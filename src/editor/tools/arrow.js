"use strict";

import { defineTool } from "./tool-base.js";
import { arrowHeadPoints } from "../core/geometry.js";
import { snapshotAnnotation, restoreAnnotation } from "./canvas-utils.js";

function drawArrow(actx, x1, y1, x2, y2, color, strokeSize) {
  const headLen = Math.max(14, strokeSize * 5);
  const { shaftEndX, shaftEndY, p1, p2 } = arrowHeadPoints(x1, y1, x2, y2, headLen);

  actx.globalAlpha = 1;
  actx.strokeStyle = color;
  actx.lineWidth = strokeSize;
  actx.lineCap = "round";
  actx.beginPath();
  actx.moveTo(x1, y1);
  actx.lineTo(shaftEndX, shaftEndY);
  actx.stroke();

  actx.beginPath();
  actx.moveTo(x2, y2);
  actx.lineTo(p1.x, p1.y);
  actx.lineTo(p2.x, p2.y);
  actx.closePath();
  actx.fillStyle = color;
  actx.fill();
}

export default defineTool({
  id: "arrow",
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
    drawArrow(ctx.annotationCtx, ctx.state.startX, ctx.state.startY, pos.x, pos.y, ctx.state.color, ctx.state.strokeSize);
  },
  onPointerUp(ctx) {
    if (!ctx.state.drawing) return;
    ctx.state.drawing = false;
    ctx.pushUndo();
  },
});
