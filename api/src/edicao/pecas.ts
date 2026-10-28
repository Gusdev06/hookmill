// Peças do lote AUTO (variacao-auto-v1 §3.2, §5.1, §8 e Revisão 23/10 §14): regras puras, sem banco. Testadas em pecas.spec.ts.
import type {
  BrollProvenance, FormatCode, FrameSecondKind, GeneratedProvenance, FrameTemplateId, PieceFormat, PieceFrame, PieceStatus, StaticTextCheck, VariationAxis,
} from '@maquina/contratos';
import type { RenderEngine, VideoFormat } from '@prisma/client';
import type {
  StaticAspect, StaticCopy, StaticImageCatalog, StaticImageSpec, StaticImageSpecAny, StaticImageSpecV2, StaticLayoutAny, StaticVisualDraft, StaticVisualV2,
} from '../integracoes/contrato';
import { STATIC_IMAGE_MODEL } from '../integracoes/catalogo/precos';

/** Template das renders de peça AUTO (Render.settings.templateId). O input real é do maquina-video (`auto-edit`). */
export const AUTO_EDIT_TEMPLATE = 'auto-edit';

/** §14.2: o que o Gerar produz (e o que decide a peça): só o 9:16. 4:5 e 1:1 são sob demanda. */
export const AUTO_FORMATS: VideoFormat[] = ['VERTICAL_9_16'];
/** Os 3 formatos possíveis de uma peça, na ordem da vista/zip/Library (9:16, 4:5, 1:1). */
export const ALL_FORMATS: VideoFormat[] = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'];

/** §14.1: prioridade na fila do Remotion (priority DESC, createdAt ASC): 0 = lote, 10 = formato pedido sob demanda. */
export const PRIORITY_BATCH = 0;
export const PRIORITY_ON_DEMAND = 10;

/** §14.1: quem produz o arquivo do render. STATIC = imagem nova no GPT Image 2 (fora da fila do Remotion). */
export function engineFor(type: string | null): RenderEngine {
  return type === 'STATIC' ? 'IMAGE_GEN' : 'REMOTION';
}

export const FORMAT_CODE: Record<VideoFormat, FormatCode> = { VERTICAL_9_16: '9x16', PORTRAIT_4_5: '4x5', SQUARE_1_1: '1x1' };
export const FORMAT_OF_CODE: Record<FormatCode, VideoFormat> = { '9x16': 'VERTICAL_9_16', '4x5': 'PORTRAIT_4_5', '1x1': 'SQUARE_1_1' };

/**
 * Ordem da fila no start (§14.2): o 9:16 de cada peça, na ordem do plano. `seq` é a posição (vira o deslocamento do
 * createdAt = launchedAt + seq; entre renders da mesma prioridade a fila tira o mais antigo primeiro).
 */
export function renderOrder<T extends { index: number }>(items: T[]): { item: T; format: VideoFormat; seq: number }[] {
  const sorted = [...items].sort((a, b) => a.index - b.index);
  let seq = 0;
  return AUTO_FORMATS.flatMap((format) => sorted.map((item) => ({ item, format, seq: seq++ })));
}

export interface PieceRenderState { format: VideoFormat | null; status: 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED'; createdAt: Date }

/** Render vigente de cada formato (o mais novo; renders refeitos no Retry deixam os antigos stale). */
export function latestByFormat<R extends PieceRenderState>(renders: R[]): Map<VideoFormat, R> {
  const out = new Map<VideoFormat, R>();
  for (const r of [...renders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) if (r.format) out.set(r.format, r);
  return out;
}

/** Status da peça, derivado na ordem do §3.2 (nunca salvo). */
export function pieceStatus(p: {
  launched: boolean; leftOutAt: Date | null; creativeState: string | null; renders: PieceRenderState[];
}): PieceStatus {
  if (!p.launched || !p.creativeState) return 'planned';
  if (p.leftOutAt) return 'left_out';
  // §A10.1: STATIC pronto refazendo a imagem por texto (Retry de `ready` com mismatch) = `rendering` até a nova assentar
  if (p.creativeState === 'APPROVED') {
    const v = latestByFormat(p.renders).get('VERTICAL_9_16');
    return v && (v.status === 'QUEUED' || v.status === 'RENDERING') ? 'rendering' : 'ready';
  }
  if (p.creativeState === 'RENDER_FAILED') return 'failed';
  if (p.renders.some((r) => r.status === 'RENDERING')) return 'rendering';
  return 'queued';
}

/**
 * Desfecho da peça (§14.2): olha só o 9:16. null = 9:16 ainda na fila/renderizando (nada muda no criativo). Formato sob
 * demanda (4:5/1:1) nunca decide a peça: falhou = só aquele formato `failed`.
 */
export function pieceOutcome(renders: PieceRenderState[], primary: VideoFormat = 'VERTICAL_9_16'): 'ready' | 'failed' | null {
  // headline-e-legenda-v1 §1.5: o HEADLINE decide pelo aspecto do campeão (o único que ele tem)
  const latest = latestByFormat(renders);
  const r = latest.get(primary);
  if (!r || r.status === 'QUEUED' || r.status === 'RENDERING') return null;
  return r.status === 'READY' ? 'ready' : 'failed';
}

/** Formato que decide a peça: HEADLINE = aspecto do campeão (`params.format`); o resto = 9:16 (§14.2). */
export function primaryFormatOf(type: string | null | undefined, params: Record<string, unknown> | null | undefined): VideoFormat {
  const f = params?.format;
  return type === 'HEADLINE' && (f === 'VERTICAL_9_16' || f === 'PORTRAIT_4_5' || f === 'SQUARE_1_1') ? f : 'VERTICAL_9_16';
}

export interface PieceFormatRender extends PieceRenderState { progress: number; errorCode: string | null; failReason: string | null }

/** Render READY mais novo de cada formato (o que está em `files`/zip enquanto uma refação roda, §A10.1). */
export function latestReadyByFormat<R extends PieceRenderState>(renders: R[]): Map<VideoFormat, R> {
  return latestByFormat(renders.filter((r) => r.status === 'READY'));
}

/** Erros críticos de um veredito gravado (itens críticos sem `match` + texto inventado, G3). */
export function criticalErrorsOf(t: StaticTextCheck | null): number {
  if (!t || t.status !== 'mismatch') return 0;
  return t.items.filter((i) => i.critical && i.match !== true).length + (t.extraText?.length ?? 0);
}

/**
 * `IteratePiece.formats` (§14.2): sempre os 3, na ordem 9x16, 4x5, 1x1, pelo render vigente de cada formato. `requestUsd`
 * só em `none`/`failed` (STATIC = staticImageUsd; vídeo = 0).
 */
export function pieceFormats(renders: PieceFormatRender[], isStatic: boolean, staticImageUsd: number, supported?: readonly FormatCode[]): PieceFormat[] {
  const latest = latestByFormat(renders);
  return ALL_FORMATS.map((f) => {
    const r = latest.get(f);
    const state: PieceFormat['state'] = !r ? 'none' : r.status === 'QUEUED' ? 'queued' : r.status === 'RENDERING' ? 'rendering' : r.status === 'READY' ? 'ready' : 'failed';
    const failed = state === 'failed';
    return {
      format: FORMAT_CODE[f], state,
      progress: state === 'rendering' ? r!.progress : null,
      errorCode: failed ? r!.errorCode ?? 'RENDER_ERROR' : null,
      failReason: failed ? r!.failReason : null,
      requestUsd: state === 'none' || failed ? (isStatic ? staticImageUsd : 0) : null,
      // 25/10 §B4: só FRAME manda `supported` (ausente = true nos outros tipos)
      ...(supported && { supported: supported.includes(FORMAT_CODE[f]) }),
    };
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `MMDD` = data UTC do launchedAt do lote (todas as peças de um zip com a mesma data). */
export function mmddUtc(d: Date): string {
  return `${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** adName da peça AUTO, sem formato nem extensão (§8): CLIENTE_MMDD_CODIGO → "MC_1013_CUT-15S". Sufixo de colisão: ad-name.ts. */
export function autoAdName(i: { shortCode: string; launchedAt: Date; code: string }): string {
  return [i.shortCode, mmddUtc(i.launchedAt), i.code].join('_');
}

/** Nome do arquivo de um formato (§8): `<adName>_<FMT>.<ext>` → "MC_1013_CUT-15S_9x16.mp4" / "MC_1013_STATIC-F1_1x1.png". */
export function autoFileName(adName: string, format: VideoFormat, mimeType: string): string {
  return `${adName}_${FORMAT_CODE[format]}.${mimeType === 'image/png' ? 'png' : 'mp4'}`;
}

/** Pasta do zip pelo eixo (fixo por tipo, §6.1). */
export function folderOf(axis: VariationAxis | null): '1-stretch' | '2-new-audience' {
  return axis === 'DIVERSITY' ? '2-new-audience' : '1-stretch';
}

/** Código do formato a partir do ?format do download (padrão 9x16). */
export function formatFromQuery(q: string | undefined): VideoFormat {
  return FORMAT_OF_CODE[(q ?? '9x16') as FormatCode] ?? 'VERTICAL_9_16';
}

/**
 * Gatilhos de mock (§14.7), nas notes da oferta: `[mock:render-fail:<TYPE>]` faz a 1ª tentativa do 9:16 daquele tipo
 * falhar com RENDER_ERROR (o Retry passa); `[mock:format-fail:<TYPE>]` faz a 1ª tentativa do 4:5 sob demanda falhar (o
 * pedido de novo passa).
 */
export function mockRenderFail(notes: string | null, type: string | null, format: VideoFormat, attempt: number, frameTemplate?: string | null): boolean {
  if (!notes || !type || attempt !== 1) return false;
  if (format === 'VERTICAL_9_16') {
    // 25/10 §B6: `[mock:frame-fail:<id>]` = 1ª tentativa do 9:16 daquela moldura falha (RENDER_ERROR); o Retry passa
    if (type === 'FRAME' && frameTemplate && notes.includes(`[mock:frame-fail:${frameTemplate}]`)) return true;
    return notes.includes(`[mock:render-fail:${type}]`);
  }
  if (format === 'PORTRAIT_4_5') return notes.includes(`[mock:format-fail:${type}]`);
  return false;
}

// ───────── molduras (estatico-montado-e-molduras-v1 §B2, §B4) ─────────

/**
 * Formatos que cada moldura tem (§B4/D13): os 3 até a revisão visual do Gusta no contact sheet; o template reprovado num
 * formato sai daqui (aí `POST /formats` = 409 `format_not_supported` e `PieceFormat.supported = false`).
 */
export const FRAME_FORMATS: Record<FrameTemplateId, readonly FormatCode[]> = {
  question_box: ['9x16', '4x5', '1x1'], gossip_page: ['9x16', '4x5', '1x1'], meme: ['9x16', '4x5', '1x1'], cinema: ['9x16', '4x5', '1x1'],
  news: ['9x16', '4x5', '1x1'], split_stack: ['9x16', '4x5', '1x1'], split_torn: ['9x16', '4x5', '1x1'], call: ['9x16', '4x5', '1x1'],
  call_dialog: ['9x16', '4x5', '1x1'], ranking: ['9x16', '4x5', '1x1'], post_card: ['9x16', '4x5', '1x1'], direct_offer: ['9x16', '4x5', '1x1'],
  story: ['9x16', '4x5', '1x1'], read_caption: ['9x16', '4x5', '1x1'], pov_testimonial: ['9x16', '4x5', '1x1'], live: ['9x16', '4x5', '1x1'],
  gossip_white: ['9x16', '4x5', '1x1'], gossip_pink: ['9x16', '4x5', '1x1'],
};

/** Template da moldura no `payload.params` (FRAME); null nos outros tipos. */
export function frameTemplateOf(params: Record<string, unknown> | null | undefined): FrameTemplateId | null {
  const t = params?.template;
  return typeof t === 'string' && t in FRAME_FORMATS ? (t as FrameTemplateId) : null;
}

/** Formatos suportados de uma peça: FRAME = tabela; outros tipos = undefined (todos). */
export function supportedFormatsOf(type: string | null, params: Record<string, unknown> | null | undefined): readonly FormatCode[] | undefined {
  // headline-e-legenda-v1 §1.5: o HEADLINE só existe no aspecto do campeão (remix-keep sai no tamanho dele)
  if (type === 'HEADLINE') return [FORMAT_CODE[primaryFormatOf(type, params)]];
  // iterate-v2 F1.1 (D2 do Gusta): os templates grátis só existem em 9:16 na v1
  if (type === 'CHAT_DM' || type === 'PERSON_MOTION') return ['9x16'];
  if (type !== 'FRAME') return undefined;
  const t = frameTemplateOf(params);
  return t ? FRAME_FORMATS[t] : ['9x16'];
}

/** `IteratePiece.frame` (B1: sem 2ª fonte; B2 preenche `second` com a proveniência). */
export function pieceFrameOf(params: Record<string, unknown> | null | undefined): PieceFrame | null {
  const template = frameTemplateOf(params);
  if (!template) return null;
  const second = (params?.second ?? null) as {
    kind?: FrameSecondKind; provenance?: BrollProvenance | null;
    clips?: { fromSec: number; toSec: number; segmentText: string; provenance: BrollProvenance | GeneratedProvenance }[];
  } | null;
  return {
    template,
    second: second?.kind
      ? {
        kind: second.kind, provenance: second.kind === 'stock_broll' ? second.provenance ?? null : null,
        // 25/10: trilha de b-roll = cada clipe com o trecho da fala e a proveniência (§B3.1 item 9)
        ...(second.kind === 'broll_track' && { track: (second.clips ?? []).map((c) => ({ fromSec: c.fromSec, toSec: c.toSec, segmentText: c.segmentText, provenance: c.provenance })) }),
      }
      : null,
    canSwapBroll: second?.kind === 'stock_broll',
  };
}

/** D14: texto do anúncio sugerido da `read_caption` (padrão do Meta publish e README do zip); null nos outros. */
export function suggestedPrimaryTextOf(params: Record<string, unknown> | null | undefined): string | null {
  const t = params?.suggestedPrimaryText;
  return frameTemplateOf(params) === 'read_caption' && typeof t === 'string' && t.trim() ? t.trim() : null;
}

/** §B2: texto da moldura não coube no mínimo de 36 px = refazer não adianta (Leave out). */
export const FRAME_TEXT_OVERFLOW = 'FRAME_TEXT_OVERFLOW';

/** `variation_items.payload.params` (objeto ou null). */
export function paramsOf(payload: unknown): Record<string, unknown> | null {
  const p = (payload ?? null) as { params?: unknown } | null;
  return p?.params && typeof p.params === 'object' ? (p.params as Record<string, unknown>) : null;
}

/** §A6 `IteratePiece.textCheck`: o veredito gravado no render do STATIC assembled; null = legado ou sem checagem ainda. */
export function textCheckOf(renderInput: unknown): StaticTextCheck | null {
  const i = (renderInput ?? null) as { spec?: { layout?: unknown }; textCheck?: StaticTextCheck | null } | null;
  if (i?.spec?.layout !== 'assembled') return null;
  const t = i.textCheck;
  return t && (t.status === 'ok' || t.status === 'mismatch' || t.status === 'skipped')
    ? { status: t.status, items: Array.isArray(t.items) ? t.items : [], extraText: Array.isArray(t.extraText) ? t.extraText : [] }
    : null;
}

/** §A10.4: etapa e tentativa do STATIC em render (`stage` do render: image/text_check/retake; tentativa = nº de tasks). */
export function staticRenderStage(stage: string | null | undefined): 'image' | 'text_check' | 'retake' {
  return stage === 'text_check' || stage === 'retake' ? stage : 'image';
}

/**
 * Duração de saída esperada de uma peça de vídeo (pra `renderEtaSec`, §10): CUT = alvo; ENDCARD = original + 2 s; resto
 * = duração do campeão. O STATIC não passa pelo Remotion (§14.2: conta STATIC_IMAGE_ETA_SEC fixos).
 */
export function expectedOutputSec(type: string | null, params: Record<string, unknown> | null, championSec: number): number {
  if (type === 'CUT' && typeof params?.targetSec === 'number') return params.targetSec;
  if (type === 'ENDCARD') return championSec + 2;
  return championSec;
}

// ───────── STATIC no GPT Image 2 (§14.3) ─────────

/** ETA fixo de 1 imagem do STATIC (= STATIC_IMAGE_MODEL.etaSec da ia, 60 s; §14.2). */
export const STATIC_IMAGE_ETA_SEC = STATIC_IMAGE_MODEL.etaSec; // 25/10: 2k, 90 s (lido do catálogo da ia)
/** Preço de 1 imagem até a ia ligar `estimateStaticImages` no CatalogService (§14.3: high 1k = US$ 0,22). TRANSIÇÃO. */
export const STATIC_IMAGE_USD_FALLBACK = STATIC_IMAGE_MODEL.usdPerImage; // 25/10: high 2k = US$ 0,40 (D1)
/**
 * US$ de `count` imagens do STATIC (§14.4: `IterateConfig.staticImageUsd` = estimativa de 1). TRANSIÇÃO (§14.5): o
 * CatalogService ganha `extends StaticImageCatalog` no fechamento; até a R-I, o preço fixo do contrato.
 */
export function estimateStaticUsd(catalog: unknown, count: number): number {
  if (count <= 0) return 0;
  const c = catalog as Partial<StaticImageCatalog> | null;
  const v = typeof c?.estimateStaticImages === 'function' ? c.estimateStaticImages.call(c, count) : count * STATIC_IMAGE_USD_FALLBACK;
  return Math.round(v * 10_000) / 10_000;
}

/** No máximo 1 reenvio automático por render (2 tasks), §14.3 passo 4. */
export const STATIC_MAX_TASKS = 2;

export const STATIC_ASPECT: Record<VideoFormat, StaticAspect> = { VERTICAL_9_16: '9:16', PORTRAIT_4_5: '4:5', SQUARE_1_1: '1:1' };

/** Plano antigo (STATIC sem `visual`, de antes do deploy): pôster tipográfico só com a headline e a paleta (§14.3). */
export const LEGACY_STATIC_VISUAL: StaticVisualDraft = { object: '', scene: '', vibe: '', style: 'ad_graphic', headlinePlacement: 'center' };

/** `StaticImageSpec` a partir do `payload.params` do item + idioma da tela do lote. */
export function staticSpecOf(params: Record<string, unknown> | null | undefined, screenLanguage: string): StaticImageSpec {
  const v = params?.visual as Partial<StaticVisualDraft> | undefined;
  const visual: StaticVisualDraft = v && typeof v === 'object'
    ? {
      object: typeof v.object === 'string' ? v.object : '', scene: typeof v.scene === 'string' ? v.scene : '', vibe: typeof v.vibe === 'string' ? v.vibe : '',
      style: v.style === 'everyday_photo' || v.style === 'cinematic' || v.style === 'ad_graphic' ? v.style : 'ad_graphic',
      headlinePlacement: v.headlinePlacement === 'top' || v.headlinePlacement === 'bottom' || v.headlinePlacement === 'center' ? v.headlinePlacement : 'center',
    }
    : { ...LEGACY_STATIC_VISUAL };
  return { headline: typeof params?.headline === 'string' ? params.headline : '', screenLanguage, visual };
}

/**
 * §A5: layout pela FORMA do `payload.params` (nunca replaneja): `copy` = assembled (plano novo); `visual.object` preenchido
 * = photo_headline (plano de 23-25/10); sem visual = poster (plano anterior a 23/10).
 */
export function staticLayoutOf(params: Record<string, unknown> | null | undefined): StaticLayoutAny {
  if (params?.copy && typeof params.copy === 'object' && (params.layout === undefined || params.layout === 'assembled')) return 'assembled';
  const v = params?.visual as Partial<StaticVisualDraft> | undefined;
  return v && typeof v === 'object' && typeof v.object === 'string' && v.object.trim() ? 'photo_headline' : 'poster';
}

/** D4: de onde vem a referência da tela do produto. Tela (celular/notebook) = captura da página › foto; produto físico = foto › captura. */
export function screenRefSourceOf(kind: StaticVisualV2['product']['kind'] | undefined, has: { page: boolean; photo: boolean }): 'page' | 'photo' | null {
  if (!kind || kind === 'none') return null;
  if (kind === 'physical_product') return has.photo ? 'photo' : has.page ? 'page' : null;
  return has.page ? 'page' : has.photo ? 'photo' : null;
}

/**
 * `StaticImageSpecAny` do render (§A4/§A5), gravado em `Render.input.spec`: assembled = V2 (marca, paleta e referência da
 * tela do backend); photo_headline/poster = o spec de 23/10 com o `layout` marcado.
 */
export function staticSpecAnyOf(
  params: Record<string, unknown> | null | undefined, screenLanguage: string,
  v2: { brandName: string; palette: { background: string; accent: string }; screenRefUrl: string | null },
): StaticImageSpecAny {
  const layout = staticLayoutOf(params);
  if (layout === 'assembled') {
    const vis = (params?.visualV2 ?? params?.visual) as StaticVisualV2;
    const spec: StaticImageSpecV2 = {
      layout: 'assembled', screenLanguage, brandName: v2.brandName, palette: v2.palette,
      copy: params!.copy as StaticCopy, visual: vis, screenRefUrl: vis?.product?.kind && vis.product.kind !== 'none' ? v2.screenRefUrl : null,
    };
    return spec;
  }
  return { ...staticSpecOf(params, screenLanguage), layout };
}

/** O spec do 23/10 que a porta ainda exige (`SubmitStaticImageInput.spec`, TRANSIÇÃO): no V2 = headline lead + highlight. */
export function legacySpecOf(spec: StaticImageSpecAny): StaticImageSpec {
  if (spec.layout === 'assembled') {
    return { headline: `${spec.copy.headline.lead} ${spec.copy.headline.highlight}`.trim(), screenLanguage: spec.screenLanguage, visual: { ...LEGACY_STATIC_VISUAL } };
  }
  return { headline: spec.headline, screenLanguage: spec.screenLanguage, visual: spec.visual };
}

export const isAssembled = (spec: unknown): spec is StaticImageSpecV2 => !!spec && typeof spec === 'object' && (spec as { layout?: unknown }).layout === 'assembled';

/**
 * Próximo passo depois de uma task do STATIC terminar sem imagem (§14.3 passo 4): reenvia 1 vez (SAFETY_BLOCK → prompt
 * `safe`; erro do provedor/timeout/download → igual) ou falha o render com o código.
 */
export function staticNextStep(i: { code: string; tasks: number; safe: boolean }): { resend: true; safe: boolean } | { resend: false } {
  const retriable = i.code === 'SAFETY_BLOCK' || i.code === 'PROVIDER_ERROR' || i.code === 'PROVIDER_TIMEOUT' || i.code === 'DOWNLOAD_INVALID';
  if (!retriable || i.tasks >= STATIC_MAX_TASKS) return { resend: false };
  return { resend: true, safe: i.safe || i.code === 'SAFETY_BLOCK' };
}

/** Código final do render do STATIC (§14.3 passo 4): SAFETY_BLOCK, PROVIDER_TIMEOUT, PROVIDER_ERROR ou DOWNLOAD_INVALID. */
export function staticFailCode(code: string): 'SAFETY_BLOCK' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'DOWNLOAD_INVALID' {
  return code === 'SAFETY_BLOCK' || code === 'PROVIDER_TIMEOUT' || code === 'DOWNLOAD_INVALID' ? code : 'PROVIDER_ERROR';
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ───────── legenda-protegida-v1 ─────────

/** §2.2 `IteratePiece.captionNote`: o render vigente saiu no modo `replace` (recorte + a nossa legenda no estilo da original). */
export function captionNoteOf(renderInput: unknown): 'replaced' | null {
  return (renderInput as { captionMode?: string } | null)?.captionMode === 'replace' ? 'replaced' : null;
}

/** §4.2: o 9:16 vigente falhou com a legenda tampada já num Retry (tentativa ≥ 2 deste formato) → a peça sugere Leave out.
 *  Os renders antigos ficam `stale` no Retry; a tentativa vem do `captionCheck.attempt` gravado no input. */
export function captionCoveredTwice(vertical: { errorCode?: string | null; input?: unknown } | undefined): boolean {
  const attempt = (vertical?.input as { captionCheck?: { attempt?: number } } | null)?.captionCheck?.attempt ?? 1;
  return vertical?.errorCode === 'CAPTION_COVERED' && attempt >= 2;
}

/** iterate-v2 F1.7: `IteratePiece.template` (id e, no person-motion, os trechos do campeão usados); null nos outros tipos. */
export function pieceTemplateOf(type: string | null | undefined, params: Record<string, unknown> | null | undefined): { id: 'chat-dm' | 'person-motion'; spans: { startSec: number; endSec: number }[] | null } | null {
  if (type === 'CHAT_DM') return { id: 'chat-dm', spans: null };
  if (type !== 'PERSON_MOTION') return null;
  const tl = Array.isArray(params?.timeline) ? (params!.timeline as { startSec: number; endSec: number }[]) : [];
  return { id: 'person-motion', spans: tl.map((t) => ({ startSec: t.startSec, endSec: t.endSec })) };
}
