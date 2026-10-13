import type { BatchSettings, EditMap, EditSettings, KeepEditBlockerHit, ScenePipeline, TakeKind, ScriptBlock, TeardownSections, TranscriptWord, VariationKind, VideoFormat } from '@maquina/contratos';
import type { CatalogService, SceneDraft } from '../integracoes';
import { mainSegments, mainSpans } from '../campeoes/mapa-edicao';
import { isVideoEngine } from '../troca/regras';

/** Fotografia do teardown no momento do plano (editar o teardown depois não muda o lote). */
export interface TeardownSnapshot {
  sections: TeardownSections;
  words: TranscriptWord[];
  durationSec: number;
  width: number | null;
  height: number | null;
  /** §13: mapa da edição do campeão no momento do plano (null = analisado antes do mapping_edit). */
  editMap?: EditMap | null;
}

/** Take planejado do item (§13.5); null = item sem lipsync (SOURCE_CUT) ou caminho antigo. */
export interface PlannedItemTake {
  kind: TakeKind; speech: string | null; sourceStartSec: number | null; sourceEndSec: number | null; words: TranscriptWord[] | null;
}
export interface ItemPlan { take: PlannedItemTake | null; scenes: PlannedScene[] }

/** payload do item (variation_items.payload). */
export interface ItemPayload {
  hook?: { speech: string; onScreenText: string | null };
  hookDurationSec?: number;
  blocks?: ScriptBlock[];
  layoutTemplateId?: string;
}

/** Cena planejada de um item, na ordem do vídeo (o launch grava como `scenes`). */
export interface PlannedScene {
  index: number; label: string; startSec: number; endSec: number; speech: string; visualPrompt: string;
  pipeline: ScenePipeline;
  sourceStartSec: number | null; sourceEndSec: number | null;
  /** palavras relativas ao início da cena (AUDIO_LIPSYNC: vêm do teardown, sem TRANSCRIBE) */
  words: TranscriptWord[] | null;
  /** NEW_HOOKS: índice da cena do corpo (a cena do controle com o mesmo índice é a dona) */
  bodyIndex: number | null;
  /** §13.15: SWAP_VIDEO = trecho main na grade do campeão, [start, end) */
  frames?: { startFrame: number; endFrame: number } | null;
}

export const LIPSYNC_MAX_SCENE_SEC = 30;
export const AUDIO_LIPSYNC_MIN_SEC = 2; // piso do Pruna
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const KIND_LIMITS: Record<VariationKind, { min: number; max: number }> = {
  NEW_HOOKS: { min: 2, max: 5 }, SWAP_AVATAR: { min: 1, max: 4 }, COPY_NEW: { min: 1, max: 4 }, REMIX_EDIT: { min: 1, max: 4 },
  AUTO_EDIT: { min: 0, max: 0 }, // lote AUTO não passa pelo plano manual (variacao-auto-v1 §6)
};
export const MAX_BATCH_ITEMS = 10;

/** Formato mais próximo do aspecto do campeão (padrão do lote). */
export function nearestFormat(width: number | null, height: number | null): VideoFormat {
  if (!width || !height) return 'VERTICAL_9_16';
  const ar = width / height;
  const opts: [VideoFormat, number][] = [['VERTICAL_9_16', 9 / 16], ['PORTRAIT_4_5', 4 / 5], ['SQUARE_1_1', 1]];
  return opts.reduce((a, b) => (Math.abs(b[1] - ar) < Math.abs(a[1] - ar) ? b : a))[0];
}

/** keepEdit padrão (§13.7): true quando todo tipo pedido que mantém a edição (SWAP_AVATAR, NEW_HOOKS) está disponível. */
export function defaultSettings(
  snapshot: Pick<TeardownSnapshot, 'width' | 'height'>, kinds: VariationKind[], ctaText: string | null, edit: EditSettings, keepEdit = false,
): BatchSettings {
  return {
    format: nearestFormat(snapshot.width, snapshot.height),
    voiceId: null,
    voiceSource: kinds.includes('SWAP_AVATAR') ? 'CHAMPION_AUDIO' : 'CATALOG',
    engine: null,
    engineModel: null,
    edit: { ...edit, ctaText: edit.ctaText || ctaText || '' },
    keepEdit,
    hookMode: 'TEXT',
    swapEngine: 'LIPSYNC',
  };
}

/** Palavras dentro de [a, b) (pelo meio da palavra). */
function wordsIn(words: TranscriptWord[], a: number, b: number): TranscriptWord[] {
  return words.filter((w) => (w.startSec + w.endSec) / 2 >= a && (w.startSec + w.endSec) / 2 < b);
}
const textOf = (ws: TranscriptWord[]) => ws.map((w) => w.word).join(' ').trim();

/** Blocos do campeão (structure do teardown; sem estrutura = 1 bloco do vídeo inteiro). Fala literal da transcrição. */
export function sourceBlocks(s: TeardownSnapshot): ScriptBlock[] {
  const st = s.sections.structure;
  const raw = st?.status === 'ok' && st.data?.blocks?.length
    ? st.data.blocks.map((b) => ({ label: b.label, startSec: b.startSec, endSec: b.endSec, onScreen: b.onScreen, speech: b.speech }))
    : [{ label: 'body', startSec: 0, endSec: s.durationSec, onScreen: '', speech: '' }];
  const sorted = raw.filter((b) => b.endSec > b.startSec).sort((a, b) => a.startSec - b.startSec);
  return sorted.map((b, i) => {
    const end = i === sorted.length - 1 ? Math.max(b.endSec, s.durationSec) : b.endSec;
    const literal = textOf(wordsIn(s.words, b.startSec, end + (i === sorted.length - 1 ? 1 : 0)));
    return { label: b.label, startSec: r3(b.startSec), endSec: r3(b.endSec), speech: literal || b.speech, visualPrompt: b.onScreen ?? '' };
  });
}

/** Fim do gancho original (seção hook do teardown; senão o fim do 1º bloco). */
export function hookEndOf(s: TeardownSnapshot): number {
  const h = s.sections.hook;
  if (h?.status === 'ok' && h.data && h.data.endSec > 0) return h.data.endSec;
  const b = sourceBlocks(s)[0];
  return b ? b.endSec : Math.min(3, s.durationSec);
}

/** Gancho original (o controle do NEW_HOOKS): fala literal até hook.endSec + texto da tela. */
export function originalHook(s: TeardownSnapshot): { speech: string; onScreenText: string | null; durationSec: number } {
  const end = hookEndOf(s);
  const h = s.sections.hook;
  const literal = textOf(wordsIn(s.words, 0, end));
  return { speech: literal || (h?.data?.spoken ?? ''), onScreenText: h?.status === 'ok' ? h.data?.onScreenText ?? null : null, durationSec: r3(end) };
}

/** Blocos do corpo (depois do gancho), cortados em hook.endSec. */
export function bodyBlocks(s: TeardownSnapshot): ScriptBlock[] {
  const end = hookEndOf(s);
  return sourceBlocks(s)
    .filter((b) => b.endSec > end + 0.05)
    .map((b) => (b.startSec < end ? { ...b, startSec: r3(end), speech: textOf(wordsIn(s.words, end, b.endSec)) || b.speech } : b));
}

/** Roteiro (blocks) do item. NEW_HOOKS: gancho novo + corpo literal; SWAP_AVATAR: fala literal inteira. */
export function itemBlocks(kind: VariationKind, s: TeardownSnapshot, hook?: { speech: string; durationSec: number }): ScriptBlock[] {
  if (kind === 'NEW_HOOKS' && hook) {
    const end = hookEndOf(s);
    const shift = hook.durationSec - end;
    const head: ScriptBlock = { label: 'hook', startSec: 0, endSec: r3(hook.durationSec), speech: hook.speech, visualPrompt: '' };
    return [head, ...bodyBlocks(s).map((b) => ({ ...b, startSec: r3(b.startSec + shift), endSec: r3(b.endSec + shift) }))];
  }
  return sourceBlocks(s);
}

function split(catalog: CatalogService, words: TranscriptWord[], blocks: ScriptBlock[]) {
  return catalog.splitSourceScenes(words, blocks.map((b) => ({ label: b.label, startSec: b.startSec, endSec: b.endSec })), LIPSYNC_MAX_SCENE_SEC);
}

/** Cenas do item no launch (§5.1 e §5.2). */
export function planScenes(
  catalog: CatalogService, kind: VariationKind, isControl: boolean, payload: ItemPayload, s: TeardownSnapshot, settings: BatchSettings,
): PlannedScene[] {
  if (kind === 'SWAP_AVATAR') {
    const audio = settings.voiceSource === 'CHAMPION_AUDIO';
    return split(catalog, s.words, sourceBlocks(s)).map((sc) => ({
      index: sc.index, label: sc.label, startSec: r3(sc.sourceStartSec), endSec: r3(sc.sourceEndSec), speech: sc.speech, visualPrompt: '',
      pipeline: audio ? 'AUDIO_LIPSYNC' : 'TTS_LIPSYNC',
      sourceStartSec: audio ? r3(sc.sourceStartSec) : null, sourceEndSec: audio ? r3(sc.sourceEndSec) : null,
      words: audio ? sc.words : null, bodyIndex: null,
    }));
  }
  if (kind === 'NEW_HOOKS') {
    const hook = payload.hook!;
    const hookDur = payload.hookDurationSec ?? hookEndOf(s);
    const end = hookEndOf(s);
    const shift = hookDur - end;
    const head: PlannedScene = {
      index: 0, label: 'hook', startSec: 0, endSec: r3(hookDur), speech: hook.speech, visualPrompt: '', pipeline: 'TTS_LIPSYNC',
      sourceStartSec: null, sourceEndSec: null, words: null, bodyIndex: null,
    };
    const body = split(catalog, s.words, bodyBlocks(s)).map((sc, i) => ({
      index: i + 1, label: sc.label, startSec: r3(sc.sourceStartSec + shift), endSec: r3(sc.sourceEndSec + shift), speech: sc.speech, visualPrompt: '',
      pipeline: (isControl ? 'TTS_LIPSYNC' : 'REUSE') as ScenePipeline, sourceStartSec: null, sourceEndSec: null, words: null, bodyIndex: i,
    }));
    return [head, ...body];
  }
  throw new Error(`planScenes: ${kind} fora do build`);
}

/** SceneDraft (formato da estimativa v1) das cenas planejadas. */
export function draftsOf(scenes: PlannedScene[]): SceneDraft[] {
  return scenes.map((s) => ({ index: s.index, label: s.label, startSec: s.startSec, endSec: s.endSec, speech: s.speech, visualPrompt: s.visualPrompt }));
}

/** Segundos de áudio de cada cena (AUDIO_LIPSYNC cobra o trecho real, com o piso de 2 s do Pruna). */
export function audioSecOf(scenes: PlannedScene[]): number[] {
  return scenes.map((s) => (s.sourceStartSec != null && s.sourceEndSec != null ? Math.max(AUDIO_LIPSYNC_MIN_SEC, s.sourceEndSec - s.sourceStartSec) : s.endSec - s.startSec));
}

// ═════════════════════════ §13: manter a edição + take contínuo ═════════════════════════

/** Tipos que mantêm a edição do campeão. */
export const KEEP_EDIT_KINDS: VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS'];

/** Bloqueios do keepEdit pros tipos pedidos (vazio = disponível em todos). */
export function keepEditBlockers(
  keepEdit: Record<'SWAP_AVATAR' | 'NEW_HOOKS', { available: boolean; blockers: KeepEditBlockerHit[] }>, kinds: VariationKind[],
): { kind: VariationKind; blockers: KeepEditBlockerHit[] } | null {
  for (const k of kinds) {
    if (k !== 'SWAP_AVATAR' && k !== 'NEW_HOOKS') continue;
    const a = keepEdit[k];
    if (!a.available) return { kind: k, blockers: a.blockers };
  }
  return null;
}

/** Janela com rosto (s): da 1ª à última frame da trilha (inclui os buracos, pra o take ser contínuo). */
export function faceWindowOf(m: Pick<EditMap, 'faceTrack' | 'fps'>): { startSec: number; endSec: number } | null {
  // só o avatar principal: do início do 1º ao fim do último trecho `main` (convidada/b-roll no meio entram no áudio contínuo)
  const main = mainSegments(m.faceTrack);
  if (!main.length || !(m.fps > 0)) return null;
  const a = Math.min(...main.map((t) => t.startFrame));
  const b = Math.max(...main.map((t) => t.endFrame));
  return b > a ? { startSec: r3(a / m.fps), endSec: r3(b / m.fps) } : null;
}

/** Fatias (blocos do campeão) recortadas na janela [a, b), tempos relativos ao início do take. */
function windowSlices(s: TeardownSnapshot, a: number, b: number): PlannedScene[] {
  const blocks = sourceBlocks(s)
    .map((x, i, all) => ({ ...x, endSec: i === all.length - 1 ? Math.max(x.endSec, s.durationSec) : x.endSec }))
    .filter((x) => x.endSec > a + 0.05 && x.startSec < b - 0.05);
  const list = blocks.length ? blocks : [{ label: 'body', startSec: a, endSec: b, speech: '', visualPrompt: '' }];
  return list.map((x, i) => {
    const st = Math.max(a, x.startSec);
    const en = Math.min(b, x.endSec);
    return {
      index: i, label: x.label, startSec: r3(st - a), endSec: r3(en - a), speech: textOf(wordsIn(s.words, st, en)) || x.speech, visualPrompt: '',
      pipeline: 'TAKE_SLICE' as const, sourceStartSec: null, sourceEndSec: null, words: null, bodyIndex: null,
    };
  });
}

/**
 * Plano de cenas + take do item no launch/estimativa (§13.3-13.5):
 *  SWAP_AVATAR keepEdit: take AUDIO_LIPSYNC da janela com rosto; limpo + áudio do campeão: take AUDIO_LIPSYNC do vídeo
 *    inteiro; limpo + voz do catálogo: take TTS_LIPSYNC com a fala literal inteira. Cenas = fatias TAKE_SLICE.
 *  NEW_HOOKS keepEdit (hookMode TEXT): 1 cena SOURCE_CUT do campeão inteiro, sem provedor, sem take.
 *  NEW_HOOKS sem keepEdit (escolha explícita): take TTS_LIPSYNC do roteiro inteiro do item (gancho falado + corpo).
 */
export function planItem(
  catalog: CatalogService, kind: VariationKind, isControl: boolean, payload: ItemPayload, s: TeardownSnapshot, settings: BatchSettings,
): ItemPlan {
  if (kind === 'SWAP_AVATAR' && settings.keepEdit && isVideoEngine(settings.swapEngine) && s.editMap) {
    return { take: null, scenes: swapScenes(s, s.editMap) };
  }
  if (kind === 'SWAP_AVATAR') {
    const audio = settings.keepEdit || settings.voiceSource === 'CHAMPION_AUDIO';
    const win = settings.keepEdit && s.editMap ? faceWindowOf(s.editMap) : null;
    const a = win?.startSec ?? 0;
    const b = win?.endSec ?? s.durationSec;
    const scenes = windowSlices(s, a, b);
    if (audio) {
      const words = wordsIn(s.words, a, b).map((w) => ({ word: w.word, startSec: r3(Math.max(0, w.startSec - a)), endSec: r3(Math.min(b, w.endSec) - a) }));
      return { take: { kind: 'AUDIO_LIPSYNC', speech: textOf(wordsIn(s.words, a, b)) || null, sourceStartSec: r3(a), sourceEndSec: r3(b), words }, scenes };
    }
    return { take: { kind: 'TTS_LIPSYNC', speech: scenes.map((x) => x.speech).filter(Boolean).join(' '), sourceStartSec: null, sourceEndSec: null, words: null }, scenes };
  }
  if (kind === 'NEW_HOOKS' && settings.keepEdit) {
    return {
      take: null,
      scenes: [{
        index: 0, label: 'champion', startSec: 0, endSec: r3(s.durationSec), speech: textOf(s.words), visualPrompt: '',
        pipeline: 'SOURCE_CUT', sourceStartSec: 0, sourceEndSec: r3(s.durationSec), words: s.words, bodyIndex: null,
      }],
    };
  }
  if (kind === 'NEW_HOOKS') {
    // gancho falado (keepEdit desligado por escolha explícita): 1 take TTS_LIPSYNC por item com o roteiro inteiro
    // (gancho + corpo literal); as cenas são fatias dele. O reuso do corpo deixa de existir com take contínuo (§13.5).
    const blocks = payload.blocks?.length ? payload.blocks : itemBlocks('NEW_HOOKS', s, payload.hook ? { speech: payload.hook.speech, durationSec: payload.hookDurationSec ?? hookEndOf(s) } : undefined);
    const scenes: PlannedScene[] = blocks.map((b, i) => ({
      index: i, label: b.label, startSec: r3(b.startSec), endSec: r3(b.endSec), speech: b.speech, visualPrompt: '',
      pipeline: 'TAKE_SLICE', sourceStartSec: null, sourceEndSec: null, words: null, bodyIndex: null,
    }));
    return { take: { kind: 'TTS_LIPSYNC', speech: scenes.map((x) => x.speech.trim()).filter(Boolean).join(' '), sourceStartSec: null, sourceEndSec: null, words: null }, scenes };
  }
  return { take: null, scenes: planScenes(catalog, kind, isControl, payload, s, settings) };
}

/** Segundos do áudio do take planejado (texto: pela fala). */
export function plannedTakeAudioSec(t: PlannedItemTake): number | null {
  return t.kind === 'AUDIO_LIPSYNC' && t.sourceStartSec != null && t.sourceEndSec != null ? Math.max(AUDIO_LIPSYNC_MIN_SEC, t.sourceEndSec - t.sourceStartSec) : null;
}

/**
 * §13.15.2: Trocar avatar com Kling/Seedance = 1 cena SWAP_VIDEO por trecho main (timeline). Tempos = os do campeão
 * (a edição e a duração não mudam); speech/words = teardown no trecho, words relativas ao início da cena.
 */
export function swapScenes(s: Pick<TeardownSnapshot, 'words'>, m: Pick<EditMap, 'fps' | 'timeline' | 'faceTrack'>): PlannedScene[] {
  return mainSpans(m).map((sp, i) => {
    const a = sp.startFrame / m.fps;
    const b = sp.endFrame / m.fps;
    const ws = wordsIn(s.words, a, b);
    return {
      index: i, label: `Trecho ${i + 1}`, startSec: r3(a), endSec: r3(b), speech: textOf(ws), visualPrompt: '',
      pipeline: 'SWAP_VIDEO' as const, sourceStartSec: r3(a), sourceEndSec: r3(b),
      words: ws.map((w) => ({ word: w.word, startSec: r3(Math.max(0, w.startSec - a)), endSec: r3(Math.min(b, w.endSec) - a) })),
      bodyIndex: null, frames: { startFrame: sp.startFrame, endFrame: sp.endFrame },
    };
  });
}
