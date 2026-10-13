import type { ChipStatus, CreativeFilter, CreativeState, Step, StepInfo } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';

/**
 * Etapa (step) e chip (status) são DERIVADOS do estado (modelo-de-dados.md, tabela da máquina de estados).
 * Funções puras: nenhuma outra parte do backend decide step/status por conta própria.
 */
export const STEPS: Step[] = ['offer', 'scripts', 'avatar', 'engine', 'generation', 'edit', 'review'];

export const STATE_VIEW: Record<CreativeState, { step: Step | 'library'; status: Exclude<ChipStatus, 'draft'> }> = {
  SCRIPTS_WRITING: { step: 'scripts', status: 'progress' },
  SCRIPTS_READY: { step: 'scripts', status: 'waiting' },
  SCRIPTS_FAILED: { step: 'scripts', status: 'failed' },
  AVATAR_PENDING: { step: 'avatar', status: 'waiting' },
  FACES_GENERATING: { step: 'avatar', status: 'progress' },
  FACES_READY: { step: 'avatar', status: 'waiting' },
  FACES_FAILED: { step: 'avatar', status: 'failed' },
  ENGINE_PENDING: { step: 'engine', status: 'waiting' },
  SCENES_GENERATING: { step: 'generation', status: 'progress' },
  SCENES_FAILED: { step: 'generation', status: 'failed' },
  EDIT_PENDING: { step: 'edit', status: 'waiting' },
  RENDERING: { step: 'edit', status: 'progress' },
  RENDER_FAILED: { step: 'edit', status: 'failed' },
  RENDER_READY: { step: 'review', status: 'waiting' },
  APPROVED: { step: 'library', status: 'approved' },
};

export const ALL_STATES = Object.keys(STATE_VIEW) as CreativeState[];
export const statesWith = (status: ChipStatus): CreativeState[] => ALL_STATES.filter((s) => STATE_VIEW[s].status === status);

/** `draft` não é estado: AVATAR_PENDING/ENGINE_PENDING sem mexida há mais de 7 dias. */
export const DRAFT_STATES: CreativeState[] = ['AVATAR_PENDING', 'ENGINE_PENDING'];
export const DRAFT_AFTER_MS = 7 * 86_400_000;

export function isDraft(state: CreativeState, updatedAt: Date, now = Date.now()): boolean {
  return DRAFT_STATES.includes(state) && now - updatedAt.getTime() > DRAFT_AFTER_MS;
}

export function stepOf(state: CreativeState): Step | 'library' {
  return STATE_VIEW[state].step;
}

export function statusOf(state: CreativeState, updatedAt: Date, now = Date.now()): ChipStatus {
  return isDraft(state, updatedAt, now) ? 'draft' : STATE_VIEW[state].status;
}

/** Chave i18n do texto do chip, ex. "status.scenes_generating" (draft → "status.draft"). */
export function statusKeyOf(state: CreativeState, status: ChipStatus): string {
  return status === 'draft' ? 'status.draft' : `status.${state.toLowerCase()}`;
}

/** As 7 etapas do trilho, na ordem, com o estado visual de cada uma. */
export function stepsOf(state: CreativeState): StepInfo[] {
  const { step, status } = STATE_VIEW[state];
  if (step === 'library') return STEPS.map((s) => ({ step: s, state: 'done' }));
  const at = STEPS.indexOf(step);
  return STEPS.map((s, i) => ({
    step: s,
    state: i < at ? 'done' : i > at ? 'todo' : status === 'progress' ? 'progress' : status === 'failed' ? 'failed' : 'current',
  }));
}

/** Filtros da Home: progress = chip progress; needs_you = waiting + failed (rascunho não conta); approved. */
export function filterStates(filter: CreativeFilter): CreativeState[] | null {
  switch (filter) {
    case 'progress':
      return statesWith('progress');
    case 'needs_you':
      return [...statesWith('waiting'), ...statesWith('failed')];
    case 'approved':
      return statesWith('approved');
    default:
      return null;
  }
}

/**
 * where de cada filtro da Home (needs_you não conta rascunho parado há 7+ dias). Única fonte da regra: a lista da Home,
 * os `counts` e o `waitingOnYou` (Home e Clients, fase2-agencia.md §3.6) usam esta função.
 */
export function filterWhere(filter: CreativeFilter, now = Date.now()): Prisma.CreativeWhereInput {
  const states = filterStates(filter);
  if (!states) return {};
  const where: Prisma.CreativeWhereInput = { state: { in: states } };
  if (filter === 'needs_you') {
    where.NOT = { state: { in: DRAFT_STATES }, updatedAt: { lt: new Date(now - DRAFT_AFTER_MS) } };
    // variacao-auto-v1 §5.4: peça AUTO não conta (a falha é cobrada pelo lote, senão conta duas vezes). OR com null
    // explícito: `NOT variationKind = X` no SQL descarta as linhas com variationKind nulo (os criativos do zero).
    where.OR = [{ variationKind: null }, { variationKind: { not: 'AUTO_EDIT' } }];
  }
  return where;
}
