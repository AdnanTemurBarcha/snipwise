import type { Editor } from '../engine/editor';
import type { CalloutLayer, Layer, TextLayer, TextStyle } from '../engine/types';
import { createCalloutLayer, createTextLayer, isTextual, relayoutText } from '../engine/document';
import { CALLOUT_PAD_RATIO } from '../engine/text-layout';
import type { Point } from '../engine/geometry';
import type { Stage } from './stage';
import { h } from './dom';

type TextualLayer = TextLayer | CalloutLayer;

/**
 * In-place text editing: a <textarea> positioned exactly over the layer
 * (same font, size, rotation), auto-growing as you type. The layer itself is
 * hidden from the canvas while editing so there's no double rendering.
 */
export class TextEditor {
  private ta: HTMLTextAreaElement | null = null;
  private draft: TextualLayer | null = null;
  private target: TextualLayer | null = null; // existing layer being edited
  private original = '';
  private closing = false;

  constructor(
    private host: HTMLElement,
    private editor: Editor,
    private stage: Stage,
    private defaults: () => Partial<TextStyle>,
  ) {}

  get active(): boolean {
    return !!this.ta;
  }

  open(opts: { layer?: Layer; kind?: 'text' | 'callout'; at?: Point }): void {
    this.commit();
    let draft: TextualLayer;
    if (opts.layer && isTextual(opts.layer)) {
      this.target = opts.layer;
      this.original = opts.layer.text;
      draft = { ...opts.layer };
      this.editor.editingId = opts.layer.id;
    } else {
      const at = opts.at ?? { x: 0, y: 0 };
      const { fill, ...d } = this.defaults() as Partial<TextStyle> & { fill?: string };
      draft =
        opts.kind === 'callout'
          ? createCalloutLayer({ ...d, x: at.x, y: at.y, color: '#ffffff', fill: fill || '#a78bfa' })
          : createTextLayer({ ...d, x: at.x, y: at.y });
      this.target = null;
      this.original = '';
      this.editor.editingId = draft.id;
      // new text is anchored by its top-left near the click
      draft.y -= draft.fontSize * draft.lineHeight * 0.5;
    }
    this.draft = draft;
    this.closing = false;

    const ta = h('textarea', { class: 'text-edit', spellcheck: false, rows: 1 });
    ta.value = draft.text;
    ta.addEventListener('input', () => {
      draft.text = ta.value;
      relayoutText(draft);
      this.place();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
        e.preventDefault();
        this.commit();
      }
    });
    ta.addEventListener('blur', () => this.commit());
    this.ta = ta;
    this.host.appendChild(ta);
    this.place();
    this.stage.requestRender();
    ta.focus();
    ta.select();
  }

  /** keep the overlay glued to the layer after zoom / pan / resize */
  place(): void {
    const ta = this.ta;
    const d = this.draft;
    if (!ta || !d) return;
    const z = this.stage.vp.zoom;
    const b = this.stage.screenBox(d);
    const pad = d.type === 'callout' ? d.fontSize * CALLOUT_PAD_RATIO * z : 0;
    Object.assign(ta.style, {
      left: `${b.left}px`,
      top: `${b.top}px`,
      width: `${b.width}px`,
      height: `${b.height}px`,
      padding: `${pad}px`,
      fontFamily: d.fontFamily,
      fontSize: `${d.fontSize * z}px`,
      fontWeight: String(d.fontWeight),
      fontStyle: d.italic ? 'italic' : 'normal',
      lineHeight: String(d.lineHeight),
      textAlign: d.align,
      color: d.color,
      caretColor: d.color,
      background: d.type === 'callout' ? d.fill : 'transparent',
      borderRadius: d.type === 'callout' ? `${d.radius * z}px` : '0',
      transform: `rotate(${d.rotation}rad)`,
      transformOrigin: 'center center',
    } as Partial<CSSStyleDeclaration>);
  }

  commit(): void {
    if (!this.ta || this.closing) return;
    this.closing = true;
    const ta = this.ta;
    const draft = this.draft!;
    const text = ta.value;
    this.ta = null;
    this.draft = null;
    ta.remove();
    this.editor.editingId = null;

    if (this.target) {
      if (text !== this.original) {
        if (text.trim() === '') this.editor.removeLayers([this.target.id]);
        else this.editor.patchLayer(this.target.id, { text }, 'Edit text');
      }
    } else if (text.trim() !== '') {
      draft.text = text;
      relayoutText(draft);
      this.editor.addLayer(draft, { label: draft.type === 'callout' ? 'Add callout' : 'Add text' });
    }
    this.target = null;
    this.stage.requestRender();
  }
}
