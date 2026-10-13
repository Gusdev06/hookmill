import { Inject, Injectable } from '@nestjs/common';
import type { ChangeRequestResponse, CreativeDetail, CreativeState, FileRef, ReviewResponse, Step } from '@maquina/contratos';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { markStale } from '../criativos/downstream';
import { CreativeStateMachine, assertNotAutoPiece, invalidState } from '../criativos/state-machine';
import { CreativeViews, VARIATION_KIND_LABEL, currentScenes, currentTake } from '../criativos/views';
import { takeEstimate } from '../geracao/take';
import { CustosService } from '../custos/custos.service';
import { GeracaoService } from '../geracao/geracao.service';
import { TrocaService } from '../troca/troca.service';
import { CATALOG_SERVICE, type CatalogService, type SceneDraft } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { FACES_PER_BATCH } from '../rostos/rostos.service';
import { ChangeRequestDto } from './revisao.dto';
import { computeAdName, isAdNameConflict } from '../biblioteca/ad-names';

const RETURNS_TO: Record<'SCENE' | 'TEXT' | 'LINE' | 'FACE', Step> = { SCENE: 'generation', LINE: 'generation', TEXT: 'edit', FACE: 'avatar' };
const RETURN_STATE: Record<'SCENE' | 'TEXT' | 'LINE' | 'FACE', CreativeState> = {
  SCENE: 'SCENES_GENERATING', LINE: 'SCENES_GENERATING', TEXT: 'EDIT_PENDING', FACE: 'FACES_READY',
};

/**
 * Pedidos de ajuste válidos por criativo (feature 2 §3.3): TEXT e SCENE sempre; LINE não vale com a voz original
 * (AUDIO_LIPSYNC) nem com corte do campeão (SOURCE_CUT); FACE só no criativo do zero e no SWAP_AVATAR.
 */
export function allowedChanges(c: { origin: string; variationKind: string | null; voiceSource: string }, pipelines: string[]): ('SCENE' | 'TEXT' | 'LINE' | 'FACE')[] {
  if (c.origin !== 'VARIATION') return ['SCENE', 'LINE', 'TEXT', 'FACE'];
  const out: ('SCENE' | 'TEXT' | 'LINE' | 'FACE')[] = ['SCENE'];
  // §13.15: SWAP_VIDEO nunca tem LINE (a copy é a do campeão, nas duas vozes)
  const noLine = c.voiceSource === 'CHAMPION_AUDIO' || pipelines.some((p) => p === 'AUDIO_LIPSYNC' || p === 'SOURCE_CUT' || p === 'SWAP_VIDEO');
  if (!noLine) out.push('LINE');
  out.push('TEXT');
  if (c.variationKind === 'SWAP_AVATAR') out.push('FACE');
  return out;
}

/** Pipelines efetivos: fatia de take AUDIO_LIPSYNC conta como AUDIO_LIPSYNC (LINE indisponível com a voz original). */
function pipelinesOf(scenes: { pipeline: string }[], take: { kind: string } | null): string[] {
  return scenes.map((s) => (s.pipeline === 'TAKE_SLICE' && take ? take.kind : s.pipeline));
}

const AD_NAME_ATTEMPTS = 5;

@Injectable()
export class RevisaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sm: CreativeStateMachine,
    private readonly views: CreativeViews,
    private readonly custos: CustosService,
    private readonly geracao: GeracaoService,
    private readonly troca: TrocaService,
    private readonly locks: KeyedMutex,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
  ) {}

  private async full(auth: AuthContext, id: string) {
    const c = await this.views.loadFull(auth.workspaceId, id);
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  /** Render que vai pra revisão: o aprovado, ou o último READY não stale. */
  private async reviewRender(creativeId: string, finalRenderId: string | null) {
    return this.prisma.render.findFirst({
      where: finalRenderId ? { id: finalRenderId } : { creativeId, status: 'READY', stale: false },
      orderBy: { createdAt: 'desc' },
      include: { file: true },
    });
  }

  async review(auth: AuthContext, creativeId: string): Promise<ReviewResponse> {
    const c = await this.full(auth, creativeId);
    if (c.state !== 'RENDER_READY' && c.state !== 'APPROVED') throw invalidState(c.state, ['RENDER_READY', 'APPROVED']);
    const render = await this.reviewRender(c.id, c.finalRenderId);
    const video = await this.views.file(render?.file);
    if (!render || !video) throw invalidState(c.state, ['RENDER_READY', 'APPROVED']);
    const face = await this.views.file(c.selectedFace?.file);

    const engine = (c.engine ?? 'SCENES') as 'SCENES' | 'LIPSYNC';
    const scenes = await currentScenes(this.prisma, c.id);
    const drafts: SceneDraft[] = scenes.map((s) => ({
      index: s.index, label: s.label, startSec: num(s.startSec) ?? 0, endSec: num(s.endSec) ?? 0, speech: s.speech, visualPrompt: s.visualPrompt,
    }));
    let all = { costUsd: 0, etaSec: 0 };
    let one = { costUsd: 0, etaSec: 0 };
    const take = await currentTake(this.prisma, c.id);
    try {
      const swaps = scenes.filter((s) => s.pipeline === 'SWAP_VIDEO');
      if (swaps.length) {
        // §13.15: SCENE = o trecho mais caro; FACE = todos os trechos
        const each = await Promise.all(swaps.map((s) => this.troca.regenerateEstimate(c, s)));
        one = each.reduce((a, b) => (b.costUsd > a.costUsd ? b : a));
        all = { costUsd: each.reduce((a, b) => a + b.costUsd, 0), etaSec: Math.max(...each.map((x) => x.etaSec)) };
      } else if (take) {
        // §13.5: SCENE/LINE refazem o take inteiro; FACE refaz o take também
        all = takeEstimate(this.catalog, take, c.format, c.voiceId);
        one = all;
      } else if (drafts.length && c.engineModel) {
        const est = (d: SceneDraft[]) => this.catalog.estimate({ engine, model: c.engineModel!, scenes: d, format: c.format });
        all = est(drafts);
        const longest = drafts.reduce((a, b) => (b.endSec - b.startSec > a.endSec - a.startSec ? b : a));
        one = est([longest]);
      }
    } catch {
      /* modelo fora do catálogo: estimativas zeradas, a revisão continua */
    }
    const faces = this.catalog.estimateFaces(FACES_PER_BATCH);
    const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
    return {
      creative: await this.views.detail(c),
      video,
      facts: {
        offerName: c.offer.name,
        scriptLetter: c.selectedScript?.letter ?? '',
        angle: c.selectedScript?.angle ?? '',
        face: (face ?? video) as FileRef,
        engineLabel: c.variationKind ? VARIATION_KIND_LABEL[c.variationKind] : this.views.engineLabel(c.engineModel) ?? '',
        durationSec: num(render.durationSec) ?? 0,
        format: c.format,
        costUsd: await this.custos.creativeCost(c.id),
      },
      changeOptions: ([
        { type: 'SCENE', returnsTo: RETURNS_TO.SCENE, estimateUsd: one.costUsd, etaSec: one.etaSec },
        { type: 'LINE', returnsTo: RETURNS_TO.LINE, estimateUsd: one.costUsd, etaSec: one.etaSec },
        { type: 'TEXT', returnsTo: RETURNS_TO.TEXT, estimateUsd: 0, etaSec: 0 },
        { type: 'FACE', returnsTo: RETURNS_TO.FACE, estimateUsd: r4(faces + all.costUsd), etaSec: all.etaSec },
      ] as ReviewResponse['changeOptions']).filter((o) => allowedChanges(c, pipelinesOf(scenes, take)).includes(o.type)),
    };
  }

  /** RENDER_READY e editDirty = false → APPROVED (vai pra Biblioteca com o render final). */
  async approve(auth: AuthContext, creativeId: string): Promise<CreativeDetail> {
    await this.locks.run(creativeId, async () => {
      const c = await this.full(auth, creativeId);
      if (c.state !== 'RENDER_READY' || c.editDirty) throw invalidState(c.state, ['RENDER_READY']);
      const render = await this.reviewRender(c.id, null);
      if (!render) throw invalidState(c.state, ['RENDER_READY']);
      // fase2-agencia.md §6: adName congelado na mesma escrita do APPROVED; corrida no unique (P2002) → próximo sufixo
      const approvedAt = new Date();
      for (let attempt = 1; ; attempt++) {
        const adName = await computeAdName(this.prisma, c.id, { approvedAt });
        try {
          await this.sm.transition({
            creativeId: c.id, event: 'APPROVE', from: 'RENDER_READY', to: 'APPROVED', where: { editDirty: false },
            data: { approvedAt, approvedById: auth.userId, finalRenderId: render.id, adName },
          });
          break;
        } catch (e) {
          if (!isAdNameConflict(e) || attempt >= AD_NAME_ATTEMPTS) throw e;
        }
      }
    });
    return (await this.views.detailById(auth.workspaceId, creativeId))!;
  }

  /** "Request changes" da revisão final. SCENE/LINE já disparam a regeração da cena. */
  async change(auth: AuthContext, creativeId: string, dto: ChangeRequestDto): Promise<ChangeRequestResponse> {
    // fase2-agencia.md §4: o CLIENT só pede ajuste de texto (os outros regeram e custam)
    if (auth.role === 'CLIENT' && dto.type !== 'TEXT') throw new AppException('FORBIDDEN');
    const cur = await this.full(auth, creativeId);
    assertNotAutoPiece(cur); // variacao-auto-v1 §3.3: peça AUTO só tem "In zip"
    const pipelines = pipelinesOf(await currentScenes(this.prisma, cur.id), await currentTake(this.prisma, cur.id));
    if (!allowedChanges(cur, pipelines).includes(dto.type)) {
      throw new AppException('INVALID_STATE', { state: cur.state, allowed: [], reason: 'change_not_available' });
    }
    const record = (c: { id: string; workspaceId: string }) => ({
      workspaceId: c.workspaceId, creativeId: c.id, type: dto.type, sceneIndex: dto.sceneIndex ?? null,
      newSpeech: dto.type === 'LINE' ? dto.newSpeech ?? null : null, note: dto.note ?? null,
      returnedTo: RETURN_STATE[dto.type], createdById: auth.userId,
    });
    if (dto.type === 'SCENE' || dto.type === 'LINE') {
      await this.geracao.regenerateScene(
        auth, creativeId, dto.sceneIndex!, dto.type === 'LINE' ? { speech: dto.newSpeech } : {}, 'CHANGE_SCENE',
        (tx, c) => tx.changeRequest.create({ data: record(c) }),
      );
    } else {
      await this.locks.run(creativeId, async () => {
        const c = await this.full(auth, creativeId);
        await this.prisma.$transaction(async (tx) => {
          if (dto.type === 'TEXT') {
            await this.sm.transition({ tx, creativeId: c.id, event: 'CHANGE_TEXT', from: 'RENDER_READY', to: 'EDIT_PENDING', data: { editDirty: true } });
          } else {
            await this.sm.transition({ tx, creativeId: c.id, event: 'CHANGE_FACE', from: 'RENDER_READY', to: 'FACES_READY', data: { selectedFaceId: null } });
            await markStale(tx, c.id);
          }
          await tx.changeRequest.create({ data: record(c) });
        });
        this.sm.announce(c.id);
      });
    }
    return { creative: (await this.views.detailById(auth.workspaceId, creativeId))!, returnTo: RETURNS_TO[dto.type] };
  }
}
