import type { Editor } from '../engine/editor';
import { BLEND_MODES, type BlendMode, type Layer, type TextStyle } from '../engine/types';
import { isTextual } from '../engine/document';
import { clamp, deg, normalizeAngle, rad } from '../engine/geometry';
import type { AlignMode } from '../engine/align';
import { h } from './dom';
import { icon } from './icons';
import type { ToolId, ToolStyle } from './stage';
import { initStylePanel } from './style-panel';
import { initPaintPanel, type PaintActions } from './paint-panel';
import { PAINT_TOOLS } from './paint';
import { initEffectsPanel } from './effects-panel';

export type TextDefaults = Partial<TextStyle> & { fill?: string };

interface Field {
  el: HTMLElement;
  sync(): void;
}

export const FONTS: { label: string; value: string }[] = [
  { label: 'Inter / System', value: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Menlo / Mono', value: 'ui-monospace, Menlo, Consolas, monospace' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
  { label: 'Comic Sans', value: '"Comic Sans MS", "Comic Neue", cursive' },
];

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function initInspector(
  root: HTMLElement,
  editor: Editor,
  defaults: TextDefaults,
  getTool: () => ToolId,
  toolStyle: ToolStyle,
  openEmoji: (anchor: HTMLElement) => void,
  paintActions: PaintActions,
): { sync(): void } {
  const fields: Field[] = [];
  const single = () => (editor.selection.length === 1 ? editor.primary : undefined);
  let ratioLock = true;

  // ── builders ──────────────────────────────────────────────────────────────
  function section(title: string, ...kids: (Node | false)[]) {
    return h('section', { class: 'insp-section' }, h('div', { class: 'insp-title' }, title), ...kids);
  }

  function row(...kids: Node[]) {
    return h('div', { class: 'insp-row' }, ...kids);
  }

  function numField(
    label: string,
    get: (l: Layer) => number | null,
    set: (l: Layer, v: number) => void,
    o: { min?: number; max?: number; step?: number; unit?: string; enabled?: (l: Layer) => boolean } = {},
  ): Field {
    const input = h('input', { type: 'number', class: 'num', step: o.step ?? 1, ...(o.min !== undefined ? { min: o.min } : {}), ...(o.max !== undefined ? { max: o.max } : {}) });
    const el = h('label', { class: 'num-field' }, h('span', { class: 'num-label' }, label), input, o.unit ? h('span', { class: 'num-unit' }, o.unit) : null);
    input.addEventListener('input', () => {
      const l = single();
      if (!l || input.value === '' || Number.isNaN(Number(input.value))) return;
      let v = Number(input.value);
      if (o.min !== undefined) v = Math.max(o.min, v);
      if (o.max !== undefined) v = Math.min(o.max, v);
      set(l, v);
    });
    input.addEventListener('keydown', (e) => e.stopPropagation());
    return {
      el,
      sync() {
        const l = single();
        const v = l ? get(l) : null;
        const on = !!l && v !== null && (o.enabled ? o.enabled(l) : true);
        input.disabled = !on;
        el.classList.toggle('disabled', !on);
        if (document.activeElement !== input) input.value = on && v !== null ? String(round(v, 2)) : '';
      },
    };
  }

  function toggleBtn(name: string, title: string, isOn: () => boolean, click: () => void, disabled?: () => boolean): Field {
    const b = h('button', { class: 'icon-btn tog', title, onclick: click }, icon(name, 16));
    return {
      el: b,
      sync() {
        b.classList.toggle('on', isOn());
        (b as HTMLButtonElement).disabled = disabled ? disabled() : false;
      },
    };
  }

  function reg<T extends Field>(f: T): T {
    fields.push(f);
    return f;
  }

  // ── transform ────────────────────────────────────────────────────────────
  const fx = reg(numField('X', (l) => l.x, (l, v) => editor.patchLayer(l.id, { x: v }, 'Move', `${l.id}:x`), { unit: 'px' }));
  const fy = reg(numField('Y', (l) => l.y, (l, v) => editor.patchLayer(l.id, { y: v }, 'Move', `${l.id}:y`), { unit: 'px' }));
  const fw = reg(numField('W', (l) => l.width, (l, v) => {
    const patch: Record<string, unknown> = { width: v };
    if (isTextual(l)) patch.autoWidth = false;
    else if (ratioLock) patch.height = (v * l.height) / l.width;
    editor.patchLayer(l.id, patch, 'Resize', `${l.id}:w`);
  }, { min: 1, unit: 'px' }));
  const fh = reg(numField('H', (l) => l.height, (l, v) => {
    const patch: Record<string, unknown> = { height: v };
    if (ratioLock) patch.width = (v * l.width) / l.height;
    editor.patchLayer(l.id, patch, 'Resize', `${l.id}:h`);
  }, { min: 1, unit: 'px', enabled: (l) => !isTextual(l) }));
  const frot = reg(numField('∠', (l) => deg(normalizeAngle(l.rotation)), (l, v) => editor.patchLayer(l.id, { rotation: rad(v) }, 'Rotate', `${l.id}:rot`), { step: 1, unit: '°', enabled: (l) => l.type !== 'line' && l.type !== 'blur' }));

  const lockBtn = reg(toggleBtn('ratioLock', 'Keep proportions', () => ratioLock, () => {
    ratioLock = !ratioLock;
    sync();
  }));
  const flipH = reg(toggleBtn('flipH', 'Flip horizontal', () => !!single()?.flipX, () => {
    const l = single();
    if (l) editor.patchLayer(l.id, { flipX: !l.flipX }, 'Flip horizontal');
  }, () => !single()));
  const flipV = reg(toggleBtn('flipV', 'Flip vertical', () => !!single()?.flipY, () => {
    const l = single();
    if (l) editor.patchLayer(l.id, { flipY: !l.flipY }, 'Flip vertical');
  }, () => !single()));
  const rot90 = reg(toggleBtn('redo', 'Rotate 90° clockwise', () => false, () => {
    const l = single();
    if (l) editor.patchLayer(l.id, { rotation: normalizeAngle(l.rotation + Math.PI / 2) }, 'Rotate 90°');
  }, () => !single()));

  // ── appearance ───────────────────────────────────────────────────────────
  const opacityRange = h('input', { type: 'range', min: 0, max: 100, step: 1, class: 'range' });
  const opacityNum = h('span', { class: 'range-val' }, '100%');
  opacityRange.addEventListener('input', () => {
    const v = Number(opacityRange.value) / 100;
    for (const l of editor.selected) editor.patchLayer(l.id, { opacity: v }, 'Opacity', `${l.id}:opacity`);
  });
  const blend = h('select', { class: 'select' }, ...BLEND_MODES.map((b) => h('option', { value: b.value }, b.label)));
  blend.addEventListener('change', () => {
    for (const l of editor.selected) editor.patchLayer(l.id, { blendMode: blend.value as BlendMode }, 'Blend mode');
  });
  reg({
    el: h('span'),
    sync() {
      const l = editor.primary;
      const on = !!l;
      opacityRange.disabled = blend.disabled = !on;
      if (l) {
        opacityRange.value = String(Math.round(l.opacity * 100));
        opacityNum.textContent = `${Math.round(l.opacity * 100)}%`;
        blend.value = l.blendMode;
      }
    },
  });

  // ── text ─────────────────────────────────────────────────────────────────
  const textTargets = () => editor.selected.filter(isTextual);
  const useTarget = () => textTargets().length > 0;
  const textVal = <K extends keyof TextStyle>(k: K, fallback: TextStyle[K]): TextStyle[K] => {
    const t = textTargets();
    if (t.length) return (t[t.length - 1] as unknown as TextStyle)[k];
    return (defaults[k] as TextStyle[K]) ?? fallback;
  };
  const setText = (patch: Partial<TextStyle> & { fill?: string; radius?: number }, label: string, key?: string) => {
    const t = textTargets();
    if (t.length) for (const l of t) editor.patchLayer(l.id, patch as Record<string, unknown>, label, key ? `${l.id}:${key}` : undefined);
    else Object.assign(defaults, patch);
    sync();
  };

  const fontSel = h('select', { class: 'select' }, ...FONTS.map((f) => h('option', { value: f.value }, f.label)));
  fontSel.addEventListener('change', () => setText({ fontFamily: fontSel.value }, 'Font'));
  const sizeIn = h('input', { type: 'number', class: 'num', min: 4, max: 800, step: 1 });
  sizeIn.addEventListener('keydown', (e) => e.stopPropagation());
  sizeIn.addEventListener('input', () => {
    const v = Number(sizeIn.value);
    if (v >= 4) setText({ fontSize: v }, 'Font size', 'size');
  });
  const lhIn = h('input', { type: 'number', class: 'num', min: 0.8, max: 4, step: 0.1 });
  lhIn.addEventListener('keydown', (e) => e.stopPropagation());
  lhIn.addEventListener('input', () => {
    const v = Number(lhIn.value);
    if (v >= 0.8) setText({ lineHeight: v }, 'Line height', 'lh');
  });
  const colorIn = h('input', { type: 'color', class: 'color' });
  colorIn.addEventListener('input', () => setText({ color: colorIn.value }, 'Text color', 'color'));
  const fillIn = h('input', { type: 'color', class: 'color' });
  fillIn.addEventListener('input', () => {
    const t = textTargets().filter((l) => l.type === 'callout');
    if (t.length) for (const l of t) editor.patchLayer(l.id, { fill: fillIn.value }, 'Bubble color', `${l.id}:fill`);
    else defaults.fill = fillIn.value;
    sync();
  });
  const radiusIn = h('input', { type: 'range', min: 0, max: 40, step: 1, class: 'range' });
  radiusIn.addEventListener('input', () => {
    for (const l of textTargets().filter((x) => x.type === 'callout')) editor.patchLayer(l.id, { radius: Number(radiusIn.value) }, 'Corner radius', `${l.id}:radius`);
  });

  const boldBtn = reg(toggleBtn('bold', 'Bold', () => (textVal('fontWeight', 600) as number) >= 700, () => setText({ fontWeight: (textVal('fontWeight', 600) as number) >= 700 ? 400 : 700 }, 'Bold')));
  const italBtn = reg(toggleBtn('italic', 'Italic', () => !!textVal('italic', false), () => setText({ italic: !textVal('italic', false) }, 'Italic')));
  const alignBtns = (['left', 'center', 'right'] as const).map((a, i) =>
    reg(toggleBtn(['alignL', 'alignC', 'alignR'][i], `Align ${a}`, () => textVal('align', 'left') === a, () => setText({ align: a }, 'Align text'))),
  );

  const textSection = section(
    'Text',
    row(fontSel),
    row(h('label', { class: 'num-field' }, h('span', { class: 'num-label' }, 'Size'), sizeIn, h('span', { class: 'num-unit' }, 'px')),
      h('label', { class: 'num-field' }, h('span', { class: 'num-label' }, 'Lead'), lhIn)),
    row(boldBtn.el, italBtn.el, h('span', { class: 'sep' }), ...alignBtns.map((b) => b.el), h('span', { class: 'grow' }), h('label', { class: 'swatch-label', title: 'Text color' }, colorIn)),
  );
  const calloutSection = section(
    'Bubble',
    row(h('span', { class: 'num-label' }, 'Fill'), fillIn, h('span', { class: 'grow' }), h('span', { class: 'num-label' }, 'Radius'), radiusIn),
  );

  // ── canvas (shown when nothing is selected) ──────────────────────────────
  const cw = h('input', { type: 'number', class: 'num', min: 1, max: 16000 });
  const ch = h('input', { type: 'number', class: 'num', min: 1, max: 16000 });
  for (const i of [cw, ch]) i.addEventListener('keydown', (e) => e.stopPropagation());
  const applyCanvas = () => {
    const w = clamp(Math.round(Number(cw.value)), 1, 16000);
    const hh = clamp(Math.round(Number(ch.value)), 1, 16000);
    if (w && hh && (w !== editor.page.width || hh !== editor.page.height)) editor.setPageSize(w, hh);
  };
  cw.addEventListener('change', applyCanvas);
  ch.addEventListener('change', applyCanvas);
  const canvasSection = section(
    'Canvas',
    row(h('label', { class: 'num-field' }, h('span', { class: 'num-label' }, 'W'), cw, h('span', { class: 'num-unit' }, 'px')),
      h('label', { class: 'num-field' }, h('span', { class: 'num-label' }, 'H'), ch, h('span', { class: 'num-unit' }, 'px'))),
    h('div', { class: 'hint' }, 'Resizes the artboard. Layers keep their position.'),
  );

  // ── align / distribute ───────────────────────────────────────────────────
  const alignDefs: [AlignMode, string, string][] = [
    ['left', 'objL', 'Align left'], ['hcenter', 'objC', 'Align horizontal centers'], ['right', 'objR', 'Align right'],
    ['top', 'alignT', 'Align top'], ['vcenter', 'alignM', 'Align vertical centers'], ['bottom', 'alignB', 'Align bottom'],
  ];
  const alignBtnEls = alignDefs.map(([mode, ic, title]) =>
    h('button', { class: 'icon-btn', title: `${title} (${editor.selection.length > 1 ? 'to selection' : 'to canvas'})`, onclick: () => editor.alignSelection(mode) }, icon(ic, 16)));
  const distH = h('button', { class: 'icon-btn', title: 'Distribute horizontally', onclick: () => editor.distributeSelection('x') }, icon('distH', 16));
  const distV = h('button', { class: 'icon-btn', title: 'Distribute vertically', onclick: () => editor.distributeSelection('y') }, icon('distV', 16));
  const alignRow = h('div', { class: 'align-row' }, ...alignBtnEls.slice(0, 3), h('span', { class: 'sep' }), ...alignBtnEls.slice(3), h('span', { class: 'sep' }), distH, distV);

  const transformSection = section(
    'Transform',
    alignRow,
    row(fx.el, fy.el),
    row(fw.el, fh.el, lockBtn.el),
    row(frot.el, h('span', { class: 'grow' }), flipH.el, flipV.el, rot90.el),
  );
  const appearanceSection = section(
    'Appearance',
    row(h('span', { class: 'num-label' }, 'Opacity'), opacityRange, opacityNum),
    row(h('span', { class: 'num-label' }, 'Blend'), blend),
  );

  const stylePanel = initStylePanel(editor, toolStyle, getTool, openEmoji);
  const paintPanel = initPaintPanel(editor, toolStyle, getTool, paintActions, () => sync());
  const effectsPanel = initEffectsPanel(editor, paintActions);
  root.append(canvasSection, transformSection, appearanceSection, effectsPanel.el, paintPanel.el, stylePanel.el, textSection, calloutSection);

  function sync() {
    const sel = editor.selected;
    const hasLayer = sel.length > 0;
    const tool = getTool();
    const textual = sel.some(isTextual);
    const showText = textual || tool === 'text' || tool === 'callout';
    const showCallout = sel.some((l) => l.type === 'callout') || (tool === 'callout' && !textual);

    // while a raster tool is active its options get the room
    const painting = PAINT_TOOLS.includes(tool);
    canvasSection.hidden = hasLayer || !editor.page.width || painting;
    transformSection.hidden = !hasLayer || painting;
    appearanceSection.hidden = !hasLayer || painting;
    textSection.hidden = !showText;
    calloutSection.hidden = !showCallout;

    for (const f of fields) f.sync();
    stylePanel.sync();
    paintPanel.sync();
    effectsPanel.el.hidden = painting;
    if (!painting) effectsPanel.sync();
    distH.disabled = distV.disabled = sel.length < 3;
    alignBtnEls.forEach((b) => ((b as HTMLButtonElement).disabled = !hasLayer));
    alignBtnEls.forEach((b, i) => (b.title = `${alignDefs[i][2]} (${sel.length > 1 ? 'to selection' : 'to canvas'})`));

    if (document.activeElement !== cw) cw.value = editor.page.width ? String(editor.page.width) : '';
    if (document.activeElement !== ch) ch.value = editor.page.height ? String(editor.page.height) : '';

    if (showText) {
      fontSel.value = FONTS.find((f) => f.value === textVal('fontFamily', FONTS[0].value))?.value ?? FONTS[0].value;
      if (document.activeElement !== sizeIn) sizeIn.value = String(round(textVal('fontSize', 24) as number));
      if (document.activeElement !== lhIn) lhIn.value = String(round(textVal('lineHeight', 1.3) as number, 2));
      colorIn.value = toHex(textVal('color', '#a78bfa') as string);
    }
    if (showCallout) {
      const c = sel.find((l) => l.type === 'callout');
      fillIn.value = toHex(c && c.type === 'callout' ? c.fill : defaults.fill ?? '#a78bfa');
      if (c && c.type === 'callout') radiusIn.value = String(c.radius);
    }
    void useTarget;
  }

  return { sync };
}

function toHex(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '#a78bfa';
}
