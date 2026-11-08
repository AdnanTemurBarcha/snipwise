"use strict";

let nextId = 1;
function genId() {
  return "layer-" + nextId++ + "-" + Date.now().toString(36);
}

export function createScene(width, height) {
  return { width, height, layers: [], selectedLayerId: null };
}

export function addImageLayer(scene, img, opts = {}) {
  const layer = {
    id: genId(),
    type: "image",
    name: opts.name || "Image",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: opts.width ?? img.naturalWidth ?? img.width,
    height: opts.height ?? img.naturalHeight ?? img.height,
    opacity: 1,
    visible: true,
    locked: false,
    img,
  };
  scene.layers.push(layer);
  scene.selectedLayerId = layer.id;
  return layer;
}

export function addTextLayer(scene, opts = {}) {
  const layer = {
    id: genId(),
    type: "text",
    name: opts.name || "Text",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: opts.width ?? 100,
    height: opts.height ?? 20,
    opacity: 1,
    visible: true,
    locked: false,
    text: "",
    color: opts.color || "#a78bfa",
    fontSize: opts.fontSize || 16,
  };
  scene.layers.push(layer);
  scene.selectedLayerId = layer.id;
  return layer;
}

export function addCalloutLayer(scene, opts = {}) {
  const layer = {
    id: genId(),
    type: "callout",
    name: opts.name || "Callout",
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    width: opts.width ?? 140,
    height: opts.height ?? 40,
    opacity: 1,
    visible: true,
    locked: false,
    text: "",
    color: opts.color || "#a78bfa",
    fontSize: opts.fontSize || 14,
  };
  scene.layers.push(layer);
  scene.selectedLayerId = layer.id;
  return layer;
}

// Sets a text/callout layer's content and remeasures width/height from the
// resulting text at the layer's current fontSize — shared by tool creation
// (tools/text.js, tools/callout.js) and in-place double-click editing
// (tools/move.js). `measureCtx` is any live 2d context (measureText doesn't
// draw anything, so reusing the annotation context is safe).
export function setTextLayerContent(scene, id, text, measureCtx) {
  const l = getLayer(scene, id);
  if (!l) return;
  l.text = text;
  measureCtx.font = `600 ${l.fontSize}px Inter,sans-serif`;
  const w = measureCtx.measureText(text).width;
  if (l.type === "callout") {
    const pad = l.fontSize * 0.6;
    l.width = Math.max(40, w + pad * 2);
    l.height = Math.max(20, l.fontSize + pad * 2);
  } else {
    l.width = Math.max(10, w);
    l.height = Math.max(14, l.fontSize * 1.3);
  }
}

export function getLayer(scene, id) {
  return scene.layers.find((l) => l.id === id) || null;
}

export function removeLayer(scene, id) {
  scene.layers = scene.layers.filter((l) => l.id !== id);
  if (scene.selectedLayerId === id) scene.selectedLayerId = null;
}

export function moveLayer(scene, id, dx, dy) {
  const l = getLayer(scene, id);
  if (!l || l.locked) return;
  l.x += dx;
  l.y += dy;
}

export function resizeLayer(scene, id, bounds) {
  const l = getLayer(scene, id);
  if (!l || l.locked) return;
  const oldHeight = l.height;
  l.x = bounds.x;
  l.y = bounds.y;
  l.width = Math.max(4, bounds.width);
  l.height = Math.max(4, bounds.height);
  // Text/callout layers scale their font size with the box instead of
  // stretching text — a resize is always a "make it bigger/smaller", never
  // a horizontal-only distortion, regardless of how the drag was constrained.
  if ((l.type === "text" || l.type === "callout") && oldHeight > 0 && l.fontSize) {
    l.fontSize = Math.max(6, l.fontSize * (l.height / oldHeight));
  }
}

export function setLayerProp(scene, id, key, value) {
  const l = getLayer(scene, id);
  if (!l) return;
  l[key] = value;
}

// delta > 0 brings the layer forward (toward the end of the array / top of the stack)
export function reorderLayer(scene, id, delta) {
  const i = scene.layers.findIndex((l) => l.id === id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= scene.layers.length) return;
  const [l] = scene.layers.splice(i, 1);
  scene.layers.splice(j, 0, l);
}

export function hitTestLayer(scene, x, y) {
  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const l = scene.layers[i];
    if (!l.visible || l.locked) continue;
    if (x >= l.x && x <= l.x + l.width && y >= l.y && y <= l.y + l.height) return l;
  }
  return null;
}

export function setSelectedLayer(scene, id) {
  scene.selectedLayerId = id;
}

// Shallow-clones layer metadata for history snapshots — the decoded <img> is
// immutable and reused by reference, so this stays cheap even with many layers.
export function cloneLayers(layers) {
  return layers.map((l) => ({ ...l }));
}
