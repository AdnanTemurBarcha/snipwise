// Raster tools: brush, eraser, bucket, gradient, eyedropper, clone stamp and the
// selection tools (marquee, ellipse, lasso, magic wand). The Stage owns the
// canvas and pointer capture and hands pointer events to this controller.

import type { Editor } from '../engine/editor';
import type { BaseLayer, ImageLayer, Layer } from '../engine/types';
import type { Point, Rect } from '../engine/geometry';
import { drawLayer, flattenPage } from '../engine/render';
import { hitLayer } from '../engine/hit';
import {
  PixelOp, StrokeWalker, createRasterLayer, ensureCanvas, fillGradient, fillOrClear, floodMask, growMask, makeCanvas,
  maskForBitmap, maskToCanvas, pageToPixel, pageToPixelFor, paintDab, parseColor, pixelScaleFor, pixelToPageFor, softDab, toHex, type RGB,
} from '../engine/raster';
import { FILTERS, applyFilter } from '../engine/filters';
import { shapePath, type SelMode, type SelShape } from '../engine/selection';
import type { Viewport } from '../engine/viewport';
import type { ToolId, ToolStyle } from './stage';

export const SELECT_TOOLS: ToolId[] = ['selrect', 'selellipse', 'lasso', 'wand'];
export const PAINT_TOOLS: ToolId[] = ['brush', 'eraser', 'bucket', 'gradient', 'eyedropper', 'clone', ...SELECT_TOOLS];
const BRUSHLIKE: ToolId[] = ['brush', 'eraser', 'clone'];

export interface PaintHooks {
  style(): ToolStyle;
  setColor(css: string): void;
  status(msg: string): void;
  request(): void;
}

/** What a paint operation draws on: a layer's pixels, or its mask. */
interface Target {
  layer: Layer;
  canvas: HTMLCanvasElement;
  /** bitmap size; it stretches to fill the layer box */
  pw: number;
  ph: number;
  created: boolean;
  isMask: boolean;
}

const imageTarget = (layer: ImageLayer, created: boolean): Target => ({
  layer, canvas: ensureCanvas(layer), pw: layer.naturalWidth, ph: layer.naturalHeight, created, isMask: false,
});

type Active =
  | { kind: 'stroke'; tool: 'brush' | 'eraser' | 'clone'; op: PixelOp; t: Target; walker: StrokeWalker; color: RGB; scale: number; moved: boolean }
  | { kind: 'gradient'; op: PixelOp; t: Target; a: Point; b: Point }
  | { kind: 'sample' }
  | { kind: 'sel'; tool: ToolId; start: Point; now: Point; mode: SelMode; free: boolean; points: Point[] };

export class PaintController {
  private active: Active | null = null;
  private hoverAt: Point | null = null;
  /** clone source in the pixel space of `cloneLayer`, and the (aligned) offset once a stroke started */
  private cloneSrc: { layerId: string; px: Point } | null = null;
  private cloneOff: Point | null = null;
  private lastEnd: { layerId: string; px: Point } | null = null;
  private sample: HTMLCanvasElement | null = null;

  constructor(private editor: Editor, private hooks: PaintHooks) {}

  get busy(): boolean {
    return this.active !== null;
  }

  // ── targets ───────────────────────────────────────────────────────────────
  private px(t: Target, p: Point): Point {
    return pageToPixelFor(t.layer, t.pw, t.ph, p);
  }

  private target(tool: ToolId, p: Point, zoom: number): Target | null {
    const ed = this.editor;
    const sel = ed.selected;
    if (ed.maskEdit && sel.length === 1 && sel[0].mask) {
      if (tool === 'clone') {
        this.hooks.status('The clone stamp does not work on masks');
        return null;
      }
      const m = sel[0].mask;
      return { layer: sel[0], canvas: m, pw: m.width, ph: m.height, created: false, isMask: true };
    }
    if (sel.length === 1 && sel[0].type === 'image') {
      if (sel[0].locked) {
        this.hooks.status('That layer is locked — unlock it in the Layers panel, or deselect it to paint on a new layer');
        return null;
      }
      return imageTarget(sel[0], false);
    }
    if (tool === 'brush' || tool === 'gradient' || tool === 'bucket') {
      const page = ed.page;
      if (!page.width) {
        this.hooks.status('Add an image first');
        return null;
      }
      return imageTarget(createRasterLayer(page.width, page.height, 'Paint'), true);
    }
    const layers = ed.page.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (l.type === 'image' && l.visible && !l.locked && hitLayer(l, p, zoom)) {
        ed.select([l.id]);
        return imageTarget(l, false);
      }
    }
    this.hooks.status(tool === 'clone' ? 'Select an unlocked image layer to clone within' : 'Select an unlocked image layer to erase on');
    return null;
  }

  private makeOp(t: Target, kind: 'paint' | 'erase'): PixelOp {
    if (t.created) this.editor.createLive(t.layer);
    const mask = maskForBitmap(t.layer, t.pw, t.ph, this.editor.pixelSel.mask);
    return new PixelOp(t.layer, t.canvas, mask, kind, this.hooks.style().brushOpacity);
  }

  private finish(op: PixelOp, created: boolean, label: string) {
    const cmd = op.commit(label);
    if (created) {
      if (cmd) this.editor.commitLive(label);
      else this.editor.discardLive();
    } else if (cmd) {
      this.editor.recordApplied(cmd);
    }
    this.hooks.request();
  }

  // ── pointer ───────────────────────────────────────────────────────────────
  /** Returns true when a drag has started and the stage should route moves here. */
  down(tool: ToolId, p: Point, e: PointerEvent, zoom: number): boolean {
    const style = this.hooks.style();
    if (tool === 'eyedropper' || (e.altKey && tool !== 'clone' && !SELECT_TOOLS.includes(tool))) {
      this.sample = flattenPage(this.editor.page, 1, undefined, true);
      this.pick(p);
      this.active = { kind: 'sample' };
      return true;
    }
    if (SELECT_TOOLS.includes(tool)) return this.selDown(tool, p, e);

    if (tool === 'clone' && e.altKey) {
      const t = this.target(tool, p, zoom);
      if (!t) return false;
      this.cloneSrc = { layerId: t.layer.id, px: this.px(t, p) };
      this.cloneOff = null;
      this.hooks.status('Clone source set — paint to copy from it');
      this.hooks.request();
      return false;
    }

    if (tool === 'clone' && !this.cloneSrc) {
      this.hooks.status('Alt-click to choose the area to clone from');
      return false;
    }

    const t = this.target(tool, p, zoom);
    if (!t) return false;
    if (tool === 'clone' && this.cloneSrc!.layerId !== t.layer.id) {
      this.hooks.status('The clone source is on a different layer — Alt-click to set it again');
      return false;
    }

    if (tool === 'bucket') {
      this.bucket(t, p, style);
      return false;
    }

    if (tool === 'gradient') {
      const op = this.makeOp(t, 'paint');
      const a = this.px(t, p);
      this.active = { kind: 'gradient', op, t, a, b: a };
      return true;
    }

    // brush / eraser / clone stroke
    const op = this.makeOp(t, tool === 'eraser' ? 'erase' : 'paint');
    // masks are alpha only: brush reveals, eraser hides
    const color = tool === 'eraser' || t.isMask ? { r: t.isMask ? 255 : 0, g: t.isMask ? 255 : 0, b: t.isMask ? 255 : 0 } : parseColor(style.color);
    const walker = new StrokeWalker((s) => Math.max(0.75, s * 0.15));
    const a: Extract<Active, { kind: 'stroke' }> = {
      kind: 'stroke', tool: tool as 'brush' | 'eraser' | 'clone', op, t, walker, color, scale: pixelScaleFor(t.layer, t.pw, t.ph), moved: false,
    };
    this.active = a;
    const px = this.px(t, p);
    if (tool === 'clone' && !this.cloneOff) this.cloneOff = { x: this.cloneSrc!.px.x - px.x, y: this.cloneSrc!.px.y - px.y };
    if (e.shiftKey && this.lastEnd && this.lastEnd.layerId === t.layer.id && tool !== 'clone') {
      // shift-click: straight line from the end of the last stroke
      this.dab(a, this.lastEnd.px, e);
    }
    this.dab(a, px, e);
    a.op.render();
    this.hooks.request();
    return true;
  }

  private dab(a: Extract<Active, { kind: 'stroke' }>, px: Point, e: PointerEvent) {
    const style = this.hooks.style();
    const pressure = e.pointerType === 'pen' ? 0.2 + 0.8 * e.pressure : 1;
    const size = Math.max(1, (style.brushSize * pressure) / a.scale);
    a.walker.to(px, size, (x, y, s) => {
      if (a.tool === 'clone') this.cloneDab(a, x, y, s, style.brushHardness);
      else paintDab(a.op.sctx, x, y, s, style.brushHardness, a.color);
      a.op.mark({ x: x - s / 2, y: y - s / 2, width: s, height: s });
    });
    this.lastEnd = { layerId: a.t.layer.id, px };
  }

  private cloneDab(a: Extract<Active, { kind: 'stroke' }>, x: number, y: number, size: number, hardness: number) {
    const off = this.cloneOff!;
    const d = Math.max(1, Math.ceil(size));
    const tmp = makeCanvas(d, d);
    const t = tmp.getContext('2d')!;
    t.drawImage(a.op.snap, x + off.x - d / 2, y + off.y - d / 2, d, d, 0, 0, d, d);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(softDab(d, hardness), 0, 0, d, d);
    a.op.sctx.drawImage(tmp, x - d / 2, y - d / 2);
  }

  move(p: Point, e: PointerEvent, zoom: number, mapEvent: (ev: PointerEvent) => Point): void {
    this.hoverAt = p;
    this.liveMods = { shiftKey: e.shiftKey, altKey: e.altKey };
    const a = this.active;
    if (!a) return;
    if (a.kind === 'sample') {
      this.pick(p);
    } else if (a.kind === 'stroke') {
      a.moved = true;
      // coalesced events give smooth strokes even when the main thread is busy
      const events = e.getCoalescedEvents?.() ?? [];
      if (events.length > 1) {
        for (const ev of events) this.dab(a, this.px(a.t, mapEvent(ev)), ev);
      } else {
        this.dab(a, this.px(a.t, p), e);
      }
      a.op.render();
    } else if (a.kind === 'gradient') {
      let b = this.px(a.t, p);
      if (e.shiftKey) b = snap15(a.a, b);
      a.b = b;
      const style = this.hooks.style();
      a.op.clearStroke();
      fillGradient(a.op.sctx, a.op.canvas.width, a.op.canvas.height, a.a, b, {
        type: style.gradientType,
        from: a.t.isMask ? { r: 255, g: 255, b: 255 } : parseColor(style.color),
        to: a.t.isMask || style.gradientFade ? null : parseColor(style.color2),
      });
      a.op.markAll();
      a.op.render();
    } else if (a.kind === 'sel') {
      a.now = p;
      if (a.tool === 'lasso') {
        const last = a.points[a.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * zoom >= 2) a.points.push(p);
      }
    }
    this.hooks.request();
  }

  up(e: PointerEvent, cancelled: boolean, zoom: number): void {
    const a = this.active;
    this.active = null;
    if (!a) return;
    if (a.kind === 'sample') {
      this.sample = null;
    } else if (a.kind === 'stroke') {
      if (cancelled) {
        a.op.cancel();
        if (a.t.created) this.editor.discardLive();
      } else {
        const label = a.tool === 'brush' ? 'Brush stroke' : a.tool === 'eraser' ? 'Erase' : 'Clone stamp';
        this.finish(a.op, a.t.created, label);
      }
    } else if (a.kind === 'gradient') {
      const len = Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) * pixelScaleFor(a.t.layer, a.t.pw, a.t.ph) * zoom;
      if (cancelled || len < 3) {
        a.op.cancel();
        if (a.t.created) this.editor.discardLive();
      } else {
        this.finish(a.op, a.t.created, 'Gradient');
      }
    } else if (a.kind === 'sel') {
      if (!cancelled) this.selUp(a, e, zoom);
    }
    this.hooks.request();
  }

  hover(p: Point | null): void {
    this.hoverAt = p;
    this.hooks.request();
  }

  // ── eyedropper ────────────────────────────────────────────────────────────
  private pick(p: Point) {
    const c = this.sample;
    if (!c) return;
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
    const d = c.getContext('2d')!.getImageData(x, y, 1, 1).data;
    if (d[3] === 0) return;
    this.hooks.setColor(toHex({ r: d[0], g: d[1], b: d[2] }));
  }

  // ── bucket fill ───────────────────────────────────────────────────────────
  private bucket(t: Target, p: Point, style: ToolStyle) {
    const w = t.pw, h = t.ph;
    // a fresh layer has nothing to look at, so it samples what you can see
    const src = t.created ? flattenPage(this.editor.page, 1) : t.canvas;
    const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
    const seed = this.px(t, p);
    let mask = floodMask(data, w, h, seed.x, seed.y, style.tolerance, style.contiguous);
    if (!mask.some((v) => v)) {
      this.hooks.status('Click inside the canvas to fill');
      return;
    }
    mask = growMask(mask, w, h);
    const op = this.makeOp(t, 'paint');
    op.sctx.drawImage(maskToCanvas(mask, w, h, t.isMask ? { r: 255, g: 255, b: 255 } : parseColor(style.color)), 0, 0);
    op.markAll();
    this.finish(op, t.created, 'Bucket fill');
  }

  // ── selection tools ───────────────────────────────────────────────────────
  private selDown(tool: ToolId, p: Point, e: PointerEvent): boolean {
    const style = this.hooks.style();
    const mode: SelMode = e.shiftKey ? 'add' : e.altKey ? 'subtract' : style.selMode;
    const page = this.editor.page;
    if (!page.width) {
      this.hooks.status('Add an image first');
      return false;
    }
    if (tool === 'wand') {
      const c = flattenPage(page, 1);
      const w = c.width, h = c.height;
      const data = c.getContext('2d')!.getImageData(0, 0, w, h).data;
      const mask = floodMask(data, w, h, p.x, p.y, style.tolerance, style.contiguous);
      if (!mask.some((v) => v)) return false;
      const canvas = maskToCanvas(mask, w, h);
      this.editor.editSelection('Magic wand', (s) => s.applyMask(canvas, mode));
      return false;
    }
    this.active = { kind: 'sel', tool, start: p, now: p, mode, free: !e.shiftKey && !e.altKey, points: [p] };
    return true;
  }

  private selRect(a: Extract<Active, { kind: 'sel' }>, e: { shiftKey: boolean; altKey: boolean }): Rect {
    let dx = a.now.x - a.start.x;
    let dy = a.now.y - a.start.y;
    if (a.free && e.shiftKey) {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
    }
    const fromCenter = a.free && e.altKey;
    const x0 = fromCenter ? a.start.x - dx : a.start.x;
    const y0 = fromCenter ? a.start.y - dy : a.start.y;
    const x1 = a.start.x + dx, y1 = a.start.y + dy;
    const page = this.editor.page;
    const left = Math.max(0, Math.min(x0, x1)), top = Math.max(0, Math.min(y0, y1));
    const right = Math.min(page.width, Math.max(x0, x1)), bottom = Math.min(page.height, Math.max(y0, y1));
    return { x: Math.round(left), y: Math.round(top), width: Math.max(0, Math.round(right) - Math.round(left)), height: Math.max(0, Math.round(bottom) - Math.round(top)) };
  }

  private liveMods: { shiftKey: boolean; altKey: boolean } = { shiftKey: false, altKey: false };

  private selUp(a: Extract<Active, { kind: 'sel' }>, e: PointerEvent, zoom: number) {
    const page = this.editor.page;
    let shape: SelShape | null = null;
    if (a.tool === 'lasso') {
      if (a.points.length >= 3) shape = { kind: 'poly', points: a.points.map((q) => ({ x: Math.min(page.width, Math.max(0, q.x)), y: Math.min(page.height, Math.max(0, q.y)) })) };
    } else {
      const r = this.selRect(a, e);
      if (r.width >= 1 && r.height >= 1 && Math.hypot(a.now.x - a.start.x, a.now.y - a.start.y) * zoom >= 3) {
        shape = { kind: a.tool === 'selellipse' ? 'ellipse' : 'rect', rect: r };
      }
    }
    if (!shape) {
      // a plain click drops the selection
      if (a.mode === 'replace' && this.editor.pixelSel.active) this.editor.editSelection('Deselect', (s) => s.clear());
      return;
    }
    const sh = shape;
    this.editor.editSelection('Select', (s) => s.applyShape(sh, a.mode, page.width, page.height));
  }

  // ── selection actions (used by the panel / shortcuts) ─────────────────────
  private editTarget(): ImageLayer | null {
    const sel = this.editor.selected;
    if (sel.length === 1 && sel[0].type === 'image') {
      if (sel[0].locked) {
        this.hooks.status('That layer is locked — unlock it in the Layers panel');
        return null;
      }
      return sel[0];
    }
    return null;
  }

  /** Fill the selection (or the whole layer) with the current colour. */
  fillSelection(): void {
    const ed = this.editor;
    const style = this.hooks.style();
    if (!ed.page.width) return;
    const mask = ed.pixelSel.mask;
    let layer = this.editTarget();
    if (!layer) {
      if (ed.selected.length === 1 && ed.selected[0].type === 'image') return; // locked: already reported
      layer = createRasterLayer(ed.page.width, ed.page.height, 'Fill');
      const cmd = fillOrClear(layer, mask, style.color, 'Fill');
      if (cmd) ed.addLayer(layer, { label: 'Fill selection' });
      return;
    }
    const cmd = fillOrClear(layer, mask, style.color, 'Fill selection');
    if (cmd) ed.recordApplied(cmd);
  }

  /** Delete the selected pixels (or the whole layer's pixels when nothing is selected). */
  clearSelection(): boolean {
    const layer = this.editTarget();
    if (!layer || !this.editor.pixelSel.active) return false;
    const cmd = fillOrClear(layer, this.editor.pixelSel.mask, null, 'Clear selection');
    if (cmd) this.editor.recordApplied(cmd);
    return true;
  }

  /** Run a destructive filter on the selected image layer (limited to the pixel selection, if any). */
  applyFilter(id: string, amount: number): boolean {
    const def = FILTERS.find((f) => f.id === id);
    const layer = this.editTarget();
    if (!def) return false;
    if (!layer) {
      if (!(this.editor.selected.length === 1 && this.editor.selected[0].type === 'image')) this.hooks.status('Select an image layer to filter');
      return false;
    }
    const canvas = ensureCanvas(layer);
    const cmd = applyFilter(canvas, def, amount, maskForBitmap(layer, canvas.width, canvas.height, this.editor.pixelSel.mask), def.label);
    this.editor.recordApplied(cmd);
    this.hooks.status(`${def.label} applied${this.editor.pixelSel.active ? ' to the selection' : ''} · undo with Ctrl+Z`);
    return true;
  }

  /** Copy (or cut) the selected pixels into a new layer. */
  selectionToLayer(cut: boolean): boolean {
    const ed = this.editor;
    const b = ed.pixelSel.bounds();
    const mask = ed.pixelSel.mask;
    if (!b || !mask) return false;
    const page = ed.page;
    const src = this.editTarget() ?? (ed.selected.length === 1 && ed.selected[0].type === 'image' ? null : undefined);
    if (src === null) return false;
    // what to copy from: the selected image layer alone, otherwise everything visible
    const full = makeCanvas(page.width, page.height);
    if (src) drawLayer(full.getContext('2d')!, src as Layer);
    else full.getContext('2d')!.drawImage(flattenPage(page, 1), 0, 0);
    const out = createRasterLayer(b.width, b.height, 'Selection', { x: b.x, y: b.y });
    const octx = ensureCanvas(out).getContext('2d')!;
    octx.drawImage(full, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(mask, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
    const extra = [];
    if (cut && src) {
      const cmd = fillOrClear(src as ImageLayer, mask, null, 'Cut');
      if (cmd) extra.push(cmd);
    }
    ed.addLayerBatch(out, extra, cut ? 'Cut to new layer' : 'Copy to new layer');
    return true;
  }

  // ── overlay ───────────────────────────────────────────────────────────────
  drawSelection(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const sel = this.editor.pixelSel;
    if (!sel.active) return;
    const o = vp.toScreen({ x: 0, y: 0 });
    ctx.save();
    if (sel.shape) {
      ctx.translate(o.x, o.y);
      ctx.scale(vp.zoom, vp.zoom);
      const path = shapePath(sel.shape);
      ctx.lineWidth = 1 / vp.zoom;
      ctx.strokeStyle = '#fff';
      ctx.stroke(path);
      ctx.strokeStyle = '#000';
      ctx.setLineDash([4 / vp.zoom, 4 / vp.zoom]);
      ctx.lineDashOffset = -((performance.now() / 70) % 8) / vp.zoom;
      ctx.stroke(path);
    } else {
      const edge = sel.outline();
      if (edge) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(edge, o.x, o.y, edge.width * vp.zoom, edge.height * vp.zoom);
      }
    }
    ctx.restore();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport, tool: ToolId): void {
    const a = this.active;
    if (a?.kind === 'sel') this.drawLiveSelection(ctx, vp, a);
    if (a?.kind === 'gradient') {
      const p0 = vp.toScreen(pixelToPageFor(a.t.layer, a.t.pw, a.t.ph, a.a));
      const p1 = vp.toScreen(pixelToPageFor(a.t.layer, a.t.pw, a.t.ph, a.b));
      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.restore();
    }
    if (BRUSHLIKE.includes(tool) && this.hoverAt) {
      const style = this.hooks.style();
      const c = vp.toScreen(this.hoverAt);
      const r = Math.max(1.5, (style.brushSize / 2) * vp.zoom);
      ctx.save();
      for (const [w, col] of [[3, 'rgba(0,0,0,0.55)'], [1.25, '#fff']] as const) {
        ctx.lineWidth = w;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.fillRect(c.x - 0.5, c.y - 0.5, 1.5, 1.5);
      // clone source
      if (tool === 'clone' && this.cloneSrc) {
        const layer = this.editor.page.layers.find((l) => l.id === this.cloneSrc!.layerId);
        if (layer && layer.type === 'image') {
          const pxPoint = this.cloneOff && a?.kind === 'stroke'
            ? { x: pageToPixel(layer, this.hoverAt).x + this.cloneOff.x, y: pageToPixel(layer, this.hoverAt).y + this.cloneOff.y }
            : this.cloneSrc.px;
          const s = vp.toScreen(pixelToPageFor(layer, layer.naturalWidth, layer.naturalHeight, pxPoint));
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(s.x - 8, s.y);
          ctx.lineTo(s.x + 8, s.y);
          ctx.moveTo(s.x, s.y - 8);
          ctx.lineTo(s.x, s.y + 8);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  private drawLiveSelection(ctx: CanvasRenderingContext2D, vp: Viewport, a: Extract<Active, { kind: 'sel' }>) {
    ctx.save();
    ctx.lineWidth = 1;
    const draw = (path: Path2D) => {
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([]);
      ctx.stroke(path);
      ctx.strokeStyle = '#000';
      ctx.setLineDash([4, 4]);
      ctx.stroke(path);
    };
    if (a.tool === 'lasso') {
      const p = new Path2D();
      a.points.forEach((q, i) => {
        const s = vp.toScreen(q);
        if (i) p.lineTo(s.x, s.y);
        else p.moveTo(s.x, s.y);
      });
      draw(p);
    } else {
      const r = this.selRect(a, this.liveMods);
      const s = vp.toScreen({ x: r.x, y: r.y });
      const p = new Path2D();
      if (a.tool === 'selellipse') p.ellipse(s.x + (r.width * vp.zoom) / 2, s.y + (r.height * vp.zoom) / 2, Math.max(0.5, (r.width * vp.zoom) / 2), Math.max(0.5, (r.height * vp.zoom) / 2), 0, 0, Math.PI * 2);
      else p.rect(s.x + 0.5, s.y + 0.5, r.width * vp.zoom, r.height * vp.zoom);
      draw(p);
    }
    ctx.restore();
  }
}

function snap15(from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(ang) * len, y: from.y + Math.sin(ang) * len };
}
