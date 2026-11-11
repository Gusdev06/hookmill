// troca-texto-queimado-v1 §16.5 (F1b, B1): medida da headline do campeão (sob demanda, também em campeão antigo) e o job
// CHAMPION_PLATE (placa do texto solto apagado), com a trava por championId + kind + layerKey + version e a espera do
// AUTO_PLAN. A porta (`TrocaTextoPort`) é do video; aqui só o banco, o storage, o job e o custo.
// Nada daqui roda com PLATE_IMPL=off (ou workspace fora de PLATE_WORKSPACE_IDS): o plano fica no estado do F1a.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { EditMap, HeadlineLook } from '@maquina/contratos';
import { Prisma, type ChampionPlate } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { CAPTION_LAYER_KEY, CAPTION_PLATE_VERSION, type CaptionTrack } from '../medicao/troca/legenda';
import { HEADLINE_PLATE_VERSION, TROCA_TEXTO, type PlacaHeadlineResult, type TrocaLegendaPort, type TrocaTextoPort } from '../medicao/troca/porta';
import { PrismaService } from '../prisma/prisma.service';
import type { HeadlinePlateState, PlateImplMode } from '../iteracao/headline-plano';
import { camadaAlvo } from '../iteracao/headline-plano';
import { editMapOf, transcriptOf } from './champion-views';
import { captionBoxOf, captionSwapLigado, legendaMaxSecDoEnv, temCamadaLegenda, type CaptionPlateState, type EditMapLegenda } from './legenda-troca';

export const TROCA_CONFIG = Symbol('TROCA_CONFIG');
/** O que o backend lê de `trocaConfig` (medicao/troca): o modo e a lista de workspaces liberados (vazio = todos). */
export interface TrocaLiberacao { impl: PlateImplMode; workspaceIds: string[] }

/** §16.5: espera da placa dentro do AUTO_PLAN. Passou = `headline_pending` neste lote; o job segue e serve ao próximo. */
const ESPERA_PADRAO_SEC = 180;
/** QA F1b Q1-B5: medida pedida pela galeria que falhou não é pedida de novo pela galeria antes disso (o lote mede igual). */
const GALERIA_APOS_FALHA_MS = 5 * 60_000;
/** Linha QUEUED/RUNNING sem mexer há mais que isso = processo morreu no meio: a trava é retomada. */
const TRAVA_VENCIDA_MS = 15 * 60_000;

const estadoDe = (r: Pick<ChampionPlate, 'status' | 'reason' | 'version'>): HeadlinePlateState => ({ status: r.status, reason: r.reason, version: r.version });

/** A porta que o backend injeta: a da headline (F1b) e, se a implementação já tiver, a da legenda (F2). Dobles do F1b só têm a 1ª. */
type PortaInjetada = TrocaTextoPort & Partial<TrocaLegendaPort>;
type AlvoPlaca = { kind: 'HEADLINE' | 'CAPTION'; layerKey: string; version: number };

@Injectable()
export class PlacasService {
  private readonly log = new Logger('Placas');
  /** Intervalo da espera (ms). Teste baixa. */
  pollMs = 1000;
  /** Medidas em voo por campeão (processo): a de depois da análise e a do AUTO_PLAN não medem 2 vezes. */
  private readonly emVoo = new Map<string, Promise<EditMap | null>>();
  /** QA F1b Q1-B5: medidas em segundo plano já agendadas pela galeria (antes de entrar em `emVoo`). */
  private readonly agendadas = new Set<string>();
  /** Última falha da medida por campeão (ms), pra galeria não repetir medida que falha a cada leitura. */
  private readonly falhaEm = new Map<string, number>();
  /** F2: detecções da legenda em voo por campeão (a de depois da análise e a do AUTO_PLAN não detectam 2 vezes). */
  private readonly legendaEmVoo = new Map<string, Promise<EditMapLegenda | null>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    @Inject(TROCA_CONFIG) private readonly cfg: TrocaLiberacao,
    @Optional() @Inject(TROCA_TEXTO) private readonly troca: PortaInjetada | null,
  ) {}

  /** Modo da troca para o workspace: 'off' se desligada, sem porta ou fora de PLATE_WORKSPACE_IDS. */
  implPara(workspaceId: string): PlateImplMode {
    if (this.cfg.impl === 'off' || !this.troca) return 'off';
    return !this.cfg.workspaceIds.length || this.cfg.workspaceIds.includes(workspaceId) ? this.cfg.impl : 'off';
  }

  /** Linha vigente (versão atual do método) da placa da camada. null = nunca pedida. */
  async estado(championId: string, layerKey: string): Promise<HeadlinePlateState | null> {
    const r = await this.prisma.championPlate.findUnique({ where: { championId_kind_layerKey_version: { championId, kind: 'HEADLINE', layerKey, version: HEADLINE_PLATE_VERSION } } });
    return r ? estadoDe(r) : null;
  }

  /** O que o contexto do plano precisa: modo e placa vigente da camada medida (se for solta). */
  async trocaDoCampeao(workspaceId: string, championId: string, editMap: EditMap | null): Promise<{ plateImpl: PlateImplMode; plate: HeadlinePlateState | null; captionPlate: CaptionPlateState | null }> {
    const plateImpl = this.implPara(workspaceId);
    const look = editMap?.headlineLook;
    const plate = plateImpl !== 'off' && look?.kind === 'loose' ? await this.estado(championId, look.layerId) : null;
    // F2: só olha a placa da legenda se a leitura achou legenda que pode ser trocada (`veredito.swap`)
    const track = (editMap as EditMapLegenda | null)?.captionTrack;
    const captionPlate = captionSwapLigado() && plateImpl !== 'off' && track?.veredito.swap ? await this.estadoLegenda(championId) : null;
    return { plateImpl, plate, captionPlate };
  }

  /** F2: linha vigente da placa CAPTION do campeão. null = nunca pedida. */
  async estadoLegenda(championId: string): Promise<CaptionPlateState | null> {
    const r = await this.prisma.championPlate.findUnique({ where: { championId_kind_layerKey_version: { championId, kind: 'CAPTION', layerKey: CAPTION_LAYER_KEY, version: CAPTION_PLATE_VERSION } } });
    return r ? estadoDe(r) : null;
  }

  /**
   * Medida sob demanda (§15.5.1, §15.4 "campeão antigo"): só quando a troca está ligada, há camada-alvo e o `editMap` ainda
   * não tem `headlineLook` da camada. Grava no `teardowns.edit_map` (null = medido, sem headline) e o custo. Falha da
   * função = não grava (estado do F1a, `headline_pending`; mede de novo no próximo lote). Devolve o editMap atualizado.
   */
  async medirSeFalta(i: { workspaceId: string; championId: string; batchId?: string | null; jobId?: string | null; editMap: EditMap | null }): Promise<EditMap | null> {
    // medida já em voo (a de depois da análise, ou outro lote): espera ela em vez de medir 2 vezes
    const voo = this.emVoo.get(i.championId);
    if (voo) {
      await voo.catch(() => undefined);
      const td = await this.prisma.teardown.findUnique({ where: { championId: i.championId }, select: { editMap: true } });
      const relido = editMapOf(td?.editMap);
      if (relido && relido.headlineLook !== undefined) return { ...(i.editMap ?? relido), headlineLook: relido.headlineLook } as EditMap;
    }
    const p = this.medir(i);
    this.emVoo.set(i.championId, p);
    try {
      return await p;
    } finally {
      if (this.emVoo.get(i.championId) === p) this.emVoo.delete(i.championId);
    }
  }

  /** Depois da análise (decisão 06/11): mede em segundo plano, sem segurar o job; serve à galeria de templates. */
  medirDepoisDaAnalise(championId: string): Promise<void> {
    return this.jobs.detach(null, `medida da headline do campeão ${championId}`, async () => {
      const c = await this.prisma.champion.findUnique({ where: { id: championId }, select: { workspaceId: true, teardown: { select: { editMap: true } } } });
      if (!c || this.implPara(c.workspaceId) === 'off') return;
      const em = await this.medirSeFalta({ workspaceId: c.workspaceId, championId, editMap: editMapOf(c.teardown?.editMap) });
      await this.detectarLegendaSeFalta({ workspaceId: c.workspaceId, championId, editMap: em });
    });
  }

  /**
   * QA F1b Q1-B5: campeão antigo (sem medida) visto na galeria ou no `use` de template. Dispara a medida em segundo plano e
   * volta na hora (a resposta segue `headline_pending`; a próxima leitura já vê o resultado). Não agenda de novo se já há
   * medida agendada/em voo, nem logo depois de uma falha. Troca desligada pro workspace = nada.
   */
  medirEmSegundoPlano(workspaceId: string, championId: string): void {
    if (this.implPara(workspaceId) === 'off' || this.agendadas.has(championId) || this.emVoo.has(championId)) return;
    const f = this.falhaEm.get(championId);
    if (f !== undefined && Date.now() - f < GALERIA_APOS_FALHA_MS) return;
    this.agendadas.add(championId);
    void this.medirDepoisDaAnalise(championId).finally(() => this.agendadas.delete(championId));
  }

  private async medir(i: { workspaceId: string; championId: string; batchId?: string | null; jobId?: string | null; editMap: EditMap | null }): Promise<EditMap | null> {
    const m = i.editMap;
    if (!m || this.implPara(i.workspaceId) === 'off') return m;
    const alvo = camadaAlvo(m, 'local');
    if (!alvo) return m;
    if (m.headlineLook !== undefined && (m.headlineLook === null || (m.headlineLook.version === 2 && m.headlineLook.layerId === alvo.id))) return m;
    const ch = await this.prisma.champion.findUnique({ where: { id: i.championId }, select: { videoFile: true } });
    if (!ch?.videoFile) return m;
    let look: HeadlineLook | null;
    try {
      const r = await this.troca!.medirHeadline({ workspaceId: i.workspaceId, championId: i.championId, videoUrl: await this.storage.signedUrl(ch.videoFile), editMap: m });
      look = r.look;
      await this.custo({ workspaceId: i.workspaceId, championId: i.championId, batchId: i.batchId ?? null, jobId: i.jobId ?? null, op: 'medir_headline', costUsd: r.costUsd });
      this.log.log(`campeão ${i.championId}: headline medida em ${r.ms} ms (${look ? `${look.kind}, ${look.verdict.ok ? 'ok' : look.verdict.reason}` : 'sem headline'})`);
    } catch (e) {
      this.log.warn(`campeão ${i.championId}: medida da headline falhou (${(e as Error).message}); fica headline_pending`);
      this.falhaEm.set(i.championId, Date.now());
      return m;
    }
    this.falhaEm.delete(i.championId);
    const novo = { ...m, headlineLook: look } as EditMap;
    // grava só o campo, por cima do editMap ATUAL (outra escrita no meio não se perde)
    await this.prisma.$transaction(async (tx) => {
      const td = await tx.teardown.findUnique({ where: { championId: i.championId }, select: { editMap: true } });
      const atual = editMapOf(td?.editMap);
      if (!atual) return;
      await tx.teardown.update({ where: { championId: i.championId }, data: { editMap: { ...atual, headlineLook: look } as unknown as Prisma.InputJsonValue } });
    });
    return novo;
  }

  /**
   * F2 (§15.6.1, §15.6.5): detecta a legenda queimada na leitura e grava `editMap.captionTrack` (null = sem legenda). Só quando a
   * troca está ligada, a porta tem `detectarLegenda` e o mapa ainda não tem o campo. Sem camada `caption` grava null sem chamar a
   * função (custo zero). Falha da porta = não grava (o formato segue fora como no F1b; detecta de novo no próximo lote).
   */
  async detectarLegendaSeFalta(i: { workspaceId: string; championId: string; batchId?: string | null; jobId?: string | null; editMap: EditMap | null }): Promise<EditMapLegenda | null> {
    const m = i.editMap as EditMapLegenda | null;
    if (!captionSwapLigado()) return m;
    if (!m || this.implPara(i.workspaceId) === 'off' || !this.troca?.detectarLegenda) return m;
    if (m.captionTrack !== undefined) return m;
    const voo = this.legendaEmVoo.get(i.championId);
    if (voo) { await voo.catch(() => undefined); const td = await this.prisma.teardown.findUnique({ where: { championId: i.championId }, select: { editMap: true } }); const r = editMapOf(td?.editMap) as EditMapLegenda | null; return r && r.captionTrack !== undefined ? { ...m, captionTrack: r.captionTrack } : m; }
    const p = this.detectarLegenda(i, m);
    this.legendaEmVoo.set(i.championId, p);
    try { return await p; } finally { if (this.legendaEmVoo.get(i.championId) === p) this.legendaEmVoo.delete(i.championId); }
  }

  private async detectarLegenda(i: { workspaceId: string; championId: string; batchId?: string | null; jobId?: string | null }, m: EditMapLegenda): Promise<EditMapLegenda | null> {
    let track: CaptionTrack | null = null;
    if (temCamadaLegenda(m)) {
      const c = await this.prisma.champion.findUnique({ where: { id: i.championId }, select: { videoFile: true, durationSec: true, teardown: { select: { transcript: true, measurements: true } } } });
      if (!c?.videoFile) return m;
      const dur = Number((c.teardown?.measurements as { durationSec?: number } | null)?.durationSec ?? c.durationSec ?? 0);
      try {
        const r = await this.troca!.detectarLegenda!({
          workspaceId: i.workspaceId, championId: i.championId, videoUrl: await this.storage.signedUrl(c.videoFile), editMap: m,
          words: transcriptOf(c.teardown?.transcript as never)?.words ?? [], durationSec: dur, captionBox: captionBoxOf(m), legendaMaxSec: legendaMaxSecDoEnv(process.env.LEGENDA_MAX_SEC),
        });
        track = r.captionTrack;
        await this.custo({ workspaceId: i.workspaceId, championId: i.championId, batchId: i.batchId ?? null, jobId: i.jobId ?? null, op: 'detectar_legenda', costUsd: r.costUsd });
        this.log.log(`campeão ${i.championId}: legenda detectada em ${r.ms} ms (${track ? (track.veredito.swap ? 'swap ok' : track.veredito.reason) : 'sem legenda'})`);
      } catch (e) {
        this.log.warn(`campeão ${i.championId}: detecção da legenda falhou (${(e as Error).message}); formatos com legenda seguem fora`);
        return m;
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const td = await tx.teardown.findUnique({ where: { championId: i.championId }, select: { editMap: true } });
      const atual = editMapOf(td?.editMap);
      if (!atual) return;
      await tx.teardown.update({ where: { championId: i.championId }, data: { editMap: { ...atual, captionTrack: track } as unknown as Prisma.InputJsonValue } });
    });
    return { ...m, captionTrack: track };
  }

  /** F2: garante a placa CAPTION (só com `veredito.swap`) e espera até `esperaSec`, como a da headline. */
  async garantirPlacaLegenda(i: { workspaceId: string; championId: string; createdById: string; batchId?: string | null; track: CaptionTrack; esperaSec?: number }): Promise<CaptionPlateState | null> {
    if (this.implPara(i.workspaceId) === 'off' || !this.troca?.placaLegenda || !i.track.veredito.swap) return null;
    const id = await this.enfileirar(i, { kind: 'CAPTION', layerKey: CAPTION_LAYER_KEY, version: CAPTION_PLATE_VERSION }, (jobId, plateId) => this.rodarLegenda(jobId, plateId, i.track));
    return this.esperarPlaca(id, i.championId, i.esperaSec);
  }

  /**
   * Garante a placa da headline solta e espera até `esperaSec` (§16.5). READY/REJECTED/FAILED já gravados = sem job (não
   * reprocessa). QUEUED/RUNNING de outro lote = só espera. Devolve o estado ao fim da espera (QUEUED/RUNNING = não ficou pronta).
   */
  async garantirPlaca(i: { workspaceId: string; championId: string; createdById: string; batchId?: string | null; look: HeadlineLook; esperaSec?: number }): Promise<HeadlinePlateState | null> {
    if (this.implPara(i.workspaceId) === 'off' || i.look.kind !== 'loose') return null;
    const id = await this.enfileirar(i, { kind: 'HEADLINE', layerKey: i.look.layerId, version: HEADLINE_PLATE_VERSION }, (jobId, plateId) => this.rodar(jobId, plateId, i.look));
    return this.esperarPlaca(id, i.championId, i.esperaSec);
  }

  private async esperarPlaca(id: string, championId: string, esperaSec?: number): Promise<HeadlinePlateState | null> {
    const fim = Date.now() + (esperaSec ?? (Number(process.env.PLATE_WAIT_SEC) || ESPERA_PADRAO_SEC)) * 1000;
    for (;;) {
      const r = await this.prisma.championPlate.findUnique({ where: { id } });
      if (!r) return null;
      if (r.status !== 'QUEUED' && r.status !== 'RUNNING') return estadoDe(r);
      if (Date.now() >= fim) {
        this.log.warn(`placa ${id} (campeão ${championId}) não ficou pronta na espera; fica pendente neste lote`);
        return estadoDe(r);
      }
      await new Promise((ok) => setTimeout(ok, this.pollMs));
    }
  }

  /** Cria (ou retoma, se a trava venceu) a linha e solta o job. Devolve o id da linha. */
  private async enfileirar(i: { workspaceId: string; championId: string; createdById: string; batchId?: string | null }, alvo: AlvoPlaca, exec: (jobId: string, plateId: string) => Promise<void>): Promise<string> {
    const key = { championId: i.championId, ...alvo };
    let row = await this.prisma.championPlate.findUnique({ where: { championId_kind_layerKey_version: key } });
    let dono = false;
    if (!row) {
      try {
        row = await this.prisma.championPlate.create({ data: { ...key, workspaceId: i.workspaceId, status: 'QUEUED' } });
        dono = true;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        row = await this.prisma.championPlate.findUniqueOrThrow({ where: { championId_kind_layerKey_version: key } });
      }
    } else if ((row.status === 'QUEUED' || row.status === 'RUNNING') && Date.now() - row.updatedAt.getTime() > TRAVA_VENCIDA_MS) {
      // trava vencida: CAS no updatedAt, só um retoma
      const hit = await this.prisma.championPlate.updateMany({ where: { id: row.id, updatedAt: row.updatedAt }, data: { status: 'QUEUED', reason: null } });
      dono = hit.count === 1;
    }
    if (dono) {
      const job = await this.jobs.create({
        workspaceId: i.workspaceId, type: 'CHAMPION_PLATE', createdById: i.createdById,
        input: { plateId: row.id, championId: i.championId, kind: key.kind, layerKey: key.layerKey, version: key.version, batchId: i.batchId ?? null },
      });
      const plateId = row.id;
      void this.jobs.detach(job.id, `placa ${plateId}`, () => exec(job.id, plateId));
    }
    return row.id;
  }

  /** O job da headline: RUNNING → porta → READY (arquivo + custo) | REJECTED | FAILED. Nunca deixa a linha presa em RUNNING. */
  private rodar(jobId: string, plateId: string, look: HeadlineLook): Promise<void> {
    return this.rodarPlaca(jobId, plateId, 'placa_headline', (row, videoUrl, outputKey) => this.troca!.placaHeadline({ workspaceId: row.workspaceId, championId: row.championId, videoUrl, look, version: row.version, outputKey }));
  }

  /** F2: o mesmo job para a placa da legenda (`placaLegenda`; `reason` vira `CaptionSwapReason`). */
  private rodarLegenda(jobId: string, plateId: string, captionTrack: CaptionTrack): Promise<void> {
    return this.rodarPlaca(jobId, plateId, 'placa_legenda', (row, videoUrl, outputKey) => this.troca!.placaLegenda!({ workspaceId: row.workspaceId, championId: row.championId, videoUrl, captionTrack, version: row.version, outputKey }));
  }

  private async rodarPlaca(jobId: string, plateId: string, op: string, chamar: (row: ChampionPlate, videoUrl: string, outputKey: string) => Promise<PlacaHeadlineResult>): Promise<void> {
    const row = await this.prisma.championPlate.update({ where: { id: plateId }, data: { status: 'RUNNING' } });
    await this.jobs.stage(jobId, 'erasing', 10);
    try {
      const ch = await this.prisma.champion.findUniqueOrThrow({ where: { id: row.championId }, select: { videoFile: true } });
      if (!ch.videoFile) throw new Error('campeão sem vídeo');
      const outputKey = this.storage.newKey(row.workspaceId, 'CHAMPION_PLATE', 'video/mp4');
      const r = await chamar(row, await this.storage.signedUrl(ch.videoFile), outputKey);
      await this.jobs.stage(jobId, 'checking', 90);
      await this.custo({ workspaceId: row.workspaceId, championId: row.championId, batchId: null, jobId, op, costUsd: r.costUsd });
      const metrics = { ...r.metrics, ms: r.ms } as Prisma.InputJsonValue;
      if (r.status === 'READY') {
        const file = await this.storage.registerObject(outputKey, { workspaceId: row.workspaceId, kind: 'CHAMPION_PLATE', mimeType: 'video/mp4', sizeBytes: r.sizeBytes ?? 0 });
        await this.prisma.championPlate.update({ where: { id: plateId }, data: { status: 'READY', reason: null, fileId: file.id, metrics, costUsd: r.costUsd } });
      } else {
        await this.prisma.championPlate.update({ where: { id: plateId }, data: { status: r.status, reason: r.reason ?? (r.status === 'REJECTED' ? 'plate_rejected' : 'plate_failed'), metrics, costUsd: r.costUsd } });
      }
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: { plateId, status: r.status, reason: r.reason } });
    } catch (e) {
      this.log.warn(`placa ${plateId}: ${(e as Error).message}`);
      await this.prisma.championPlate.update({ where: { id: plateId }, data: { status: 'FAILED', reason: 'plate_failed', metrics: { erro: 1 } } }).catch(() => undefined);
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: 'PROVIDER_ERROR', failReason: 'The text plate could not be made.' }).catch(() => undefined);
    }
  }

  /** Custo real da função (Lambda) no campeão/lote; local e fake = 0, sem linha. */
  private async custo(i: { workspaceId: string; championId: string; batchId: string | null; jobId: string | null; op: string; costUsd: number }): Promise<void> {
    if (!(i.costUsd > 0)) return;
    await this.prisma.costEntry.create({
      data: {
        workspaceId: i.workspaceId, championId: i.championId, variationBatchId: i.batchId, jobId: i.jobId, provider: 'AWS_LAMBDA', kind: 'RENDER',
        model: `hookmill-legenda:${i.op}`, units: 1, unit: 'call', amountUsd: Math.round(i.costUsd * 10_000) / 10_000,
      },
    });
  }
}
