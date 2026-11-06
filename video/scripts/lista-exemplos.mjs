// Exemplos dos templates de lista (templates-lista-v1, 04/11): Versus e Value stack com o avatar Pocketwise e os tempos REAIS
// palavra a palavra (mlx-whisper local, scripts/lista-exemplos-palavras.json). Monta as props com as funções do lib
// (agendaLista → posicionarLista → medirLista), confere o painel (checarLegendaProtegida) e renderiza na composição
// `Template`. Mídia local, nada pago. O avatar precisa estar em public/fixtures/avatar-pocketwise.mp4 (fora do git).
// Uso: node scripts/lista-exemplos.mjs [saida-dir] [stills]
//   sem `stills`: MP4 9:16 dos dois (tempo e memória) · com `stills`: só quadros 9:16/4:5/1:1 pra folha
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.resolve(process.argv[2] ?? path.join(raiz, 'out', 'lista-2026-11-04'));
const soStills = process.argv[3] === 'stills';
mkdirSync(saida, { recursive: true });

// lib em TS → ESM temporário (o lib não tem dependência de React)
const libJs = path.join(tmpdir(), `maquina-lista-lib-${process.pid}.mjs`);
await build({ entryPoints: [path.join(raiz, 'src', 'lib', 'index.ts')], bundle: true, platform: 'node', format: 'esm', outfile: libJs, logLevel: 'error' });
const L = await import(pathToFileURL(libJs).href);

const palavras = JSON.parse(readFileSync(path.join(raiz, 'scripts', 'lista-exemplos-palavras.json'), 'utf8'));
const source = { videoUrl: 'fixtures/avatar-pocketwise.mp4', width: 464, height: 832, fps: 25, durationSec: 19.68 };
// rosto (testa ao queixo, com cabelo), medido nos quadros 2/9/15 s; sem legenda queimada no avatar
const faceSafeBand = { x: 142, y: 125, w: 206, h: 344 };
const protectedBands = [];
const brand = { name: 'Pocketwise', handle: '@pocketwise', initials: 'PW', color: '#3B5BFF' };
const idx = (w) => { const i = palavras.findIndex((x) => x.word.replace(/[^a-z0-9']/gi, '').toLowerCase() === w); if (i < 0) throw new Error(w); return i; };

// linhas como o plano da IA escreveria (âncora = palavra da fala; sem âncora = Brain)
const LISTAS = {
  versus: {
    heads: { bad: 'Other apps', good: 'Pocketwise' }, title: null, order: 'by_speech',
    lines: [
      { id: 'l1', side: 'bad', kind: 'item', text: 'Tried every budget app', anchor: idx('tried') },
      { id: 'l2', side: 'bad', kind: 'item', text: 'Quit all of them', anchor: idx('quit') },
      { id: 'l3', side: 'bad', kind: 'item', text: 'No idea where it went', anchor: null },
      { id: 'l4', side: 'good', kind: 'item', text: 'See where it all goes', anchor: idx('where') },
      { id: 'l5', side: 'good', kind: 'item', text: 'A check-in every day', anchor: palavras.findIndex((x, i) => i > idx('goes') && /^every/i.test(x.word)) },
      { id: 'l6', side: 'good', kind: 'item', text: '$400 saved in 3 weeks', anchor: idx('saved') },
    ],
  },
  'value-stack': {
    heads: null, title: 'What you get', order: 'by_speech',
    lines: [
      { id: 'l1', side: null, kind: 'item', text: 'See where every dollar goes', anchor: idx('where') },
      { id: 'l2', side: null, kind: 'item', text: 'A check-in every single day', anchor: palavras.findIndex((x, i) => i > idx('goes') && /^every/i.test(x.word)) },
      { id: 'l3', side: null, kind: 'proof', text: '$400 saved by week 3', anchor: idx('saved') },
      { id: 'l4', side: null, kind: 'price', text: '$4.99/mo after a 7-day free trial', anchor: null },
      { id: 'l5', side: null, kind: 'cta', text: "Link's right below", anchor: idx('links') },
    ],
  },
};

const montar = (templateId, format, columns = 2) => {
  const d = LISTAS[templateId];
  const mode = templateId === 'value-stack' ? 'stack' : format === 'SQUARE_1_1' || columns === 1 ? 'one-col' : 'two-col';
  const at = L.agendaLista(d.lines.map((l) => ({ anchorWordIndex: l.anchor, side: l.side })), palavras, source.durationSec, d.order);
  const lines0 = d.lines.map((l, k) => ({ id: l.id, side: l.side, kind: l.kind, text: l.text, atSec: at[k] }));
  const need = L.needLista(mode, L.linhasDoNeed(mode, lines0));
  const placement = L.posicionarLista({ format, source, faceSafeBand, protectedBands, need });
  if (placement.mode === 'none') throw new Error(`${templateId} ${format}: sem lugar (${placement.reason})`);
  const base = { mode, look: 'ink', brandColor: brand.color, source, guard: { faceSafeBand, protectedBands }, placement, heads: d.heads, title: d.title, lines: lines0, sfx: { pop: 'sfx/pop.wav', ding: 'sfx/ding.wav' } };
  const m = L.medirLista({ ...base, language: 'en' });
  if (m.overflow.length) throw new Error(`${templateId} ${format}: não coube ${m.overflow.join(', ')}`);
  const props = { ...base, lines: lines0.map((l, k) => ({ ...l, fit: m.lines[k] })) };
  const check = L.checarLegendaProtegida(props);
  if (!check.ok) throw new Error(`${templateId} ${format}: ${JSON.stringify(check.hits)}`);
  const { width, height } = L.FORMATOS[format];
  const input = {
    templateId, format, fps: 30, language: 'en', brand, palette: [], safeArea: { top: L.LISTA_UI[format].top, bottom: L.LISTA_UI[format].bottom },
    sfx: { pop: 'sfx/pop.wav', send: 'sfx/send.wav', ding: 'sfx/ding.wav' }, durationInFrames: Math.round(source.durationSec * 30), checkpoints: L.checkpointsLista(props), props,
  };
  L.propsDeTemplateInput(input);
  console.log(`${templateId} ${format} ${width}x${height}: ${placement.mode}/${placement.reason} painel ${JSON.stringify(placement.panel)} · tempos ${at.join(' ')} · fontes ${m.lines.map((f) => f.size).join('/')}`);
  return input;
};

const PORTA = 3021;
const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src', 'index.ts'), publicDir: path.join(raiz, 'public') });
const medidas = {};
for (const templateId of ['versus', 'value-stack']) {
  for (const format of soStills ? ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] : ['VERTICAL_9_16']) {
    const inputProps = montar(templateId, format);
    writeFileSync(path.join(saida, `${templateId}-${format}.props.json`), JSON.stringify(inputProps, null, 1));
    const composition = await selectComposition({ port: PORTA, serveUrl, id: 'Template', inputProps });
    if (soStills) {
      for (const s of [4.2, 10.5, 19.5]) {
        await renderStill({ port: PORTA, composition, serveUrl, inputProps, frame: Math.round(s * 30), imageFormat: 'png', output: path.join(saida, 'stills', `${templateId}-${format}-${s}.png`) });
      }
      continue;
    }
    const t0 = Date.now();
    let pico = 0;
    const amostra = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 250);
    await renderMedia({
      port: PORTA, composition, serveUrl, inputProps, codec: 'h264', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 90, concurrency: 1,
      offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, outputLocation: path.join(saida, `${templateId}.mp4`),
    });
    clearInterval(amostra);
    medidas[templateId] = { segundos: (Date.now() - t0) / 1000, rssNodeMB: Math.round(pico / 1e6), frames: composition.durationInFrames };
    console.log(templateId, medidas[templateId]);
  }
}
if (!soStills) writeFileSync(path.join(saida, 'medidas.json'), JSON.stringify(medidas, null, 2));
