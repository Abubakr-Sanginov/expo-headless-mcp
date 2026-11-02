import { drainLogs } from './session.js';

const LONG = 'a'.repeat(300);
const PAYLOADS = {
  email: ['', 'not-an-email', 'user@example.com', LONG + '@x.io'],
  password: ['', '123', 'correct-horse-9', LONG],
  numeric: ['', '0', '-1', '99999999999999999999', 'abc'],
  text: ['', ' ', 'Hello', LONG, "<b>x</b> ' OR 1=1 --", 'Привет, мир', '你好世界 こんにちは 안녕하세요', 'مرحبا بالعالم', 'שלום עולם', '😀🚀 ñ ü ß ‮', '0'],
};

const kindOf = (n) => {
  const p = n.props;
  const hint = `${p.testID || ''} ${p.placeholder || ''} ${p.textContentType || ''} ${p.keyboardType || ''} ${p.autoComplete || ''}`.toLowerCase();
  if (p.secureTextEntry || /pass/.test(hint)) return 'password';
  if (/mail/.test(hint) || p.keyboardType === 'email-address') return 'email';
  if (/numeric|number|phone|decimal|digit/.test(hint)) return 'numeric';
  return 'text';
};

// Monkey-style exploration: for several rounds of input data, fill every field and
// tap every pressable (scrolling to reach them), watching for crashes, console errors,
// layout problems and taps that do nothing.
export const autoTest = async (s, { rounds = 4, maxStepsPerRound = 30 } = {}) => {
  const findings = [];
  const steps = [];
  const shots = [];
  const warned = new Set();
  const seenStates = new Set();
  const effects = new Map(); // tap key -> times it had a visible effect
  const note = (severity, text) => {
    if (!findings.some((f) => f.text === text)) findings.push({ severity, text });
  };

  const check = async (where, capture) => {
    const logs = drainLogs();
    let bad = false;
    for (const l of logs) {
      if (/^\[(error)\]/.test(l)) { note('ERROR', `${where}: ${l.slice(0, 300)}`); bad = true; }
      else if (/^\[warn\]/.test(l)) note('WARN', `${where}: ${l.slice(0, 300)}`);
    }
    for (const w of s.describe().warnings) {
      if (!warned.has(w)) {
        warned.add(w);
        note('LAYOUT', `${where}: ${w}`);
        bad = true;
      }
    }
    seenStates.add(s.signature());
    if (bad && capture && shots.length < 6) shots.push({ caption: where, png: await s.screenshot() });
    return logs;
  };

  const alerts = () => {
    const a = s.state.alerts.splice(0);
    for (const x of a) steps.push(`  alert shown: ${x.title}${x.message ? ` — ${x.message}` : ''}`);
    return a.length;
  };

  for (let round = 0; round < rounds; round++) {
    if (round > 0) await s.load();
    else {
      drainLogs();
    }
    await s.settle(100);
    if (round === 0) shots.push({ caption: 'initial screen', png: await s.screenshot() });
    await check(`round ${round + 1} load`, true);
    steps.push(`Round ${round + 1}`);

    // Fill every input with this round's payload.
    for (const inp of s.interactives().filter((i) => i.kind === 'input')) {
      const list = PAYLOADS[kindOf(inp.node)];
      const value = list[round % list.length];
      s.scrollIntoView(inp.node);
      const [cx, cy] = [inp.node.rect.x + inp.node.rect.w / 2, inp.node.rect.y + inp.node.rect.h / 2];
      const r = await s.type({ text: value, x: cx, y: cy });
      steps.push(`  ${r.length > 110 ? r.slice(0, 110) + '…' : r}`);
      await check(`round ${round + 1}, typing ${JSON.stringify(value.slice(0, 20))} into ${inp.name}`, true);
    }

    const tapped = new Set();
    for (let i = 0; i < maxStepsPerRound; i++) {
      const next = s.interactives().find((x) => x.kind === 'press' && !tapped.has(x.key));
      if (!next) break;
      tapped.add(next.key);
      s.scrollIntoView(next.node);
      const before = s.signature();
      const [cx, cy] = [next.node.rect.x + next.node.rect.w / 2, next.node.rect.y + next.node.rect.h / 2];
      const where = `round ${round + 1}, tap "${next.name}"`;
      let result;
      try {
        result = await s.tapNode(next.node, cx, cy);
      } catch (e) {
        note('ERROR', `${where}: threw ${e.message}`);
        continue;
      }
      const hadAlert = alerts();
      const logs = await check(where, true);
      const changed = s.signature() !== before;
      steps.push(`  tap "${next.name}" → ${changed ? 'screen changed' : hadAlert ? 'alert' : logs.length ? 'logs only' : 'NO VISIBLE EFFECT'}`);
      effects.set(next.name, (effects.get(next.name) || 0) + (changed || hadAlert || logs.length ? 1 : 0));
      // Back to the top so the next element is found in reading order.
      for (const n of s.all()) if (n.props.__scroll) n.scrollY = 0;
    }
    if (!s.interactives().length) steps.push('  (no interactive elements)');
  }

  for (const [name, n] of effects) if (n === 0) note('INFO', `tapping "${name}" never visibly did anything in any round (dead button, or only a side effect)`);
  const filtered = findings;
  const summary = [
    `Auto-test finished: ${rounds} rounds, ${seenStates.size} distinct screen states seen.`,
    filtered.length ? `Findings (${filtered.length}):\n` + filtered.map((f) => `- [${f.severity}] ${f.text}`).join('\n') : 'Findings: none — no crashes, console errors, or layout warnings, and every tap had an effect.',
    'Steps:\n' + steps.join('\n'),
  ].join('\n\n');
  return { summary, shots };
};
