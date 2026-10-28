// Caminhante de funil (A1 do teste manual de 28/10, briefing-leitura-v2 §6.1): quiz/funil de várias etapas só mostra a
// 1ª tela pra leitura (b) — a oferta final (planos, preço, garantia) mora no fim do quiz. Abre a página no mesmo
// chrome-headless-shell (custo US$ 0), confirma que parece quiz (opções de resposta, poucos links internos, progresso),
// e avança tela a tela com a resposta mais neutra: "skip"/"pular" > 1ª opção do grupo > "continue/next" > único botão.
// Preenche nome/e-mail fictício SÓ quando o campo é obrigatório pra avançar. PARA na oferta/pricing/checkout.
// NUNCA: clicar em pagar/comprar/finalizar/assinar, digitar cartão/documento/senha, logar, sair do domínio da oferta
// (exceção: checkout de plataforma do §2.3, lido e parado). Nada sai do navegador: toda requisição que não é GET/HEAD
// (POST de lead, evento, beacon) e todo pixel/analytics conhecido são abortados — o funil do usuário não ganha lead
// falso nem evento de pixel. Tetos: 30 ações, 60 s, 8 000 caracteres por tela; tela repetida = para. Nunca lança.
import { Logger } from '@nestjs/common';
import type { HTTPRequest } from 'puppeteer-core';
import { openPage, shootScreens, type RenderPageOptions, type RenderedShot } from './render-pagina';
import { inOffer, isCheckoutHost, offerScope } from './subpaginas';

export const WALK_LIMITS = {
  /** ações (cliques/preenchimentos). ~25 telas; 30 porque quiz real (Heirloom Jar) leva ~27 ações até a oferta */
  maxActions: 30,
  totalMs: 60_000,
  chars: 8_000,
  /** espera a tela mudar depois de uma ação */
  settleMs: 4_000,
  /** tela sem nada clicável (loader, animação): espera ela avançar sozinha */
  autoWaitMs: 8_000,
  /** tentativas na mesma tela sem ela mudar */
  triesPerScreen: 4,
  /** a mesma tela voltando mais que isso = loop → para ("tela repetida"). Loader que reaparece entre perguntas
   *  pop-up (Heirloom Jar: 3 perguntas no meio da barra) volta 1–3 vezes e não é loop; volta não vira página nova */
  revisits: 3,
  /** prints da tela final (oferta/checkout) pra camada (d) */
  offerShots: 2,
} as const;

/** Dado fictício: só entra em campo obrigatório pra avançar. example.com nunca entrega e-mail (RFC 2606). */
export const FAKE = { email: 'test+hookmill@example.com', firstName: 'Alex', lastName: 'Test', fullName: 'Alex Test', phone: '5555550100', number: '30', text: 'Test' } as const;

export type WalkRole = 'quiz_step' | 'offer' | 'checkout';
export type WalkStop = 'offer' | 'checkout' | 'repeat' | 'stuck' | 'max_actions' | 'timeout' | 'left_domain' | 'login_wall' | 'sensitive_field' | 'not_quiz' | 'error';

export interface WalkScreen {
  /** 1 = a tela de entrada */
  step: number;
  url: string;
  role: WalkRole;
  title: string | null;
  text: string;
  truncated: boolean;
  /** o que o caminhante fez pra sair desta tela (null = parou aqui) */
  action: string | null;
}

export interface WalkResult {
  screens: WalkScreen[];
  stoppedBy: WalkStop;
  actions: number;
  ms: number;
  /** requisições abortadas (POST/beacon/pixel/fora do domínio) — prova de que nada saiu */
  blocked: number;
  /** prints 390×844 @2x da tela final quando parou em oferta/checkout */
  shots: RenderedShot[];
}

export type FunnelWalker = (url: string, opts?: { deadline?: number }) => Promise<WalkResult | null>;

// ------------------------------------------------------------------ snapshot da tela (montado dentro do navegador)

export interface WalkControl {
  key: string;
  tag: string;
  type: string;
  text: string;
  /** aria-label/title/value/name/id/class/href juntos: o que a regra de "proibido" e "voltar" olha além do texto */
  meta: string;
  disabled: boolean;
  pressed: boolean;
  inDialog: boolean;
  isSubmit: boolean;
  form: string | null;
  /** irmãos no mesmo pai e mesma tag = grupo de respostas */
  group: string;
  href: string | null;
  top: number;
}
export interface WalkField {
  key: string;
  tag: string;
  type: string;
  /** name/id/autocomplete/placeholder/label/aria-label */
  hint: string;
  required: boolean;
  filled: boolean;
  inDialog: boolean;
  form: string | null;
  options: string[];
}
export interface WalkSnapshot {
  url: string;
  title: string | null;
  text: string;
  controls: WalkControl[];
  fields: WalkField[];
  dialog: boolean;
  cardField: boolean;
  password: boolean;
  progress: boolean;
  internalLinks: number;
}

// ------------------------------------------------------------------ regras (puras, testadas sem navegador)

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** nunca clicar: pagar, comprar, finalizar, assinar, carrinho, logar, carteira de pagamento. */
const FORBIDDEN = /\b(?:pay|payment|pagar|pague|pagamento|buy|purchase|comprar|compre|compra|checkout|place (?:my |your )?order|complete (?:my |your )?(?:order|purchase)|confirm (?:my |your )?(?:order|payment|purchase)|finalizar|finalize|subscribe|assinar|assine|suscribirse|add to (?:cart|bag)|adicionar ao carrinho|cart|carrinho|carrito|apple pay|google pay|gpay|paypal|pix|boleto|log ?in|sign ?in|entrar|iniciar sesion|continue with (?:google|apple|facebook)|sign up with|card|cartao|tarjeta|stripe|claim (?:my |your )?(?:offer|discount|deal)|unlock now|order now|start (?:my |your )?(?:free )?(?:trial|subscription)|reserve|reservar|garantir (?:minha|meu|a|o)|quero comprar)\b/;
const MONEY = /(?:R\$|US?\$|\$|€|£)\s?\d|\d+[.,]\d{2}\s?(?:usd|brl|eur)\b/i;
/** sinal de oferta: preço + botão de compra (proibido ou de CTA de oferta) na tela. */
const OFFER_CTA = /\b(?:get (?:my|your|the) (?:plan|program|access|jar|kit|offer|discount)|get started now|start now|join now|enroll|inscrever|inscreva|quero (?:o|a|meu|minha|garantir)|choose (?:this |your )?plan|select (?:this |your )?plan|escolher plano|claim|get access|unlock)\b/;
const PRICE_TEXT = /R\$ ?\d|US?\$ ?\d|\$\d|€ ?\d|£ ?\d|\d+x de|\/m[eê]s|\/month|\/mo\b|\/ano|\/year|por m[eê]s|per month|per day|\/day|al mes/i;
const SKIP = /^(?:skip|skip (?:this|question|for now)|not now|maybe later|later|prefer not to (?:say|answer)|i(?:'| a)?m not sure|not sure|pular|pule|agora nao|depois|prefiro nao (?:dizer|responder)|nao sei|omitir|saltar|ahora no)\b/;
const CONTINUE = /^(?:next|continue|continuar|continua|start|start (?:the )?quiz|begin|let'?s (?:go|start|begin)|get started|take the quiz|see (?:my )?(?:results?|plan|profile|answer)|show (?:me|my)|reveal|go|proximo|proxima|avancar|seguir|comecar|iniciar|vamos|ver (?:meu |o |minha )?(?:resultado|plano|perfil)|siguiente|empezar|comenzar|ok|got it|entendi|done|submit|enviar|calculate|calcular)\b/;
const BACK = /(?:^|\b)(?:back|voltar|volver|previous|anterior|prev|close|fechar|cerrar|dismiss|share|compartilhar|menu|logo|home|inicio|language|idioma|privacy|privacidade|terms|termos|cookies?)(?:\b|$)|[←‹«×✕]/;
const SENSITIVE = /\b(?:card|cc-|cartao|tarjeta|cvc|cvv|expir|validade|iban|cpf|cnpj|ssn|social security|passport|rg|documento|password|senha|contrasena|otp|one-time|pin)\b/;

const blob = (c: Pick<WalkControl, 'text' | 'meta'>) => strip(`${c.text} ${c.meta}`);

/** Controle que o caminhante nunca toca (pagar, comprar, logar…) ou cujo rótulo traz preço. */
export function isForbidden(c: Pick<WalkControl, 'text' | 'meta' | 'href'>): boolean {
  if (FORBIDDEN.test(blob(c)) || MONEY.test(c.text)) return true;
  if (c.href) {
    try { if (isCheckoutHost(new URL(c.href).hostname)) return true; } catch { /* href quebrado */ }
  }
  return false;
}

const isBack = (c: WalkControl) => BACK.test(strip(c.text)) || (!c.text.trim() && BACK.test(strip(c.meta)));

/** Papel da tela: checkout (campo de cartão / host de checkout / rota de checkout) > offer (preço + CTA de compra) > quiz_step. */
export function classifyScreen(s: WalkSnapshot): WalkRole {
  let u: URL | null = null;
  try { u = new URL(s.url); } catch { /* fica null */ }
  if (s.cardField || (u && isCheckoutHost(u.hostname)) || (u && /\/(?:checkout|pagamento|payment|cart|carrinho)(?:[/?#]|$)/i.test(u.pathname))) return 'checkout';
  const visible = s.controls;
  const buyControl = visible.some((c) => isForbidden(c) || OFFER_CTA.test(blob(c)));
  if (PRICE_TEXT.test(s.text) && buyControl) return 'offer';
  return 'quiz_step';
}

/** Tela de entrada parece quiz/funil? Opções de resposta ou botão de avançar, poucos links internos, e progresso/dica/tela curta. */
export function looksLikeQuiz(s: WalkSnapshot): boolean {
  if (s.cardField || s.password) return false;
  const pool = usable(s, new Set());
  const groups = answerGroups(pool);
  const hasAdvance = pool.some((c) => CONTINUE.test(strip(c.text)));
  if (!groups.length && !hasAdvance) return false;
  if (s.internalLinks >= 3) return false;
  const hint = /\b(?:quiz|survey|assessment|questionario|questionnaire|teste|test|avaliacao|diagnostico|start|step|etapa|pergunta|question)\b/.test(strip(`${s.url} ${s.title ?? ''}`));
  return s.progress || hint || (groups.length > 0 && s.text.length < 2_500);
}

/** Controles clicáveis que o caminhante pode usar: visível, habilitado, não proibido, não "voltar", não tentado; diálogo aberto manda. */
function usable(s: WalkSnapshot, tried: Set<string>): WalkControl[] {
  let pool = s.controls.filter((c) => !c.disabled && !tried.has(c.key) && !isForbidden(c) && !isBack(c));
  // link só se for da mesma oferta (o filtro de rede também barra, isso aqui evita o clique inútil)
  pool = pool.filter((c) => {
    if (!c.href) return true;
    try {
      const h = new URL(c.href);
      if (!/^https?:$/.test(h.protocol)) return false;
      return inOffer(c.href, offerScope(s.url)) && h.pathname !== new URL(s.url).pathname;
    } catch { return false; }
  });
  if (s.dialog) {
    const inDialog = pool.filter((c) => c.inDialog);
    if (inDialog.length) pool = inDialog;
  }
  return pool;
}

function answerGroups(pool: WalkControl[]): WalkControl[][] {
  const by = new Map<string, WalkControl[]>();
  for (const c of pool) {
    if (c.isSubmit || c.href) continue;
    const list = by.get(c.group) ?? [];
    list.push(c);
    by.set(c.group, list);
  }
  return [...by.values()].filter((g) => g.length >= 2).sort((a, b) => a[0].top - b[0].top);
}

export type WalkAction =
  | { kind: 'click'; key: string; label: string }
  | { kind: 'fill'; fills: { key: string; value: string; tag: string; type: string }[]; then: { key: string; label: string } | null; label: string }
  | { kind: 'wait' }
  | { kind: 'stop'; reason: WalkStop };

/** Valor fictício pro campo; null = campo que nunca preenchemos (cartão, documento, senha) ou sem regra. */
export function fakeValueFor(f: WalkField): string | null {
  const h = strip(`${f.type} ${f.hint}`);
  if (f.type === 'password' || SENSITIVE.test(h)) return null;
  if (f.tag === 'select') return f.options[0] ?? null;
  if (f.type === 'checkbox' || f.type === 'radio') return 'on';
  if (f.type === 'email' || /e-?mail|correo/.test(h)) return FAKE.email;
  if (f.type === 'tel' || /phone|telefone|celular|whatsapp|telefono/.test(h)) return FAKE.phone;
  if (/last|sobrenome|apellido|family-name/.test(h)) return FAKE.lastName;
  if (/first|given-name|primeiro nome/.test(h)) return FAKE.firstName;
  if (/name|nome|nombre/.test(h)) return FAKE.fullName;
  if (f.type === 'number' || /\bage\b|idade|edad/.test(h)) return FAKE.number;
  if (f.type === 'date' || f.type === 'datetime-local' || f.type === 'month') return null;
  if (f.tag === 'textarea' || f.type === 'text' || f.type === 'search' || !f.type) return FAKE.text;
  return null;
}

/**
 * Próxima ação na tela (ordem do neutro): diálogo aberto primeiro; "skip" > preencher só o obrigatório e enviar >
 * 1ª opção do 1º grupo de respostas (grupo já marcado = multi-escolha → avançar) > "continue/next" > o único/1º botão
 * que sobrou > esperar a tela andar sozinha.
 */
export function decideAction(s: WalkSnapshot, tried: Set<string>): WalkAction {
  if (s.password) return { kind: 'stop', reason: 'login_wall' };
  const pool = usable(s, tried);
  const skip = pool.find((c) => SKIP.test(strip(c.text)));
  if (skip) return { kind: 'click', key: skip.key, label: `skip: ${skip.text}` };

  // obrigatório vazio: required/aria-required, ou e-mail sem pergunta na tela (o "deixe seu e-mail pra ver o resultado")
  const groups = answerGroups(pool);
  const fields = s.fields.filter((f) => (!s.dialog || f.inDialog) && !f.filled && (f.required || (f.type === 'email' && !groups.length)));
  if (fields.length) {
    const fills: { key: string; value: string; tag: string; type: string }[] = [];
    for (const f of fields) {
      const v = fakeValueFor(f);
      if (v === null) return { kind: 'stop', reason: 'sensitive_field' };
      fills.push({ key: f.key, value: v, tag: f.tag, type: f.type });
    }
    const form = fields[0].form;
    const submit = pool.find((c) => c.isSubmit && (!form || c.form === form))
      ?? pool.find((c) => CONTINUE.test(strip(c.text)))
      ?? pool.find((c) => !c.href && (!form || c.form === form));
    return { kind: 'fill', fills, then: submit ? { key: submit.key, label: submit.text } : null, label: `fill ${fills.map((f) => f.type || f.tag).join('+')}${submit ? ` → ${submit.text}` : ' → enter'}` };
  }

  for (const g of groups) {
    if (g.some((c) => c.pressed)) break; // multi-escolha já marcada: avançar
    const first = g.find((c) => !c.pressed);
    if (first) return { kind: 'click', key: first.key, label: `answer: ${first.text}` };
  }
  const next = pool.find((c) => CONTINUE.test(strip(c.text)) && !c.pressed);
  if (next) return { kind: 'click', key: next.key, label: `continue: ${next.text}` };
  const any = pool.find((c) => !c.href && !c.pressed) ?? pool.find((c) => !c.pressed);
  if (any) return { kind: 'click', key: any.key, label: `click: ${any.text || any.meta.slice(0, 40)}` };
  return { kind: 'wait' };
}

/** Assinatura da tela pro "tela repetida = para": caminho + texto sem números (loader de % não conta como tela nova). */
export function screenSignature(s: Pick<WalkSnapshot, 'url' | 'text' | 'dialog'>): string {
  let path = s.url;
  try { const u = new URL(s.url); path = `${u.host}${u.pathname}`; } catch { /* fica a url */ }
  return `${path}|${s.dialog ? 'D' : ''}|${s.text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 2_000)}`;
}

// ------------------------------------------------------------------ filtro de rede (o caminhante não emite nada)

/** pixel/analytics: nunca carregam durante a caminhada (o evento do funil do usuário não pode ser contaminado). */
const TRACKER_HOST = /(?:^|\.)(?:facebook\.com|facebook\.net|fbcdn\.net|connect\.facebook\.net|google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com|googlesyndication\.com|tiktok\.com|tiktokw\.us|analytics\.tiktok\.com|clarity\.ms|hotjar\.com|hotjar\.io|segment\.io|segment\.com|mixpanel\.com|amplitude\.com|posthog\.com|i\.posthog\.com|plausible\.io|utmify\.com\.br|utmify\.com|snapchat\.com|sc-static\.net|pinterest\.com|pinimg\.com|bing\.com|bat\.bing\.com|taboola\.com|outbrain\.com|reddit\.com|redditstatic\.com|twitter\.com|ads-twitter\.com|linkedin\.com|licdn\.com|vercel-insights\.com|vitals\.vercel-insights\.com)$/i;
const TRACKER_PATH = /\/(?:_vercel\/insights|_vercel\/speed-insights|tr\/?$|collect\b|g\/collect)/i;

export interface WalkFilterState { blocked: number; leftTo: string | null }

/** true = aborta. Só GET/HEAD; sem beacon; sem pixel; documento do frame principal fora da oferta (≠ checkout de plataforma) = sai. */
export function walkRequestFilter(startUrl: string, state: WalkFilterState, isMainFrameNav: (r: HTTPRequest) => boolean) {
  const scope = offerScope(startUrl);
  return (r: HTTPRequest): boolean => {
    let u: URL;
    try { u = new URL(r.url()); } catch { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const method = r.method().toUpperCase();
    const type = r.resourceType();
    let abort = false;
    if (method !== 'GET' && method !== 'HEAD') abort = true;
    else if (type === 'ping' || type === 'eventsource' || type === 'websocket') abort = true;
    else if (TRACKER_HOST.test(u.hostname) || TRACKER_PATH.test(u.pathname)) abort = true;
    else if (type === 'document' && isMainFrameNav(r) && !inOffer(u.toString(), scope) && !isCheckoutHost(u.hostname)) {
      abort = true;
      state.leftTo = u.toString();
    }
    if (abort) state.blocked++;
    return abort;
  };
}

// ------------------------------------------------------------------ a caminhada

const log = new Logger('CaminhanteFunil');

/** Monta o snapshot da tela atual dentro da página (marca cada controle com data-hm-k pra clicar depois). */
async function snapshot(page: import('puppeteer-core').Page): Promise<WalkSnapshot> {
  return page.evaluate(() => {
    const w = window as unknown as { __hmK?: number };
    const keyOf = (el: Element) => {
      let k = el.getAttribute('data-hm-k');
      if (!k) { w.__hmK = (w.__hmK ?? 0) + 1; k = String(w.__hmK); el.setAttribute('data-hm-k', k); }
      return k;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) return false;
      return !(el as HTMLElement).closest('[hidden],[aria-hidden="true"],[inert]');
    };
    const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
    const dialogs = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]')].filter(visible);
    const inDialog = (el: Element) => dialogs.some((d) => d.contains(el));
    const SEM = 'button,[role="button"],[role="radio"],[role="option"],[role="checkbox"],[role="link"],[role="tab"],input[type="submit"],input[type="button"],input[type="image"],a[href],label';
    const semantic = [...document.querySelectorAll(SEM)];
    const semSet = new Set(semantic);
    // div/li clicável sem semântica (React onClick): cursor pointer, o de fora, sem controle semântico dentro
    const pointer: Element[] = [];
    for (const el of document.querySelectorAll('div,li,span,section,article,p,img')) {
      if (pointer.length > 300) break;
      if (semSet.has(el) || el.closest(SEM)) continue;
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer') continue;
      if (el.querySelector(SEM)) continue;
      pointer.push(el);
    }
    const controls: WalkControl[] = [];
    for (const el of [...semantic, ...pointer]) {
      if (controls.length >= 150) break;
      let target: Element = el;
      if (el.tagName === 'LABEL') {
        const ctl = (el as HTMLLabelElement).control;
        if (!ctl || !['radio', 'checkbox'].includes((ctl as HTMLInputElement).type)) continue; // label de texto: o input é campo
      }
      if (el.tagName === 'INPUT' && ['radio', 'checkbox'].includes((el as HTMLInputElement).type)) {
        const lab = (el as HTMLInputElement).labels?.[0];
        if (lab && visible(lab)) continue; // a label já entra como controle
      }
      // controle dentro de outro (span[role=button] dentro de <button>, botão dentro de <a>): fica o de fora,
      // a não ser que o de fora seja <label> de campo de texto (aí ele não é controle)
      const outer = el.parentElement?.closest(SEM);
      if (outer) {
        const ctl = outer.tagName === 'LABEL' ? (outer as HTMLLabelElement).control as HTMLInputElement | null : null;
        if (outer.tagName !== 'LABEL' || (ctl && ['radio', 'checkbox'].includes(ctl.type))) continue;
      }
      if (!visible(target)) continue;
      const input = el.tagName === 'LABEL' ? ((el as HTMLLabelElement).control as HTMLInputElement | null) : el.tagName === 'INPUT' ? (el as HTMLInputElement) : null;
      const html = el as HTMLElement;
      const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' || !!input?.disabled;
      const cls = typeof html.className === 'string' ? html.className : '';
      const pressed = el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' || !!input?.checked || /\b(?:selected|active|checked|is-selected|is-active)\b/i.test(cls);
      const form = (el as HTMLButtonElement).form ?? el.closest('form');
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const isSubmit = (el.tagName === 'BUTTON' && (type === 'submit' || (!type && !!form))) || (el.tagName === 'INPUT' && (type === 'submit' || type === 'image'));
      const href = el.tagName === 'A' ? (el as HTMLAnchorElement).href || null : null;
      const parent = el.parentElement;
      const text = clean(html.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || el.getAttribute('alt') || '').slice(0, 160);
      const meta = clean([el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('name'), el.id, cls, el.getAttribute('data-action'), href, input?.value].filter(Boolean).join(' ')).slice(0, 300);
      target = el;
      controls.push({
        key: keyOf(target), tag: el.tagName.toLowerCase(), type, text, meta, disabled, pressed,
        inDialog: inDialog(el), isSubmit, form: form ? keyOf(form) : null,
        group: `${parent ? keyOf(parent) : 'root'}|${el.tagName}`, href,
        top: Math.round(el.getBoundingClientRect().top + window.scrollY),
      });
    }
    const fields: WalkField[] = [];
    for (const el of document.querySelectorAll('input,select,textarea')) {
      const i = el as HTMLInputElement;
      const type = (i.getAttribute('type') ?? (el.tagName === 'INPUT' ? 'text' : '')).toLowerCase();
      if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
      const lab = i.labels?.[0];
      if (!visible(el) && !(lab && visible(lab))) continue;
      const hint = clean([i.name, i.id, i.getAttribute('autocomplete'), i.getAttribute('placeholder'), i.getAttribute('aria-label'), lab?.innerText].filter(Boolean).join(' ')).slice(0, 200);
      const filled = type === 'checkbox' || type === 'radio' ? i.checked : !!i.value?.trim();
      const options = el.tagName === 'SELECT' ? [...(el as HTMLSelectElement).options].filter((o) => o.value && !o.disabled).map((o) => o.value).slice(0, 5) : [];
      const form = i.form ?? el.closest('form');
      fields.push({ key: keyOf(el), tag: el.tagName.toLowerCase(), type, hint, required: i.required || el.getAttribute('aria-required') === 'true', filled, inDialog: inDialog(el), form: form ? keyOf(form) : null, options });
    }
    const cardField = [...document.querySelectorAll('input')].some((i) => visible(i) && /cc-(?:number|exp|csc)/i.test(i.getAttribute('autocomplete') ?? ''))
      || [...document.querySelectorAll('iframe')].some((f) => visible(f) && f.getBoundingClientRect().height > 30 && /js\.stripe\.com|elements-inner|pagar\.me|mercadopago|paypal\.com|braintree|adyen|checkout\.com|pagseguro|iugu|asaas/i.test(`${f.src} ${f.name} ${f.title}`));
    const password = [...document.querySelectorAll('input[type="password"]')].some(visible);
    const progress = [...document.querySelectorAll('progress,[role="progressbar"],[class*="progress"],[class*="meter"],[class*="step"],[class*="stepper"]')].some(visible)
      || /\b\d{1,2}\s*(?:of|de|\/)\s*\d{1,2}\b|\b(?:step|etapa|pergunta|question)\s*\d/i.test(document.body?.innerText.slice(0, 600) ?? '');
    const here = location.pathname;
    const internalLinks = new Set([...document.querySelectorAll('a[href]')].filter(visible).map((a) => {
      try { const u = new URL((a as HTMLAnchorElement).href); return u.origin === location.origin && u.pathname !== here ? u.pathname : null; } catch { return null; }
    }).filter(Boolean)).size;
    return {
      url: location.href, title: document.title || null, text: (document.body?.innerText ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(),
      controls, fields, dialog: dialogs.length > 0, cardField, password, progress, internalLinks,
    };
  });
}

async function act(page: import('puppeteer-core').Page, a: Extract<WalkAction, { kind: 'click' | 'fill' }>): Promise<void> {
  const sel = (k: string) => `[data-hm-k="${k}"]`;
  const click = async (key: string) => {
    const h = await page.$(sel(key));
    if (!h) return;
    try {
      await h.click({ delay: 20 });
    } catch {
      await page.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.click(), sel(key)).catch(() => undefined);
    }
  };
  if (a.kind === 'click') return click(a.key);
  for (const f of a.fills) {
    if (f.tag === 'select') { await page.select(sel(f.key), f.value).catch(() => undefined); continue; }
    if (f.type === 'checkbox' || f.type === 'radio') { await click(f.key); continue; }
    const h = await page.$(sel(f.key));
    if (!h) continue;
    await h.click({ clickCount: 3 }).catch(() => undefined);
    await h.type(f.value, { delay: 8 }).catch(() => undefined);
  }
  if (a.then) await click(a.then.key);
  else await page.keyboard.press('Enter').catch(() => undefined);
}

/** Espera a assinatura mudar (e assentar); `null` = não mudou no prazo. Aguenta navegação no meio (contexto destruído). */
async function waitChange(page: import('puppeteer-core').Page, before: string, ms: number, isOver: () => boolean): Promise<WalkSnapshot | null> {
  const end = Date.now() + ms;
  let last: string | null = null;
  let lastSnap: WalkSnapshot | null = null;
  while (Date.now() < end && !isOver()) {
    await new Promise((r) => setTimeout(r, 200));
    let s: WalkSnapshot;
    try { s = await snapshot(page); } catch { continue; } // navegando
    const sig = screenSignature(s);
    if (sig === before) { last = null; continue; }
    if (sig === last) return s; // mudou e ficou igual por 1 ciclo: assentou
    last = sig;
    lastSnap = s;
  }
  return lastSnap;
}

export interface WalkOptions extends RenderPageOptions {
  deadline?: number;
  limits?: Partial<Record<keyof typeof WALK_LIMITS, number>>;
}

/** Caminha o funil a partir da URL. `null` = sem navegador. Nunca lança (erro vira `stoppedBy: 'error'` com o que já leu). */
export async function walkFunnel(url: string, opts: WalkOptions = {}): Promise<WalkResult | null> {
  const L = { ...WALK_LIMITS, ...opts.limits };
  const t0 = Date.now();
  const deadline = Math.min(opts.deadline ?? Infinity, t0 + L.totalMs);
  const over = () => Date.now() > deadline;
  const state: WalkFilterState = { blocked: 0, leftTo: null };
  const screens: WalkScreen[] = [];
  let stoppedBy: WalkStop = 'error';
  let actions = 0;
  let shots: RenderedShot[] = [];
  const filter = walkRequestFilter(url, state, (r) => r.isNavigationRequest() && !r.frame()?.parentFrame());
  try {
    const done = await openPage(url, { ...opts, scroll: false, timeoutMs: Math.min(opts.timeoutMs ?? 20_000, 20_000), requestFilter: filter, sessionMs: L.totalMs + 25_000 }, async (s) => {
      const { page } = s;
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 3_000 }).catch(() => undefined);
      let snap = await snapshot(page);
      if (!looksLikeQuiz(snap) && classifyScreen(snap) === 'quiz_step') { stoppedBy = 'not_quiz'; return true; }
      const seen = new Map<string, number>();
      const record = (sn: WalkSnapshot) => {
        seen.set(screenSignature(sn), 1);
        const text = sn.text;
        screens.push({ step: screens.length + 1, url: sn.url, role: classifyScreen(sn), title: sn.title, text: text.slice(0, L.chars), truncated: text.length > L.chars, action: null });
      };
      record(snap);
      const tried = new Map<string, Set<string>>();
      for (;;) {
        const role = screens[screens.length - 1].role;
        if (role !== 'quiz_step') {
          stoppedBy = role;
          shots = await shootScreens(s, L.offerShots).catch(() => [] as RenderedShot[]);
          return true;
        }
        if (over()) { stoppedBy = 'timeout'; return true; }
        if (actions >= L.maxActions) { stoppedBy = 'max_actions'; return true; }
        const sig = screenSignature(snap);
        const triedHere = tried.get(sig) ?? new Set<string>();
        tried.set(sig, triedHere);
        const a = decideAction(snap, triedHere);
        if (a.kind === 'stop') { stoppedBy = a.reason; return true; }
        let next: WalkSnapshot | null;
        if (a.kind === 'wait') {
          next = await waitChange(page, sig, Math.min(L.autoWaitMs, deadline - Date.now()), over);
          if (!next) { stoppedBy = over() ? 'timeout' : 'stuck'; return true; }
        } else {
          actions++;
          await act(page, a);
          if (state.leftTo) { stoppedBy = 'left_domain'; return true; }
          next = await waitChange(page, sig, Math.min(L.settleMs, Math.max(0, deadline - Date.now())), over);
          if (state.leftTo) { stoppedBy = 'left_domain'; return true; }
          if (!next) {
            // a tela não andou: marca o que foi tentado e tenta outro (multi-escolha, botão que não faz nada)
            if (a.kind === 'click') triedHere.add(a.key);
            else if (a.then) triedHere.add(a.then.key);
            if (triedHere.size >= L.triesPerScreen || a.kind === 'fill') {
              // fill sem efeito = formulário precisa de algo que não damos (ou o envio foi barrado): para
              stoppedBy = 'stuck';
              return true;
            }
            snap = await snapshot(page).catch(() => snap);
            continue;
          }
        }
        const cur = screens[screens.length - 1];
        const label = a.kind === 'wait' ? 'waited (auto-advance)' : a.label;
        cur.action = cur.action ? `${cur.action} · ${label}` : label; // tela revisitada (loader) junta as ações
        const nsig = screenSignature(next);
        const visits = seen.get(nsig) ?? 0;
        if (visits) {
          // tela que já vimos: não vira página de novo; voltou demais = loop
          if (visits >= L.revisits) { stoppedBy = 'repeat'; return true; }
          seen.set(nsig, visits + 1);
          snap = next;
          continue;
        }
        snap = next;
        record(snap);
      }
    });
    if (done === null) return null;
  } catch (e) {
    log.warn(`caminhada de ${url} parou com erro (${(e as Error).message}); fica o que leu`);
    stoppedBy = screens.length ? (Date.now() > deadline ? 'timeout' : 'error') : 'error';
  }
  return { screens, stoppedBy, actions, ms: Date.now() - t0, blocked: state.blocked, shots };
}

/** Caminhante pronto pro leitura.ts (o módulo monta com o executável da config). */
export function makeFunnelWalker(opts: WalkOptions = {}): FunnelWalker {
  return (url, o) => walkFunnel(url, { ...opts, ...o });
}
