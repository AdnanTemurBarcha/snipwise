"use strict";

import { iconMarkup } from "./icons.js";

const TOOL_BUTTONS = {
  toolMove: "move",
  toolPen: "pen",
  toolArrow: "arrow",
  toolLine: "line",
  toolRect: "rect",
  toolCircle: "circle",
  toolText: "text",
  toolHighlight: "highlight",
  toolBlur: "blur",
  toolStep: "step",
  toolCallout: "callout",
  toolEmoji: "emoji",
  toolCropCanvas: "cropcanvas",
};

// Pure DOM wiring — the actual behavior (undo, clear, export, add-image) is
// injected via `hooks` from main.js so this file never has to know how any
// of it actually works.
export function initToolbar(state, hooks) {
  const { onToolChange, setStatus, onUndo, onClear, onDownload, onCopy, onAddImage, onExportPdf } = hooks;

  Object.keys(TOOL_BUTTONS).forEach((id) => {
    document.getElementById(id).addEventListener("click", () => {
      Object.keys(TOOL_BUTTONS).forEach((t) => document.getElementById(t).classList.remove("active"));
      document.getElementById(id).classList.add("active");
      state.tool = TOOL_BUTTONS[id];
      state.pendingEmoji = null;
      onToolChange(state.tool);
      setStatus(`Tool: ${state.tool}`);
    });
  });

  const customColor = document.getElementById("customColor");
  const hexColor = document.getElementById("hexColor");

  // Single point of truth for "the color changed" — keeps the swatches,
  // the free picker, and the hex field all in sync regardless of which one
  // the user actually touched.
  function setColor(hex, { deselectSwatches = true } = {}) {
    state.color = hex;
    customColor.value = hex;
    hexColor.value = hex;
    if (deselectSwatches) {
      document.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("active"));
    }
  }

  document.getElementById("colorPicker").addEventListener("click", (e) => {
    const s = e.target.closest(".color-swatch");
    if (!s) return;
    setColor(s.dataset.color, { deselectSwatches: false });
    document.querySelectorAll(".color-swatch").forEach((x) => x.classList.remove("active"));
    s.classList.add("active");
  });

  // Free color selection — native picker, no preset restriction.
  customColor.addEventListener("input", () => setColor(customColor.value));

  // Hex text entry — accepts "#rrggbb" or "rrggbb" typed/pasted directly.
  // Invalid/partial input is left alone until it resolves to 6 hex digits;
  // on blur it snaps back to the last valid color so the field never shows
  // a half-typed value.
  hexColor.addEventListener("input", () => {
    const v = hexColor.value.trim();
    const hex = v.startsWith("#") ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) setColor(hex);
  });
  hexColor.addEventListener("blur", () => {
    hexColor.value = state.color;
  });
  hexColor.addEventListener("keydown", (e) => {
    if (e.key === "Enter") hexColor.blur();
  });

  document.getElementById("strokeSize").addEventListener("input", (e) => {
    state.strokeSize = parseInt(e.target.value, 10) || 3;
  });

  document.getElementById("themeBtn").addEventListener("click", () => {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    chrome.storage.local.set({ theme: dark ? "dark" : "light" });
  });

  const ratioLockBtn = document.getElementById("toolRatioLock");
  ratioLockBtn.addEventListener("click", () => {
    state.ratioLocked = !state.ratioLocked;
    ratioLockBtn.classList.toggle("toggle-on", state.ratioLocked);
    ratioLockBtn.innerHTML = iconMarkup(state.ratioLocked ? "ratioLock" : "ratioUnlock");
    setStatus(state.ratioLocked ? "Ratio lock on — resizes stay proportional" : "Ratio lock off");
  });

  document.getElementById("toolUndo").addEventListener("click", () => onUndo());
  document.getElementById("toolClear").addEventListener("click", () => onClear());
  document.getElementById("btnDownload").addEventListener("click", () => onDownload());
  document.getElementById("btnCopy").addEventListener("click", () => onCopy());
  document.getElementById("btnAddImage").addEventListener("click", () => onAddImage());
  document.getElementById("btnExportPdf").addEventListener("click", () => onExportPdf());
}

export function selectTool(id) {
  const btnId = Object.keys(TOOL_BUTTONS).find((k) => TOOL_BUTTONS[k] === id);
  if (btnId) document.getElementById(btnId).click();
}
