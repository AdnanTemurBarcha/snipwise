// Exercises the crop-region content script (dist/content.js) in a real page with a stubbed chrome.* API.
// Usage: npm run build && node scripts/e2e-crop.mjs
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const DIST = path.resolve(import.meta.dirname, '../dist');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><body style="margin:0;height:3000px;background:linear-gradient(#cde,#fed)"><h1>Test page</h1></body>');
}).listen(0);
await new Promise((r) => server.once('listening', r));
const url = `http://localhost:${server.address().port}/`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1000, height: 700 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => {
  const listeners = new Set();
  window.__sent = [];
  window.__captureFails = 0; // how many captureTab calls should fail before one succeeds (Infinity = always)
  window.__captureCalls = 0;
  window.chrome = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) },
      sendMessage: (msg, cb) => {
        if (msg.action === 'captureTab') {
          window.__captureCalls++;
          const ok = window.__captureCalls > window.__captureFails;
          const c = document.createElement('canvas'); c.width = 1000; c.height = 700; c.getContext('2d').fillRect(0, 0, 1000, 700);
          setTimeout(() => cb && cb(ok ? c.toDataURL('image/png') : null), 5);
        } else window.__sent.push(msg);
      },
    },
  };
  window.__listenerCount = () => listeners.size;
  window.__dispatch = (msg) => { let r; listeners.forEach((f) => f(msg, {}, (v) => { r = v; })); return r; };
});

let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const inject = () => page.addScriptTag({ path: path.join(DIST, 'content.js') });
const overlay = () => page.evaluate(() => !!document.getElementById('__snipwise_overlay'));
const sent = () => page.evaluate(() => window.__sent.length);
const reset = () => page.evaluate(() => { window.__sent = []; window.__captureCalls = 0; window.__captureFails = 0; });
const waitSent = (n) => page.waitForFunction((n) => window.__sent.length >= n, { timeout: 6000 }, n).then(() => true, () => false);

await page.goto(url);
await inject(); await inject(); await inject();
check('injecting repeatedly keeps a single message listener', (await page.evaluate(() => window.__listenerCount())) === 1);
check('answers the popup\'s ping', (await page.evaluate(() => window.__dispatch({ action: 'ping' })))?.ok === true);
const ack = await page.evaluate(() => window.__dispatch({ action: 'crop' }));
check('crop request is acknowledged', ack?.ok === true);
check('crop overlay appears', await overlay());

// normal drag
await page.mouse.move(100, 120); await page.mouse.down(); await page.mouse.move(300, 260, { steps: 6 }); await page.mouse.up();
check('releasing inside removes the overlay', !(await overlay()));
check('a capture is delivered', await waitSent(1));
const dims = await page.evaluate(async () => {
  const i = new Image(); i.src = window.__sent[0].dataUrl; await i.decode(); return [i.width, i.height, window.__sent[0].action];
});
check('captured image has the dragged size', dims[0] === 200 && dims[1] === 140 && dims[2] === 'captureReady', dims.join('x'));

// retry after failures
await reset(); await page.evaluate(() => { window.__captureFails = 2; });
await page.evaluate(() => window.__dispatch({ action: 'crop' }));
await page.mouse.move(50, 50); await page.mouse.down(); await page.mouse.move(200, 150, { steps: 4 }); await page.mouse.up();
check('a failing screenshot call is retried until it works', await waitSent(1) && (await page.evaluate(() => window.__captureCalls)) === 3);

// release outside the window
await reset();
await page.evaluate(() => window.__dispatch({ action: 'crop' }));
await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(900, 600, { steps: 4 }); await page.mouse.move(1300, 900, { steps: 4 }); await page.mouse.up();
check('releasing the mouse outside the window still finishes the crop', !(await overlay()) && await waitSent(1));
const edge = await page.evaluate(async () => { const i = new Image(); i.src = window.__sent[0].dataUrl; await i.decode(); return [i.width, i.height]; });
check('the area is clamped to the page', edge[0] === 400 && edge[1] === 300, edge.join('x'));

// Esc after another key
await reset();
await page.evaluate(() => window.__dispatch({ action: 'crop' }));
await page.keyboard.press('Shift');
await page.keyboard.press('Escape');
check('Esc cancels even after another key was pressed', !(await overlay()));
await page.evaluate(() => window.__dispatch({ action: 'crop' }));
await page.mouse.move(200, 200); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up();
check('Esc during a drag cancels without capturing', !(await overlay()) && (await sent()) === 0);

// permanent failure
await reset(); await page.evaluate(() => { window.__captureFails = Infinity; });
await page.evaluate(() => window.__dispatch({ action: 'crop' }));
await page.mouse.move(100, 100); await page.mouse.down(); await page.mouse.move(260, 220, { steps: 4 }); await page.mouse.up();
await page.waitForFunction(() => [...document.querySelectorAll('div')].some((d) => /couldn't capture/.test(d.textContent)), { timeout: 9000 }).then(() => check('a failed capture tells the user instead of hanging', true), () => check('a failed capture tells the user instead of hanging', false));
check('overlay is gone after a failure', !(await overlay()));

// a tiny click does nothing
await reset();
await page.evaluate(() => window.__dispatch({ action: 'crop' }));
await page.mouse.click(300, 300);
check('a plain click closes the overlay without capturing', !(await overlay()) && (await sent()) === 0);

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll crop checks passed');
process.exit(failed ? 1 : 0);
