"use strict";

if (window.__snipwiseLoaded) {
  // Already injected
} else {
  window.__snipwiseLoaded = true;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "crop") startCrop();
  });
}

function send(dataUrl, mode = "screenshot") {
  chrome.runtime.sendMessage({
    action: "captureReady",
    dataUrl,
    title: document.title,
    mode,
  });
}

function captureTab() {
  return new Promise((res) =>
    chrome.runtime.sendMessage({ action: "captureTab" }, res)
  );
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function startCrop() {
  document.getElementById("__snipwise_overlay")?.remove();

  const W = window.innerWidth, H = window.innerHeight;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "__snipwise_overlay";
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  Object.assign(svg.style, {
    position: "fixed", inset: "0",
    zIndex: "2147483647", cursor: "crosshair", pointerEvents: "all",
  });
  svg.innerHTML = `
    <defs>
      <mask id="snip_mask">
        <rect width="${W}" height="${H}" fill="white"/>
        <rect id="snip_hole" x="0" y="0" width="0" height="0" fill="black"/>
      </mask>
    </defs>
    <rect width="${W}" height="${H}" fill="rgba(0,0,0,0.48)" mask="url(#snip_mask)"/>
    <rect id="snip_border" x="0" y="0" width="0" height="0"
          fill="none" stroke="#a78bfa" stroke-width="2" stroke-dasharray="6 3"/>
    <rect id="snip_handles_tl" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
    <rect id="snip_handles_tr" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
    <rect id="snip_handles_bl" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
    <rect id="snip_handles_br" x="0" y="0" width="8" height="8" fill="#a78bfa" rx="1"/>
  `;
  document.body.appendChild(svg);

  const hole   = svg.getElementById("snip_hole");
  const border = svg.getElementById("snip_border");
  const htl = svg.getElementById("snip_handles_tl");
  const htr = svg.getElementById("snip_handles_tr");
  const hbl = svg.getElementById("snip_handles_bl");
  const hbr = svg.getElementById("snip_handles_br");

  const tip = document.createElement("div");
  Object.assign(tip.style, {
    position: "fixed", top: "14px", left: "50%",
    transform: "translateX(-50%)",
    background: "#1e1829", color: "#c4b5fd",
    padding: "7px 14px", borderRadius: "6px", fontSize: "12px",
    fontFamily: "Inter,sans-serif", border: "1px solid #4c3d6e",
    pointerEvents: "none", zIndex: "2147483648", whiteSpace: "nowrap",
  });
  tip.textContent = "Drag to select area · Esc to cancel";
  document.body.appendChild(tip);

  let sx, sy, dragging = false;

  function updateRect(x, y, w, h) {
    [hole, border].forEach((el) => {
      el.setAttribute("x", x); el.setAttribute("y", y);
      el.setAttribute("width", w); el.setAttribute("height", h);
    });
    htl.setAttribute("x", x - 4);     htl.setAttribute("y", y - 4);
    htr.setAttribute("x", x + w - 4); htr.setAttribute("y", y - 4);
    hbl.setAttribute("x", x - 4);     hbl.setAttribute("y", y + h - 4);
    hbr.setAttribute("x", x + w - 4); hbr.setAttribute("y", y + h - 4);
  }

  svg.addEventListener("mousedown", (e) => {
    e.preventDefault();
    sx = e.clientX; sy = e.clientY;
    dragging = true;
    updateRect(sx, sy, 0, 0);
  });

  svg.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, sx), y = Math.min(e.clientY, sy);
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    updateRect(x, y, w, h);
    tip.textContent = `${Math.round(w)} × ${Math.round(h)}px · Release to capture`;
  });

  svg.addEventListener("mouseup", async (e) => {
    if (!dragging) return;
    dragging = false;
    const x = Math.min(e.clientX, sx), y = Math.min(e.clientY, sy);
    const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
    svg.remove(); tip.remove();
    if (w < 8 || h < 8) return;
    await new Promise(r => setTimeout(r, 60));
    const shot = await captureTab();
    const img  = await loadImg(shot);
    const sx2 = Math.round(x * (img.width  / window.innerWidth));
    const sy2 = Math.round(y * (img.height / window.innerHeight));
    const sw  = Math.round(w * (img.width  / window.innerWidth));
    const sh  = Math.round(h * (img.height / window.innerHeight));
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    c.getContext("2d").drawImage(img, sx2, sy2, sw, sh, 0, 0, sw, sh);
    send(c.toDataURL("image/png"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { svg.remove(); tip.remove(); }
  }, { once: true });
}
