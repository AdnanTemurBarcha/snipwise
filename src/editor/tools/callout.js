"use strict";

import { defineTool } from "./tool-base.js";
import { addCalloutLayer, setTextLayerContent, resizeLayer } from "../core/scene.js";

export default defineTool({
  id: "callout",
  cursor: "crosshair",
  async onPointerDown(ctx, pos, e) {
    const fontSize = Math.max(13, ctx.state.strokeSize * 3);
    const text = await ctx.promptText(pos.x, pos.y, e.clientX, e.clientY, {
      color: ctx.state.color,
      fontSize,
      variant: "callout",
    });
    if (!text) return;

    const layer = addCalloutLayer(ctx.scene, { x: pos.x, y: pos.y, color: ctx.state.color, fontSize });
    setTextLayerContent(ctx.scene, layer.id, text, ctx.annotationCtx);
    // Now that width/height are known, position the bubble above the click
    // point with its tail pointing back down toward it (tail sits at 25%
    // from the left edge — see render/compositor.js's drawCalloutLayer).
    resizeLayer(ctx.scene, layer.id, {
      x: pos.x - layer.width * 0.25,
      y: pos.y - layer.height - 12,
      width: layer.width,
      height: layer.height,
    });

    ctx.requestRender();
    ctx.pushUndo();
    ctx.setStatus("Callout added — switch to Move tool to reposition or double-click to edit");
  },
});
