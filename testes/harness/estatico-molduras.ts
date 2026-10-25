// Harness do estático "anúncio montado" (Parte A) e das molduras (Parte B) — docs/contratos/estatico-montado-e-molduras-v1.md
// (APROVADO 25/10). Dono: maquina-qa. Oráculo PRÓPRIO do QA: não importa nada de api/ (o léxico de afirmações, os limites e o
// contraste são reescritos aqui a partir do texto do contrato, pra o teste não herdar o bug do código que ele testa).
import { expect } from '@playwright/test';
import { as } from './api.ts';
import { q } from './db.ts';
import { BRAIN_CHEIO } from './iterate.ts';

// ───────────────────────── Brains de fixture ─────────────────────────
/** Brain cheio do iterate (tem trial, garantia e preço "9.99" sem símbolo de moeda). */
export { BRAIN_CHEIO };
/** Sem oferta, sem prova, sem CTA: nada de grátis/garantia/preço pode aparecer em lugar nenhum (§A3.1). */
export const BRAIN_SEM_OFERTA = {
  ...BRAIN_CHEIO,
  proof: null, offerAndPrice: null, cta: null,
  promise: 'Find money you forgot you were spending.',
  what: 'A budgeting app that finds forgotten subscriptions.',
};
/** Dois preços com moeda: `direct_offer` pode ter `from` e `to` (§B5). */
export const BRAIN_PRECO_DUPLO = { ...BRAIN_CHEIO, language: 'pt-BR', offerAndPrice: 'De R$ 197,00 por R$ 97,90 no plano anual. Garantia de 7 dias.' };
/** Um preço com moeda: `from` tem que ser null. */
export const BRAIN_PRECO_UNICO = { ...BRAIN_CHEIO, offerAndPrice: 'Only $19.99 a month. Cancel anytime.' };
/** Número sem moeda: `direct_offer` fora de allowedFrames (`no_price`). */
export const BRAIN_SEM_PRECO = { ...BRAIN_CHEIO, offerAndPrice: '7-day free trial. Cancel anytime.' };

// ───────────────────────── léxico de afirmações (§A3.2 item 2) ─────────────────────────
/** Famílias de termo que exigem dado no Brain/fala. pt, en, es. Outros idiomas = só a regra de número. */
export const FAMILIAS: Record<string, RegExp> = {
  gratis: /\b(gr[aá]tis|gratuit[oa]s?|free|trial|teste|prueba|gratis)\b/i,
  garantia: /\b(garantia|garant[ií]a|guarantee[ds]?|reembolso|refund(s|ed)?|devolu[cç][aã]o)\b/i,
  desconto: /(\b(desconto|descuento|off|promo[cç][aã]o|promoci[oó]n|sale|oferta\s+rel[aâ]mpago)\b|%)/i,
  plataforma: /\b(ios|android|app\s*store|google\s*play|iphone)\b/i,
  autoridade: /\b(especialista|m[eé]dic[oa]s?|doctor[es]?|doctors?|clinically|cl[ií]nicamente|aprovad[oa]|approved|certificad[oa]|certified|estudo|study|studies|estudio|cient[ií]fic[oa]|scientific)\b/i,
  ranking: /(n[º°o]\s*1\b|#\s*1\b|\bnúmero\s+1\b|\bmelhor\b|\bbest\b|\bmejor\b)/i,
  semRisco: /(sem\s+risco|risk[-\s]?free|sin\s+riesgo)/i,
};
export const familiasEm = (texto: string | null | undefined): string[] =>
  texto ? Object.entries(FAMILIAS).filter(([, re]) => re.test(texto)).map(([k]) => k) : [];
export const numerosEm = (s: string | null | undefined) => (s?.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ''));

/** Contexto "nada inventado" do lote: campos do Brain + transcrição do campeão. */
export interface Ctx { brain: Record<string, string | null>; fala: string }
export async function ctxDoLote(batchId: string): Promise<Ctx> {
  const [c] = await q(`select o.name, o.kind, o.what, o.audience, o.pains, o.promise, o.proof, o.offer_and_price, o.cta, o.notes, t.transcript
                         from variation_batches b join offers o on o.id = b.offer_id left join teardowns t on t.champion_id = b.champion_id where b.id = $1`, [batchId]);
  return {
    brain: { name: c.name, kind: c.kind, what: c.what, audience: c.audience, pains: c.pains, promise: c.promise, proof: c.proof, offerAndPrice: c.offer_and_price, cta: c.cta, notes: c.notes },
    fala: (c.transcript?.words ?? []).map((w: any) => w.word).join(' '),
  };
}
const fontesDe = (ctx: Ctx) => [...Object.values(ctx.brain), ctx.fala].filter(Boolean).join(' \n ');

/** Texto inventado? Devolve as violações (vazio = ok). Regra do QA: número fora do Brain/fala; família sem a mesma família na fonte. */
export function inventado(texto: string | null | undefined, ctx: Ctx): string[] {
  if (!texto) return [];
  const fonte = fontesDe(ctx);
  const nums = new Set(numerosEm(fonte));
  const out: string[] = [];
  for (const n of numerosEm(texto)) if (!nums.has(n)) out.push(`número "${n}" não está no Brain/fala`);
  const famFonte = new Set(familiasEm(fonte));
  for (const f of familiasEm(texto)) if (!famFonte.has(f)) out.push(`afirmação "${f}" sem fonte`);
  return out;
}

// ───────────────────────── STATIC V2 (§A2/§A3.1) ─────────────────────────
const BRIEF_FIELDS = ['what', 'audience', 'pains', 'promise', 'proof', 'offerAndPrice', 'cta', 'notes', 'name', 'kind'];
/** Fontes aceitas por campo (§A3.1). `generic` só onde a coluna "generic pode?" diz sim. */
export const FONTE_ACEITA: Record<string, { fontes: string[]; generic: boolean }> = {
  brandLine: { fontes: ['what', 'kind', 'promise'], generic: false },
  tagline: { fontes: ['promise', 'pains', 'transcript'], generic: true },
  headline: { fontes: ['promise', 'pains', 'transcript'], generic: false },
  subheadline: { fontes: ['what', 'promise', 'proof', 'offerAndPrice', 'transcript'], generic: false },
  handwritten: { fontes: [...BRIEF_FIELDS, 'transcript'], generic: true },
  benefits: { fontes: ['what', 'promise', 'pains', 'proof', 'offerAndPrice'], generic: false },
  trust: { fontes: ['proof', 'offerAndPrice', 'what', 'notes'], generic: false },
  ctaMain: { fontes: ['cta', 'transcript'], generic: true },
  ctaSub: { fontes: ['offerAndPrice', 'cta'], generic: false },
  closing: { fontes: [...BRIEF_FIELDS, 'transcript'], generic: true },
  screenTitle: { fontes: ['what', 'name', 'kind'], generic: false },
};
export const ICONES = ['moon', 'sun', 'clock', 'calendar', 'check', 'shield', 'lock', 'heart', 'star', 'lightning', 'home', 'phone', 'chat', 'chart', 'money', 'gift', 'person', 'people', 'play', 'leaf', 'target', 'book', 'spark', 'route'];
export const EMOCOES = ['pain', 'relief', 'desire', 'curiosity', 'pride'];
const palavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Todos os textos de tela do copy (o que a imagem escreve), com a chave do bloco. */
export function textosDoCopy(copy: any, visual?: any): { key: string; text: string }[] {
  const t: { key: string; text: string }[] = [];
  const add = (key: string, v: string | null | undefined) => { if (v) t.push({ key, text: v }); };
  add('brandLine', copy.brandLine); add('tagline', copy.tagline);
  add('headline.lead', copy.headline?.lead); add('headline.highlight', copy.headline?.highlight);
  add('subheadline', copy.subheadline); add('handwritten', copy.handwritten);
  (copy.benefits ?? []).forEach((b: any, i: number) => { add(`benefits.${i}.title`, b.title); add(`benefits.${i}.line`, b.line); });
  (copy.trust ?? []).forEach((b: any, i: number) => add(`trust.${i}`, b.text));
  add('cta.main', copy.cta?.main); add('cta.sub', copy.cta?.sub); add('closing', copy.closing);
  add('screenTitle', visual?.product?.screenTitle);
  return t;
}

/** Confere um `AutoStaticDraftV2` (payload.params do item) contra §A2/§A3.1. Devolve a lista de violações. */
export function confereStaticV2(p: any, ctx: Ctx, brandName: string): string[] {
  const v: string[] = [];
  const err = (m: string) => v.push(m);
  if (p.layout !== 'assembled') err(`layout = ${p.layout} (plano novo = 'assembled')`);
  // TRANSIÇÃO (§C.0): no plano o visual novo vem em `visualV2` (o `visual` pode ser o v1 legado); depois da fusão, `visual`.
  const c = p.copy, vis = p.visualV2 ?? (p.visual?.hero !== undefined || p.visual?.product ? p.visual : null);
  if (!c) return [...v, 'sem copy'];
  const lim = (k: string, s: string | null | undefined, max: number, maxPal?: number) => {
    if (s == null) return;
    if (s.length > max) err(`${k}: ${s.length} > ${max} car.`);
    if (maxPal && palavras(s) > maxPal) err(`${k}: ${palavras(s)} > ${maxPal} palavras`);
  };
  const fonte = (k: string, src: string | null | undefined, presente: boolean) => {
    if (!presente) { if (src != null) err(`${k}: fonte ${src} sem texto`); return; }
    const r = FONTE_ACEITA[k];
    if (!src) return err(`${k}: sem fonte`);
    if (src === 'generic') { if (!r.generic) err(`${k}: 'generic' não pode (§A3.1)`); return; }
    if (!r.fontes.includes(src)) err(`${k}: fonte ${src} não aceita (aceitas: ${r.fontes.join(', ')})`);
    if (src === 'transcript' ? !ctx.fala : !ctx.brain[src]) err(`${k}: fonte ${src} vazia no Brain (unsupported_source)`);
  };
  lim('brandLine', c.brandLine, 32); fonte('brandLine', c.brandLineSource, !!c.brandLine);
  lim('tagline', c.tagline, 32);
  if (!c.headline?.lead || !c.headline?.highlight) err('headline.lead/highlight vazios');
  lim('headline.lead', c.headline?.lead, 45); lim('headline.highlight', c.headline?.highlight, 22);
  if ((c.headline?.lead?.length ?? 0) + (c.headline?.highlight?.length ?? 0) > 60) err('headline lead + highlight > 60');
  fonte('headline', c.headlineSource, true);
  if (c.headlineSource === 'generic') err('headline nunca generic');
  lim('subheadline', c.subheadline, 90); fonte('subheadline', c.subheadlineSource, !!c.subheadline);
  lim('handwritten', c.handwritten, 28, 5);
  const nb = c.benefits?.length ?? 0, nt = c.trust?.length ?? 0;
  if (!(nb === 0 || (nb >= 3 && nb <= 5))) err(`benefits = ${nb} (0 ou 3-5)`);
  if (!(nt === 0 || nt === 3)) err(`trust = ${nt} (0 ou 3)`);
  for (const [i, b] of (c.benefits ?? []).entries()) {
    lim(`benefits.${i}.title`, b.title, 24); lim(`benefits.${i}.line`, b.line, 40);
    if (!ICONES.includes(b.icon)) err(`benefits.${i}.icon fora do enum: ${b.icon}`);
    fonte('benefits', b.source, true);
  }
  for (const [i, b] of (c.trust ?? []).entries()) {
    lim(`trust.${i}`, b.text, 24);
    if (!ICONES.includes(b.icon)) err(`trust.${i}.icon fora do enum: ${b.icon}`);
    fonte('trust', b.source, true);
  }
  if (!c.cta?.main) err('cta.main vazio');
  lim('cta.main', c.cta?.main, 18); lim('cta.sub', c.cta?.sub, 22); fonte('ctaSub', c.cta?.subSource, !!c.cta?.sub);
  lim('closing', c.closing, 50, 9);
  const soma = textosDoCopy(c).reduce((a, x) => a + x.text.length, 0);
  if (soma > 420) err(`soma do copy ${soma} > 420 (static_copy_too_long)`);
  // nada inventado em todo texto + screenTitle
  for (const t of textosDoCopy(c, vis)) for (const m of inventado(t.text, ctx)) err(`${t.key}: ${m} — "${t.text}"`);
  // marca: só no bloco da marca (o backend injeta), nunca em benefits/trust
  const marca = brandName.toLowerCase();
  for (const t of textosDoCopy(c).filter((x) => /^(benefits|trust)/.test(x.key))) if (t.text.toLowerCase().includes(marca)) err(`${t.key}: nome da marca fora do bloco da marca`);
  // visual v2 em inglês, sem aspas e sem marca
  if (!vis) err('sem visual v2');
  else {
    if (vis.hero) {
      if (!EMOCOES.includes(vis.hero.emotion)) err(`hero.emotion fora do enum: ${vis.hero.emotion}`);
      lim('hero.person', vis.hero.person, 200); lim('hero.setting', vis.hero.setting, 160); lim('hero.light', vis.hero.light, 80);
    }
    if (!['phone_screen', 'laptop_screen', 'physical_product', 'none'].includes(vis.product?.kind)) err(`product.kind: ${vis.product?.kind}`);
    lim('product.look', vis.product?.look, 200); lim('product.screenTitle', vis.product?.screenTitle, 24);
    fonte('screenTitle', vis.product?.screenTitleSource, !!vis.product?.screenTitle);
    lim('mood', vis.mood, 100);
    const livres = [vis.hero?.person, vis.hero?.setting, vis.hero?.light, vis.product?.look, vis.mood].filter(Boolean).join(' ');
    if (/["“”]/.test(livres)) err('static_visual_has_text: aspas no visual');
    if (livres.toLowerCase().includes(marca)) err('static_visual_has_brand: marca no visual');
  }
  return v;
}

// ───────────────────────── paleta (§A3.3) ─────────────────────────
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
export function hexRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const luminancia = (hex: string) => { const [r, g, b] = hexRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Contraste WCAG do texto branco sobre `hex`. */
export const contrasteBranco = (hex: string) => 1.05 / (luminancia(hex) + 0.05);
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = hexRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// ───────────────────────── blocos por aspecto (§A4) ─────────────────────────
/** Quais blocos do copy podem aparecer no prompt/checagem de cada aspecto. */
export function blocosEsperados(aspect: '9:16' | '4:5' | '1:1', copy: any): string[] {
  const k: string[] = ['brand', 'headline', 'cta'];
  if (copy.tagline && aspect !== '1:1') k.push('tagline');
  if (copy.subheadline && (aspect !== '1:1' || copy.subheadline.length <= 45)) k.push('subheadline');
  if (copy.handwritten && aspect !== '1:1') k.push('handwritten');
  if (copy.benefits?.length) k.push('benefits');
  if (copy.trust?.length && aspect !== '1:1') k.push('trust');
  if (copy.closing && aspect === '9:16') k.push('closing');
  return k;
}
export const maxCards = (aspect: string) => (aspect === '9:16' ? 5 : 3);

// ───────────────────────── molduras (§B2) ─────────────────────────
export const FRAME_B1 = ['question_box', 'meme', 'cinema', 'news', 'ranking', 'post_card', 'direct_offer', 'story', 'read_caption', 'pov_testimonial', 'live', 'call'] as const;
export const FRAME_B2 = ['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'] as const;
/** Limites de cada texto (§B2). `n` = contagem de itens quando é lista. */
export const FRAME_LIMITES: Record<string, Record<string, number | { n: [number, number]; max: number }>> = {
  question_box: { question: 70 },
  meme: { pov: 70, cta: 28 },
  cinema: { question: 60, subtitle: 80 },
  news: { topic: 18, 'headline.lead': 40, 'headline.highlight': 30, dek: 80, cta: 28 },
  read_caption: { headline: 70, primaryText: 600 },
  pov_testimonial: { pov: 80, cta: 28 },
  direct_offer: { promise: 40, cta: 28 },
  live: {},
  ranking: { title: 24, items: { n: [3, 5], max: 28 } },
  post_card: { copy: 140 },
  story: { question: 70, headline: 40, support: 80, copy: 320 },
  call: { title: 40, slideTitle: 50, slideSteps: { n: [3, 3], max: 32 } },
  split_stack: { headline: 50 }, split_torn: { headline: 50 },
  gossip_page: { headline: 80, pageName: 24 }, gossip_white: { headline: 80 }, gossip_pink: { headline: 80 },
  call_dialog: { title: 40, names: { n: [2, 2], max: 14 } },
};
/** Textos fixos de interface: são do template por idioma, nunca da IA (§B2 "Regras gerais"). */
export const UI_FIXA = [/fa[cç]a uma pergunta/i, /ask (me )?a question/i, /hazme una pregunta/i, /leia a legenda/i, /read the caption/i, /lee la descripci[oó]n/i,
  /toque no bot[aã]o/i, /tap the button/i, /\bao vivo\b/i, /^\s*live\s*$/i, /coment[aá]rios limitados/i, /comments? (are )?limited/i, /^\s*POV\s*:/i, /\bTOP\s*\d\b/i];
const semAsteriscos = (s: string) => s.replace(/\*/g, '');
const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

/** Confere um item FRAME (payload.params: { type:'FRAME', template, texts, sources? }). */
export function confereFrame(p: any, ctx: Ctx): string[] {
  const v: string[] = [];
  const lim = FRAME_LIMITES[p.template];
  if (!lim) return [`template fora do catálogo: ${p.template}`];
  const todos: { k: string; s: string }[] = [];
  for (const [k, r] of Object.entries(lim)) {
    const val = get(p.texts, k);
    if (typeof r === 'number') {
      if (typeof val !== 'string' || !val.trim()) { v.push(`${k} vazio`); continue; }
      const stars = (val.match(/\*/g) ?? []).length;
      if (stars > 2 || stars % 2) v.push(`${k}: destaque com ${stars} asteriscos (máx. 1 trecho)`);
      if (semAsteriscos(val).length > r) v.push(`${k}: ${semAsteriscos(val).length} > ${r}`);
      todos.push({ k, s: semAsteriscos(val) });
    } else {
      const arr = Array.isArray(val) ? val : [];
      if (arr.length < r.n[0] || arr.length > r.n[1]) v.push(`${k}: ${arr.length} itens (${r.n.join('-')})`);
      arr.forEach((x: string, i: number) => { if (semAsteriscos(x).length > r.max) v.push(`${k}.${i}: > ${r.max}`); todos.push({ k: `${k}.${i}`, s: semAsteriscos(x) }); });
    }
  }
  if (p.template === 'direct_offer') {
    const pr = p.texts.price ?? {};
    const oap = ctx.brain.offerAndPrice ?? '';
    if (!pr.to || !oap.includes(pr.to)) v.push(`price.to "${pr.to}" não está literal no offerAndPrice "${oap}"`);
    if (pr.from && !oap.includes(pr.from)) v.push(`price.from "${pr.from}" não está literal no offerAndPrice`);
    const comMoeda = oap.match(/(R\$|US\$|\$|€|£|USD|BRL|EUR)\s?\d/g) ?? [];
    if (pr.from && comMoeda.length < 2) v.push('price.from sem 2 valores no Brain');
  }
  for (const t of todos) {
    for (const m of inventado(t.s, ctx)) v.push(`${t.k}: ${m} — "${t.s}"`);
    for (const re of UI_FIXA) if (re.test(t.s)) v.push(`${t.k}: texto fixo de interface veio da IA (${re}) — "${t.s}"`);
  }
  if (p.template === 'call_dialog') for (const n of p.texts.names ?? []) if (/^[A-ZÁÉÍÓÚ][a-záéíóúãõç]+\s[A-Z]/.test(n)) v.push(`names: parece nome de pessoa "${n}"`);
  return v;
}

// ───────────────────────── disponibilidade (pendente até as entregas) ─────────────────────────
/** A entrega chegou? Lê o config da API do QA. Pendente = o spec marca skip com o motivo, não falha.
 *  E2E_EM_FORCAR=1 roda mesmo assim (pra ver o que falta). */
export async function entrega(): Promise<{ estaticoV2: boolean; molduras: boolean; cfg: any }> {
  const r = await as('donoA').get('/iterate/config');
  const cfg = r.data ?? {};
  const forcar = process.env.E2E_EM_FORCAR === '1';
  return {
    cfg,
    // A-I: STATIC_IMAGE_MODEL 2k = US$ 0,40 (D1). O resto do A se confere no plano (layout 'assembled').
    estaticoV2: forcar || Math.abs((cfg.staticImageUsd ?? 0) - 0.4) < 1e-6,
    // fusão do B1 (§C.0): 'FRAME' entra no AutoVariationType e no config.types
    molduras: forcar || (cfg.types ?? []).includes('FRAME'),
  };
}

/** Itens do lote com o payload (o plano salvo é a fonte da verdade do que a imagem/moldura vai escrever). */
export const itensDoLote = (batchId: string) =>
  q<{ id: string; code: string; auto_type: string; payload: any; index: number }>(`select id, code, auto_type, payload, index from variation_items where batch_id = $1 order by index`, [batchId]);
/** Spec V2 gravado no render (§A5: `Render.input.spec` guarda o spec completo). Aceita `spec` ou `specV2` na transição. */
export const specDoRender = (input: any) => (input?.spec?.layout === 'assembled' ? input.spec : input?.specV2 ?? input?.spec ?? null);
export const renderVigente = async (creativeId: string, format = 'VERTICAL_9_16') =>
  (await q(`select id, status, engine, input, file_id, error_code from renders where creative_id = $1 and format = $2 and not stale order by created_at desc limit 1`, [creativeId, format]))[0];
export const tasksDo = (renderId: string) =>
  q<{ id: string; status: string; kind: string; input: any; error_code: string | null }>(`select id, status, kind, input, error_code from provider_tasks where render_id = $1 order by submitted_at, id`, [renderId]);

/** "Nada pago" do lote: soma de cost_entries = 0 e nenhuma task de provider fora do que o mock fabrica. */
export async function nadaPago(batchId: string) {
  const [{ s }] = await q(`select coalesce(sum(amount_usd),0)::float s from cost_entries where variation_batch_id = $1`, [batchId]);
  expect(s, 'mock: nenhum centavo lançado no lote').toBe(0);
}
