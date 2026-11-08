import { beforeAll, describe, expect, it } from 'vitest';
import { Editor } from '../studio/engine/editor';
import {
  createBlurLayer, createImageLayer, createLineLayer, createPathLayer, createShapeLayer, createStampLayer,
  lineEndpoints, nextStepNumber, pathPointsAbs, setLineEndpoints, createTextLayer,
} from '../studio/engine/document';
import { distToSegment, hitLayer } from '../studio/engine/hit';
import { snapRect, snapTargets } from '../studio/engine/snap';
import { alignMoves, distributeMoves } from '../studio/engine/align';
import { setTextMeasurer } from '../studio/engine/text-layout';
import { rad } from '../studio/engine/geometry';

beforeAll(() => setTextMeasurer((t, f) => t.length * Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 16) * 0.5));
const approx = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);
const base = () => {
  const e = new Editor();
  e.addImage(createImageLayer({} as CanvasImageSource, 400, 300));
  return e;
};

describe('line layers', () => {
  it('round-trips endpoints through the fractional box', () => {
    const l = createLineLayer({ x: 50, y: 200 }, { x: 10, y: 20 }, { endArrow: true });
    const [a, b] = lineEndpoints(l);
    approx(a.x, 50); approx(a.y, 200); approx(b.x, 10); approx(b.y, 20);
    expect([l.x, l.y, l.width, l.height]).toEqual([10, 20, 40, 180]);
    expect(l.name).toBe('Arrow');
  });
  it('a perfectly horizontal line still has a usable box', () => {
    const l = createLineLayer({ x: 0, y: 5 }, { x: 100, y: 5 });
    expect(l.height).toBe(1);
    const [a, b] = lineEndpoints(l);
    approx(a.y, 5); approx(b.y, 5);
  });
  it('moving the box moves both endpoints; resizing scales the line', () => {
    const l = createLineLayer({ x: 0, y: 0 }, { x: 100, y: 50 });
    l.x += 10; l.y += 20;
    const [a, b] = lineEndpoints(l);
    approx(a.x, 10); approx(b.x, 110); approx(b.y, 70);
    l.width *= 2;
    approx(lineEndpoints(l)[1].x, 10 + 200);
  });
  it('setLineEndpoints can flip direction', () => {
    const l = createLineLayer({ x: 0, y: 0 }, { x: 10, y: 10 });
    setLineEndpoints(l, { x: 10, y: 0 }, { x: 0, y: 10 });
    const [a, b] = lineEndpoints(l);
    approx(a.x, 10); approx(b.x, 0); approx(a.y, 0); approx(b.y, 10);
  });
});

describe('path layers', () => {
  it('keeps points when the box is rebuilt', () => {
    const pts = [{ x: 10, y: 10 }, { x: 60, y: 40 }, { x: 110, y: 20 }];
    const p = createPathLayer(pts);
    pathPointsAbs(p).forEach((q, i) => { approx(q.x, pts[i].x); approx(q.y, pts[i].y); });
  });
  it('a single dab and a flat stroke do not divide by zero', () => {
    const dot = createPathLayer([{ x: 5, y: 5 }]);
    expect(Number.isFinite(dot.points[0].x)).toBe(true);
    const flat = createPathLayer([{ x: 0, y: 7 }, { x: 50, y: 7 }]);
    expect(flat.height).toBe(1);
    pathPointsAbs(flat).forEach((q) => approx(q.y, 7));
  });
});

describe('hit testing', () => {
  it('measures segment distance', () => {
    approx(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
    approx(distToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  });
  it('lines are grabbable near the stroke but not across the box', () => {
    const l = createLineLayer({ x: 0, y: 0 }, { x: 100, y: 100 }, { strokeWidth: 4 });
    expect(hitLayer(l, { x: 50, y: 52 }, 1)).toBe(true);
    expect(hitLayer(l, { x: 90, y: 10 }, 1)).toBe(false); // inside the bbox, far from the line
  });
  it('slop stays constant on screen when zoomed out', () => {
    const l = createLineLayer({ x: 0, y: 0 }, { x: 100, y: 0 }, { strokeWidth: 2 });
    expect(hitLayer(l, { x: 50, y: 15 }, 1)).toBe(false);
    expect(hitLayer(l, { x: 50, y: 15 }, 0.2)).toBe(true); // 5px screen = 25 page px
  });
  it('hollow rectangles hit only the outline', () => {
    const r = createShapeLayer('rect', { x: 0, y: 0, width: 200, height: 100, strokeWidth: 4 });
    expect(hitLayer(r, { x: 100, y: 50 }, 1)).toBe(false);
    expect(hitLayer(r, { x: 100, y: 1 }, 1)).toBe(true);
    expect(hitLayer(r, { x: 199, y: 50 }, 1)).toBe(true);
  });
  it('filled shapes hit anywhere inside', () => {
    const r = createShapeLayer('rect', { x: 0, y: 0, width: 200, height: 100, fill: '#f00' });
    expect(hitLayer(r, { x: 100, y: 50 }, 1)).toBe(true);
    const e = createShapeLayer('ellipse', { x: 0, y: 0, width: 200, height: 100, fill: '#f00' });
    expect(hitLayer(e, { x: 100, y: 50 }, 1)).toBe(true);
    expect(hitLayer(e, { x: 2, y: 2 }, 1)).toBe(false); // bbox corner is outside the ellipse
  });
  it('hollow ellipses hit the ring', () => {
    const e = createShapeLayer('ellipse', { x: 0, y: 0, width: 200, height: 200, strokeWidth: 4 });
    expect(hitLayer(e, { x: 100, y: 100 }, 1)).toBe(false);
    expect(hitLayer(e, { x: 199, y: 100 }, 1)).toBe(true);
  });
  it('rotated shapes are tested in their own frame', () => {
    const r = createShapeLayer('rect', { x: 0, y: 0, width: 200, height: 20, fill: '#000', rotation: rad(90) });
    // rotated about (100,10): now vertical, spanning x 90..110, y -90..110
    expect(hitLayer(r, { x: 100, y: 100 }, 1)).toBe(true);
    expect(hitLayer(r, { x: 190, y: 10 }, 1)).toBe(false);
  });
  it('hidden layers never hit', () => {
    const r = createShapeLayer('rect', { x: 0, y: 0, width: 50, height: 50, fill: '#000', visible: false });
    expect(hitLayer(r, { x: 10, y: 10 }, 1)).toBe(false);
  });
});

describe('snapping', () => {
  it('snaps an edge to the page centre within the threshold', () => {
    const e = base();
    const t = snapTargets(e.page, new Set());
    const r = snapRect({ x: 195, y: 100, width: 50, height: 50 }, t, 6);
    // left edge 195 -> page centre 200
    approx(r.dx, 5);
    expect(r.guidesX).toContain(200);
  });
  it('does nothing outside the threshold', () => {
    const t = { xs: [0, 100], ys: [0, 100] };
    const r = snapRect({ x: 30, y: 30, width: 10, height: 10 }, t, 6);
    expect([r.dx, r.dy, r.guidesX.length, r.guidesY.length]).toEqual([0, 0, 0, 0]);
  });
  it('picks the closest of several candidates', () => {
    const t = { xs: [100, 104], ys: [] };
    approx(snapRect({ x: 103, y: 0, width: 10, height: 10 }, t, 6).dx, 1);
  });
  it('excluded layers are not snap targets', () => {
    const e = base();
    const a = createShapeLayer('rect', { x: 333, y: 0, width: 10, height: 10 });
    e.addLayer(a);
    expect(snapTargets(e.page, new Set([a.id])).xs).not.toContain(333);
    expect(snapTargets(e.page, new Set()).xs).toContain(333);
  });
});

describe('align / distribute', () => {
  const box = (x: number, w: number, y = 0, h = 10) => createShapeLayer('rect', { x, y, width: w, height: h });
  it('aligns left, centre and right to a reference', () => {
    const ls = [box(10, 20), box(50, 40)];
    const ref = { x: 0, y: 0, width: 100, height: 100 };
    expect(alignMoves(ls, 'left', ref).map((m) => m.dx)).toEqual([-10, -50]);
    expect(alignMoves(ls, 'right', ref).map((m) => m.dx)).toEqual([70, 10]);
    expect(alignMoves(ls, 'hcenter', ref).map((m) => m.dx)).toEqual([30, -20]);
  });
  it('distributes with equal gaps and keeps the ends', () => {
    const ls = [box(0, 10), box(15, 10), box(100, 10)];
    const m = distributeMoves(ls, 'x');
    // total span 110, items 30 => gaps of 40: middle must start at 50
    expect(m[1].dx).toBe(50 - 15);
    expect(m[0].dx).toBe(0);
    expect(m[2].dx).toBe(0);
  });
  it('needs three layers to distribute', () => {
    expect(distributeMoves([box(0, 10), box(50, 10)], 'x')).toEqual([]);
  });
  it('Editor.alignSelection: single layer aligns to the page, undoably', () => {
    const e = base();
    const r = box(10, 40, 10, 40);
    e.addLayer(r);
    e.alignSelection('right');
    expect(r.x).toBe(400 - 40);
    e.alignSelection('vcenter');
    approx(r.y, 150 - 20);
    e.undo();
    approx(r.y, 10);
    e.undo();
    expect(r.x).toBe(10);
  });
  it('Editor.alignSelection with several layers is one undo step', () => {
    const e = base();
    const a = box(10, 20, 0), b = box(100, 20, 50);
    e.addLayer(a); e.addLayer(b);
    e.select([a.id, b.id]);
    const n = e.history.entries.length;
    e.alignSelection('left');
    expect(e.history.entries.length).toBe(n + 1);
    expect([a.x, b.x]).toEqual([10, 10]);
    e.undo();
    expect([a.x, b.x]).toEqual([10, 100]);
  });
});

describe('live creation (draw tools)', () => {
  it('records nothing until committed, then one undo step', () => {
    const e = base();
    const n = e.history.entries.length;
    const r = createShapeLayer('rect', { x: 0, y: 0, width: 5, height: 5 });
    e.createLive(r);
    expect(e.page.layers).toContain(r);
    expect(e.history.entries.length).toBe(n);
    e.updateLive(r.id, { width: 80, height: 60 });
    e.commitLive('Add rectangle');
    expect(e.history.entries.length).toBe(n + 1);
    expect(e.selection).toEqual([r.id]);
    e.undo();
    expect(e.page.layers).not.toContain(r);
    e.redo();
    expect(e.page.layers).toContain(r);
    expect(r.width).toBe(80);
  });
  it('discard leaves no trace', () => {
    const e = base();
    const n = e.history.entries.length;
    const r = createShapeLayer('rect');
    e.createLive(r);
    e.discardLive();
    expect(e.page.layers).not.toContain(r);
    expect(e.history.entries.length).toBe(n);
    expect(e.live).toBeNull();
  });
});

describe('crop', () => {
  it('shrinks the artboard, shifts layers, and undo restores both', () => {
    const e = base();
    const r = createShapeLayer('rect', { x: 150, y: 100, width: 50, height: 50 });
    e.addLayer(r);
    e.cropTo({ x: 100, y: 50, width: 200, height: 150 });
    expect([e.page.width, e.page.height]).toEqual([200, 150]);
    expect([r.x, r.y]).toEqual([50, 50]);
    expect([e.page.layers[0].x, e.page.layers[0].y]).toEqual([-100, -50]); // still there, just clipped
    e.undo();
    expect([e.page.width, e.page.height]).toEqual([400, 300]);
    expect([r.x, r.y]).toEqual([150, 100]);
    e.redo();
    expect(e.page.width).toBe(200);
  });
  it('cropping to the full page is a no-op', () => {
    const e = base();
    const n = e.history.entries.length;
    e.cropTo({ x: 0, y: 0, width: 400, height: 300 });
    expect(e.history.entries.length).toBe(n);
  });
});

describe('stamps and blur', () => {
  it('step numbers increment past the highest existing', () => {
    const e = base();
    expect(nextStepNumber(e.page)).toBe(1);
    e.addLayer(createStampLayer('step', '1', 40, { x: 50, y: 50 }));
    e.addLayer(createStampLayer('step', '3', 40, { x: 90, y: 50 }));
    e.addLayer(createStampLayer('emoji', '👍', 40, { x: 130, y: 50 }));
    expect(nextStepNumber(e.page)).toBe(4);
  });
  it('stamps are centred on the requested point', () => {
    const s = createStampLayer('step', '1', 40, { x: 100, y: 100 });
    expect([s.x, s.y, s.width, s.height]).toEqual([80, 80, 40, 40]);
  });
  it('blur layers never rotate and default to pixelate', () => {
    const b = createBlurLayer({ x: 1, y: 2, width: 30, height: 30 });
    expect([b.mode, b.rotation]).toEqual(['pixelate', 0]);
  });
  it('text still relayouts alongside the new layer kinds', () => {
    const e = base();
    const t = createTextLayer({ text: 'abc', fontSize: 20 });
    e.addLayer(t);
    e.addLayer(createShapeLayer('rect'));
    e.patchLayer(t.id, { text: 'abcdefgh' });
    expect(t.width).toBeGreaterThan(40);
  });
});
