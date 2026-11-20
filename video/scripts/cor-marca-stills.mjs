// Stills das molduras com a "Cor da marca" do editor (nada pago). Uso: node scripts/cor-marca-stills.mjs <pasta-saida> <variante: sem|vermelho|amarelo> [filtro-slug]
// Variantes imitam o editor: brand.color = brand.accent = cor (accent só existe depois da mudança; antes é ignorado pelo schema).
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , saida, variante = 'sem', filtro = ''] = process.argv;
const COR = { sem: null, vermelho: '#E32222', amarelo: '#FFE14D' }[variante];
const SLUGS = ['01-caixinha', '02-choquei', '03-meme', '04-cinema', '05-noticia', '06-tela-dividida', '07-tela-dividida-2', '08-google-meet', '09-meet-dialogo',
  '10-ranking', '11-tweet', '12-oferta-direta', '13-story', '14-leia-a-legenda', '15-pov-depoimento', '16-live', '17-fofoca-1', '18-fofoca-2'].filter((s) => s.includes(filtro));
const FRAMES = [90, 200];
mkdirSync(saida, { recursive: true });
const PORTA = 3021;
const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src', 'index.ts'), publicDir: path.join(raiz, 'public') });
for (const s of SLUGS) {
  const id = `Moldura-9x16-${s}`;
  const base = await selectComposition({ port: PORTA, serveUrl, id });
  const props = JSON.parse(JSON.stringify(base.props));
  if (COR) { props.frame.brand.color = COR; props.frame.brand.accent = COR; }
  const composition = await selectComposition({ port: PORTA, serveUrl, id, inputProps: props });
  for (const f of FRAMES) {
    await renderStill({ port: PORTA, composition, serveUrl, inputProps: props, output: path.join(saida, `${s}-f${f}.png`), frame: f, imageFormat: 'png' });
  }
  console.log(variante, s);
}
