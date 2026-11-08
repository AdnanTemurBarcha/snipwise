"use strict";

import { createScene, addImageLayer } from "./core/scene.js";
import { createHistory, pushState, undo as undoHistory, resetHistory } from "./core/history.js";
import { createWorkspace, createPage, getActivePage } from "./core/workspace.js";
import { render as renderScene, flatten } from "./render/compositor.js";
import { getTool } from "./tools/index.js";
import {
  loadCaptureFromBackground,
  loadImage,
  loadImageFromFile,
  setupDragDrop,
  setupPaste,
  openFilePicker,
} from "./io/import.js";
import { downloadPng, copyToClipboard } from "./io/export.js";
import { promptText, pickEmoji, runCanvasCrop } from "./ui/inline-input.js";
import { initToolbar } from "./ui/toolbar.js";
import { initLayersPanel } from "./ui/layers-panel.js";
import { initPagesPanel } from "./ui/pages-panel.js";
import { openPdfExportDialog } from "./ui/pdf-export-dialog.js";
import { setStatus, setSizeText, setZoomText } from "./ui/statusbar.js";
import { mountIcons } from "./ui/icons.js";
import { initKeyboard } from "./keyboard.js";

mountIcons();

const displayCanvas = document.getElementById("displayCanvas");
const annotationCanvas = document.getElementById("annotationCanvas");
const displayCtx = displayCanvas.getContext("2d");
const annotationCtx = annotationCanvas.getContext("2d", { willReadFrequently: true });
const container = document.getElementById("canvasContainer");
const canvasWrap = document.getElementById("canvasWrap");
const layersPanelEl = document.getElementById("layersPanel");
const pagesPanelEl = document.getElementById("pagesPanel");

// `scene`/`history`/`annotationCanvas` are the *live* working buffers for
// whichever page is active. A workspace page is just a persisted snapshot of
// this same shape — switching pages means flushing these into the outgoing
// page, then loading the incoming page's snapshot back into these same
// objects (see persistActivePage/loadPageIntoBuffers below). Everything else
// (tools, compositor, layers panel) keeps operating on `scene`/`history`
// exactly as before and never needs to know pages exist.
const scene = createScene(0, 0);
const history = createHistory();
const workspace = createWorkspace();
createPage(workspace, "Page 1");
const state = {
  tool: "pen",
  color: "#a78bfa",
  strokeSize: 3,
  drawing: false,
  startX: 0,
  startY: 0,
  lastSnap: null,
  pendingEmoji: null,
  stepCounter: 1,
  cropping: false,
  ratioLocked: false,
  zoom: 1,
};

// ── Theme (light is the default — dark is opt-in) ───────────────────────────
chrome.storage.local.get(["theme"], (r) => {
  document.documentElement.classList.toggle("dark", r.theme === "dark");
});

// ── Render / undo plumbing ──────────────────────────────────────────────────
function requestRender() {
  renderScene(scene, displayCtx, annotationCanvas, { showSelection: state.tool === "move" });
  canvasWrap.classList.toggle("is-empty", scene.width === 0 || scene.height === 0);
}

// Every mutation in the app funnels through pushUndo() sooner or later (it's
// the one thing every tool calls after committing a change) — refreshing the
// layers panel here, rather than at each call site, guarantees the sidebar
// can never go stale no matter which tool or path made the change.
function pushUndo() {
  if (!annotationCanvas.width || !annotationCanvas.height) return;
  pushState(history, scene, annotationCtx);
  layersPanel.renderList();
}

function doUndo() {
  if (undoHistory(history, scene, annotationCtx)) {
    requestRender();
    layersPanel.renderList();
    setStatus("Undo");
  }
}

function resizeCanvases(width, height) {
  displayCanvas.width = width;
  displayCanvas.height = height;
  annotationCanvas.width = width;
  annotationCanvas.height = height;
  applyZoom();
}

// ── Zoom (view-only — doesn't touch the backing store, just the CSS size) ──
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function applyZoom() {
  const dpr = window.devicePixelRatio || 1;
  if (scene.width > 0) {
    displayCanvas.style.width = (scene.width / dpr) * state.zoom + "px";
  }
  setZoomText(`${Math.round(state.zoom * 100)}%`);
}

function zoomIn() {
  state.zoom = ZOOM_STEPS.find((z) => z > state.zoom + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  applyZoom();
}

function zoomOut() {
  const prev = [...ZOOM_STEPS].reverse().find((z) => z < state.zoom - 0.001);
  state.zoom = prev ?? ZOOM_STEPS[0];
  applyZoom();
}

function zoomReset() {
  state.zoom = 1;
  applyZoom();
}

function zoomToFit() {
  if (!scene.width || !scene.height) return;
  const dpr = window.devicePixelRatio || 1;
  const availW = canvasWrap.clientWidth - 48;
  const availH = canvasWrap.clientHeight - 48;
  const naturalW = scene.width / dpr;
  const naturalH = scene.height / dpr;
  const scale = Math.min(availW / naturalW, availH / naturalH, ZOOM_STEPS[ZOOM_STEPS.length - 1]);
  state.zoom = Math.max(ZOOM_STEPS[0], scale);
  applyZoom();
}

// ── Page persistence (flush/load the live buffers above) ───────────────────
function persistActivePage() {
  const page = getActivePage(workspace);
  if (!page) return;
  page.sceneData = {
    width: scene.width,
    height: scene.height,
    layers: scene.layers,
    selectedLayerId: scene.selectedLayerId,
  };
  page.historyStack = history.stack;
  page.stepCounter = state.stepCounter;
  if (scene.width > 0 && scene.height > 0) {
    const snap = document.createElement("canvas");
    snap.width = scene.width;
    snap.height = scene.height;
    snap.getContext("2d").drawImage(annotationCanvas, 0, 0);
    page.annotationSnapshot = snap;
  } else {
    page.annotationSnapshot = null;
  }
}

function loadPageIntoBuffers(page) {
  scene.width = page.sceneData.width;
  scene.height = page.sceneData.height;
  scene.layers = page.sceneData.layers;
  scene.selectedLayerId = page.sceneData.selectedLayerId;
  history.stack = page.historyStack;
  state.stepCounter = page.stepCounter;
  state.pendingEmoji = null;
  resizeCanvases(scene.width, scene.height);
  if (scene.width > 0 && scene.height > 0) {
    annotationCtx.clearRect(0, 0, scene.width, scene.height);
    if (page.annotationSnapshot) annotationCtx.drawImage(page.annotationSnapshot, 0, 0);
  }
  requestRender();
  layersPanel.renderList();
  setSizeText(scene.width > 0 ? `${scene.width} × ${scene.height}px` : "No canvas yet");
}

function switchToPage(id) {
  if (id === workspace.activePageId) return;
  persistActivePage();
  workspace.activePageId = id;
  loadPageIntoBuffers(getActivePage(workspace));
  pagesPanel.renderList();
  setStatus(`Switched to ${getActivePage(workspace).name}`);
}

function handleNewPage() {
  persistActivePage();
  const page = createPage(workspace);
  workspace.activePageId = page.id;
  loadPageIntoBuffers(page);
  pagesPanel.renderList();
  setStatus(`Created ${page.name}`);
}

function handleActivePageRemoved() {
  // removePage() already re-pointed workspace.activePageId at a neighbor;
  // the removed page's buffers are gone, nothing to persist.
  loadPageIntoBuffers(getActivePage(workspace));
  setStatus("Page deleted");
}

function applyCanvasCrop(rect) {
  const merged = flatten(scene, annotationCanvas);
  const cropped = document.createElement("canvas");
  cropped.width = Math.round(rect.width);
  cropped.height = Math.round(rect.height);
  cropped
    .getContext("2d")
    .drawImage(merged, rect.x, rect.y, rect.width, rect.height, 0, 0, cropped.width, cropped.height);

  scene.width = cropped.width;
  scene.height = cropped.height;
  scene.layers = [];
  scene.selectedLayerId = null;
  addImageLayer(scene, cropped, {
    x: 0,
    y: 0,
    width: cropped.width,
    height: cropped.height,
    name: "Background",
  });
  scene.selectedLayerId = null;

  resizeCanvases(cropped.width, cropped.height);
  annotationCtx.clearRect(0, 0, cropped.width, cropped.height);
  state.stepCounter = 1;
  resetHistory(history);
  requestRender();
  pushUndo();
  pagesPanel.renderList();
  zoomToFit();
  setSizeText(`${cropped.width} × ${cropped.height}px`);
  setStatus(`Canvas cropped to ${cropped.width} × ${cropped.height}px`);
}

// ── Tool dispatch ────────────────────────────────────────────────────────────
function getPos(e) {
  const r = annotationCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (annotationCanvas.width / r.width),
    y: (e.clientY - r.top) * (annotationCanvas.height / r.height),
  };
}

const toolCtx = {
  scene,
  state,
  annotationCanvas,
  annotationCtx,
  displayCanvas,
  displayCtx,
  history,
  pushUndo,
  requestRender,
  setStatus,
  flatten: () => flatten(scene, annotationCanvas),
  promptText: (cx, cy, clientX, clientY, opts) =>
    promptText(container, annotationCanvas, cx, cy, clientX, clientY, opts),
  pickEmoji: (clientX, clientY) => pickEmoji(clientX, clientY),
  runCanvasCrop: () => runCanvasCrop(container, annotationCanvas),
  applyCanvasCrop: (rect) => applyCanvasCrop(rect),
};

annotationCanvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  getTool(state.tool)?.onPointerDown(toolCtx, getPos(e), e);
});
annotationCanvas.addEventListener("mousemove", (e) => {
  getTool(state.tool)?.onPointerMove(toolCtx, getPos(e), e);
});
annotationCanvas.addEventListener("mouseup", (e) => {
  getTool(state.tool)?.onPointerUp(toolCtx, getPos(e), e);
});
annotationCanvas.addEventListener("dblclick", (e) => {
  getTool(state.tool)?.onDoubleClick(toolCtx, getPos(e), e);
});
annotationCanvas.addEventListener("mouseleave", () => {
  state.drawing = false;
});

// ── Add image layers (file picker / drag-drop / paste) ─────────────────────
// On a blank workspace (no capture loaded) the artboard has no size yet — the
// first image added establishes it and becomes the full-bleed background,
// exactly like the original screenshot does in the capture flow. Any further
// images in the same drop/paste land as smaller centered layers on top.
function addImagesToScene(images) {
  const addedCount = images.length;
  let rest = images;

  if (scene.width === 0 || scene.height === 0) {
    const [first, ...remaining] = images;
    scene.width = first.width;
    scene.height = first.height;
    resizeCanvases(first.width, first.height);
    addImageLayer(scene, first, {
      x: 0,
      y: 0,
      width: first.width,
      height: first.height,
      name: first.__name || "Background",
    });
    rest = remaining;
    zoomToFit();
  }

  rest.forEach((img) => {
    const maxW = scene.width * 0.4;
    const scale = Math.min(1, maxW / img.width);
    const w = img.width * scale;
    const h = img.height * scale;
    addImageLayer(scene, img, {
      x: (scene.width - w) / 2,
      y: (scene.height - h) / 2,
      width: w,
      height: h,
      name: img.__name || "Image",
    });
  });

  requestRender();
  pushUndo();
  pagesPanel.renderList();
  setSizeText(`${scene.width} × ${scene.height}px`);
  setStatus(`Added ${addedCount} image${addedCount > 1 ? "s" : ""} · press V to move/resize`);
}

async function addImagesFromFiles(files) {
  const images = [];
  for (const file of files) {
    try {
      const img = await loadImageFromFile(file);
      img.__name = file.name;
      images.push(img);
    } catch (_) {
      // skip files that fail to decode
    }
  }
  if (images.length) addImagesToScene(images);
}

// ── Wire toolbar / layers panel / pages panel / keyboard ────────────────────
const layersPanel = initLayersPanel(layersPanelEl, scene, { requestRender, pushUndo });
const pagesPanel = initPagesPanel(pagesPanelEl, workspace, scene, {
  onSwitch: switchToPage,
  onNewPage: handleNewPage,
  onActivePageRemoved: handleActivePageRemoved,
});

initToolbar(state, {
  onToolChange: () => requestRender(),
  setStatus,
  onUndo: doUndo,
  onClear: () => {
    annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
    state.stepCounter = 1;
    pushUndo();
    setStatus("Cleared");
  },
  onDownload: () => {
    const size = downloadPng(scene, annotationCanvas);
    setStatus(`Downloaded PNG ✓ — ${size.width}×${size.height}px`);
  },
  onCopy: async () => {
    const ok = await copyToClipboard(scene, annotationCanvas);
    setStatus(ok ? "Copied to clipboard ✓" : "Copy failed — use Download instead");
  },
  onAddImage: () => openFilePicker(addImagesFromFiles),
  onExportPdf: () => {
    persistActivePage();
    openPdfExportDialog(workspace);
  },
});

initKeyboard(state, scene, {
  onUndo: doUndo,
  onDownload: () => document.getElementById("btnDownload").click(),
  onCopy: () => document.getElementById("btnCopy").click(),
  requestRender,
  pushUndo,
  onSceneChanged: () => layersPanel.renderList(),
});

setupDragDrop(canvasWrap, addImagesFromFiles);
setupPaste(addImagesFromFiles);
document.getElementById("btnAddImageEmpty").addEventListener("click", () => openFilePicker(addImagesFromFiles));

document.getElementById("zoomOutBtn").addEventListener("click", zoomOut);
document.getElementById("zoomInBtn").addEventListener("click", zoomIn);
document.getElementById("zoomLevelBtn").addEventListener("click", zoomReset);
document.getElementById("zoomFitBtn").addEventListener("click", zoomToFit);

// ── Load the initial capture, or start a blank workspace ───────────────────
// No capture just means the popup's "Blank Workspace" entry point was used —
// that's a normal path, not an error. The artboard stays unsized until the
// user adds a first image (see addImagesToScene), same as any other add.
loadCaptureFromBackground().then(async (capture) => {
  if (capture && capture.dataUrl) {
    const img = await loadImage(capture.dataUrl);
    scene.width = img.width;
    scene.height = img.height;
    resizeCanvases(img.width, img.height);
    addImageLayer(scene, img, { x: 0, y: 0, width: img.width, height: img.height, name: "Screenshot" });
    scene.selectedLayerId = null;
    pushUndo();
    setSizeText(`${img.width} × ${img.height}px`);
    setStatus(`Captured: ${capture.title || "Untitled"}`);
  } else {
    resizeCanvases(0, 0);
    setSizeText("No canvas yet");
    setStatus("Blank workspace — drag, paste, or Add Image to start");
  }

  requestRender();
  layersPanel.renderList();
  pagesPanel.renderList();
  document.getElementById("loading").style.display = "none";
  document.getElementById("toolbar").style.display = "flex";
  canvasWrap.style.display = "flex";
  document.getElementById("statusbar").style.display = "flex";
  zoomToFit();
});
