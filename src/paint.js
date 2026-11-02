import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fontOf, wrapText, liveChildren, textOf } from './layout.js';

const imageCache = new Map();

const sourceUri = (src) => {
  if (!src) return null;
  if (typeof src === 'string') return src;
  if (Array.isArray(src)) return sourceUri(src[0]);
  return src.uri || null;
};

const loadSource = async (uri) => {
  if (imageCache.has(uri)) return imageCache.get(uri);
  const p = (async () => {
    try {
      if (uri.startsWith('data:')) return await loadImage(Buffer.from(uri.slice(uri.indexOf(',') + 1), uri.includes(';base64') ? 'base64' : 'utf8'));
      if (/^https?:/.test(uri)) {
        const res = await fetch(uri, { signal: AbortSignal.timeout(8000) });
        return await loadImage(Buffer.from(await res.arrayBuffer()));
      }
      return await loadImage(uri);
    } catch {
      return null;
    }
  })();
  imageCache.set(uri, p);
  return p;
};

export const preloadImages = async (node) => {
  const jobs = [];
  const walk = (n) => {
    if (n.type === 'rn-image') {
      const uri = sourceUri(n.props.source);
      if (uri) jobs.push(loadSource(uri).then((img) => (n.img = img)));
    }
    liveChildren(n).forEach(walk);
  };
  walk(node);
  await Promise.all(jobs);
};

const radii = (st, w, h) => {
  const base = Number(st.borderRadius) || 0;
  const r = [st.borderTopLeftRadius ?? base, st.borderTopRightRadius ?? base, st.borderBottomRightRadius ?? base, st.borderBottomLeftRadius ?? base];
  const cap = Math.min(w, h) / 2;
  return r.map((v) => Math.max(0, Math.min(v, cap)));
};

const roundedPath = (ctx, x, y, w, h, [tl, tr, br, bl]) => {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
};

const sorted = (kids) => (kids.some((k) => k.st?.zIndex) ? [...kids].sort((a, b) => (a.st.zIndex || 0) - (b.st.zIndex || 0)) : kids);

const drawText = (ctx, node, text, box, st, color) => {
  const r = wrapText(text, st, box.w, node.props.numberOfLines);
  ctx.font = fontOf(st);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  const align = st.textAlign === 'center' ? 'center' : st.textAlign === 'right' ? 'right' : 'left';
  ctx.textAlign = align;
  const x = align === 'center' ? box.x + box.w / 2 : align === 'right' ? box.x + box.w : box.x;
  r.lines.forEach((line, i) => {
    const cy = box.y + i * r.lineHeight + r.lineHeight / 2;
    ctx.fillText(line, x, cy);
    const deco = st.textDecorationLine || '';
    if (/underline|line-through/.test(deco)) {
      const w = ctx.measureText(line).width;
      const sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      const thickness = Math.max(1, (Number(st.fontSize) || 14) / 14);
      ctx.fillStyle = st.textDecorationColor || color;
      if (/underline/.test(deco)) ctx.fillRect(sx, cy + (Number(st.fontSize) || 14) * 0.45, w, thickness);
      if (/line-through/.test(deco)) ctx.fillRect(sx, cy - thickness / 2, w, thickness);
      ctx.fillStyle = color;
    }
  });
  return r;
};

const paintNode = (ctx, node, ctxState) => {
  if (node.hidden || !node.rect) return;
  const st = node.st;
  if (st.display === 'none') return;
  const { x, y, w, h } = node.rect;
  const opacity = st.opacity ?? 1;
  ctx.save();
  ctx.globalAlpha *= opacity;
  const rad = radii(st, w, h);

  if (st.backgroundColor && st.backgroundColor !== 'transparent') {
    ctx.save();
    if (st.shadowColor && (st.shadowOpacity > 0 || st.elevation)) {
      ctx.shadowColor = st.shadowOpacity > 0 ? st.shadowColor : 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = (st.shadowRadius ?? st.elevation * 1.5 ?? 4) * 1;
      ctx.shadowOffsetX = st.shadowOffset?.width || 0;
      ctx.shadowOffsetY = st.shadowOffset?.height ?? (st.elevation ? st.elevation / 2 : 0);
    } else if (st.elevation) {
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = st.elevation * 1.5;
      ctx.shadowOffsetY = st.elevation / 2;
    }
    ctx.fillStyle = st.backgroundColor;
    roundedPath(ctx, x, y, w, h, rad);
    ctx.fill();
    ctx.restore();
  }

  const bw = node.border;
  const uniform = bw.l === bw.t && bw.t === bw.r && bw.r === bw.b;
  if (bw.l || bw.t || bw.r || bw.b) {
    const color = st.borderColor || '#000';
    if (uniform) {
      ctx.strokeStyle = st.borderColor || '#000';
      ctx.lineWidth = bw.l;
      roundedPath(ctx, x + bw.l / 2, y + bw.l / 2, w - bw.l, h - bw.l, rad.map((v) => Math.max(0, v - bw.l / 2)));
      ctx.stroke();
    } else {
      ctx.fillStyle = st.borderTopColor || color;
      ctx.fillRect(x, y, w, bw.t);
      ctx.fillStyle = st.borderBottomColor || color;
      ctx.fillRect(x, y + h - bw.b, w, bw.b);
      ctx.fillStyle = st.borderLeftColor || color;
      ctx.fillRect(x, y, bw.l, h);
      ctx.fillStyle = st.borderRightColor || color;
      ctx.fillRect(x + w - bw.r, y, bw.r, h);
    }
  }

  const clip = st.overflow === 'hidden' || st.overflow === 'scroll' || node.props.__scroll || (st.borderRadius && node.type === 'rn-image');
  if (clip) {
    roundedPath(ctx, x, y, w, h, rad);
    ctx.clip();
  }

  if (node.type === 'rn-text') {
    drawText(ctx, node, node.text, { x: x + node.pad.l, y: y + node.pad.t, w: w - node.pad.l - node.pad.r }, st, st.color || '#000');
  } else if (node.type === 'rn-textinput') {
    const p = node.props;
    const raw = p.value ?? '';
    const shown = p.secureTextEntry ? '•'.repeat(String(raw).length) : String(raw);
    const box = { x: x + node.pad.l + node.border.l, y: y + node.pad.t + node.border.t, w: w - node.pad.l - node.pad.r - node.border.l - node.border.r };
    ctx.font = fontOf(st);
    const isFocused = ctxState.focused === node;
    if (shown) {
      const r = drawText(ctx, node, shown, box, st, st.color || '#000');
      if (isFocused) {
        const last = r.lines[r.lines.length - 1] || '';
        ctx.fillStyle = '#007AFF';
        ctx.fillRect(box.x + ctx.measureText(last).width + 1, box.y + (r.lines.length - 1) * r.lineHeight + 2, 2, r.lineHeight - 4);
      }
    } else {
      if (p.placeholder) drawText(ctx, node, p.placeholder, box, st, p.placeholderTextColor || '#9a9a9a');
      if (isFocused) {
        ctx.fillStyle = '#007AFF';
        ctx.fillRect(box.x, box.y + 2, 2, (Number(st.lineHeight) || Math.round((Number(st.fontSize) || 14) * 1.25)) - 4);
      }
    }
    if (isFocused && !uniform) {
      /* no ring for non-uniform borders */
    }
  } else if (node.type === 'rn-image') {
    const inner = { x: x + node.border.l, y: y + node.border.t, w: w - node.border.l - node.border.r, h: h - node.border.t - node.border.b };
    if (node.img) {
      const iw = node.img.width;
      const ih = node.img.height;
      const mode = node.props.resizeMode || st.resizeMode || 'cover';
      if (mode === 'stretch') ctx.drawImage(node.img, inner.x, inner.y, inner.w, inner.h);
      else {
        const s = mode === 'contain' ? Math.min(inner.w / iw, inner.h / ih) : Math.max(inner.w / iw, inner.h / ih);
        const dw = iw * s;
        const dh = ih * s;
        ctx.save();
        ctx.beginPath();
        ctx.rect(inner.x, inner.y, inner.w, inner.h);
        ctx.clip();
        ctx.drawImage(node.img, inner.x + (inner.w - dw) / 2, inner.y + (inner.h - dh) / 2, dw, dh);
        ctx.restore();
      }
    } else {
      ctx.fillStyle = '#d9dce1';
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      ctx.strokeStyle = '#a3a8b0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(inner.x + inner.w, inner.y + inner.h);
      ctx.moveTo(inner.x + inner.w, inner.y);
      ctx.lineTo(inner.x, inner.y + inner.h);
      ctx.stroke();
    }
  } else if (node.type === 'rn-spinner') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    ctx.strokeStyle = node.props.color || '#8e8e93';
    ctx.lineWidth = Math.max(2, w / 9);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2 - ctx.lineWidth, 0, Math.PI * 1.5);
    ctx.stroke();
  } else if (node.type === 'rn-switch') {
    /* drawn via children in shim */
  }

  if (node.type !== 'rn-text' && node.type !== 'rn-textinput') {
    for (const c of sorted(liveChildren(node))) paintNode(ctx, c, ctxState);
  }

  if (node.props.disabled && node.type === 'rn-view' && node.props.__pressable) {
    ctx.globalAlpha *= 0.5;
  }
  ctx.restore();
};

export const paint = async (root, { width, height, scale, background = '#ffffff', focused = null }) => {
  await preloadImages(root);
  const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  for (const c of sorted(liveChildren(root))) paintNode(ctx, c, { focused });
  return canvas.toBuffer('image/png');
};

export { textOf };
