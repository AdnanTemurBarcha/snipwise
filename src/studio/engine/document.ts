import type {
  BaseLayer, BlurLayer, CalloutLayer, ImageLayer, Layer, LineLayer, PathLayer, Page, ShapeLayer,
  StampLayer, StudioDocument, TextLayer, TextStyle,
} from './types';
import { CALLOUT_PAD_RATIO, layoutText, fontString, measureWidth } from './text-layout';
import { clamp } from './geometry';
import { defaultAdjustments } from './adjust';
import type { Adjustments, AdjustLayer } from './types';

let counter = 0;
export function genId(prefix = 'l'): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const DEFAULT_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function baseLayer(name: string, o: Partial<BaseLayer> = {}): BaseLayer {
  return {
    id: genId(),
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'source-over',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    flipX: false,
    flipY: false,
    ...o,
  };
}

export function createDocument(): StudioDocument {
  const page = createPage('Page 1');
  return { pages: [page], activePageId: page.id };
}

export function createPage(name: string, width = 0, height = 0): Page {
  return { id: genId('p'), name, width, height, layers: [] };
}

export function activePage(doc: StudioDocument): Page {
  return doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0];
}

export function findLayer(page: Page, id: string): Layer | undefined {
  return page.layers.find((l) => l.id === id);
}

export function createImageLayer(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  o: Partial<BaseLayer> = {},
): ImageLayer {
  return {
    ...baseLayer(o.name ?? 'Image', { width: naturalWidth, height: naturalHeight, ...o }),
    type: 'image',
    source,
    naturalWidth,
    naturalHeight,
  };
}

export function defaultTextStyle(o: Partial<TextStyle> = {}): TextStyle {
  return {
    text: '',
    fontFamily: DEFAULT_FONT,
    fontSize: 24,
    fontWeight: 600,
    italic: false,
    align: 'left',
    lineHeight: 1.3,
    color: '#a78bfa',
    autoWidth: true,
    ...o,
  };
}

export function createTextLayer(o: Partial<TextLayer> = {}): TextLayer {
  const layer: TextLayer = {
    ...baseLayer(o.name ?? 'Text', o),
    ...defaultTextStyle(o),
    type: 'text',
  };
  relayoutText(layer);
  return layer;
}

export function createCalloutLayer(o: Partial<CalloutLayer> = {}): CalloutLayer {
  const layer: CalloutLayer = {
    ...baseLayer(o.name ?? 'Callout', o),
    ...defaultTextStyle({ fontSize: 18, color: '#ffffff', align: 'left', ...o }),
    type: 'callout',
    fill: o.fill ?? '#a78bfa',
    radius: o.radius ?? 8,
  };
  relayoutText(layer);
  return layer;
}

export function isTextual(l: Layer): l is TextLayer | CalloutLayer {
  return l.type === 'text' || l.type === 'callout';
}

export const MIN_TEXT_WIDTH = 20;

/** Recomputes width (if autoWidth) and height of a text/callout layer from its content. */
export function relayoutText(l: TextLayer | CalloutLayer): void {
  const pad = l.type === 'callout' ? l.fontSize * CALLOUT_PAD_RATIO : 0;
  if (l.autoWidth) {
    const font = fontString(l);
    const natural = Math.max(0, ...l.text.split('\n').map((line) => measureWidth(line, font)));
    l.width = Math.max(MIN_TEXT_WIDTH, Math.ceil(natural) + pad * 2 + 2);
  } else {
    l.width = Math.max(MIN_TEXT_WIDTH, l.width);
  }
  const layout = layoutText(l, l.width - pad * 2);
  l.height = Math.max(l.fontSize * l.lineHeight, layout.contentHeight) + pad * 2;
}

export function cloneLayer(l: Layer, offset = 16): Layer {
  const copy = { ...l, id: genId(), name: `${l.name} copy`, x: l.x + offset, y: l.y + offset } as Layer;
  if (copy.mask) {
    const m = document.createElement('canvas');
    m.width = copy.mask.width;
    m.height = copy.mask.height;
    m.getContext('2d', { willReadFrequently: true })!.drawImage(copy.mask, 0, 0);
    copy.mask = m;
  }
  // painted layers own their pixels: the copy must not share the canvas
  if (copy.type === 'image' && copy.source instanceof HTMLCanvasElement) {
    const c = document.createElement('canvas');
    c.width = copy.source.width;
    c.height = copy.source.height;
    c.getContext('2d', { willReadFrequently: true })!.drawImage(copy.source, 0, 0);
    copy.source = c;
  }
  return copy;
}

export function clampOpacity(v: number): number {
  return clamp(v, 0, 1);
}


export function createAdjustLayer(width: number, height: number, adjust: Partial<Adjustments> = {}, name = 'Adjustment'): AdjustLayer {
  return {
    ...baseLayer(name, { x: 0, y: 0, width, height }),
    type: 'adjust',
    adjust: { ...defaultAdjustments(), ...adjust },
  };
}

// ── annotation layers ───────────────────────────────────────────────────────

export function createShapeLayer(shape: 'rect' | 'ellipse', o: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    ...baseLayer(o.name ?? (shape === 'rect' ? 'Rectangle' : 'Ellipse'), o),
    type: 'shape',
    shape,
    fill: o.fill ?? null,
    stroke: o.stroke === undefined ? '#a78bfa' : o.stroke,
    strokeWidth: o.strokeWidth ?? 4,
    radius: o.radius ?? 0,
  };
}

/** Build a line from two absolute page points. */
export function createLineLayer(
  a: { x: number; y: number },
  b: { x: number; y: number },
  o: Partial<LineLayer> = {},
): LineLayer {
  const layer: LineLayer = {
    ...baseLayer(o.name ?? (o.endArrow ? 'Arrow' : 'Line'), o),
    type: 'line',
    x1: 0, y1: 0, x2: 1, y2: 1,
    color: o.color ?? '#a78bfa',
    strokeWidth: o.strokeWidth ?? 4,
    startArrow: o.startArrow ?? false,
    endArrow: o.endArrow ?? false,
    rotation: 0,
  };
  setLineEndpoints(layer, a, b);
  return layer;
}

/** Endpoints in page space. */
export function lineEndpoints(l: LineLayer): [{ x: number; y: number }, { x: number; y: number }] {
  return [
    { x: l.x + l.x1 * l.width, y: l.y + l.y1 * l.height },
    { x: l.x + l.x2 * l.width, y: l.y + l.y2 * l.height },
  ];
}

/** Re-derive box + fractions from two absolute endpoints. */
export function setLineEndpoints(l: LineLayer, a: { x: number; y: number }, b: { x: number; y: number }): void {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const w = Math.max(1, Math.abs(a.x - b.x));
  const h = Math.max(1, Math.abs(a.y - b.y));
  l.x = minX;
  l.y = minY;
  l.width = w;
  l.height = h;
  l.rotation = 0;
  l.x1 = (a.x - minX) / w;
  l.y1 = (a.y - minY) / h;
  l.x2 = (b.x - minX) / w;
  l.y2 = (b.y - minY) / h;
}

/** Build a freehand path from absolute page points. */
export function createPathLayer(points: { x: number; y: number }[], o: Partial<PathLayer> = {}): PathLayer {
  const layer: PathLayer = {
    ...baseLayer(o.name ?? 'Pen', o),
    type: 'path',
    points: [],
    color: o.color ?? '#a78bfa',
    strokeWidth: o.strokeWidth ?? 4,
    cap: o.cap ?? 'round',
  };
  setPathPoints(layer, points);
  return layer;
}

export function pathPointsAbs(l: PathLayer): { x: number; y: number }[] {
  return l.points.map((p) => ({ x: l.x + p.x * l.width, y: l.y + p.y * l.height }));
}

export function setPathPoints(l: PathLayer, pts: { x: number; y: number }[]): void {
  if (!pts.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  l.x = minX;
  l.y = minY;
  l.width = w;
  l.height = h;
  l.points = pts.map((p) => ({ x: (p.x - minX) / w, y: (p.y - minY) / h }));
}

export function createStampLayer(kind: 'step' | 'emoji', text: string, size: number, center: { x: number; y: number }, o: Partial<StampLayer> = {}): StampLayer {
  return {
    ...baseLayer(o.name ?? (kind === 'step' ? `Step ${text}` : `Emoji ${text}`), o),
    type: 'stamp',
    kind,
    text,
    color: o.color ?? '#a78bfa',
    width: size,
    height: size,
    x: center.x - size / 2,
    y: center.y - size / 2,
  };
}

export function createBlurLayer(o: Partial<BlurLayer> = {}): BlurLayer {
  return {
    ...baseLayer(o.name ?? 'Blur', o),
    type: 'blur',
    mode: o.mode ?? 'pixelate',
    amount: o.amount ?? 12,
    color: o.color ?? '#000000',
    rotation: 0,
  };
}

/** Next step-marker number: one more than the highest on the page. */
export function nextStepNumber(page: Page): number {
  let max = 0;
  for (const l of page.layers) {
    if (l.type === 'stamp' && l.kind === 'step') max = Math.max(max, parseInt(l.text, 10) || 0);
  }
  return max + 1;
}
