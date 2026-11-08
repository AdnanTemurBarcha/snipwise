import { ICONS } from './icon-set.js';
import { svgIcon } from './dom';

const S = 'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';

// Studio-only icons; everything else is shared with the legacy editor's set.
const EXTRA: Record<string, string> = {
  selrect: `<rect x="4" y="5" width="16" height="14" rx="1" ${S} stroke-dasharray="3 2.5"/>`,
  selellipse: `<ellipse cx="12" cy="12" rx="8.5" ry="6.5" ${S} stroke-dasharray="3 2.5"/>`,
  lasso: `<path d="M12 4c-4.4 0-8 2.2-8 5s3.6 5 8 5 8-2.2 8-5-3.6-5-8-5z" ${S} stroke-dasharray="3 2.5"/><path d="M8 14c-1 2 0 5 2.5 5.5 1.5.3 2.5-.8 2.5-2" ${S}/>`,
  wand: `<path d="M5 19L15 9" ${S}/><path d="M15 4v3M15 11v3M11 9h3M17 9h3M12.5 6.5l1.5 1.5M16 10l1.5 1.5M17.5 6.5L16 8" ${S}/>`,
  brush: `<path d="M20 4l-9 9" ${S}/><path d="M11 13c-3 0-4 2-4 4 0 1.5-1 2.5-3 3 4 1 9 0 9-4 0-1.3-.7-2.4-2-3z" ${S}/>`,
  eraser: `<path d="M8 20h12M5.5 14.5l8-8a2 2 0 013 0l2 2a2 2 0 010 3l-7.5 7.5H9.5z" ${S}/><path d="M9 11l5 5" ${S}/>`,
  bucket: `<path d="M5 12l6-7 8 8-6 6a2 2 0 01-3 0z" ${S}/><path d="M5 12h14M20 17c0 1-.8 2-1.5 2S17 18 17 17c0-1.2 1.5-2.5 1.5-2.5S20 15.8 20 17z" ${S}/>`,
  gradient: `<rect x="4" y="5" width="16" height="14" rx="2" ${S}/><path d="M8 5v14M12 5v14M16 5v14" ${S} opacity=".45"/>`,
  eyedropper: `<path d="M14 6l4 4M17.5 3.5a2.1 2.1 0 013 3L17 10l-3-3zM14 7l-9 9v3h3l9-9" ${S}/>`,
  clone: `<circle cx="9" cy="9" r="4.5" ${S}/><circle cx="15.5" cy="15.5" r="4.5" ${S} stroke-dasharray="2.5 2.5"/>`,
  adjust: `<circle cx="12" cy="12" r="8" ${S}/><path d="M12 4a8 8 0 010 16z" fill="currentColor" stroke="none"/>`,
  help: `<circle cx="12" cy="12" r="9" ${S}/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01" ${S}/>`,
  select: `<path d="M5 3l14 8-6.2 1.6L10.5 19 5 3z" ${S}/>`,
  hand: `<path d="M8 13V6.5a1.5 1.5 0 013 0V11m0-5.5a1.5 1.5 0 013 0V11m0-4a1.5 1.5 0 013 0v7a6 6 0 01-6 6h-1a6 6 0 01-4.7-2.3L4 14.5a1.5 1.5 0 012.3-1.9L8 14" ${S}/>`,
  text: `<path d="M5 6V4h14v2M12 4v16M9 20h6" ${S}/>`,
  redo: `<path d="M21 10h-9a5 5 0 000 10h2" ${S}/><path d="M21 10l-5-5M21 10l-5 5" ${S}/>`,
  lock: `<rect x="5" y="10" width="14" height="10" rx="1.5" ${S}/><path d="M8 10V7a4 4 0 018 0v3" ${S}/>`,
  unlock: `<rect x="5" y="10" width="14" height="10" rx="1.5" ${S}/><path d="M8 10V7a4 4 0 017.5-2" ${S}/>`,
  flipH: `<path d="M12 3v18" ${S} stroke-dasharray="2 2.5"/><path d="M9 7L3 17h6V7zM15 7l6 10h-6V7z" ${S}/>`,
  flipV: `<path d="M3 12h18" ${S} stroke-dasharray="2 2.5"/><path d="M7 9L17 3v6H7zM7 15l10 6v-6H7z" ${S}/>`,
  dup: `<rect x="8" y="8" width="12" height="12" rx="1.5" ${S}/><path d="M4 16V5a1 1 0 011-1h11" ${S}/>`,
  fit: `<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" ${S}/>`,
  bold: `<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z" ${S}/>`,
  italic: `<path d="M10 5h8M6 19h8M14 5l-4 14" ${S}/>`,
  alignL: `<path d="M4 6h16M4 10h10M4 14h16M4 18h10" ${S}/>`,
  alignC: `<path d="M4 6h16M7 10h10M4 14h16M7 18h10" ${S}/>`,
  alignR: `<path d="M4 6h16M10 10h10M4 14h16M10 18h10" ${S}/>`,
  objL: `<path d="M4 3v18" ${S}/><rect x="7" y="6" width="13" height="4" rx="1" ${S}/><rect x="7" y="14" width="8" height="4" rx="1" ${S}/>`,
  objC: `<path d="M12 3v18" ${S}/><rect x="5" y="6" width="14" height="4" rx="1" ${S}/><rect x="8" y="14" width="8" height="4" rx="1" ${S}/>`,
  objR: `<path d="M20 3v18" ${S}/><rect x="4" y="6" width="13" height="4" rx="1" ${S}/><rect x="9" y="14" width="8" height="4" rx="1" ${S}/>`,
  alignT: `<path d="M4 4h16" ${S}/><rect x="7" y="7" width="4" height="12" rx="1" ${S}/><rect x="13" y="7" width="4" height="7" rx="1" ${S}/>`,
  alignM: `<path d="M3 12h18" ${S} stroke-dasharray="2 2.5"/><rect x="7" y="5" width="4" height="14" rx="1" ${S}/><rect x="13" y="8" width="4" height="8" rx="1" ${S}/>`,
  alignB: `<path d="M4 20h16" ${S}/><rect x="7" y="5" width="4" height="12" rx="1" ${S}/><rect x="13" y="10" width="4" height="7" rx="1" ${S}/>`,
  distH: `<path d="M4 4v16M20 4v16" ${S}/><rect x="9.5" y="8" width="5" height="8" rx="1" ${S}/>`,
  distV: `<path d="M4 4h16M4 20h16" ${S}/><rect x="8" y="9.5" width="8" height="5" rx="1" ${S}/>`,
  ellipse: `<ellipse cx="12" cy="12" rx="9" ry="6.5" ${S}/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5" ${S}/>`,
  plus: `<path d="M12 5v14M5 12h14" ${S}/>`,
  sun: `<circle cx="12" cy="12" r="4" ${S}/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" ${S}/>`,
};

export function icon(name: string, size = 18): SVGSVGElement {
  const inner = EXTRA[name] ?? (ICONS as Record<string, string>)[name] ?? '';
  return svgIcon(inner, size);
}
