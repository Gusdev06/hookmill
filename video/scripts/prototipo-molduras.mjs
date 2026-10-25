// PROTÓTIPO 25/10: renderiza as 18 molduras (Prototipo-Molduras no Root) com mídia local. Nada pago.
// Uso: node scripts/prototipo-molduras.mjs [stills|video] [filtro]
//   stills -> out/prototipo-molduras-2026-10-25/stills/NN-nome.png (frame de 3 s)
//   video  -> out/prototipo-molduras-2026-10-25/NN-nome.mp4 + tempos.json
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modo = process.argv[2] ?? 'stills';
const filtro = process.argv[3] ?? '';
const saida = path.join(raiz, 'out', 'prototipo-molduras-2026-10-25');
mkdirSync(path.join(saida, 'stills'), { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src', 'index.ts'), publicDir: path.join(raiz, 'public') });
const ids = ['01-caixinha', '02-choquei', '03-meme', '04-cinema', '05-noticia', '06-tela-dividida', '07-tela-dividida-2', '08-google-meet', '09-meet-dialogo',
  '10-ranking', '11-tweet', '12-oferta-direta', '13-story', '14-leia-a-legenda', '15-pov-depoimento', '16-live', '17-fofoca-1', '18-fofoca-2'].filter((i) => i.includes(filtro));

const tempos = {};
for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id: `Moldura-${id}`, inputProps: {} });
  const t0 = Date.now();
  if (modo === 'stills') {
    await renderStill({ composition, serveUrl, output: path.join(saida, 'stills', `${id}.png`), frame: 90, imageFormat: 'png' });
  } else {
    await renderMedia({
      composition, serveUrl, codec: 'h264', pixelFormat: 'yuv420p', imageFormat: 'jpeg', jpegQuality: 90, concurrency: 4,
      offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, outputLocation: path.join(saida, `${id}.mp4`),
    });
  }
  tempos[id] = (Date.now() - t0) / 1000;
  console.log(`${modo} ${id} ${tempos[id].toFixed(1)} s`);
}
if (modo === 'video') writeFileSync(path.join(saida, 'tempos.json'), JSON.stringify(tempos, null, 2));
