// Aceite do vídeo do cliente no editor universal (F-U2, editor-universal-v1 §5 e §12). Mídia local; nada pago.
// Uso (de video/): node scripts/editor-universal/aceite-video.mjs [stills|player|trim|tudo]
//  stills: renderStill dos docs de teste + folha out/editor-u2/folha-video.png
//  player: renderStill × print do <Player> (mesmo Chrome do render, página própria, sem o web) nos mesmos docs/quadros, com uma grade cinza
//          parada no lugar do vídeo; compara com scripts/editor-f1/comparar.py
//  trim:   render H.264 com aparar: nb_frames = corte, áudio do tamanho do corte, quadro N do aparado = quadro N+in do inteiro
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { buildSync } from 'esbuild';
import sharp from 'sharp';
import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modo = process.argv[2] ?? 'tudo';
const out = path.join(raiz, 'out/editor-u2');
mkdirSync(out, { recursive: true });
const req = createRequire(import.meta.url);
const js = path.join(out, 'lib.cjs');
buildSync({ stdin: { contents: "export * from './src/lib/index'; export * from './scripts/editor-universal/casos'; export { demoProps } from './src/molduras/demo';", resolveDir: raiz, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: js, logLevel: 'warning' });
const L = req(js);
const v3 = (video) => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [], video: { layerId: 'video', ...video } });
const CASOS = [
  ['question-zoom', 'Moldura', L.demoProps('question_box'), v3({ framing: { fit: 'cover', zoom: 1.6, panX: 0.05, panY: -0.04 } })],
  ['news-caixa-trim', 'Moldura', L.demoProps('news'), v3({ box: { x: 0.2, y: 0.3, w: 0.6, h: 0.4 }, trim: { inSec: 2, outSec: 6 } })],
  ['postcard-caixa', 'Moldura', L.demoProps('post_card'), v3({ box: { x: 0.05, y: 0.6, w: 0.5, h: 0.3 } })],
  ['split-caber', 'Moldura', L.demoProps('split_stack'), v3({ framing: { fit: 'contain_blur', zoom: 1, panX: 0, panY: 0 } })],
  ['cinema-caixa', 'Moldura', L.demoProps('cinema'), v3({ box: { x: 0.25, y: 0.2, w: 0.5, h: 0.3 } })],
  ['offer-caixa', 'Moldura', L.demoProps('direct_offer'), v3({ box: { x: 0.1, y: 0.05, w: 0.8, h: 0.45 } })],
  ['call-caixa', 'Moldura', L.demoProps('call_dialog'), v3({ box: { x: 0.05, y: 0.55, w: 0.45, h: 0.3 } })],
  ['headline-caixa-zoom-trim', 'RemixKeep', L.HEADLINE_ADD, v3({ box: { x: 0, y: 0.3, w: 1, h: 0.55 }, framing: { fit: 'cover', zoom: 1.3, panX: 0, panY: 0 }, trim: { inSec: 1, outSec: 4 } })],
  ['headline-caber', 'RemixKeep', L.HEADLINE_ADD, v3({ framing: { fit: 'contain_blur', zoom: 0.7, panX: 0, panY: 0 } })],
];
const resolvidos = CASOS.map(([nome, comp, base, doc]) => {
  const fmt = '9x16';
  const r = comp === 'Moldura' ? L.resolverPropsMoldura(base, doc, { format: fmt }) : L.resolverPropsHeadline(base, doc, { format: fmt });
  const erros = comp === 'Moldura' ? L.validarDocMoldura(doc, base) : L.validarDocHeadline(doc, base);
  if (erros.length) throw new Error(`${nome}: ${JSON.stringify(erros)}`);
  return { nome, comp, base, props: r.props, layout: r.layout };
});
const QUADROS = [20, 50];
const PORTA = 3031;
let serveUrl = null;
const servir = async () => (serveUrl ??= await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public'), outDir: path.join(out, 'bundle') }));

async function stills() {
  const url = await servir();
  const pasta = path.join(out, 'stills'); mkdirSync(pasta, { recursive: true });
  const itens = [];
  for (const c of resolvidos) {
    const composition = await selectComposition({ port: PORTA, serveUrl: url, id: c.comp, inputProps: c.props });
    for (const f of QUADROS) {
      const file = path.join(pasta, `${c.nome}-${f}.png`);
      await renderStill({ port: PORTA, serveUrl: url, composition, inputProps: c.props, frame: f, output: file, imageFormat: 'png' });
      if (f === QUADROS[0]) itens.push({ file, label: c.nome });
    }
    console.log(c.nome, composition.durationInFrames, 'quadros');
  }
  const cw = 270, ch = 480, lab = 34, cols = 5, comps = [];
  for (const [k, i] of itens.entries()) {
    const x = (k % cols) * cw, y = Math.floor(k / cols) * (ch + lab);
    comps.push({ input: await sharp(i.file).resize(cw, ch, { fit: 'contain', background: '#111' }).toBuffer(), left: x, top: y });
    comps.push({ input: Buffer.from(`<svg width="${cw}" height="${lab}"><rect width="100%" height="100%" fill="#111"/><text x="${cw / 2}" y="23" font-family="Helvetica" font-size="15" font-weight="700" fill="#fff" text-anchor="middle">${i.label}</text></svg>`), left: x, top: y + ch });
  }
  await sharp({ create: { width: cols * cw, height: Math.ceil(itens.length / cols) * (ch + lab), channels: 3, background: '#111' } }).composite(comps).png().toFile(path.join(out, 'folha-video.png'));
  console.log('folha', path.join(out, 'folha-video.png'));
}

/** Mídia de geometria: grade PARADA (o tempo do decode do navegador × do render não entra na comparação; o tempo é conferido por video.currentTime). */
const grade = path.join(out, 'grade.mp4');
const comGrade = (props) => JSON.parse(JSON.stringify(props).replace(/fixtures\/[\w-]+\.mp4/g, 'http://127.0.0.1:3032/grade.mp4'));

async function player() {
  if (!existsSync(grade)) {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x606060:s=960x960:r=24:d=32,drawgrid=w=120:h=120:t=8:c=0xE0E0E0,drawbox=x=420:y=420:w=120:h=120:c=0x202020:t=fill,format=gray',
      '-c:v', 'libx264', '-g', '24', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', grade]);
  }
  // CONTROLE=1: a mesma comparação sem doc (o que já separa Player de render hoje, antes de qualquer edição)
  const CTRL = process.env.CONTROLE ? '-controle' : '';
  const propsGrade = resolvidos.map((c) => ({ ...c, props: comGrade(CTRL ? c.base : c.props) }));
  const pagina = path.join(out, 'player-pagina.js');
  writeFileSync(path.join(out, 'props.json'), JSON.stringify(Object.fromEntries(propsGrade.map((c) => [c.nome, { comp: c.comp, props: c.props }]))));
  buildSync({
    stdin: { contents: `
      import React, { useRef, useEffect } from 'react';
      import { createRoot } from 'react-dom/client';
      import { Player } from '@remotion/player';
      import { Moldura, RemixKeep, metadadosMoldura, metadadosRemix, carregarFontes } from './src/player';
      import dados from './out/editor-u2/props.json';
      const q = new URLSearchParams(location.search).get('caso');
      const c = dados[q];
      const meta = c.comp === 'Moldura' ? metadadosMoldura(c.props) : metadadosRemix(c.props);
      const App = () => {
        const ref = useRef(null);
        useEffect(() => {
          window.irPara = async (f) => {
            ref.current.seekTo(f);
            await document.fonts.ready;
            await new Promise((r) => setTimeout(r, 500));
            for (let i = 0; i < 80; i++) {
              const vs = [...document.querySelectorAll('video')];
              if (vs.every((v) => v.readyState >= 2 && !v.seeking)) break;
              await new Promise((r) => setTimeout(r, 100));
            }
            await new Promise((r) => setTimeout(r, 700));
            window.ultimoTempo = [...document.querySelectorAll('video')].map((v) => v.currentTime);
            return ref.current.getCurrentFrame();
          };
        }, []);
        return <Player ref={ref} component={c.comp === 'Moldura' ? Moldura : RemixKeep} inputProps={c.props} {...meta} style={{ width: meta.compositionWidth, height: meta.compositionHeight }} acknowledgeRemotionLicense />;
      };
      carregarFontes().then(() => createRoot(document.getElementById('r')).render(<App />));
    `, resolveDir: raiz, loader: 'tsx' },
    bundle: true, platform: 'browser', format: 'iife', outfile: pagina, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning', jsx: 'automatic',
  });
  const srv = http.createServer((a, b) => {
    const u = decodeURIComponent(a.url.split('?')[0]);
    if (u === '/') { b.setHeader('content-type', 'text/html'); b.end('<!doctype html><html><body style="margin:0;background:#000"><div id="r"></div><script src="/pagina.js"></script></body></html>'); return; }
    if (u === '/pagina.js') { createReadStream(pagina).pipe(b); return; }
    b.setHeader('access-control-allow-origin', '*');
    const f = u === '/grade.mp4' ? grade : path.join(raiz, 'public', u);
    if (!existsSync(f)) { b.statusCode = 404; b.end(); return; }
    const size = statSync(f).size;
    b.setHeader('accept-ranges', 'bytes');
    const rg = /bytes=(\d+)-(\d*)/.exec(a.headers.range ?? '');
    if (f.endsWith('.mp4')) b.setHeader('content-type', 'video/mp4');
    if (rg) {
      const s = Number(rg[1]), e = rg[2] ? Number(rg[2]) : size - 1;
      b.statusCode = 206; b.setHeader('content-range', `bytes ${s}-${e}/${size}`); b.setHeader('content-length', e - s + 1);
      createReadStream(f, { start: s, end: e }).pipe(b);
    } else { b.setHeader('content-length', size); createReadStream(f).pipe(b); }
  });
  await new Promise((r) => srv.listen(3032, r));
  const url = await servir();
  const stillsGrade = path.join(out, `stills-grade${CTRL}`); mkdirSync(stillsGrade, { recursive: true });
  for (const c of propsGrade) {
    const composition = await selectComposition({ port: PORTA, serveUrl: url, id: c.comp, inputProps: c.props });
    for (const f of QUADROS) await renderStill({ port: PORTA, serveUrl: url, composition, inputProps: c.props, frame: f, output: path.join(stillsGrade, `${c.nome}-${f}.png`), imageFormat: 'png' });
  }
  const CHROME = path.join(raiz, '../node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell');
  const bin = process.env.CHROME ?? (existsSync(CHROME) ? CHROME : path.join(raiz, 'node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell'));
  const chrome = spawn(bin, ['--headless', '--remote-debugging-port=9341', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--user-data-dir=${mkdtempSync(path.join(os.tmpdir(), 'u2-'))}`, 'about:blank'], { stdio: 'ignore' });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  let alvos; for (let i = 0; i < 50; i++) { try { alvos = await (await fetch('http://127.0.0.1:9341/json')).json(); break; } catch { await espera(200); } }
  const ws = new WebSocket(alvos.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const cdp = (method, params = {}) => new Promise((ok) => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
  const pasta = path.join(out, `player-grade${CTRL}`); mkdirSync(pasta, { recursive: true });
  for (const c of resolvidos) {
    await cdp('Page.navigate', { url: `http://127.0.0.1:3032/?caso=${c.nome}` });
    for (let i = 0; i < 300; i++) { const r = await cdp('Runtime.evaluate', { expression: 'typeof window.irPara', returnByValue: true }); if (r.result.result.value === 'function') break; await espera(100); }
    for (const f of QUADROS) {
      const r = await cdp('Runtime.evaluate', { expression: `window.irPara(${f})`, awaitPromise: true, returnByValue: true });
      const shot = await cdp('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } });
      writeFileSync(path.join(pasta, `${c.nome}-${f}.png`), Buffer.from(shot.result.data, 'base64'));
      const tempos = await cdp('Runtime.evaluate', { expression: 'window.ultimoTempo', returnByValue: true });
      console.log(c.nome, f, 'quadro', r.result?.result?.value, 'video.currentTime', JSON.stringify(tempos.result?.result?.value), r.result?.exceptionDetails?.text ?? '');
    }
  }
  ws.close(); chrome.kill(); srv.close();
  try { console.log(execFileSync('python3', [path.join(raiz, 'scripts/editor-f1/comparar.py'), stillsGrade, pasta], { encoding: 'utf8' })); } catch (e) { console.log(e.stdout); process.exitCode = 1; }
}

async function trim() {
  const url = await servir();
  const base = L.demoProps('question_box');
  const manual = { fit: 'cover', zoom: 1, panX: 0, panY: 0 };
  const inteiro = L.resolverPropsMoldura(base, v3({ framing: manual }), { format: '9x16' }).props;
  const aparado = L.resolverPropsMoldura(base, v3({ framing: manual, trim: { inSec: 2, outSec: 5 } }), { format: '9x16' }).props;
  const composition = await selectComposition({ port: PORTA, serveUrl: url, id: 'Moldura', inputProps: aparado });
  const mp4 = path.join(out, 'trim.mp4');
  await renderMedia({ port: PORTA, serveUrl: url, composition, inputProps: aparado, codec: 'h264', outputLocation: mp4, imageFormat: 'jpeg', jpegQuality: 90 });
  const sonda = (a) => execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,nb_read_packets,duration', '-of', 'json', a], { encoding: 'utf8' });
  const st = JSON.parse(sonda(mp4)).streams;
  const v = st.find((x) => x.codec_type === 'video'), a = st.find((x) => x.codec_type === 'audio');
  console.log(`trim 2-5 s: ${v.nb_read_packets} quadros de vídeo (esperado 90), áudio ${a?.duration} s`);
  if (Number(v.nb_read_packets) !== 90) throw new Error('nb_frames errado');
  // o quadro 30 do aparado (2 + 1 s do arquivo) = o quadro 90 do inteiro, na parte do vídeo acima do cartão de texto
  const compI = await selectComposition({ port: PORTA, serveUrl: url, id: 'Moldura', inputProps: inteiro });
  const fa = path.join(out, 'trim-a.png'), fb = path.join(out, 'trim-b.png');
  await renderStill({ port: PORTA, serveUrl: url, composition, inputProps: aparado, frame: 30, output: fa, imageFormat: 'png' });
  await renderStill({ port: PORTA, serveUrl: url, composition: compI, inputProps: inteiro, frame: 90, output: fb, imageFormat: 'png' });
  const raw = async (f) => (await sharp(f).extract({ left: 0, top: 0, width: 1080, height: 700 }).removeAlpha().raw().toBuffer());
  const [x, y] = await Promise.all([raw(fa), raw(fb)]);
  let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - y[i]));
  console.log(`quadro 30 aparado × quadro 90 inteiro: diferença máxima ${m} níveis`);
  if (m > 2) throw new Error('aparar não desloca o vídeo');
  // HEADLINE: RemixKeep aparado (sai mudo; áudio e base entram no comporSobreOCampeao, coberto em api/src/render/posprocesso.spec.ts)
  const hApar = L.resolverPropsHeadline(L.HEADLINE_ADD, v3({ trim: { inSec: 1, outSec: 4 } }), { format: '9x16' }).props;
  const cH = await selectComposition({ port: PORTA, serveUrl: url, id: 'RemixKeep', inputProps: hApar });
  const mH = path.join(out, 'trim-headline.mp4');
  await renderMedia({ port: PORTA, serveUrl: url, composition: cH, inputProps: hApar, codec: 'h264', muted: true, outputLocation: mH, imageFormat: 'png' });
  const nH = JSON.parse(sonda(mH)).streams.find((x) => x.codec_type === 'video').nb_read_packets;
  console.log(`HEADLINE trim 1-4 s: ${nH} quadros (esperado 72)`);
  if (Number(nH) !== 72) throw new Error('nb_frames errado na HEADLINE');
  const cI = await selectComposition({ port: PORTA, serveUrl: url, id: 'RemixKeep', inputProps: L.HEADLINE_ADD });
  const ha = path.join(out, 'trim-h-a.png'), hb = path.join(out, 'trim-h-b.png');
  await renderStill({ port: PORTA, serveUrl: url, composition: cH, inputProps: hApar, frame: 10, output: ha, imageFormat: 'png' });
  await renderStill({ port: PORTA, serveUrl: url, composition: cI, inputProps: L.HEADLINE_ADD, frame: 34, output: hb, imageFormat: 'png' });
  const topo = async (f) => (await sharp(f).extract({ left: 0, top: 500, width: 1080, height: 800 }).removeAlpha().raw().toBuffer());
  const [hx, hy] = await Promise.all([topo(ha), topo(hb)]);
  let mh = 0; for (let i = 0; i < hx.length; i++) mh = Math.max(mh, Math.abs(hx[i] - hy[i]));
  console.log(`HEADLINE quadro 10 aparado × quadro 34 inteiro: diferença máxima ${mh} níveis`);
  if (mh > 2) throw new Error('aparar não desloca o vídeo na HEADLINE');
}

if (modo === 'stills' || modo === 'tudo') await stills();
if (modo === 'player' || modo === 'tudo') await player();
if (modo === 'trim' || modo === 'tudo') await trim();
rmSync(path.join(out, 'props.json'), { force: true });
