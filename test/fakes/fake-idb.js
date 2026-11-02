// Minimal idb emulator for tests.
import fs from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
const cmd = a.join(' ');
if (cmd === '--help') process.exit(0);
fs.appendFileSync(path.join(process.env.FAKE_DIR, 'log.txt'), 'idb ' + cmd + '\n');
if (cmd.startsWith('ui describe-all')) {
  process.stdout.write(JSON.stringify([
    { type: 'Application', AXLabel: 'Expo Go', AXFrame: '{{0, 0}, {393, 852}}' },
    { type: 'StaticText', AXLabel: 'Sign in', AXFrame: '{{24, 300}, {200, 40}}' },
    { type: 'TextField', AXLabel: 'Email', AXValue: '', AXUniqueId: 'email', AXFrame: '{{24, 400}, {345, 46}}' },
    { type: 'Button', AXLabel: 'Log in', AXFrame: '{{24, 600}, {345, 48}}' },
  ]));
}
