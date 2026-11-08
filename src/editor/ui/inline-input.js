"use strict";

// The few DOM-heavy interactive UI pieces the annotation tools need (an
// inline text field, the emoji picker panel, the crop-selection overlay).
// Tools never build these themselves — they call these Promise-based
// functions through the injected tool ctx, keeping tools/* free of `document`.

function clientScale(canvas) {
  const rect = canvas.getBoundingClientRect();
  return { sX: rect.width / canvas.width, sY: rect.height / canvas.height };
}

export function promptText(container, canvas, canvasX, canvasY, clientX, clientY, opts = {}) {
  return new Promise((resolve) => {
    const { sX, sY } = clientScale(canvas);
    const fontSize = opts.fontSize || 16;

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
      position: "absolute",
      left: canvasX * sX + "px",
      top: canvasY * sY - 4 + "px",
      zIndex: "200",
      minWidth: opts.variant === "callout" ? "100px" : "120px",
    });

    const input = document.createElement("input");
    if (opts.variant === "callout") {
      Object.assign(input.style, {
        background: opts.color,
        color: "#fff",
        border: "none",
        borderRadius: "6px",
        fontSize: `${fontSize * Math.min(sX, sY)}px`,
        fontFamily: "Inter,sans-serif",
        fontWeight: "600",
        outline: "none",
        padding: "4px 10px",
        width: "160px",
      });
    } else {
      Object.assign(input.style, {
        background: "rgba(0,0,0,0.6)",
        border: "none",
        borderBottom: `2px solid ${opts.color}`,
        color: opts.color,
        fontSize: `${fontSize * Math.min(sX, sY)}px`,
        fontFamily: "Inter,sans-serif",
        fontWeight: "600",
        outline: "none",
        padding: "2px 6px",
        width: "200px",
        borderRadius: "2px",
      });
    }

    if (opts.initialValue) input.value = opts.initialValue;

    wrap.appendChild(input);
    container.appendChild(wrap);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    let settled = false;
    function commit() {
      if (settled) return;
      settled = true;
      const text = input.value.trim();
      wrap.remove();
      resolve(text || null);
    }
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") commit();
      if (e.key === "Escape") {
        settled = true;
        wrap.remove();
        resolve(null);
      }
    });
    input.addEventListener("blur", () => setTimeout(commit, 150));
  });
}

const EMOJIS = [
  "😀", "😂", "❤️", "👍", "👎", "🔥", "⭐", "✅", "❌", "⚠️",
  "💡", "📌", "🎯", "🚀", "💬", "🔍", "📷", "🖊️", "✂️", "📋",
  "👀", "💥", "🎉", "🤔", "😱", "👉", "☝️", "🙌", "💪", "🛑",
];

export function pickEmoji(clientX, clientY) {
  return new Promise((resolve) => {
    const panel = document.getElementById("emojiPanel");
    panel.style.display = "grid";
    panel.style.left = clientX + "px";
    panel.style.top = clientY + 8 + "px";
    panel.innerHTML = "";

    function close(result) {
      panel.style.display = "none";
      panel.innerHTML = "";
      document.removeEventListener("mousedown", onOutside);
      resolve(result);
    }
    function onOutside() {
      close(null);
    }

    EMOJIS.forEach((em) => {
      const btn = document.createElement("button");
      Object.assign(btn.style, {
        width: "30px",
        height: "30px",
        fontSize: "18px",
        cursor: "pointer",
        background: "transparent",
        border: "1px solid transparent",
        borderRadius: "6px",
      });
      btn.textContent = em;
      btn.addEventListener("mouseenter", () => (btn.style.background = "var(--surface2)"));
      btn.addEventListener("mouseleave", () => (btn.style.background = "transparent"));
      btn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        close(em);
      });
      panel.appendChild(btn);
    });

    setTimeout(() => document.addEventListener("mousedown", onOutside, { once: true }), 50);
  });
}

export function runCanvasCrop(container, canvas) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      zIndex: "500",
      cursor: "crosshair",
      background: "transparent",
    });
    const sel = document.createElement("div");
    Object.assign(sel.style, {
      position: "absolute",
      display: "none",
      border: "2px dashed #a78bfa",
      boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
      pointerEvents: "none",
    });
    overlay.appendChild(sel);
    container.appendChild(overlay);

    let sx, sy, ex, ey;
    let dragging = false;
    const rect = canvas.getBoundingClientRect();
    const scX = canvas.width / rect.width;
    const scY = canvas.height / rect.height;

    overlay.addEventListener("mousedown", (e) => {
      sx = e.clientX;
      sy = e.clientY;
      dragging = true;
      sel.style.display = "block";
      Object.assign(sel.style, { left: sx + "px", top: sy + "px", width: "0", height: "0" });
    });
    overlay.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      ex = e.clientX;
      ey = e.clientY;
      const x = Math.min(sx, ex);
      const y = Math.min(sy, ey);
      const w = Math.abs(ex - sx);
      const h = Math.abs(ey - sy);
      Object.assign(sel.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    });
    overlay.addEventListener("mouseup", () => {
      dragging = false;
    });

    function finish(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }
    function onKey(e) {
      if (e.key === "Enter") {
        if (!ex || !ey) {
          finish(null);
          return;
        }
        const cRect = container.getBoundingClientRect();
        const x = Math.min(sx, ex);
        const y = Math.min(sy, ey);
        const w = Math.abs(ex - sx);
        const h = Math.abs(ey - sy);
        const cx = (x - cRect.left) * scX;
        const cy = (y - cRect.top) * scY;
        const cw = w * scX;
        const ch = h * scY;
        if (cw < 10 || ch < 10) {
          finish(null);
          return;
        }
        finish({ x: cx, y: cy, width: cw, height: ch });
      }
      if (e.key === "Escape") finish(null);
    }
    document.addEventListener("keydown", onKey);
  });
}
