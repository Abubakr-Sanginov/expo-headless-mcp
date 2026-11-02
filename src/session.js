import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import * as jsxDevRuntime from 'react/jsx-dev-runtime';
import path from 'node:path';
import { createRoot, reconciler } from './reconciler.js';
import { layoutTree, liveChildren, flatten, textOf, wrapText } from './layout.js';
import { paint } from './paint.js';
import { bundleProject } from './bundler.js';

globalThis.__expoMcpReact = React;
globalThis.__expoMcpJsx = jsxRuntime;
globalThis.__expoMcpJsxDev = jsxDevRuntime;

const h = React.createElement;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- logs & timers owned by the app under test ----
export const logs = [];
const fmt = (a) => a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.stack || x.message : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ');
export const pushLog = (level, args) => {
  logs.push(`[${level}] ${fmt(args).slice(0, 600)}`);
  if (logs.length > 200) logs.shift();
};
export const drainLogs = () => logs.splice(0, logs.length);

const intervals = new Set();
const rawSetInterval = globalThis.setInterval;
globalThis.setInterval = (...a) => {
  const id = rawSetInterval(...a);
  intervals.add(id);
  return id;
};

class Boundary extends React.Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    pushLog('error', ['Uncaught render error:', err]);
  }
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return h('rn-view', { style: { flex: 1, backgroundColor: '#b00020', padding: 20, paddingTop: 60 } },
      h('rn-text', { style: { color: '#fff', fontWeight: 'bold', fontSize: 18 } }, 'Runtime error'),
      h('rn-text', { style: { color: '#fff', fontSize: 12, marginTop: 8 } }, String(err.message || err).slice(0, 600)));
  }
}

const isLeaf = (n) => n.type === 'rn-text' || n.type === 'rn-textinput' || n.type === 'rn-spinner';
const sortedKids = (n) => {
  const k = liveChildren(n);
  return k.some((c) => c.st?.zIndex) ? [...k].sort((a, b) => (a.st.zIndex || 0) - (b.st.zIndex || 0)) : k;
};
const deepText = (n) => (n.type === 'rn-text' ? n.text || textOf(n) : n.type === 'rn-textinput' ? n.props.value || n.props.placeholder || '' : liveChildren(n).map(deepText).filter(Boolean).join(' '));
const pressHandler = (n) => (n.props.disabled ? null : n.props.onPress || n.props.onPressIn || n.props.onPressOut || n.props.onLongPress ? n : null);
const label = (n) => n.props.testID || n.props.accessibilityLabel || n.props.nativeID;
const center = (n) => [Math.round(n.rect.x + n.rect.w / 2), Math.round(n.rect.y + n.rect.h / 2)];

export class Session {
  constructor(project, { width = 390, height = 844, scale = 1.5, entry } = {}) {
    this.project = path.resolve(project);
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.entry = entry;
    this.focused = null;
    this.root = null;
  }

  async load() {
    this.dispose();
    this.state = globalThis.__rnState = { alerts: [], size: { width: this.width, height: this.height, scale: this.scale }, root: null };
    const { url, entry } = await bundleProject(this.project, this.entry);
    this.entryFile = entry;
    await import(url);
    const App = this.state.root;
    if (!App) throw new Error(`${entry} did not provide a root component (no default App and no registerRootComponent/AppRegistry call).`);
    this.root = createRoot((e) => pushLog('error', ['React recoverable error:', e]));
    reconciler.batchedUpdates(() => this.root.render(h(Boundary, null, h(App))));
    await this.settle(250);
  }

  dispose() {
    for (const id of intervals) clearInterval(id);
    intervals.clear();
    if (this.root) {
      try { this.root.unmount(); } catch {}
    }
    this.root = null;
    this.focused = null;
  }

  get tree() {
    return this.root.container;
  }

  async settle(ms = 150) {
    await sleep(ms);
    this.layout();
  }

  layout() {
    layoutTree(this.tree, this.width, this.height);
    if (this.focused && !this.isAttached(this.focused)) this.focused = null;
  }

  isAttached(n) {
    while (n.parent) n = n.parent;
    return n === this.tree;
  }

  async screenshot() {
    this.layout();
    return paint(this.tree, { width: this.width, height: this.height, scale: this.scale, focused: this.focused });
  }

  hit(x, y, n = this.tree) {
    if (n.hidden || n.st?.display === 'none' || n.props.pointerEvents === 'none') return null;
    const r = n.rect;
    const inside = !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    const clips = n.st && (n.st.overflow === 'hidden' || n.st.overflow === 'scroll' || n.props.__scroll);
    if (n.type !== 'root' && clips && !inside) return null;
    if (!isLeaf(n)) {
      for (const c of sortedKids(n).reverse()) {
        const k = this.hit(x, y, c);
        if (k) return k;
      }
    }
    return inside && n.type !== 'root' ? n : null;
  }

  all(n = this.tree, out = []) {
    out.push(n);
    liveChildren(n).forEach((c) => this.all(c, out));
    return out;
  }

  // Finds an element by testID / accessibilityLabel / placeholder / visible text.
  find(query, { input = false } = {}) {
    const q = String(query).toLowerCase();
    const nodes = this.all().filter((n) => n.rect && n.type !== 'root' && (!input || n.type === 'rn-textinput'));
    const keys = (n) => [n.props.testID, n.props.accessibilityLabel, n.props.nativeID, n.props.placeholder, n.type === 'rn-text' ? n.text : null, n.type === 'rn-textinput' ? n.props.value : null].filter((s) => typeof s === 'string');
    const exact = nodes.filter((n) => keys(n).some((s) => s.toLowerCase() === q));
    const hits = exact.length ? exact : nodes.filter((n) => keys(n).some((s) => s.toLowerCase().includes(q)));
    // Prefer the input/pressable itself over a text label inside it.
    return hits.find((n) => n.type === 'rn-textinput') || hits.find((n) => pressHandler(n)) || hits[0] || null;
  }

  run(fn) {
    try {
      return reconciler.batchedUpdates(fn);
    } catch (e) {
      pushLog('error', ['Handler threw:', e]);
    }
  }

  setFocus(node) {
    if (this.focused === node) return;
    const prev = this.focused;
    this.focused = node;
    if (prev) this.run(() => prev.props.onBlur && prev.props.onBlur({ nativeEvent: {} }));
    if (node) this.run(() => node.props.onFocus && node.props.onFocus({ nativeEvent: {} }));
  }

  describeNode(n) {
    if (!n) return 'nothing';
    const t = deepText(n);
    const kind = n.type === 'rn-text' ? 'Text' : n.type === 'rn-textinput' ? 'TextInput' : n.type === 'rn-image' ? 'Image' : pressHandler(n) ? 'Pressable' : 'View';
    return `${kind}${label(n) ? `#${label(n)}` : ''}${t ? ` "${t.slice(0, 60)}"` : ''}`;
  }

  async tapNode(node, x, y, long = false) {
    // Walk up to the nearest ancestor that handles presses.
    let target = node;
    let input = null;
    while (target) {
      if (target.type === 'rn-textinput') { input = target; break; }
      if (pressHandler(target)) break;
      target = target.parent && target.parent.type !== 'root' ? target.parent : null;
    }
    const ev = { nativeEvent: { pageX: x, pageY: y, locationX: x - (node.rect?.x || 0), locationY: y - (node.rect?.y || 0), timestamp: Date.now() }, persist() {}, stopPropagation() {} };
    let result;
    if (input) {
      this.setFocus(input);
      result = `focused ${this.describeNode(input)}`;
    } else {
      this.setFocus(null);
      if (target) {
        const p = target.props;
        this.run(() => {
          p.onPressIn && p.onPressIn(ev);
          if (long && p.onLongPress) p.onLongPress(ev);
          else p.onPress && p.onPress(ev);
          p.onPressOut && p.onPressOut(ev);
        });
        result = `${long ? 'long-pressed' : 'pressed'} ${this.describeNode(target)}`;
      } else {
        result = `nothing pressable at this point (topmost element: ${this.describeNode(node)})`;
      }
    }
    await this.settle();
    return result;
  }

  async click({ x, y, target, long }) {
    this.layout();
    if (target && target.startsWith('alert:')) return this.alertButton(target.slice(6));
    if (target) {
      const n = this.find(target);
      if (!n) return `no element matching "${target}"`;
      const [cx, cy] = center(n);
      return this.tapNode(n, cx, cy, long);
    }
    const n = this.hit(x, y);
    if (!n) {
      this.setFocus(null);
      await this.settle();
      return `no element at (${x}, ${y})`;
    }
    return this.tapNode(n, x, y, long);
  }

  async alertButton(text) {
    const b = (this.state.lastAlertButtons || []).find((b) => (b.text || '').toLowerCase() === text.toLowerCase());
    if (!b) return `no alert button "${text}"`;
    this.run(() => b.onPress && b.onPress());
    this.state.lastAlertButtons = [];
    await this.settle();
    return `pressed alert button "${b.text}"`;
  }

  async type({ text, target, x, y, submit, append }) {
    this.layout();
    let n = null;
    if (target) n = this.find(target, { input: true });
    else if (x != null) {
      let k = this.hit(x, y);
      while (k && k.type !== 'rn-textinput') k = k.parent;
      n = k;
    } else n = this.focused;
    if (!n || n.type !== 'rn-textinput') return `no text input found (${target ?? (x != null ? `at ${x},${y}` : 'focused')})`;
    this.setFocus(n);
    const value = (append ? String(n.props.value ?? '') : '') + text;
    this.run(() => n.props.onChangeText && n.props.onChangeText(value));
    if (submit) this.run(() => n.props.onSubmitEditing && n.props.onSubmitEditing({ nativeEvent: { text: value } }));
    await this.settle();
    return `typed "${text}" into ${this.describeNode(n)}${submit ? ' and submitted' : ''}`;
  }

  async scroll({ x, y, dx = 0, dy = 0 }) {
    this.layout();
    let n = this.hit(x, y);
    while (n && !n.props.__scroll) n = n.parent;
    if (!n || !n.rect) return `no scrollable area at (${x}, ${y})`;
    const horizontal = n.props.__scroll === 'h';
    const view = horizontal ? n.rect.w : n.rect.h;
    const max = Math.max(0, n.contentSize - view);
    const delta = horizontal ? dx : dy;
    n.scrollY = Math.max(0, Math.min(max, (n.scrollY || 0) + delta));
    await this.settle(50);
    return `scrolled to ${Math.round(n.scrollY)}/${Math.round(max)} (${horizontal ? 'horizontal' : 'vertical'})`;
  }


  // Everything the user could tap or type into, in reading order, with stable keys.
  interactives() {
    this.layout();
    const seen = new Map();
    const out = [];
    for (const n of this.all()) {
      if (!n.rect || n.type === 'root') continue;
      const input = n.type === 'rn-textinput';
      if (!input && !pressHandler(n)) continue;
      const name = input ? n.props.testID || n.props.placeholder || n.props.accessibilityLabel || 'input' : label(n) || deepText(n) || n.props.accessibilityRole || 'pressable';
      const base = (input ? 'input:' : 'press:') + String(name).slice(0, 50).replace(/[0-9]+/g, '#');
      const i = seen.get(base) || 0;
      seen.set(base, i + 1);
      out.push({ key: base + '#' + i, kind: input ? 'input' : 'press', name: String(name).slice(0, 50), node: n });
    }
    out.sort((a, b) => a.node.rect.y - b.node.rect.y || a.node.rect.x - b.node.rect.x);
    return out;
  }

  // Scrolls ancestors so the node's centre is inside the viewport.
  scrollIntoView(node) {
    for (let k = 0; k < 3; k++) {
      let sc = node.parent;
      while (sc && !sc.props.__scroll) sc = sc.parent;
      if (!sc) return;
      const horizontal = sc.props.__scroll === 'h';
      const [cx, cy] = center(node);
      const c = horizontal ? cx : cy;
      const v0 = horizontal ? sc.rect.x : sc.rect.y;
      const size = horizontal ? sc.rect.w : sc.rect.h;
      if (c >= v0 + 8 && c <= v0 + size - 8) return;
      const max = Math.max(0, sc.contentSize - size);
      sc.scrollY = Math.max(0, Math.min(max, (sc.scrollY || 0) + c - (v0 + size / 2)));
      this.layout();
    }
  }

  // Coarse fingerprint of what is on screen, used to tell whether an action changed anything.
  signature() {
    this.layout();
    return this.all().filter((n) => n.rect && (n.type === 'rn-text' || n.type === 'rn-textinput' || n.type === 'rn-image'))
      .map((n) => n.type + ':' + (n.type === 'rn-text' ? n.text : n.type === 'rn-textinput' ? n.props.value ?? '' : '') + '@' + Math.round(n.rect.x) + ',' + Math.round(n.rect.y) + ',' + Math.round(n.rect.w)).join('|')
      + '|sw:' + this.all().filter((n) => n.props.__switch).map((n) => n.st.backgroundColor).join(',');
  }

  // Text outline of the screen plus layout problems a screenshot alone can hide.
  describe() {
    this.layout();
    const lines = [];
    const warnings = [];
    const leaves = [];
    const screen = { x: 0, y: 0, w: this.width, h: this.height };
    const onScreen = (r) => r.x < screen.w && r.x + r.w > 0 && r.y < screen.h && r.y + r.h > 0;
    const walk = (n, depth) => {
      const interesting = n.type !== 'root' && (n.type === 'rn-text' || n.type === 'rn-textinput' || n.type === 'rn-image' || pressHandler(n) || n.props.__scroll || label(n));
      if (interesting && n.rect) {
        const r = n.rect;
        const kind = n.type === 'rn-text' ? 'Text' : n.type === 'rn-textinput' ? 'TextInput' : n.type === 'rn-image' ? 'Image' : n.props.__scroll ? 'ScrollView' : pressHandler(n) ? 'Pressable' : 'View';
        const t = n.type === 'rn-text' || kind === 'Pressable' ? deepText(n) : '';
        const extra = n.type === 'rn-textinput' ? ` value=${JSON.stringify(n.props.value ?? '')}${n.props.placeholder ? ` placeholder=${JSON.stringify(n.props.placeholder)}` : ''}${this.focused === n ? ' FOCUSED' : ''}` : '';
        const nm = `${kind}${label(n) ? `#${label(n)}` : ''}${t ? ` "${t.slice(0, 80)}"` : ''}${extra}`;
        lines.push(`${'  '.repeat(Math.min(depth, 8))}${nm} @ (${Math.round(r.x)},${Math.round(r.y)}) ${Math.round(r.w)}x${Math.round(r.h)} center=(${center(n).join(',')})`);
        if (onScreen(r) && (r.x < -1 || r.x + r.w > screen.w + 1)) warnings.push(`${nm} extends beyond screen width (x=${Math.round(r.x)}..${Math.round(r.x + r.w)})`);
        if (n.type === 'rn-text' && n.text) {
          const w = r.w - n.pad.l - n.pad.r;
          const m = wrapText(n.text, n.st, w, n.props.numberOfLines);
          if (m.lines.length * m.lineHeight > r.h - n.pad.t - n.pad.b + 1) warnings.push(`${nm} text overflows its box (needs ${m.lines.length * m.lineHeight}px, has ${Math.round(r.h)}px)`);
          if (n.props.numberOfLines && m.fullLines > n.props.numberOfLines) warnings.push(`${nm} is truncated by numberOfLines=${n.props.numberOfLines}`);
        }
        if ((n.type === 'rn-text' && n.text) || n.type === 'rn-textinput' || n.type === 'rn-image') if (onScreen(r) && r.w > 0 && r.h > 0) leaves.push({ n, nm, r });
      }
      liveChildren(n).forEach((c) => walk(c, depth + (interesting ? 1 : 0)));
    };
    walk(this.tree, 0);
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i].r;
        const b = leaves[j].r;
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const hh = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const isImg = leaves[i].n.type === 'rn-image' || leaves[j].n.type === 'rn-image';
        if (w > 2 && hh > 2 && !isImg) warnings.push(`overlap: ${leaves[i].nm} and ${leaves[j].nm} (${Math.round(w)}x${Math.round(hh)}px)`);
      }
    }
    return { lines, warnings };
  }
}
