// Destructive pixel filters for image layers. The pixel maths is on plain
// RGBA arrays so it can be unit-tested; blur/pixelate lean on the canvas.

import { makeCanvas, PixelEditCommand } from './raster';

export function invertData(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}

export function grayscaleData(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
}

export function sepiaData(d: Uint8ClampedArray): void {
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = Math.min(255, 0.393 * r + 0.769 * g + 0.189 * b);
    d[i + 1] = Math.min(255, 0.349 * r + 0.686 * g + 0.168 * b);
    d[i + 2] = Math.min(255, 0.272 * r + 0.534 * g + 0.131 * b);
  }
}

export function posterizeData(d: Uint8ClampedArray, levels: number): void {
  const n = Math.max(2, Math.round(levels)) - 1;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(Math.round((d[i + c] / 255) * n) * (255 / n));
  }
}

/** Deterministic PRNG so noise is reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian-ish noise; `amount` is the max deviation in 0..255 steps. */
export function noiseData(d: Uint8ClampedArray, amount: number, mono = true, rand: () => number = Math.random): void {
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (rand() + rand() + rand() - 1.5) * (2 * amount) / 1.5;
    for (let c = 0; c < 3; c++) {
      const v = mono ? n : (rand() + rand() + rand() - 1.5) * (2 * amount) / 1.5;
      d[i + c] = d[i + c] + v;
    }
  }
}

/** 3×3 unsharp-style sharpen; `amount` 0..1+ scales the kernel's effect. */
export function sharpenData(src: Uint8ClampedArray, w: number, h: number, amount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const k = amount;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const around = src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c];
        out[i + c] = src[i + c] + k * (4 * src[i + c] - around);
      }
    }
  }
  return out;
}

export interface FilterDef {
  id: string;
  label: string;
  /** slider for the filter's single parameter */
  param?: { label: string; min: number; max: number; step: number; value: number; unit?: string };
  /** returns a new canvas the same size as `src` */
  run(src: HTMLCanvasElement, amount: number): HTMLCanvasElement;
}

function viaImageData(src: HTMLCanvasElement, fn: (img: ImageData) => void): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  fn(img);
  ctx.putImageData(img, 0, 0);
  return out;
}

export const FILTERS: FilterDef[] = [
  {
    id: 'blur', label: 'Gaussian blur', param: { label: 'Radius', min: 1, max: 60, step: 1, value: 6, unit: 'px' },
    run(src, amount) {
      const out = makeCanvas(src.width, src.height);
      const ctx = out.getContext('2d')!;
      // blur on an edge-extended copy so borders don't fade to transparent
      const pad = Math.ceil(amount * 2);
      const big = makeCanvas(src.width + pad * 2, src.height + pad * 2);
      const b = big.getContext('2d')!;
      b.drawImage(src, pad, pad);
      b.drawImage(src, 0, 0, src.width, 1, pad, 0, src.width, pad);
      b.drawImage(src, 0, src.height - 1, src.width, 1, pad, pad + src.height, src.width, pad);
      b.drawImage(big, pad, 0, 1, big.height, 0, 0, pad, big.height);
      b.drawImage(big, pad + src.width - 1, 0, 1, big.height, pad + src.width, 0, pad, big.height);
      ctx.filter = `blur(${amount}px)`;
      ctx.drawImage(big, -pad, -pad);
      return out;
    },
  },
  {
    id: 'sharpen', label: 'Sharpen', param: { label: 'Amount', min: 5, max: 100, step: 5, value: 40, unit: '%' },
    run: (src, amount) => viaImageData(src, (img) => img.data.set(sharpenData(img.data, img.width, img.height, amount / 100))),
  },
  {
    id: 'noise', label: 'Add noise', param: { label: 'Amount', min: 1, max: 100, step: 1, value: 20 },
    run: (src, amount) => viaImageData(src, (img) => noiseData(img.data, amount)),
  },
  {
    id: 'pixelate', label: 'Pixelate', param: { label: 'Block size', min: 2, max: 80, step: 1, value: 10, unit: 'px' },
    run(src, amount) {
      const tw = Math.max(1, Math.ceil(src.width / amount)), th = Math.max(1, Math.ceil(src.height / amount));
      const small = makeCanvas(tw, th);
      small.getContext('2d')!.drawImage(src, 0, 0, tw, th);
      const out = makeCanvas(src.width, src.height);
      const ctx = out.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, tw, th, 0, 0, tw * amount, th * amount);
      return out;
    },
  },
  {
    id: 'posterize', label: 'Posterize', param: { label: 'Levels', min: 2, max: 16, step: 1, value: 5 },
    run: (src, amount) => viaImageData(src, (img) => posterizeData(img.data, amount)),
  },
  { id: 'grayscale', label: 'Black & white', run: (src) => viaImageData(src, (img) => grayscaleData(img.data)) },
  { id: 'sepia', label: 'Sepia', run: (src) => viaImageData(src, (img) => sepiaData(img.data)) },
  { id: 'invert', label: 'Invert colors', run: (src) => viaImageData(src, (img) => invertData(img.data)) },
];

/**
 * Run a filter on a bitmap, limited to the selection when there is one.
 * Soft selection edges blend the filtered and original pixels.
 */
export function applyFilter(canvas: HTMLCanvasElement, def: FilterDef, amount: number, mask: HTMLCanvasElement | null, label: string): PixelEditCommand {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const before = ctx.getImageData(0, 0, w, h);
  const filtered = def.run(canvas, amount);
  if (mask) {
    // result = original * (1 - m) + filtered * m
    const keep = makeCanvas(w, h);
    const kctx = keep.getContext('2d')!;
    kctx.drawImage(canvas, 0, 0);
    kctx.globalCompositeOperation = 'destination-out';
    kctx.drawImage(mask, 0, 0);
    const part = makeCanvas(w, h);
    const pctx = part.getContext('2d')!;
    pctx.drawImage(filtered, 0, 0);
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(mask, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(keep, 0, 0);
    ctx.drawImage(part, 0, 0);
  } else {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(filtered, 0, 0);
  }
  const after = ctx.getImageData(0, 0, w, h);
  return new PixelEditCommand(label, canvas, { x: 0, y: 0, width: w, height: h }, before, after);
}
