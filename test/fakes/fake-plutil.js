import fs from 'node:fs';
import path from 'node:path';
process.stdout.write(fs.readFileSync(path.join(process.env.FAKE_DIR, 'ios-version'), 'utf8').trim() + '\n');
