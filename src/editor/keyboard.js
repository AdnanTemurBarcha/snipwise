"use strict";

import { selectTool } from "./ui/toolbar.js";
import { removeLayer, moveLayer } from "./core/scene.js";

const SHORTCUTS = {
  v: "move",
  p: "pen",
  a: "arrow",
  l: "line",
  r: "rect",
  c: "circle",
  t: "text",
  h: "highlight",
  b: "blur",
  s: "step",
  o: "callout",
  e: "emoji",
  x: "cropcanvas",
};

export function initKeyboard(state, scene, hooks) {
  const { onUndo, onDownload, onCopy, requestRender, pushUndo, onSceneChanged } = hooks;

  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      onUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      onDownload();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "c") {
      onCopy();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;

    if (state.tool === "move" && scene.selectedLayerId) {
      if (e.key === "Delete" || e.key === "Backspace") {
        removeLayer(scene, scene.selectedLayerId);
        requestRender();
        pushUndo();
        onSceneChanged?.();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const deltas = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (deltas[e.key]) {
        e.preventDefault();
        const [dx, dy] = deltas[e.key];
        moveLayer(scene, scene.selectedLayerId, dx, dy);
        requestRender();
        pushUndo();
        return;
      }
    }

    if (SHORTCUTS[e.key]) selectTool(SHORTCUTS[e.key]);
  });
}
