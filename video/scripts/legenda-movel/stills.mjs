// Stills da legenda móvel (20/11). Uso (de video/): node scripts/legenda-movel/stills.mjs <saida> [bundle-base-dir]
//   - renderiza cada caso com o código ATUAL; com [bundle-base-dir] (checkout do HEAD sem a legenda móvel) renderiza o caso
//     "sem edição" também lá e compara pixel a pixel.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { buildSync } from 'esbuild';
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const saida = path.resolve(process.argv[2]);
const baseDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
const FRAME = Number(process.env.FRAME ?? 66);
mkdirSync(saida, { recursive: true });
const req = createRequire(import.meta.url);
const js = path.join(saida, '.casos.cjs');
buildSync({ entryPoints: [path.join(raiz, 'scripts/legenda-movel/casos.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: js, logLevel: 'warning' });
const { CASOS, propsDoCaso } = req(js);

const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public'), outDir: path.join(saida, '.bundle') });
const still = async (url, nome, props) => {
  const composition = await selectComposition({ port: 3029, serveUrl: url, id: 'Moldura', inputProps: props });
  const arq = path.join(saida, `${nome}.png`);
  await renderStill({ port: 3029, serveUrl: url, composition, inputProps: props, frame: FRAME, imageFormat: 'png', output: arq });
  return arq;
};
const pixels = async (f) => (await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
for (const c of CASOS) {
  const t = Date.now();
  const f = await still(serveUrl, c.nome, propsDoCaso(c));
  console.log(`${c.nome} ${((Date.now() - t) / 1000).toFixed(1)} s`);
  if (baseDir && c.nome === '00-sem-edicao') {
    const urlBase = await bundle({ entryPoint: path.join(baseDir, 'video/src/index.ts'), publicDir: path.join(raiz, 'public'), outDir: path.join(saida, '.bundle-base') });
    // props do caso sem edição: as da base, sem o resolver (= o que o código de antes recebia)
    const fb = await still(urlBase, '00-sem-edicao-ANTES', c.base);
    const a = await pixels(f), b = await pixels(fb);
    let dif = 0;
    if (a.data.length !== b.data.length) dif = -1; else for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) dif++;
    console.log(`IDENTIDADE sem edição: ${dif === 0 ? 'IDENTICO pixel a pixel' : `DIFERE (${dif} bytes)`} (${a.info.width}x${a.info.height})`);
  }
}
