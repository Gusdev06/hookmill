// variacao-auto-v1 §7.5: print da landing page pro SPLIT-LP. Chromium headless que já vai na imagem pro Remotion
// (REMOTION_BROWSER_EXECUTABLE) via puppeteer-core. Custo US$ 0. A medição não fala com o storage: o backend injeta `salvar`.
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../arquivos/storage.service';
import { acharNavegador } from '../common/util/navegador';
import type { PageCaptureError, PageCaptureResult, PageCaptureService } from './contrato';
import { diagnosticarImagem, diagnosticarPagina } from './pagina-quebrada';

export interface PageCaptureConfig {
  browserExecutable: string | null;     // REMOTION_BROWSER_EXECUTABLE (vazio = o chrome-headless-shell que o Remotion baixou)
  timeoutMs?: number;                   // teto da captura inteira (15 s)
  /** Só testes: libera localhost/rede privada (HTML de fixture). Em produção fica false (SSRF). */
  allowPrivateHosts?: boolean;
}

/** Arquivo local da captura: PNG 1080 px de largura (viewport de celular 540 css × DPR 2), até 3 telas de altura. */
export interface PageCaptureFile { path: string; widthPx: number; heightPx: number; text: string }

const CSS_W = 540, CSS_H = 960, DPR = 2, TELAS = 3, TEXTO_MAX = 4000;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Resolução do binário compartilhada com o briefing (`common/util/navegador.ts`); re-exportada pra quem já importava daqui. */
export { acharNavegador };

const privado = (ip: string): boolean => {
  if (isIP(ip) === 6) return ip === '::1' || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith('::ffff:') && privado(ip.slice(7));
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
};

const erro = (error: PageCaptureError['error'], status: number | null, detail: string): PageCaptureError => ({ error, status, detail });

/** Captura pra arquivo local (sem storage). `outPath` = .png. */
export async function capturarPagina(url: string, outPath: string, cfg: PageCaptureConfig): Promise<PageCaptureFile | PageCaptureError> {
  let alvo: URL;
  try { alvo = new URL(url); } catch { return erro('PAGE_UNREADABLE', null, 'url inválida'); }
  if (!/^https?:$/.test(alvo.protocol)) return erro('PAGE_UNREADABLE', null, `protocolo ${alvo.protocol}`);
  const host = alvo.hostname.replace(/^\[|\]$/g, '');
  if (!cfg.allowPrivateHosts) {
    try {
      const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
      if (!ips.length || ips.some(privado)) return erro('PAGE_FORBIDDEN', null, `host privado: ${host}`);
    } catch (e) {
      return erro('PAGE_UNREADABLE', null, `dns: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const executablePath = acharNavegador(cfg.browserExecutable);
  if (!executablePath) return erro('PAGE_UNREADABLE', null, 'chrome-headless-shell não encontrado (REMOTION_BROWSER_EXECUTABLE)');

  const teto = cfg.timeoutMs ?? 15_000;
  const puppeteer = await import('puppeteer-core');
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'captura-'));
  const browser = await puppeteer.launch({
    executablePath, headless: true, userDataDir,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run'],
  });
  let estourou = false;
  const relogio = setTimeout(() => { estourou = true; void browser.close().catch(() => undefined); }, teto * TENTATIVAS.length + 1000);
  let ultimo: PageCaptureError = erro('PAGE_UNREADABLE', null, 'sem tentativa');
  try {
    // bug 25/10: página que quebra ao hidratar (Next "Application error") ou muro anti-robô não pode virar captura válida.
    // 1ª tentativa = celular; se a página veio quebrada mas pode se recuperar, 2ª com mais espera e user-agent de desktop.
    for (const t of TENTATIVAS) {
      const r = await tentarCaptura(browser, alvo, outPath, cfg, t, teto);
      if (!('error' in r)) return r;
      ultimo = r;
      if (!r.recuperavel) break;
    }
    return { error: ultimo.error, status: ultimo.status, detail: ultimo.detail };
  } catch (e) {
    if (estourou) return erro('PAGE_TIMEOUT', null, `passou de ${teto} ms`);
    const msg = e instanceof Error ? e.message : String(e);
    return /timeout/i.test(msg) ? erro('PAGE_TIMEOUT', null, msg.slice(0, 300)) : erro('PAGE_UNREADABLE', null, msg.slice(0, 300));
  } finally {
    clearTimeout(relogio);
    await browser.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Como cada tentativa abre a página (a 2ª espera mais e se apresenta como desktop). */
interface Tentativa { ua: string; esperaMs: number; waitUntil: 'domcontentloaded' | 'load' }
const TENTATIVAS: Tentativa[] = [
  { ua: UA, esperaMs: 800, waitUntil: 'domcontentloaded' },
  { ua: UA_DESKTOP, esperaMs: 2500, waitUntil: 'load' },
];

type Falha = PageCaptureError & { recuperavel: boolean };

/** Uma tentativa numa aba nova. Página quebrada (texto de erro, status, pouco texto, tela de uma cor) = falha. */
async function tentarCaptura(
  browser: import('puppeteer-core').Browser, alvo: URL, outPath: string, cfg: PageCaptureConfig, t: Tentativa, teto: number,
): Promise<PageCaptureFile | Falha> {
  const inicio = Date.now();
  const resta = () => Math.max(500, teto - (Date.now() - inicio));
  const falha = (error: PageCaptureError['error'], status: number | null, detail: string, recuperavel: boolean): Falha => ({ error, status, detail, recuperavel });
  const page = await browser.newPage();
  try {
    await page.setUserAgent(t.ua);
    await page.setViewport({ width: CSS_W, height: CSS_H, deviceScaleFactor: DPR, isMobile: t.ua === UA, hasTouch: t.ua === UA });
    if (!cfg.allowPrivateHosts) {
      // sub-recursos pra IP privado literal também saem (SSRF pelo HTML da página)
      await page.setRequestInterception(true);
      page.on('request', (r) => {
        try { const h = new URL(r.url()).hostname.replace(/^\[|\]$/g, ''); if (isIP(h) && privado(h)) return void r.abort(); } catch { /* data:, blob: */ }
        void r.continue();
      });
    }
    let resp;
    try {
      resp = await page.goto(alvo.href, { waitUntil: t.waitUntil, timeout: resta() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return /timeout/i.test(msg) ? falha('PAGE_TIMEOUT', null, msg.slice(0, 300), false) : falha('PAGE_UNREADABLE', null, msg.slice(0, 300), false);
    }
    const status = resp?.status() ?? null;
    if (status && [401, 403, 407, 429, 451].includes(status)) return falha('PAGE_FORBIDDEN', status, `http ${status}`, false);
    if (status && status >= 400) return falha('PAGE_UNREADABLE', status, `http ${status}`, status >= 500);
    // hidratação: rede assentar + readyState complete + uma espera (o "Application error" do Next aparece DEPOIS do JS rodar)
    await page.waitForNetworkIdle({ idleTime: 400, timeout: Math.min(3000, resta() - 3000) }).catch(() => undefined);
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: Math.min(3000, resta() - 2500) }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, Math.min(t.esperaMs, Math.max(0, resta() - 2500))));
    // imagens preguiçosas: desce as 3 telas e volta; espera a rede assentar (com teto)
    await page.evaluate(async (passo: number, telas: number) => {
      for (let i = 1; i <= telas; i++) { window.scrollTo(0, passo * i); await new Promise((r) => setTimeout(r, 150)); }
      window.scrollTo(0, 0);
    }, CSS_H, TELAS).catch(() => undefined);
    await page.waitForNetworkIdle({ idleTime: 300, timeout: Math.min(2000, resta() - 2500) }).catch(() => undefined);
    const info = await page.evaluate((max: number) => ({
      title: document.title || '',
      text: (document.body?.innerText || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max),
      altura: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
      imagens: document.images.length,
    }), TEXTO_MAX);
    const d = diagnosticarPagina({ title: info.title, text: info.text, status, imagens: info.imagens });
    if (!d.ok) {
      return falha(d.motivo === 'bloqueio' ? 'PAGE_FORBIDDEN' : 'PAGE_UNREADABLE', status, `página quebrada (${d.motivo}): ${d.detalhe}`.slice(0, 300), d.recuperavel);
    }
    const alturaCss = Math.min(Math.max(CSS_H, info.altura), CSS_H * TELAS);
    await page.screenshot({ path: outPath as `${string}.png`, type: 'png', clip: { x: 0, y: 0, width: CSS_W, height: alturaCss }, captureBeyondViewport: true });
    await stat(outPath);
    const img = await diagnosticarImagem(outPath, info.text.length);
    if (!img.ok) return falha('PAGE_UNREADABLE', status, `página quebrada (${img.motivo}): ${img.detalhe}`, true);
    return { path: outPath, widthPx: CSS_W * DPR, heightPx: Math.round(alturaCss * DPR), text: info.text };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * PageCaptureService (§7.5). O backend injeta `salvar` (sobe o PNG como File PAGE_CAPTURE do workspace e devolve o id).
 * O arquivo local é apagado depois de salvo. Falha nunca lança: devolve { error, status }.
 */
export class PuppeteerPageCaptureService implements PageCaptureService {
  constructor(
    private readonly cfg: PageCaptureConfig,
    private readonly salvar: (i: { workspaceId: string; path: string; mimeType: 'image/png'; widthPx: number; heightPx: number }) => Promise<{ fileId: string }>,
  ) {}

  async capture(i: { workspaceId: string; url: string }): Promise<PageCaptureResult> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pagina-'));
    try {
      const r = await capturarPagina(i.url, path.join(dir, 'pagina.png'), this.cfg);
      if ('error' in r) return r;
      const { fileId } = await this.salvar({ workspaceId: i.workspaceId, path: r.path, mimeType: 'image/png', widthPx: r.widthPx, heightPx: r.heightPx });
      return { fileId, widthPx: r.widthPx, heightPx: r.heightPx, text: r.text };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Provider pronto pro Nest (o iteracao liga numa linha: `{ provide: PAGE_CAPTURE, ...pageCaptureProvider }`). Sobe o PNG
 * pelo StorageService (global) como File PAGE_CAPTURE do workspace. Chrome = REMOTION_BROWSER_EXECUTABLE.
 */
export const pageCaptureProvider = {
  inject: [StorageService, ConfigService],
  useFactory: (storage: StorageService, cfg: ConfigService): PageCaptureService =>
    new PuppeteerPageCaptureService(
      { browserExecutable: cfg.get<string>('REMOTION_BROWSER_EXECUTABLE') || null },
      async ({ workspaceId, path: arquivo, mimeType, widthPx, heightPx }) => {
        const f = await storage.put(arquivo, { workspaceId, kind: 'PAGE_CAPTURE', mimeType, meta: { width: widthPx, height: heightPx } });
        return { fileId: f.id };
      },
    ),
};
