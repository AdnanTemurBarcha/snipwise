"use strict";

import { getLayer } from "../core/scene.js";
import { HANDLE_SIZE } from "../core/geometry.js";

// Draws a single scene layer, whatever its type — the one place that knows
// how each layer type gets rendered, shared by render() and flatten() so the
// on-screen view and any exported/flattened output never diverge.
function drawLayer(ctx, layer) {
  ctx.globalAlpha = layer.opacity;
  if (layer.type === "text") {
    drawTextLayer(ctx, layer);
  } else if (layer.type === "callout") {
    drawCalloutLayer(ctx, layer);
  } else {
    ctx.drawImage(layer.img, layer.x, layer.y, layer.width, layer.height);
  }
}

function drawTextLayer(ctx, layer) {
  ctx.font = `600 ${layer.fontSize}px Inter,sans-serif`;
  ctx.fillStyle = layer.color;
  ctx.textBaseline = "top";
  ctx.fillText(layer.text, layer.x, layer.y);
  ctx.textBaseline = "alphabetic";
}

function drawCalloutLayer(ctx, layer) {
  const { x, y, width, height, fontSize } = layer;
  const pad = fontSize * 0.6;
  const tailX = x + width * 0.25;

  ctx.fillStyle = layer.color;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 8);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(tailX - 8, y + height);
  ctx.lineTo(tailX + 8, y + height);
  ctx.lineTo(tailX, y + height + 10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = `600 ${fontSize}px Inter,sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(layer.text, x + pad, y + pad);
  ctx.textBaseline = "alphabetic";
}

// Draws the scene's layers back-to-front onto `displayCtx`, then the
// annotation raster on top, then (optionally) a selection outline + resize
// handles for the active layer. Event-driven, not a render loop — callers
// invoke this only when something actually changed.
export function render(scene, displayCtx, annotationCanvas, opts = {}) {
  const { width, height } = scene;
  if (displayCtx.canvas.width !== width) displayCtx.canvas.width = width;
  if (displayCtx.canvas.height !== height) displayCtx.canvas.height = height;

  displayCtx.clearRect(0, 0, width, height);
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    drawLayer(displayCtx, layer);
  }
  displayCtx.globalAlpha = 1;
  if (annotationCanvas.width > 0 && annotationCanvas.height > 0) {
    displayCtx.drawImage(annotationCanvas, 0, 0);
  }

  if (opts.showSelection && scene.selectedLayerId) {
    const layer = getLayer(scene, scene.selectedLayerId);
    if (layer) drawSelectionOverlay(displayCtx, layer);
  }
}

function drawSelectionOverlay(ctx, layer) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(layer.x, layer.y, layer.width, layer.height);
  ctx.setLineDash([]);
  ctx.fillStyle = "#a78bfa";
  const corners = [
    [layer.x, layer.y],
    [layer.x + layer.width, layer.y],
    [layer.x, layer.y + layer.height],
    [layer.x + layer.width, layer.y + layer.height],
  ];
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - HANDLE_SIZE / 2, cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }
  ctx.restore();
}

// Flattens image layers + the annotation raster into a brand-new canvas, with
// no selection UI. Used by export, blur sampling, and Crop Canvas.
export function flatten(scene, annotationCanvas) {
  const c = document.createElement("canvas");
  c.width = scene.width;
  c.height = scene.height;
  const ctx = c.getContext("2d");
  for (const layer of scene.layers) {
    if (!layer.visible) continue;
    drawLayer(ctx, layer);
  }
  ctx.globalAlpha = 1;
  if (annotationCanvas.width > 0 && annotationCanvas.height > 0) {
    ctx.drawImage(annotationCanvas, 0, 0);
  }
  return c;
}
