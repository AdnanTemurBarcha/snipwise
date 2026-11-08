import type { Editor } from '../engine/editor';
import { h } from './dom';
import { icon } from './icons';
import { PAINT_TOOLS, SELECT_TOOLS } from './paint';
import { SWATCHES } from './style-panel';
import type { ToolId, ToolStyle } from './stage';

export interface PaintActions {
  fill(): void;
  clear(): void;
  toLayer(cut: boolean): void;
  cropToSelection(): void;
  applyFilter(id: string, amount: number): void;
}

/** Tool options for the raster tools, plus actions on the pixel selection. */
export function initPaintPanel(
  editor: Editor,
  style: ToolStyle,
  getTool: () => ToolId,
  actions: PaintActions,
  onColor: () => void,
): { el: HTMLElement; sync(): void } {
  const row = (...k: Node[]) => h('div', { class: 'insp-row' }, ...k);
  const lbl = (t: string) => h('span', { class: 'num-label' }, t);
  const grow = () => h('span', { class: 'grow' });

  const syncers: (() => void)[] = [];
  const slider = (label: string, min: number, max: number, step: number, key: 'brushSize' | 'brushHardness' | 'brushOpacity' | 'tolerance', scale = 1, unit = '') => {
    const input = h('input', { type: 'range', min, max, step, class: 'range' });
    const out = h('span', { class: 'num-unit val' });
    input.addEventListener('input', () => {
      style[key] = Number(input.value) * scale;
      out.textContent = `${Math.round(Number(input.value))}${unit}`;
    });
    syncers.push(() => {
      input.value = String(Math.round(style[key] / scale));
      out.textContent = `${Math.round(style[key] / scale)}${unit}`;
    });
    return row(lbl(label), input, out);
  };

  const check = (label: string, key: 'contiguous' | 'gradientFade') => {
    const c = h('input', { type: 'checkbox' });
    c.addEventListener('change', () => { style[key] = c.checked; sync(); });
    syncers.push(() => { c.checked = style[key]; });
    return row(h('label', { class: 'chk' }, c, ` ${label}`));
  };

  // colours
  const color1 = h('input', { type: 'color', class: 'color', title: 'Color' });
  const color2 = h('input', { type: 'color', class: 'color', title: 'Second color' });
  color1.addEventListener('input', () => { style.color = color1.value; onColor(); });
  color2.addEventListener('input', () => { style.color2 = color2.value; });
  const swatches = h('div', { class: 'swatches' });
  for (const c of SWATCHES) {
    swatches.append(h('button', { class: 'swatch', style: `background:${c}`, title: c, 'data-c': c, onclick: () => { style.color = c; onColor(); } }));
  }
  const colorRow = row(lbl('Color'), grow(), color1);
  const color2Row = row(lbl('To'), grow(), color2);
  const swatchRow = row(swatches);

  const gType = h('select', { class: 'select' }, h('option', { value: 'linear' }, 'Linear'), h('option', { value: 'radial' }, 'Radial'));
  gType.addEventListener('change', () => { style.gradientType = gType.value as ToolStyle['gradientType']; });
  const gradRow = row(lbl('Type'), gType);

  // selection mode
  const modes: ['replace' | 'add' | 'subtract', string, string][] = [['replace', 'New', 'Replace the selection'], ['add', 'Add', 'Add to the selection (Shift)'], ['subtract', 'Subtract', 'Subtract from the selection (Alt)']];
  const modeBtns = modes.map(([m, label, title]) =>
    h('button', { class: 'seg', title, onclick: () => { style.selMode = m; syncAll(); } }, label),
  );
  const modeRow = row(h('div', { class: 'segs' }, ...modeBtns));

  const toolRows = {
    brush: [slider('Size', 1, 400, 1, 'brushSize', 1, 'px'), slider('Hardness', 0, 100, 1, 'brushHardness', 0.01, '%'), slider('Opacity', 1, 100, 1, 'brushOpacity', 0.01, '%')],
    eraser: [slider('Size', 1, 400, 1, 'brushSize', 1, 'px'), slider('Hardness', 0, 100, 1, 'brushHardness', 0.01, '%'), slider('Opacity', 1, 100, 1, 'brushOpacity', 0.01, '%')],
    clone: [slider('Size', 1, 400, 1, 'brushSize', 1, 'px'), slider('Hardness', 0, 100, 1, 'brushHardness', 0.01, '%'), slider('Opacity', 1, 100, 1, 'brushOpacity', 0.01, '%'), h('p', { class: 'hint tiny' }, 'Alt-click to set the source, then paint.')],
    bucket: [slider('Tolerance', 0, 255, 1, 'tolerance'), check('Contiguous', 'contiguous'), slider('Opacity', 1, 100, 1, 'brushOpacity', 0.01, '%')],
    gradient: [gradRow, check('Fade to transparent', 'gradientFade'), slider('Opacity', 1, 100, 1, 'brushOpacity', 0.01, '%'), h('p', { class: 'hint tiny' }, 'Drag across the canvas · Shift snaps the angle.')],
    eyedropper: [h('p', { class: 'hint tiny' }, 'Click or drag to pick a color. Alt-click works with any tool.')],
    selrect: [modeRow, h('p', { class: 'hint tiny' }, 'Shift/Alt while dragging: square / from center.')],
    selellipse: [modeRow, h('p', { class: 'hint tiny' }, 'Shift/Alt while dragging: circle / from center.')],
    lasso: [modeRow, h('p', { class: 'hint tiny' }, 'Draw freehand around the area.')],
    wand: [modeRow, slider('Tolerance', 0, 255, 1, 'tolerance'), check('Contiguous', 'contiguous'), h('p', { class: 'hint tiny' }, 'Click a color to select it.')],
  } as Record<string, HTMLElement[]>;

  const optionsHost = h('div', { class: 'tool-options' });
  const options = h('section', { class: 'insp-section' }, h('div', { class: 'insp-title opt-title' }, 'Tool'), colorRow, color2Row, swatchRow, optionsHost);

  // ── selection actions ─────────────────────────────────────────────────────
  const num = (value: number, min: number, max: number) => {
    const i = h('input', { type: 'number', class: 'num', min, max, step: 1 });
    i.value = String(value);
    i.addEventListener('keydown', (e) => e.stopPropagation());
    return i;
  };
  const featherIn = num(4, 0, 200);
  const growIn = num(2, 1, 200);
  const btn = (label: string, title: string, fn: () => void, ic?: string) =>
    h('button', { class: 'btn ghost sm', title, onclick: fn }, ...(ic ? [icon(ic, 14)] : []), label);

  const sel = editor.pixelSel;
  const selEl = h('section', { class: 'insp-section' },
    h('div', { class: 'insp-title' }, 'Selection'),
    h('div', { class: 'btn-grid' },
      btn('Select all', 'Select the whole canvas', () => editor.editSelection('Select all', (s) => s.selectAll(editor.page.width, editor.page.height))),
      btn('Invert', 'Invert the selection (Ctrl+Shift+I)', () => editor.editSelection('Invert selection', (s) => s.invert(editor.page.width, editor.page.height))),
      btn('Deselect', 'Drop the selection (Esc)', () => editor.editSelection('Deselect', (s) => s.clear())),
    ),
    row(lbl('Feather'), grow(), featherIn, h('span', { class: 'num-unit' }, 'px'), btn('Apply', 'Soften the selection edge', () => editor.editSelection('Feather', (s) => s.feather(Number(featherIn.value) || 0)))),
    row(lbl('Grow / shrink'), grow(), growIn, h('span', { class: 'num-unit' }, 'px'),
      btn('+', 'Grow the selection', () => editor.editSelection('Grow selection', (s) => s.expand(Number(growIn.value) || 0))),
      btn('−', 'Shrink the selection', () => editor.editSelection('Shrink selection', (s) => s.expand(-(Number(growIn.value) || 0))))),
    h('div', { class: 'btn-grid' },
      btn('Fill', 'Fill with the current color', actions.fill),
      btn('Clear', 'Delete the selected pixels (Delete)', actions.clear),
      btn('Copy to layer', 'Copy the selection to a new layer (Ctrl+J)', () => actions.toLayer(false)),
      btn('Cut to layer', 'Move the selection to a new layer (Ctrl+Shift+J)', () => actions.toLayer(true)),
      btn('Crop to it', 'Crop the canvas to the selection bounds', actions.cropToSelection),
    ),
  );

  let renderedTool: ToolId | null = null;
  const maskHint = h('div', { class: 'mask-hint' },
    h('span', {}, 'Editing layer mask — brush reveals, eraser hides'),
    h('button', { class: 'btn ghost sm', onclick: () => editor.setMaskEdit(false) }, 'Done'),
  );
  options.insertBefore(maskHint, options.children[1]);
  const el = h('div', { class: 'paint-panel' }, options, selEl);

  function syncAll() {
    sync();
  }

  function sync() {
    const tool = getTool();
    const isPaint = PAINT_TOOLS.includes(tool);
    options.hidden = !isPaint;
    maskHint.hidden = !editor.maskEdit;
    selEl.hidden = !(sel.active && !!editor.page.width);
    if (isPaint) {
      (options.querySelector('.opt-title') as HTMLElement).textContent =
        { brush: 'Brush', eraser: 'Eraser', clone: 'Clone stamp', bucket: 'Paint bucket', gradient: 'Gradient', eyedropper: 'Eyedropper', selrect: 'Rectangular marquee', selellipse: 'Elliptical marquee', lasso: 'Lasso', wand: 'Magic wand' }[tool as string] ?? 'Tool';
      if (renderedTool !== tool) {
        renderedTool = tool;
        optionsHost.replaceChildren(...(toolRows[tool] ?? []));
      }
      const usesColor = ['brush', 'bucket', 'gradient'].includes(tool);
      colorRow.hidden = !usesColor;
      swatchRow.hidden = !usesColor;
      color2Row.hidden = tool !== 'gradient' || style.gradientFade;
      color1.value = /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : '#a78bfa';
      color2.value = style.color2;
      gType.value = style.gradientType;
      swatches.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.c === style.color.toLowerCase()));
      modeBtns.forEach((b, i) => b.classList.toggle('on', style.selMode === modes[i][0]));
      syncers.forEach((f) => f());
    }
  }

  return { el, sync };
}

export { SELECT_TOOLS };
