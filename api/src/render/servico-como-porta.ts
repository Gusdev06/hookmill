import {
  RenderError,
  type RenderImpl,
  type RenderInput,
  type RenderPort,
  type RenderProgress,
  type RenderResult,
  type RenderService,
  type RenderSnapshot,
  type RenderSubmission,
} from './contrato';

interface Corrida { snap: RenderSnapshot; promessa: Promise<RenderResult> }

/**
 * Adaptadores `local` e `fake` da RenderPort (render-lambda-v1 §6.1): embrulham um RenderService de hoje
 * (RemotionRenderService ou FakeRenderService) sem mudar o comportamento dele. O `submit` põe na fila interna do serviço
 * (FilaLimitada / RENDER_CONCURRENCY) e devolve na hora; o progresso vai pelo `onEvent` e pelo `snapshot` (memória do
 * processo); o `finalize` espera a promessa e devolve o RenderResult já em disco.
 * Restart da API: a memória some, o `snapshot` devolve `failed` retryable e a recuperação põe de volta em QUEUED (§2.7).
 */
export class ServicoComoPorta implements RenderPort {
  private readonly corridas = new Map<string, Corrida>();
  private readonly ouvintes: ((renderId: string, snap: RenderSnapshot) => void)[] = [];

  constructor(readonly impl: Exclude<RenderImpl, 'lambda'>, private readonly servico: RenderService) {}

  templates() { return this.servico.templates(); }

  onEvent(fn: (renderId: string, snap: RenderSnapshot) => void) { this.ouvintes.push(fn); }

  private avisar(id: string, snap: RenderSnapshot) {
    for (const fn of this.ouvintes) {
      try { fn(id, snap); } catch { /* ouvinte não derruba o render */ }
    }
  }

  async submit(input: RenderInput, o: { attempt: number; webhookUrl: string | null }): Promise<RenderSubmission> {
    const id = input.renderId;
    const inicial: RenderProgress = { stage: 'bundling', progress: 0, frame: 0, totalFrames: 0 };
    const corrida: Corrida = { snap: { state: 'running', progress: inicial, costUsd: null, error: null }, promessa: null as never };
    corrida.promessa = this.servico.render(input, (p) => {
      // teto 99 enquanto não há arquivo: o 100 é do READY (render-lambda-v1 §2.8)
      corrida.snap = { ...corrida.snap, progress: { ...p, progress: Math.min(99, p.progress) } };
      this.avisar(id, corrida.snap);
    });
    corrida.promessa.then(
      () => {
        corrida.snap = { ...corrida.snap, state: 'done', progress: { ...corrida.snap.progress, stage: 'encoding', progress: 99 } };
        this.avisar(id, corrida.snap);
      },
      (e: unknown) => {
        const failedFrame = e instanceof RenderError ? e.failedFrame : null;
        corrida.snap = { ...corrida.snap, state: 'failed', error: { message: e instanceof Error ? e.message : String(e), failedFrame, retryable: false } };
        this.avisar(id, corrida.snap);
      },
    );
    this.corridas.set(id, corrida);
    return { impl: this.impl, externalId: id, bucket: null, serveUrl: null, attempt: o.attempt };
  }

  async snapshot(sub: RenderSubmission): Promise<RenderSnapshot> {
    const c = this.corridas.get(sub.externalId);
    if (c) return c.snap;
    return {
      state: 'failed', costUsd: null,
      progress: { stage: 'bundling', progress: 0, frame: 0, totalFrames: 0 },
      error: { message: `render ${this.impl} perdido (API reiniciou)`, failedFrame: null, retryable: true },
    };
  }

  async finalize(_input: RenderInput, sub: RenderSubmission): Promise<RenderResult> {
    const c = this.corridas.get(sub.externalId);
    if (!c) throw new RenderError('RENDER_ERROR', null, `render ${this.impl} perdido (API reiniciou)`);
    return c.promessa;
  }

  async release(_input: RenderInput, sub: RenderSubmission): Promise<void> {
    this.corridas.delete(sub.externalId);
  }
}

