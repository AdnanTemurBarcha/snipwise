"use strict";

let pendingCapture = null;

// ─── Badge progress — shows on the extension icon, zero page-DOM involvement ──
function badge(text, color = "#7c3aed") {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
function badgeClear() {
  chrome.action.setBadgeText({ text: "" });
}

// ─── Full-page capture ────────────────────────────────────────────────────────
async function captureFullPage(mode, title, url, tabId) {
  badge("...");

  const [dimResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollWidth:      document.documentElement.scrollWidth,
      scrollHeight:     document.documentElement.scrollHeight,
      viewportWidth:    window.innerWidth,
      viewportHeight:   window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      originalScrollX:  window.scrollX,
      originalScrollY:  window.scrollY,
    }),
  });

  const d = dimResult.result;
  const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio } = d;
  const capW   = viewportWidth  * devicePixelRatio;
  const capH   = viewportHeight * devicePixelRatio;
  const totalW = scrollWidth    * devicePixelRatio;
  const totalH = scrollHeight   * devicePixelRatio;

  // Single viewport — no stitching needed
  if (scrollHeight <= viewportHeight + 5) {
    await new Promise(r => setTimeout(r, 300));
    const dataUrl = await new Promise(resolve =>
      chrome.tabs.captureVisibleTab(null, { format: "png" }, resolve)
    );
    if (!dataUrl) { badge("ERR", "#dc2626"); setTimeout(badgeClear, 3000); return; }
    badge("✓", "#16a34a");
    setTimeout(badgeClear, 2000);
    storePending(dataUrl, mode, title, url);
    return;
  }

  const rows = Math.ceil(scrollHeight / viewportHeight);
  const captures = [];

  for (let i = 0; i < rows; i++) {
    const scrollY = Math.min(i * viewportHeight, scrollHeight - viewportHeight);
    const pct     = Math.round(((i + 1) / rows) * 100);

    badge(`${pct}%`);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y) => window.scrollTo(0, y),
      args: [scrollY],
    });

    await new Promise(r => setTimeout(r, 600));

    const dataUrl = await new Promise(resolve =>
      chrome.tabs.captureVisibleTab(null, { format: "png" }, resolve)
    );
    if (!dataUrl) continue;

    captures.push({
      dataUrl,
      scrollY: scrollY * devicePixelRatio,
      isLast:  i === rows - 1,
    });
  }

  // Restore scroll
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (x, y) => window.scrollTo(x, y),
    args: [d.originalScrollX, d.originalScrollY],
  });

  if (captures.length === 0) {
    badge("ERR", "#dc2626");
    setTimeout(badgeClear, 3000);
    return;
  }

  const [stitchResult] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (captures, totalW, totalH, capW, capH) => {
      return new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width  = totalW;
        canvas.height = totalH;
        const ctx = canvas.getContext("2d");
        let loaded = 0;
        captures.forEach((cap) => {
          const img = new Image();
          img.onload = () => {
            if (cap.isLast) {
              const srcY = capH - (totalH - cap.scrollY);
              if (srcY > 0) {
                ctx.drawImage(img, 0, srcY, capW, capH - srcY,
                                   0, cap.scrollY + srcY, capW, capH - srcY);
              } else {
                ctx.drawImage(img, 0, cap.scrollY);
              }
            } else {
              ctx.drawImage(img, 0, cap.scrollY);
            }
            loaded++;
            if (loaded === captures.length) resolve(canvas.toDataURL("image/png"));
          };
          img.onerror = () => { loaded++; if (loaded === captures.length) resolve(null); };
          img.src = cap.dataUrl;
        });
      });
    },
    args: [captures, totalW, totalH, capW, capH],
  });

  const dataUrl = stitchResult?.result;
  if (dataUrl) {
    badge("✓", "#16a34a");
    setTimeout(badgeClear, 2000);
    storePending(dataUrl, mode, title, url);
  } else {
    badge("ERR", "#dc2626");
    setTimeout(badgeClear, 3000);
  }
}

function storePending(dataUrl, mode, title, url) {
  pendingCapture = {
    dataUrl,
    title: title || "Capture",
    url:   url   || "",
    mode:  mode  || "screenshot",
    ts: Date.now(),
  };
  chrome.tabs.create({
    url: chrome.runtime.getURL(mode === "pdf" ? "pdf.html" : "editor.html"),
  });
}

// ─── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === "captureTab") {
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(null, { format: "png", quality: 100 }, (dataUrl) => {
        const err = chrome.runtime.lastError;
        if (err) console.warn("Snipwise captureVisibleTab:", err.message);
        sendResponse(dataUrl || null);
      });
    }, 200);
    return true;
  }

  if (msg.action === "getCaptureData") {
    sendResponse(pendingCapture);
    pendingCapture = null;
    return;
  }

  if (msg.action === "captureVisible") {
    setTimeout(() => {
      chrome.tabs.captureVisibleTab(null, { format: "png", quality: 100 }, (dataUrl) => {
        if (!dataUrl || chrome.runtime.lastError) return;
        storePending(dataUrl, msg.mode || "screenshot", msg.title, msg.url);
      });
    }, 300);
    return true;
  }

  if (msg.action === "capturePage") {
    captureFullPage(msg.mode, msg.title, msg.url, msg.tabId).catch(console.error);
    return true;
  }

  if (msg.action === "captureReady") {
    storePending(msg.dataUrl, msg.mode || "screenshot", msg.title, msg.url);
  }
});
