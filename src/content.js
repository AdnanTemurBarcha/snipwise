"use strict";

// Crop-region capture. Injected on demand by the popup.
// Wrapped in a function so repeated injections replace the previous copy instead of stacking listeners.
(() => {
  try {
    window.__snipwiseCleanup?.();
  } catch (_) {
    /* the previous copy belonged to a reloaded extension */
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  let activeTeardown = null;
  const cancelActive = () => {
    if (activeTeardown) activeTeardown();
  };

  function onMessage(msg, _sender, sendResponse) {
    if (msg && msg.action === "ping") {
      sendResponse({ ok: true });
    } else if (msg && msg.action === "crop") {
      startCrop();
      sendResponse({ ok: true });
    }
  }
  chrome.runtime.onMessage.addListener(onMessage);

  window.__snipwiseCleanup = () => {
    cancelActive();
    try {
      chrome.runtime.onMessage.removeListener(onMessage);
    } catch (_) {
      /* extension context gone */
    }
  };

  function send(dataUrl) {
    chrome.runtime.sendMessage({ action: "captureReady", dataUrl, title: document.title, mode: "screenshot" });
  }

  // The background answers with a data URL, or null when Chrome refused (it rate-limits
  // captureVisibleTab to about two calls a second), so retry a few times before giving up.
  async function captureTab() {
    for (let attempt = 0; attempt < 4; attempt++) {
      const shot = await new Promise((res) =>
        chrome.runtime.sendMessage({ action: "captureTab" }, (v) => {
          void chrome.runtime.lastError;
          res(v);
        }),
      );
      if (typeof shot === "string" && shot.startsWith("data:")) return shot;
      await sleep(350 * (attempt + 1));
    }
    throw new Error("captureVisibleTab failed");
  }

  function loadImg(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image failed to load"));
      i.src = src;
    });
  }

  function toast(text, isError) {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed", top: "14px", left: "50%", transform: "translateX(-50%)",
      background: isError ? "#3b1219" : "#1e1829", color: isError ? "#fecaca" : "#c4b5fd",
      padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontFamily: "Inter,system-ui,sans-serif",
      border: `1px solid ${isError ? "#7f1d1d" : "#4c3d6e"}`, zIndex: "2147483647", pointerEvents: "none",
    });
    el.textContent = text;
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  async function finishCrop(x, y, w, h) {
    try {
      await nextPaint(); // make sure the dimming overlay is really gone from the screenshot
      await sleep(40);
      const shot = await captureTab();
      const img = await loadImg(shot);
      const kx = img.width / window.innerWidth;
      const ky = img.height / window.innerHeight;
      const sx = Math.round(x * kx), sy = Math.round(y * ky);
      const sw = Math.max(1, Math.round(w * kx)), sh = Math.max(1, Math.round(h * ky));
      const c = document.createElement("canvas");
      c.width = sw;
      c.height = sh;
      c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      send(c.toDataURL("image/png"));
    } catch (err) {
      console.warn("Snipwise crop failed:", err);
      toast("Snipwise couldn't capture that area — please try again.", true);
    }
  }

  function startCrop() {
    cancelActive();
    document.getElementById("__snipwise_overlay")?.remove();

    const W = window.innerWidth, H = window.innerHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "__snipwise_overlay";
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    Object.assign(svg.style, {
      position: "fixed", inset: "0", zIndex: "2147483647", cursor: "crosshair", pointerEvents: "all", touchAction: "none",
    });
    svg.innerHTML = `
      <defs>
        <mask id="snip_mask">
          <rect width="${W}" height="${H}" fill="white"/>
          <rect id="snip_hole" x="0" y="0" width="0" height="0" fill="black"/>
        </mask>
      </defs>
      <rect width="${W}" height="${H}" fill="rgba(0,0,0,0.48)" mask="url(#snip_mask)"/>
      <rect id="snip_border" x="0" y="0" width="0" height="0" fill="none" stroke="#a78bfa" stroke-width="2" stroke-dasharray="6 3"/>
      <rect id="snip_handles_tl" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
      <rect id="snip_handles_tr" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
      <rect id="snip_handles_bl" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
      <rect id="snip_handles_br" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
    `;
    const root = document.body || document.documentElement;
    root.appendChild(svg);

    const hole = svg.getElementById("snip_hole");
    const border = svg.getElementById("snip_border");
    const htl = svg.getElementById("snip_handles_tl");
    const htr = svg.getElementById("snip_handles_tr");
    const hbl = svg.getElementById("snip_handles_bl");
    const hbr = svg.getElementById("snip_handles_br");

    const tip = document.createElement("div");
    Object.assign(tip.style, {
      position: "fixed", top: "14px", left: "50%", transform: "translateX(-50%)",
      background: "#1e1829", color: "#c4b5fd", padding: "7px 14px", borderRadius: "6px", fontSize: "12px",
      fontFamily: "Inter,sans-serif", border: "1px solid #4c3d6e", pointerEvents: "none", zIndex: "2147483647", whiteSpace: "nowrap",
    });
    tip.textContent = "Drag to select area · Esc to cancel";
    root.appendChild(tip);

    let sx = 0, sy = 0, dragging = false;

    function updateRect(x, y, w, h) {
      [hole, border].forEach((el) => {
        el.setAttribute("x", x); el.setAttribute("y", y);
        el.setAttribute("width", w); el.setAttribute("height", h);
      });
      htl.setAttribute("x", x - 4); htl.setAttribute("y", y - 4);
      htr.setAttribute("x", x + w - 4); htr.setAttribute("y", y - 4);
      hbl.setAttribute("x", x - 4); hbl.setAttribute("y", y + h - 4);
      hbr.setAttribute("x", x + w - 4); hbr.setAttribute("y", y + h - 4);
    }

    // Always remove every listener we added, whatever ends the crop.
    function teardown() {
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", teardown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", teardown);
      svg.remove();
      tip.remove();
      if (activeTeardown === teardown) activeTeardown = null;
    }
    activeTeardown = teardown;

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        teardown();
      }
    }

    function clampRect(ax, ay, bx, by) {
      const x0 = Math.max(0, Math.min(ax, bx)), y0 = Math.max(0, Math.min(ay, by));
      const x1 = Math.min(window.innerWidth, Math.max(ax, bx)), y1 = Math.min(window.innerHeight, Math.max(ay, by));
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }

    svg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      sx = e.clientX;
      sy = e.clientY;
      dragging = true;
      try { svg.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
      updateRect(sx, sy, 0, 0);
    });

    svg.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const r = clampRect(sx, sy, e.clientX, e.clientY);
      updateRect(r.x, r.y, r.w, r.h);
      tip.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}px · Release to capture`;
    });

    // Listening on the window (with pointer capture) means releasing the button
    // outside the page still ends the drag instead of leaving the overlay stuck.
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      const r = clampRect(sx, sy, e.clientX, e.clientY);
      teardown();
      if (r.w < 8 || r.h < 8) return;
      void finishCrop(r.x, r.y, r.w, r.h);
    }

    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", teardown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", teardown);
  }
})();
