// Caminhante de funil (A1, 28/10). Regras puras sem navegador + integração com um quiz fixture servido em 127.0.0.1:
// 4 etapas (opção simples, multi-escolha, rádio com "Skip", diálogo sim/não), e-mail obrigatório + nome opcional,
// loader que avança sozinho, tela de oferta com botão de pagar que NÃO pode ser clicado, POST de lead e beacon que
// NÃO podem sair. Nenhuma chamada ao Claude; o navegador é o chrome-headless-shell (sem binário = integração pulada).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { acharNavegador } from '../../common/util/navegador';
import {
  FAKE, classifyScreen, decideAction, fakeValueFor, isForbidden, looksLikeQuiz, screenSignature, walkFunnel, walkRequestFilter,
  type WalkControl, type WalkField, type WalkSnapshot,
} from './caminhante';
import { readOffer, shouldWalk } from './leitura';
import type { PageText } from './pagina';
import { briefUserMessage } from './prompts';
import { normalizeUrl } from './subpaginas';

// ------------------------------------------------------------------ regras puras

const ctl = (over: Partial<WalkControl>): WalkControl => ({
  key: over.key ?? String(Math.random()), tag: 'button', type: 'button', text: '', meta: '', disabled: false, pressed: false,
  inDialog: false, isSubmit: false, form: null, group: 'g1|BUTTON', href: null, top: 0, ...over,
});
const field = (over: Partial<WalkField>): WalkField => ({
  key: 'f1', tag: 'input', type: 'text', hint: '', required: false, filled: false, inDialog: false, form: 'form1', options: [], ...over,
});
const snap = (over: Partial<WalkSnapshot>): WalkSnapshot => ({
  url: 'https://quiz.com/start', title: 'Quiz', text: 'Question 1 of 4', controls: [], fields: [], dialog: false, cardField: false,
  password: false, progress: true, internalLinks: 0, ...over,
});

describe('caminhante: regras', () => {
  it('isForbidden: pagar, comprar, finalizar, assinar, logar, carrinho, preço no rótulo, host de checkout', () => {
    for (const text of ['Pay now', 'Buy it', 'Comprar agora', 'Finalizar compra', 'Assinar', 'Add to cart', 'Log in', 'Entrar', 'Get it for $19', 'Pagar com Pix', 'Continue with Google'])
      expect(isForbidden({ text, meta: '', href: null })).toBe(true);
    expect(isForbidden({ text: 'Go', meta: 'btn buy', href: null })).toBe(true);
    expect(isForbidden({ text: 'Finish', meta: '', href: 'https://pay.hotmart.com/X' })).toBe(true);
    for (const text of ['Continue', 'Next', 'Paying off debt', 'Skip', 'Get started', 'See my results', 'Not me'])
      expect(isForbidden({ text, meta: '', href: null })).toBe(false);
  });

  it('decideAction: skip > obrigatório > 1ª opção > multi já marcada avança > continue > espera', () => {
    const a = ctl({ key: 'a', text: 'Option A', top: 10 });
    const b = ctl({ key: 'b', text: 'Option B', top: 20 });
    const skip = ctl({ key: 's', text: 'Skip', group: 'g2|BUTTON', top: 30 });
    const next = ctl({ key: 'n', text: 'Continue', group: 'g3|BUTTON', top: 40 });
    expect(decideAction(snap({ controls: [a, b, skip, next] }), new Set())).toMatchObject({ kind: 'click', key: 's' });
    expect(decideAction(snap({ controls: [a, b, next] }), new Set())).toMatchObject({ kind: 'click', key: 'a' });
    // multi-escolha: A já marcada → avança
    expect(decideAction(snap({ controls: [{ ...a, pressed: true }, b, next] }), new Set())).toMatchObject({ kind: 'click', key: 'n' });
    // opção clicada e a tela não andou (multi-escolha sem aria-pressed) → avançar; avançar também não andou → outra opção
    expect(decideAction(snap({ controls: [a, b, next] }), new Set(['a']))).toMatchObject({ kind: 'click', key: 'n' });
    expect(decideAction(snap({ controls: [a, b, next] }), new Set(['a', 'n']))).toMatchObject({ kind: 'click', key: 'b' });
    // diálogo manda
    const yes = ctl({ key: 'y', text: 'No', inDialog: true, group: 'd|BUTTON' });
    expect(decideAction(snap({ dialog: true, controls: [a, b, yes] }), new Set())).toMatchObject({ kind: 'click', key: 'y' });
    // voltar e pagar nunca
    expect(decideAction(snap({ controls: [ctl({ text: 'Back' }), ctl({ text: 'Pay now', group: 'x' })] }), new Set())).toEqual({ kind: 'wait' });
  });

  it('decideAction: preenche só o obrigatório (e-mail) com dado fictício; campo de cartão/senha para', () => {
    const submit = ctl({ key: 'sub', text: 'Show me my plan', isSubmit: true, form: 'form1', group: 'f|BUTTON' });
    const email = field({ key: 'e', type: 'email', hint: 'email you@example.com', required: true });
    const name = field({ key: 'n', type: 'text', hint: 'name' });
    const a = decideAction(snap({ controls: [submit], fields: [email, name] }), new Set());
    expect(a).toMatchObject({ kind: 'fill', fills: [{ key: 'e', value: FAKE.email }], then: { key: 'sub' } });
    // nome opcional sozinho: não preenche, só avança
    expect(decideAction(snap({ controls: [submit], fields: [name] }), new Set())).toMatchObject({ kind: 'click', key: 'sub' });
    expect(decideAction(snap({ controls: [submit], fields: [field({ hint: 'card number cc-number', required: true })] }), new Set())).toEqual({ kind: 'stop', reason: 'sensitive_field' });
    expect(decideAction(snap({ password: true }), new Set())).toEqual({ kind: 'stop', reason: 'login_wall' });
    expect(fakeValueFor(field({ hint: 'cpf' }))).toBeNull();
    expect(fakeValueFor(field({ hint: 'first name given-name' }))).toBe(FAKE.firstName);
  });

  it('classifyScreen: preço + botão de compra = offer; cartão/rota de checkout = checkout; senão quiz_step', () => {
    expect(classifyScreen(snap({ text: 'Your plan $19.99/month', controls: [ctl({ text: 'Pay now' })] }))).toBe('offer');
    expect(classifyScreen(snap({ text: 'Your plan $19.99/month', controls: [ctl({ text: 'Get my plan' })] }))).toBe('offer');
    expect(classifyScreen(snap({ text: 'How much do you spend? $0 to $50', controls: [ctl({ text: 'Next' })] }))).toBe('quiz_step');
    expect(classifyScreen(snap({ cardField: true }))).toBe('checkout');
    expect(classifyScreen(snap({ url: 'https://quiz.com/checkout' }))).toBe('checkout');
  });

  it('looksLikeQuiz: opções + poucos links = quiz; landing com menu não', () => {
    const opts = [ctl({ text: 'A' }), ctl({ text: 'B' })];
    expect(looksLikeQuiz(snap({ controls: opts }))).toBe(true);
    expect(looksLikeQuiz(snap({ controls: opts, internalLinks: 6 }))).toBe(false);
    expect(looksLikeQuiz(snap({ controls: [], progress: false }))).toBe(false);
  });

  it('screenSignature ignora números (loader de %) e muda com o texto', () => {
    expect(screenSignature(snap({ text: 'Loading 12%' }))).toBe(screenSignature(snap({ text: 'Loading 87%' })));
    expect(screenSignature(snap({ text: 'Question A' }))).not.toBe(screenSignature(snap({ text: 'Question B' })));
  });

  it('walkRequestFilter: barra POST, beacon, pixel e documento fora da oferta; deixa GET da oferta e checkout de plataforma', () => {
    const state = { blocked: 0, leftTo: null as string | null };
    const f = walkRequestFilter('https://quiz.com/start', state, () => true);
    const req = (url: string, method = 'GET', type = 'document') => ({ url: () => url, method: () => method, resourceType: () => type }) as never;
    expect(f(req('https://quiz.com/api/lead', 'POST', 'fetch'))).toBe(true);
    expect(f(req('https://quiz.com/api/beacon', 'GET', 'ping'))).toBe(true);
    expect(f(req('https://www.facebook.com/tr?id=1', 'GET', 'image'))).toBe(true);
    expect(f(req('https://quiz.com/step2'))).toBe(false);
    expect(f(req('https://checkout.stripe.com/c/pay/x'))).toBe(false);
    expect(state.leftTo).toBeNull();
    expect(f(req('https://evil.example.com/'))).toBe(true);
    expect(state.leftTo).toBe('https://evil.example.com/');
    expect(state.blocked).toBe(4);
  });
});

// ------------------------------------------------------------------ leitura com caminhante falso (sem navegador)

describe('leitura: caminhante na cascata', () => {
  const ok = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const quizHtml = `<html><head><title>Find your plan</title></head><body><div id="root"><h1>Which describes you?</h1><button>A</button><button>B</button><p>${'intro text '.repeat(30)}</p></div></body></html>`;
  const fetchImpl = (async (u: string) => (normalizeUrl(u) === normalizeUrl('https://quiz.com/start') ? ok(quizHtml) : new Response('', { status: 404 }))) as unknown as typeof fetch;
  const base = { fetchImpl, resolve: async () => ['93.184.216.34'], certLookup: async () => [] as string[], capture: null };

  it('emite walking_quiz, ordena principal → oferta → subpáginas → telas do quiz e conta no cabeçalho do prompt', async () => {
    const stages: string[] = [];
    const walk = jest.fn(async () => ({
      screens: [
        { step: 1, url: 'https://quiz.com/start', role: 'quiz_step' as const, title: 't', text: 'Which describes you?\nA\nB', truncated: false, action: 'answer: A' },
        { step: 2, url: 'https://quiz.com/start', role: 'quiz_step' as const, title: 't', text: 'How often do you struggle with X?', truncated: false, action: 'answer: Never' },
        { step: 3, url: 'https://quiz.com/start', role: 'offer' as const, title: 't', text: 'Your plan: $19.99/month. 30-day guarantee.', truncated: false, action: null },
      ],
      stoppedBy: 'offer' as const, actions: 2, ms: 1200, blocked: 3, shots: [],
    }));
    const r = await readOffer('https://quiz.com/start', { ...base, walk }, (s) => stages.push(s));
    expect(walk).toHaveBeenCalledTimes(1);
    expect(stages).toEqual(['fetching_page', 'rendering_page', 'walking_quiz', 'reading_subpages', 'reading_images']);
    expect(r.page.pages.map((p) => [p.role, p.url])).toEqual([
      ['main', 'https://quiz.com/start'],
      ['offer', 'https://quiz.com/start#step-3'],
      ['quiz_step', 'https://quiz.com/start#step-1'],
      ['quiz_step', 'https://quiz.com/start#step-2'],
    ]);
    expect(r.walk).toMatchObject({ screens: 3, stoppedBy: 'offer', blocked: 3 });
    const msg = briefUserMessage({ url: r.page.url, text: r.page.text, pages: r.page.pages.map((p) => ({ ...p })), readMode: r.page.readMode });
    expect(msg).toMatch(/1 main page, 1 subpage, 2 quiz screens walked/);
    expect(msg).toMatch(/<page role="offer" url="https:\/\/quiz.com\/start#step-3"/);
  });

  it('landing com menu (≥ 3 links internos) não abre o caminhante', () => {
    const landing: PageText = {
      url: 'https://shop.com/', title: 'Shop', description: null, text: 'x'.repeat(3000), truncated: false, pages: [], readMode: 'http',
      anchors: ['/pricing', '/about', '/faq', '/reviews'].map((p) => ({ href: `https://shop.com${p}`, text: p.slice(1), cta: false })),
    };
    expect(shouldWalk(landing)).toBe(false);
    expect(shouldWalk({ ...landing, anchors: [] })).toBe(true);
    expect(shouldWalk({ ...landing, url: 'https://shop.com/quiz' })).toBe(true);
  });
});

// ------------------------------------------------------------------ integração: quiz fixture no navegador de verdade

const QUIZ = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Sleep quiz</title>
<style>.opt{display:block;margin:8px;padding:12px;border:1px solid #333} #bar{height:6px;background:#3a3} .sheet{position:fixed;inset:0;background:#fff}</style></head>
<body><div class="progress"><div id="bar"></div></div><main id="screen"></main><div id="overlay"></div>
<img src="https://www.facebook.com/tr?id=123&ev=PageView" width="1" height="1" alt="">
<script>
const S = { name: '', email: '', picks: [] };
const $ = (s) => document.querySelector(s);
const track = (ev) => { fetch('/api/lead', { method: 'POST', body: JSON.stringify({ ev, email: S.email }) }).catch(() => {}); try { navigator.sendBeacon('/api/beacon', ev); } catch (e) {} };
function go(id) { $('#screen').innerHTML = R[id](); (B[id] || (() => {}))(); track('step_' + id); }
const R = {
  q1: () => '<p>Question 1 of 4</p><h2>How do you usually sleep?</h2><div class="opts"><button class="opt">Like a baby</button><button class="opt">I wake up a lot</button><button class="opt">Barely</button></div>',
  q2: () => '<p>Question 2 of 4</p><h2>What gets in the way? Pick all that apply</h2><div class="opts"><button class="opt" aria-pressed="false">Stress</button><button class="opt" aria-pressed="false">Phone at night</button></div><button id="next" disabled>Continue</button>',
  q3: () => '<p>Question 3 of 4</p><h2>Your age range</h2><form><label><input type="radio" name="age" value="1"> 18-29</label><label><input type="radio" name="age" value="2"> 30-49</label></form><button id="skip">Skip</button>',
  q4: () => '<p>Question 4 of 4</p><h2>Almost there</h2><button id="ask">See my sleep profile</button>',
  email: () => '<h2>Where should we send your sleep plan?</h2><form id="f"><label for="nm">Name (optional)</label><input id="nm" name="name"><label for="em">Email</label><input id="em" name="email" type="email" required><button type="submit">Show my plan</button></form>',
  loading: () => '<h2>Building your plan… <span id="pct">0</span>%</h2>',
  offer: () => '<h1>Plan for ' + (S.name || 'you') + '</h1><p>Sent to ' + S.email + '</p><p>Deep Sleep Program: $19.99/month. 30-day money-back guarantee. Cancel anytime.</p><button id="back">Back</button><a href="https://evil.example.com/learn" class="cta">Learn more</a><button id="pay" class="btn">Pay now and start tonight</button>',
};
const B = {
  q1: () => document.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => setTimeout(() => go('q2'), 150))),
  q2: () => {
    document.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => { b.setAttribute('aria-pressed', 'true'); S.picks.push(b.textContent); $('#next').disabled = false; }));
    $('#next').addEventListener('click', () => go('q3'));
  },
  q3: () => {
    document.querySelectorAll('input[name=age]').forEach((r) => r.addEventListener('change', () => go('q4')));
    $('#skip').addEventListener('click', () => go('q4'));
  },
  q4: () => $('#ask').addEventListener('click', () => {
    $('#overlay').innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><h2>Do you snore?</h2><button data-a="no">No</button><button data-a="yes">Yes</button></div>';
    document.querySelectorAll('#overlay button').forEach((b) => b.addEventListener('click', () => { $('#overlay').innerHTML = ''; go('email'); }));
  }),
  email: () => $('#f').addEventListener('submit', (e) => {
    e.preventDefault();
    const em = $('#em');
    if (!em.value) return;
    S.email = em.value; S.name = $('#nm').value;
    track('email_submit');
    go('loading');
  }),
  loading: () => { let p = 0; const t = setInterval(() => { p += 25; const el = $('#pct'); if (el) el.textContent = p; if (p >= 100) { clearInterval(t); go('offer'); } }, 400); },
  offer: () => $('#pay').addEventListener('click', () => { window.__paid = true; fetch('/api/pay', { method: 'POST' }).catch(() => {}); location.href = '/paid'; }),
};
go('q1');
</script></body></html>`;

const LANDING = `<!doctype html><html><head><title>Acme</title></head><body><nav><a href="/pricing">Pricing</a><a href="/about">About</a><a href="/faq">FAQ</a><a href="/blog">Blog</a></nav>
<h1>Acme makes widgets</h1><p>${'Widgets for everyone. '.repeat(80)}</p><button>Contact us</button></body></html>`;

const exe = process.env.REMOTION_BROWSER_EXECUTABLE || acharNavegador(null);
const withBrowser = exe ? describe : describe.skip;

withBrowser('caminhante: quiz fixture no chrome-headless-shell', () => {
  let server: http.Server;
  let origin = '';
  const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === '/' || req.url === '/start') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return void res.end(QUIZ); }
      if (req.url === '/landing') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return void res.end(LANDING); }
      res.writeHead(404); res.end('');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { await new Promise((r) => server.close(r)); });

  it('percorre as 4 etapas, preenche só o e-mail, espera o loader, para na oferta e não paga nem emite nada', async () => {
    hits.length = 0;
    const r = await walkFunnel(`${origin}/start`, { browserExecutable: exe, allowPrivate: true });
    expect(r).not.toBeNull();
    const w = r!;
    // eslint-disable-next-line no-console
    console.log(w.screens.map((s) => `${s.step}. [${s.role}] ${s.text.split('\n').slice(0, 2).join(' / ').slice(0, 70)} → ${s.action ?? 'STOP'}`).join('\n'), `\nstoppedBy=${w.stoppedBy} actions=${w.actions} blocked=${w.blocked} ms=${w.ms}`);
    expect(w.stoppedBy).toBe('offer');
    const last = w.screens[w.screens.length - 1];
    expect(last.role).toBe('offer');
    expect(last.text).toContain('$19.99/month');
    // nome opcional NÃO foi preenchido; e-mail fictício foi
    expect(last.text).toContain('Plan for you');
    expect(last.text).toContain(FAKE.email);
    const actions = w.screens.map((s) => s.action ?? '');
    expect(actions).toEqual(expect.arrayContaining([expect.stringMatching(/^answer: Like a baby/), expect.stringMatching(/^skip: Skip/), expect.stringMatching(/^fill email/)]));
    expect(actions.some((a) => /^continue: Continue/.test(a))).toBe(true); // multi-escolha → avançar
    expect(actions.some((a) => /^answer: No|^click: No/.test(a))).toBe(true); // diálogo
    expect(actions.some((a) => /waited/.test(a))).toBe(true); // loader
    expect(w.shots.length).toBeGreaterThan(0);
    // nada saiu: nenhum POST, nenhum beacon, ninguém em /paid
    expect(hits.filter((h) => !h.startsWith('GET '))).toEqual([]);
    expect(hits.some((h) => /\/paid|\/api\/pay|\/api\/beacon/.test(h))).toBe(false);
    expect(w.blocked).toBeGreaterThan(0);
    expect(actions.some((a) => /pay|learn more|back/i.test(a))).toBe(false);
  }, 90_000);

  it('landing comum: not_quiz, nenhuma ação', async () => {
    const r = await walkFunnel(`${origin}/landing`, { browserExecutable: exe, allowPrivate: true });
    expect(r).toMatchObject({ stoppedBy: 'not_quiz', actions: 0, screens: [] });
  }, 60_000);

  it('teto de ações: para em max_actions sem passar do limite', async () => {
    const r = await walkFunnel(`${origin}/start`, { browserExecutable: exe, allowPrivate: true, limits: { maxActions: 2 } });
    expect(r!.stoppedBy).toBe('max_actions');
    expect(r!.actions).toBe(2);
  }, 60_000);
});
