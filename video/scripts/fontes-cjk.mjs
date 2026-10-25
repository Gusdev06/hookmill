// Fontes CJK (zh-TW/zh-CN/ja/ko) pras molduras e templates: Noto Sans TC/SC/JP/KR (@fontsource, OFL), pesos 600 e 900,
// em pedaços por unicode-range (o navegador só baixa os pedaços que o texto usa). Copia os .woff2 pra public/fonts/cjk/
// (vai no bundle: render local, Lambda e Player do web, que copia public/fonts inteiro) e gera:
//   src/fontes-cjk.ts          -> lista dos pedaços (arquivo + unicode-range) que o carregarFontesCJK registra
//   src/lib/metricas-cjk.ts    -> largura dos glifos CJK (medida no Chrome do render; padrão 1 em, exceções guardadas)
// Só os pedaços numerados (CJK); latin/cyrillic do Noto ficam de fora (o latino é Inter/Montserrat/…) e cada faixa é
// cortada a partir de U+2E80 (+ jamo do hangul), pra o Noto nunca ganhar do latino num caractere que o latino tem.
// Uso: node scripts/fontes-cjk.mjs
import puppeteer from 'puppeteer-core';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FONTES = { tc: 'noto-sans-tc', sc: 'noto-sans-sc', jp: 'noto-sans-jp', kr: 'noto-sans-kr' };
const PESOS = [600, 900];
const destino = path.join(raiz, 'public', 'fonts', 'cjk');
rmSync(destino, { recursive: true, force: true });

const faixasDe = (s) => s.split(',').map((x) => x.trim().replace(/^U\+/i, '')).map((x) => {
  const [a, b] = x.split('-');
  return [parseInt(a, 16), parseInt(b ?? a, 16)];
});
/** só o que é CJK: >= U+2E80, ou jamo do hangul (U+1100-11FF) */
const cortar = ([a, b]) => {
  const out = [];
  if (a <= 0x11ff && b >= 0x1100) out.push([Math.max(a, 0x1100), Math.min(b, 0x11ff)]);
  if (b >= 0x2e80) out.push([Math.max(a, 0x2e80), b]);
  return out;
};
const hex = (n) => n.toString(16);
const paraRange = (fs) => fs.map(([a, b]) => (a === b ? `U+${hex(a)}` : `U+${hex(a)}-${hex(b)}`)).join(',');

const pedacos = {};
for (const [k, pkg] of Object.entries(FONTES)) {
  const dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`));
  const uni = JSON.parse(readFileSync(path.join(dir, 'unicode.json'), 'utf8'));
  pedacos[k] = [];
  mkdirSync(path.join(destino, k), { recursive: true });
  for (const [chave, faixa] of Object.entries(uni)) {
    const m = /^\[(\d+)\]$/.exec(chave);
    if (!m) continue; // latin, cyrillic… ficam de fora
    const fs = faixasDe(faixa).flatMap(cortar);
    if (!fs.length) continue;
    const i = Number(m[1]);
    for (const w of PESOS) copyFileSync(path.join(dir, 'files', `${pkg}-${i}-${w}-normal.woff2`), path.join(destino, k, `${i}-${w}.woff2`));
    pedacos[k].push({ i, r: paraRange(fs), fs });
  }
}

// ── medida no Chrome do render ──
const chromeDir = path.join(raiz, 'node_modules', '.remotion', 'chrome-headless-shell');
const pl = readdirSync(chromeDir).find((d) => d !== 'VERSION');
const sub = readdirSync(path.join(chromeDir, pl)).find((d) => d.startsWith('chrome-headless-shell'));
const browser = await puppeteer.launch({ executablePath: path.join(chromeDir, pl, sub, 'chrome-headless-shell'), headless: true, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
const html = path.join(destino, '_medir.html');
writeFileSync(html, '<html><body></body></html>');
await page.goto(`file://${html}`);
const S = 1000;
const larguras = {};
const vertical = {};
for (const k of Object.keys(FONTES)) {
  larguras[k] = {};
  for (const w of PESOS) {
    const cps = pedacos[k].flatMap((p) => p.fs.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, j) => a + j)));
    const res = await page.evaluate(async (k, w, lista, cps, S) => {
      await Promise.all(lista.map(async (p) => {
        const f = new FontFace(`CJK${k}${w}`, `url(./${k}/${p.i}-${w}.woff2)`, { weight: String(w), unicodeRange: p.r });
        document.fonts.add(f);
        await f.load();
      }));
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${w} ${S}px CJK${k}${w}`;
      const out = [];
      for (const cp of cps) out.push(Math.round(ctx.measureText(String.fromCodePoint(cp)).width * 10) / 10);
      const mt = ctx.measureText('\u4e00');
      return { out, asc: mt.fontBoundingBoxAscent / S, desc: mt.fontBoundingBoxDescent / S };
    }, k, w, pedacos[k].map(({ i, r }) => ({ i, r })), cps, S);
    // exceções (≠ 1000) em faixas contíguas de mesma largura
    vertical[k] = { asc: Math.round(res.asc * 10000) / 10000, desc: Math.round(res.desc * 10000) / 10000 };
    const exc = [];
    cps.forEach((cp, j) => {
      const v = res.out[j];
      if (Math.abs(v - S) < 0.05) return;
      const u = exc[exc.length - 1];
      if (u && u[1] === cp - 1 && u[2] === v) u[1] = cp; else exc.push([cp, cp, v]);
    });
    larguras[k][w] = exc;
    console.log(`${k} ${w}: ${cps.length} glifos, ${exc.length} faixas fora de 1 em`);
  }
}

// validação: frases medidas no DOM (span) × soma da tabela (CJK sem kerning)
const FRASES = { tc: '為什麼我早上起床時比睡覺前更痛？', sc: '为什么我早上起床时比睡觉前更痛？', jp: 'なぜ朝起きると寝る前より痛いのか？', kr: '왜 아침에 일어나면 더 아플까요?' };
let pior = 0;
for (const k of Object.keys(FONTES)) {
  for (const w of PESOS) {
    const real = await page.evaluate((k, w, t) => {
      const n = document.createElement('span');
      n.style.cssText = `position:absolute;white-space:pre;font-size:100px;font-family:CJK${k}${w};font-weight:${w}`;
      n.textContent = t; document.body.appendChild(n); const r = n.getBoundingClientRect().width; n.remove(); return r;
    }, k, w, FRASES[k].replace(/[ ?]/g, ''));
    const t = [...FRASES[k].replace(/[ ?]/g, '')];
    const tab = t.reduce((a, c) => { const cp = c.codePointAt(0); const e = larguras[k][w].find(([x, y]) => cp >= x && cp <= y); return a + (e ? e[2] : S); }, 0) / 10;
    pior = Math.max(pior, Math.abs(real - tab) / real);
  }
}
await browser.close();
rmSync(html);
console.log(`pior erro relativo tabela × DOM (frases CJK): ${(pior * 100).toFixed(3)}%`);

writeFileSync(path.join(raiz, 'src', 'fontes-cjk.ts'), `// GERADO por scripts/fontes-cjk.mjs (não editar). Pedaços das Noto Sans TC/SC/JP/KR (OFL, @fontsource 5.3.1) em
// public/fonts/cjk/<fonte>/<i>-<peso>.woff2, com o unicode-range de cada um (só CJK: >= U+2E80 e jamo do hangul).
export const CJK_PESOS = ${JSON.stringify(PESOS)} as const;
export const CJK_PEDACOS: Record<'tc' | 'sc' | 'jp' | 'kr', { i: number; r: string }[]> = ${JSON.stringify(Object.fromEntries(Object.entries(pedacos).map(([k, v]) => [k, v.map(({ i, r }) => ({ i, r }))])))};
`);
writeFileSync(path.join(raiz, 'src', 'lib', 'metricas-cjk.ts'), `// GERADO por scripts/fontes-cjk.mjs (não editar). Largura dos glifos CJK (Noto Sans TC/SC/JP/KR, pesos ${PESOS.join('/')}),
// em 1/${S} em, medida no Chrome do render: padrão ${S} (largura cheia); aqui só as faixas [início, fim, largura] diferentes.
// Pior erro relativo tabela × DOM nas frases de validação: ${(pior * 100).toFixed(3)}%.
export const CJK_UNITS = ${S};
/** ascendente/descendente (em) de cada fonte CJK: altura da linha com line-height normal quando a linha tem CJK. */
export const CJK_VERTICAL: Record<'tc' | 'sc' | 'jp' | 'kr', { asc: number; desc: number }> = ${JSON.stringify(vertical)};
export const CJK_EXCECOES: Record<'tc' | 'sc' | 'jp' | 'kr', Record<${PESOS.join(' | ')}, [number, number, number][]>> = ${JSON.stringify(larguras)};
`);
console.log('ok');
