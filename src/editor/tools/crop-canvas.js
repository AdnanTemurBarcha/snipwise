"use strict";

import { defineTool } from "./tool-base.js";

export default defineTool({
  id: "cropcanvas",
  cursor: "crosshair",
  async onPointerDown(ctx) {
    if (ctx.state.cropping) return;
    ctx.state.cropping = true;
    ctx.setStatus("Drag to select the area to keep · Enter to confirm · Esc to cancel");
    const rect = await ctx.runCanvasCrop();
    ctx.state.cropping = false;
    if (!rect) {
      ctx.setStatus("Crop cancelled");
      return;
    }
    ctx.applyCanvasCrop(rect);
  },
});
