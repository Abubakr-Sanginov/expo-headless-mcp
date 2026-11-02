// iOS Simulator mode: drives Expo Go in a booted simulator. macOS + Xcode only.
// Screenshots, install and URL opening use `xcrun simctl`; taps/typing/UI tree need Facebook's `idb`
// (simctl has no input commands). Physical iPhones cannot be driven this way.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { Device, UserDecision, run, download, sleep, projectSdk, requiredExpoGo } from './device.js';

export const EXPO_GO_IOS = 'host.exp.Exponent';
const EXPO_GO = 'host.exp.exponent'; // value used for the shared node "package" field

// EXPO_MCP_XCRUN / EXPO_MCP_IDB may point to a .js script (tests) or a binary.
const xcrunBin = () => process.env.EXPO_MCP_XCRUN || 'xcrun';
const idbBin = () => process.env.EXPO_MCP_IDB || 'idb';
const isMac = () => process.platform === 'darwin' || !!process.env.EXPO_MCP_FORCE_DARWIN;
const withBin = (bin, args) => (bin.endsWith('.js') ? run(process.execPath, [bin, ...args]) : run(bin, args));
const xcrun = (args, opts) => withBin(xcrunBin(), args, opts);
const idb = (args, opts) => withBin(idbBin(), args, opts);
const text = (r) => r.stdout.toString('utf8');

export const IDB_HELP = [
  'Taps, typing and reading the iOS UI need Facebook\'s "idb" (Xcode\'s simctl cannot send input). Install it yourself, then retry:',
  '  brew tap facebook/fb && brew install idb-companion',
  '  pip3 install fb-idb',
].join('\n');

export const IOS_UNAVAILABLE =
  'iOS Simulator testing needs a Mac with Xcode (this computer is not macOS). Physical iPhones cannot be driven by this tool either (Apple blocks remote input). Open the app in Expo Go on the iPhone yourself and check it there, or use headless / Android mode.';

export const iosToolsAvailable = async () => {
  if (!isMac()) return { mac: false };
  const r = await xcrun(['simctl', 'help']);
  const hasIdb = (await idb(['--help'])).code === 0;
  return { mac: true, simctl: r.code === 0, idb: hasIdb };
};

export const listSimulators = async () => {
  if (!isMac()) return { available: false, sims: [] };
  const r = await xcrun(['simctl', 'list', 'devices', '-j']);
  if (r.code !== 0) return { available: false, sims: [], error: 'xcrun simctl failed — is Xcode installed? ' + r.stderr.trim().slice(0, 200) };
  const data = JSON.parse(text(r));
  const sims = [];
  for (const [runtime, list] of Object.entries(data.devices || {})) {
    for (const d of list) {
      if (d.isAvailable === false) continue;
      sims.push({ platform: 'ios', serial: d.udid, state: d.state === 'Booted' ? 'device' : d.state, model: d.name, runtime: runtime.replace(/.*SimRuntime\./, '').replace(/-/g, '.'), emulator: true });
    }
  }
  return { available: true, sims: sims.filter((s) => s.state === 'device').concat(sims.filter((s) => s.state !== 'device')) };
};

const decodeFrame = (e) => {
  if (e.frame && typeof e.frame === 'object') return { x: e.frame.x, y: e.frame.y, w: e.frame.width, h: e.frame.height };
  const m = String(e.AXFrame || '').match(/\{\{(-?[\d.]+),\s*(-?[\d.]+)\},\s*\{(-?[\d.]+),\s*(-?[\d.]+)\}\}/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
};

const CLICKABLE = /^(Button|Link|Switch|Cell|Tab|TabBar|Toggle|MenuItem|Segmented|CheckBox|RadioButton)/i;
const INPUT = /^(TextField|SecureTextField|TextView|SearchField)/i;

export class IosSimulator extends Device {
  constructor(info, project) {
    super(info, project);
    this.points = null;
    this.lastTap = null;
  }

  get physical() {
    return false;
  }

  async ensureExpoGo(ask) {
    const sdk = projectSdk(this.project);
    if (!sdk) throw new Error(`Cannot tell which Expo SDK ${this.project} uses (no "expo" dependency in package.json).`);
    const need = await requiredExpoGo(sdk);
    if (!need.iosUrl) throw new Error(`Expo does not publish an iOS Expo Go build for SDK ${sdk}.`);
    const container = await xcrun(['simctl', 'get_app_container', this.serial, EXPO_GO_IOS]);
    let have = null;
    if (container.code === 0) {
      const plist = path.join(text(container).trim(), 'Info.plist');
      const v = await withBin(process.env.EXPO_MCP_PLUTIL || 'plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist]);
      const version = text(v).trim();
      have = { version: version || 'unknown', sdk: version ? Number(version.split('.')[0]) : null };
    }
    if (have && have.sdk === sdk) return { installed: false, version: have.version };

    const name = this.info.model || this.serial;
    const message = !have
      ? `Expo Go is not installed in the simulator "${name}". Install Expo Go ${need.iosVersion} (SDK ${sdk}, from Expo's official release) into it?`
      : `The simulator "${name}" has Expo Go ${have.version} (SDK ${have.sdk}) but this project uses SDK ${sdk}. Replace it with Expo Go ${need.iosVersion}?`;
    await ask(message, `install-expo-go:${this.serial}:${need.iosVersion}`);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-go-ios-'));
    try {
      const tgz = path.join(dir, 'ExpoGo.tar.gz');
      if (process.env.EXPO_MCP_SKIP_DOWNLOAD) fs.writeFileSync(tgz, '');
      else await download(need.iosUrl, tgz);
      const x = await run('tar', ['-xzf', tgz, '-C', dir]);
      if (x.code !== 0 && !process.env.EXPO_MCP_SKIP_DOWNLOAD) throw new Error('Could not unpack Expo Go: ' + x.stderr.trim());
      const app = process.env.EXPO_MCP_SKIP_DOWNLOAD ? dir : fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => f.endsWith('.app'));
      if (!app) throw new Error('Expo Go archive did not contain an .app bundle.');
      const r = await xcrun(['simctl', 'install', this.serial, app], { timeout: 5 * 60 * 1000 });
      if (r.code !== 0) throw new Error('simctl install failed: ' + r.stderr.trim().slice(0, 400));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    return { installed: true, version: need.iosVersion };
  }

  async reload() {
    const mark = this.metroLog.length;
    await xcrun(['simctl', 'terminate', this.serial, EXPO_GO_IOS]);
    const r = await xcrun(['simctl', 'openurl', this.serial, `exp://127.0.0.1:${this.port}`]);
    if (r.code !== 0) throw new Error('simctl openurl failed: ' + r.stderr.trim().slice(0, 300));
    for (let i = 0; i < 180; i++) {
      if (this.metroLog.slice(mark).some((l) => /Bundled|Bundling failed|Unable to resolve/i.test(l))) break;
      await sleep(500);
    }
    await sleep(2500);
  }

  cleanup() {}

  async foreground() {
    // The simulator is disposable and has no per-app focus API without private tooling.
    return { inExpoGo: true, line: 'iOS Simulator (foreground check not available)' };
  }

  async requireExpoGoFocus() {}

  async nodes() {
    const r = await idb(['ui', 'describe-all', '--udid', this.serial, '--json'], { timeout: 30000 });
    if (r.code !== 0) throw new Error('idb ui describe-all failed: ' + (r.stderr.trim() || text(r)).slice(0, 300));
    const raw = text(r).trim();
    let list;
    try {
      const j = JSON.parse(raw);
      list = Array.isArray(j) ? j : [j];
    } catch {
      list = raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
    }
    const out = [];
    for (const e of list.flat()) {
      const f = decodeFrame(e);
      if (!f) continue;
      const type = String(e.type || e.role || '').replace(/^AX/, '');
      if (/^Application$/i.test(type)) {
        this.points = { w: f.w, h: f.h };
        continue;
      }
      const input = INPUT.test(type);
      out.push({
        text: input ? e.AXValue || '' : e.AXLabel || e.AXValue || '',
        'content-desc': input ? e.AXLabel || '' : '',
        'resource-id': e.AXUniqueId || '',
        class: input ? 'EditText' : type,
        package: EXPO_GO,
        clickable: CLICKABLE.test(type) ? 'true' : 'false',
        focused: 'false',
        x1: f.x, y1: f.y, x2: f.x + f.w, y2: f.y + f.h,
      });
    }
    return out;
  }

  async screenshot(maxDim = 1280) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-ios-shot-'));
    const file = path.join(dir, 'shot.png');
    try {
      const r = await xcrun(['simctl', 'io', this.serial, 'screenshot', '--type=png', file], { timeout: 30000 });
      if (r.code !== 0 || !fs.existsSync(file)) throw new Error('simctl screenshot failed: ' + r.stderr.trim().slice(0, 300));
      const raw = fs.readFileSync(file);
      const img = await loadImage(raw);
      if (!this.points) await this.nodes().catch(() => {}); // learns the point size (taps use points, not pixels)
      const k = Math.min(1, maxDim / Math.max(img.width, img.height));
      this.shot = { w: Math.round(img.width * k), h: Math.round(img.height * k) };
      this.scale = this.points ? this.shot.w / this.points.w : k;
      if (k === 1) return raw;
      const c = createCanvas(this.shot.w, this.shot.h);
      c.getContext('2d').drawImage(img, 0, 0, this.shot.w, this.shot.h);
      return c.toBuffer('image/png');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  toDevice(x, y) {
    return [Math.round((x / this.scale) * 10) / 10, Math.round((y / this.scale) * 10) / 10];
  }

  async tap(x, y, long = false) {
    const [dx, dy] = this.toDevice(x, y);
    this.lastTap = { x: dx, y: dy };
    const r = await idb(['ui', 'tap', String(dx), String(dy), ...(long ? ['--duration', '0.8'] : []), '--udid', this.serial]);
    if (r.code !== 0) throw new Error('idb tap failed: ' + r.stderr.trim().slice(0, 300));
  }

  async swipe(x1, y1, x2, y2, ms = 300) {
    const pts = [...this.toDevice(x1, y1), ...this.toDevice(x2, y2)].map(String);
    const r = await idb(['ui', 'swipe', ...pts, '--duration', String(ms / 1000), '--udid', this.serial]);
    if (r.code !== 0) throw new Error('idb swipe failed: ' + r.stderr.trim().slice(0, 300));
  }

  async key(name) {
    if (name === 'back') throw new Error('iOS has no hardware back key; tap the app\'s own Back button instead.');
    const codes = { enter: 40, tab: 43, delete: 42 }; // HID usage ids
    if (!(name in codes)) throw new Error(`Key "${name}" is not allowed. Allowed: enter, tab, delete.`);
    await idb(['ui', 'key', String(codes[name]), '--udid', this.serial]);
  }

  async typeText(txt, { replace = true } = {}) {
    if (/[^\x20-\x7e]/.test(txt)) throw new Error('Typing non-ASCII text (Cyrillic, CJK, emoji, accents, newlines…) into the iOS Simulator is not supported through idb. Test those languages in headless mode instead.');
    if (replace && this.lastTap) {
      const nodes = await this.nodes();
      const f = nodes.find((n) => n.class === 'EditText' && n.x1 <= this.lastTap.x && n.x2 >= this.lastTap.x && n.y1 <= this.lastTap.y && n.y2 >= this.lastTap.y);
      const len = Math.min(200, (f ? (f.text || '').length : 0) + 2);
      if (len) await idb(['ui', 'key-sequence', ...Array(len).fill('42'), '--udid', this.serial]);
    }
    const r = await idb(['ui', 'text', txt, '--udid', this.serial]);
    if (r.code !== 0) throw new Error('idb text failed: ' + r.stderr.trim().slice(0, 300));
  }
}

export { UserDecision };
