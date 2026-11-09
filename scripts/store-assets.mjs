// Generates the Chrome Web Store images by driving the real, built Studio in Chrome.
//   npm run build && node scripts/store-assets.mjs        (or: npm run store-assets)
// Output: store/*.png — 24-bit PNG, no alpha, at the exact sizes the Web Store asks for:
//   screenshots 1280x800 (1-5)  ·  small promo tile 440x280  ·  marquee promo tile 1400x560
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
// NO_CAPTION=1 renders the same scenes without the purple caption band, for use on the website (output: store/site/)
const NO_CAPTION = process.env.NO_CAPTION === '1';
const OUT = path.join(ROOT, NO_CAPTION ? 'store/site' : 'store');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const FONT = "Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

const server = http.createServer((req, res) => {
  const f = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://localhost:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--font-render-hinting=none'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 24-bit PNG (no alpha) ───────────────────────────────────────────────────
function crcChunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePngRGB(w, h, rgba) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * (w * 3 + 1) + 1 + x * 3;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), crcChunk('IHDR', ihdr), crcChunk('IDAT', zlib.deflateSync(raw, { level: 9 })), crcChunk('IEND', Buffer.alloc(0))]);
}

// Resample a high-resolution screenshot down to the exact store size, then write it as RGB PNG.
const proc = await browser.newPage();
await proc.goto('about:blank');
async function finish(pngBuffer, w, h, name) {
  const b64 = pngBuffer.toString('base64');
  const data = await proc.evaluate(async (b64, w, h) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data;
    let bin = ''; const chunk = 0x8000;
    for (let i = 0; i < px.length; i += chunk) bin += String.fromCharCode.apply(null, px.subarray(i, i + chunk));
    return btoa(bin);
  }, b64, w, h);
  const file = path.join(OUT, name);
  fs.writeFileSync(file, encodePngRGB(w, h, Buffer.from(data, 'base64')));
  console.log(`wrote ${path.relative(ROOT, file)}  ${w}x${h}`);
}

// ── brand mark (white tile + purple scissors) ───────────────────────────────
const MARK = (size, bg = '#ffffff') => `<svg width="${size}" height="${size}" viewBox="0 0 128 128"><rect x="4" y="4" width="120" height="120" rx="30" fill="${bg}"/>
<circle cx="38" cy="42" r="17" fill="#8b6cff"/><circle cx="38" cy="42" r="6.5" fill="#1b1230"/>
<circle cx="38" cy="86" r="17" fill="#8b6cff"/><circle cx="38" cy="86" r="6.5" fill="#1b1230"/>
<path d="M54 50 L104 30 M54 78 L104 98" stroke="#5b21b6" stroke-width="10" stroke-linecap="round"/>
<circle cx="66" cy="64" r="8" fill="${bg}" stroke="#7c3aed" stroke-width="5"/></svg>`;

// ── a fictional product page to "capture" (no real brands) ──────────────────
const PAGE_W = 1200, PAGE_H = 750;
const PEOPLE = [
  ['Sarah Chen', 'sarah.chen@northwind.example', 'Business', 'Active', '$1,240'],
  ['Marcus Lee', 'marcus.lee@brightpath.example', 'Starter', 'Active', '$320'],
  ['Priya Nair', 'priya.nair@lumen.example', 'Enterprise', 'Pending', '$4,980'],
];
const dashboardHtml = () => `<!doctype html><meta charset=utf-8><style>
*{box-sizing:border-box;margin:0;padding:0}body{width:${PAGE_W}px;height:${PAGE_H}px;font-family:${FONT};background:#f3f5fb;color:#172033;position:relative;overflow:hidden}
.abs{position:absolute}.card{position:absolute;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(20,30,60,.08)}
.side{left:0;top:0;width:190px;height:${PAGE_H}px;background:#101a33;color:#aab6d6}
.nav{position:absolute;left:18px;width:154px;height:36px;border-radius:9px;padding:9px 12px;font-size:13.5px;font-weight:600}
.k{font-size:12px;color:#7a869f;font-weight:600;letter-spacing:.2px}.v{font-size:28px;font-weight:800;letter-spacing:-.5px}
.up{font-size:12px;font-weight:700;color:#12a05c}.dn{color:#e5484d}
.row{position:absolute;left:0;right:0;height:46px;border-top:1px solid #eef1f7;font-size:14px}.row span{position:absolute;top:14px}
.pill{border-radius:99px;padding:3px 10px;font-size:12px;font-weight:700}
</style>
<div class="abs side"><div class="abs" style="left:22px;top:22px;font-weight:800;font-size:18px;color:#fff;letter-spacing:-.3px">▲ Northwind</div>
${['Overview', 'Reports', 'Customers', 'Billing', 'Settings'].map((t, i) => `<div class="nav" style="top:${84 + i * 44}px;${i === 0 ? 'background:#1e2c52;color:#fff' : ''}">${t}</div>`).join('')}</div>
<div class="abs" style="left:190px;top:0;right:0;height:56px;background:#fff;border-bottom:1px solid #e6eaf3">
<div class="abs" style="left:24px;top:14px;width:300px;height:28px;border-radius:8px;background:#f0f3fa;color:#8a95ad;font-size:13px;padding:6px 12px">Search reports…</div>
<div class="abs" style="right:24px;top:12px;width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#38bdf8)"></div></div>
<div class="abs" style="left:214px;top:68px;font-size:19px;font-weight:800;letter-spacing:-.3px">Overview</div>
${[['Revenue', '$48.2k', '+8.4%', 0], ['Active users', '12,480', '+3.1%', 0], ['Conversion', '3.8%', '+12%', 0], ['Churn', '1.2%', '−0.4%', 1]].map((c, i) => `
<div class="card" style="left:${214 + i * 246}px;top:96px;width:222px;height:92px"><div class="abs k" style="left:18px;top:14px">${c[0]}</div><div class="abs v" style="left:18px;top:34px">${c[1]}</div><div class="abs up ${c[3] ? 'dn' : ''}" style="left:18px;top:70px;top:68px">${c[2]}</div></div>`).join('')}
<div class="card" style="left:214px;top:212px;width:594px;height:272px"><div class="abs k" style="left:20px;top:16px">Monthly revenue</div>
<svg class="abs" style="left:20px;top:44px" width="554" height="210" viewBox="0 0 554 210"><defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c3aed" stop-opacity=".28"/><stop offset="1" stop-color="#7c3aed" stop-opacity="0"/></linearGradient></defs>
${[40, 90, 140, 190].map((y) => `<line x1="0" x2="554" y1="${y}" y2="${y}" stroke="#eef1f7"/>`).join('')}
<path d="M0 160 C50 150 80 120 120 126 S190 80 240 92 S320 130 370 70 S470 40 554 30 L554 210 L0 210Z" fill="url(#a)"/>
<path d="M0 160 C50 150 80 120 120 126 S190 80 240 92 S320 130 370 70 S470 40 554 30" fill="none" stroke="#7c3aed" stroke-width="3.5" stroke-linecap="round"/></svg></div>
<div class="card" style="left:832px;top:212px;width:342px;height:272px"><div class="abs k" style="left:20px;top:16px">Plans</div>
<svg class="abs" style="left:24px;top:46px" width="150" height="150" viewBox="0 0 42 42"><circle cx="21" cy="21" r="15.9" fill="none" stroke="#eef1f7" stroke-width="6"/>
<circle cx="21" cy="21" r="15.9" fill="none" stroke="#7c3aed" stroke-width="6" stroke-dasharray="52 48" transform="rotate(-90 21 21)"/>
<circle cx="21" cy="21" r="15.9" fill="none" stroke="#38bdf8" stroke-width="6" stroke-dasharray="28 72" stroke-dashoffset="-52" transform="rotate(-90 21 21)"/>
<circle cx="21" cy="21" r="15.9" fill="none" stroke="#f59e0b" stroke-width="6" stroke-dasharray="14 86" stroke-dashoffset="-80" transform="rotate(-90 21 21)"/></svg>
${[['Business', '#7c3aed', '52%'], ['Starter', '#38bdf8', '28%'], ['Enterprise', '#f59e0b', '14%']].map((p, i) => `<div class="abs" style="left:196px;top:${74 + i * 36}px;font-size:13px;font-weight:600"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${p[1]};margin-right:8px"></span>${p[0]} <b style="color:#7a869f;margin-left:6px">${p[2]}</b></div>`).join('')}</div>
<div class="card" style="left:214px;top:508px;width:960px;height:222px"><div class="abs k" style="left:24px;top:14px">Recent customers</div>
<div style="position:absolute;left:0;right:0;top:36px;height:186px">
${PEOPLE.map((p, i) => `<div class="row" style="top:${i * 46 + 2}px"><span style="left:24px;font-weight:700">${p[0]}</span><span style="left:256px;color:#41506e">${p[1]}</span><span style="left:560px"><b class="pill" style="background:${p[2] === 'Enterprise' ? '#fff3dc;color:#b7791f' : p[2] === 'Business' ? '#efe9ff;color:#6d28d9' : '#e3f4ff;color:#0369a1'}">${p[2]}</b></span><span style="left:700px;color:${p[3] === 'Active' ? '#12a05c' : '#b7791f'};font-weight:700">● ${p[3]}</span><span style="left:860px;font-weight:700">${p[4]}</span></div>`).join('')}</div></div>`;

async function dashboardShot() {
  const p = await browser.newPage();
  await p.setViewport({ width: PAGE_W, height: PAGE_H, deviceScaleFactor: 2 });
  await p.setContent(dashboardHtml());
  await sleep(300);
  const buf = await p.screenshot({ type: 'png' });
  await p.close();
  return 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
}
// "photo" for the layers shot: a generated sunset landscape (no stock images, no licences)
const photoHtml = () => `<!doctype html><meta charset=utf-8><body style="margin:0;width:900px;height:600px;overflow:hidden;background:linear-gradient(#1b1464,#7c3aed 38%,#f97316 70%,#fde68a)">
<div style="position:absolute;left:560px;top:230px;width:150px;height:150px;border-radius:50%;background:radial-gradient(#fff7d6,#ffd36e 55%,#ff9b3d);box-shadow:0 0 120px 40px rgba(255,190,90,.55)"></div>
<svg width="900" height="600" style="position:absolute;inset:0"><path d="M0 430 L140 330 L260 410 L420 280 L560 400 L700 320 L900 440 L900 600 L0 600Z" fill="#2a1659"/><path d="M0 500 L180 420 L330 480 L520 400 L720 490 L900 430 L900 600 L0 600Z" fill="#150b33"/></svg></body>`;
async function photoShot() {
  const p = await browser.newPage();
  await p.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
  await p.setContent(photoHtml());
  const buf = await p.screenshot({ type: 'png' });
  await p.close();
  return 'data:image/png;base64,' + Buffer.from(buf).toString('base64');
}

// ── driving the real Studio ─────────────────────────────────────────────────
async function openStudio(theme, br = browser) {
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((theme) => {
    window.chrome = { storage: { local: { get: (k, cb) => cb && cb({ theme }), set: () => {} } }, runtime: { sendMessage: (m, cb) => cb && cb(null) } };
  }, theme);
  await page.goto(`${base}/studio.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.studio);
  const ctl = {
    page,
    ev: (fn, ...a) => page.evaluate(fn, ...a),
    // page (artboard) coordinates in the 1200x750 design -> artboard px (the dashboard is captured at 2x)
    at: async (x, y, k = 2) => page.evaluate((x, y) => {
      const r = window.studio.stage.canvas.getBoundingClientRect(); const s = window.studio.stage.vp.toScreen({ x, y });
      return { x: r.left + s.x, y: r.top + s.y };
    }, x * k, y * k),
  };
  ctl.drag = async (a, b, steps = 10) => {
    const p = await ctl.at(...a), q = await ctl.at(...b);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(p.x + ((q.x - p.x) * i) / steps, p.y + ((q.y - p.y) * i) / steps);
    await page.mouse.up();
  };
  ctl.click = async (x, y) => { const p = await ctl.at(x, y); await page.mouse.click(p.x, p.y); };
  ctl.tool = async (k, id) => {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press(k);
      if (await page.waitForFunction((id) => window.studio.stage.tool === id, { timeout: 600 }, id).then(() => true, () => false)) return;
    }
  };
  ctl.style = (o) => page.evaluate((o) => Object.assign(window.studio.style, o), o);
  ctl.place = async (dataUrl, name, trim = false) => {
    await page.evaluate(async (d, n, t) => { const i = new Image(); i.src = d; await i.decode(); window.studio.placeImage(i, n, { trim: t }); window.studio.editor.select([]); window.studio.stage.fit(); }, dataUrl, name, trim);
    await sleep(150);
  };
  ctl.type = async (text) => { await page.keyboard.type(text, { delay: 12 }); await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control'); };
  ctl.caption = (title, sub) => NO_CAPTION ? Promise.resolve() : page.evaluate((title, sub, mark, font) => {
    document.getElementById('cap')?.remove();
    const d = document.createElement('div'); d.id = 'cap';
    d.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:92px;display:flex;align-items:center;justify-content:space-between;padding:0 34px;background:linear-gradient(100deg,#4c1d95,#7c3aed 58%,#a78bfa);color:#fff;font-family:${font};z-index:99999;box-shadow:0 -10px 36px rgba(30,10,80,.38)`;
    d.innerHTML = `<div><div style="font:800 31px/1.1 ${font};letter-spacing:-.6px">${title}</div><div style="font:500 16px/1.3 ${font};opacity:.9;margin-top:6px">${sub}</div></div><div style="display:flex;align-items:center;gap:12px;font:800 20px ${font};letter-spacing:-.3px">${mark}<span>Snipwise Studio</span></div>`;
    document.body.append(d);
  }, title, sub, MARK(46), FONT);
  ctl.snap = async (name) => { await page.evaluate(() => { const t = document.getElementById('statusText'); if (t) t.textContent = 'Ready'; }); await sleep(350); const buf = await page.screenshot({ type: 'png' }); await finish(Buffer.from(buf), 1280, 800, name); return buf; };
  return ctl;
}

const dashboard = await dashboardShot();
const photo = await photoShot();
const ORANGE = '#f97316', PURPLE = '#7c3aed', DEEP = '#5b21b6';
let rawUi = null;

// nudge the view so the artboard sits centred in the area above the caption band
const centre = (s) => s.ev(() => { const st = window.studio.stage; st.vp.panBy(0, -32); st.zoomBy(1); });
// readable callouts: white text on deep purple
const styleCallouts = (s) => s.ev((deep) => {
  const { editor } = window.studio;
  for (const l of editor.page.layers) if (l.type === 'callout') editor.patchLayer(l.id, { fill: deep, color: '#ffffff' }, 'style');
}, DEEP);
const selectLast = (s, type) => s.ev((type) => { const { editor } = window.studio; const l = [...editor.page.layers].reverse().find((x) => x.type === type); if (l) editor.select([l.id]); }, type);

// 1 ── capture & edit overview ───────────────────────────────────────────────
{
  const s = await openStudio('light');
  await s.place(dashboard, 'Screenshot');
  await s.style({ strokeWidth: 10, radius: 26, fill: null, color: PURPLE });
  await s.tool('r', 'rect'); await s.drag([706, 96], [928, 188]);
  await s.style({ color: ORANGE, strokeWidth: 11 });
  await s.tool('a', 'arrow'); await s.drag([760, 330], [812, 196]);
  await s.tool('o', 'callout'); await s.click(560, 330); await s.type('Conversion is up 12% 🎉');
  await styleCallouts(s);
  await s.style({ color: PURPLE });
  await s.tool('n', 'step'); await s.click(198, 106); await s.click(204, 214);
  await s.ev(() => window.studio.editor.select([]));
  await s.tool('v', 'select');
  await centre(s);
  await sleep(300);
  rawUi = Buffer.from(await s.page.screenshot({ type: 'png' })); // no caption: used for the marquee tile
  await s.caption('Capture any page. Edit it like a pro.', 'Annotate, retouch and export — right in your browser.');
  await s.snap('screenshot-1-capture-and-edit.png');
  await s.page.close();
}

// 2 ── annotation tools ──────────────────────────────────────────────────────
{
  const s = await openStudio('light');
  await s.place(dashboard, 'Screenshot');
  await s.ev(() => { window.studio.style.highlight = '#facc15'; });
  await s.tool('y', 'highlight'); await s.drag([234, 164], [338, 164], 8);
  await s.style({ color: PURPLE, strokeWidth: 10, radius: 26, fill: null });
  await s.tool('c', 'ellipse'); await s.drag([360, 262], [700, 420]);
  await s.style({ color: ORANGE, strokeWidth: 11 });
  await s.tool('o', 'callout'); await s.click(236, 440); await s.type('Peak month — worth a call-out');
  await styleCallouts(s);
  await s.tool('a', 'arrow'); await s.drag([420, 428], [470, 392]);
  await s.style({ color: PURPLE });
  await s.tool('n', 'step');
  for (const [x, y] of [[198, 106], [204, 214], [826, 214]]) await s.click(x, y);
  await selectLast(s, 'callout');
  await s.tool('v', 'select');
  await centre(s);
  await s.caption('Annotate with arrows, callouts & numbered steps', 'Text, shapes, highlighter, pen, emoji — every mark is an editable layer.');
  await s.snap('screenshot-2-annotate.png');
  await s.page.close();
}

// 3 ── privacy: blur / pixelate / redact ─────────────────────────────────────
{
  const s = await openStudio('light');
  await s.place(dashboard, 'Screenshot');
  await s.style({ blurAmount: 16 });
  const rowsY = [569, 615, 661];
  const modes = ['pixelate', 'blur', 'redact'];
  for (let i = 0; i < 3; i++) {
    await s.ev((m) => { window.studio.style.blurMode = m; }, modes[i]);
    await s.tool('u', 'blur');
    await s.drag([462, rowsY[i] - 14], [716, rowsY[i] + 14]);
  }
  await s.ev(() => { const { editor } = window.studio; editor.patchLayer(editor.page.layers.at(-1).id, { color: '#172033' }, 'cover'); });
  await s.style({ color: PURPLE, strokeWidth: 9 });
  await s.tool('o', 'callout'); await s.click(560, 420); await s.type('Emails hidden before sharing');
  await styleCallouts(s);
  await s.style({ color: ORANGE, strokeWidth: 11 });
  await s.tool('a', 'arrow'); await s.drag([640, 458], [600, 540]);
  await s.ev(() => { const { editor } = window.studio; editor.select([editor.page.layers.find((l) => l.type === 'blur').id]); });
  await s.tool('v', 'select');
  await centre(s);
  await s.caption('Hide private details before you share', 'Blur, pixelate or redact — non-destructive, so you can always undo.');
  await s.snap('screenshot-3-privacy.png');
  await s.page.close();
}

// 4 ── layers, masks & effects (dark theme) ──────────────────────────────────
{
  const s = await openStudio('dark');
  await s.ev(() => window.studio.newCanvas({ width: 2400, height: 1500, background: '#1b1236' }));
  await s.place(photo, 'Sunset photo');
  await s.ev(() => {
    const { editor } = window.studio; const l = editor.page.layers.at(-1);
    editor.select([l.id]);
    editor.patchLayer(l.id, { fx: { shadow: { color: '#000000', blur: 100, x: 0, y: 50, opacity: 0.6 } } }, 'fx');
    editor.addMask(l.id, 'reveal');
  });
  // fade the bottom of the photo into the background by erasing the mask with a very soft brush
  await s.style({ brushSize: 560, brushHardness: 0, brushOpacity: 1 });
  await s.tool('e', 'eraser');
  await s.drag([420, 690], [780, 690], 16);
  await s.ev(() => window.studio.editor.setMaskEdit(false));
  await s.ev(() => window.studio.editor.select([]));
  await s.tool('t', 'text');
  await s.click(176, 470); await s.type('Golden hour');
  await s.ev(() => {
    const { editor } = window.studio; const t = editor.page.layers.at(-1);
    editor.patchLayer(t.id, { fontSize: 150, fontWeight: 800, color: '#ffffff', fx: { shadow: { color: '#000000', blur: 36, x: 0, y: 12, opacity: 0.55 } } }, 'title');
  });
  await s.ev(() => window.studio.editor.select([]));
  await s.tool('v', 'select');
  await s.page.click('button[title^="New adjustment"]');
  await s.ev(() => { const { editor } = window.studio; const l = editor.primary; editor.patchLayer(l.id, { adjust: { ...l.adjust, saturation: 26, contrast: 10, brightness: 3, sepia: 10 } }, 'warm'); });
  await s.ev(() => window.studio.editor.select([]));
  await centre(s);
  await s.caption('Layers, masks, shadows & adjustments', 'Non-destructive effects, blend modes and adjustment layers — like a real photo editor.');
  await s.snap('screenshot-4-layers-effects.png');
  await s.page.close();
}

// 5 ── export (PDF dialog with a live preview) ───────────────────────────────
// Headless Chrome cannot display its built-in PDF viewer, so the real PDF the dialog just built is rasterised
// with poppler's pdftoppm and shown in the preview pane (the same pages the viewer would show).
{
  const s = await openStudio('light');
  await s.place(dashboard, 'Screenshot');
  await s.style({ color: PURPLE, strokeWidth: 10, fill: null, radius: 26 });
  await s.tool('r', 'rect'); await s.drag([706, 96], [928, 188]);
  await s.ev(() => window.studio.editor.select([]));
  await s.page.click('#btnPdf');
  await s.page.waitForSelector('#pdfDialogOverlay .modal', { visible: true }).catch(() => {});
  await s.page.waitForFunction(() => { const f = document.getElementById('pdfPreviewFrame'); return f && f.src && f.src.startsWith('blob:'); }, { timeout: 10000 });
  await sleep(800);
  const b64 = await s.ev(async () => {
    const f = document.getElementById('pdfPreviewFrame');
    const bytes = new Uint8Array(await (await fetch(f.src.split('#')[0])).arrayBuffer());
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snipwise-pdf-'));
  fs.writeFileSync(path.join(tmp, 'export.pdf'), Buffer.from(b64, 'base64'));
  execFileSync('pdftoppm', ['-png', '-r', '130', '-f', '1', '-l', '2', path.join(tmp, 'export.pdf'), path.join(tmp, 'page')]);
  const pages = fs.readdirSync(tmp).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort()
    .map((f) => 'data:image/png;base64,' + fs.readFileSync(path.join(tmp, f)).toString('base64'));
  fs.rmSync(tmp, { recursive: true, force: true });
  await s.ev((pages) => {
    const frame = document.getElementById('pdfPreviewFrame');
    const box = frame.parentElement;
    frame.style.display = 'none';
    const view = document.createElement('div');
    view.style.cssText = 'position:absolute;inset:0;background:#282828;display:flex;align-items:center;justify-content:center;gap:22px;padding:22px;overflow:hidden';
    for (const src of pages) {
      const img = document.createElement('img'); img.src = src;
      img.style.cssText = 'height:100%;width:auto;max-width:48%;object-fit:contain;background:#fff;box-shadow:0 8px 28px rgba(0,0,0,.5)';
      view.append(img);
    }
    box.style.position = 'relative'; box.append(view);
  }, pages);
  await sleep(500);
  await s.caption('Export a PNG — or a polished PDF', 'Full-resolution PNG, copy to clipboard, or a multi-page PDF with a cover page.');
  await s.snap('screenshot-5-export.png');
  await s.page.close();
}

// ── promo tiles ─────────────────────────────────────────────────────────────
async function tile(w, h, html, name) {
  const p = await browser.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await p.setContent(html);
  await sleep(400);
  await finish(Buffer.from(await p.screenshot({ type: 'png' })), w, h, name);
  await p.close();
}
const uiB64 = 'data:image/png;base64,' + rawUi.toString('base64');
const chip = (css, inner) => `<div style="position:absolute;${css}">${inner}</div>`;
const arrowSvg = (c) => `<svg width="120" height="90" viewBox="0 0 120 90"><path d="M6 80 C30 50 60 28 100 16" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/><path d="M104 14 L80 8 M104 14 L94 36" stroke="${c}" stroke-width="9" stroke-linecap="round" fill="none"/></svg>`;
const step = (n, c = '#f97316') => `<div style="width:54px;height:54px;border-radius:50%;background:${c};color:#fff;font:800 28px/54px ${FONT};text-align:center;box-shadow:0 8px 22px rgba(0,0,0,.28)">${n}</div>`;
const bg = 'radial-gradient(900px 500px at 85% 10%,#a78bfa55,transparent 60%),linear-gradient(120deg,#3b0f8c,#6d28d9 55%,#8b5cf6)';

if (!NO_CAPTION) {
await tile(1400, 560, `<!doctype html><meta charset=utf-8><body style="margin:0;width:1400px;height:560px;overflow:hidden;position:relative;background:${bg};font-family:${FONT};color:#fff">
<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1.5px,transparent 1.5px);background-size:34px 34px;opacity:.6"></div>
<div style="position:absolute;left:84px;top:140px">${MARK(124)}</div>
<div style="position:absolute;left:84px;top:288px;font:800 66px/1 ${FONT};letter-spacing:-2px">Snipwise Studio</div>
<div style="position:absolute;left:88px;top:376px;font:600 32px/1.2 ${FONT};color:#e4d9ff;letter-spacing:-.3px">Capture. Edit. Export.</div>
<div style="position:absolute;left:700px;top:88px;width:860px;height:540px;border-radius:22px;overflow:hidden;transform:rotate(-4deg);box-shadow:0 40px 90px rgba(20,5,60,.55),0 0 0 1px rgba(255,255,255,.25)"><img src="${uiB64}" style="width:100%;display:block"></div>
${chip('left:628px;top:96px', step(1, '#f97316'))}${chip('left:1300px;top:440px', step(2, '#22d3ee'))}
${chip('left:606px;top:420px', arrowSvg('#fde047'))}
</body>`, 'promo-marquee-1400x560.png');

await tile(440, 280, `<!doctype html><meta charset=utf-8><body style="margin:0;width:440px;height:280px;overflow:hidden;position:relative;background:${bg};font-family:${FONT};color:#fff">
<div style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.12) 1.2px,transparent 1.2px);background-size:22px 22px;opacity:.6"></div>
<div style="position:absolute;left:50%;top:32px;transform:translateX(-50%)">${MARK(112)}</div>
<div style="position:absolute;left:0;right:0;top:166px;text-align:center;font:800 40px/1 ${FONT};letter-spacing:-1.4px">Snipwise Studio</div>
<div style="position:absolute;left:0;right:0;top:222px;text-align:center;font:600 18px/1 ${FONT};color:#e4d9ff;letter-spacing:.2px">Capture · Edit · Export</div>
${chip('left:46px;top:46px;transform:scale(.7);transform-origin:0 0', step(1))}${chip('right:46px;top:46px;transform:scale(.7);transform-origin:100% 0', step(2, '#22d3ee'))}
</body>`, 'promo-small-440x280.png');

}

await browser.close();
server.close();
