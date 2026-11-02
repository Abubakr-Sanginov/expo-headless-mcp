// End-to-end checks against fixtures. Run: node test/e2e.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session, drainLogs } from '../src/session.js';
import { autoTest } from '../src/autotest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, 'fixtures', n);
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const texts = (s) => s.describe().lines.join('\n');
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.error('ok   ', name);
  } catch (e) {
    failed++;
    console.error('FAIL ', name, '\n', e.stack.split('\n').slice(0, 5).join('\n'));
  }
};

await test('login: validation flow', async () => {
  const s = new Session(fx('login'));
  await s.load();
  assert.match(texts(s), /Sign in/);
  await s.click({ target: 'Log in' });
  assert.match(texts(s), /Enter a valid email/);
  await s.type({ target: 'email', text: 'a@b.co' });
  await s.type({ target: 'password', text: '12' });
  await s.click({ target: 'Log in' });
  assert.match(texts(s), /at least 6 characters/);
  await s.type({ target: 'password', text: '123456' });
  await s.click({ target: 'Log in' });
  assert.match(texts(s), /Welcome, a@b\.co!/);
  const png = await s.screenshot();
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  s.dispose();
});

await test('login: auto_test is clean', async () => {
  const s = new Session(fx('login'));
  await s.load();
  const { summary } = await autoTest(s, { rounds: 3 });
  assert.match(summary, /Findings: none/, summary);
  s.dispose();
});

await test('sample: overlap detected', async () => {
  const s = new Session(path.join(here, 'sample'));
  await s.load();
  assert.ok(s.describe().warnings.some((w) => w.startsWith('overlap')));
  s.dispose();
});

await test('rich tsx: list, modal, icons, stubs, effects', async () => {
  const s = new Session(fx('rich'));
  await s.load();
  const t = texts(s);
  assert.match(t, /Todos \(2\) · ios · 390/, t);
  assert.match(t, /Écrire le rapport/);
  await s.click({ target: 'Add todo' });
  assert.match(texts(s), /TextInput#draft/);
  await s.type({ target: 'draft', text: 'Walk the dog', submit: true });
  const t2 = texts(s);
  assert.match(t2, /Todos \(3\)/, t2);
  assert.match(t2, /Walk the dog/);
  assert.doesNotMatch(t2, /TextInput#draft/, 'modal should close');
  await s.click({ target: 'Buy milk' });
  fs.writeFileSync(path.join(out, 'rich.png'), await s.screenshot());
  assert.deepEqual(drainLogs().filter((l) => l.startsWith('[error]')), []);
  s.dispose();
});

await test('rich tsx: auto_test finds no crashes', async () => {
  const s = new Session(fx('rich'));
  await s.load();
  const { summary } = await autoTest(s, { rounds: 3 });
  assert.doesNotMatch(summary, /\[ERROR\]/, summary);
  s.dispose();
});

await test('runtime error is reported, not fatal', async () => {
  const s = new Session(fx('crash'));
  await s.load();
  assert.match(texts(s), /Runtime error/);
  assert.ok(drainLogs().some((l) => /Uncaught render error/.test(l)));
  s.dispose();
});

console.error(failed ? `${failed} test(s) failed` : 'all passed');
process.exit(failed ? 1 : 0);
