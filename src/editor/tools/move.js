"use strict";

import { defineTool } from "./tool-base.js";
import { hitTestLayer, resizeLayer, setSelectedLayer, getLayer, setTextLayerContent } from "../core/scene.js";
import { HANDLE_SIZE, hitTestHandle, resizeFromHandle } from "../core/geometry.js";

// Module-scoped drag state — this editor only ever has one active instance
// per page, matching the singleton style the rest of the codebase already uses.
let dragMode = null; // 'move' | 'resize' | null
let dragHandle = null;
let dragStart = { x: 0, y: 0 };
let origBounds = null;
let dragForceConstrain = false;

function isTextLike(layer) {
  return layer && (layer.type === "text" || layer.type === "callout");
}

export default defineTool({
  id: "move",
  cursor: "default",
  onPointerDown(ctx, pos) {
    const { scene } = ctx;
    const selected = scene.selectedLayerId ? getLayer(scene, scene.selectedLayerId) : null;

    if (selected) {
      const handle = hitTestHandle(pos.x, pos.y, selected, HANDLE_SIZE);
      if (handle) {
        dragMode = "resize";
        dragHandle = handle;
        dragStart = { x: pos.x, y: pos.y };
        origBounds = { x: selected.x, y: selected.y, width: selected.width, height: selected.height };
        dragForceConstrain = isTextLike(selected);
        return;
      }
    }

    const hit = hitTestLayer(scene, pos.x, pos.y);
    setSelectedLayer(scene, hit ? hit.id : null);
    if (hit) {
      dragMode = "move";
      dragStart = { x: pos.x, y: pos.y };
      origBounds = { x: hit.x, y: hit.y, width: hit.width, height: hit.height };
    } else {
      dragMode = null;
    }
    ctx.requestRender();
  },
  onPointerMove(ctx, pos, e) {
    if (!dragMode) return;
    const { scene } = ctx;
    const id = scene.selectedLayerId;
    if (!id) return;
    const dx = pos.x - dragStart.x;
    const dy = pos.y - dragStart.y;

    if (dragMode === "move") {
      resizeLayer(scene, id, {
        x: origBounds.x + dx,
        y: origBounds.y + dy,
        width: origBounds.width,
        height: origBounds.height,
      });
    } else if (dragMode === "resize") {
      const constrain = dragForceConstrain || Boolean(e?.shiftKey) || Boolean(ctx.state.ratioLocked);
      resizeLayer(scene, id, resizeFromHandle(dragHandle, origBounds, dx, dy, constrain));
    }
    ctx.requestRender();
  },
  onPointerUp(ctx) {
    if (dragMode) {
      dragMode = null;
      dragHandle = null;
      origBounds = null;
      dragForceConstrain = false;
      ctx.pushUndo();
    }
  },
  async onDoubleClick(ctx, pos, e) {
    const { scene } = ctx;
    const hit = hitTestLayer(scene, pos.x, pos.y);
    if (!isTextLike(hit)) return;

    const newText = await ctx.promptText(hit.x, hit.y, e.clientX, e.clientY, {
      color: hit.color,
      fontSize: hit.fontSize,
      variant: hit.type,
      initialValue: hit.text,
    });
    if (newText === null) return;

    setTextLayerContent(scene, hit.id, newText, ctx.annotationCtx);
    ctx.requestRender();
    ctx.pushUndo();
    ctx.setStatus(`${hit.type === "callout" ? "Callout" : "Text"} updated`);
  },
});
