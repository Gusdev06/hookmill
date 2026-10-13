import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CreativeDetail, CreativeState, Job, Script, ScriptBlock, ScriptsResponse, WinnerUsed } from '@maquina/contratos';
import type { Creative, JobType, Prisma, Script as ScriptRow } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { asAsyncErrorCode, failReasonFor } from '../common/errors/falhas';
import { KeyedMutex } from '../common/util/mutex';
import { hasLoss, markStale, requireConfirm } from '../criativos/downstream';
import { CreativeStateMachine, invalidState, pickEvent, assertNotVariation } from '../criativos/state-machine';
import { CreativeViews, blocksOf } from '../criativos/views';
import { CustosService, SCRIPT_ESTIMATE_USD } from '../custos/custos.service';
import { EventosService } from '../eventos/eventos.service';
import { CLAUDE_SERVICE, isIntegracaoError, type ClaudeService, type ScriptDraft, type WinnerExample } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { draftOf } from '../ofertas/ofertas.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateScriptDto } from './roteiros.dto';

export const MAX_ACTIVE_SCRIPTS = 5;
const STAGE_PROGRESS: Record<string, number> = { reading_brief: 5, studying_winners: 15, writing: 25 };
const WORDS_PER_SEC = 2.5;

/** "A", "B", … "Z", "AA", "AB"… pela ordem de criação no criativo (letra nunca é reaproveitada). */
export function letterAt(n: number): string {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Edita fala/prompt de blocos existentes e recalcula os tempos proporcional ao nº de palavras
 * (bloco editado mantém o ritmo de fala que tinha; os seguintes andam junto).
 */
export function applyBlockEdits(blocks: ScriptBlock[], edits: { index: number; speech?: string; visualPrompt?: string }[]): ScriptBlock[] {
  const out = blocks.map((b) => ({ ...b }));
  for (const e of edits) {
    const b = out[e.index];
    if (!b) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `blocks.${e.index}.index`, rule: 'exists' }] });
    if (e.visualPrompt !== undefined) b.visualPrompt = e.visualPrompt;
    if (e.speech !== undefined && e.speech !== b.speech) {
      const oldDur = b.endSec - b.startSec;
      const oldWords = words(b.speech);
      const rate = oldWords > 0 && oldDur > 0 ? oldWords / oldDur : WORDS_PER_SEC;
      b.speech = e.speech;
      b.endSec = b.startSec + Math.max(1, r1(words(e.speech) / rate));
    }
  }
  let at = out.length ? out[0].startSec : 0;
  for (const b of out) {
    const dur = b.endSec - b.startSec;
    b.startSec = r1(at);
    b.endSec = r1(at + dur);
    at = b.endSec;
  }
  return out;
}

interface Slot { scriptId: string; letter: string }

@Injectable()
export class RoteirosService {
  private readonly log = new Logger('Roteiros');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly custos: CustosService,
    private readonly sm: CreativeStateMachine,
    private readonly views: CreativeViews,
    private readonly eventos: EventosService,
    private readonly locks: KeyedMutex,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
  ) {}

  async creative(auth: AuthContext, id: string): Promise<Creative> {
    const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  private async script(c: Creative, scriptId: string): Promise<ScriptRow> {
    const s = await this.prisma.script.findFirst({ where: { id: scriptId, creativeId: c.id, workspaceId: c.workspaceId, discardedAt: null } });
    if (!s) throw new AppException('NOT_FOUND');
    return s;
  }

  private activeScripts(creativeId: string) {
    return this.prisma.script.findMany({ where: { creativeId, discardedAt: null }, orderBy: [{ createdAt: 'asc' }, { letter: 'asc' }] });
  }

  // ───────── leitura ─────────

  async list(auth: AuthContext, creativeId: string): Promise<ScriptsResponse> {
    const c = await this.creative(auth, creativeId);
    const [scripts, job] = await Promise.all([
      this.activeScripts(c.id),
      this.prisma.job.findFirst({ where: { creativeId: c.id, type: { in: ['SCRIPTS_GENERATE', 'SCRIPT_REGENERATE'] } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const ids = [...new Set(scripts.flatMap((s) => s.informedByCreativeIds))];
    const winners = ids.length
      ? await this.prisma.creative.findMany({ where: { id: { in: ids }, workspaceId: auth.workspaceId }, include: { offer: { select: { name: true } } } })
      : [];
    const winnersUsed: WinnerUsed[] = winners.map((w) => ({ creativeId: w.id, name: w.name, offerName: w.offer.name, sameOffer: w.offerId === c.offerId }));
    return {
      scripts: scripts.map((s) => this.views.script(s, c.selectedScriptId)),
      job: job ? (await this.jobs.get(auth, job.id)) : null,
      winnersUsed,
    };
  }

  // ───────── escrever roteiros ─────────

  /** POST …/scripts/generate: "Regenerate all" (replace) ou "Write the other N". */
  async generate(auth: AuthContext, creativeId: string, count: number, replace: boolean): Promise<{ job: Job; scripts: Script[] }> {
    return this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotVariation(c);
      pickEvent(c.state, ['GENERATE_SCRIPTS']);
      const active = await this.prisma.script.count({ where: { creativeId: c.id, discardedAt: null } });
      if ((replace ? 0 : active) + count > MAX_ACTIVE_SCRIPTS) {
        throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'count', rule: 'maxActiveScripts' }] });
      }
      await this.custos.assertWithinCap(auth.workspaceId, count * SCRIPT_ESTIMATE_USD);
      const avoid = replace ? [] : (await this.activeScripts(c.id)).map((s) => s.angle).filter((a): a is string => !!a);
      const { slots, job } = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event: 'GENERATE_SCRIPTS', from: c.state, to: 'SCRIPTS_WRITING' });
        if (replace) {
          await tx.script.updateMany({ where: { creativeId: c.id, discardedAt: null }, data: { discardedAt: new Date() } });
          if (c.selectedScriptId) await tx.creative.update({ where: { id: c.id }, data: { selectedScriptId: null } });
        }
        return this.openSlots(tx, c, auth.userId, count, 'SCRIPTS_GENERATE', { count, replace });
      });
      this.sm.announce(c.id);
      void this.jobs.detach(job.id, 'roteiros', () => this.run(job.id, c.id, slots, avoid));
      const scripts = await this.prisma.script.findMany({ where: { id: { in: slots.map((s) => s.scriptId) } }, orderBy: { letter: 'asc' } });
      return { job: await this.jobs.announceById(job.id), scripts: scripts.map((s) => this.views.script(s, null)) };
    });
  }

  /** POST …/scripts/:id/regenerate: mesma letra, conteúdo novo. */
  async regenerate(auth: AuthContext, creativeId: string, scriptId: string): Promise<{ job: Job; script: Script }> {
    return this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotVariation(c);
      const s = await this.script(c, scriptId);
      pickEvent(c.state, ['GENERATE_SCRIPTS']);
      await this.custos.assertWithinCap(auth.workspaceId, SCRIPT_ESTIMATE_USD);
      const avoid = (await this.activeScripts(c.id)).map((x) => x.angle).filter((a): a is string => !!a);
      const job = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, creativeId: c.id, event: 'GENERATE_SCRIPTS', from: c.state, to: 'SCRIPTS_WRITING' });
        if (c.selectedScriptId === s.id) await tx.creative.update({ where: { id: c.id }, data: { selectedScriptId: null } });
        const j = await tx.job.create({
          data: { workspaceId: c.workspaceId, type: 'SCRIPT_REGENERATE', status: 'QUEUED', input: { scriptId: s.id }, creativeId: c.id, offerId: c.offerId, createdById: auth.userId },
        });
        await tx.script.update({
          where: { id: s.id },
          data: { status: 'WRITING', angle: null, rationale: null, durationSec: null, blocks: [], informedByCreativeIds: [], editedByUser: false, failReason: null, jobId: j.id },
        });
        return j;
      });
      this.sm.announce(c.id);
      void this.jobs.detach(job.id, 'roteiro', () => this.run(job.id, c.id, [{ scriptId: s.id, letter: s.letter }], avoid));
      const fresh = await this.prisma.script.findUniqueOrThrow({ where: { id: s.id } });
      return { job: await this.jobs.announceById(job.id), script: this.views.script(fresh, null) };
    });
  }

  /** Cria N roteiros WRITING com as próximas letras + o job (dentro da transação de quem chama). */
  async openSlots(
    tx: Prisma.TransactionClient, c: Pick<Creative, 'id' | 'workspaceId' | 'offerId'>, userId: string,
    count: number, type: JobType, input: Prisma.InputJsonValue,
  ): Promise<{ slots: Slot[]; job: { id: string } }> {
    const used = await tx.script.count({ where: { creativeId: c.id } });
    const job = await tx.job.create({
      data: { workspaceId: c.workspaceId, type, status: 'QUEUED', input, creativeId: c.id, offerId: c.offerId, createdById: userId },
    });
    const slots: Slot[] = [];
    for (let i = 0; i < count; i++) {
      const letter = letterAt(used + i);
      const s = await tx.script.create({ data: { workspaceId: c.workspaceId, creativeId: c.id, letter, status: 'WRITING', jobId: job.id } });
      slots.push({ scriptId: s.id, letter });
    }
    return { slots, job };
  }

  /** Vencedores do workspace: até 5 da mesma oferta e até 3 de outras (só estrutura). */
  async winners(workspaceId: string, offerId: string): Promise<WinnerExample[]> {
    const base = { workspaceId, isWinner: true, state: 'APPROVED' as const, archivedAt: null, selectedScriptId: { not: null } };
    const [same, other] = await Promise.all([
      this.prisma.creative.findMany({ where: { ...base, offerId }, include: { selectedScript: true }, orderBy: { winnerMarkedAt: 'desc' }, take: 5 }),
      this.prisma.creative.findMany({ where: { ...base, offerId: { not: offerId } }, include: { selectedScript: true }, orderBy: { winnerMarkedAt: 'desc' }, take: 3 }),
    ]);
    return [...same.map((c) => [c, true] as const), ...other.map((c) => [c, false] as const)].map(([c, sameOffer]) => ({
      creativeId: c.id,
      sameOffer,
      angle: c.selectedScript?.angle ?? null,
      blocks: blocksOf(c.selectedScript?.blocks ?? []),
    }));
  }

  /**
   * Roda o job de roteiros em segundo plano: streaming (script.delta), roteiro pronto/falho (script.updated),
   * etapas (job.updated) e, no fim, a transição SCRIPTS_WRITING → SCRIPTS_READY | SCRIPTS_FAILED.
   */
  async run(jobId: string, creativeId: string, slots: Slot[], avoidAngles: string[]): Promise<void> {
    let chain: Promise<unknown> = Promise.resolve();
    const later = (fn: () => Promise<unknown>) => (chain = chain.then(fn).catch((e) => this.log.warn(`job ${jobId}: ${(e as Error).message}`)));
    let firstError: string | null = null;
    try {
      const c = await this.prisma.creative.findUniqueOrThrow({ where: { id: creativeId }, include: { offer: true } });
      const winners = await this.winners(c.workspaceId, c.offerId);
      const informed = winners.map((w) => w.creativeId);
      await this.claude.generateScripts(
        { workspaceId: c.workspaceId, creativeId, jobId, offer: draftOf(c.offer), count: slots.length, avoidAngles, winners },
        {
          onStage: (stage) => later(() => this.jobs.stage(jobId, stage, STAGE_PROGRESS[stage])),
          onDelta: (slot, blockIndex, field, text) => {
            const s = slots[slot];
            if (s) this.eventos.publish(creativeId, 'script.delta', { scriptId: s.scriptId, letter: s.letter, blockIndex, field, text });
          },
          onScriptDone: (slot, draft) => later(() => this.saveDraft(slots[slot], draft, informed, creativeId)),
          onScriptFailed: (slot, code) => {
            firstError ??= code;
            later(() => this.saveFailure(slots[slot], code, creativeId));
          },
        },
      );
    } catch (e) {
      firstError ??= isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      if (!isIntegracaoError(e)) this.log.error(`roteiros ${jobId} falharam: ${(e as Error).stack ?? e}`);
    }
    await chain;
    await this.finish(jobId, creativeId, slots, firstError).catch((e) => this.log.warn(`fim do job ${jobId}: ${(e as Error).message}`));
  }

  private async saveDraft(slot: Slot | undefined, d: ScriptDraft, informed: string[], creativeId: string) {
    if (!slot) return;
    const s = await this.prisma.script.update({
      where: { id: slot.scriptId },
      data: {
        status: 'READY', angle: d.angle, rationale: d.rationale, durationSec: d.durationSec,
        blocks: d.blocks as unknown as Prisma.InputJsonValue, informedByCreativeIds: informed, failReason: null,
      },
    });
    this.eventos.publish(creativeId, 'script.updated', this.views.script(s, null));
  }

  private async saveFailure(slot: Slot | undefined, code: string, creativeId: string) {
    if (!slot) return;
    const s = await this.prisma.script.update({
      where: { id: slot.scriptId },
      data: { status: 'FAILED', failReason: failReasonFor(asAsyncErrorCode(code)) },
    });
    this.eventos.publish(creativeId, 'script.updated', this.views.script(s, null));
  }

  /** Fecha o job (SUCCEEDED / PARTIAL / FAILED) e aplica a transição do criativo. Também usado pelo boot (INTERRUPTED). */
  async finish(jobId: string, creativeId: string, slots: Slot[] | null, errorCode: string | null) {
    const ids = slots?.map((s) => s.scriptId);
    const where = ids ? { id: { in: ids } } : { jobId };
    const code = asAsyncErrorCode(errorCode);
    await this.prisma.script.updateMany({ where: { ...where, status: 'WRITING' }, data: { status: 'FAILED', failReason: failReasonFor(code) } });
    const rows = await this.prisma.script.findMany({ where, select: { status: true } });
    const ready = rows.filter((r) => r.status === 'READY').length;
    const status = rows.length && ready === rows.length ? 'SUCCEEDED' : ready > 0 ? 'PARTIAL' : 'FAILED';
    await this.jobs.finish(jobId, {
      status,
      output: { scriptIds: ids ?? [] },
      errorCode: status === 'SUCCEEDED' ? null : code,
      failReason: status === 'SUCCEEDED' ? null : failReasonFor(code),
    });
    await this.locks.run(creativeId, async () => {
      const anyReady = await this.prisma.script.count({ where: { creativeId, discardedAt: null, status: 'READY' } });
      const pending = await this.prisma.script.count({ where: { creativeId, discardedAt: null, status: 'WRITING' } });
      if (pending) return; // outro job do mesmo criativo ainda escreve
      await this.sm
        .transition({ creativeId, event: 'SCRIPTS_JOB_DONE', from: 'SCRIPTS_WRITING', to: anyReady ? 'SCRIPTS_READY' : 'SCRIPTS_FAILED' })
        .catch(() => undefined); // já saiu de SCRIPTS_WRITING (ou foi arquivado): nada a fazer
    });
  }

  // ───────── editar / escolher ─────────

  async update(auth: AuthContext, creativeId: string, scriptId: string, dto: UpdateScriptDto): Promise<Script> {
    return this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotVariation(c);
      const s = await this.script(c, scriptId);
      if (c.state === 'APPROVED' || s.status !== 'READY') {
        throw invalidState(c.state, ['SCRIPTS_READY', 'AVATAR_PENDING', 'FACES_READY', 'FACES_FAILED', 'ENGINE_PENDING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDER_FAILED', 'RENDER_READY']);
      }
      const blocks = dto.blocks ? applyBlockEdits(blocksOf(s.blocks), dto.blocks) : blocksOf(s.blocks);
      const durationSec = blocks.length ? blocks[blocks.length - 1].endSec - blocks[0].startSec : null;
      const isChosen = c.selectedScriptId === s.id;
      const updated = await this.prisma.$transaction(async (tx) => {
        if (isChosen) {
          // roteiro escolhido com cenas/renders vigentes: mudar fala/prompt invalida o que foi gerado (confirm)
          const loss = await requireConfirm(tx, c.id, dto.confirm);
          if (hasLoss(loss)) {
            const ev = pickEvent(c.state, ['RESELECT_SCRIPT']);
            await this.sm.transition({ tx, creativeId: c.id, event: ev, from: c.state, to: c.selectedFaceId ? 'ENGINE_PENDING' : 'FACES_READY' });
            await markStale(tx, c.id);
          }
        }
        return tx.script.update({
          where: { id: s.id },
          data: {
            ...(dto.angle !== undefined && { angle: dto.angle }),
            blocks: blocks as unknown as Prisma.InputJsonValue,
            durationSec,
            editedByUser: true,
          },
        });
      });
      this.sm.announce(c.id);
      const view = this.views.script(updated, c.selectedScriptId);
      this.eventos.publish(c.id, 'script.updated', view);
      return view;
    });
  }

  async select(auth: AuthContext, creativeId: string, scriptId: string, confirm?: boolean): Promise<CreativeDetail> {
    const c = await this.locks.run(creativeId, async () => {
      const c = await this.creative(auth, creativeId);
      assertNotVariation(c);
      const s = await this.script(c, scriptId);
      const ev = pickEvent(c.state, ['SELECT_SCRIPT', 'RESELECT_SCRIPT']);
      if (s.status !== 'READY') throw invalidState(c.state, ['SCRIPTS_READY']);
      if (ev === 'RESELECT_SCRIPT' && c.selectedScriptId === s.id) return c; // mesma escolha: nada muda
      const readyFaces = await this.prisma.face.count({ where: { creativeId: c.id, status: 'READY' } });
      const to: CreativeState = c.selectedFaceId ? 'ENGINE_PENDING' : readyFaces ? 'FACES_READY' : 'AVATAR_PENDING';
      await this.prisma.$transaction(async (tx) => {
        const loss = ev === 'RESELECT_SCRIPT' ? await requireConfirm(tx, c.id, confirm) : null;
        await this.sm.transition({ tx, creativeId: c.id, event: ev, from: c.state, to, data: { selectedScriptId: s.id } });
        if (loss && hasLoss(loss)) await markStale(tx, c.id);
      });
      this.sm.announce(c.id);
      if (!c.faceDescription) void this.jobs.detach(null, `sugestão de rosto ${c.id}`, () => this.suggestFace(c.id, s.id));
      return c;
    });
    return (await this.views.detailById(auth.workspaceId, c.id))!;
  }

  /** Sugestão de "quem aparece" ao escolher o roteiro (só preenche se o campo ainda estiver vazio). */
  private async suggestFace(creativeId: string, scriptId: string) {
    try {
      const c = await this.prisma.creative.findUniqueOrThrow({ where: { id: creativeId }, include: { offer: true } });
      const s = await this.prisma.script.findUniqueOrThrow({ where: { id: scriptId } });
      const text = await this.claude.suggestFaceDescription({
        offer: draftOf(c.offer),
        script: { angle: s.angle ?? '', rationale: s.rationale ?? '', durationSec: Number(s.durationSec ?? 0), blocks: blocksOf(s.blocks) },
        workspaceId: c.workspaceId,
        creativeId,
      });
      const r = await this.prisma.creative.updateMany({ where: { id: creativeId, faceDescription: null }, data: { faceDescription: text.slice(0, 600) } });
      if (r.count) this.sm.announce(creativeId);
    } catch (e) {
      this.log.warn(`sugestão de rosto (${creativeId}) falhou: ${(e as Error).message}`);
    }
  }
}

