// resultado-v1 (28/10, teste manual A3): ResultType → Meta, compat do BusinessType, validação do OTHER, prefixo sugerido.
import { suggestShortCode } from './cliente';
import { RESULT_PROFILE, RESULT_TYPES, defaultResultOf, legacyBusinessTypeOf, pixelEventFor, resultPatchOf, resultStateError } from './resultado';
import { optimizationFor } from '../integracoes/meta/publicacao';
import { RESULT_ACTIONS, resultActionTypes } from '../integracoes/meta/leitura';
import { resultTypeFor } from '../integracoes/meta/mock.service';

describe('resultado-v1: tabela do ResultType', () => {
  it('cada tipo tem perfil completo e action_type do sync', () => {
    for (const t of RESULT_TYPES) {
      expect(RESULT_PROFILE[t]).toBeDefined();
      expect(RESULT_ACTIONS[t].primary).toBeTruthy();
    }
  });
  it('objetivo e evento do pixel na publicação', () => {
    expect(RESULT_PROFILE.PURCHASE).toMatchObject({ objective: 'OUTCOME_SALES', pixelEvent: 'PURCHASE' });
    expect(RESULT_PROFILE.SUBSCRIPTION).toMatchObject({ objective: 'OUTCOME_SALES', pixelEvent: 'SUBSCRIBE' });
    expect(RESULT_PROFILE.LEAD).toMatchObject({ objective: 'OUTCOME_LEADS', pixelEvent: 'LEAD' });
    expect(RESULT_PROFILE.APPOINTMENT).toMatchObject({ objective: 'OUTCOME_LEADS', pixelEvent: 'SCHEDULE' });
    expect(RESULT_PROFILE.SIGNUP).toMatchObject({ objective: 'OUTCOME_LEADS', pixelEvent: 'COMPLETE_REGISTRATION' });
    expect(RESULT_PROFILE.MESSAGE).toMatchObject({ objective: 'OUTCOME_TRAFFIC', pixelEvent: null });
    expect(RESULT_PROFILE.APP_INSTALL).toMatchObject({ objective: 'OUTCOME_APP_PROMOTION', pixelEvent: null });
    expect(RESULT_PROFILE.OTHER).toMatchObject({ objective: 'OUTCOME_TRAFFIC', pixelEvent: null });
  });
  it('pixelEventFor: o do resultType quando o objetivo é o dele; trocou o objetivo = padrão do objetivo', () => {
    expect(pixelEventFor('OUTCOME_LEADS', 'APPOINTMENT')).toBe('SCHEDULE');
    expect(pixelEventFor('OUTCOME_SALES', 'APPOINTMENT')).toBe('PURCHASE');
    expect(pixelEventFor('OUTCOME_SALES', 'SUBSCRIPTION')).toBe('SUBSCRIBE');
    expect(pixelEventFor('OUTCOME_LEADS', null)).toBe('LEAD');
    expect(pixelEventFor('OUTCOME_TRAFFIC', 'PURCHASE')).toBeNull();
  });
  it('optimizationFor usa o pixelEvent; sem ele mantém PURCHASE/LEAD (publicação antiga)', () => {
    expect(optimizationFor('OUTCOME_LEADS', 'px', 'SCHEDULE')).toEqual({ optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: 'px', custom_event_type: 'SCHEDULE' } });
    expect(optimizationFor('OUTCOME_SALES', 'px')).toMatchObject({ promoted_object: { custom_event_type: 'PURCHASE' } });
    expect(optimizationFor('OUTCOME_LEADS', null, 'SCHEDULE')).toEqual({ optimization_goal: 'LINK_CLICKS' });
  });
  it('sync: resultType manda no action_type; MESSAGE conta sem pixel; sem resultType = regra antiga', () => {
    expect(resultActionTypes(null, true, 'SIGNUP')).toEqual({ primary: 'omni_complete_registration', fallback: 'complete_registration' });
    expect(resultActionTypes(null, false, 'MESSAGE').primary).toBe('onsite_conversion.messaging_conversation_started_7d');
    expect(resultActionTypes(null, false, 'LEAD')).toEqual({ primary: 'link_click', fallback: null });
    expect(resultActionTypes('ONLINE_STORE', true)).toEqual({ primary: 'omni_purchase', fallback: 'purchase' });
    expect(resultTypeFor(null, true, 'APPOINTMENT')).toBe('schedule_total');
    expect(resultTypeFor('APP', true)).toBe('omni_app_install');
  });
  it('compat: BusinessType derivado e resultado padrão', () => {
    expect(legacyBusinessTypeOf('PURCHASE')).toBe('ONLINE_STORE');
    expect(legacyBusinessTypeOf('SUBSCRIPTION')).toBe('ONLINE_STORE');
    expect(legacyBusinessTypeOf('MESSAGE')).toBe('LOCAL_BUSINESS');
    expect(legacyBusinessTypeOf('APP_INSTALL')).toBe('APP');
    expect(legacyBusinessTypeOf('OTHER')).toBeNull();
    expect(defaultResultOf('SIGNUP')).toBe('SIGNUPS');
  });
});

describe('resultPatchOf / resultStateError', () => {
  it('businessType antigo migra; resultType manda quando vêm os dois', () => {
    expect(resultPatchOf({ businessType: 'ONLINE_STORE' })).toEqual({ resultType: 'PURCHASE', resultTypeOther: null });
    expect(resultPatchOf({ businessType: 'LOCAL_BUSINESS' })).toEqual({ resultType: 'LEAD', resultTypeOther: null });
    expect(resultPatchOf({ businessType: 'APP' })).toEqual({ resultType: 'APP_INSTALL', resultTypeOther: null });
    expect(resultPatchOf({ businessType: null })).toEqual({ resultType: null, resultTypeOther: null });
    expect(resultPatchOf({ resultType: 'MESSAGE', businessType: 'APP' })).toEqual({ resultType: 'MESSAGE', resultTypeOther: null });
    expect(resultPatchOf({})).toEqual({});
  });
  it('OTHER guarda o texto aparado; trocar pra outro tipo limpa', () => {
    expect(resultPatchOf({ resultType: 'OTHER', resultTypeOther: '  Doações ' })).toEqual({ resultType: 'OTHER', resultTypeOther: 'Doações' });
    expect(resultPatchOf({ resultType: 'LEAD', resultTypeOther: 'x' })).toEqual({ resultType: 'LEAD', resultTypeOther: null });
    expect(resultStateError('OTHER', null)).toMatch(/required/);
    expect(resultStateError('OTHER', 'Doações')).toBeNull();
    expect(resultStateError('LEAD', null)).toBeNull();
  });
});

describe('suggestShortCode (A2)', () => {
  it('iniciais do nome quando livre', () => {
    expect(suggestShortCode('Heirloom Jar', new Set())).toBe('HJ');
    expect(suggestShortCode('Clínica Ótima Sorriso', new Set())).toBe('COS');
    expect(suggestShortCode('Acme', new Set())).toBe('AC');
  });
  it('não repete o prefixo de outro cliente', () => {
    expect(suggestShortCode('Heirloom Jar', new Set(['HJ']))).toBe('HEI');
    expect(suggestShortCode('Acme', new Set(['AC', 'ACM', 'ACME']))).toBe('AC2');
    const code = suggestShortCode('Mooncloth', new Set(['MO', 'MOO', 'MOON', 'MOONC', 'MOONCL']))!;
    expect(code).toMatch(/^[A-Z0-9]{2,6}$/);
    expect(['MO', 'MOO', 'MOON', 'MOONC', 'MOONCL']).not.toContain(code);
  });
  it('sem letra nem dígito = null', () => {
    expect(suggestShortCode('—', new Set())).toBeNull();
  });
});
