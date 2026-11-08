"use strict";

import { buildPdfDocument, exportWorkspaceToPdf, DEFAULT_PDF_OPTIONS } from "../io/pdf-export.js";

const ACCENT_SWATCHES = ["#7c3aed", "#a78bfa", "#f87171", "#4ade80", "#fbbf24", "#38bdf8", "#111827"];

let overlayEl = null;
let built = false;
let previewUrl = null;
let debounceTimer = null;

function buildDialog(overlay) {
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-label="Export PDF">
      <div class="modal-header">
        <span>Export PDF</span>
        <button class="modal-close" id="pdfDialogClose" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="pdf-settings">
          <label class="pdf-field">
            <span>Page size</span>
            <select id="pdfPageSize">
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
              <option value="legal">Legal</option>
            </select>
          </label>
          <label class="pdf-field">
            <span>Orientation</span>
            <select id="pdfOrientation">
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <label class="pdf-field">
            <span>Margin (mm)</span>
            <input type="number" id="pdfMargin" min="5" max="30" step="1" />
          </label>
          <label class="pdf-field">
            <span>Page fit</span>
            <select id="pdfPageFit">
              <option value="fit">Fit each page to one PDF page</option>
              <option value="split">Split tall pages across multiple</option>
            </select>
          </label>
          <label class="pdf-checkbox">
            <input type="checkbox" id="pdfIncludeCover" />
            <span>Include cover page</span>
          </label>
          <div id="pdfCoverFields">
            <label class="pdf-field">
              <span>Cover title</span>
              <input type="text" id="pdfCoverTitle" maxlength="60" />
            </label>
            <div class="pdf-field">
              <span>Accent color</span>
              <div class="pdf-accent-row">
                <div class="pdf-accent-swatches" id="pdfAccentSwatches"></div>
                <div class="pdf-accent-custom-group">
                  <label class="color-custom-wrap" title="Custom accent color — pick any color">
                    <input type="color" id="pdfAccentCustom" class="color-custom" />
                  </label>
                  <input
                    class="hex-input"
                    id="pdfAccentHex"
                    type="text"
                    maxlength="7"
                    spellcheck="false"
                    autocomplete="off"
                    title="Hex color"
                  />
                </div>
              </div>
            </div>
            <label class="pdf-checkbox">
              <input type="checkbox" id="pdfIncludeThumbnail" />
              <span>Include page thumbnail</span>
            </label>
          </div>
        </div>
        <div class="pdf-preview">
          <iframe id="pdfPreviewFrame" title="PDF preview"></iframe>
          <div class="pdf-preview-status" id="pdfPreviewStatus"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="pdfDialogCancel">Cancel</button>
        <button class="btn btn-primary" id="pdfDialogExport">Export PDF</button>
      </div>
    </div>
  `;

  const swatchRow = overlay.querySelector("#pdfAccentSwatches");
  ACCENT_SWATCHES.forEach((hex) => {
    const sw = document.createElement("div");
    sw.className = "pdf-accent-swatch";
    sw.style.background = hex;
    sw.dataset.color = hex;
    swatchRow.appendChild(sw);
  });
}

function readOptions(overlay) {
  return {
    pageSize: overlay.querySelector("#pdfPageSize").value,
    orientation: overlay.querySelector("#pdfOrientation").value,
    marginMm: parseFloat(overlay.querySelector("#pdfMargin").value) || DEFAULT_PDF_OPTIONS.marginMm,
    pageFit: overlay.querySelector("#pdfPageFit").value,
    includeCover: overlay.querySelector("#pdfIncludeCover").checked,
    coverTitle: overlay.querySelector("#pdfCoverTitle").value || DEFAULT_PDF_OPTIONS.coverTitle,
    coverAccent:
      overlay.querySelector("#pdfAccentSwatches .active")?.dataset.color ||
      overlay.querySelector("#pdfAccentCustom").value,
    includeThumbnail: overlay.querySelector("#pdfIncludeThumbnail").checked,
  };
}

function applyOptionsToForm(overlay, opts) {
  overlay.querySelector("#pdfPageSize").value = opts.pageSize;
  overlay.querySelector("#pdfOrientation").value = opts.orientation;
  overlay.querySelector("#pdfMargin").value = opts.marginMm;
  overlay.querySelector("#pdfPageFit").value = opts.pageFit;
  overlay.querySelector("#pdfIncludeCover").checked = opts.includeCover;
  overlay.querySelector("#pdfCoverTitle").value = opts.coverTitle;
  overlay.querySelector("#pdfIncludeThumbnail").checked = opts.includeThumbnail;
  overlay.querySelectorAll("#pdfAccentSwatches .pdf-accent-swatch").forEach((sw) => {
    sw.classList.toggle("active", sw.dataset.color === opts.coverAccent);
  });
  overlay.querySelector("#pdfAccentCustom").value = opts.coverAccent;
  overlay.querySelector("#pdfAccentHex").value = opts.coverAccent;
  overlay.querySelector("#pdfCoverFields").style.display = opts.includeCover ? "flex" : "none";
}

function regeneratePreview(overlay, workspace) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const statusEl = overlay.querySelector("#pdfPreviewStatus");
    statusEl.textContent = "Generating preview…";
    try {
      const opts = readOptions(overlay);
      const { doc } = buildPdfDocument(workspace, opts);
      const blob = doc.output("blob");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      overlay.querySelector("#pdfPreviewFrame").src = previewUrl;
      statusEl.textContent = "";
    } catch (err) {
      statusEl.textContent = err.message || "Preview failed";
    }
  }, 300);
}

export function openPdfExportDialog(workspace) {
  if (!overlayEl) overlayEl = document.getElementById("pdfDialogOverlay");
  if (!built) {
    buildDialog(overlayEl);
    built = true;
  }

  applyOptionsToForm(overlayEl, DEFAULT_PDF_OPTIONS);

  const close = () => {
    overlayEl.style.display = "none";
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    overlayEl.querySelector("#pdfPreviewFrame").src = "about:blank";
  };

  // Re-wired on every open (rather than addEventListener) so repeated opens
  // never stack duplicate handlers on this one cached dialog instance.
  overlayEl.querySelector("#pdfDialogClose").onclick = close;
  overlayEl.querySelector("#pdfDialogCancel").onclick = close;
  overlayEl.onclick = (e) => {
    if (e.target === overlayEl) close();
  };

  overlayEl.querySelector("#pdfAccentSwatches").onclick = (e) => {
    const sw = e.target.closest(".pdf-accent-swatch");
    if (!sw) return;
    overlayEl.querySelectorAll(".pdf-accent-swatch").forEach((s) => s.classList.remove("active"));
    sw.classList.add("active");
    overlayEl.querySelector("#pdfAccentCustom").value = sw.dataset.color;
    overlayEl.querySelector("#pdfAccentHex").value = sw.dataset.color;
    regeneratePreview(overlayEl, workspace);
  };

  // Free accent color selection — deselects the preset swatches so
  // readOptions() falls back to this input's value.
  overlayEl.querySelector("#pdfAccentCustom").oninput = () => {
    overlayEl.querySelectorAll(".pdf-accent-swatch").forEach((s) => s.classList.remove("active"));
    overlayEl.querySelector("#pdfAccentHex").value = overlayEl.querySelector("#pdfAccentCustom").value;
    regeneratePreview(overlayEl, workspace);
  };

  // Hex text entry, mirroring the same pattern as the main toolbar's color field.
  overlayEl.querySelector("#pdfAccentHex").oninput = () => {
    const v = overlayEl.querySelector("#pdfAccentHex").value.trim();
    const hex = v.startsWith("#") ? v : `#${v}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      overlayEl.querySelectorAll(".pdf-accent-swatch").forEach((s) => s.classList.remove("active"));
      overlayEl.querySelector("#pdfAccentCustom").value = hex;
      regeneratePreview(overlayEl, workspace);
    }
  };
  overlayEl.querySelector("#pdfAccentHex").onblur = () => {
    overlayEl.querySelector("#pdfAccentHex").value = overlayEl.querySelector("#pdfAccentCustom").value;
  };

  ["pdfPageSize", "pdfOrientation", "pdfMargin", "pdfPageFit", "pdfCoverTitle", "pdfIncludeThumbnail"].forEach((id) => {
    overlayEl.querySelector(`#${id}`).oninput = () => regeneratePreview(overlayEl, workspace);
  });

  overlayEl.querySelector("#pdfIncludeCover").onchange = (e) => {
    overlayEl.querySelector("#pdfCoverFields").style.display = e.target.checked ? "flex" : "none";
    regeneratePreview(overlayEl, workspace);
  };

  overlayEl.querySelector("#pdfDialogExport").onclick = () => {
    try {
      const opts = readOptions(overlayEl);
      exportWorkspaceToPdf(workspace, opts);
      close();
    } catch (err) {
      overlayEl.querySelector("#pdfPreviewStatus").textContent = err.message || "Export failed";
    }
  };

  overlayEl.style.display = "flex";
  regeneratePreview(overlayEl, workspace);
}
