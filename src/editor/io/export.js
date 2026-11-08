"use strict";

import { flatten } from "../render/compositor.js";

export function downloadPng(scene, annotationCanvas) {
  const merged = flatten(scene, annotationCanvas);
  const a = document.createElement("a");
  a.download = `snipwise-${Date.now()}.png`;
  a.href = merged.toDataURL("image/png", 1.0);
  a.click();
  return { width: merged.width, height: merged.height };
}

export function copyToClipboard(scene, annotationCanvas) {
  const merged = flatten(scene, annotationCanvas);
  return new Promise((resolve) => {
    merged.toBlob(
      async (blob) => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          resolve(true);
        } catch (_) {
          resolve(false);
        }
      },
      "image/png",
      1.0,
    );
  });
}
