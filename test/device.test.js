// Device-mode tests against a fake adb (test/fakes/fake-adb.js). Run: node test/device.test.js
// Needs network once for Expo's public version list; the APK download itself is skipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createCanvas } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-mcp-dev-'));
const project = path.join(work, 'app');
fs.cpSync(path.join(here, 'fixtures', 'login'), project, { recursive: true });
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'app', main: 'index.js', dependencies: { expo: '~58.0.22' } }));
fs.mkdirSync(path.join(project, 'node_modules', 'expo'), { recursive: true });
const png = path.join(work, 'screen.png');
fs.writeFileSync(png, createCanvas(1080, 2400).toBuffer('image/png'));

const PHONE = { serial: 'R58M123', state: 'device', model: 'Galaxy_S23' };
const EMU = { serial: 'emulator-5554', state: 'device', model: 'Pixel_7' };

const SIM = { udid: 'AAAA-1111', name: 'iPhone 15', state: 'Booted' };

const start = async ({ devices, goVersion, iosVersion, elicit, noAdb, sims, noIdb, mac = true }) => {
  const dir = fs.mkdtempSync(path.join(work, 'fake-'));
  if (goVersion) fs.writeFileSync(path.join(dir, 'go-version'), goVersion);
  if (iosVersion) fs.writeFileSync(path.join(dir, 'ios-version'), iosVersion);
  const env = {
    ...process.env,
    EXPO_PROJECT: project,
    EXPO_MCP_ADB: noAdb ? path.join(work, 'does-not-exist') : path.join(here, 'fakes', 'fake-adb.js'),
    EXPO_MCP_SKIP_DOWNLOAD: '1',
    EXPO_MCP_METRO_CMD: `node "${path.join(here, 'fakes', 'fake-metro.js')}" {port}`,
    FAKE_DIR: dir,
    FAKE_PNG: png,
    FAKE_DEVICES: JSON.stringify(devices || []),
    FAKE_SIMS: JSON.stringify(sims || []),
    EXPO_MCP_XCRUN: path.join(here, 'fakes', 'fake-xcrun.js'),
    EXPO_MCP_PLUTIL: path.join(here, 'fakes', 'fake-plutil.js'),
    EXPO_MCP_IDB: noIdb ? path.join(work, 'no-idb') : path.join(here, 'fakes', 'fake-idb.js'),
  };
  if (mac) env.EXPO_MCP_FORCE_DARWIN = '1';
  else delete env.EXPO_MCP_FORCE_DARWIN;
  const client = new Client({ name: 't', version: '1' }, { capabilities: elicit ? { elicitation: {} } : {} });
  const asked = [];
  if (elicit) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      asked.push(req.params.message);
      return elicit === 'accept' ? { action: 'accept', content: { approve: true } } : { action: 'decline' };
    });
  }
  await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(root, 'src', 'server.js')], env }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'), images: r.content.filter((c) => c.type === 'image').length, isError: !!r.isError };
  };
  const log = () => (fs.existsSync(path.join(dir, 'log.txt')) ? fs.readFileSync(path.join(dir, 'log.txt'), 'utf8') : '');
  return { client, call, asked, log, dir, close: () => client.close() };
};

let failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.error('ok   ', name); } catch (e) { failed++; console.error('FAIL ', name, '\n', e.stack.split('\n').slice(0, 6).join('\n')); }
};

await test('adb missing: advises the user to check themselves, changes nothing', async () => {
  const t = await start({ noAdb: true });
  const r = await t.call('device_list');
  assert.match(r.text, /adb .* not found/i);
  assert.match(r.text, /check the app themselves/i);
  const u = await t.call('use_target', { target: 'device' });
  assert.match(u.text, /Nothing was changed/);
  await t.close();
});

await test('nothing connected: advice + USB debugging steps + phone-tapping warning', async () => {
  const t = await start({ devices: [] });
  const r = await t.call('device_list');
  assert.match(r.text, /No Android device\/emulator or booted iOS Simulator is connected/);
  assert.match(r.text, /themselves/);
  assert.match(r.text, /USB debugging/);
  assert.match(r.text, /tapping, typing and scrolling on the phone/);
  assert.equal(t.log(), '');
  await t.close();
});

await test('unauthorized phone: tells how to authorize and warns about tapping', async () => {
  const t = await start({ devices: [{ ...PHONE, state: 'unauthorized' }] });
  const r = await t.call('use_target', { target: 'device' });
  assert.match(r.text, /Allow USB debugging|Allow/);
  assert.match(r.text, /tapping, typing and scrolling/);
  assert.doesNotMatch(t.log(), /install|input|am start/);
  await t.close();
});

await test('no elicitation: asks the AI to relay, touches nothing until confirmed (phone + Expo Go missing)', async () => {
  const t = await start({ devices: [PHONE] });
  let r = await t.call('use_target', { target: 'device' });
  assert.match(r.text, /USER CONFIRMATION REQUIRED/);
  assert.match(r.text, /CONTROL your phone/);
  assert.equal(t.log(), '', 'no adb commands may run before consent (apart from listing)');
  const key1 = r.text.match(/\[confirmation key: ([^\]]+)\]/)[1];
  r = await t.call('use_target', { target: 'device', confirmed: [key1] });
  assert.match(r.text, /Expo Go is not installed/);
  assert.doesNotMatch(t.log(), /\binstall\b/, 'must not install before consent');
  const key2 = r.text.match(/\[confirmation key: ([^\]]+)\]/)[1];
  r = await t.call('use_target', { target: 'device', confirmed: [key1, key2] });
  assert.match(r.text, /Device mode: Galaxy S23 \(Android phone\), Expo Go 58\.0\.\d+ \(just installed\)/, r.text);
  assert.equal(r.images, 1);
  assert.match(t.log(), /install -r .*\.apk/);
  await t.close();
});

await test('elicitation decline: nothing installed or touched, firm "do not retry"', async () => {
  const t = await start({ devices: [PHONE], elicit: 'decline' });
  const r = await t.call('use_target', { target: 'device' });
  assert.match(r.text, /user declined/i);
  assert.match(r.text, /Do NOT retry/);
  assert.equal(t.asked.length, 1);
  assert.equal(t.log(), '');
  await t.close();
});

await test('elicitation accept + wrong SDK: asks to replace Expo Go, then works', async () => {
  const t = await start({ devices: [EMU], goVersion: '57.0.1', elicit: 'accept' });
  const r = await t.call('use_target', { target: 'device' });
  assert.equal(t.asked.length, 1, 'emulator needs no control consent, only the SDK mismatch question');
  assert.match(t.asked[0], /Expo Go 57\.0\.1 \(SDK 57\).*SDK 58/);
  assert.match(r.text, /Device mode: Pixel 7 \(Android emulator\)/, r.text);
  await t.close();
});

await test('correct SDK already installed: no questions for an emulator', async () => {
  const t = await start({ devices: [EMU], goVersion: '58.0.5', elicit: 'decline' });
  const r = await t.call('use_target', { target: 'device' });
  assert.equal(t.asked.length, 0);
  assert.match(r.text, /Device mode/);
  await t.close();
});

await test('device actions: describe, tap by text (coords scaled), type ASCII, refuse non-ASCII, safety checks', async () => {
  const t = await start({ devices: [EMU], goVersion: '58.0.5' });
  await t.call('use_target', { target: 'device' });
  const d = await t.call('describe_screen');
  assert.match(d.text, /Pressable "Log in"/);
  assert.match(d.text, /TextInput "Email".*id=email/);
  let r = await t.call('click_screen', { target: 'Log in' });
  assert.equal(r.images, 1);
  assert.match(t.log(), /shell input tap 540 1780/, t.log());
  r = await t.call('type_text', { text: 'a@b.co', target: 'email' });
  assert.match(t.log(), /shell input text a\\?@b\.co|shell input text a@b\.co/, t.log());
  r = await t.call('type_text', { text: 'Привет' });
  assert.equal(r.isError, true);
  assert.match(r.text, /non-ASCII/);
  r = await t.call('press_key', { key: 'back' });
  assert.match(t.log(), /keyevent 4/);
  const a = await t.call('auto_test');
  assert.equal(a.isError, true);
  assert.match(a.text, /headless/);
  // Another app in the foreground: refuse to touch it.
  fs.writeFileSync(path.join(t.dir, 'focus'), 'com.bank.app');
  const before = t.log();
  r = await t.call('click_screen', { x: 10, y: 10 });
  assert.equal(r.isError, true);
  assert.match(r.text, /Refusing to touch other apps/);
  assert.equal(t.log().replace(before, '').includes('input tap'), false);
  await t.close();
});

await test('back to headless: tools work without a device again', async () => {
  const t = await start({ devices: [EMU], goVersion: '58.0.5' });
  await t.call('use_target', { target: 'device' });
  const h = await t.call('use_target', { target: 'headless' });
  assert.match(h.text, /headless/);
  const r = await t.call('refresh_screen');
  assert.match(r.text, /Rendered/);
  await t.close();
});

await test('not macOS: iOS is explained as unavailable, nothing else changes', async () => {
  if (process.platform === 'darwin') return;
  const t = await start({ devices: [], mac: false });
  const r = await t.call('device_list');
  assert.match(r.text, /iOS Simulator testing needs a Mac with Xcode/);
  assert.match(r.text, /Physical iPhones cannot be driven/);
  await t.close();
});

await test('iOS sim without idb: tells the user how to install idb, changes nothing', async () => {
  const t = await start({ sims: [SIM], noIdb: true });
  const l = await t.call('device_list');
  assert.match(l.text, /iOS Simulator iPhone 15/);
  assert.match(l.text, /brew install idb-companion/);
  const r = await t.call('use_target', { target: 'device' });
  assert.match(r.text, /idb/);
  assert.doesNotMatch(t.log(), /install|openurl/);
  await t.close();
});

await test('iOS sim: consent before installing Expo Go, then works (screenshot scaling, tap in points)', async () => {
  const t = await start({ sims: [SIM] });
  let r = await t.call('use_target', { target: 'device' });
  assert.match(r.text, /USER CONFIRMATION REQUIRED/);
  assert.match(r.text, /Expo Go is not installed in the simulator "iPhone 15"/);
  assert.doesNotMatch(t.log(), /install|openurl|idb|terminate/, 'only read-only queries may run before consent');
  const key = r.text.match(/\[confirmation key: ([^\]]+)\]/)[1];
  r = await t.call('use_target', { target: 'device', confirmed: [key] });
  assert.match(r.text, /Device mode: iPhone 15 \(iOS Simulator\), Expo Go 58\.0\.\d+ \(just installed\)/, r.text);
  assert.match(t.log(), /xcrun simctl install AAAA-1111/);
  assert.match(t.log(), /xcrun simctl openurl AAAA-1111 exp:\/\/127\.0\.0\.1:\d+/);
  const d = await t.call('describe_screen');
  assert.match(d.text, /Pressable "Log in"/, d.text);
  assert.match(d.text, /TextInput .*id=email/);
  r = await t.call('click_screen', { target: 'Log in' });
  assert.match(t.log(), /idb ui tap 196(\.\d)? 624(\.\d)? --udid AAAA-1111/, t.log());
  r = await t.call('type_text', { text: 'a@b.co', target: 'email' });
  assert.match(t.log(), /idb ui text a@b\.co --udid AAAA-1111/, t.log());
  r = await t.call('type_text', { text: '你好' });
  assert.equal(r.isError, true);
  assert.match(r.text, /non-ASCII/);
  r = await t.call('press_key', { key: 'back' });
  assert.equal(r.isError, true);
  assert.match(r.text, /no hardware back key/);
  r = await t.call('scroll_screen', { x: 200, y: 600, dy: 300 });
  assert.match(t.log(), /idb ui swipe/);
  await t.close();
});

await test('iOS sim, user declines Expo Go install: nothing changes', async () => {
  const t = await start({ sims: [SIM], elicit: 'decline' });
  const r = await t.call('use_target', { target: 'device' });
  assert.match(r.text, /user declined/i);
  assert.doesNotMatch(t.log(), /install|openurl|idb|terminate/);
  await t.close();
});

await test('iOS sim with a mismatching Expo Go asks to replace it', async () => {
  const t = await start({ sims: [SIM], iosVersion: '57.0.2', elicit: 'accept' });
  const r = await t.call('use_target', { target: 'device' });
  assert.equal(t.asked.length, 1);
  assert.match(t.asked[0], /Expo Go 57\.0\.2 \(SDK 57\).*SDK 58/);
  assert.match(r.text, /Device mode: iPhone 15/);
  await t.close();
});

try { fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
console.error(failed ? `${failed} test(s) failed` : 'all passed');
process.exit(failed ? 1 : 0);
