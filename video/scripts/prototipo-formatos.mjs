// PROTÓTIPO 28/10 (v2, motion no lugar do print): renderiza os 2 formatos programáticos (Prototipo-Formatos no Root) com mídia local. Nada pago.
// Uso: node scripts/prototipo-formatos.mjs [stills|video] [filtro]
//   stills -> out/prototipo-formatos-2026-10-28/stills/<id>-<seg>s.png
//   video  -> out/prototipo-formatos-2026-10-28/<id>.mp4 + tempos.json (tempo de render e pico de RAM do processo)
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modo = process.argv[2] ?? 'stills';
const filtro = process.argv[3] ?? '';
const saida = path.join(raiz, 'out', 'prototipo-formatos-2026-10-28');
mkdirSync(path.join(saida, 'stills'), { recursive: true });

const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src', 'index.ts'), publicDir: path.join(raiz, 'public') });
const ids = ['chat-dm', 'green-screen-print'].filter((i) => i.includes(filtro));
const arqTempos = path.join(saida, 'tempos.json');
const tempos = existsSync(arqTempos) ? JSON.parse(readFileSync(arqTempos, 'utf8')) : {};

for (const id of ids) {
  const composition = await selectComposition({ serveUrl, id: `Formato-${id}`, inputProps: {} });
  if (modo === 'stills') {
    const dur = composition.durationInFrames / composition.fps;
    for (let s = 0.5; s < dur; s += 1.5) {
      await renderStill({ composition, serveUrl, output: path.join(saida, 'stills', `${id}-v2-${s.toFixed(1).padStart(4, "0")}s.png`), frame: Math.round(s * composition.fps), imageFormat: 'png' });
    }
  } else {
    let pico = 0;
    const amostra = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 250);
    const t0 = Date.now();
    await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: path.join(saida, `${id}-v2.mp4`), crf: 20, concurrency: 4 });
    clearInterval(amostra);
    tempos[`${id}-v2`] = { segundosDeVideo: +(composition.durationInFrames / composition.fps).toFixed(2), segundosDeRender: +((Date.now() - t0) / 1000).toFixed(1), picoRssNodeMB: Math.round(pico / 1e6), concurrency: 4 };
    console.log(id, tempos[`${id}-v2`]);
  }
}
writeFileSync(arqTempos, JSON.stringify(tempos, null, 2));
