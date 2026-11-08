export {};
// Docs page behaviour: dark mode, generated table of contents, scroll-spy and search.
// (Extension pages cannot run inline scripts, so this lives in its own file.)

const $ = (s: string) => document.querySelector(s) as HTMLElement;

// theme: share the choice made in the editor
try {
  chrome.storage.local.get(['theme'], (r: { theme?: string }) => {
    document.documentElement.classList.toggle('dark', r.theme === 'dark');
  });
} catch {
  document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches);
}
$('#themeBtn').addEventListener('click', () => {
  const dark = !document.documentElement.classList.contains('dark');
  document.documentElement.classList.toggle('dark', dark);
  try {
    chrome.storage.local.set({ theme: dark ? 'dark' : 'light' });
  } catch {
    /* no extension storage */
  }
});

// table of contents from sections and their sub-headings
const toc = $('#toc');
const sections = [...document.querySelectorAll<HTMLElement>('main section')];
const links = new Map<string, HTMLAnchorElement>();
for (const s of sections) {
  const a = Object.assign(document.createElement('a'), { href: `#${s.id}`, textContent: s.dataset.title || s.id });
  toc.append(a);
  links.set(s.id, a);
  for (const h of s.querySelectorAll<HTMLElement>('h3[id]')) {
    const sub = Object.assign(document.createElement('a'), { href: `#${h.id}`, textContent: h.textContent || h.id, className: 'sub' });
    toc.append(sub);
    links.set(h.id, sub);
  }
}
toc.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('a')) toc.classList.remove('open');
});
$('#menuBtn').addEventListener('click', () => toc.classList.toggle('open'));

// scroll-spy
const spy = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('on'));
      links.get((en.target as HTMLElement).id)?.classList.add('on');
    }
  },
  { rootMargin: '-80px 0px -70% 0px' },
);
sections.forEach((s) => spy.observe(s));

// search: hide sections that don't match, highlight the matches
const input = $('#search') as HTMLInputElement;
const original = new Map<HTMLElement, string>();
sections.forEach((s) => original.set(s, s.innerHTML));

function highlight(root: HTMLElement, q: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue && n.nodeValue.toLowerCase().includes(q) && !(n.parentElement?.closest('script,style'))) hits.push(n as Text);
  }
  for (const t of hits) {
    const text = t.nodeValue!;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (let at = text.toLowerCase().indexOf(q); at >= 0; at = text.toLowerCase().indexOf(q, i)) {
      frag.append(text.slice(i, at));
      const m = document.createElement('mark');
      m.textContent = text.slice(at, at + q.length);
      frag.append(m);
      i = at + q.length;
    }
    frag.append(text.slice(i));
    t.replaceWith(frag);
  }
}

function runSearch() {
  const q = input.value.trim().toLowerCase();
  let shown = 0;
  for (const s of sections) {
    s.innerHTML = original.get(s)!;
    const match = !q || (s.textContent || '').toLowerCase().includes(q);
    s.hidden = !match;
    links.get(s.id)!.hidden = !match;
    s.querySelectorAll('h3[id]').forEach((h) => (links.get(h.id)!.hidden = !match));
    if (match) {
      shown++;
      if (q.length > 1) {
        highlight(s, q);
        s.querySelectorAll('details').forEach((d) => {
          if (d.querySelector('mark')) d.open = true;
        });
      }
    }
  }
  $('#noResults').hidden = shown > 0;
}
let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(runSearch, 120);
});
window.addEventListener('keydown', (e) => {
  if ((e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  }
  if (e.key === 'Escape' && document.activeElement === input) {
    input.value = '';
    runSearch();
    input.blur();
  }
});
