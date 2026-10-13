// Reconciliador (eventos.md §3): webhook perdido não trava cena. Com webhook ligado: a cada 2 min, tasks
// SUBMITTED há mais de 10 min. Com WAVESPEED_WEBHOOKS=off (dev sem túnel): a cada 15 s, qualquer task com
// mais de 10 s. Mais de 30 min sem terminar → TIMEOUT. Uma rodada por vez (sem sobreposição).
// Rosto (Higgsfield Soul V2, ~20 s): laço rápido próprio, só tasks HIGGSFIELD, a cada 5 s, TIMEOUT em 10 min.
// Sem webhook da Higgsfield por enquanto: o polling basta e não depende de URL pública.
import { Logger } from '@nestjs/common';
import type { TaskProvider } from '../portas';
import type { WaveSpeedGenerationService } from './generation.service';

export const RECONCILE = {
  withWebhooks: { everyMs: 120_000, minAgeMs: 600_000 },
  pollingOnly: { everyMs: 15_000, minAgeMs: 10_000 },
  timeoutMs: 30 * 60_000,
  higgsfield: { everyMs: 5_000, minAgeMs: 5_000, timeoutMs: 10 * 60_000 },
};

export class Reconciliador {
  private readonly log = new Logger('WaveSpeedReconciler');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly gen: Pick<WaveSpeedGenerationService, 'reconcile'>,
    private readonly webhooksOn: boolean,
    /** só as tasks deste provedor (laço rápido do rosto); ausente = todas */
    private readonly provider?: TaskProvider,
  ) {}

  get schedule(): { everyMs: number; minAgeMs: number } {
    if (this.provider === 'HIGGSFIELD') return { everyMs: RECONCILE.higgsfield.everyMs, minAgeMs: RECONCILE.higgsfield.minAgeMs };
    return this.webhooksOn ? RECONCILE.withWebhooks : RECONCILE.pollingOnly;
  }

  private get timeoutMs() {
    return this.provider === 'HIGGSFIELD' ? RECONCILE.higgsfield.timeoutMs : RECONCILE.timeoutMs;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.schedule.everyMs);
    this.timer.unref?.();
    void this.tick(); // boot: fecha o que terminou enquanto a API estava fora
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const n = await this.gen.reconcile({ minAgeMs: this.schedule.minAgeMs, timeoutMs: this.timeoutMs, ...(this.provider ? { provider: this.provider } : {}) });
      if (n) this.log.log(`${n} task(s) closed by polling`);
      return n;
    } catch (e) {
      this.log.error(`reconcile failed: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }
}
