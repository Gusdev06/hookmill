// Templates grátis do Iterate v2 (docs/contratos/iterate-v2-quiz-templates-ia.md F1.4): `chat-dm` (conversa estilo Direct,
// sem pessoa) e `person-motion` (palco de motion em cima + rosto e voz do PRÓPRIO campeão numa caixa embaixo, legenda
// palavra a palavra). Promovidos do protótipo aprovado de 28/10 (src/prototipos/formatos, fora do produto).
// PURO (sem React): o schema da composição `Template`, as funções que a API usa no build (chatTimeline, fitTemplateText,
// personMotionLayout, chatLayout/personLayout pra conferir o texto que não cabe) e o validador das props.
// Regras do Gusta: nenhum print da landing, nenhuma imagem gerada, nunca imagem do produto, nada inventado (o texto chega
// validado pelo backend), só 9:16 na v1. Tudo o que não é o campeão é desenhado em código.
import { z } from 'zod';
import { captionsAutoSchema } from './captionsSchema';
import { METRIC_CHARS } from './metricas-fontes';
import { cjkDe, ehCJK, fitText, temCJK, textoVisivel, type FittedText, type FrameFontKey } from './molduras';

export const TEMPLATE_COMPOSITION_ID = 'Template';
export const TEMPLATE_RENDER_TEMPLATE_ID = 'template';
export const TEMPLATE_IDS = ['chat-dm', 'person-motion'] as const;
export type FormatTemplateId = (typeof TEMPLATE_IDS)[number];
/** Catálogo fixo de ícones desenhados em código (a IA escolhe daqui; nunca inventa ícone). */
export const TEMPLATE_ICON_IDS = ['check', 'x', 'arrow', 'brain', 'globe', 'chat', 'clock', 'star', 'gift', 'lock', 'heart', 'bolt'] as const;
export type TemplateIconId = (typeof TEMPLATE_ICON_IDS)[number];
export const TEMPLATE_W = 1080;
export const TEMPLATE_H = 1920;
export const TEMPLATE_FPS = 30;
/** Área livre da UI do Reels/Stories (a mesma das molduras 9:16, D6). */
export const TEMPLATE_SAFE = { top: 96, bottom: 192 } as const;
/** Mínimo de texto (igual ao das molduras). */
export const TEMPLATE_MIN_FONT_PX = 36;
/** Cena final do chat (promessa + números reais + CTA) e do pessoa + motion (prova + CTA). */
export const CHAT_CLOSE_SEC = 4.4;
export const PERSON_END_SEC = 3.4;

// ───────────────────────── schema ─────────────────────────

const proofStatSchema = z.object({
  value: z.number().min(0), decimals: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  prefix: z.string().max(4), suffix: z.string().max(4), label: z.string().min(1),
});
export type ProofStat = z.infer<typeof proofStatSchema>;
const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
const spanSchema = z.object({ startSec: z.number().min(0), endSec: z.number().min(0) });
const ctaSchema = z.object({ button: z.string().min(1), note: z.string().nullable() });

const chatMessageSchema = z.object({
  from: z.enum(['prospect', 'brand']),
  kind: z.enum(['question', 'objection', 'answer', 'correction', 'offer']),
  /** texto da bolha; 'correction'/'offer' = título do card */
  text: z.string().min(1),
  wrong: z.array(z.string()).max(2),
  right: z.array(z.string()).max(3),
  /** agenda calculada pelo builder (chatTimeline) */
  atSec: z.number().min(0), typingSec: z.number().min(0).nullable(), y: z.number(), h: z.number().positive(),
});
export type ChatMessageProps = z.infer<typeof chatMessageSchema>;

export const chatDmPropsSchema = z.object({
  hook: z.object({ text: z.string().min(1), highlight: z.string().nullable() }),
  chrome: z.object({ typing: z.string().min(1), inputPlaceholder: z.string().min(1), profileStatus: z.string().min(1) }),
  messages: z.array(chatMessageSchema).min(1).max(12),
  close: z.object({ atSec: z.number().min(0), lines: z.array(z.string().min(1)).min(1).max(3) }),
  cta: ctaSchema,
  proof: z.array(proofStatSchema).max(3),
});
export type ChatDmProps = z.infer<typeof chatDmPropsSchema>;

const beatBase = { fromSec: z.number().min(0), toSec: z.number().min(0) };
export const personBeatSchema = z.discriminatedUnion('kind', [
  z.object({ ...beatBase, kind: z.literal('kinetic'), words: z.array(z.string().min(1)).min(1).max(4) }),
  z.object({ ...beatBase, kind: z.literal('wrong_right'), wrong: z.string().min(1), right: z.array(z.string().min(1)).min(1).max(3) }),
  z.object({ ...beatBase, kind: z.literal('steps'), steps: z.array(z.string().min(1)).min(2).max(4) }),
  z.object({ ...beatBase, kind: z.literal('icon_list'), items: z.array(z.object({ icon: z.enum(TEMPLATE_ICON_IDS), text: z.string().min(1) })).min(2).max(4) }),
  z.object({ ...beatBase, kind: z.literal('badge'), text: z.string().min(1) }),
  z.object({ ...beatBase, kind: z.literal('cta'), button: z.string().min(1), note: z.string().nullable() }),
]);
export type PersonBeatProps = z.infer<typeof personBeatSchema>;

export const personMotionPropsSchema = z.object({
  source: z.object({ videoUrl: z.string().min(1), width: z.number().positive(), height: z.number().positive(), fps: z.number().positive(), durationSec: z.number().positive() }),
  /** trechos do campeão (já encaixados no silêncio); áudio = o do campeão, rampa de joinFadeMs em cada emenda */
  timeline: z.array(spanSchema).min(1).max(6),
  joinFadeMs: z.literal(40),
  /** caixa do rosto na saída (px) e, por trecho, a janela do campeão (px do arquivo) que aparece nela */
  faceBox: z.object({ focus: z.object({ x: z.number(), y: z.number() }), box: rectSchema, windows: z.array(rectSchema).min(1) }),
  /** cenas do palco no tempo de SAÍDA */
  beats: z.array(personBeatSchema).min(1),
  /** legenda palavra a palavra: palavras no tempo do CAMPEÃO (a composição leva pro tempo da peça pelo timeline, como no AutoEdit) */
  captions: captionsAutoSchema,
  endCard: z.object({ fromSec: z.number().min(0), proof: z.array(proofStatSchema).max(3), cta: ctaSchema }).nullable(),
});
export type PersonMotionProps = z.infer<typeof personMotionPropsSchema>;

const brandSchema = z.object({ name: z.string().min(1), handle: z.string(), initials: z.string().min(1).max(3), color: z.string().min(4) });
const comumSchema = {
  format: z.literal('VERTICAL_9_16'),
  fps: z.literal(30),
  language: z.string().min(2),
  brand: brandSchema,
  palette: z.array(z.string()),
  safeArea: z.object({ top: z.number().min(0), bottom: z.number().min(0) }),
  /** .wav do bundle (public/sfx/*.wav, caminho relativo = staticFile) ou URL; null = sem SFX */
  sfx: z.object({ pop: z.string(), send: z.string(), ding: z.string() }).nullable(),
  durationInFrames: z.number().int().positive(),
  /** frases e instantes que a checagem por visão confere (F1.5) */
  checkpoints: z.array(z.object({ atSec: z.number().min(0), texts: z.array(z.string()) })),
};
export const templateSchema = z.discriminatedUnion('templateId', [
  z.object({ ...comumSchema, templateId: z.literal('chat-dm'), props: chatDmPropsSchema }),
  z.object({ ...comumSchema, templateId: z.literal('person-motion'), props: personMotionPropsSchema }),
]);
export type TemplateProps = z.infer<typeof templateSchema>;

/** RenderInput do contrato (`kind 'template'`) → props validadas da composição (lança se não servir). */
export const propsDeTemplateInput = (input: Record<string, unknown>): TemplateProps => {
  const { kind: _k, renderId: _r, ...resto } = input as Record<string, unknown> & { kind?: string; renderId?: string };
  void _k; void _r;
  const p = templateSchema.parse(resto);
  if (p.templateId === 'person-motion') {
    const d = p.props.source.durationSec;
    for (const t of p.props.timeline) if (t.endSec <= t.startSec || t.endSec > d + 0.05) throw new Error(`trecho ${t.startSec}-${t.endSec} fora do campeão (${d} s)`);
    if (p.props.faceBox.windows.length !== p.props.timeline.length) throw new Error('faceBox.windows: uma janela por trecho');
  }
  return p;
};

// ───────────────────────── texto ─────────────────────────

const CHARS = new Set([...METRIC_CHARS]);
/** Caracteres que as fontes do bundle não desenham (emoji, setas, estrelas, ✓…): saem do texto antes do render. A
 *  composição desenha seta/estrela/check como SVG. Sem isso o Lambda pinta quadrado vazio. */
export const semGlifo = (s: string): string[] => [...new Set([...s].filter((c) => !/\s/.test(c) && !CHARS.has(c) && !ehCJK(c.codePointAt(0)!) && c !== '‍' && c !== '️'))];
/** Tira o que não tem glifo e normaliza espaços. */
export const limparTexto = (s: string): string => {
  const fora = new Set(semGlifo(s));
  return [...s].filter((c) => !fora.has(c) && c !== '‍' && c !== '️').join('').replace(/\s+/g, ' ').trim();
};

/** Ajuste de texto dos templates (o fitText das molduras: mesma tabela medida no Chrome, CJK quebra por caractere). */
export interface TemplateFit { slot: string; fit: FittedText }
export const fitTemplateText = (slot: string, text: string, o: { font: FrameFontKey; width: number; maxLines: number; max: number; min?: number; lineHeight?: number; language: string }): TemplateFit => ({
  slot,
  fit: fitText(text, { font: o.font, width: o.width, maxLines: o.maxLines, max: o.max, min: Math.max(TEMPLATE_MIN_FONT_PX, o.min ?? TEMPLATE_MIN_FONT_PX), lineHeight: o.lineHeight ?? 1.18, cjk: cjkDe(o.language) }),
});
/** Os slots que não couberam (= TEMPLATE_TEXT_OVERFLOW no build). */
export const naoCouberam = (fits: TemplateFit[]) => fits.filter((f) => !f.fit.fits).map((f) => ({ slot: f.slot, overflow: f.fit.overflow, size: f.fit.size, lines: f.fit.lines.length }));

const temCJKTexto = (s: string) => temCJK(s);

// ───────────────────────── chat-dm: geometria e agenda ─────────────────────────

export const CHAT_GEO = {
  hookTop: TEMPLATE_SAFE.top, hookH: 250,                    // manchete fixa (gancho do campeão)
  headerTop: TEMPLATE_SAFE.top + 250, headerH: 120,            // cabeçalho do Direct
  areaTop: TEMPLATE_SAFE.top + 250 + 120 + 16,                 // conversa
  inputH: 100,
  bubbleFs: 50, bubbleLh: 1.3, padV: 26, padH: 36, maxTxt: 700, gap: 18,
  cardW: 800, profileH: 470,
} as const;
/** Fim da área da conversa = começo da barra de digitar (acima da safeArea). */
export const CHAT_AREA_BOTTOM = TEMPLATE_H - TEMPLATE_SAFE.bottom - CHAT_GEO.inputH - 24;
export const CHAT_AREA_H = CHAT_AREA_BOTTOM - CHAT_GEO.areaTop;
const DIGITANDO = 0.55;

type ChatMsgIn = Pick<ChatMessageProps, 'from' | 'kind' | 'text' | 'wrong' | 'right'>;
export interface ChatIn { hook: ChatDmProps['hook']; chrome: ChatDmProps['chrome']; messages: ChatMsgIn[]; close: { lines: string[] }; cta: ChatDmProps['cta']; proof: ProofStat[] }

/** Ajustes de cada mensagem (bolha: texto; correção: título + linhas; oferta: título + benefícios + botão + nota). */
export const ajustesDaMensagem = (m: ChatMsgIn, i: number, cta: ChatDmProps['cta'], language: string): TemplateFit[] => {
  const g = CHAT_GEO;
  if (m.kind === 'correction') {
    return [
      fitTemplateText(`messages.${i}.title`, m.text, { font: 'inter-800', width: g.cardW - 72, maxLines: 1, max: 36, language }),
      ...m.wrong.map((l, k) => fitTemplateText(`messages.${i}.wrong.${k}`, l, { font: 'inter-800', width: g.cardW - 72 - 64, maxLines: 2, max: 50, min: 36, language })),
      ...m.right.map((l, k) => fitTemplateText(`messages.${i}.right.${k}`, l, { font: 'inter-800', width: g.cardW - 72 - 64, maxLines: 2, max: 50, min: 36, language })),
    ];
  }
  if (m.kind === 'offer') {
    return [
      fitTemplateText(`messages.${i}.title`, m.text, { font: 'montserrat-900', width: g.cardW - 80 - 140, maxLines: 2, max: 64, min: 40, lineHeight: 1.08, language }),
      ...m.right.map((l, k) => fitTemplateText(`messages.${i}.right.${k}`, l, { font: 'inter-800', width: g.cardW - 80 - 60, maxLines: 2, max: 42, min: 36, language })),
      fitTemplateText(`messages.${i}.button`, cta.button, { font: 'inter-800', width: g.cardW - 80 - 60, maxLines: 1, max: 44, min: 36, language }),
      ...(cta.note ? [fitTemplateText(`messages.${i}.note`, cta.note, { font: 'inter-600', width: g.cardW - 80, maxLines: 2, max: 36, language })] : []),
    ];
  }
  return [fitTemplateText(`messages.${i}.text`, m.text, { font: 'inter-600', width: g.maxTxt, maxLines: 6, max: g.bubbleFs, min: 40, lineHeight: g.bubbleLh, language })];
};

const alturaFit = (f: FittedText) => f.height;
/** Altura da mensagem (px), com as linhas que a medida deu. */
export const alturaDaMensagem = (m: ChatMsgIn, fits: TemplateFit[]): number => {
  const by = new Map(fits.map((f) => [f.slot.split('.').slice(2).join('.'), f.fit]));
  if (m.kind === 'correction') {
    const rows = [...m.wrong.map((_, k) => by.get(`wrong.${k}`)!), ...m.right.map((_, k) => by.get(`right.${k}`)!)];
    return 24 + 56 + rows.reduce((s, f) => s + Math.max(76, alturaFit(f) + 20), 0) + 28;
  }
  if (m.kind === 'offer') {
    const t = by.get('title')!;
    const rows = m.right.map((_, k) => by.get(`right.${k}`)!);
    const note = by.get('note');
    return Math.max(190, alturaFit(t) + 90) + 26 + rows.reduce((s, f) => s + Math.max(60, alturaFit(f) + 14), 0) + 10 + 104 + (note ? alturaFit(note) + 18 : 0) + 30;
  }
  return alturaFit(by.get('text')!) + CHAT_GEO.padV * 2;
};

/** Tempo de leitura de uma mensagem (s): CJK por caractere, latino por caractere visível, entre 1,2 e 3 s. */
export const leituraSec = (m: ChatMsgIn): number => {
  const all = [m.text, ...m.wrong, ...m.right].join(' ');
  const n = [...textoVisivel(all)].filter((c) => !/\s/.test(c)).length;
  const base = m.kind === 'offer' ? 2.4 : m.kind === 'correction' ? 1.8 : 0.5;
  return Math.min(3, Math.max(1.2, base + n * (temCJKTexto(all) ? 0.05 : 0.028)));
};

export interface ChatAgenda { messages: { atSec: number; typingSec: number | null; y: number; h: number }[]; closeAtSec: number; endSec: number }
/**
 * Agenda do chat (substitui o `agenda` do protótipo): quando cada mensagem entra, o "digitando…" da marca antes dela, a
 * altura MEDIDA com a fonte real (fitText) e o y na conversa (o cabeçalho de perfil fica no topo). Fim = cena final.
 */
export const chatTimeline = (c: ChatIn, language: string): ChatAgenda => {
  let t = 0.25;
  let y: number = CHAT_GEO.profileH;
  const out: ChatAgenda['messages'] = [];
  c.messages.forEach((m, i) => {
    const ant = c.messages[i - 1];
    let typingSec: number | null = null;
    if (m.from === 'brand') {
      typingSec = t;
      t += ant?.from === 'brand' ? DIGITANDO * 0.6 : DIGITANDO;
    } else if (i > 0) t += 0.3;
    const h = Math.ceil(alturaDaMensagem(m, ajustesDaMensagem(m, i, c.cta, language)));
    out.push({ atSec: Math.round(t * 1000) / 1000, typingSec: typingSec === null ? null : Math.round(typingSec * 1000) / 1000, y, h });
    y += h + CHAT_GEO.gap + (c.messages[i + 1] && c.messages[i + 1].from !== m.from ? 14 : 0);
    t += leituraSec(m);
  });
  const closeAtSec = Math.round((t + 0.1) * 1000) / 1000;
  return { messages: out, closeAtSec, endSec: Math.round((closeAtSec + CHAT_CLOSE_SEC) * 1000) / 1000 };
};

/** Todos os textos do chat ajustados (o build confere `naoCouberam`; a composição desenha com os mesmos). */
export const chatLayout = (c: ChatIn, language: string): TemplateFit[] => [
  ...hookFits(c.hook.text, language),
  fitTemplateText('chrome.profileStatus', c.chrome.profileStatus, { font: 'inter-600', width: 640, maxLines: 1, max: 34, language }),
  fitTemplateText('chrome.typing', c.chrome.typing, { font: 'inter-600', width: 640, maxLines: 1, max: 30, min: 36, language }),
  fitTemplateText('chrome.inputPlaceholder', c.chrome.inputPlaceholder, { font: 'inter-600', width: TEMPLATE_W - 72 - 80, maxLines: 1, max: 36, language }),
  ...c.messages.flatMap((m, i) => ajustesDaMensagem(m, i, c.cta, language)),
  ...c.close.lines.map((l, k) => fitTemplateText(`close.lines.${k}`, l, { font: 'montserrat-900', width: TEMPLATE_W - 120, maxLines: 2, max: 84, min: 44, lineHeight: 1.1, language })),
  ...ctaFits('cta', c.cta, language),
  ...proofFits('proof', c.proof, language),
];

/** Geometria da cena final do chat (linhas da promessa, prova, CTA, nota): a composição e o build usam a mesma conta. */
export const fechoChatGeo = (hLinhas: number[], nProof: number, hNota: number | null) => {
  const topoLinhas = TEMPLATE_SAFE.top + 70;
  const topoProva = topoLinhas + hLinhas.reduce((s, h) => s + h + 10, 0) + 40;
  const topoCta = topoProva + nProof * (PROOF_ROW.h + 22) + 30;
  const topoNota = topoCta + 170;
  const fim = hNota !== null ? topoNota + hNota : topoCta + 140;
  return { topoLinhas, topoProva, topoCta, topoNota, fim, cabe: fim <= TEMPLATE_H - TEMPLATE_SAFE.bottom };
};

/** Manchete fixa do topo (2 linhas, como o protótipo). */
export const hookFits = (text: string, language: string): TemplateFit[] => [
  fitTemplateText('hook', text, { font: 'montserrat-900', width: TEMPLATE_W - 100, maxLines: 2, max: 72, min: 40, lineHeight: 1.12, language }),
];
export const ctaFits = (slot: string, cta: ChatDmProps['cta'], language: string): TemplateFit[] => [
  fitTemplateText(`${slot}.button`, cta.button, { font: 'inter-800', width: 640, maxLines: 1, max: 54, min: 36, language }),
  ...(cta.note ? [fitTemplateText(`${slot}.note`, cta.note, { font: 'inter-600', width: TEMPLATE_W - 160, maxLines: 2, max: 38, language })] : []),
];
/** Prova: 1 linha por número (cartão largo: número à esquerda, rótulo à direita). */
export const PROOF_ROW = { w: 900, h: 190, numW: 330, labelW: 900 - 330 - 150 } as const;
export const proofFits = (slot: string, proof: ProofStat[], language: string): TemplateFit[] => proof.flatMap((p, i) => [
  fitTemplateText(`${slot}.${i}.value`, formatarNumero(p), { font: 'montserrat-900', width: PROOF_ROW.numW, maxLines: 1, max: 96, min: 48, language }),
  fitTemplateText(`${slot}.${i}.label`, p.label, { font: 'inter-800', width: PROOF_ROW.labelW, maxLines: 3, max: 44, min: 36, language }),
]);
/** Número exibido no fim da contagem (prefixo + valor + sufixo; milhar com vírgula, como no Brain). */
export const formatarNumero = (p: ProofStat, v = p.value) => `${p.prefix}${p.decimals > 0 ? v.toFixed(p.decimals) : Math.round(v).toLocaleString('en-US')}${p.suffix}`;

// ───────────────────────── person-motion: geometria ─────────────────────────

/** Palco (em cima), legenda (no meio) e rosto (embaixo), tudo dentro da área livre. */
export const PERSON_GEO = {
  stage: { x: 0, y: TEMPLATE_SAFE.top, w: TEMPLATE_W, h: 980 },
  caption: { x: 60, y: TEMPLATE_SAFE.top + 980 + 14, w: TEMPLATE_W - 120, h: 150 },
  face: { d: 420 },
} as const;
export const PERSON_FACE_BOX = {
  x: (TEMPLATE_W - PERSON_GEO.face.d) / 2, y: TEMPLATE_H - TEMPLATE_SAFE.bottom - PERSON_GEO.face.d - 12, w: PERSON_GEO.face.d, h: PERSON_GEO.face.d,
} as const;

type Box = { x: number; y: number; w: number; h: number };
type FaceSeg = { startFrame: number; endFrame: number; region: Box; faceInRegion: { atFrame: number; box: Box }[]; role?: string };
export interface FaceMapLike {
  width: number; height: number; fps?: number; frameCount: number; faceTrack: FaceSeg[];
  /** camadas de texto queimado do editMap (headline, text, caption…); só as que não são `caption` entram aqui (a legenda vem
   *  das faixas protegidas) */
  layers?: { kind?: string; box: Box; startFrame: number; endFrame: number }[];
}
/** Textos queimados que não são legenda (headline, texto solto), em px do arquivo, com 2 % de folga. */
export const textosQueimados = (source: { width: number; height: number }, m: FaceMapLike | null): Faixa[] => {
  if (!m?.layers?.length) return [];
  const ex = source.width / m.width, ey = source.height / m.height, fps = m.fps ?? 30;
  const f = 0.02 * source.height;
  return m.layers.filter((l) => l.kind !== 'caption' && l.endFrame > l.startFrame).map((l) => ({
    x: l.box.x * ex, y: Math.max(0, l.box.y * ey - f), w: l.box.w * ex, h: l.box.h * ey + 2 * f, startSec: l.startFrame / fps, endSec: l.endFrame / fps,
  }));
};
/** Faixa protegida (legenda queimada) em px do arquivo, com o intervalo (legendaProtegida). */
type Faixa = { x: number; y: number; w: number; h: number; startSec: number; endSec: number };

const cruzaBox = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Rosto principal (px do arquivo) num intervalo [a, b) s: média ponderada dos trechos `main` que cruzam o intervalo. */
export const rostoNoTrecho = (source: { width: number; height: number }, m: FaceMapLike | null, a: number, b: number): Box | null => {
  if (!m) return null;
  const fps = m.fps ?? 30;
  const ex = source.width / m.width, ey = source.height / m.height;
  const segs = m.faceTrack.filter((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length);
  const em = (sg: FaceSeg[]) => {
    let cx = 0, cy = 0, w = 0, h = 0, n = 0;
    for (const s of sg) {
      const ov = Math.min(b * fps, s.endFrame) - Math.max(a * fps, s.startFrame);
      const p = Math.max(1, ov);
      const f = s.faceInRegion[0].box;
      cx += (s.region.x + (f.x + f.w / 2) * s.region.w) * ex * p; cy += (s.region.y + (f.y + f.h / 2) * s.region.h) * ey * p;
      w += f.w * s.region.w * ex * p; h += f.h * s.region.h * ey * p; n += p;
    }
    return n ? { x: cx / n - w / n / 2, y: cy / n - h / n / 2, w: w / n, h: h / n } : null;
  };
  const dentro = segs.filter((s) => s.endFrame > a * fps && s.startFrame < b * fps);
  return em(dentro.length ? dentro : segs);
};

/** Fração do vídeo com o rosto principal no faceTrack (regra do `allowedFor`: ≥ 40 %). */
export const fracaoComRosto = (m: FaceMapLike | null): number => {
  if (!m?.frameCount) return 0;
  const segs = m.faceTrack.filter((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length && s.endFrame > s.startFrame).sort((x, y) => x.startFrame - y.startFrame);
  let total = 0, fim = -1;
  for (const s of segs) {
    const a = Math.max(s.startFrame, fim);
    if (s.endFrame > a) total += s.endFrame - a;
    fim = Math.max(fim, s.endFrame);
  }
  return Math.min(1, total / m.frameCount);
};

export type PersonLayout =
  | { mode: 'ok'; faceBox: PersonMotionProps['faceBox'] }
  | { mode: 'blocked'; reason: 'no_face' | 'caption_in_face'; hits: { spanIndex: number; atSec: number }[] };

/**
 * Caixa do rosto (F1.4 `personMotionLayout`): por trecho, a janela QUADRADA do campeão centrada no rosto (o rosto ocupa
 * ~55 % da altura da caixa), presa ao quadro. A legenda queimada do campeão (faixa protegida) não pode aparecer dentro
 * da caixa: a janela sobe/desce até sair dela sem perder o rosto; não deu = `blocked` (CAPTION_PROTECTED no build).
 */
export const personMotionLayout = (
  source: { width: number; height: number },
  m: FaceMapLike | null,
  timeline: { startSec: number; endSec: number }[],
  protectedBands: Faixa[] = [],
): PersonLayout => {
  const windows: Box[] = [];
  const hits: { spanIndex: number; atSec: number }[] = [];
  const lado = Math.min(source.width, source.height);
  for (let i = 0; i < timeline.length; i++) {
    const t = timeline[i];
    const r = rostoNoTrecho(source, m, t.startSec, t.endSec);
    if (!r) return { mode: 'blocked', reason: 'no_face', hits: [] };
    const base = Math.min(lado, Math.max(r.h / 0.55, r.w / 0.6, 160));
    // núcleo do rosto (olhos à boca): a caixa do detector inclui testa/cabelo e queixo; o close apertado do protótipo
    // aprovado (28/10) corta testa e queixo e nunca a boca
    const nucleo = { top: r.y + r.h * 0.1, bottom: r.y + r.h * 0.78 };
    const minimo = Math.min(lado, Math.max((nucleo.bottom - nucleo.top) * 1.05, r.w * 0.95));
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2 + r.h * 0.08;
    // outros textos queimados do campeão (headline, texto solto): nunca dentro da caixa do rosto (folga de 2 %)
    const textos = textosQueimados(source, m).filter((f) => f.startSec < t.endSec && f.endSec > t.startSec);
    const noTrecho = protectedBands.filter((f) => f.startSec < t.endSec && f.endSec > t.startSec);
    // 1ª tentativa com a faixa protegida inteira (com a folga); 2ª com a caixa MEDIDA da legenda (sem a folga vertical
    // FOLGA_V da legendaProtegida): a legenda queimada continua fora da caixa do rosto
    const semFolga = (f: Faixa): Faixa => {
      const fy = 0.04 * source.height;
      return { ...f, y: f.y + fy, h: Math.max(1, f.h - 2 * fy) };
    };
    // tamanhos: o ideal (rosto inteiro, ~55 % da caixa) e, sem lugar, fechando o enquadramento até o close do núcleo
    // (olhos à boca), como o protótipo aprovado. Posição: a mais perto do centro do rosto que não cruza nenhuma faixa.
    const tentar = (faixas: Faixa[]): Box | null => {
      for (let z = 0; z <= 8; z++) {
        const s = base - ((base - minimo) * z) / 8;
        const x = Math.min(source.width - s, Math.max(0, cx - s / 2));
        const precisa = z === 0 ? { top: r.y, bottom: r.y + r.h } : nucleo;
        const lo = Math.max(0, precisa.bottom - s), hi = Math.min(precisa.top, source.height - s);
        if (lo > hi + 0.5) continue;
        const y0 = Math.min(hi, Math.max(lo, cy - s / 2));
        const cruzamX = faixas.filter((f) => x < f.x + f.w && f.x < x + s);
        const cands = [y0, lo, hi, ...cruzamX.flatMap((f) => [f.y - s, f.y + f.h])].filter((y) => y >= lo - 0.5 && y <= hi + 0.5);
        const ok = cands.filter((y) => !cruzamX.some((f) => cruzaBox({ x, y: y + 0.01, w: s, h: s - 0.02 }, f))).sort((a, b) => Math.abs(a - y0) - Math.abs(b - y0));
        if (ok.length) return { x, y: Math.max(0, ok[0]), w: s, h: s };
      }
      return null;
    };
    const achou = tentar([...noTrecho, ...textos]) ?? tentar([...noTrecho.map(semFolga), ...textos]);
    if (!achou) { hits.push({ spanIndex: i, atSec: t.startSec }); continue; }
    windows.push({ x: Math.round(achou.x), y: Math.round(achou.y), w: Math.round(achou.w), h: Math.round(achou.h) });
  }
  if (hits.length) return { mode: 'blocked', reason: 'caption_in_face', hits };
  const w0 = windows[0];
  const focus = { x: Math.round(((w0.x + w0.w / 2) / source.width) * 1000) / 1000, y: Math.round(((w0.y + w0.h / 2) / source.height) * 1000) / 1000 };
  return { mode: 'ok', faceBox: { focus, box: { ...PERSON_FACE_BOX }, windows } };
};

/** Textos do palco ajustados (o build confere `naoCouberam`; a composição desenha com os mesmos). */
export const beatFits = (b: Pick<PersonBeatProps, 'kind'> & Record<string, unknown>, i: number, language: string): TemplateFit[] => {
  const W = TEMPLATE_W;
  const s = (k: string) => `beats.${i}.${k}`;
  switch (b.kind) {
    case 'kinetic':
      return (b.words as string[]).map((w, k) => fitTemplateText(s(`words.${k}`), w, { font: 'montserrat-900', width: W - 140, maxLines: 2, max: 116, min: 52, lineHeight: 1.06, language }));
    case 'wrong_right':
      return [
        fitTemplateText(s('wrong'), b.wrong as string, { font: 'inter-800', width: W - 140 - 120, maxLines: 2, max: 68, min: 40, language }),
        ...(b.right as string[]).map((r, k) => fitTemplateText(s(`right.${k}`), r, { font: 'inter-800', width: W - 140 - 110, maxLines: 2, max: 60, min: 36, language })),
      ];
    case 'steps':
      return (b.steps as string[]).map((r, k) => fitTemplateText(s(`steps.${k}`), r, { font: 'inter-800', width: 760, maxLines: 1, max: 60, min: 36, language }));
    case 'icon_list':
      return (b.items as { text: string }[]).map((it, k) => fitTemplateText(s(`items.${k}`), it.text, { font: 'inter-800', width: W - 140 - 150, maxLines: 2, max: 58, min: 36, language }));
    case 'badge':
      return [fitTemplateText(s('text'), b.text as string, { font: 'montserrat-900', width: W - 220, maxLines: 2, max: 96, min: 48, lineHeight: 1.06, language })];
    case 'cta':
      return ctaFits(s('cta'), { button: b.button as string, note: (b.note as string | null) ?? null }, language);
    default:
      return [];
  }
};
export const personLayout = (p: Pick<PersonMotionProps, 'beats' | 'endCard'>, language: string): TemplateFit[] => [
  ...p.beats.flatMap((b, i) => beatFits(b as never, i, language)),
  ...(p.endCard ? [...proofFits('endCard.proof', p.endCard.proof, language), ...ctaFits('endCard.cta', p.endCard.cta, language)] : []),
];

/** Altura (px) que cada cena do palco ocupa (pra conferir que cabe no palco). */
export const alturaDoBeat = (b: PersonBeatProps, fits: TemplateFit[]): number => {
  const hs = fits.map((f) => f.fit.height);
  const soma = (xs: number[], extra: number) => xs.reduce((a, x) => a + x + extra, 0);
  switch (b.kind) {
    case 'kinetic': return soma(hs, 24);
    case 'wrong_right': return hs[0] + 80 + 130 + soma(hs.slice(1), 40) + 70;
    case 'steps': return soma(hs.map((h) => h + 44), 0) + (hs.length - 1) * 70;
    case 'icon_list': return soma(hs.map((h) => Math.max(110, h + 40)), 26);
    case 'badge': return hs[0] + 60;
    case 'cta': return 140 + (hs[1] ? hs[1] + 40 : 0);
  }
};
/** Prova + CTA da cena final (px). */
export const alturaDoFim = (n: number, temNota: boolean) => n * (PROOF_ROW.h + 22) + 150 + (temNota ? 90 : 0);

/** Duração (frames) da peça a partir das props (igual ao `durationInFrames` que o builder calcula). */
export const duracaoTemplate = (p: TemplateProps): number => p.durationInFrames;
