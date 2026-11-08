"use strict";

import pen from "./pen.js";
import arrow from "./arrow.js";
import line from "./line.js";
import rect from "./rect.js";
import circle from "./circle.js";
import text from "./text.js";
import highlight from "./highlight.js";
import blur from "./blur.js";
import step from "./step.js";
import callout from "./callout.js";
import emoji from "./emoji.js";
import cropcanvas from "./crop-canvas.js";
import move from "./move.js";

const registry = {};
[pen, arrow, line, rect, circle, text, highlight, blur, step, callout, emoji, cropcanvas, move].forEach((tool) => {
  registry[tool.id] = tool;
});

export function getTool(id) {
  return registry[id] || null;
}

export function getToolIds() {
  return Object.keys(registry);
}
