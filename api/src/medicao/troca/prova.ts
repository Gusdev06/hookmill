// Prova da fonte no Chrome (troca-texto-queimado-v1 §16.2 A3). Dono: video.
// As palavras ORIGINAIS em cada candidata, no mesmo Chrome Linux que renderiza a peça (o G0 mediu Lambda = VPS no texto),
// quadro inteiro com fundo transparente. A régua (py/medir_headline.py, fase `regua`) compõe sobre o fundo medido e
// compara com o original. O CSS do texto é o do `BlocoTexto` da S4 (research_notes/s4-demo-2026-11-06/remotion): a V3
// leva o mesmo para o RemixKeep, senão a prova mede uma coisa e a peça desenha outra.
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acharNavegador } from '../../common/util/navegador';
import type { LayoutFonte } from './evento';

/** Borrão leve do texto (S4): caixa 0,6 px; solto 0,4 px. A V3 usa os mesmos valores no RemixKeep. */
export const SUAVIZA_PX = { box: 0.6, loose: 0.4 } as const;

export interface PedidoProva {
  fontId: string;
  lines: string[];
  layout: LayoutFonte;
  color: string;
  shadow: { dx: number; dy: number; blurPx: number; color: string } | null;
  suavizaPx: number;
  canvas: { width: number; height: number };
}

export interface StillProva { fontId: string; png: string /* data:image/png;base64, RGBA */ }

export interface ProvaChrome {
  renderizar(pedidos: PedidoProva[]): Promise<StillProva[]>;
}

/** Arquivo da fonte do catálogo: video/public/fonts/<família>-latin-<peso>-normal.woff2 (V1). */
export function arquivoDaFonte(fontesDir: string, fontId: string): string {
  const m = /^(.*)-(\d{3})$/.exec(fontId);
  if (!m) throw new Error(`fontId inválido: ${fontId}`);
  const f = path.join(fontesDir, `${m[1]}-latin-${m[2]}-normal.woff2`);
  if (f.includes('/System/Library')) throw new Error('fonte do sistema é proibida (§15.7.3)');
  return f;
}

/** Pasta das fontes: TROCA_FONTES_DIR, senão video/public/fonts do monorepo (src e dist ficam na mesma profundidade). */
export function pastaDeFontes(cfg?: string | null): string {
  const cands = [cfg, path.resolve(__dirname, '..', '..', '..', '..', 'video', 'public', 'fonts'),
    path.resolve(process.cwd(), '..', 'video', 'public', 'fonts'), path.resolve(process.cwd(), 'video', 'public', 'fonts')];
  for (const c of cands) if (c && existsSync(c)) return c;
  throw new Error('pasta de fontes não encontrada (TROCA_FONTES_DIR)');
}

/** HTML de 1 still. Exportado para o teste ler sem abrir o Chrome. */
export function htmlDaProva(p: PedidoProva, fonteB64: string): string {
  const fam = `P_${p.fontId.replace(/[^a-z0-9]/gi, '_')}`;
  const dados = JSON.stringify({ fam, lines: p.lines, lay: p.layout, color: p.color, shadow: p.shadow, blur: p.suavizaPx });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"${fam}";src:url(data:font/woff2;base64,${fonteB64}) format("woff2");font-weight:normal;font-style:normal}
html,body{margin:0;padding:0;background:transparent;width:${p.canvas.width}px;height:${p.canvas.height}px;overflow:hidden}
#t{position:absolute;inset:0}
.l{position:absolute;white-space:pre;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;font-kerning:normal;font-weight:normal}
</style></head><body><div id="t"></div><script>window.__dados=${dados};</script></body></html>`;
}

/** Roda na página: mesmo cálculo do BlocoTexto da S4 (medida do canvas, centro por linha, topo = base − ascendente). */
function montarNaPagina(): void {
  const d = (window as unknown as { __dados: { fam: string; lines: string[]; lay: LayoutFonte; color: string; shadow: PedidoProva['shadow']; blur: number } }).__dados;
  const t = document.getElementById('t')!;
  if (d.blur) t.style.filter = `blur(${d.blur}px)`;
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `normal ${d.lay.sz}px "${d.fam}"`;
  (c as unknown as { fontKerning: string }).fontKerning = 'normal';
  (c as unknown as { textRendering: string }).textRendering = 'geometricPrecision';
  d.lines.forEach((txt, i) => {
    const m = c.measureText(txt);
    const w = m.width + d.lay.tr * d.lay.sz * Math.max(0, txt.length - 1);
    const el = document.createElement('div');
    el.className = 'l';
    el.textContent = txt;
    el.style.fontFamily = `"${d.fam}"`;
    el.style.fontSize = `${d.lay.sz}px`;
    el.style.lineHeight = `${m.fontBoundingBoxAscent + m.fontBoundingBoxDescent}px`;
    el.style.left = `${d.lay.cxs[i] - w / 2}px`;
    el.style.top = `${d.lay.base + i * d.lay.pitch - m.fontBoundingBoxAscent}px`;
    el.style.color = d.color;
    if (d.lay.tr) el.style.letterSpacing = `${d.lay.tr}em`;
    if (d.shadow) el.style.textShadow = `${d.shadow.dx}px ${d.shadow.dy}px ${d.shadow.blurPx}px ${d.shadow.color}`;
    t.appendChild(el);
  });
}

export interface ProvaPuppeteerConfig {
  browserExecutable: string | null;
  fontesDir: string;
  timeoutMs?: number;
}

/** Prova pelo chrome-headless-shell da API (o mesmo do render local e, no texto, igual ao do Lambda: G0). */
export class ProvaPuppeteer implements ProvaChrome {
  constructor(private readonly cfg: ProvaPuppeteerConfig) {}

  async renderizar(pedidos: PedidoProva[]): Promise<StillProva[]> {
    if (!pedidos.length) return [];
    const executablePath = acharNavegador(this.cfg.browserExecutable);
    if (!executablePath) throw new Error('chrome-headless-shell não encontrado (REMOTION_BROWSER_EXECUTABLE)');
    const puppeteer = await import('puppeteer-core');
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'prova-'));
    const browser = await puppeteer.launch({
      executablePath, headless: true, userDataDir,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--font-render-hinting=none', '--force-color-profile=srgb'],
    });
    try {
      const out: StillProva[] = [];
      for (const p of pedidos) {
        const page = await browser.newPage();
        try {
          await page.setViewport({ width: p.canvas.width, height: p.canvas.height, deviceScaleFactor: 1 });
          const b64 = readFileSync(arquivoDaFonte(this.cfg.fontesDir, p.fontId)).toString('base64');
          await page.setContent(htmlDaProva(p, b64), { waitUntil: 'load', timeout: this.cfg.timeoutMs ?? 15_000 });
          const fam = `P_${p.fontId.replace(/[^a-z0-9]/gi, '_')}`;
          await page.evaluate(async (f: string, sz: number) => { await document.fonts.load(`${sz}px "${f}"`); await document.fonts.ready; }, fam, p.layout.sz);
          await page.evaluate(montarNaPagina);
          const png = await page.screenshot({ type: 'png', omitBackground: true, encoding: 'base64', clip: { x: 0, y: 0, width: p.canvas.width, height: p.canvas.height } });
          out.push({ fontId: p.fontId, png: `data:image/png;base64,${png}` });
        } finally {
          await page.close().catch(() => undefined);
        }
      }
      return out;
    } finally {
      await browser.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
