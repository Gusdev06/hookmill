// resultado-v1 (A2): cor da marca tirada dos CTAs renderizados (nunca do modelo) e do theme-color; leitura do Claude
// devolvendo ramo/mercado/resultado; sonda de cor na cascata só quando a principal não renderizou.
import { brandColorOf, isAccent, parseCssColor, pickCtaColor, themeColorOf } from './cor-marca';
import { BRIEF_SCHEMA } from './prompts';
import { parseBriefFull } from './validacao';
import { schemaStats } from './schema-stats';
import { readOffer } from './leitura';
import type { RenderedPage } from './render-pagina';

describe('cor-marca', () => {
  it('parseCssColor entende rgb, rgba e hex', () => {
    expect(parseCssColor('rgb(228, 87, 46)')).toEqual([228, 87, 46, 1]);
    expect(parseCssColor('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0]);
    expect(parseCssColor('#abc')).toEqual([170, 187, 204, 1]);
    expect(parseCssColor('transparent')).toBeNull();
  });
  it('isAccent descarta branco, preto, cinza e transparente', () => {
    expect(isAccent([255, 255, 255, 1])).toBe(false);
    expect(isAccent([0, 0, 0, 1])).toBe(false);
    expect(isAccent([128, 128, 128, 1])).toBe(false);
    expect(isAccent([228, 87, 46, 0.2])).toBe(false);
    expect(isAccent([228, 87, 46, 1])).toBe(true);
  });
  it('pickCtaColor: a cor de destaque com mais área vence; nada colorido = null', () => {
    expect(pickCtaColor([
      { color: 'rgb(255, 255, 255)', area: 90_000 },
      { color: 'rgb(228, 87, 46)', area: 12_000 },
      { color: 'rgb(230, 88, 47)', area: 10_000 },
      { color: 'rgb(40, 120, 220)', area: 15_000 },
    ])).toBe('#E5572E');
    expect(pickCtaColor([{ color: 'rgba(0, 0, 0, 0)', area: 5000 }, { color: 'rgb(17, 17, 17)', area: 5000 }])).toBeNull();
    expect(pickCtaColor([])).toBeNull();
  });
  it('themeColorOf lê o meta theme-color (ignora o escuro e o neutro)', () => {
    expect(themeColorOf('<head><meta name="theme-color" content="#1E88E5"></head>')).toBe('#1E88E5');
    expect(themeColorOf('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000"><meta content="#ff6600" name="theme-color">')).toBe('#FF6600');
    expect(themeColorOf('<meta name="theme-color" content="#ffffff">')).toBeNull();
    expect(themeColorOf('<title>x</title>')).toBeNull();
  });
  it('brandColorOf: CTA > theme-color > null', () => {
    expect(brandColorOf('#E4572E', '#1E88E5')).toEqual({ hex: '#E4572E', source: 'cta' });
    expect(brandColorOf(null, '#1E88E5')).toEqual({ hex: '#1E88E5', source: 'theme_color' });
    expect(brandColorOf(null, null)).toBeNull();
  });
});

describe('briefing com sugestões do negócio (A2/A3)', () => {
  const base = { name: 'Heirloom Jar', language: 'en', kind: null, what: null, audience: null, promise: null, pains: null, proof: null, offerAndPrice: null, cta: null, notes: null, sources: {}, imageNotes: [] };
  it('industry/market/resultType vêm do modelo; vazio e UNKNOWN viram null', () => {
    expect(parseBriefFull(JSON.stringify({ ...base, industry: 'Faith gifts', market: 'United States', resultType: 'PURCHASE' })).business)
      .toEqual({ industry: 'Faith gifts', market: 'United States', resultType: 'PURCHASE' });
    expect(parseBriefFull(JSON.stringify({ ...base, industry: '', market: 'unknown', resultType: 'UNKNOWN' })).business)
      .toEqual({ industry: null, market: null, resultType: null });
    // porta antiga (sem os campos) não quebra
    expect(parseBriefFull(JSON.stringify(base)).business).toEqual({ industry: null, market: null, resultType: null });
  });
  it('schema: os 3 campos são obrigatórios e não somam união (limite de 16 da API)', () => {
    expect(BRIEF_SCHEMA.required).toEqual(expect.arrayContaining(['industry', 'market', 'resultType']));
    const st = schemaStats(BRIEF_SCHEMA);
    expect(st.unions).toBeLessThanOrEqual(16);
    expect(st.optional).toBe(0);
  });
});

describe('readOffer: cor da marca na cascata (A2)', () => {
  const html = (title: string, body: string, head = '') => `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
  const long = (s: string, n = 60) => `<p>${`${s} `.repeat(n)}</p>`;
  const ok = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const one = (body: string) => (async () => ok(body)) as unknown as typeof fetch;
  const resolve = async () => ['93.184.216.34'];
  const certLookup = async () => [] as string[];
  const rendered = (over: Partial<RenderedPage>): RenderedPage => ({
    url: 'https://loja.com/', title: 'Loja', description: null, text: '', links: [], images: [], bigImgs: 0,
    video: { firstScreen: false, poster: null, ogImage: null }, passwordVisible: false, ...over,
  });
  const page = html('Loja', long('Compre o pote de versículos hoje por US$ 29 com frete grátis.'), '<meta name="theme-color" content="#1E88E5">');

  it('HTTP bastou: a sonda abre a página só pela cor dos CTAs (em vez do theme-color)', async () => {
    const colorProbe = jest.fn(async () => '#E4572E');
    const r = await readOffer('https://loja.com/', { fetchImpl: one(page), resolve, certLookup, capture: null, colorProbe }, () => undefined);
    expect(colorProbe).toHaveBeenCalledTimes(1);
    expect(r.brandColor).toEqual({ hex: '#E4572E', source: 'cta' });
  });
  it('sonda falhando cai pro theme-color; sem sonda também; sem nada = null', async () => {
    const failing = jest.fn(async () => { throw new Error('no browser'); });
    expect((await readOffer('https://loja.com/', { fetchImpl: one(page), resolve, certLookup, capture: null, colorProbe: failing }, () => undefined)).brandColor)
      .toEqual({ hex: '#1E88E5', source: 'theme_color' });
    expect((await readOffer('https://loja.com/', { fetchImpl: one(page), resolve, certLookup, capture: null }, () => undefined)).brandColor)
      .toEqual({ hex: '#1E88E5', source: 'theme_color' });
    const plain = html('Loja', long('Compre hoje por US$ 29.'));
    expect((await readOffer('https://loja.com/', { fetchImpl: one(plain), resolve, certLookup, capture: null }, () => undefined)).brandColor).toBeNull();
  });
  it('principal renderizada: usa a cor do próprio render, sem sonda', async () => {
    const spa = html('Quiz', '<div id="root"></div><noscript>enable JavaScript</noscript>');
    const colorProbe = jest.fn(async () => '#000001');
    const renderMain = jest.fn(async () => rendered({ text: 'Which of these situations is closest to yours right now? '.repeat(40), ctaColor: '#7B2CBF' }));
    const r = await readOffer('https://loja.com/', { fetchImpl: one(spa), resolve, certLookup, renderMain, capture: null, colorProbe }, () => undefined);
    expect(colorProbe).not.toHaveBeenCalled();
    expect(r.brandColor).toEqual({ hex: '#7B2CBF', source: 'cta' });
  });
});
