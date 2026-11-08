import { describe, expect, it } from 'vitest';
import { applyLUT, cssFilter, defaultAdjustments, defaultLevels, isIdentityAdjust, levelsLUT } from '../studio/engine/adjust';
import { grayscaleData, invertData, mulberry32, noiseData, posterizeData, sepiaData, sharpenData } from '../studio/engine/filters';

const px = (...v: number[]) => new Uint8ClampedArray(v);

describe('adjustments', () => {
  it('defaults are an identity and produce no filter', () => {
    const a = defaultAdjustments();
    expect(isIdentityAdjust(a)).toBe(true);
    expect(cssFilter(a)).toBe('none');
  });
  it('builds a CSS filter chain for the active parts only', () => {
    const f = cssFilter({ ...defaultAdjustments(), brightness: 20, hue: 90, blur: 3 });
    expect(f).toBe('brightness(1.200) hue-rotate(90deg) blur(3px)');
  });
  it('saturation never goes negative', () => {
    expect(cssFilter({ ...defaultAdjustments(), saturation: -100 })).toBe('saturate(0.000)');
  });
  it('levels: identity maps every value to itself', () => {
    const lut = levelsLUT(defaultLevels());
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
  });
  it('levels: black/white points clip and stretch', () => {
    const lut = levelsLUT({ ...defaultLevels(), inBlack: 50, inWhite: 200 });
    expect(lut[50]).toBe(0);
    expect(lut[200]).toBe(255);
    expect(lut[125]).toBe(128);
    expect(lut[10]).toBe(0);
    expect(lut[250]).toBe(255);
  });
  it('levels: gamma > 1 brightens midtones', () => {
    const lut = levelsLUT({ ...defaultLevels(), gamma: 2 });
    expect(lut[128]).toBeGreaterThan(128);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });
  it('applyLUT leaves alpha alone', () => {
    const d = px(10, 20, 30, 77);
    applyLUT(d, levelsLUT({ ...defaultLevels(), outWhite: 100 }));
    expect(d[3]).toBe(77);
    expect(d[0]).toBeLessThan(10);
  });
});

describe('pixel filters', () => {
  it('invert', () => {
    const d = px(0, 100, 255, 9);
    invertData(d);
    expect([...d]).toEqual([255, 155, 0, 9]);
  });
  it('grayscale equalises channels', () => {
    const d = px(255, 0, 0, 255);
    grayscaleData(d);
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
    expect(d[0]).toBe(76);
  });
  it('sepia warms white without overflowing', () => {
    const d = px(255, 255, 255, 255);
    sepiaData(d);
    expect(d[0]).toBe(255);
    expect(d[2]).toBeLessThan(d[0]);
  });
  it('posterize snaps to the requested levels', () => {
    const d = px(10, 130, 250, 255);
    posterizeData(d, 2);
    expect([d[0], d[1], d[2]]).toEqual([0, 255, 255]);
  });
  it('noise is reproducible with a seed, skips transparent pixels and stays in range', () => {
    const a = px(100, 100, 100, 255, 100, 100, 100, 0);
    const b = px(100, 100, 100, 255, 100, 100, 100, 0);
    noiseData(a, 30, true, mulberry32(7));
    noiseData(b, 30, true, mulberry32(7));
    expect([...a]).toEqual([...b]);
    expect([...a.slice(4, 7)]).toEqual([100, 100, 100]);
    expect(a[0]).not.toBe(100);
  });
  it('sharpen leaves flat areas alone and boosts edges', () => {
    const w = 5, h = 3;
    const flat = new Uint8ClampedArray(w * h * 4).fill(100);
    expect([...sharpenData(flat, w, h, 1)]).toEqual([...flat]);
    const edge = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < 3; x++) edge[(y * w + x) * 4] = edge[(y * w + x) * 4 + 1] = edge[(y * w + x) * 4 + 2] = 100;
    const out = sharpenData(edge, w, h, 1);
    const i = (1 * w + 2) * 4; // dark pixel next to the edge gets darker
    expect(out[i]).toBeLessThan(100);
  });
});
