import { cssAccentColorsOf, pickCtaColors, secondColorOf } from './cor-marca';
import { logoOf } from './logo-marca';

const BASE = 'https://loja.com/produto';

describe('logo da leitura (lacunas-home-eddy-v1 §2)', () => {
  it('img de logo no cabeçalho vence os ícones', () => {
    const html = `<html><head><link rel="icon" href="/favicon.ico"></head><body><header><img class="site-logo" src="/img/logo.svg"></header></body></html>`;
    expect(logoOf(html, BASE)).toEqual({ url: 'https://loja.com/img/logo.svg', source: 'header' });
  });
  it('sem logo no cabeçalho: apple-touch-icon antes do favicon; maior sizes vence', () => {
    const html = `<head><link rel="icon" sizes="32x32" href="/f32.png"><link rel="icon" sizes="192x192" href="/f192.png"><link rel="apple-touch-icon" href="https://cdn.loja.com/apple.png"></head><body><header><img src="/hero.jpg"></header></body>`;
    expect(logoOf(html, BASE)).toEqual({ url: 'https://cdn.loja.com/apple.png', source: 'icon' });
    expect(logoOf(`<link rel="icon" sizes="32x32" href="/f32.png"><link rel="shortcut icon" sizes="192x192" href="/f192.png">`, BASE)).toEqual({ url: 'https://loja.com/f192.png', source: 'icon' });
  });
  it('og:image por último; data: e nada = null', () => {
    expect(logoOf(`<meta property="og:image" content="https://loja.com/share.jpg">`, BASE)).toEqual({ url: 'https://loja.com/share.jpg', source: 'og_image' });
    expect(logoOf(`<link rel="icon" href="data:image/png;base64,AAA">`, BASE)).toBeNull();
    expect(logoOf('<p>oi</p>', BASE)).toBeNull();
  });
});

describe('2ª cor da leitura (lacunas-home-eddy-v1 §2)', () => {
  it('grupos de CTA do mais pesado pro mais leve, sem cinza', () => {
    expect(pickCtaColors([
      { color: 'rgb(228, 87, 46)', area: 1000 }, { color: 'rgb(29, 53, 87)', area: 400 }, { color: 'rgb(200,200,200)', area: 5000 },
    ])).toEqual(['#E4572E', '#1D3557']);
  });
  it('variáveis CSS com nome de marca, só cor de destaque', () => {
    const html = `<style>:root{--primary:#e4572e;--text:#222;--color-secondary: rgb(29,53,87);--bg:#fff}</style>`;
    expect(cssAccentColorsOf(html)).toEqual(['#E4572E', '#1D3557']);
  });
  it('a 1ª candidata longe da 1ª cor; sem 1ª cor = null', () => {
    expect(secondColorOf('#E4572E', [{ hex: '#E65A30', source: 'cta' }, { hex: '#1D3557', source: 'css' }])).toEqual({ hex: '#1D3557', source: 'css' });
    expect(secondColorOf(null, [{ hex: '#1D3557', source: 'css' }])).toBeNull();
    expect(secondColorOf('#E4572E', [{ hex: null, source: 'theme_color' }])).toBeNull();
  });
});
