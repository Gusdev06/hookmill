// Contrato §1 (envelope, validação) e §2 (auth). Depende de: B1 (auth, seed, envelope, ValidationPipe, guard JWT).
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk, login, tokenOf } from '../../harness/api.ts';
import { ENV } from '../../harness/env.ts';
import { PERSONAS, WS } from '../../harness/db.ts';

test('C-AUTH-01 health é pública e responde { ok, db, storage, version }', async () => {
  const res = await call('GET', '/health');
  const d = expectOk(res);
  for (const k of ['ok', 'db', 'storage', 'version']) expect(d).toHaveProperty(k);
});

test('C-AUTH-02 login certo devolve tokens, expiresIn 900, user e workspace', async () => {
  const d = expectOk(await login(ENV.ownerEmail));
  expect(typeof d.accessToken).toBe('string');
  expect(typeof d.refreshToken).toBe('string');
  expect(d.expiresIn).toBe(900);
  expect(d.user).toMatchObject({ id: PERSONAS.donoA.id, email: ENV.ownerEmail });
  expect(d.user).toHaveProperty('uiLocale');
  expect(d.user).not.toHaveProperty('passwordHash');
  expect(d.workspace).toMatchObject({ id: WS.A, role: 'OWNER' });
});

test('C-AUTH-03 senha errada e e-mail inexistente → 401 INVALID_CREDENTIALS (mesma resposta)', async () => {
  expectErro(await login(ENV.ownerEmail, 'senha-errada-123'), 401, 'INVALID_CREDENTIALS');
  expectErro(await login('ninguem@teste.local', 'senha-errada-123'), 401, 'INVALID_CREDENTIALS');
});

test('C-AUTH-04 login sem campo, com campo inválido ou campo a mais → 400 VALIDATION_ERROR com details.fields', async () => {
  const d1 = expectErro(await call('POST', '/auth/login', { body: { email: ENV.ownerEmail } }), 400, 'VALIDATION_ERROR');
  expect(d1.fields.some((f: any) => f.field === 'password')).toBe(true);
  expectErro(await call('POST', '/auth/login', { body: { email: 'nao-e-email', password: 'x' } }), 400, 'VALIDATION_ERROR');
  const d3 = expectErro(await call('POST', '/auth/login', { body: { email: ENV.ownerEmail, password: ENV.password, workspaceId: WS.B } }), 400, 'VALIDATION_ERROR');
  expect(d3.fields.some((f: any) => f.field === 'workspaceId')).toBe(true);
  expectErro(await call('POST', '/auth/login', { raw: '{nao json' }), 400, 'VALIDATION_ERROR');
});

test('C-AUTH-05 rota autenticada sem token, token lixo ou assinado com outro segredo → 401 UNAUTHORIZED', async () => {
  expectErro(await call('GET', '/auth/me'), 401, 'UNAUTHORIZED');
  expectErro(await call('GET', '/auth/me', { token: 'lixo' }), 401, 'UNAUTHORIZED');
  // JWT forjado com alg none e wid de outro workspace
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forjado = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: PERSONAS.donoA.id, wid: WS.B, role: 'OWNER' })}.`;
  expectErro(await call('GET', '/auth/me', { token: forjado }), 401, 'UNAUTHORIZED');
});

test('C-AUTH-06 GET /auth/me lista user, workspace ativo e todos os workspaces do usuário', async () => {
  const d = expectOk(await as('duplo').get('/auth/me'));
  expect(d.user.id).toBe(PERSONAS.duplo.id);
  expect(d.workspace.id).toBe(WS.A);
  expect(d.workspaces.map((w: any) => w.id).sort()).toEqual([WS.A, WS.B].sort());
});

test('C-AUTH-07 refresh é rotativo: o novo funciona, o antigo vira 401 REFRESH_INVALID', async () => {
  const l = expectOk(await login(PERSONAS.adminA.email));
  const r1 = expectOk(await call('POST', '/auth/refresh', { body: { refreshToken: l.refreshToken } }));
  expect(r1.refreshToken).not.toBe(l.refreshToken);
  expectErro(await call('POST', '/auth/refresh', { body: { refreshToken: l.refreshToken } }), 401, 'REFRESH_INVALID');
  expectOk(await call('POST', '/auth/refresh', { body: { refreshToken: r1.refreshToken } }));
  expectErro(await call('POST', '/auth/refresh', { body: { refreshToken: 'inexistente' } }), 401, 'REFRESH_INVALID');
});

test('C-AUTH-08 logout revoga o refresh token', async () => {
  const l = expectOk(await login(PERSONAS.membroA.email));
  expect(expectOk(await call('POST', '/auth/logout', { token: l.accessToken, body: { refreshToken: l.refreshToken } }))).toEqual({ ok: true });
  expectErro(await call('POST', '/auth/refresh', { body: { refreshToken: l.refreshToken } }), 401, 'REFRESH_INVALID');
});

test('C-AUTH-09 switch-workspace: membro troca pro outro workspace; não-membro recebe 404', async () => {
  const d = expectOk(await as('duplo').post('/auth/switch-workspace', { workspaceId: WS.B }));
  expect(d.workspace.id).toBe(WS.B);
  const me = expectOk(await call('GET', '/auth/me', { token: d.accessToken }));
  expect(me.workspace.id).toBe(WS.B);
  expectErro(await as('membroA').post('/auth/switch-workspace', { workspaceId: WS.B }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post('/auth/switch-workspace', { workspaceId: 'nao-existe' }), 404, 'NOT_FOUND');
});

test('C-AUTH-10 PATCH /auth/me troca nome e idioma; senha exige a atual correta', async () => {
  const d = expectOk(await as('membroA').patch('/auth/me', { name: 'Novo Nome', uiLocale: 'PT_BR' }));
  expect(d).toMatchObject({ name: 'Novo Nome', uiLocale: 'PT_BR' });
  expectErro(await as('membroA').patch('/auth/me', { uiLocale: 'FR' }), 400, 'VALIDATION_ERROR');
  const bad = await as('membroA').patch('/auth/me', { password: { current: 'errada-errada', next: 'outra-senha-123' } });
  expect([400, 401]).toContain(bad.status);
});

test('C-AUTH-11 convite: criar (OWNER/ADMIN), ler público, aceitar com senha ≥10, reusar → 410', async () => {
  const inv = expectOk(await as('donoA').post('/workspace/invites', { email: 'convidado@teste.local', role: 'MEMBER' }), 201);
  expect(inv).toHaveProperty('inviteUrl');
  expect(inv).toHaveProperty('expiresAt');
  const token = String(inv.inviteUrl).split('/').filter(Boolean).pop()!;
  expect(expectOk(await call('GET', `/auth/invites/${token}`))).toMatchObject({ workspaceName: 'QA Alfa', email: 'convidado@teste.local', role: 'MEMBER' });
  expectErro(await call('POST', `/auth/invites/${token}/accept`, { body: { name: 'Conv', password: 'curta' } }), 400, 'VALIDATION_ERROR');
  const acc = expectOk(await call('POST', `/auth/invites/${token}/accept`, { body: { name: 'Conv', password: 'senha-longa-123' } }));
  expect(acc.workspace).toMatchObject({ id: WS.A, role: 'MEMBER' });
  expectErro(await call('GET', `/auth/invites/${token}`), 410, 'INVITE_INVALID');
  expectErro(await call('POST', `/auth/invites/${token}/accept`, { body: { name: 'Conv', password: 'senha-longa-123' } }), 410, 'INVITE_INVALID');
});

test('C-AUTH-12 convite: MEMBER não convida (403), e-mail já membro → 409 EMAIL_TAKEN, revogado → 410', async () => {
  expectErro(await as('membroA').post('/workspace/invites', { email: 'x@teste.local', role: 'MEMBER' }), 403, 'FORBIDDEN');
  expectErro(await as('donoA').post('/workspace/invites', { email: PERSONAS.adminA.email, role: 'MEMBER' }), 409, 'EMAIL_TAKEN');
  expectErro(await as('donoA').post('/workspace/invites', { email: 'y@teste.local', role: 'OWNER' }), 400, 'VALIDATION_ERROR');
  const inv = expectOk(await as('adminA').post('/workspace/invites', { email: 'revogado@teste.local', role: 'ADMIN' }), 201);
  expect(expectOk(await as('adminA').del(`/workspace/invites/${inv.id}`))).toEqual({ ok: true });
  const token = String(inv.inviteUrl).split('/').filter(Boolean).pop()!;
  expectErro(await call('GET', `/auth/invites/${token}`), 410, 'INVITE_INVALID');
});

test('C-AUTH-13 token de usuário removido do workspace para de valer no refresh', async () => {
  const l = expectOk(await login(PERSONAS.membroA.email));
  expectOk(await as('donoA').del(`/workspace/members/${PERSONAS.membroA.id}`));
  expectErro(await call('POST', '/auth/refresh', { body: { refreshToken: l.refreshToken } }), 401, 'REFRESH_INVALID');
});

test('C-AUTH-14 tokens em cache funcionam (sanidade do harness)', async () => {
  expect(typeof (await tokenOf('donoB'))).toBe('string');
});
