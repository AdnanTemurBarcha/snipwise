// Pixel-level editing for image layers: brush dabs, strokes, flood fill,
// gradients, and the undo command that stores only the pixels that changed.

import type { Command } from './history';
import type { BaseLayer, ImageLayer } from './types';
import type { Point, Rect } from './geometry';
import { createImageLayer } from './document';

/**
 * Bitmaps we edit are read back constantly (undo snapshots, hit-testing, bounds), so they are
 * created CPU-backed. The first getContext call fixes this for the canvas's lifetime.
 */
export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

/** Make sure the layer is backed by a canvas we can paint on (a no-op visually). */
export function ensureCanvas(layer: ImageLayer): HTMLCanvasElement {
  if (layer.source instanceof HTMLCanvasElement) return layer.source;
  const c = makeCanvas(layer.naturalWidth, layer.naturalHeight);
  c.getContext('2d')!.drawImage(layer.source, 0, 0, c.width, c.height);
  layer.source = c;
  return c;
}

/** A transparent, paintable layer. */
export function createRasterLayer(width: number, height: number, name = 'Paint', at: Point = { x: 0, y: 0 }): ImageLayer {
  const c = makeCanvas(width, height);
  const l = createImageLayer(c, c.width, c.height, { name, x: at.x, y: at.y });
  l.raster = true;
  return l;
}

/** Matrix taking pixel coordinates of a `pw`×`ph` bitmap that fills the layer box to page coordinates. */
export function pixelMatrixFor(l: BaseLayer, pw: number, ph: number): DOMMatrix {
  return new DOMMatrix()
    .translate(l.x + l.width / 2, l.y + l.height / 2)
    .rotate((l.rotation * 180) / Math.PI)
    .scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1)
    .translate(-l.width / 2, -l.height / 2)
    .scale(l.width / pw, l.height / ph);
}

export function pageToPixelFor(l: BaseLayer, pw: number, ph: number, p: Point): Point {
  const q = pixelMatrixFor(l, pw, ph).inverse().transformPoint({ x: p.x, y: p.y });
  return { x: q.x, y: q.y };
}

export function pixelToPageFor(l: BaseLayer, pw: number, ph: number, p: Point): Point {
  const q = pixelMatrixFor(l, pw, ph).transformPoint({ x: p.x, y: p.y });
  return { x: q.x, y: q.y };
}

/** Matrix taking layer-pixel coordinates to page coordinates. */
export function pixelMatrix(l: ImageLayer): DOMMatrix {
  return pixelMatrixFor(l, l.naturalWidth, l.naturalHeight);
}

export function pageToPixel(l: ImageLayer, p: Point): Point {
  return pageToPixelFor(l, l.naturalWidth, l.naturalHeight, p);
}

/** Page px per bitmap pixel (mean of both axes). */
export function pixelScaleFor(l: BaseLayer, pw: number, ph: number): number {
  return (l.width / pw + l.height / ph) / 2;
}

export function pixelScale(l: ImageLayer): number {
  return pixelScaleFor(l, l.naturalWidth, l.naturalHeight);
}

/** The page selection, resampled into a bitmap that fills the layer box. */
export function maskForBitmap(l: BaseLayer, pw: number, ph: number, selMask: HTMLCanvasElement | null): HTMLCanvasElement | null {
  if (!selMask) return null;
  const m = makeCanvas(pw, ph);
  const ctx = m.getContext('2d')!;
  ctx.setTransform(pixelMatrixFor(l, pw, ph).inverse());
  ctx.drawImage(selMask, 0, 0);
  return m;
}

/** The page selection, resampled into this layer's pixel space. */
export function maskForLayer(l: ImageLayer, selMask: HTMLCanvasElement | null): HTMLCanvasElement | null {
  return maskForBitmap(l, l.naturalWidth, l.naturalHeight, selMask);
}

// ── colour ──────────────────────────────────────────────────────────────────
export interface RGB {
  r: number;
  g: number;
  b: number;
}

let probe: CanvasRenderingContext2D | null = null;
export function parseColor(css: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  probe ??= makeCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}

export const toHex = (c: RGB) => '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
const rgba = (c: RGB, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

// ── flood fill (pure, testable) ─────────────────────────────────────────────
/**
 * Pixels matching the colour at (sx, sy) within `tol` (0-255, per channel).
 * Returns a w*h array of 0/255.
 */
export function floodMask(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tol: number, contiguous: boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const si = (sy * w + sx) * 4;
  const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2], a0 = data[si + 3];
  const match = (i: number) =>
    Math.abs(data[i] - r0) <= tol && Math.abs(data[i + 1] - g0) <= tol && Math.abs(data[i + 2] - b0) <= tol && Math.abs(data[i + 3] - a0) <= tol;

  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (match(p * 4)) out[p] = 255;
    return out;
  }
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && !out[y * w + x] && match((y * w + x) * 4)) x--;
    x++;
    let up = false, down = false;
    while (x < w && !out[y * w + x] && match((y * w + x) * 4)) {
      out[y * w + x] = 255;
      if (y > 0) {
        const m = !out[(y - 1) * w + x] && match(((y - 1) * w + x) * 4);
        if (m && !up) stack.push(x, y - 1);
        up = m;
      }
      if (y < h - 1) {
        const m = !out[(y + 1) * w + x] && match(((y + 1) * w + x) * 4);
        if (m && !down) stack.push(x, y + 1);
        down = m;
      }
      x++;
    }
  }
  return out;
}

/** Grow a 0/255 mask by one pixel in every direction (hides the halo on anti-aliased edges). */
export function growMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) continue;
      if ((x > 0 && mask[y * w + x - 1]) || (x < w - 1 && mask[y * w + x + 1]) || (y > 0 && mask[(y - 1) * w + x]) || (y < h - 1 && mask[(y + 1) * w + x])) {
        out[y * w + x] = 255;
      }
    }
  }
  return out;
}

/** Turn a 0/255 mask into a canvas whose alpha is the mask. */
export function maskToCanvas(mask: Uint8Array, w: number, h: number, color: RGB = { r: 0, g: 0, b: 0 }): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const img = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    img.data[i * 4] = color.r;
    img.data[i * 4 + 1] = color.g;
    img.data[i * 4 + 2] = color.b;
    img.data[i * 4 + 3] = mask[i];
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

// ── brush ───────────────────────────────────────────────────────────────────
const dabCache = new Map<string, HTMLCanvasElement>();

/** A white dab whose alpha falls off from `hardness` to the rim. Cached per size. */
export function softDab(size: number, hardness: number): HTMLCanvasElement {
  const d = Math.max(1, Math.ceil(size));
  const key = `${d}:${hardness.toFixed(2)}`;
  let c = dabCache.get(key);
  if (c) return c;
  c = makeCanvas(d, d);
  paintDab(c.getContext('2d')!, d / 2, d / 2, d, hardness, { r: 255, g: 255, b: 255 });
  if (dabCache.size > 40) dabCache.clear();
  dabCache.set(key, c);
  return c;
}

export function paintDab(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, hardness: number, col: RGB): void {
  const r = Math.max(0.5, size / 2);
  if (hardness >= 0.99 || r < 1.5) {
    ctx.fillStyle = rgba(col, 1);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const g = ctx.createRadialGradient(x, y, r * hardness, x, y, r);
  g.addColorStop(0, rgba(col, 1));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Walks a pointer path and emits evenly spaced dab positions. */
export class StrokeWalker {
  private last: (Point & { size: number }) | null = null;
  private carry = 0;

  constructor(private spacing: (size: number) => number = (s) => Math.max(0.75, s * 0.15)) {}

  to(p: Point, size: number, emit: (x: number, y: number, size: number) => void): void {
    if (!this.last) {
      this.last = { ...p, size };
      emit(p.x, p.y, size);
      return;
    }
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    let d = this.spacing(size) - this.carry;
    while (d <= len) {
      const t = d / len;
      emit(this.last.x + dx * t, this.last.y + dy * t, this.last.size + (size - this.last.size) * t);
      d += this.spacing(size);
    }
    this.carry = len - (d - this.spacing(size));
    this.last = { ...p, size };
  }
}

// ── gradient ────────────────────────────────────────────────────────────────
export interface GradientSpec {
  type: 'linear' | 'radial';
  from: RGB;
  /** null fades to transparent */
  to: RGB | null;
}

export function fillGradient(ctx: CanvasRenderingContext2D, w: number, h: number, a: Point, b: Point, spec: GradientSpec): void {
  const g =
    spec.type === 'radial'
      ? ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)))
      : ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  g.addColorStop(0, rgba(spec.from, 1));
  g.addColorStop(1, spec.to ? rgba(spec.to, 1) : rgba(spec.from, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ── undoable pixel edits ────────────────────────────────────────────────────
export class PixelEditCommand implements Command {
  constructor(public label: string, private canvas: HTMLCanvasElement, private rect: Rect, private before: ImageData, private after: ImageData) {}
  do() {
    this.canvas.getContext('2d')!.putImageData(this.after, this.rect.x, this.rect.y);
  }
  undo() {
    this.canvas.getContext('2d')!.putImageData(this.before, this.rect.x, this.rect.y);
  }
}

let tmpCanvas: HTMLCanvasElement | null = null;

/**
 * One brush stroke / fill / gradient on one layer. Everything is drawn into a
 * separate stroke canvas and composited over a snapshot, which gives
 * stroke-level opacity, selection clipping, a cheap live preview and a
 * dirty-rect undo for free.
 */
export class PixelOp {
  readonly snap: HTMLCanvasElement;
  readonly stroke: HTMLCanvasElement;
  readonly sctx: CanvasRenderingContext2D;
  private ctx: CanvasRenderingContext2D;
  private dirty: Rect | null = null;
  private drawn: Rect | null = null;

  constructor(
    readonly layer: BaseLayer,
    readonly canvas: HTMLCanvasElement,
    private mask: HTMLCanvasElement | null,
    readonly kind: 'paint' | 'erase',
    public opacity = 1,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.snap = makeCanvas(canvas.width, canvas.height);
    this.snap.getContext('2d')!.drawImage(canvas, 0, 0);
    this.stroke = makeCanvas(canvas.width, canvas.height);
    this.sctx = this.stroke.getContext('2d')!;
  }

  /** Record that `r` (layer pixels) has been drawn on the stroke canvas. */
  mark(r: Rect): void {
    const x0 = Math.max(0, Math.floor(r.x) - 1);
    const y0 = Math.max(0, Math.floor(r.y) - 1);
    const x1 = Math.min(this.canvas.width, Math.ceil(r.x + r.width) + 1);
    const y1 = Math.min(this.canvas.height, Math.ceil(r.y + r.height) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const n = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    this.dirty = this.dirty ? union(this.dirty, n) : n;
  }

  markAll(): void {
    this.mark({ x: 0, y: 0, width: this.canvas.width, height: this.canvas.height });
  }

  /** Wipe the stroke canvas (live-preview tools such as the gradient redraw from scratch). */
  clearStroke(): void {
    this.sctx.clearRect(0, 0, this.stroke.width, this.stroke.height);
    this.dirty = null;
  }

  /** Re-composite the dirty area: snapshot + stroke (+ mask, opacity). */
  render(): void {
    const region = this.drawn && this.dirty ? union(this.drawn, this.dirty) : this.drawn ?? this.dirty;
    if (!region) return;
    const { x, y, width: w, height: h } = region;
    this.ctx.clearRect(x, y, w, h);
    this.ctx.drawImage(this.snap, x, y, w, h, x, y, w, h);
    if (this.dirty) {
      const d = this.dirty;
      if (!tmpCanvas || tmpCanvas.width < d.width || tmpCanvas.height < d.height) {
        tmpCanvas = makeCanvas(Math.max(d.width, tmpCanvas?.width ?? 0), Math.max(d.height, tmpCanvas?.height ?? 0));
      }
      const t = tmpCanvas.getContext('2d')!;
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);
      t.drawImage(this.stroke, d.x, d.y, d.width, d.height, 0, 0, d.width, d.height);
      if (this.mask) {
        t.globalCompositeOperation = 'destination-in';
        t.drawImage(this.mask, d.x, d.y, d.width, d.height, 0, 0, d.width, d.height);
      }
      this.ctx.save();
      this.ctx.globalAlpha = this.opacity;
      this.ctx.globalCompositeOperation = this.kind === 'erase' ? 'destination-out' : 'source-over';
      this.ctx.drawImage(tmpCanvas, 0, 0, d.width, d.height, d.x, d.y, d.width, d.height);
      this.ctx.restore();
    }
    this.drawn = this.dirty ?? this.drawn;
  }

  cancel(): void {
    const r = this.drawn;
    if (r) {
      this.ctx.clearRect(r.x, r.y, r.width, r.height);
      this.ctx.drawImage(this.snap, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    }
  }

  /** Finish: returns the undo command, or null when nothing changed. */
  commit(label: string): PixelEditCommand | null {
    this.render();
    const r = this.drawn;
    if (!r) return null;
    const before = this.snap.getContext('2d')!.getImageData(r.x, r.y, r.width, r.height);
    const after = this.ctx.getImageData(r.x, r.y, r.width, r.height);
    return new PixelEditCommand(label, this.canvas, r, before, after);
  }
}

function union(a: Rect, b: Rect): Rect {
  const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width), y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Fill (or, with `color = null`, clear) the selection on a layer in one undoable step. */
export function fillOrClear(layer: ImageLayer, selMask: HTMLCanvasElement | null, color: string | null, label: string): PixelEditCommand | null {
  const canvas = ensureCanvas(layer);
  const op = new PixelOp(layer, canvas, maskForLayer(layer, selMask), color === null ? 'erase' : 'paint');
  op.sctx.fillStyle = color ?? '#000';
  op.sctx.fillRect(0, 0, canvas.width, canvas.height);
  op.markAll();
  return op.commit(label);
}

/** Images bigger than this are never scanned for transparent margins. */
const MAX_TRIM_PIXELS = 24_000_000;

// ── trimming transparent margins ────────────────────────────────────────────
/**
 * Bounds of the pixels whose alpha is at least `threshold` (0-255), or null when
 * there are none. Soft drop-shadow fringes fall below the threshold and are ignored.
 */
export function opaqueBounds(data: Uint8ClampedArray, w: number, h: number, threshold = 128): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Returns a copy of the image without its transparent margins (for example the
 * shadow padding macOS adds to window screenshots), or null if there is nothing to trim.
 */
export function trimTransparent(img: CanvasImageSource & { width: number; height: number }, threshold = 128): HTMLCanvasElement | null {
  const w = (img as HTMLImageElement).naturalWidth || img.width;
  const h = (img as HTMLImageElement).naturalHeight || img.height;
  if (!w || !h) return null;
  // reading every pixel of a huge image (e.g. a long full-page capture) is slow and memory hungry
  if (w * h > MAX_TRIM_PIXELS) return null;
  const src = makeCanvas(w, h);
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const b = opaqueBounds(ctx.getImageData(0, 0, w, h).data, w, h, threshold);
  if (!b || (b.width === w && b.height === h)) return null;
  // ignore trims that would only shave a stray pixel or two
  if (w - b.width < 2 && h - b.height < 2) return null;
  const out = makeCanvas(b.width, b.height);
  out.getContext('2d')!.drawImage(src, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
  return out;
}
