"use strict";

// Same message the old editor.js used — background.js is untouched.
export function loadCaptureFromBackground() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "getCaptureData" }, (capture) => resolve(capture || null));
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

export async function loadImageFromFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  return loadImage(dataUrl);
}

export function setupDragDrop(target, onFiles) {
  ["dragenter", "dragover"].forEach((evt) =>
    target.addEventListener(evt, (e) => {
      e.preventDefault();
      target.classList.add("drag-over");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    target.addEventListener(evt, (e) => {
      e.preventDefault();
      target.classList.remove("drag-over");
    }),
  );
  target.addEventListener("drop", (e) => {
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith("image/"));
    if (files.length) onFiles(files);
  });
}

export function setupPaste(onFiles) {
  document.addEventListener("paste", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return; // let inline text inputs handle text paste normally
    const items = Array.from(e.clipboardData?.items || []);
    const files = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) onFiles(files);
  });
}

export function openFilePicker(onFiles) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.style.display = "none";
  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    if (files.length) onFiles(files);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
