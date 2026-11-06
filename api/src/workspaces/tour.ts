import type { TipKey, TourEventName } from '@maquina/contratos';

/** tour-v2 (docs/contratos/tour-v2.md). Cópias em runtime das listas do contrato (o pacote de contratos é só tipos). */
export const TIP_KEYS = ['adSource', 'plan', 'result', 'send', 'library'] as const satisfies readonly TipKey[];
export const TOUR_EVENT_NAMES = [
  'tour_started', 'tour_stop_viewed', 'tour_stop_next', 'tour_stop_back', 'tour_stop_missing',
  'tour_skipped', 'tour_completed', 'tip_shown', 'tip_dismissed', 'tip_action',
] as const satisfies readonly TourEventName[];
export const EVENTS_MAX_PER_REQUEST = 50;
export const EVENT_PROPS_MAX_CHARS = 2048;
