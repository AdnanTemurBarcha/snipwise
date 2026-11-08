import type { BaseLayer } from './types';

export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Box = Pick<BaseLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

export const TAU = Math.PI * 2;

export function center(b: Pick<Box, 'x' | 'y' | 'width' | 'height'>): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function rotatePoint(p: Point, about: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

/** Page-space point -> the layer's unrotated local frame (origin = top-left of box). */
export function toLocal(b: Box, p: Point): Point {
  const c = center(b);
  const r = rotatePoint(p, c, -b.rotation);
  return { x: r.x - b.x, y: r.y - b.y };
}

/** Local (unrotated, box-relative) point -> page space. */
export function toPage(b: Box, local: Point): Point {
  const c = center(b);
  return rotatePoint({ x: b.x + local.x, y: b.y + local.y }, c, b.rotation);
}

export function pointInBox(b: Box, p: Point): boolean {
  const l = toLocal(b, p);
  return l.x >= 0 && l.y >= 0 && l.x <= b.width && l.y <= b.height;
}

/** The four corners in page space: nw, ne, se, sw. */
export function corners(b: Box): Point[] {
  return [
    toPage(b, { x: 0, y: 0 }),
    toPage(b, { x: b.width, y: 0 }),
    toPage(b, { x: b.width, y: b.height }),
    toPage(b, { x: 0, y: b.height }),
  ];
}

/** Axis-aligned bounds of the rotated box in page space. */
export function boundsOf(b: Box): Rect {
  const cs = corners(b);
  const xs = cs.map((p) => p.x);
  const ys = cs.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function normalizeAngle(a: number): number {
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  if (r <= -Math.PI) r += TAU;
  return r;
}

export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Hit test using the layer's box (rotation-aware). Alias kept for readability at call sites. */
export function hitTestPoint(b: Box, p: Point): boolean {
  return pointInBox(b, p);
}
