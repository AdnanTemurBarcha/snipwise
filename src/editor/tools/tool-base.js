"use strict";

// Shared tool shape. A tool never touches `document` — it receives an
// injected `ctx` (scene, annotation canvas, history, and a handful of
// UI callbacks) plus a canvas-space pointer position, and mutates
// scene/annotation state through that ctx. All DOM wiring lives in ui/*.
export function defineTool(def) {
  return {
    id: def.id,
    cursor: def.cursor || "crosshair",
    onPointerDown: def.onPointerDown || (() => {}),
    onPointerMove: def.onPointerMove || (() => {}),
    onPointerUp: def.onPointerUp || (() => {}),
    onDoubleClick: def.onDoubleClick || (() => {}),
  };
}
