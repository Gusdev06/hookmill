// Aceite (b) do F1: tira print do <Player> da página de teste do web nos frames da fixture, no MESMO Chrome headless
// do render (video/node_modules/.remotion/chrome-headless-shell), viewport 1080x1920, deviceScaleFactor 1.
// Uso (de video/): node scripts/editor-f1/player-prints.mjs <url-da-pagina> [base]
//   ex.: node scripts/editor-f1/player-prints.mjs http://localhost:3000/dev/editor-f1 basePreto
// Saída: out/f1-player-<base>/<doc>-<frame>.png. Depois: python3 scripts/editor-f1/comparar.py out/f1-stills-<base> out/f1-player-<base>
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [url, BASE = 'basePreto'] = process.argv.slice(2);
if (!url) throw new Error('uso: player-prints.mjs <url-da-pagina> [base]');
const CHROME = path.join(raiz, 'node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const fx = JSON.parse(readFileSync(path.join(raiz, 'scripts/editor-f1/player-fixtures.json'), 'utf8'));
const chrome = spawn(process.env.CHROME ?? CHROME, ['--headless', '--remote-debugging-port=9339', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'f1-'))}`, 'about:blank'], { stdio: 'ignore' });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let alvos; for (let i = 0; i < 50; i++) { try { alvos = await (await fetch('http://127.0.0.1:9339/json')).json(); break; } catch { await espera(200); } }
const ws = new WebSocket(alvos.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
await cdp('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
const out = path.join(raiz, `out/f1-player-${BASE}`); mkdirSync(out, { recursive: true });
for (const nome of Object.keys(fx.docs)) {
  await cdp('Page.navigate', { url: `${url}?doc=${nome}&base=${BASE}` });
  for (let i = 0; i < 300; i++) { const r = await cdp('Runtime.evaluate', { expression: 'typeof window.irPara', returnByValue: true }); if (r.result.result.value === 'function') break; await espera(100); }
  const meta = (await cdp('Runtime.evaluate', { expression: 'window.meta', returnByValue: true })).result.result.value;
  for (const f of fx.frames) {
    const frame = f === 'ultimo' ? meta.durationInFrames - 1 : f;
    const r = await cdp('Runtime.evaluate', { expression: `window.irPara(${frame})`, awaitPromise: true, returnByValue: true });
    const shot = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } });
    writeFileSync(path.join(out, `${nome}-${f}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log(nome, f, 'frame', r.result?.result?.value, r.result?.exceptionDetails?.text ?? '');
  }
}
ws.close(); chrome.kill();
