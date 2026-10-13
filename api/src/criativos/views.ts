import { Inject, Injectable } from '@nestjs/common';
import type {
  CreativeDetail, CreativeRow, CreativeState, EditDoc, EditSettings, Face, FileRef, Render, Scene, ScenesSummary, Script, ScriptBlock,
  Take, TranscriptWord, VariationAxis, VariationKind, VideoFormat,
} from '@maquina/contratos';
import { normalizarDoc } from '@maquina/video';
import type { Prisma, File as FileRow, Face as FaceRow, Render as RenderRow, Scene as SceneRow, Script as ScriptRow, Take as TakeRow } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { asAsyncErrorCode, faceAction, sceneAction } from '../common/errors/falhas';
import { initials, num } from '../common/util/format';
import { CustosService } from '../custos/custos.service';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { takeEstimateUsd } from '../geracao/take';
import { STATE_VIEW, statusKeyOf, statusOf, stepsOf } from './derivacao';
import { loadEditMap, swapSceneEstimate } from '../troca/estimativa';
import { engineOfModel } from '../troca/regras';
import { sceneSwapOf } from '../troca/vista';
import { docTemConteudo, editDocOf, montarScratchSource } from '../edicao/editor-doc';
import type { VariationRefAuto } from './contrato-auto';

export const CREATIVE_INCLUDE = {
  offer: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  thumbnail: true,
  selectedFace: { include: { file: true } },
  selectedScript: true,
  finalRender: { include: { file: true } },
  champion: { select: { id: true, name: true } },
  variationItem: { select: { kind: true, lever: true, isControl: true, batchId: true, code: true, axis: true } },
} satisfies Prisma.CreativeInclude;

/** Rótulo do tipo de variação (summary.engineLabel e nome dos criativos do lote). */
export const VARIATION_KIND_LABEL: Record<VariationKind, string> = {
  SWAP_AVATAR: 'Swap avatar',
  NEW_HOOKS: 'New hook',
  COPY_NEW: 'New copy',
  REMIX_EDIT: 'Remix',
  AUTO_EDIT: 'Auto variation', // variacao-auto-v1
};

/** VariationRef do criativo (null no criativo do zero). */
export function variationRefOf(c: {
  origin: string; championId: string | null; variationBatchId: string | null; variationKind: VariationKind | null;
  champion?: { id: string; name: string } | null;
  variationItem?: { kind: VariationKind; lever: string | null; isControl: boolean; batchId: string; code?: string | null; axis?: VariationAxis | null } | null;
}): VariationRefAuto | null {
  if (c.origin !== 'VARIATION' || !c.championId || !c.variationKind) return null;
  return {
    kind: c.variationKind,
    championId: c.championId,
    championName: c.champion?.name ?? '',
    batchId: c.variationBatchId ?? c.variationItem?.batchId ?? '',
    lever: c.variationItem?.lever ?? null,
    isControl: c.variationItem?.isControl ?? false,
    code: c.variationItem?.code ?? null, // variacao-auto-v1 §4
    axis: c.variationItem?.axis ?? null,
  };
}

export type CreativeFull = Prisma.CreativeGetPayload<{ include: typeof CREATIVE_INCLUDE }>;

type Db = Pick<PrismaService, 'scene'> | Prisma.TransactionClient;

/** Cenas da geração vigente (maior generation com stale = false), em ordem. */
export async function currentScenes(db: Db, creativeId: string): Promise<SceneRow[]> {
  const rows = await db.scene.findMany({ where: { creativeId, stale: false }, orderBy: [{ generation: 'desc' }, { index: 'asc' }] });
  if (!rows.length) return [];
  const gen = rows[0].generation;
  return rows.filter((r) => r.generation === gen);
}

/** §13.5: take da geração vigente (null em SCENES/Kling-Seedance, SOURCE_CUT e criativos antigos). */
export async function currentTake(db: Pick<PrismaService, 'take'> | Prisma.TransactionClient, creativeId: string): Promise<TakeRow | null> {
  return db.take.findFirst({ where: { creativeId, stale: false }, orderBy: { generation: 'desc' } });
}

export function scenesSummary(scenes: Pick<SceneRow, 'status' | 'progress' | 'startedAt' | 'endSec' | 'startSec'>[]): ScenesSummary {
  const total = scenes.length;
  const ready = scenes.filter((s) => s.status === 'READY').length;
  const failed = scenes.filter((s) => s.status === 'FAILED').length;
  const pending = scenes.filter((s) => s.status === 'QUEUED' || s.status === 'GENERATING');
  const progress = total ? Math.round(scenes.reduce((a, s) => a + (s.status === 'FAILED' ? 100 : s.progress), 0) / total) : 0;
  // ETA grosseira: as cenas rodam em paralelo; o que falta da mais atrasada (~3 min por cena no provedor real).
  const etaSec = pending.length ? Math.max(...pending.map((s) => Math.round(((100 - s.progress) / 100) * 180))) : null;
  return { ready, total, failed, progress, etaSec };
}

export function blocksOf(json: Prisma.JsonValue): ScriptBlock[] {
  return Array.isArray(json) ? (json as unknown as ScriptBlock[]) : [];
}

export function editSettingsOf(json: Prisma.JsonValue): EditSettings | null {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Object.keys(json).length) return null;
  return json as unknown as EditSettings;
}

/** Monta as respostas do contrato (@maquina/contratos) a partir das linhas do banco. URLs sempre assinadas na hora. */
@Injectable()
export class CreativeViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly custos: CustosService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  async file(f: FileRow | null | undefined): Promise<FileRef | null> {
    return f ? this.storage.fileRef(f) : null;
  }

  engineLabel(engineModel: string | null): string | null {
    if (!engineModel) return null;
    for (const e of this.catalog.engines()) for (const m of e.models) if (m.id === engineModel) return m.label;
    return engineModel;
  }

  async loadFull(workspaceId: string, creativeId: string): Promise<CreativeFull | null> {
    return this.prisma.creative.findFirst({ where: { id: creativeId, workspaceId, archivedAt: null }, include: CREATIVE_INCLUDE });
  }

  /** Progresso e parâmetros do chip (ex.: { ready: 2, total: 4 }). */
  private async liveProgress(c: CreativeFull): Promise<{ params: Record<string, number>; progress: number | null }> {
    const state = c.state as CreativeState;
    switch (state) {
      case 'SCRIPTS_WRITING': {
        const s = await this.prisma.script.findMany({ where: { creativeId: c.id, discardedAt: null }, select: { status: true } });
        const ready = s.filter((x) => x.status !== 'WRITING').length;
        return { params: { ready, total: s.length }, progress: s.length ? Math.round((ready / s.length) * 100) : 0 };
      }
      case 'FACES_GENERATING': {
        const last = await this.prisma.face.findFirst({ where: { creativeId: c.id }, orderBy: { batch: 'desc' }, select: { batch: true } });
        const f = last ? await this.prisma.face.findMany({ where: { creativeId: c.id, batch: last.batch }, select: { status: true } }) : [];
        const ready = f.filter((x) => x.status === 'READY' || x.status === 'FAILED').length;
        return { params: { ready, total: f.length }, progress: f.length ? Math.round((ready / f.length) * 100) : 0 };
      }
      case 'SCENES_GENERATING':
      case 'SCENES_FAILED': {
        const sum = scenesSummary(await currentScenes(this.prisma, c.id));
        return state === 'SCENES_GENERATING'
          ? { params: { ready: sum.ready, total: sum.total }, progress: sum.progress }
          : { params: { failed: sum.failed, total: sum.total }, progress: null };
      }
      case 'RENDERING': {
        const r = await this.prisma.render.findFirst({ where: { creativeId: c.id }, orderBy: { createdAt: 'desc' }, select: { progress: true } });
        const p = r?.progress ?? 0;
        return { params: { progress: p }, progress: p };
      }
      default:
        return { params: {}, progress: null };
    }
  }

  async row(c: CreativeFull): Promise<CreativeRow> {
    const state = c.state as CreativeState;
    const status = statusOf(state, c.updatedAt);
    const live = await this.liveProgress(c);
    return {
      id: c.id,
      name: c.name,
      offer: { id: c.offer.id, name: c.offer.name },
      state,
      step: STATE_VIEW[state].step,
      status,
      statusKey: statusKeyOf(state, status),
      statusParams: live.params,
      progress: status === 'progress' ? live.progress ?? 0 : null,
      engine: c.engine,
      engineModel: c.engineModel,
      thumbnail: (await this.file(c.thumbnail)) ?? (await this.file(c.selectedFace?.file)),
      createdBy: { id: c.createdBy.id, name: c.createdBy.name, initials: initials(c.createdBy.name) },
      updatedAt: c.updatedAt.toISOString(),
      variation: variationRefOf(c),
      editedInEditor: await this.editedInEditor(c),
    };
  }

  /**
   * editor-v1 §5.1 (D1), selo "editado": o render final (aprovado) ou, antes de aprovar, o vigente (último READY não stale)
   * saiu com doc que, normalizado, ainda muda algo. Derivado de renders.doc. O render novo já grava o doc normalizado;
   * a normalização aqui cobre os renders gravados antes disso (corte de cena regerada contava como "editado").
   */
  async editedInEditor(c: {
    id: string; state: string; format: VideoFormat; language: string;
    finalRender?: { doc: Prisma.JsonValue; settings: Prisma.JsonValue } | null;
  }): Promise<boolean> {
    let r: { doc: Prisma.JsonValue; settings: Prisma.JsonValue } | null | undefined = c.finalRender;
    if (!r) {
      if (!['RENDER_READY', 'EDIT_PENDING', 'RENDERING', 'RENDER_FAILED'].includes(c.state)) return false;
      r = await this.prisma.render.findFirst({
        where: { creativeId: c.id, status: 'READY', stale: false }, orderBy: { createdAt: 'desc' }, select: { doc: true, settings: true },
      });
    }
    if (!r || !docTemConteudo(r.doc)) return false;
    // final (aprovado) e vigente (não stale): as cenas vigentes são as que o render usou
    return !!(await this.docNormalizado(c, editSettingsOf(r.settings), r.doc));
  }

  /**
   * Doc normalizado contra as cenas vigentes (editor-v1 §5.4: corte/correção de cena regerada cai, igual ao padrão sai).
   * null = sem ajuste. Só consulta cenas quando o doc cru tem conteúdo.
   */
  async docNormalizado(c: { id: string; format: VideoFormat; language: string }, settings: EditSettings | null, json: Prisma.JsonValue | null | undefined): Promise<EditDoc | null> {
    const raw = editDocOf(json);
    if (!docTemConteudo(raw)) return null;
    const scenes = await currentScenes(this.prisma, c.id);
    const ids = scenes.map((s) => s.clipFileId).filter((x): x is string => !!x);
    const files = new Map((await this.prisma.file.findMany({ where: { id: { in: ids } } })).map((f) => [f.id, f]));
    // só tempos e ids importam aqui: sem URL assinada
    const fonte = await montarScratchSource(scenes, files, async (f) => ({ id: f.id, url: '', mimeType: f.mimeType }), c);
    return normalizarDoc(raw, fonte, settings ?? undefined);
  }

  async detail(c: CreativeFull): Promise<CreativeDetail> {
    const row = await this.row(c);
    const state = c.state as CreativeState;
    let final: (RenderRow & { file: FileRow | null }) | null = c.finalRender;
    if (!final && (state === 'RENDER_READY' || state === 'EDIT_PENDING')) {
      final = await this.prisma.render.findFirst({
        where: { creativeId: c.id, status: 'READY', stale: false },
        orderBy: { createdAt: 'desc' },
        include: { file: true },
      });
    }
    return {
      ...row,
      language: c.language,
      format: c.format,
      voiceId: c.voiceId,
      steps: stepsOf(state),
      summary: {
        scriptLetter: c.selectedScript?.letter ?? null,
        scriptDurationSec: num(c.selectedScript?.durationSec),
        face: await this.file(c.selectedFace?.file),
        engineLabel: c.variationKind ? VARIATION_KIND_LABEL[c.variationKind] : this.engineLabel(c.engineModel),
      },
      faceDescription: c.faceDescription,
      editSettings: editSettingsOf(c.editSettings),
      editDirty: c.editDirty,
      estimatedCostUsd: num(c.estimatedCostUsd),
      costUsd: await this.custos.creativeCost(c.id),
      finalRender: final ? await this.render(final) : null,
      approvedAt: c.approvedAt?.toISOString() ?? null,
      isWinner: c.isWinner,
      take: await this.takeOf(c),
      adName: c.adName,
      savedAt: c.updatedAt.toISOString(),
    };
  }

  private async takeOf(c: CreativeFull): Promise<Take | null> {
    const t = await currentTake(this.prisma, c.id);
    return t ? this.take(t, c.format) : null;
  }

  async take(t: TakeRow & { clipFile?: FileRow | null; thumbnailFile?: FileRow | null }, format: CreativeFull['format']): Promise<Take> {
    const code = t.status === 'FAILED' ? asAsyncErrorCode(t.errorCode) : null;
    const clip = t.clipFile === undefined && t.clipFileId ? await this.prisma.file.findUnique({ where: { id: t.clipFileId } }) : t.clipFile;
    const thumb = t.thumbnailFile === undefined && t.thumbnailFileId ? await this.prisma.file.findUnique({ where: { id: t.thumbnailFileId } }) : t.thumbnailFile;
    return {
      id: t.id,
      kind: t.kind,
      status: t.status,
      progress: t.status === 'READY' ? 100 : t.progress,
      attempt: t.attempt,
      durationSec: num(t.durationSec),
      sourceStartSec: num(t.sourceStartSec),
      sourceEndSec: num(t.sourceEndSec),
      clip: t.status === 'READY' ? await this.file(clip) : null,
      thumbnail: await this.file(thumb),
      failReason: t.status === 'FAILED' ? t.failReason : null,
      errorCode: code,
      action: t.status === 'FAILED' ? sceneAction(code) : null,
      regenerateEstimateUsd: takeEstimateUsd(this.catalog, t, format),
    };
  }

  /** CreativeDetail pelo id (404 tratado por quem chama: null). */
  async detailById(workspaceId: string, creativeId: string): Promise<CreativeDetail | null> {
    const c = await this.loadFull(workspaceId, creativeId);
    return c ? this.detail(c) : null;
  }

  script(s: ScriptRow, selectedScriptId: string | null): Script {
    return {
      id: s.id,
      letter: s.letter,
      status: s.status,
      angle: s.angle,
      rationale: s.rationale,
      durationSec: num(s.durationSec),
      blocks: blocksOf(s.blocks),
      editedByUser: s.editedByUser,
      selected: s.id === selectedScriptId,
      failReason: s.failReason,
    };
  }

  async face(f: FaceRow & { file?: FileRow | null }, selectedFaceId: string | null): Promise<Face> {
    const code = f.status === 'FAILED' ? asAsyncErrorCode(f.errorCode) : null;
    return {
      id: f.id,
      batch: f.batch,
      position: f.position,
      status: f.status,
      image: f.status === 'READY' ? await this.file(f.file) : null,
      failReason: f.failReason,
      errorCode: code,
      action: f.status === 'FAILED' ? faceAction(code) : null,
      selected: f.id === selectedFaceId,
    };
  }

  async scene(s: SceneRow & { clipFile?: FileRow | null; thumbnailFile?: FileRow | null }): Promise<Scene> {
    const code = s.status === 'FAILED' ? asAsyncErrorCode(s.errorCode) : null;
    const clip = s.clipFile === undefined && s.clipFileId ? await this.prisma.file.findUnique({ where: { id: s.clipFileId } }) : s.clipFile;
    return {
      id: s.id,
      index: s.index,
      label: s.label,
      startSec: num(s.startSec) ?? 0,
      endSec: num(s.endSec) ?? 0,
      speech: s.speech,
      visualPrompt: s.visualPrompt,
      status: s.status,
      progress: s.status === 'READY' ? 100 : s.progress,
      attempt: s.attempt,
      failReason: s.failReason,
      errorCode: code,
      action: s.status === 'FAILED' ? sceneAction(code) : null,
      clip: s.status === 'READY' ? await this.file(clip) : null,
      thumbnail: await this.file(
        s.thumbnailFile === undefined && s.thumbnailFileId ? await this.prisma.file.findUnique({ where: { id: s.thumbnailFileId } }) : s.thumbnailFile,
      ),
      pipeline: s.pipeline, // §13.11: valor literal do banco
      take: s.pipeline === 'TAKE_SLICE' && s.takeId
        ? { id: s.takeId, startSec: num(s.takeStartSec) ?? 0, endSec: num(s.takeEndSec) ?? 0 }
        : null,
      swap: s.pipeline === 'SWAP_VIDEO' ? await this.swapOf(s) : null,
    };
  }

  /** §13.15: SceneSwap da cena SWAP_VIDEO (janelas com o clipe de cada uma, etapa, "Refazer trecho (US$ x)"). */
  private async swapOf(s: SceneRow): Promise<Scene['swap']> {
    const c = await this.prisma.creative.findUnique({ where: { id: s.creativeId }, select: { engineModel: true, voiceSource: true, variationBatchId: true, championId: true } });
    if (!c) return null;
    let estimate = 0;
    const engine = engineOfModel(c.engineModel);
    const m = engine ? await loadEditMap(this.prisma, c) : null;
    if (engine && m && s.startFrame != null && s.endFrame != null) {
      try {
        estimate = swapSceneEstimate(this.catalog, engine, c.voiceSource === 'ENGINE_VOICE' ? 'ENGINE_VOICE' : 'CHAMPION_AUDIO', m, {
          startFrame: s.startFrame, endFrame: s.endFrame, words: Array.isArray(s.words) ? (s.words as unknown as TranscriptWord[]) : [],
        }).costUsd;
      } catch {
        estimate = 0; // catálogo recusou: a leitura nunca quebra
      }
    }
    return sceneSwapOf(s, c, async (id) => this.file(await this.prisma.file.findUnique({ where: { id } })), estimate);
  }

  async render(r: RenderRow & { file?: FileRow | null }): Promise<Render> {
    const file = r.file === undefined && r.fileId ? await this.prisma.file.findUnique({ where: { id: r.fileId } }) : r.file;
    return {
      id: r.id,
      status: r.status,
      stage: r.stage,
      progress: r.status === 'READY' ? 100 : r.progress,
      frame: r.frame,
      totalFrames: r.totalFrames,
      failReason: r.failReason,
      failedFrame: r.failedFrame,
      action: r.status === 'FAILED' ? 'render_again' : null,
      video: r.status === 'READY' ? await this.file(file) : null,
      durationSec: num(r.durationSec),
      settings: r.settings as unknown as EditSettings,
      createdAt: r.createdAt.toISOString(),
      doc: editDocOf(r.doc),
      editRevision: r.editRevision,
    };
  }
}
