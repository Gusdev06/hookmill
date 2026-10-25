import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RenderError, type RenderInput, type RenderPort, type RenderProgress, type RenderResult, type RenderService, type RenderSnapshot } from './contrato';
import { escolhaDeImpl } from './lambda/config';
import { RenderPorts } from './portas';
import { criarRenderPorts } from './render.module';
import { ServicoComoPorta } from './servico-como-porta';

const porta = (impl: 'local' | 'lambda' | 'fake') => ({ impl, templates: () => [] }) as unknown as RenderPort;
const env = (o: Record<string, string>) => (k: string) => o[k];

describe('escolha do adaptador (RENDER_IMPL + RENDER_LAMBDA_KINDS)', () => {
  it('remotion = local; vazio cai no padrão; kinds padrão = scratch', () => {
    expect(escolhaDeImpl(env({ RENDER_IMPL: 'remotion' })).impl).toBe('local');
    expect(escolhaDeImpl(env({}), 'fake').impl).toBe('fake');
    expect([...escolhaDeImpl(env({ RENDER_IMPL: 'lambda' })).lambdaKinds]).toEqual(['scratch']);
    expect(() => escolhaDeImpl(env({ RENDER_LAMBDA_KINDS: 'scratch,video' }))).toThrow(/video/);
  });

  it('lambda só pros kinds listados; o resto vai pro local; porImpl atende linha antiga (null = local)', () => {
    const p = new RenderPorts('lambda', new Set(['scratch', 'auto-edit']), { local: porta('local'), lambda: porta('lambda'), fake: porta('fake') });
    expect(p.para({}).impl).toBe('lambda');                     // sem kind = scratch
    expect(p.para({ kind: 'auto-edit' }).impl).toBe('lambda');
    expect(p.para({ kind: 'remix-keep' }).impl).toBe('local');
    expect(p.porImpl(null).impl).toBe('local');
    expect(p.porImpl('lambda').impl).toBe('lambda');
  });

  it('rollback: RENDER_IMPL=local mas lambda configurado → render novo no local, linha lambda ainda acompanhada', () => {
    const p = new RenderPorts('local', new Set(['scratch']), { local: porta('local'), lambda: porta('lambda') });
    expect(p.para({}).impl).toBe('local');
    expect(p.porImpl('lambda').impl).toBe('lambda');
  });

  it('criarRenderPorts: RENDER_IMPL=lambda sem função/site falha no boot; sem env lambda fica desligado', () => {
    const local = { templates: () => [], render: async () => { throw new Error('x'); } } as RenderService;
    expect(() => criarRenderPorts(env({ RENDER_IMPL: 'lambda' }), local)).toThrow(/REMOTION_LAMBDA_FUNCTION/);
    const p = criarRenderPorts(env({ RENDER_IMPL: 'local' }), local);
    expect(p.todos().map((x) => x.impl).sort()).toEqual(['fake', 'local']);
    expect(() => p.porImpl('lambda')).toThrow(/sem adaptador/);
    const l = criarRenderPorts(env({ RENDER_IMPL: 'lambda', REMOTION_LAMBDA_FUNCTION: 'f', REMOTION_SERVE_URL: 'https://s/index.html', RENDER_LAMBDA_WEBHOOK: 'off' }), local);
    expect(l.para({}).impl).toBe('lambda');
    expect(criarRenderPorts(env({ INTEGRACOES_MODE: 'mock' }), local).impl).toBe('fake');
  });
});

describe('ServicoComoPorta (adaptadores local e fake no formato novo)', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'porta-'));
  const servico = (falhar = false): RenderService => ({
    templates: () => [],
    render: async (input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> => {
      onProgress({ stage: 'rendering', progress: 50, frame: 30, totalFrames: 60 });
      await new Promise((r) => setTimeout(r, 20));
      if (falhar) throw new RenderError('RENDER_ERROR', 31, 'boom');
      onProgress({ stage: 'encoding', progress: 100, frame: 60, totalFrames: 60 });
      const outputPath = path.join(tmp, `${input.renderId}.mp4`);
      writeFileSync(outputPath, 'x');
      return { outputPath, posterPath: outputPath, durationSec: 2, width: 1080, height: 1920, sizeBytes: 1 };
    },
  });
  const input = { renderId: 'r1' } as RenderInput;

  it('submit devolve na hora; onEvent avisa progresso (teto 99) e o fim; finalize devolve o RenderResult', async () => {
    const p = new ServicoComoPorta('local', servico());
    const eventos: RenderSnapshot[] = [];
    p.onEvent((_id, s) => eventos.push(s));
    const sub = await p.submit(input, { attempt: 0, webhookUrl: null });
    expect(sub).toEqual({ impl: 'local', externalId: 'r1', bucket: null, serveUrl: null, attempt: 0 });
    const r = await p.finalize(input, sub);
    expect(r.durationSec).toBe(2);
    expect(eventos.map((e) => [e.state, e.progress.progress])).toEqual([['running', 50], ['running', 99], ['done', 99]]);
    await p.release(input, sub);
    expect((await p.snapshot(sub)).error?.retryable).toBe(true); // esquecido = como depois de um restart
  });

  it('falha vira snapshot failed com o frame; finalize lança o RenderError', async () => {
    const p = new ServicoComoPorta('fake', servico(true));
    const sub = await p.submit(input, { attempt: 0, webhookUrl: null });
    await expect(p.finalize(input, sub)).rejects.toMatchObject({ failedFrame: 31 });
    expect(await p.snapshot(sub)).toMatchObject({ state: 'failed', error: { failedFrame: 31, retryable: false } });
  });
});
