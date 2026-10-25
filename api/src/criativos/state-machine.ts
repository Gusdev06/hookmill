import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { CreativeState } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Eventos da máquina de estados do criativo. A tabela abaixo é a de modelo-de-dados.md ("Transições (as únicas
 * válidas)") + os retornos a montante descritos logo depois dela (trocar roteiro/rosto com confirm, novo Generate
 * com confirm, api.md §9). Cada linha: de onde pode sair e pra onde pode ir.
 */
export const TRANSITIONS = {
  /** job de roteiros terminou: SUCCEEDED/PARTIAL (há roteiro READY) ou FAILED sem nenhum roteiro. Também o boot (INTERRUPTED). */
  SCRIPTS_JOB_DONE: { from: ['SCRIPTS_WRITING'], to: ['SCRIPTS_READY', 'SCRIPTS_FAILED'] },
  /** gerar/regerar roteiros */
  GENERATE_SCRIPTS: { from: ['SCRIPTS_READY', 'SCRIPTS_FAILED'], to: ['SCRIPTS_WRITING'] },
  /** escolher roteiro (pra AVATAR_PENDING, ou FACES_READY se já há rostos, ou ENGINE_PENDING se já há rosto escolhido) */
  SELECT_SCRIPT: { from: ['SCRIPTS_READY'], to: ['AVATAR_PENDING', 'FACES_READY', 'ENGINE_PENDING'] },
  /** trocar/editar o roteiro escolhido depois de AVATAR_PENDING (cenas e renders viram stale, com confirm se havia cenas) */
  RESELECT_SCRIPT: {
    from: ['AVATAR_PENDING', 'FACES_READY', 'FACES_FAILED', 'ENGINE_PENDING', 'SCENES_GENERATING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY'],
    to: ['AVATAR_PENDING', 'FACES_READY', 'ENGINE_PENDING'],
  },
  /** gerar 4 rostos */
  GENERATE_FACES: { from: ['AVATAR_PENDING', 'FACES_READY', 'FACES_FAILED'], to: ['FACES_GENERATING'] },
  /** lote terminou: ≥1 READY e nenhum pendente → FACES_READY; todos FAILED → FACES_FAILED */
  FACES_BATCH_DONE: { from: ['FACES_GENERATING'], to: ['FACES_READY', 'FACES_FAILED'] },
  /** escolher rosto */
  SELECT_FACE: { from: ['FACES_READY'], to: ['ENGINE_PENDING'] },
  /** trocar o rosto depois de ENGINE_PENDING (cenas e renders viram stale, com confirm se havia cenas) */
  RESELECT_FACE: {
    from: ['ENGINE_PENDING', 'SCENES_GENERATING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY'],
    to: ['ENGINE_PENDING'],
  },
  /** POST /generate */
  GENERATE: { from: ['ENGINE_PENDING'], to: ['SCENES_GENERATING'] },
  /** novo Generate depois de gerado (trocar motor), com confirm: cenas e renders anteriores viram stale */
  REGENERATE_ALL: { from: ['SCENES_FAILED', 'EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY'], to: ['SCENES_GENERATING'] },
  /** nenhuma cena pendente: todas READY → RENDERING (render automático); ≥1 FAILED → SCENES_FAILED */
  SCENES_SETTLED: { from: ['SCENES_GENERATING'], to: ['RENDERING', 'SCENES_FAILED'] },
  /** regerar uma cena (alvo READY ou FAILED) */
  REGENERATE_SCENE: {
    from: ['SCENES_GENERATING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY'],
    to: ['SCENES_GENERATING'],
  },
  /** POST /render */
  RENDER: { from: ['EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY'], to: ['RENDERING'] },
  /** render terminou: READY (ou EDIT_PENDING se os ajustes mudaram durante o render) ou FAILED */
  RENDER_FINISHED: { from: ['RENDERING'], to: ['RENDER_READY', 'EDIT_PENDING', 'RENDER_FAILED'] },
  /** mudar ajuste de edição com o vídeo pronto */
  EDIT_CHANGED: { from: ['RENDER_READY'], to: ['EDIT_PENDING'] },
  /** aprovar (exige editDirty = false) */
  APPROVE: { from: ['RENDER_READY'], to: ['APPROVED'] },
  /** pedir ajuste TEXT: volta pro Edit */
  CHANGE_TEXT: { from: ['RENDER_READY'], to: ['EDIT_PENDING'] },
  /** pedir ajuste SCENE/LINE: regera só a cena */
  CHANGE_SCENE: { from: ['RENDER_READY'], to: ['SCENES_GENERATING'] },
  /** pedir ajuste FACE: volta pro Avatar com cenas stale */
  CHANGE_FACE: { from: ['RENDER_READY'], to: ['FACES_READY'] },
  /** variacao-auto-v1 §3.3: peça AUTO nasce RENDERING no start do lote (criação; sem origem). Ver `initialState`. */
  AUTO_PIECE_START: { from: [], to: ['RENDERING'] },
  /** variacao-auto-v1 §3.3 (rev. 23/10 §14.2): peça AUTO com o 9:16 READY vai sozinha pra Library, na mesma transação do
   *  RENDER_READY. 4:5/1:1 são sob demanda depois disso e nunca mexem no estado (o criativo segue APPROVED). */
  AUTO_APPROVE: { from: ['RENDER_READY'], to: ['APPROVED'] },
} as const satisfies Record<string, { from: readonly CreativeState[]; to: readonly CreativeState[] }>;

export type CreativeEvent = keyof typeof TRANSITIONS;
export const CREATIVE_EVENTS = Object.keys(TRANSITIONS) as CreativeEvent[];

/** Evento interno (eventos.md §5): o SSE publica creative.updated. */
export const CREATIVE_CHANGED = 'creative.changed';

export function allowedFrom(event: CreativeEvent): CreativeState[] {
  return [...TRANSITIONS[event].from];
}

/** Estado de nascimento de um evento de criação (from vazio). Único jeito de criar criativo já num estado da máquina. */
export function initialState(event: 'AUTO_PIECE_START'): CreativeState {
  return TRANSITIONS[event].to[0];
}

export function canTransition(event: CreativeEvent, from: CreativeState, to: CreativeState): boolean {
  const t = TRANSITIONS[event];
  return (t.from as readonly CreativeState[]).includes(from) && (t.to as readonly CreativeState[]).includes(to);
}

export function invalidState(state: CreativeState, allowed: CreativeState[]): AppException {
  return new AppException('INVALID_STATE', { state, allowed: [...new Set(allowed)] });
}

/** Dentre os eventos de uma ação, o que aceita o estado atual; nenhum = 409 INVALID_STATE com a união dos permitidos. */
export function pickEvent(state: CreativeState, events: CreativeEvent[]): CreativeEvent {
  const ev = events.find((e) => (TRANSITIONS[e].from as readonly CreativeState[]).includes(state));
  if (!ev) throw invalidState(state, events.flatMap(allowedFrom));
  return ev;
}

/** Ação que não muda estado mas só vale em alguns estados (ex.: PATCH engine, PATCH edit). */
export function assertState(state: CreativeState, allowed: CreativeState[]): void {
  if (!allowed.includes(state)) throw invalidState(state, allowed);
}

type Db = Pick<PrismaService, 'creative'> | Prisma.TransactionClient;

export interface TransitionInput {
  creativeId: string;
  event: CreativeEvent;
  to: CreativeState;
  /** estado esperado exato; sem ele, qualquer origem do evento */
  from?: CreativeState;
  /** filtro extra do compare-and-set (ex.: editDirty = false no aprovar) */
  where?: Prisma.CreativeWhereInput;
  /** campos gravados junto com a troca de estado */
  data?: Prisma.CreativeUncheckedUpdateManyInput;
  /** dentro de uma transação: quem chama anuncia depois do commit (announce) */
  tx?: Prisma.TransactionClient;
}

/**
 * ÚNICO escritor de creatives.state. Toda troca é compare-and-set:
 *   updateMany where { id, state = <esperado>, archivedAt: null } → 0 linhas = alguém mudou antes (clique duplo) = 409.
 */
@Injectable()
export class CreativeStateMachine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventEmitter2,
  ) {}

  async transition(input: TransitionInput): Promise<{ to: CreativeState }> {
    const { creativeId, event, to } = input;
    const def = TRANSITIONS[event];
    if (!(def.to as readonly CreativeState[]).includes(to)) throw new Error(`transição inválida: ${event} → ${to}`);
    if (input.from && !canTransition(event, input.from, to)) throw new Error(`transição inválida: ${event} ${input.from} → ${to}`);
    const db: Db = input.tx ?? this.prisma;
    const fromSet = input.from ? [input.from] : allowedFrom(event);

    const now = new Date();
    const r = await db.creative.updateMany({
      where: { ...input.where, id: creativeId, archivedAt: null, state: { in: fromSet } },
      data: { ...input.data, state: to, stateChangedAt: now },
    });
    if (r.count !== 1) {
      const cur = await db.creative.findUnique({ where: { id: creativeId }, select: { state: true, archivedAt: true } });
      if (!cur || cur.archivedAt) throw new AppException('NOT_FOUND');
      throw invalidState(cur.state, allowedFrom(event));
    }
    if (!input.tx) this.announce(creativeId);
    return { to };
  }

  /** Avisa o SSE (creative.updated). Chamado depois do commit. */
  announce(creativeId: string): void {
    this.bus.emit(CREATIVE_CHANGED, { creativeId });
  }
}

/**
 * Feature 2 (§3.3): criativo de variação não aceita scripts/*, PATCH engine nem POST /generate. A alavanca é do lote;
 * mudar outra coisa contamina o teste. 409 INVALID_STATE com details.reason = 'variation_locked'.
 */
export function assertNotVariation(c: { state: CreativeState; origin: string }): void {
  if (c.origin === 'VARIATION') throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'variation_locked' });
}

/**
 * variacao-auto-v1 §3.3: peça AUTO (variationKind AUTO_EDIT) não aceita generate, scripts/*, engine, edit, render manual,
 * editor nem changes. O único ajuste depois de gerar é "In zip". 409 INVALID_STATE reason 'variation_locked'.
 */
export function assertNotAutoPiece(c: { state: CreativeState; variationKind?: string | null }): void {
  if (c.variationKind === 'AUTO_EDIT') throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'variation_locked' });
}

/**
 * Feature 2 (esclarecimento 5, 06/10): em variação, POST /generate só vale com engine, engineModel, voiceId e format
 * IGUAIS aos do criativo (refaz as cenas depois de um pedido FACE, com estimativa). Qualquer diferença = variation_locked.
 */
export function assertVariationGenerate(
  c: { state: CreativeState; origin: string; engine: string | null; engineModel: string | null; voiceId: string | null; format: string; variationKind?: string | null },
  dto: { engine: string; engineModel: string; voiceId?: string | null; format: string },
): void {
  assertNotAutoPiece(c);
  if (c.origin !== 'VARIATION') return;
  const same = dto.engine === c.engine && dto.engineModel === c.engineModel && (dto.voiceId ?? null) === (c.voiceId ?? null) && dto.format === c.format;
  if (!same) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'variation_locked' });
}
