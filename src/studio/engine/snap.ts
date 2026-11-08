import type { Rect } from './geometry';
import { boundsOf } from './geometry';
import type { Page } from './types';

export interface SnapTargets {
  xs: number[];
  ys: number[];
}

/** Edges/centres other things expose to snap against: page edges, page centre, other layers. */
export function snapTargets(page: Page, exclude: Set<string>): SnapTargets {
  const xs = [0, page.width / 2, page.width];
  const ys = [0, page.height / 2, page.height];
  for (const l of page.layers) {
    if (exclude.has(l.id) || !l.visible) continue;
    const b = boundsOf(l);
    xs.push(b.x, b.x + b.width / 2, b.x + b.width);
    ys.push(b.y, b.y + b.height / 2, b.y + b.height);
  }
  return { xs, ys };
}

export interface SnapResult {
  dx: number;
  dy: number;
  /** vertical guide lines (x positions) to draw */
  guidesX: number[];
  /** horizontal guide lines (y positions) to draw */
  guidesY: number[];
}

function best(values: number[], targets: number[], threshold: number) {
  let delta = 0;
  let found: number | null = null;
  let min = threshold + 1e-9;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) < min) {
        min = Math.abs(d);
        delta = d;
        found = t;
      }
    }
  }
  return { delta, found };
}

/** How far to nudge `r` so one of its edges/centre lines up with a target within `threshold`. */
export function snapRect(r: Rect, t: SnapTargets, threshold: number): SnapResult {
  const bx = best([r.x, r.x + r.width / 2, r.x + r.width], t.xs, threshold);
  const by = best([r.y, r.y + r.height / 2, r.y + r.height], t.ys, threshold);
  const dx = bx.found === null ? 0 : bx.delta;
  const dy = by.found === null ? 0 : by.delta;
  // draw a guide for every target the snapped rect now actually touches
  const eps = 0.01;
  const nx = [r.x + dx, r.x + dx + r.width / 2, r.x + dx + r.width];
  const ny = [r.y + dy, r.y + dy + r.height / 2, r.y + dy + r.height];
  const guidesX = bx.found === null ? [] : [...new Set(t.xs.filter((x) => nx.some((v) => Math.abs(v - x) < eps)))];
  const guidesY = by.found === null ? [] : [...new Set(t.ys.filter((y) => ny.some((v) => Math.abs(v - y) < eps)))];
  return { dx, dy, guidesX, guidesY };
}
