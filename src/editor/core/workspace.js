"use strict";

let nextId = 1;
function genId() {
  return "page-" + nextId++ + "-" + Date.now().toString(36);
}

export function createWorkspace() {
  return { pages: [], activePageId: null };
}

// A page holds a *persisted snapshot* of one page's scene/history/raster —
// the live working buffers (scene, history, annotationCanvas) in main.js get
// written into / loaded from this shape when the active page switches.
export function createPage(workspace, name) {
  const page = {
    id: genId(),
    name: name || `Page ${workspace.pages.length + 1}`,
    sceneData: { width: 0, height: 0, layers: [], selectedLayerId: null },
    annotationSnapshot: null,
    historyStack: [],
    stepCounter: 1,
  };
  workspace.pages.push(page);
  if (!workspace.activePageId) workspace.activePageId = page.id;
  return page;
}

export function getPage(workspace, id) {
  return workspace.pages.find((p) => p.id === id) || null;
}

export function getActivePage(workspace) {
  return getPage(workspace, workspace.activePageId);
}

// Refuses to remove the last remaining page. Returns true if removed, and
// re-points activePageId at a neighboring page when the active page was removed.
export function removePage(workspace, id) {
  if (workspace.pages.length <= 1) return false;
  const i = workspace.pages.findIndex((p) => p.id === id);
  if (i < 0) return false;
  workspace.pages.splice(i, 1);
  if (workspace.activePageId === id) {
    const next = workspace.pages[Math.min(i, workspace.pages.length - 1)];
    workspace.activePageId = next ? next.id : null;
  }
  return true;
}

// delta > 0 moves the page later in the tab order.
export function reorderPage(workspace, id, delta) {
  const i = workspace.pages.findIndex((p) => p.id === id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= workspace.pages.length) return;
  const [p] = workspace.pages.splice(i, 1);
  workspace.pages.splice(j, 0, p);
}

export function renamePage(workspace, id, name) {
  const p = getPage(workspace, id);
  if (p && name) p.name = name;
}
