import type { Editor } from '../engine/editor';
import { flattenPage } from '../engine/render';
import { h } from './dom';
import { icon } from './icons';

export function initPagesPanel(root: HTMLElement, editor: Editor, onNew?: () => void): { render(): void } {
  const list = h('div', { class: 'page-list' });
  const add = h('button', { class: 'icon-btn', title: 'Add page', onclick: () => (onNew ? onNew() : editor.addPage()) }, icon('plus', 16), ' New page');
  add.classList.add('wide');
  root.append(list, add);
  const count = document.getElementById('pagesCount');

  function render() {
    list.replaceChildren();
    for (const p of editor.doc.pages) {
      const active = p.id === editor.doc.activePageId;
      const thumb = h('div', { class: 'page-thumb' });
      if (p.width && p.height) {
        const s = Math.min(48 / p.width, 36 / p.height);
        const c = flattenPage(p, s, '#ffffff');
        thumb.append(c);
      }
      const name = h('span', { class: 'page-name' }, p.name);
      name.addEventListener('dblclick', () => {
        const v = prompt('Rename page', p.name)?.trim();
        if (v) {
          p.name = v;
          render();
        }
      });
      const row = h(
        'div',
        { class: `page-row${active ? ' selected' : ''}` },
        thumb,
        name,
        editor.doc.pages.length > 1
          ? h('button', {
              class: 'icon-btn',
              title: 'Delete page',
              onclick: (e: Event) => {
                e.stopPropagation();
                if (p.layers.length === 0 || confirm(`Delete "${p.name}" and its ${p.layers.length} layer(s)?`)) editor.removePage(p.id);
              },
            }, icon('trash', 14))
          : null,
      );
      row.addEventListener('click', () => editor.switchPage(p.id));
      list.append(row);
    }
    if (count) count.textContent = String(editor.doc.pages.length);
  }
  return { render };
}
