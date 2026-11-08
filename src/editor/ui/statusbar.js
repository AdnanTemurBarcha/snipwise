"use strict";

export function setStatus(text) {
  document.getElementById("statusText").textContent = text;
}

export function setSizeText(text) {
  document.getElementById("sizeText").textContent = text;
}

export function setZoomText(text) {
  document.getElementById("zoomLevelBtn").textContent = text;
}
