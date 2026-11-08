import type { Box, Point } from './geometry';
import { center, clamp, normalizeAngle, rotatePoint, toLocal, toPage, TAU } from './geometry';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type HandleId = ResizeHandle | 'rotate';

export const HANDLE_ORDER: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Direction signs in the layer's local frame: -1 = left/top edge, 1 = right/bottom edge. */
export function handleSigns(h: ResizeHandle): { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } {
  return {
    sx: h.includes('w') ? -1 : h.includes('e') ? 1 : 0,
    sy: h.includes('n') ? -1 : h.includes('s') ? 1 : 0,
  };
}

export const ROTATE_HANDLE_OFFSET_PX = 26;

/** Local-frame position of a handle (relative to the unrotated box). */
export function handleLocal(b: Box, h: ResizeHandle): Point {
  const { sx, sy } = handleSigns(h);
  return { x: ((sx + 1) / 2) * b.width, y: ((sy + 1) / 2) * b.height };
}

export function handlePosition(b: Box, h: HandleId, zoom: number): Point {
  if (h === 'rotate') {
    return toPage(b, { x: b.width / 2, y: -ROTATE_HANDLE_OFFSET_PX / zoom });
  }
  return toPage(b, handleLocal(b, h));
}

/** Which handle (if any) lies within `radiusPx` screen pixels of page point `p`. */
export function hitHandle(
  b: Box,
  p: Point,
  zoom: number,
  radiusPx = 9,
  available: HandleId[] = [...HANDLE_ORDER, 'rotate'],
): HandleId | null {
  const r = radiusPx / zoom;
  // rotate first: it floats outside the box so it never competes with edges
  const order: HandleId[] = ['rotate', ...HANDLE_ORDER];
  for (const h of order) {
    if (!available.includes(h)) continue;
    const hp = handlePosition(b, h, zoom);
    if (Math.hypot(hp.x - p.x, hp.y - p.y) <= r) return h;
  }
  return null;
}

export interface ResizeOpts {
  /** keep aspect ratio (corners only; edges ignore it) */
  lockAspect?: boolean;
  /** resize symmetrically about the centre */
  fromCenter?: boolean;
  minSize?: number;
}

export type BoxPatch = { x: number; y: number; width: number; height: number };

/**
 * Resize `orig` by dragging `handle` from `start` to `now` (all page space).
 * Works for rotated boxes: the opposite edge/corner stays pinned on screen.
 */
export function resizeBox(orig: Box, handle: ResizeHandle, start: Point, now: Point, o: ResizeOpts = {}): BoxPatch {
  const min = o.minSize ?? 4;
  const { sx, sy } = handleSigns(handle);
  const d = rotatePoint({ x: now.x - start.x, y: now.y - start.y }, { x: 0, y: 0 }, -orig.rotation);
  const k = o.fromCenter ? 2 : 1;

  let w = sx !== 0 ? orig.width + sx * d.x * k : orig.width;
  let h = sy !== 0 ? orig.height + sy * d.y * k : orig.height;

  if (o.lockAspect && sx !== 0 && sy !== 0 && orig.width > 0 && orig.height > 0) {
    const s = Math.max(w / orig.width, h / orig.height);
    w = orig.width * s;
    h = orig.height * s;
  }

  w = Math.max(min, w);
  h = Math.max(min, h);

  // where does the pinned point go? the centre shifts by half the size change
  // along each dragged axis (or not at all when scaling from the centre)
  const c = center(orig);
  let lx = 0;
  let ly = 0;
  if (!o.fromCenter) {
    lx = (sx * (w - orig.width)) / 2;
    ly = (sy * (h - orig.height)) / 2;
  }
  const shift = rotatePoint({ x: lx, y: ly }, { x: 0, y: 0 }, orig.rotation);
  const cx = c.x + shift.x;
  const cy = c.y + shift.y;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Angle for the rotate handle: pointer direction from the centre, 0 = handle straight up. */
export function rotationFromPointer(b: Box, pointer: Point, snapDeg?: number): number {
  const c = center(b);
  let a = Math.atan2(pointer.y - c.y, pointer.x - c.x) + Math.PI / 2;
  if (snapDeg) {
    const step = (snapDeg * Math.PI) / 180;
    a = Math.round(a / step) * step;
  }
  return normalizeAngle(a);
}

/**
 * After a layer's size changed for reasons outside our control (text
 * reflow), shift it so `anchorLocalOld` (a point in the OLD local frame) stays
 * visually pinned. Returns the new x/y for `next` (whose width/height are final).
 */
export function pinAnchor(old: Box, anchorLocalOld: Point, next: Pick<Box, 'width' | 'height' | 'rotation'>, anchorLocalNew: Point): Point {
  const pinned = toPage(old, anchorLocalOld);
  const rel = rotatePoint(
    { x: anchorLocalNew.x - next.width / 2, y: anchorLocalNew.y - next.height / 2 },
    { x: 0, y: 0 },
    next.rotation,
  );
  const cx = pinned.x - rel.x;
  const cy = pinned.y - rel.y;
  return { x: cx - next.width / 2, y: cy - next.height / 2 };
}

export { clamp, toLocal, TAU };
