// Mock determinístico dos roteiros dos templates grátis (iterate-v2-quiz-templates-ia F1.2/F1.7). Tudo sai da fala do
// campeão (com srcSpan) e do Brain (com a fonte): nada inventado, nenhum número que não esteja lá, nenhuma marca.
// Gatilho nas notes da OFERTA:
//   [mock:prospect-testimonial] → a 1ª chamada põe um relato de resultado na boca de quem pergunta (violação
//                                  `prospect_testimonial`); a de reparo (com `violations`) devolve o chat certo.
// (`[mock:template-overflow:<TYPE>]` mora no build do render: edicao.service.)
// Lista (templates-lista-v1 §2.3, LIST_OVERLAY Versus / Value stack), gatilhos nas notes da OFERTA:
//   [mock:list-thin]     → só 1 linha ancorada na fala; o resto sai do Brain (anchor null) → o backend marca fill 'pending'.
//   [mock:list-no-room]  → o plano sai normal; quem força `posicionarLista = none` é o backend (`mockListNoRoom(notes)`).
//   [mock:list-invented] → a 1ª chamada (sem `violations`) põe um número inventado numa linha; a de reparo vem limpa.
import type {
  AutoChatDmDraft, AutoListOverlayDraft, AutoPersonMotionDraft, AutoPlanInput, CopySource, ListLineDraft, ListTemplateId, ListTextDraft, PersonBeatDraft, TemplateText, TranscriptWord,
} from '../contrato';

type Bloco = { label: string; function: string; startSec: number; endSec: number; onScreen: string; speech: string };
const r2 = (n: number) => Math.round(n * 100) / 100;
const semDigito = (x: string) => x.replace(/[0-9]+[%.,]?[0-9]*/g, '').replace(/\s+/g, ' ').trim();
const semEspaco = (lang: string) => /^(zh|ja)/i.test(lang);
/** Corta em `max` caracteres visíveis (latino: na fronteira de palavra; CJK: no caractere). */
const cortar = (s: string, max: number, lang: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const cs = [...t];
  if (cs.length <= max) return t;
  if (semEspaco(lang)) return cs.slice(0, max).join('').replace(/[，、,]$/, '');
  const c = cs.slice(0, max + 1).join('');
  const sp = c.lastIndexOf(' ');
  return (sp > max * 0.5 ? c.slice(0, sp) : cs.slice(0, max).join('')).replace(/[\s,;:–—-]+$/, '');
};
/** 1ª frase de um trecho de fala. */
const frase = (s: string) => ((s ?? '').trim().match(/^[^.!?。！？\n]+[.!?。！？]?/) ?? [''])[0].trim();

const CHROME: Record<string, AutoChatDmDraft['chrome']> = {
  en: { typing: 'typing…', inputPlaceholder: 'Message…', profileStatus: 'Active now' },
  pt: { typing: 'digitando…', inputPlaceholder: 'Mensagem…', profileStatus: 'Online agora' },
  es: { typing: 'escribiendo…', inputPlaceholder: 'Mensaje…', profileStatus: 'Activo ahora' },
  'zh-tw': { typing: '正在輸入…', inputPlaceholder: '傳送訊息…', profileStatus: '目前在線上' },
  zh: { typing: '正在输入…', inputPlaceholder: '发送消息…', profileStatus: '在线' },
  ja: { typing: '入力中…', inputPlaceholder: 'メッセージ…', profileStatus: 'オンライン' },
};
const chromeDe = (lang: string) => {
  const l = lang.toLowerCase();
  if (l.startsWith('zh')) return /(-tw|-hk|-mo|hant)/.test(l) ? CHROME['zh-tw'] : CHROME.zh;
  return CHROME[l.slice(0, 2)] ?? CHROME.en;
};
/** Relato de resultado (só pro gatilho [mock:prospect-testimonial]). */
const RESULTADO: Record<string, string> = { en: 'It worked for me, I finally got results', pt: 'Funcionou pra mim, consegui resultado', es: 'Me funcionó, por fin vi resultados' };

function blocosDe(i: AutoPlanInput): Bloco[] {
  const t = i.teardown.structure;
  return t.status === 'ok' && t.data ? t.data.blocks : [];
}
const fala = (words: TranscriptWord[], a: number, b: number, lang: string) => {
  const ws = words.filter((w) => w.startSec >= a - 0.05 && w.startSec < b);
  return ws.reduce((s, w, k) => s + (k && !semEspaco(lang) ? ' ' : '') + w.word.trim(), '').trim();
};
const daFala = (text: string, a: number, b: number): TemplateText => ({ text, source: 'transcript', srcSpan: { startSec: r2(a), endSec: r2(b) } });
const doBrain = (text: string, source: CopySource): TemplateText => ({ text, source });

/** Roteiro do chat a partir da fala e do Brain (6 mensagens: pergunta, 2 respostas, objeção, resposta, oferta). */
export function mockChatDm(i: AutoPlanInput): AutoChatDmDraft | null {
  const lang = i.screenLanguage;
  const bs = blocosDe(i).filter((b) => b.endSec > b.startSec);
  if (bs.length < 2) return null;
  const linha = (b: Bloco, max: number) => cortar(frase(b.speech) || fala(i.transcript, b.startSec, b.endSec, lang), max, lang);
  const hookB = bs[0];
  const hookOnScreen = i.teardown.hook.status === 'ok' ? i.teardown.hook.data?.onScreenText ?? null : null;
  const hookTxt = cortar(hookOnScreen || linha(hookB, 40), 40, lang);
  const meio = bs.slice(1);
  const pegar = (k: number) => meio[k % meio.length];
  const b1 = pegar(0), b2 = pegar(1), b3 = pegar(2);
  const objecao = cortar(frase(b2.speech) || linha(b2, 90), 90, lang);
  // nada de marca no texto do template: campo do Brain com o nome da oferta/workspace não entra
  const marcas = [i.offer.name, i.workspace?.name].filter((x): x is string => !!x && x.trim().length >= 3).map((x) => x.toLowerCase());
  const semMarca = (x: string) => (marcas.some((m) => x.toLowerCase().includes(m)) ? '' : x);
  const promessa = semMarca(semDigito(i.offer.promise ?? ''));
  const oQue = semMarca(semDigito(i.offer.what ?? ''));
  const cta = semMarca(semDigito(i.offer.cta ?? ''));
  const ctaSpoken = i.teardown.offerProofCta.status === 'ok' ? i.teardown.offerProofCta.data?.ctaSpoken ?? '' : '';
  const ctaTxt: TemplateText = cta ? doBrain(cortar(cta, 28, lang), 'cta') : daFala(cortar(ctaSpoken || linha(bs[bs.length - 1], 28), 28, lang), bs[bs.length - 1].startSec, bs[bs.length - 1].endSec);
  const ofertaTitulo: TemplateText = oQue ? doBrain(cortar(oQue, 24, lang), 'what') : daFala(cortar(linha(bs[bs.length - 1], 24), 24, lang), bs[bs.length - 1].startSec, bs[bs.length - 1].endSec);
  const beneficios: TemplateText[] = [
    ...(promessa ? [doBrain(cortar(promessa, 40, lang), 'promise')] : []),
    daFala(cortar(linha(b3, 40), 40, lang), b3.startSec, b3.endSec),
  ].slice(0, 3);
  const pergunta = i.offer.notes?.includes('[mock:prospect-testimonial]') && !i.violations?.length
    ? daFala(RESULTADO[lang.slice(0, 2)] ?? RESULTADO.en, hookB.startSec, hookB.endSec)
    : daFala(cortar(linha(hookB, 90), 90, lang), hookB.startSec, hookB.endSec);
  return {
    type: 'CHAT_DM',
    hook: { ...daFala(hookTxt, hookB.startSec, hookB.endSec), highlight: null },
    chrome: chromeDe(lang),
    messages: [
      { from: 'prospect', kind: 'question', text: pergunta, preserves: ['hook', 'pain'] },
      { from: 'brand', kind: 'answer', text: daFala(linha(b1, 90), b1.startSec, b1.endSec), preserves: ['pain'] },
      { from: 'brand', kind: 'answer', text: daFala(linha(b3, 90), b3.startSec, b3.endSec), preserves: ['mechanism'] },
      { from: 'prospect', kind: 'objection', text: daFala(objecao, b2.startSec, b2.endSec), preserves: ['objection'] },
      { from: 'brand', kind: 'answer', text: daFala(linha(b2, 90), b2.startSec, b2.endSec), preserves: ['proof'] },
      // mais 2 respostas da marca (a fala do resto do vídeo): o chat fecha 18-40 s de leitura
      ...[bs[bs.length - 1], meio[Math.floor(meio.length / 2)]].map((b) => ({ from: 'brand' as const, kind: 'answer' as const, text: daFala(cortar(b.speech || linha(b, 90), 90, lang), b.startSec, b.endSec), preserves: [] })),
      { from: 'brand', kind: 'offer', text: ofertaTitulo, right: beneficios, preserves: ['offer', 'cta'] },
    ],
    close: { lines: [promessa ? doBrain(cortar(promessa, 32, lang), 'promise') : daFala(cortar(linha(hookB, 32), 32, lang), hookB.startSec, hookB.endSec)] },
    cta: { button: ctaTxt, note: null },
    proof: [],
  };
}

/** Roteiro do pessoa + motion: gancho + blocos do meio + CTA (18-40 s), 1 cena por trecho ancorada na 1ª palavra dele. */
export function mockPersonMotion(i: AutoPlanInput): AutoPersonMotionDraft | null {
  const lang = i.screenLanguage;
  const words = i.transcript;
  const bs = blocosDe(i).filter((b) => b.endSec > b.startSec);
  if (bs.length < 2 || !words.length) return null;
  const dur = i.media.durationSec;
  const ctaIdx = [...bs.keys()].reverse().find((k) => /cta|offer/i.test(bs[k].function)) ?? bs.length - 1;
  const escolhidos: { startSec: number; endSec: number }[] = [];
  const add = (a: number, b: number) => { if (b - a >= 1) escolhidos.push({ startSec: r2(a), endSec: r2(Math.min(b, dur)) }); };
  add(bs[0].startSec, Math.min(bs[0].endSec, bs[0].startSec + 8));
  const ctaSpan = { a: bs[ctaIdx].startSec, b: Math.min(bs[ctaIdx].endSec, bs[ctaIdx].startSec + 10) };
  let total = escolhidos.reduce((s, x) => s + x.endSec - x.startSec, 0) + (ctaIdx > 0 ? ctaSpan.b - ctaSpan.a : 0);
  for (let k = 1; k < bs.length && escolhidos.length < 5; k++) {
    if (k === ctaIdx) continue;
    if (total >= 30) break;
    const len = Math.min(bs[k].endSec - bs[k].startSec, 38 - total);
    if (len < 2) continue;
    add(bs[k].startSec, bs[k].startSec + len);
    total += len;
  }
  if (ctaIdx > 0) add(ctaSpan.a, ctaSpan.b);
  escolhidos.sort((x, y) => x.startSec - y.startSec);
  const spans = escolhidos.filter((s, k) => k === 0 || s.startSec >= escolhidos[k - 1].endSec);
  const soma = spans.reduce((s, x) => s + x.endSec - x.startSec, 0);
  if (spans.length < 2 || soma < 17) return null;
  const cta = semDigito(i.offer.cta ?? '');
  const ctaSpoken = i.teardown.offerProofCta.status === 'ok' ? i.teardown.offerProofCta.data?.ctaSpoken ?? '' : '';
  const botao: TemplateText = cta ? doBrain(cortar(cta, 28, lang), 'cta') : daFala(cortar(ctaSpoken || fala(words, ctaSpan.a, ctaSpan.b, lang), 28, lang), ctaSpan.a, ctaSpan.b);
  const beats: PersonBeatDraft[] = [];
  spans.forEach((s, k) => {
    const idx = words.findIndex((w) => w.startSec >= s.startSec - 0.05 && w.startSec < s.endSec);
    if (idx < 0) return;
    const fim = words.reduce((u, w, j) => (w.startSec < s.endSec && w.startSec >= s.startSec - 0.05 ? j : u), idx);
    const ultimo = k === spans.length - 1;
    if (ultimo) {
      beats.push({ spanIndex: k, atWord: idx, untilWord: fim, kind: 'cta', button: botao, note: null });
      return;
    }
    const txt = cortar(fala(words, s.startSec, Math.min(s.endSec, s.startSec + 3), lang), 24, lang);
    const meio = Math.min(fim, idx + Math.max(1, Math.floor((fim - idx) / 2)));
    beats.push({ spanIndex: k, atWord: idx, untilWord: meio, kind: 'kinetic', words: [daFala(txt || '…', s.startSec, s.endSec)] });
    if (meio < fim) {
      const t2 = cortar(fala(words, words[meio + 1]?.startSec ?? s.startSec, s.endSec, lang), 20, lang);
      if (t2) beats.push({ spanIndex: k, atWord: meio + 1, untilWord: fim, kind: 'badge', text: daFala(t2, s.startSec, s.endSec) });
    }
  });
  return { type: 'PERSON_MOTION', spans: spans.map((s) => ({ ...s, preserves: [] })), beats, endCard: { proof: [], cta: { button: botao, note: null } } };
}

// ───────────────────────── lista (templates-lista-v1 §2) ─────────────────────────

/** Gatilho de QA pro backend: com isto nas notes da oferta, o fake do `posicionarLista` devolve `none` (fit `no_room`). */
export const mockListNoRoom = (notes: string | null | undefined): boolean => !!notes?.includes('[mock:list-no-room]');

const ROTULO_RUIM: Record<string, string> = { en: 'Other ways', pt: 'Outros jeitos', es: 'Otras formas' };
const ROTULO_PILHA: Record<string, string> = { en: 'What you get', pt: 'O que você leva', es: 'Lo que te llevas' };
const INVENTADO = '97% ';
/** Frases da fala (fecham em . ! ? 。 ！ ？), cada uma com o índice global da 1ª palavra (a âncora). */
function frasesDaFala(words: TranscriptWord[], lang: string): { text: string; k: number }[] {
  const out: { text: string; k: number }[] = [];
  let cur: string[] = [], k0 = 0;
  words.forEach((w, k) => {
    if (!cur.length) k0 = k;
    cur.push(w.word.trim());
    if (/[.!?。！？]$/.test(w.word.trim()) || k === words.length - 1) {
      out.push({ text: cur.join(semEspaco(lang) ? '' : ' '), k: k0 });
      cur = [];
    }
  });
  return out;
}
/** Pedaços de um campo do Brain (frases, depois vírgulas), sem dígito, ≥ 2 palavras. */
const pedacos = (x: string | null | undefined) =>
  (x ?? '').split(/[\n.!?;,]+/).map((t) => semDigito(t.replace(/["“”]/g, ''))).filter((t) => t.split(' ').length >= 2);

/** Linhas da lista a partir da fala (âncora = 1ª palavra do bloco) e do Brain (com o campo). Nada inventado (fora do gatilho). */
export function mockListOverlay(i: AutoPlanInput, id: ListTemplateId): AutoListOverlayDraft | null {
  const lang = i.screenLanguage;
  const l2 = lang.toLowerCase().slice(0, 2);
  const notes = i.offer.notes ?? '';
  const thin = notes.includes('[mock:list-thin]');
  const inventar = notes.includes('[mock:list-invented]') && !i.violations?.length;
  const words = i.transcript;
  const marcas = [i.offer.name, i.workspace?.name].filter((x): x is string => !!x && x.trim().length >= 3).map((x) => x.toLowerCase());
  const semMarca = (x: string) => (marcas.some((m) => x.toLowerCase().includes(m)) ? '' : x);
  // frases da fala: a última é o CTA falado (com ≥ 3); 1ª metade do resto = o lado ruim, 2ª metade = o bom / os benefícios
  const frases = frasesDaFala(words, lang);
  const ctaFalado = frases.length >= 3 ? frases[frases.length - 1] : undefined;
  const corpo = ctaFalado ? frases.slice(0, -1) : frases;
  const metade = Math.ceil(corpo.length / 2);
  /** frase (sem dígito nem marca) no limite, ancorada na 1ª palavra; null = sem fala útil */
  const daFalaL = (f: { text: string; k: number }, max: number): ListTextDraft | null => {
    const t = cortar(semMarca(semDigito(f.text)).replace(/[.!?。！？]+$/, ''), max, lang);
    return t ? { text: t, source: 'transcript', field: null, anchorWordIndex: f.k } : null;
  };
  const doBrainL = (field: ListTextDraft['field'], text: string, max: number): ListTextDraft | null => {
    const t = cortar(semMarca(text), max, lang);
    return t ? { text: t, source: 'brain', field, anchorWordIndex: null } : null;
  };
  // [mock:list-thin]: só a 1ª linha da fala entra; o resto vem do Brain
  let falaRestante = thin ? 1 : Infinity;
  const tomarFala = (b: { text: string; k: number } | undefined, max: number) => {
    if (!b || falaRestante <= 0) return null;
    const t = daFalaL(b, max);
    if (t) falaRestante--;
    return t;
  };
  const doCampo = (campos: ('pains' | 'promise' | 'what' | 'proof')[], max: number) => {
    const fila = campos.flatMap((f) => pedacos(i.offer[f]).map((t) => [f, t] as const));
    let k = 0;
    return () => {
      while (k < fila.length) {
        const [f, t] = fila[k++];
        const out = doBrainL(f, t, max);
        if (out) return out;
      }
      return null;
    };
  };
  const problema = corpo.slice(0, metade);
  const beneficio = corpo.slice(metade);

  if (id === 'versus') {
    const P = i.list?.versus?.maxPairs === 4 ? 4 : 3;
    const ruimBrain = doCampo(['pains'], 24);
    const bomBrain = doCampo(['promise', 'what', 'proof'], 24);
    const ruins: ListTextDraft[] = [], bons: ListTextDraft[] = [];
    for (let k = 0; k < P; k++) {
      const r = tomarFala(problema[k], 24) ?? ruimBrain();
      const b = tomarFala(beneficio[k], 24) ?? bomBrain();
      if (!r || !b) break;
      ruins.push(r);
      bons.push(b);
    }
    if (ruins.length < 1) return null;
    if (inventar) bons[0] = { ...bons[0], text: cortar(INVENTADO + bons[0].text, 24, lang) };
    const nome = cortar(i.offer.name ?? '', 14, lang);
    if (!nome) return null;
    return {
      type: 'LIST_OVERLAY', templateId: 'versus', order: 'by_speech',
      heads: { bad: { text: ROTULO_RUIM[l2] ?? ROTULO_RUIM.en, source: 'generic', field: null, anchorWordIndex: null }, good: { text: nome, source: 'brain', field: 'name', anchorWordIndex: null } },
      title: null,
      lines: [...ruins.map((t): ListLineDraft => ({ ...t, side: 'bad', kind: 'item' })), ...bons.map((t): ListLineDraft => ({ ...t, side: 'good', kind: 'item' }))],
    };
  }

  // value-stack: itens (fala, depois promise/what) + prova (número do proof) + preço (offerAndPrice) + CTA; ≤ 5 barras
  const provaTxt = ((i.offer.proof ?? '').split(/(?<=[.!?;])\s+|\n+/).map((t) => t.replace(/["“”]/g, '').trim()).find((t) => /[0-9]/.test(t)) ?? '');
  const provaCort = provaTxt ? cortar(semMarca(provaTxt), 30, lang) : '';
  const prova: ListTextDraft | null = provaCort && /[0-9]/.test(provaCort) ? { text: provaCort, source: 'brain', field: 'proof', anchorWordIndex: null } : null;
  const preco = (i.offer.offerAndPrice ?? '').trim() ? doBrainL('offerAndPrice', i.offer.offerAndPrice!.trim(), 34) : null;
  const cta = (i.offer.cta ?? '').trim() ? doBrainL('cta', semDigito(i.offer.cta!), 22) : ctaFalado ? daFalaL(ctaFalado, 22) : null;
  if (!cta) return null;
  const nItens = Math.max(2, Math.min(4, 4 - (prova ? 1 : 0) - (preco ? 1 : 0)));
  const itemBrain = doCampo(['promise', 'what'], 30);
  const itens: ListTextDraft[] = [];
  for (const b of corpo.slice(1)) {
    if (itens.length >= nItens) break;
    const t = tomarFala(b, 30);
    if (t) itens.push(t);
  }
  while (itens.length < nItens) {
    const t = itemBrain();
    if (!t) break;
    itens.push(t);
  }
  if (itens.length + (prova ? 1 : 0) < 3) return null;
  if (inventar) itens[0] = { ...itens[0], text: cortar(INVENTADO + itens[0].text, 30, lang) };
  const lines: ListLineDraft[] = [
    ...itens.map((t): ListLineDraft => ({ ...t, side: null, kind: 'item' })),
    ...(prova ? [{ ...prova, side: null, kind: 'proof' } as ListLineDraft] : []),
    ...(preco ? [{ ...preco, side: null, kind: 'price' } as ListLineDraft] : []),
    { ...cta, side: null, kind: 'cta' } as ListLineDraft,
  ].slice(0, 5);
  return {
    type: 'LIST_OVERLAY', templateId: 'value-stack', order: 'by_speech', heads: null,
    title: { text: ROTULO_PILHA[l2] ?? ROTULO_PILHA.en, source: 'generic', field: null, anchorWordIndex: null },
    lines,
  };
}
