// meta-templates-v2 (B1/B3, 03/11): regras do §3, resolução do agendamento (§2.3), mínimo do total (§2.2), campos novos
// dos settings/estrutura (§6) e importação (§7). Funções puras + `availability` do service com a porta falsa.
import type { MetaTemplateAd, MetaTemplateAdset, MetaTemplateBody, MetaTemplateCampaign } from '@maquina/contratos';
import { AppException } from '../common/errors/app-exception';
import { MetaError, cifrar, type MetaTemplateSourceRead } from '../integracoes';
import {
  applyOverride, availabilityErrors, budgetTooLow, campaignShapeChanged, isLocalDateTime, localToUtc, mergedErrors, overrideErrors, patchNeedsRecheck, pixelMissing, resolveSchedule,
  reusesTemplateCampaign, snapshotOf, structureOf, templateBodyErrors, templateFromSource, v2Settings,
} from './templates';
import { MetaTemplatesService } from './templates.service';

const campaign = (o: Partial<MetaTemplateCampaign> = {}): MetaTemplateCampaign => ({
  destination: 'REUSE_CAMPAIGN', objective: 'OUTCOME_SALES', budgetMode: 'CBO', dailyBudgetMinor: 2000, bidStrategy: 'LOWEST_COST', bidAmountMinor: null,
  specialAdCategories: [], namePattern: 'HookMill — {offer}', ...o,
});
const adset = (o: Partial<MetaTemplateAdset> = {}): MetaTemplateAdset => ({
  pixelId: 'pix_mock', pixelEvent: 'PURCHASE', countries: ['US'], ageMin: 18, ageMax: 65, genders: 'ALL', advantageAudience: true, placements: 'AUTO',
  adsPerAdset: { min: 4, max: 8 }, namePattern: '{offer} — {date} — {n}', ...o,
});
const ad = (o: Partial<MetaTemplateAd> = {}): MetaTemplateAd => ({
  primaryText: null, headline: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com/x', urlTags: null, namePattern: '{code}', ...o,
});
const body = (c: Partial<MetaTemplateCampaign> = {}, a: Partial<MetaTemplateAdset> = {}, d: Partial<MetaTemplateAd> = {}): MetaTemplateBody => ({
  name: 'T', campaign: campaign(c), adset: adset(a), ad: ad(d),
});
const rules = (b: MetaTemplateBody) => templateBodyErrors(b, false).map((e) => `${e.field}:${e.rule}`);
const AWARE = { pixelId: null, pixelEvent: null } as const;
const LIFE = { budgetType: 'LIFETIME' as const, dailyBudgetMinor: 0, lifetimeBudgetMinor: 30000, destination: 'NEW_CAMPAIGN' as const };
const END7 = { schedule: { start: null, end: { kind: 'AFTER_DAYS' as const, days: 7 } } };

describe('meta-templates-v2 §3 validação (formato e regras cruzadas)', () => {
  it('template v1 salvo (sem campos novos) continua válido', () => {
    expect(rules(body())).toEqual([]);
  });

  it('objetivo: os 6 no template; fora deles isIn', () => {
    expect(rules(body({ objective: 'OUTCOME_AWARENESS' }, AWARE))).toEqual([]);
    expect(rules(body({ objective: 'OUTCOME_ENGAGEMENT' }, { ...AWARE, optimizationGoal: 'POST_ENGAGEMENT' }))).toEqual([]);
    expect(rules(body({ objective: 'OUTCOME_REACH' as never }))).toContain('campaign.objective:isIn');
  });

  it('orçamento: DAILY/LIFETIME e as 5 regras', () => {
    expect(rules(body({ budgetType: 'WEEKLY' as never }))).toContain('campaign.budgetType:isIn');
    expect(rules(body({ dailyBudgetMinor: 0 }))).toContain('campaign.dailyBudgetMinor:isInt');
    expect(rules(body({ lifetimeBudgetMinor: 100 }))).toContain('campaign.lifetimeBudgetMinor:notAllowed');
    expect(rules(body({ budgetType: 'DAILY', lifetimeBudgetMinor: null }))).toEqual([]);
    expect(rules(body({ ...LIFE }, END7))).toEqual([]);
    expect(rules(body({ ...LIFE, dailyBudgetMinor: 500 }, END7))).toContain('campaign.dailyBudgetMinor:zeroForLifetime');
    expect(rules(body({ ...LIFE, lifetimeBudgetMinor: 0 }, END7))).toContain('campaign.lifetimeBudgetMinor:isInt');
    expect(rules(body({ ...LIFE, lifetimeBudgetMinor: 1.5 }, END7))).toContain('campaign.lifetimeBudgetMinor:isInt');
    expect(rules(body({ ...LIFE, destination: 'REUSE_CAMPAIGN' }, END7))).toContain('campaign.destination:lifetimeCboNeedsNewCampaign');
    // ABO + LIFETIME + REUSE pode (cada conjunto tem o seu total)
    expect(rules(body({ ...LIFE, budgetMode: 'ABO', destination: 'REUSE_CAMPAIGN' }, END7))).toEqual([]);
  });

  it('LIFETIME sem fim = requiredForLifetime', () => {
    expect(rules(body({ ...LIFE }))).toContain('adset.schedule.end:requiredForLifetime');
    expect(rules(body({ ...LIFE }, { schedule: { start: null, end: null } }))).toContain('adset.schedule.end:requiredForLifetime');
  });

  it('meta de desempenho e pixel por objetivo', () => {
    expect(rules(body({ objective: 'OUTCOME_AWARENESS' }, { ...AWARE, optimizationGoal: 'POST_ENGAGEMENT' }))).toContain('adset.optimizationGoal:isIn');
    expect(rules(body({ objective: 'OUTCOME_AWARENESS' }, { ...AWARE, optimizationGoal: 'BANANA' as never }))).toContain('adset.optimizationGoal:isIn');
    expect(rules(body({}, { optimizationGoal: 'REACH' }))).toContain('adset.optimizationGoal:notForObjective');
    expect(rules(body({}, { optimizationGoal: null }))).toEqual([]);
    expect(rules(body({ objective: 'OUTCOME_AWARENESS' }))).toContain('adset.pixelId:notForObjective');
    // só o evento já é proibido (o erro sai em pixelId)
    expect(rules(body({ objective: 'OUTCOME_ENGAGEMENT' }, { pixelId: null, pixelEvent: 'LEAD' }))).toEqual(['adset.pixelId:notForObjective']);
  });

  it('agendamento: formato', () => {
    expect(isLocalDateTime('2026-11-10T14:00')).toBe(true);
    expect(isLocalDateTime('2026-02-30T14:00')).toBe(false);
    expect(isLocalDateTime('2026-11-10T24:00')).toBe(false);
    expect(isLocalDateTime('2026-11-10T14:00:00Z')).toBe(false);
    expect(rules(body({}, { schedule: { start: '2026-11-10 14:00', end: null } }))).toContain('adset.schedule.start:isLocalDateTime');
    expect(rules(body({}, { schedule: { start: null, end: { kind: 'AT', at: 'amanhã' } } }))).toContain('adset.schedule.end:isLocalDateTime');
    expect(rules(body({}, { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 0 } } }))).toContain('adset.schedule.end:isInt');
    expect(rules(body({}, { schedule: { start: null, end: { kind: 'AFTER_DAYS', days: 366 } } }))).toContain('adset.schedule.end:isInt');
    expect(rules(body({}, { schedule: null }))).toEqual([]);
  });

  it('idiomas, públicos e Instagram', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ key: i + 1, name: `L${i}` }));
    expect(rules(body({}, { locales: many }))).toContain('adset.locales:isLocaleList');
    expect(rules(body({}, { locales: [{ key: 6, name: 'a' }, { key: 6, name: 'b' }] }))).toContain('adset.locales:isLocaleList');
    expect(rules(body({}, { locales: [{ key: 1.5, name: 'a' }] }))).toContain('adset.locales:isLocaleList');
    expect(rules(body({}, { locales: [{ key: 6, name: 'English (US)' }] }))).toEqual([]);
    const aud = Array.from({ length: 21 }, (_, i) => ({ id: `ca_${i}`, name: 'x' }));
    expect(rules(body({}, { customAudiences: aud }))).toContain('adset.customAudiences:isAudienceList');
    expect(rules(body({}, { excludedCustomAudiences: [{ id: '', name: 'x' }] }))).toContain('adset.excludedCustomAudiences:isAudienceList');
    expect(rules(body({}, { customAudiences: [{ id: 'ca_1', name: 'a' }], excludedCustomAudiences: [{ id: 'ca_1', name: 'a' }] })))
      .toContain('adset.excludedCustomAudiences:includedAndExcluded');
    expect(rules(body({}, {}, { instagramAccount: { id: 'ig_1', username: 'x'.repeat(101) } }))).toContain('ad.instagramAccount:isInstagramAccount');
    expect(rules(body({}, {}, { instagramAccount: { id: 'ig_1', username: 'hookmill' } }))).toEqual([]);
    expect(rules(body({}, {}, { instagramAccount: null }))).toEqual([]);
  });

  it('chave desconhecida continua notAllowed', () => {
    expect(rules(body({}, { interests: [] } as never))).toContain('adset.interests:notAllowed');
  });
});

describe('meta-templates-v2 §2.3 agendamento no fuso da conta', () => {
  const now = new Date('2026-11-03T12:00:00Z'); // 09:00 em São Paulo (UTC−3, sem horário de verão)

  it('converte hora local pra UTC (São Paulo e Nova York com horário de verão)', () => {
    expect(localToUtc('2026-11-10T14:00', 'America/Sao_Paulo').toISOString()).toBe('2026-11-10T17:00:00.000Z');
    expect(localToUtc('2026-07-10T14:00', 'America/New_York').toISOString()).toBe('2026-07-10T18:00:00.000Z'); // EDT −4
    expect(localToUtc('2026-01-10T14:00', 'America/New_York').toISOString()).toBe('2026-01-10T19:00:00.000Z'); // EST −5
    // 08/03/2026 02:30 não existe em NY (pula de 02:00 pra 03:00): anda pra frente
    expect(localToUtc('2026-03-08T02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(localToUtc('2026-11-10T14:00', 'Nada/Disso').toISOString()).toBe('2026-11-10T14:00:00.000Z');
  });

  it('salvar: início > 5 min no passado = inPast; dentro dos 5 min passa', () => {
    expect(resolveSchedule({ start: '2026-11-03T08:50', end: null }, 'America/Sao_Paulo', now, 'save').errors).toEqual([{ field: 'adset.schedule.start', rule: 'inPast' }]);
    expect(resolveSchedule({ start: '2026-11-03T08:57', end: null }, 'America/Sao_Paulo', now, 'save').errors).toEqual([]);
  });

  it('enviar: início passado vira agora (start_time não vai); futuro vai em UTC', () => {
    const past = resolveSchedule({ start: '2026-11-01T08:00', end: { kind: 'AFTER_DAYS', days: 7 } }, 'America/Sao_Paulo', now, 'send');
    expect(past.errors).toEqual([]);
    expect(past.value).toEqual({ startTime: null, endTime: '2026-11-10T12:00:00.000Z', days: 7 });
    const fut = resolveSchedule({ start: '2026-11-05T10:00', end: { kind: 'AFTER_DAYS', days: 3 } }, 'America/Sao_Paulo', now, 'send');
    expect(fut.value).toEqual({ startTime: '2026-11-05T13:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', days: 3 });
  });

  it('fim AT: passado = inPast; < 24 h do início efetivo = minDuration24h; dias = teto', () => {
    expect(resolveSchedule({ start: null, end: { kind: 'AT', at: '2026-11-02T10:00' } }, 'America/Sao_Paulo', now, 'send').errors)
      .toEqual([{ field: 'adset.schedule.end', rule: 'inPast' }]);
    expect(resolveSchedule({ start: null, end: { kind: 'AT', at: '2026-11-04T08:00' } }, 'America/Sao_Paulo', now, 'save').errors)
      .toEqual([{ field: 'adset.schedule.end', rule: 'minDuration24h' }]);
    expect(resolveSchedule({ start: '2026-11-05T10:00', end: { kind: 'AT', at: '2026-11-06T09:00' } }, 'America/Sao_Paulo', now, 'save').errors)
      .toEqual([{ field: 'adset.schedule.end', rule: 'minDuration24h' }]);
    const ok = resolveSchedule({ start: null, end: { kind: 'AT', at: '2026-11-05T10:00' } }, 'America/Sao_Paulo', now, 'send');
    expect(ok.errors).toEqual([]);
    expect(ok.value.days).toBe(3); // 2 d 1 h → 3
  });

  it('sem agendamento = nada resolvido', () => {
    expect(resolveSchedule(null, 'UTC', now, 'send')).toEqual({ value: { startTime: null, endTime: null, days: null }, errors: [] });
  });
});

describe('meta-templates-v2 §2.2 mínimo, pixel e forma da campanha', () => {
  it('mínimo diário (v1) e do total (mínimo × dias)', () => {
    expect(budgetTooLow(campaign({ dailyBudgetMinor: 400 }), 500, null, 'USD')).toEqual({ minimumMinor: 500, currency: 'USD' });
    expect(budgetTooLow(campaign({ dailyBudgetMinor: 500 }), 500, null, 'USD')).toBeNull();
    expect(budgetTooLow(campaign({ ...LIFE, lifetimeBudgetMinor: 3000 }), 500, 7, 'USD')).toEqual({ minimumMinor: 3500, currency: 'USD', budgetType: 'LIFETIME', days: 7 });
    expect(budgetTooLow(campaign({ ...LIFE, lifetimeBudgetMinor: 3500 }), 500, 7, 'USD')).toBeNull();
    expect(budgetTooLow(campaign({ ...LIFE, lifetimeBudgetMinor: 1 }), 500, null, 'USD')).toBeNull();
    expect(budgetTooLow(campaign({ dailyBudgetMinor: 1 }), null, null, 'USD')).toBeNull();
  });

  it('pixelMissing: Awareness/Engagement nunca pedem pixel', () => {
    expect(pixelMissing(campaign({ objective: 'OUTCOME_AWARENESS' }), adset(AWARE))).toBe(false);
    expect(pixelMissing(campaign(), adset({ pixelId: null, pixelEvent: null }))).toBe(true);
  });

  it('campaignShapeChanged compara o tipo de orçamento (ausente = DAILY)', () => {
    expect(campaignShapeChanged(campaign(), campaign({ budgetType: 'DAILY' }))).toBe(false);
    expect(campaignShapeChanged(campaign(), campaign({ budgetType: 'LIFETIME' }))).toBe(true);
  });
});

describe('meta-templates-v2 §6 settings e estrutura', () => {
  const sched = { startTime: '2026-11-05T13:00:00.000Z', endTime: '2026-11-08T13:00:00.000Z', days: 3 };

  it('template v1 = nenhum campo novo (settings e estrutura iguais aos de hoje)', () => {
    const t = { campaign: campaign(), adset: adset(), ad: ad() };
    expect(v2Settings(t, { startTime: null, endTime: null, days: null })).toEqual({});
    const s = structureOf(t, { campaign: 'C', adset: 'A' }, { ...v2Settings(t, sched) } as never);
    expect(Object.keys(s).sort()).toEqual(['adsetName', 'advantageAudience', 'bidAmountMinor', 'bidStrategy', 'budgetMode', 'campaignName', 'genders', 'placements', 'urlTags']);
  });

  it('v2 completo: total, agenda resolvida, meta padrão, idiomas, públicos e Instagram', () => {
    const t = {
      campaign: campaign({ ...LIFE, objective: 'OUTCOME_AWARENESS' }),
      adset: adset({ ...AWARE, optimizationGoal: null, schedule: { start: '2026-11-05T10:00', end: { kind: 'AFTER_DAYS', days: 3 } }, locales: [{ key: 6, name: 'English (US)' }], customAudiences: [{ id: 'ca_1', name: 'a' }], excludedCustomAudiences: [{ id: 'ca_2', name: 'b' }] }),
      ad: ad({ instagramAccount: { id: 'ig_1', username: 'hm' } }),
    };
    const v2 = v2Settings(t, sched);
    expect(v2).toEqual({
      budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, startTime: sched.startTime, endTime: sched.endTime, optimizationGoal: 'REACH',
      locales: [6], customAudienceIds: ['ca_1'], excludedCustomAudienceIds: ['ca_2'], instagramUserId: 'ig_1',
    });
    const s = structureOf(t, { campaign: 'C', adset: 'A' }, v2 as never);
    expect(s).toMatchObject(v2);
  });

  it('notAvailable por campo; lista não lida = pula', () => {
    const t = { adset: adset({ customAudiences: [{ id: 'ca_mock_gone', name: 'x' }], excludedCustomAudiences: [{ id: 'ca_ok', name: 'y' }] }), ad: ad({ instagramAccount: { id: 'ig_mock_gone', username: 'g' } }) };
    expect(availabilityErrors(t, { instagram: new Set(['ig_1']), audiences: new Set(['ca_ok']) })).toEqual([
      { field: 'ad.instagramAccount', rule: 'notAvailable' }, { field: 'adset.customAudiences', rule: 'notAvailable' },
    ]);
    expect(availabilityErrors(t, { instagram: null, audiences: null })).toEqual([]);
  });
});

describe('meta-templates-v2 §7 importação', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const ctx = { level: 'campaign' as const, id: 'c1', defaultCountries: ['US'], fallbackLink: null, now };
  const src = (o: { campaign?: Partial<MetaTemplateSourceRead['campaign']>; adset?: Partial<NonNullable<MetaTemplateSourceRead['adset']>>; creative?: Partial<NonNullable<NonNullable<MetaTemplateSourceRead['ad']>['creative']>> } = {}): MetaTemplateSourceRead => ({
    campaign: { id: 'c1', name: 'Camp', objective: 'OUTCOME_SALES', bidStrategy: 'LOWEST_COST_WITHOUT_CAP', dailyBudgetMinor: 2000, lifetimeBudgetMinor: null, specialAdCategories: [], startTime: null, stopTime: null, ...o.campaign },
    adset: {
      id: 'a1', name: 'Set', bidStrategy: null, bidAmountMinor: null, dailyBudgetMinor: null, lifetimeBudgetMinor: null, optimizationGoal: 'OFFSITE_CONVERSIONS',
      promotedObject: { pixelId: 'pix', customEventType: 'PURCHASE', applicationId: null }, targeting: { geo_locations: { countries: ['US'] } }, startTime: null, endTime: null, ...o.adset,
    },
    ad: { id: 'ad1', name: 'Ad', creative: { message: null, title: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com', urlTags: null, ...o.creative } },
  });
  const fields = (r: { unsupported: { field: string }[] }) => r.unsupported.map((u) => u.field);

  it('v1 (diário, sem campos novos) continua igual e é válido', () => {
    const r = templateFromSource(src(), ctx);
    expect(r.adjusted).toBeUndefined();
    expect(r.unsupported).toEqual([]);
    expect(r.template.campaign).not.toHaveProperty('budgetType');
    expect(r.template.adset).not.toHaveProperty('schedule');
    expect(templateBodyErrors(r.template, false)).toEqual([]);
  });

  it('total da campanha → CBO + LIFETIME + NEW_CAMPAIGN; agendamento fixo → N dias (adjusted)', () => {
    const r = templateFromSource(src({ campaign: { dailyBudgetMinor: null, lifetimeBudgetMinor: 30000 }, adset: { startTime: '2026-11-01T03:00:00+0000', endTime: '2026-11-08T03:00:00+0000' } }), ctx);
    expect(r.template.campaign).toMatchObject({ budgetMode: 'CBO', budgetType: 'LIFETIME', lifetimeBudgetMinor: 30000, dailyBudgetMinor: 0, destination: 'NEW_CAMPAIGN' });
    expect(r.template.adset.schedule).toEqual({ start: null, end: { kind: 'AFTER_DAYS', days: 7 } });
    expect(r.adjusted).toEqual([{ field: 'adset.schedule', value: 'Ran 2026-11-01 – 2026-11-08 → runs 7 days from publish' }]);
    expect(fields(r)).not.toContain('campaign.lifetimeBudget');
    expect(templateBodyErrors(r.template, false)).toEqual([]);
  });

  it('total do conjunto → ABO + LIFETIME (REUSE pode)', () => {
    const r = templateFromSource(src({ campaign: { dailyBudgetMinor: null }, adset: { lifetimeBudgetMinor: 9000, endTime: '2026-11-13T12:00:00+0000' } }), ctx);
    expect(r.template.campaign).toMatchObject({ budgetMode: 'ABO', budgetType: 'LIFETIME', lifetimeBudgetMinor: 9000, destination: 'REUSE_CAMPAIGN' });
    expect(r.template.adset.schedule).toEqual({ start: null, end: { kind: 'AFTER_DAYS', days: 10 } }); // só fim: contado de agora
  });

  it('só fim, já passado → sem agendamento (adjusted)', () => {
    const r = templateFromSource(src({ adset: { endTime: '2026-10-01T00:00:00+0000' } }), ctx);
    expect(r.template.adset.schedule).toBeNull();
    expect(r.adjusted?.[0].field).toBe('adset.schedule');
  });

  it('idiomas, públicos e Instagram (nome das listas; fallback)', () => {
    const r = templateFromSource(src({
      adset: { targeting: { geo_locations: { countries: ['US'], cities: [{ key: '1', name: 'Austin' }] }, locales: [6, 999], custom_audiences: [{ id: 'ca_1', name: 'Buyers' }], excluded_custom_audiences: [{ id: 'ca_2', name: 'Old' }], flexible_spec: [{ interests: [{ id: '1', name: 'Yoga' }] }] } },
      creative: { instagramUserId: 'ig_mock_1' },
    }), { ...ctx, locales: [{ key: 6, name: 'English (US)' }], instagramAccounts: [{ id: 'ig_mock_1', username: 'hookmill.demo', profilePicUrl: null, source: 'AD_ACCOUNT' }] });
    expect(r.template.adset.locales).toEqual([{ key: 6, name: 'English (US)' }, { key: 999, name: 'Locale 999' }]);
    expect(r.template.adset.customAudiences).toEqual([{ id: 'ca_1', name: 'Buyers' }]);
    expect(r.template.adset.excludedCustomAudiences).toEqual([{ id: 'ca_2', name: 'Old' }]);
    expect(r.template.ad.instagramAccount).toEqual({ id: 'ig_mock_1', username: 'hookmill.demo' });
    expect(fields(r)).toEqual(expect.arrayContaining(['adset.targeting.geo_locations.cities', 'adset.targeting.flexible_spec']));
    expect(fields(r)).not.toContain('adset.targeting.locales');
    expect(fields(r)).not.toContain('adset.targeting.custom_audiences');
    // sem lista: username = id
    expect(templateFromSource(src({ creative: { instagramUserId: 'ig_x' } }), ctx).template.ad.instagramAccount).toEqual({ id: 'ig_x', username: 'ig_x' });
  });

  it('Awareness: meta aceita copiada, sem pixel', () => {
    const r = templateFromSource(src({ campaign: { objective: 'OUTCOME_AWARENESS' }, adset: { optimizationGoal: 'AD_RECALL_LIFT', promotedObject: null } }), ctx);
    expect(r.template.campaign.objective).toBe('OUTCOME_AWARENESS');
    expect(r.template.adset).toMatchObject({ optimizationGoal: 'AD_RECALL_LIFT', pixelId: null, pixelEvent: null });
    expect(r.template.ad.callToAction).toBe('SHOP_NOW');
    expect(r.unsupported).toEqual([]);
    expect(templateBodyErrors(r.template, false)).toEqual([]);
  });

  it('Engagement: ON_VIDEO copia; MESSENGER e meta fora da tabela vão pro unsupported com o padrão', () => {
    const ok = templateFromSource(src({ campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { optimizationGoal: 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS', destinationType: 'ON_VIDEO', promotedObject: null } }), ctx);
    expect(ok.template.adset.optimizationGoal).toBe('TWO_SECOND_CONTINUOUS_VIDEO_VIEWS');
    const msg = templateFromSource(src({ campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { optimizationGoal: 'CONVERSATIONS', destinationType: 'MESSENGER', promotedObject: null } }), ctx);
    expect(msg.template.adset.optimizationGoal).toBe('THRUPLAY');
    expect(fields(msg)).toContain('adset.destinationType');
    const off = templateFromSource(src({ campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { optimizationGoal: 'POST_ENGAGEMENT', destinationType: 'ON_VIDEO', promotedObject: null } }), ctx);
    expect(off.template.adset.optimizationGoal).toBe('THRUPLAY');
    expect(fields(off)).toContain('adset.optimizationGoal');
    // pixel na origem com Engagement: sai do template e aparece no unsupported
    const px = templateFromSource(src({ campaign: { objective: 'OUTCOME_ENGAGEMENT' }, adset: { optimizationGoal: 'THRUPLAY', destinationType: 'ON_VIDEO' } }), ctx);
    expect(px.template.adset.pixelId).toBeNull();
    expect(templateBodyErrors(px.template, false)).toEqual([]);
  });

  it('Reservation e criativo flexível/carrossel continuam unsupported', () => {
    const r = templateFromSource(src({ campaign: { buyingType: 'RESERVED' }, creative: { format: 'CAROUSEL' } }), ctx);
    expect(fields(r)).toEqual(expect.arrayContaining(['campaign.buyingType', 'ad.creative.format']));
  });
});

describe('MetaTemplatesService.availability (porta falsa)', () => {
  const key = 'a'.repeat(64);
  const conn = { id: 'conn1', adAccountId: 'act_mock_1', pageId: 'page_1', metaUserId: 'mock_user', tokenCiphertext: cifrar('tok', key), status: 'ACTIVE' } as never;
  const make = (meta: object) => new MetaTemplatesService(
    { metaConnection: { updateMany: async () => ({ count: 0 }) } } as never, { metaMode: 'mock', metaTokenKey: key } as never, {} as never, {} as never, meta as never,
  );
  const t = { adset: adset({ customAudiences: [{ id: 'ca_mock_gone', name: 'x' }] }), ad: ad({ instagramAccount: { id: 'ig_mock_1', username: 'hm' } }) };
  const lists = {
    listInstagramAccounts: jest.fn(async () => ({ accounts: [{ id: 'ig_mock_1', username: 'hm', profilePicUrl: null, source: 'AD_ACCOUNT' }], pageLookup: 'ok' })),
    listCustomAudiences: jest.fn(async () => ({ audiences: [{ id: 'ca_mock_buyers' }], truncated: false })),
  };

  it('template sem referência não chama a Meta', async () => {
    const svc = make(lists);
    lists.listInstagramAccounts.mockClear();
    expect(await svc.availability(conn, { adset: adset(), ad: ad() }, 'save')).toEqual([]);
    expect(lists.listInstagramAccounts).not.toHaveBeenCalled();
  });

  it('público que sumiu = notAvailable', async () => {
    expect(await make(lists).availability(conn, t, 'send')).toEqual([{ field: 'adset.customAudiences', rule: 'notAvailable' }]);
  });

  it('Meta fora: pula ao salvar, falha no envio', async () => {
    const down = { ...lists, listCustomAudiences: async () => { throw new MetaError('META_UNAVAILABLE', null, { details: { reason: 'down', retryAfterSec: 30 } }); } };
    expect(await make(down).availability(conn, t, 'save')).toEqual([]);
    await expect(make(down).availability(conn, t, 'send')).rejects.toBeInstanceOf(AppException);
  });

  it('lista truncada não acusa ausência', async () => {
    const big = { ...lists, listCustomAudiences: async () => ({ audiences: [], truncated: true }) };
    expect(await make(big).availability(conn, t, 'send')).toEqual([]);
  });
});

describe('patchNeedsRecheck (v2 §3, B2 do QA 03/11)', () => {
  it('só name e/ou isDefault não revalida; qualquer seção (ou importedFrom) revalida o mesclado', () => {
    expect(patchNeedsRecheck({})).toBe(false);
    expect(patchNeedsRecheck({ name: 'x' })).toBe(false);
    expect(patchNeedsRecheck({ isDefault: true })).toBe(false);
    expect(patchNeedsRecheck({ name: 'x', isDefault: false, campaign: undefined })).toBe(false);
    expect(patchNeedsRecheck({ name: 'x', campaign: campaign() })).toBe(true);
    expect(patchNeedsRecheck({ adset: adset() })).toBe(true);
    expect(patchNeedsRecheck({ ad: ad() })).toBe(true);
    expect(patchNeedsRecheck({ importedFrom: null })).toBe(true);
  });
});

describe('meta-templates-v2 §14 override do envio (04/11)', () => {
  const tpl = { campaign: campaign(), adset: adset(), ad: ad() };
  const r = (o: unknown) => overrideErrors(o).map((e) => `${e.field}:${e.rule}`);

  it('formato: ausente ok; níveis opcionais e inteiros com a validação do template; caminhos campaign.*/adset.*/ad.*', () => {
    expect(r(undefined)).toEqual([]);
    expect(r({})).toEqual([]);
    expect(r({ adset: adset({ countries: ['BR'] }) })).toEqual([]);
    expect(r([])).toEqual(['override:isObject']);
    expect(r({ name: 'x', isDefault: true, foo: 1 })).toEqual(['override.name:notAllowed', 'override.isDefault:notAllowed', 'override.foo:notAllowed']);
    expect(r({ campaign: { dailyBudgetMinor: 5000 } })).toEqual(expect.arrayContaining(['campaign.destination:isIn', 'campaign.objective:isIn']));
    expect(r({ campaign: campaign({ dailyBudgetMinor: 0 }) })).toEqual(['campaign.dailyBudgetMinor:isInt']);
    expect(r({ adset: adset({ ageMin: 40, ageMax: 30 }), ad: ad({ link: 'nope' }) })).toEqual(['adset.ageMax:gteAgeMin', 'ad.link:isUrl']);
    expect(r({ campaign: campaign({ objective: 'OUTCOME_AWARENESS' }), adset: adset() })).toEqual(['adset.pixelId:notForObjective']);
  });

  it('applyOverride troca só os níveis que vieram; mergedErrors cruza o mesclado (objetivo do envio × conjunto do template)', () => {
    const none = applyOverride(tpl, undefined);
    expect(none).toEqual({ ...tpl, overridden: [] });
    expect(mergedErrors(none)).toEqual([]);
    const s = applyOverride(tpl, { ad: ad({ primaryText: 'Only this send' }) });
    expect(s.overridden).toEqual(['ad']);
    expect(s.ad.primaryText).toBe('Only this send');
    expect(s.campaign).toBe(tpl.campaign);
    expect(tpl.ad.primaryText).toBeNull(); // o template não muda
    const aware = applyOverride(tpl, { campaign: campaign({ objective: 'OUTCOME_AWARENESS' }) });
    expect(mergedErrors(aware).map((e) => `${e.field}:${e.rule}`)).toEqual(['adset.pixelId:notForObjective']);
  });

  it('snapshotOf: lê o gravado; Json velho/estranho = null (cai no template ao vivo)', () => {
    const s = applyOverride(tpl, { adset: adset({ countries: ['BR'] }) });
    expect(snapshotOf(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(snapshotOf(null)).toBeNull();
    expect(snapshotOf({ campaign: {} })).toBeNull();
    expect(snapshotOf({ ...s, overridden: ['adset', 'x'] })?.overridden).toEqual(['adset']);
  });

  it('REUSE só com a campanha na mesma forma do template; orçamento/nome mudando continua reaproveitando', () => {
    expect(reusesTemplateCampaign(campaign(), campaign())).toBe(true);
    expect(reusesTemplateCampaign(campaign({ dailyBudgetMinor: 9000, namePattern: 'X' }), campaign())).toBe(true);
    expect(reusesTemplateCampaign(campaign({ objective: 'OUTCOME_TRAFFIC' }), campaign())).toBe(false);
    expect(reusesTemplateCampaign(campaign({ budgetMode: 'ABO' }), campaign())).toBe(false);
    expect(reusesTemplateCampaign(campaign({ destination: 'NEW_CAMPAIGN' }), campaign())).toBe(false);
    expect(reusesTemplateCampaign(campaign(), campaign({ destination: 'NEW_CAMPAIGN' }))).toBe(false);
  });
});
