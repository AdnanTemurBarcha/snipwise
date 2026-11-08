"use strict";

import { removeLayer, reorderLayer, setLayerProp, setSelectedLayer } from "../core/scene.js";
import { iconMarkup } from "./icons.js";

export function initLayersPanel(panelEl, scene, hooks) {
  const { requestRender, pushUndo } = hooks;
  const countEl = document.getElementById("layersCount");

  function renderList() {
    panelEl.innerHTML = "";
    if (countEl) countEl.textContent = String(scene.layers.length);
    if (scene.layers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "panel-empty";
      empty.textContent = "No layers yet";
      panelEl.appendChild(empty);
      return;
    }
    // Top of the list = frontmost layer (last in the back-to-front array).
    for (let i = scene.layers.length - 1; i >= 0; i--) {
      panelEl.appendChild(buildRow(scene.layers[i], i));
    }
  }

  // Two-tier row: thumbnail/name/visibility up top, opacity + reorder +
  // delete below — spreads the controls across two lines instead of cramming
  // 4 buttons and a slider into one narrow line.
  function buildRow(layer, index) {
    const row = document.createElement("div");
    row.className = "layer-row" + (layer.id === scene.selectedLayerId ? " active" : "");
    row.addEventListener("click", () => {
      setSelectedLayer(scene, layer.id);
      requestRender();
      renderList();
    });

    const top = document.createElement("div");
    top.className = "layer-row-top";

    const thumb = document.createElement("canvas");
    thumb.width = 36;
    thumb.height = 36;
    thumb.className = "row-thumb";
    const tctx = thumb.getContext("2d");
    if (layer.type === "image") {
      const scale = Math.min(36 / layer.img.width, 36 / layer.img.height);
      const dw = layer.img.width * scale;
      const dh = layer.img.height * scale;
      tctx.drawImage(layer.img, (36 - dw) / 2, (36 - dh) / 2, dw, dh);
    } else {
      // Text/callout layers have no image — draw a small "T" glyph instead
      // (a drawn speech-bubble outline for callouts), no emoji.
      tctx.fillStyle = layer.color;
      if (layer.type === "callout") {
        tctx.strokeStyle = layer.color;
        tctx.lineWidth = 1.5;
        tctx.beginPath();
        tctx.roundRect(6, 7, 24, 16, 3);
        tctx.stroke();
      }
      tctx.font = "bold 15px Inter, sans-serif";
      tctx.textAlign = "center";
      tctx.textBaseline = "middle";
      tctx.fillText("T", 18, layer.type === "callout" ? 15 : 18);
      tctx.textAlign = "left";
      tctx.textBaseline = "alphabetic";
    }

    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = layer.name;

    const visBtn = document.createElement("button");
    visBtn.className = "row-btn";
    visBtn.innerHTML = layer.visible ? iconMarkup("eye") : iconMarkup("eyeOff");
    visBtn.title = "Toggle visibility";
    visBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setLayerProp(scene, layer.id, "visible", !layer.visible);
      requestRender();
      pushUndo();
      renderList();
    });

    top.append(thumb, name, visBtn);

    const bottom = document.createElement("div");
    bottom.className = "layer-row-bottom";

    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0";
    opacity.max = "100";
    opacity.value = String(Math.round(layer.opacity * 100));
    opacity.className = "row-opacity";
    opacity.title = "Opacity";
    opacity.addEventListener("click", (e) => e.stopPropagation());
    opacity.addEventListener("input", () => {
      setLayerProp(scene, layer.id, "opacity", opacity.valueAsNumber / 100);
      requestRender();
    });
    opacity.addEventListener("change", () => pushUndo());

    const upBtn = document.createElement("button");
    upBtn.className = "row-btn";
    upBtn.innerHTML = iconMarkup("up");
    upBtn.title = "Bring forward";
    upBtn.disabled = index === scene.layers.length - 1;
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reorderLayer(scene, layer.id, 1);
      requestRender();
      pushUndo();
      renderList();
    });

    const downBtn = document.createElement("button");
    downBtn.className = "row-btn";
    downBtn.innerHTML = iconMarkup("down");
    downBtn.title = "Send backward";
    downBtn.disabled = index === 0;
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      reorderLayer(scene, layer.id, -1);
      requestRender();
      pushUndo();
      renderList();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "row-btn row-btn-danger";
    delBtn.innerHTML = iconMarkup("trash");
    delBtn.title = "Delete layer";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeLayer(scene, layer.id);
      requestRender();
      pushUndo();
      renderList();
    });

    bottom.append(opacity, upBtn, downBtn, delBtn);

    row.append(top, bottom);
    return row;
  }

  renderList();
  return { renderList };
}
