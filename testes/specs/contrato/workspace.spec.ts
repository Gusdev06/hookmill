// Contrato §14 (Settings) + catálogos (§9 engines/voices, §11 templates). Depende de: B1 (workspaces), B2 (custos), I1 (catálogo), V2 (templates).
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { PERSONAS, WS } from '../../harness/db.ts';

test('C-WS-01 GET /workspace devolve { id, name, uiLocale, monthlySpendCapUsd } do workspace do token', async () => {
  const d = expectOk(await as('donoA').get('/workspace'));
  expect(d).toMatchObject({ id: WS.A, name: 'QA Alfa' });
  expect(d).toHaveProperty('uiLocale');
  expect(d).toHaveProperty('monthlySpendCapUsd');
});

test('C-WS-02 PATCH /workspace: OWNER/ADMIN mudam teto (número ou null); MEMBER → 403 FORBIDDEN', async () => {
  expect(expectOk(await as('adminA').patch('/workspace', { monthlySpendCapUsd: 50 })).monthlySpendCapUsd).toBe(50);
  expect(expectOk(await as('donoA').patch('/workspace', { monthlySpendCapUsd: null })).monthlySpendCapUsd).toBeNull();
  expectErro(await as('membroA').patch('/workspace', { monthlySpendCapUsd: 9999 }), 403, 'FORBIDDEN');
  expectErro(await as('donoA').patch('/workspace', { monthlySpendCapUsd: -1 }), 400, 'VALIDATION_ERROR');
  expectErro(await as('donoA').patch('/workspace', { id: WS.B }), 400, 'VALIDATION_ERROR');
});

test('C-WS-03 membros: lista só do workspace; só OWNER muda papel; último OWNER → 409 LAST_OWNER', async () => {
  const d = expectOk(await as('membroA').get('/workspace/members'));
  expect(d.members.map((m: any) => m.userId).sort()).toEqual([PERSONAS.donoA.id, PERSONAS.adminA.id, PERSONAS.membroA.id, PERSONAS.duplo.id, PERSONAS.clienteA.id].sort()); // CLIENT (fase2-agencia)
  expect(Array.isArray(d.invites)).toBe(true);
  expectErro(await as('adminA').patch(`/workspace/members/${PERSONAS.membroA.id}`, { role: 'ADMIN' }), 403, 'FORBIDDEN');
  expect(expectOk(await as('donoA').patch(`/workspace/members/${PERSONAS.membroA.id}`, { role: 'ADMIN' })).role).toBe('ADMIN');
  // Mudanças 05/10 §2: código próprio LAST_OWNER
  expectErro(await as('donoA').patch(`/workspace/members/${PERSONAS.donoA.id}`, { role: 'MEMBER' }), 409, 'LAST_OWNER');
  expectErro(await as('donoA').del(`/workspace/members/${PERSONAS.donoA.id}`), 409, 'LAST_OWNER');
});

test('C-WS-04 services mostra chave mascarada, nunca a chave inteira', async () => {
  const d = expectOk(await as('membroA').get('/workspace/services'));
  expect(d.map((s: any) => s.provider).sort()).toEqual(['ANTHROPIC', 'APIFY', 'HIGGSFIELD', 'META', 'STORAGE', 'WAVESPEED']); // feature 2 + meta-v1
  for (const s of d) if (s.keyMasked) expect(s.keyMasked.length).toBeLessThan(16);
});

test('C-WS-05 spend do mês: formato e 400 em mês inválido', async () => {
  const d = expectOk(await as('membroA').get('/workspace/spend?month=2026-10'));
  expect(d).toMatchObject({ month: '2026-10' });
  for (const k of ['spentUsd', 'capUsd', 'byProvider', 'byKind']) expect(d).toHaveProperty(k);
  expectErro(await as('membroA').get('/workspace/spend?month=outubro'), 400, 'VALIDATION_ERROR');
});

test('C-CAT-01 GET /engines lista SCENES e LIPSYNC com modelos e formatos', async () => {
  const d = expectOk(await as('membroA').get('/engines'));
  expect(d.engines.map((e: any) => e.id).sort()).toEqual(['LIPSYNC', 'SCENES']);
  for (const e of d.engines) expect(e.models.length).toBeGreaterThan(0);
  expect(d.formats.sort()).toEqual(['PORTRAIT_4_5', 'SQUARE_1_1', 'VERTICAL_9_16']);
});

test('C-CAT-02 GET /voices filtra por idioma e traz gênero e amostra', async () => {
  const d = expectOk(await as('membroA').get('/voices?language=en'));
  expect(Array.isArray(d)).toBe(true);
  for (const v of d) {
    expect(['female', 'male', 'neutral']).toContain(v.gender);
    expect(v).toHaveProperty('sample');
  }
});

test('C-CAT-03 GET /templates lista clean, bold, headline', async () => {
  const d = expectOk(await as('membroA').get('/templates'));
  expect(d.map((t: any) => t.id).sort()).toEqual(['bold', 'clean', 'headline', 'remix-keep']); // remix-keep (feature 2): kind remix, o wizard filtra
  expect(d.find((t: any) => t.id === 'remix-keep').kind).toBe('remix');
  expect(d.find((t: any) => t.id === 'headline').supportsHeadline).toBe(true);
});
