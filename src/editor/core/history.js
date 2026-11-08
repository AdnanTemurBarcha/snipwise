"use strict";

import { cloneLayers } from "./scene.js";

const MAX_HISTORY = 50;

export function createHistory() {
  return { stack: [] };
}

// Snapshots BOTH the layer metadata and the annotation raster in one entry so
// a single linear Ctrl+Z undoes whichever happened last — a layer move/resize
// or an annotation stroke — same mental model as the old raster-only undo.
export function pushState(history, scene, annotationCtx) {
  history.stack.push({
    sceneWidth: scene.width,
    sceneHeight: scene.height,
    layers: cloneLayers(scene.layers),
    selectedLayerId: scene.selectedLayerId,
    raster: annotationCtx.getImageData(
      0,
      0,
      annotationCtx.canvas.width,
      annotationCtx.canvas.height,
    ),
  });
  if (history.stack.length > MAX_HISTORY) history.stack.shift();
}

export function undo(history, scene, annotationCtx) {
  if (history.stack.length <= 1) return false;
  history.stack.pop();
  const entry = history.stack[history.stack.length - 1];
  scene.width = entry.sceneWidth;
  scene.height = entry.sceneHeight;
  scene.layers = cloneLayers(entry.layers);
  scene.selectedLayerId = entry.selectedLayerId;
  annotationCtx.putImageData(entry.raster, 0, 0);
  return true;
}

export function resetHistory(history) {
  history.stack = [];
}
