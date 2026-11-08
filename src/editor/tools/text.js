"use strict";

import { defineTool } from "./tool-base.js";
import { addTextLayer, setTextLayerContent } from "../core/scene.js";

export default defineTool({
  id: "text",
  cursor: "text",
  async onPointerDown(ctx, pos, e) {
    const fontSize = Math.max(14, ctx.state.strokeSize * 4);
    const text = await ctx.promptText(pos.x, pos.y, e.clientX, e.clientY, {
      color: ctx.state.color,
      fontSize,
      variant: "text",
    });
    if (!text) return;

    const layer = addTextLayer(ctx.scene, {
      x: pos.x,
      y: pos.y - fontSize * 0.5,
      color: ctx.state.color,
      fontSize,
    });
    setTextLayerContent(ctx.scene, layer.id, text, ctx.annotationCtx);
    ctx.requestRender();
    ctx.pushUndo();
    ctx.setStatus("Text added — switch to Move tool to reposition or double-click to edit");
  },
});
