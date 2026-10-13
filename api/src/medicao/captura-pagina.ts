// variacao-auto-v1 §7.5: print da landing page pro SPLIT-LP. Chromium headless que já vai na imagem pro Remotion
// (REMOTION_BROWSER_EXECUTABLE) via puppeteer-core. Custo US$ 0. A medição não fala com o storage: o backend injeta `salvar`.
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../arquivos/storage.service';
import type { PageCaptureError, PageCaptureResult, PageCaptureService } from './contrato';

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

/** Chrome do Remotion: env, senão o que o `npx remotion browser ensure` deixou em node_modules/.remotion. */
export function acharNavegador(cfg: string | null): string | null {
  if (cfg && existsSync(cfg)) return cfg;
  const plat = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64') : process.platform === 'linux' ? (process.arch === 'arm64' ? 'linux-arm64' : 'linux64') : 'win64';
  const bin = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  const bases = [process.cwd(), path.resolve(__dirname, '..', '..'), path.resolve(process.cwd(), 'api')];
  for (const b of bases) {
    const p = path.join(b, 'node_modules', '.remotion', 'chrome-headless-shell', plat, `chrome-headless-shell-${plat}`, bin);
    if (existsSync(p)) return p;
  }
  return null;
}

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
  const inicio = Date.now();
  const resta = () => Math.max(500, teto - (Date.now() - inicio));
  const puppeteer = await import('puppeteer-core');
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'captura-'));
  const browser = await puppeteer.launch({
    executablePath, headless: true, userDataDir,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run'],
  });
  let estourou = false;
  const relogio = setTimeout(() => { estourou = true; void browser.close().catch(() => undefined); }, teto + 1000);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: CSS_W, height: CSS_H, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
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
      resp = await page.goto(alvo.href, { waitUntil: 'domcontentloaded', timeout: resta() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return /timeout/i.test(msg) ? erro('PAGE_TIMEOUT', null, msg.slice(0, 300)) : erro('PAGE_UNREADABLE', null, msg.slice(0, 300));
    }
    const status = resp?.status() ?? null;
    if (status && [401, 403, 407, 429, 451].includes(status)) return erro('PAGE_FORBIDDEN', status, `http ${status}`);
    if (status && status >= 400) return erro('PAGE_UNREADABLE', status, `http ${status}`);
    // imagens preguiçosas: desce as 3 telas e volta; espera a rede assentar (com teto)
    await page.waitForNetworkIdle({ idleTime: 400, timeout: Math.min(3000, resta() - 3000) }).catch(() => undefined);
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
    // muro anti-robô (Cloudflare e afins) com 200 = proibido na prática
    if (/just a moment|attention required|access denied|verify you are human|captcha/i.test(info.title + ' ' + info.text.slice(0, 300))) {
      return erro('PAGE_FORBIDDEN', status, `bloqueio: ${info.title.slice(0, 80)}`);
    }
    if (info.text.length < 20 && info.imagens === 0) return erro('PAGE_UNREADABLE', status, 'página vazia');
    const alturaCss = Math.min(Math.max(CSS_H, info.altura), CSS_H * TELAS);
    await page.screenshot({ path: outPath as `${string}.png`, type: 'png', clip: { x: 0, y: 0, width: CSS_W, height: alturaCss }, captureBeyondViewport: true });
    await stat(outPath);
    return { path: outPath, widthPx: CSS_W * DPR, heightPx: Math.round(alturaCss * DPR), text: info.text };
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
