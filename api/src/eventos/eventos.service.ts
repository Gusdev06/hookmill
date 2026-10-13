import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { AuthContext } from '../common/auth/auth-context';

/** Tipos de evento do SSE do criativo (docs/contratos/eventos.md §1). */
export type CreativeEventType =
  | 'snapshot'
  | 'creative.updated'
  | 'job.updated'
  | 'script.delta'
  | 'script.updated'
  | 'face.updated'
  | 'scene.updated'
  | 'take.updated' // §13.5
  | 'render.updated'
  | 'cost.updated'
  | 'editor.updated'; // editor-v1 §9

export interface SseMessage {
  event: CreativeEventType;
  data: unknown;
}

/** Monta o snapshot (CreativeDetail) ao conectar. O módulo de criativos (B2) registra o seu. */
export type SnapshotProvider = (creativeId: string, auth: AuthContext) => Promise<unknown | null>;

export const HEARTBEAT_MS = 20_000;
export const RENDER_MIN_INTERVAL_MS = 500; // render.updated: no máximo 2 eventos/s por criativo

/**
 * Barramento in-process por criativo (uma instância da API). O estado de verdade é o banco:
 * evento perdido não tem replay; o web refaz o GET e reabre o stream.
 */
@Injectable()
export class EventosService {
  private readonly channels = new Map<string, { subject: Subject<SseMessage>; subscribers: number }>();
  private readonly renderGate = new Map<string, { last: number; pending?: SseMessage; timer?: NodeJS.Timeout }>();
  private snapshotProvider: SnapshotProvider | null = null;

  registerSnapshotProvider(fn: SnapshotProvider) {
    this.snapshotProvider = fn;
  }

  getSnapshotProvider(): SnapshotProvider | null {
    return this.snapshotProvider;
  }

  /** Publica um evento pra quem está ouvindo o criativo. Sem ouvinte = descartado (não há replay). */
  publish(creativeId: string, event: Exclude<CreativeEventType, 'snapshot'>, data: unknown) {
    const msg: SseMessage = { event, data };
    if (event === 'render.updated') return this.publishThrottled(creativeId, msg);
    this.channels.get(creativeId)?.subject.next(msg);
  }

  private publishThrottled(creativeId: string, msg: SseMessage) {
    if (!this.channels.has(creativeId)) return;
    const gate = this.renderGate.get(creativeId) ?? { last: 0 };
    this.renderGate.set(creativeId, gate);
    const wait = gate.last + RENDER_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0 && !gate.timer) {
      gate.last = Date.now();
      this.channels.get(creativeId)?.subject.next(msg);
      return;
    }
    gate.pending = msg; // o mais recente vence
    if (!gate.timer) {
      gate.timer = setTimeout(() => {
        gate.timer = undefined;
        gate.last = Date.now();
        if (gate.pending) this.channels.get(creativeId)?.subject.next(gate.pending);
        gate.pending = undefined;
      }, Math.max(0, wait));
      gate.timer.unref?.();
    }
  }

  stream(creativeId: string): Observable<SseMessage> {
    return new Observable<SseMessage>((sub) => {
      let ch = this.channels.get(creativeId);
      if (!ch) {
        ch = { subject: new Subject<SseMessage>(), subscribers: 0 };
        this.channels.set(creativeId, ch);
      }
      ch.subscribers++;
      const s = ch.subject.subscribe(sub);
      return () => {
        s.unsubscribe();
        const c = this.channels.get(creativeId);
        if (c && --c.subscribers <= 0) {
          this.channels.delete(creativeId);
          const g = this.renderGate.get(creativeId);
          if (g?.timer) clearTimeout(g.timer);
          this.renderGate.delete(creativeId);
        }
      };
    });
  }

  listenerCount(creativeId: string): number {
    return this.channels.get(creativeId)?.subscribers ?? 0;
  }
}

export function formatSse(msg: SseMessage): string {
  return `event: ${msg.event}\ndata: ${JSON.stringify(msg.data)}\n\n`;
}
