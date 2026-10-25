import { Injectable } from '@nestjs/common';
import { BRAIN_CACHE_TTL_SEC } from './brain.montagem';

/** Intervalo mínimo entre dois `?fresh=1` do mesmo workspace (§1.3); dentro dele, serve o cache. */
export const BRAIN_FRESH_MIN_MS = 10_000;

/**
 * brain-3d-v1 §1.3: cache em memória no processo, TTL 60 s, sem invalidação ativa (uma instância na VPS).
 * Chaves começam por `<workspaceId>|` (o `fresh` derruba as do workspace). Expira na leitura; varre ao passar de 500.
 */
@Injectable()
export class BrainCache {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();
  private readonly lastFresh = new Map<string, number>();
  ttlMs = BRAIN_CACHE_TTL_SEC * 1000;
  /** relógio (teste troca) */
  now: () => number = () => Date.now();

  get<T>(key: string): T | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value as T;
  }

  set<T>(key: string, value: T): T {
    if (this.entries.size > 500) {
      const t = this.now();
      for (const [k, e] of this.entries) if (e.expiresAt <= t) this.entries.delete(k);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }

  /**
   * `?fresh=1`: derruba o cache do workspace se o último fresh foi há ≥ 10 s e devolve true;
   * senão devolve false (o chamador serve o cache).
   */
  tryFresh(workspaceId: string): boolean {
    const t = this.now();
    const last = this.lastFresh.get(workspaceId);
    if (last != null && t - last < BRAIN_FRESH_MIN_MS) return false;
    this.lastFresh.set(workspaceId, t);
    for (const k of [...this.entries.keys()]) if (k.startsWith(`${workspaceId}|`)) this.entries.delete(k);
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.lastFresh.clear();
  }
}
