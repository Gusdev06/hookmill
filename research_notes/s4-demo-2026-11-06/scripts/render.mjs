// Uso: node render.mjs <jobs.json> [--sem-bundle]. Render Remotion real, com os ajustes do produto: png, crf 10, bt709, mudo (remotion-render.service.ts).
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const AQUI = path.dirname(fileURLToPath(import.meta.url)); const RAIZ = path.dirname(AQUI);
const PROJ = path.resolve(RAIZ, '../..');
const CHROME = path.join(PROJ, 'video/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const buildDir = path.join(RAIZ, 'remotion/build');
let serveUrl = buildDir;
if (!process.argv.includes('--sem-bundle') || !fs.existsSync(buildDir)) {
  const t = Date.now();
  serveUrl = await bundle({ entryPoint: path.join(RAIZ, 'remotion/src/index.ts'), publicDir: path.join(RAIZ, 'remotion/public'), outDir: buildDir, rootDir: path.join(RAIZ, 'remotion') });
  console.log('bundle', (Date.now() - t) / 1000, 's');
}
const browserExecutable = fs.existsSync(CHROME) ? CHROME : null;
const conc = Number(process.env.CONC ?? 4);
for (const j of jobs) {
  const t = Date.now();
  const inputProps = j.props;
  const composition = await selectComposition({ serveUrl, id: 'Sonda', inputProps, browserExecutable, logLevel: 'error' });
  const saida = path.resolve(RAIZ, j.saida); fs.mkdirSync(path.dirname(saida), { recursive: true });
  await renderMedia({ serveUrl, composition, inputProps, outputLocation: saida, muted: true, crf: 10, colorSpace: 'bt709', codec: 'h264', imageFormat: 'png', pixelFormat: 'yuv420p', concurrency: conc, offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, overwrite: true, logLevel: 'error', browserExecutable });
  console.log(j.saida, composition.width + 'x' + composition.height, composition.durationInFrames, 'q', (Date.now() - t) / 1000, 's');
}
