// troca-texto-queimado-v1 §16.5 (F1b, B1): medida da headline do campeão (sob demanda, também em campeão antigo) e o job
// CHAMPION_PLATE (placa do texto solto apagado), com a trava por championId + kind + layerKey + version e a espera do
// AUTO_PLAN. A porta (`TrocaTextoPort`) é do video; aqui só o banco, o storage, o job e o custo.
// Nada daqui roda com PLATE_IMPL=off (ou workspace fora de PLATE_WORKSPACE_IDS): o plano fica no estado do F1a.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { EditMap, HeadlineLook } from '@maquina/contratos';
import { Prisma, type ChampionPlate } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { HEADLINE_PLATE_VERSION, TROCA_TEXTO, type TrocaTextoPort } from '../medicao/troca/porta';
import { PrismaService } from '../prisma/prisma.service';
import type { HeadlinePlateState, PlateImplMode } from '../iteracao/headline-plano';
import { camadaAlvo } from '../iteracao/headline-plano';
import { editMapOf } from './champion-views';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    @Inject(TROCA_CONFIG) private readonly cfg: TrocaLiberacao,
    @Optional() @Inject(TROCA_TEXTO) private readonly troca: TrocaTextoPort | null,
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
  async trocaDoCampeao(workspaceId: string, championId: string, editMap: EditMap | null): Promise<{ plateImpl: PlateImplMode; plate: HeadlinePlateState | null }> {
    const plateImpl = this.implPara(workspaceId);
    const look = editMap?.headlineLook;
    const plate = plateImpl !== 'off' && look?.kind === 'loose' ? await this.estado(championId, look.layerId) : null;
    return { plateImpl, plate };
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
      await this.medirSeFalta({ workspaceId: c.workspaceId, championId, editMap: editMapOf(c.teardown?.editMap) });
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
   * Garante a placa da headline solta e espera até `esperaSec` (§16.5). READY/REJECTED/FAILED já gravados = sem job (não
   * reprocessa). QUEUED/RUNNING de outro lote = só espera. Devolve o estado ao fim da espera (QUEUED/RUNNING = não ficou pronta).
   */
  async garantirPlaca(i: { workspaceId: string; championId: string; createdById: string; batchId?: string | null; look: HeadlineLook; esperaSec?: number }): Promise<HeadlinePlateState | null> {
    if (this.implPara(i.workspaceId) === 'off' || i.look.kind !== 'loose') return null;
    const id = await this.enfileirar(i);
    const fim = Date.now() + (i.esperaSec ?? (Number(process.env.PLATE_WAIT_SEC) || ESPERA_PADRAO_SEC)) * 1000;
    for (;;) {
      const r = await this.prisma.championPlate.findUnique({ where: { id } });
      if (!r) return null;
      if (r.status !== 'QUEUED' && r.status !== 'RUNNING') return estadoDe(r);
      if (Date.now() >= fim) {
        this.log.warn(`placa ${id} (campeão ${i.championId}) não ficou pronta na espera; headline_pending neste lote`);
        return estadoDe(r);
      }
      await new Promise((ok) => setTimeout(ok, this.pollMs));
    }
  }

  /** Cria (ou retoma, se a trava venceu) a linha e solta o job. Devolve o id da linha. */
  private async enfileirar(i: { workspaceId: string; championId: string; createdById: string; batchId?: string | null; look: HeadlineLook }): Promise<string> {
    const key = { championId: i.championId, kind: 'HEADLINE' as const, layerKey: i.look.layerId, version: HEADLINE_PLATE_VERSION };
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
        input: { plateId: row.id, championId: i.championId, layerKey: key.layerKey, version: key.version, batchId: i.batchId ?? null },
      });
      const plateId = row.id;
      void this.jobs.detach(job.id, `placa ${plateId}`, () => this.rodar(job.id, plateId, i.look));
    }
    return row.id;
  }

  /** O job: RUNNING → porta → READY (arquivo + custo) | REJECTED | FAILED. Nunca deixa a linha presa em RUNNING. */
  private async rodar(jobId: string, plateId: string, look: HeadlineLook): Promise<void> {
    const row = await this.prisma.championPlate.update({ where: { id: plateId }, data: { status: 'RUNNING' } });
    await this.jobs.stage(jobId, 'erasing', 10);
    try {
      const ch = await this.prisma.champion.findUniqueOrThrow({ where: { id: row.championId }, select: { videoFile: true } });
      if (!ch.videoFile) throw new Error('campeão sem vídeo');
      const outputKey = this.storage.newKey(row.workspaceId, 'CHAMPION_PLATE', 'video/mp4');
      const r = await this.troca!.placaHeadline({ workspaceId: row.workspaceId, championId: row.championId, videoUrl: await this.storage.signedUrl(ch.videoFile), look, version: row.version, outputKey });
      await this.jobs.stage(jobId, 'checking', 90);
      await this.custo({ workspaceId: row.workspaceId, championId: row.championId, batchId: null, jobId, op: 'placa_headline', costUsd: r.costUsd });
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
