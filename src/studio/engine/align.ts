import type { Layer } from './types';
import { boundsOf, unionRects, type Rect } from './geometry';

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export interface Move {
  id: string;
  dx: number;
  dy: number;
}

/** Shifts needed to align each layer's (rotated) bounds to `ref`. */
export function alignMoves(layers: Layer[], mode: AlignMode, ref: Rect): Move[] {
  return layers.map((l) => {
    const b = boundsOf(l);
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left': dx = ref.x - b.x; break;
      case 'hcenter': dx = ref.x + ref.width / 2 - (b.x + b.width / 2); break;
      case 'right': dx = ref.x + ref.width - (b.x + b.width); break;
      case 'top': dy = ref.y - b.y; break;
      case 'vcenter': dy = ref.y + ref.height / 2 - (b.y + b.height / 2); break;
      case 'bottom': dy = ref.y + ref.height - (b.y + b.height); break;
    }
    return { id: l.id, dx, dy };
  });
}

/** Even gaps between layers along an axis; the outermost two stay put. Needs 3+ layers. */
export function distributeMoves(layers: Layer[], axis: 'x' | 'y'): Move[] {
  if (layers.length < 3) return [];
  const items = layers
    .map((l) => ({ l, b: boundsOf(l) }))
    .sort((p, q) => (axis === 'x' ? p.b.x - q.b.x : p.b.y - q.b.y));
  const size = (b: Rect) => (axis === 'x' ? b.width : b.height);
  const start = (b: Rect) => (axis === 'x' ? b.x : b.y);
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const total = start(last) + size(last) - start(first);
  const gap = (total - items.reduce((s, it) => s + size(it.b), 0)) / (items.length - 1);
  let pos = start(first) + size(first) + gap;
  const moves: Move[] = [{ id: items[0].l.id, dx: 0, dy: 0 }];
  for (let i = 1; i < items.length - 1; i++) {
    const d = pos - start(items[i].b);
    moves.push({ id: items[i].l.id, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0 });
    pos += size(items[i].b) + gap;
  }
  moves.push({ id: items[items.length - 1].l.id, dx: 0, dy: 0 });
  return moves;
}

export function selectionBounds(layers: Layer[]): Rect | null {
  return unionRects(layers.map(boundsOf));
}
