// Feature 2 · contrato dos uploads (api.md §18, feature-2 §2 limites e §4.1). Dono: maquina-qa.
// Depende de: B4a (módulo uploads/, UPLOAD_MODE=proxy) + V3 (probe). Fixtures: node testes/fixtures/campeoes/gerar.mjs.
// PENDENTE até o B4a: roda só no projeto `feature2` (npm run feature2), fora do `npm run contrato`.
import { readFileSync } from 'node:fs';
import { test, expect } from '../../harness/fixtures.ts';
import { as, call, expectErro, expectOk } from '../../harness/api.ts';
import { q, WS } from '../../harness/db.ts';
import { fixture, manifesto, putCru, subir, esperarJobsQuietos } from '../../harness/f2.ts';
import { ENV } from '../../harness/env.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

const MAX = 209_715_200;
const base = (over: Record<string, unknown> = {}) => ({ purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: 1_000_000, ...over });

test('C-UP-01 POST /uploads → 201 { uploadId, method PUT, url (proxy = <api>/uploads/:id/content), headers, expiresAt ~30 min }', async () => {
  const antes = Date.now();
  const d = expectOk(await as('membroA').post('/uploads', base()), 201);
  expect(d).toMatchObject({ uploadId: expect.any(String), method: 'PUT', url: expect.any(String), headers: expect.any(Object), expiresAt: expect.any(String) });
  expect(d.url).toBe(`${ENV.apiUrl}/uploads/${d.uploadId}/content`);
  const exp = Date.parse(d.expiresAt) - antes;
  expect(exp).toBeGreaterThan(29 * 60_000);
  expect(exp).toBeLessThan(31 * 60_000);
  const [u] = await q('select status, workspace_id, storage_key, size_bytes from uploads where id = $1', [d.uploadId]);
  expect(u).toMatchObject({ status: 'PENDING', workspace_id: WS.A, size_bytes: 1_000_000 });
  expect(u.storage_key.startsWith(`ws/${WS.A}/`), `storage_key fora da pasta do workspace: ${u.storage_key}`).toBe(true);
});

test('C-UP-02 POST /uploads inválido → 400 VALIDATION_ERROR com details.fields (purpose, campo a mais, tamanho, faltando)', async () => {
  for (const body of [
    base({ purpose: 'AVATAR' }),
    base({ sizeBytes: 0 }),
    base({ sizeBytes: -5 }),
    base({ sizeBytes: 'muito' }),
    base({ workspaceId: WS.B }),
    { purpose: 'CHAMPION_VIDEO', mimeType: 'video/mp4', sizeBytes: 10 },
  ]) {
    const det = expectErro(await as('membroA').post('/uploads', body), 400, 'VALIDATION_ERROR');
    expect(Array.isArray(det?.fields), JSON.stringify(body)).toBe(true);
  }
});

test('C-UP-03 sizeBytes > 200 MB → 422 MEDIA_TOO_LARGE { maxBytes } e nada é criado', async () => {
  const sim = manifesto().simulados.find((s) => s.nome === 'grande-demais')!;
  const det = expectErro(await as('membroA').post('/uploads', base({ sizeBytes: sim.sizeBytes })), 422, 'MEDIA_TOO_LARGE');
  expect(det).toMatchObject({ maxBytes: MAX });
  expect(await q('select id from uploads')).toHaveLength(0);
  // exatamente no limite passa
  expectOk(await as('membroA').post('/uploads', base({ sizeBytes: MAX })), 201);
});

test('C-UP-04 mime fora de mp4/mov → 422 MEDIA_INVALID { reason: mime }', async () => {
  for (const mimeType of ['video/webm', 'image/png', 'application/octet-stream']) {
    const det = expectErro(await as('membroA').post('/uploads', base({ mimeType })), 422, 'MEDIA_INVALID');
    expect(det).toMatchObject({ reason: 'mime' });
  }
});

test('C-UP-05 caminho feliz: PUT do mp4 de 20 s + complete → READY, FileRef com duração/dimensão, sem avisos, preço da análise', async () => {
  const f = fixture('fala-split-20s.mp4');
  const s = await subir('membroA', f.file);
  expectOk(s.create, 201);
  expect(s.put!.status, JSON.stringify(s.put!.body)).toBe(200);
  const d = expectOk(s.complete!);
  expect(d).toMatchObject({ uploadId: s.uploadId, status: 'READY', warnings: [] });
  expect(d.file).toMatchObject({ id: expect.any(String), url: expect.any(String), mimeType: 'video/mp4', width: 720, height: 1280 });
  expect(Math.abs(d.file.durationSec - 20)).toBeLessThan(0.2);
  expect(typeof d.analysisEstimateUsd).toBe('number');
  expect(d.analysisEstimateUsd).toBeGreaterThan(0);
  // a URL assinada devolve os mesmos bytes (o PUT em stream não corrompeu)
  const bytes = Buffer.from(await (await fetch(d.file.url)).arrayBuffer());
  expect(bytes.length).toBe(f.sizeBytes);
  expect(Buffer.compare(bytes, readFileSync(f.path))).toBe(0);
  const [u] = await q('select status, file_id from uploads where id = $1', [s.uploadId]);
  expect(u).toMatchObject({ status: 'READY', file_id: d.file.id });
  const [file] = await q('select kind, workspace_id from files where id = $1', [d.file.id]);
  expect(file).toMatchObject({ kind: 'CHAMPION_VIDEO', workspace_id: WS.A });
});

for (const nome of ['fala-split-20s.mov', 'hevc-10s.mp4']) {
  test(`C-UP-06 aceito: ${nome} (MOV / H.265 estão no contrato)`, async () => {
    const s = await subir('membroA', nome);
    const d = expectOk(s.complete!);
    expect(d.status).toBe('READY');
    expect(d.file.mimeType).toBe(fixture(nome).mimeType);
  });
}

test('C-UP-07 avisos que não bloqueiam: sem áudio → no_audio; lado menor 400 px → low_resolution', async () => {
  expect(expectOk((await subir('membroA', 'sem-audio-10s.mp4')).complete!).warnings).toEqual(['no_audio']);
  expect(expectOk((await subir('membroA', '400px-12s.mp4')).complete!).warnings).toEqual(['low_resolution']);
});

for (const nome of ['pequeno-200px-8s.mp4', 'curto-3s.mp4', 'longo-125s.mp4', 'so-audio.mp4']) {
  test(`C-UP-08 recusado no complete: ${nome}`, async () => {
    const f = fixture(nome);
    const esp = f.esperado.complete as { status: number; code: string; details: Record<string, unknown> };
    const s = await subir('membroA', nome);
    expect(s.put!.status).toBe(200);
    const det = expectErro(s.complete!, esp.status, esp.code);
    expect(det).toMatchObject(esp.details);
    if (esp.code !== 'MEDIA_INVALID') expect(typeof det.durationSec).toBe('number');
    const [u] = await q('select status from uploads where id = $1', [s.uploadId]);
    expect(u.status).not.toBe('READY');
  });
}

test('C-UP-09 truncado passa no complete (ffprobe lê) — a decodificação inteira é do job de análise', async () => {
  const s = await subir('membroA', 'truncado-20s.mp4');
  expect(expectOk(s.complete!).status).toBe('READY');
});

test('C-UP-10 complete sem PUT → 409 UPLOAD_INCOMPLETE { expectedBytes, actualBytes: null }', async () => {
  const s = await subir('membroA', 'curto-3s.mp4', { semPut: true });
  const det = expectErro(s.complete!, 409, 'UPLOAD_INCOMPLETE');
  expect(det).toMatchObject({ expectedBytes: fixture('curto-3s.mp4').sizeBytes, actualBytes: null });
});

test('C-UP-11 tamanho declarado maior que o enviado → complete 409 UPLOAD_INCOMPLETE com os dois tamanhos', async () => {
  const f = fixture('curto-3s.mp4');
  const s = await subir('membroA', f.file, { declarar: { sizeBytes: f.sizeBytes + 1000 } });
  expect(s.put!.status).toBe(200);
  const det = expectErro(s.complete!, 409, 'UPLOAD_INCOMPLETE');
  expect(det).toMatchObject({ expectedBytes: f.sizeBytes + 1000, actualBytes: f.sizeBytes });
});

test('C-UP-12 PUT maior que o declarado → 413 (o stream corta no limite)', async () => {
  const f = fixture('curto-3s.mp4');
  const s = await subir('membroA', f.file, { declarar: { sizeBytes: 1000 }, semComplete: true });
  expect(s.put!.status, JSON.stringify(s.put!.body)).toBe(413);
});

test('C-UP-13 upload vencido (30 min) → PUT e complete 410 UPLOAD_EXPIRED', async () => {
  const s = await subir('membroA', 'curto-3s.mp4', { semPut: true, semComplete: true });
  await q(`update uploads set expires_at = (now() at time zone 'utc') - interval '1 minute' where id = $1`, [s.uploadId]);
  const put = await putCru('membroA', s.create.data.url, readFileSync(fixture('curto-3s.mp4').path), s.create.data.headers);
  const complete = await as('membroA').post(`/uploads/${s.uploadId}/complete`, {});
  expect({ put: put.status, complete: complete.status }, JSON.stringify({ put: put.body, complete: complete.body })).toEqual({ put: 410, complete: 410 });
  expectErro(put, 410, 'UPLOAD_EXPIRED');
  expectErro(complete, 410, 'UPLOAD_EXPIRED');
});

test('C-UP-14 id inexistente → 404 NOT_FOUND no PUT e no complete; sem token → 401', async () => {
  const put = await putCru('membroA', `${ENV.apiUrl}/uploads/qa_nao_existe/content`, Buffer.from('x'));
  expectErro(put, 404, 'NOT_FOUND');
  expectErro(await as('membroA').post('/uploads/qa_nao_existe/complete', {}), 404, 'NOT_FOUND');
  expectErro(await call('POST', '/uploads', { body: base() }), 401, 'UNAUTHORIZED');
  // Esclarecimento 06/10 nº 1: o PUT em proxy exige Bearer
  const s = await subir('membroA', 'curto-3s.mp4', { semPut: true, semComplete: true });
  expectErro(await putCru(null, s.create.data.url, Buffer.from('x')), 401, 'UNAUTHORIZED');
});

test('C-UP-15 complete é idempotente: READY repete 200 com o mesmo file; FAILED repete o mesmo 422', async () => {
  const s = await subir('membroA', 'fala-split-20s.mp4');
  const a = expectOk(s.complete!);
  const b = expectOk(await as('membroA').post(`/uploads/${s.uploadId}/complete`, {}));
  expect(b.file.id).toBe(a.file.id);
  expect(b.status).toBe('READY');
  expect(await q('select id from files where kind = $1', ['CHAMPION_VIDEO'])).toHaveLength(1);
  const r = await subir('membroA', 'curto-3s.mp4');
  expectErro(r.complete!, 422, 'MEDIA_TOO_SHORT');
  expectErro(await as('membroA').post(`/uploads/${r.uploadId}/complete`, {}), 422, 'MEDIA_TOO_SHORT');
});
