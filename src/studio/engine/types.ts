// Core document model for the Snipwise studio editor.
//
// A layer is an axis-aligned box (x, y, width, height) in page space plus a
// rotation about the box centre and optional flips. Flips only mirror the
// layer's *content* inside its box, so box maths never has to care about them.

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

/** Non-destructive colour adjustments. 0 everywhere = unchanged. */
export interface Adjustments {
  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;
  /** -100..100 */
  saturation: number;
  /** degrees -180..180 */
  hue: number;
  /** 0..100 */
  grayscale: number;
  /** 0..100 */
  sepia: number;
  /** 0..100 */
  invert: number;
  /** px */
  blur: number;
  levels?: Levels | null;
}

export interface Levels {
  /** 0..255 */
  inBlack: number;
  /** 0..255 */
  inWhite: number;
  /** 0.1..3, 1 = unchanged */
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export interface DropShadow {
  color: string;
  blur: number;
  x: number;
  y: number;
  /** 0..1 */
  opacity: number;
}

export interface OutlineFx {
  color: string;
  width: number;
}

/** Per-layer effects. Always replace the object, never mutate it (undo keeps the old one). */
export interface LayerFx {
  shadow?: DropShadow | null;
  stroke?: OutlineFx | null;
  adjust?: Adjustments | null;
}

export interface BaseLayer {
  fx?: LayerFx;
  /** Layer mask: alpha 255 = visible, 0 = hidden. Sized to the layer box in px; paint it with the brush tools. */
  mask?: HTMLCanvasElement | null;
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  width: number;
  height: number;
  /** radians, clockwise, about the box centre */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  source: CanvasImageSource;
  naturalWidth: number;
  naturalHeight: number;
  /** painted layer: only its opaque pixels are hit by clicks */
  raster?: boolean;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: TextAlign;
  /** multiple of fontSize */
  lineHeight: number;
  color: string;
  /** width follows the text (no wrapping) until the user sets a width by hand */
  autoWidth: boolean;
}

export interface TextLayer extends BaseLayer, TextStyle {
  type: 'text';
}

export interface CalloutLayer extends BaseLayer, TextStyle {
  type: 'callout';
  /** bubble fill */
  fill: string;
  radius: number;
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  /** null = no fill */
  fill: string | null;
  /** null = no outline */
  stroke: string | null;
  strokeWidth: number;
  /** rect corner radius */
  radius: number;
}

/**
 * A straight line or arrow. Endpoints are stored as fractions (0..1) of the
 * layer box, so moving and resizing the box transforms the line naturally.
 * Lines are never rotated (rotation stays 0) - their endpoints carry the angle.
 */
export interface LineLayer extends BaseLayer {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
  startArrow: boolean;
  endArrow: boolean;
}

/** Freehand stroke (pen / highlighter). Points are fractions of the layer box. */
export interface PathLayer extends BaseLayer {
  type: 'path';
  points: { x: number; y: number }[];
  color: string;
  strokeWidth: number;
  cap: 'round' | 'butt';
}

/** Numbered step marker or emoji sticker, sized by its (square) box. */
export interface StampLayer extends BaseLayer {
  type: 'stamp';
  kind: 'step' | 'emoji';
  /** the step number or the emoji glyph */
  text: string;
  color: string;
}

/**
 * Non-destructive privacy tool: re-renders whatever is *beneath* it, pixelated,
 * blurred or covered. Move or delete it and the original shows again.
 */
export interface BlurLayer extends BaseLayer {
  type: 'blur';
  mode: 'pixelate' | 'blur' | 'redact';
  /** block size (pixelate) / radius (blur), in page px */
  amount: number;
  /** cover colour for redact */
  color: string;
}

/** Re-colours everything beneath it (and only inside its box). */
export interface AdjustLayer extends BaseLayer {
  type: 'adjust';
  adjust: Adjustments;
}

export type Layer = AdjustLayer | ImageLayer | TextLayer | CalloutLayer | ShapeLayer | LineLayer | PathLayer | StampLayer | BlurLayer;
export type LayerType = Layer['type'];

export interface Page {
  id: string;
  name: string;
  width: number;
  height: number;
  /** back-to-front */
  layers: Layer[];
}

export interface StudioDocument {
  pages: Page[];
  activePageId: string;
}

/** Fields shared by every layer that callers may patch. */
export type LayerPatch = Partial<Omit<Layer, 'id' | 'type'>> & Record<string, unknown>;
