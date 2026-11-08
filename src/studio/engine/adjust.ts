// Colour adjustments shared by per-layer effects, adjustment layers and (later) filters.
// Everything except levels maps onto CSS filters, which Canvas 2D runs on the GPU.

import type { Adjustments, Levels } from './types';

export function defaultAdjustments(): Adjustments {
  return { brightness: 0, contrast: 0, saturation: 0, hue: 0, grayscale: 0, sepia: 0, invert: 0, blur: 0, levels: null };
}

export function defaultLevels(): Levels {
  return { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
}

export function isIdentityLevels(l?: Levels | null): boolean {
  return !l || (l.inBlack === 0 && l.inWhite === 255 && l.gamma === 1 && l.outBlack === 0 && l.outWhite === 255);
}

export function isIdentityAdjust(a?: Adjustments | null): boolean {
  if (!a) return true;
  return !a.brightness && !a.contrast && !a.saturation && !a.hue && !a.grayscale && !a.sepia && !a.invert && !a.blur && isIdentityLevels(a.levels);
}

/** The CSS `filter` string for everything but levels ('none' when there is nothing to do). */
export function cssFilter(a: Adjustments): string {
  const f: string[] = [];
  if (a.brightness) f.push(`brightness(${(1 + a.brightness / 100).toFixed(3)})`);
  if (a.contrast) f.push(`contrast(${(1 + a.contrast / 100).toFixed(3)})`);
  if (a.saturation) f.push(`saturate(${Math.max(0, 1 + a.saturation / 100).toFixed(3)})`);
  if (a.hue) f.push(`hue-rotate(${a.hue}deg)`);
  if (a.grayscale) f.push(`grayscale(${a.grayscale / 100})`);
  if (a.sepia) f.push(`sepia(${a.sepia / 100})`);
  if (a.invert) f.push(`invert(${a.invert / 100})`);
  if (a.blur) f.push(`blur(${a.blur}px)`);
  return f.length ? f.join(' ') : 'none';
}

/** Extra room needed around the content so a blur doesn't clip. */
export function adjustPad(a: Adjustments): number {
  return Math.ceil(a.blur * 3);
}

/** 256-entry lookup table for a Levels adjustment. */
export function levelsLUT(l: Levels): Uint8Array {
  const lut = new Uint8Array(256);
  const span = Math.max(1, l.inWhite - l.inBlack);
  const inv = 1 / Math.max(0.01, l.gamma);
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i - l.inBlack) / span));
    lut[i] = Math.round(l.outBlack + Math.pow(t, inv) * (l.outWhite - l.outBlack));
  }
  return lut;
}

export function applyLUT(data: Uint8ClampedArray, lut: Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
}

export interface AdjustPreset {
  name: string;
  adjust: Partial<Adjustments>;
}

export const ADJUST_PRESETS: AdjustPreset[] = [
  { name: 'Black & white', adjust: { grayscale: 100, contrast: 10 } },
  { name: 'Sepia', adjust: { sepia: 85, contrast: 5 } },
  { name: 'Warm', adjust: { sepia: 25, saturation: 15, brightness: 4 } },
  { name: 'Cool', adjust: { hue: -18, saturation: 8 } },
  { name: 'Vivid', adjust: { saturation: 40, contrast: 15 } },
  { name: 'Faded', adjust: { contrast: -20, saturation: -25, brightness: 8 } },
  { name: 'High contrast', adjust: { contrast: 45 } },
  { name: 'Dim', adjust: { brightness: -35 } },
  { name: 'Invert', adjust: { invert: 100 } },
];
