// QA 01/11 · templates-creditos-v1 contra a API do QA (mock, maquina_test, render fake): o que o int spec do backend não cobre.
// Isolamento entre workspaces, OWNER mais antigo paga, Gerar duplo em paralelo, validações do contrato e admin. Dono: maquina-qa.
// Rodar (de testes/): E2E_API_PORT=3151 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261101000100_templates_cold_open_endcard E2E_LIMITES_V2=1 \
//   npx playwright test --project=qa0111-api
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { PERSONAS, WS, q } from '../../harness/db.ts';
import { FALA20, ateLote, oferta, subirArquivo } from '../../harness/iterate.ts';

const saldo = async (id: string) => Number((await q<{ credit_balance: number }>('select credit_balance from users where id = $1', [id]))[0].credit_balance);
const lancamentos = async (id: string) => q<{ kind: string; delta: number; idempotency_key: string }>('select kind, delta, idempotency_key from credit_entries where user_id = $1 order by created_at', [id]);

test('créditos: pagador, isolamento, Gerar duplo, validações e admin', async () => {
  test.setTimeout(900_000);
  const A = as('donoA'); const adminA = as('adminA'); const membroA = as('membroA'); const cliA = as('clienteA'); const B = as('donoB');
  // donoA = OWNER mais antigo, PAID com 1 crédito; adminA vira OWNER depois (membership mais nova), PAID com 100
  await q(`update users set access = 'PAID', account_mode = 'OWN', credit_balance = 1 where id = $1`, [PERSONAS.donoA.id]);
  await q(`update users set access = 'PAID', account_mode = 'OWN', credit_balance = 100 where id = $1`, [PERSONAS.adminA.id]);
  await q(`update memberships set role = 'OWNER', created_at = now() + interval '1 minute' where user_id = $1 and workspace_id = $2`, [PERSONAS.adminA.id, WS.A]);
  await q(`update templates set example_key = 'templates/qa/' || slug || '.mp4' where slug in ('meme-pov', 'static-ad', 'let-hookmill-pick')`);
  const offer = await oferta('A');

  // ── galeria e validações do `use` ──
  const gal = expectOk(await A.get('/ad-templates'));
  expect(gal.credits).toMatchObject({ access: 'PAID', pool: 'CREDITS', balance: 1, unlimited: false });
  expect(gal.items.map((t: any) => t.slug)).toContain('meme-pov');
  expectErro(await A.get('/ad-templates?championId=x&uploadId=y'), 400, 'VALIDATION_ERROR');
  const sub = await subirArquivo('membroA', FALA20);
  expect(sub.complete?.status).toBe(200);
  expectErro(await membroA.post('/ad-templates/meme-pov/use', { uploadId: sub.uploadId, creativeId: 'x', offerId: offer.id }), 400, 'VALIDATION_ERROR');
  expectErro(await cliA.post('/ad-templates/meme-pov/use', { uploadId: sub.uploadId, offerId: offer.id }), 403, 'FORBIDDEN');
  expectErro(await membroA.post('/ad-templates/nao-existe/use', { uploadId: sub.uploadId, offerId: offer.id }), 404, 'NOT_FOUND');
  // upload de A usado por B = 404 (isolamento)
  expect((await B.post('/ad-templates/meme-pov/use', { uploadId: sub.uploadId })).status).toBe(404);

  // ── lote do template até o plano (leitura em mock) ──
  const use = expectOk(await membroA.post('/ad-templates/meme-pov/use', { uploadId: sub.uploadId, offerId: offer.id }), 202);
  const id = use.id as string;
  expect(use.template).toMatchObject({ slug: 'meme-pov', status: 'DRAFT' });
  const b = await ateLote('membroA', id, (x) => ['PLAN_READY', 'ANALYSIS_FAILED', 'PLAN_FAILED'].includes(x.status), { timeoutMs: 600_000, oQue: 'PLAN_READY do template' });
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  expect(b.template).toMatchObject({ quote: 1, pool: 'CREDITS', balance: 1, enough: true });

  // ── isolamento: B não vê nem mexe no lote de A ──
  expect((await B.get(`/iterate/${id}`)).status).toBe(404);
  expect((await B.post(`/iterate/${id}/start`, { expectedCredits: 1, expectedPieces: b.pieces.length })).status).toBe(404);
  const peca = b.template.texts.find((t: any) => t.items.length) ?? null;
  if (peca) expect((await B.patch(`/iterate/${id}/items/${peca.pieceId}/texts`, { texts: [{ path: peca.items[0].path, value: 'x' }] })).status).toBe(404);
  expect(expectOk(await B.get('/iterate?limit=50')).map((r: any) => r.id)).not.toContain(id);
  expect(expectOk(await B.get('/ad-templates/runs')).items.length).toBe(0);
  expect(expectOk(await B.get('/credits')).unlimited).toBe(true); // B = INTERNAL, nada do saldo de A

  // ── textos (grátis, só em PLAN_READY) ──
  if (peca) {
    const it = peca.items[0];
    const longo = 'x'.repeat(it.maxChars + 5);
    const inv = expectErro(await membroA.patch(`/iterate/${id}/items/${peca.pieceId}/texts`, { texts: [{ path: it.path, value: longo }] }), 422, 'TEXT_INVALID');
    expect(inv.violations?.[0]).toMatchObject({ path: it.path });
    expectOk(await membroA.patch(`/iterate/${id}/items/${peca.pieceId}/texts`, { texts: [{ path: it.path, value: it.value.slice(0, Math.max(1, it.maxChars - 1)) }] }));
  }

  // ── Gerar: sem expectedCredits = 400; quote errado = 409 CREDITS_CHANGED; CLIENT = 403 ──
  const pieces = b.pieces.length;
  expectErro(await membroA.post(`/iterate/${id}/start`, { expectedPieces: pieces }), 400, 'VALIDATION_ERROR');
  const ch = expectErro(await membroA.post(`/iterate/${id}/start`, { expectedPieces: pieces, expectedCredits: 5 }), 409, 'CREDITS_CHANGED');
  expect(ch).toMatchObject({ credits: 1 });
  expect((await cliA.post(`/iterate/${id}/start`, { expectedPieces: pieces, expectedCredits: 1 })).status).toBe(403);
  expect(await saldo(PERSONAS.donoA.id)).toBe(1);

  // ── Gerar duplo em paralelo: 1 reserva só, do OWNER mais antigo ──
  const [r1, r2] = await Promise.all([
    membroA.post(`/iterate/${id}/start`, { expectedPieces: pieces, expectedCredits: 1 }),
    membroA.post(`/iterate/${id}/start`, { expectedPieces: pieces, expectedCredits: 1 }),
  ]);
  console.log('Gerar duplo:', r1.status, r2.status, r1.body?.error?.code ?? '', r2.body?.error?.code ?? '');
  expect([r1.status, r2.status].filter((s) => s === 202)).toHaveLength(1);
  const reservas = (await lancamentos(PERSONAS.donoA.id)).filter((e) => e.kind === 'RESERVE');
  expect(reservas).toHaveLength(1);
  expect(await saldo(PERSONAS.donoA.id)).toBe(0);
  expect(await saldo(PERSONAS.adminA.id)).toBe(100); // o OWNER mais novo não paga
  expect((await lancamentos(PERSONAS.adminA.id)).length).toBe(0);
  // texto depois do Gerar = 409
  if (peca) expectErro(await membroA.patch(`/iterate/${id}/items/${peca.pieceId}/texts`, { texts: [{ path: peca.items[0].path, value: 'y' }] }), 409, 'INVALID_STATE');

  // ── 2º uso com saldo 0 = 402 INSUFFICIENT_CREDITS no Gerar (o use passa: leitura e plano não cobram) ──
  const use2 = expectOk(await membroA.post('/ad-templates/meme-pov/use', { uploadId: sub.uploadId, offerId: offer.id }), 202);
  const b2 = await ateLote('membroA', use2.id, (x) => ['PLAN_READY', 'ANALYSIS_FAILED', 'PLAN_FAILED'].includes(x.status), { timeoutMs: 600_000, oQue: 'PLAN_READY 2' });
  expect(b2.status).toBe('PLAN_READY');
  expect(b2.template).toMatchObject({ balance: 0, enough: false });
  const ins = expectErro(await membroA.post(`/iterate/${use2.id}/start`, { expectedPieces: b2.pieces.length, expectedCredits: 1 }), 402, 'INSUFFICIENT_CREDITS');
  expect(ins).toMatchObject({ need: 1, balance: 0, pool: 'CREDITS' });

  // ── admin: só INTERNAL OWNER do workspace ativo; idempotente; chave de outra conta = 400; débito maior que o saldo = 409 ──
  expect((await A.post('/admin/credits/grant', { userId: PERSONAS.donoA.id, credits: 5, note: 'qa', idempotencyKey: 'qa-0111-grant-1' })).status).toBe(403);
  const g1 = expectOk(await B.post('/admin/credits/grant', { email: PERSONAS.donoA.email, credits: 5, note: 'qa', idempotencyKey: 'qa-0111-grant-1' }));
  const g2 = expectOk(await B.post('/admin/credits/grant', { email: PERSONAS.donoA.email, credits: 5, note: 'qa', idempotencyKey: 'qa-0111-grant-1' }));
  expect([g1.balance, g2.balance]).toEqual([5, 5]);
  expect(await saldo(PERSONAS.donoA.id)).toBe(5);
  expectErro(await B.post('/admin/credits/grant', { userId: PERSONAS.adminA.id, credits: 5, note: 'qa', idempotencyKey: 'qa-0111-grant-1' }), 400, 'VALIDATION_ERROR');
  expectErro(await B.post('/admin/credits/grant', { userId: PERSONAS.donoA.id, credits: -1000, note: 'qa', idempotencyKey: 'qa-0111-grant-2' }), 409, 'INVALID_STATE');
  // ledger da conta: B (outra conta) não vê os lançamentos de A
  const ledA = expectOk(await A.get('/credits/ledger')).items;
  expect(ledA.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['RESERVE', 'MANUAL']));
  expect(expectOk(await B.get('/credits/ledger')).items.length).toBe(0);
});
