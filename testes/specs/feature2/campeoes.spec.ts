// Feature 2 · contrato dos campeões (api.md §19, §17 gatilhos feature 2; feature-2 §3.1 máquina, §4.2 rotas).
// Depende de: B4a (campeoes/ + job de análise) + I4a (mock AdLibrary/analyzeChampion/transcrição) + V3 (medição real).
// PENDENTE até o B4a: roda só no projeto `feature2` (npm run feature2). Nada pago: INTEGRACOES_MODE e AD_LIBRARY_MODE = mock.
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, expectErro, expectOk, expectPagina } from '../../harness/api.ts';
import { q, WS, type Persona } from '../../harness/db.ts';
import { criarOferta } from '../../harness/fabrica.ts';
import { SECTION_KEYS, criarCampeao, subir, esperarJobsQuietos } from '../../harness/f2.ts';

test.afterEach(async () => { await esperarJobsQuietos(); });

const AD = (id: string) => `https://www.facebook.com/ads/library/?id=${id}`;

async function uploadPronto(p: Persona, file = 'fala-split-20s.mp4'): Promise<string> {
  const s = await subir(p, file);
  expectOk(s.complete!);
  return s.uploadId!;
}
async function importar(p: Persona, body: Record<string, unknown>) {
  return as(p).post('/champions', { rights: 'THIRD_PARTY', ...body });
}
const lerCampeao = (p: Persona, id: string) => as(p).get(`/champions/${id}`).then((r) => expectOk(r));
const ateTerminar = (p: Persona, id: string, timeoutMs = 60_000) =>
  aguardar(() => lerCampeao(p, id), (c) => c.status === 'READY' || c.status === 'FAILED', { timeoutMs, intervalMs: 1000, oQue: `campeão ${id} sair de RESOLVING/ANALYZING` });

test('C-CH-01 GET /champions/config: limites, Ad Library, preço da análise e tipos do build de 10/10', async () => {
  const c = expectOk(await as('membroA').get('/champions/config'));
  expect(c).toMatchObject({ maxBytes: 209_715_200, minSec: 5, maxSec: 120 });
  expect(c.mimeTypes).toEqual(expect.arrayContaining(['video/mp4', 'video/quicktime']));
  expect(Object.keys(c.adLibrary).sort()).toEqual(['available', 'reason', 'retryAfter']);
  expect(typeof c.adLibrary.available).toBe('boolean');
  expect([null, 'quota', 'not_configured']).toContain(c.adLibrary.reason);
  expect(c.adLibrary.retryAfter === null || typeof c.adLibrary.retryAfter === 'string').toBe(true);
  // em mock a Ad Library responde (os gatilhos da §17 dependem disso)
  expect(c.adLibrary.available).toBe(true);
  expect(c.analysisUsdPerSec).toBeGreaterThan(0);
  const kinds = Object.fromEntries(c.kinds.map((k: any) => [k.kind, k.enabled]));
  expect(kinds).toEqual({ SWAP_AVATAR: true, NEW_HOOKS: true, COPY_NEW: false, REMIX_EDIT: false });
});

test('C-CH-02 upload → 202 ANALYZING com job CHAMPION_ANALYZE → READY com teardown de 12 seções, medições reais e tipos disponíveis', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA');
  const d = expectOk(await importar('membroA', { offerId: offer.id, uploadId, name: 'Champ QA' }), 202);
  expect(d).toMatchObject({ status: 'ANALYZING', name: 'Champ QA', rights: 'THIRD_PARTY', sources: ['UPLOAD'], offer: { id: offer.id } });
  expect(d.job).toMatchObject({ type: 'CHAMPION_ANALYZE' });
  const fim = await ateTerminar('membroA', d.id);
  expect(fim.status, JSON.stringify(fim).slice(0, 500)).toBe('READY');
  expect(fim.job.checklist.map((c: any) => c.key)).toEqual(['reading_video', 'extracting_audio', 'transcribing', 'measuring', 'mapping_edit', 'diagnosing']); // §13.7: mapping_edit antes de diagnosing
  expect(fim.job.checklist.every((c: any) => c.done)).toBe(true);
  // teardown: 12 seções, cada uma ok ou na+motivo (nunca some)
  const t = fim.teardown;
  expect(Object.keys(t.sections).sort()).toEqual([...SECTION_KEYS].sort());
  for (const k of SECTION_KEYS) {
    const s = t.sections[k];
    expect(['ok', 'na'], k).toContain(s.status);
    if (s.status === 'na') expect(typeof s.naReason, k).toBe('string');
  }
  expect(t.transcript.words.length).toBeGreaterThanOrEqual(5);
  for (const w of t.transcript.words) expect(w.endSec).toBeGreaterThanOrEqual(w.startSec);
  // a medição roda DE VERDADE no mock (feature-2 §4.6): tem que bater com a fixture
  expect(t.measurements).toMatchObject({ width: 720, height: 1280, hasAudio: true });
  expect(Math.abs(t.measurements.durationSec - 20)).toBeLessThan(0.2);
  const corteLayout = t.measurements.cuts.find((c: any) => c.kind === 'layout');
  expect(corteLayout, 'a fixture tem corte de layout em 8 s').toBeTruthy();
  expect(Math.abs(corteLayout.atSec - 8)).toBeLessThanOrEqual(0.1);
  expect(t.measurements.silences.length).toBeGreaterThan(0); // a fala do `say` tem 3 pausas de 0,5 s
  expect(t.editedSections).toEqual([]);
  const av = Object.fromEntries(fim.availableKinds.map((k: any) => [k.kind, k]));
  expect(av.SWAP_AVATAR).toEqual({ kind: 'SWAP_AVATAR', available: true, reason: null });
  expect(av.NEW_HOOKS).toEqual({ kind: 'NEW_HOOKS', available: true, reason: null });
  expect(av.COPY_NEW).toMatchObject({ available: false, reason: 'NOT_ENABLED' });
  expect(av.REMIX_EDIT).toMatchObject({ available: false, reason: 'NOT_ENABLED' });
  expect(fim.video).toMatchObject({ mimeType: 'video/mp4' });
  expect(typeof fim.costUsd).toBe('number');
  // TRANSCRIBE do campeão é provider_task com champion_id (eventos.md)
  expect(await q(`select id from provider_tasks where champion_id = $1`, [d.id])).toHaveLength(1);
});

test('C-CH-03 POST /champions inválido → 400 (sem upload nem link, rights fora do enum ou faltando, campo a mais, link que não é de um anúncio)', async () => {
  const offer = await criarOferta('A');
  for (const body of [
    { offerId: offer.id, rights: 'THIRD_PARTY' },
    { offerId: offer.id, rights: 'MINE', adLibraryUrl: AD('123') },
    { offerId: offer.id, adLibraryUrl: AD('123') },
    { offerId: offer.id, rights: 'OWN', adLibraryUrl: AD('123'), workspaceId: WS.B },
  ]) {
    expectErro(await as('membroA').post('/champions', body), 400, 'VALIDATION_ERROR');
  }
  for (const url of ['https://www.facebook.com/ads/library/?q=subscriptions', 'https://www.facebook.com/ads/library/?id=abc', 'https://example.com/?id=123']) {
    const det = expectErro(await importar('membroA', { offerId: offer.id, adLibraryUrl: url }), 400, 'VALIDATION_ERROR');
    expect(det.fields).toContainEqual({ field: 'adLibraryUrl', rule: 'ad_library_single_ad' });
  }
  // outros parâmetros junto do id são aceitos
  expectOk(await importar('membroA', { offerId: offer.id, adLibraryUrl: 'https://www.facebook.com/ads/library/?active_status=all&id=987654321&media_type=all' }), 202);
});

test('C-CH-04 404 pra oferta/upload que não existe; 409 UPLOAD_INCOMPLETE pra upload ainda PENDING', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA');
  expectErro(await importar('membroA', { offerId: 'qa_nao_existe', uploadId }), 404, 'NOT_FOUND');
  expectErro(await importar('membroA', { offerId: offer.id, uploadId: 'qa_nao_existe' }), 404, 'NOT_FOUND');
  const pend = await subir('membroA', 'fala-split-20s.mp4', { semComplete: true });
  expectErro(await importar('membroA', { offerId: offer.id, uploadId: pend.uploadId }), 409, 'UPLOAD_INCOMPLETE');
});

test('C-CH-05 [mock-ad-unavailable] só link → 503 AD_LIBRARY_UNAVAILABLE { quota, 2026-10-19 } síncrono e nada é criado', async () => {
  const offer = await criarOferta('A');
  const det = expectErro(await importar('membroA', { offerId: offer.id, adLibraryUrl: `${AD('111')}&x=mock-ad-unavailable` }), 503, 'AD_LIBRARY_UNAVAILABLE');
  expect(det).toEqual({ reason: 'quota', retryAfter: '2026-10-19' });
  expect(await q('select id from champions')).toHaveLength(0);
  expect(await q(`select id from jobs where type in ('CHAMPION_RESOLVE','CHAMPION_ANALYZE')`)).toHaveLength(0);
});

test('C-CH-06 [mock-ad-unavailable] com upload junto → não é 503: o link só busca metadado e não bloqueia a análise', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA');
  const d = expectOk(await importar('membroA', { offerId: offer.id, uploadId, adLibraryUrl: `${AD('111')}&x=mock-ad-unavailable` }), 202);
  expect(d.status).toBe('ANALYZING');
  expect((await ateTerminar('membroA', d.id)).status).toBe('READY');
});

for (const [gatilho, code] of [['mock-ad-notfound', 'AD_NOT_FOUND'], ['mock-ad-novideo', 'AD_HAS_NO_VIDEO']] as const) {
  test(`C-CH-07 [${gatilho}] só link → 202 RESOLVING → FAILED ${code} com action upload_video; PUT video destrava até READY`, async () => {
    const offer = await criarOferta('A');
    const d = expectOk(await importar('membroA', { offerId: offer.id, adLibraryUrl: `${AD('222')}&x=${gatilho}` }), 202);
    expect(d).toMatchObject({ status: 'RESOLVING', sources: ['AD_LIBRARY'], job: { type: 'CHAMPION_RESOLVE' } });
    const f = await ateTerminar('membroA', d.id);
    expect(f).toMatchObject({ status: 'FAILED', errorCode: code, action: 'upload_video' });
    expect(typeof f.failReason).toBe('string');
    const uploadId = await uploadPronto('membroA');
    const r = expectOk(await as('membroA').put(`/champions/${d.id}/video`, { uploadId }), 202);
    expect(r.status).toBe('ANALYZING');
    const ok = await ateTerminar('membroA', d.id);
    expect(ok.status).toBe('READY');
    expect(ok.sources.sort()).toEqual(['AD_LIBRARY', 'UPLOAD']);
  });
}

test('C-CH-08 link qualquer (mock) → RESOLVING (fetching_ad, downloading_video) → ANALYZING → READY com adMeta resolved', async () => {
  const offer = await criarOferta('A');
  const d = expectOk(await importar('membroA', { offerId: offer.id, adLibraryUrl: AD('1234567890') }), 202);
  expect(d.status).toBe('RESOLVING');
  expect(d.job.checklist.map((c: any) => c.key)).toEqual(['fetching_ad', 'downloading_video']);
  const fim = await ateTerminar('membroA', d.id);
  expect(fim.status).toBe('READY');
  expect(fim.adLibraryUrl).toBe(AD('1234567890'));
  expect(fim.adMeta).toMatchObject({ status: 'resolved', adArchiveId: '1234567890' });
  expect(Math.abs(fim.durationSec - 20)).toBeLessThan(0.5); // vídeo sintético de 20 s com fala
  expect(fim.availableKinds.find((k: any) => k.kind === 'SWAP_AVATAR').available).toBe(true);
});

test('C-CH-09 [mock:analysis-fail] → FAILED PROVIDER_ERROR (analyze_again); tirar o gatilho e reanalisar → READY sem retranscrever', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA');
  const d = expectOk(await importar('membroA', { offerId: offer.id, uploadId, notes: 'teste [mock:analysis-fail]' }), 202);
  const f = await ateTerminar('membroA', d.id);
  expect(f).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', action: 'analyze_again' });
  expect(f.job.checklist.find((c: any) => c.key === 'diagnosing').done).toBe(false);
  expect(f.job.checklist.find((c: any) => c.key === 'transcribing').done).toBe(true);
  const transcricoes = (await q('select id from provider_tasks where champion_id = $1', [d.id])).length;
  expectOk(await as('membroA').patch(`/champions/${d.id}`, { notes: 'sem gatilho' }));
  const a = expectOk(await as('membroA').post(`/champions/${d.id}/analyze`, {}), 202);
  expect(a.job).toMatchObject({ type: 'CHAMPION_ANALYZE' });
  expect((await ateTerminar('membroA', d.id)).status).toBe('READY');
  // "o que já ficou pronto (transcrição, medições) é reaproveitado"
  expect((await q('select id from provider_tasks where champion_id = $1', [d.id])).length).toBe(transcricoes);
});

test('C-CH-10 vídeo truncado: complete passa, o job decodifica inteiro e o campeão fica FAILED MEDIA_INVALID (undecodable)', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA', 'truncado-20s.mp4');
  const d = expectOk(await importar('membroA', { offerId: offer.id, uploadId }), 202);
  const f = await ateTerminar('membroA', d.id);
  expect(f).toMatchObject({ status: 'FAILED', errorCode: 'MEDIA_INVALID' });
  expect(f.action).toBe('upload_video'); // Esclarecimento 06/10 nº 2
  expect(f.job.checklist.find((c: any) => c.key === 'reading_video').done).toBe(false);
  expect(await q('select id from provider_tasks where champion_id = $1', [d.id])).toHaveLength(0); // não pagou transcrição de arquivo podre
});

test('C-CH-11 sem áudio: aviso não bloqueia, análise READY e hasSpeech falso → SWAP_AVATAR/NEW_HOOKS indisponíveis (NO_SPEECH)', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA', 'sem-audio-10s.mp4');
  const d = expectOk(await importar('membroA', { offerId: offer.id, uploadId }), 202);
  const f = await ateTerminar('membroA', d.id);
  expect(f.status).toBe('READY');
  expect(f.teardown.measurements.hasAudio).toBe(false);
  const av = Object.fromEntries(f.availableKinds.map((k: any) => [k.kind, k]));
  expect(av.SWAP_AVATAR).toMatchObject({ available: false, reason: 'NO_SPEECH' });
  expect(av.NEW_HOOKS).toMatchObject({ available: false, reason: 'NO_SPEECH' });
  const det = expectErro(await as('membroA').post(`/champions/${d.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] }), 422, 'NO_SPEECH');
  expect(det).toEqual({ kind: 'SWAP_AVATAR' });
});

test('C-CH-12 GET /champions: lista paginada, filtro offerId, ChampionRow, arquivado some da lista', async () => {
  const o1 = await criarOferta('A', { name: 'O1' });
  const o2 = await criarOferta('A', { name: 'O2' });
  const c1 = await criarCampeao('A', 'READY', { offer: o1 });
  const c2 = await criarCampeao('A', 'FAILED', { offer: o2 });
  await criarCampeao('A', 'ANALYZING', { offer: o2 });
  const todos = expectPagina(await as('membroA').get('/champions'));
  expect(todos).toHaveLength(3);
  for (const r of todos) {
    expect(r).toMatchObject({ id: expect.any(String), name: expect.any(String), offer: { id: expect.any(String), name: expect.any(String) },
      status: expect.any(String), rights: expect.any(String), sources: expect.any(Array), batchesCount: 0, variationsCount: 0, winnersCount: 0,
      createdBy: { id: expect.any(String), name: expect.any(String), initials: expect.any(String) }, updatedAt: expect.any(String) });
  }
  expect(expectPagina(await as('membroA').get(`/champions?offerId=${o2.id}`)).map((r) => r.id)).not.toContain(c1.id);
  const p1 = await as('membroA').get('/champions?limit=2');
  expect(expectPagina(p1)).toHaveLength(2);
  expect(p1.body.meta.nextCursor).toBeTruthy();
  const p2 = expectPagina(await as('membroA').get(`/champions?limit=2&cursor=${encodeURIComponent(p1.body.meta.nextCursor)}`));
  expect(p2).toHaveLength(1);
  expectErro(await as('membroA').get('/champions?limit=0'), 400, 'VALIDATION_ERROR');
  expect(expectOk(await as('membroA').del(`/champions/${c2.id}`))).toEqual({ ok: true });
  expect(expectPagina(await as('membroA').get('/champions')).map((r) => r.id)).not.toContain(c2.id);
  // Esclarecimento 06/10 nº 4: arquivado = 404 em toda rota dele
  expectErro(await as('membroA').get(`/champions/${c2.id}`), 404, 'NOT_FOUND');
  expectErro(await as('membroA').patch(`/champions/${c2.id}`, { name: 'x' }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post(`/champions/${c2.id}/analyze`, {}), 404, 'NOT_FOUND');
  const [arq] = await q('select archived_at from champions where id = $1', [c2.id]);
  expect(arq.archived_at).not.toBeNull();
});

test('C-CH-13 PATCH /champions/:id: nome, notas e rights; OWN grava quem declarou e quando', async () => {
  const c = await criarCampeao('A', 'READY');
  const d = expectOk(await as('membroA').patch(`/champions/${c.id}`, { name: 'Renomeado', rights: 'OWN', notes: 'nota' }));
  expect(d).toMatchObject({ id: c.id, name: 'Renomeado', rights: 'OWN' });
  const [r] = await q('select rights, rights_declared_by_id, rights_declared_at, notes from champions where id = $1', [c.id]);
  expect(r).toMatchObject({ rights: 'OWN', rights_declared_by_id: 'qa_user_membro_a', notes: 'nota' });
  expect(r.rights_declared_at).not.toBeNull();
  expectErro(await as('membroA').patch(`/champions/${c.id}`, { rights: 'MINE' }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(`/champions/${c.id}`, { status: 'READY' }), 400, 'VALIDATION_ERROR');
});

test('C-CH-14 PATCH teardown: seção editada entra em editedSections; correção de palavra muda o texto e não o tempo', async () => {
  const c = await criarCampeao('A', 'READY');
  const antes = expectOk(await as('membroA').get(`/champions/${c.id}`)).teardown;
  const hook = { status: 'ok', naReason: null, data: { endSec: 3, visual: 'editado', onScreenText: 'Stop', spoken: 'Stop scrolling.' } };
  const t = expectOk(await as('membroA').patch(`/champions/${c.id}/teardown`, { sections: { hook }, transcriptWords: [{ index: 0, word: 'Halt' }] }));
  expect(t.editedSections).toEqual(['hook']);
  expect(t.sections.hook.data.visual).toBe('editado');
  expect(t.transcript.words[0]).toMatchObject({ word: 'Halt', startSec: antes.transcript.words[0].startSec, endSec: antes.transcript.words[0].endSec });
  expect(t.sections.structure).toEqual(antes.sections.structure); // parcial: o resto fica
  expectErro(await as('membroA').patch(`/champions/${c.id}/teardown`, { sections: { inventada: hook } }), 400, 'VALIDATION_ERROR');
  expectErro(await as('membroA').patch(`/champions/${c.id}/teardown`, { transcriptWords: [{ index: 9999, word: 'x' }] }), 400, 'VALIDATION_ERROR');
});

test('C-CH-15 analyze com seção editada sem confirm → 409 CONFIRM_DOWNSTREAM_RESET { editedSections }; com confirm → 202', async () => {
  const c = await criarCampeao('A', 'READY', { editedSections: ['hook', 'whySells'] });
  const det = expectErro(await as('membroA').post(`/champions/${c.id}/analyze`, {}), 409, 'CONFIRM_DOWNSTREAM_RESET');
  expect(det.editedSections.sort()).toEqual(['hook', 'whySells']);
  expect((await q('select status from champions where id = $1', [c.id]))[0].status).toBe('READY');
  expect(expectOk(await as('membroA').post(`/champions/${c.id}/analyze`, { confirm: true }), 202).job.type).toBe('CHAMPION_ANALYZE');
});

test('C-CH-16 GET /champions/:id/batches: resumo, mais recente primeiro; 404 pra campeão inexistente', async () => {
  const c = await criarCampeao('A', 'READY');
  const b1 = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] }), 202);
  const b2 = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'NEW_HOOKS', count: 2 }] }), 202);
  const lista = expectOk(await as('membroA').get(`/champions/${c.id}/batches`));
  expect(lista.map((b: any) => b.id)).toEqual([b2.id, b1.id]);
  expectErro(await as('membroA').get('/champions/qa_nao_existe/batches'), 404, 'NOT_FOUND');
  expectErro(await as('membroA').get('/champions/qa_nao_existe'), 404, 'NOT_FOUND');
});

test('C-CH-17 custo do campeão: análise grava cost_entries com champion_id e o costUsd do detalhe é a soma (mock = 0)', async () => {
  const offer = await criarOferta('A');
  const uploadId = await uploadPronto('membroA');
  const d = expectOk(await importar('membroA', { offerId: offer.id, uploadId }), 202);
  const f = await ateTerminar('membroA', d.id);
  const custos = await q<{ amount_usd: string }>('select amount_usd from cost_entries where champion_id = $1', [d.id]);
  expect(custos.length, 'Whisper + Claude: ao menos 2 lançamentos').toBeGreaterThanOrEqual(2);
  expect(f.costUsd).toBeCloseTo(custos.reduce((s, c) => s + Number(c.amount_usd), 0), 4);
});
