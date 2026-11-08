"use strict";

export const HANDLE_SIZE = 10;

export function pointInRect(px, py, rect) {
  return (
    px >= rect.x &&
    px <= rect.x + rect.width &&
    py >= rect.y &&
    py <= rect.y + rect.height
  );
}

// Returns which corner ('nw'|'ne'|'sw'|'se') of a layer's bounding box is
// under (px, py), within `radius` canvas-space pixels, or null.
export function hitTestHandle(px, py, layer, radius) {
  const corners = {
    nw: { x: layer.x, y: layer.y },
    ne: { x: layer.x + layer.width, y: layer.y },
    sw: { x: layer.x, y: layer.y + layer.height },
    se: { x: layer.x + layer.width, y: layer.y + layer.height },
  };
  for (const name of Object.keys(corners)) {
    const c = corners[name];
    if (Math.abs(px - c.x) <= radius && Math.abs(py - c.y) <= radius) return name;
  }
  return null;
}

// Given the bounds at drag-start and a pointer delta, returns the new bounds
// for a corner-handle resize (opposite corner stays anchored). With
// `constrain` true, width/height are scaled together to preserve the
// original aspect ratio — driven by whichever axis moved proportionally
// more — instead of following dx/dy independently.
export function resizeFromHandle(handle, orig, dx, dy, constrain = false) {
  if (!constrain) {
    let { x, y, width, height } = orig;
    if (handle === "se") {
      width += dx;
      height += dy;
    } else if (handle === "sw") {
      x += dx;
      width -= dx;
      height += dy;
    } else if (handle === "ne") {
      y += dy;
      width += dx;
      height -= dy;
    } else if (handle === "nw") {
      x += dx;
      y += dy;
      width -= dx;
      height -= dy;
    }
    return { x, y, width, height };
  }

  let rawW = orig.width;
  let rawH = orig.height;
  if (handle === "se") {
    rawW += dx;
    rawH += dy;
  } else if (handle === "sw") {
    rawW -= dx;
    rawH += dy;
  } else if (handle === "ne") {
    rawW += dx;
    rawH -= dy;
  } else if (handle === "nw") {
    rawW -= dx;
    rawH -= dy;
  }

  const scaleW = rawW / orig.width;
  const scaleH = rawH / orig.height;
  const scale = Math.abs(scaleW - 1) > Math.abs(scaleH - 1) ? scaleW : scaleH;
  const ratio = orig.width / orig.height;
  const width = Math.max(4, orig.width * scale);
  const height = Math.max(4, width / ratio);

  let x = orig.x;
  let y = orig.y;
  if (handle === "sw" || handle === "nw") x = orig.x + orig.width - width;
  if (handle === "ne" || handle === "nw") y = orig.y + orig.height - height;

  return { x, y, width, height };
}

// Arrow shaft-end (stops short of the tip) + arrowhead wing points.
export function arrowHeadPoints(x1, y1, x2, y2, headLen) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const shaftEndX = x2 - headLen * 0.75 * Math.cos(angle);
  const shaftEndY = y2 - headLen * 0.75 * Math.sin(angle);
  const p1 = {
    x: x2 - headLen * Math.cos(angle - Math.PI / 7),
    y: y2 - headLen * Math.sin(angle - Math.PI / 7),
  };
  const p2 = {
    x: x2 - headLen * Math.cos(angle + Math.PI / 7),
    y: y2 - headLen * Math.sin(angle + Math.PI / 7),
  };
  return { angle, shaftEndX, shaftEndY, p1, p2 };
}
