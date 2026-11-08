import { h } from './dom';

/** Handy for annotating screenshots; shown first as "Quick picks". */
const QUICK = [
  '👍', '👎', '👉', '👈', '👆', '👇', '✅', '❌', '⚠️', '❗', '❓', '💡', '⭐', '🔥', '❤️', '🎉',
  '🐛', '🔒', '🔑', '📌', '📎', '✏️', '📷', '🔍', '🚀', '⏰', '💬', '👀', '🙌', '😀', '😅', '😍',
  '😎', '🤔', '😱', '😡', '🙈', '💯', '✔️', '➡️', '⬅️', '⬆️', '⬇️', '🔴', '🟢', '🟡', '🔵', '⚡',
];

const RECENT_KEY = 'snipwise.recentEmoji';
const MAX_RECENT = 24;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function remember(e: string) {
  try {
    const list = [e, ...loadRecent().filter((x) => x !== e)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: recents just won't persist */
  }
}

/** Does `name` contain every word of `query`? (Or, for an emoji typed into the box, the glyph itself.) */
export function matchesEmoji(emoji: string, name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!/[a-z0-9]/.test(q)) return emoji.includes(q);
  const words = q.split(/\s+/);
  return words.every((w) => name.includes(w));
}

/** Popover with every Unicode emoji, grouped, searchable by name, with recents. */
export function openEmojiPicker(anchor: HTMLElement, current: string, onPick: (e: string) => void): void {
  document.getElementById('emojiPicker')?.remove();
  const search = h('input', { type: 'search', class: 'emoji-search', placeholder: 'Search emoji…', spellcheck: false, autocomplete: 'off' });
  const tabs = h('div', { class: 'emoji-tabs' });
  const body = h('div', { class: 'emoji-body' }, h('div', { class: 'emoji-loading' }, 'Loading…'));
  const pop = h('div', { id: 'emojiPicker', class: 'emoji-picker' }, search, tabs, body);
  document.body.append(pop);

  const W = 352;
  const r = anchor.getBoundingClientRect();
  pop.style.width = `${W}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - W - 8, r.left - W + r.width))}px`;
  pop.style.top = `${Math.max(8, Math.min(window.innerHeight - 400 - 8, r.bottom + 6))}px`;

  const pick = (e: string) => {
    remember(e);
    onPick(e);
    close();
  };
  body.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('.emoji-cell');
    if (b?.dataset.e) pick(b.dataset.e);
  });

  const cell = (e: string, name: string) =>
    h('button', { class: `emoji-cell${e === current ? ' on' : ''}`, title: name, 'data-e': e, 'data-n': name }, e);
  const section = (id: string, title: string, items: [string, string][]) => {
    const sec = h('div', { class: 'emoji-sec', 'data-sec': id }, h('div', { class: 'emoji-sec-title' }, title));
    const grid = h('div', { class: 'emoji-grid' });
    for (const [e, n] of items) grid.append(cell(e, n));
    sec.append(grid);
    return sec;
  };

  import('./emoji-data').then(({ EMOJI_GROUPS }) => {
    if (!pop.isConnected) return;
    const all = EMOJI_GROUPS.flatMap((g) => g.items);
    const names = new Map(all.map(([e, n]) => [e, n]));
    const recents = loadRecent();

    const buildBrowse = () => {
      body.replaceChildren();
      tabs.replaceChildren();
      const addTab = (id: string, icon: string, title: string) =>
        tabs.append(h('button', { class: 'emoji-tab', title, onclick: () => body.querySelector(`[data-sec="${id}"]`)?.scrollIntoView({ block: 'start' }) }, icon));
      if (recents.length) {
        body.append(section('recent', 'Recent', recents.map((e) => [e, names.get(e) ?? ''] as [string, string])));
        addTab('recent', '🕘', 'Recent');
      }
      body.append(section('quick', 'Quick picks', QUICK.map((e) => [e, names.get(e) ?? ''] as [string, string])));
      addTab('quick', '⭐', 'Quick picks');
      for (const g of EMOJI_GROUPS) {
        body.append(section(g.id, g.name, g.items));
        addTab(g.id, g.icon, g.name);
      }
      body.scrollTop = 0;
    };

    const run = () => {
      const q = search.value.trim();
      if (!q) return buildBrowse();
      tabs.replaceChildren();
      const hits = all.filter(([e, n]) => matchesEmoji(e, n, q));
      body.replaceChildren(hits.length ? section('results', `${hits.length} result${hits.length === 1 ? '' : 's'}`, hits.slice(0, 300)) : h('div', { class: 'emoji-loading' }, 'No emoji found'));
      body.scrollTop = 0;
    };
    let timer = 0;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = window.setTimeout(run, 80);
    });
    search.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const first = body.querySelector<HTMLElement>('.emoji-cell');
        if (first?.dataset.e) pick(first.dataset.e);
      }
    });
    buildBrowse();
    search.focus();
  });

  const onDoc = (ev: MouseEvent) => {
    if (!pop.contains(ev.target as Node) && ev.target !== anchor) close();
  };
  const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && close();
  function close() {
    pop.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
  });
}
