import type { TextStyle } from './types';

export type Measure = (text: string, font: string) => number;

let measurer: Measure | null = null;

/** Inject a text-width function (a real canvas in the app, a fake in tests). */
export function setTextMeasurer(m: Measure | null): void {
  measurer = m;
}

function defaultMeasure(): Measure {
  if (!measurer) {
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
    measurer = (text, font) => {
      if (!ctx) {
        ctx = (typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(1, 1).getContext('2d')
          : document.createElement('canvas').getContext('2d')) as CanvasRenderingContext2D;
      }
      ctx.font = font;
      return ctx.measureText(text).width;
    };
  }
  return measurer;
}

export function measureWidth(text: string, font: string): number {
  return defaultMeasure()(text, font);
}

export function fontString(s: Pick<TextStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic'>): string {
  return `${s.italic ? 'italic ' : ''}${s.fontWeight} ${s.fontSize}px ${s.fontFamily}`;
}

/** Word-wraps `text` to `maxWidth`. Explicit newlines always break. */
export function wrapLines(text: string, font: string, maxWidth: number): string[] {
  const measure = defaultMeasure();
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (para === '') {
      out.push('');
      continue;
    }
    const words = para.split(/(\s+)/); // keep whitespace tokens so spacing is preserved
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (line && measure(candidate.trimEnd(), font) > maxWidth) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = candidate;
      }
      // a single word wider than the box: hard-break by characters
      while (measure(line, font) > maxWidth && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && measure(line.slice(0, n), font) > maxWidth) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line.trimEnd());
  }
  return out.length ? out : [''];
}

export interface TextLayout {
  lines: string[];
  lineHeightPx: number;
  contentHeight: number;
}

export function layoutText(style: TextStyle, maxWidth: number): TextLayout {
  const lines = wrapLines(style.text, fontString(style), Math.max(1, maxWidth));
  const lineHeightPx = style.fontSize * style.lineHeight;
  return { lines, lineHeightPx, contentHeight: lines.length * lineHeightPx };
}

export const CALLOUT_PAD_RATIO = 0.6;
export const CALLOUT_TAIL = 10;
