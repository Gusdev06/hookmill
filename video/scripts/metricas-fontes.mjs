// Gera src/lib/metricas-fontes.ts: largura de avanço por caractere e kerning por par das fontes das molduras, medidos no
// mesmo Chrome do render (o chrome-headless-shell do Remotion) com os mesmos .woff2 de public/fonts. Com a tabela, o
// fitText (src/lib/molduras.ts) mede texto em Node (API, testes) e no navegador com o MESMO número: a decisão de tamanho
// da composição e a validação do buildFrameInput não divergem. Rodar de novo só se trocar fonte ou conjunto de caracteres.
// Uso: node scripts/metricas-fontes.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeDir = path.join(raiz, 'node_modules', '.remotion', 'chrome-headless-shell');
const plataforma = readdirSync(chromeDir).find((d) => d !== 'VERSION');
const sub = readdirSync(path.join(chromeDir, plataforma)).find((d) => d.startsWith('chrome-headless-shell'));
const executablePath = path.join(chromeDir, plataforma, sub, 'chrome-headless-shell');

// chave = a usada no fitText; arquivo e peso = os de src/fontes.ts
const FONTES = {
  'inter-600': ['inter-latin-600-normal.woff2', 600],
  'inter-800': ['inter-latin-800-normal.woff2', 800],
  'montserrat-800': ['montserrat-latin-800-normal.woff2', 800],
  'montserrat-900': ['montserrat-latin-900-normal.woff2', 900],
  'anton-400': ['anton-latin-400-normal.woff2', 400],
  'archivo-black-400': ['archivo-black-latin-400-normal.woff2', 400],
};

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
    for (const c of chars) cw[c] = ctx.measureText(c).width;
    const kern = {};
    for (const a of chars) {
      if (a === ' ') continue;
      for (const b of chars) {
        if (b === ' ') continue;
        const d = ctx.measureText(a + b).width - cw[a] - cw[b];
        if (Math.abs(d) >= 0.5) kern[a + b] = Math.round(d * 10) / 10;
      }
    }
    out[k] = { adv, kern, ln, asc, desc };
  }
  return out;
}, FONTES, chars, S);

// validação: tabela × span real em frases com acento, maiúscula e pontuação, em 3 tamanhos
const AMOSTRAS = [
  'Por que eu acordo com mais dor do que quando fui dormir?', 'Ninguém te contou, mas a dor que você sente de manhã',
  'SUA COLUNA LEVE DE NOVO', 'Toque no botão e garanta', 'AVA, Tékoä... “Wow” — R$ 97,90 / $19.99', 'Pulsa, apretá el botón: ¡ya!',
];
const medirTabela = (k, t, s) => {
  const { adv, kern } = dados[k];
  let w = 0;
  for (let i = 0; i < t.length; i++) { w += adv[t[i]] ?? adv['M']; if (i) w += kern[t[i - 1] + t[i]] ?? 0; }
  return (w * s) / S;
};
let pior = 0;
for (const k of Object.keys(FONTES)) {
  for (const t of AMOSTRAS) {
    for (const s of [36, 58, 120]) {
      const real = await page.evaluate((k, p, t, s) => {
        const n = document.createElement('span');
        n.style.cssText = `position:absolute;top:-10000px;white-space:pre;display:inline-block;font-size:${s}px;font-family:M-${k};font-weight:${p}`;
        n.textContent = t; document.body.appendChild(n); const w = n.getBoundingClientRect().width; n.remove(); return w;
      }, k, FONTES[k][1], t, s);
      const erro = Math.abs(real - medirTabela(k, t, s)) / real;
      pior = Math.max(pior, erro);
      if (erro > 0.004) console.log(`erro ${(erro * 100).toFixed(2)}% ${k} ${s}px "${t}" real ${real.toFixed(1)} tabela ${medirTabela(k, t, s).toFixed(1)}`);
    }
  }
}
await browser.close();
console.log(`pior erro relativo tabela × DOM: ${(pior * 100).toFixed(3)}%`);

// acento kerna igual à letra base na maioria das fontes: guarda só o par que difere do par base (o leitor cai no base)
const base = (c) => c.normalize('NFD')[0];
const linhas = Object.entries(dados).map(([k, { adv, kern, ln, asc, desc }]) => {
  const a = chars.map((c) => Math.round(adv[c] * 10) / 10).join(',');
  const pares = new Map();
  for (const a of chars) for (const b of chars) {
    if (a === ' ' || b === ' ') continue;
    const p = a + b, bp = base(a) + base(b), v = kern[p] ?? 0;
    if (bp === p) { if (v) pares.set(p, v); continue; }
    if (Math.abs((kern[bp] ?? 0) - v) >= 0.5) pares.set(p, v);
  }
  const kk = [...pares].map(([p, v]) => `${p}${v}`).join('\u0001');
  return `  '${k}': { ln: ${Math.round(ln * 10000) / 10000}, asc: ${Math.round(asc * 10000) / 10000}, desc: ${Math.round(desc * 10000) / 10000}, adv: [${a}], kern: ${JSON.stringify(kk)} },`;
});
const ts = `// GERADO por scripts/metricas-fontes.mjs (não editar à mão). Larguras em unidades de 1/${S} em, medidas no Chrome do
// render com os .woff2 de public/fonts. ln = altura da linha com line-height normal (em); adv[i] = avanço de METRIC_CHARS[i]; kern = pares "ab<valor>" separados por \\u0001.
// Pior erro relativo da tabela contra o DOM nas frases de validação: ${(pior * 100).toFixed(3)}%.
export const METRIC_UNITS = ${S};
export const METRIC_CHARS = ${JSON.stringify(chars.join(''))};
export const METRIC_FONTS = {
${linhas.join('\n')}
} as const;
`;
writeFileSync(path.join(raiz, 'src', 'lib', 'metricas-fontes.ts'), ts);
console.log(`src/lib/metricas-fontes.ts: ${(ts.length / 1024).toFixed(0)} KB`);
