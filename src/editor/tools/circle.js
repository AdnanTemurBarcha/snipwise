"use strict";

import { defineTool } from "./tool-base.js";
import { snapshotAnnotation, restoreAnnotation } from "./canvas-utils.js";

function drawCircle(actx, x1, y1, x2, y2, color, strokeSize) {
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const rx = Math.abs(x2 - x1) / 2;
  const ry = Math.abs(y2 - y1) / 2;
  actx.globalAlpha = 1;
  actx.strokeStyle = color;
  actx.lineWidth = strokeSize;
  actx.beginPath();
  actx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  actx.stroke();
}

export default defineTool({
  id: "circle",
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
    drawCircle(ctx.annotationCtx, ctx.state.startX, ctx.state.startY, pos.x, pos.y, ctx.state.color, ctx.state.strokeSize);
  },
  onPointerUp(ctx) {
    if (!ctx.state.drawing) return;
    ctx.state.drawing = false;
    ctx.pushUndo();
  },
});
