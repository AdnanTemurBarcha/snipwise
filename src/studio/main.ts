import { Editor } from './engine/editor';
import { createImageLayer } from './engine/document';
import { trimTransparent } from './engine/raster';
import { flattenPage } from './engine/render';
import { Stage, type ToolId, type ToolStyle } from './ui/stage';
import { SELECT_TOOLS } from './ui/paint';
import { openNewCanvasDialog } from './ui/new-canvas';
import { openEmojiPicker } from './ui/emoji-picker';
import { TextEditor } from './ui/text-editor';
import { initInspector, type TextDefaults } from './ui/inspector';
import { initLayersPanel } from './ui/layers-panel';
import { initPagesPanel } from './ui/pages-panel';
import { $, h } from './ui/dom';
import { icon } from './ui/icons';
// Capture hand-off, file/paste/drop import, PDF dialog.
import {
  loadCaptureFromBackground, loadImage, loadImageFromFile, openFilePicker, setupDragDrop, setupPaste,
} from './io/import.js';
import { openPdfExportDialog } from './ui/pdf-export-dialog.js';

const editor = new Editor();
const toolStyle: ToolStyle = {
  color: '#a78bfa', fill: null, strokeWidth: 4, radius: 0, blurMode: 'pixelate', blurAmount: 12,
  emoji: '👍', stampSize: 36, highlight: '#facc15',
  brushSize: 24, brushHardness: 0.8, brushOpacity: 1, tolerance: 32, contiguous: true,
  gradientType: 'linear', color2: '#ffffff', gradientFade: false, selMode: 'replace',
};
const defaults: TextDefaults = { fontSize: 28, color: '#a78bfa', fill: '#a78bfa', fontWeight: 600, italic: false, align: 'left', lineHeight: 1.3 };

// ── theme ───────────────────────────────────────────────────────────────────
chrome.storage.local.get(['theme'], (r) => document.documentElement.classList.toggle('dark', r.theme === 'dark'));

// ── status helpers ──────────────────────────────────────────────────────────
const statusEl = $('#statusText');
let statusTimer = 0;
function setStatus(msg: string) {
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (statusEl.textContent = 'Ready'), 4000);
}

// ── core UI ─────────────────────────────────────────────────────────────────
const stageHost = $('#stageHost');
let textEditor: TextEditor | undefined;
const stage: Stage = new Stage(stageHost, editor, {
  onZoomChange(zoom) {
    $('#zoomLevel').textContent = `${Math.round(zoom * 100)}%`;
    textEditor?.place();
  },
  onToolChange(t) {
    document.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    showToolName(t);
    inspector.sync();
    if (t === 'emoji') {
      const btn = document.querySelector<HTMLElement>('.tool[data-tool="emoji"]');
      if (btn) pickEmoji(btn);
    }
  },
  editText: (o) => textEditor?.open(o),
  style: () => toolStyle,
  onCropChange: (active) => $('#cropBar').classList.toggle('on', active),
  setColor(c) {
    toolStyle.color = c;
    inspector.sync();
  },
  status: (m) => setStatus(m),
});
textEditor = new TextEditor(stageHost, editor, stage, () => defaults);

function pickEmoji(anchor: HTMLElement) {
  const sel = editor.selected.find((l) => l.type === 'stamp' && l.kind === 'emoji');
  openEmojiPicker(anchor, sel && sel.type === 'stamp' ? sel.text : toolStyle.emoji, (e) => {
    toolStyle.emoji = e;
    if (sel) editor.patchLayer(sel.id, { text: e, name: `Emoji ${e}` }, 'Change emoji');
    inspector.sync();
  });
}

const paintActions = {
  fill: () => stage.paint.fillSelection(),
  clear: () => { if (!stage.paint.clearSelection()) setStatus('Select an unlocked image layer to clear pixels on'); },
  toLayer: (cut: boolean) => { if (!stage.paint.selectionToLayer(cut)) setStatus('Nothing to copy'); },
  applyFilter: (id: string, amount: number) => void stage.paint.applyFilter(id, amount),
  cropToSelection: () => {
    const b = editor.pixelSel.bounds();
    if (b) { editor.cropTo(b); setStatus('Cropped to selection · undo restores everything'); }
  },
};
const inspector = initInspector($('#inspector'), editor, defaults, () => stage.tool, toolStyle, pickEmoji, paintActions);
const layers = initLayersPanel($('#layersPanel'), editor);
const pages = initPagesPanel($('#pagesPanel'), editor, () => void newCanvas());

// ── toolbar ─────────────────────────────────────────────────────────────────
const TOOLS: ({ id: ToolId; icon: string; title: string; key: string } | 'sep')[] = [
  { id: 'select', icon: 'select', title: 'Select & transform (V)', key: 'v' },
  { id: 'hand', icon: 'hand', title: 'Pan (H) — or hold Space', key: 'h' },
  'sep',
  { id: 'selrect', icon: 'selrect', title: 'Rectangular marquee (M)', key: 'm' },
  { id: 'selellipse', icon: 'selellipse', title: 'Elliptical marquee (Shift+M)', key: '' },
  { id: 'lasso', icon: 'lasso', title: 'Lasso (Q)', key: 'q' },
  { id: 'wand', icon: 'wand', title: 'Magic wand (W)', key: 'w' },
  'sep',
  { id: 'brush', icon: 'brush', title: 'Brush (B)', key: 'b' },
  { id: 'eraser', icon: 'eraser', title: 'Eraser (E)', key: 'e' },
  { id: 'bucket', icon: 'bucket', title: 'Paint bucket (K)', key: 'k' },
  { id: 'gradient', icon: 'gradient', title: 'Gradient (G)', key: 'g' },
  { id: 'eyedropper', icon: 'eyedropper', title: 'Eyedropper (I)', key: 'i' },
  { id: 'clone', icon: 'clone', title: 'Clone stamp (S) — Alt-click to set source', key: 's' },
  'sep',
  { id: 'text', icon: 'text', title: 'Text (T)', key: 't' },
  { id: 'callout', icon: 'callout', title: 'Callout (O)', key: 'o' },
  'sep',
  { id: 'rect', icon: 'rect', title: 'Rectangle (R)', key: 'r' },
  { id: 'ellipse', icon: 'ellipse', title: 'Ellipse (C)', key: 'c' },
  { id: 'line', icon: 'line', title: 'Line (L)', key: 'l' },
  { id: 'arrow', icon: 'arrow', title: 'Arrow (A)', key: 'a' },
  { id: 'pen', icon: 'pen', title: 'Pen (P)', key: 'p' },
  { id: 'highlight', icon: 'highlight', title: 'Highlighter (Y)', key: 'y' },
  'sep',
  { id: 'blur', icon: 'blur', title: 'Blur / pixelate / redact (U)', key: 'u' },
  { id: 'step', icon: 'step', title: 'Step marker (N)', key: 'n' },
  { id: 'emoji', icon: 'emoji', title: 'Emoji (J)', key: 'j' },
  'sep',
  { id: 'crop', icon: 'crop', title: 'Crop canvas (X)', key: 'x' },
];
function showToolName(id: ToolId) {
  const t = TOOLS.find((x): x is Exclude<typeof x, 'sep'> => x !== 'sep' && x.id === id);
  $('#toolName').textContent = t ? t.title.replace(/\s*[(—].*$/, '') : '';
}
showToolName('select');
const rail = $('#toolrail');
for (const t of TOOLS) {
  if (t === 'sep') { rail.append(h('div', { class: 'tool-sep' })); continue; }
  const b = h('button', { class: `tool${t.id === 'select' ? ' active' : ''}`, title: t.title, 'data-tool': t.id, onclick: () => stage.setTool(t.id) }, icon(t.icon, 20));
  rail.append(b);
}

// crop confirm bar
$('#cropBar').append(
  h('span', { class: 'hint' }, 'Drag to set the crop · non-destructive'),
  h('button', { class: 'btn ghost', onclick: () => stage.cancelCrop() }, 'Cancel'),
  h('button', { class: 'btn primary', onclick: () => stage.applyCrop() }, icon('check', 16), 'Apply crop'),
);

const withIcon = (el: HTMLElement, name: string, label?: string) => {
  el.prepend(icon(name, 16));
  if (label) el.append(label);
};
withIcon($('#btnNew'), 'plus', 'New');
withIcon($('#btnNewEmpty'), 'plus', 'New blank canvas');
withIcon($('#btnAddImage'), 'addImage', 'Add Image');
withIcon($('#btnAddImageEmpty'), 'addImage', 'Add Image');
withIcon($('#btnDocs'), 'help', 'Docs');
withIcon($('#btnCopy'), 'copy', 'Copy');
withIcon($('#btnPdf'), 'exportPdf', 'Export PDF');
withIcon($('#btnDownload'), 'download', 'Download PNG');
withIcon($('#btnUndo'), 'undo');
withIcon($('#btnRedo'), 'redo');
withIcon($('#btnTheme'), 'sun');

$('#btnUndo').addEventListener('click', () => editor.undo());
$('#btnRedo').addEventListener('click', () => editor.redo());
$('#zoomIn').addEventListener('click', () => stage.zoomBy(1.25));
$('#zoomOut').addEventListener('click', () => stage.zoomBy(0.8));
$('#zoomLevel').addEventListener('click', () => stage.zoomTo(1));
$('#zoomFit').addEventListener('click', () => stage.fit());
$('#btnTheme').addEventListener('click', () => {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  chrome.storage.local.set({ theme: dark ? 'dark' : 'light' });
  stage.requestRender();
});

// ── import ──────────────────────────────────────────────────────────────────
async function addImages(files: File[]) {
  let n = 0;
  for (const f of files) {
    try {
      const img = await loadImageFromFile(f);
      placeImage(img, f.name.replace(/\.[^.]+$/, '') || 'Image');
      n++;
    } catch {
      /* skip undecodable files */
    }
  }
  if (n) setStatus(`Added ${n} image${n > 1 ? 's' : ''} · drag, scale or rotate them with the handles`);
  else setStatus('Could not read that image');
}

/** Pick sensible default sizes for tools and text on an artboard of this width. */
function tuneDefaults(w: number) {
  defaults.fontSize = Math.max(16, Math.min(72, Math.round(w / 55)));
  toolStyle.strokeWidth = Math.max(3, Math.min(14, Math.round(w / 350)));
  toolStyle.stampSize = Math.max(28, Math.min(120, Math.round(w / 28)));
  toolStyle.blurAmount = Math.max(8, Math.min(40, Math.round(w / 120)));
  toolStyle.brushSize = Math.max(8, Math.min(120, Math.round(w / 60)));
  inspector.sync();
}

function placeImage(img: HTMLImageElement, name: string, opts: { trim?: boolean } = {}) {
  const first = editor.page.width === 0;
  // transparent margins (e.g. a window screenshot's shadow padding) would make the transform box
  // float away from the visible pixels, so they are trimmed off
  const trimmed = opts.trim === false ? null : trimTransparent(img);
  const source: CanvasImageSource = trimmed ?? img;
  const nw = trimmed ? trimmed.width : img.naturalWidth || img.width;
  const nh = trimmed ? trimmed.height : img.naturalHeight || img.height;
  if (trimmed) setStatus(`Trimmed transparent edges: ${img.naturalWidth} × ${img.naturalHeight} → ${nw} × ${nh} px`);
  editor.addImage(createImageLayer(source, nw, nh, { name }));
  if (first) tuneDefaults(editor.page.width);
  else {
    const l = editor.primary;
    if (l && !trimmed && l.width < nw - 0.5) setStatus(`${name}: ${nw} × ${nh} px, scaled to ${Math.round((l.width / nw) * 100)}% to fit the canvas`);
  }
}

async function newCanvas() {
  const p = editor.page;
  const r = await openNewCanvasDialog(p.width ? { w: p.width, h: p.height } : { w: 1920, h: 1080 });
  if (!r) return;
  editor.createCanvas({ width: r.width, height: r.height, background: r.background });
  tuneDefaults(r.width);
  stage.fit();
  setStatus(`New ${r.width} × ${r.height} px canvas${r.background ? '' : ' · transparent'} — pick a tool and start`);
}
$('#btnNew').addEventListener('click', () => void newCanvas());
$('#btnNewEmpty').addEventListener('click', () => void newCanvas());

setupDragDrop($('#stageWrap'), addImages);
setupPaste(addImages);
$('#btnAddImage').addEventListener('click', () => openFilePicker(addImages));
$('#btnAddImageEmpty').addEventListener('click', () => openFilePicker(addImages));

// ── export ──────────────────────────────────────────────────────────────────
function pageBlob(type = 'image/png', quality = 1): Promise<Blob | null> {
  return new Promise((res) => flattenPage(editor.page, 1).toBlob(res, type, quality));
}

async function download() {
  if (!editor.page.width) return setStatus('Nothing to export yet');
  const blob = await pageBlob();
  if (!blob) return setStatus('Export failed');
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `snipwise-${Date.now()}.png` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  setStatus(`Downloaded PNG ✓ — ${editor.page.width}×${editor.page.height}px`);
}

async function copyImage() {
  if (!editor.page.width) return setStatus('Nothing to copy yet');
  const blob = await pageBlob();
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob! })]);
    setStatus('Copied to clipboard ✓');
  } catch {
    setStatus('Copy failed — use Download instead');
  }
}

function exportPdf() {
  const workspace = {
    pages: editor.doc.pages.map((p) => ({
      id: p.id,
      name: p.name,
      sceneData: { width: p.width, height: p.height },
      flat: () => flattenPage(p, 1, '#ffffff'),
    })),
  };
  openPdfExportDialog(workspace);
}

function openDocs() {
  try {
    chrome.tabs.create({ url: chrome.runtime.getURL('docs.html') });
  } catch {
    window.open('docs.html', '_blank');
  }
}
$('#btnDocs').addEventListener('click', openDocs);
$('#btnDownload').addEventListener('click', download);
$('#btnCopy').addEventListener('click', copyImage);
$('#btnPdf').addEventListener('click', exportPdf);

// ── reactions ───────────────────────────────────────────────────────────────
let layersRaf = 0;
function scheduleLayers() {
  if (layersRaf) return;
  layersRaf = requestAnimationFrame(() => {
    layersRaf = 0;
    layers.render();
  });
}
let pagesTimer = 0;
function schedulePages() {
  clearTimeout(pagesTimer);
  pagesTimer = window.setTimeout(() => pages.render(), 250);
}

function refreshChrome() {
  ($('#btnUndo') as HTMLButtonElement).disabled = !editor.history.canUndo;
  ($('#btnRedo') as HTMLButtonElement).disabled = !editor.history.canRedo;
  $('#btnUndo').title = editor.history.undoLabel ? `Undo ${editor.history.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
  $('#btnRedo').title = editor.history.redoLabel ? `Redo ${editor.history.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)';
  const p = editor.page;
  $('#emptyState').hidden = p.width > 0;
  $('#sizeText').textContent = p.width ? `${Math.round(p.width)} × ${Math.round(p.height)} px` : 'No canvas yet';
}

editor.subscribe((kind) => {
  if (kind === 'live') {
    inspector.sync();
    return;
  }
  if (kind === 'pixels') {
    inspector.sync();
    return;
  }
  if (kind === 'history') {
    refreshChrome();
    inspector.sync();
    return;
  }
  scheduleLayers();
  inspector.sync();
  if (kind === 'doc') {
    schedulePages();
    stage.autoFit();
    refreshChrome();
    textEditor?.place();
  }
});

// ── keyboard ────────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.matches('input, textarea, select, [contenteditable="true"]')) return;
  if (textEditor?.active) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === 'F1') { e.preventDefault(); openDocs(); return; }

  if (mod) {
    switch (k) {
      case 'z': e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return;
      case 'y': e.preventDefault(); editor.redo(); return;
      case 'd': e.preventDefault(); editor.duplicateLayers(editor.selection); return;
      case 'a':
        e.preventDefault();
        if (e.shiftKey) { editor.editSelection('Deselect', (s) => s.clear()); return; }
        if (SELECT_TOOLS.includes(stage.tool)) { editor.editSelection('Select all', (s) => s.selectAll(editor.page.width, editor.page.height)); return; }
        editor.select(editor.page.layers.filter((l) => l.visible && !l.locked).map((l) => l.id));
        return;
      case 'i':
        if (e.shiftKey && editor.page.width) { e.preventDefault(); editor.editSelection('Invert selection', (s) => s.invert(editor.page.width, editor.page.height)); }
        return;
      case 'j':
        e.preventDefault();
        if (editor.pixelSel.active) { if (!stage.paint.selectionToLayer(e.shiftKey)) setStatus('Nothing to copy'); }
        else editor.duplicateLayers(editor.selection);
        return;
      case 's': e.preventDefault(); void download(); return;
      case 'c': if (!window.getSelection()?.toString()) { e.preventDefault(); void copyImage(); } return;
      case '0': e.preventDefault(); stage.fit(); return;
      case '1': e.preventDefault(); stage.zoomTo(1); return;
      case '=': case '+': e.preventDefault(); stage.zoomBy(1.25); return;
      case '-': e.preventDefault(); stage.zoomBy(0.8); return;
    }
    return;
  }

  if (k === 'm' && e.shiftKey && !e.altKey) { stage.setTool('selellipse'); return; }
  const tool = TOOLS.find((x): x is Exclude<typeof x, 'sep'> => x !== 'sep' && x.key === k);
  if (tool && !e.altKey) { stage.setTool(tool.id); return; }

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      if (e.altKey && editor.pixelSel.active) { e.preventDefault(); stage.paint.fillSelection(); return; }
      if (editor.pixelSel.active && stage.paint.clearSelection()) { e.preventDefault(); return; }
      if (editor.selection.length) { e.preventDefault(); editor.removeLayers(editor.selection); }
      return;
    case 'Escape':
      if (stage.tool === 'crop') return; // the stage handles it
      if (editor.pixelSel.active) { editor.editSelection('Deselect', (s) => s.clear()); return; }
      if (editor.selection.length) editor.select([]);
      else stage.setTool('select');
      return;
    case '[': editor.selected.forEach((l) => editor.sendBackward(l.id)); return;
    case ']': editor.selected.forEach((l) => editor.bringForward(l.id)); return;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      const sel = editor.selected.filter((l) => !l.locked);
      if (!sel.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      for (const l of sel) editor.patchLayer(l.id, { x: l.x + dx, y: l.y + dy }, 'Nudge', `${l.id}:nudge`);
    }
  }
});

// ── boot ────────────────────────────────────────────────────────────────────
refreshChrome();
layers.render();
pages.render();
inspector.sync();

loadCaptureFromBackground().then(async (capture: { dataUrl?: string; title?: string } | null) => {
  if (capture?.dataUrl) {
    const img = await loadImage(capture.dataUrl);
    placeImage(img, 'Screenshot', { trim: false }); // captures are opaque: nothing to trim
    editor.select([]);
    setStatus(`Captured: ${capture.title || 'Untitled'}`);
  } else {
    setStatus('Blank workspace — drag, paste or add an image to start');
  }
  stage.fit();
});

// handy for debugging from the console
(window as unknown as { studio: unknown }).studio = { editor, stage, placeImage, style: toolStyle, flatten: () => flattenPage(editor.page, 1), newCanvas: (o: { width: number; height: number; background: string | null }) => { editor.createCanvas(o); tuneDefaults(o.width); stage.fit(); } };
