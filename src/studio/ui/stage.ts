import type { Editor } from '../engine/editor';
import type { Layer, LineLayer, PathLayer } from '../engine/types';
import {
  createBlurLayer, createLineLayer, createPathLayer, createShapeLayer, createStampLayer, isTextual,
  lineEndpoints, nextStepNumber, setLineEndpoints, setPathPoints,
} from '../engine/document';
import { boundsOf, corners, normalizeAngle, unionRects, type Point, type Rect } from '../engine/geometry';
import { hitLayer as hitTest } from '../engine/hit';
import { snapRect, snapTargets, type SnapTargets } from '../engine/snap';
import { drawPage } from '../engine/render';
import {
  handlePosition, hitHandle, pinAnchor, resizeBox, rotationFromPointer, handleSigns,
  type HandleId, type ResizeHandle,
} from '../engine/transform';
import { Viewport } from '../engine/viewport';
import { PAINT_TOOLS, PaintController } from './paint';

export type ToolId =
  | 'select' | 'hand' | 'text' | 'callout'
  | 'rect' | 'ellipse' | 'line' | 'arrow' | 'pen' | 'highlight' | 'blur' | 'step' | 'emoji' | 'crop'
  | 'brush' | 'eraser' | 'bucket' | 'gradient' | 'eyedropper' | 'clone'
  | 'selrect' | 'selellipse' | 'lasso' | 'wand';

export const DRAW_TOOLS: ToolId[] = ['rect', 'ellipse', 'line', 'arrow', 'pen', 'highlight', 'blur'];

/** Style used by tools when they create something new. */
export interface ToolStyle {
  color: string;
  /** null = outline only */
  fill: string | null;
  strokeWidth: number;
  radius: number;
  blurMode: 'pixelate' | 'blur' | 'redact';
  blurAmount: number;
  emoji: string;
  stampSize: number;
  highlight: string;
  // raster tools
  brushSize: number;
  brushHardness: number;
  brushOpacity: number;
  tolerance: number;
  contiguous: boolean;
  gradientType: 'linear' | 'radial';
  /** second colour for gradients */
  color2: string;
  gradientFade: boolean;
  selMode: 'replace' | 'add' | 'subtract';
}

type Mode =
  | { kind: 'none' }
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'move'; start: Point; origins: Map<string, { x: number; y: number }>; moved: boolean; targets: SnapTargets; box: Rect }
  | { kind: 'resize'; handle: ResizeHandle; start: Point; orig: Layer }
  | { kind: 'rotate'; orig: Layer }
  | { kind: 'endpoint'; which: 0 | 1; layer: LineLayer }
  | { kind: 'draw'; tool: ToolId; layer: Layer; start: Point; points: Point[] }
  | { kind: 'marquee'; start: Point; now: Point; base: string[]; click?: string; moved: boolean }
  | { kind: 'paint' }
  | { kind: 'crop'; op: 'new' | 'move' | ResizeHandle; start: Point; orig: Rect };

export interface StageHooks {
  onZoomChange(zoom: number): void;
  onToolChange(tool: ToolId): void;
  editText(opts: { layer?: Layer; kind?: 'text' | 'callout'; at?: Point }): void;
  style(): ToolStyle;
  onCropChange(active: boolean): void;
  setColor(css: string): void;
  status(msg: string): void;
}

const CHECK_A = '#ffffff';
const CHECK_B = '#e3e5ea';
const ACCENT = '#8b6cff';
const SNAP_PX = 6;
const CROP_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class Stage {
  readonly canvas = document.createElement('canvas');
  readonly vp = new Viewport();
  tool: ToolId = 'select';
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private raf = 0;
  private mode: Mode = { kind: 'none' };
  private spaceDown = false;
  private hoverId: string | null = null;
  private hoverHandle: HandleId | null = null;
  private checker: CanvasPattern | null = null;
  private fittedFor = '';
  private guides: { xs: number[]; ys: number[] } = { xs: [], ys: [] };
  cropRect: Rect | null = null;
  readonly paint: PaintController;

  constructor(private host: HTMLElement, private editor: Editor, private hooks: StageHooks) {
    this.paint = new PaintController(editor, {
      style: () => hooks.style(),
      setColor: (c) => hooks.setColor(c),
      status: (m) => hooks.status(m),
      request: () => this.requestRender(),
    });
    // marching ants
    setInterval(() => {
      if (editor.pixelSel.active && !document.hidden) this.requestRender();
    }, 120);
    this.canvas.className = 'stage-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    // Keep focus where we put it (the in-place text box) instead of letting the click steal it.
    this.canvas.addEventListener('mousedown', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e, true));
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    editor.subscribe(() => this.requestRender());
    this.resize();
  }

  // ── sizing / view ─────────────────────────────────────────────────────────
  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.floor(r.width));
    this.h = Math.max(1, Math.floor(r.height));
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.hooks.onZoomChange(this.vp.zoom);
    this.requestRender();
  }

  fit(): void {
    const p = this.editor.page;
    this.vp.fit(this.w, this.h, p.width, p.height);
    this.fittedFor = `${p.id}:${p.width}x${p.height}`;
    this.afterViewChange();
  }

  /** Re-fit automatically the first time a page gets (or changes) its size. */
  autoFit(): void {
    const p = this.editor.page;
    const key = `${p.id}:${p.width}x${p.height}`;
    if (key !== this.fittedFor) this.fit();
  }

  zoomTo(z: number): void {
    this.vp.zoomAt(this.w / 2, this.h / 2, z);
    this.afterViewChange();
  }

  zoomBy(f: number): void {
    this.zoomTo(this.vp.zoom * f);
  }

  private afterViewChange() {
    this.hooks.onZoomChange(this.vp.zoom);
    this.requestRender();
  }

  setTool(t: ToolId): void {
    if (this.tool === t) return;
    if (this.tool === 'crop') this.endCrop();
    this.tool = t;
    if (t === 'crop') this.beginCrop();
    this.hooks.onToolChange(t);
    this.updateCursor();
    this.requestRender();
  }

  screenBox(l: Layer) {
    const tl = this.vp.toScreen({ x: l.x, y: l.y });
    return { left: tl.x, top: tl.y, width: l.width * this.vp.zoom, height: l.height * this.vp.zoom };
  }

  // ── crop ──────────────────────────────────────────────────────────────────
  private beginCrop() {
    const p = this.editor.page;
    if (!p.width) {
      this.hooks.status('Add an image before cropping');
      queueMicrotask(() => this.setTool('select'));
      return;
    }
    this.cropRect = { x: 0, y: 0, width: p.width, height: p.height };
    this.editor.select([]);
    this.hooks.onCropChange(true);
    this.hooks.status('Drag to choose the crop area · Enter to apply · Esc to cancel');
  }

  private endCrop() {
    this.cropRect = null;
    this.hooks.onCropChange(false);
  }

  applyCrop(): void {
    const r = this.cropRect;
    if (!r) return;
    this.editor.cropTo(r);
    this.hooks.status(`Cropped to ${Math.round(r.width)} × ${Math.round(r.height)} px · undo restores everything`);
    this.setTool('select');
  }

  cancelCrop(): void {
    if (this.tool === 'crop') this.setTool('select');
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  requestRender(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private getChecker(): CanvasPattern {
    if (!this.checker) {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const x = c.getContext('2d')!;
      x.fillStyle = CHECK_A;
      x.fillRect(0, 0, 16, 16);
      x.fillStyle = CHECK_B;
      x.fillRect(0, 0, 8, 8);
      x.fillRect(8, 8, 8, 8);
      this.checker = this.ctx.createPattern(c, 'repeat')!;
    }
    return this.checker;
  }

  private draw() {
    const { ctx, dpr, vp } = this;
    const page = this.editor.page;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!page.width || !page.height) return;

    const sx = vp.panX;
    const sy = vp.panY;
    const sw = page.width * vp.zoom;
    const sh = page.height * vp.zoom;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    ctx.fillStyle = this.getChecker();
    ctx.fillRect(sx, sy, sw, sh);
    ctx.translate(sx, sy);
    ctx.scale(vp.zoom, vp.zoom);
    drawPage(ctx, page, { skip: this.editor.editingId ? new Set([this.editor.editingId]) : undefined });
    ctx.restore();

    this.drawOverlay();
  }

  private outline(l: Layer, color: string, width: number, dash?: number[]) {
    const { ctx, vp } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    if (l.type === 'line') {
      const [a, b] = lineEndpoints(l).map((p) => vp.toScreen(p));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else {
      const cs = corners(l).map((p) => vp.toScreen(p));
      ctx.beginPath();
      cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  availableHandles(l: Layer): HandleId[] {
    switch (l.type) {
      case 'line': return [];
      case 'blur': return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      case 'stamp': return ['nw', 'ne', 'se', 'sw', 'rotate'];
      case 'text':
      case 'callout': return ['nw', 'ne', 'se', 'sw', 'e', 'w', 'rotate'];
      default: return ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];
    }
  }

  private handle(p: Point, kind: 'square' | 'circle') {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (kind === 'circle') ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2);
    else ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawOverlay() {
    const { ctx, vp } = this;
    const sel = this.editor.selected;

    this.paint.drawSelection(ctx, vp);
    if (this.tool === 'crop') {
      this.drawCropOverlay();
      return;
    }
    if (PAINT_TOOLS.includes(this.tool)) this.paint.drawOverlay(ctx, vp, this.tool);

    if (this.hoverId && !sel.some((l) => l.id === this.hoverId)) {
      const hl = this.editor.page.layers.find((l) => l.id === this.hoverId);
      if (hl) this.outline(hl, ACCENT, 1.5);
    }

    for (const l of sel) {
      if (l.id === this.editor.editingId) continue;
      this.outline(l, ACCENT, 1.5, l.type === 'path' || l.type === 'blur' ? [5, 4] : undefined);
    }

    const showHandles = this.tool === 'select' && sel.length === 1 && !sel[0].locked && sel[0].id !== this.editor.editingId;
    if (showHandles) {
      const l = sel[0];
      if (l.type === 'line') {
        for (const p of lineEndpoints(l)) this.handle(vp.toScreen(p), 'circle');
      } else {
        const hs = this.availableHandles(l);
        if (hs.includes('rotate')) {
          const top = vp.toScreen(handlePosition(l, 'n', vp.zoom));
          const rot = vp.toScreen(handlePosition(l, 'rotate', vp.zoom));
          ctx.save();
          ctx.strokeStyle = ACCENT;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(top.x, top.y);
          ctx.lineTo(rot.x, rot.y);
          ctx.stroke();
          ctx.restore();
        }
        for (const hid of hs) this.handle(vp.toScreen(handlePosition(l, hid, vp.zoom)), hid === 'rotate' ? 'circle' : 'square');
      }
    }

    // multi-selection: one bounding box
    if (sel.length > 1 && this.tool === 'select') {
      const u = unionRects(sel.map(boundsOf));
      if (u) {
        const a = vp.toScreen({ x: u.x, y: u.y });
        ctx.save();
        ctx.strokeStyle = ACCENT;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(a.x, a.y, u.width * vp.zoom, u.height * vp.zoom);
        ctx.restore();
      }
    }

    // snap guides
    if (this.guides.xs.length || this.guides.ys.length) {
      const page = this.editor.page;
      ctx.save();
      ctx.strokeStyle = '#ff2d9b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of this.guides.xs) {
        const s = vp.toScreen({ x, y: 0 });
        ctx.moveTo(Math.round(s.x) + 0.5, vp.toScreen({ x, y: 0 }).y);
        ctx.lineTo(Math.round(s.x) + 0.5, vp.toScreen({ x, y: page.height }).y);
      }
      for (const y of this.guides.ys) {
        const s = vp.toScreen({ x: 0, y });
        ctx.moveTo(vp.toScreen({ x: 0, y }).x, Math.round(s.y) + 0.5);
        ctx.lineTo(vp.toScreen({ x: page.width, y }).x, Math.round(s.y) + 0.5);
      }
      ctx.stroke();
      ctx.restore();
    }

    // marquee
    const m = this.mode;
    if (m.kind === 'marquee') {
      const a = vp.toScreen(m.start);
      const b = vp.toScreen(m.now);
      ctx.save();
      ctx.fillStyle = 'rgba(139,108,255,0.12)';
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      ctx.restore();
    }

    // live read-outs
    const primary = this.editor.primary;
    if (m.kind === 'resize' || m.kind === 'rotate' || (m.kind === 'draw' && primary === undefined)) {
      const l = m.kind === 'draw' ? m.layer : primary;
      if (l && l.type !== 'path') {
        const b = boundsOf(l);
        const a = vp.toScreen({ x: b.x + b.width / 2, y: b.y + b.height });
        const label =
          m.kind === 'rotate'
            ? `${Math.round((normalizeAngle(l.rotation) * 180) / Math.PI)}°`
            : l.type === 'line'
              ? `${Math.round(Math.hypot(l.width * (l.x2 - l.x1), l.height * (l.y2 - l.y1)))} px`
              : `${Math.round(l.width)} × ${Math.round(l.height)}`;
        this.badge(label, a.x, a.y + 18);
      }
    }
  }

  private drawCropOverlay() {
    const { ctx, vp } = this;
    const page = this.editor.page;
    const r = this.cropRect;
    if (!r) return;
    const p0 = vp.toScreen({ x: 0, y: 0 });
    const pw = page.width * vp.zoom;
    const ph = page.height * vp.zoom;
    const a = vp.toScreen({ x: r.x, y: r.y });
    const rw = r.width * vp.zoom;
    const rh = r.height * vp.zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(8,8,14,0.55)';
    ctx.beginPath();
    ctx.rect(p0.x, p0.y, pw, ph);
    ctx.rect(a.x, a.y, rw, rh);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.x, a.y, rw, rh);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(a.x + (rw * i) / 3, a.y);
      ctx.lineTo(a.x + (rw * i) / 3, a.y + rh);
      ctx.moveTo(a.x, a.y + (rh * i) / 3);
      ctx.lineTo(a.x + rw, a.y + (rh * i) / 3);
    }
    ctx.stroke();
    ctx.restore();
    for (const hid of CROP_HANDLES) this.handle(vp.toScreen(handlePosition({ ...r, rotation: 0 }, hid, vp.zoom)), 'square');
    this.badge(`${Math.round(r.width)} × ${Math.round(r.height)}`, a.x + rw / 2, a.y + rh + 18);
  }

  private badge(text: string, x: number, y: number) {
    const { ctx } = this;
    ctx.save();
    ctx.font = '600 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(20,20,28,0.88)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 10, w, 20, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // ── input ─────────────────────────────────────────────────────────────────
  private pagePoint(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return this.vp.toPage({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  private topHit(p: Point): Layer | null {
    const layers = this.editor.page.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      if (hitTest(layers[i], p, this.vp.zoom)) return layers[i];
    }
    return null;
  }

  private hitEndpoint(l: LineLayer, p: Point): 0 | 1 | null {
    const r = 10 / this.vp.zoom;
    const pts = lineEndpoints(l);
    for (const i of [1, 0] as const) {
      if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) <= r) return i;
    }
    return null;
  }

  private onDown(e: PointerEvent) {
    // clicking the canvas commits any open text box and drops focus from inspector fields
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    if (this.editor.editingId) return;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pagePoint(e);

    if (e.button === 1 || this.tool === 'hand' || this.spaceDown) {
      this.mode = { kind: 'pan', lastX: e.clientX, lastY: e.clientY };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;

    if (this.tool === 'crop') return this.cropDown(p);

    if (PAINT_TOOLS.includes(this.tool)) {
      if (this.paint.down(this.tool, p, e, this.vp.zoom)) this.mode = { kind: 'paint' };
      return;
    }

    if (this.tool === 'text' || this.tool === 'callout') {
      const hit = this.topHit(p);
      if (hit && hit.type === this.tool) {
        this.editor.select([hit.id]);
        this.hooks.editText({ layer: hit });
      } else {
        this.hooks.editText({ kind: this.tool, at: p });
      }
      return;
    }

    if (this.tool === 'step' || this.tool === 'emoji') return this.stampAt(p);
    if (DRAW_TOOLS.includes(this.tool)) return this.drawStart(p);
    this.selectDown(e, p);
  }

  private selectDown(e: PointerEvent, p: Point) {
    const sel = this.editor.selected;
    if (sel.length === 1 && !sel[0].locked) {
      const l = sel[0];
      if (l.type === 'line') {
        const which = this.hitEndpoint(l, p);
        if (which !== null) {
          this.editor.beginGesture([l.id]);
          this.mode = { kind: 'endpoint', which, layer: l };
          return;
        }
      } else {
        const hid = hitHandle(l, p, this.vp.zoom, 9, this.availableHandles(l));
        if (hid === 'rotate') {
          this.editor.beginGesture([l.id]);
          this.mode = { kind: 'rotate', orig: { ...l } as Layer };
          return;
        }
        if (hid) {
          this.editor.beginGesture([l.id]);
          this.mode = { kind: 'resize', handle: hid, start: p, orig: { ...l } as Layer };
          return;
        }
      }
    }

    const hit = this.topHit(p);
    if (!hit || hit.locked) {
      // empty space or a locked layer (e.g. the Background): drag draws a marquee,
      // a plain click on a locked layer still selects it so it can be unlocked
      const base = e.shiftKey ? [...this.editor.selection] : [];
      if (!e.shiftKey) this.editor.select([]);
      this.mode = { kind: 'marquee', start: p, now: p, base, click: hit?.id, moved: false };
      return;
    }
    if (e.shiftKey) {
      const has = this.editor.selection.includes(hit.id);
      this.editor.select(has ? this.editor.selection.filter((i) => i !== hit.id) : [...this.editor.selection, hit.id]);
    } else if (!this.editor.selection.includes(hit.id)) {
      this.editor.select([hit.id]);
    }
    const movable = this.editor.selected.filter((l) => !l.locked);
    if (!movable.length) return;
    this.editor.beginGesture(movable.map((l) => l.id));
    this.mode = {
      kind: 'move',
      start: p,
      origins: new Map(movable.map((l) => [l.id, { x: l.x, y: l.y }])),
      moved: false,
      targets: snapTargets(this.editor.page, new Set(movable.map((l) => l.id))),
      box: unionRects(movable.map(boundsOf))!,
    };
  }

  // ── drawing tools ─────────────────────────────────────────────────────────
  private drawStart(p: Point) {
    const s = this.hooks.style();
    let layer: Layer;
    switch (this.tool) {
      case 'rect':
        layer = createShapeLayer('rect', { x: p.x, y: p.y, width: 1, height: 1, stroke: s.color, fill: s.fill, strokeWidth: s.strokeWidth, radius: s.radius });
        break;
      case 'ellipse':
        layer = createShapeLayer('ellipse', { x: p.x, y: p.y, width: 1, height: 1, stroke: s.color, fill: s.fill, strokeWidth: s.strokeWidth });
        break;
      case 'line':
      case 'arrow':
        layer = createLineLayer(p, { x: p.x + 1, y: p.y }, { color: s.color, strokeWidth: s.strokeWidth, endArrow: this.tool === 'arrow' });
        break;
      case 'pen':
        layer = createPathLayer([p], { color: s.color, strokeWidth: s.strokeWidth });
        break;
      case 'highlight':
        layer = createPathLayer([p], { name: 'Highlight', color: s.highlight, strokeWidth: s.strokeWidth * 4, opacity: 0.4 });
        break;
      default:
        layer = createBlurLayer({ x: p.x, y: p.y, width: 1, height: 1, mode: s.blurMode, amount: s.blurAmount, color: '#000000' });
    }
    this.editor.select([]);
    this.editor.createLive(layer);
    this.mode = { kind: 'draw', tool: this.tool, layer, start: p, points: [p] };
  }

  private drawMove(m: Extract<Mode, { kind: 'draw' }>, p: Point, e: PointerEvent) {
    const l = m.layer;
    if (l.type === 'path') {
      const last = m.points[m.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2 / this.vp.zoom) return;
      m.points.push(p);
      setPathPoints(l as PathLayer, m.points);
      this.editor.updateLive(l.id, {});
      return;
    }
    if (l.type === 'line') {
      let q = p;
      if (e.shiftKey) q = snapAngle(m.start, p, 15);
      setLineEndpoints(l, m.start, q);
      this.editor.updateLive(l.id, {});
      return;
    }
    // rect / ellipse / blur
    let dx = p.x - m.start.x;
    let dy = p.y - m.start.y;
    if (e.shiftKey && l.type === 'shape') {
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx || 1) * s;
      dy = Math.sign(dy || 1) * s;
    }
    const cx = e.altKey ? m.start.x - dx : m.start.x;
    const cy = e.altKey ? m.start.y - dy : m.start.y;
    const ex = m.start.x + dx;
    const ey = m.start.y + dy;
    this.editor.updateLive(l.id, {
      x: Math.min(cx, ex),
      y: Math.min(cy, ey),
      width: Math.max(1, Math.abs(ex - cx)),
      height: Math.max(1, Math.abs(ey - cy)),
    });
  }

  private drawEnd(m: Extract<Mode, { kind: 'draw' }>, cancelled: boolean) {
    const l = m.layer;
    const tiny = (l.type === 'shape' || l.type === 'blur') && Math.max(l.width, l.height) * this.vp.zoom < 4;
    const tinyLine = l.type === 'line' && Math.hypot(l.width, l.height) * this.vp.zoom < 4;
    if (cancelled || tiny || tinyLine) {
      this.editor.discardLive();
      return;
    }
    const label: Record<string, string> = {
      rect: 'Add rectangle', ellipse: 'Add ellipse', line: 'Add line', arrow: 'Add arrow',
      pen: 'Draw', highlight: 'Highlight', blur: 'Add blur',
    };
    this.editor.commitLive(label[m.tool] ?? 'Add layer');
  }

  private stampAt(p: Point) {
    const s = this.hooks.style();
    const layer =
      this.tool === 'step'
        ? createStampLayer('step', String(nextStepNumber(this.editor.page)), s.stampSize, p, { color: s.color })
        : createStampLayer('emoji', s.emoji, s.stampSize * 1.2, p);
    this.editor.addLayer(layer, { label: this.tool === 'step' ? 'Add step marker' : 'Add emoji' });
  }

  // ── crop interaction ──────────────────────────────────────────────────────
  private cropDown(p: Point) {
    const r = this.cropRect;
    if (!r) return;
    const hid = hitHandle({ ...r, rotation: 0 }, p, this.vp.zoom, 9, CROP_HANDLES);
    if (hid) {
      this.mode = { kind: 'crop', op: hid as ResizeHandle, start: p, orig: { ...r } };
    } else if (!this.cropIsFullPage(r) && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height) {
      this.mode = { kind: 'crop', op: 'move', start: p, orig: { ...r } };
    } else {
      this.mode = { kind: 'crop', op: 'new', start: this.clampToPage(p), orig: { ...r } };
    }
  }

  /** The untouched starting box covers everything, so "move" would do nothing: a drag should draw a new box instead. */
  private cropIsFullPage(r: Rect): boolean {
    const pg = this.editor.page;
    return r.x <= 0 && r.y <= 0 && r.width >= pg.width && r.height >= pg.height;
  }

  private clampToPage(p: Point): Point {
    const pg = this.editor.page;
    return { x: Math.min(pg.width, Math.max(0, p.x)), y: Math.min(pg.height, Math.max(0, p.y)) };
  }

  private cropMove(m: Extract<Mode, { kind: 'crop' }>, p: Point, e: PointerEvent) {
    const pg = this.editor.page;
    let r: Rect;
    if (m.op === 'move') {
      const dx = p.x - m.start.x;
      const dy = p.y - m.start.y;
      r = {
        ...m.orig,
        x: Math.min(pg.width - m.orig.width, Math.max(0, m.orig.x + dx)),
        y: Math.min(pg.height - m.orig.height, Math.max(0, m.orig.y + dy)),
      };
    } else if (m.op === 'new') {
      const q = this.clampToPage(p);
      let w = q.x - m.start.x;
      let h = q.y - m.start.y;
      if (e.shiftKey) {
        const s = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * s;
        h = Math.sign(h || 1) * s;
      }
      r = { x: Math.min(m.start.x, m.start.x + w), y: Math.min(m.start.y, m.start.y + h), width: Math.abs(w), height: Math.abs(h) };
    } else {
      const q = this.clampToPage(p);
      const b = resizeBox({ ...m.orig, rotation: 0 }, m.op, m.start, q, { minSize: 8, lockAspect: e.shiftKey && handleSigns(m.op).sx !== 0 && handleSigns(m.op).sy !== 0 });
      r = { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, pg.width - Math.max(0, b.x)), height: Math.min(b.height, pg.height - Math.max(0, b.y)) };
    }
    if (r.width >= 1 && r.height >= 1) this.cropRect = r;
    this.requestRender();
  }

  // ── pointer move / up ────────────────────────────────────────────────────
  private onMove(e: PointerEvent) {
    const m = this.mode;
    if (m.kind === 'pan') {
      this.vp.panBy(e.clientX - m.lastX, e.clientY - m.lastY);
      m.lastX = e.clientX;
      m.lastY = e.clientY;
      this.afterViewChange();
      return;
    }
    const p = this.pagePoint(e);
    if (m.kind === 'none' && PAINT_TOOLS.includes(this.tool)) {
      this.paint.hover(p);
      return;
    }

    switch (m.kind) {
      case 'paint': return this.paint.move(p, e, this.vp.zoom, (ev) => this.pagePoint(ev));
      case 'move': return this.moveMove(m, p, e);
      case 'rotate':
        this.editor.updateLive(m.orig.id, { rotation: rotationFromPointer(m.orig, p, e.shiftKey ? 15 : undefined) });
        return;
      case 'resize': return this.applyResize(m, p, e);
      case 'endpoint': return this.endpointMove(m, p, e);
      case 'draw': return this.drawMove(m, p, e);
      case 'crop': return this.cropMove(m, p, e);
      case 'marquee': {
        m.now = p;
        if (Math.hypot(p.x - m.start.x, p.y - m.start.y) * this.vp.zoom > 3) m.moved = true;
        if (!m.moved) return;
        const rect: Rect = { x: Math.min(m.start.x, p.x), y: Math.min(m.start.y, p.y), width: Math.abs(p.x - m.start.x), height: Math.abs(p.y - m.start.y) };
        const inside = this.editor.page.layers
          .filter((l) => l.visible && !l.locked && l.type !== 'adjust' && intersects(boundsOf(l), rect))
          .map((l) => l.id);
        this.editor.select([...new Set([...m.base, ...inside])]);
        this.requestRender();
        return;
      }
    }

    // hover feedback
    const sel = this.editor.selected;
    const hit = this.tool === 'select' ? this.topHit(p) : null;
    let hh: HandleId | null = null;
    if (this.tool === 'select' && sel.length === 1 && !sel[0].locked) {
      if (sel[0].type === 'line') hh = this.hitEndpoint(sel[0], p) !== null ? 'se' : null;
      else hh = hitHandle(sel[0], p, this.vp.zoom, 9, this.availableHandles(sel[0]));
    } else if (this.tool === 'crop' && this.cropRect) {
      hh = hitHandle({ ...this.cropRect, rotation: 0 }, p, this.vp.zoom, 9, CROP_HANDLES);
    }
    if ((hit?.id ?? null) !== this.hoverId || hh !== this.hoverHandle) {
      this.hoverId = hit?.id ?? null;
      this.hoverHandle = hh;
      this.updateCursor();
      this.requestRender();
    }
  }

  private moveMove(m: Extract<Mode, { kind: 'move' }>, p: Point, e: PointerEvent) {
    let dx = p.x - m.start.x;
    let dy = p.y - m.start.y;
    if (!m.moved && Math.hypot(dx, dy) * this.vp.zoom < 3) return;
    m.moved = true;
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    this.guides = { xs: [], ys: [] };
    if (!(e.ctrlKey || e.metaKey)) {
      const s = snapRect({ ...m.box, x: m.box.x + dx, y: m.box.y + dy }, m.targets, SNAP_PX / this.vp.zoom);
      if (!e.shiftKey || dx !== 0) dx += s.dx;
      if (!e.shiftKey || dy !== 0) dy += s.dy;
      this.guides = { xs: s.guidesX, ys: s.guidesY };
    }
    for (const [id, o] of m.origins) this.editor.updateLive(id, { x: o.x + dx, y: o.y + dy });
  }

  private endpointMove(m: Extract<Mode, { kind: 'endpoint' }>, p: Point, e: PointerEvent) {
    const [a, b] = lineEndpoints(m.layer);
    const fixed = m.which === 0 ? b : a;
    const q = e.shiftKey ? snapAngle(fixed, p, 15) : p;
    if (m.which === 0) setLineEndpoints(m.layer, q, b);
    else setLineEndpoints(m.layer, a, q);
    this.editor.updateLive(m.layer.id, {});
  }

  private applyResize(m: Extract<Mode, { kind: 'resize' }>, p: Point, e: PointerEvent) {
    const o = m.orig;
    const { sx, sy } = handleSigns(m.handle);
    const corner = sx !== 0 && sy !== 0;

    if (isTextual(o)) {
      if (corner) {
        const r = resizeBox(o, m.handle, m.start, p, { lockAspect: true, fromCenter: e.altKey, minSize: 8 });
        const s = r.width / o.width;
        const patch: Record<string, unknown> = { fontSize: Math.max(4, Math.round(o.fontSize * s * 10) / 10) };
        if (!o.autoWidth) patch.width = o.width * s;
        this.editor.updateLive(o.id, patch);
      } else {
        const r = resizeBox(o, m.handle, m.start, p, { fromCenter: e.altKey, minSize: 24 });
        this.editor.updateLive(o.id, { width: r.width, autoWidth: false });
      }
      const l = this.editor.page.layers.find((x) => x.id === o.id)!;
      const ax = (1 - sx) / 2;
      const ay = corner ? (1 - sy) / 2 : 0;
      const pos = e.altKey
        ? pinAnchor(o, { x: o.width / 2, y: o.height / 2 }, l, { x: l.width / 2, y: l.height / 2 })
        : pinAnchor(o, { x: ax * o.width, y: ay * o.height }, l, { x: ax * l.width, y: ay * l.height });
      this.editor.updateLive(o.id, { x: pos.x, y: pos.y });
      return;
    }

    const lock = corner && (o.type === 'stamp' || !e.shiftKey);
    const r = resizeBox(o, m.handle, m.start, p, { lockAspect: lock, fromCenter: e.altKey });
    this.editor.updateLive(o.id, r);
  }

  private onUp(e: PointerEvent, cancelled = false) {
    const m = this.mode;
    this.mode = { kind: 'none' };
    this.guides = { xs: [], ys: [] };
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    switch (m.kind) {
      case 'move':
        cancelled ? this.editor.cancelGesture() : this.editor.endGesture(m.origins.size > 1 ? 'Move layers' : 'Move');
        break;
      case 'resize':
        cancelled ? this.editor.cancelGesture() : this.editor.endGesture('Resize');
        break;
      case 'rotate':
        cancelled ? this.editor.cancelGesture() : this.editor.endGesture('Rotate');
        break;
      case 'endpoint':
        cancelled ? this.editor.cancelGesture() : this.editor.endGesture('Edit line');
        break;
      case 'draw':
        this.drawEnd(m, cancelled);
        break;
      case 'paint':
        this.paint.up(e, cancelled, this.vp.zoom);
        break;
      case 'marquee':
        if (!m.moved && m.click && !cancelled) {
          this.editor.select(e.shiftKey ? [...new Set([...m.base, m.click])] : [m.click]);
          this.hooks.status('Locked layer — unlock it in the Layers panel to move or transform it');
        }
        break;
    }
    this.updateCursor();
    this.requestRender();
  }

  private onDouble(e: MouseEvent) {
    if (this.tool === 'hand' || this.tool === 'crop') return;
    const hit = this.topHit(this.pagePoint(e));
    if (hit && isTextual(hit) && !hit.locked) {
      this.editor.select([hit.id]);
      this.hooks.editText({ layer: hit });
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      this.vp.zoomAt(e.clientX - r.left, e.clientY - r.top, this.vp.zoom * f);
    } else if (e.shiftKey) {
      this.vp.panBy(-(e.deltaY || e.deltaX), 0);
    } else {
      this.vp.panBy(-e.deltaX, -e.deltaY);
    }
    this.afterViewChange();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.code === 'Space') {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (down) e.preventDefault();
      if (this.spaceDown !== down) {
        this.spaceDown = down;
        this.updateCursor();
      }
    }
    if (down && this.tool === 'crop' && !(e.target as HTMLElement).matches('input, textarea, select')) {
      if (e.key === 'Enter') { e.preventDefault(); this.applyCrop(); }
      if (e.key === 'Escape') { e.preventDefault(); this.cancelCrop(); }
    }
  }

  private updateCursor() {
    let c = 'default';
    if (this.mode.kind === 'pan') c = 'grabbing';
    else if (this.tool === 'hand' || this.spaceDown) c = 'grab';
    else if (this.tool === 'text') c = 'text';
    else if (this.tool === 'crop') c = this.hoverHandle ? this.resizeCursor(this.hoverHandle as ResizeHandle, 0) : 'crosshair';
    else if (this.tool === 'brush' || this.tool === 'eraser' || this.tool === 'clone') c = 'none';
    else if (this.tool !== 'select') c = 'crosshair';
    else if (this.hoverHandle) c = this.hoverHandle === 'rotate' ? 'alias' : this.hoverHandle === 'se' && this.editor.primary?.type === 'line' ? 'pointer' : this.resizeCursor(this.hoverHandle as ResizeHandle);
    else if (this.hoverId) c = 'move';
    this.canvas.style.cursor = c;
  }

  private resizeCursor(h: ResizeHandle, rot = this.editor.primary?.rotation ?? 0): string {
    const base: Record<ResizeHandle, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
    const deg = (base[h] + (rot * 180) / Math.PI + 3600) % 180;
    return ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'][Math.round(deg / 45) % 4];
  }

  get busy(): boolean {
    return this.mode.kind !== 'none';
  }
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** Snap the direction from `from` to `to` to the nearest `stepDeg`. */
export function snapAngle(from: Point, to: Point, stepDeg: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}
