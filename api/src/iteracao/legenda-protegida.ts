// legenda-protegida-v1 §2.3/§3 no plano: o template (ou o tipo) que tamparia ou cortaria a legenda queimada do campeão,
// mesmo depois de desviar e de recortar sem cortar o rosto, não é oferecido (`burned_captions`). A conta é a MESMA do build
// (buildFrameInput / buildHeadlineInput / buildAutoEditInput do maquina-video, que rodam `decidirLegenda` e lançam
// CAPTION_PROTECTED / HEADLINE_NO_ROOM): no `allowed` com textos de amostra; na validação com os textos reais do plano.
import type { AutoVariationType, EditMap, FrameTemplateId, ProtectedBand, TranscriptWord } from '@maquina/contratos';
import { TEXT_LIMITS } from '@maquina/video';
import type { FrameSpec } from '../integracoes/contrato';
import { buildAutoEditInput, type AutoEditContext } from '../render/auto-edit';
import { buildFrameInput } from '../render/frame';
import { buildHeadlineInput } from '../render/headline';
import { semLegendaQueimada } from '../campeoes/faixas-protegidas';
import type { HeadlineInfo } from './headline-plano';

export type CaptionBlockReason = 'face_cut' | 'no_room';
export interface CaptionBlocked { type: AutoVariationType; template: FrameTemplateId | null; reason: CaptionBlockReason }

/** O que a guarda precisa do campeão (as mesmas peças do `autoContext` da fila, sem URL assinada). */
export interface CaptionGuardSource {
  editMap: EditMap | null;
  source: { width: number; height: number; fps: number; durationSec: number; hasAudio: boolean };
  words: TranscriptWord[];
  silences: { startSec: number; endSec: number }[];
  blocks: { index: number; startSec: number; endSec: number }[];
  hookEndSec: number | null;
  palette: string[];
  brandName: string;
  language: string;
  brandColor: string | null;
}

/** Item do plano visto pela guarda (tipo + params finais, os mesmos que vão pro `payload.params`). */
export interface CaptionGuardItem { type: AutoVariationType; params: Record<string, unknown> }

export interface CaptionGuard {
  /** faixas protegidas do campeão (px do arquivo); vazio = nada a proteger */
  bands: ProtectedBand[];
  /** fora do `allowed` (template null = o tipo inteiro) */
  blocked: CaptionBlocked[];
  /** a mesma conta com o item real: motivo ou null (passa) */
  check(item: CaptionGuardItem): CaptionBlockReason | null;
}

/** Tipos de vídeo em que o builder roda `decidirLegenda` (os outros não desenham por cima do campeão ou não usam o vídeo). */
const TIPOS_CHECADOS: readonly AutoVariationType[] = ['CUT', 'REVIEW', 'NATIVE_SEARCH', 'HEADLINE'];
const DUAS_FONTES: readonly FrameTemplateId[] = ['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'];

const semEspaco = (lang: string) => /^(zh|ja|ko|th)/i.test(lang);
/** Texto de amostra com ~70 % do limite (o tamanho típico do plano), no sistema de escrita do idioma. */
function amostra(max: number, lang: string): string {
  const n = Math.max(1, Math.round(max * 0.7));
  if (semEspaco(lang)) return '字'.repeat(n);
  const out: string[] = [];
  while (out.join(' ').length + 6 <= n) out.push('Texto');
  return out.length ? out.join(' ') : 'Texto'.slice(0, n);
}

/** Textos de amostra por template (forma do `frameTextsSchemas`). */
export function textosDeAmostra(t: FrameTemplateId, lang: string): Record<string, unknown> {
  const L = TEXT_LIMITS;
  const a = (n: number) => amostra(n, lang);
  switch (t) {
    case 'question_box': return { question: a(L.question_box.question) };
    case 'meme': return { pov: a(L.meme.pov), cta: a(L.meme.cta) };
    case 'cinema': return { question: a(L.cinema.question), subtitle: a(L.cinema.subtitle) };
    case 'news': return { topic: a(L.news.topic), headline: { lead: a(L.news.lead), highlight: a(L.news.highlight) }, dek: a(L.news.dek), cta: a(L.news.cta) };
    case 'read_caption': return { headline: a(L.read_caption.headline), primaryText: a(200) };
    case 'pov_testimonial': return { pov: a(L.pov_testimonial.pov), cta: a(L.pov_testimonial.cta) };
    case 'direct_offer': return { promise: a(L.direct_offer.promise), price: { from: '$ 99', to: '$ 49' }, cta: a(L.direct_offer.cta) };
    case 'live': return {};
    case 'ranking': return { title: a(L.ranking.title), items: [1, 2, 3, 4].map(() => a(L.ranking.item)) };
    case 'post_card': return { copy: a(L.post_card.copy) };
    case 'split_stack': return { headline: a(L.split_stack.headline) };
    case 'split_torn': return { headline: a(L.split_torn.headline) };
    case 'gossip_page': return { headline: a(L.gossip_page.headline), pageName: a(L.gossip_page.pageName) };
    case 'gossip_white': return { headline: a(L.gossip_white.headline) };
    case 'gossip_pink': return { headline: a(L.gossip_pink.headline) };
    case 'call': return { title: a(L.call.title), slideTitle: a(L.call.slideTitle), slideSteps: [1, 2, 3].map(() => a(L.call.step)) };
    case 'call_dialog': return { title: a(L.call_dialog.title), names: [a(L.call_dialog.name), a(L.call_dialog.name)] };
    case 'story': return { question: a(L.story.question), headline: a(L.story.headline), support: a(L.story.support), copy: a(200) };
  }
}

/** Variações de amostra de um template: listas (ranking 3-5 itens, call 2-3 passos) mudam a altura do layout; o template só
 *  sai do `allowed` se TODAS tampam a legenda (a validação repete a conta com a lista real do plano). */
export function amostrasDoTemplate(t: FrameTemplateId, lang: string): Record<string, unknown>[] {
  const base = textosDeAmostra(t, lang);
  const L = TEXT_LIMITS;
  if (t === 'ranking') {
    const items = base.items as string[];
    return [L.ranking.itemsMin, 4, L.ranking.itemsMax].map((n) => ({ ...base, items: Array.from({ length: n }, () => items[0]) }));
  }
  if (t === 'call') {
    const steps = base.slideSteps as string[];
    return [L.call.stepsMin, L.call.stepsMax].map((n) => ({ ...base, slideSteps: Array.from({ length: n }, () => steps[0]) }));
  }
  return [base];
}

/** 2ª fonte de amostra (a posição da caixa é a que conta; o conteúdo é resolvido no render): trilha de b-roll inteira. */
const segundaDeAmostra = (dur: number) => ({ kind: 'broll_track', clips: [{ fromSec: 0, toSec: dur, fileUrl: 'about:blank', srcStartSec: 0, srcEndSec: dur }] });

/** Params de amostra dos tipos de vídeo checados (os do plano real entram pelo `check`). */
function paramsDeAmostra(type: AutoVariationType, s: CaptionGuardSource, headline: HeadlineInfo | null): Record<string, unknown> | null {
  const dur = s.source.durationSec;
  switch (type) {
    case 'CUT': {
      const b = s.blocks.length > 2 ? s.blocks.slice(0, -1) : s.blocks;
      return { type, targetSec: 15, blockIndexes: b.map((x) => x.index), timeline: b.length ? b.map((x) => ({ startSec: x.startSec, endSec: x.endSec })) : [{ startSec: 0, endSec: Math.min(dur, 15) }] };
    }
    case 'REVIEW': return { type, quote: amostra(90, s.language), author: 'Ana', stars: 5 };
    case 'NATIVE_SEARCH': return { type, query: amostra(30, s.language) };
    case 'HEADLINE': {
      if (!headline || headline.blockedReason) return null;
      const text = headline.mode === 'replace' && headline.original ? headline.original : amostra(Math.min(40, headline.maxChars), headline.language);
      return { type, mode: headline.mode, text, highlight: null, language: headline.language };
    }
    default: return null;
  }
}

function ctxDe(s: CaptionGuardSource, type: AutoVariationType, params: Record<string, unknown>, editMap: EditMap | null): AutoEditContext {
  return {
    renderId: 'plan', type, params: { ...params, type } as unknown as AutoEditContext['params'], language: s.language,
    source: { videoUrl: 'about:blank', ...s.source } as AutoEditContext['source'],
    editMap, words: s.words, silences: s.silences, blocks: s.blocks, hookEndSec: s.hookEndSec, palette: s.palette, brandName: s.brandName, page: null,
  };
}

const codeOf = (e: unknown) => (e as { code?: string } | null)?.code;

/**
 * Roda o builder do item (9:16 = o formato do Gerar; HEADLINE = o do campeão, decidido no builder). Só CAPTION_PROTECTED
 * (e, no HEADLINE, o NO_ROOM que some sem as camadas de legenda) conta como bloqueio: os outros erros (texto que não
 * coube, rosto, etc.) são de outras regras.
 */
function decide(s: CaptionGuardSource, item: CaptionGuardItem): CaptionBlockReason | null {
  const ctx = ctxDe(s, item.type, item.params, s.editMap);
  try {
    if (item.type === 'FRAME') {
      const p = item.params as unknown as FrameSpec;
      buildFrameInput({ ...p, second: p.second ?? (DUAS_FONTES.includes(p.template) ? (segundaDeAmostra(s.source.durationSec) as never) : null) }, ctx, 'VERTICAL_9_16');
    } else if (item.type === 'HEADLINE') {
      const p = item.params as { mode: 'replace' | 'add'; text: string; highlight: string | null; language?: string };
      const spec = { mode: p.mode, text: p.text, highlight: p.highlight, language: p.language ?? s.language, brandColor: s.brandColor };
      try {
        buildHeadlineInput(spec, ctx);
      } catch (e) {
        if (codeOf(e) !== 'HEADLINE_NO_ROOM') return null;
        // sem a legenda queimada coube? então quem tirou o lugar foi ela
        try {
          buildHeadlineInput(spec, ctxDe(s, item.type, item.params, semLegendaQueimada(s.editMap)));
          return 'no_room';
        } catch {
          return null;
        }
      }
    } else if (TIPOS_CHECADOS.includes(item.type)) {
      buildAutoEditInput(ctx, 'VERTICAL_9_16');
    }
    return null;
  } catch (e) {
    if (codeOf(e) === 'CAPTION_PROTECTED') return ((e as { reason?: CaptionBlockReason }).reason ?? 'no_room');
    return null;
  }
}

/**
 * Guarda do lote. `bands` vazio (sem legenda queimada, ou com a versão sem legenda) = nada bloqueado e `check` sempre passa.
 * `frame` = marca/idioma da tela das molduras (os mesmos do FrameSpec do plano).
 */
export function captionGuardOf(
  s: CaptionGuardSource,
  bands: ProtectedBand[],
  opts: { templates: readonly FrameTemplateId[]; frame: { brand: FrameSpec['brand']; screenLanguage: string; faceAtSec: number | null }; headline: HeadlineInfo | null },
): CaptionGuard {
  if (!bands.length) return { bands: [], blocked: [], check: () => null };
  const guard = (item: CaptionGuardItem) => decide(s, item);
  const blocked: CaptionBlocked[] = [];
  for (const t of opts.templates) {
    let reason: CaptionBlockReason | null = null;
    for (const texts of amostrasDoTemplate(t, opts.frame.screenLanguage)) {
      const spec: FrameSpec = {
        template: t, texts: texts as FrameSpec['texts'], screenLanguage: opts.frame.screenLanguage,
        brand: opts.frame.brand, faceAtSec: opts.frame.faceAtSec, second: null, suggestedPrimaryText: null,
      };
      const r = guard({ type: 'FRAME', params: spec as unknown as Record<string, unknown> });
      if (!r) { reason = null; break; }
      reason = r;
    }
    if (reason) blocked.push({ type: 'FRAME', template: t, reason });
  }
  for (const type of TIPOS_CHECADOS) {
    const params = paramsDeAmostra(type, s, opts.headline);
    if (!params) continue;
    const r = guard({ type, params });
    if (r) blocked.push({ type, template: null, reason: r });
  }
  return { bands, blocked, check: guard };
}
