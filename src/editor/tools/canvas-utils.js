"use strict";

export function setupStroke(ctx, color, width, alpha) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = alpha;
}

export function snapshotAnnotation(ctx) {
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function restoreAnnotation(ctx, snapshot) {
  ctx.putImageData(snapshot, 0, 0);
}
