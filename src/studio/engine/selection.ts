// Pixel selection: an alpha mask the size of the page, plus (when it is still a
// single clean shape) a vector outline so the marching ants stay crisp.

import type { Point, Rect } from './geometry';

export type SelMode = 'replace' | 'add' | 'subtract';

export type SelShape =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'ellipse'; rect: Rect }
  | { kind: 'poly'; points: Point[] };

export interface SelSnapshot {
  mask: HTMLCanvasElement | null;
  shape: SelShape | null;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

export function shapePath(shape: SelShape): Path2D {
  const p = new Path2D();
  if (shape.kind === 'rect') p.rect(shape.rect.x, shape.rect.y, shape.rect.width, shape.rect.height);
  else if (shape.kind === 'ellipse') {
    const r = shape.rect;
    p.ellipse(r.x + r.width / 2, r.y + r.height / 2, Math.max(0.5, r.width / 2), Math.max(0.5, r.height / 2), 0, 0, Math.PI * 2);
  } else {
    shape.points.forEach((pt, i) => (i ? p.lineTo(pt.x, pt.y) : p.moveTo(pt.x, pt.y)));
    p.closePath();
  }
  return p;
}

export class PixelSelection {
  mask: HTMLCanvasElement | null = null;
  shape: SelShape | null = null;
  /** bumped on every change so caches can tell */
  version = 0;
  private edge: { v: number; canvas: HTMLCanvasElement } | null = null;
  private boundsCache: { v: number; rect: Rect | null } | null = null;

  get active(): boolean {
    return this.mask !== null;
  }

  snapshot(): SelSnapshot {
    let copy: HTMLCanvasElement | null = null;
    if (this.mask) {
      copy = makeCanvas(this.mask.width, this.mask.height);
      copy.getContext('2d')!.drawImage(this.mask, 0, 0);
    }
    return { mask: copy, shape: this.shape ? structuredClone(this.shape) : null };
  }

  restore(s: SelSnapshot): void {
    if (s.mask) {
      const c = makeCanvas(s.mask.width, s.mask.height);
      c.getContext('2d')!.drawImage(s.mask, 0, 0);
      this.mask = c;
    } else this.mask = null;
    this.shape = s.shape ? structuredClone(s.shape) : null;
    this.version++;
  }

  clear(): void {
    if (!this.mask && !this.shape) return;
    this.mask = null;
    this.shape = null;
    this.version++;
  }

  /** Combine a shape with the current selection. */
  applyShape(shape: SelShape, mode: SelMode, pageW: number, pageH: number): void {
    const path = shapePath(shape);
    const next = makeCanvas(pageW, pageH);
    const ctx = next.getContext('2d')!;
    const keep = mode !== 'replace' && this.mask;
    if (keep) ctx.drawImage(this.mask!, 0, 0);
    ctx.fillStyle = '#000';
    if (mode === 'subtract') {
      ctx.globalCompositeOperation = 'destination-out';
      if (!this.mask) return; // nothing to subtract from
    }
    ctx.fill(path);
    this.mask = next;
    this.shape = keep ? null : mode === 'subtract' ? null : shape;
    this.version++;
    this.dropIfEmpty();
  }

  /** Combine a ready-made mask (e.g. from the magic wand) with the current selection. */
  applyMask(mask: HTMLCanvasElement, mode: SelMode): void {
    if (mode === 'replace' || !this.mask) {
      if (mode === 'subtract') return;
      this.mask = mask;
    } else {
      const ctx = this.mask.getContext('2d')!;
      ctx.save();
      ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : 'destination-out';
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }
    this.shape = null;
    this.version++;
    this.dropIfEmpty();
  }

  selectAll(pageW: number, pageH: number): void {
    this.applyShape({ kind: 'rect', rect: { x: 0, y: 0, width: pageW, height: pageH } }, 'replace', pageW, pageH);
  }

  invert(pageW: number, pageH: number): void {
    const next = makeCanvas(pageW, pageH);
    const ctx = next.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, next.width, next.height);
    if (this.mask) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.mask, 0, 0);
    }
    this.mask = next;
    this.shape = null;
    this.version++;
    this.dropIfEmpty();
  }

  feather(radius: number): void {
    if (!this.mask || radius <= 0) return;
    const next = makeCanvas(this.mask.width, this.mask.height);
    const ctx = next.getContext('2d')!;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(this.mask, 0, 0);
    this.mask = next;
    this.shape = null;
    this.version++;
    this.dropIfEmpty();
  }

  /** Shrink or grow the selection by `px` (negative shrinks). */
  expand(px: number): void {
    if (!this.mask || !px) return;
    const w = this.mask.width, h = this.mask.height;
    const grow = px > 0;
    const src = this.mask.getContext('2d')!.getImageData(0, 0, w, h);
    const out = morph(src.data, w, h, Math.abs(Math.round(px)), grow);
    const next = makeCanvas(w, h);
    const id = new ImageData(new Uint8ClampedArray(out), w, h);
    next.getContext('2d')!.putImageData(id, 0, 0);
    this.mask = next;
    this.shape = null;
    this.version++;
    this.dropIfEmpty();
  }

  /** Tight bounds of the selected pixels, or null. */
  bounds(): Rect | null {
    if (!this.mask) return null;
    if (this.boundsCache?.v === this.version) return this.boundsCache.rect;
    const w = this.mask.width, h = this.mask.height;
    const d = this.mask.getContext('2d')!.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const rect = x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    this.boundsCache = { v: this.version, rect };
    return rect;
  }

  private dropIfEmpty() {
    if (this.mask && !this.bounds()) {
      this.mask = null;
      this.shape = null;
      this.version++;
    }
  }

  /** 1px outline of the mask (page resolution) for the ants when there is no vector shape. */
  outline(): HTMLCanvasElement | null {
    if (!this.mask) return null;
    if (this.edge?.v === this.version) return this.edge.canvas;
    const w = this.mask.width, h = this.mask.height;
    const src = this.mask.getContext('2d')!.getImageData(0, 0, w, h).data;
    const out = new Uint8ClampedArray(w * h * 4);
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] >= 128;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on(x, y)) continue;
        if (on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1)) continue;
        const i = (y * w + x) * 4;
        const v = ((x + y) >> 1) & 1 ? 255 : 0;
        out[i] = out[i + 1] = out[i + 2] = v;
        out[i + 3] = 255;
      }
    }
    const canvas = makeCanvas(w, h);
    canvas.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
    this.edge = { v: this.version, canvas };
    return canvas;
  }
}

/** Grow (dilate) or shrink (erode) the alpha channel by `r` pixels using a square kernel. */
export function morph(data: Uint8ClampedArray, w: number, h: number, r: number, grow: boolean): Uint8ClampedArray {
  const pass = (src: Uint8ClampedArray, horizontal: boolean): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let best = grow ? 0 : 255;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const a = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : src[(yy * w + xx) * 4 + 3];
          best = grow ? Math.max(best, a) : Math.min(best, a);
        }
        out[(y * w + x) * 4 + 3] = best;
      }
    }
    return out;
  };
  return pass(pass(data, true), false);
}
