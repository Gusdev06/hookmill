// kit-marca-v1 §5 (31/10): prova do logo do kit nas composições. Antes (iniciais) × depois (logo PNG escuro transparente e
// logo SVG branco transparente) em 3 molduras, Chat DM (cabeçalho + cena final) e AutoEdit (STORY + ENDCARD). Mídia local,
// logos de exemplo gerados aqui (sem marca real), nada pago.
// Uso: node scripts/logo-kit.mjs   → out/logo-kit-2026-10-31/{stills,index.html}
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const saida = path.join(raiz, 'out', 'logo-kit-2026-10-31');
const stills = path.join(saida, 'stills');
const pub = path.join(raiz, 'public', 'fixtures', 'logo-kit');
mkdirSync(stills, { recursive: true });
mkdirSync(pub, { recursive: true });

// ── logos de exemplo (marca fictícia) ──
// PNG largo (wordmark), tinta escura, fundo transparente: placa clara
const svgPng = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240">
  <circle cx="120" cy="120" r="92" fill="#FB8500"/><circle cx="120" cy="120" r="44" fill="#14213D"/>
  <text x="250" y="160" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="128" fill="#14213D">nordo</text></svg>`;
await sharp(Buffer.from(svgPng)).png().toFile(path.join(pub, 'logo-escuro.png'));
// SVG quadrado só em branco, fundo transparente (logo feito pra fundo escuro): placa escura
const svgBranco = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <path d="M100 18 L182 100 L100 182 L18 100 Z" fill="none" stroke="#FFFFFF" stroke-width="16"/>
  <path d="M100 62 L138 100 L100 138 L62 100 Z" fill="#FFFFFF"/></svg>`;
writeFileSync(path.join(pub, 'logo-branco.svg'), svgBranco);

const LOGOS = {
  png: { url: 'fixtures/logo-kit/logo-escuro.png', colors: ['#14213D', '#FB8500'] },
  svg: { url: 'fixtures/logo-kit/logo-branco.svg', colors: ['#FFFFFF'] },
};

const PORTA = 3022; // a 3000/3001 é da API e do web
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: path.join(raiz, 'src', 'index.ts'), publicDir: path.join(raiz, 'public') });
console.log(`bundle ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const still = async (id, nome, frame, inputProps) => {
  const composition = await selectComposition({ port: PORTA, serveUrl, id, inputProps });
  const out = path.join(stills, `${nome}.png`);
  await renderStill({ port: PORTA, composition, serveUrl, output: out, frame: Math.min(frame, composition.durationInFrames - 1), imageFormat: 'png', inputProps });
  return out;
};
const base = async (id, inputProps) => (await selectComposition({ port: PORTA, serveUrl, id, inputProps })).props;

const comLogo = {
  moldura: (p, logo) => ({ ...p, frame: { ...p.frame, brand: { ...p.frame.brand, ...(logo && { logo }) } } }),
  template: (p, logo) => ({ ...p, brand: { ...p.brand, ...(logo && { logo }) } }),
  auto: (p, logo) => ({ ...p, ...(logo && { brandLogo: logo }) }),
};

const cenas = [];
// 3 molduras: avatar redondo (post_card), marca no slide (call), assinatura (cinema)
for (const [slug, rotulo] of [['11-tweet', 'Moldura post_card (avatar)'], ['08-google-meet', 'Moldura call (marca no slide)'], ['04-cinema', 'Moldura cinema (assinatura)']]) {
  const id = `Moldura-9x16-${slug}`;
  const p = await base(id);
  cenas.push({ rotulo, id, frame: 90, props: (logo) => comLogo.moldura(p, logo) });
}
// Chat DM: cabeçalho + bolhas (meio) e cena final (endcard)
const tpl = await base('Template');
const msgs = tpl.props.messages;
cenas.push({ rotulo: 'Chat DM (cabeçalho + bolhas)', id: 'Template', frame: Math.round((msgs[4].atSec + 0.6) * 30), props: (logo) => comLogo.template(tpl, logo) });
cenas.push({ rotulo: 'Chat DM (cena final / endcard)', id: 'Template', frame: Math.round((tpl.props.close.atSec + 3) * 30), props: (logo) => comLogo.template(tpl, logo) });
// AutoEdit: STORY (avatar + handle) e ENDCARD
const auto = await base('AutoEdit');
const story = { ...auto, type: 'STORY', params: { type: 'STORY', handle: '@nordo', timeAgo: '2h', replyLabel: 'Send message', bars: 3 } };
const end = { ...auto, type: 'ENDCARD', params: { type: 'ENDCARD', variant: 'cta', headline: 'Sleep without back pain', subline: '10 minutes before bed', ctaText: 'Try it free', durationSec: 2, background: '#141414' } };
cenas.push({ rotulo: 'AutoEdit STORY (avatar + handle)', id: 'AutoEdit', frame: 45, props: (logo) => comLogo.auto(story, logo) });
cenas.push({ rotulo: 'AutoEdit ENDCARD', id: 'AutoEdit', frame: 9999, props: (logo) => comLogo.auto(end, logo) });

const linhas = [];
for (const [k, c] of cenas.entries()) {
  const t = Date.now();
  const arqs = {};
  for (const [v, logo] of [['antes', null], ['png', LOGOS.png], ['svg', LOGOS.svg]]) arqs[v] = await still(c.id, `${String(k + 1).padStart(2, '0')}-${v}`, c.frame, c.props(logo));
  console.log(`${c.rotulo}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
  linhas.push({ ...c, arqs });
}

const rel = (f) => path.relative(saida, f);
const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Logo do kit da marca nos vídeos — 31/10</title>
<style>body{background:#0d0d10;color:#eee;font:15px/1.4 -apple-system,Helvetica,sans-serif;margin:24px}h1{font-size:22px}
.l{margin:28px 0}.l h2{font-size:16px;margin:0 0 10px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;max-width:1200px}
figure{margin:0}figure img{width:100%;border-radius:8px;border:1px solid #2a2a30}figcaption{color:#aaa;margin-top:6px}
.logos{display:flex;gap:16px;align-items:center}.logos img{height:72px;padding:8px;border-radius:8px}</style>
<h1>Logo do kit da marca no lugar das iniciais (kit-marca-v1 §5)</h1>
<p>Antes = sem logo no kit (iniciais, como hoje). Depois = logo PNG escuro transparente (placa clara) e logo SVG só branco transparente (placa escura). Logos fictícios gerados no script; mídia local; nada pago.</p>
<div class="logos"><img src="${rel(path.join(pub, 'logo-escuro.png'))}" style="background:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/16px 16px"><img src="${rel(path.join(pub, 'logo-branco.svg'))}" style="background:repeating-conic-gradient(#555 0 25%,#333 0 50%) 0 0/16px 16px"></div>
${linhas.map((l) => `<div class="l"><h2>${l.rotulo} · quadro ${l.frame === 9999 ? 'final' : l.frame}</h2><div class="g">
<figure><img src="${rel(l.arqs.antes)}"><figcaption>Antes (iniciais)</figcaption></figure>
<figure><img src="${rel(l.arqs.png)}"><figcaption>Depois: logo PNG</figcaption></figure>
<figure><img src="${rel(l.arqs.svg)}"><figcaption>Depois: logo SVG branco</figcaption></figure></div></div>`).join('\n')}
</html>`;
writeFileSync(path.join(saida, 'index.html'), html);
console.log(`galeria ${path.join(saida, 'index.html')} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
