"use strict";

import { defineTool } from "./tool-base.js";

export default defineTool({
  id: "step",
  cursor: "crosshair",
  onPointerDown(ctx, pos) {
    const actx = ctx.annotationCtx;
    const r = Math.max(16, ctx.state.strokeSize * 5);
    const num = ctx.state.stepCounter++;

    actx.globalAlpha = 1;
    actx.beginPath();
    actx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    actx.fillStyle = ctx.state.color;
    actx.fill();

    actx.fillStyle = "#fff";
    actx.font = `bold ${Math.round(r * 1.1)}px Inter,sans-serif`;
    actx.textAlign = "center";
    actx.textBaseline = "middle";
    actx.fillText(num > 9 ? "9+" : String(num), pos.x, pos.y + 1);
    actx.textAlign = "left";
    actx.textBaseline = "alphabetic";

    ctx.pushUndo();
    ctx.setStatus(`Step ${num} placed`);
  },
});
