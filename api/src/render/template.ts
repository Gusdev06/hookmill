/**
 * iterate-v2-quiz-templates-ia F1.4: buildTemplateInput(spec, ctx, format) → TemplateRenderInput (kind 'template'). Função
 * PURA do maquina-video, como o buildFrameInput: o backend monta o TemplateSpec (payload.params da peça) e o AutoEditContext
 * do campeão, e chama ao tirar o render da fila. Mesmo spec + ctx + formato = mesmo input.
 *
 * - Só 9:16 na v1 (outro formato = RENDER_ERROR; a vista já mostra `supported: false`).
 * - chat-dm: agenda pelo `chatTimeline` do @maquina/video (altura MEDIDA com a fonte real); nenhuma mídia baixada.
 * - person-motion: trechos do campeão (rosto e voz dele), caixa do rosto por trecho (`personMotionLayout`): a legenda
 *   queimada dentro da caixa = CAPTION_PROTECTED; cenas do palco no tempo de SAÍDA (palavra → segundo da peça); legenda
 *   palavra a palavra com as palavras do campeão (a composição leva pro tempo da peça pelo timeline).
 * - Texto que não cabe no mínimo de 36 px (ou cena maior que o palco, fecho fora da área livre) = TEMPLATE_TEXT_OVERFLOW.
 * - `checkpoints`: 4-6 instantes com o texto esperado (checagem por visão, F1.5).
 */
import type { VideoFormat } from '@prisma/client';
import {
  PERSON_END_SEC, PERSON_GEO, TEMPLATE_SAFE, alturaDoBeat, beatFits, chatLayout, chatTimeline, faixasProtegidasDe, fechoChatGeo, limparTexto, naoCouberam,
  personLayout, personMotionLayout, propsDeTemplateInput, type ChatDmProps, type FaceMapLike, type PersonBeatProps, type PersonMotionProps, type TemplateProps,
} from '@maquina/video';
import type { FrameBrand, TemplateSpec } from '../integracoes/contrato';
import type { AutoEditContext } from './auto-edit';
import type { TemplateRenderInput } from './contrato';
import { CaptionProtectedError } from './frame';
import { palavrasNaEscrita } from './escrita-chinesa';

/** Texto do template que não coube (a fila grava TEMPLATE_TEXT_OVERFLOW na peça; refazer não adianta). */
export class TemplateTextOverflowError extends Error {
  readonly code = 'TEMPLATE_TEXT_OVERFLOW' as const;
  constructor(public readonly slots: { slot: string; overflow: string | null; size: number; lines: number }[]) {
    super(`TEMPLATE_TEXT_OVERFLOW: ${slots.map((s) => `${s.slot} ${s.overflow ?? ''} ${s.lines} linhas a ${s.size}px`).join('; ')}`);
  }
}

/** .wav sintetizados do bundle (video/public/sfx). */
export const TEMPLATE_SFX = { pop: 'sfx/pop.wav', send: 'sfx/send.wav', ding: 'sfx/ding.wav' } as const;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Idioma da tela: sem região ("zh") herda a do lote ("zh-TW") — decide tradicional × simplificado. */
const idioma = (spec: { screenLanguage: string }, ctx: AutoEditContext) =>
  !spec.screenLanguage.includes('-') && ctx.language.toLowerCase().startsWith(spec.screenLanguage.toLowerCase()) ? ctx.language : spec.screenLanguage;

const marca = (b: FrameBrand): TemplateProps['brand'] => ({ name: limparTexto(b.name) || 'Brand', handle: limparTexto(b.handle), initials: limparTexto(b.initials).slice(0, 3) || 'B', color: b.color });

/** Segundo do campeão → segundo da peça (timeline emendado). null = fora dos trechos. */
export function paraSaida(timeline: { startSec: number; endSec: number }[], t: number): number | null {
  let at = 0;
  for (const s of timeline) {
    if (t >= s.startSec - 0.05 && t <= s.endSec + 0.05) return r3(at + Math.min(Math.max(t, s.startSec), s.endSec) - s.startSec);
    at += s.endSec - s.startSec;
  }
  return null;
}

function buildChat(spec: Extract<TemplateSpec, { type: 'CHAT_DM' }>, lang: string): { props: ChatDmProps; durSec: number; checkpoints: TemplateProps['checkpoints'] } {
  const chat = {
    hook: spec.hook, chrome: spec.chrome,
    messages: spec.messages.map((m) => ({ from: m.from, kind: m.kind, text: m.text, wrong: m.wrong.slice(0, 2), right: m.right.slice(0, 3) })),
    close: { lines: spec.close.lines.slice(0, 3) }, cta: spec.cta, proof: spec.proof.slice(0, 3),
  };
  const fits = chatLayout(chat, lang);
  const fora = naoCouberam(fits);
  const by = new Map(fits.map((f) => [f.slot, f.fit]));
  const geo = fechoChatGeo(chat.close.lines.map((_, k) => by.get(`close.lines.${k}`)!.height), chat.proof.length, chat.cta.note ? by.get('cta.note')!.height : null);
  if (!geo.cabe) fora.push({ slot: 'close', overflow: 'lines', size: 0, lines: chat.close.lines.length });
  if (fora.length) throw new TemplateTextOverflowError(fora);
  const ag = chatTimeline(chat, lang);
  const props: ChatDmProps = {
    ...chat,
    messages: chat.messages.map((m, i) => ({ ...m, ...ag.messages[i] })),
    close: { atSec: ag.closeAtSec, lines: chat.close.lines },
  };
  // checagem por visão: gancho, 3 mensagens espalhadas (a que acabou de entrar) e a cena final
  const idx = [...new Set([1, Math.floor(props.messages.length / 2), props.messages.length - 1])].filter((k) => k >= 0 && k < props.messages.length);
  const checkpoints = [
    { atSec: 1, texts: [chat.hook.text] },
    ...idx.map((k) => ({ atSec: r3(Math.min(ag.closeAtSec - 0.2, props.messages[k].atSec + 0.8)), texts: [props.messages[k].text] })),
    { atSec: r3(ag.closeAtSec + 3), texts: [...chat.close.lines, chat.cta.button] },
  ];
  return { props, durSec: ag.endSec, checkpoints };
}

function buildPerson(spec: Extract<TemplateSpec, { type: 'PERSON_MOTION' }>, ctx: AutoEditContext, lang: string, accent: string): { props: PersonMotionProps; durSec: number; checkpoints: TemplateProps['checkpoints'] } {
  const src = ctx.source;
  const timeline = spec.timeline.filter((s) => s.endSec > s.startSec).map((s) => ({ startSec: r3(Math.max(0, s.startSec)), endSec: r3(Math.min(src.durationSec, s.endSec)) }));
  const bands = ctx.editMap ? faixasProtegidasDe(ctx.editMap as never, src) : [];
  const lay = personMotionLayout(src, ctx.editMap as unknown as FaceMapLike, timeline, bands);
  if (lay.mode === 'blocked') throw new CaptionProtectedError(lay.reason === 'no_face' ? 'face_cut' : 'no_room', lay.hits.map((h) => ({ element: 'face_box', atSec: h.atSec, overlapPx: 0 })));
  const fala = timeline.reduce((s, x) => s + (x.endSec - x.startSec), 0);
  const w = ctx.words;
  // cena → tempo de saída; a próxima cena (ou o fim do trecho) fecha a anterior
  const inicioDoTrecho = (k: number) => timeline.slice(0, k).reduce((s, x) => s + x.endSec - x.startSec, 0);
  const brutos = spec.beats
    .filter((b) => timeline[b.spanIndex] && w[b.atWord])
    .map((b) => {
      const tr = timeline[b.spanIndex];
      const de = paraSaida([tr], w[b.atWord].startSec);
      const ate = b.untilWord !== null && w[b.untilWord] ? paraSaida([tr], w[b.untilWord].endSec) : null;
      const off = inicioDoTrecho(b.spanIndex);
      return { b, fromSec: r3(off + (de ?? 0)), toSec: ate !== null ? r3(off + ate) : null, fimTrecho: r3(off + tr.endSec - tr.startSec) };
    })
    .sort((x, y) => x.fromSec - y.fromSec);
  const beats: PersonBeatProps[] = brutos.map((x, k) => {
    // o palco nunca fica vazio na fala: a cena vai até a próxima (ou até o fim da fala)
    const toSec = r3(Math.max(x.fromSec + 0.6, brutos[k + 1]?.fromSec ?? fala));
    const { spanIndex: _s, atWord: _a, untilWord: _u, ...conteudo } = x.b;
    void _s; void _a; void _u;
    return { ...conteudo, fromSec: x.fromSec, toSec } as PersonBeatProps;
  });
  if (!beats.length) throw new TemplateTextOverflowError([{ slot: 'beats', overflow: 'lines', size: 0, lines: 0 }]);
  const endCard = spec.endCard ? { fromSec: r3(fala), proof: spec.endCard.proof.slice(0, 3), cta: spec.endCard.cta } : null;
  const props: PersonMotionProps = {
    source: { videoUrl: src.videoUrl, width: src.width, height: src.height, fps: src.fps, durationSec: src.durationSec },
    timeline, joinFadeMs: 40, faceBox: lay.faceBox, beats,
    captions: { words: palavrasNaEscrita(w, lang).map((x) => ({ word: x.word, startSec: x.startSec, endSec: x.endSec })), highlightColor: accent, language: lang }, // zh-TW = tradicional
    endCard,
  };
  const fits = personLayout(props, lang);
  const fora = naoCouberam(fits);
  beats.forEach((b, i) => {
    const h = alturaDoBeat(b, beatFits(b as never, i, lang));
    if (h > PERSON_GEO.stage.h) fora.push({ slot: `beats.${i}`, overflow: 'lines', size: 0, lines: Math.round(h) });
  });
  if (fora.length) throw new TemplateTextOverflowError(fora);
  const textosDoBeat = (b: PersonBeatProps): string[] => {
    switch (b.kind) {
      case 'kinetic': return b.words;
      case 'wrong_right': return [b.wrong, ...b.right];
      case 'steps': return b.steps;
      case 'icon_list': return b.items.map((x) => x.text);
      case 'badge': return [b.text];
      case 'cta': return [b.button];
    }
  };
  const escolhidos = beats.length <= 4 ? beats : [beats[0], beats[Math.floor(beats.length / 3)], beats[Math.floor((2 * beats.length) / 3)], beats[beats.length - 1]];
  const checkpoints = [
    ...escolhidos.map((b) => ({ atSec: r3(Math.min(b.toSec - 0.1, b.fromSec + Math.min(1.2, (b.toSec - b.fromSec) * 0.8))), texts: textosDoBeat(b) })),
    ...(endCard ? [{ atSec: r3(fala + PERSON_END_SEC - 0.6), texts: [endCard.cta.button, ...endCard.proof.map((p) => p.label)] }] : []),
  ];
  return { props, durSec: fala + (endCard ? PERSON_END_SEC : 0), checkpoints };
}

export function buildTemplateInput(spec: TemplateSpec, ctx: AutoEditContext, format: VideoFormat): TemplateRenderInput {
  if (format !== 'VERTICAL_9_16') throw new Error(`template ${spec.templateId}: só 9:16 na v1 (pedido ${format})`);
  const lang = idioma(spec, ctx);
  const brand = marca(spec.brand);
  const comum = {
    format: 'VERTICAL_9_16' as const, fps: 30 as const, language: lang, brand, palette: ctx.palette ?? [], safeArea: { ...TEMPLATE_SAFE }, sfx: { ...TEMPLATE_SFX },
  };
  const montado = spec.type === 'CHAT_DM' ? buildChat(spec, lang) : buildPerson(spec, ctx, lang, brand.color);
  const props = {
    ...comum, durationInFrames: Math.round(montado.durSec * 30), checkpoints: montado.checkpoints,
    ...(spec.type === 'CHAT_DM' ? { templateId: 'chat-dm' as const, props: montado.props as ChatDmProps } : { templateId: 'person-motion' as const, props: montado.props as PersonMotionProps }),
  } as TemplateProps;
  // mesma validação da composição (schema): erro aqui = RENDER_ERROR antes de ir pra fila
  propsDeTemplateInput(props as unknown as Record<string, unknown>);
  return { kind: 'template', renderId: ctx.renderId, ...props };
}
