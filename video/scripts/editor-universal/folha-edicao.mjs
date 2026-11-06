// Folha de conferência do F-U1: stills (frame 60) da base e da mesma peça com um doc de teste (caixa movida/escalada,
// caixa escondida, cor da marca, texto trocado, HEADLINE com faixa movida). Render local; nada pago.
// Uso (de video/): node scripts/editor-universal/folha-edicao.mjs  -> out/editor-universal/folha-edicao.png
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { buildSync } from 'esbuild';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(raiz, 'out/editor-universal/folha');
mkdirSync(out, { recursive: true });
const req = createRequire(import.meta.url);
const js = path.join(raiz, 'out/editor-universal/folha.cjs');
buildSync({ stdin: { contents: "export * from './src/lib/index'; export * from './scripts/editor-universal/casos'; export { demoProps } from './src/molduras/demo';", resolveDir: raiz, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: js, logLevel: 'warning' });
const L = req(js);
const v3 = (o) => ({ version: 3, clips: [], trim: null, layers: [], captionWords: [], ...o });
const casos = [
  ['ranking', 'Moldura', L.demoProps('ranking'), v3({ templateOpts: { brand: '#E5231B' }, layers: [{ id: 'slot:title', text: 'O que destrava' }, { id: 'box:card', rect: { x: 0.05, y: 0.42, w: 0.6, h: 0.3 } }, { id: 'box:list', visible: false }] })],
  ['question_box', 'Moldura', L.demoProps('question_box'), v3({ layers: [{ id: 'box:card', rect: { x: 0.15, y: 0.12, w: 0.62, h: 0.4 } }, { id: 'slot:question', text: 'Por que dói *às 7 da manhã*?' }] })],
  ['story', 'Moldura', L.demoProps('story'), v3({ layers: [{ id: 'box:cartao', rect: { x: 0.2, y: 0.25, w: 0.6, h: 0.3 } }] })],
  ['news', 'Moldura', L.demoProps('news'), v3({ templateOpts: { brand: '#00A86B' }, layers: [{ id: 'slot:cta', transform: { x: 0.5, y: 0.45, scale: 0.8, rotationDeg: 0, boxWidth: 0.89 } }, { id: 'slot:topic', text: 'Exclusivo' }] })],
  ['call-1x1', 'Moldura', L.demoProps('call', 'SQUARE_1_1'), v3({ layers: [{ id: 'box:controls', visible: false }], items: { 'slot:slideSteps': [{ id: 'i2', text: 'Ponte de quadril, 30 s' }] } })],
  ['headline', 'RemixKeep', L.HEADLINE_ADD, v3({ layers: [{ id: 'headline:box', fill: '#FFFFFF', rect: { x: 0, y: 0.62, w: 1, h: 0.1421875 } }, { id: 'headline', text: 'Sua lombar *leve* amanhã', style: { color: '#111111', highlightColor: '#D7261E' } }] })],
];
const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src/index.ts'), publicDir: path.join(raiz, 'public'), outDir: path.join(raiz, 'out/editor-universal/bundle-depois') });
const itens = [];
for (const [nome, comp, base, doc] of casos) {
  const fmt = comp === 'Moldura' ? { VERTICAL_9_16: '9x16', PORTRAIT_4_5: '4x5', SQUARE_1_1: '1x1' }[base.format] : '9x16';
  const res = comp === 'Moldura' ? L.resolverPropsMoldura(base, doc, { format: fmt }) : L.resolverPropsHeadline(base, doc, { format: fmt });
  for (const [rot, props] of [['base', base], ['editado', res.props]]) {
    const composition = await selectComposition({ port: 3028, serveUrl, id: comp, inputProps: props });
    const file = path.join(out, `${nome}-${rot}.png`);
    await renderStill({ port: 3028, serveUrl, composition, inputProps: props, frame: 60, output: file, imageFormat: 'png' });
    itens.push({ file, label: `${nome} ${rot}` });
    console.log(file);
  }
}
const cw = 300, ch = 534, lab = 36, cols = 4;
const comps = [];
for (const [k, i] of itens.entries()) {
  const x = (k % cols) * cw, y = Math.floor(k / cols) * (ch + lab);
  comps.push({ input: await sharp(i.file).resize(cw, ch, { fit: 'contain', background: '#111' }).toBuffer(), left: x, top: y });
  comps.push({ input: Buffer.from(`<svg width="${cw}" height="${lab}"><rect width="100%" height="100%" fill="#111"/><text x="${cw / 2}" y="25" font-family="Helvetica" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">${i.label}</text></svg>`), left: x, top: y + ch });
}
const linhas = Math.ceil(itens.length / cols);
await sharp({ create: { width: cols * cw, height: linhas * (ch + lab), channels: 3, background: '#111' } }).composite(comps).png().toFile(path.join(raiz, 'out/editor-universal/folha-edicao.png'));
console.log('folha out/editor-universal/folha-edicao.png');
