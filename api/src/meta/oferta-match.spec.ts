// meta-oferta-v1 §3: casamento anúncio → oferta (função pura). Os 12 exemplos do §3.7 são os primeiros casos.
import { type ManualLink, type MatchAd, type MatchInput, type MatchOffer, attributeAds, linkCoverage, linkStrength, needleOf, normalizeUrl, offerInfoOf, refsOf } from './oferta-match';

const X: MatchOffer = { id: 'X', name: 'Spy Gram', archived: false, refs: refsOf(['https://spygram.app/quiz', 'https://pay.kiwify.com.br/Ab12']) };
const Y: MatchOffer = { id: 'Y', name: 'Zap Spy', archived: false, refs: refsOf(['https://zapspy.com.br']) };

let n = 0;
function ad(p: Partial<MatchAd> & { name: string }): MatchAd {
  n++;
  return {
    metaAdId: `ad_${n}`, campaignId: 'c1', campaignName: 'Prospecting', adsetId: 's1', adsetName: 'Broad', destinationUrls: [], destinationSource: 'video_cta', urlTags: null,
    ...p,
  };
}
const post = { destinationUrls: [] as string[], destinationSource: 'existing_post' };

function run(ads: MatchAd[], extra: Partial<MatchInput> = {}, requested = 'X') {
  const input: MatchInput = { offers: [X, Y], manual: [], hookmill: new Map(), champion: new Map(), ...extra };
  const atts = attributeAds(ads, input);
  return (a: MatchAd) => offerInfoOf(a, atts.get(a.metaAdId)!, input, requested, true);
}

describe('§3.7 exemplos (X = Spy Gram, Y = Zap Spy)', () => {
  const cbo01 = ad({ name: 'CBO 01', destinationUrls: ['https://spygram.app/quiz?utm_source=fb'] });
  const cbo02 = ad({ name: 'CBO 02', destinationUrls: ['https://spygram.app/quiz/step-2'] });
  const cbo03 = ad({ name: 'CBO 03', adsetId: 's2', destinationUrls: ['https://pay.kiwify.com.br/Ab12?src=ad'] });
  const cbo04 = ad({ name: 'CBO 04', adsetId: 's2', destinationUrls: ['https://pay.kiwify.com.br/Zz99'] });
  const zap = ad({ name: 'Ad 5', campaignId: 'c2', campaignName: 'ZAPSPY ABO', adsetId: 's3', ...post });
  const novo = ad({ name: 'Teste novo', campaignId: 'c3', adsetId: 's4', destinationUrls: ['https://zapspy.com.br/promo'] });
  const t2 = ad({ name: 'Teste 2', campaignId: 'c3', adsetId: 's4', destinationUrls: ['https://outroproduto.com/vsl'] });
  const lead = ad({ name: 'SPY GRAM | lead', campaignId: 'c4', adsetId: 's5', destinationUrls: [], destinationSource: 'lead_form' });
  const c7 = ad({ name: 'Criativo 7', ...post }); // conjunto s1 dos CBO 01/02
  const c8 = ad({ name: 'Criativo 8', campaignId: 'c9', adsetId: 's9', ...post });
  const c9 = ad({ name: 'Criativo 9', campaignId: 'c9', adsetId: 's9', ...post });
  const all = [cbo01, cbo02, cbo03, cbo04, zap, novo, t2, lead, c7, c8, c9];
  const info = run(all);

  it('1. mesma página com UTM → this, link (força 3)', () => {
    expect(info(cbo01)).toMatchObject({ fit: 'this', offerId: 'X', offerName: 'Spy Gram', match: 'link', confidence: 'high', noneReason: null, destinationHost: 'spygram.app' });
  });
  it('2. caminho abaixo da ref → this, link (força 2)', () => {
    expect(info(cbo02)).toMatchObject({ fit: 'this', match: 'link', confidence: 'high' });
  });
  it('3. checkout Kiwify da oferta → this, link (plataforma + produto)', () => {
    expect(info(cbo03)).toMatchObject({ fit: 'this', match: 'link' });
  });
  it('4. produto Kiwify de outro → other, none / foreign_link', () => {
    expect(info(cbo04)).toMatchObject({ fit: 'other', offerId: null, match: 'none', confidence: null, noneReason: 'foreign_link' });
  });
  it('5. sem link, campanha "ZAPSPY ABO" → other (Y por nome)', () => {
    expect(info(zap)).toMatchObject({ fit: 'other', offerId: 'Y', match: 'name', confidence: 'low' });
  });
  it('6. site de Y em outro caminho → other, Y (ref de Y é a raiz: força 1 pelo §3.3, ver nota)', () => {
    // §3.7 diz "link Y (força 2)", mas o §3.3 manda "path de ref / com anúncio /qualquer dá força 1": vale o §3.3 → domain
    expect(info(novo)).toMatchObject({ fit: 'other', offerId: 'Y', match: 'domain', confidence: 'low' });
  });
  it('7. site que não é de nenhuma oferta → other, foreign_link (D5)', () => {
    expect(info(t2)).toMatchObject({ fit: 'other', offerId: null, noneReason: 'foreign_link' });
  });
  it('8. formulário com o nome da oferta → this, name', () => {
    expect(info(lead)).toMatchObject({ fit: 'this', match: 'name', confidence: 'low', linkPending: false, destinationUrl: null });
  });
  it('9. post existente no conjunto dos CBO 01/02 → this, sibling', () => {
    expect(info(c7)).toMatchObject({ fit: 'this', offerId: 'X', match: 'sibling', confidence: 'low' });
  });
  it('10. post existente em campanha só de posts → unknown, no_link', () => {
    expect(info(c8)).toMatchObject({ fit: 'unknown', offerId: null, match: 'none', noneReason: 'no_link' });
  });
  it('11. CBO 01 marcado NOT_BELONGS pra X → other (manual)', () => {
    const manual: ManualLink[] = [{ level: 'AD', objectId: cbo01.metaAdId, offerId: 'X', decision: 'NOT_BELONGS' }];
    expect(run(all, { manual })(cbo01)).toMatchObject({ fit: 'other', offerId: null, match: 'none', noneReason: 'excluded', manual: { level: 'AD', decision: 'NOT_BELONGS' } });
  });
  it('12. Teste 2 marcado BELONGS X → this, manual', () => {
    const manual: ManualLink[] = [{ level: 'AD', objectId: t2.metaAdId, offerId: 'X', decision: 'BELONGS' }];
    expect(run(all, { manual })(t2)).toMatchObject({ fit: 'this', offerId: 'X', match: 'manual', confidence: 'high', manual: { level: 'AD', decision: 'BELONGS' } });
  });
  it('mesma lista pedindo Y: espelha (X vira other, Y vira this)', () => {
    const forY = run(all, {}, 'Y');
    expect(forY(cbo01).fit).toBe('other');
    expect(forY(zap).fit).toBe('this');
    expect(forY(c8).fit).toBe('unknown');
  });
});

describe('§3.5 ordem das regras e exclusões', () => {
  it('hookmill e campeão antes do link; NOT_BELONGS na campanha pula a regra 3', () => {
    const a = ad({ name: 'HM — Hook', campaignId: 'cx', destinationUrls: ['https://zapspy.com.br/'] });
    const b = ad({ name: 'Imported', campaignId: 'cy', destinationUrls: ['https://zapspy.com.br/'] });
    const extra = { hookmill: new Map([[a.metaAdId, 'X']]), champion: new Map([[b.metaAdId, 'X']]) };
    const info = run([a, b], extra);
    expect(info(a)).toMatchObject({ fit: 'this', match: 'hookmill', confidence: 'high' });
    expect(info(b)).toMatchObject({ fit: 'this', match: 'champion' });
    const excl = run([a, b], { ...extra, manual: [{ level: 'CAMPAIGN', objectId: 'cx', offerId: 'X', decision: 'NOT_BELONGS' }] });
    expect(excl(a)).toMatchObject({ fit: 'other', offerId: 'Y', match: 'link', manual: { level: 'CAMPAIGN', decision: 'NOT_BELONGS' } });
  });
  it('BELONGS por anúncio vale mais que BELONGS por campanha', () => {
    const a = ad({ name: 'A', campaignId: 'cz', ...post });
    const manual: ManualLink[] = [
      { level: 'CAMPAIGN', objectId: 'cz', offerId: 'Y', decision: 'BELONGS' },
      { level: 'AD', objectId: a.metaAdId, offerId: 'X', decision: 'BELONGS' },
    ];
    expect(run([a], { manual })(a)).toMatchObject({ fit: 'this', match: 'manual' });
    expect(run([a], { manual: [manual[0]] })(a)).toMatchObject({ fit: 'other', offerId: 'Y', match: 'manual_campaign' });
  });
  it('empate de link entre ofertas não decide (ambiguous, unknown)', () => {
    const Z: MatchOffer = { id: 'Z', name: 'Outra', archived: false, refs: refsOf(['https://spygram.app/quiz']) };
    const a = ad({ name: 'A', campaignId: 'cw', destinationUrls: ['https://spygram.app/quiz'] });
    const input: MatchInput = { offers: [X, Z], manual: [], hookmill: new Map(), champion: new Map() };
    const att = attributeAds([a], input).get(a.metaAdId)!;
    expect(offerInfoOf(a, att, input, 'X', true)).toMatchObject({ fit: 'unknown', offerId: null, noneReason: 'ambiguous' });
  });
  it('nome: a agulha mais longa vence ("spygram" contém "spyg…"); sem relação = empate', () => {
    const S: MatchOffer = { id: 'S', name: 'Spyg', archived: false, refs: [] };
    const a = ad({ name: 'spy-gram_v3', campaignId: 'cv', ...post });
    const input: MatchInput = { offers: [X, S], manual: [], hookmill: new Map(), champion: new Map() };
    expect(offerInfoOf(a, attributeAds([a], input).get(a.metaAdId)!, input, 'X', true)).toMatchObject({ fit: 'this', match: 'name' });
    const b = ad({ name: 'spygram + zapspy', campaignId: 'cu', ...post });
    const inp2: MatchInput = { offers: [X, Y], manual: [], hookmill: new Map(), champion: new Map() };
    expect(offerInfoOf(b, attributeAds([b], inp2).get(b.metaAdId)!, inp2, 'X', true)).toMatchObject({ fit: 'unknown', noneReason: 'ambiguous' });
  });
  it('utm_campaign do link e url_tags reforçam o nome', () => {
    const a = ad({ name: 'Ad', campaignId: 'ct', destinationUrls: ['https://outro.com/?utm_campaign=spy_gram'] });
    const b = ad({ name: 'Ad', campaignId: 'cs', urlTags: 'utm_campaign=zap-spy', ...post });
    const info = run([a, b]);
    expect(info(a)).toMatchObject({ fit: 'this', match: 'name' });
    expect(info(b)).toMatchObject({ fit: 'other', offerId: 'Y', match: 'name' });
  });
  it('link ainda não lido → unknown, link_pending; oferta sem URL → unknown, offer_has_no_url (nunca foreign_link)', () => {
    const pend = ad({ name: 'P', campaignId: 'cr', destinationUrls: [], destinationSource: null });
    const far = ad({ name: 'F', campaignId: 'cq', destinationUrls: ['https://longe.com/x'] });
    const N: MatchOffer = { id: 'N', name: 'Sem Url', archived: false, refs: [] };
    const input: MatchInput = { offers: [N], manual: [], hookmill: new Map(), champion: new Map() };
    const atts = attributeAds([pend, far], input);
    expect(offerInfoOf(pend, atts.get(pend.metaAdId)!, input, 'N', true)).toMatchObject({ fit: 'unknown', noneReason: 'link_pending', linkPending: true });
    expect(offerInfoOf(far, atts.get(far.metaAdId)!, input, 'N', false)).toMatchObject({ fit: 'unknown', noneReason: 'offer_has_no_url', canEdit: false });
  });
  it('sem oferta pedida: fit e manual null, atribuição igual', () => {
    const a = ad({ name: 'A', campaignId: 'cp', destinationUrls: ['https://spygram.app/quiz'] });
    expect(run([a], {}, null as unknown as string)(a)).toMatchObject({ fit: null, offerId: 'X', match: 'link', manual: null });
  });
});

describe('§3.1-3.3 normalização e força', () => {
  const k = (u: string) => normalizeUrl(u)!;
  it('host sem www./m., path minúsculo sem / final nem index.html, query fora, sem esquema = https', () => {
    expect(k('HTTPS://WWW.MeuSite.com/VSL/index.html?utm=1#x')).toEqual({ host: 'meusite.com', site: 'meusite.com', path: '/vsl', platform: null, product: null });
    expect(k('m.meusite.com//a//b/')).toMatchObject({ host: 'meusite.com', path: '/a/b' });
    expect(k('meusite.com')).toMatchObject({ path: '/' });
    expect(normalizeUrl('ftp://x.com')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
  it('desembrulha l.facebook.com, l.instagram.com, google.com/url e out.reddit.com', () => {
    expect(k('https://l.facebook.com/l.php?u=https%3A%2F%2Fmeusite.com%2Fvsl')).toMatchObject({ host: 'meusite.com', path: '/vsl' });
    expect(k('https://l.instagram.com/?u=https%3A%2F%2Fmeusite.com%2Fa')).toMatchObject({ path: '/a' });
    expect(k('https://www.google.com/url?q=https://meusite.com/b')).toMatchObject({ path: '/b' });
    expect(k('https://out.reddit.com/t3?url=https%3A%2F%2Fmeusite.com%2Fc')).toMatchObject({ path: '/c' });
  });
  it('PSL privado: foo.vercel.app é site próprio; loja.myshopify.com também', () => {
    expect(k('https://foo.vercel.app/x')).toMatchObject({ site: 'foo.vercel.app', platform: null });
    expect(k('https://loja.myshopify.com/products/x')).toMatchObject({ site: 'loja.myshopify.com', platform: null });
  });
  it('§3.2 identidade de produto por plataforma', () => {
    const p = (u: string) => [k(u).platform, k(u).product];
    expect(p('pay.hotmart.com/X12345678Y')).toEqual(['hotmart.com', 'x12345678y']);
    expect(p('go.hotmart.com/X12345678Y?ap=1')).toEqual(['hotmart.com', 'x12345678y']);
    expect(p('pay.kiwify.com.br/AbC123')).toEqual(['kiwify.com.br', 'abc123']);
    expect(p('chk.eduzz.com/123456')).toEqual(['eduzz.com', '123456']);
    expect(p('app.monetizze.com.br/checkout/KAB123')).toEqual(['monetizze.com.br', 'kab123']);
    expect(p('pay.cakto.com.br/abc_123')).toEqual(['cakto.com.br', 'abc_123']);
    expect(p('checkout.perfectpay.com.br/pay/PPU38X')).toEqual(['perfectpay.com.br', 'ppu38x']);
    expect(p('checkout.ticto.app/O12AB')).toEqual(['ticto.com.br', 'o12ab']);
    expect(p('ev.braip.com/checkout/xyz')).toEqual(['braip.com', 'xyz']);
    expect(p('payfast.greenn.com.br/123')).toEqual(['greenn.com.br', '123']);
    expect(p('hop.clickbank.net/?vendor=ABC&affiliate=x')).toEqual(['clickbank.net', 'abc']);
    expect(p('abc.hop.clickbank.net')).toEqual(['clickbank.net', 'abc']);
    expect(p('www.digistore24.com/product/123456')).toEqual(['digistore24.com', '123456']);
    expect(p('buy.stripe.com/abc123')).toEqual(['stripe.com', 'abc123']);
    expect(p('loja.mycartpanda.com/checkout/123:1')).toEqual(['mycartpanda.com', 'loja/123']);
    expect(p('pay.hotmart.com')).toEqual(['hotmart.com', null]);
  });
  it('força: exact, prefix em fronteira de segmento, domain, 0', () => {
    expect(linkStrength(k('https://www.meusite.com/vsl/?utm_source=fb'), k('meusite.com/vsl'))).toBe(3);
    expect(linkStrength(k('meusite.com/curso/v2'), k('meusite.com/curso'))).toBe(2);
    expect(linkStrength(k('meusite.com/cursos'), k('meusite.com/curso'))).toBe(1); // não é prefixo em fronteira
    expect(linkStrength(k('meusite.com/qualquer'), k('meusite.com'))).toBe(1); // ref "/" não dá prefixo
    expect(linkStrength(k('lp.meusite.com/outro'), k('meusite.com/curso'))).toBe(1);
    expect(linkStrength(k('outrosite.com/curso'), k('meusite.com/curso'))).toBe(0);
    expect(linkStrength(k('pay.hotmart.com/A1'), k('pay.hotmart.com/B2'))).toBe(0);
    expect(linkStrength(k('go.hotmart.com/A1?ap=x'), k('pay.hotmart.com/A1'))).toBe(3);
    expect(linkStrength(k('pay.hotmart.com'), k('pay.hotmart.com'))).toBe(0); // sem produto = de todo mundo
  });
  it('agulha: ≥ 4 caracteres, sem acento, fora dos genéricos', () => {
    expect(needleOf('Spy Gram')).toBe('spygram');
    expect(needleOf('Coração Ágil')).toBe('coracaoagil');
    expect(needleOf('App')).toBeNull();
    expect(needleOf('Curso')).toBeNull();
    expect(needleOf('Q-1')).toBeNull();
  });
  it('§4.4 cobertura de link', () => {
    expect(linkCoverage([{ destinationUrls: ['https://a'], destinationSource: 'video_cta' }, { destinationUrls: [], destinationSource: null }, { destinationUrls: [], destinationSource: 'lead_form' }]))
      .toEqual({ read: 1, pending: 1, unreadable: 1 });
  });
});
