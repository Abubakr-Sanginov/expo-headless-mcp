// Minimal xcrun/simctl emulator for tests. State/log live in $FAKE_DIR.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const a = process.argv.slice(2);
const file = (n) => path.join(dir, n);
const read = (n, d = '') => (fs.existsSync(file(n)) ? fs.readFileSync(file(n), 'utf8').trim() : d);
const cmd = a.join(' ');
if (!/^simctl (help|list)/.test(cmd)) fs.appendFileSync(file('log.txt'), 'xcrun ' + cmd + '\n');
if (cmd === 'simctl help') process.stdout.write('usage');
else if (cmd.startsWith('simctl list devices')) {
  const sims = JSON.parse(process.env.FAKE_SIMS || '[]');
  process.stdout.write(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-17-5': sims.map((s) => ({ udid: s.udid, name: s.name, state: s.state, isAvailable: true })) } }));
} else if (cmd.startsWith('simctl get_app_container')) {
  if (!read('ios-version')) { process.stderr.write('not installed'); process.exit(1); }
  process.stdout.write(file('app') + '\n');
} else if (cmd.startsWith('simctl install')) fs.writeFileSync(file('ios-version'), read('ios-target', '58.0.7'));
else if (cmd.includes('io') && cmd.includes('screenshot')) fs.copyFileSync(process.env.FAKE_PNG, a[a.length - 1]);
