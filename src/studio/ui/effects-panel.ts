import type { Editor } from '../engine/editor';
import type { Adjustments, DropShadow, Layer, LayerFx, Levels, OutlineFx } from '../engine/types';
import { FILTERS } from '../engine/filters';
import type { PaintActions } from './paint-panel';
import { icon } from './icons';
import { ADJUST_PRESETS, defaultAdjustments, defaultLevels, isIdentityAdjust, isIdentityLevels } from '../engine/adjust';
import { h } from './dom';

const DEFAULT_SHADOW: DropShadow = { color: '#000000', blur: 12, x: 0, y: 6, opacity: 0.45 };
const DEFAULT_STROKE: OutlineFx = { color: '#ffffff', width: 4 };

type NumKey = 'brightness' | 'contrast' | 'saturation' | 'hue' | 'grayscale' | 'sepia' | 'invert' | 'blur';
const ADJ_ROWS: { key: NumKey; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
  { key: 'hue', label: 'Hue', min: -180, max: 180 },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100 },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100 },
  { key: 'invert', label: 'Invert', min: 0, max: 100 },
  { key: 'blur', label: 'Blur', min: 0, max: 40 },
];

/** Drop shadow, outline and colour adjustments for the selected layers (all non-destructive). */
export function initEffectsPanel(editor: Editor, actions: PaintActions): { el: HTMLElement; sync(): void } {
  const targets = () => editor.selected;
  const syncers: (() => void)[] = [];
  const row = (...k: Node[]) => h('div', { class: 'insp-row' }, ...k);
  const lbl = (t: string) => h('span', { class: 'num-label' }, t);
  const grow = () => h('span', { class: 'grow' });

  // ── model helpers ─────────────────────────────────────────────────────────
  const getAdjust = (l: Layer): Adjustments => (l.type === 'adjust' ? l.adjust : l.fx?.adjust ?? defaultAdjustments());
  const patchFx = (l: Layer, fx: LayerFx, key: string, label: string) =>
    editor.patchLayer(l.id, { fx }, label, `${l.id}:${key}`);
  const setAdjust = (l: Layer, a: Adjustments, key = 'adj', label = 'Adjust') => {
    if (l.type === 'adjust') editor.patchLayer(l.id, { adjust: a }, label, `${l.id}:${key}`);
    else patchFx(l, { ...l.fx, adjust: isIdentityAdjust(a) ? null : a }, key, label);
  };
  const first = () => targets()[targets().length - 1];

  // ── generic slider row ────────────────────────────────────────────────────
  function slider(label: string, min: number, max: number, step: number, get: (l: Layer) => number, set: (l: Layer, v: number) => void, unit = '') {
    const input = h('input', { type: 'range', min, max, step, class: 'range' });
    const out = h('span', { class: 'num-unit val' });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = `${Math.round(v * 100) / 100}${unit}`;
      for (const l of targets()) set(l, v);
    });
    input.addEventListener('dblclick', () => {
      input.value = String(min < 0 ? 0 : min);
      input.dispatchEvent(new Event('input'));
    });
    syncers.push(() => {
      const l = first();
      if (!l) return;
      const v = get(l);
      if (document.activeElement !== input) input.value = String(v);
      out.textContent = `${Math.round(v * 100) / 100}${unit}`;
    });
    const r = row(lbl(label), input, out);
    r.title = 'Double-click the slider to reset';
    return r;
  }

  // ── shadow ────────────────────────────────────────────────────────────────
  const shadowOn = h('input', { type: 'checkbox' });
  const shadowColor = h('input', { type: 'color', class: 'color' });
  const setShadow = (mut: (s: DropShadow) => DropShadow | null, key = 'shadow') => {
    for (const l of targets()) {
      const cur = l.fx?.shadow ?? null;
      patchFx(l, { ...l.fx, shadow: mut(cur ?? DEFAULT_SHADOW) }, key, 'Drop shadow');
    }
  };
  shadowOn.addEventListener('change', () => setShadow((s) => (shadowOn.checked ? s : null), 'shadow-on'));
  shadowColor.addEventListener('input', () => setShadow((s) => ({ ...s, color: shadowColor.value }), 'shadow-c'));
  const shadowRows = [
    slider('Blur', 0, 80, 1, (l) => l.fx?.shadow?.blur ?? DEFAULT_SHADOW.blur, (l, v) => patchFx(l, { ...l.fx, shadow: { ...(l.fx?.shadow ?? DEFAULT_SHADOW), blur: v } }, 'shadow-b', 'Shadow blur'), 'px'),
    slider('X', -100, 100, 1, (l) => l.fx?.shadow?.x ?? DEFAULT_SHADOW.x, (l, v) => patchFx(l, { ...l.fx, shadow: { ...(l.fx?.shadow ?? DEFAULT_SHADOW), x: v } }, 'shadow-x', 'Shadow offset'), 'px'),
    slider('Y', -100, 100, 1, (l) => l.fx?.shadow?.y ?? DEFAULT_SHADOW.y, (l, v) => patchFx(l, { ...l.fx, shadow: { ...(l.fx?.shadow ?? DEFAULT_SHADOW), y: v } }, 'shadow-y', 'Shadow offset'), 'px'),
    slider('Opacity', 0, 100, 1, (l) => Math.round((l.fx?.shadow?.opacity ?? DEFAULT_SHADOW.opacity) * 100), (l, v) => patchFx(l, { ...l.fx, shadow: { ...(l.fx?.shadow ?? DEFAULT_SHADOW), opacity: v / 100 } }, 'shadow-o', 'Shadow opacity'), '%'),
  ];
  const shadowBody = h('div', {}, ...shadowRows);

  // ── outline ───────────────────────────────────────────────────────────────
  const strokeOn = h('input', { type: 'checkbox' });
  const strokeColor = h('input', { type: 'color', class: 'color' });
  const setStroke = (mut: (s: OutlineFx) => OutlineFx | null, key = 'stroke') => {
    for (const l of targets()) patchFx(l, { ...l.fx, stroke: mut(l.fx?.stroke ?? DEFAULT_STROKE) }, key, 'Outline');
  };
  strokeOn.addEventListener('change', () => setStroke((s) => (strokeOn.checked ? s : null), 'stroke-on'));
  strokeColor.addEventListener('input', () => setStroke((s) => ({ ...s, color: strokeColor.value }), 'stroke-c'));
  const strokeBody = h('div', {}, slider('Width', 1, 40, 1, (l) => l.fx?.stroke?.width ?? DEFAULT_STROKE.width, (l, v) => patchFx(l, { ...l.fx, stroke: { ...(l.fx?.stroke ?? DEFAULT_STROKE), width: v } }, 'stroke-w', 'Outline width'), 'px'));

  const effects = h('section', { class: 'insp-section' },
    h('div', { class: 'insp-title' }, 'Effects'),
    row(h('label', { class: 'chk' }, shadowOn, ' Drop shadow'), grow(), shadowColor),
    shadowBody,
    row(h('label', { class: 'chk' }, strokeOn, ' Outline'), grow(), strokeColor),
    strokeBody,
  );

  // ── adjustments ───────────────────────────────────────────────────────────
  // built-in presets plus the user's own (kept in extension storage)
  type Saved = { name: string; adjust: Adjustments };
  let custom: Saved[] = [];
  const store = (typeof chrome !== 'undefined' && chrome.storage?.local) || null;
  const persist = () => {
    try {
      if (store) store.set({ adjustPresets: custom });
      else localStorage.setItem('snipwise.adjustPresets', JSON.stringify(custom));
    } catch { /* storage unavailable: presets last for this session */ }
  };
  const loaded = (list: unknown) => {
    if (Array.isArray(list)) custom = list.filter((p): p is Saved => !!p && typeof p.name === 'string' && !!p.adjust);
    fillPresets();
    syncPreset();
  };
  try {
    if (store) store.get(['adjustPresets'], (r: { adjustPresets?: unknown }) => loaded(r?.adjustPresets));
    else loaded(JSON.parse(localStorage.getItem('snipwise.adjustPresets') || '[]'));
  } catch { /* no saved presets */ }

  const preset = h('select', { class: 'select', title: 'Apply a look' });
  const keys: (keyof Adjustments)[] = ['brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'sepia', 'invert', 'blur'];
  const same = (a: Adjustments, b: Partial<Adjustments>) => keys.every((k) => (a[k] as number) === ((b[k] as number | undefined) ?? 0));
  function fillPresets() {
    preset.replaceChildren(
      h('option', { value: 'none' }, 'No preset'),
      h('option', { value: 'custom', disabled: true, hidden: true }, 'Custom'),
      (() => { const g = h('optgroup', { label: 'Built-in' }); ADJUST_PRESETS.forEach((p, i) => g.append(h('option', { value: `b${i}` }, p.name))); return g; })(),
      ...(custom.length ? [(() => { const g = h('optgroup', { label: 'My presets' }); custom.forEach((p, i) => g.append(h('option', { value: `c${i}` }, p.name))); return g; })()] : []),
    );
  }
  /** Show which preset the selection currently matches, or "Custom" once the sliders were moved. */
  function syncPreset() {
    const l = first();
    if (!l) return;
    const a = getAdjust(l);
    let v = 'custom';
    if (isIdentityAdjust(a)) v = 'none';
    else {
      const ci = custom.findIndex((p) => same(a, p.adjust) && JSON.stringify(a.levels ?? null) === JSON.stringify(p.adjust.levels ?? null));
      const bi = ADJUST_PRESETS.findIndex((p) => same(a, p.adjust));
      if (ci >= 0) v = `c${ci}`;
      else if (bi >= 0) v = `b${bi}`;
    }
    preset.value = v;
    delBtn.hidden = !v.startsWith('c');
  }
  preset.addEventListener('change', () => {
    const v = preset.value;
    for (const l of targets()) {
      if (v === 'none') setAdjust(l, { ...defaultAdjustments(), levels: getAdjust(l).levels ?? null }, 'adj-preset', 'Adjust: none');
      else if (v.startsWith('b')) {
        const p = ADJUST_PRESETS[Number(v.slice(1))];
        setAdjust(l, { ...defaultAdjustments(), levels: getAdjust(l).levels ?? null, ...p.adjust }, 'adj-preset', `Adjust: ${p.name}`);
      } else if (v.startsWith('c')) {
        const p = custom[Number(v.slice(1))];
        if (p) setAdjust(l, { ...defaultAdjustments(), ...p.adjust }, 'adj-preset', `Adjust: ${p.name}`);
      }
    }
    syncPreset();
  });
  const reset = h('button', { class: 'btn ghost sm', title: 'Remove all adjustments', onclick: () => { for (const l of targets()) setAdjust(l, defaultAdjustments(), 'adj-reset', 'Reset adjustments'); } }, 'Reset');

  // save the current look as a preset
  const nameIn = h('input', { type: 'text', class: 'num nc-name', placeholder: 'Preset name', maxlength: 40 });
  nameIn.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') saveRow.hidden = true;
  });
  const saveRow = h('div', { class: 'insp-row' }, nameIn, h('button', { class: 'btn primary sm', onclick: () => confirmSave() }, 'Save'), h('button', { class: 'btn ghost sm', onclick: () => { saveRow.hidden = true; } }, 'Cancel'));
  saveRow.hidden = true;
  function confirmSave() {
    const l = first();
    const name = nameIn.value.trim();
    if (!l || !name) return;
    const a = { ...getAdjust(l) };
    const i = custom.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) custom[i] = { name: custom[i].name, adjust: a };
    else custom.push({ name, adjust: a });
    persist();
    fillPresets();
    saveRow.hidden = true;
    nameIn.value = '';
    syncPreset();
  }
  const saveBtn = h('button', { class: 'btn ghost sm', title: 'Save the current adjustments as a preset', onclick: () => {
    const l = first();
    if (!l || isIdentityAdjust(getAdjust(l))) return;
    saveRow.hidden = !saveRow.hidden;
    if (!saveRow.hidden) nameIn.focus();
  } }, 'Save…');
  const delBtn = h('button', { class: 'btn ghost sm', title: 'Delete this saved preset', onclick: () => {
    const i = Number(preset.value.slice(1));
    if (preset.value.startsWith('c') && custom[i]) {
      custom.splice(i, 1);
      persist();
      fillPresets();
      syncPreset();
    }
  } }, 'Delete');
  delBtn.hidden = true;
  fillPresets();

  const adjRows = ADJ_ROWS.map((r) =>
    slider(r.label, r.min, r.max, 1, (l) => getAdjust(l)[r.key], (l, v) => setAdjust(l, { ...getAdjust(l), [r.key]: v }, `adj-${r.key}`, `Adjust ${r.label.toLowerCase()}`), r.key === 'hue' ? '°' : r.key === 'blur' ? 'px' : ''),
  );

  const lv = (l: Layer): Levels => getAdjust(l).levels ?? defaultLevels();
  const setLv = (l: Layer, p: Partial<Levels>, key: string) => {
    const next = { ...lv(l), ...p };
    setAdjust(l, { ...getAdjust(l), levels: isIdentityLevels(next) ? null : next }, key, 'Adjust levels');
  };
  const levelRows = [
    slider('Black', 0, 254, 1, (l) => lv(l).inBlack, (l, v) => setLv(l, { inBlack: Math.min(v, lv(l).inWhite - 1) }, 'lv-b')),
    slider('Gamma', 0.2, 3, 0.05, (l) => lv(l).gamma, (l, v) => setLv(l, { gamma: v }, 'lv-g')),
    slider('White', 1, 255, 1, (l) => lv(l).inWhite, (l, v) => setLv(l, { inWhite: Math.max(v, lv(l).inBlack + 1) }, 'lv-w')),
  ];

  const adjTitle = h('div', { class: 'insp-title' }, 'Adjustments');
  const adjust = h('section', { class: 'insp-section' },
    adjTitle,
    row(preset, saveBtn, delBtn, reset),
    saveRow,
    ...adjRows,
    h('div', { class: 'insp-sub' }, 'Levels'),
    ...levelRows,
  );

  // ── mask ──────────────────────────────────────────────────────────────────
  const btn = (label: string, title: string, fn: () => void) => h('button', { class: 'btn ghost sm', title, onclick: fn }, label);
  const one = () => (editor.selection.length === 1 ? editor.primary : undefined);
  const fromSel = btn('From selection', 'Keep only the selected area visible', () => { const l = one(); if (l) editor.addMask(l.id, 'selection'); });
  const addBtns = h('div', { class: 'btn-grid' },
    btn('Reveal all', 'Add a mask that shows everything — then erase to hide', () => { const l = one(); if (l) editor.addMask(l.id, 'reveal'); }),
    btn('Hide all', 'Add a mask that hides everything — then brush to reveal', () => { const l = one(); if (l) editor.addMask(l.id, 'hide'); }),
    fromSel,
  );
  const editBtn = h('button', { class: 'btn ghost sm tog-btn', title: 'Paint the mask with the brush tools', onclick: () => editor.setMaskEdit(!editor.maskEdit) }, icon('brush', 14), 'Edit mask');
  const maskBtns = h('div', { class: 'btn-grid' }, editBtn,
    btn('Invert', 'Swap visible and hidden areas', () => { const l = one(); if (l) editor.invertMask(l.id); }),
    btn('Delete', 'Remove the mask', () => { const l = one(); if (l) editor.removeMask(l.id); }),
  );
  const maskHelp = h('p', { class: 'hint tiny' }, 'Brush reveals, eraser hides. Hidden areas stay in the layer — nothing is lost.');
  const maskSection = h('section', { class: 'insp-section' }, h('div', { class: 'insp-title' }, 'Layer mask'), addBtns, maskBtns, maskHelp);

  // ── filters (destructive) ─────────────────────────────────────────────────
  const filterSel = h('select', { class: 'select' }, ...FILTERS.map((f) => h('option', { value: f.id }, f.label)));
  const amount = h('input', { type: 'range', class: 'range' });
  const amountOut = h('span', { class: 'num-unit val' });
  const amountLbl = lbl('Amount');
  const amountRow = row(amountLbl, amount, amountOut);
  const syncFilter = () => {
    const f = FILTERS.find((x) => x.id === filterSel.value)!;
    amountRow.hidden = !f.param;
    if (f.param) {
      amountLbl.textContent = f.param.label;
      amount.min = String(f.param.min);
      amount.max = String(f.param.max);
      amount.step = String(f.param.step);
      amount.value = String(f.param.value);
      amountOut.textContent = `${f.param.value}${f.param.unit ?? ''}`;
    }
  };
  filterSel.addEventListener('change', syncFilter);
  amount.addEventListener('input', () => {
    const f = FILTERS.find((x) => x.id === filterSel.value)!;
    amountOut.textContent = `${amount.value}${f.param?.unit ?? ''}`;
  });
  syncFilter();
  const filterSection = h('section', { class: 'insp-section' },
    h('div', { class: 'insp-title' }, 'Filters'),
    row(filterSel),
    amountRow,
    row(h('span', { class: 'hint tiny grow' }, 'Permanent edit to this layer’s pixels — limited to the selection if there is one.'), btn('Apply', 'Apply the filter (undoable)', () => actions.applyFilter(filterSel.value, Number(amount.value)))),
  );

  const el = h('div', { class: 'effects-panel' }, effects, adjust, maskSection, filterSection);

  function sync() {
    const t = targets();
    const any = t.length > 0;
    const l = first();
    effects.hidden = !any || t.every((x) => x.type === 'adjust');
    adjust.hidden = !any;
    if (!any || !l) return;
    adjTitle.textContent = l.type === 'adjust' ? 'Adjustment layer' : 'Adjustments';
    const sh = l.fx?.shadow;
    shadowOn.checked = !!sh;
    shadowColor.value = /^#[0-9a-f]{6}$/i.test(sh?.color ?? '') ? sh!.color : DEFAULT_SHADOW.color;
    shadowBody.hidden = !sh;
    const st = l.fx?.stroke;
    strokeOn.checked = !!st;
    strokeColor.value = /^#[0-9a-f]{6}$/i.test(st?.color ?? '') ? st!.color : DEFAULT_STROKE.color;
    strokeBody.hidden = !st;
    syncers.forEach((f) => f());
    syncPreset();

    const single = one();
    const maskable = !!single && single.type !== 'blur';
    maskSection.hidden = !maskable;
    if (single) {
      addBtns.hidden = !!single.mask;
      maskBtns.hidden = !single.mask;
      maskHelp.hidden = false;
      (fromSel as HTMLButtonElement).disabled = !editor.pixelSel.active;
      editBtn.classList.toggle('on', editor.maskEdit);
    }
    filterSection.hidden = !(single && single.type === 'image');
  }

  return { el, sync };
}
