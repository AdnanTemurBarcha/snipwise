import { describe, expect, it } from 'vitest';
import { StrokeWalker, floodMask, growMask, opaqueBounds } from '../studio/engine/raster';
import { morph } from '../studio/engine/selection';

/** w*h RGBA buffer from a string grid: '.' = white, '#' = black, 'r' = red. */
function grid(rows: string[]): { data: Uint8ClampedArray; w: number; h: number } {
  const h = rows.length, w = rows[0].length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    const i = (y * w + x) * 4;
    const [r, g, b] = c === '#' ? [0, 0, 0] : c === 'r' ? [255, 0, 0] : [255, 255, 255];
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }));
  return { data, w, h };
}
const count = (m: Uint8Array) => m.reduce((n, v) => n + (v ? 1 : 0), 0);

describe('floodMask', () => {
  const g = grid([
    '..#..',
    '..#..',
    '###..',
    '.....',
  ]);
  it('stays inside a closed region when contiguous', () => {
    const m = floodMask(g.data, g.w, g.h, 0, 0, 0, true);
    expect(count(m)).toBe(4); // the 2x2 corner only
    expect(m[0]).toBe(255);
    expect(m[3]).toBe(0);
  });
  it('flows around walls but not through them', () => {
    const m = floodMask(g.data, g.w, g.h, 4, 0, 0, true);
    expect(m[3 * g.w + 0]).toBe(255); // wraps round the bottom
    expect(m[0]).toBe(0); // the walled-off corner stays empty
  });
  it('non-contiguous selects every matching pixel', () => {
    expect(count(floodMask(g.data, g.w, g.h, 0, 0, 0, false))).toBe(20 - 5);
  });
  it('tolerance widens the match', () => {
    const near = grid(['..r', '..r']);
    expect(count(floodMask(near.data, near.w, near.h, 0, 0, 0, true))).toBe(4);
    expect(count(floodMask(near.data, near.w, near.h, 0, 0, 255, true))).toBe(6);
  });
  it('ignores seeds outside the image', () => {
    expect(count(floodMask(g.data, g.w, g.h, -3, 2, 0, true))).toBe(0);
    expect(count(floodMask(g.data, g.w, g.h, 99, 2, 0, true))).toBe(0);
  });
});

describe('growMask', () => {
  it('adds a one pixel ring', () => {
    const m = new Uint8Array(25);
    m[12] = 255;
    expect(count(growMask(m, 5, 5))).toBe(5);
  });
});

describe('morph', () => {
  const alpha = (w: number, h: number, on: (x: number, y: number) => boolean) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = on(x, y) ? 255 : 0;
    return d;
  };
  const n = (d: Uint8ClampedArray) => d.reduce((c, v, i) => c + (i % 4 === 3 && v ? 1 : 0), 0);
  it('grows a square', () => {
    const out = morph(alpha(9, 9, (x, y) => x >= 3 && x <= 5 && y >= 3 && y <= 5), 9, 9, 1, true);
    expect(n(out)).toBe(25);
  });
  it('shrinks a square', () => {
    const out = morph(alpha(9, 9, (x, y) => x >= 2 && x <= 6 && y >= 2 && y <= 6), 9, 9, 1, false);
    expect(n(out)).toBe(9);
  });
});

describe('StrokeWalker', () => {
  it('emits evenly spaced dabs and carries the remainder', () => {
    const w = new StrokeWalker(() => 2);
    const xs: number[] = [];
    w.to({ x: 0, y: 0 }, 10, (x) => xs.push(x));
    w.to({ x: 5, y: 0 }, 10, (x) => xs.push(x));
    w.to({ x: 9, y: 0 }, 10, (x) => xs.push(x));
    expect(xs).toEqual([0, 2, 4, 6, 8]);
  });
  it('is independent of how the path is chopped up', () => {
    const run = (stops: number[]) => {
      const w = new StrokeWalker(() => 3);
      const out: number[] = [];
      for (const x of stops) w.to({ x, y: 0 }, 8, (px) => out.push(Math.round(px * 100) / 100));
      return out;
    };
    expect(run([0, 20])).toEqual(run([0, 1, 7, 7.5, 13, 20]));
  });
});

describe('opaqueBounds', () => {
  const rgba = (w: number, h: number, alphaAt: (x: number, y: number) => number) => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = alphaAt(x, y);
    return d;
  };
  it('finds the visible window inside transparent padding', () => {
    const d = rgba(10, 8, (x, y) => (x >= 2 && x <= 7 && y >= 1 && y <= 5 ? 255 : 0));
    expect(opaqueBounds(d, 10, 8)).toEqual({ x: 2, y: 1, width: 6, height: 5 });
  });
  it('ignores faint shadow fringes below the threshold', () => {
    const d = rgba(10, 8, (x, y) => (x >= 3 && x <= 6 && y >= 2 && y <= 5 ? 255 : x >= 1 && x <= 8 && y >= 0 && y <= 7 ? 40 : 0));
    expect(opaqueBounds(d, 10, 8)).toEqual({ x: 3, y: 2, width: 4, height: 4 });
  });
  it('returns null for a fully transparent image', () => {
    expect(opaqueBounds(rgba(4, 4, () => 0), 4, 4)).toBeNull();
  });
});
