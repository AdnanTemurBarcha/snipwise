"use strict";

// Single source of truth for every SVG icon the editor uses — line-icon
// style, 24x24 viewBox, stroke="currentColor" so each icon inherits the
// button's text color and adapts to both themes with no extra CSS. No
// external icon font/library, consistent with the project's "no external
// runtime dependencies" rule.
const S = 'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const EYE_OFF = `<path d="M3 3l18 18" ${S}/><path d="M10.6 5.1A10.6 10.6 0 0112 5c5 0 9 4 10 7-.4 1.2-1.2 2.6-2.4 3.9M6.5 6.6C4.4 8 2.9 10 2 12c.7 2.1 2.6 4.4 5.1 5.9" ${S}/><path d="M9.9 9.9a3 3 0 004.2 4.2" ${S}/>`;
const TRASH = `<path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" ${S}/><path d="M10 11v6M14 11v6" ${S}/>`;

export const ICONS = {
  move: `<path d="M12 2v20M2 12h20" ${S}/><path d="M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l3 3" ${S}/>`,
  pen: `<path d="M14.5 4.5l5 5L9 20l-5.5 1.5L5 16 14.5 4.5z" ${S}/><path d="M12.5 6.5l5 5" ${S}/>`,
  arrow: `<path d="M5 19L19 5" ${S}/><path d="M9 5h10v10" ${S}/>`,
  line: `<path d="M5 19L19 5" ${S}/>`,
  rect: `<rect x="4" y="6" width="16" height="12" rx="1.5" ${S}/>`,
  circle: `<circle cx="12" cy="12" r="8" ${S}/>`,
  highlight: `<path d="M3 21l1-4 10-10 3 3-10 10-4 1z" ${S}/><path d="M14 7l3-3 3 3-3 3" ${S}/>`,
  blur: EYE_OFF,
  eyeOff: EYE_OFF,
  eye: `<path d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7s-9-4-10-7z" ${S}/><circle cx="12" cy="12" r="3" ${S}/>`,
  step: `<circle cx="12" cy="12" r="8" ${S}/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>`,
  callout: `<path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9A1.5 1.5 0 0118.5 16H9l-4 4v-4H5.5A1.5 1.5 0 014 14.5v-9z" ${S}/>`,
  emoji: `<circle cx="12" cy="12" r="9" ${S}/><path d="M8.5 10h.01M15.5 10h.01" ${S}/><path d="M8 14.5c1 1.3 2.5 2 4 2s3-.7 4-2" ${S}/>`,
  crop: `<path d="M6 2v14a2 2 0 002 2h14" ${S}/><path d="M18 22V8a2 2 0 00-2-2H2" ${S}/>`,
  undo: `<path d="M3 10h9a5 5 0 010 10h-2" ${S}/><path d="M3 10l5-5M3 10l5 5" ${S}/>`,
  clear: TRASH,
  trash: TRASH,
  addImage: `<rect x="3" y="4" width="14" height="14" rx="1.5" ${S}/><path d="M3 15l4-4 3 3 4-5 3 3" ${S}/><circle cx="7.2" cy="8.2" r="1.3" fill="currentColor" stroke="none"/><path d="M18 3v6M15 6h6" ${S}/>`,
  copy: `<rect x="8" y="8" width="12" height="12" rx="1.5" ${S}/><path d="M4 16V5a1 1 0 011-1h11" ${S}/>`,
  exportPdf: `<path d="M6 9V3h12v6" ${S}/><rect x="4" y="9" width="16" height="8" rx="1.5" ${S}/><path d="M6 17v4h12v-4" ${S}/>`,
  download: `<path d="M12 3v12" ${S}/><path d="M7 10l5 5 5-5" ${S}/><path d="M4 20h16" ${S}/>`,
  up: `<path d="M5 15l7-7 7 7" ${S}/>`,
  down: `<path d="M5 9l7 7 7-7" ${S}/>`,
  ratioLock: `<rect x="5" y="10" width="14" height="10" rx="1.5" ${S}/><path d="M8 10V7a4 4 0 018 0v3" ${S}/>`,
  ratioUnlock: `<rect x="5" y="10" width="14" height="10" rx="1.5" ${S}/><path d="M8 10V7a4 4 0 017.5-2" ${S}/>`,
  imagePlaceholder: `<rect x="3" y="4" width="18" height="16" rx="2" ${S}/><circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5-4 4-3-3-6 6" ${S}/>`,
  pagesIcon: `<rect x="7" y="3" width="12" height="15" rx="1.5" ${S}/><path d="M4 8v11a1 1 0 001 1h11" ${S}/>`,
  layersIcon: `<path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" ${S}/><path d="M4 12l8 4.5 8-4.5" ${S}/><path d="M4 15.5l8 4.5 8-4.5" ${S}/>`,
};

function svg(inner, viewBox = "0 0 24 24") {
  return `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// Fills every [data-icon] element under `root` with its named icon.
// Static toolbar buttons in editor.html carry data-icon attributes instead
// of emoji text; this runs once at startup from editor/main.js.
export function mountIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    if (ICONS[name]) el.innerHTML = svg(ICONS[name]);
  });
}

// For dynamically created buttons (layers/pages panel rows) that build their
// own DOM and want the raw <svg> markup directly.
export function iconMarkup(name) {
  return ICONS[name] ? svg(ICONS[name]) : "";
}
