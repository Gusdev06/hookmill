import { z } from 'zod';
import { FORMATOS, FPS, type VideoFormat } from './formatos';
import { trechosEmFrames, type EditMapLike } from './autoEdit';
import { corDeDestaque } from './cores';
import { METRIC_CHARS, METRIC_FONTS, METRIC_UNITS } from './metricas-fontes';
import { CJK_EXCECOES, CJK_UNITS } from './metricas-cjk';
import { captionsAutoSchema, outputProtectedBandSchema, protectedBandSchema } from './captionsSchema';

// Molduras de vídeo (contrato docs/contratos/estatico-montado-e-molduras-v1.md §B2-§B4). Puro (sem React): a composição
// `Moldura` (src/molduras/) e o buildFrameInput da API usam as mesmas funções. Promovido do protótipo aprovado em 25/10
// (src/prototipos/molduras/, que fica intocado como referência visual).
//
// Diferenças em relação ao §B2 do contrato (o arquiteto fecha os tipos em contratos/src/iteracao.ts; até lá, locais):
// 1. `story` existe aqui (o protótipo aprovado tem 18; o contrato lista 17). Entra em FRAME_IDS_EXTRA.
// 2. Campos de texto além do contrato: gossip_page.pageName; call {title, slideTitle, slideSteps}; call_dialog
//    {title, names}; story {question, headline, support, copy}. Limites locais em TEXT_LIMITS.
// 3. Marcação de destaque: trecho entre *asteriscos* sai na cor de destaque do template; os limites contam sem os *.
// 4. `frameLayout(id, format, texts, language)`: recebe os textos (news, pov, post_card, direct_offer e call encaixam o
//    vídeo no espaço que o texto deixa; sem isso sobra vão).
// 5. `face` (rosto redondo) é campo próprio, não um `second`: as fofocas usam `second` (2º vídeo) E `face` ao mesmo tempo.
//    `second.kind: 'clip'` (outro arquivo de vídeo) é local, pra fixture e pro Meet diálogo com 2ª pessoa de outro take.
// 6. `reframe.contain_blur` aceita `focus` opcional (onde fica o rosto, pra ancorar o vídeo inteiro na caixa sem colar a
//    testa no topo). Sem `focus`, igual ao AutoEdit (centrado).

// ───────────────────────── ids ─────────────────────────

export const FRAME_COMPOSITION_ID = 'Moldura';
export const FRAME_TEMPLATE_ID = 'frame';

export const FRAME_IDS_F1 = ['question_box', 'meme', 'cinema', 'news', 'read_caption', 'pov_testimonial', 'direct_offer', 'live', 'ranking', 'post_card'] as const;
export const FRAME_IDS_F2 = ['split_stack', 'split_torn', 'call', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'] as const;
export const FRAME_IDS_EXTRA = ['story'] as const;
export const FRAME_IDS = [...FRAME_IDS_F1, ...FRAME_IDS_F2, ...FRAME_IDS_EXTRA] as const;
export type FrameTemplateId = (typeof FRAME_IDS)[number];
/** = FrameTemplateId (nome do protótipo); o teste de tipo da API prova que é igual ao FrameTemplateId do @maquina/contratos. */
export type MolduraId = FrameTemplateId;
/** Templates que precisam de 2ª fonte (`second`); sem ela o 2º quadro repete o campeão 12 s à frente. */
export const FRAME_NEEDS_SECOND: readonly FrameTemplateId[] = ['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'];
/** Templates que mostram o rosto redondo (`face`). */
export const FRAME_USES_FACE: readonly FrameTemplateId[] = ['question_box', 'live', 'gossip_page', 'gossip_white'];

// ───────────────────────── textos ─────────────────────────

/** Limites (caracteres sem os * de destaque). Contrato §B2 + locais (marcados). */
export const TEXT_LIMITS = {
  question_box: { question: 70 },
  meme: { pov: 70, cta: 28 },
  cinema: { question: 60, subtitle: 80 },
  news: { topic: 18, lead: 40, highlight: 30, dek: 80, cta: 28 },
  read_caption: { headline: 70, primaryText: 600 },
  pov_testimonial: { pov: 80, cta: 28 },
  direct_offer: { promise: 40, price: 16, cta: 28 },
  ranking: { title: 24, item: 28, itemsMin: 3, itemsMax: 5 },
  post_card: { copy: 140 },
  split_stack: { headline: 50 },
  split_torn: { headline: 50 },
  gossip_page: { headline: 80, pageName: 24 /* local */ },
  gossip_white: { headline: 80 },
  gossip_pink: { headline: 80 },
  call: { title: 40, slideTitle: 40, step: 30, stepsMin: 2, stepsMax: 3 } /* local */,
  call_dialog: { title: 40, name: 14 } /* local (= contrato) */,
  story: { question: 70, headline: 40, support: 70, copy: 300 } /* local */,
} as const;

/** Tamanho visível (sem a marcação *destaque*). */
export const textoVisivel = (s: string) => s.replace(/\*/g, '');
const txt = (max: number) => z.string().min(1).refine((s) => textoVisivel(s).trim().length > 0 && textoVisivel(s).length <= max, { message: `até ${max} caracteres` });

const L = TEXT_LIMITS;
export const frameTextsSchemas = {
  question_box: z.object({ question: txt(L.question_box.question) }),
  meme: z.object({ pov: txt(L.meme.pov), cta: txt(L.meme.cta) }),
  cinema: z.object({ question: txt(L.cinema.question), subtitle: txt(L.cinema.subtitle) }),
  news: z.object({ topic: txt(L.news.topic), headline: z.object({ lead: txt(L.news.lead), highlight: txt(L.news.highlight) }), dek: txt(L.news.dek), cta: txt(L.news.cta) }),
  read_caption: z.object({ headline: txt(L.read_caption.headline), primaryText: txt(L.read_caption.primaryText) }),
  pov_testimonial: z.object({ pov: txt(L.pov_testimonial.pov), cta: txt(L.pov_testimonial.cta) }),
  direct_offer: z.object({ promise: txt(L.direct_offer.promise), price: z.object({ from: txt(L.direct_offer.price).nullable(), to: txt(L.direct_offer.price) }), cta: txt(L.direct_offer.cta) }),
  live: z.object({}).strict(),
  ranking: z.object({ title: txt(L.ranking.title), items: z.array(txt(L.ranking.item)).min(L.ranking.itemsMin).max(L.ranking.itemsMax) }),
  post_card: z.object({ copy: txt(L.post_card.copy) }),
  split_stack: z.object({ headline: txt(L.split_stack.headline) }),
  split_torn: z.object({ headline: txt(L.split_torn.headline) }),
  gossip_page: z.object({ headline: txt(L.gossip_page.headline), pageName: txt(L.gossip_page.pageName) }),
  gossip_white: z.object({ headline: txt(L.gossip_white.headline) }),
  gossip_pink: z.object({ headline: txt(L.gossip_pink.headline) }),
  call: z.object({ title: txt(L.call.title), slideTitle: txt(L.call.slideTitle), slideSteps: z.array(txt(L.call.step)).min(L.call.stepsMin).max(L.call.stepsMax) }),
  call_dialog: z.object({ title: txt(L.call_dialog.title), names: z.tuple([txt(L.call_dialog.name), txt(L.call_dialog.name)]) }),
  story: z.object({ question: txt(L.story.question), headline: txt(L.story.headline), support: txt(L.story.support), copy: txt(L.story.copy) }),
} satisfies Record<FrameTemplateId, z.ZodTypeAny>;

export type FrameTextsMap = { [K in FrameTemplateId]: z.infer<(typeof frameTextsSchemas)[K]> };
export type FrameTexts = FrameTextsMap[FrameTemplateId];

/** Textos fixos de interface (constantes do template, não saem da IA). pt, en, es, zh (TW/HK = tradicional; resto =
 *  simplificado), ja, ko (decisão do Gusta, 25/10); outro idioma = en. */
export const FRAME_UI = {
  pt: { askQuestion: 'Faça uma pergunta', readCaption: 'Leia a legenda', tapButton: 'Toque no botão', live: 'AO VIVO', comments: 'Comentários limitados', pov: 'POV:', povTitle: 'Pov:', from: 'De', only: 'Por apenas', now: 'agora', exclusive: 'EXCLUSIVO', gossip: 'FOFOCA!', ranking: 'RANKING', top: 'TOP', guest: 'Convidado', timeAgo: '2h' },
  en: { askQuestion: 'Ask me a question', readCaption: 'Read the caption', tapButton: 'Tap the button', live: 'LIVE', comments: 'Comments limited', pov: 'POV:', povTitle: 'Pov:', from: 'Was', only: 'Now only', now: 'now', exclusive: 'EXCLUSIVE', gossip: 'GOSSIP!', ranking: 'RANKING', top: 'TOP', guest: 'Guest', timeAgo: '2h' },
  es: { askQuestion: 'Hazme una pregunta', readCaption: 'Lee la descripción', tapButton: 'Toca el botón', live: 'EN VIVO', comments: 'Comentarios limitados', pov: 'POV:', povTitle: 'Pov:', from: 'Antes', only: 'Por solo', now: 'ahora', exclusive: 'EXCLUSIVO', gossip: '¡CHISME!', ranking: 'RANKING', top: 'TOP', guest: 'Invitado', timeAgo: '2 h' },
  zhHant: { askQuestion: '問我任何問題', readCaption: '請看貼文說明', tapButton: '點擊按鈕', live: '直播', comments: '留言功能已限制', pov: 'POV：', povTitle: 'POV：', from: '原價', only: '現在只要', now: '剛剛', exclusive: '獨家', gossip: '八卦！', ranking: '排行榜', top: 'TOP', guest: '來賓', timeAgo: '2 小時' },
  zhHans: { askQuestion: '问我任何问题', readCaption: '请看文案说明', tapButton: '点击按钮', live: '直播', comments: '评论功能已限制', pov: 'POV：', povTitle: 'POV：', from: '原价', only: '现在只要', now: '刚刚', exclusive: '独家', gossip: '八卦！', ranking: '排行榜', top: 'TOP', guest: '嘉宾', timeAgo: '2 小时' },
  ja: { askQuestion: '質問してね', readCaption: 'キャプションを読んでね', tapButton: 'ボタンをタップ', live: 'ライブ', comments: 'コメントは制限されています', pov: 'POV：', povTitle: 'POV：', from: '通常価格', only: '今だけ', now: 'たった今', exclusive: '独占', gossip: 'ゴシップ！', ranking: 'ランキング', top: 'TOP', guest: 'ゲスト', timeAgo: '2時間前' },
  ko: { askQuestion: '무엇이든 물어보세요', readCaption: '캡션을 확인하세요', tapButton: '버튼을 누르세요', live: '라이브', comments: '댓글이 제한되었습니다', pov: 'POV:', povTitle: 'POV:', from: '정가', only: '지금 단', now: '방금', exclusive: '단독', gossip: '가십!', ranking: '랭킹', top: 'TOP', guest: '게스트', timeAgo: '2시간' },
} as const;
export type FrameUi = { [K in keyof (typeof FRAME_UI)['pt']]: string };
export const frameUi = (language: string): FrameUi => {
  const full = language.toLowerCase();
  const l = full.slice(0, 2);
  if (l === 'zh') return /(-tw|-hk|-mo|hant)/.test(full) ? FRAME_UI.zhHant : FRAME_UI.zhHans;
  return l === 'pt' ? FRAME_UI.pt : l === 'es' ? FRAME_UI.es : l === 'ja' ? FRAME_UI.ja : l === 'ko' ? FRAME_UI.ko : FRAME_UI.en;
};

// ───────────────────────── medida de texto ─────────────────────────

export type FrameFontKey = keyof typeof METRIC_FONTS;
/** Família (a carregada em src/fontes.ts) e peso de cada chave da tabela. */
export const FRAME_FONTS: Record<FrameFontKey, { family: string; weight: number }> = {
  'inter-600': { family: 'MaquinaInter', weight: 600 },
  'inter-800': { family: 'MaquinaInter', weight: 800 },
  'montserrat-800': { family: 'MaquinaMontserrat', weight: 800 },
  'montserrat-900': { family: 'MaquinaMontserrat', weight: 900 },
  'anton-400': { family: 'MaquinaAnton', weight: 400 },
  'archivo-black-400': { family: 'MaquinaArchivoBlack', weight: 400 },
};

type Tabela = { ln: number; asc: number; desc: number; adv: Map<string, number>; kern: Map<string, number> };
const tabelas = new Map<FrameFontKey, Tabela>();
const tabela = (f: FrameFontKey): Tabela => {
  let t = tabelas.get(f);
  if (!t) {
    const m = METRIC_FONTS[f];
    const adv = new Map<string, number>();
    [...METRIC_CHARS].forEach((c, i) => adv.set(c, m.adv[i]));
    const kern = new Map<string, number>();
    for (const e of m.kern.split('\u0001')) if (e.length > 2) kern.set(e.slice(0, 2), Number(e.slice(2)));
    t = { ln: m.ln, asc: m.asc, desc: m.desc, adv, kern };
    tabelas.set(f, t);
  }
  return t;
};
const base = (c: string) => c.normalize('NFD')[0] ?? c;
const avanco = (t: Tabela, c: string) => t.adv.get(c) ?? t.adv.get(base(c)) ?? t.adv.get('M')!;
const parKern = (t: Tabela, a: string, b: string) => t.kern.get(a + b) ?? t.kern.get(base(a) + base(b)) ?? 0;

// ── CJK (zh/ja/ko): glifos das Noto Sans TC/SC/JP/KR (src/fontes-cjk.ts), registradas por baixo de cada família latina
// com unicode-range só CJK. A fonte latina não tem esses glifos; o caractere CJK cai no pedaço Noto do mesmo peso.
export type CjkFont = 'tc' | 'sc' | 'jp' | 'kr';
/** Qual Noto usar pelo idioma da tela: zh-TW/HK/MO/Hant = TC; outro zh = SC; ja = JP; ko = KR; resto = TC (só fallback). */
export const cjkDe = (language: string): CjkFont => {
  const l = language.toLowerCase();
  if (l.startsWith('ja')) return 'jp';
  if (l.startsWith('ko')) return 'kr';
  if (l.startsWith('zh')) return /(-tw|-hk|-mo|hant)/.test(l) ? 'tc' : 'sc';
  return 'tc';
};
/** Peso da Noto que cobre cada fonte latina (600 pro texto corrido, 900 pros títulos e display). */
export const PESO_CJK: Record<FrameFontKey, 600 | 900> = {
  'inter-600': 600, 'inter-800': 900, 'montserrat-800': 900, 'montserrat-900': 900, 'anton-400': 900, 'archivo-black-400': 900,
};
/** Caractere CJK (ideograma, kana, hangul, pontuação/formas de largura cheia): a medida e a quebra mudam. */
export const ehCJK = (cp: number) =>
  (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3ffff);
const ehHangul = (cp: number) => (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f) || (cp >= 0xac00 && cp <= 0xd7ff);
export const temCJK = (s: string) => { for (const c of s) if (ehCJK(c.codePointAt(0)!)) return true; return false; };
const larguraCJK = (font: FrameFontKey, cp: number, cjk: CjkFont) => {
  const exc = CJK_EXCECOES[cjk][PESO_CJK[font]];
  let lo = 0, hi = exc.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (cp < exc[m][0]) hi = m - 1; else if (cp > exc[m][1]) lo = m + 1; else return exc[m][2];
  }
  return CJK_UNITS;
};

/** Largura em px (tabela medida no Chrome do render: mesma resposta em Node e no navegador). Igual ao span com
 *  white-space: pre, letter-spacing em `em` (o navegador soma depois de cada caractere, inclusive o último).
 *  Caractere CJK que a fonte latina não tem = largura do glifo da Noto `cjk` no peso correspondente, sem kerning. */
export const medirTexto = (font: FrameFontKey, text: string, size: number, letterSpacingEm = 0, cjk: CjkFont = 'tc'): number => {
  const t = tabela(font);
  const cs = [...text];
  let w = 0;
  let antCJK = false;
  for (let i = 0; i < cs.length; i++) {
    const cp = cs[i].codePointAt(0)!;
    const cjkAqui = !t.adv.has(cs[i]) && ehCJK(cp);
    if (cjkAqui) w += larguraCJK(font, cp, cjk) * (METRIC_UNITS / CJK_UNITS);
    else {
      w += avanco(t, cs[i]);
      if (i && !antCJK) w += parKern(t, cs[i - 1], cs[i]);
    }
    antCJK = cjkAqui;
  }
  return (w * size) / METRIC_UNITS + cs.length * letterSpacingEm * size;
};
/** Altura de 1 linha com line-height normal (px): o Chrome arredonda ascendente e descendente separadamente. */
export const alturaLinhaNormal = (font: FrameFontKey, size: number) => { const t = tabela(font); return Math.round(t.asc * size) + Math.round(t.desc * size); };

/** Tamanho mínimo de texto ajustado na saída de 1080 de largura (§B2). */
export const FRAME_MIN_FONT_PX = 36;

export interface FitTextOptions {
  font: FrameFontKey; width: number; maxLines: number; max: number; min: number;
  lineHeight?: number; uppercase?: boolean; letterSpacingEm?: number; step?: number;
  /** Noto do idioma (cjkDe(language)); só pesa se o texto tiver CJK */
  cjk?: CjkFont;
}
export interface FittedText {
  /** texto original (com a marcação *destaque*) */
  text: string; size: number; lineHeight: number; lines: string[];
  /** false = nem no mínimo coube em maxLines (ou uma palavra não cabe na largura): FRAME_TEXT_OVERFLOW no buildFrameInput.
   *  A composição desenha mesmo assim, no mínimo, quebrando a palavra se preciso: nunca corta. */
  fits: boolean; overflow: null | 'lines' | 'word'; height: number;
  /** Texto com CJK: [início, fim) de cada linha no texto visível (sem os *). A composição desenha linha a linha (a quebra
   *  CJK é nossa, não a do navegador). Ausente = texto latino, o navegador quebra (igual ao protótipo aprovado). */
  ranges?: [number, number][];
}

/** Altura de N linhas como o Chrome calcula (line-height guardado em LayoutUnit de 1/64 px, truncado). */
const alturaLinhas = (n: number, size: number, lh: number) => n * (Math.floor(size * lh * 64) / 64);

/** Quebra gulosa por palavra em `width` (px). Palavra maior que a linha é partida por caractere (marcada). */
const quebrar = (palavras: string[], cabe: (t: string) => boolean) => {
  const linhas: string[] = [];
  let atual = '';
  let partiu = false;
  for (const p of palavras) {
    const tentativa = atual ? `${atual} ${p}` : p;
    if (cabe(tentativa)) { atual = tentativa; continue; }
    if (atual) linhas.push(atual);
    if (cabe(p)) { atual = p; continue; }
    partiu = true;
    let pedaco = '';
    for (const c of p) { if (cabe(pedaco + c) || !pedaco) pedaco += c; else { linhas.push(pedaco); pedaco = c; } }
    atual = pedaco;
  }
  if (atual) linhas.push(atual);
  return { linhas, partiu };
};

// Quebra CJK: ideograma/kana = 1 unidade (quebra entre quaisquer dois); latino e hangul = palavra (quebra no espaço;
// coreano usa espaço entre palavras). Regras básicas (kinsoku): pontuação de fechamento não começa linha, abertura não
// termina linha.
const NAO_INICIA = new Set([...'，。、．・：；！？）」』】》〉〕｝〙〗’”…‥ー々〜～ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ%％,.!?:;)]}']);
const NAO_TERMINA = new Set([...'（「『【《〈〔｛〘〖‘“([{']);
type Unidade = { a: number; b: number; espaco: boolean };
const unidadesCJK = (s: string): Unidade[] => {
  const u: Unidade[] = [];
  let palavra: Unidade | null = null;
  let pos = 0;
  const fecha = () => { if (palavra) { u.push(palavra); palavra = null; } };
  for (const ch of s) {
    const a = pos;
    pos += ch.length;
    if (/\s/.test(ch)) { fecha(); u.push({ a, b: pos, espaco: true }); continue; }
    const cp = ch.codePointAt(0)!;
    if (ehCJK(cp) && !ehHangul(cp)) { fecha(); u.push({ a, b: pos, espaco: false }); continue; }
    if (palavra) palavra.b = pos; else palavra = { a, b: pos, espaco: false };
  }
  fecha();
  // kinsoku: junta fechamento ao anterior e abertura ao seguinte (sem espaço no meio)
  const out: Unidade[] = [];
  for (const x of u) {
    const ant = out[out.length - 1];
    if (!x.espaco && ant && !ant.espaco && (NAO_INICIA.has(s.slice(x.a, x.b)[0]) || NAO_TERMINA.has(s.slice(ant.a, ant.b).slice(-1)))) ant.b = x.b;
    else out.push({ ...x });
  }
  return out;
};
const quebrarCJK = (s: string, cabe: (t: string) => boolean) => {
  const ranges: [number, number][] = [];
  let partiu = false;
  let ini = -1, fim = -1; // linha atual [ini, fim) sem espaço nas pontas
  const fechar = () => { if (ini >= 0) ranges.push([ini, fim]); ini = fim = -1; };
  for (const x of unidadesCJK(s)) {
    if (x.espaco) continue; // o espaço entra no slice da linha se ficar no meio
    if (ini < 0) { ini = x.a; fim = x.b; } else if (cabe(s.slice(ini, x.b))) fim = x.b; else { fechar(); ini = x.a; fim = x.b; }
    if (!cabe(s.slice(ini, fim))) {
      // unidade maior que a linha: parte por caractere
      partiu = true;
      let a = ini;
      for (let p = ini; p < fim;) {
        const n = s.codePointAt(p)! > 0xffff ? 2 : 1;
        if (p > a && !cabe(s.slice(a, p + n))) { ranges.push([a, p]); a = p; }
        p += n;
      }
      ini = a;
    }
  }
  fechar();
  return { linhas: ranges.map(([a, b]) => s.slice(a, b)), ranges, partiu };
};

/**
 * Maior tamanho (de max até min, passo 2) em que o texto cabe em `width` com até `maxLines` linhas, quebra gulosa por
 * palavra (= a do navegador com a mesma medida). Mesmo algoritmo do `tamanhoQueCabe` do protótipo aprovado; mínimo
 * nunca abaixo de FRAME_MIN_FONT_PX. Não coube: devolve o mínimo, com as linhas que ele precisar e `fits: false`.
 */
export const fitText = (text: string, o: FitTextOptions): FittedText => {
  const lh = o.lineHeight ?? 1.12;
  let min = Math.max(o.min, FRAME_MIN_FONT_PX);
  const max = Math.max(o.max, min);
  const visivel = textoVisivel(text);
  const corpo = o.uppercase ? visivel.toUpperCase() : visivel;
  const cabe = (s: number) => (t: string) => medirTexto(o.font, t, s, o.letterSpacingEm, o.cjk) <= o.width;
  // CJK: quebra nossa por caractere/palavra, com as linhas desenhadas uma a uma (corpo e visível com o mesmo tamanho).
  // Os limites do contrato são em caracteres (calibrados no latino); o ideograma tem largura cheia (~2 letras), então
  // em CJK o mínimo do template cai pro mínimo geral de 36 px (legível; CJK é denso).
  const cjk = temCJK(corpo) && corpo.length === visivel.length;
  if (cjk) min = FRAME_MIN_FONT_PX;
  const palavras = corpo.split(/\s+/).filter(Boolean);
  const tentar = (s: number): { linhas: string[]; partiu: boolean; ranges?: [number, number][] } => (cjk ? quebrarCJK(corpo, cabe(s)) : quebrar(palavras, cabe(s)));
  for (let s = max; s >= min; s -= o.step ?? 2) {
    const r = tentar(s);
    if (!r.partiu && r.linhas.length <= o.maxLines) {
      return { text, size: s, lineHeight: lh, lines: r.linhas, fits: true, overflow: null, height: alturaLinhas(r.linhas.length, s, lh), ...(r.ranges && { ranges: r.ranges }) };
    }
  }
  const r = tentar(min);
  return { text, size: min, lineHeight: lh, lines: r.linhas, fits: false, overflow: r.partiu ? 'word' : 'lines', height: alturaLinhas(r.linhas.length, min, lh), ...(r.ranges && { ranges: r.ranges }) };
};

// ───────────────────────── reenquadramento na caixa ─────────────────────────
// Decisões do Gusta (25/10, teste live): (1) só a área do vídeo real do campeão (`contentBox`: sem as faixas pretas
// do letterbox nem a headline queimada nelas); (2) nada de borda borrada: o vídeo PREENCHE a caixa (cover) centrado no
// rosto, com um zoom máximo que não corta o rosto; no caso extremo sobra fundo sólido na cor da marca; (3) o texto da
// moldura não fica por cima de legenda queimada (`burnedTextBands`, ver frameLayout).

export type Rect = { x: number; y: number; w: number; h: number };
export type Focus = { x: number; y: number };
/** cover: `focus` (0-1 da contentBox) é o centro da janela; `scale` (≤ 1) = fração do zoom de cover (o rosto não coube:
 *  sobra fundo na cor da marca). `contain_blur` = legado (inputs antigos): vira o vídeo inteiro sobre a cor da marca. */
export type FrameReframe = { mode: 'cover'; focus: Focus; scale?: number } | { mode: 'contain_blur'; focus?: Focus };

/** Rosto principal (px do arquivo): mediana dos trechos `main` do faceTrack, ponderada pela duração. */
export const rostoPrincipal = (source: { width: number; height: number }, m: EditMapLike | null): { cx: number; cy: number; w: number; h: number } | null => {
  const segs = (m?.faceTrack ?? []).filter((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length);
  if (!segs.length || !m) return null;
  const ex = source.width / m.width, ey = source.height / m.height;
  let cx = 0, cy = 0, w = 0, h = 0, n = 0;
  for (const s of segs) {
    const f = s.faceInRegion[0].box;
    const p = Math.max(1, s.endFrame - s.startFrame);
    cx += (s.region.x + (f.x + f.w / 2) * s.region.w) * ex * p;
    cy += (s.region.y + (f.y + f.h / 2) * s.region.h) * ey * p;
    w += f.w * s.region.w * ex * p; h += f.h * s.region.h * ey * p; n += p;
  }
  return { cx: cx / n, cy: cy / n, w: w / n, h: h / n };
};

/** Onde o rosto fica na caixa (fração da altura, de cima): sobra testa, sem colar no topo. */
export const ROSTO_ALTURA_ALVO = 0.4;
/** Quanto da caixa do rosto (detector: testa ao queixo, com cabelo) precisa caber: 0,92 = aceita aparar 4 % em cima e
 *  embaixo (cabelo/queixo), nunca olhos e boca. */
export const ROSTO_FOLGA = 0.92;
/** Zoom limitado pelo rosto só vale abaixo disto (fração do cover); acima, cover cheio (aparar um pouco é melhor que
 *  faixa de cor). Faixa na cor da marca = caso extremo. */
export const ESCALA_MIN_COM_FAIXA = 0.85;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Área do vídeo real dentro do campeão (px do arquivo): a célula `mainSpeaker` do editMap (letterbox) ou, sem ela, a
 *  maior célula das grades; null = o quadro inteiro. Deixa de fora faixas pretas e a headline queimada nelas. */
export const contentBoxDe = (source: { width: number; height: number }, m: (EditMapLike & { mainSpeaker?: { box: Rect } | null; cells?: { cells: Rect[] }[] }) | null): Rect | null => {
  if (!m) return null;
  const ex = source.width / m.width, ey = source.height / m.height;
  let b: Rect | null = m.mainSpeaker?.box ?? null;
  if (!b && m.cells?.length) for (const g of m.cells) for (const c of g.cells) if (!b || c.w * c.h > b.w * b.h) b = c;
  if (!b) return null;
  const r = { x: Math.round(b.x * ex), y: Math.round(b.y * ey), w: Math.round(b.w * ex), h: Math.round(b.h * ey) };
  return r.w >= source.width * 0.98 && r.h >= source.height * 0.98 ? null : r;
};

/** Faixas de texto queimado DENTRO da área do vídeo (legenda, texto solto), px do arquivo, com o intervalo em que aparecem. */
export type BurnedBand = { y: number; h: number; startSec: number; endSec: number };
export const faixasQueimadasDe = (source: { width: number; height: number }, m: (EditMapLike & { fps?: number; layers: { box: Rect; startFrame: number; endFrame: number; kind?: string; style?: { fontSizePx?: number; lineHeight?: number } }[] }) | null, contentBox: Rect | null): BurnedBand[] => {
  if (!m) return [];
  const ex = source.width / m.width, ey = source.height / m.height, fps = m.fps ?? 30;
  const cb = contentBox ?? { x: 0, y: 0, w: source.width, h: source.height };
  type Camada = { box: Rect; startFrame: number; endFrame: number; kind?: string; style?: { fontSizePx?: number; lineHeight?: number } };
  return (m.layers as Camada[])
    .map((l) => {
      // legenda queimada muda de altura ao longo do vídeo (1 ou 2 linhas por página) e a visão costuma medir uma página
      // de 1 linha: a faixa ganha 1 linha do tamanho medido em cima e 1 embaixo (bug 26/10, Amnayalife: caixa de 75 px,
      // legenda real de 2 linhas acima dela)
      let y = l.box.y, h = l.box.h;
      if (l.kind === 'caption') {
        const linha = l.style?.fontSizePx ? l.style.fontSizePx * (l.style.lineHeight ?? 1.15) : h / 2;
        y -= linha; h += 2 * linha;
      }
      return { y: y * ey, h: h * ey, startSec: l.startFrame / fps, endSec: l.endFrame / fps, x: l.box.x * ex, w: l.box.w * ex };
    })
    .filter((l) => l.y + l.h > cb.y + 2 && l.y < cb.y + cb.h - 2) // headline nas faixas pretas sai com o recorte
    .map((l) => ({ y: Math.round(Math.max(l.y, cb.y)), h: Math.round(Math.min(l.y + l.h, cb.y + cb.h) - Math.max(l.y, cb.y)), startSec: r3(l.startSec), endSec: r3(l.endSec) }));
};

/**
 * Reenquadramento NA CAIXA do vídeo (§B2): cover da `contentBox` (sem letterbox) com o rosto a 40 % da altura. Zoom
 * máximo = o rosto (com folga) cabe na caixa; se nem no cover ele cabe, `scale` < 1 e sobra fundo na cor da marca (nunca
 * borrado). Sem faceTrack: cover com foco (0,5; 0,4).
 */
export const reframeNaCaixa = (box: { w: number; h: number }, source: { width: number; height: number }, editMap: EditMapLike | null, _canvasW = 1080, contentBox: Rect | null = null, protegida: Rect | null = null): FrameReframe => {
  const C = contentBox ?? { x: 0, y: 0, w: source.width, h: source.height };
  const rosto = rostoPrincipal(source, editMap);
  const cover = Math.max(box.w / C.w, box.h / C.h);
  const conter = Math.min(box.w / C.w, box.h / C.h);
  let scale = 1;
  if (rosto) {
    const maxRosto = Math.min(box.w / (ROSTO_FOLGA * rosto.w), box.h / (ROSTO_FOLGA * rosto.h));
    const s0 = clamp(maxRosto, conter, cover);
    scale = s0 / cover >= ESCALA_MIN_COM_FAIXA ? 1 : s0 / cover;
  }
  // legenda-protegida-v1 §2.1: a legenda queimada (faixa protegida, px do arquivo) inteira DENTRO da janela: se ela é mais
  // larga/alta que a janela, afasta o zoom (até 85 % do cover, a faixa na cor da marca ainda é discreta)
  const U = protegida ? { x: protegida.x - C.x, y: protegida.y - C.y, w: protegida.w, h: protegida.h } : null;
  if (U) {
    const precisa = Math.min(box.w / Math.min(U.w * 1.01, C.w), box.h / Math.min(U.h * 1.01, C.h));
    if (cover * scale > precisa && precisa / cover >= ESCALA_MIN_COM_FAIXA) scale = Math.min(scale, precisa / cover);
  }
  const s = cover * scale;
  const ww = box.w / s, wh = box.h / s; // janela, px da contentBox
  let cx = rosto ? rosto.cx - C.x : 0.5 * C.w;
  let cy = rosto ? rosto.cy - C.y + (0.5 - ROSTO_ALTURA_ALVO) * wh : 0.4 * C.h + (0.5 - 0.5) * wh;
  if (!rosto) cy = 0.4 * C.h;
  if (U) {
    // centro da janela num intervalo que contém a faixa inteira (se ela cabe), o mais perto do enquadramento do rosto
    if (U.w <= ww) cx = clamp(cx, U.x + U.w - ww / 2, U.x + ww / 2);
    if (U.h <= wh) cy = clamp(cy, U.y + U.h - wh / 2, U.y + wh / 2);
  }
  if (!rosto && !U) return { mode: 'cover', focus: { x: 0.5, y: 0.4 } };
  return { mode: 'cover', focus: { x: r3(clamp(cx / C.w, 0, 1)), y: r3(clamp(cy / C.h, 0, 1)) }, ...(scale < 0.999 && { scale: r3(scale) }) };
};

/**
 * Onde pintar dentro da caixa (px relativos à caixa): `area` = retângulo da contentBox na caixa (div com overflow
 * hidden; fora dela, a cor da marca), `video` = o arquivo inteiro relativo à `area`. `origem` = ponto do push-in.
 */
export const pinturaNaCaixa = (box: { w: number; h: number }, source: { width: number; height: number }, r: FrameReframe, contentBox: Rect | null = null) => {
  const C = contentBox ?? { x: 0, y: 0, w: source.width, h: source.height };
  const cover = Math.max(box.w / C.w, box.h / C.h);
  const conter = Math.min(box.w / C.w, box.h / C.h);
  const s = r.mode === 'cover' ? cover * (r.scale ?? 1) : conter;
  const focus = r.focus ?? { x: 0.5, y: 0.5 };
  const ww = box.w / s, wh = box.h / s; // janela, px da contentBox
  const posicao = (f: number, total: number, janela: number) => (janela <= total ? clamp(f * total - janela / 2, 0, total - janela) : (total - janela) / 2);
  const jx = posicao(focus.x, C.w, ww);
  const jy = wh <= C.h ? clamp(focus.y * C.h - wh / 2, 0, C.h - wh) : clamp(focus.y * C.h - wh / 2, C.h - wh, 0);
  const area = { left: -jx * s, top: -jy * s, w: C.w * s, h: C.h * s };
  // origem do push-in: a posição da janela na folga (0 = encostada no começo, 1 = no fim); sem folga, o foco
  const ox = C.w - ww > 0.5 ? jx / (C.w - ww) : focus.x;
  const oy = C.h - wh > 0.5 ? jy / (C.h - wh) : focus.y;
  return {
    area, video: { left: -C.x * s, top: -C.y * s, w: source.width * s, h: source.height * s }, s,
    origem: { x: ox * box.w, y: oy * box.h }, cheio: area.left <= 0.5 && area.top <= 0.5 && area.left + area.w >= box.w - 0.5 && area.top + area.h >= box.h - 0.5,
  };
};

/** Faixas de texto queimado em px da SAÍDA (canvas), dada a caixa do vídeo e o reenquadramento. Só as que caem na caixa. */
export const faixasNaSaida = (bands: BurnedBand[] | undefined, source: { width: number; height: number }, r: FrameReframe, videoBox: Rect, contentBox: Rect | null = null, minSec = 3): { y0: number; y1: number }[] => {
  if (!bands?.length) return [];
  // texto que pisca por < 3 s (efeito de edição, não legenda) não empurra a moldura: só colidiria por um instante
  bands = bands.filter((b) => b.endSec - b.startSec >= minSec);
  const p = pinturaNaCaixa(videoBox, source, r, contentBox);
  const C = contentBox ?? { x: 0, y: 0, w: source.width, h: source.height };
  return bands
    .map((b) => ({ y0: videoBox.y + p.area.top + (b.y - C.y) * p.s, y1: videoBox.y + p.area.top + (b.y + b.h - C.y) * p.s }))
    .map((b) => ({ y0: Math.max(b.y0, videoBox.y), y1: Math.min(b.y1, videoBox.y + videoBox.h) }))
    .filter((b) => b.y1 - b.y0 > 4)
    .map((b) => ({ y0: Math.round(b.y0), y1: Math.round(b.y1) }));
};

// ───────────────────────── entrada de render ─────────────────────────

const focusSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const frameReframeSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('cover'), focus: focusSchema, scale: z.number().positive().max(1).optional() }),
  z.object({ mode: z.literal('contain_blur'), focus: focusSchema.optional() }),
]);
const fonteSchema = z.object({
  /** URL http(s) assinada; em dev, caminho relativo a public/ */
  videoUrl: z.string().min(1),
  width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(),
  durationSec: z.number().positive(), hasAudio: z.boolean(),
});
export const secondSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('champion_segment'), startSec: z.number().min(0), endSec: z.number().positive(), reframe: frameReframeSchema.optional() }),
  z.object({ kind: z.literal('page_capture'), fileUrl: z.string().min(1), scroll: z.boolean() }),
  z.object({ kind: z.literal('product_photo'), fileUrl: z.string().min(1) }),
  /** b-roll de terceiro já no nosso storage (§B3.1); duração = intervalo baixado. Sem medidas: cover pelo CSS */
  z.object({
    kind: z.literal('stock_broll'), fileUrl: z.string().min(1), durationSec: z.number().positive().optional(),
    /** medidas do arquivo (com elas, cover com o mesmo push-in do campeão; sem elas, cover pelo CSS) */
    width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
  }),
  /** trilha de b-roll (decisão 25/10): vários clipes que trocam conforme a fala, na linha do tempo da PEÇA, sem buraco.
   *  Cada clipe toca `srcStartSec`–`srcEndSec` do arquivo a partir de `fromSec` até `toSec`. `provenance` passa direto. */
  z.object({
    kind: z.literal('broll_track'),
    clips: z.array(z.object({
      fromSec: z.number().min(0), toSec: z.number().positive(), fileUrl: z.string().min(1),
      srcStartSec: z.number().min(0), srcEndSec: z.number().positive(),
      segmentText: z.string().optional(), provenance: z.unknown().optional(),
      width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
    })).min(1),
  }),
  /** local: outro arquivo de vídeo (mudo), em loop se curto */
  z.object({ kind: z.literal('clip'), videoUrl: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive(), durationSec: z.number().positive(), startSec: z.number().min(0).optional(), reframe: frameReframeSchema.optional() }),
]);
export const faceSourceSchema = z.discriminatedUnion('kind', [
  /** frame do campeão em `atSec`, recortado no rosto (`box` normalizado 0-1 no arquivo, do faceTrack) */
  z.object({ kind: z.literal('face_crop'), atSec: z.number().min(0), box: z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }) }),
  z.object({ kind: z.literal('image'), url: z.string().min(1) }),
]);

const frameDe = <K extends FrameTemplateId>(id: K) => z.object({
  id: z.literal(id), texts: frameTextsSchemas[id] as (typeof frameTextsSchemas)[K],
  /** = FrameBrand do contrato (backend preenche): nome = offer.name, handle = workspace normalizado, cor da marca */
  brand: z.object({ name: z.string().min(1), handle: z.string().min(1), initials: z.string(), color: z.string() }),
});
const frameSchema = z.discriminatedUnion('id', [
  frameDe('question_box'), frameDe('meme'), frameDe('cinema'), frameDe('news'), frameDe('read_caption'), frameDe('pov_testimonial'),
  frameDe('direct_offer'), frameDe('live'), frameDe('ranking'), frameDe('post_card'), frameDe('split_stack'), frameDe('split_torn'),
  frameDe('call'), frameDe('call_dialog'), frameDe('gossip_page'), frameDe('gossip_white'), frameDe('gossip_pink'), frameDe('story'),
]);

/** Props da composição `Moldura` = FrameRenderInput (§B2) sem renderId/kind/templateId. */
export const molduraSchema = z.object({
  format: z.enum(['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1']),
  language: z.string(),
  frame: frameSchema,
  video: z.object({
    source: fonteSchema,
    timeline: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().positive() })).min(1),
    joinFadeMs: z.number().min(0),
    reframe: frameReframeSchema,
    /** área do vídeo real no campeão (px do arquivo), sem letterbox/headline queimada; ausente = quadro inteiro */
    contentBox: z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() }).nullable().optional(),
    /** faixas de texto queimado DENTRO da contentBox (px do arquivo): o texto da moldura não fica em cima delas */
    burnedTextBands: z.array(z.object({ y: z.number(), h: z.number().positive(), startSec: z.number().min(0), endSec: z.number().min(0) })).optional(),
    /** legenda-protegida-v1: legenda queimada do campeão (px do arquivo, com folga), que nenhum elemento pode cobrir nem cortar */
    protectedBands: z.array(protectedBandSchema).optional(),
  }),
  second: secondSourceSchema.optional(),
  face: faceSourceSchema.optional(),
  safeArea: z.object({ top: z.number().min(0), bottom: z.number().min(0) }),
  /** legenda automática (campeão sem legenda queimada) ou, com captionMode 'replace', a NOSSA legenda no estilo da original */
  captions: captionsAutoSchema.optional(),
  /** legenda-protegida-v1 §2: 'avoid' = o layout desvia da legenda queimada; 'replace' = o vídeo foi recortado sem ela
   *  (contentBox − faixa) e a nossa legenda entra no estilo da original */
  captionMode: z.enum(['avoid', 'replace']).optional(),
  /** faixa da legenda no vídeo renderizado (checagem por visão); a composição ignora */
  outputProtectedBands: z.array(outputProtectedBandSchema).optional(),
});
export type MolduraProps = z.infer<typeof molduraSchema>;
export type SecondSourceProps = z.infer<typeof secondSourceSchema>;
export type BrollTrackClipProps = Extract<SecondSourceProps, { kind: 'broll_track' }>['clips'][number];

/** Trilha sem buraco na linha do tempo da peça: ordena, cada clipe vai até o início do próximo, o 1º começa em 0 e o
 *  último vai até o fim da peça. Duração em frames e quanto do arquivo existe pra cada trecho. */
export const trilhaEmFrames = (clips: BrollTrackClipProps[], totalFrames: number, fps: number = FPS) => {
  const cs = [...clips].sort((a, b) => a.fromSec - b.fromSec);
  return cs.map((c, i) => {
    const de = i === 0 ? 0 : Math.round(c.fromSec * fps);
    const ate = i === cs.length - 1 ? totalFrames : Math.round(cs[i + 1].fromSec * fps);
    const frames = Math.max(1, ate - de);
    const disponivel = Math.max(1, Math.round((c.srcEndSec - c.srcStartSec) * fps));
    // clipe mais curto que o trecho: desacelera até 0,6x; o que ainda faltar segura o último quadro (nunca preto)
    const taxa = disponivel >= frames ? 1 : Math.max(0.6, disponivel / frames);
    const tocando = Math.min(frames, Math.floor(disponivel / taxa));
    return { clip: c, de, frames, taxa, tocando, inicio: Math.round(c.srcStartSec * fps), fimArquivo: Math.round(c.srcEndSec * fps) };
  }).filter((t) => t.de < totalFrames);
};
export type FaceSourceProps = z.infer<typeof faceSourceSchema>;
export type FrameOf<K extends FrameTemplateId> = Extract<MolduraProps['frame'], { id: K }>;

/** Duração em frames = soma do timeline (o campeão inteiro, por padrão). */
export const duracaoMoldura = (p: Pick<MolduraProps, 'video'>, fps: number = FPS) =>
  trechosEmFrames(p.video.timeline, fps).reduce((n, t) => n + t.frames, 0);

/** Valida o FrameRenderInput e confere o timeline dentro do campeão. */
export const propsDeFrameInput = (input: MolduraProps & Record<string, unknown>): MolduraProps => {
  const { renderId: _r, kind: _k, templateId: _t, ...resto } = input as MolduraProps & { renderId?: string; kind?: string; templateId?: string };
  const p = molduraSchema.parse(resto);
  const dur = p.video.source.durationSec + 0.05;
  for (const [i, t] of p.video.timeline.entries()) {
    if (!(t.endSec > t.startSec) || t.endSec > dur) throw new Error(`timeline ${i}: ${t.startSec}-${t.endSec} fora de 0-${p.video.source.durationSec}`);
  }
  return p;
};

/** Cor de destaque da marca (cartões, avatar, slide): a da marca se for hex válido; senão a mais saturada da paleta. */
export const corDaMarca = (brandColor: string | null | undefined, palette: string[] = []) =>
  brandColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(brandColor) ? brandColor : corDeDestaque(palette, '#ffffff');
/** @handle sem o @ (o template põe quando precisa). */
export const semArroba = (h: string) => h.replace(/^@+/, '');
/** Iniciais do nome (avatar sem foto). */
export const iniciais = (nome: string) => {
  const ps = nome.split(/\s+/).filter((p) => p.length > 2 || /^[A-Z0-9]/.test(p));
  return (ps.length >= 2 ? ps[0][0] + ps[1][0] : nome.replace(/\s+/g, '').slice(0, 2)).toUpperCase();
};

// ───────────────────────── layout ─────────────────────────

/** Margens livres de texto/interface por formato (D6: 5 % / 10 % no 9:16; no feed, as do SAFE_AREA). */
export const FRAME_SAFE: Record<VideoFormat, { top: number; bottom: number }> = {
  VERTICAL_9_16: { top: 96, bottom: 192 },
  PORTRAIT_4_5: { top: 60, bottom: 90 },
  SQUARE_1_1: { top: 50, bottom: 70 },
};

export interface FrameLayout {
  id: FrameTemplateId; format: VideoFormat;
  canvas: { w: number; h: number }; safe: { top: number; bottom: number };
  /** caixa do vídeo principal (o do áudio) */
  videoBox: Rect;
  secondBox?: Rect;
  /** caixa (quadrada) do rosto redondo */
  faceBox?: Rect;
  /** onde mora cada bloco de texto/interface (pra checar a safeArea) */
  slots: Record<string, Rect>;
  /** textos já ajustados (fitText) */
  text: Record<string, FittedText>;
  /** medidas do template neste formato (tamanhos de fonte fixos, paddings, raios) */
  n: Record<string, number>;
  /** itens visíveis (ranking: máx. 3 no 1:1) */
  items?: string[];
  bg: string;
}

type Faixa = { y0: number; y1: number; protegida?: boolean };
type Ctx = { f: VideoFormat; W: number; H: number; safe: { top: number; bottom: number }; ui: FrameUi; slideImage: boolean; cjk: CjkFont; faixas: Faixa[] };
/** Faixa de texto queimado (px da saída) que encosta em [y0, y1], com 8 px de folga; a de maior sobreposição. */
const colide = (c: Ctx, y0: number, y1: number): Faixa | null => {
  let melhor: Faixa | null = null, mx = 0;
  for (const f of c.faixas) { const o = Math.min(y1, f.y1 + 8) - Math.max(y0, f.y0 - 8); if (o > mx) { mx = o; melhor = f; } }
  return melhor;
};
/** [y0, y1] não encosta em faixa nenhuma, exceto as que ele cobre inteiras (bloco opaco). */
/** Legenda queimada PROTEGIDA (legenda-protegida-v1, 26/10) nunca é coberta: bloco opaco só pode cobrir texto queimado
 *  que não é legenda. */
const livre = (c: Ctx, y0: number, y1: number, opaco: boolean) => c.faixas.every((f) => f.y1 + 8 <= y0 || f.y0 - 8 >= y1 || (opaco && !f.protegida && y0 <= f.y0 - 8 && y1 >= f.y1 + 8));
/** fitText com a Noto do idioma da peça */
const fitC = (c: Ctx, text: string, o: FitTextOptions) => fitText(text, { ...o, cjk: c.cjk });
/** Rótulo de 1 linha (CTA, selo, nome da página, título do ranking): encolhe a fonte até caber em `width`, no mínimo
 *  `min`. Texto latino no tamanho do protótipo não muda; CJK (largura cheia) e texto no limite encolhem em vez de quebrar. */
const encolher = (c: Ctx, font: FrameFontKey, text: string, size: number, width: number, o: { min?: number; uppercase?: boolean; ls?: number } = {}) => {
  const t = o.uppercase ? text.toUpperCase() : text;
  let s = size;
  while (s > (o.min ?? 26) && medirTexto(font, t, s, o.ls ?? 0, c.cjk) > width) s -= 2;
  return s;
};
/** escolhe por formato: 9:16, 4:5, 1:1 */
const por = <T,>(c: Ctx, v: T, p: T, q: T): T => (c.f === 'VERTICAL_9_16' ? v : c.f === 'PORTRAIT_4_5' ? p : q);
const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const M = 60;
type Lay = Omit<FrameLayout, 'id' | 'format' | 'canvas' | 'safe'>;

const LAYOUTS: { [K in FrameTemplateId]: (c: Ctx, t: FrameTextsMap[K]) => Lay } = {
  // ── 1. Caixinha: vídeo cheio, cartão "Faça uma pergunta" com o rosto. 9:16 desce do y 1010; feed sobe do rodapé.
  question_box: (c, t) => {
    const n = {
      cardW: por(c, 840, 760, 700), avatar: por(c, 132, 112, 100), titleSize: por(c, 40, 36, 34), radius: por(c, 44, 40, 36),
      headTop: por(c, 92, 78, 70), headBottom: por(c, 34, 30, 26), headX: 40, bodyTop: por(c, 46, 38, 32), bodyBottom: por(c, 54, 46, 40), bodyX: por(c, 50, 40, 40),
      veil: por(c, 1100, 760, 620),
    };
    const opQ = { font: 'montserrat-800' as const, width: n.cardW - 2 * n.bodyX, maxLines: por(c, 4, 3, 3), max: por(c, 70, 60, 52), min: por(c, 44, 40, 38), lineHeight: 1.14 };
    let q = fitC(c, t.question, opQ);
    const alturaCartao = (f: FittedText) => n.headTop + alturaLinhaNormal('inter-800', n.titleSize) + n.headBottom + n.bodyTop + f.height + n.bodyBottom;
    let cardH = alturaCartao(q);
    let y = c.f === 'VERTICAL_9_16' ? 1010 : c.H - c.safe.bottom - 10 - cardH;
    // legenda queimada do campeão encostando no cartão (25-26/10): 1º abaixo dela (a pergunta encolhe até caber no espaço
    // até a área segura); 2º acima dela; por último o cartão (opaco) cobre a faixa. O cartão é mais estreito que a
    // legenda, então cobrir deixa letra nas pontas: é a última opção
    const b = colide(c, y - n.avatar / 2, y + cardH);
    if (b) {
      const topo = c.safe.top + n.avatar / 2 + 6, fundoMax = c.H - c.safe.bottom;
      let feito = false;
      const yAbaixo = b.y1 + n.avatar / 2 + 24;
      for (let m = opQ.maxLines; m >= 1 && !feito; m--) {
        const f = fitC(c, t.question, { ...opQ, maxLines: m });
        if (f.fits && yAbaixo + alturaCartao(f) <= fundoMax && livre(c, yAbaixo - n.avatar / 2, yAbaixo + alturaCartao(f), true)) { q = f; cardH = alturaCartao(f); y = yAbaixo; feito = true; }
      }
      if (!feito) {
        // cobrindo: cartão quase da largura da tela (a legenda queimada costuma ser mais larga que o cartão de 840)
        const largo = c.W - 24;
        const qL = fitC(c, t.question, { ...opQ, width: largo - 2 * n.bodyX });
        const hL = alturaCartao(qL);
        const yCobre = clamp(Math.round(b.y0 - (hL - (b.y1 - b.y0)) / 2), topo, fundoMax - hL);
        if (hL >= b.y1 - b.y0 + 24 && livre(c, yCobre - n.avatar / 2, yCobre + hL, true)) { n.cardW = largo; q = qL; cardH = hL; y = yCobre; feito = true; }
      }
      if (!feito) {
        const v = clamp(b.y0 - 24 - cardH, topo, fundoMax - cardH);
        if (livre(c, v - n.avatar / 2, v + cardH, true)) y = v;
      }
    }
    const x = (c.W - n.cardW) / 2;
    return { videoBox: R(0, 0, c.W, c.H), faceBox: R(c.W / 2 - n.avatar / 2, y - n.avatar / 2, n.avatar, n.avatar), slots: { card: R(x, y - n.avatar / 2, n.cardW, cardH + n.avatar / 2) }, text: { question: q }, n: { ...n, cardX: x, cardY: y, cardH }, bg: '#000' };
  },
  // ── 3. Meme: POV em cima, vídeo no meio, CTA embaixo (o 1:1 corta o CTA).
  meme: (c, t) => {
    const n = { textY: por(c, c.safe.top + 40, 60, 50), textH: por(c, 470, 300, 260), videoY: por(c, 640, 380, 330), videoH: por(c, 880, 750, 680), ctaY: por(c, 1560, 1140, 0), ctaH: por(c, 150, 120, 0), ctaSize: por(c, 50, 42, 0), arrow: por(c, 58, 48, 0) };
    const pov = fitC(c, `*${c.ui.pov}* ${t.pov}`, { font: 'inter-800', width: c.W - 2 * M, maxLines: por(c, 5, 4, 4), max: por(c, 70, 56, 50), min: por(c, 44, 38, 36), lineHeight: 1.16 });
    if (n.ctaSize) n.ctaSize = encolher(c, 'inter-800', t.cta, n.ctaSize, c.W - 2 * M - n.arrow - 20);
    const slots: Record<string, Rect> = { pov: R(M, n.textY, c.W - 2 * M, n.textH) };
    if (n.ctaH) slots.cta = R(0, n.ctaY, c.W, n.ctaH);
    return { videoBox: R(0, n.videoY, c.W, n.videoH), slots, text: { pov }, n, bg: '#050505' };
  },
  // ── 4. Cinema: pergunta grande, faixa de vídeo que abre, marca embaixo (o 1:1 corta o subtítulo).
  cinema: (c, t) => {
    // 4:5: faixa com 55 % da altura (B4); a marca (linha + nome, ~58 px) logo abaixo, dentro da safeArea
    const n = { textY: por(c, 300, 60, 50), textH: por(c, 520, 360, 300), bandY: por(c, 900, 432, 380), bandH: por(c, 600, 745, 520), brandGap: por(c, 70, 22, 40), brandSize: por(c, 30, 28, 26), gap: por(c, 34, 22, 0) };
    const question = fitC(c, t.question, { font: 'montserrat-800', width: 900, maxLines: 3, max: por(c, 86, 64, 66), min: por(c, 52, 44, 44), lineHeight: 1.08 });
    const text: Record<string, FittedText> = { question };
    if (c.f !== 'SQUARE_1_1') text.subtitle = fitC(c, t.subtitle, { font: 'inter-600', width: 820, maxLines: por(c, 3, 2, 2), max: por(c, 42, 36, 36), min: 34, lineHeight: 1.3 });
    return { videoBox: R(0, n.bandY, c.W, n.bandH), slots: { text: R(90, n.textY, 900, n.textH), brand: R(0, n.bandY + n.bandH + n.brandGap, c.W, 60) }, text, n, bg: '#050505' };
  },
  // ── 5. Notícia: selo, manchete, linha fina, vídeo no espaço que sobra, CTA (feed: CTA por cima do pé do vídeo; 1:1 sem linha fina).
  news: (c, t) => {
    const n = {
      top: por(c, c.safe.top + 10, 60, 50), gap: por(c, 26, 16, 14), pillPadY: por(c, 18, 12, 10), pillPadX: por(c, 28, 22, 20), pillDot: por(c, 18, 14, 12), pillSize: por(c, 40, 30, 28),
      ctaPadY: por(c, 28, 20, 18), ctaSize: por(c, 44, 36, 34), arrow: por(c, 50, 40, 38), ctaInset: por(c, 0, 24, 20),
    };
    const head = fitC(c, `${t.headline.lead} *${t.headline.highlight}*`, { font: 'montserrat-900', width: c.W - 2 * M, maxLines: por(c, 4, 3, 3), max: por(c, 78, 52, 50), min: por(c, 48, 40, 38), lineHeight: 1.06 });
    const text: Record<string, FittedText> = { headline: head };
    n.pillSize = encolher(c, 'montserrat-900', t.topic, n.pillSize, c.W - 2 * M - 2 * n.pillPadX - n.pillDot - 18, { uppercase: true, ls: 0.12 });
    n.ctaSize = encolher(c, 'montserrat-900', t.cta, n.ctaSize, c.W - 2 * M - 2 * n.ctaInset - n.arrow - 18 - 40, { uppercase: true, ls: 0.02 });
    const pillH = 2 * n.pillPadY + Math.max(alturaLinhaNormal('montserrat-900', n.pillSize), n.pillDot);
    let y = n.top + pillH + n.gap + head.height + n.gap;
    if (c.f !== 'SQUARE_1_1') {
      text.dek = fitC(c, t.dek, { font: 'inter-600', width: c.W - 2 * M - 28, maxLines: por(c, 3, 2, 2), max: por(c, 38, 36, 36), min: 32, lineHeight: por(c, 1.3, 1.25, 1.25) });
      y += text.dek.height + n.gap;
    }
    const ctaH = 2 * n.ctaPadY + Math.max(alturaLinhaNormal('montserrat-900', n.ctaSize), n.arrow);
    const fim = c.H - c.safe.bottom;
    const vBottom = c.f === 'VERTICAL_9_16' ? fim - ctaH - n.gap : fim;
    const cta = c.f === 'VERTICAL_9_16' ? R(M, fim - ctaH, c.W - 2 * M, ctaH) : R(M + n.ctaInset, fim - n.ctaInset - ctaH, c.W - 2 * M - 2 * n.ctaInset, ctaH);
    return { videoBox: R(M, y, c.W - 2 * M, vBottom - y), slots: { header: R(M, n.top, c.W - 2 * M, y - n.gap - n.top), cta }, text, n: { ...n, pillH, ctaH }, bg: '#F3EFE8' };
  },
  // ── 15. Leia a legenda: vídeo cheio, manchete com marca-texto, pílula "Leia a legenda".
  read_caption: (c, t) => {
    const n = { veil: por(c, 1050, 700, 560), pillSize: por(c, 44, 38, 36), pillPadY: por(c, 20, 18, 16), pillPadX: por(c, 40, 36, 32), arrow: por(c, 48, 42, 40), gap: 40 };
    const pillH = 2 * n.pillPadY + Math.max(alturaLinhaNormal('inter-800', n.pillSize), n.arrow);
    const pillY = c.f === 'VERTICAL_9_16' ? c.H - c.safe.bottom - 130 : c.H - c.safe.bottom - pillH - 10;
    const opcoesH = { font: 'montserrat-900' as const, width: c.W - 2 * M, maxLines: por(c, 4, 3, 3), max: por(c, 82, 66, 58), min: por(c, 52, 44, 40), lineHeight: 1.12 };
    let h = fitC(c, t.headline, opcoesH);
    let hy = c.f === 'VERTICAL_9_16' ? 1040 : pillY - n.gap - h.height;
    // manchete (texto solto sobre o vídeo) em cima de legenda queimada: vai pra baixo da faixa (reajustando o tamanho ao
    // espaço até a pílula); não cabendo, pra cima dela
    const b = colide(c, hy, hy + h.height);
    if (b) {
      const ini = b.y1 + 48, disp = pillY - 20 - ini; // 48 px: colada embaixo da legenda queimada parece continuação dela
      let feito = false;
      for (let m = opcoesH.maxLines; m >= 1 && !feito; m--) {
        const f = fitC(c, t.headline, { ...opcoesH, maxLines: m });
        if (f.fits && f.height <= disp && livre(c, ini, ini + f.height, false)) { h = f; hy = ini; feito = true; }
      }
      if (!feito && b.y0 - 48 - h.height >= c.safe.top && livre(c, b.y0 - 48 - h.height, b.y0 - 48, false)) hy = b.y0 - 48 - h.height;
    }
    return { videoBox: R(0, 0, c.W, c.H), slots: { headline: R(M, hy, c.W - 2 * M, h.height), pill: R(0, pillY, c.W, pillH) }, text: { headline: h }, n: { ...n, pillY, pillH, headlineY: hy }, bg: '#000' };
  },
  // ── 16. POV + depoimento: POV em cima, vídeo no espaço que sobra, pílula de CTA.
  pov_testimonial: (c, t) => {
    const n = { top: por(c, c.safe.top + 30, 60, 50), gap: por(c, 40, 24, 20), ctaPadY: por(c, 32, 22, 18), ctaSize: por(c, 42, 36, 32), arrow: por(c, 46, 40, 36), radius: por(c, 40, 34, 30) };
    const pov = fitC(c, `*${c.ui.povTitle}* ${t.pov}`, { font: 'inter-800', width: c.W - 2 * M, maxLines: por(c, 4, 3, 3), max: por(c, 64, 52, 44), min: por(c, 44, 38, 36), lineHeight: 1.16 });
    n.ctaSize = encolher(c, 'montserrat-900', t.cta, n.ctaSize, c.W - 2 * M - n.arrow - 18 - 60, { uppercase: true, ls: 0.02 });
    const ctaH = 2 * n.ctaPadY + Math.max(alturaLinhaNormal('montserrat-900', n.ctaSize), n.arrow);
    const fim = c.H - c.safe.bottom;
    const vy = n.top + pov.height + n.gap;
    return { videoBox: R(M, vy, c.W - 2 * M, fim - ctaH - n.gap - vy), slots: { pov: R(M, n.top, c.W - 2 * M, pov.height), cta: R(M, fim - ctaH, c.W - 2 * M, ctaH) }, text: { pov }, n: { ...n, ctaH }, bg: '#FAF8F4' };
  },
  // ── 13. Oferta direta: vídeo em cima até onde o texto começa (sem vão), promessa, preço, CTA presos no rodapé.
  direct_offer: (c, t) => {
    const n = {
      promiseMax: por(c, 150, 92, 80), promiseMin: por(c, 80, 60, 50), fromSize: por(c, 52, 42, 36), onlySize: por(c, 46, 38, 34), priceSize: por(c, 168, 110, 96),
      ctaSize: por(c, 44, 38, 36), ctaPadY: por(c, 30, 24, 20), ctaPadX: por(c, 56, 46, 40), arrow: por(c, 50, 42, 38),
      gapCta: por(c, 56, 30, 30), gapPrice: por(c, 40, 22, 24), fade: por(c, 262, 200, 170), overlap: por(c, 60, 60, 40),
    };
    const promise = fitC(c, t.promise, { font: 'anton-400', width: c.W - 2 * M, maxLines: 2, max: n.promiseMax, min: n.promiseMin, lineHeight: 1.08, uppercase: true });
    const fim = c.H - c.safe.bottom;
    n.ctaSize = encolher(c, 'montserrat-900', t.cta, n.ctaSize, c.W - 2 * M - 2 * n.ctaPadX - n.arrow - 20);
    const ctaH = 2 * n.ctaPadY + Math.max(alturaLinhaNormal('montserrat-900', n.ctaSize), n.arrow);
    const fromH = t.price.from ? alturaLinhaNormal('inter-800', n.fromSize) : 0;
    // preço numa linha só: "Por apenas" + preço cabem na largura; preço longo ("R$ 1.997,90") encolhe a fonte do preço
    let priceSize = n.priceSize;
    const larguraPreco = (s: number) => medirTexto('inter-800', c.ui.only, n.onlySize, 0, c.cjk) + 22 + medirTexto('montserrat-900', t.price.to, s, -0.03, c.cjk);
    while (priceSize > FRAME_MIN_FONT_PX && larguraPreco(priceSize) > c.W - 2 * M) priceSize -= 2;
    const priceH = alturaLinhaNormal('montserrat-900', priceSize);
    const ctaY = fim - ctaH;
    const priceY = ctaY - n.gapCta - priceH - fromH;
    const promiseY = priceY - n.gapPrice - promise.height;
    const vh = Math.min(c.H, promiseY + n.overlap);
    return {
      videoBox: R(0, 0, c.W, vh),
      slots: { promise: R(M, promiseY, c.W - 2 * M, promise.height), price: R(M, priceY, c.W - 2 * M, priceH + fromH), cta: R(M, ctaY, c.W - 2 * M, ctaH) },
      text: { promise }, n: { ...n, priceSize, ctaH, fromH, priceH, ctaY, priceY, promiseY }, bg: '#0A0F1E',
    };
  },
  // ── 17. Live: vídeo cheio, cabeçalho de live, corações subindo, barra de comentários.
  live: (c) => {
    const n = {
      headTop: por(c, c.safe.top + 10, 60, 50), avatar: por(c, 100, 80, 72), handleSize: por(c, 40, 34, 32), badgeSize: por(c, 30, 26, 24), close: por(c, 60, 50, 46),
      barH: por(c, 104, 90, 80), pillSize: por(c, 36, 32, 30), icon: por(c, 60, 52, 48), heartFrom: por(c, 1600, 1150, 920), heartTo: por(c, 1080, 750, 600), heartScale: por(c, 1, 0.9, 0.85),
      veilTop: por(c, 420, 320, 280), veilBottom: por(c, 520, 380, 320),
    };
    const barY = c.f === 'VERTICAL_9_16' ? c.H - c.safe.bottom - 120 : c.H - c.safe.bottom - n.barH;
    return { videoBox: R(0, 0, c.W, c.H), faceBox: R(44 + 5, n.headTop + 5, n.avatar - 10, n.avatar - 10), slots: { header: R(44, n.headTop, c.W - 88, n.avatar), bar: R(44, barY, c.W - 88, n.barH) }, text: {}, n: { ...n, barY }, bg: '#000' };
  },
  // ── 11. Ranking: vídeo cheio, cartão RANKING/TOP N, itens com medalha presos embaixo (1:1: máx. 3).
  ranking: (c, t) => {
    const items = c.f === 'SQUARE_1_1' ? t.items.slice(0, 3) : t.items;
    const n = {
      cardX: por(c, 90, 130, 160), cardY: por(c, c.safe.top + 34, 60, 50), cardPadT: por(c, 30, 22, 20), cardPadB: por(c, 34, 26, 22), cardRadius: por(c, 60, 50, 44),
      trophy: por(c, 74, 60, 52), rankSize: por(c, 76, 60, 52), topSize: por(c, 38, 32, 28), titleSize: por(c, 42, 36, 36),
      medal: por(c, 96, 76, 72), itemGap: por(c, 16, 12, 10), itemPadY: por(c, 10, 8, 8), bottomGap: por(c, 24, 16, 14), count: items.length,
      veilTop: por(c, 520, 420, 360), veilBottom: por(c, 1100, 820, 640),
    };
    const itemW = c.W - 2 * M - 180 + por(c, 0, 20, 24);
    const text: Record<string, FittedText> = {};
    // CJK (largura cheia): item pode ir pra 2 linhas dentro da altura da medalha; latino continua em 1
    items.forEach((it, i) => { text[`item${i}`] = fitC(c, it, { font: 'montserrat-800', width: itemW, maxLines: temCJK(it) ? 2 : 1, max: por(c, 50, 44, 40), min: 36, ...(temCJK(it) && { lineHeight: 1.08 }) }); });
    n.titleSize = encolher(c, 'inter-800', t.title, n.titleSize, c.W - 2 * n.cardX - 80);
    const itemH = Math.max(n.medal, ...items.map((_x, i) => text[`item${i}`].height)) + 2 * n.itemPadY + 2; // + borda de 1,5 px (o Chrome desenha 1 px)
    let listH = items.length * itemH + (items.length - 1) * n.itemGap;
    const fimLista = c.H - c.safe.bottom - n.bottomGap;
    let listY = fimLista - listH;
    const cardH = n.cardPadT + Math.max(n.trophy, alturaLinhaNormal('montserrat-900', n.rankSize)) + 6 + alturaLinhaNormal('inter-800', n.titleSize) + n.cardPadB;
    // legenda queimada no caminho da lista (bug 26/10): lista inteira abaixo da faixa; senão acima; senão a lista (linhas
    // opacas, coladas) COBRE a faixa inteira; o texto dos itens nunca fica em cima da legenda queimada
    let opaco = 0;
    const b = colide(c, listY, listY + listH);
    if (b) {
      const topoMin = n.cardY + cardH + 16;
      const listHColada = items.length * itemH + (items.length - 1) * 4;
      const opcoes: { y: number; h: number; opaco: number }[] = [
        { y: b.y1 + 16, h: listH, opaco: 0 }, { y: b.y0 - 16 - listH, h: listH, opaco: 0 },
        { y: Math.max(topoMin, b.y0 - 8), h: listHColada, opaco: 1 }, { y: b.y1 + 8 - listHColada, h: listHColada, opaco: 1 },
      ];
      const ok = opcoes.find((o) => o.y >= topoMin && o.y + o.h <= fimLista && livre(c, o.y, o.y + o.h, o.opaco === 1));
      if (ok) { listY = ok.y; listH = ok.h; opaco = ok.opaco; if (opaco) n.itemGap = 4; }
    }
    return { videoBox: R(0, 0, c.W, c.H), slots: { card: R(n.cardX, n.cardY, c.W - 2 * n.cardX, cardH), list: R(M, listY, c.W - 2 * M, listH) }, text, items, n: { ...n, itemW, itemH, listY, opaco }, bg: '#000' };
  },
  // ── 12. Tweet: cartão de post com o vídeo dentro. Feed: o vídeo ocupa o que sobra até o rodapé.
  post_card: (c, t) => {
    const n = {
      x: 40, y: por(c, c.safe.top + 40, 60, 50), padT: por(c, 44, 26, 28), padX: por(c, 44, 36, 32), padB: por(c, 36, 20, 22), gap: por(c, 30, 16, 16), radius: por(c, 40, 34, 30),
      avatar: por(c, 112, 76, 72), nameSize: por(c, 44, 32, 32), handleSize: por(c, 36, 28, 28), iniciaisSize: por(c, 44, 30, 30), dots: por(c, 48, 38, 36), icon: por(c, 46, 36, 36), mediaRadius: por(c, 30, 26, 22),
    };
    const w = c.W - 2 * n.x - 2 * n.padX;
    const copy = fitC(c, t.copy, { font: 'inter-600', width: w, maxLines: por(c, 5, 4, 3), max: por(c, 54, 42, 40), min: por(c, 40, 36, 36), lineHeight: 1.28 });
    const headH = Math.max(n.avatar, alturaLinhaNormal('inter-800', n.nameSize) + 4 + alturaLinhaNormal('inter-600', n.handleSize));
    const vy = n.y + n.padT + headH + n.gap + copy.height + n.gap;
    const vh = c.f === 'VERTICAL_9_16' ? 880 : c.H - c.safe.bottom - (n.gap + n.icon + n.padB) - vy;
    return { videoBox: R(n.x + n.padX, vy, w, vh), slots: { card: R(n.x, n.y, c.W - 2 * n.x, vy + vh + n.gap + n.icon + n.padB - n.y) }, text: { copy }, n: { ...n, headH, contentW: w }, bg: '#050608' };
  },
  // ── 7. Tela dividida: 2 vídeos empilhados, faixa vermelha na emenda.
  split_stack: (c, t) => {
    const n = { bandW: 1000, bandPadY: por(c, 30, 26, 22), bandPadX: 50 };
    const h = fitC(c, t.headline, { font: 'montserrat-900', width: 900, maxLines: 2, max: por(c, 70, 58, 52), min: por(c, 46, 40, 38), lineHeight: 1.04, uppercase: true });
    const bh = h.height + 2 * n.bandPadY;
    return { videoBox: R(0, 0, c.W, c.H / 2), secondBox: R(0, c.H / 2, c.W, c.H / 2), slots: { band: R((c.W - n.bandW) / 2, c.H / 2 - bh / 2, n.bandW, bh) }, text: { headline: h }, n: { ...n, bandH: bh }, bg: '#000' };
  },
  // ── 8. Tela dividida 2: faixa de papel rasgado com fita.
  split_torn: (c, t) => {
    const n = { stripW: 1120, stripH: por(c, 270, 240, 210) };
    const h = fitC(c, t.headline, { font: 'archivo-black-400', width: 900, maxLines: 2, max: por(c, 68, 58, 50), min: por(c, 44, 40, 36), lineHeight: 1.08 });
    return { videoBox: R(0, 0, c.W, c.H / 2), secondBox: R(0, c.H / 2, c.W, c.H / 2), slots: { strip: R(40, c.H / 2 - n.stripH / 2, c.W - 80, n.stripH) }, text: { headline: h }, n, bg: '#000' };
  },
  // ── 9. Chamada (Google Meet genérico): slide do tamanho do conteúdo (sem vão), pessoa no resto. 1:1: lado a lado.
  call: (c, t) => {
    const lado = c.f === 'SQUARE_1_1';
    const n = {
      barTop: por(c, c.safe.top + 6, 60, 50), barH: por(c, 80, 64, 56), titleSize: por(c, 38, 32, 30), timerSize: por(c, 34, 28, 26),
      top: por(c, 210, 140, 116), gap: por(c, 18, 16, 16), padY: por(c, 50, 38, 32), padX: por(c, 56, 44, 34), brandH: por(c, 52, 44, 40), brandSize: por(c, 34, 30, 26),
      inner: por(c, 30, 22, 18), stepBox: por(c, 66, 56, 52), stepSize: por(c, 46, 40, 40), stepGap: por(c, 30, 20, 16), stepGapX: por(c, 22, 18, 14), progress: por(c, 14, 12, 10),
      ctrl: por(c, 104, 88, 80), ctrlIcon: por(c, 48, 42, 38), hangW: por(c, 160, 136, 124), radius: por(c, 28, 24, 22),
    };
    const ctrlY = c.f === 'VERTICAL_9_16' ? c.H - c.safe.bottom - 116 : c.H - c.safe.bottom - n.ctrl;
    const slideW = lado ? 540 : c.W - 64;
    const textW = slideW - 2 * n.padX;
    // 1:1 com imagem: título em até 2 linhas e passos mais juntos, pra sobrar altura pra foto embaixo
    if (lado && c.slideImage) n.stepGap = 10;
    const title = fitC(c, t.slideTitle, { font: 'montserrat-900', width: textW, maxLines: lado && !c.slideImage ? 3 : 2, max: por(c, 66, 54, 54), min: por(c, 44, 40, 36), lineHeight: 1.05 });
    const text: Record<string, FittedText> = { title };
    // 2ª fonte da "apresentação" (foto do produto / captura da página): 9:16 e 4:5 = coluna à direita dos passos;
    // 1:1 (slide estreito) = embaixo dos passos, ocupando o que sobra do slide
    const img = c.slideImage;
    const imgW = img && !lado ? por(c, 300, 260, 0) : 0;
    const imgGap = por(c, 28, 22, 16);
    const stepsW = textW - (imgW ? imgW + imgGap : 0);
    t.slideSteps.forEach((s, i) => { text[`step${i}`] = fitC(c, s, { font: 'inter-800', width: stepsW - n.stepBox - n.stepGapX, maxLines: lado && !img ? 3 : 2, max: n.stepSize, min: lado ? 36 : n.stepSize - 8, lineHeight: 1.15 }); });
    const stepsH = t.slideSteps.reduce((a, _s, i) => a + Math.max(n.stepBox, text[`step${i}`].height), 0) + (t.slideSteps.length - 1) * n.stepGap;
    const blocoH = imgW ? Math.max(stepsH, por(c, 280, 220, 0)) : stepsH;
    const fimArea = ctrlY - n.gap;
    const conteudoH = n.padY + n.brandH + n.inner + title.height + n.inner + 10 + blocoH + n.inner + 10 + n.progress + n.padY;
    const slideH = lado ? fimArea - n.top : conteudoH;
    const slide = R(32, n.top, slideW, slideH);
    const pessoa = lado ? R(32 + slideW + 16, n.top, c.W - 64 - slideW - 16, fimArea - n.top) : R(32, n.top + slideH + n.gap, c.W - 64, fimArea - (n.top + slideH + n.gap));
    const blocoY = n.top + n.padY + n.brandH + n.inner + title.height + n.inner + 10;
    const slots: Record<string, Rect> = { bar: R(40, n.barTop, c.W - 80, n.barH), slide, controls: R(40, ctrlY, c.W - 80, n.ctrl) };
    if (img) {
      slots.slideImage = lado
        ? R(32 + n.padX, blocoY + stepsH + imgGap, textW, slideH - (blocoY - n.top) - stepsH - imgGap - (n.inner + 10 + n.progress + n.padY))
        : R(32 + n.padX + stepsW + imgGap, blocoY, imgW, blocoH);
    }
    return { videoBox: pessoa, slots, text, n: { ...n, ctrlY, stepsH, stepsW, imgW, imgGap, blocoH }, bg: '#1B1C20' };
  },
  // ── 10. Meet diálogo: 2 quadros (2 fontes do campeão, sem rosto gerado). 1:1: lado a lado.
  call_dialog: (c) => {
    const lado = c.f === 'SQUARE_1_1';
    const n = {
      barTop: por(c, c.safe.top + 6, 60, 50), barH: por(c, 80, 64, 56), titleSize: por(c, 38, 32, 30), timerSize: por(c, 34, 28, 26), top: por(c, 210, 140, 116), gap: por(c, 18, 16, 16),
      ctrl: por(c, 104, 88, 80), ctrlIcon: por(c, 48, 42, 38), hangW: por(c, 160, 136, 124), radius: por(c, 28, 24, 22),
    };
    const ctrlY = c.f === 'VERTICAL_9_16' ? c.H - c.safe.bottom - 116 : c.H - c.safe.bottom - n.ctrl;
    const fim = c.f === 'VERTICAL_9_16' ? c.H - c.safe.bottom - 140 : ctrlY - n.gap;
    const a = lado ? R(32, n.top, (c.W - 64 - n.gap) / 2, fim - n.top) : R(32, n.top, c.W - 64, (fim - n.top - n.gap) / 2);
    const b = lado ? R(32 + a.w + n.gap, n.top, a.w, a.h) : R(32, n.top + a.h + n.gap, a.w, a.h);
    return { videoBox: a, secondBox: b, slots: { bar: R(40, n.barTop, c.W - 80, n.barH), controls: R(40, ctrlY, c.W - 80, n.ctrl) }, text: {}, n: { ...n, ctrlY }, bg: '#1B1C20' };
  },
  // ── 2. Choquei: post de página com 2 vídeos lado a lado e o rosto redondo na emenda.
  gossip_page: (c, t) => {
    const n = {
      top: por(c, c.safe.top + 24, 60, 50), avatar: por(c, 96, 80, 72), nameSize: por(c, 40, 36, 32), subSize: por(c, 32, 28, 26), initSize: por(c, 32, 28, 26), dots: por(c, 48, 42, 38), gap: por(c, 34, 24, 20),
      vy: por(c, 620, 400, 300), vh: por(c, 940, 740, 640), face: por(c, 230, 170, 150), faceUp: por(c, 110, 80, 60), iconsGap: por(c, 46, 26, 20), icon: por(c, 54, 46, 42), tileGap: 16, radius: por(c, 24, 22, 20),
    };
    const head = fitC(c, t.headline, { font: 'inter-600', width: c.W - 2 * M, maxLines: por(c, 5, 4, 3), max: por(c, 58, 46, 40), min: por(c, 40, 36, 36), lineHeight: 1.22 });
    n.nameSize = encolher(c, 'inter-800', t.pageName, n.nameSize, c.W - 2 * M - n.avatar - 10 - 44 - n.dots);
    const lw = (c.W - 2 * M - n.tileGap) / 2;
    const cy = n.vy + n.vh - n.faceUp;
    return {
      videoBox: R(M, n.vy, lw, n.vh), secondBox: R(M + lw + n.tileGap, n.vy, lw, n.vh), faceBox: R(c.W / 2 - n.face / 2, cy - n.face / 2, n.face, n.face),
      slots: { header: R(M, n.top, c.W - 2 * M, n.vy - n.top), icons: R(M + 10, n.vy + n.vh + n.iconsGap, c.W - 2 * M - 20, n.icon) }, text: { headline: head }, n, bg: '#0B0B0D',
    };
  },
  // ── 18. Fofoca 1: fundo branco, EXCLUSIVO + manchete, 2 vídeos, rosto na base.
  gossip_white: (c, t) => {
    const n = { hy: por(c, c.safe.top + 40, 60, 50), vy: por(c, 700, 460, 360), vh: por(c, 830, 640, 540), face: por(c, 250, 190, 160), labelSize: por(c, 30, 26, 24), dot: por(c, 14, 12, 12), gap: por(c, 26, 18, 14), radius: 30, tileGap: 16 };
    const head = fitC(c, t.headline, { font: 'montserrat-900', width: c.W - 2 * M, maxLines: por(c, 4, 3, 3), max: por(c, 74, 60, 52), min: por(c, 46, 40, 36), lineHeight: 1.06 });
    const lw = (c.W - 2 * M - n.tileGap) / 2;
    return {
      videoBox: R(M, n.vy, lw, n.vh), secondBox: R(M + lw + n.tileGap, n.vy, lw, n.vh), faceBox: R(c.W / 2 - n.face / 2, n.vy + n.vh - n.face / 2, n.face, n.face),
      slots: { header: R(M, n.hy, c.W - 2 * M, n.vy - n.hy - 40) }, text: { headline: head }, n, bg: '#FFFFFF',
    };
  },
  // ── 19. Fofoca 2: rosa com retícula, manchete em cartão, 2 vídeos com borda, selo estourado.
  gossip_pink: (c, t) => {
    const n = { cy: por(c, c.safe.top + 70, 60, 50), padY: por(c, 34, 28, 24), vy: por(c, 640, 0, 0), vh: por(c, 940, 0, 0), seal: por(c, 300, 200, 170), sealSize: por(c, 70, 46, 40), tileGap: 20, border: 8 };
    const head = fitC(c, t.headline, { font: 'montserrat-900', width: c.W - 160, maxLines: por(c, 4, 3, 3), max: por(c, 66, 54, 46), min: por(c, 42, 38, 36), lineHeight: 1.08 });
    const cardH = head.height + 2 * n.padY;
    const vy = c.f === 'VERTICAL_9_16' ? 640 : n.cy + cardH + por(c, 0, 40, 30);
    const vh = c.f === 'VERTICAL_9_16' ? 940 : c.H - c.safe.bottom - vy;
    const lw = (c.W - 80 - n.tileGap) / 2;
    return {
      videoBox: R(40, vy, lw, vh), secondBox: R(40 + lw + n.tileGap, vy, lw, vh),
      // feed: selo menor e mais baixo, em cima do 2º vídeo (no 9:16 do protótipo ele invade o cartão; no feed cobria a manchete)
      slots: { card: R(40, n.cy, c.W - 80, cardH), seal: c.f === 'VERTICAL_9_16' ? R(c.W - n.seal - 40, vy - Math.round(n.seal * 0.4667), n.seal, n.seal) : R(c.W - n.seal - 30, vy - Math.round(n.seal * 0.22), n.seal, n.seal) }, text: { headline: head }, n: { ...n, vy, vh, cardH }, bg: '#FF3EA5',
    };
  },
  // ── 14. Story: vídeo cheio, caixinha em cima, bloco verde + apoio + texto embaixo (1:1 sem o apoio).
  story: (c, t) => {
    const n = {
      top: por(c, c.safe.top + 40, 60, 50), cardW: por(c, 780, 700, 700), headSize: por(c, 34, 30, 28), headPad: por(c, 22, 18, 16), bodyPadY: por(c, 30, 24, 20), bodyPadX: 40,
      greenPadY: por(c, 26, 20, 18), greenPadX: 44, gap: por(c, 28, 18, 14), copyPadY: por(c, 36, 28, 24), copyPadX: 42,
      veilTop: por(c, 700, 500, 400), veilBottom: por(c, 1200, 860, 700),
    };
    const text: Record<string, FittedText> = {
      question: fitC(c, t.question, { font: 'montserrat-800', width: n.cardW - 80, maxLines: 3, max: por(c, 50, 42, 40), min: por(c, 38, 36, 36), lineHeight: 1.12 }),
      headline: fitC(c, t.headline, { font: 'montserrat-900', width: 820, maxLines: 2, max: por(c, 60, 50, 46), min: por(c, 42, 40, 38), lineHeight: 1.08 }),
      copy: fitC(c, t.copy, { font: 'inter-600', width: 876, maxLines: 7, max: por(c, 38, 36, 36), min: 30, lineHeight: por(c, 1.36, 1.3, 1.28) }),
    };
    if (c.f !== 'SQUARE_1_1') text.support = fitC(c, t.support, { font: 'inter-800', width: 900, maxLines: 2, max: por(c, 44, 38, 36), min: 34 });
    // bloco de baixo (verde + apoio + texto) contra legenda queimada: o apoio é texto solto; se ele (ou um vão) cair em
    // cima da faixa, reordena verde → texto (opacos, colados) → apoio e posiciona os opacos COBRINDO a faixa; senão,
    // tenta o bloco inteiro abaixo dela
    const greenH = text.headline.height + 2 * n.greenPadY + 6, copyH = text.copy.height + 2 * n.copyPadY, supH = text.support?.height ?? 0;
    const grupoH = greenH + n.gap + (supH ? supH + n.gap : 0) + copyH;
    const fim = c.H - c.safe.bottom;
    const topoNormal = fim - grupoH;
    const supY = topoNormal + greenH + n.gap;
    const normalOk = livre(c, topoNormal, topoNormal + greenH, true) && (!supH || livre(c, supY, supY + supH + n.gap, false)) && livre(c, fim - copyH, fim, true)
      && livre(c, topoNormal + greenH, topoNormal + greenH + n.gap, false);
    let storyTop = -1, storyCobre = 0;
    if (!normalOk) {
      const b = colide(c, topoNormal, fim)!;
      const t0 = b.y0 - 12, h2 = greenH + 6 + copyH + (supH ? n.gap + supH : 0);
      if (t0 + greenH + 6 + copyH >= b.y1 + 8 && t0 + h2 <= fim && livre(c, t0, t0 + greenH + 6 + copyH, true)) { storyTop = t0; storyCobre = 1; }
      else if (b.y1 + 16 + grupoH <= fim) storyTop = b.y1 + 16;
    }
    // slots de verdade (pra checagem da legenda protegida): o cartão de cima e o bloco de baixo; `column` é só a coluna
    const cartaoH = 2 * n.headPad + alturaLinhaNormal('inter-800', n.headSize) + 2 * n.bodyPadY + 6 + text.question.height;
    const grupoY = storyTop >= 0 ? storyTop : topoNormal;
    const grupoAlt = storyTop >= 0 && storyCobre ? greenH + 6 + copyH + (supH ? n.gap + supH : 0) : grupoH;
    return {
      videoBox: R(0, 0, c.W, c.H),
      slots: { column: R(M, n.top, c.W - 2 * M, c.H - c.safe.bottom - n.top), cartao: R((c.W - n.cardW) / 2, n.top, n.cardW, cartaoH), grupo: R(M, grupoY, c.W - 2 * M, grupoAlt) },
      text, n: { ...n, storyTop, storyCobre }, bg: '#000',
    };
  },
};

/**
 * Layout da moldura num formato (§B2/§B4): caixas do vídeo, da 2ª fonte e do rosto, slots de texto e textos já ajustados.
 * Puro e determinístico (a medida de texto é a tabela de src/lib/metricas-fontes.ts). O 9:16 é o protótipo aprovado;
 * 4:5 e 1:1 têm layout próprio (não é o 9:16 encolhido).
 */
/** Faixas que se tocam (ou ficam a < 24 px) viram uma só: a legenda que muda de posição/altura ao longo do vídeo vira a
 *  UNIÃO das posições, e o texto da moldura desvia do bloco inteiro (bug 26/10). */
export const unirFaixas = (fs: Faixa[]) => {
  const o = [...fs].sort((a, b) => a.y0 - b.y0);
  const out: Faixa[] = [];
  for (const f of o) {
    const u = out[out.length - 1];
    if (u && f.y0 <= u.y1 + 24) { u.y1 = Math.max(u.y1, f.y1); u.protegida = !!(u.protegida || f.protegida); } else out.push({ ...f });
  }
  return out;
};

/** Opções que dependem da mídia (não do texto). `slideImage`: a `call` tem 2ª fonte de imagem (product_photo /
 *  page_capture) pra mostrar dentro do slide da apresentação. */
export interface FrameLayoutOptions {
  slideImage?: boolean;
  /** faixas de legenda queimada em px da SAÍDA (faixasNaSaida): os textos sobre o vídeo cheio desviam delas */
  faixas?: Faixa[];
}
/** As opções de layout a partir da 2ª fonte da peça (a composição e o buildFrameInput usam a mesma regra). */
export const opcoesDeLayout = (second: { kind: string } | null | undefined): FrameLayoutOptions => ({
  slideImage: second?.kind === 'product_photo' || second?.kind === 'page_capture',
});

export const frameLayout = <K extends FrameTemplateId>(id: K, format: VideoFormat, texts: FrameTextsMap[K], language = 'pt', opts: FrameLayoutOptions = {}): FrameLayout => {
  const { width: W, height: H } = FORMATOS[format];
  const c: Ctx = { f: format, W, H, safe: FRAME_SAFE[format], ui: frameUi(language), slideImage: !!opts.slideImage && id === 'call', cjk: cjkDe(language), faixas: unirFaixas(opts.faixas ?? []) };
  const l = (LAYOUTS[id] as (c: Ctx, t: FrameTextsMap[K]) => Lay)(c, texts);
  return { id, format, canvas: { w: W, h: H }, safe: c.safe, ...l };
};

/** Textos que não couberam (FRAME_TEXT_OVERFLOW no buildFrameInput). Vazio = ok. */
export const textosQueNaoCouberam = (l: FrameLayout) => Object.entries(l.text).filter(([, t]) => !t.fits).map(([k, t]) => ({ slot: k, overflow: t.overflow, size: t.size, lines: t.lines.length }));

/**
 * Layout da peça inteira (o que a composição desenha e o buildFrameInput valida): frameLayout com a imagem do slide
 * (call) e as faixas de legenda queimada do campeão já mapeadas pra saída (pelo reenquadramento da caixa do vídeo).
 */
export const layoutDaPeca = (p: Pick<MolduraProps, 'format' | 'language' | 'frame' | 'video' | 'second' | 'captionMode'>): FrameLayout => {
  const id = p.frame.id;
  const texts = p.frame.texts as FrameTextsMap[typeof id];
  const base: FrameLayoutOptions = opcoesDeLayout(p.second);
  const L0 = frameLayout(id, p.format, texts, p.language, base);
  // texto queimado (desvia, pode ser coberto por bloco opaco) + legenda protegida (desvia, nunca coberta); no modo
  // 'replace' a legenda foi recortada pra fora e a nossa entra no lugar: as faixas protegidas não valem mais
  const cb = p.video.contentBox ?? null;
  const prot = p.captionMode === 'replace' ? [] : (p.video.protectedBands ?? []).map((b) => ({ y: b.y, h: b.h, startSec: b.startSec, endSec: b.endSec }));
  const faixas: Faixa[] = [
    ...faixasNaSaida(p.video.burnedTextBands, p.video.source, p.video.reframe, L0.videoBox, cb),
    ...faixasNaSaida(prot, p.video.source, p.video.reframe, L0.videoBox, cb, 0).map((f) => ({ ...f, protegida: true })),
  ];
  return faixas.length ? frameLayout(id, p.format, texts, p.language, { ...base, faixas }) : L0;
};
