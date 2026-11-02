import Yoga from 'yoga-layout';
import { createCanvas } from '@napi-rs/canvas';

// Latin first, then fallbacks so CJK, Indic, Arabic/Hebrew and emoji render on Windows, macOS and Linux.
export const FONT_FAMILY = [
  '"Segoe UI"', '"Helvetica Neue"', 'Arial', '"Noto Sans"',
  '"Microsoft YaHei"', '"PingFang SC"', '"Noto Sans CJK SC"', '"Yu Gothic"', '"Hiragino Sans"', '"Malgun Gothic"', '"Apple SD Gothic Neo"',
  '"Nirmala UI"', '"Kohinoor Devanagari"', '"Noto Sans Devanagari"',
  '"Segoe UI Emoji"', '"Apple Color Emoji"', '"Noto Color Emoji"', '"Segoe UI Symbol"', 'sans-serif',
].join(', ');

export const flatten = (style) => {
  const out = {};
  const walk = (s) => {
    if (!s) return;
    if (Array.isArray(s)) return s.forEach(walk);
    for (const k of Object.keys(s)) {
      const v = s[k];
      out[k] = v && typeof v === 'object' && typeof v.__getValue === 'function' ? v.__getValue() : v;
    }
  };
  walk(style);
  return out;
};

const measureCtx = createCanvas(4, 4).getContext('2d');

export const fontOf = (st) => {
  const size = Number(st.fontSize) || 14;
  const weight = st.fontWeight === 'bold' ? 700 : st.fontWeight || 400;
  return `${st.fontStyle === 'italic' ? 'italic ' : ''}${weight} ${size}px ${FONT_FAMILY}`;
};

export const textOf = (node) => {
  let s = '';
  for (const c of node.children) s += c.type === 'raw' ? c.text : c.type === 'rn-text' ? textOf(c) : '';
  return s;
};

// Wraps text into lines that fit maxWidth. Returns { lines, width, lineHeight, fullLines }.
export const wrapText = (text, st, maxWidth, numberOfLines) => {
  measureCtx.font = fontOf(st);
  const width = (s) => measureCtx.measureText(s).width;
  const size = Number(st.fontSize) || 14;
  const lineHeight = Number(st.lineHeight) || Math.round(size * 1.25);
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!Number.isFinite(maxWidth)) {
      lines.push(para);
      continue;
    }
    let cur = '';
    for (const word of para.split(/(?<=\s)/)) {
      const trial = cur + word;
      if (cur && width(trial.trimEnd()) > maxWidth) {
        lines.push(cur.trimEnd());
        cur = word;
      } else cur = trial;
      while (width(cur) > maxWidth && cur.length > 1) {
        let n = cur.length - 1;
        while (n > 1 && width(cur.slice(0, n)) > maxWidth) n--;
        lines.push(cur.slice(0, n));
        cur = cur.slice(n);
      }
    }
    lines.push(cur.trimEnd());
  }
  let shown = lines;
  if (numberOfLines && lines.length > numberOfLines) {
    shown = lines.slice(0, numberOfLines);
    let last = shown[numberOfLines - 1];
    while (last.length && width(last + '…') > maxWidth) last = last.slice(0, -1);
    shown[numberOfLines - 1] = last + '…';
  }
  return { lines: shown, width: Math.max(0, ...shown.map(width)), lineHeight, fullLines: lines.length };
};

const MAPS = {
  flexDirection: { column: Yoga.FLEX_DIRECTION_COLUMN, row: Yoga.FLEX_DIRECTION_ROW, 'column-reverse': Yoga.FLEX_DIRECTION_COLUMN_REVERSE, 'row-reverse': Yoga.FLEX_DIRECTION_ROW_REVERSE },
  justify: { 'flex-start': Yoga.JUSTIFY_FLEX_START, center: Yoga.JUSTIFY_CENTER, 'flex-end': Yoga.JUSTIFY_FLEX_END, 'space-between': Yoga.JUSTIFY_SPACE_BETWEEN, 'space-around': Yoga.JUSTIFY_SPACE_AROUND, 'space-evenly': Yoga.JUSTIFY_SPACE_EVENLY },
  align: { auto: Yoga.ALIGN_AUTO, 'flex-start': Yoga.ALIGN_FLEX_START, center: Yoga.ALIGN_CENTER, 'flex-end': Yoga.ALIGN_FLEX_END, stretch: Yoga.ALIGN_STRETCH, baseline: Yoga.ALIGN_BASELINE, 'space-between': Yoga.ALIGN_SPACE_BETWEEN, 'space-around': Yoga.ALIGN_SPACE_AROUND },
  wrap: { nowrap: Yoga.WRAP_NO_WRAP, wrap: Yoga.WRAP_WRAP, 'wrap-reverse': Yoga.WRAP_WRAP_REVERSE },
  overflow: { visible: Yoga.OVERFLOW_VISIBLE, hidden: Yoga.OVERFLOW_HIDDEN, scroll: Yoga.OVERFLOW_SCROLL },
};

const SIDES = [['Top', Yoga.EDGE_TOP], ['Left', Yoga.EDGE_LEFT], ['Right', Yoga.EDGE_RIGHT], ['Bottom', Yoga.EDGE_BOTTOM], ['Start', Yoga.EDGE_START], ['End', Yoga.EDGE_END]];

const applyStyle = (y, st, horizontal) => {
  const set = (fn, v) => v !== undefined && v !== null && y[fn](v);
  y.setFlexDirection(MAPS.flexDirection[st.flexDirection] ?? (horizontal ? Yoga.FLEX_DIRECTION_ROW : Yoga.FLEX_DIRECTION_COLUMN));
  if (st.flexWrap) y.setFlexWrap(MAPS.wrap[st.flexWrap]);
  if (st.justifyContent) y.setJustifyContent(MAPS.justify[st.justifyContent]);
  if (st.alignItems) y.setAlignItems(MAPS.align[st.alignItems]);
  if (st.alignSelf) y.setAlignSelf(MAPS.align[st.alignSelf]);
  if (st.alignContent) y.setAlignContent(MAPS.align[st.alignContent]);
  if (st.overflow) y.setOverflow(MAPS.overflow[st.overflow]);
  if (st.display === 'none') y.setDisplay(Yoga.DISPLAY_NONE);
  set('setFlex', st.flex);
  set('setFlexGrow', st.flexGrow);
  set('setFlexShrink', st.flexShrink);
  set('setFlexBasis', st.flexBasis);
  set('setWidth', st.width);
  set('setHeight', st.height);
  set('setMinWidth', st.minWidth);
  set('setMinHeight', st.minHeight);
  set('setMaxWidth', st.maxWidth);
  set('setMaxHeight', st.maxHeight);
  set('setAspectRatio', st.aspectRatio);
  if (st.position === 'absolute') y.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
  for (const [name, edge] of [['top', Yoga.EDGE_TOP], ['left', Yoga.EDGE_LEFT], ['right', Yoga.EDGE_RIGHT], ['bottom', Yoga.EDGE_BOTTOM]])
    if (st[name] !== undefined) y.setPosition(edge, st[name]);
  for (const [pre, fn] of [['margin', 'setMargin'], ['padding', 'setPadding']]) {
    if (st[pre] !== undefined) y[fn](Yoga.EDGE_ALL, st[pre]);
    if (st[pre + 'Horizontal'] !== undefined) y[fn](Yoga.EDGE_HORIZONTAL, st[pre + 'Horizontal']);
    if (st[pre + 'Vertical'] !== undefined) y[fn](Yoga.EDGE_VERTICAL, st[pre + 'Vertical']);
    for (const [s, edge] of SIDES) if (st[pre + s] !== undefined) y[fn](edge, st[pre + s]);
  }
  if (st.borderWidth !== undefined) y.setBorder(Yoga.EDGE_ALL, st.borderWidth);
  for (const [s, edge] of SIDES.slice(0, 4)) if (st[`border${s}Width`] !== undefined) y.setBorder(edge, st[`border${s}Width`]);
  if (st.gap !== undefined) y.setGap(Yoga.GUTTER_ALL, st.gap);
  if (st.rowGap !== undefined) y.setGap(Yoga.GUTTER_ROW, st.rowGap);
  if (st.columnGap !== undefined) y.setGap(Yoga.GUTTER_COLUMN, st.columnGap);
};

const isLeaf = (n) => n.type === 'rn-text' || n.type === 'rn-textinput' || n.type === 'rn-spinner';
const liveChildren = (n) => (isLeaf(n) ? [] : n.children.filter((c) => c.type !== 'raw' && !c.hidden));

// Builds a yoga tree mirroring the host tree, lays it out, and writes
// node.st / node.rect (absolute screen coords) / node.pad / node.border / node.contentSize.
export const layoutTree = (root, width, height) => {
  const build = (node) => {
    const y = Yoga.Node.create();
    const st = flatten(node.props.style);
    node.st = st;
    applyStyle(y, st, node.props.__scroll === 'h');
    if (node.type === 'rn-text') {
      const text = textOf(node);
      const lines = node.props.numberOfLines;
      node.text = text;
      y.setMeasureFunc((w, wm) => {
        const r = wrapText(text, st, wm === Yoga.MEASURE_MODE_UNDEFINED ? Infinity : w, lines);
        return { width: Math.ceil(wm === Yoga.MEASURE_MODE_EXACTLY ? w : r.width), height: r.lineHeight * r.lines.length };
      });
    } else if (node.type === 'rn-textinput') {
      const lh = Number(st.lineHeight) || Math.round((Number(st.fontSize) || 14) * 1.25);
      const rows = node.props.multiline ? node.props.numberOfLines || 3 : 1;
      y.setMeasureFunc((w, wm) => ({ width: wm === Yoga.MEASURE_MODE_UNDEFINED ? 160 : w, height: lh * rows }));
    } else if (node.type === 'rn-spinner') {
      const s = node.props.size === 'large' ? 36 : 20;
      y.setMeasureFunc(() => ({ width: s, height: s }));
    } else {
      for (const c of liveChildren(node)) y.insertChild(build(c), y.getChildCount());
    }
    return y;
  };

  const rootY = Yoga.Node.create();
  root.st = {};
  rootY.setWidth(width);
  rootY.setHeight(height);
  for (const c of liveChildren(root)) rootY.insertChild(build(c), rootY.getChildCount());
  rootY.calculateLayout(width, height, Yoga.DIRECTION_LTR);

  const place = (node, y, ox, oy) => {
    const l = y.getComputedLayout();
    const x = ox + l.left;
    const top = oy + l.top;
    node.rect = { x, y: top, w: l.width, h: l.height };
    const edge = (fn, e) => y[fn](e);
    node.pad = { l: edge('getComputedPadding', Yoga.EDGE_LEFT), t: edge('getComputedPadding', Yoga.EDGE_TOP), r: edge('getComputedPadding', Yoga.EDGE_RIGHT), b: edge('getComputedPadding', Yoga.EDGE_BOTTOM) };
    node.border = { l: edge('getComputedBorder', Yoga.EDGE_LEFT), t: edge('getComputedBorder', Yoga.EDGE_TOP), r: edge('getComputedBorder', Yoga.EDGE_RIGHT), b: edge('getComputedBorder', Yoga.EDGE_BOTTOM) };
    const horizontal = node.props.__scroll === 'h';
    const scroll = node.scrollY || 0;
    let extent = 0;
    liveChildren(node).forEach((c, i) => {
      const cy = y.getChild(i);
      const cl = cy.getComputedLayout();
      extent = Math.max(extent, horizontal ? cl.left + cl.width : cl.top + cl.height);
      place(c, cy, x - (horizontal ? scroll : 0), top - (horizontal ? 0 : scroll));
    });
    node.contentSize = extent + (horizontal ? node.pad.r : node.pad.b);
  };
  place(root, rootY, 0, 0);
  rootY.freeRecursive();
};

export { liveChildren };
