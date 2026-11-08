import type { Layer, LayerPatch, Page, StudioDocument } from './types';
import {
  activePage, cloneLayer, createDocument, createPage, findLayer, isTextual, relayoutText,
} from './document';
import { BatchCommand, type Command, History } from './history';
import { PixelEditCommand, createRasterLayer, makeCanvas, maskForBitmap } from './raster';
import { PixelSelection, type SelSnapshot } from './selection';
import { alignMoves, distributeMoves, selectionBounds, type AlignMode, type Move } from './align';

const TEXT_KEYS = new Set([
  'text', 'fontFamily', 'fontSize', 'fontWeight', 'italic', 'lineHeight', 'autoWidth', 'width',
]);

/** Apply a patch in place and keep derived text geometry consistent. */
export function applyPatch(layer: Layer, patch: LayerPatch): void {
  Object.assign(layer, patch);
  if (isTextual(layer) && Object.keys(patch).some((k) => TEXT_KEYS.has(k))) {
    relayoutText(layer);
  }
}

class SelectionCommand implements Command {
  constructor(public label: string, private sel: PixelSelection, private before: SelSnapshot, private after: SelSnapshot) {}
  do() {
    this.sel.restore(this.after);
  }
  undo() {
    this.sel.restore(this.before);
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

/** Make `layer` equal `snap`, including dropping optional properties (mask, fx) the snapshot lacks. */
function restoreLayer(layer: Layer, snap: Layer): void {
  const target = layer as unknown as Record<string, unknown>;
  for (const k of Object.keys(target)) if (!(k in snap)) delete target[k];
  Object.assign(layer, snap);
}

class SetLayerCommand implements Command {
  constructor(
    public label: string,
    private layer: Layer,
    private before: Layer,
    private after: Layer,
    private mergeKey?: string,
  ) {}
  do() {
    restoreLayer(this.layer, this.after);
  }
  undo() {
    restoreLayer(this.layer, this.before);
  }
  merge(next: Command): boolean {
    if (!(next instanceof SetLayerCommand) || !this.mergeKey) return false;
    if (next.layer !== this.layer || next.mergeKey !== this.mergeKey) return false;
    this.after = next.after;
    return true;
  }
}

export class AddLayerCommand implements Command {
  constructor(public label: string, private page: Page, private layer: Layer, private index: number) {}
  do() {
    // idempotent: a live-created layer is already in the page when it is recorded
    if (this.page.layers.indexOf(this.layer) < 0) this.page.layers.splice(this.index, 0, this.layer);
  }
  undo() {
    const i = this.page.layers.indexOf(this.layer);
    if (i >= 0) this.page.layers.splice(i, 1);
  }
}

class RemoveLayersCommand implements Command {
  private entries: { layer: Layer; index: number }[];
  constructor(public label: string, private page: Page, layers: Layer[]) {
    this.entries = layers
      .map((layer) => ({ layer, index: page.layers.indexOf(layer) }))
      .filter((e) => e.index >= 0)
      .sort((a, b) => a.index - b.index);
  }
  do() {
    for (const e of this.entries) {
      const i = this.page.layers.indexOf(e.layer);
      if (i >= 0) this.page.layers.splice(i, 1);
    }
  }
  undo() {
    for (const e of this.entries) this.page.layers.splice(e.index, 0, e.layer);
  }
  get count() {
    return this.entries.length;
  }
}

class ReorderCommand implements Command {
  constructor(public label: string, private page: Page, private layer: Layer, private from: number, private to: number) {}
  do() {
    this.move(this.from, this.to);
  }
  undo() {
    this.move(this.to, this.from);
  }
  private move(a: number, b: number) {
    const [l] = this.page.layers.splice(a, 1);
    this.page.layers.splice(b, 0, l);
  }
}

class PageSizeCommand implements Command {
  constructor(
    public label: string,
    private page: Page,
    private before: { width: number; height: number },
    private after: { width: number; height: number },
  ) {}
  do() {
    Object.assign(this.page, this.after);
  }
  undo() {
    Object.assign(this.page, this.before);
  }
}

class CropCommand implements Command {
  private before: { width: number; height: number };
  constructor(public label: string, private page: Page, private rect: { x: number; y: number; width: number; height: number }) {
    this.before = { width: page.width, height: page.height };
  }
  do() {
    this.page.width = Math.round(this.rect.width);
    this.page.height = Math.round(this.rect.height);
    for (const l of this.page.layers) {
      l.x -= this.rect.x;
      l.y -= this.rect.y;
    }
  }
  undo() {
    this.page.width = this.before.width;
    this.page.height = this.before.height;
    for (const l of this.page.layers) {
      l.x += this.rect.x;
      l.y += this.rect.y;
    }
  }
}

class AddPageCommand implements Command {
  constructor(public label: string, private doc: StudioDocument, private page: Page, private prevActive: string) {}
  do() {
    this.doc.pages.push(this.page);
    this.doc.activePageId = this.page.id;
  }
  undo() {
    this.doc.pages = this.doc.pages.filter((p) => p !== this.page);
    this.doc.activePageId = this.doc.pages.some((p) => p.id === this.prevActive)
      ? this.prevActive
      : this.doc.pages[0].id;
  }
}

class RemovePageCommand implements Command {
  private index: number;
  constructor(public label: string, private doc: StudioDocument, private page: Page) {
    this.index = doc.pages.indexOf(page);
  }
  do() {
    this.doc.pages = this.doc.pages.filter((p) => p !== this.page);
    const idx = Math.min(this.index, this.doc.pages.length - 1);
    this.doc.activePageId = this.doc.pages[idx].id;
  }
  undo() {
    this.doc.pages.splice(this.index, 0, this.page);
    this.doc.activePageId = this.page.id;
  }
}

// ── Editor store ────────────────────────────────────────────────────────────

export type ChangeKind = 'doc' | 'selection' | 'history' | 'live' | 'pixels';

export class Editor {
  doc: StudioDocument = createDocument();
  history = new History();
  selection: string[] = [];
  /** pixel selection (marquee / lasso / wand) - independent of the selected layers */
  readonly pixelSel = new PixelSelection();
  /** brush tools paint the selected layer's mask instead of its pixels */
  maskEdit = false;
  /** id of the text layer currently being edited in place, if any */
  editingId: string | null = null;
  private listeners = new Set<(kind: ChangeKind) => void>();
  private gesture: Map<string, Layer> | null = null;

  constructor() {
    this.history.subscribe(() => this.emit('history'));
  }

  get page(): Page {
    return activePage(this.doc);
  }

  get selected(): Layer[] {
    const p = this.page;
    return this.selection.map((id) => findLayer(p, id)).filter((l): l is Layer => !!l);
  }

  get primary(): Layer | undefined {
    return this.selected[this.selected.length - 1];
  }

  subscribe(fn: (kind: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind) {
    this.listeners.forEach((f) => f(kind));
  }

  // selection
  select(ids: string[]): void {
    const valid = ids.filter((id) => findLayer(this.page, id));
    if (valid.length === this.selection.length && valid.every((v, i) => v === this.selection[i])) return;
    this.selection = valid;
    if (this.maskEdit && !(valid.length === 1 && findLayer(this.page, valid[0])?.mask)) this.maskEdit = false;
    this.emit('selection');
  }

  // ── layer masks ───────────────────────────────────────────────────────────
  setMaskEdit(on: boolean): void {
    const ok = on && this.selection.length === 1 && !!this.primary?.mask;
    if (ok === this.maskEdit) return;
    this.maskEdit = ok;
    this.emit('selection');
  }

  addMask(id: string, fill: 'reveal' | 'hide' | 'selection'): boolean {
    const l = findLayer(this.page, id);
    if (!l || l.mask) return false;
    const w = Math.max(1, Math.ceil(l.width)), h = Math.max(1, Math.ceil(l.height));
    const mask = makeCanvas(w, h);
    const ctx = mask.getContext('2d')!;
    if (fill === 'reveal') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    } else if (fill === 'selection') {
      const m = maskForBitmap(l, w, h, this.pixelSel.mask);
      if (!m) return false;
      ctx.drawImage(m, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
    }
    this.patchLayer(id, { mask }, 'Add layer mask');
    this.maskEdit = this.selection.length === 1 && this.selection[0] === id;
    this.emit('selection');
    return true;
  }

  removeMask(id: string): void {
    this.patchLayer(id, { mask: null }, 'Delete layer mask');
    this.maskEdit = false;
    this.emit('selection');
  }

  invertMask(id: string): void {
    const l = findLayer(this.page, id);
    const m = l?.mask;
    if (!l || !m) return;
    const ctx = m.getContext('2d')!;
    const before = ctx.getImageData(0, 0, m.width, m.height);
    const inv = makeCanvas(m.width, m.height);
    const ictx = inv.getContext('2d')!;
    ictx.fillStyle = '#fff';
    ictx.fillRect(0, 0, m.width, m.height);
    ictx.globalCompositeOperation = 'destination-out';
    ictx.drawImage(m, 0, 0);
    ctx.clearRect(0, 0, m.width, m.height);
    ctx.drawImage(inv, 0, 0);
    const after = ctx.getImageData(0, 0, m.width, m.height);
    this.recordApplied(new PixelEditCommand('Invert mask', m, { x: 0, y: 0, width: m.width, height: m.height }, before, after));
  }

  private pruneSelection() {
    this.selection = this.selection.filter((id) => findLayer(this.page, id));
  }

  // generic command runner
  private run(cmd: Command) {
    const { width, height } = this.page;
    this.history.execute(cmd);
    this.afterChange(width, height);
  }

  private afterChange(w: number, h: number) {
    this.pruneSelection();
    // a pixel selection belongs to one artboard size
    if (this.page.width !== w || this.page.height !== h) this.pixelSel.clear();
    this.emit('doc');
  }

  /** Record an edit that has already been applied (e.g. a finished brush stroke). */
  recordApplied(cmd: Command): void {
    this.history.breakMerge();
    this.history.record(cmd);
    this.history.breakMerge();
    this.emit('doc');
  }

  /** Change the pixel selection as one undo step. */
  editSelection(label: string, fn: (s: PixelSelection) => void): void {
    const before = this.pixelSel.snapshot();
    const v = this.pixelSel.version;
    fn(this.pixelSel);
    if (this.pixelSel.version === v) return;
    this.history.breakMerge();
    this.history.record(new SelectionCommand(label, this.pixelSel, before, this.pixelSel.snapshot()));
    this.history.breakMerge();
    this.emit('pixels');
  }

  // layers
  addLayer(layer: Layer, opts: { select?: boolean; label?: string } = {}): void {
    this.run(new AddLayerCommand(opts.label ?? `Add ${layer.name}`, this.page, layer, this.page.layers.length));
    if (opts.select !== false) this.select([layer.id]);
  }

  /**
   * Add an image. On an empty page the first image defines the page size and
   * fills it (the screenshot becomes the background); later images are
   * centred and scaled to fit.
   */
  addImage(layer: Layer, name?: string): void {
    const page = this.page;
    const cmds: Command[] = [];
    if (name) layer.name = name;
    if (page.width === 0 || page.height === 0) {
      cmds.push(new PageSizeCommand('Page size', page, { width: page.width, height: page.height }, {
        width: layer.width,
        height: layer.height,
      }));
      layer.x = 0;
      layer.y = 0;
      // like Photoshop's Background: the image that defines the artboard starts locked,
      // so dragging on it draws a selection marquee instead of nudging the screenshot
      layer.locked = true;
    } else {
      // placed at its real size; only shrunk (to fit the canvas exactly) if it would not fit at all
      const scale = Math.min(1, page.width / layer.width, page.height / layer.height);
      layer.width *= scale;
      layer.height *= scale;
      layer.x = (page.width - layer.width) / 2;
      layer.y = (page.height - layer.height) / 2;
    }
    cmds.push(new AddLayerCommand(`Add ${layer.name}`, page, layer, page.layers.length));
    this.run(new BatchCommand(`Add ${layer.name}`, cmds));
    this.select([layer.id]);
  }

  /**
   * Start a blank canvas ("New" in Photoshop). An empty page is reused; otherwise a new page is added.
   * `background` null = transparent, otherwise a solid colour layer. One undo step.
   */
  createCanvas(opts: { width: number; height: number; background: string | null; name?: string }): void {
    const width = Math.round(opts.width), height = Math.round(opts.height);
    const cmds: Command[] = [];
    let page = this.page;
    if (page.width > 0 || page.layers.length) {
      page = createPage(opts.name ?? `Page ${this.doc.pages.length + 1}`);
      cmds.push(new AddPageCommand('New page', this.doc, page, this.doc.activePageId));
    } else if (opts.name) page.name = opts.name;
    cmds.push(new PageSizeCommand('Canvas size', page, { width: page.width, height: page.height }, { width, height }));
    if (opts.background) {
      const bg = createRasterLayer(width, height, 'Background');
      const ctx = (bg.source as HTMLCanvasElement).getContext('2d')!;
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, width, height);
      bg.locked = true;
      cmds.push(new AddLayerCommand('Background', page, bg, 0));
    }
    this.run(new BatchCommand('New canvas', cmds));
    this.selection = [];
    this.pixelSel.clear();
    this.emit('selection');
  }

  /** Insert a layer just above the selected one (or on top) as one undo step. */
  addLayerAbove(layer: Layer, label: string): void {
    const sel = this.primary;
    const idx = sel ? this.page.layers.indexOf(sel) + 1 : this.page.layers.length;
    this.run(new AddLayerCommand(label, this.page, layer, idx));
    this.select([layer.id]);
  }

  /** Add a layer together with other already-built commands as one undo step. */
  addLayerBatch(layer: Layer, extra: Command[], label: string): void {
    this.run(new BatchCommand(label, [new AddLayerCommand(label, this.page, layer, this.page.layers.length), ...extra]));
    this.select([layer.id]);
  }

  removeLayers(ids: string[]): void {
    const layers = ids.map((id) => findLayer(this.page, id)).filter((l): l is Layer => !!l && !l.locked);
    if (!layers.length) return;
    const cmd = new RemoveLayersCommand(layers.length > 1 ? `Delete ${layers.length} layers` : `Delete ${layers[0].name}`, this.page, layers);
    this.run(cmd);
  }

  duplicateLayers(ids: string[]): void {
    const src = ids.map((id) => findLayer(this.page, id)).filter((l): l is Layer => !!l);
    if (!src.length) return;
    const copies = src.map((l) => cloneLayer(l));
    const cmds = copies.map((c, i) => new AddLayerCommand(`Duplicate ${src[i].name}`, this.page, c, this.page.layers.length + i));
    this.run(new BatchCommand(`Duplicate ${src.length > 1 ? `${src.length} layers` : src[0].name}`, cmds));
    this.select(copies.map((c) => c.id));
  }

  /** One-shot property change (inspector fields, buttons). Merges while scrubbing. */
  patchLayer(id: string, patch: LayerPatch, label = 'Edit layer', mergeKey?: string): void {
    const layer = findLayer(this.page, id);
    if (!layer) return;
    const before = { ...layer } as Layer;
    applyPatch(layer, patch);
    const after = { ...layer } as Layer;
    if (JSON.stringify(stripSource(before)) === JSON.stringify(stripSource(after))) return;
    this.history.record(new SetLayerCommand(label, layer, before, after, mergeKey));
    this.emit('doc');
  }

  reorder(id: string, toIndex: number): void {
    const p = this.page;
    const layer = findLayer(p, id);
    if (!layer) return;
    const from = p.layers.indexOf(layer);
    const to = Math.max(0, Math.min(p.layers.length - 1, toIndex));
    if (from === to) return;
    this.run(new ReorderCommand('Reorder layer', p, layer, from, to));
  }

  bringForward(id: string) {
    this.reorder(id, this.page.layers.findIndex((l) => l.id === id) + 1);
  }
  sendBackward(id: string) {
    this.reorder(id, this.page.layers.findIndex((l) => l.id === id) - 1);
  }
  bringToFront(id: string) {
    this.reorder(id, this.page.layers.length - 1);
  }
  sendToBack(id: string) {
    this.reorder(id, 0);
  }

  // live gestures (drag move/resize/rotate): mutate freely, record once at the end
  beginGesture(ids: string[]): void {
    this.gesture = new Map();
    for (const id of ids) {
      const l = findLayer(this.page, id);
      if (l) this.gesture.set(id, { ...l } as Layer);
    }
  }

  updateLive(id: string, patch: LayerPatch): void {
    const l = findLayer(this.page, id);
    if (!l) return;
    applyPatch(l, patch);
    this.emit('live');
  }

  endGesture(label: string): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    const cmds: Command[] = [];
    for (const [id, before] of g) {
      const l = findLayer(this.page, id);
      if (!l) continue;
      const after = { ...l } as Layer;
      if (JSON.stringify(stripSource(before)) !== JSON.stringify(stripSource(after))) {
        cmds.push(new SetLayerCommand(label, l, before, after));
      }
    }
    if (cmds.length) {
      this.history.breakMerge();
      this.history.record(cmds.length === 1 ? cmds[0] : new BatchCommand(label, cmds));
      this.history.breakMerge();
    }
    this.emit('doc');
  }

  cancelGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    for (const [id, before] of g) {
      const l = findLayer(this.page, id);
      if (l) Object.assign(l, before);
    }
    this.emit('doc');
  }

  // live creation (draw tools): the layer exists on the page immediately but is
  // only recorded in history once the gesture finishes.
  private liveLayer: Layer | null = null;

  createLive(layer: Layer): void {
    this.liveLayer = layer;
    this.page.layers.push(layer);
    this.emit('live');
  }

  /** Finish a live creation: record it as one undo step. Returns the layer, or null if discarded. */
  commitLive(label: string): Layer | null {
    const l = this.liveLayer;
    this.liveLayer = null;
    if (!l) return null;
    this.history.breakMerge();
    this.history.record(new AddLayerCommand(label, this.page, l, this.page.layers.indexOf(l)));
    this.select([l.id]);
    this.emit('doc');
    return l;
  }

  discardLive(): void {
    const l = this.liveLayer;
    this.liveLayer = null;
    if (!l) return;
    const i = this.page.layers.indexOf(l);
    if (i >= 0) this.page.layers.splice(i, 1);
    this.emit('doc');
  }

  get live(): Layer | null {
    return this.liveLayer;
  }

  /** Apply several layer patches as one undo step. */
  patchLayers(items: { id: string; patch: LayerPatch }[], label: string): void {
    const cmds: Command[] = [];
    for (const { id, patch } of items) {
      const layer = findLayer(this.page, id);
      if (!layer) continue;
      const before = { ...layer } as Layer;
      applyPatch(layer, patch);
      const after = { ...layer } as Layer;
      if (JSON.stringify(stripSource(before)) !== JSON.stringify(stripSource(after))) {
        cmds.push(new SetLayerCommand(label, layer, before, after));
      }
    }
    if (!cmds.length) return;
    this.history.breakMerge();
    this.history.record(cmds.length === 1 ? cmds[0] : new BatchCommand(label, cmds));
    this.history.breakMerge();
    this.emit('doc');
  }

  private applyMoves(moves: Move[], label: string) {
    const items = moves
      .filter((m) => m.dx || m.dy)
      .map((m) => {
        const l = findLayer(this.page, m.id)!;
        return { id: m.id, patch: { x: l.x + m.dx, y: l.y + m.dy } };
      });
    this.patchLayers(items, label);
  }

  /** One layer aligns to the page; several align to their shared bounds. */
  alignSelection(mode: AlignMode): void {
    const sel = this.selected.filter((l) => !l.locked);
    if (!sel.length) return;
    const ref =
      sel.length === 1
        ? { x: 0, y: 0, width: this.page.width, height: this.page.height }
        : selectionBounds(sel)!;
    this.applyMoves(alignMoves(sel, mode, ref), 'Align');
  }

  distributeSelection(axis: 'x' | 'y'): void {
    const sel = this.selected.filter((l) => !l.locked);
    this.applyMoves(distributeMoves(sel, axis), 'Distribute');
  }

  /** Non-destructive crop: shrinks the artboard and shifts layers; undo restores everything. */
  cropTo(rect: { x: number; y: number; width: number; height: number }): void {
    const r = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
    if (r.x === 0 && r.y === 0 && r.width === this.page.width && r.height === this.page.height) return;
    this.run(new CropCommand('Crop canvas', this.page, r));
  }

  setPageSize(width: number, height: number): void {
    const p = this.page;
    this.run(new PageSizeCommand('Canvas size', p, { width: p.width, height: p.height }, { width, height }));
  }

  // pages
  addPage(): void {
    const p = createPage(`Page ${this.doc.pages.length + 1}`);
    this.run(new AddPageCommand('Add page', this.doc, p, this.doc.activePageId));
    this.selection = [];
    this.emit('selection');
  }

  removePage(id: string): void {
    if (this.doc.pages.length <= 1) return;
    const p = this.doc.pages.find((x) => x.id === id);
    if (!p) return;
    this.run(new RemovePageCommand(`Delete ${p.name}`, this.doc, p));
    this.selection = [];
    this.emit('selection');
  }

  switchPage(id: string): void {
    if (this.doc.activePageId === id || !this.doc.pages.some((p) => p.id === id)) return;
    this.doc.activePageId = id;
    this.pixelSel.clear();
    this.selection = [];
    this.editingId = null;
    this.emit('doc');
    this.emit('selection');
  }

  undo(): void {
    const { width, height } = this.page;
    if (this.history.undo()) this.afterChange(width, height);
  }

  redo(): void {
    const { width, height } = this.page;
    if (this.history.redo()) this.afterChange(width, height);
  }
}

/** Image sources aren't JSON-serialisable; compare everything else. */
function stripSource(l: Layer): unknown {
  const { source: _s, ...rest } = l as Layer & { source?: unknown };
  return rest;
}
