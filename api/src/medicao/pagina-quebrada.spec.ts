// Bug 25/10 (lote cmvnlm4yd000l22emdoob1j5a): captura da LP saiu como "Application error: a client-side exception has
// occurred" e virou referência do STATIC. Página quebrada por texto/status, por imagem (PNG de uma cor) e, com Chrome
// disponível, a captura de verdade de um HTML de erro × HTML bom (servidor local).
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { acharNavegador } from '../common/util/navegador';
import { capturarPagina } from './captura-pagina';
import { diagnosticarImagem, diagnosticarPagina, fracaoDaCorDominante, quaseUmaCor } from './pagina-quebrada';

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
jest.setTimeout(120_000);

const NEXT_ERRO = 'Application error: a client-side exception has occurred (see the browser console for more information).';
const BOA = 'Amnaya Life. Sleep better in 10 minutes a night. Guided routines for busy parents. Start your 7-day trial today. Real stories from 2,000 families.';

describe('diagnosticarPagina: texto e status', () => {
  it.each([
    [NEXT_ERRO, 'erro_do_app', true],
    ['Unhandled Runtime Error\nError: Hydration failed', 'erro_do_app', true],
    ['404\nThis page could not be found.', 'nao_encontrada', false],
    ['Internal Server Error', 'erro_do_servidor', true],
    ['502 Bad Gateway nginx', 'erro_do_servidor', true],
    ['404: NOT_FOUND Code: DEPLOYMENT_NOT_FOUND', 'nao_encontrada', false],
    ['Just a moment...\nEnable JavaScript and cookies to continue', 'bloqueio', true],
    ['Access denied | example.com used Cloudflare to restrict access', 'bloqueio', true],
    ['Loading', 'pouco_texto', true],
  ] as const)('%s → %s', (text, motivo, recuperavel) => {
    expect(diagnosticarPagina({ title: '', text, status: 200 })).toMatchObject({ ok: false, motivo, recuperavel });
  });
  it('status de erro e título; página boa passa (mesmo citando "404" no meio do texto)', () => {
    expect(diagnosticarPagina({ title: 'x', text: BOA, status: 503 })).toMatchObject({ ok: false, motivo: 'erro_do_servidor' });
    expect(diagnosticarPagina({ title: 'x', text: BOA, status: 404 })).toMatchObject({ ok: false, motivo: 'nao_encontrada' });
    expect(diagnosticarPagina({ title: 'Attention Required! | Cloudflare', text: BOA, status: 200 })).toMatchObject({ ok: false, motivo: 'bloqueio' });
    expect(diagnosticarPagina({ title: 'Amnaya', text: BOA, status: 200 })).toEqual({ ok: true, motivo: null, detalhe: null, recuperavel: false });
    expect(diagnosticarPagina({ title: 'Amnaya', text: `${BOA} ${'x '.repeat(400)} we fixed the 404 page not found bug`, status: 200 }).ok).toBe(true);
    expect(diagnosticarPagina({ title: '', text: '', imagens: 3 }).ok).toBe(true); // só imagem (a regra da cor decide)
  });
});

describe('diagnosticarImagem: PNG de uma cor × página com conteúdo', () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'pagina-quebrada-')); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  const png = async (nome: string, src: string, extra: string[] = []) => {
    const p = join(dir, nome);
    await run(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', src, ...extra, '-frames:v', '1', p]);
    return p;
  };
  it('branco com uma linha escura (a tela do "Application error") = quebrada; testsrc = ok', async () => {
    const erro = await png('erro.png', 'color=c=white:s=1080x1920', ['-vf', 'drawbox=x=100:y=900:w=880:h=40:color=black:t=fill']);
    const boa = await png('boa.png', 'testsrc2=size=1080x1920');
    expect(await diagnosticarImagem(erro)).toMatchObject({ ok: false, motivo: 'uma_cor', recuperavel: true });
    expect((await diagnosticarImagem(boa)).ok).toBe(true);
    expect((await diagnosticarImagem(join(dir, 'nao-existe.png'))).ok).toBe(true); // sem pixels = não decide
  });
  it('fração e limiar', () => {
    const uma = new Uint8Array(48 * 48 * 3).fill(250);
    expect(fracaoDaCorDominante(uma)).toBe(1);
    const metade = Uint8Array.from({ length: 48 * 48 * 3 }, (_, i) => (Math.floor(i / 3) % 2 ? 0 : 255));
    expect(fracaoDaCorDominante(metade)).toBeCloseTo(0.5, 2);
    expect([quaseUmaCor(0.99, 2000), quaseUmaCor(0.96, 100), quaseUmaCor(0.96, 2000), quaseUmaCor(0.8, 0)]).toEqual([true, true, false, false]);
  });
});

const chrome = acharNavegador(process.env.REMOTION_BROWSER_EXECUTABLE || null);
(chrome ? describe : describe.skip)('capturarPagina (Chrome local, HTML servido em 127.0.0.1)', () => {
  let server: Server;
  let base: string;
  let dir: string;
  const HTML: Record<string, string> = {
    // a página do Next depois que a hidratação quebra
    '/next-erro': `<html><head><title></title></head><body style="background:#fff"><div id="__next"></div>
      <script>setTimeout(()=>{document.body.innerHTML='<h2 style="font:14px sans-serif">${NEXT_ERRO}</h2>'},200)</script></body></html>`,
    '/cloudflare': '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing.</body></html>',
    '/boa': `<html><head><title>Amnaya</title></head><body style="margin:0;font:18px sans-serif">
      <section style="background:#2E7DFF;color:#fff;height:500px;padding:40px">${BOA}</section>
      <section style="background:#FF8A3D;height:500px;padding:40px">Guided routines</section>
      <section style="background:#111;color:#eee;height:500px;padding:40px">Start your 7-day trial today</section></body></html>`,
  };
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'captura-spec-'));
    server = createServer((req, res) => {
      const body = HTML[req.url ?? ''];
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
      res.end(body ?? 'nope');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const cfg = { browserExecutable: chrome, allowPrivateHosts: true, timeoutMs: 15_000 };
  it('erro do Next depois de hidratar → PAGE_UNREADABLE (2 tentativas); Cloudflare → PAGE_FORBIDDEN; página boa → PNG', async () => {
    const e = await capturarPagina(`${base}/next-erro`, join(dir, 'a.png'), cfg);
    expect(e).toMatchObject({ error: 'PAGE_UNREADABLE' });
    expect((e as { detail: string }).detail).toMatch(/erro_do_app/);
    expect(await capturarPagina(`${base}/cloudflare`, join(dir, 'b.png'), cfg)).toMatchObject({ error: 'PAGE_FORBIDDEN' });
    expect(await capturarPagina(`${base}/sumiu`, join(dir, 'c.png'), cfg)).toMatchObject({ error: 'PAGE_UNREADABLE', status: 404 });
    const ok = await capturarPagina(`${base}/boa`, join(dir, 'd.png'), cfg);
    expect(ok).toMatchObject({ path: join(dir, 'd.png'), widthPx: 1080 });
    expect((ok as { text: string }).text).toContain('Amnaya Life');
  });
});
