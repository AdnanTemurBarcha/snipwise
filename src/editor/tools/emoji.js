"use strict";

import { defineTool } from "./tool-base.js";

export default defineTool({
  id: "emoji",
  cursor: "crosshair",
  async onPointerDown(ctx, pos, e) {
    if (ctx.state.pendingEmoji) {
      const size = Math.max(24, ctx.state.strokeSize * 8);
      const actx = ctx.annotationCtx;
      actx.globalAlpha = 1;
      actx.font = `${size}px serif`;
      actx.textBaseline = "middle";
      actx.fillText(ctx.state.pendingEmoji, pos.x - size / 2, pos.y);
      actx.textBaseline = "alphabetic";
      ctx.state.pendingEmoji = null;
      ctx.pushUndo();
      ctx.setStatus("Emoji stamped");
      return;
    }
    const emoji = await ctx.pickEmoji(e.clientX, e.clientY);
    if (emoji) {
      ctx.state.pendingEmoji = emoji;
      ctx.setStatus(`Click canvas to stamp ${emoji}`);
    }
  },
});
