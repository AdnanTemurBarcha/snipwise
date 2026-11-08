"use strict";

import { defineTool } from "./tool-base.js";
import { setupStroke } from "./canvas-utils.js";

export default defineTool({
  id: "pen",
  cursor: "crosshair",
  onPointerDown(ctx, pos) {
    ctx.state.drawing = true;
    ctx.annotationCtx.beginPath();
    ctx.annotationCtx.moveTo(pos.x, pos.y);
  },
  onPointerMove(ctx, pos) {
    if (!ctx.state.drawing) return;
    setupStroke(ctx.annotationCtx, ctx.state.color, ctx.state.strokeSize, 1);
    ctx.annotationCtx.lineTo(pos.x, pos.y);
    ctx.annotationCtx.stroke();
  },
  onPointerUp(ctx) {
    if (!ctx.state.drawing) return;
    ctx.state.drawing = false;
    ctx.annotationCtx.beginPath();
    ctx.pushUndo();
  },
});
