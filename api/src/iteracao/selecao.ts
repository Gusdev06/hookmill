import type { AutoVariationType, IterateAnswers, IterateBatch, IteratePreferences, IterateWant, VariationAxis, VariationSelection } from '@maquina/contratos';
import { AppException } from '../common/errors/app-exception';

export const FREE_WANTS: IterateWant[] = ['headline', 'frames', 'static', 'chat_motion'];
export const DEFAULT_ANSWERS: IterateAnswers = { goal: 'auto', ai: 'free_only', aiCapUsd: null, aiCapCredits: null, wants: [] };
export const WANT_OF: Partial<Record<AutoVariationType, IterateWant>> = {
  HEADLINE: 'headline', FRAME: 'frames', STATIC: 'static', CHAT_DM: 'chat_motion', PERSON_MOTION: 'chat_motion',
};

/** Validate persisted preferences as well as request bodies; no implicit coercion of spend limits. */
export function validateAnswers(value: unknown, aiEnabled = false): IterateAnswers {
  const a = value as IterateAnswers | null;
  const invalid = (field: string, rule: string): never => { throw new AppException('VALIDATION_ERROR', { fields: [{ field, rule }] }); };
  if (!a || typeof a !== 'object' || Array.isArray(a)) return invalid('answers', 'object');
  if (!['stretch', 'new_audience', 'both', 'auto'].includes(a.goal)) return invalid('answers.goal', 'enum');
  if (!['free_only', 'yes', 'auto'].includes(a.ai)) return invalid('answers.ai', 'enum');
  if (a.aiCapCredits !== null) return invalid('answers.aiCapCredits', 'null');
  if (a.aiCapUsd !== null) {
    if (a.ai !== 'yes') return invalid('answers.aiCapUsd', 'cap_needs_yes');
    if (typeof a.aiCapUsd !== 'number' || !Number.isFinite(a.aiCapUsd) || a.aiCapUsd < 1 || a.aiCapUsd > 1000) return invalid('answers.aiCapUsd', 'cap_range');
  }
  if (!Array.isArray(a.wants) || a.wants.some((w) => ![...FREE_WANTS, 'face', 'format'].includes(w))) return invalid('answers.wants', 'enum');
  if (a.wants.some((w) => w === 'face' || w === 'format')) {
    if (a.ai === 'free_only') return invalid('answers.wants', 'wants_need_ai');
    if (!aiEnabled) return invalid('answers.wants', 'ai_not_enabled');
  }
  return { goal: a.goal, ai: a.ai, aiCapUsd: a.aiCapUsd, aiCapCredits: null, wants: [...new Set(a.wants)] };
}

export function preferencesOf(value: unknown): IteratePreferences | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as IteratePreferences;
  try { validateAnswers(p); } catch { return null; }
  return typeof p.savedAt === 'string' && !!p.savedBy?.id && typeof p.fromBatchId === 'string' ? p : null;
}

export function selectionInfo(answers: IterateAnswers): NonNullable<IterateBatch['selectionInfo']> {
  const goal = answers.goal === 'auto' ? 'both' : answers.goal;
  return { goal, goalReasonKey: answers.goal === 'auto' ? 'auto_default' : null, stretchMax: goal === 'stretch' ? 6 : goal === 'new_audience' ? 2 : 4 };
}

export interface SelectionCandidate { autoType: AutoVariationType | null; axis: VariationAxis | null; priority?: number | null; index: number }

/** Pure re-selection: priority comes from the planner; changes never make another LLM request. */
export function selectPieces<T extends SelectionCandidate>(candidates: readonly T[], answers: IterateAnswers) {
  const info = selectionInfo(answers);
  let stretch = 0, diversity = 0, total = 0;
  const selected = [...candidates].sort((a, b) => (a.priority ?? a.index) - (b.priority ?? b.index)).map((item) => {
    const wantKey = item.autoType ? WANT_OF[item.autoType] ?? null : null;
    let selection: VariationSelection;
    if (wantKey && answers.wants.length && !answers.wants.includes(wantKey)) selection = 'not_asked';
    else if (total >= 12 || (item.axis === 'ITERATION' && stretch >= info.stretchMax) || (info.goal === 'stretch' && item.axis === 'DIVERSITY' && diversity >= 3)) selection = 'goal_cut';
    else {
      selection = wantKey && answers.wants.includes(wantKey) ? 'asked' : 'auto';
      total++;
      if (item.axis === 'ITERATION') stretch++; else diversity++;
    }
    return { item, wantKey, selection, included: selection === 'auto' || selection === 'asked' };
  });
  const belowFloor = total < 4;
  for (const s of selected) {
    if (total >= 4) break;
    if (s.selection !== 'goal_cut') continue;
    s.selection = s.wantKey && answers.wants.includes(s.wantKey) ? 'asked' : 'auto';
    s.included = true;
    total++;
  }
  if (info.goal === 'both') {
    let count = selected.filter((x) => x.included).length;
    const diversity = selected.filter((x) => x.included && x.item.axis === 'DIVERSITY').length;
    // Balance within the requested categories; never bring back a category the user excluded.
    for (const s of [...selected].reverse()) {
      if (count <= 4 || diversity >= Math.ceil(count * .4)) break;
      if (!s.included || s.item.axis !== 'ITERATION') continue;
      s.included = false; s.selection = 'goal_cut'; count--;
    }
    total = count;
  }
  return { selected, info, smallBatch: belowFloor || total < 8 };
}
