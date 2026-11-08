"use strict";

import { defineTool } from "./tool-base.js";
import { snapshotAnnotation, restoreAnnotation } from "./canvas-utils.js";

function drawLine(actx, x1, y1, x2, y2, color, strokeSize) {
  actx.globalAlpha = 1;
  actx.strokeStyle = color;
  actx.lineWidth = strokeSize;
  actx.lineCap = "round";
  actx.beginPath();
  actx.moveTo(x1, y1);
  actx.lineTo(x2, y2);
  actx.stroke();
}

export default defineTool({
  id: "line",
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
    drawLine(ctx.annotationCtx, ctx.state.startX, ctx.state.startY, pos.x, pos.y, ctx.state.color, ctx.state.strokeSize);
  },
  onPointerUp(ctx) {
    if (!ctx.state.drawing) return;
    ctx.state.drawing = false;
    ctx.pushUndo();
  },
});
