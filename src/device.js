// Real-device mode: drives Expo Go on an Android emulator or a USB phone through adb.
// Works from Windows, macOS and Linux. Anything that changes the device (install, uninstall,
// controlling a physical phone) goes through `ask`, which must obtain the user's consent.
import { execFile, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export const EXPO_GO = 'host.exp.exponent';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UserDecision extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'declined' | 'needs-confirmation'
  }
}

// ---------- adb plumbing ----------
let adbPath = null;
// EXPO_MCP_ADB overrides discovery (a path to adb, or to a .js script that emulates it in tests).
const adbCommand = (file, args) => (file.endsWith('.js') ? [process.execPath, [file, ...args]] : [file, args]);
export const findAdb = () => {
  if (adbPath) return adbPath;
  if (process.env.EXPO_MCP_ADB) {
    const [f, a] = adbCommand(process.env.EXPO_MCP_ADB, ['version']);
    return spawnSync(f, a, { windowsHide: true }).status === 0 ? (adbPath = process.env.EXPO_MCP_ADB) : null;
  }
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const home = os.homedir();
  const sdkDirs = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    process.platform === 'darwin' && path.join(home, 'Library', 'Android', 'sdk'),
    process.platform === 'linux' && path.join(home, 'Android', 'Sdk'),
  ].filter(Boolean);
  // tools/platform-tools next to this package is where a user-approved download of adb is placed.
  const local = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'platform-tools', exe);
  const candidates = ['adb', ...sdkDirs.map((d) => path.join(d, 'platform-tools', exe)), local];
  for (const c of candidates) {
    if (c !== 'adb' && !fs.existsSync(c)) continue;
    const r = spawnSync(c, ['version'], { windowsHide: true });
    if (r.status === 0) return (adbPath = c);
  }
  return null;
};

export const run = (file, args, { timeout = 30000 } = {}) =>
  new Promise((resolve) => {
    [file, args] = adbCommand(file, args);
    execFile(file, args, { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: stderr.toString(), error: err }));
  });

const adb = (serial, args, opts) => run(findAdb(), serial ? ['-s', serial, ...args] : args, opts);
const adbText = async (serial, args, opts) => (await adb(serial, args, opts)).stdout.toString('utf8');

export const NO_ADB_HELP =
  'adb (Android platform-tools) was not found on this computer. Install "Android SDK Platform-Tools" from https://developer.android.com/tools/releases/platform-tools (it works on Windows, macOS and Linux), make sure `adb` is on PATH or set ANDROID_HOME, then try again.';

export const USB_DEBUGGING_HELP = [
  'To enable USB debugging on an Android phone:',
  '1. Settings → About phone → tap "Build number" 7 times (enters developer mode).',
  '2. Settings → System → Developer options → turn on "USB debugging".',
  '3. Connect with a data-capable USB cable, set USB mode to "File transfer", unlock the phone and tap "Allow" on the "Allow USB debugging?" dialog.',
  'Heads-up: once connected, the AI will be tapping, typing and scrolling on the phone screen (only inside Expo Go) — keep the phone unlocked and do not use it meanwhile.',
].join('\n');

export const listDevices = async () => {
  if (!findAdb()) return { adb: false, devices: [] };
  await run(findAdb(), ['start-server']);
  const out = await adbText(null, ['devices', '-l']);
  const devices = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || !parts[0] || parts[0].startsWith('*')) continue;
    const state = parts[1] === 'no' ? 'no permissions' : parts[1];
    const attrs = Object.fromEntries(parts.slice(2).map((p) => p.split(':')).filter((p) => p.length === 2));
    devices.push({
      serial: parts[0],
      state,
      model: (attrs.model || attrs.device || '').replace(/_/g, ' '),
      emulator: parts[0].startsWith('emulator-'),
      usb: !parts[0].startsWith('emulator-') && !/^[\d.]+:\d+$/.test(parts[0]) ? 'usb' : parts[0].startsWith('emulator-') ? 'emulator' : 'wifi',
    });
  }
  return { adb: true, devices };
};

export const stateGuidance = (d) => {
  const who = `${d.model || d.serial}`;
  switch (d.state) {
    case 'device': return null;
    case 'unauthorized':
      return `USB debugging is not authorized on ${who}. Ask the user to unlock the phone and tap "Allow" on the "Allow USB debugging?" dialog (tick "Always allow from this computer"). If no dialog appears: unplug and replug the cable, or Developer options → "Revoke USB debugging authorizations", then reconnect. Warn them that the AI will tap on the phone once it is allowed.`;
    case 'offline':
      return `${who} is listed as offline. Ask the user to reconnect the cable / restart the emulator (or run \`adb kill-server\`) and try again.`;
    case 'no permissions':
      return `${who} has no adb permissions (usually missing udev rules on Linux). Ask the user to set up udev rules for their phone vendor or run adb with proper permissions.`;
    default:
      return `${who} is in state "${d.state}" and cannot be used yet.`;
  }
};

// ---------- Expo SDK / Expo Go versions ----------
export const projectSdk = (project) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
    const v = (pkg.dependencies && pkg.dependencies.expo) || (pkg.devDependencies && pkg.devDependencies.expo);
    const m = v && String(v).match(/(\d+)\./);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
};

export const requiredExpoGo = async (sdk) => {
  const res = await fetch('https://api.expo.dev/v2/versions/latest', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Could not read Expo's version list (HTTP ${res.status}).`);
  const data = (await res.json()).data;
  const entry = data.sdkVersions && data.sdkVersions[`${sdk}.0.0`];
  if (!entry || (!entry.androidClientUrl && !entry.iosClientUrl)) throw new Error(`Expo does not publish an Expo Go build for SDK ${sdk} (it may be too old or too new).`);
  return { sdk, version: entry.androidClientVersion, url: entry.androidClientUrl, iosVersion: entry.iosClientVersion, iosUrl: entry.iosClientUrl };
};

const installedExpoGo = async (serial) => {
  const list = await adbText(serial, ['shell', 'pm', 'list', 'packages', EXPO_GO]);
  if (!new RegExp(`package:${EXPO_GO.replace(/\./g, '\\.')}\\s*$`, 'm').test(list)) return null;
  const dump = await adbText(serial, ['shell', 'dumpsys', 'package', EXPO_GO]);
  const m = dump.match(/versionName=([\d.]+)/);
  return { version: m ? m[1] : 'unknown', sdk: m ? Number(m[1].split('.')[0]) : null };
};

export const download = async (url, file) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
};

// ---------- Metro (the JS dev server Expo Go connects to) ----------
const freePort = (start) =>
  new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once('error', () => tryPort(p + 1));
      s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)));
    };
    tryPort(start);
  });

const killTree = (child) => {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {}
};

const xmlDecode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

export class Device {
  constructor(info, project) {
    this.info = info;
    this.serial = info.serial;
    this.project = project;
    this.scale = 1;
    this.metro = null;
    this.metroLog = [];
    this.port = null;
  }

  get physical() {
    return !this.info.emulator;
  }

  // ----- Expo Go on the device (asks before installing / replacing) -----
  async ensureExpoGo(ask) {
    const sdk = projectSdk(this.project);
    if (!sdk) throw new Error(`Cannot tell which Expo SDK ${this.project} uses (no "expo" dependency in package.json).`);
    const need = await requiredExpoGo(sdk);
    if (!need.url) throw new Error(`Expo does not publish an Android Expo Go build for SDK ${sdk}.`);
    const have = await installedExpoGo(this.serial);
    const name = this.info.model || this.serial;
    if (have && have.sdk === sdk) return { installed: false, version: have.version };

    const downgrade = have && have.sdk != null && have.sdk > sdk;
    const message = !have
      ? `Expo Go is not installed on ${name}. Install Expo Go ${need.version} (SDK ${sdk}, downloaded from Expo's official release, ~100 MB) on this ${this.physical ? 'phone' : 'emulator'}?`
      : downgrade
        ? `${name} has Expo Go ${have.version} (SDK ${have.sdk}) but this project uses SDK ${sdk}. Android cannot downgrade in place, so the current Expo Go must be UNINSTALLED first (its saved project list is lost) and Expo Go ${need.version} installed. Proceed?`
        : `${name} has Expo Go ${have.version} (SDK ${have.sdk}) but this project uses SDK ${sdk}. Update it to Expo Go ${need.version}?`;
    await ask(message, `install-expo-go:${this.serial}:${need.version}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-go-'));
    const apk = path.join(dir, `Expo-Go-${need.version}.apk`);
    try {
      if (process.env.EXPO_MCP_SKIP_DOWNLOAD) fs.writeFileSync(apk, ''); // test hook
      else await download(need.url, apk);
      if (downgrade) {
        const u = await adb(this.serial, ['uninstall', EXPO_GO], { timeout: 120000 });
        if (u.code !== 0) throw new Error('Uninstalling the old Expo Go failed: ' + u.stdout.toString() + u.stderr);
      }
      const r = await adb(this.serial, ['install', '-r', apk], { timeout: 10 * 60 * 1000 });
      const out = r.stdout.toString() + r.stderr;
      if (r.code !== 0 || !/Success/i.test(out)) throw new Error('adb install failed: ' + out.trim().slice(0, 400));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const now = await installedExpoGo(this.serial);
    if (!now || now.sdk !== sdk) throw new Error(`Expo Go installation could not be verified (found ${now ? now.version : 'nothing'}).`);
    return { installed: true, version: now.version };
  }

  // ----- Metro -----
  async startMetro(ask) {
    if (this.metro && !this.metro.killed && this.metro.exitCode === null) return;
    if (!fs.existsSync(path.join(this.project, 'node_modules', 'expo'))) {
      await ask(`The project's dependencies are not installed (no node_modules/expo in ${this.project}). Run "npm install" there so the Expo dev server can start?`, `npm-install:${this.project}`);
      const r = spawnSync('npm', ['install'], { cwd: this.project, shell: true, windowsHide: true, encoding: 'utf8', timeout: 15 * 60 * 1000 });
      if (r.status !== 0) throw new Error('npm install failed:\n' + String(r.stderr || r.stdout).slice(-600));
    }
    this.port = await freePort(8081);
    this.metroLog = [];
    // EXPO_MCP_METRO_CMD lets users (and tests) supply their own dev-server command; {port} is replaced.
    const custom = process.env.EXPO_MCP_METRO_CMD;
    const child = spawn(custom ? custom.replace('{port}', String(this.port)) : 'npx', custom ? [] : ['expo', 'start', '--port', String(this.port)], {
      cwd: this.project,
      shell: true,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, EXPO_NO_TELEMETRY: '1', BROWSER: 'none', CI: '', FORCE_COLOR: '0' },
    });
    this.metro = child;
    const onData = (b) => {
      for (const l of b.toString().split(/\r?\n/)) if (l.trim()) this.metroLog.push(l.trim());
      if (this.metroLog.length > 300) this.metroLog.splice(0, this.metroLog.length - 300);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    process.once('exit', () => killTree(child));
    for (let i = 0; i < 240; i++) {
      if (child.exitCode !== null) throw new Error('Expo dev server exited early:\n' + this.metroLog.slice(-8).join('\n'));
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/status`, { signal: AbortSignal.timeout(1500) });
        if ((await res.text()).includes('running')) return;
      } catch {}
      await sleep(500);
    }
    throw new Error('Expo dev server did not start within 2 minutes:\n' + this.metroLog.slice(-8).join('\n'));
  }

  stop() {
    killTree(this.metro);
    this.metro = null;
    this.cleanup();
  }

  cleanup() {
    if (this.port) adb(this.serial, ['reverse', '--remove', `tcp:${this.port}`]).catch(() => {});
  }

  // (Re)starts the app inside Expo Go and waits for the bundle.
  async reload() {
    const mark = this.metroLog.length;
    await adb(this.serial, ['reverse', `tcp:${this.port}`, `tcp:${this.port}`]);
    await adb(this.serial, ['shell', 'am', 'force-stop', EXPO_GO]);
    await adb(this.serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `exp://127.0.0.1:${this.port}`, '-p', EXPO_GO]);
    for (let i = 0; i < 180; i++) {
      if (this.metroLog.slice(mark).some((l) => /Bundled|Bundling failed|Unable to resolve/i.test(l))) break;
      await sleep(500);
    }
    await sleep(2000);
  }

  metroProblems(since = 0) {
    return this.metroLog.slice(since).filter((l) => /error|unable to resolve|failed|exception/i.test(l)).slice(-10);
  }

  // ----- screen access -----
  async size() {
    const out = await adbText(this.serial, ['shell', 'wm', 'size']);
    const m = [...out.matchAll(/(\d+)x(\d+)/g)].pop();
    if (!m) throw new Error('Could not read the screen size: ' + out.trim());
    return { w: Number(m[1]), h: Number(m[2]) };
  }

  async foreground() {
    const out = await adbText(this.serial, ['shell', 'dumpsys', 'activity', 'activities']);
    const line = out.split(/\r?\n/).find((l) => /topResumedActivity|mResumedActivity/.test(l)) || '';
    return { inExpoGo: line.includes(EXPO_GO), line: line.trim() };
  }

  async requireExpoGoFocus() {
    const fg = await this.foreground();
    if (!fg.inExpoGo) throw new Error(`Expo Go is not in the foreground (${fg.line || 'unknown app'}). Refusing to touch other apps on the device. Call refresh_screen to bring the app back.`);
  }

  async screenshot(maxDim = 1280) {
    const r = await adb(this.serial, ['exec-out', 'screencap', '-p'], { timeout: 30000 });
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const start = r.stdout.indexOf(sig);
    if (start < 0) throw new Error('Screenshot failed: ' + (r.stderr || r.stdout.toString().slice(0, 200)));
    const raw = r.stdout.subarray(start);
    const img = await loadImage(raw);
    this.scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    this.shot = { w: Math.round(img.width * this.scale), h: Math.round(img.height * this.scale) };
    if (this.scale === 1) return raw;
    const c = createCanvas(this.shot.w, this.shot.h);
    c.getContext('2d').drawImage(img, 0, 0, this.shot.w, this.shot.h);
    return c.toBuffer('image/png');
  }

  toDevice(x, y) {
    return [Math.round(x / this.scale), Math.round(y / this.scale)];
  }

  async tap(x, y, long = false) {
    await this.requireExpoGoFocus();
    const [dx, dy] = this.toDevice(x, y);
    const args = long ? ['shell', 'input', 'swipe', dx, dy, dx, dy, 800] : ['shell', 'input', 'tap', dx, dy];
    const r = await adb(this.serial, args.map(String));
    if (r.code !== 0) throw new Error('tap failed: ' + r.stderr);
  }

  async swipe(x1, y1, x2, y2, ms = 300) {
    await this.requireExpoGoFocus();
    const pts = [...this.toDevice(x1, y1), ...this.toDevice(x2, y2)];
    await adb(this.serial, ['shell', 'input', 'swipe', ...pts.map(String), String(ms)]);
  }

  async key(name) {
    const codes = { back: 4, enter: 66, tab: 61, delete: 67 };
    if (!(name in codes)) throw new Error(`Key "${name}" is not allowed. Allowed: ${Object.keys(codes).join(', ')}.`);
    await this.requireExpoGoFocus();
    await adb(this.serial, ['shell', 'input', 'keyevent', String(codes[name])]);
  }

  // adb "input text" only handles printable ASCII; refuse anything else rather than type garbage.
  async typeText(text, { replace = true } = {}) {
    if (/[^\x20-\x7e]/.test(text)) throw new Error('Typing non-ASCII text (Cyrillic, CJK, emoji, accents, newlines…) into a real device is not supported through adb. Test those languages in headless mode instead, or ask the user to type them.');
    if (text.includes('%')) throw new Error('The "%" character cannot be typed through adb input.');
    await this.requireExpoGoFocus();
    if (replace) {
      const nodes = await this.nodes();
      const f = nodes.find((n) => n.focused === 'true');
      const len = Math.min(200, (f ? (f.text || '').length : 0) + 2);
      await adb(this.serial, ['shell', 'input', 'keyevent', '123', ...Array(len).fill('67')]); // MOVE_END then DEL x N
    }
    const escaped = text.replace(/ /g, '%s').replace(/([&|;<>()$`\\"'*?[\]{}~#!^])/g, '\\$1');
    const r = await adb(this.serial, ['shell', 'input', 'text', escaped]);
    if (r.code !== 0) throw new Error('typing failed: ' + r.stderr);
  }

  // UI tree via uiautomator, with bounds converted to screenshot coordinates.
  async nodes() {
    const xml = await adbText(this.serial, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 30000 });
    const out = [];
    for (const m of xml.matchAll(/<node\s+([^>]*?)\/?>/g)) {
      const a = {};
      for (const kv of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[kv[1]] = xmlDecode(kv[2]);
      const b = (a.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (!b) continue;
      const [x1, y1, x2, y2] = b.slice(1).map(Number);
      out.push({ ...a, x1, y1, x2, y2 });
    }
    return out;
  }

  describe(nodes) {
    const s = this.scale;
    const rows = nodes.filter((n) => n.package === EXPO_GO && (n.text || n['content-desc'] || n['resource-id'] || n.clickable === 'true'));
    return rows.map((n) => {
      const cx = Math.round(((n.x1 + n.x2) / 2) * s);
      const cy = Math.round(((n.y1 + n.y2) / 2) * s);
      const kind = /EditText/.test(n.class) ? 'TextInput' : n.clickable === 'true' ? 'Pressable' : /Image/.test(n.class) ? 'Image' : 'Text';
      const label = [n.text && `"${n.text.slice(0, 80)}"`, n['content-desc'] && `desc=${JSON.stringify(n['content-desc'].slice(0, 60))}`, n['resource-id'] && `id=${n['resource-id'].split('/').pop()}`].filter(Boolean).join(' ');
      return `${kind} ${label} @ (${Math.round(n.x1 * s)},${Math.round(n.y1 * s)}) ${Math.round((n.x2 - n.x1) * s)}x${Math.round((n.y2 - n.y1) * s)} center=(${cx},${cy})${n.focused === 'true' ? ' FOCUSED' : ''}`;
    });
  }

  findTarget(nodes, query) {
    const q = String(query).toLowerCase();
    const pool = nodes.filter((n) => n.package === EXPO_GO);
    const keys = (n) => [n.text, n['content-desc'], n['resource-id'] && n['resource-id'].split('/').pop(), n['resource-id']].filter(Boolean).map((s) => s.toLowerCase());
    const exact = pool.filter((n) => keys(n).includes(q));
    const hits = exact.length ? exact : pool.filter((n) => keys(n).some((k) => k.includes(q)));
    return hits.find((n) => n.clickable === 'true') || hits[0] || null;
  }
}
