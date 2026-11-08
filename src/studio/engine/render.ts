import type { AdjustLayer, BlurLayer, CalloutLayer, LineLayer, Layer, PathLayer, Page, ShapeLayer, StampLayer, TextLayer } from './types';
import { adjustPad, applyLUT, cssFilter, isIdentityAdjust, isIdentityLevels, levelsLUT } from './adjust';
import { CALLOUT_PAD_RATIO, CALLOUT_TAIL, fontString, layoutText } from './text-layout';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface RenderOpts {
  /** layers to skip (e.g. the one being edited in place) */
  skip?: Set<string>;
}

/** Draws one layer in page space. The single place that knows how each type looks. */
export function drawLayer(ctx: Ctx, l: Layer): void {
  // blur and adjustment layers need the pixels underneath; drawPage's backdrop pass handles them
  if (!l.visible || l.type === 'blur' || l.type === 'adjust') return;
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.globalCompositeOperation = l.blendMode;
  ctx.translate(l.x + l.width / 2, l.y + l.height / 2);
  if (l.rotation) ctx.rotate(l.rotation);
  if (l.flipX || l.flipY) ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
  ctx.translate(-l.width / 2, -l.height / 2);
  if (hasFx(l)) drawWithFx(ctx, l);
  else drawContent(ctx, l);
  ctx.restore();
}

function activeAdjust(l: Layer) {
  const a = l.fx?.adjust;
  return a && !isIdentityAdjust(a) ? a : null;
}

function hasFx(l: Layer): boolean {
  const fx = l.fx;
  return !!l.mask || (!!fx && (!!fx.shadow || (!!fx.stroke && fx.stroke.width > 0) || !!activeAdjust(l)));
}

/** Layer content in its own local space (origin = top-left of the box). */
function drawContent(ctx: Ctx, l: Layer): void {
  switch (l.type) {
    case 'image':
      ctx.drawImage(l.source, 0, 0, l.width, l.height);
      break;
    case 'text':
      drawText(ctx, l);
      break;
    case 'callout':
      drawCallout(ctx, l);
      break;
    case 'shape':
      drawShape(ctx, l);
      break;
    case 'line':
      drawLine(ctx, l);
      break;
    case 'path':
      drawPath(ctx, l);
      break;
    case 'stamp':
      drawStamp(ctx, l);
      break;
  }
}

/** Effects pass: content -> outline -> colour adjustments -> drop shadow, via an off-screen canvas. */
function drawWithFx(ctx: Ctx, l: Layer): void {
  const fx = l.fx ?? {};
  const adj = activeAdjust(l);
  const strokeW = fx.stroke && fx.stroke.width > 0 ? fx.stroke.width : 0;
  const pad = Math.ceil(strokeW + 2 + (adj ? adjustPad(adj) : 0));
  const w = Math.ceil(l.width) + pad * 2;
  const h = Math.ceil(l.height) + pad * 2;

  const content = makeCanvas(w, h);
  const cctx = content.getContext('2d') as Ctx;
  cctx.translate(pad, pad);
  drawContent(cctx, l);
  cctx.setTransform(1, 0, 0, 1, 0, 0);
  if (l.mask) {
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(l.mask, pad, pad, l.width, l.height);
    cctx.globalCompositeOperation = 'source-over';
  }

  let out = content;
  if (strokeW > 0 && fx.stroke) {
    const sil = makeCanvas(w, h);
    const sctx = sil.getContext('2d') as Ctx;
    sctx.drawImage(content, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = fx.stroke.color;
    sctx.fillRect(0, 0, w, h);
    out = makeCanvas(w, h);
    const octx = out.getContext('2d') as Ctx;
    // stamp the silhouette around a ring (and a half ring, so wide outlines have no holes)
    const rings = strokeW > 3 ? [strokeW, strokeW / 2] : [strokeW];
    for (const r of rings) {
      const steps = Math.max(16, Math.ceil(r * 8));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        octx.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    octx.drawImage(content, 0, 0);
  }

  if (adj && !isIdentityLevels(adj.levels)) applyLevels(out, adj.levels!);

  ctx.save();
  if (adj) {
    const f = cssFilter(adj);
    if (f !== 'none') ctx.filter = f;
  }
  if (fx.shadow) {
    // canvas shadows live in device space, so scale them with the current zoom
    const m = ctx.getTransform();
    const k = Math.hypot(m.a, m.b) || 1;
    const sh = fx.shadow;
    ctx.shadowColor = withAlpha(sh.color, sh.opacity);
    ctx.shadowBlur = sh.blur * k;
    ctx.shadowOffsetX = sh.x * k;
    ctx.shadowOffsetY = sh.y * k;
  }
  ctx.drawImage(out, -pad, -pad);
  ctx.restore();
}

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function applyLevels(canvas: HTMLCanvasElement | OffscreenCanvas, lv: Parameters<typeof levelsLUT>[0]): void {
  const c = canvas.getContext('2d') as Ctx;
  const img = c.getImageData(0, 0, canvas.width, canvas.height);
  applyLUT(img.data, levelsLUT(lv));
  c.putImageData(img, 0, 0);
}

/** Re-colour what has been drawn so far inside an adjustment layer's box. */
function applyAdjustLayer(ctx: Ctx, backdrop: CanvasImageSource, l: AdjustLayer): void {
  if (isIdentityAdjust(l.adjust)) return;
  const x = Math.round(l.x), y = Math.round(l.y);
  const w = Math.max(1, Math.round(l.width)), h = Math.max(1, Math.round(l.height));
  const m = adjustPad(l.adjust);
  const src = makeCanvas(w + m * 2, h + m * 2);
  (src.getContext('2d') as Ctx).drawImage(backdrop, x - m, y - m, w + m * 2, h + m * 2, 0, 0, w + m * 2, h + m * 2);
  const out = makeCanvas(w + m * 2, h + m * 2);
  const octx = out.getContext('2d') as Ctx;
  const f = cssFilter(l.adjust);
  if (f !== 'none') octx.filter = f;
  octx.drawImage(src, 0, 0);
  octx.filter = 'none';
  if (!isIdentityLevels(l.adjust.levels)) applyLevels(out, l.adjust.levels!);
  if (l.mask) {
    // the adjustment only shows where the mask is
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(l.mask, m, m, w, h);
    octx.globalCompositeOperation = 'source-over';
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = l.opacity;
  ctx.globalCompositeOperation = l.blendMode;
  ctx.drawImage(out, x - m, y - m);
  ctx.restore();
}

function drawShape(ctx: Ctx, l: ShapeLayer): void {
  ctx.beginPath();
  if (l.shape === 'ellipse') ctx.ellipse(l.width / 2, l.height / 2, l.width / 2, l.height / 2, 0, 0, Math.PI * 2);
  else if (l.radius > 0) ctx.roundRect(0, 0, l.width, l.height, Math.min(l.radius, l.width / 2, l.height / 2));
  else ctx.rect(0, 0, l.width, l.height);
  if (l.fill) {
    ctx.fillStyle = l.fill;
    ctx.fill();
  }
  if (l.stroke && l.strokeWidth > 0) {
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

export function arrowHeadSize(strokeWidth: number): number {
  return Math.max(12, strokeWidth * 4);
}

function drawLine(ctx: Ctx, l: LineLayer): void {
  const ax = l.x1 * l.width, ay = l.y1 * l.height, bx = l.x2 * l.width, by = l.y2 * l.height;
  const ang = Math.atan2(by - ay, bx - ax);
  const head = arrowHeadSize(l.strokeWidth);
  // pull the shaft back so a round cap never pokes past the arrow tip
  const inset = head * 0.6;
  const sx = ax + (l.startArrow ? Math.cos(ang) * inset : 0);
  const sy = ay + (l.startArrow ? Math.sin(ang) * inset : 0);
  const ex = bx - (l.endArrow ? Math.cos(ang) * inset : 0);
  const ey = by - (l.endArrow ? Math.sin(ang) * inset : 0);
  ctx.strokeStyle = l.color;
  ctx.fillStyle = l.color;
  ctx.lineWidth = l.strokeWidth;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  const tip = (x: number, y: number, a: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - head * Math.cos(a - 0.45), y - head * Math.sin(a - 0.45));
    ctx.lineTo(x - head * Math.cos(a + 0.45), y - head * Math.sin(a + 0.45));
    ctx.closePath();
    ctx.fill();
  };
  if (l.endArrow) tip(bx, by, ang);
  if (l.startArrow) tip(ax, ay, ang + Math.PI);
}

function drawPath(ctx: Ctx, l: PathLayer): void {
  const pts = l.points;
  if (!pts.length) return;
  ctx.strokeStyle = l.color;
  ctx.fillStyle = l.color;
  ctx.lineWidth = l.strokeWidth;
  ctx.lineCap = l.cap;
  ctx.lineJoin = 'round';
  const X = (p: { x: number }) => p.x * l.width;
  const Y = (p: { y: number }) => p.y * l.height;
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(X(pts[0]), Y(pts[0]), l.strokeWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(X(pts[0]), Y(pts[0]));
  // quadratic smoothing through midpoints
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (X(pts[i]) + X(pts[i + 1])) / 2;
    const my = (Y(pts[i]) + Y(pts[i + 1])) / 2;
    ctx.quadraticCurveTo(X(pts[i]), Y(pts[i]), mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(X(last), Y(last));
  ctx.stroke();
}

function drawStamp(ctx: Ctx, l: StampLayer): void {
  const s = Math.min(l.width, l.height);
  ctx.save();
  ctx.translate((l.width - s) / 2, (l.height - s) / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (l.kind === 'step') {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    const digits = l.text.length;
    ctx.font = `700 ${s * (digits > 2 ? 0.4 : digits > 1 ? 0.5 : 0.6)}px system-ui, sans-serif`;
    ctx.fillText(l.text, s / 2, s / 2 + s * 0.04);
  } else {
    ctx.font = `${s * 0.82}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(l.text, s / 2, s / 2 + s * 0.06);
  }
  ctx.restore();
}

/** Apply a blur layer to whatever has already been drawn onto `ctx`/`backdrop`. */
function applyBlur(ctx: Ctx, backdrop: CanvasImageSource, l: BlurLayer): void {
  const x = Math.round(l.x), y = Math.round(l.y);
  const w = Math.max(1, Math.round(l.width)), h = Math.max(1, Math.round(l.height));
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (l.mode === 'redact') {
    ctx.fillStyle = l.color;
    ctx.fillRect(x, y, w, h);
  } else if (l.mode === 'pixelate') {
    const size = Math.max(2, l.amount);
    const tw = Math.max(1, Math.ceil(w / size)), th = Math.max(1, Math.ceil(h / size));
    const tmp = makeCanvas(tw, th);
    const t = tmp.getContext('2d') as Ctx;
    t.imageSmoothingEnabled = true;
    t.drawImage(backdrop, x, y, w, h, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(x, y, w, h);
    ctx.drawImage(tmp, 0, 0, tw, th, x, y, tw * size, th * size);
  } else {
    // gaussian: read a margin around the box so edges don't fade to transparent
    const m = Math.ceil(l.amount * 2);
    const sw = w + m * 2, sh = h + m * 2;
    const tmp = makeCanvas(sw, sh);
    const t = tmp.getContext('2d') as Ctx;
    t.drawImage(backdrop, x - m, y - m, sw, sh, 0, 0, sw, sh);
    ctx.clearRect(x, y, w, h);
    ctx.filter = `blur(${l.amount}px)`;
    ctx.drawImage(tmp, x - m, y - m);
    ctx.filter = 'none';
  }
  ctx.restore();
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

function drawLines(ctx: Ctx, l: TextLayer | CalloutLayer, padX: number, padY: number, innerW: number): void {
  const layout = layoutText(l, innerW);
  ctx.font = fontString(l);
  ctx.fillStyle = l.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = l.align;
  const x = l.align === 'left' ? padX : l.align === 'center' ? padX + innerW / 2 : padX + innerW;
  layout.lines.forEach((line, i) => {
    ctx.fillText(line, x, padY + i * layout.lineHeightPx + layout.lineHeightPx / 2);
  });
}

function drawText(ctx: Ctx, l: TextLayer): void {
  drawLines(ctx, l, 0, 0, l.width);
}

function drawCallout(ctx: Ctx, l: CalloutLayer): void {
  const pad = l.fontSize * CALLOUT_PAD_RATIO;
  const tailX = l.width * 0.25;
  ctx.fillStyle = l.fill;
  ctx.beginPath();
  ctx.roundRect(0, 0, l.width, l.height, l.radius);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(tailX - 8, l.height - 0.5);
  ctx.lineTo(tailX + 8, l.height - 0.5);
  ctx.lineTo(tailX, l.height + CALLOUT_TAIL);
  ctx.closePath();
  ctx.fill();
  drawLines(ctx, l, pad, pad, l.width - pad * 2);
}

let scratch: HTMLCanvasElement | OffscreenCanvas | null = null;

/** Draws all layers. Pages with blur layers are composed off-screen so those layers can sample what's beneath them. */
export function drawPage(ctx: Ctx, page: Page, opts: RenderOpts = {}): void {
  const needsBackdrop = page.layers.some((l) => (l.type === 'blur' || l.type === 'adjust') && l.visible && !opts.skip?.has(l.id));
  if (!needsBackdrop) {
    for (const l of page.layers) {
      if (!opts.skip?.has(l.id)) drawLayer(ctx, l);
    }
    return;
  }
  const w = Math.max(1, Math.ceil(page.width)), h = Math.max(1, Math.ceil(page.height));
  if (!scratch || scratch.width !== w || scratch.height !== h) scratch = makeCanvas(w, h);
  const sctx = scratch.getContext('2d') as Ctx;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  for (const l of page.layers) {
    if (opts.skip?.has(l.id) || !l.visible) continue;
    if (l.type === 'blur') applyBlur(sctx, scratch, l);
    else if (l.type === 'adjust') applyAdjustLayer(sctx, scratch, l);
    else drawLayer(sctx, l);
  }
  ctx.drawImage(scratch, 0, 0);
}

/** Composite a page to a fresh canvas — used by export, copy, thumbnails. */
export function flattenPage(page: Page, scale = 1, background?: string, readback = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(page.width * scale));
  c.height = Math.max(1, Math.round(page.height * scale));
  // pass readback = true when the caller will sample pixels repeatedly (eyedropper)
  const ctx = c.getContext('2d', { willReadFrequently: readback })!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.scale(scale, scale);
  drawPage(ctx, page);
  return c;
}
