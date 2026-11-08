"use strict";

import { removePage, reorderPage } from "../core/workspace.js";
import { iconMarkup } from "./icons.js";

const THUMB_W = 200;
const THUMB_H = 125; // 16:10, matches .page-card-thumb's CSS aspect-ratio

// Vertical page cards — a large preview thumbnail on top (so pages read as
// visual "slides" rather than a thin text list) with a slim footer for the
// name and reorder controls. Reorder/delete mutate `workspace` directly
// (same convention as ui/layers-panel.js calling core/scene.js functions
// directly) — only the buffer-swap side effects go through hooks.
//
// `scene` is the *live* working buffers for whichever page is active — its
// layers are only copied into that page's persisted snapshot when the user
// switches away (see persistActivePage in main.js), so the active page's
// card reads straight from `scene` to show an up-to-date thumbnail without
// needing that flush to happen first.
export function initPagesPanel(panelEl, workspace, scene, hooks) {
  const { onSwitch, onNewPage, onActivePageRemoved } = hooks;
  const countEl = document.getElementById("pagesCount");

  function renderList() {
    panelEl.innerHTML = "";
    if (countEl) countEl.textContent = String(workspace.pages.length);

    workspace.pages.forEach((page, i) => {
      const isActive = page.id === workspace.activePageId;
      const layers = isActive ? scene.layers : page.sceneData.layers;
      panelEl.appendChild(buildCard(page, i, isActive, layers));
    });

    const addBtn = document.createElement("button");
    addBtn.className = "panel-add-btn";
    addBtn.textContent = "+ New Page";
    addBtn.addEventListener("click", () => onNewPage());
    panelEl.appendChild(addBtn);
  }

  function buildCard(page, index, isActive, layers) {
    const card = document.createElement("div");
    card.className = "page-card" + (isActive ? " active" : "");
    card.addEventListener("click", () => onSwitch(page.id));

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "page-card-thumb";

    const firstLayer = layers[0];
    if (firstLayer && firstLayer.img) {
      const thumb = document.createElement("canvas");
      thumb.width = THUMB_W;
      thumb.height = THUMB_H;
      const tctx = thumb.getContext("2d");
      const scale = Math.min(THUMB_W / firstLayer.img.width, THUMB_H / firstLayer.img.height);
      const dw = firstLayer.img.width * scale;
      const dh = firstLayer.img.height * scale;
      tctx.drawImage(firstLayer.img, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
      thumbWrap.appendChild(thumb);
    }

    if (workspace.pages.length > 1) {
      const delBtn = document.createElement("button");
      delBtn.className = "page-card-del";
      delBtn.innerHTML = iconMarkup("trash");
      delBtn.title = "Delete page";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const wasActive = page.id === workspace.activePageId;
        if (removePage(workspace, page.id)) {
          if (wasActive) onActivePageRemoved();
          renderList();
        }
      });
      thumbWrap.appendChild(delBtn);
    }

    const footer = document.createElement("div");
    footer.className = "page-card-footer";

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = page.name;

    const upBtn = document.createElement("button");
    upBtn.className = "row-btn";
    upBtn.innerHTML = iconMarkup("up");
    upBtn.title = "Move up";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reorderPage(workspace, page.id, -1);
      renderList();
    });

    const downBtn = document.createElement("button");
    downBtn.className = "row-btn";
    downBtn.innerHTML = iconMarkup("down");
    downBtn.title = "Move down";
    downBtn.disabled = index === workspace.pages.length - 1;
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reorderPage(workspace, page.id, 1);
      renderList();
    });

    footer.append(name, upBtn, downBtn);
    card.append(thumbWrap, footer);
    return card;
  }

  renderList();
  return { renderList };
}
