import { Injectable } from '@nestjs/common';
import type { ChampionStatus } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Máquina do campeão (feature-2-variar-campeao.md §3.1). Nascimento: só link → RESOLVING; com upload → ANALYZING
 * (CHAMPION_ENTRY abaixo, gravado no create). Depois disso, só estas transições, todas compare-and-set.
 */
export const CHAMPION_TRANSITIONS = {
  /** link resolvido com vídeo e baixado */
  RESOLVED: { from: ['RESOLVING'], to: ['ANALYZING'] },
  /** AD_LIBRARY_UNAVAILABLE / AD_NOT_FOUND / AD_HAS_NO_VIDEO / MEDIA_INVALID (action: upload_video) */
  RESOLVE_FAILED: { from: ['RESOLVING'], to: ['FAILED'] },
  /** teardown pronto */
  ANALYSIS_DONE: { from: ['ANALYZING'], to: ['READY'] },
  /** transcrição, medição, Claude ou INTERRUPTED (action: analyze_again) */
  ANALYSIS_FAILED: { from: ['ANALYZING'], to: ['FAILED'] },
  /** PUT /champions/:id/video */
  ATTACH_VIDEO: { from: ['FAILED'], to: ['ANALYZING'] },
  /** POST /champions/:id/analyze */
  ANALYZE_AGAIN: { from: ['FAILED', 'READY'], to: ['ANALYZING'] },
  /** meta-v1 D13: campeão da Meta que falhou no download (sem vídeo) volta a baixar (retry do lote) */
  IMPORT_AGAIN: { from: ['FAILED'], to: ['RESOLVING'] },
} as const satisfies Record<string, { from: readonly ChampionStatus[]; to: readonly ChampionStatus[] }>;

export type ChampionEvent = keyof typeof CHAMPION_TRANSITIONS;
export const CHAMPION_EVENTS = Object.keys(CHAMPION_TRANSITIONS) as ChampionEvent[];

/** Estado de nascimento por origem (POST /champions). */
export const CHAMPION_ENTRY = { LINK_ONLY: 'RESOLVING', WITH_UPLOAD: 'ANALYZING' } as const satisfies Record<string, ChampionStatus>;

export function championAllowedFrom(event: ChampionEvent): ChampionStatus[] {
  return [...CHAMPION_TRANSITIONS[event].from];
}

export function championInvalidState(state: ChampionStatus, allowed: ChampionStatus[]): AppException {
  return new AppException('INVALID_STATE', { state, allowed: [...new Set(allowed)] });
}

export function assertChampionCan(state: ChampionStatus, event: ChampionEvent): void {
  if (!(CHAMPION_TRANSITIONS[event].from as readonly ChampionStatus[]).includes(state)) throw championInvalidState(state, championAllowedFrom(event));
}

type Db = Pick<PrismaService, 'champion'> | Prisma.TransactionClient;

/** ÚNICO escritor de champions.status. updateMany where { id, status in from, archivedAt null }; 0 linhas = 409. */
@Injectable()
export class ChampionStateMachine {
  constructor(private readonly prisma: PrismaService) {}

  async transition(input: {
    championId: string; event: ChampionEvent; to: ChampionStatus; from?: ChampionStatus;
    data?: Prisma.ChampionUncheckedUpdateManyInput; tx?: Prisma.TransactionClient;
  }): Promise<{ to: ChampionStatus }> {
    const def = CHAMPION_TRANSITIONS[input.event];
    if (!(def.to as readonly ChampionStatus[]).includes(input.to)) throw new Error(`transição inválida: ${input.event} → ${input.to}`);
    if (input.from && !(def.from as readonly ChampionStatus[]).includes(input.from)) throw new Error(`transição inválida: ${input.event} ${input.from} → ${input.to}`);
    const db: Db = input.tx ?? this.prisma;
    const fromSet = input.from ? [input.from] : championAllowedFrom(input.event);
    const r = await db.champion.updateMany({
      where: { id: input.championId, archivedAt: null, status: { in: fromSet } },
      data: { ...input.data, status: input.to },
    });
    if (r.count !== 1) {
      const cur = await db.champion.findUnique({ where: { id: input.championId }, select: { status: true, archivedAt: true } });
      if (!cur || cur.archivedAt) throw new AppException('NOT_FOUND');
      throw championInvalidState(cur.status, championAllowedFrom(input.event));
    }
    return { to: input.to };
  }
}
