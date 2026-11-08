import type { Editor } from '../engine/editor';
import type { Layer } from '../engine/types';
import { drawLayer } from '../engine/render';
import { createAdjustLayer } from '../engine/document';
import { h } from './dom';
import { icon } from './icons';

const THUMB_W = 40;
const THUMB_H = 30;

function thumbnail(l: Layer): HTMLCanvasElement {
  const c = h('canvas', { class: 'thumb', width: THUMB_W * 2, height: THUMB_H * 2 });
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  const s = Math.min((THUMB_W - 4) / l.width, (THUMB_H - 4) / l.height, 4);
  ctx.translate((THUMB_W - l.width * s) / 2, (THUMB_H - l.height * s) / 2);
  ctx.scale(s, s);
  if (l.type === 'adjust') {
    const g = ctx.createLinearGradient(0, 0, l.width, 0);
    g.addColorStop(0, '#111');
    g.addColorStop(1, '#eee');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l.width, l.height);
    ctx.fillStyle = 'rgba(167,139,250,0.9)';
    ctx.beginPath();
    ctx.arc(l.width / 2, l.height / 2, Math.min(l.width, l.height) * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (l.type === 'blur') {
    ctx.fillStyle = l.mode === 'redact' ? l.color : '#9aa0aa';
    ctx.fillRect(0, 0, l.width, l.height);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const step = Math.max(2, Math.min(l.width, l.height) / 4);
    for (let y = 0; y < l.height; y += step) for (let x = ((y / step) % 2) * step; x < l.width; x += step * 2) ctx.fillRect(x, y, step, step);
  } else {
    drawLayer(ctx, { ...l, x: 0, y: 0, rotation: 0, opacity: 1, visible: true, blendMode: 'source-over' } as Layer);
  }
  return c;
}

function maskThumbCanvas(l: Layer): HTMLCanvasElement {
  const c = h('canvas', { class: 'thumb mask-thumb', width: THUMB_H * 2, height: THUMB_H * 2 });
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  if (l.mask) {
    const s = Math.min(c.width / l.mask.width, c.height / l.mask.height);
    ctx.drawImage(l.mask, (c.width - l.mask.width * s) / 2, (c.height - l.mask.height * s) / 2, l.mask.width * s, l.mask.height * s);
  }
  return c;
}

export function initLayersPanel(root: HTMLElement, editor: Editor): { render(): void } {
  const list = h('div', { class: 'layer-list' });
  const count = document.getElementById('layersCount');
  let dragId: string | null = null;

  const actions = h(
    'div',
    { class: 'panel-actions' },
    action('adjust', 'New adjustment layer — re-colors everything below it', () => {
      const p = editor.page;
      if (p.width) editor.addLayerAbove(createAdjustLayer(p.width, p.height), 'Add adjustment layer');
    }),
    action('dup', 'Duplicate (Ctrl+D)', () => editor.duplicateLayers(editor.selection)),
    action('up', 'Bring forward (])', () => editor.selected.forEach((l) => editor.bringForward(l.id))),
    action('down', 'Send backward ([)', () => editor.selected.forEach((l) => editor.sendBackward(l.id))),
    action('trash', 'Delete (Del)', () => editor.removeLayers(editor.selection)),
  );
  root.append(list, actions);

  function action(name: string, title: string, fn: () => void) {
    return h('button', { class: 'icon-btn', title, onclick: fn }, icon(name, 16));
  }

  function maskThumb(l: Layer): HTMLElement {
    const c = maskThumbCanvas(l);
    c.title = 'Layer mask — click to paint it';
    if (editor.maskEdit && editor.selection.length === 1 && editor.selection[0] === l.id) c.classList.add('editing');
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      editor.select([l.id]);
      editor.setMaskEdit(!(editor.maskEdit && editor.selection[0] === l.id));
    });
    return c;
  }

  function row(l: Layer, arrayIndex: number): HTMLElement {
    const selected = editor.selection.includes(l.id);
    const name = h('span', { class: 'layer-name', title: 'Double-click to rename' }, l.name);
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = h('input', { class: 'rename', value: l.name, spellcheck: false });
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        const v = input.value.trim();
        if (ok && v && v !== l.name) editor.patchLayer(l.id, { name: v }, 'Rename layer');
        else render();
      };
      input.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') finish(true);
        if (ev.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      name.replaceWith(input);
      input.focus();
      input.select();
    });

    const el = h(
      'div',
      { class: `layer-row${selected ? ' selected' : ''}${l.visible ? '' : ' hidden-layer'}`, draggable: true, 'data-id': l.id },
      h('button', {
        class: 'icon-btn eye',
        title: l.visible ? 'Hide' : 'Show',
        onclick: (e: Event) => {
          e.stopPropagation();
          editor.patchLayer(l.id, { visible: !l.visible }, l.visible ? 'Hide layer' : 'Show layer');
        },
      }, icon(l.visible ? 'eye' : 'eyeOff', 15)),
      thumbnail(l),
      l.mask ? maskThumb(l) : false,
      name,
      h('button', {
        class: `icon-btn lock${l.locked ? ' on' : ''}`,
        title: l.locked ? 'Unlock' : 'Lock',
        onclick: (e: Event) => {
          e.stopPropagation();
          editor.patchLayer(l.id, { locked: !l.locked }, l.locked ? 'Unlock layer' : 'Lock layer');
        },
      }, icon(l.locked ? 'lock' : 'unlock', 14)),
    );

    el.addEventListener('click', (e) => {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        const has = editor.selection.includes(l.id);
        editor.select(has ? editor.selection.filter((i) => i !== l.id) : [...editor.selection, l.id]);
      } else {
        editor.select([l.id]);
      }
    });
    el.addEventListener('dragstart', (e) => {
      dragId = l.id;
      e.dataTransfer?.setData('text/plain', l.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      dragId = null;
      list.querySelectorAll('.drop-above,.drop-below,.dragging').forEach((n) => n.classList.remove('drop-above', 'drop-below', 'dragging'));
    });
    el.addEventListener('dragover', (e) => {
      if (!dragId || dragId === l.id) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      el.classList.toggle('drop-above', above);
      el.classList.toggle('drop-below', !above);
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragId || dragId === l.id) return;
      const r = el.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      const layers = editor.page.layers;
      const from = layers.findIndex((x) => x.id === dragId);
      // list is shown top-first, so "above" a row = higher array index
      let to = above ? arrayIndex + 1 : arrayIndex;
      if (from < to) to -= 1;
      editor.reorder(dragId, to);
    });
    return el;
  }

  function render() {
    const layers = editor.page.layers;
    list.replaceChildren();
    if (!layers.length) {
      list.append(h('div', { class: 'panel-empty' }, 'No layers yet'));
    } else {
      for (let i = layers.length - 1; i >= 0; i--) list.append(row(layers[i], i));
    }
    if (count) count.textContent = String(layers.length);
  }

  return { render };
}
