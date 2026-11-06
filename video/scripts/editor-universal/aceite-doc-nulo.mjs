// Aceite (b) do F-U1 (editor-universal-v1 §5): render com doc NULO == render de hoje, frame a frame, nas 18 molduras × 3
// formatos + 2 HEADLINE. Render local (renderFrames, PNG sem perda); compara o hash dos pixels de cada quadro.
// Uso (de video/):
//   node scripts/editor-universal/aceite-doc-nulo.mjs base   [filtro]   -> bundle de HOJE (guardado) + hashes em out/editor-universal/base.json
//   node scripts/editor-universal/aceite-doc-nulo.mjs depois [filtro]   -> bundle atual, props = resolverProps<Família>(base, null).props, compara
// Env: NTH (padrão 1 = todos os quadros), BUNDLE_BASE (reusar um bundle de hoje já feito).
import { bundle } from '@remotion/bundler';
import { renderFrames, selectComposition } from '@remotion/renderer';
import { buildSync } from 'esbuild';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modo = process.argv[2] ?? 'base';
const filtro = process.argv[3] ?? '';
const NTH = Number(process.env.NTH ?? 1);
const out = path.join(raiz, 'out/editor-universal');
mkdirSync(out, { recursive: true });
const req = createRequire(import.meta.url);

// casos (e, no `depois`, os resolvers) compilados com esbuild em out/, sem tocar no dist/lib que a API carrega
const casosJs = path.join(out, 'casos.cjs');
buildSync({ entryPoints: [path.join(raiz, 'scripts/editor-universal/casos.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: casosJs, logLevel: 'warning' });
const casos = req(casosJs).casosAceite().filter((c) => c.nome.includes(filtro));
let resolver = null;
if (modo === 'depois') {
  const libJs = path.join(out, 'lib.cjs');
  buildSync({ entryPoints: [path.join(raiz, 'src/lib/index.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: libJs, logLevel: 'warning' });
  const lib = req(libJs);
  resolver = (c) => (c.composicao === 'Moldura' ? lib.resolverPropsMoldura(c.props, null, { format: c.formato }) : lib.resolverPropsHeadline(c.props, null, { format: c.formato })).props;
}

const PORTA = 3027; // 3000/3001 = API e web em dev
const t0 = Date.now();
let serveUrl;
if (modo === 'base') {
  serveUrl = process.env.BUNDLE_BASE ?? (await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public'), outDir: path.join(out, 'bundle-base') }));
} else {
  serveUrl = await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public'), outDir: path.join(out, 'bundle-depois') });
}
console.log(`bundle ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${serveUrl}`);

const hashes = {};
const tmp = path.join(out, 'frames-tmp');
for (const c of casos) {
  const inputProps = resolver ? resolver(c) : c.props;
  const t = Date.now();
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const composition = await selectComposition({ port: PORTA, serveUrl, id: c.composicao, inputProps });
  await renderFrames({ port: PORTA, serveUrl, composition, inputProps, imageFormat: 'png', outputDir: tmp, everyNthFrame: NTH, onStart: () => {}, onFrameUpdate: () => {} });
  const arquivos = readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
  const hs = [];
  for (const f of arquivos) {
    const { data } = await sharp(path.join(tmp, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    hs.push(createHash('sha256').update(data).digest('hex').slice(0, 16));
  }
  hashes[c.nome] = hs;
  console.log(`${c.nome}: ${hs.length} quadros em ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
rmSync(tmp, { recursive: true, force: true });

const arqBase = path.join(out, 'base.json');
if (modo === 'base') {
  const anterior = existsSync(arqBase) ? JSON.parse(readFileSync(arqBase, 'utf8')) : {};
  writeFileSync(arqBase, JSON.stringify({ ...anterior, ...hashes }, null, 1));
  console.log(`base gravada (${Object.keys(hashes).length} casos) em ${arqBase}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
} else {
  const base = JSON.parse(readFileSync(arqBase, 'utf8'));
  let iguais = 0, quadros = 0;
  const difs = [];
  for (const [nome, hs] of Object.entries(hashes)) {
    const b = base[nome];
    if (!b) { difs.push(`${nome}: sem base`); continue; }
    const ruins = hs.map((h, i) => (h === b[i] ? null : i)).filter((i) => i !== null);
    quadros += hs.length;
    if (b.length === hs.length && !ruins.length) iguais++;
    else difs.push(`${nome}: ${b.length} x ${hs.length} quadros, diferentes ${ruins.slice(0, 10).join(',')}${ruins.length > 10 ? '…' : ''}`);
  }
  const rel = { quando: new Date().toISOString(), nth: NTH, casos: Object.keys(hashes).length, identicos: iguais, quadros, diferencas: difs };
  writeFileSync(path.join(out, 'resultado.json'), JSON.stringify(rel, null, 1));
  console.log(`${iguais}/${Object.keys(hashes).length} casos idênticos frame a frame (${quadros} quadros) em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const d of difs) console.log(`  DIFERENTE ${d}`);
  if (difs.length) process.exit(1);
}
