import { Inject, Injectable } from '@nestjs/common';
import type {
  Action, AdLibraryMeta, AsyncErrorCode, ChampionDetail, EditMap, KeepEditAvailability, ChampionRow, ChampionStatus, Measurements, Teardown, TeardownSectionKey,
  TeardownSections, TranscriptWord, VariationKind,
} from '@maquina/contratos';
import type { Champion, Prisma, Teardown as TeardownRow } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { asAsyncErrorCode } from '../common/errors/falhas';
import { initials, num } from '../common/util/format';
import { presentJob } from '../jobs/job.presenter';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_KINDS, ENABLED_KINDS, NEEDS_SPEECH } from './limites';
import { captionUnredrawable, dedupeBlockers } from './mapa-edicao';

/** Transcrição guardada em teardowns.transcript. */
export interface StoredTranscript {
  language: string; text: string; words: TranscriptWord[]; wpm: number; wordsSource: 'whisper' | 'none';
}
/** Medições guardadas em teardowns.measurements: igual ao contrato, mas o frame-chave guarda só o fileId. */
export type StoredMeasurements = Omit<Measurements, 'keyframes'> & { keyframes: { atSec: number; reason: Measurements['keyframes'][number]['reason']; fileId: string }[] };

export const SECTION_KEYS: readonly TeardownSectionKey[] = [
  'identification', 'metaCopy', 'transcript', 'hook', 'structure', 'layout', 'visual', 'audio', 'offerProofCta', 'whySells', 'stealVsVary', 'replicationPlan',
];

export const CHAMPION_INCLUDE = {
  offer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  thumbnailFile: true,
  videoFile: true,
  teardown: true,
  _count: { select: { batches: true, creatives: { where: { archivedAt: null } } } },
} satisfies Prisma.ChampionInclude;
export type ChampionFull = Prisma.ChampionGetPayload<{ include: typeof CHAMPION_INCLUDE }>;

export function transcriptOf(json: Prisma.JsonValue | null | undefined): StoredTranscript | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const t = json as unknown as StoredTranscript;
  return Array.isArray(t.words) ? t : null;
}

export function measurementsOf(json: Prisma.JsonValue | null | undefined): StoredMeasurements | null {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !('durationSec' in json)) return null;
  return json as unknown as StoredMeasurements;
}

export function sectionsOf(json: Prisma.JsonValue | null | undefined): TeardownSections | null {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Object.keys(json).length) return null;
  return json as unknown as TeardownSections;
}

export function wpmOf(words: TranscriptWord[]): number {
  if (words.length < 2) return 0;
  const span = words[words.length - 1].endSec - words[0].startSec;
  return span > 0 ? Math.round((words.length / span) * 60) : 0;
}

/** Ação sugerida no campeão FAILED: sem vídeo ainda = subir o arquivo; com vídeo = analisar de novo. */
export function championAction(c: Pick<Champion, 'status' | 'videoFileId' | 'errorCode'>): Action | null {
  if (c.status !== 'FAILED') return null;
  if (!c.videoFileId) return 'upload_video';
  return c.errorCode === 'MEDIA_INVALID' ? 'upload_video' : 'analyze_again';
}

/** availableKinds do ChampionDetail (fala e build; nenhum tipo travado por `rights`, decisão D1). */
export function availableKinds(c: Pick<Champion, 'status' | 'hasSpeech'>): ChampionDetail['availableKinds'] {
  return ALL_KINDS.map((kind: VariationKind) => {
    if (!ENABLED_KINDS.includes(kind)) return { kind, available: false, reason: 'NOT_ENABLED' as const };
    if (c.status !== 'READY') return { kind, available: false, reason: null };
    if (NEEDS_SPEECH.includes(kind) && !c.hasSpeech) return { kind, available: false, reason: 'NO_SPEECH' as const };
    return { kind, available: true, reason: null };
  });
}

export function editMapOf(json: Prisma.JsonValue | null | undefined): EditMap | null {
  if (!json || typeof json !== 'object' || Array.isArray(json) || (json as { version?: unknown }).version !== 1) return null;
  return json as unknown as EditMap;
}

const NOT_MAPPED: KeepEditAvailability = { available: false, blockers: [{ reason: 'not_mapped', startSec: null, endSec: null }] };
const NOT_READY: KeepEditAvailability = { available: false, blockers: [] };

/** §13: keepEdit do ChampionDetail. Campeão não READY = indisponível sem motivo (ainda analisando);
 *  READY sem EditMap (analisado antes do mapping_edit) = 'not_mapped'; senão, o que o mapa diz. */
export function keepEditOf(c: Pick<Champion, 'status'>, editMap: EditMap | null): ChampionDetail['keepEdit'] {
  if (c.status !== 'READY') return { SWAP_AVATAR: NOT_READY, NEW_HOOKS: NOT_READY };
  if (!editMap) return { SWAP_AVATAR: NOT_MAPPED, NEW_HOOKS: NOT_MAPPED };
  return editMap.keepEdit;
}

/** §13.15.1: Trocar avatar com a voz do motor = os bloqueios do keepEdit.SWAP_AVATAR + `caption_unredrawable`. */
export function engineVoiceOf(c: Pick<Champion, 'status'>, editMap: EditMap | null): KeepEditAvailability {
  const base = keepEditOf(c, editMap).SWAP_AVATAR;
  if (c.status !== 'READY' || !editMap) return base;
  const blockers = dedupeBlockers([...base.blockers, ...captionUnredrawable(editMap)]);
  return { available: blockers.length === 0, blockers };
}

/** Respostas do contrato pro campeão (URLs assinadas na hora). */
@Injectable()
export class ChampionViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async load(workspaceId: string, id: string): Promise<ChampionFull | null> {
    return this.prisma.champion.findFirst({ where: { id, workspaceId, archivedAt: null }, include: CHAMPION_INCLUDE });
  }

  async row(c: ChampionFull): Promise<ChampionRow> {
    const winners = await this.prisma.creative.count({ where: { championId: c.id, archivedAt: null, isWinner: true } });
    return {
      id: c.id,
      name: c.name,
      offer: { id: c.offer.id, name: c.offer.name },
      status: c.status as ChampionStatus,
      rights: c.rights,
      sources: sourcesOf(c),
      thumbnail: c.thumbnailFile ? await this.storage.fileRef(c.thumbnailFile) : null,
      durationSec: num(c.durationSec),
      language: c.language,
      batchesCount: c._count.batches,
      variationsCount: c._count.creatives,
      winnersCount: winners,
      createdBy: { id: c.createdBy.id, name: c.createdBy.name, initials: initials(c.createdBy.name) },
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  async detail(c: ChampionFull): Promise<ChampionDetail> {
    const [row, job, cost] = await Promise.all([
      this.row(c),
      this.prisma.job.findFirst({ where: { championId: c.id, type: { in: ['CHAMPION_RESOLVE', 'CHAMPION_ANALYZE'] } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.costEntry.aggregate({ where: { championId: c.id }, _sum: { amountUsd: true } }),
    ]);
    return {
      ...row,
      video: c.videoFile ? await this.storage.fileRef(c.videoFile) : null,
      adLibraryUrl: c.adLibraryUrl,
      adMeta: (c.adMeta as unknown as AdLibraryMeta | null) ?? null,
      notes: c.notes,
      job: job ? presentJob(job) : null,
      errorCode: c.status === 'FAILED' && c.errorCode ? (asAsyncErrorCode(c.errorCode) as AsyncErrorCode) : null,
      failReason: c.status === 'FAILED' ? c.failReason : null,
      action: championAction(c),
      // durante a reanálise o teardown anterior continua visível (se existir); null até as 12 seções existirem
      teardown: c.teardown ? await this.teardown(c.teardown) : null,
      availableKinds: availableKinds(c),
      keepEdit: keepEditOf(c, editMapOf(c.teardown?.editMap)),
      engineVoice: engineVoiceOf(c, editMapOf(c.teardown?.editMap)),
      costUsd: Math.round((num(cost._sum.amountUsd) ?? 0) * 10_000) / 10_000,
    };
  }

  /** Teardown só existe pra fora quando as 12 seções já foram escritas ao menos uma vez. */
  async teardown(t: TeardownRow): Promise<Teardown | null> {
    const sections = sectionsOf(t.sections);
    const m = measurementsOf(t.measurements);
    if (!sections || !m) return null;
    const tr = transcriptOf(t.transcript) ?? { language: '', text: '', words: [], wpm: 0, wordsSource: 'none' as const };
    const files = await this.prisma.file.findMany({ where: { id: { in: m.keyframes.map((k) => k.fileId) } } });
    const byId = new Map(files.map((f) => [f.id, f]));
    const keyframes: Measurements['keyframes'] = [];
    for (const k of m.keyframes) {
      const f = byId.get(k.fileId);
      if (f) keyframes.push({ atSec: k.atSec, reason: k.reason, image: await this.storage.fileRef(f) });
    }
    return {
      id: t.id,
      language: tr.language,
      analyzedAt: (t.analyzedAt ?? t.updatedAt).toISOString(),
      editedSections: t.editedSections.filter((k): k is TeardownSectionKey => (SECTION_KEYS as readonly string[]).includes(k)),
      transcript: { text: tr.text, words: tr.words, wpm: tr.wpm },
      measurements: { ...m, keyframes },
      sections,
      editMap: editMapOf(t.editMap),
    };
  }
}

/** UPLOAD quando o vídeo veio do navegador; AD_LIBRARY quando há link (os dois podem coexistir). */
function sourcesOf(c: ChampionFull): ChampionRow['sources'] {
  const out: ChampionRow['sources'] = [];
  const videoFromLink = !!c.videoFile?.sourceUrl; // ingestFromUrl grava sourceUrl; upload do navegador não
  if (c.videoFileId && !videoFromLink) out.push('UPLOAD');
  if (c.adLibraryUrl) out.push('AD_LIBRARY');
  return out;
}
