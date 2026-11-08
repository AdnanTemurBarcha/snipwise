import { h as el } from './dom';

export interface NewCanvasResult {
  width: number;
  height: number;
  /** null = transparent */
  background: string | null;
}

interface Preset {
  group: string;
  name: string;
  w: number;
  h: number;
}

const PRESETS: Preset[] = [
  { group: 'Screen', name: 'Full HD', w: 1920, h: 1080 },
  { group: 'Screen', name: '4K UHD', w: 3840, h: 2160 },
  { group: 'Screen', name: 'Desktop', w: 1440, h: 900 },
  { group: 'Screen', name: 'Mobile', w: 390, h: 844 },
  { group: 'Social', name: 'Instagram post', w: 1080, h: 1080 },
  { group: 'Social', name: 'Instagram story', w: 1080, h: 1920 },
  { group: 'Social', name: 'X / Twitter post', w: 1600, h: 900 },
  { group: 'Social', name: 'YouTube thumbnail', w: 1280, h: 720 },
  { group: 'Social', name: 'Facebook cover', w: 820, h: 312 },
  { group: 'Social', name: 'LinkedIn banner', w: 1584, h: 396 },
  { group: 'Print (300 dpi)', name: 'A4', w: 2480, h: 3508 },
  { group: 'Print (300 dpi)', name: 'A5', w: 1748, h: 2480 },
  { group: 'Print (300 dpi)', name: 'US Letter', w: 2550, h: 3300 },
  { group: 'Print (300 dpi)', name: 'Photo 4 × 6 in', w: 1800, h: 1200 },
  { group: 'Icon', name: 'App icon', w: 1024, h: 1024 },
  { group: 'Icon', name: 'Favicon', w: 512, h: 512 },
];

export const MAX_SIDE = 8192;
const MAX_PIXELS = 40_000_000;
const KEY = 'snipwise.newCanvas';

export function validSize(w: number, h: number): string | null {
  if (!(w >= 1 && h >= 1)) return 'Width and height must be at least 1 px';
  if (w > MAX_SIDE || h > MAX_SIDE) return `Each side can be at most ${MAX_SIDE} px`;
  if (w * h > MAX_PIXELS) return 'That is more than 40 megapixels — try a smaller size';
  return null;
}

/** Photoshop-style "New" dialog. Resolves with the chosen canvas, or null if cancelled. */
export function openNewCanvasDialog(defaultSize: { w: number; h: number }): Promise<NewCanvasResult | null> {
  let saved: { w?: number; h?: number; bg?: string; custom?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    /* no storage */
  }
  return new Promise((resolve) => {
    let w = saved.w ?? defaultSize.w;
    let h = saved.h ?? defaultSize.h;
    let bg: 'transparent' | 'white' | 'black' | 'custom' = (saved.bg as typeof bg) ?? 'white';
    let custom = saved.custom ?? '#8b6cff';

    const num = (v: number) => {
      const i = el('input', { type: 'number', class: 'num nc-num', min: 1, max: MAX_SIDE, step: 1 });
      i.value = String(v);
      i.addEventListener('keydown', (e) => e.stopPropagation());
      return i;
    };
    const wIn = num(w);
    const hIn = num(h);
    const preset = el('select', { class: 'select' }, el('option', { value: '' }, 'Custom'));
    for (const g of [...new Set(PRESETS.map((p) => p.group))]) {
      const og = el('optgroup', { label: g });
      PRESETS.forEach((p, i) => {
        if (p.group === g) og.append(el('option', { value: String(i) }, `${p.name} — ${p.w} × ${p.h}`));
      });
      preset.append(og);
    }
    const swap = el('button', { class: 'btn ghost sm', title: 'Swap width and height' }, '⇄');
    const err = el('div', { class: 'nc-err' });
    const previewBox = el('div', { class: 'nc-preview-box' });
    const preview = el('div', { class: 'nc-preview' }, previewBox);
    const colorIn = el('input', { type: 'color', class: 'color' });
    colorIn.value = custom;

    const bgOpts: ['transparent' | 'white' | 'black' | 'custom', string][] = [['transparent', 'Transparent'], ['white', 'White'], ['black', 'Black'], ['custom', 'Color']];
    const bgBtns = bgOpts.map(([k, label]) => el('button', { class: 'seg', onclick: () => { bg = k; refresh(); } }, label));

    const bgCss = () => (bg === 'transparent' ? null : bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : custom);

    const matchPreset = () => {
      const i = PRESETS.findIndex((p) => p.w === w && p.h === h);
      preset.value = i < 0 ? '' : String(i);
    };

    const create = el('button', { class: 'btn primary' }, 'Create');
    function refresh() {
      const problem = validSize(w, h);
      err.textContent = problem ?? '';
      (create as HTMLButtonElement).disabled = !!problem;
      bgBtns.forEach((b, i) => b.classList.toggle('on', bgOpts[i][0] === bg));
      colorIn.hidden = bg !== 'custom';
      const ratio = w > 0 && h > 0 ? w / h : 1;
      const boxW = ratio >= 1 ? 160 : 160 * ratio;
      const boxH = ratio >= 1 ? 160 / ratio : 160;
      previewBox.style.width = `${Math.max(8, boxW)}px`;
      previewBox.style.height = `${Math.max(8, boxH)}px`;
      const c = bgCss();
      previewBox.style.background = c ?? '';
      previewBox.classList.toggle('transparent', c === null);
      previewBox.textContent = w && h ? `${w} × ${h}` : '';
      previewBox.style.color = c === '#000000' ? '#fff' : c === null || c === '#ffffff' ? '#64748b' : '#fff';
    }

    const fromInputs = () => {
      w = Math.round(Number(wIn.value));
      h = Math.round(Number(hIn.value));
      matchPreset();
      refresh();
    };
    wIn.addEventListener('input', fromInputs);
    hIn.addEventListener('input', fromInputs);
    preset.addEventListener('change', () => {
      const p = PRESETS[Number(preset.value)];
      if (!p) return;
      w = p.w;
      h = p.h;
      wIn.value = String(w);
      hIn.value = String(h);
      refresh();
    });
    swap.addEventListener('click', () => {
      [w, h] = [h, w];
      wIn.value = String(w);
      hIn.value = String(h);
      matchPreset();
      refresh();
    });
    colorIn.addEventListener('input', () => { custom = colorIn.value; refresh(); });

    const overlay = el('div', { class: 'modal-overlay nc-overlay' });
    const close = (result: NewCanvasResult | null) => {
      window.removeEventListener('keydown', onKey, true);
      overlay.remove();
      resolve(result);
    };
    const submit = () => {
      if (validSize(w, h)) return;
      try {
        localStorage.setItem(KEY, JSON.stringify({ w, h, bg, custom }));
      } catch {
        /* no storage */
      }
      close({ width: w, height: h, background: bgCss() });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); e.stopPropagation(); submit(); }
    };
    window.addEventListener('keydown', onKey, true);
    create.addEventListener('click', submit);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });

    const field = (label: string, ...kids: Node[]) => el('div', { class: 'nc-field' }, el('label', { class: 'nc-label' }, label), ...kids);
    overlay.append(
      el('div', { class: 'modal nc-modal', role: 'dialog', 'aria-label': 'New canvas' },
        el('div', { class: 'modal-header' }, 'New canvas', el('button', { class: 'modal-close', title: 'Close', onclick: () => close(null) }, '✕')),
        el('div', { class: 'nc-body' },
          el('div', { class: 'nc-form' },
            field('Preset', preset),
            field('Size', el('div', { class: 'nc-size' }, wIn, el('span', { class: 'num-unit' }, '×'), hIn, el('span', { class: 'num-unit' }, 'px'), swap)),
            field('Background', el('div', { class: 'segs' }, ...bgBtns), colorIn),
            err,
          ),
          preview,
        ),
        el('div', { class: 'nc-footer' }, el('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancel'), create),
      ),
    );
    document.body.append(overlay);
    overlay.style.display = 'flex';
    matchPreset();
    refresh();
    wIn.focus();
    wIn.select();
  });
}
