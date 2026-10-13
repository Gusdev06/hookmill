import type { RenderProgress } from './contrato';

/** Limita os avisos de progresso (eventos.md: no máximo 2 render.updated/s). Mudança de etapa e o 100% sempre passam. */
export function limitarProgresso(onProgress: (p: RenderProgress) => void, intervaloMs = 500, agora: () => number = Date.now) {
  let ultimoEm = -Infinity;
  let ultimo: RenderProgress | null = null;
  return (p: RenderProgress) => {
    const mudouEtapa = !ultimo || ultimo.stage !== p.stage;
    const fim = p.progress >= 100;
    const t = agora();
    if (!mudouEtapa && !fim && t - ultimoEm < intervaloMs) return;
    if (ultimo && !mudouEtapa && ultimo.progress === p.progress && ultimo.frame === p.frame) return;
    ultimoEm = t;
    ultimo = p;
    onProgress(p);
  };
}

/**
 * Progresso do renderMedia → contrato. `progress` é porcentagem inteira 0-100 (o Render da api.md mostra "%").
 * 'rendering' enquanto há frame por desenhar; 'encoding' depois (o Remotion codifica em paralelo e fecha o mux no fim).
 */
export function mapearProgresso(p: { progress: number; renderedFrames: number; encodedFrames: number }, totalFrames: number): RenderProgress {
  const stage = p.renderedFrames < totalFrames ? 'rendering' : 'encoding';
  return {
    stage,
    progress: Math.max(0, Math.min(100, Math.floor(p.progress * 100))),
    frame: Math.min(p.renderedFrames, totalFrames),
    totalFrames,
  };
}

/** Frame que falhou: o Remotion põe `frame` nos erros de JS da página; senão, tenta ler da mensagem. */
export function frameDoErro(err: unknown): number | null {
  const f = (err as { frame?: unknown } | null)?.frame;
  if (typeof f === 'number' && Number.isFinite(f)) return f;
  const msg = err instanceof Error ? err.message : String(err);
  const m = /frame[^0-9]{0,12}(\d+)/i.exec(msg);
  return m ? Number(m[1]) : null;
}
