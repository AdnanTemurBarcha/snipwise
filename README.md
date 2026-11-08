# ✂ Snipwise Studio — Capture, Edit & Export

> Capture any page, then edit it like a pro. Right in your browser.

A free, open-source Chrome extension that captures screenshots and gives you a full layered image editor to finish them — annotate, paint, retouch, add effects, then export a PNG or a polished PDF. **100% local: no uploads, no accounts, no tracking.**

[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/snipwise)
[![License](https://img.shields.io/badge/license-MIT-7c3aed?style=flat-square)](LICENSE)
[![Manifest](https://img.shields.io/badge/manifest-v3-a78bfa?style=flat-square)]()
[![Version](https://img.shields.io/badge/version-3.0.0-c4b5fd?style=flat-square)]()

---

## Features

### Five ways to start

| Mode | Description |
|------|-------------|
| 📷 **Visible Area** | Captures exactly what's on screen right now |
| 📄 **Full Page** | Scrolls and stitches the entire page automatically |
| ✂ **Crop Region** | Drag to select any area of the page |
| 🖨 **Save as PDF** | One-click capture straight to a PDF file |
| 🗂 **Blank Canvas** | Open Studio empty — start from your own images, or a blank canvas from presets (social, screen, print) with a transparent or colored background |

### A real editor, not a markup tool

- **Layers everywhere** — every annotation, image and brush stroke is an editable layer: move, resize, rotate, flip, reorder, lock, hide, duplicate, rename. Align, distribute and snap with guides.
- **Annotate** — text, callouts, rectangles, ellipses, lines, arrows, pen, highlighter, numbered step markers and a full searchable **emoji** picker (the whole Unicode set).
- **Privacy tools** — non-destructive **blur, pixelate and solid redact** layers that re-render what's underneath; move or delete them and the original is back.
- **Paint & retouch** — brush (size, hardness, opacity, pen pressure), eraser, paint bucket, gradient, eyedropper and clone stamp.
- **Selections** — rectangle, ellipse, lasso and magic wand with add/subtract, feather, grow/shrink, invert; fill, clear, copy or cut to a new layer.
- **Non-destructive effects** — drop shadow, outline, brightness/contrast/saturation/hue/sepia/blur, levels, 16 blend modes, **adjustment layers**, saveable presets.
- **Layer masks** — hide parts of any layer without erasing them; paint masks with the brush tools, or create them from a selection.
- **Filters** — Gaussian blur, sharpen, noise, pixelate, posterize, black & white, sepia, invert (selection-aware).
- **Pages & canvas** — multiple pages, non-destructive crop, artboard resize, smart placement that trims transparent margins and keeps images at their real size.
- **Export** — full-resolution PNG (with transparency), copy to clipboard, and a customizable multi-page **PDF** with live preview, cover page and page-fit options.
- **Unlimited undo/redo** (300 steps), dark and light themes, built-in **documentation** (the Docs button, or `F1`).

Everything is documented in [`src/docs.html`](src/docs.html), which opens inside the extension from the **Docs** button.

Privacy: Snipwise Studio collects nothing and never uploads anything — see the [privacy policy](privacy.md).

---

## Installation

[![Install from Chrome Web Store](https://img.shields.io/badge/Available_on-Chrome_Web_Store-4285F4?style=flat-square&logo=googlechrome)](https://chromewebstore.google.com/detail/snipwise)

### From source

```bash
git clone https://github.com/AdnanTemurBarcha/snipwise.git
cd snipwise
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and choose the **`dist/`** folder.

---

## Development

The extension is built with **Vite + TypeScript** (Manifest V3). The editor is a Canvas 2D app with its own document model, command-based undo/redo and renderer.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | TypeScript (strict) |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | Builds, then drives the real editor in Chrome (Puppeteer) — draws, paints, selects, masks, exports |
| `npm run e2e:crop` | Tests the crop-region capture script |
| `npm run package` | Builds and zips `dist/` as `snipwise-studio.zip` for the Chrome Web Store |

The end-to-end tests expect Chrome at the default macOS path; set `CHROME=/path/to/chrome` to override.

### Project layout

```
src/
├── popup.html / popup.js      # Toolbar popup: capture modes
├── background.js              # Service worker: capture, stitching, hand-off to Studio
├── content.js                 # Crop-region overlay (injected on demand)
├── pdf.html / pdf.js          # "Save as PDF" quick capture
├── docs.html / docs.css / docs.ts   # Built-in documentation
├── studio.html
└── studio/
    ├── main.ts                # App wiring, shortcuts, import/export
    ├── engine/                # Document model, commands/history, renderer, selection,
    │                          #   raster ops, filters, adjustments (no DOM UI)
    ├── ui/                    # Stage (canvas + tools), inspector, layers/pages panels, dialogs
    ├── io/                    # Capture hand-off, import (drop/paste/picker), PDF export
    └── studio.css
public/                        # manifest.json, icons, bundled jsPDF
scripts/                       # e2e scripts
```

### Permissions

| Permission | Why |
|------------|-----|
| `activeTab`, `scripting` | Capture the page you invoked Snipwise on and run the crop overlay |
| `tabs` | Open Studio / PDF / docs tabs and take the screenshot |
| `storage` | Keep your theme and saved adjustment presets (captures are passed to Studio in memory and are never stored) |

There are **no host permissions** and no remote code.

---

## Contributing

Pull requests welcome. Please keep these in mind:

- **Local only** — no network requests, no analytics, no remote scripts.
- **No host permissions** — keep it that way.
- **Keep the engine/UI boundary** — `src/studio/engine/` holds the model, rendering and pixel operations; DOM and event handling live in `src/studio/ui/`.
- **Add tests** — unit tests for pure logic in `src/__tests__/`, and a check in `scripts/e2e-studio.mjs` for anything a user can click.
- **Undoable by default** — every edit goes through the command history.
- Test on Chrome (and Brave if you can) before submitting.

---

## Related

- [SwiftCheck](https://github.com/AdnanTemurBarcha/swift-check) — Internet speed test in MB/s, by the same developer

---

## License

MIT — do whatever you want, attribution appreciated.

---

## Credits

- PDF export: [jsPDF](https://github.com/parallax/jsPDF) — bundled locally
- Emoji data: [unicode-emoji-json](https://github.com/muan/unicode-emoji-json) (MIT)
- Built by [Adnan Temur Barcha](https://github.com/AdnanTemurBarcha)
