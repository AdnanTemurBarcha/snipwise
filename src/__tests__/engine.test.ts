import { beforeAll, describe, expect, it } from 'vitest';
import { Editor } from '../studio/engine/editor';
import { History } from '../studio/engine/history';
import { createCalloutLayer, createImageLayer, createTextLayer } from '../studio/engine/document';
import { setTextMeasurer } from '../studio/engine/text-layout';
import { boundsOf, pointInBox, toLocal, toPage, rad } from '../studio/engine/geometry';
import { hitHandle, pinAnchor, resizeBox, rotationFromPointer } from '../studio/engine/transform';
import { Viewport } from '../studio/engine/viewport';

// deterministic text metrics: every char is half the font size wide
beforeAll(() => {
  setTextMeasurer((text, font) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
    return text.length * size * 0.5;
  });
});

const img = () => createImageLayer({} as CanvasImageSource, 200, 100, { name: 'img' });
const approx = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('geometry', () => {
  it('round-trips page <-> local for rotated boxes', () => {
    const b = { x: 10, y: 20, width: 100, height: 40, rotation: rad(33) };
    const p = { x: 77, y: 55 };
    const back = toPage(b, toLocal(b, p));
    approx(back.x, p.x);
    approx(back.y, p.y);
  });
  it('hit-tests rotated boxes by their real shape', () => {
    const b = { x: 0, y: 0, width: 100, height: 10, rotation: rad(90) };
    // rotated 90deg about (50,5): occupies x 45..55, y -45..55
    expect(pointInBox(b, { x: 50, y: 40 })).toBe(true);
    expect(pointInBox(b, { x: 90, y: 5 })).toBe(false);
  });
  it('bounds of a 90deg rotation swap the extents', () => {
    const r = boundsOf({ x: 0, y: 0, width: 100, height: 10, rotation: rad(90) });
    approx(r.width, 10);
    approx(r.height, 100);
  });
});

describe('resizeBox', () => {
  const box = { x: 100, y: 100, width: 100, height: 50, rotation: 0 };
  it('drags the east edge and pins the west edge', () => {
    const r = resizeBox(box, 'e', { x: 200, y: 125 }, { x: 250, y: 125 });
    expect(r).toEqual({ x: 100, y: 100, width: 150, height: 50 });
  });
  it('drags the north-west corner and pins the south-east corner', () => {
    const r = resizeBox(box, 'nw', { x: 100, y: 100 }, { x: 80, y: 90 });
    expect(r).toEqual({ x: 80, y: 90, width: 120, height: 60 });
  });
  it('keeps aspect ratio on corners when locked', () => {
    const r = resizeBox(box, 'se', { x: 200, y: 150 }, { x: 300, y: 160 }, { lockAspect: true });
    approx(r.width / r.height, 2);
    expect(r.x).toBe(100);
    expect(r.y).toBe(100);
  });
  it('never collapses below the minimum size', () => {
    const r = resizeBox(box, 'e', { x: 200, y: 125 }, { x: -500, y: 125 }, { minSize: 8 });
    expect(r.width).toBe(8);
  });
  it('pins the opposite corner on screen for a rotated box', () => {
    const rot = { ...box, rotation: rad(40) };
    const before = toPage(rot, { x: 0, y: 0 }); // nw corner, opposite of se
    const startSE = toPage(rot, { x: 100, y: 50 });
    const now = { x: startSE.x + 30, y: startSE.y + 12 };
    const patch = resizeBox(rot, 'se', startSE, now);
    const after = toPage({ ...patch, rotation: rot.rotation }, { x: 0, y: 0 });
    approx(after.x, before.x, 1e-6);
    approx(after.y, before.y, 1e-6);
  });
  it('scales symmetrically from the centre', () => {
    const r = resizeBox(box, 'e', { x: 200, y: 125 }, { x: 220, y: 125 }, { fromCenter: true });
    expect(r.width).toBe(140);
    expect(r.x).toBe(80);
  });
});

describe('handles and rotation', () => {
  const box = { x: 0, y: 0, width: 100, height: 100, rotation: 0 };
  it('finds corner handles, scaled by zoom', () => {
    expect(hitHandle(box, { x: 101, y: 99 }, 1)).toBe('se');
    expect(hitHandle(box, { x: 50, y: 50 }, 1)).toBeNull();
    // at 0.25 zoom a 9px screen radius covers 36 page px
    expect(hitHandle(box, { x: 120, y: 120 }, 0.25)).toBe('se');
  });
  it('finds the rotate handle above the box', () => {
    expect(hitHandle(box, { x: 50, y: -26 }, 1)).toBe('rotate');
  });
  it('rotates to point at the cursor and snaps', () => {
    approx(rotationFromPointer(box, { x: 150, y: 50 }), rad(90));
    approx(rotationFromPointer(box, { x: 150, y: 52 }, 15), rad(90));
  });
  it('pinAnchor keeps a point fixed when size changes', () => {
    const old = { x: 10, y: 10, width: 100, height: 40, rotation: rad(25) };
    const next = { width: 160, height: 70, rotation: old.rotation };
    const a = pinAnchor(old, { x: 0, y: 0 }, next, { x: 0, y: 0 });
    const pinnedOld = toPage(old, { x: 0, y: 0 });
    const pinnedNew = toPage({ ...a, ...next }, { x: 0, y: 0 });
    approx(pinnedNew.x, pinnedOld.x);
    approx(pinnedNew.y, pinnedOld.y);
  });
});

describe('viewport', () => {
  it('zoomAt keeps the point under the cursor fixed', () => {
    const v = new Viewport();
    v.panX = 30;
    v.panY = 10;
    const before = v.toPage({ x: 200, y: 150 });
    v.zoomAt(200, 150, 2.5);
    const after = v.toPage({ x: 200, y: 150 });
    approx(after.x, before.x);
    approx(after.y, before.y);
  });
  it('fit centres the page', () => {
    const v = new Viewport();
    v.fit(1000, 800, 500, 400, 0, 4);
    expect(v.zoom).toBe(2);
    expect(v.toScreen({ x: 250, y: 200 })).toEqual({ x: 500, y: 400 });
  });
});

describe('text layout', () => {
  it('auto-width text sizes to its content', () => {
    const t = createTextLayer({ text: 'hello', fontSize: 20 });
    expect(t.width).toBeGreaterThanOrEqual(50); // 5 chars * 10px
    expect(t.height).toBeCloseTo(26);
  });
  it('fixed-width text wraps and grows taller', () => {
    const t = createTextLayer({ text: 'aaaa bbbb cccc dddd', fontSize: 20, autoWidth: false, width: 100 });
    expect(t.height).toBeGreaterThan(26 * 1.5);
  });
  it('callouts include padding', () => {
    const c = createCalloutLayer({ text: 'hi', fontSize: 20 });
    expect(c.height).toBeCloseTo(26 + 2 * 12);
  });
});

describe('History', () => {
  it('undoes and redoes, clearing redo on a new action', () => {
    let n = 0;
    const h = new History();
    const inc = (v: number) => ({ label: 'inc', do: () => (n += v), undo: () => (n -= v) });
    h.execute(inc(1));
    h.execute(inc(10));
    h.undo();
    expect(n).toBe(1);
    h.redo();
    expect(n).toBe(11);
    h.undo();
    h.execute(inc(100));
    expect(h.canRedo).toBe(false);
    expect(n).toBe(101);
  });
  it('is bounded', () => {
    const h = new History(3);
    for (let i = 0; i < 10; i++) h.execute({ label: String(i), do() {}, undo() {} });
    expect(h.entries).toEqual(['7', '8', '9']);
  });
});

describe('Editor', () => {
  it('first image sizes the page; later images are centred and fitted', () => {
    const e = new Editor();
    e.addImage(img());
    expect([e.page.width, e.page.height]).toEqual([200, 100]);
    const big = createImageLayer({} as CanvasImageSource, 800, 600, { name: 'big' });
    e.addImage(big);
    // too big for the 200x100 page: shrunk only enough to fit it exactly
    approx(big.height, 100);
    approx(big.width, 133.33, 0.01);
    approx(big.x + big.width / 2, 100);
    approx(big.y + big.height / 2, 50);
    // a smaller one keeps its real size
    const small = createImageLayer({} as CanvasImageSource, 40, 20, { name: 'small' });
    e.addImage(small);
    expect([small.width, small.height, small.x, small.y]).toEqual([40, 20, 80, 40]);
  });

  it('undo/redo of add restores page size and layers together', () => {
    const e = new Editor();
    e.addImage(img());
    e.undo();
    expect(e.page.layers).toHaveLength(0);
    expect(e.page.width).toBe(0);
    e.redo();
    expect(e.page.layers).toHaveLength(1);
    expect(e.page.width).toBe(200);
  });

  it('a gesture is one undo step and restores exactly', () => {
    const e = new Editor();
    e.addImage(img());
    const id = e.page.layers[0].id;
    e.beginGesture([id]);
    for (let i = 1; i <= 20; i++) e.updateLive(id, { x: i, y: i * 2, rotation: i / 10 });
    e.endGesture('Transform');
    expect(e.page.layers[0].x).toBe(20);
    e.undo();
    expect(e.page.layers[0].x).toBe(0);
    expect(e.page.layers[0].rotation).toBe(0);
    e.redo();
    expect(e.page.layers[0].x).toBe(20);
  });

  it('a no-op gesture records nothing', () => {
    const e = new Editor();
    e.addImage(img());
    const before = e.history.entries.length;
    e.beginGesture([e.page.layers[0].id]);
    e.endGesture('Nothing');
    expect(e.history.entries.length).toBe(before);
  });

  it('cancelGesture reverts', () => {
    const e = new Editor();
    e.addImage(img());
    const id = e.page.layers[0].id;
    e.beginGesture([id]);
    e.updateLive(id, { x: 99 });
    e.cancelGesture();
    expect(e.page.layers[0].x).toBe(0);
  });

  it('scrubbing a property merges into one undo step', () => {
    const e = new Editor();
    e.addImage(img());
    const id = e.page.layers[0].id;
    const n = e.history.entries.length;
    for (const v of [0.9, 0.8, 0.7, 0.5]) e.patchLayer(id, { opacity: v }, 'Opacity', 'opacity');
    expect(e.history.entries.length).toBe(n + 1);
    e.undo();
    expect(e.page.layers[0].opacity).toBe(1);
  });

  it('editing text relayouts and undoes the geometry too', () => {
    const e = new Editor();
    e.addImage(img());
    const t = createTextLayer({ text: 'hi', fontSize: 20 });
    e.addLayer(t);
    const w0 = t.width;
    e.patchLayer(t.id, { text: 'hello world' }, 'Edit text');
    expect(t.width).toBeGreaterThan(w0);
    e.undo();
    expect(t.text).toBe('hi');
    expect(t.width).toBe(w0);
  });

  it('delete skips locked layers, undo restores z-order', () => {
    const e = new Editor();
    e.addImage(img());
    const a = createTextLayer({ text: 'a' });
    const b = createTextLayer({ text: 'b' });
    e.addLayer(a);
    e.addLayer(b);
    const order = e.page.layers.map((l) => l.id);
    e.removeLayers([e.page.layers[0].id, a.id]);
    e.undo();
    expect(e.page.layers.map((l) => l.id)).toEqual(order);
    e.patchLayer(a.id, { locked: true });
    e.removeLayers([a.id]);
    expect(e.page.layers.some((l) => l.id === a.id)).toBe(true);
  });

  it('duplicate selects the copies; reorder works both ways', () => {
    const e = new Editor();
    e.addImage(img());
    const t = createTextLayer({ text: 'x' });
    e.addLayer(t);
    e.duplicateLayers([t.id]);
    expect(e.page.layers).toHaveLength(3);
    expect(e.selection).toEqual([e.page.layers[2].id]);
    e.sendToBack(t.id);
    expect(e.page.layers[0].id).toBe(t.id);
    e.undo();
    expect(e.page.layers[1].id).toBe(t.id);
  });

  it('pages: add, switch, delete, undo', () => {
    const e = new Editor();
    const first = e.doc.activePageId;
    e.addPage();
    expect(e.doc.pages).toHaveLength(2);
    expect(e.doc.activePageId).not.toBe(first);
    e.undo();
    expect(e.doc.pages).toHaveLength(1);
    expect(e.doc.activePageId).toBe(first);
    e.removePage(first); // last page can't be removed
    expect(e.doc.pages).toHaveLength(1);
  });
});
