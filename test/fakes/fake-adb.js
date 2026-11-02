// Minimal adb emulator for tests. State/log live in $FAKE_DIR.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.FAKE_DIR;
const a = process.argv.slice(2);
const log = (l) => fs.appendFileSync(path.join(dir, 'log.txt'), l + '\n');
const file = (n) => path.join(dir, n);
const read = (n, d = '') => (fs.existsSync(file(n)) ? fs.readFileSync(file(n), 'utf8').trim() : d);
if (a[0] === '-s') a.splice(0, 2);
const cmd = a.join(' ');
if (a[0] !== 'version' && a[0] !== 'devices' && a[0] !== 'start-server') log(cmd);
const out = (s) => process.stdout.write(s);

if (a[0] === 'version') out('Android Debug Bridge version 1.0.41\n');
else if (a[0] === 'start-server') out('');
else if (a[0] === 'devices') {
  out('List of devices attached\n');
  for (const d of JSON.parse(process.env.FAKE_DEVICES || '[]')) out(`${d.serial}\t${d.state} ${d.serial.startsWith('emulator') ? '' : 'usb:1-1 '}product:x model:${d.model} device:y transport_id:1\n`);
} else if (cmd.startsWith('shell pm list packages')) {
  if (read('go-version')) out('package:host.exp.exponent\n');
} else if (cmd.startsWith('shell dumpsys package')) out(`    versionName=${read('go-version', '0.0.0')}\n`);
else if (cmd.startsWith('install')) { fs.writeFileSync(file('go-version'), read('go-target', '58.0.5')); out('Success\n'); }
else if (cmd.startsWith('uninstall')) { fs.rmSync(file('go-version'), { force: true }); out('Success\n'); }
else if (cmd === 'shell wm size') out('Physical size: 1080x2400\n');
else if (cmd.startsWith('shell dumpsys activity activities')) out(`  topResumedActivity=ActivityRecord{1 u0 ${read('focus', 'host.exp.exponent')}/.MainActivity t5}\n`);
else if (cmd.startsWith('exec-out screencap')) process.stdout.write(fs.readFileSync(process.env.FAKE_PNG));
else if (cmd.startsWith('exec-out uiautomator dump')) {
  const node = (t, cls, clickable, b, extra = '') => `<node index="0" text="${t}" resource-id="${extra}" class="${cls}" package="host.exp.exponent" content-desc="" clickable="${clickable}" focused="${read('focused') === t ? 'true' : 'false'}" bounds="${b}" />`;
  out(`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${node('Sign in', 'android.widget.TextView', 'false', '[72,900][600,1000]')}${node('Email', 'android.widget.EditText', 'true', '[72,1050][1008,1200]', 'host.exp.exponent:id/email')}${node('Log in', 'android.widget.Button', 'true', '[72,1700][1008,1860]')}</hierarchy>\nUI hierarchy dumped to: /dev/tty\n`);
}
