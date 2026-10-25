// Leitura das páginas (antes `fetchOfferPages`) mora em subpaginas.ts / leitura.ts desde a leitura v2 (22/10): ver leitura.spec.ts.
import { extractLinks } from './pagina';
import { certSubdomains, linkedSubdomains, offerDomain } from './subdominios';

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
});
