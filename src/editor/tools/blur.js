"use strict";

import { defineTool } from "./tool-base.js";
import { snapshotAnnotation, restoreAnnotation } from "./canvas-utils.js";

function blurPreview(actx, x1, y1, x2, y2) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  actx.globalAlpha = 1;
  actx.strokeStyle = "#a78bfa";
  actx.lineWidth = 2;
  actx.setLineDash([6, 3]);
  actx.strokeRect(x, y, w, h);
  actx.setLineDash([]);
}

export default defineTool({
  id: "blur",
  cursor: "crosshair",
  onPointerDown(ctx, pos) {
    ctx.state.drawing = true;
    ctx.state.startX = pos.x;
    ctx.state.startY = pos.y;
    ctx.state.lastSnap = snapshotAnnotation(ctx.annotationCtx);
  },
  onPointerMove(ctx, pos) {
    if (!ctx.state.drawing) return;
    restoreAnnotation(ctx.annotationCtx, ctx.state.lastSnap);
    blurPreview(ctx.annotationCtx, ctx.state.startX, ctx.state.startY, pos.x, pos.y);
  },
  onPointerUp(ctx, pos) {
    if (!ctx.state.drawing) return;
    ctx.state.drawing = false;
    // Restore the clean pre-preview raster before sampling so the dashed
    // selection outline itself never gets baked into the pixelated result.
    restoreAnnotation(ctx.annotationCtx, ctx.state.lastSnap);

    const x1 = ctx.state.startX;
    const y1 = ctx.state.startY;
    const x = Math.min(x1, pos.x);
    const y = Math.min(y1, pos.y);
    const w = Math.abs(pos.x - x1);
    const h = Math.abs(pos.y - y1);

    if (w >= 4 && h >= 4) {
      const merged = ctx.flatten();
      const pixel = 12;
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.round(w / pixel));
      tmp.height = Math.max(1, Math.round(h / pixel));
      const tCtx = tmp.getContext("2d");
      tCtx.imageSmoothingEnabled = false;
      tCtx.drawImage(merged, x, y, w, h, 0, 0, tmp.width, tmp.height);

      ctx.annotationCtx.imageSmoothingEnabled = false;
      ctx.annotationCtx.globalAlpha = 1;
      ctx.annotationCtx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      ctx.annotationCtx.imageSmoothingEnabled = true;
    }
    ctx.pushUndo();
  },
});
