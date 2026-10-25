// Molduras de produção (src/molduras/): stills, prova contra o protótipo e contact sheets. Mídia local, nada pago.
// Uso: node scripts/molduras.mjs <modo> [filtro]
//   prova    -> stills 9:16 no frame 90 com o enquadramento do protótipo + diff contra out/prototipo-molduras-2026-10-25/stills
//   formatos -> stills dos 18 x 3 formatos (enquadramento do produto) + contact sheet por formato
//   extra    -> textos curto/médio/limite em pt/en/es (fitText) + sem faceTrack, num contact sheet
//   video    -> renderMedia de 1 template x 3 formatos (tempo e memória)
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modo = process.argv[2] ?? 'prova';
const filtro = process.argv[3] ?? '';
const saida = path.join(raiz, 'out', 'molduras-producao-2026-10-25');
const protoStills = path.join(raiz, 'out', 'prototipo-molduras-2026-10-25', 'stills');
const SLUGS = ['01-caixinha', '02-choquei', '03-meme', '04-cinema', '05-noticia', '06-tela-dividida', '07-tela-dividida-2', '08-google-meet', '09-meet-dialogo',
  '10-ranking', '11-tweet', '12-oferta-direta', '13-story', '14-leia-a-legenda', '15-pov-depoimento', '16-live', '17-fofoca-1', '18-fofoca-2'].filter((s) => s.includes(filtro));
const FMT = { '9x16': 'VERTICAL_9_16', '4x5': 'PORTRAIT_4_5', '1x1': 'SQUARE_1_1' };

// porta própria (3020+): a 3000/3001 é da API e do web em dev; o Remotion não pode ocupar
const PORTA = 3020;
const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src', 'index.ts'), publicDir: path.join(raiz, 'public') });

const still = async (id, out, frame = 90, inputProps) => {
  const composition = await selectComposition({ port: PORTA, serveUrl, id, inputProps });
  await renderStill({ port: PORTA, composition, serveUrl, output: out, frame, imageFormat: 'png', inputProps });
};

/** Folha: células com rótulo, `cols` colunas, cada célula com `cw` de largura. */
const folha = async (itens, out, { cols = 6, cw = 360 } = {}) => {
  const metas = await Promise.all(itens.map(async (i) => ({ ...i, m: await sharp(i.file).metadata() })));
  const ch = Math.round((cw * metas[0].m.height) / metas[0].m.width);
  const lab = 44;
  const linhas = Math.ceil(metas.length / cols);
  const W = cols * cw, H = linhas * (ch + lab);
  const comps = [];
  for (const [k, i] of metas.entries()) {
    const x = (k % cols) * cw, y = Math.floor(k / cols) * (ch + lab);
    comps.push({ input: await sharp(i.file).resize(cw, ch, { fit: 'contain', background: '#111' }).toBuffer(), left: x, top: y });
    const svg = `<svg width="${cw}" height="${lab}"><rect width="100%" height="100%" fill="#111"/><text x="${cw / 2}" y="30" font-family="Helvetica" font-weight="700" font-size="22" fill="#fff" text-anchor="middle">${i.label.replace(/&/g, '&amp;')}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + ch });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } }).composite(comps).png().toFile(out);
  console.log(`folha ${out}`);
};

/** Diferença por pixel (RGB) entre 2 PNGs do mesmo tamanho: média e % de pixels com diferença > 24 num canal. */
const diff = async (a, b, out) => {
  const [x, y] = await Promise.all([a, b].map((f) => sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width, height } = x.info;
  const d = Buffer.alloc(width * height * 3);
  let soma = 0, fora = 0;
  for (let i = 0; i < width * height; i++) {
    let mx = 0;
    for (let c = 0; c < 3; c++) { const v = Math.abs(x.data[i * 3 + c] - y.data[i * 3 + c]); soma += v; mx = Math.max(mx, v); }
    if (mx > 24) fora++;
    const g = Math.min(255, mx * 4);
    d[i * 3] = g; d[i * 3 + 1] = g; d[i * 3 + 2] = g;
  }
  if (out) await sharp(d, { raw: { width, height, channels: 3 } }).png().toFile(out);
  return { media: soma / (width * height * 3), pctFora: (100 * fora) / (width * height) };
};

if (modo === 'prova') {
  const dir = path.join(saida, 'prova');
  mkdirSync(dir, { recursive: true });
  const res = {};
  const itens = [];
  for (const s of SLUGS) {
    const f = path.join(dir, `${s}.png`);
    await still(`Prova-${s}`, f);
    const r = await diff(path.join(protoStills, `${s}.png`), f, path.join(dir, `${s}-diff.png`));
    res[s] = { mediaAbs: +r.media.toFixed(3), pctPixelsDiferentes: +r.pctFora.toFixed(3) };
    console.log(s, res[s]);
    itens.push({ file: path.join(protoStills, `${s}.png`), label: `${s} protótipo` }, { file: f, label: `${s} produção` }, { file: path.join(dir, `${s}-diff.png`), label: `${s} diferença x4` });
  }
  writeFileSync(path.join(dir, 'diff.json'), JSON.stringify(res, null, 2));
  if (!filtro) await folha(itens, path.join(saida, 'prova-vs-prototipo.png'), { cols: 6, cw: 300 });
}

if (modo === 'formatos') {
  for (const [nome] of Object.entries(FMT)) {
    if (process.argv[4] && process.argv[4] !== nome) continue;
    const dir = path.join(saida, nome);
    mkdirSync(dir, { recursive: true });
    const itens = [];
    for (const s of SLUGS) {
      const f = path.join(dir, `${s}.png`);
      const t0 = Date.now();
      await still(`Moldura-${nome}-${s}`, f);
      console.log(`${nome} ${s} ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      itens.push({ file: f, label: s });
    }
    if (!filtro) await folha(itens, path.join(saida, `contact-sheet-${nome}.png`), { cols: 6, cw: 360 });
  }
}

if (modo === 'extra') {
  // casos de texto e de mídia (src/molduras/casos.ts, pasta Molduras-Casos do Root)
  const comps = (await getCompositions(serveUrl, { port: PORTA })).filter((c) => c.id.startsWith('Caso-') && c.id.includes(filtro));
  const dir = path.join(saida, 'casos');
  mkdirSync(dir, { recursive: true });
  const itens = [];
  for (const c of comps) {
    const nome = c.id.slice(5);
    const f = path.join(dir, `${nome}.png`);
    await renderStill({ port: PORTA, composition: c, serveUrl, output: f, frame: 90, imageFormat: 'png' });
    itens.push({ file: f, label: nome, h: c.height });
    console.log(nome);
  }
  for (const [k, h] of [['9x16', 1920], ['4x5', 1350], ['1x1', 1080]]) {
    const doFormato = itens.filter((i) => i.h === h);
    if (doFormato.length) await folha(doFormato, path.join(saida, `casos-${k}.png`), { cols: 6, cw: 330 });
  }
}

if (modo === 'zh') {
  // os 18 em zh-TW com textos no limite, nos 3 formatos (Molduras-zhTW-* no Root)
  for (const [nome] of Object.entries(FMT)) {
    const dir = path.join(saida, `zh-tw-${nome}`);
    mkdirSync(dir, { recursive: true });
    const itens = [];
    for (const s of SLUGS) {
      const f = path.join(dir, `${s}.png`);
      await still(`ZH-${nome}-${s}`, f);
      itens.push({ file: f, label: s });
    }
    if (!filtro) await folha(itens, path.join(saida, `zh-tw-${nome}.png`), { cols: 6, cw: 360 });
    console.log(`zh ${nome} ok`);
  }
}

if (modo === 'video') {
  const tempos = {};
  for (const [nome] of Object.entries(FMT)) {
    if (process.argv[4] && process.argv[4] !== nome) continue;
    const id = `Moldura-${nome}-${filtro || '05-noticia'}`;
    // peça de DUR segundos (padrão 30) do take de 31 s: o caso real do AUTO (campeão inteiro)
    const base = await selectComposition({ port: PORTA, serveUrl, id });
    const inputProps = { ...base.props, video: { ...base.props.video, timeline: [{ startSec: 0, endSec: Number(process.env.DUR ?? 30) }] } };
    const composition = await selectComposition({ port: PORTA, serveUrl, id, inputProps });
    mkdirSync(path.join(saida, 'video'), { recursive: true });
    const t0 = Date.now();
    await renderMedia({
      port: PORTA, composition, serveUrl, inputProps, codec: 'h264', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 90, concurrency: 1,
      offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, outputLocation: path.join(saida, 'video', `${id}.mp4`),
    });
    tempos[id] = (Date.now() - t0) / 1000;
    console.log(id, tempos[id], 's');
  }
  writeFileSync(path.join(saida, 'video', 'tempos.json'), JSON.stringify(tempos, null, 2));
}
