// Backoff do cron de META_SYNC por conexão (revisão do arquiteto, 21/10): a Meta falhou → o cron espera 5 min, depois
// 15, 60 e no máximo 6 h antes de tentar de novo; sucesso zera. Em memória (reinício = tenta na hora, que é o desejado).
// Só o cron respeita; o "Sync now" manual continua livre (já tem o mínimo de 5 min do §3.2).

export const SYNC_BACKOFF_STEPS_MS: readonly number[] = [5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

export class SyncBackoff {
  private readonly state = new Map<string, { failures: number; nextAt: number }>();

  /** Quantas falhas seguidas (0 = saudável). */
  failures(connectionId: string): number {
    return this.state.get(connectionId)?.failures ?? 0;
  }

  /** Falha registrada: devolve quando o cron pode tentar de novo (ms epoch). */
  fail(connectionId: string, now = Date.now()): number {
    const failures = this.failures(connectionId) + 1;
    const wait = SYNC_BACKOFF_STEPS_MS[Math.min(failures, SYNC_BACKOFF_STEPS_MS.length) - 1];
    const nextAt = now + wait;
    this.state.set(connectionId, { failures, nextAt });
    return nextAt;
  }

  succeed(connectionId: string): void {
    this.state.delete(connectionId);
  }

  /** O cron pode disparar esta conexão agora? */
  allows(connectionId: string, now = Date.now()): boolean {
    const s = this.state.get(connectionId);
    return !s || now >= s.nextAt;
  }

  /** Quando o cron pode tentar (null = agora). */
  nextAt(connectionId: string): number | null {
    return this.state.get(connectionId)?.nextAt ?? null;
  }
}
