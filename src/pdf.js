"use strict";

function show(id) {
  document.getElementById(id).style.display = "block";
}
function hide(id) {
  document.getElementById(id).style.display = "none";
}
function msg(text) {
  document.getElementById("msg").textContent = text;
}

// ── Constants ────────────────────────────────────────────────────────────────
const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 12;
const HEADER_H = 8;
const FOOTER_H = 8;
const CONTENT_W = PAGE_W - MARGIN * 2;
const CONTENT_TOP = MARGIN + HEADER_H + 2;
const CONTENT_BOTTOM = PAGE_H - MARGIN - FOOTER_H - 2;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;
const JPEG_QUALITY = 0.82;

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Image failed to load"));
    img.src = src;
  });
}

function toJpegDataUrl(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL("image/jpeg", JPEG_QUALITY);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

// ── Header / Footer ─────────────────────────────────────────────────────────
function drawHeader(doc, title) {
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text(truncate(title, 80), MARGIN, MARGIN + 4);
  doc.text("Snipwise", PAGE_W - MARGIN, MARGIN + 4, { align: "right" });
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, MARGIN + HEADER_H, PAGE_W - MARGIN, MARGIN + HEADER_H);
}

function drawFooter(doc, pageNum, totalPages, url, ts) {
  const y = PAGE_H - MARGIN - 2;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y - 4, PAGE_W - MARGIN, y - 4);

  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text(truncate(url, 70), MARGIN, y);
  doc.text(fmtDate(ts), PAGE_W / 2, y, { align: "center" });
  doc.text(`${pageNum} / ${totalPages}`, PAGE_W - MARGIN, y, {
    align: "right",
  });
}

// ── Cover page ──────────────────────────────────────────────────────────────
function drawCover(doc, title, url, ts, thumbDataUrl, thumbW, thumbH) {
  // Accent bar
  doc.setFillColor(103, 58, 237);
  doc.rect(0, 0, PAGE_W, 52, "F");

  // Brand
  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.text("Snipwise", MARGIN, 30);

  doc.setFontSize(10);
  doc.setTextColor(220, 210, 255);
  doc.text("Screenshot & PDF", MARGIN, 40);

  // Title
  doc.setFontSize(18);
  doc.setTextColor(30, 30, 30);
  const titleLines = doc.splitTextToSize(title || "Untitled Page", CONTENT_W);
  doc.text(titleLines, MARGIN, 72);

  // URL + date
  const titleBlockH = titleLines.length * 8;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(truncate(url, 100), MARGIN, 72 + titleBlockH + 6);
  doc.text("Captured: " + fmtDate(ts), MARGIN, 72 + titleBlockH + 14);

  // Thumbnail
  const thumbTop = 72 + titleBlockH + 26;
  const availH = PAGE_H - thumbTop - MARGIN;
  const availW = CONTENT_W;

  const scale = Math.min(availW / thumbW, availH / thumbH, 1);
  const drawW = thumbW * scale;
  const drawH = thumbH * scale;
  const drawX = MARGIN + (availW - drawW) / 2;

  // Shadow
  doc.setFillColor(240, 240, 240);
  doc.roundedRect(drawX - 2, thumbTop - 2, drawW + 4, drawH + 4, 2, 2, "F");

  doc.addImage(thumbDataUrl, "JPEG", drawX, thumbTop, drawW, drawH);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function generatePdf() {
  const capture = await new Promise((res) =>
    chrome.runtime.sendMessage({ action: "getCaptureData" }, res),
  );

  if (!capture || !capture.dataUrl) {
    hide("spinner");
    show("err");
    document.getElementById("err").textContent =
      "No capture found. Please try again.";
    return;
  }

  const { title, url, ts } = capture;

  msg("Processing image\u2026");

  try {
    const img = await loadImage(capture.dataUrl);
    const pxW = img.naturalWidth;
    const pxH = img.naturalHeight;

    msg("Compressing\u2026");
    const jpegUrl = toJpegDataUrl(img);

    // Scale image to fit A4 content width
    const scale = CONTENT_W / (pxW * 0.2646);
    const imgMmW = CONTENT_W;
    const imgMmH = pxH * 0.2646 * scale;

    const totalContentPages = Math.ceil(imgMmH / CONTENT_H);
    const totalPages = 1 + totalContentPages;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    // ── Cover ────────────────────────────────────────────────────────────
    msg("Creating cover page\u2026");

    const thumbScale = Math.min(400 / pxW, 1);
    const thumbC = document.createElement("canvas");
    thumbC.width = Math.round(pxW * thumbScale);
    thumbC.height = Math.round(pxH * thumbScale);
    const thumbCtx = thumbC.getContext("2d");
    thumbCtx.fillStyle = "#ffffff";
    thumbCtx.fillRect(0, 0, thumbC.width, thumbC.height);
    thumbCtx.drawImage(img, 0, 0, thumbC.width, thumbC.height);
    const thumbDataUrl = thumbC.toDataURL("image/jpeg", 0.7);
    const thumbMmW = thumbC.width * 0.2646;
    const thumbMmH = thumbC.height * 0.2646;

    drawCover(doc, title, url, ts, thumbDataUrl, thumbMmW, thumbMmH);

    // ── Content pages ────────────────────────────────────────────────────
    const sliceCanvas = document.createElement("canvas");
    const sliceCtx = sliceCanvas.getContext("2d");
    const pxPerPage = CONTENT_H / (imgMmH / pxH);

    for (let i = 0; i < totalContentPages; i++) {
      msg("Rendering page " + (i + 2) + " of " + totalPages + "\u2026");
      doc.addPage("a4", "portrait");

      drawHeader(doc, title);
      drawFooter(doc, i + 2, totalPages, url, ts);

      const srcY = Math.round(i * pxPerPage);
      const srcH = Math.min(Math.round(pxPerPage), pxH - srcY);
      if (srcH <= 0) continue;

      sliceCanvas.width = pxW;
      sliceCanvas.height = srcH;
      sliceCtx.fillStyle = "#ffffff";
      sliceCtx.fillRect(0, 0, pxW, srcH);
      sliceCtx.drawImage(img, 0, srcY, pxW, srcH, 0, 0, pxW, srcH);

      const sliceDataUrl = sliceCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const sliceMmH = Math.min(CONTENT_H, imgMmH - i * CONTENT_H);

      doc.addImage(sliceDataUrl, "JPEG", MARGIN, CONTENT_TOP, imgMmW, sliceMmH);
    }

    // ── Save ─────────────────────────────────────────────────────────────
    const safeName = (title || "capture")
      .replace(/[^a-zA-Z0-9_\- ]/g, "")
      .trim()
      .slice(0, 50);
    const filename = "snipwise-" + safeName + "-" + Date.now() + ".pdf";
    msg("Saving\u2026");
    doc.save(filename);

    hide("spinner");
    hide("msg");
    show("done");
    setTimeout(function () {
      window.close();
    }, 2000);
  } catch (e) {
    hide("spinner");
    show("err");
    document.getElementById("err").textContent = "PDF failed: " + e.message;
    console.error(e);
  }
}

generatePdf();
