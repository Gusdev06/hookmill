// Gera src/lib/metricas-fontes.ts: largura de avanço por caractere e kerning por par, medidos no mesmo Chrome do render
// (o chrome-headless-shell do Remotion) com os mesmos .woff2 de public/fonts. Com a tabela, o fitText (src/lib/molduras.ts)
// e o ajustarHeadlineCopia (src/lib/ajuste-headline.ts) medem texto em Node (API, testes) e no navegador com o MESMO
// número. Rodar de novo só se trocar fonte ou conjunto de caracteres.
// Saída: METRIC_FONTS (as 6 chaves das molduras, FrameFontKey; não crescer sem mexer em molduras.ts), METRIC_FONTS_COPY
// (o resto do FONT_CATALOG, troca-texto §14.1.2) e METRIC_INK (topo e base da tinta de cada caractere, todas as chaves).
// O G0 (research_notes/g0-2026-11-06) mostrou o Chrome Linux medindo igual ao Mac: a tabela vale nos dois.
// Uso: node scripts/metricas-fontes.mjs   (procura o chrome-headless-shell em video/node_modules e na raiz do monorepo)
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeDir = [path.join(raiz, 'node_modules', '.remotion', 'chrome-headless-shell'), path.join(raiz, '..', 'node_modules', '.remotion', 'chrome-headless-shell')]
  .find((d) => existsSync(d));
const plataforma = readdirSync(chromeDir).find((d) => d !== 'VERSION');
const sub = readdirSync(path.join(chromeDir, plataforma)).find((d) => d.startsWith('chrome-headless-shell'));
const executablePath = path.join(chromeDir, plataforma, sub, 'chrome-headless-shell');

// chave = FontId do catálogo (+ 'inter-600' dos templates); arquivo e peso = os de src/fontes.ts
const MOLDURAS = ['inter-600', 'inter-800', 'montserrat-800', 'montserrat-900', 'anton-400', 'archivo-black-400'];
const COPIA = [
  'oswald-700', 'bebas-neue-400', 'poppins-800', 'roboto-condensed-700',
  'montserrat-500', 'montserrat-600', 'montserrat-700', 'inter-400', 'inter-500', 'inter-700', 'poppins-500', 'poppins-600',
  'arimo-400', 'arimo-500', 'arimo-600', 'arimo-700', 'tiktok-sans-400', 'tiktok-sans-500', 'tiktok-sans-600', 'tiktok-sans-700',
  'albert-sans-500',
];
const FONTES = Object.fromEntries([...MOLDURAS, ...COPIA].map((k) => {
  const i = k.lastIndexOf('-');
  return [k, [`${k.slice(0, i)}-latin-${k.slice(i + 1)}-normal.woff2`, Number(k.slice(i + 1))]];
}));

const chars = [];
for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
for (let c = 161; c <= 255; c++) if (c !== 173) chars.push(String.fromCharCode(c));
chars.push(...'‘’“”–—…•€™·');

const css = Object.entries(FONTES).map(([k, [arq, peso]]) => {
  const b64 = readFileSync(path.join(raiz, 'public', 'fonts', arq)).toString('base64');
  return `@font-face{font-family:"M-${k}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${peso};}`;
}).join('\n');

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<html><head><style>${css}</style></head><body>${Object.entries(FONTES).map(([k, [, p]]) => `<span style="font-family:'M-${k}';font-weight:${p}">ÁaZ</span>`).join('')}</body></html>`);
await page.evaluate(() => document.fonts.ready);

const S = 1000;
const dados = await page.evaluate((FONTES, chars, S) => {
  const out = {};
  const span = document.createElement('span');
  span.style.cssText = `position:absolute;top:-10000px;white-space:pre;display:inline-block;font-size:${S}px`;
  document.body.appendChild(span);
  const ctx = document.createElement('canvas').getContext('2d');
  for (const [k, [, peso]] of Object.entries(FONTES)) {
    span.style.fontFamily = `M-${k}`; span.style.fontWeight = String(peso);
    ctx.font = `${peso} ${S}px "M-${k}"`;
    const dom = (t) => { span.textContent = t; return span.getBoundingClientRect().width; };
    const adv = {};
    for (const c of chars) adv[c] = dom(c);
    span.textContent = 'Hg'; const ln = span.getBoundingClientRect().height / S;
    const mt = ctx.measureText('Hg'); const asc = mt.fontBoundingBoxAscent / S, desc = mt.fontBoundingBoxDescent / S;
    const cw = {};
    const top = [], bot = [];
    for (const c of chars) {
      const m = ctx.measureText(c); cw[c] = m.width;
      const vazio = c === ' ' || (m.actualBoundingBoxAscent === 0 && m.actualBoundingBoxDescent === 0);
      top.push(vazio ? 0 : Math.round(m.actualBoundingBoxAscent)); bot.push(vazio ? 0 : Math.round(m.actualBoundingBoxDescent));
    }
    const kern = {};
    for (const a of chars) {
      if (a === ' ') continue;
      for (const b of chars) {
        if (b === ' ') continue;
        const d = ctx.measureText(a + b).width - cw[a] - cw[b];
        if (Math.abs(d) >= 0.5) kern[a + b] = Math.round(d * 10) / 10;
      }
    }
    out[k] = { adv, kern, ln, asc, desc, top, bot };
  }
  return out;
}, FONTES, chars, S);

// validação: tabela × span real em frases com acento, maiúscula e pontuação, em 3 tamanhos
const AMOSTRAS = [
  'Por que eu acordo com mais dor do que quando fui dormir?', 'Ninguém te contou, mas a dor que você sente de manhã',
  'SUA COLUNA LEVE DE NOVO', 'Toque no botão e garanta', 'How to view your man’s recent following on IG', 'Tired of scrolling his endless following list?', 'AVA, Tékoä... “Wow” — R$ 97,90 / $19.99', 'Pulsa, apretá el botón: ¡ya!',
];
const kernUsado = (k, par) => { const v = dados[k].kern[par] ?? 0; return MOLDURAS.includes(k) || Math.abs(v) >= 3 ? v : 0; };
const medirTabela = (k, t, s) => {
  const { adv } = dados[k];
  let w = 0;
  for (let i = 0; i < t.length; i++) { w += adv[t[i]] ?? adv['M']; if (i) w += kernUsado(k, t[i - 1] + t[i]); }
  return (w * s) / S;
};
// 2 modelos: `linear` (o do fitText das molduras: avanço × tamanho) e `inteiro` (o do ajustarHeadlineCopia: cada avanço
// arredondado ao px, + kerning). O Chrome do render em Linux (Lambda e VPS) posiciona glifo em px inteiro; o do Mac não.
const medirInteiro = (k, t, s) => {
  const { adv } = dados[k];
  let w = 0;
  for (let i = 0; i < t.length; i++) { w += Math.round(((adv[t[i]] ?? adv['M']) * s) / S); if (i) w += (kernUsado(k, t[i - 1] + t[i]) * s) / S; }
  return w;
};
const pior = { linear: 0, inteiro: 0 };
const piorPorFonte = {};
for (const k of Object.keys(FONTES)) {
  piorPorFonte[k] = { linear: 0, inteiro: 0 };
  for (const t of AMOSTRAS) {
    for (const s of [26.75, 36, 41.5, 58, 120]) {
      const real = await page.evaluate((k, p, t, s) => {
        const n = document.createElement('span');
        n.style.cssText = `position:absolute;top:-10000px;white-space:pre;display:inline-block;font-size:${s}px;font-family:M-${k};font-weight:${p}`;
        n.textContent = t; document.body.appendChild(n); const w = n.getBoundingClientRect().width; n.remove(); return w;
      }, k, FONTES[k][1], t, s);
      for (const [m, f] of [['linear', medirTabela], ['inteiro', medirInteiro]]) {
        const erro = Math.abs(real - f(k, t, s)) / real;
        pior[m] = Math.max(pior[m], erro); piorPorFonte[k][m] = Math.max(piorPorFonte[k][m], erro);
      }
    }
  }
}
await browser.close();
for (const [k, e] of Object.entries(piorPorFonte)) console.log(`${k.padEnd(22)} linear ${(e.linear * 100).toFixed(2)}%  inteiro ${(e.inteiro * 100).toFixed(2)}%`);
console.log(`pior erro relativo tabela × DOM: linear ${(pior.linear * 100).toFixed(3)}%, inteiro ${(pior.inteiro * 100).toFixed(3)}%`);

// acento kerna igual à letra base na maioria das fontes: guarda só o par que difere do par base (o leitor cai no base)
const base = (c) => c.normalize('NFD')[0];
const linha = ([k, { adv, kern, ln, asc, desc }], minKern = 0.5) => {
  const a = chars.map((c) => Math.round(adv[c] * 10) / 10).join(',');
  const pares = new Map();
  for (const a of chars) for (const b of chars) {
    if (a === ' ' || b === ' ') continue;
    const p = a + b, bp = base(a) + base(b), v = kern[p] ?? 0;
    if (bp === p) { if (Math.abs(v) >= minKern) pares.set(p, v); continue; }
    if (Math.abs((kern[bp] ?? 0) - v) >= minKern) pares.set(p, v);
  }
  const kk = [...pares].map(([p, v]) => `${p}${v}`).join('\u0001');
  return `  '${k}': { ln: ${Math.round(ln * 10000) / 10000}, asc: ${Math.round(asc * 10000) / 10000}, desc: ${Math.round(desc * 10000) / 10000}, adv: [${a}], kern: ${JSON.stringify(kk)} },`;
};
// METRIC_FONTS é das molduras (fitText): só regera com --molduras; sem a flag, o bloco atual é copiado byte a byte, para
// a tabela nova (gerada em Linux) não mudar a medida das molduras por baixo.
const destino = path.join(raiz, 'src', 'lib', 'metricas-fontes.ts');
const blocoAtual = (() => {
  if (process.argv.includes('--molduras') || !existsSync(destino)) return null;
  const atual = readFileSync(destino, 'utf8');
  const i = atual.indexOf('export const METRIC_FONTS = {\n'), j = atual.indexOf('\n} as const;', i);
  return i < 0 || j < 0 ? null : atual.slice(i + 'export const METRIC_FONTS = {\n'.length, j);
})();
const linhasMolduras = blocoAtual === null ? MOLDURAS.map((k) => linha([k, dados[k]])) : [blocoAtual];
// cópia: só par de kerning >= 3/1000 em (0,15 px a 50 px), para a tabela caber no bundle do web; o erro medido abaixo já inclui o corte
const KERN_MIN_COPIA = 3;
const linhasCopia = COPIA.map((k) => linha([k, dados[k]], KERN_MIN_COPIA));
const linhasTinta = [...MOLDURAS, ...COPIA].map((k) => `  '${k}': { top: [${dados[k].top.join(',')}], bot: [${dados[k].bot.join(',')}] },`);
const ts = `// GERADO por scripts/metricas-fontes.mjs (não editar à mão). Larguras em unidades de 1/${S} em, medidas no Chrome do
// render com os .woff2 de public/fonts. ln = altura da linha com line-height normal (em); adv[i] = avanço de METRIC_CHARS[i]; kern = pares "ab<valor>" separados por \\u0001.
// Pior erro relativo contra o DOM nas frases de validação (Chrome ${process.platform}), modelo linear: ${(pior.linear * 100).toFixed(3)}%;
// modelo inteiro (avanço arredondado ao px, o do Chrome Linux do render): ${(pior.inteiro * 100).toFixed(3)}%.
// METRIC_FONTS ${blocoAtual === null ? 'regerado nesta rodada' : 'copiado da versão anterior (gerada no Mac; regerar com --molduras)'}.
export const METRIC_UNITS = ${S};
export const METRIC_CHARS = ${JSON.stringify(chars.join(''))};
export const METRIC_FONTS = {
${linhasMolduras.join('\n')}
} as const;
/** O resto do FONT_CATALOG (cópia de headline, troca-texto §14.1.2), mesmo formato. */
export const METRIC_FONTS_COPY = {
${linhasCopia.join('\n')}
} as const;
/** Tinta de cada caractere de METRIC_CHARS (actualBoundingBox do canvas): top = acima da linha de base, bot = abaixo, em 1/${S} em. */
export const METRIC_INK = {
${linhasTinta.join('\n')}
} as const;
`;
writeFileSync(destino, ts);
console.log(`src/lib/metricas-fontes.ts: ${(ts.length / 1024).toFixed(0)} KB`);
