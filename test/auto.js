import fs from 'node:fs';
import { Session } from '../src/session.js';
import { autoTest } from '../src/autotest.js';
const s = new Session(process.argv[2] || 'D:/Projects/ExpoTestApp');
await s.load();
const { summary, shots } = await autoTest(s, { rounds: 4 });
console.error(summary);
shots.forEach((x, i) => fs.writeFileSync(`test/out/auto-${i}.png`, x.png));
process.exit(0);
