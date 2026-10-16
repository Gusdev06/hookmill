import { extractLinks } from './pagina';
import { briefUserMessage } from './prompts';
import { certSubdomains, fetchOfferPages, linkedSubdomains, offerDomain } from './subdominios';

const html = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const long = (s: string) => `<p>${`${s} `.repeat(30)}</p>`;
const page = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('subdomínios da oferta', () => {
  it('offerDomain: sufixo composto, domínio privado e plataforma', () => {
    expect(offerDomain('lp.meucurso.com.br')).toBe('meucurso.com.br');
    expect(offerDomain('oferta.vercel.app')).toBe('oferta.vercel.app'); // site de alguém na Vercel, não "vercel.app"
    expect(offerDomain('pay.hotmart.com')).toBeNull();
    expect(offerDomain('93.184.216.34')).toBeNull();
  });

  it('extractLinks + linkedSubdomains: só subdomínios da oferta, sem infra e um por host', () => {
    const base = new URL('https://www.meucurso.com.br/oferta');
    const links = extractLinks(
      '<a href="https://checkout.meucurso.com.br/p/1">Comprar</a><a href="https://checkout.meucurso.com.br/p/2">x</a>' +
        '<form action="//app.meucurso.com.br/login"></form><a href="/faq">faq</a><a href="mailto:a@b.c">m</a>' +
        '<a href="https://mail.meucurso.com.br">m</a><a href="https://pay.hotmart.com/X">h</a><a href="https://outro.com.br">o</a>' +
        '<a href="https://meucurso.com.br/">raiz</a><a href="#topo">t</a>',
      base,
    );
    expect(links).toContain('https://app.meucurso.com.br/login');
    expect(links).not.toContain('mailto:a@b.c');
    expect(linkedSubdomains(base.toString(), links)).toEqual(['https://checkout.meucurso.com.br/p/1', 'https://app.meucurso.com.br/login']);
    expect(linkedSubdomains('https://go.hotmart.com/x', ['https://pay.hotmart.com/y'])).toEqual([]);
    // suporte/docs saem; funil vem antes do resto
    expect(linkedSubdomains('https://meucurso.com.br/', ['https://blog.meucurso.com.br/a', 'https://help.meucurso.com.br/', 'https://docs.meucurso.com.br/', 'https://membros.meucurso.com.br/'])).toEqual([
      'https://membros.meucurso.com.br/', 'https://blog.meucurso.com.br/a',
    ]);
  });

  it('certSubdomains: tira curinga, infra e o que não tem cara de funil; falha vira []', async () => {
    const rows = [
      { name_value: '*.meucurso.com.br\nmeucurso.com.br' },
      { name_value: 'membros.meucurso.com.br\nmail.meucurso.com.br' },
      { name_value: 'checkout.meucurso.com.br' },
      { name_value: 'jenkins-old.meucurso.com.br\nstaging.meucurso.com.br\noutro.com\napp.linux-packages.meucurso.com.br' },
    ];
    const ok = (async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch;
    expect(await certSubdomains('meucurso.com.br', { fetchImpl: ok })).toEqual(['https://checkout.meucurso.com.br/', 'https://membros.meucurso.com.br/']);
    const down = (async () => { throw new Error('timeout'); }) as unknown as typeof fetch;
    expect(await certSubdomains('meucurso.com.br', { fetchImpl: down })).toEqual([]);
  });

  it('fetchOfferPages: lê linkados + crt.sh até o teto; falha, redirect pra fora e repetido ficam de fora', async () => {
    const sites: Record<string, () => Response> = {
      'https://www.meucurso.com.br/': () => page(html('Curso', long('Aprenda tráfego do zero.') + '<a href="https://checkout.meucurso.com.br/p">Comprar</a><a href="https://quebrado.meucurso.com.br/">x</a>')),
      'https://checkout.meucurso.com.br/p': () => page(html('Checkout', long('12x de R$ 49,70 garantia de 7 dias'))),
      'https://quebrado.meucurso.com.br/': () => new Response('', { status: 500 }),
      'https://membros.meucurso.com.br/': () => new Response('', { status: 302, headers: { location: 'https://pay.hotmart.com/abc' } }),
      'https://app.meucurso.com.br/': () => page(html('App', long('Área do aluno com 40 aulas'))),
    };
    const fetchImpl = (async (u: string) => (sites[u] ?? (() => new Response('', { status: 404 })))()) as unknown as typeof fetch;
    const r = await fetchOfferPages('https://www.meucurso.com.br/', {
      fetchImpl,
      resolve: async () => ['93.184.216.34'],
      certLookup: async () => ['https://checkout.meucurso.com.br/', 'https://membros.meucurso.com.br/', 'https://app.meucurso.com.br/'],
    });
    expect(r.text).toContain('Aprenda tráfego');
    expect(r.related?.map((p) => p.url)).toEqual(['https://checkout.meucurso.com.br/p', 'https://app.meucurso.com.br/']);
    expect(r.related?.[0].text).toContain('garantia de 7 dias');

    const msg = briefUserMessage(r);
    expect(msg.indexOf('<page_text>')).toBeLessThan(msg.indexOf('<related_page url="https://checkout.meucurso.com.br/p" title="Checkout">'));
  });

  it('fetchOfferPages: plataforma não procura subdomínio; página principal com erro continua derrubando', async () => {
    const certLookup = jest.fn(async () => ['https://x.hotmart.com/']);
    const fetchImpl = (async () => page(html('H', long('Produto na Hotmart')))) as unknown as typeof fetch;
    const r = await fetchOfferPages('https://go.hotmart.com/abc', { fetchImpl, resolve: async () => ['93.184.216.34'], certLookup });
    expect(r.related).toEqual([]);
    expect(certLookup).not.toHaveBeenCalled();
    const fail = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    await expect(fetchOfferPages('https://meucurso.com.br', { fetchImpl: fail, resolve: async () => ['93.184.216.34'], certLookup })).rejects.toMatchObject({ code: 'PAGE_FORBIDDEN' });
  });
});
