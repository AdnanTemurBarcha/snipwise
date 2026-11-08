import type { Layer } from './types';
import { toLocal, pointInBox, type Point } from './geometry';
import { lineEndpoints, pathPointsAbs } from './document';
import { arrowHeadSize } from './render';
import { pageToPixel, pixelScale } from './raster';

/** Screen-space slop (px) added around thin strokes so they're easy to grab. */
export const HIT_SLOP_PX = 5;

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does page point `p` hit this layer? `zoom` keeps the slop constant on screen. */
export function hitLayer(l: Layer, p: Point, zoom: number): boolean {
  if (!l.visible || l.type === 'adjust') return false; // adjustment layers are picked in the Layers panel
  const tol = HIT_SLOP_PX / zoom;

  switch (l.type) {
    case 'line': {
      const [a, b] = lineEndpoints(l);
      const head = l.endArrow || l.startArrow ? arrowHeadSize(l.strokeWidth) / 2 : 0;
      return distToSegment(p, a, b) <= Math.max(l.strokeWidth / 2 + head * 0.5, tol);
    }
    case 'path': {
      const pts = pathPointsAbs(l);
      const r = l.strokeWidth / 2 + tol;
      if (p.x < l.x - r || p.y < l.y - r || p.x > l.x + l.width + r || p.y > l.y + l.height + r) return false;
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= r;
      for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= r) return true;
      return false;
    }
    case 'shape': {
      const q = toLocal(l, p);
      const half = (l.stroke ? l.strokeWidth : 0) / 2 + tol;
      const inOuter = q.x >= -half && q.y >= -half && q.x <= l.width + half && q.y <= l.height + half;
      if (!inOuter) return false;
      if (l.fill) {
        if (l.shape === 'rect') return true;
        return ellipseR(q, l) <= 1 + half / Math.max(1, Math.min(l.width, l.height) / 2);
      }
      // outline only: hit the ring, not the hollow middle
      if (l.shape === 'rect') {
        const inInner = q.x > half && q.y > half && q.x < l.width - half && q.y < l.height - half;
        return !inInner;
      }
      const rad = Math.min(l.width, l.height) / 2;
      return Math.abs(ellipseR(q, l) - 1) * rad <= half;
    }
    case 'image': {
      if (!pointInBox(l, p)) return false;
      if (!l.raster || !(l.source instanceof HTMLCanvasElement)) return true;
      // painted layers: only the painted pixels count, with a little slop for thin strokes
      const q = pageToPixel(l, p);
      const r = Math.min(6, Math.ceil(tol / Math.max(0.01, pixelScale(l))));
      const x = Math.max(0, Math.floor(q.x) - r), y = Math.max(0, Math.floor(q.y) - r);
      const w = Math.min(l.source.width - x, r * 2 + 1), h = Math.min(l.source.height - y, r * 2 + 1);
      if (w <= 0 || h <= 0) return false;
      const d = l.source.getContext('2d')!.getImageData(x, y, w, h).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
      return false;
    }
    default:
      return pointInBox(l, p);
  }
}

function ellipseR(q: Point, l: { width: number; height: number }): number {
  const rx = l.width / 2 || 1;
  const ry = l.height / 2 || 1;
  return Math.hypot((q.x - rx) / rx, (q.y - ry) / ry);
}
