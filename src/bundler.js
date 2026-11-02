import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHIM = path.join(ROOT, 'src', 'shim');
// Bundles live in the OS temp dir so the package directory (e.g. an npx cache) can be read-only.
const CACHE = path.join(os.tmpdir(), `expo-headless-mcp-${process.pid}`);
process.on('exit', () => fs.rmSync(CACHE, { recursive: true, force: true }));

const shim = (f) => path.join(SHIM, f);

// Exact-name replacements for packages whose real code needs a native runtime.
const OVERRIDES = {
  'react-native': shim('rn.js'),
  expo: shim('expo.js'),
  'expo-status-bar': shim('expo-status-bar.js'),
  'expo-font': shim('expo-font.js'),
  'expo-splash-screen': shim('expo-splash-screen.js'),
  'expo-constants': shim('expo-constants.js'),
  'react-native-safe-area-context': shim('safe-area.js'),
  '@expo/vector-icons': shim('vector-icons.js'),
  '@react-native-async-storage/async-storage': shim('async-storage.js'),
};
// The app must share the renderer's React instance, so 'react' resolves to globals set by session.js.
const HOST_REACT = { react: '__expoMcpReact', 'react/jsx-runtime': '__expoMcpJsx', 'react/jsx-dev-runtime': '__expoMcpJsxDev' };
const NATIVE_ONLY = /^(expo-.+|@expo\/.+|react-native-.+|react-native\/.+|@react-native[^/]*\/.+|react-dom(\/.*)?|react-native-web)$/;

const pkgName = (p) => (p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]);

const IMPORT_RE = /import\s+(?:type\s+)?([\w$]+)?\s*,?\s*(?:\*\s+as\s+([\w$]+)|\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
const IDENT = /^[A-Za-z_$][\w$]*$/;

// A stand-in for a native-only package: every export is a callable, chainable no-op, so
// "import { x }", "import * as X; X.y()" and "import X; X.y()" all work.
const stubSource = (names) => [
  'const make = () => new Proxy(function () {}, {',
  "  get: (_t, k) => (k === '__esModule' ? true : k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : make()),",
  '  apply: () => undefined,',
  '  construct: () => ({}),',
  '});',
  'export default make();',
  ...[...names].filter((n) => IDENT.test(n) && n !== 'default').map((n) => 'export const ' + n + ' = make();'),
].join('\n');

const makePlugin = () => {
  // Names imported from each package, so stubs can expose them as real named exports.
  const wanted = new Map();
  const want = (pkg, name) => {
    if (!wanted.has(pkg)) wanted.set(pkg, new Set());
    wanted.get(pkg).add(name);
  };
  return {
    name: 'expo-mcp-resolve',
    setup(b) {
      b.onLoad({ filter: /.*/, namespace: 'host-react' }, (args) => ({ contents: 'module.exports = globalThis.' + HOST_REACT[args.path] + ';', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubSource(wanted.get(args.path) || []), loader: 'js' }));
      // Record which names every source file takes from each package (used by stubs above).
      b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
        let text;
        try { text = await fs.promises.readFile(args.path, 'utf8'); } catch { return; }
        for (const m of text.matchAll(IMPORT_RE)) {
          const [, , ns, braces, spec] = m;
          if (braces) for (const part of braces.split(',')) {
            const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
            if (name) want(spec, name);
          }
          if (ns) {
            const escaped = ns.replace(/[$]/g, '[$]');
            for (const u of text.matchAll(new RegExp(String.raw`(?<![\w$.])${escaped}\.([A-Za-z_$][\w$]*)`, 'g'))) want(spec, u[1]);
          }
        }
      });
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.skip || args.kind === 'entry-point') return;
        const p = args.path;
        if (p.startsWith('.') || path.isAbsolute(p)) return;
        if (HOST_REACT[p]) return { path: p, namespace: 'host-react' };
        if (OVERRIDES[p]) return { path: OVERRIDES[p] };
        if (p.startsWith('@expo/vector-icons/')) return { path: shim('vector-icons.js') };
        if (NATIVE_ONLY.test(p) || NATIVE_ONLY.test(pkgName(p))) return { path: p, namespace: 'stub' };
        const r = await b.resolve(p, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { skip: true } });
        if (r.errors.length) return { path: p, namespace: 'stub' };
        return r;
      });
    },
  };
};

const exists = (f) => fs.existsSync(f);

// Finds the file that makes the app mount: App.* in the project root or src/, else package.json "main".
export const findEntry = (project, explicit) => {
  if (explicit) return { file: path.resolve(project, explicit), kind: explicit.match(/(^|[\\/])App\.[jt]sx?$/) ? 'app' : 'main' };
  for (const dir of ['', 'src']) {
    for (const ext of ['tsx', 'jsx', 'js', 'ts']) {
      const f = path.join(project, dir, `App.${ext}`);
      if (exists(f)) return { file: f, kind: 'app' };
    }
  }
  try {
    const main = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')).main;
    if (main && !main.startsWith('node_modules') && !main.startsWith('expo/') && exists(path.join(project, main))) return { file: path.join(project, main), kind: 'main' };
  } catch {}
  throw new Error(`No App.(js|jsx|ts|tsx) or usable "main" found in ${project}. Pass "entry" explicitly. (expo-router apps are not supported.)`);
};

let counter = 0;

export const bundleProject = async (project, explicitEntry) => {
  const entry = findEntry(project, explicitEntry);
  fs.mkdirSync(CACHE, { recursive: true });
  for (const f of fs.readdirSync(CACHE)) if (f.startsWith('bundle-')) fs.rmSync(path.join(CACHE, f), { force: true });
  const id = ++counter;
  const stdin = {
    contents:
      entry.kind === 'app'
        ? `import App from ${JSON.stringify(entry.file)};\nconst s = globalThis.__rnState;\nif (s && !s.root) s.root = App;\n`
        : `import ${JSON.stringify(entry.file)};\n`,
    resolveDir: project,
    sourcefile: 'expo-mcp-entry.js',
    loader: 'js',
  };
  const outfile = path.join(CACHE, `bundle-${Date.now()}-${id}.mjs`);
  await build({
    stdin,
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'node20',
    logLevel: 'silent',
    sourcemap: 'inline',
    plugins: [makePlugin()],
    mainFields: ['react-native', 'browser', 'module', 'main'],
    resolveExtensions: ['.ios.tsx', '.ios.ts', '.ios.jsx', '.ios.js', '.native.tsx', '.native.ts', '.native.jsx', '.native.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    loader: {
      '.js': 'jsx',
      '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl',
      '.ttf': 'empty', '.otf': 'empty', '.mp3': 'empty', '.mp4': 'empty', '.wav': 'empty',
    },
    define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"', global: 'globalThis' },
    jsx: 'automatic',
    absWorkingDir: project,
  });
  return { url: pathToFileURL(outfile).href + '?v=' + id, entry: entry.file };
};
