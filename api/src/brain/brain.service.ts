import { Injectable } from '@nestjs/common';
import type {
  BrainGraph, BrainMedia, BrainNeighbor, BrainNode, BrainNodeDetail, BrainNodeField, BrainNodeKind, BrainOpenTarget, MetaMetrics,
} from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import type { AuthContext } from '../common/auth/auth-context';
import { metaSaudavel } from '../meta/comum';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { defaultResultOf, targetCpaOf, targetCpaText } from '../workspaces/cliente';
import { BrainCache } from './brain.cache';
import type { BrainGraphQueryDto } from './brain.dto';
import {
  brandAssetLabel, BRAIN_CATEGORY_OF, BRAIN_MAX_PAINS_PER_OFFER, BRAIN_MAX_PROOFS_PER_OFFER, BRAIN_NODE_KINDS, dividirItens, fontesDe, itemHash, montarGrafo, SETUP_STEP,
  type BrainDados, type DadosAnuncio, type DadosCriativo, type DadosLeitura, type DadosLote, type Montado,
} from './brain.montagem';
import { isReadMeta } from '../ofertas/ofertas.dto';
import { WAITING_BATCH_WHERE } from '../workspaces/waiting';
import { BATCH_CREATIVES_SELECT, piecesPublished } from '../iteracao/lote-etapa';

/** lacunas-home-eddy-v1 §3.2: lotes lidos (a montagem corta em BRAIN_MAX_BATCHES; o drawer vê todos estes). */
const BATCHES_READ = 60;
const RECENT_BATCH_MS = 14 * 86_400_000;

const MAX_NEIGHBORS = 50;
const NODE_ID = /^([a-z_]+):(.{1,200})$/s;

const obj = (v: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
/** Script.blocks[0].speech (blocks[0] é sempre o gancho). */
export function hookOf(blocks: Prisma.JsonValue | undefined): string | null {
  if (!Array.isArray(blocks) || !blocks.length) return null;
  const s = obj(blocks[0] as Prisma.JsonValue).speech;
  return typeof s === 'string' && s.trim() ? s : null;
}
/** Teardown.sections.hook.data.spoken */
export function teardownHookOf(sections: Prisma.JsonValue | undefined): string | null {
  const s = obj(obj(obj(sections).hook as Prisma.JsonValue).data as Prisma.JsonValue).spoken;
  return typeof s === 'string' && s.trim() ? s : null;
}
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** brain-preenchido-v1: `offers.read_meta` → o recorte que o Brain usa (inválido = null). */
export function leituraOf(json: Prisma.JsonValue | null | undefined): DadosLeitura | null {
  const m = isReadMeta(json) ? json : null;
  if (!m) return null;
  return {
    pages: m.pages.filter((p) => p && typeof p.url === 'string').map((p) => ({ url: p.url, role: p.role, via: p.via, chars: p.chars })),
    fieldOrigins: m.fieldOrigins ?? {},
    imagesRead: m.imagesRead.length,
    readAt: typeof m.readAt === 'string' ? m.readAt : null,
  };
}
const sourcesOf = (json: Prisma.JsonValue | null | undefined): Partial<Record<string, 'page' | 'user'>> =>
  Object.fromEntries(Object.entries(obj(json)).filter(([, v]) => v === 'page' || v === 'user')) as Partial<Record<string, 'page' | 'user'>>;
/** miniatura assinada nos nós que levam thumbnailUrl */
const THUMB_KINDS = new Set(['creative', 'batch', 'brand_asset']);
/** `<offerId>:<resto>` (o id da oferta não tem `:`) */
const splitKey = (k: string): [string, string] => {
  const i = k.indexOf(':');
  return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)];
};

/**
 * Brain 3D v1 (docs/contratos/brain-3d-v1.md, revisão 22/10; B5). Só leitura: monta o grafo do workspace a partir do banco.
 * Lê MetaConnection/MetaAdSnapshot/MetaPublication/Champion/Teardown direto pelo Prisma (não importa nada de api/src/meta/).
 * Consultas por montagem: 9 (workspace, ofertas, criativos, conexão, lotes [lacunas-home-eddy-v1], kit da marca [brain-preenchido-v1]; snapshots,
 * publicações e campeões da Meta só com Meta conectada). Drawer: + até 3 (custo e render do criativo, vídeo do anúncio, blocos do roteiro).
 */
@Injectable()
export class BrainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly cache: BrainCache,
  ) {}

  private get metaEnabled(): boolean {
    return this.config.metaMode !== 'off';
  }

  // ───────────────────────── rotas ─────────────────────────
  async graph(auth: AuthContext, q: BrainGraphQueryDto): Promise<BrainGraph> {
    const wid = auth.workspaceId;
    const metaOn = this.metaEnabled;
    if (q.fresh === '1') this.cache.tryFresh(wid);
    const offerId = q.offerId ?? null;
    let dados = await this.dados(wid, metaOn);
    if (offerId && !dados.offers.some((o) => o.id === offerId)) {
      // oferta criada há menos de 60 s ainda não está no cache: relê uma vez antes do 404
      dados = await this.dados(wid, metaOn, true);
      if (!dados.offers.some((o) => o.id === offerId)) throw new AppException('NOT_FOUND');
    }
    const key = `${wid}|graph|${metaOn ? 1 : 0}|${offerId ?? ''}|${dados.loadedAt.getTime()}`;
    const hit = this.cache.get<BrainGraph>(key);
    if (hit) return hit;
    const m = montarGrafo(dados, { metaEnabled: metaOn, offerId });
    await this.assinar(m);
    return this.cache.set(key, m.graph);
  }

  async node(auth: AuthContext, rawId: string): Promise<BrainNodeDetail> {
    const match = NODE_ID.exec(rawId ?? '');
    const kind = match?.[1] as BrainNodeKind | undefined;
    if (!match || !kind || !BRAIN_NODE_KINDS.includes(kind)) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'id', rule: 'brainNodeId' }] });
    }
    const key = match[2];
    const wid = auth.workspaceId;
    const metaOn = this.metaEnabled;
    if (!metaOn && kind === 'meta_ad') throw new AppException('NOT_FOUND');

    let dados = await this.dados(wid, metaOn);
    let full = this.completo(wid, metaOn, dados);
    let node = full.graph.nodes.find((x) => x.id === rawId);
    if (!node) {
      dados = await this.dados(wid, metaOn, true);
      full = this.completo(wid, metaOn, dados);
      node = full.graph.nodes.find((x) => x.id === rawId);
      if (!node) throw new AppException('NOT_FOUND');
    }

    // cópia: o nó do cache não leva URL assinada
    const out: BrainNode = { ...node, meta: { ...node.meta } };
    const thumb = full.thumbKeys.get(out.id);
    if (thumb && (out.meta.kind === 'creative' || out.meta.kind === 'batch' || out.meta.kind === 'brand_asset')) out.meta.thumbnailUrl = await this.storage.signedUrl({ storageKey: thumb });

    const byId = new Map(full.graph.nodes.map((x) => [x.id, x]));
    const neighbors: BrainNeighbor[] = [];
    for (const e of full.graph.edges) {
      if (neighbors.length >= MAX_NEIGHBORS) break;
      const other = e.from === out.id ? e.to : e.to === out.id ? e.from : null;
      const o = other ? byId.get(other) : undefined;
      if (o) neighbors.push({ id: o.id, kind: o.kind, category: BRAIN_CATEGORY_OF[o.kind], label: o.label, edge: e.kind, winner: o.winner });
    }
    const { fields, media } = await this.detalhe(out, key, dados);
    return { node: out, fields, neighbors, media, open: this.open(out, key, dados) };
  }

  // ───────────────────────── leitura do banco ─────────────────────────
  /** Linhas do workspace (cache 60 s por workspace + modo Meta). `force` relê. */
  private async dados(wid: string, metaOn: boolean, force = false): Promise<BrainDados> {
    const key = `${wid}|dados|${metaOn ? 1 : 0}`;
    if (!force) {
      const hit = this.cache.get<BrainDados>(key);
      if (hit) return hit;
    }
    return this.cache.set(key, await this.carregar(wid, metaOn));
  }

  /** Grafo sem teto nem limites por tipo (drawer: todo nó que existe tem detalhe). */
  private completo(wid: string, metaOn: boolean, dados: BrainDados): Montado {
    const key = `${wid}|full|${metaOn ? 1 : 0}|${dados.loadedAt.getTime()}`;
    return this.cache.get<Montado>(key) ?? this.cache.set(key, montarGrafo(dados, { metaEnabled: metaOn, limitar: false }));
  }

  async carregar(wid: string, metaOn: boolean): Promise<BrainDados> {
    const [ws, offers, creatives, conn, lotes, kit] = await Promise.all([
      this.prisma.workspace.findUnique({
        where: { id: wid },
        select: { id: true, name: true, resultType: true, industry: true, market: true, websiteUrl: true, monthlySpendCapUsd: true, targetCpaMin: true, targetCpaMax: true, targetCpaCurrency: true },
      }),
      this.prisma.offer.findMany({
        where: { workspaceId: wid, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, kind: true, language: true, what: true, promise: true, offerAndPrice: true, cta: true,
          audience: true, pains: true, proof: true, notes: true, fieldSources: true, readMeta: true,
          _count: { select: { creatives: { where: { archivedAt: null } } } },
        },
      }),
      this.prisma.creative.findMany({
        where: { workspaceId: wid, archivedAt: null },
        select: {
          id: true, offerId: true, name: true, adName: true, state: true, isWinner: true, origin: true, variationCode: true, engine: true,
          winnerMarkedAt: true, approvedAt: true, stateChangedAt: true,
          updatedAt: true, variationKind: true, variationBatchId: true, // lacunas-home-eddy-v1 §3
          thumbnail: { select: { storageKey: true } },
          finalRender: { select: { durationSec: true } },
          champion: { select: { metaAdId: true, sourceCreativeId: true } },
          selectedScript: { select: { id: true, letter: true, angle: true, durationSec: true, editedByUser: true, blocks: true } },
        },
      }),
      metaOn
        ? this.prisma.metaConnection.findUnique({
            where: { workspaceId: wid },
            select: { id: true, status: true, adAccountId: true, currency: true, lastSyncAt: true, lastHealth: true },
          })
        : Promise.resolve(null),
      // lacunas-home-eddy-v1 §3.2: lotes esperando a pessoa, trabalhando ou dos últimos 14 dias (campeão não arquivado)
      this.prisma.variationBatch.findMany({
        where: {
          workspaceId: wid,
          champion: { archivedAt: null },
          OR: [
            WAITING_BATCH_WHERE,
            { status: { in: ['ANALYZING', 'PLANNING'] } },
            { status: 'LAUNCHED', creatives: { some: { state: 'RENDERING', archivedAt: null } } },
            { createdAt: { gte: new Date(Date.now() - RECENT_BATCH_MS) } },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: BATCHES_READ,
        select: {
          id: true, mode: true, status: true, championId: true, offerId: true, downloadedAt: true, createdAt: true, updatedAt: true,
          champion: { select: { name: true, metaAdId: true, sourceCreativeId: true, thumbnailFile: { select: { storageKey: true } } } },
          creatives: BATCH_CREATIVES_SELECT,
        },
      }),
      // brain-preenchido-v1: kit da marca (logo, arquivos, vídeos demo)
      this.prisma.brandAsset.findMany({
        where: { workspaceId: wid },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true, kind: true, label: true, offerId: true, colors: true, createdAt: true,
          file: { select: { storageKey: true, mimeType: true, sizeBytes: true, durationSec: true } },
          offer: { select: { name: true, archivedAt: true } },
        },
      }),
    ]);
    if (!ws) throw new AppException('NOT_FOUND');

    let ads: DadosAnuncio[] = [];
    let publications: BrainDados['publications'] = [];
    let metaChampions: BrainDados['metaChampions'] = [];
    // Gusta 25/10: anúncio da Meta (gasto, CPA) só com a conexão saudável; checagem bloqueante falhando = sem nós da Meta
    const saudavel = metaSaudavel(conn as Parameters<typeof metaSaudavel>[0]);
    if (conn && conn.adAccountId && saudavel) {
      const [snaps, pubs, champs] = await Promise.all([
        this.prisma.metaAdSnapshot.findMany({
          where: { workspaceId: wid, connectionId: conn.id, adAccountId: conn.adAccountId },
          select: {
            metaAdId: true, name: true, campaignName: true, adsetName: true, effectiveStatus: true, verdict: true, trend: true, metrics: true,
            thumbnailUrl: true, videoId: true, adCreatedTime: true,
          },
        }),
        this.prisma.metaPublication.findMany({
          where: { workspaceId: wid, connectionId: conn.id, status: { in: ['PAUSED', 'ACTIVE'] } },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, creativeId: true, status: true, metaAdId: true, publishedAt: true, activatedAt: true, renderFileId: true,
            createdBy: { select: { name: true } },
          },
        }),
        this.prisma.champion.findMany({
          where: { workspaceId: wid, archivedAt: null, metaAdId: { not: null } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, offerId: true, metaAdId: true, teardown: { select: { sections: true } } },
        }),
      ]);
      ads = snaps.map((s) => {
        const m = obj(s.metrics) as Partial<MetaMetrics>;
        return {
          metaAdId: s.metaAdId, name: s.name, campaignName: s.campaignName, adsetName: s.adsetName, effectiveStatus: s.effectiveStatus,
          verdict: s.verdict, trend: s.trend, spend: n(m.spend) ?? 0, results: n(m.results), cpa: n(m.cpa), ctr: n(m.ctr), hookRate: n(m.hookRate),
          thumbnailUrl: s.thumbnailUrl, videoId: s.videoId, adCreatedTime: s.adCreatedTime,
        };
      });
      publications = pubs.map(({ createdBy, ...p }) => ({ ...p, byName: createdBy.name }));
      metaChampions = champs.map((c) => ({ id: c.id, offerId: c.offerId, metaAdId: c.metaAdId!, hookSpoken: teardownHookOf(c.teardown?.sections) }));
    }

    return {
      workspace: {
        id: ws.id, name: ws.name, resultType: ws.resultType, industry: ws.industry, market: ws.market,
        websiteUrl: ws.websiteUrl, monthlySpendCapUsd: num(ws.monthlySpendCapUsd), defaultResult: defaultResultOf(ws.resultType),
        targetCpa: targetCpaText(targetCpaOf(ws)),
      },
      offers: offers.map(({ _count, fieldSources, readMeta, ...o }) => ({ ...o, creatives: _count.creatives, fieldSources: sourcesOf(fieldSources), readMeta: leituraOf(readMeta) })),
      brandAssets: kit.map((a) => ({
        id: a.id, kind: a.kind, label: a.label, offerId: a.offerId, colors: a.colors ?? [], createdAt: a.createdAt, offerName: a.offer?.name ?? null,
        file: { storageKey: a.file.storageKey, mimeType: a.file.mimeType, sizeBytes: a.file.sizeBytes, durationSec: num(a.file.durationSec) },
      })),
      creatives: creatives.map((c): DadosCriativo => {
        const s = c.selectedScript;
        return {
          id: c.id, offerId: c.offerId, name: c.name, adName: c.adName, state: c.state, isWinner: c.isWinner, origin: c.origin,
          variationCode: c.variationCode, engine: c.engine, durationSec: num(c.finalRender?.durationSec) ?? num(s?.durationSec),
          thumbKey: c.thumbnail?.storageKey ?? null,
          recency: (c.isWinner ? c.winnerMarkedAt : c.state === 'APPROVED' ? c.approvedAt : null) ?? c.stateChangedAt,
          script: s ? { id: s.id, letter: s.letter, angle: s.angle, durationSec: num(s.durationSec), editedByUser: s.editedByUser, hook: hookOf(s.blocks) } : null,
          sourceMetaAdId: c.champion?.metaAdId ?? null,
          sourceCreativeId: c.champion?.sourceCreativeId ?? null,
          updatedAt: c.updatedAt, variationKind: c.variationKind, batchId: c.variationBatchId,
        };
      }),
      batches: lotes.map((b): DadosLote => ({
        id: b.id, mode: b.mode, status: b.status, championId: b.championId, championName: b.champion.name, offerId: b.offerId,
        sourceMetaAdId: b.champion.metaAdId, sourceCreativeId: b.champion.sourceCreativeId,
        pieces: b.creatives.length, ready: b.creatives.filter((c) => c.state === 'APPROVED').length,
        rendering: b.creatives.some((c) => c.state === 'RENDERING'), downloadedAt: b.downloadedAt, published: piecesPublished(b.creatives),
        thumbKey: b.champion.thumbnailFile?.storageKey ?? null, createdAt: b.createdAt, updatedAt: b.updatedAt,
      })),
      metaChampions,
      connection: saudavel ? conn : null, // conexão com checagem falhando = como sem conexão (nós da Meta omitidos)
      ads,
      publications,
      loadedAt: new Date(),
    };
  }

  /** Miniaturas dos criativos incluídos: URL assinada (6 h) gerada localmente, sem rede. */
  private async assinar(m: Montado): Promise<void> {
    const byId = new Map(m.graph.nodes.map((x) => [x.id, x]));
    await Promise.all(
      [...m.thumbKeys].map(async ([id, storageKey]) => {
        const node = byId.get(id);
        if (node && THUMB_KINDS.has(node.meta.kind) && 'thumbnailUrl' in node.meta) node.meta.thumbnailUrl = await this.storage.signedUrl({ storageKey });
      }),
    );
  }

  // ───────────────────────── drawer (§2.3) ─────────────────────────
  private async detalhe(node: BrainNode, key: string, d: BrainDados): Promise<{ fields: BrainNodeField[]; media: BrainMedia | null }> {
    const f = (k: string, v: string | number | null | undefined): BrainNodeField => ({ key: k, value: v ?? null });
    const sign = async (storageKey: string | null | undefined) => (storageKey ? this.storage.signedUrl({ storageKey }) : null);
    const offer = () => d.offers.find((x) => x.id === key)!;
    const wid = d.workspace.id;
    switch (node.kind) {
      case 'workspace':
        return { fields: [f('workspace.name', d.workspace.name)], media: null };
      case 'business': {
        const w = d.workspace;
        // kit-marca-v1 §5: o kit da marca aparece no nó do negócio (logo = pôster; 1º vídeo demo = vídeo)
        // brain-preenchido-v1 §6: lê o kit dos `dados` (sem consulta à parte); 1º vídeo demo = o mais antigo, como antes
        const kit = d.brandAssets ?? [];
        const logo = kit.filter((a) => a.kind === 'LOGO').at(-1) ?? null;
        const demos = kit.filter((a) => a.kind === 'DEMO_VIDEO');
        return {
          fields: [
            f('business.businessType', w.resultType), f('business.industry', w.industry), f('business.market', w.market), f('business.websiteUrl', w.websiteUrl),
            f('brand.logo', logo ? logo.label ?? 'logo' : null), f('brand.colors', logo?.colors.length ? logo.colors.join(', ') : null),
            f('brand.files', kit.filter((a) => a.kind === 'FILE').length), f('brand.demoVideos', demos.length),
          ],
          media: logo || demos.length ? { posterUrl: await sign(logo?.file.storageKey), videoUrl: await sign(demos[0]?.file.storageKey) } : null,
        };
      }
      case 'goal':
        return { fields: [f('goal.spendCapUsd', d.workspace.monthlySpendCapUsd), f('goal.defaultResult', d.workspace.defaultResult), f('goal.targetCpa', d.workspace.targetCpa ?? null)], media: null };
      case 'offer': {
        const o = offer();
        const winners = node.meta.kind === 'offer' ? node.meta.winners : 0;
        return {
          fields: [
            f('offer.name', o.name), f('offer.kind', o.kind), f('offer.language', o.language), f('offer.what', o.what), f('offer.promise', o.promise),
            f('offer.offerAndPrice', o.offerAndPrice), f('offer.cta', o.cta), f('offer.creatives', o.creatives), f('offer.winners', winners),
            f('offer.imagesRead', o.readMeta ? o.readMeta.imagesRead : null),
          ],
          media: null,
        };
      }
      case 'audience':
        return { fields: [f('offer.audience', offer().audience), f('offer.pains', offer().pains)], media: null };
      case 'proof':
        return { fields: [f('offer.proof', offer().proof)], media: null };
      case 'instructions':
        return { fields: [f('offer.notes', offer().notes)], media: null };
      case 'hook': {
        const m = node.meta.kind === 'hook' ? node.meta : null;
        return {
          fields: [f('hook.text', node.summary), f('hook.angle', m?.angle), f('hook.scripts', m?.scripts), f('hook.ads', m?.ads), f('hook.bestCpa', m?.bestCpa), f('hook.currency', m?.currency)],
          media: null,
        };
      }
      case 'script': {
        const s = await this.prisma.script.findFirst({ where: { id: key, workspaceId: wid }, select: { letter: true, angle: true, rationale: true, durationSec: true, blocks: true } });
        const blocks = Array.isArray(s?.blocks)
          ? (s!.blocks as Prisma.JsonArray).map((b) => {
              const o = obj(b);
              return { label: o.label ?? null, startSec: o.startSec ?? null, endSec: o.endSec ?? null, speech: o.speech ?? null };
            })
          : [];
        return {
          fields: [
            f('script.letter', s?.letter), f('script.angle', s?.angle), f('script.rationale', s?.rationale), f('script.durationSec', num(s?.durationSec)),
            f('script.blocks', JSON.stringify(blocks)),
          ],
          media: null,
        };
      }
      case 'creative': {
        const c = d.creatives.find((x) => x.id === key)!;
        const [cost, renders] = await Promise.all([
          this.prisma.costEntry.aggregate({ where: { workspaceId: wid, creativeId: c.id }, _sum: { amountUsd: true } }),
          this.prisma.render.findMany({
            where: { workspaceId: wid, creativeId: c.id, status: 'READY', fileId: { not: null } },
            orderBy: { createdAt: 'desc' },
            select: { file: { select: { storageKey: true } }, finalOf: { select: { id: true } } },
          }),
        ]);
        // render final (finalRender), senão o último READY
        const render = renders.find((r) => r.finalOf) ?? renders[0];
        return {
          fields: [
            f('creative.name', c.name), f('creative.adName', c.adName), f('creative.state', c.state), f('creative.origin', c.origin),
            f('creative.variationCode', c.variationCode), f('creative.engine', c.engine), f('creative.durationSec', c.durationSec),
            f('creative.costUsd', num(cost._sum.amountUsd) ?? 0), f('creative.iteratedFromMetaAdId', c.sourceMetaAdId), f('creative.iteratedFromCreativeId', c.sourceCreativeId),
          ],
          media: { videoUrl: await sign(render?.file?.storageKey), posterUrl: await sign(c.thumbKey) },
        };
      }
      case 'meta_ad': {
        const a = d.ads.find((x) => x.metaAdId === key)!;
        const m = node.meta.kind === 'meta_ad' ? node.meta : null;
        const pub = d.publications.find((p) => p.metaAdId === key);
        const champ = d.metaChampions.find((c) => c.metaAdId === key);
        let videoKey: string | null = null;
        if (pub) {
          videoKey = (await this.prisma.file.findFirst({ where: { id: pub.renderFileId, workspaceId: wid }, select: { storageKey: true } }))?.storageKey ?? null;
        } else if (champ) {
          videoKey = (await this.prisma.champion.findFirst({ where: { id: champ.id, workspaceId: wid }, select: { videoFile: { select: { storageKey: true } } } }))?.videoFile?.storageKey ?? null;
        }
        return {
          fields: [
            f('meta_ad.name', a.name), f('meta_ad.campaignName', a.campaignName), f('meta_ad.adsetName', a.adsetName), f('meta_ad.effectiveStatus', a.effectiveStatus),
            f('meta_ad.verdict', a.verdict), f('meta_ad.trend', a.trend), f('meta_ad.spend30d', a.spend), f('meta_ad.results', a.results), f('meta_ad.cpa', a.cpa),
            f('meta_ad.ctr', a.ctr), f('meta_ad.hookRate', a.hookRate), f('meta_ad.daysRunning', m?.daysRunning), f('meta_ad.currency', m?.currency),
          ],
          media: { videoUrl: await sign(videoKey), posterUrl: a.thumbnailUrl },
        };
      }
      case 'batch': {
        // lacunas-home-eddy-v1 §3.2: sem consulta nova; pôster = miniatura do campeão
        const b = (d.batches ?? []).find((x) => x.id === key)!;
        const m = node.meta.kind === 'batch' ? node.meta : null;
        return {
          fields: [
            f('batch.mode', b.mode), f('batch.stage', m?.stage), f('batch.pieces', b.pieces), f('batch.ready', b.ready),
            f('batch.offer', d.offers.find((o) => o.id === b.offerId)?.name), f('batch.createdAt', b.createdAt.toISOString()),
          ],
          media: { videoUrl: null, posterUrl: await sign(b.thumbKey) },
        };
      }
      // ── brain-preenchido-v1 §6
      case 'brand_asset': {
        const a = (d.brandAssets ?? []).find((x) => x.id === key)!;
        const mime = a.file.mimeType;
        const url = await sign(a.file.storageKey);
        return {
          fields: [
            f('brand.kind', a.kind), f('brand.label', a.label), f('brand.mimeType', mime), f('brand.sizeBytes', a.file.sizeBytes),
            f('brand.durationSec', a.kind === 'DEMO_VIDEO' ? a.file.durationSec : null),
            f('brand.colors', a.kind === 'LOGO' && a.colors.length ? a.colors.join(', ') : null),
            f('brand.offerName', a.offerId ? a.offerName : null), f('brand.createdAt', a.createdAt.toISOString()), f('brand.downloadUrl', url),
          ],
          media: a.kind === 'DEMO_VIDEO' || mime.startsWith('video/') ? { videoUrl: url, posterUrl: null } : mime.startsWith('image/') ? { videoUrl: null, posterUrl: url } : null,
        };
      }
      case 'brand_color': {
        const logo = (d.brandAssets ?? []).filter((a) => a.kind === 'LOGO').at(-1);
        const hex = node.meta.kind === 'brand_color' ? node.meta.hex : `#${key.toUpperCase()}`;
        return { fields: [f('brand.hex', hex), f('brand.logo', logo ? brandAssetLabel(logo, d.brandAssets ?? []) : null)], media: null };
      }
      case 'offer_field': {
        const [oid, field] = splitKey(key);
        const o = d.offers.find((x) => x.id === oid)!;
        const k = field as 'what' | 'promise' | 'offerAndPrice' | 'cta';
        const origins = o.readMeta?.fieldOrigins[k];
        const from = o.fieldSources?.[k];
        return {
          fields: [
            f(`offer.${k}`, o[k]), f('offer.readFrom', origins?.length ? JSON.stringify(origins) : null),
            f('offer.fieldSource', from === 'page' || from === 'user' ? from : null), f('offer.offerName', o.name),
          ],
          media: null,
        };
      }
      case 'pain':
      case 'proof_item': {
        const [oid, h] = splitKey(key);
        const o = d.offers.find((x) => x.id === oid)!;
        const itens = node.kind === 'pain' ? dividirItens(o.pains, BRAIN_MAX_PAINS_PER_OFFER) : dividirItens(o.proof, BRAIN_MAX_PROOFS_PER_OFFER);
        const i = itens.findIndex((x) => itemHash(x) === h);
        const p = node.kind === 'pain' ? 'pain' : 'proof';
        return { fields: [f(`${p}.item`, itens[i]), f(`${p}.position`, i + 1), f(`${p}.of`, itens.length), f(`${p}.offerName`, o.name)], media: null };
      }
      case 'source': {
        const fo = fontesDe(d.workspace, d.offers).get(key)!;
        const nomes = fo.offerIds.map((id) => d.offers.find((o) => o.id === id)?.name).filter((x): x is string => !!x);
        return {
          fields: [
            f('source.url', fo.url), f('source.roles', fo.roles.length ? fo.roles.join(',') : null), f('source.via', fo.via), f('source.chars', fo.chars),
            f('source.readAt', fo.readAt), f('source.offers', nomes.length ? nomes.join(' · ') : null), f('source.isWebsite', fo.isWebsite ? 1 : 0),
          ],
          media: null,
        };
      }
    }
  }

  private open(node: BrainNode, key: string, d: BrainDados): BrainOpenTarget | null {
    switch (node.kind) {
      case 'brand_asset': return { route: 'brand', id: key };
      case 'brand_color': return { route: 'brand' };
      case 'offer_field': return { route: 'setup', step: SETUP_STEP.offer_field };
      case 'pain': return { route: 'setup', step: SETUP_STEP.pain };
      case 'proof_item': return { route: 'setup', step: SETUP_STEP.proof_item };
      case 'source': {
        if (node.meta.kind === 'source' && node.meta.isWebsite) return { route: 'setup', step: SETUP_STEP.business };
        const first = fontesDe(d.workspace, d.offers).get(key)?.offerIds[0];
        return first ? { route: 'offer', id: first } : { route: 'setup', step: SETUP_STEP.business };
      }
      case 'business': return { route: 'setup', step: SETUP_STEP.business };
      case 'proof': return { route: 'setup', step: SETUP_STEP.proof };
      case 'audience': return { route: 'setup', step: SETUP_STEP.audience };
      case 'instructions': return { route: 'setup', step: SETUP_STEP.instructions };
      case 'goal': return { route: 'setup', step: SETUP_STEP.goal };
      case 'offer': return { route: 'offer', id: key };
      case 'script': return { route: 'creative', id: node.meta.kind === 'script' ? node.meta.creativeId : undefined, step: 'scripts' };
      case 'creative': return { route: 'creative', id: key };
      case 'meta_ad': return { route: 'campaigns', id: key };
      case 'batch': return { route: 'batch', id: key }; // o web escolhe /iterate/:id (AUTO) ou o Variar (MANUAL) pela meta.mode
      default: return null; // hook e workspace: o web abre o BrainKnows
    }
  }
}
