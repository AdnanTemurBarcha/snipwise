"use strict";

import { defineTool } from "./tool-base.js";
import { snapshotAnnotation, restoreAnnotation } from "./canvas-utils.js";

function drawRect(actx, x1, y1, x2, y2, color, strokeSize) {
  actx.globalAlpha = 1;
  actx.strokeStyle = color;
  actx.fillStyle = color;
  actx.lineWidth = strokeSize;
  actx.beginPath();
  actx.strokeRect(x1, y1, x2 - x1, y2 - y1);
}

export default defineTool({
  id: "rect",
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
    drawRect(ctx.annotationCtx, ctx.state.startX, ctx.state.startY, pos.x, pos.y, ctx.state.color, ctx.state.strokeSize);
  },
  onPointerUp(ctx) {
    if (!ctx.state.drawing) return;
    ctx.state.drawing = false;
    ctx.pushUndo();
  },
});
