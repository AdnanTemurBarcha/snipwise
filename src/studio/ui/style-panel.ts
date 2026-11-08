import type { Editor } from '../engine/editor';
import type { Layer } from '../engine/types';
import { h } from './dom';
import { icon } from './icons';
import type { ToolId, ToolStyle } from './stage';
import { DRAW_TOOLS } from './stage';
import { PAINT_TOOLS } from './paint';

export const SWATCHES = ['#a78bfa', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#ffffff', '#111111'];

const STYLED = new Set(['shape', 'line', 'path', 'stamp', 'blur']);

/**
 * Appearance of annotation layers (colour, fill, stroke, arrowheads, blur mode...).
 * With layers selected it edits them *and* the defaults for the next thing you
 * draw; with only a draw tool active it edits just the defaults.
 */
export function initStylePanel(
  editor: Editor,
  style: ToolStyle,
  getTool: () => ToolId,
  openEmoji: (anchor: HTMLElement) => void,
): { el: HTMLElement; sync(): void } {
  const targets = () => editor.selected.filter((l) => STYLED.has(l.type));
  const has = (pred: (l: Layer) => boolean) => targets().some(pred);

  const patch = (p: Record<string, unknown>, label: string, key?: string) => {
    for (const l of targets()) editor.patchLayer(l.id, p, label, key ? `${l.id}:${key}` : undefined);
  };

  // colour
  const swatches = h('div', { class: 'swatches' });
  const colorIn = h('input', { type: 'color', class: 'color', title: 'Custom color' });
  const setColor = (c: string, key = 'color') => {
    style.color = c;
    for (const l of targets()) {
      if (l.type === 'shape') editor.patchLayer(l.id, { stroke: c }, 'Stroke color', `${l.id}:${key}`);
      else if (l.type === 'line' || l.type === 'path' || l.type === 'stamp') editor.patchLayer(l.id, { color: c }, 'Color', `${l.id}:${key}`);
    }
    sync();
  };
  for (const c of SWATCHES) {
    swatches.append(h('button', { class: 'swatch', style: `background:${c}`, title: c, 'data-c': c, onclick: () => setColor(c, 'swatch') }));
  }
  colorIn.addEventListener('input', () => setColor(colorIn.value));

  // fill (shapes)
  const fillOn = h('input', { type: 'checkbox' });
  const fillIn = h('input', { type: 'color', class: 'color' });
  const setFill = () => {
    const c = fillOn.checked ? fillIn.value : null;
    style.fill = c;
    for (const l of targets()) if (l.type === 'shape') editor.patchLayer(l.id, { fill: c }, 'Fill', `${l.id}:fill`);
    sync();
  };
  fillOn.addEventListener('change', setFill);
  fillIn.addEventListener('input', () => { fillOn.checked = true; setFill(); });

  // stroke width
  const widthIn = h('input', { type: 'number', class: 'num', min: 1, max: 200, step: 1 });
  widthIn.addEventListener('keydown', (e) => e.stopPropagation());
  widthIn.addEventListener('input', () => {
    const v = Number(widthIn.value);
    if (!(v >= 1)) return;
    style.strokeWidth = v;
    for (const l of targets()) {
      if (l.type === 'path' && l.opacity < 1 && l.name === 'Highlight') editor.patchLayer(l.id, { strokeWidth: v * 4 }, 'Stroke width', `${l.id}:w`);
      else if (l.type === 'shape' || l.type === 'line' || l.type === 'path') editor.patchLayer(l.id, { strokeWidth: v }, 'Stroke width', `${l.id}:w`);
    }
  });

  const radiusIn = h('input', { type: 'range', min: 0, max: 80, step: 1, class: 'range' });
  radiusIn.addEventListener('input', () => {
    style.radius = Number(radiusIn.value);
    for (const l of targets()) if (l.type === 'shape') editor.patchLayer(l.id, { radius: style.radius }, 'Corner radius', `${l.id}:r`);
  });

  // arrows
  const startArrow = h('button', { class: 'icon-btn tog', title: 'Arrowhead at start', onclick: () => {
    const l = targets().find((x) => x.type === 'line');
    if (l && l.type === 'line') patch({ startArrow: !l.startArrow }, 'Arrowhead');
  } }, icon('arrow', 16));
  (startArrow.firstChild as SVGElement).style.transform = 'rotate(180deg)';
  const endArrow = h('button', { class: 'icon-btn tog', title: 'Arrowhead at end', onclick: () => {
    const l = targets().find((x) => x.type === 'line');
    if (l && l.type === 'line') patch({ endArrow: !l.endArrow }, 'Arrowhead');
  } }, icon('arrow', 16));

  // blur
  const blurMode = h('select', { class: 'select' },
    h('option', { value: 'pixelate' }, 'Pixelate'),
    h('option', { value: 'blur' }, 'Blur'),
    h('option', { value: 'redact' }, 'Solid cover'),
  );
  blurMode.addEventListener('change', () => {
    style.blurMode = blurMode.value as ToolStyle['blurMode'];
    for (const l of targets()) if (l.type === 'blur') editor.patchLayer(l.id, { mode: style.blurMode }, 'Blur mode');
    sync();
  });
  const blurAmt = h('input', { type: 'range', min: 2, max: 80, step: 1, class: 'range' });
  blurAmt.addEventListener('input', () => {
    style.blurAmount = Number(blurAmt.value);
    for (const l of targets()) if (l.type === 'blur') editor.patchLayer(l.id, { amount: style.blurAmount }, 'Blur amount', `${l.id}:amt`);
  });
  const coverIn = h('input', { type: 'color', class: 'color' });
  coverIn.addEventListener('input', () => {
    for (const l of targets()) if (l.type === 'blur') editor.patchLayer(l.id, { color: coverIn.value }, 'Cover color', `${l.id}:cov`);
  });

  // stamps
  const stepIn = h('input', { type: 'text', class: 'num', maxlength: 3 });
  stepIn.addEventListener('keydown', (e) => e.stopPropagation());
  stepIn.addEventListener('input', () => {
    for (const l of targets()) if (l.type === 'stamp' && l.kind === 'step') editor.patchLayer(l.id, { text: stepIn.value || '1', name: `Step ${stepIn.value || 1}` }, 'Step number', `${l.id}:step`);
  });
  const emojiBtn = h('button', { class: 'btn ghost emoji-btn', title: 'Choose emoji' }, style.emoji);
  emojiBtn.addEventListener('click', () => openEmoji(emojiBtn));
  const sizeIn = h('input', { type: 'number', class: 'num', min: 8, max: 600, step: 2 });
  sizeIn.addEventListener('keydown', (e) => e.stopPropagation());
  sizeIn.addEventListener('input', () => {
    const v = Number(sizeIn.value);
    if (!(v >= 8)) return;
    style.stampSize = v;
    for (const l of targets()) {
      if (l.type !== 'stamp') continue;
      const cx = l.x + l.width / 2, cy = l.y + l.height / 2;
      editor.patchLayer(l.id, { width: v, height: v, x: cx - v / 2, y: cy - v / 2 }, 'Marker size', `${l.id}:size`);
    }
  });

  const row = (...k: Node[]) => h('div', { class: 'insp-row' }, ...k);
  const lbl = (t: string) => h('span', { class: 'num-label' }, t);
  const wrap = (cls: string, ...k: Node[]) => h('div', { class: cls }, ...k);

  const colorRow = wrap('s-color', row(lbl('Color'), h('span', { class: 'grow' }), colorIn), row(swatches));
  const fillRow = wrap('s-fill', row(h('label', { class: 'chk' }, fillOn, ' Fill'), h('span', { class: 'grow' }), fillIn));
  const widthRow = wrap('s-width', row(lbl('Width'), h('span', { class: 'grow' }), widthIn, h('span', { class: 'num-unit' }, 'px')));
  const radiusRow = wrap('s-radius', row(lbl('Corners'), radiusIn));
  const arrowRow = wrap('s-arrow', row(lbl('Arrowheads'), h('span', { class: 'grow' }), startArrow, endArrow));
  const blurRow = wrap('s-blur', row(lbl('Effect'), blurMode), row(lbl('Strength'), blurAmt), wrap('s-cover', row(lbl('Cover'), h('span', { class: 'grow' }), coverIn)));
  const stampRow = wrap('s-stamp', wrap('s-step', row(lbl('Number'), h('span', { class: 'grow' }), stepIn)), wrap('s-emoji', row(lbl('Emoji'), h('span', { class: 'grow' }), emojiBtn)), row(lbl('Size'), h('span', { class: 'grow' }), sizeIn, h('span', { class: 'num-unit' }, 'px')));

  const el = h('section', { class: 'insp-section' }, h('div', { class: 'insp-title' }, 'Style'), colorRow, fillRow, widthRow, radiusRow, arrowRow, blurRow, stampRow);

  function sync() {
    const t = targets();
    const tool = getTool();
    const drawing = DRAW_TOOLS.includes(tool) || tool === 'step' || tool === 'emoji';
    el.hidden = PAINT_TOOLS.includes(tool) || (!t.length && !drawing);
    if (el.hidden) return;

    const kind = (k: string) => has((l) => l.type === k) || (!t.length && toolKinds(tool).includes(k));
    const isShape = kind('shape');
    const isLine = kind('line');
    const isPath = kind('path');
    const isStamp = kind('stamp');
    const isBlur = kind('blur');
    const stepish = has((l) => l.type === 'stamp' && l.kind === 'step') || (!t.length && tool === 'step');
    const emojish = has((l) => l.type === 'stamp' && l.kind === 'emoji') || (!t.length && tool === 'emoji');
    const isHighlight = t.some((l) => l.type === 'path' && l.name === 'Highlight') || (!t.length && tool === 'highlight');

    colorRow.hidden = isBlur && !isShape && !isLine && !isPath && !isStamp || emojish && !stepish && !isShape && !isLine && !isPath;
    fillRow.hidden = !isShape;
    widthRow.hidden = !(isShape || isLine || isPath);
    radiusRow.hidden = !(has((l) => l.type === 'shape' && l.shape === 'rect') || (!t.length && tool === 'rect'));
    arrowRow.hidden = !(has((l) => l.type === 'line'));
    blurRow.hidden = !isBlur;
    stampRow.hidden = !isStamp;
    (stampRow.querySelector('.s-step') as HTMLElement).hidden = !stepish;
    (stampRow.querySelector('.s-emoji') as HTMLElement).hidden = !emojish;

    // reflect the first target's values (or the defaults)
    const first = t[t.length - 1];
    const color = first
      ? first.type === 'shape' ? first.stroke ?? style.color : 'color' in first ? (first as { color: string }).color : style.color
      : isHighlight ? style.highlight : style.color;
    colorIn.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#a78bfa';
    swatches.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.c === color.toLowerCase()));
    const fill = first && first.type === 'shape' ? first.fill : style.fill;
    fillOn.checked = !!fill;
    if (fill) fillIn.value = fill;
    if (document.activeElement !== widthIn) {
      const w = first && (first.type === 'shape' || first.type === 'line' || first.type === 'path')
        ? first.type === 'path' && first.name === 'Highlight' ? first.strokeWidth / 4 : first.strokeWidth
        : style.strokeWidth;
      widthIn.value = String(Math.round(w * 10) / 10);
    }
    radiusIn.value = String(first && first.type === 'shape' ? first.radius : style.radius);
    const ln = first && first.type === 'line' ? first : undefined;
    startArrow.classList.toggle('on', !!ln?.startArrow);
    endArrow.classList.toggle('on', !!ln?.endArrow);
    const bl = first && first.type === 'blur' ? first : undefined;
    blurMode.value = bl?.mode ?? style.blurMode;
    blurAmt.value = String(bl?.amount ?? style.blurAmount);
    coverIn.value = bl?.color ?? '#000000';
    (blurRow.querySelector('.s-cover') as HTMLElement).hidden = (bl?.mode ?? style.blurMode) !== 'redact';
    const st = first && first.type === 'stamp' ? first : undefined;
    if (document.activeElement !== stepIn) stepIn.value = st && st.kind === 'step' ? st.text : '';
    if (document.activeElement !== sizeIn) sizeIn.value = String(Math.round(st ? st.width : style.stampSize));
    emojiBtn.textContent = st && st.kind === 'emoji' ? st.text : style.emoji;
  }

  return { el, sync };
}

function toolKinds(tool: ToolId): string[] {
  switch (tool) {
    case 'rect': case 'ellipse': return ['shape'];
    case 'line': case 'arrow': return ['line'];
    case 'pen': case 'highlight': return ['path'];
    case 'blur': return ['blur'];
    case 'step': case 'emoji': return ['stamp'];
    default: return [];
  }
}
