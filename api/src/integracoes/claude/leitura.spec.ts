// Leitura da oferta em camadas (briefing-leitura-v2, 22/10) com fetch, render, captura e transporte FALSOS.
// Cobre as 5 páginas de referência do §8 (QA): (1) estática, (2) SPA/quiz, (3) preço só em imagem,
// (4) checkout em subdomínio, (5) atrás de login. Nenhuma chamada real.
import { IntegracaoError } from '../erros';
import { MemoryCostStore } from '../store/memoria.store';
import { ClaudeLiveService } from './claude.service';
import { imageCaption, imageTrigger, stripImage, type CapturedImage } from './imagens';
import { readOffer } from './leitura';
import { fetchHtmlPage, type PageText } from './pagina';
import { BRIEF_SCHEMA, briefUserMessage } from './prompts';
import type { RenderedPage } from './render-pagina';
import { CONVENTIONAL_PATHS, excluded, isCheckoutHost, normalizeUrl, pickCandidates, readSubpages, roleOf } from './subpaginas';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './transporte';
import { parseBriefFull } from './validacao';

const html = (title: string, body: string, head = '') => `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
const long = (s: string, n = 30) => `<p>${`${s} `.repeat(n)}</p>`;
const ok = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const site = (pages: Record<string, () => Response>) =>
  (async (u: string) => { const k = normalizeUrl(u); const hit = Object.entries(pages).find(([p]) => normalizeUrl(p) === k)?.[1]; return hit ? hit() : new Response('', { status: 404 }); }) as unknown as typeof fetch;
const resolve = async () => ['93.184.216.34'];
const noCerts = async () => [] as string[];
const rendered = (over: Partial<RenderedPage>): RenderedPage => ({
  url: 'https://x.com/', title: null, description: null, text: '', links: [], images: [], bigImgs: 0,
  video: { firstScreen: false, poster: null, ogImage: null }, passwordVisible: false, ...over,
});
const shot = (page: { role: CapturedImage['page']['role']; url: string }, index: number): CapturedImage => ({
  index, src: `${page.url}#screen-${index}`, alt: null, kind: 'screenshot', widthPx: 724, heightPx: 1568, data: 'AAAA', mediaType: 'image/jpeg', page,
});
const stagesOf = () => { const list: string[] = []; return { list, on: (s: string) => list.push(s) }; };

// ------------------------------------------------------------------ regras de subpágina (§2)

describe('subpáginas: papel, exclusões, dedupe', () => {
  it('roleOf pela âncora ou pelo caminho, sem acento; termos ≠ privacidade', () => {
    expect(roleOf('Comprar agora', 'https://oferta.com/p')).toBe('checkout');
    expect(roleOf('', 'https://oferta.com/precos')).toBe('pricing');
    expect(roleOf('Quem somos', 'https://oferta.com/a')).toBe('about');
    expect(roleOf('', 'https://oferta.com/como-funciona')).toBe('faq');
    expect(roleOf('Depoimentos', 'https://oferta.com/x')).toBe('testimonials');
    expect(roleOf('Garantia', 'https://oferta.com/x')).toBe('terms');
    expect(roleOf('', 'https://oferta.com/obrigado')).toBe('thankyou');
    expect(roleOf('Blog', 'https://oferta.com/blog')).toBeNull();
  });

  it('excluded: login, privacidade, social, arquivos, blog, paginação, idioma alternativo, subdomínio de infra', () => {
    const main = 'https://oferta.com/';
    for (const u of ['https://oferta.com/login', 'https://oferta.com/privacy', 'https://instagram.com/x', 'https://oferta.com/ebook.pdf', 'https://oferta.com/blog/post-1', 'https://oferta.com/lista?page=2', 'https://oferta.com/en/pricing', 'https://help.oferta.com/'])
      expect(excluded(u, main)).toBe(true);
    for (const u of ['https://oferta.com/checkout', 'https://checkout.oferta.com/p', 'https://oferta.com/sobre'])
      expect(excluded(u, main)).toBe(false);
    expect(excluded('https://oferta.com/en/pricing', 'https://oferta.com/en/')).toBe(false);
  });

  it('normalizeUrl tira #, utm/fbclid, barra final e põe host minúsculo; isCheckoutHost reconhece plataformas', () => {
    expect(normalizeUrl('https://WWW.Oferta.com/p/?utm_source=a&b=1&fbclid=z#top')).toBe('https://oferta.com/p?b=1');
    expect(isCheckoutHost('pay.hotmart.com')).toBe(true);
    expect(isCheckoutHost('app.lemonsqueezy.com')).toBe(true);
    expect(isCheckoutHost('oferta.com')).toBe(false);
  });

  it('pickCandidates: prioridade por papel, CTA primeiro na mesma prioridade, other só de 1 nível, checkout externo do CTA', () => {
    const main: PageText = {
      url: 'https://oferta.com/', title: null, description: null, text: 'a'.repeat(300), truncated: false, pages: [], readMode: 'http',
      anchors: [
        { href: 'https://oferta.com/sobre', text: 'Sobre', cta: false },
        { href: 'https://oferta.com/planos', text: 'Ver planos', cta: false },
        { href: 'https://oferta.com/planos-pro', text: 'Planos Pro', cta: true },
        { href: 'https://pay.hotmart.com/ABC', text: 'Quero', cta: true },
        { href: 'https://oferta.com/time', text: '', cta: false },
        { href: 'https://oferta.com/blog/x', text: '', cta: false },
        { href: 'https://oferta.com/login', text: 'Entrar', cta: false },
        { href: 'https://oferta.com/', text: 'Home', cta: false },
      ],
    };
    const { internal, externalCheckout } = pickCandidates(main, ['https://membros.oferta.com/']);
    expect(internal.map((c) => [c.role, c.url])).toEqual([
      ['pricing', 'https://oferta.com/planos-pro'], ['pricing', 'https://oferta.com/planos'], ['about', 'https://oferta.com/sobre'], ['other', 'https://oferta.com/time'], ['other', 'https://membros.oferta.com/'],
    ]);
    expect(externalCheckout).toBe('https://pay.hotmart.com/ABC');
  });

  it('readSubpages: 6 no máximo, redirect pra fora/principal e texto repetido ficam de fora, checkout externo lido 1 vez', async () => {
    const anchors = Array.from({ length: 9 }, (_, i) => ({ href: `https://oferta.com/p${i}`, text: `Página ${i}`, cta: false }));
    const pages: Record<string, () => Response> = { 'https://oferta.com/': () => ok(html('X', long('Oferta principal.'))) };
    for (let i = 0; i < 9; i++) pages[`https://oferta.com/p${i}`] = () => ok(html(`P${i}`, long(`Conteúdo da página ${i}.`)));
    pages['https://oferta.com/p2'] = () => ok(html('P2', long('Conteúdo da página 1.'))); // mesmos 500 primeiros caracteres da p1
    pages['https://oferta.com/p3'] = () => new Response('', { status: 302, headers: { location: 'https://outro.com/' } });
    pages['https://outro.com/'] = () => ok(html('O', long('Outro site.')));
    pages['https://pay.hotmart.com/ABC'] = () => ok(html('Checkout', long('12x de R$ 49,70 com garantia de 7 dias.')));
    const main: PageText = { url: 'https://oferta.com/', title: 'X', description: null, text: 'Oferta principal. '.repeat(30), truncated: false, pages: [], readMode: 'http', anchors: [...anchors, { href: 'https://pay.hotmart.com/ABC', text: 'Comprar', cta: true }] };
    const subs = await readSubpages(main, { fetchImpl: site(pages), resolve, certLookup: noCerts });
    expect(subs.length).toBe(7); // 6 internas + 1 checkout externo
    expect(subs[0]).toMatchObject({ role: 'checkout', url: 'https://pay.hotmart.com/ABC', via: 'http' });
    expect(subs[0].text).toContain('garantia de 7 dias');
    const urls = subs.map((p) => p.url);
    expect(urls).not.toContain('https://oferta.com/p2');
    expect(urls).not.toContain('https://oferta.com/p3');
    expect(urls).not.toContain('https://outro.com/');
  });

  it('readSubpages: SPA sem link interno sonda as rotas convencionais (só 200 com ≥ 200 caracteres entra)', async () => {
    const pages: Record<string, () => Response> = {
      'https://quiz.app/checkout': () => ok(html('Checkout', long('Plano único por US$ 19 com garantia.'))),
      'https://quiz.app/pricing': () => ok(html('Pricing', '<p>curto</p>')),
      'https://quiz.app/planos': () => ok(html('Planos', long('Plano mensal e anual.'))),
    };
    const main: PageText = { url: 'https://quiz.app/', title: 'Quiz', description: null, text: 'Which situation is yours? '.repeat(20), truncated: false, pages: [], readMode: 'rendered', anchors: [], links: [] };
    const subs = await readSubpages(main, { fetchImpl: site(pages), resolve, certLookup: noCerts });
    expect(subs.map((p) => [p.role, p.url])).toEqual([['checkout', 'https://quiz.app/checkout'], ['pricing', 'https://quiz.app/planos']]);
    expect(CONVENTIONAL_PATHS.length).toBe(4);
  });
});

// ------------------------------------------------------------------ imagens (§3)

describe('imagens: gatilho, rótulo e metadados', () => {
  const base = { url: 'https://x.com/', title: 'X', bigImgs: 0, hasVideo: false };
  it('imageTrigger: pouco texto, landing de banner, sem preço com palavra de compra, quiz/VSL; página normal não dispara', () => {
    expect(imageTrigger({ ...base, mainText: 'a'.repeat(300), totalText: 'a'.repeat(300) })).toBe('little_text');
    expect(imageTrigger({ ...base, mainText: 'a'.repeat(2000), totalText: 'a'.repeat(2000), bigImgs: 3 })).toBe('banner_page');
    expect(imageTrigger({ ...base, mainText: `${'texto '.repeat(400)} comprar agora`, totalText: `${'texto '.repeat(400)} comprar agora` })).toBe('no_price');
    expect(imageTrigger({ ...base, url: 'https://x.com/quiz', mainText: 'texto '.repeat(400), totalText: 'texto '.repeat(400) })).toBe('quiz_or_vsl');
    expect(imageTrigger({ ...base, mainText: 'texto '.repeat(400), totalText: 'texto '.repeat(400), hasVideo: true })).toBe('quiz_or_vsl');
    expect(imageTrigger({ ...base, mainText: `${'texto '.repeat(400)} comprar por R$ 97`, totalText: `${'texto '.repeat(400)} comprar por R$ 97` })).toBeNull();
  });

  it('imageCaption rotula por número, papel e origem; stripImage tira o base64 e põe o que foi lido', () => {
    const s = shot({ role: 'main', url: 'https://x.com/' }, 1);
    expect(imageCaption(s)).toBe('[image 1 — page: main https://x.com/ — src: screenshot screen-1]');
    const img: CapturedImage = { ...s, index: 2, kind: 'img', src: 'https://cdn.x.com/banner.jpg', alt: 'Banner' };
    expect(imageCaption(img)).toBe('[image 2 — page: main https://x.com/ — src: https://cdn.x.com/banner.jpg — alt: Banner]');
    expect(stripImage(img, 'Preço no banner')).toEqual({ index: 2, src: 'https://cdn.x.com/banner.jpg', alt: 'Banner', kind: 'img', widthPx: 724, heightPx: 1568, read: 'Preço no banner' });
    expect('data' in stripImage(img)).toBe(false);
  });
});

// ------------------------------------------------------------------ cascata (§1) — as 5 páginas de referência

describe('readOffer: cascata com as páginas de referência do §8', () => {
  it('(1) estática com texto: só HTTP, subpáginas linkadas, sem render nem imagem → crawled', async () => {
    const fetchImpl = site({
      'https://curso.com.br/': () => ok(html('Curso', `${long('Aprenda tráfego pago do zero em 30 dias por R$ 497.', 60)}<a class="btn" href="/comprar">Comprar</a><a href="/sobre">Sobre</a>`)),
      'https://curso.com.br/comprar': () => ok(html('Comprar', long('12x de R$ 49,70. Garantia de 7 dias.'))),
      'https://curso.com.br/sobre': () => ok(html('Sobre', long('Quem somos: 10 anos de tráfego.'))),
    });
    const renderMain = jest.fn(async () => rendered({}));
    const capture = jest.fn(async () => [] as CapturedImage[]);
    const st = stagesOf();
    const r = await readOffer('https://curso.com.br/', { fetchImpl, resolve, certLookup: noCerts, renderMain, capture }, st.on);
    expect(st.list).toEqual(['fetching_page', 'rendering_page', 'reading_subpages', 'reading_images']);
    expect(renderMain).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(r.page.readMode).toBe('crawled');
    expect(r.page.pages.map((p) => [p.role, p.via])).toEqual([['main', 'http'], ['checkout', 'http'], ['about', 'http']]);
    expect(r.images).toEqual([]);
  });

  it('(2) SPA/quiz: HTTP vazio → render com scroll lê a tela 1 → rotas convencionais → quiz dispara imagens → vision', async () => {
    const spa = html('The Kingdom of Love', '<div id="root"></div><noscript>You need to enable JavaScript.</noscript>');
    const fetchImpl = site({
      'https://thekingdomoflove.vercel.app/': () => ok(spa),
      'https://thekingdomoflove.vercel.app/checkout': () => ok(html('Checkout', long('Get the full method for $27 today. 7-day guarantee.', 8))),
    });
    const renderMain = jest.fn(async () => rendered({ url: 'https://thekingdomoflove.vercel.app/', title: 'The Kingdom of Love', text: 'Have the person you want at your feet in just 7 days. Which of these situations is closest to yours right now? '.repeat(4) }));
    const capture = jest.fn(async (main: PageText) => [shot({ role: 'main', url: main.url }, 1), shot({ role: 'main', url: main.url }, 2)]);
    const st = stagesOf();
    const r = await readOffer('https://thekingdomoflove.vercel.app', { fetchImpl, resolve, certLookup: noCerts, renderMain, capture }, st.on);
    expect(renderMain).toHaveBeenCalledTimes(1);
    expect(r.page.rendered).toBe(true);
    expect(r.page.pages.map((p) => [p.role, p.via])).toEqual([['main', 'rendered'], ['checkout', 'http']]);
    expect(r.imageReason).toBe('little_text'); // tela 1 do quiz + checkout curto < 1 500 caracteres
    expect(r.images.length).toBe(2);
    expect(r.page.pages[0].images.map((i) => i.index)).toEqual([1, 2]);
    expect(r.page.readMode).toBe('vision');
  });

  it('(2b) SPA sem binário (render → null) e sem imagem → PAGE_UNREADABLE com o detalhe de hoje; com render vazio → empty_after_render', async () => {
    const spa = html('App', '<div id="root"></div>');
    const fetchImpl = site({ 'https://app.io/': () => ok(spa) });
    await expect(readOffer('https://app.io/', { fetchImpl, resolve, certLookup: noCerts, renderMain: async () => null, capture: async () => [] }, () => undefined))
      .rejects.toMatchObject({ code: 'PAGE_UNREADABLE', message: 'no readable text (page rendered by JavaScript?)' });
    await expect(readOffer('https://app.io/', { fetchImpl, resolve, certLookup: noCerts, renderMain: async () => rendered({ url: 'https://app.io/', text: 'nada' }), capture: async () => [] }, () => undefined))
      .rejects.toMatchObject({ code: 'PAGE_UNREADABLE', details: { reason: 'empty_after_render' } });
  });

  it('(3) preço só em imagem: texto sem padrão de preço + "comprar" dispara visão e as imagens entram na chamada', async () => {
    const body = `${long('Transforme sua pele em 21 dias com o protocolo completo.')}<img src="https://cdn.x.com/preco.jpg" width="800"><a class="btn" href="/checkout">Comprar agora</a>`;
    const fetchImpl = site({
      'https://pele.com.br/': () => ok(html('Pele', body)),
      'https://pele.com.br/checkout': () => ok(html('Checkout', long('Finalize sua compra com segurança.'))),
    });
    const capture = jest.fn(async (main: PageText, pages) => [shot({ role: 'main', url: main.url }, 1), { ...shot({ role: 'main', url: main.url }, 2), kind: 'img' as const, src: 'https://cdn.x.com/preco.jpg', alt: null }, shot({ role: pages[0].role, url: pages[0].url }, 3)]);
    const r = await readOffer('https://pele.com.br/', { fetchImpl, resolve, certLookup: noCerts, renderMain: async () => null, capture }, () => undefined);
    expect(r.imageReason).toBe('no_price');
    expect(r.page.readMode).toBe('vision');
    expect(r.page.pages[1].images.map((i) => i.index)).toEqual([3]);

    // a chamada do Claude leva as imagens antes do texto e devolve sources com imageIndex → fieldOrigins
    const calls: ClaudeCall[] = [];
    const transport: ClaudeTransport = {
      async run(call): Promise<ClaudeResult> {
        calls.push(call);
        return {
          text: JSON.stringify({
            name: 'Protocolo Pele', language: 'pt-BR', kind: 'Curso', what: 'Protocolo de 21 dias.', audience: 'Mulheres 30+', promise: 'Pele renovada em 21 dias', pains: null, proof: null,
            offerAndPrice: '12x de R$ 39,90', cta: 'Comprar agora', notes: null,
            sources: { name: [{ role: 'main', imageIndex: null }], kind: [{ role: 'main', imageIndex: null }], what: [{ role: 'main', imageIndex: null }], audience: [{ role: 'main', imageIndex: null }], promise: [{ role: 'main', imageIndex: 1 }], pains: [], proof: [], offerAndPrice: [{ role: 'main', imageIndex: 2 }, { role: 'checkout', imageIndex: null }], cta: [{ role: 'main', imageIndex: null }], notes: [] },
            imageNotes: [{ index: 1, text: 'Hero com a promessa.' }, { index: 2, text: 'Banner: 12x de R$ 39,90.' }, { index: 3, text: 'Checkout.' }],
          }),
          stopReason: 'end_turn',
          usage: [{ model: 'claude-opus-5-5', inputTokens: 5000, outputTokens: 600, cacheWriteTokens: 0, cacheReadTokens: 0 }],
        };
      },
    };
    const svc = new ClaudeLiveService(transport, new MemoryCostStore(), { model: 'claude-opus-5-5', readOffer: async () => r });
    const out = await svc.extractOffer({ url: 'https://pele.com.br/', workspaceId: 'w', jobId: 'j' }, () => undefined);
    expect(calls[0].images?.map((i) => i.caption)).toEqual([
      '[image 1 — page: main https://pele.com.br/ — src: screenshot screen-1]',
      '[image 2 — page: main https://pele.com.br/ — src: https://cdn.x.com/preco.jpg]',
      '[image 3 — page: checkout https://pele.com.br/checkout — src: screenshot screen-3]',
    ]);
    expect(calls[0].user).toContain('Read mode: crawled+vision — 1 main page, 1 subpage, 3 images');
    expect(calls[0].user.indexOf('<page role="main"')).toBeLessThan(calls[0].user.indexOf('<page role="checkout"'));
    expect(out.readMode).toBe('vision');
    expect(out.fieldOrigins.offerAndPrice).toEqual([{ role: 'main', url: 'https://pele.com.br/', imageIndex: 2 }, { role: 'checkout', url: 'https://pele.com.br/checkout' }]);
    expect(out.fieldOrigins.promise).toEqual([{ role: 'main', url: 'https://pele.com.br/', imageIndex: 1 }]);
    expect(out.fieldOrigins.pains).toBeUndefined();
    expect(out.imagesRead.map((i) => [i.index, i.kind, i.read])).toEqual([[1, 'screenshot', 'Hero com a promessa.'], [2, 'img', 'Banner: 12x de R$ 39,90.'], [3, 'screenshot', 'Checkout.']]);
    expect(out.imagesRead.some((i) => 'data' in i)).toBe(false);
    expect(out.relatedUrls).toEqual(['https://pele.com.br/checkout']);
    expect(out.costUsd).toBeCloseTo(5 * 0.004 + 0.6 * 0.02, 6);
  });

  it('(4) checkout em subdomínio: lido como role checkout por crt.sh mesmo sem link → crawled', async () => {
    const fetchImpl = site({
      'https://www.meucurso.com.br/': () => ok(html('Curso', `${long('Curso completo de confeitaria por R$ 297.')}<a href="https://app.meucurso.com.br/login">Entrar</a>`)),
      'https://checkout.meucurso.com.br/': () => ok(html('Checkout', long('12x de R$ 29,70, garantia de 7 dias.'))),
    });
    const r = await readOffer('https://www.meucurso.com.br/', { fetchImpl, resolve, certLookup: async () => ['https://checkout.meucurso.com.br/'], renderMain: async () => null, capture: async () => [] }, () => undefined);
    expect(r.page.readMode).toBe('crawled');
    expect(r.page.pages.map((p) => [p.role, p.url])).toEqual([['main', 'https://www.meucurso.com.br/'], ['checkout', 'https://checkout.meucurso.com.br/']]);
  });

  it('(5) atrás de login: redirect pra /login com pouco texto, senha no HTML ou senha visível no render → login_wall', async () => {
    const loginHtml = html('Login', '<form><input type="email"><input type="password"><button>Entrar</button></form>');
    const redirect = site({
      'https://membros.app/': () => new Response('', { status: 302, headers: { location: '/login' } }),
      'https://membros.app/login': () => ok(loginHtml),
    });
    await expect(readOffer('https://membros.app/', { fetchImpl: redirect, resolve, certLookup: noCerts }, () => undefined)).rejects.toMatchObject({ code: 'PAGE_UNREADABLE', details: { reason: 'login_wall' } });
    await expect(fetchHtmlPage('https://membros.app/area', { fetchImpl: site({ 'https://membros.app/area': () => ok(loginHtml) }), resolve })).rejects.toMatchObject({ details: { reason: 'login_wall' } });
    const spa = site({ 'https://membros.app/': () => ok(html('App', '<div id="root"></div>')) });
    await expect(readOffer('https://membros.app/', { fetchImpl: spa, resolve, certLookup: noCerts, renderMain: async () => rendered({ url: 'https://membros.app/', text: 'Sign in to continue', passwordVisible: true }) }, () => undefined))
      .rejects.toMatchObject({ code: 'PAGE_UNREADABLE', details: { reason: 'login_wall' } });
  });

  it('render que falha não derruba página que o HTTP já leu; render só roda com texto < 2 000 ou SPA', async () => {
    const fetchImpl = site({ 'https://x.com/': () => ok(html('X', long('Página curta mas legível com oferta e preço R$ 10.', 6))) });
    const renderMain = jest.fn(async () => { throw new IntegracaoError('PAGE_UNREADABLE', 'render failed: boom'); });
    const r = await readOffer('https://x.com/', { fetchImpl, resolve, certLookup: noCerts, renderMain, capture: async () => [] }, () => undefined);
    expect(renderMain).toHaveBeenCalledTimes(1);
    expect(r.page.readMode).toBe('http');
    const big = site({ 'https://x.com/': () => ok(html('X', long('Texto longo de página de vendas com preço R$ 10.', 60))) });
    const r2 = await readOffer('https://x.com/', { fetchImpl: big, resolve, certLookup: noCerts, renderMain, capture: async () => [] }, () => undefined);
    expect(renderMain).toHaveBeenCalledTimes(1);
    expect(r2.page.readMode).toBe('http');
  });
});

// ------------------------------------------------------------------ prompt e parser (§5)

describe('prompt e parser do briefing v2', () => {
  it('briefUserMessage: cabeçalho com o modo, páginas rotuladas por papel na ordem, principal primeiro', () => {
    const msg = briefUserMessage({
      url: 'https://x.com/', title: 'X', text: 'main text', readMode: 'crawled', imageCount: 0,
      pages: [{ url: 'https://x.com/', role: 'main', title: 'X', text: 'main text', truncated: false, via: 'rendered' }, { url: 'https://x.com/checkout', role: 'checkout', title: null, text: 'R$ 97', truncated: true, via: 'http' }],
    });
    expect(msg).toContain('Read mode: crawled — 1 main page, 1 subpage, 0 images');
    expect(msg).toContain('<page role="main" url="https://x.com/" via="rendered" title="X">\nmain text\n</page>');
    expect(msg).toContain('<page role="checkout" url="https://x.com/checkout" via="http" cut="true">\nR$ 97\n</page>');
    expect(briefUserMessage({ text: 'colado' })).toContain('<page role="main" via="pasted">');
  });

  it('BRIEF_SCHEMA cabe no limite da API: ≤ 16 parâmetros com união (anyOf/type array) — bug live 22/10 tinha 19', () => {
    let unions = 0;
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      if (Array.isArray(o.anyOf) || Array.isArray(o.type)) unions++;
      for (const v of Object.values(o)) walk(v);
    };
    walk(BRIEF_SCHEMA);
    expect(unions).toBeLessThanOrEqual(16);
    expect(parseBriefFull(JSON.stringify({ name: 'N', language: 'en', what: 'w', sources: { what: [{ role: 'main', imageIndex: 0 }, { role: 'main', imageIndex: 2 }] } })).sources)
      .toEqual({ what: [{ role: 'main' }, { role: 'main', imageIndex: 2 }] });
  });

  it('BRIEF_SCHEMA exige sources e imageNotes; parseBriefFull tolera formato ruim e tira duplicatas', () => {
    expect(BRIEF_SCHEMA.required).toEqual(expect.arrayContaining(['sources', 'imageNotes']));
    const p = parseBriefFull(JSON.stringify({ name: 'N', language: 'en', kind: null, what: 'w', sources: { what: [{ role: 'main', imageIndex: null }, { role: 'main' }, { role: 'nope' }], kind: [{ role: 'main' }] }, imageNotes: [{ index: 1, text: ' ok ' }, { index: 0, text: 'x' }, 'lixo'] }));
    expect(p.sources).toEqual({ what: [{ role: 'main' }] }); // kind é null → sem origem; role inválido cai
    expect(p.imageNotes).toEqual([{ index: 1, text: 'ok' }]);
    expect(parseBriefFull(JSON.stringify({ name: 'N', language: 'pt' })).sources).toEqual({});
  });
});
