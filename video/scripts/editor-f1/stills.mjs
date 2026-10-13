// Aceite (b) do F1 (editor-v1 §10): renderStill de referência pro Player × render.
// 3 docs (player-fixtures.json) × frames 0, 45, 300 e o último -> out/f1-stills/<doc>-<frame>.png (png, escala 1).
// Uso (de video/): node scripts/editor-f1/stills.mjs [base|basePreto] [bundleDir]   (padrão basePreto = o aceite)
// (compila src/lib com esbuild em out/, sem tocar no dist/lib que a API carrega)
// O web abre a mesma fixture no <Player> e tira print dos mesmos frames; depois: scripts/editor-f1/comparar.py.
import { bundle } from '@remotion/bundler';
import { buildSync } from 'esbuild';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lib = path.join(raiz, 'out/f1-lib.cjs');
buildSync({ entryPoints: [path.join(raiz, 'src/lib/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: lib, logLevel: 'warning' });
const { aplicarDoc, duracaoEmFrames } = createRequire(import.meta.url)(lib);
const fx = JSON.parse(readFileSync(path.join(raiz, 'scripts/editor-f1/player-fixtures.json'), 'utf8'));
const base = process.argv[2] ?? 'basePreto';
const serveUrl = process.argv[3] ?? (await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public') }));
const out = path.join(raiz, `out/f1-stills-${base}`);
mkdirSync(out, { recursive: true });
for (const [nome, doc] of Object.entries(fx.docs)) {
  const inputProps = aplicarDoc(fx[base], doc);
  const composition = await selectComposition({ serveUrl, id: fx.composition, inputProps });
  const ultimo = duracaoEmFrames(inputProps) - 1;
  for (const f of fx.frames) {
    const frame = f === 'ultimo' ? ultimo : f;
    const output = path.join(out, `${nome}-${f}.png`);
    await renderStill({ serveUrl, composition, inputProps, frame, output, imageFormat: 'png', scale: 1 });
    console.log(output, `frame ${frame}`);
  }
}
