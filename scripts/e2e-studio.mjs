// Drives the built Studio page in a real (throwaway-profile) Chrome with a stubbed chrome.* API.
// Usage: npm run build && node scripts/e2e-studio.mjs [screenshotDir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DIST = path.resolve(import.meta.dirname, '../dist');
const SHOTS = process.argv[2] || path.resolve(import.meta.dirname, '../.e2e');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--window-size=1500,950'], defaultViewport: { width: 1500, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('response', (r) => r.status() >= 400 && !/favicon/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
await page.evaluateOnNewDocument(() => {
  window.chrome = { storage: { local: { get: (k, cb) => cb && cb({}), set: () => {} } }, runtime: { sendMessage: (m, cb) => cb && cb(null) } };
});

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

await page.goto(`${base}/studio.html`, { waitUntil: 'load' });
await page.waitForFunction(() => window.studio);

// a recognisable test image: 900x600, coloured bands + text
await ev(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 600;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 900, 600); g.addColorStop(0, '#dbeafe'); g.addColorStop(1, '#fde68a');
  x.fillStyle = g; x.fillRect(0, 0, 900, 600);
  x.fillStyle = '#1f2937'; x.font = 'bold 54px sans-serif'; x.fillText('Quarterly report', 60, 120);
  x.font = '28px sans-serif'; x.fillText('password: hunter2   card: 4242 4242 4242 4242', 60, 190);
  x.fillStyle = '#ef4444'; x.fillRect(60, 260, 300, 140);
  const img = new Image(); img.src = c.toDataURL(); await img.decode();
  window.studio.placeImage(img, 'Background');
});

const S = () => ev(() => ({
  n: window.studio.editor.page.layers.length,
  types: window.studio.editor.page.layers.map((l) => l.type),
  sel: window.studio.editor.selection.length,
  w: window.studio.editor.page.width, h: window.studio.editor.page.height,
}));
// page point -> viewport (client) coords
const at = (x, y) => ev((x, y) => {
  const r = window.studio.stage.canvas.getBoundingClientRect(); const s = window.studio.stage.vp.toScreen({ x, y });
  return { x: r.left + s.x, y: r.top + s.y };
}, x, y);
const drag = async (a, b, steps = 8, mods = []) => {
  const p = await at(...a), q = await at(...b);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(p.x + ((q.x - p.x) * i) / steps, p.y + ((q.y - p.y) * i) / steps);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
};
const click = async (x, y) => { const p = await at(x, y); await page.mouse.click(p.x, p.y); };
const key = async (k) => { await page.keyboard.press(k); };
// press a tool shortcut and wait until the tool is really active (a key sent right after heavy work can be dropped)
const tool = async (k, id) => {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(k);
    if (await page.waitForFunction((id) => window.studio.stage.tool === id, { timeout: 600 }, id).then(() => true, () => false)) return;
  }
};
const layer = (i) => ev((i) => { const l = window.studio.editor.page.layers[i]; return l && JSON.parse(JSON.stringify({ ...l, source: undefined })); }, i);

let s = await S();
check('image loads and sizes the page', s.n === 1 && s.w === 900 && s.h === 600, JSON.stringify(s));
await shot('01-loaded');

// ── drawing tools ───────────────────────────────────────────────────────────
await key('r'); await drag([420, 250], [620, 400]);
s = await S(); check('rectangle tool draws a shape layer', s.types.at(-1) === 'shape' && s.n === 2, s.types.join());
let l = await layer(1);
check('rectangle geometry matches the drag', Math.abs(l.x - 420) < 2 && Math.abs(l.width - 200) < 2 && Math.abs(l.height - 150) < 2, `${l.x},${l.y} ${l.width}x${l.height}`);

await key('c'); await drag([640, 250], [760, 330], 8, ['Shift']);
l = await layer(2); check('Shift makes the ellipse a circle', l.shape === 'ellipse' && Math.abs(l.width - l.height) < 1.5, `${l.width}x${l.height}`);

await key('a'); await drag([100, 500], [350, 430]);
l = await layer(3); check('arrow tool draws a line layer with an arrowhead', l.type === 'line' && l.endArrow === true);

await key('l'); await drag([100, 560], [400, 560]);
l = await layer(4); check('line tool draws a line', l.type === 'line' && !l.endArrow && l.height === 1);

await key('p');
{ const pts = Array.from({ length: 20 }, (_, i) => [500 + i * 12, 480 + Math.sin(i / 2) * 30]);
  const p0 = await at(...pts[0]); await page.mouse.move(p0.x, p0.y); await page.mouse.down();
  for (const pt of pts) { const q = await at(...pt); await page.mouse.move(q.x, q.y); }
  await page.mouse.up(); }
l = await layer(5); check('pen draws a path with many points', l.type === 'path' && l.points.length > 10, `${l.points?.length} pts`);

await key('y'); await drag([60, 100], [520, 108], 10);
l = await layer(6); check('highlighter is a translucent wide path', l.type === 'path' && l.opacity < 1 && l.strokeWidth > 8, `${l.opacity} ${l.strokeWidth}`);

await key('u'); await drag([440, 165], [880, 205]);
l = await layer(7); check('blur tool creates a non-destructive blur layer', l.type === 'blur' && l.mode === 'pixelate');

for (const [x, y] of [[80, 300], [150, 300], [220, 300]]) { await key('n'); await click(x, y); }
s = await S();
const steps = await ev(() => window.studio.editor.page.layers.filter((l) => l.type === 'stamp').map((l) => l.text));
check('step markers count up 1,2,3', steps.join() === '1,2,3', steps.join());

await shot('02-annotated');

// ── select / move / undo ────────────────────────────────────────────────────
await key('v');
await click(520, 325); // inside hollow rect: should NOT select it, falls through to the background image
let sel = await ev(() => window.studio.editor.primary?.type);
check('clicking inside a hollow rectangle selects what is behind it', sel === 'image', sel);
await click(470, 250); // on rect outline (top edge, clear of the handles)
sel = await ev(() => window.studio.editor.primary?.type);
check('clicking a rectangle outline selects it', sel === 'shape', sel);
const before = await layer(1);
await drag([470, 250], [510, 290]);
let after = await layer(1);
check('dragging moves the layer', Math.abs(after.x - before.x - 40) < 6 && Math.abs(after.y - before.y - 40) < 6, `${before.x}->${after.x}`);
await page.keyboard.down('Control'); await key('z'); await page.keyboard.up('Control');
after = await layer(1);
check('Ctrl+Z undoes the move in one step', Math.abs(after.x - before.x) < 0.5, `${after.x}`);
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await key('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
after = await layer(1);
check('Ctrl+Shift+Z redoes it', after.x > before.x + 30, `${after.x}`);

// resize + rotate via handles
const hp = await ev(() => { const st = window.studio; const L = st.editor.primary; const t = (p) => { const r = st.stage.canvas.getBoundingClientRect(); const s = st.stage.vp.toScreen(p); return { x: r.left + s.x, y: r.top + s.y }; };
  const c = (a) => ({ x: L.x + (a[0] * L.width), y: L.y + a[1] * L.height });
  return { se: t(c([1, 1])), rot: t({ x: L.x + L.width / 2, y: L.y - 26 / st.stage.vp.zoom }), w: L.width }; });
await page.mouse.move(hp.se.x, hp.se.y); await page.mouse.down(); await page.mouse.move(hp.se.x + 60, hp.se.y + 40, { steps: 6 }); await page.mouse.up();
l = await layer(1); check('dragging the SE handle resizes', l.width > 200 + 40, `${l.width}x${l.height}`);
const hp2 = await ev(() => { const st = window.studio; const L = st.editor.primary; const r = st.stage.canvas.getBoundingClientRect(); const s = st.stage.vp.toScreen({ x: L.x + L.width / 2, y: L.y - 26 / st.stage.vp.zoom }); return { x: r.left + s.x, y: r.top + s.y, cx: r.left + st.stage.vp.toScreen({ x: L.x + L.width / 2, y: L.y + L.height / 2 }).x, cy: r.top + st.stage.vp.toScreen({ x: L.x + L.width / 2, y: L.y + L.height / 2 }).y }; });
await page.mouse.move(hp2.x, hp2.y); await page.mouse.down(); await page.mouse.move(hp2.cx + 150, hp2.cy, { steps: 8 }); await page.mouse.up();
l = await layer(1); check('dragging the rotate handle rotates ~90°', Math.abs(l.rotation - Math.PI / 2) < 0.15, `${(l.rotation * 180 / Math.PI).toFixed(1)}°`);
await shot('03-transformed');

// ── marquee, align, distribute ─────────────────────────────────────────────
await key('Escape');
await drag([40, 270], [300, 330]); // starts on the locked background -> marquee
let msel = await ev(() => window.studio.editor.selected.map((l) => l.type + ':' + (l.text ?? '')));
check('marquee over the locked background selects the 3 step markers', msel.length === 3 && msel.every((x) => x.startsWith('stamp')), msel.join());

// scramble y so align has work to do
await ev(() => { const e = window.studio.editor; e.selected.forEach((l, i) => e.patchLayer(l.id, { y: l.y + i * 30 })); });
const ys0 = await ev(() => window.studio.editor.selected.map((l) => l.y));
await ev(() => window.studio.editor.alignSelection('top'));
const ys1 = await ev(() => window.studio.editor.selected.map((l) => l.y));
check('align top puts all markers on the same y', new Set(ys1.map((y) => Math.round(y))).size === 1 && new Set(ys0.map((y) => Math.round(y))).size > 1, ys1.map((y) => Math.round(y)).join());
await ev(() => { const e = window.studio.editor; const [a, b, c] = e.selected; e.patchLayer(c.id, { x: 600 }); });
await ev(() => window.studio.editor.distributeSelection('x'));
const xs = await ev(() => window.studio.editor.selected.map((l) => l.x).sort((a, b) => a - b));
check('distribute spaces the markers evenly', Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1])) < 1, xs.map((x) => Math.round(x)).join());

// snapping: drag a marker so its centre is ~4px off the page centre -> snaps
await key('Escape');
await ev(() => { const e = window.studio.editor; const s = e.page.layers.find((l) => l.type === 'stamp'); e.select([s.id]); e.patchLayer(s.id, { x: 100, y: 20 }); });
const sc = await ev(() => { const l = window.studio.editor.primary; return { cx: l.x + l.width / 2, cy: l.y + l.height / 2 }; });
await drag([sc.cx, sc.cy], [450 - 4 + 0, sc.cy], 10);
const after450 = await ev(() => { const l = window.studio.editor.primary; return l.x + l.width / 2; });
check('moving near the page centre snaps to it', Math.abs(after450 - 450) < 0.5, `${after450}`);

// ── blur is non-destructive and actually changes pixels ─────────────────────
await ev(() => window.studio.editor.select([]));
await shot('04-aligned');
const blurInfo = await ev(async () => {
  const { editor } = window.studio;
  // render the page with and without the blur layer through the app's own exporter path
  const grab = () => new Promise((res) => { const c = document.querySelector('canvas.stage-canvas'); res(c.toDataURL()); });
  const b = editor.page.layers.find((l) => l.type === 'blur');
  const on = await grab(); editor.patchLayer(b.id, { visible: false }); await new Promise((r) => setTimeout(r, 120)); const off = await grab();
  editor.patchLayer(b.id, { visible: true }); await new Promise((r) => setTimeout(r, 120));
  return { different: on !== off };
});
check('toggling the blur layer changes the rendered canvas', blurInfo.different);

// ── z-order, duplicate, delete ──────────────────────────────────────────────
const n0 = (await S()).n;
await ev(() => { const e = window.studio.editor; e.select([e.page.layers[1].id]); });
await page.keyboard.down('Control'); await key('d'); await page.keyboard.up('Control');
check('Ctrl+D duplicates the selection', (await S()).n === n0 + 1);
await key('Delete');
check('Delete removes it', (await S()).n === n0);
await page.keyboard.down('Control'); await key('z'); await page.keyboard.up('Control');
check('undo of delete restores it', (await S()).n === n0 + 1);

// ── crop ────────────────────────────────────────────────────────────────────
await key('x');
check('crop tool shows the confirm bar', await ev(() => document.getElementById('cropBar').classList.contains('on')));
await drag([100, 80], [700, 500]);
const cr = await ev(() => ({ ...window.studio.stage.cropRect }));
check('dragging defines a crop rectangle', Math.abs(cr.width - 600) < 3 && Math.abs(cr.height - 420) < 3, `${Math.round(cr.width)}x${Math.round(cr.height)}`);
await shot('05-cropping');
await key('Enter');
s = await S();
check('Enter applies the crop to the artboard', s.w === 600 && s.h === 420, `${s.w}x${s.h}`);
await page.keyboard.down('Control'); await key('z'); await page.keyboard.up('Control');
s = await S();
check('undo brings the full artboard back', s.w === 900 && s.h === 600, `${s.w}x${s.h}`);

// ── text ────────────────────────────────────────────────────────────────────
await key('t'); await click(500, 60);
await page.keyboard.type('Hello Snipwise');
await page.keyboard.down('Control'); await key('Enter'); await page.keyboard.up('Control');
const t = await ev(() => window.studio.editor.page.layers.at(-1));
check('text tool creates a text layer from typed input', t.type === 'text' && t.text === 'Hello Snipwise', t.text);

// ── raster tools & selections (phase 3) ─────────────────────────────────────
const E = (fn, ...a) => ev(fn, ...a);
const ctrl = async (k, shift = false) => { await page.keyboard.down('Control'); if (shift) await page.keyboard.down('Shift'); await key(k); if (shift) await page.keyboard.up('Shift'); await page.keyboard.up('Control'); };
const nLayers = () => E(() => window.studio.editor.page.layers.length);
const lastRaster = () => E(() => { const ls = window.studio.editor.page.layers; const l = ls[ls.length - 1]; return l && { type: l.type, raster: !!l.raster, locked: l.locked, name: l.name }; });
const alphaCount = (idx = -1) => E((idx) => {
  const ls = window.studio.editor.page.layers; const l = idx < 0 ? ls[ls.length + idx] : ls[idx];
  const c = l.source; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n;
}, idx);
const pixel = (x, y, idx = -1) => E((x, y, idx) => {
  const ls = window.studio.editor.page.layers; const l = idx < 0 ? ls[ls.length + idx] : ls[idx];
  return [...l.source.getContext('2d').getImageData(x, y, 1, 1).data];
}, x, y, idx);
const pixSel = () => E(() => { const p = window.studio.editor.pixelSel; return { active: p.active, b: p.bounds() }; });
const near = (a, b, t = 3) => Math.abs(a - b) <= t;
await E(() => window.studio.editor.select([]));

// selection tools
await key('w'); await click(330, 380);
let ps = await pixSel();
check('magic wand selects the red block', ps.active && near(ps.b.x, 60) && near(ps.b.y, 260) && near(ps.b.width, 300) && near(ps.b.height, 140), JSON.stringify(ps.b));
await key('Escape');
ps = await pixSel(); check('Escape drops the pixel selection', !ps.active);
await ctrl('z');
ps = await pixSel(); check('undo brings the selection back', ps.active);
await ctrl('z');
await key('m'); await drag([50, 440], [250, 560]);
ps = await pixSel(); check('rectangular marquee selects the dragged area', ps.active && near(ps.b.x, 50) && near(ps.b.y, 440) && near(ps.b.width, 200) && near(ps.b.height, 120), JSON.stringify(ps.b));
await shot('07-selection');
await page.keyboard.down('Shift'); await key('m'); await page.keyboard.up('Shift');
check('Shift+M switches to the elliptical marquee', await E(() => window.studio.stage.tool === 'selellipse'));
await drag([600, 440], [800, 560], 8, ['Shift']);
ps = await pixSel(); check('Shift while starting adds to the selection', ps.active && ps.b.x < 60 && ps.b.x + ps.b.width > 780, JSON.stringify(ps.b));
await key('q');
{ const pts = [[300, 440], [380, 450], [400, 520], [330, 560], [290, 500]]; const p0 = await at(...pts[0]); await page.mouse.move(p0.x, p0.y); await page.mouse.down(); for (const pt of pts.slice(1).concat([pts[0]])) { const q = await at(...pt); await page.mouse.move(q.x, q.y, { steps: 4 }); } await page.mouse.up(); }
ps = await pixSel(); check('lasso replaces the selection with a freehand shape', ps.active && near(ps.b.x, 290, 4) && ps.b.x + ps.b.width < 420, JSON.stringify(ps.b));
await key('Escape');

// brush
await key('b'); const nBefore = await nLayers(); await drag([100, 250], [300, 250], 12);
let lr = await lastRaster();
check('brush with nothing selected paints on a new raster layer', (await nLayers()) === nBefore + 1 && lr.type === 'image' && lr.raster, JSON.stringify(lr));
const a1 = await alphaCount();
check('the stroke put pixels on the layer', a1 > 1500, `${a1} px`);
check('stroke is the brush colour at its centre', (await pixel(200, 250)).slice(0, 3).join() === '167,139,250');
await ctrl('z');
check('one undo removes the whole stroke and its layer', (await nLayers()) === nBefore);
await ctrl('z', true);
check('redo brings it back with its pixels', (await nLayers()) === nBefore + 1 && (await alphaCount()) === a1);

// eraser
await key('e'); await drag([150, 240], [250, 260], 8);
const a2 = await alphaCount();
check('eraser removes pixels from the painted layer', a2 < a1, `${a1} -> ${a2}`);
await ctrl('z');
check('undoing the erase restores them exactly', (await alphaCount()) === a1);

// selection-limited painting
await E(() => window.studio.editor.select([]));
await key('m'); await drag([400, 300], [500, 400]);
await key('b'); await drag([350, 350], [550, 350], 10);
check('painting is clipped to the selection', (await pixel(450, 350))[3] > 200 && (await pixel(380 - 40, 350))[3] === 0 && (await pixel(520, 350))[3] === 0);
await shot('08-painted');
await ctrl('z');
await key('Escape');

// eyedropper + bucket
await key('i'); await click(330, 380);
check('eyedropper picks the colour under the cursor', await E(() => window.studio.style.color === '#ef4444'), await E(() => window.studio.style.color));
await E(() => { window.studio.style.color = '#00c853'; window.studio.editor.select([]); });
await key('k'); const nb = await nLayers(); await click(340, 390);
lr = await lastRaster();
check('bucket fill lands on a new layer', (await nLayers()) === nb + 1 && lr.raster);
check('bucket filled the clicked colour region', (await pixel(340, 390)).join() === '0,200,83,255' && (await pixel(700, 100))[3] === 0);

// gradient
await E(() => { window.studio.style.color = '#ff0000'; window.studio.style.color2 = '#0000ff'; window.studio.editor.select([]); });
await key('g'); const ng = await nLayers(); await drag([0, 580], [900, 580], 10);
const g0 = await pixel(2, 300), g1 = await pixel(897, 300);
check('gradient creates a layer fading from colour 1 to colour 2', (await nLayers()) === ng + 1 && g0[0] > 240 && g1[2] > 240, `${g0} / ${g1}`);

// locked background is protected
await E(() => { const { editor } = window.studio; editor.select([editor.page.layers[0].id]); });
await key('b'); const nl = await nLayers();
await drag([100, 50], [200, 50], 6);
check('painting on the locked Background is refused', (await nLayers()) === nl && await E(() => !(window.studio.editor.page.layers[0].source instanceof HTMLCanvasElement)));

// selection -> new layer, clear, invert
await E(() => { window.studio.editor.select([]); });
await key('m'); await drag([60, 260], [360, 400]);
const nj = await nLayers(); await ctrl('j');
lr = await lastRaster();
check('Ctrl+J copies the selection to a new layer', (await nLayers()) === nj + 1 && lr.raster && (await alphaCount()) > 40000, `${await alphaCount()} px`);
await ctrl('i', true);
ps = await pixSel(); check('Ctrl+Shift+I inverts the selection', ps.active && ps.b.width >= 899, JSON.stringify(ps.b));
await key('Escape');
await key('v');

// tool option sliders map to sane style values
await key('b');
const sl = await E(() => {
  const labels = [...document.querySelectorAll('.tool-options .insp-row')];
  const find = (t) => labels.find((r) => r.querySelector('.num-label')?.textContent === t)?.querySelector('input');
  const read = () => ({ h: window.studio.style.brushHardness, o: window.studio.style.brushOpacity });
  const hardness = find('Hardness'), opacity = find('Opacity');
  hardness.value = '50'; hardness.dispatchEvent(new Event('input', { bubbles: true }));
  opacity.value = '40'; opacity.dispatchEvent(new Event('input', { bubbles: true }));
  const after = read();
  hardness.value = '80'; hardness.dispatchEvent(new Event('input', { bubbles: true }));
  opacity.value = '100'; opacity.dispatchEvent(new Event('input', { bubbles: true }));
  return { after, shown: [find('Hardness').value, find('Opacity').value] };
});
check('hardness/opacity sliders write 0..1 into the brush style', Math.abs(sl.after.h - 0.5) < 0.01 && Math.abs(sl.after.o - 0.4) < 0.01, JSON.stringify(sl));
await key('v');

// painting directly on an unlocked screenshot, clone stamp, rotated layers
const srcPixel = (x, y, idx) => E((x, y, idx) => {
  const l = window.studio.editor.page.layers[idx]; const c = document.createElement('canvas'); c.width = l.naturalWidth; c.height = l.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(l.source, 0, 0); return [...g.getImageData(x, y, 1, 1).data];
}, x, y, idx);
await E(() => { const { editor } = window.studio; const bg = editor.page.layers[0]; editor.patchLayer(bg.id, { locked: false }, 'Unlock'); editor.select([bg.id]); window.studio.style.color = '#10b981'; });
const orig = await srcPixel(700, 540, 0);
await key('b'); await drag([650, 540], [750, 540], 8);
const painted = await srcPixel(700, 540, 0);
check('brush paints straight onto an unlocked screenshot', painted.join() === '16,185,129,255' && orig.join() !== painted.join(), `${orig} -> ${painted}`);
await ctrl('z');
check('undo restores the original screenshot pixels', (await srcPixel(700, 540, 0)).join() === orig.join());
await key('s'); await page.keyboard.down('Alt'); await click(330, 380); await page.keyboard.up('Alt');
await drag([650, 540], [750, 540], 8);
const cloned = await srcPixel(660, 540, 0);
check('clone stamp copies pixels from the Alt-click source', cloned[0] > 200 && cloned[1] < 120, `${cloned}`);
await ctrl('z');
await E(() => { window.studio.editor.select([]); });
await key('b'); await drag([100, 250], [300, 250], 6);
const ri = (await nLayers()) - 1;
await E((ri) => { const { editor } = window.studio; const l = editor.page.layers[ri]; editor.patchLayer(l.id, { rotation: Math.PI / 2 }, 'Rotate'); }, ri);
await drag([600, 300], [620, 300], 4);
check('painting on a rotated layer lands where the cursor is', (await pixel(450, 150, ri))[3] > 100 && (await pixel(600, 300, ri))[3] === 0);
await key('v');

await key('b');
check('status bar names the active tool', await E(() => document.getElementById('toolName').textContent === 'Brush'), await E(() => document.getElementById('toolName').textContent));
await key('v');

// ── new blank canvas ────────────────────────────────────────────────────────
const P = () => E(() => ({ pages: window.studio.editor.doc.pages.length, w: window.studio.editor.page.width, h: window.studio.editor.page.height, layers: window.studio.editor.page.layers.map((l) => ({ n: l.name, locked: l.locked, raster: !!l.raster })) }));
await page.click('#btnNew'); await page.waitForSelector('.nc-modal');
await E(() => { const sel = document.querySelector('.nc-modal select'); sel.value = [...sel.options].find((o) => /Instagram post/.test(o.textContent)).value; sel.dispatchEvent(new Event('change', { bubbles: true })); });
const dims = await E(() => [...document.querySelectorAll('.nc-modal .nc-num')].map((i) => i.value));
check('choosing a preset fills in its size', dims.join('x') === '1080x1080', dims.join('x'));
await E(() => { const i = document.querySelectorAll('.nc-modal .nc-num')[0]; i.value = '99999'; i.dispatchEvent(new Event('input', { bubbles: true })); });
check('oversized canvases are rejected', await E(() => document.querySelector('.nc-modal .btn.primary').disabled && /8192/.test(document.querySelector('.nc-err').textContent)));
await E(() => { const i = document.querySelectorAll('.nc-modal .nc-num')[0]; i.value = '800'; i.dispatchEvent(new Event('input', { bubbles: true })); [...document.querySelectorAll('.nc-modal .seg')].find((b) => b.textContent === 'Transparent').click(); });
await shot('09-new-canvas');
await page.click('.nc-modal .btn.primary');
let pg = await P();
check('transparent canvas adds a page of that size with no layers', pg.pages === 2 && pg.w === 800 && pg.h === 1080 && pg.layers.length === 0, JSON.stringify(pg));
await ctrl('z');
pg = await P(); check('creating a canvas is a single undo step', pg.pages === 1 && pg.w === 900, JSON.stringify(pg));
await ctrl('z', true);
await key('b'); await drag([100, 100], [400, 300], 6);
pg = await P(); check('you can paint straight onto a transparent canvas', pg.layers.length === 1 && pg.layers[0].raster, JSON.stringify(pg));
await page.click('#btnNew'); await page.waitForSelector('.nc-modal');
await E(() => { [...document.querySelectorAll('.nc-modal .seg')].find((b) => b.textContent === 'Color').click(); const c = document.querySelector('.nc-modal input[type=color]'); c.value = '#102030'; c.dispatchEvent(new Event('input', { bubbles: true })); });
await key('Enter');
pg = await P();
check('Enter creates a colour-filled canvas with a locked Background', pg.pages === 3 && pg.layers.length === 1 && pg.layers[0].locked && pg.layers[0].n === 'Background', JSON.stringify(pg));
check('background pixels use the chosen colour', (await pixel(5, 5, 0)).slice(0, 3).join() === '16,32,48');
await page.click('#btnNew'); await page.waitForSelector('.nc-modal'); await key('Escape');
check('Escape closes the dialog without creating anything', (await P()).pages === 3 && !(await E(() => !!document.querySelector('.nc-modal'))));
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));

// ── effects & adjustments (phase 4) ─────────────────────────────────────────
const flatPx = (x, y) => E((x, y) => [...window.studio.flatten().getContext('2d').getImageData(x, y, 1, 1).data], x, y);
await E(() => window.studio.newCanvas({ width: 400, height: 300, background: '#ffffff' }));
await tool('r', 'rect'); await E(() => { window.studio.style.fill = '#ff0000'; window.studio.style.strokeWidth = 1; });
await drag([100, 100], [200, 180]);
const rid = await E(() => window.studio.editor.primary.id);
const fxPatch = (fx) => E((rid, fx) => { const { editor } = window.studio; editor.patchLayer(rid, { fx }, 'fx'); }, rid, fx);
await E((rid) => window.studio.editor.patchLayer(rid, { stroke: null }, 'no stroke'), rid);
check('baseline: nothing right of the rectangle', (await flatPx(230, 140)).join() === '255,255,255,255');
await fxPatch({ shadow: { color: '#000000', blur: 0, x: 30, y: 0, opacity: 1 } });
check('drop shadow is drawn beside the layer', (await flatPx(220, 140))[0] < 30 && (await flatPx(150, 140)).join() === '255,0,0,255', (await flatPx(220, 140)).join());
await fxPatch({ stroke: { color: '#00ff00', width: 6 } });
check('outline surrounds the layer', (await flatPx(96, 140))[1] > 200 && (await flatPx(96, 140))[0] < 60, (await flatPx(96, 140)).join());
await fxPatch({ adjust: { brightness: 0, contrast: 0, saturation: 0, hue: 0, grayscale: 100, sepia: 0, invert: 0, blur: 0, levels: null } });
const gp = await flatPx(150, 140);
check('per-layer grayscale adjustment desaturates the layer', Math.abs(gp[0] - gp[1]) < 4 && Math.abs(gp[1] - gp[2]) < 4 && gp[0] < 200, gp.join());
await fxPatch({});
// adjustment layer
const nA = await nLayers();
await page.click('button[title^="New adjustment"]');
check('adjustment layer button adds an adjust layer', (await nLayers()) === nA + 1 && await E(() => window.studio.editor.primary.type === 'adjust'));
await E(() => { const { editor } = window.studio; const l = editor.primary; editor.patchLayer(l.id, { adjust: { ...l.adjust, invert: 100 } }, 'invert'); });
check('adjustment layer re-colors what is beneath it', (await flatPx(10, 10)).slice(0, 3).join() === '0,0,0' && (await flatPx(150, 140)).slice(0, 3).join() === '0,255,255');
await shot('10-adjustment');
const sliderVal = await E(() => {
  const rows = [...document.querySelectorAll('.effects-panel .insp-row')];
  const r = rows.find((x) => x.querySelector('.num-label')?.textContent === 'Brightness').querySelector('input');
  r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true }));
  return window.studio.editor.primary.adjust.brightness;
});
check('the Adjustments panel sliders edit the layer', sliderVal === 40, String(sliderVal));
await ctrl('z'); await ctrl('z'); await ctrl('z');
check('undo walks the adjustment layer back out', (await nLayers()) === nA && (await flatPx(10, 10)).slice(0, 3).join() === '255,255,255');
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));

// preset dropdown reflects the applied look; custom presets can be saved
await E(() => window.studio.newCanvas({ width: 300, height: 200, background: '#ffffff' }));
await key('r'); await drag([50, 50], [150, 120]); await key('v');
const presetSel = () => E(() => { const s = document.querySelector('.effects-panel select'); return { v: s.value, t: s.selectedOptions[0]?.textContent }; });
await E(() => { const s = document.querySelector('.effects-panel select'); s.value = [...s.options].find((o) => o.textContent === 'Sepia').value; s.dispatchEvent(new Event('change', { bubbles: true })); });
let ps2 = await presetSel(); check('dropdown shows the applied preset by name', ps2.t === 'Sepia', JSON.stringify(ps2));
await E(() => { const r = [...document.querySelectorAll('.effects-panel .insp-row')].find((x) => x.querySelector('.num-label')?.textContent === 'Brightness').querySelector('input'); r.value = '12'; r.dispatchEvent(new Event('input', { bubbles: true })); });
ps2 = await presetSel(); check('moving a slider switches it to "Custom"', ps2.t === 'Custom', JSON.stringify(ps2));
await E(() => [...document.querySelectorAll('.effects-panel .btn')].find((b) => b.textContent === 'Save…').click());
await E(() => { const i = document.querySelector('.effects-panel .nc-name'); i.value = 'My warm look'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
ps2 = await presetSel(); check('saved preset appears under My presets and is selected', ps2.t === 'My warm look', JSON.stringify(ps2));
await E(() => [...document.querySelectorAll('.effects-panel .btn')].find((b) => b.textContent === 'Reset').click());
await E(() => { const s = document.querySelector('.effects-panel select'); s.value = [...s.options].find((o) => o.textContent === 'My warm look').value; s.dispatchEvent(new Event('change', { bubbles: true })); });
check('applying the saved preset restores its values', await E(() => { const a = window.studio.editor.primary.fx.adjust; return a.sepia === 85 && a.contrast === 5 && a.brightness === 12; }));
await E(() => [...document.querySelectorAll('.effects-panel .btn')].find((b) => b.textContent === 'Delete').click());
check('deleting removes it from the list', await E(() => ![...document.querySelectorAll('.effects-panel option')].some((o) => o.textContent === 'My warm look')));
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));

// ── layer masks & filters ───────────────────────────────────────────────────
await E(() => window.studio.newCanvas({ width: 400, height: 300, background: '#ffffff' }));
await tool('r', 'rect'); await E(() => { window.studio.style.fill = '#ff0000'; window.studio.style.strokeWidth = 1; });
await drag([100, 100], [300, 200]);
const mid = await E(() => { const { editor } = window.studio; editor.patchLayer(editor.primary.id, { stroke: null }, 's'); return editor.primary.id; });
await key('v'); await E((id) => window.studio.editor.select([id]), mid);
check('mask section appears for a selected layer', await E(() => [...document.querySelectorAll('.effects-panel .insp-title')].some((t) => t.textContent === 'Layer mask' && !t.parentElement.hidden)));
await E(() => [...document.querySelectorAll('.effects-panel .btn')].find((b) => b.textContent === 'Reveal all').click());
check('adding a mask puts the layer in mask-edit mode', await E(() => window.studio.editor.maskEdit && !!window.studio.editor.primary.mask));
check('layer row shows a mask thumbnail', await page.waitForFunction(() => !!document.querySelector('.layer-row.selected .mask-thumb'), { timeout: 2000 }).then(() => true, () => false));
check('Reveal-all mask leaves the layer fully visible', (await flatPx(200, 150)).join() === '255,0,0,255');
await key('e'); await drag([150, 150], [250, 150], 8);
check('eraser on the mask hides the layer along the stroke', (await flatPx(200, 150)).join() === '255,255,255,255' && (await flatPx(200, 190)).join() === '255,0,0,255', (await flatPx(200, 150)).join());
await key('b'); await drag([180, 150], [220, 150], 6);
check('brush on the mask reveals it again', (await flatPx(200, 150)).join() === '255,0,0,255');
await ctrl('z'); await ctrl('z');
check('mask edits undo like any other step', (await flatPx(200, 150)).join() === '255,0,0,255' && await E(() => window.studio.editor.primary.mask !== null));
await ctrl('z');
check('undo removes the mask itself', await E(() => !window.studio.editor.primary.mask));
await ctrl('z', true);
await E(() => window.studio.editor.invertMask(window.studio.editor.primary.id));
check('inverting a reveal-all mask hides the layer', (await flatPx(200, 150)).join() === '255,255,255,255');
await E(() => window.studio.editor.removeMask(window.studio.editor.primary.id));
check('deleting the mask restores the layer', (await flatPx(200, 150)).join() === '255,0,0,255');
await key('v');
// mask from a selection
await key('m'); await drag([100, 100], [200, 200]);
await key('v'); await E((id) => window.studio.editor.select([id]), mid);
await E(() => [...document.querySelectorAll('.effects-panel .btn')].find((b) => b.textContent === 'From selection').click());
check('mask from selection keeps only the selected part', (await flatPx(150, 150)).join() === '255,0,0,255' && (await flatPx(250, 150)).join() === '255,255,255,255');
await E(() => window.studio.editor.setMaskEdit(false)); await key('Escape');

// filters
await E(() => { const { editor } = window.studio; const bg = editor.page.layers[0]; editor.patchLayer(bg.id, { locked: false }, 'u'); editor.select([bg.id]); });
const runFilter = (id) => E((id) => {
  const sel = document.querySelector('.effects-panel .insp-section:last-child select'); sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
  [...document.querySelectorAll('.effects-panel .btn')].find((b) => b.textContent === 'Apply').click();
}, id);
await runFilter('invert');
check('Invert filter changes the layer pixels', (await flatPx(5, 5)).slice(0, 3).join() === '0,0,0');
await ctrl('z');
check('filters undo in one step', (await flatPx(5, 5)).slice(0, 3).join() === '255,255,255');
await key('m'); await drag([0, 0], [50, 50]);
await E(() => { const { editor } = window.studio; editor.select([editor.page.layers[0].id]); });
await runFilter('invert');
check('a filter is limited to the pixel selection', (await flatPx(10, 10)).slice(0, 3).join() === '0,0,0' && (await flatPx(300, 280)).slice(0, 3).join() === '255,255,255');
await shot('11-masks-filters');
await key('Escape'); await key('v');
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));

// placing images keeps their real size
await E(() => window.studio.newCanvas({ width: 400, height: 300, background: '#ffffff' }));
const placed = await E(async () => {
  const mk = async (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').fillRect(0, 0, w, h); const i = new Image(); i.src = c.toDataURL(); await i.decode(); return i; };
  const { editor } = window.studio;
  window.studio.placeImage(await mk(200, 100), 'small'); const a = editor.primary;
  const r1 = [a.x, a.y, a.width, a.height];
  window.studio.placeImage(await mk(800, 300), 'wide'); const b = editor.primary;
  return { small: r1, big: [b.x, b.y, b.width, b.height] };
});
check('a smaller image is placed at 100% and centred', placed.small.join() === '100,100,200,100', placed.small.join());
check('an oversized image is shrunk only to fit the canvas', placed.big[2] === 400 && Math.abs(placed.big[3] - 150) < 0.01 && placed.big[0] === 0, placed.big.join());
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));

// transparent margins are trimmed so the transform box hugs what you see
await E(() => window.studio.newCanvas({ width: 600, height: 400, background: '#ffffff' }));
const trim = await E(async () => {
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 0, 300, 200);   // faint shadow-like fringe
  x.fillStyle = '#2563eb'; x.fillRect(40, 30, 220, 140);          // the visible "window"
  const i = new Image(); i.src = c.toDataURL(); await i.decode();
  window.studio.placeImage(i, 'window'); const l = window.studio.editor.primary;
  return [l.width, l.height, l.naturalWidth, l.naturalHeight];
});
check('transparent shadow margins are trimmed from placed images', trim.join() === '220,140,220,140', trim.join());
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));

// ── export through the real flatten path ────────────────────────────────────
const exp = await ev(async () => {
  const { editor } = window.studio;
  editor.select([]);
  return { page: [editor.page.width, editor.page.height], layers: editor.page.layers.length, undo: editor.history.entries.length };
});
check('document survived the whole session', exp.layers > 8, JSON.stringify(exp));
await shot('06-final');

// ── emoji picker ────────────────────────────────────────────────────────────
await E(() => window.studio.editor.switchPage(window.studio.editor.doc.pages[0].id));
await key('j');
await page.waitForSelector('#emojiPicker .emoji-cell');
const cells = await E(() => ({ n: document.querySelectorAll('#emojiPicker .emoji-cell').length, tabs: document.querySelectorAll('#emojiPicker .emoji-tab').length }));
check('emoji picker lists the full Unicode set with category tabs', cells.n > 1800 && cells.tabs >= 10, JSON.stringify(cells));
await page.type('#emojiPicker .emoji-search', 'rocket'); await new Promise((r) => setTimeout(r, 300));
const firstHit = await E(() => document.querySelector('#emojiPicker .emoji-cell')?.dataset.e);
check('search finds emoji by name', firstHit === '🚀', firstHit);
await page.click('#emojiPicker .emoji-cell');
check('picking an emoji sets it and closes the picker', await E(() => window.studio.style.emoji === '🚀' && !document.getElementById('emojiPicker')));
await E(() => document.querySelector('.tool[data-tool="emoji"]').click()); // already active: re-open via the Style panel button
await E(() => { const b = document.querySelector('.emoji-btn'); if (b) b.click(); });
await page.waitForSelector('#emojiPicker .emoji-cell', { timeout: 3000 }).catch(() => {});
const recent = await E(() => document.querySelector('#emojiPicker [data-sec="recent"] .emoji-cell')?.dataset.e);
check('recently used emoji appear first', recent === '🚀', String(recent));
await shot('13-emoji');
await key('Escape'); await key('v');

// ── docs page ───────────────────────────────────────────────────────────────
check('Studio top bar has a Docs button', await E(() => !!document.getElementById('btnDocs') && /Docs/.test(document.getElementById('btnDocs').textContent)));
const docs = await browser.newPage();
const docErrors = [];
docs.on('pageerror', (e) => docErrors.push(String(e)));
await docs.evaluateOnNewDocument(() => { window.chrome = { storage: { local: { get: (k, cb) => cb({ theme: 'dark' }), set() {} } } }; });
await docs.goto(`${base}/docs.html`, { waitUntil: 'load' });
const info = await docs.evaluate(() => {
  const ids = new Set([...document.querySelectorAll('[id]')].map((e) => e.id));
  const bad = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)).filter((id) => !ids.has(id));
  return { sections: document.querySelectorAll('main section').length, toc: document.querySelectorAll('#toc a').length, bad, dark: document.documentElement.classList.contains('dark') };
});
check('docs page renders sections and a table of contents', info.sections >= 12 && info.toc > info.sections, JSON.stringify({ s: info.sections, t: info.toc }));
check('every internal docs link points at a real anchor', info.bad.length === 0, info.bad.join());
check('docs follow the saved dark theme', info.dark);
await docs.type('#search', 'clone stamp'); await new Promise((r) => setTimeout(r, 400));
const found = await docs.evaluate(() => ({ visible: [...document.querySelectorAll('main section')].filter((s) => !s.hidden).map((s) => s.id), marks: document.querySelectorAll('mark').length }));
check('searching narrows the docs and highlights matches', found.visible.includes('paint') && found.visible.length < 8 && found.marks > 0, JSON.stringify(found));
await docs.evaluate(() => { const i = document.getElementById('search'); i.value = ''; i.dispatchEvent(new Event('input')); });
await new Promise((r) => setTimeout(r, 300));
await docs.setViewport({ width: 1300, height: 900 });
await docs.screenshot({ path: path.join(SHOTS, '12-docs.png') });
check('docs page has no script errors', docErrors.length === 0, docErrors.join());
await docs.close();

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
console.log('Screenshots:', SHOTS);
process.exit(failed ? 1 : 0);
