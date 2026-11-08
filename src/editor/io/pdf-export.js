"use strict";

// Ported from the original pdf.js (cover page, header/footer, A4 geometry,
// JPEG compression, per-tall-image slicing) — same jsPDF APIs, restructured
// to loop over workspace pages instead of slicing one stitched screenshot,
// and parameterized (page size/orientation/margin/cover) instead of fixed
// module constants so the settings dialog can drive it.
import { flatten } from "../render/compositor.js";

const PAGE_SIZES = {
  a4: [210, 297],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
};
const JPEG_QUALITY = 0.82;
const MM_PER_PX = 0.2646;

export const DEFAULT_PDF_OPTIONS = {
  pageSize: "a4",
  orientation: "portrait",
  marginMm: 12,
  includeCover: true,
  coverTitle: "Snipwise Export",
  coverAccent: "#7c3aed",
  includeThumbnail: true,
  // "fit": scale each workspace page to fit entirely within one PDF page
  // (contain, centered) — the sane default now that pages are general
  // compositions, not necessarily tall scrolling captures.
  // "split": legacy behavior — fill the full page width and slice the
  // height across as many PDF pages as needed, for genuinely tall pages
  // (e.g. a full-page website capture) where shrinking to fit would make
  // it illegible.
  pageFit: "fit",
};

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [124, 58, 237];
}

function computeGeometry(options) {
  const base = PAGE_SIZES[options.pageSize] || PAGE_SIZES.a4;
  const landscape = options.orientation === "landscape";
  const PAGE_W = landscape ? base[1] : base[0];
  const PAGE_H = landscape ? base[0] : base[1];
  const MARGIN = options.marginMm ?? 12;
  const HEADER_H = 8;
  const FOOTER_H = 8;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const CONTENT_TOP = MARGIN + HEADER_H + 2;
  const CONTENT_BOTTOM = PAGE_H - MARGIN - FOOTER_H - 2;
  const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;
  return { PAGE_W, PAGE_H, MARGIN, HEADER_H, FOOTER_H, CONTENT_W, CONTENT_TOP, CONTENT_BOTTOM, CONTENT_H, landscape };
}

function blankCanvas(sceneData) {
  const c = document.createElement("canvas");
  c.width = sceneData.width;
  c.height = sceneData.height;
  return c;
}

function flattenPage(page) {
  return flatten(page.sceneData, page.annotationSnapshot || blankCanvas(page.sceneData));
}

function drawHeader(doc, g, pageName) {
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text(truncate(pageName, 80), g.MARGIN, g.MARGIN + 4);
  doc.text("Snipwise", g.PAGE_W - g.MARGIN, g.MARGIN + 4, { align: "right" });
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(g.MARGIN, g.MARGIN + g.HEADER_H, g.PAGE_W - g.MARGIN, g.MARGIN + g.HEADER_H);
}

function drawFooter(doc, g, pageNum, totalPages, ts) {
  const y = g.PAGE_H - g.MARGIN - 2;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.2);
  doc.line(g.MARGIN, y - 4, g.PAGE_W - g.MARGIN, y - 4);
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text(fmtDate(ts), g.MARGIN, y);
  doc.text(`${pageNum} / ${totalPages}`, g.PAGE_W - g.MARGIN, y, { align: "right" });
}

function drawCover(doc, g, opts) {
  const { pageCount, ts, title, accentRgb, thumbDataUrl, thumbMmW, thumbMmH, showThumbnail } = opts;

  doc.setFillColor(...accentRgb);
  doc.rect(0, 0, g.PAGE_W, 52, "F");

  doc.setFontSize(24);
  doc.setTextColor(255, 255, 255);
  doc.text(title || "Snipwise Export", g.MARGIN, 30);

  doc.setFontSize(10);
  doc.setTextColor(230, 230, 255);
  doc.text(`${pageCount} page${pageCount > 1 ? "s" : ""} combined`, g.MARGIN, 40);

  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("Generated: " + fmtDate(ts), g.MARGIN, 64);

  if (showThumbnail && thumbDataUrl) {
    const thumbTop = 76;
    const availH = g.PAGE_H - thumbTop - g.MARGIN;
    const availW = g.CONTENT_W;
    const scale = Math.min(availW / thumbMmW, availH / thumbMmH, 1);
    const drawW = thumbMmW * scale;
    const drawH = thumbMmH * scale;
    const drawX = g.MARGIN + (availW - drawW) / 2;

    doc.setFillColor(240, 240, 240);
    doc.roundedRect(drawX - 2, thumbTop - 2, drawW + 4, drawH + 4, 2, 2, "F");
    doc.addImage(thumbDataUrl, "JPEG", drawX, thumbTop, drawW, drawH);
  }
}

// Returns [{ imgMmW, imgMmH, slices, pxPerSlice, offsetX, offsetY }] — one
// entry per exportable page. offsetX/offsetY position the image within the
// page's content box (used by "fit" mode to center it; always 0 for "split").
function computeLayout(pages, g, pageFit) {
  return pages.map((page) => {
    const pxW = page.sceneData.width;
    const pxH = page.sceneData.height;
    const widthScale = g.CONTENT_W / (pxW * MM_PER_PX);

    if (pageFit === "split") {
      const imgMmW = g.CONTENT_W;
      const imgMmH = pxH * MM_PER_PX * widthScale;
      const slices = Math.max(1, Math.ceil(imgMmH / g.CONTENT_H));
      const pxPerSlice = g.CONTENT_H / (imgMmH / pxH);
      return { imgMmW, imgMmH, slices, pxPerSlice, offsetX: 0, offsetY: 0 };
    }

    // "fit": contain within one page, centered, never sliced.
    const heightScale = g.CONTENT_H / (pxH * MM_PER_PX);
    const scale = Math.min(widthScale, heightScale);
    const imgMmW = pxW * MM_PER_PX * scale;
    const imgMmH = pxH * MM_PER_PX * scale;
    return {
      imgMmW,
      imgMmH,
      slices: 1,
      pxPerSlice: pxH,
      offsetX: (g.CONTENT_W - imgMmW) / 2,
      offsetY: (g.CONTENT_H - imgMmH) / 2,
    };
  });
}

// Builds the jsPDF document in memory (no save/download) so callers can read
// doc.output("blob") for a live preview, or doc.save() to actually download.
export function buildPdfDocument(workspace, options = {}) {
  const opts = { ...DEFAULT_PDF_OPTIONS, ...options };
  const pages = workspace.pages.filter((p) => p.sceneData.width > 0 && p.sceneData.height > 0);
  if (pages.length === 0) {
    throw new Error("Nothing to export yet — add at least one image first.");
  }

  const g = computeGeometry(opts);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({
    orientation: g.landscape ? "landscape" : "portrait",
    unit: "mm",
    format: [g.PAGE_W, g.PAGE_H],
    compress: true,
  });
  const ts = Date.now();
  const layout = computeLayout(pages, g, opts.pageFit);
  const totalPages = (opts.includeCover ? 1 : 0) + layout.reduce((sum, l) => sum + l.slices, 0);

  const firstCanvas = flattenPage(pages[0]);

  if (opts.includeCover) {
    let thumbDataUrl = null;
    let thumbMmW = 0;
    let thumbMmH = 0;
    if (opts.includeThumbnail) {
      const thumbScale = Math.min(400 / firstCanvas.width, 1);
      const thumbW = Math.round(firstCanvas.width * thumbScale);
      const thumbH = Math.round(firstCanvas.height * thumbScale);
      const thumbCanvas = document.createElement("canvas");
      thumbCanvas.width = thumbW;
      thumbCanvas.height = thumbH;
      const thumbCtx = thumbCanvas.getContext("2d");
      thumbCtx.fillStyle = "#ffffff";
      thumbCtx.fillRect(0, 0, thumbW, thumbH);
      thumbCtx.drawImage(firstCanvas, 0, 0, thumbW, thumbH);
      thumbDataUrl = thumbCanvas.toDataURL("image/jpeg", 0.7);
      thumbMmW = thumbW * MM_PER_PX;
      thumbMmH = thumbH * MM_PER_PX;
    }
    drawCover(doc, g, {
      pageCount: pages.length,
      ts,
      title: truncate(opts.coverTitle, 60),
      accentRgb: hexToRgb(opts.coverAccent),
      thumbDataUrl,
      thumbMmW,
      thumbMmH,
      showThumbnail: opts.includeThumbnail,
    });
  }

  let pageNum = opts.includeCover ? 1 : 0;
  // Without a cover, jsPDF's auto-created first page is free — the first
  // content slice reuses it instead of calling addPage().
  let usedInitialPage = !opts.includeCover;
  const sliceCanvas = document.createElement("canvas");
  const sliceCtx = sliceCanvas.getContext("2d");

  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const canvas = p === 0 ? firstCanvas : flattenPage(page);
    const { imgMmW, imgMmH, slices, pxPerSlice, offsetX, offsetY } = layout[p];
    const pxW = canvas.width;
    const pxH = canvas.height;

    for (let i = 0; i < slices; i++) {
      pageNum++;
      if (usedInitialPage) {
        usedInitialPage = false;
      } else {
        doc.addPage([g.PAGE_W, g.PAGE_H], g.landscape ? "landscape" : "portrait");
      }
      drawHeader(doc, g, page.name);
      drawFooter(doc, g, pageNum, totalPages, ts);

      const srcY = Math.round(i * pxPerSlice);
      const srcH = Math.min(Math.round(pxPerSlice), pxH - srcY);
      if (srcH <= 0) continue;

      sliceCanvas.width = pxW;
      sliceCanvas.height = srcH;
      sliceCtx.fillStyle = "#ffffff";
      sliceCtx.fillRect(0, 0, pxW, srcH);
      sliceCtx.drawImage(canvas, 0, srcY, pxW, srcH, 0, 0, pxW, srcH);

      const sliceDataUrl = sliceCanvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const sliceMmH = Math.min(g.CONTENT_H, imgMmH - i * g.CONTENT_H);
      doc.addImage(
        sliceDataUrl,
        "JPEG",
        g.MARGIN + offsetX,
        g.CONTENT_TOP + offsetY,
        imgMmW,
        sliceMmH,
      );
    }
  }

  return { doc, pageCount: pages.length };
}

export function exportWorkspaceToPdf(workspace, options = {}) {
  const { doc, pageCount } = buildPdfDocument(workspace, options);
  const filename = `snipwise-${pageCount}pages-${Date.now()}.pdf`;
  doc.save(filename);
  return { pageCount, filename };
}
