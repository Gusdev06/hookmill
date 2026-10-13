// Renders de amostra do F2b (editor-v1 §10): 3 docs sobre a fonte de teste local (5 cenas Kling, nada pago).
// mover = camadas movidas/giradas · estilo = fonte/cor/fundo/contorno/sombra trocados + palavra corrigida ·
// cenas = cena aparada + reordenada + apagada (legenda acompanha; end card congela o fim da cena aparada).
// Uso (de video/): node scripts/editor-f2b/amostras.mjs [bundleDir]  -> out/f2b-amostras/<doc>.mp4 + folha-<doc>.jpg
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { buildSync } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lib = path.join(raiz, 'out/f2b-lib.cjs');
buildSync({ entryPoints: [path.join(raiz, 'src/lib/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: lib, logLevel: 'warning' });
const { resolverProps, validarDoc, normalizarDoc, duracaoEmFrames } = createRequire(import.meta.url)(lib);
const amostra = JSON.parse(readFileSync(path.join(raiz, 'public/fixtures/amostra.json'), 'utf8'));
const fonte = {
  format: 'VERTICAL_9_16', fps: 30, language: 'en',
  scenes: amostra.scenes.map((s, i) => ({ sceneId: `s${i + 1}`, index: i, attempt: 1, durationSec: s.durationSec, clipStartSec: 0, clip: { url: s.clipUrl }, thumbnail: null, words: s.words })),
};
const settings = { templateId: 'headline', captionStyle: 'word', captionPosition: 'bottom', headline: 'I found out without touching their phone', ctaText: 'Try it free today', endCard: true };
const clip = (id, o = {}) => { const s = fonte.scenes.find((x) => x.sceneId === id); return { sceneId: id, enabled: true, attempt: 1, inSec: 0, outSec: s.durationSec, ...o }; };
const docs = {
  mover: { version: 1, clips: [], trim: null, captionWords: [], layers: [
    { id: 'hook', transform: { x: 0.42, y: 0.42, scale: 0.85, rotationDeg: -7, boxWidth: 0.7 } },
    { id: 'caption', transform: { x: 0.5, y: 0.28, scale: 1.25, rotationDeg: 5, boxWidth: 0.75 } },
    { id: 'cta', transform: { x: 0.62, y: 0.88, scale: 1.2, rotationDeg: -4, boxWidth: 0.7 } },
  ] },
  estilo: { version: 1, clips: [], trim: null, layers: [
    { id: 'hook', style: { fontId: 'bebas-neue-400', color: '#FFE14D', background: { kind: 'none', color: null }, strokeColor: '#000000', strokeWidthPx: 4, uppercase: true, align: 'left' } },
    { id: 'caption', style: { fontId: 'anton-400', color: '#FFFFFF', highlightColor: '#FF3B6B', background: { kind: 'pill', color: '#000000B3' }, uppercase: true, shadow: false } },
    { id: 'cta', text: 'Download now', style: { fontId: 'poppins-800', color: '#FFFFFF', background: { kind: 'box', color: '#6C22D6' } } },
  ], captionWords: [{ key: 's1@1:4', text: 'INSTA' }, { key: 's1@1:8', text: '' }] },
  cenas: { version: 1, trim: null, layers: [], captionWords: [], clips: [
    clip('s3', { inSec: 2.0 }), clip('s1'), clip('s5'), clip('s4', { enabled: false }), clip('s2', { inSec: 1.0, outSec: 5.0 }),
  ] },
};
const serveUrl = process.argv[2] ?? (await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public') }));
const out = path.join(raiz, 'out/f2b-amostras');
mkdirSync(out, { recursive: true });
for (const [nome, doc] of Object.entries(docs)) {
  const erros = validarDoc(doc, fonte);
  if (erros.length) throw new Error(`${nome}: ${JSON.stringify(erros)}`);
  const inputProps = resolverProps(fonte, settings, normalizarDoc(doc, fonte, settings));
  writeFileSync(path.join(out, `${nome}.props.json`), JSON.stringify(inputProps, null, 1));
  const composition = await selectComposition({ serveUrl, id: 'Criativo', inputProps });
  const t0 = Date.now();
  const mp4 = path.join(out, `${nome}.mp4`);
  await renderMedia({ serveUrl, composition, inputProps, codec: 'h264', outputLocation: mp4, concurrency: 3, imageFormat: 'jpeg', pixelFormat: 'yuv420p' });
  const total = duracaoEmFrames(inputProps);
  // folha: 12 quadros espaçados + o último frame das cenas e 2 do end card
  const quadros = [...Array.from({ length: 10 }, (_, i) => Math.round((i * (total - 76)) / 9)), total - 60, total - 1];
  const sel = quadros.map((f) => `eq(n\\,${f})`).join('+');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', `select='${sel}',scale=270:-1,drawtext=text='%{eif\\:t*30\\:d}':x=8:y=8:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6,tile=6x2`, '-frames:v', '1', '-vsync', 'vfr', path.join(out, `folha-${nome}.jpg`)]);
  console.log(`${nome}: ${total} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s, quadros ${quadros.join(' ')}`);
}
