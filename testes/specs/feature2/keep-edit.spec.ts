// Feature 2 §13 · manter a edição do campeão + take único de lipsync (Q7 → portão F2-G2b, 09/10).
// Fonte: docs/contratos/feature-2-variar-campeao.md §13 (+ api.md "Mudanças 06/10 noite"). D6 (Gusta, 06/10): Novos ganchos = (a) gancho escrito, definitivo.
// Depende de: B5 (mapping_edit, keepEdit, take, launch por modo), V4a (medição: células, YuNet, faceTrack, fitCrop), V4b (remix-keep + remux),
// I5 (describeEdit mock, sliceTake, estimate por take, lipsync mock com rosto em loop).
// PENDENTE até a entrega: só roda com E2E_F2_KEEP=1 (npm run keep -w testes). Fixtures: npm run fixtures:paineis -w testes.
// Nada pago: API de teste própria (3101) em INTEGRACOES_MODE=mock; o harness bloqueia 3000/3001 (a 3001 é a API LIVE do Gusta).
import { readFileSync } from 'node:fs';
import { test, expect } from '../../harness/fixtures.ts';
import { aguardar, as, expectErro, expectOk } from '../../harness/api.ts';
import { q, WS } from '../../harness/db.ts';
import { criarCriativoNoEstado } from '../../harness/fabrica.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import {
  ateEstado, baixar, campeaoComMapa, campeaoPaineis, contar, custoDoCriativo, editMapRef, fixturePath, gravarJson,
  lerCampeao, paineis, qaVideo, takesDoCriativo, tarefasDoCriativo,
} from '../../harness/keep-edit.ts';

test.skip(process.env.E2E_F2_KEEP !== '1', 'pendente até B5/V4/I5 (§13): rode com E2E_F2_KEEP=1');
test.describe.configure({ timeout: 300_000 });
test.afterEach(async () => { await esperarJobsQuietos(900_000); });

const PX = 2; // tolerância das caixas medidas (§13.8 V4a: ±2 px)
const perto = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
function regiaoBate(r: any, e: any) {
  expect(perto(r.x, e.x, PX) && perto(r.y, e.y, PX) && perto(r.w, e.w, PX) && perto(r.h, e.h, PX), `região ${JSON.stringify(r)} vs ${JSON.stringify(e)}`).toBe(true);
}
const lerLote = (id: string) => as('membroA').get(`/variation-batches/${id}`).then((r) => expectOk(r));
const atePlanoPronto = (id: string) => aguardar(() => lerLote(id), (b) => b.status !== 'PLANNING', { timeoutMs: 60_000, intervalMs: 750, oQue: `lote ${id} sair de PLANNING` });

/** Lote do campeão até o launch (elenco pela API em mock: rostos sintéticos de verdade no storage de teste). */
async function lancar(championId: string, requests: any[], settings: any = {}) {
  const b = expectOk(await as('membroA').post(`/champions/${championId}/batches`, { requests, settings }), 202);
  const pronto = await atePlanoPronto(b.id);
  expect(pronto.status, JSON.stringify(pronto.items?.map((i: any) => [i.status, i.errorCode]))).toBe('PLAN_READY');
  for (const c of pronto.castings) {
    expectOk(await as('membroA').post(`/variation-batches/${b.id}/castings/${c.id}/faces/generate`, { description: c.description }), 202);
    const fim = (f: any) => ['READY', 'FAILED'].includes(f.status);
    const pronta = await aguardar(() => lerLote(b.id), (x) => { const fs = x.castings.find((y: any) => y.id === c.id).batches?.[0]?.faces ?? []; return fs.length > 0 && fs.every(fim); },
      { timeoutMs: 90_000, intervalMs: 750, oQue: 'rostos do elenco' });
    const fs = pronta.castings.find((y: any) => y.id === c.id).batches[0].faces;
    const face = fs.find((f: any) => f.status === 'READY');
    expect(face, `nenhum rosto do elenco READY: ${JSON.stringify(fs.map((f: any) => [f.status, f.errorCode, f.failReason]))} · descrição: ${c.description}`).toBeTruthy();
    expectOk(await as('membroA').post(`/variation-batches/${b.id}/castings/${c.id}/faces/${face.id}/select`, {}));
  }
  const e = expectOk(await as('membroA').get(`/variation-batches/${b.id}/estimate`));
  const r = expectOk(await as('membroA').post(`/variation-batches/${b.id}/launch`, { expectedCostUsd: e.costUsd }), 202);
  return { batch: pronto, estimate: e, launch: r };
}

/** Criativo do zero com motor LIPSYNC gerado pela API (rostos mock reais). `fala` sobrescreve as falas do roteiro A. */
async function criativoLipsync(opts: { falas?: string[] } = {}) {
  const c = await criarCriativoNoEstado('A', 'AVATAR_PENDING');
  if (opts.falas) {
    const [s] = await q('select blocks from scripts where id = $1', [c.selectedScriptId]);
    const blocks = s.blocks.map((b: any, i: number) => ({ ...b, speech: opts.falas![i] ?? b.speech }));
    await q('update scripts set blocks = $2::jsonb where id = $1', [c.selectedScriptId, JSON.stringify(blocks)]);
  }
  expectOk(await as('membroA').post(`/creatives/${c.id}/faces/generate`, { description: 'woman in her 30s, kitchen, natural light' }), 202);
  const faces = await aguardar(() => as('membroA').get(`/creatives/${c.id}/faces`).then((r) => expectOk(r)),
    (f) => f.batches[0]?.faces.every((x: any) => x.status === 'READY'), { timeoutMs: 60_000, oQue: 'rostos mock' });
  expectOk(await as('membroA').post(`/creatives/${c.id}/faces/${faces.batches[0].faces[0].id}/select`, {}));
  const voz = expectOk(await as('membroA').get('/voices?language=en')).find((v: any) => v.gender === 'female') ?? expectOk(await as('membroA').get('/voices?language=en'))[0];
  const gen = { engine: 'LIPSYNC', engineModel: 'pruna-lipsync', voiceId: voz.id, format: 'VERTICAL_9_16' };
  return { c, gen, voz };
}

// ═════════════════ trilha do rosto + mapa da edição (§13.1-13.2) ═════════════════

test('KE-TRILHA-01 paineis-caixa: análise ganha mapping_edit; trilha = 1 trecho na caixa x0 y119 336x324 (±2 px), frames [0, 450); headline solid; keepEdit disponível nos 2 tipos', async () => {
  const P = paineis();
  const c = await campeaoPaineis('membroA', 'A', 'paineis-caixa-15s.mp4');
  const d = await lerCampeao(c.id);
  expect(d.job.checklist.map((k: any) => k.key)).toEqual(['reading_video', 'extracting_audio', 'transcribing', 'measuring', 'mapping_edit', 'diagnosing']);
  const m = d.teardown.editMap;
  console.log('[qa] KE-TRILHA-01 editMap', JSON.stringify({ faceTrack: m?.faceTrack, layers: m?.layers?.map((l: any) => ({ kind: l.kind, box: l.box, bg: l.background, f: [l.startFrame, l.endFrame], src: l.source })), keepEdit: d.keepEdit }));
  expect(m, 'editMap nulo num campeão analisado depois do §13').not.toBeNull();
  // grade do campeão = a do VÍDEO (450 frames), não a do áudio (15 s + 4 frames)
  expect(m).toMatchObject({ version: 1, width: 720, height: 960, fps: 30, frameCount: P.grade.frames });
  expect(m.faceTrack).toHaveLength(1);
  const [t] = m.faceTrack;
  expect(t.fullFrame).toBe(false);
  expect(t.startFrame).toBeLessThanOrEqual(1);
  expect(t.endFrame).toBeGreaterThanOrEqual(449);
  regiaoBate(t.region, P.caixas.rosto);
  expect(t.facesMax).toBe(1);
  expect(t.minScore).toBeGreaterThanOrEqual(0.8);
  // células: a caixa do rosto é uma célula medida (colunas + faixas)
  expect(m.cells.some((s: any) => s.cells.some((r: any) => perto(r.x, 0, PX) && perto(r.y, 119, PX) && perto(r.w, 336, PX) && perto(r.h, 324, PX)))).toBe(true);
  // mock do describeEdit (I5): 1 headline solid + 1 karaokê. A caixa da headline, refinada por pixel, é a faixa vermelha medida
  const h = m.layers.find((l: any) => l.kind === 'headline');
  expect(h?.background.kind).toBe('solid');
  if (h.source === 'vision+pixel') regiaoBate(h.background.box, P.caixas.topo);
  expect(m.layers.filter((l: any) => l.kind === 'caption')).toHaveLength(1);
  // perfil genérico: nunca nome/@
  expect(Object.keys(m.profile ?? {})).toEqual(expect.arrayContaining(['gender', 'ageBand', 'ethnicity', 'hair', 'clothing', 'setting', 'lighting', 'framing', 'pose']));
  expect(JSON.stringify(m.profile)).not.toMatch(/@|name/i);
  expect(d.keepEdit).toEqual({ SWAP_AVATAR: { available: true, blockers: [] }, NEW_HOOKS: { available: true, blockers: [] } });
  expect(m.keepEdit).toEqual(d.keepEdit);
});

test('KE-TRILHA-02 paineis-cheia-caixa: 2 trechos — tela cheia [0,150) fullFrame e caixa [150,450); borda no frame 150 ±1 (emenda por frame, nunca por segundo)', async () => {
  const P = paineis();
  const c = await campeaoPaineis('membroA', 'A', 'paineis-cheia-caixa-15s.mp4');
  const m = (await lerCampeao(c.id)).teardown.editMap;
  expect(m.faceTrack, JSON.stringify(m.faceTrack)).toHaveLength(2);
  const [a, b] = m.faceTrack;
  expect(a.fullFrame).toBe(true);
  regiaoBate(a.region, { x: 0, y: 0, w: 720, h: 960 });
  expect(Math.abs(a.endFrame - 150)).toBeLessThanOrEqual(1);
  expect(b.startFrame).toBe(a.endFrame); // contínuo, sem buraco nem sobreposição
  expect(b.fullFrame).toBe(false);
  regiaoBate(b.region, P.caixas.rosto);
  // escala do rosto: a caixa relativa à região muda entre os trechos (rosto cheio x caixa pequena)
  expect(a.faceInRegion.length).toBeGreaterThanOrEqual(1);
  expect((await lerCampeao(c.id)).keepEdit.SWAP_AVATAR).toEqual({ available: true, blockers: [] });
});

// ═════════════════ bloqueios explícitos (§13.3.6, §13.4) ═════════════════

test('KE-BLQ-01 dois rostos na caixa → SWAP_AVATAR indisponível com multiple_faces (trecho em s); keepEdit:true = 422 KEEP_EDIT_UNSUPPORTED; keepEdit:false (talking head limpo) passa', async () => {
  const c = await campeaoPaineis('membroA', 'A', 'paineis-2-rostos-15s.mp4');
  const d = await lerCampeao(c.id);
  expect(d.keepEdit.SWAP_AVATAR.available).toBe(false);
  const hit = d.keepEdit.SWAP_AVATAR.blockers.find((b: any) => b.reason === 'multiple_faces');
  expect(hit, JSON.stringify(d.keepEdit)).toBeTruthy();
  expect(hit.startSec).toBeLessThanOrEqual(1);
  expect(hit.endSec).toBeGreaterThanOrEqual(14);
  const det = expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { keepEdit: true } }), 422, 'KEEP_EDIT_UNSUPPORTED');
  expect(det).toMatchObject({ kind: 'SWAP_AVATAR', blockers: expect.arrayContaining([expect.objectContaining({ reason: 'multiple_faces' })]) });
  expect(await q('select id from variation_batches where champion_id = $1', [c.id])).toHaveLength(0); // nada criado
  // escolha explícita do caminho limpo
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { keepEdit: false } }), 202);
  expect(b.settings.keepEdit).toBe(false);
});

test('KE-BLQ-02 sem rosto (fala-split-20s, gradiente) → no_face nos 2 tipos que dependem de rosto; padrão do lote cai pra keepEdit:false com o motivo', async () => {
  const c = await campeaoPaineis('membroA', 'A', 'fala-split-20s.mp4');
  const d = await lerCampeao(c.id);
  expect(d.keepEdit.SWAP_AVATAR).toMatchObject({ available: false, blockers: [expect.objectContaining({ reason: 'no_face' })] });
  // sem keepEdit explícito: padrão = true só quando disponível (§13.7) → aqui false, sem 422
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }] }), 202);
  expect(b.settings.keepEdit).toBe(false);
});

test('KE-BLQ-03 rosto borrado (YuNet ~0,6) → low_confidence, não no_face (a fixture tem rosto, só abaixo de 0,8)', async () => {
  const c = await campeaoPaineis('membroA', 'A', 'paineis-rosto-borrado-15s.mp4');
  const d = await lerCampeao(c.id);
  expect(d.keepEdit.SWAP_AVATAR.available).toBe(false);
  expect(d.keepEdit.SWAP_AVATAR.blockers.map((b: any) => b.reason)).toContain('low_confidence');
});

test('KE-BLQ-04 campeão analisado antes do §13 (editMap null) → not_mapped nos 2 tipos com startSec/endSec null; keepEdit:true = 422', async () => {
  const c = await campeaoComMapa('A', null);
  const d = await lerCampeao(c.id);
  expect(d.teardown.editMap).toBeNull();
  for (const k of ['SWAP_AVATAR', 'NEW_HOOKS']) expect(d.keepEdit[k]).toEqual({ available: false, blockers: [{ reason: 'not_mapped', startSec: null, endSec: null }] });
  expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'NEW_HOOKS', count: 2 }], settings: { keepEdit: true, hookMode: 'TEXT' } }), 422, 'KEEP_EDIT_UNSUPPORTED');
});

for (const [motivo, kind] of [['caption_straddles_face', 'SWAP_AVATAR'], ['overlay_over_face', 'SWAP_AVATAR'], ['hook_text_over_video', 'NEW_HOOKS']] as const) {
  test(`KE-BLQ-05 ${motivo} gravado no mapa → ${kind} 422 KEEP_EDIT_UNSUPPORTED com o motivo; o outro tipo segue livre`, async () => {
    const c = await campeaoComMapa('A', editMapRef({ [kind]: [motivo] }));
    const d = await lerCampeao(c.id);
    expect(d.keepEdit[kind]).toEqual({ available: false, blockers: [{ reason: motivo, startSec: 0, endSec: 15 }] });
    const req = kind === 'SWAP_AVATAR' ? [{ kind, count: 1 }] : [{ kind, count: 2 }];
    const det = expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: req, settings: { keepEdit: true, hookMode: 'TEXT' } }), 422, 'KEEP_EDIT_UNSUPPORTED');
    expect(det).toEqual({ kind, blockers: [{ reason: motivo, startSec: 0, endSec: 15 }] });
    const outro = kind === 'SWAP_AVATAR' ? [{ kind: 'NEW_HOOKS', count: 2 }] : [{ kind: 'SWAP_AVATAR', count: 1 }];
    expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: outro, settings: { keepEdit: true, hookMode: 'TEXT' } }), 202);
  });
}

// Detecção ponta a ponta pelos gatilhos oficiais (api.md §17, notes do campeão): visão (ia) e medição/backend.
for (const [gatilho, kind, motivo] of [
  ['[mock:keep-straddle]', 'SWAP_AVATAR', 'caption_straddles_face'], ['[mock:keep-overlay]', 'SWAP_AVATAR', 'overlay_over_face'],
  ['[mock:hook-over-video]', 'NEW_HOOKS', 'hook_text_over_video'], ['[mock:keep-two-faces]', 'SWAP_AVATAR', 'multiple_faces'],
  ['[mock:not-mapped]', 'SWAP_AVATAR', 'not_mapped'],
] as const) {
  test(`KE-BLQ-06 ${gatilho} na análise → ${kind} indisponível com ${motivo}; keepEdit:true = 422 com o mesmo motivo`, async () => {
    const c = await campeaoPaineis('membroA', 'A', 'paineis-caixa-15s.mp4', `QA ${gatilho}`);
    const d = await lerCampeao(c.id);
    expect(d.keepEdit[kind].available, JSON.stringify(d.keepEdit)).toBe(false);
    expect(d.keepEdit[kind].blockers.map((b: any) => b.reason)).toContain(motivo);
    const req = kind === 'SWAP_AVATAR' ? [{ kind, count: 1 }] : [{ kind, count: 2 }];
    const det = expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: req, settings: { keepEdit: true, hookMode: 'TEXT' } }), 422, 'KEEP_EDIT_UNSUPPORTED');
    expect(det.blockers.map((b: any) => b.reason)).toContain(motivo);
  });
}

test('KE-SET-01 settings: keepEdit padrão true quando disponível; SWAP keepEdit força voiceSource CHAMPION_AUDIO e o formato do campeão; hookMode ≠ TEXT = 400; PATCH settings com bloqueio = 422', async () => {
  const c = await campeaoComMapa('A', editMapRef({ NEW_HOOKS: ['hook_text_over_video'] }));
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { voiceSource: 'CATALOG', voiceId: 'Wise_Woman' } }), 202);
  expect(b.settings).toMatchObject({ keepEdit: true, voiceSource: 'CHAMPION_AUDIO' });
  for (const hookMode of ['VOICE_CLONE', 'NEW_AVATAR', 'X']) {
    expectErro(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'SWAP_AVATAR', count: 1 }], settings: { hookMode } }), 400, 'VALIDATION_ERROR');
  }
  await atePlanoPronto(b.id);
  // trocar a voz pro catálogo com keepEdit: o contrato diz "força" CHAMPION_AUDIO (200 ignorando ou 400; nunca grava CATALOG)
  const pv = await as('membroA').patch(`/variation-batches/${b.id}/settings`, { voiceSource: 'CATALOG' });
  expect([200, 400]).toContain(pv.status);
  const s = await lerLote(b.id);
  expect(s.settings.voiceSource).toBe('CHAMPION_AUDIO');
});

// ═════════════════ Trocar avatar mantendo a edição: take único (§13.3, §13.5) ═════════════════

test('TK-01 SWAP keepEdit: 1 Take AUDIO_LIPSYNC por criativo = 1 chamada LIPSYNC, 0 TTS, 0 TRANSCRIBE; janela = 1ª à última frame com rosto; seed 7; fatias TAKE_SLICE contíguas', async () => {
  const c = await campeaoPaineis('membroA', 'A');
  const { launch, estimate } = await lancar(c.id, [{ kind: 'SWAP_AVATAR', count: 2 }], { keepEdit: true });
  // estimativa: 1 take por item (LIPSYNC uma vez, ceil(s) × 0,025) + elenco; nada de TTS/TRANSCRIBE
  for (const it of estimate.items ?? []) for (const l of it.lines ?? []) expect(['TTS', 'TRANSCRIBE']).not.toContain(l.kind);
  expect(launch.creatives).toHaveLength(2); // SWAP não tem controle
  for (const cr of launch.creatives) {
    await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
    const tk = await takesDoCriativo(cr.id);
    expect(tk, JSON.stringify(tk)).toHaveLength(1);
    expect(tk[0]).toMatchObject({ kind: 'AUDIO_LIPSYNC', status: 'READY', attempt: 1, seed: 7 });
    // rosto o vídeo todo → janela [0, ~15 s] (fim do vídeo, não do áudio)
    expect(Number(tk[0].source_start_sec)).toBeLessThanOrEqual(0.05);
    expect(Number(tk[0].source_end_sec)).toBeGreaterThanOrEqual(14.9);
    const tarefas = await tarefasDoCriativo(cr.id);
    expect({ LIPSYNC: contar(tarefas, 'LIPSYNC'), TTS: contar(tarefas, 'TTS'), TRANSCRIBE: contar(tarefas, 'TRANSCRIBE') }).toEqual({ LIPSYNC: 1, TTS: 0, TRANSCRIBE: 0 });
    const lip = tarefas.find((t) => t.kind === 'LIPSYNC')!;
    expect(lip.take_id).toBe(tk[0].id);
    expect(lip.scene_id).toBeNull();
    expect(JSON.stringify(lip.input)).toMatch(/"seed":\s*7/);
    const cenas = await q('select index, pipeline, take_id, take_start_sec, take_end_sec, status from scenes where creative_id = $1 and not stale order by index', [cr.id]);
    expect(cenas.length).toBeGreaterThanOrEqual(1);
    for (const s of cenas) expect(s).toMatchObject({ pipeline: 'TAKE_SLICE', take_id: tk[0].id, status: 'READY' });
    for (let i = 1; i < cenas.length; i++) expect(Number(cenas[i].take_start_sec)).toBeCloseTo(Number(cenas[i - 1].take_end_sec), 3);
    expect(Number(cenas[0].take_start_sec)).toBe(0);
    // API: CreativeDetail.take e Scene.take
    const det = expectOk(await as('membroA').get(`/creatives/${cr.id}`));
    expect(det.take).toMatchObject({ id: tk[0].id, kind: 'AUDIO_LIPSYNC', status: 'READY', regenerateEstimateUsd: expect.any(Number) });
    const sc = expectOk(await as('membroA').get(`/creatives/${cr.id}/scenes`));
    for (const s of sc.scenes) expect(s.take).toMatchObject({ id: tk[0].id });
    // por último: o render da peça (a peça em si é o PC-01)
    expect(await q('select state from creatives where id = $1', [cr.id])).toEqual([{ state: 'RENDER_READY' }]);
  }
});

test('PC-01 peça SWAP keepEdit (render remix-keep, mock): nº de frames = campeão (450, não o do áudio), md5 do áudio decodificado = campeão, fora da região PSNR ≥ 40 dB, dentro da região diferente em todo frame da trilha, 1 rosto por frame', async () => {
  const P = paineis();
  const ref = P.fixtures.find((f) => f.file === 'paineis-caixa-15s.mp4')!;
  const c = await campeaoPaineis('membroA', 'A');
  const { launch } = await lancar(c.id, [{ kind: 'SWAP_AVATAR', count: 1 }], { keepEdit: true });
  const cr = launch.creatives[0];
  await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
  const ed = expectOk(await as('membroA').get(`/creatives/${cr.id}/edit`));
  expect(ed.settings.templateId ?? ed.templateId).toBe('remix-keep');
  const video = ed.previewRender?.video ?? ed.latestRender?.video;
  expect(video, JSON.stringify(ed.latestRender)).toBeTruthy();
  const peca = await baixar('membroA', video.url, `pc01-${cr.id}.mp4`);
  const mapa = (await lerCampeao(c.id)).teardown.editMap;
  const trilha = gravarJson(`pc01-trilha-${cr.id}.json`, mapa.faceTrack.map((t: any) => ({ startFrame: t.startFrame, endFrame: t.endFrame, region: t.region })));
  // camadas redesenhadas por cima do rosto ficam fora da comparação "fora da região" (nesta fixture nenhuma cai dentro)
  const r = qaVideo(['peca', '--campeao', fixturePath('paineis-caixa-15s.mp4'), '--peca', peca, '--trilha', trilha, '--folha', peca.replace('.mp4', '-folha.png')]);
  console.log('[qa] PC-01', JSON.stringify(r));
  expect(r.peca.frames, 'nº de frames da peça').toBe(ref.probe.frames);
  expect(r.grade).toBe(true);
  expect(r.audioMd5.peca, 'áudio do campeão copiado sem recodificar').toBe(ref.audioMd5);
  expect(r.foraFramesAbaixoDe40, `fora da região: PSNR mín ${r.foraPsnrMin} no frame ${r.foraPsnrMinFrame}`).toBe(0);
  expect(r.dentroFramesIguaisTotal, `original piscando nos frames ${r.dentroFramesIguaisAoCampeao}`).toBe(0);
  // 1 rosto por frame: no mock depende de o lipsync mock devolver o rosto do elenco em loop (I5) e o rosto mock ser detectável
  expect(r.framesSemUmRostoTotal, `frames sem exatamente 1 rosto: ${JSON.stringify(r.framesSemUmRosto)}`).toBe(0);
});

test('PC-02 peça SWAP keepEdit em paineis-cheia-caixa: a legenda que caía dentro da região (tela cheia) é redesenhada por cima do rosto novo; a borda do trecho troca no frame exato', async () => {
  const c = await campeaoPaineis('membroA', 'A', 'paineis-cheia-caixa-15s.mp4');
  const { launch } = await lancar(c.id, [{ kind: 'SWAP_AVATAR', count: 1 }], { keepEdit: true });
  const cr = launch.creatives[0];
  await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
  const ed = expectOk(await as('membroA').get(`/creatives/${cr.id}/edit`));
  const peca = await baixar('membroA', (ed.previewRender ?? ed.latestRender).video.url, `pc02-${cr.id}.mp4`);
  const mapa = (await lerCampeao(c.id)).teardown.editMap;
  const trilha = gravarJson(`pc02-trilha-${cr.id}.json`, mapa.faceTrack.map((t: any) => ({ startFrame: t.startFrame, endFrame: t.endFrame, region: t.region })));
  const r = qaVideo(['peca', '--campeao', fixturePath('paineis-cheia-caixa-15s.mp4'), '--peca', peca, '--trilha', trilha, '--folha', peca.replace('.mp4', '-folha.png')]);
  console.log('[qa] PC-02', JSON.stringify(r));
  expect(r.grade && r.audioIgual).toBe(true);
  expect(r.dentroFramesIguaisTotal, `original piscando nos frames ${r.dentroFramesIguaisAoCampeao}`).toBe(0);
  expect(r.foraFramesAbaixoDe40).toBe(0);
  // conferência visual da legenda redesenhada: a folha (-folha.png) é lida pelo QA no relatório
});

test('PC-03 aceite podcast (campeão real do Gusta): Trocar avatar disponível sem bloqueio; trilha só nos planos da apresentadora; convidada, inserts e b-roll idênticos (PSNR ≥ 40 fora da região), áudio md5 igual, mesmo nº de frames', async () => {
  const A = JSON.parse(readFileSync(fixturePath('aceite.json'), 'utf8')).fixtures[0];
  const c = await campeaoPaineis('membroA', 'A', 'podcast-aceite.mp4');
  const d = await lerCampeao(c.id);
  console.log('[qa] PC-03 mapa', JSON.stringify({ faceTrack: d.teardown.editMap?.faceTrack?.map((t: any) => [t.startFrame, t.endFrame, t.region, t.fullFrame]), keepEdit: d.keepEdit }));
  expect(d.keepEdit.SWAP_AVATAR, JSON.stringify(d.keepEdit)).toEqual({ available: true, blockers: [] });
  const m = d.teardown.editMap;
  expect(m.frameCount).toBe(A.probe.frames);
  // trilha ⊂ planos da apresentadora (±2 frames na borda) e cobre cada plano principal
  const principais = A.planos.filter((p: any) => p.tipo === 'principal');
  for (const t of m.faceTrack) {
    const dono = principais.find((p: any) => t.startFrame >= p.de - 2 && t.endFrame <= p.ate + 2);
    expect(dono, `trecho [${t.startFrame}, ${t.endFrame}) cai fora dos planos da apresentadora`).toBeTruthy();
  }
  for (const p of principais) {
    const cobertos = m.faceTrack.filter((t: any) => t.startFrame < p.ate && t.endFrame > p.de).reduce((n: number, t: any) => n + Math.min(t.endFrame, p.ate) - Math.max(t.startFrame, p.de), 0);
    expect(cobertos, `plano principal [${p.de}, ${p.ate}) coberto só ${cobertos} frames`).toBeGreaterThanOrEqual(p.ate - p.de - 4);
  }
  const { launch } = await lancar(c.id, [{ kind: 'SWAP_AVATAR', count: 1 }], { keepEdit: true });
  const cr = launch.creatives[0];
  await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
  const ed = expectOk(await as('membroA').get(`/creatives/${cr.id}/edit`));
  const video = (ed.previewRender ?? ed.latestRender)?.video;
  expect(video, JSON.stringify(ed.latestRender)).toBeTruthy();
  const peca = await baixar('membroA', video.url, `pc03-${cr.id}.mp4`);
  const trilha = gravarJson(`pc03-trilha-${cr.id}.json`, m.faceTrack.map((t: any) => ({ startFrame: t.startFrame, endFrame: t.endFrame, region: t.region })));
  // fora da região = convidada, inserts e b-roll inteiros + o resto do quadro nos planos principais
  const r = qaVideo(['peca', '--campeao', fixturePath('podcast-aceite.mp4'), '--peca', peca, '--trilha', trilha, '--folha', peca.replace('.mp4', '-folha.png')]);
  console.log('[qa] PC-03', JSON.stringify(r));
  expect(r.peca.frames).toBe(A.probe.frames);
  expect(r.audioMd5.peca).toBe(A.audioMd5);
  expect(r.foraFramesAbaixoDe40, `PSNR mín fora ${r.foraPsnrMin} no frame ${r.foraPsnrMinFrame}`).toBe(0);
  expect(r.dentroFramesIguaisTotal, `original piscando nos frames ${r.dentroFramesIguaisAoCampeao}`).toBe(0);
  expect(r.framesSemUmRostoTotal, `frames sem exatamente 1 rosto: ${JSON.stringify(r.framesSemUmRosto)}`).toBe(0);
});

test('TK-02 criativo do zero, motor LIPSYNC: 1 take TTS_LIPSYNC (TTS do texto inteiro → 1 LIPSYNC → 1 TRANSCRIBE), N cenas = fatias; fronteiras no silêncio (nenhuma palavra cortada); estimativa cobra o take uma vez', async () => {
  const { c, gen } = await criativoLipsync();
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=LIPSYNC&model=pruna-lipsync&format=VERTICAL_9_16&voiceId=${gen.voiceId}`));
  expect(e.lines.filter((l: any) => l.kind === 'LIPSYNC')).toHaveLength(1);
  expect(e.lines.filter((l: any) => l.kind === 'TTS')).toHaveLength(1);
  expect(e.lines.filter((l: any) => l.kind === 'TRANSCRIBE')).toHaveLength(1);
  const lip = e.lines.find((l: any) => l.kind === 'LIPSYNC');
  expect(lip.amountUsd).toBeCloseTo(Math.ceil(lip.units) * 0.025, 4);
  const r = expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { ...gen, expectedCostUsd: e.costUsd }), 202);
  expect(r.scenes.length).toBe(4);
  await ateEstado(c.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
  const tk = await takesDoCriativo(c.id);
  expect(tk).toHaveLength(1);
  expect(tk[0]).toMatchObject({ kind: 'TTS_LIPSYNC', status: 'READY' });
  const t = await tarefasDoCriativo(c.id);
  expect({ TTS: contar(t, 'TTS'), LIPSYNC: contar(t, 'LIPSYNC'), TRANSCRIBE: contar(t, 'TRANSCRIBE') }).toEqual({ TTS: 1, LIPSYNC: 1, TRANSCRIBE: 1 });
  expect(t.every((x) => x.take_id === tk[0].id && x.scene_id === null)).toBe(true);
  // TTS = texto inteiro (as 4 falas unidas, em ordem)
  const [sp] = await q('select speech from takes where id = $1', [tk[0].id]);
  for (const f of ['QA hook line.', 'QA problem line.', 'QA product line.', 'QA call to action.']) expect(sp.speech).toContain(f);
  expect(sp.speech.indexOf('QA hook line.')).toBeLessThan(sp.speech.indexOf('QA call to action.'));
  const cenas = await q('select index, pipeline, take_start_sec, take_end_sec, words from scenes where creative_id = $1 and not stale order by index', [c.id]);
  expect(cenas.every((s: any) => s.pipeline === 'TAKE_SLICE')).toBe(true);
  // palavras relativas à cena, todas dentro da fatia (nenhuma cortada na fronteira)
  for (const s of cenas) {
    const dur = Number(s.take_end_sec) - Number(s.take_start_sec);
    for (const w of s.words ?? []) {
      expect(w.startSec).toBeGreaterThanOrEqual(-0.001);
      expect(w.endSec, `palavra "${w.word}" passa do fim da cena ${s.index}`).toBeLessThanOrEqual(dur + 0.001);
    }
  }
  expect(await custoDoCriativo(c.id)).toBe(0); // mock = US$ 0, mesmo caminho de gravação
});

test('TK-03 refazer cena numa fatia = refaz o TAKE: sem confirm → 409 INVALID_STATE reason regenerate_take {takeId, estimateUsd}; esperado < 90 % da estimativa → ESTIMATE_CHANGED; com confirm + expectedCostUsd → attempt 2, seed 8, todas as fatias voltam a gerar, 2ª chamada LIPSYNC', async () => {
  const { c, gen } = await criativoLipsync();
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=LIPSYNC&model=pruna-lipsync&format=VERTICAL_9_16&voiceId=${gen.voiceId}`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { ...gen, expectedCostUsd: e.costUsd }), 202);
  await ateEstado(c.id, ['RENDER_READY']);
  const [tk] = await takesDoCriativo(c.id);
  console.log('[qa] TK-03 cenas antes', JSON.stringify(await q('select index, pipeline, take_id, status, stale from scenes where creative_id = $1 order by generation, index', [c.id])), 'takes', JSON.stringify(await takesDoCriativo(c.id)));
  const det = expectErro(await as('membroA').post(`/creatives/${c.id}/scenes/2/regenerate`, {}), 409, 'INVALID_STATE');
  expect(det).toMatchObject({ reason: 'regenerate_take', takeId: tk.id, estimateUsd: expect.any(Number) });
  expect((await takesDoCriativo(c.id))[0].attempt).toBe(1); // nada mudou
  // regra da v1 (a mesma do generate): esperado ACIMA passa; ESTIMATE_CHANGED só quando a estimativa real passa 10 % do esperado
  expect(det.estimateUsd, 'estimativa do take > 0 pra testar o lado de baixo').toBeGreaterThan(0);
  expectErro(await as('membroA').post(`/creatives/${c.id}/scenes/2/regenerate`, { confirm: true, expectedCostUsd: Number((det.estimateUsd / 2).toFixed(4)) }), 409, 'ESTIMATE_CHANGED');
  expect((await takesDoCriativo(c.id))[0].attempt).toBe(1);
  expectOk(await as('membroA').post(`/creatives/${c.id}/scenes/2/regenerate`, { confirm: true, expectedCostUsd: det.estimateUsd }), 202);
  const fatias = await q(`select status from scenes where creative_id = $1 and not stale`, [c.id]);
  expect(fatias.every((s: any) => ['QUEUED', 'GENERATING'].includes(s.status)), JSON.stringify(fatias)).toBe(true);
  await ateEstado(c.id, ['RENDER_READY', 'EDIT_PENDING', 'RENDER_FAILED', 'SCENES_FAILED']);
  const depois = await takesDoCriativo(c.id);
  const vivo = depois.find((t: any) => !t.stale) ?? depois[depois.length - 1];
  expect(vivo).toMatchObject({ attempt: 2, seed: 8, status: 'READY' });
  expect(contar(await tarefasDoCriativo(c.id), 'LIPSYNC')).toBe(2); // 1 por tentativa, nunca 1 por cena
});

test('TK-04 POST /creatives/:id/take/regenerate {expectedCostUsd} → 202 Take; outro workspace → 404; pedido de mudança SCENE/LINE custa o take inteiro (changeOptions)', async () => {
  const { c, gen } = await criativoLipsync();
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=LIPSYNC&model=pruna-lipsync&format=VERTICAL_9_16&voiceId=${gen.voiceId}`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { ...gen, expectedCostUsd: e.costUsd }), 202);
  await ateEstado(c.id, ['RENDER_READY']);
  const det = expectOk(await as('membroA').get(`/creatives/${c.id}`));
  const custo = det.take.regenerateEstimateUsd;
  const rev = expectOk(await as('membroA').get(`/creatives/${c.id}/review`));
  for (const t of ['SCENE', 'LINE']) {
    const op = rev.changeOptions.find((o: any) => o.type === t);
    expect(op?.estimateUsd, `${t} custa o take inteiro`).toBeCloseTo(custo, 4);
  }
  expectErro(await as('donoB').post(`/creatives/${c.id}/take/regenerate`, { expectedCostUsd: custo }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post(`/creatives/${c.id}/take/regenerate`, {}), 400, 'VALIDATION_ERROR');
  const t = expectOk(await as('membroA').post(`/creatives/${c.id}/take/regenerate`, { expectedCostUsd: custo, note: 'QA' }), 202);
  expect(t).toMatchObject({ kind: 'TTS_LIPSYNC', attempt: 2 });
  expect(['QUEUED', 'GENERATING']).toContain(t.status);
});

test('TK-05 falha do take vira "esperando você": [mock:PROVIDER_ERROR] na fala → take FAILED e TODAS as fatias FAILED com o mesmo errorCode; criativo SCENES_FAILED em needs_you; refazer o clipe destrava', async () => {
  const { c, gen } = await criativoLipsync({ falas: [undefined as any, 'QA problem line [mock:PROVIDER_ERROR].'] });
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=LIPSYNC&model=pruna-lipsync&format=VERTICAL_9_16&voiceId=${gen.voiceId}`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { ...gen, expectedCostUsd: e.costUsd }), 202);
  await ateEstado(c.id, ['SCENES_FAILED', 'RENDER_READY'], 90_000);
  expect((await q('select state from creatives where id = $1', [c.id]))[0].state).toBe('SCENES_FAILED');
  const [tk] = await takesDoCriativo(c.id);
  expect(tk).toMatchObject({ status: 'FAILED', error_code: 'PROVIDER_ERROR' });
  const fatias = await q('select status, error_code from scenes where creative_id = $1 and not stale', [c.id]);
  expect(fatias.every((s: any) => s.status === 'FAILED' && s.error_code === 'PROVIDER_ERROR'), JSON.stringify(fatias)).toBe(true);
  const det = expectOk(await as('membroA').get(`/creatives/${c.id}`));
  expect(det.take).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_ERROR', action: expect.any(String) });
  expect(expectOk(await as('membroA').get('/creatives?filter=needs_you')).map((l: any) => l.id)).toContain(c.id);
  // destrava: tira o gatilho e refaz o clipe
  const [s] = await q('select id, blocks from scripts where id = $1', [c.selectedScriptId]);
  await q('update scripts set blocks = $2::jsonb where id = $1', [s.id, JSON.stringify(s.blocks.map((b: any) => ({ ...b, speech: b.speech.replace(' [mock:PROVIDER_ERROR]', '') })))]);
  await q(`update takes set speech = replace(speech, ' [mock:PROVIDER_ERROR]', '') where id = $1`, [tk.id]);
  expectOk(await as('membroA').post(`/creatives/${c.id}/take/regenerate`, { expectedCostUsd: det.take.regenerateEstimateUsd }), 202);
  await ateEstado(c.id, ['RENDER_READY', 'EDIT_PENDING', 'SCENES_FAILED']);
  expect((await q('select state from creatives where id = $1', [c.id]))[0].state).not.toBe('SCENES_FAILED');
});

test('TK-06 áudio do take > 600 s → 422 LIPSYNC_AUDIO_TOO_LONG {durationSec, maxSec: 600} no generate (estimado por palavras/min); nada criado, nada cobrado', async () => {
  const longa = Array.from({ length: 450 }, (_, i) => `word${i}`).join(' ') + '.'; // 4 × 450 = 1800 palavras ≈ 720 s a 150 ppm
  const { c, gen } = await criativoLipsync({ falas: [longa, longa, longa, longa] });
  const r = await as('membroA').post(`/creatives/${c.id}/generate`, { ...gen, expectedCostUsd: 1000 });
  const det = expectErro(r, 422, 'LIPSYNC_AUDIO_TOO_LONG');
  expect(det.maxSec).toBe(600);
  expect(det.durationSec).toBeGreaterThan(600);
  expect(await takesDoCriativo(c.id)).toHaveLength(0);
  expect(await tarefasDoCriativo(c.id)).toHaveLength(0);
});

// ═════════════════ re-edição sem custo ═════════════════

test('RE-01 re-edição (texto da tela / corte) num criativo LIPSYNC pronto: PATCH /edit + render → 0 provider_tasks novas, custo igual, take intacto (attempt 1)', async () => {
  const { c, gen } = await criativoLipsync();
  const e = expectOk(await as('membroA').get(`/creatives/${c.id}/estimate?engine=LIPSYNC&model=pruna-lipsync&format=VERTICAL_9_16&voiceId=${gen.voiceId}`));
  expectOk(await as('membroA').post(`/creatives/${c.id}/generate`, { ...gen, expectedCostUsd: e.costUsd }), 202);
  await ateEstado(c.id, ['RENDER_READY']);
  const antes = { tarefas: (await tarefasDoCriativo(c.id)).length, custo: await custoDoCriativo(c.id), take: (await takesDoCriativo(c.id))[0] };
  expectOk(await as('membroA').patch(`/creatives/${c.id}/edit`, { headline: 'QA new headline', ctaText: 'QA new CTA' }));
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  await ateEstado(c.id, ['RENDER_READY', 'RENDER_FAILED']);
  expect((await q('select state from creatives where id = $1', [c.id]))[0].state).toBe('RENDER_READY');
  expect((await tarefasDoCriativo(c.id)).length).toBe(antes.tarefas);
  expect(await custoDoCriativo(c.id)).toBe(antes.custo);
  const depois = await takesDoCriativo(c.id);
  expect(depois).toHaveLength(1);
  expect(depois[0]).toMatchObject({ id: antes.take.id, attempt: 1, clip_file_id: antes.take.clip_file_id });
});

test('RE-02 criativo remix-keep: GET /edit devolve templateId remix-keep e PATCH /edit = 409 INVALID_STATE reason variation_locked (a edição é a do campeão)', async () => {
  const c = await campeaoPaineis('membroA', 'A');
  const { launch } = await lancar(c.id, [{ kind: 'SWAP_AVATAR', count: 1 }], { keepEdit: true });
  const cr = launch.creatives[0];
  await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
  const ed = expectOk(await as('membroA').get(`/creatives/${cr.id}/edit`));
  expect(ed.settings.templateId ?? ed.templateId).toBe('remix-keep');
  const det = expectErro(await as('membroA').patch(`/creatives/${cr.id}/edit`, { headline: 'QA' }), 409, 'INVALID_STATE');
  expect(det.reason).toBe('variation_locked');
});

// ═════════════════ Novos ganchos (a) gancho escrito — D6 decidida (06/10) ═════════════════

test('HK-01 NEW_HOOKS hookMode TEXT: sem controle; item só aceita hook.onScreenText (speech = 400); estimativa de geração US$ 0', async () => {
  const c = await campeaoPaineis('membroA', 'A');
  const b = expectOk(await as('membroA').post(`/champions/${c.id}/batches`, { requests: [{ kind: 'NEW_HOOKS', count: 3 }], settings: { keepEdit: true, hookMode: 'TEXT' } }), 202);
  const p = await atePlanoPronto(b.id);
  expect(p.status).toBe('PLAN_READY');
  expect(p.items.filter((i: any) => i.isControl)).toHaveLength(0); // o próprio campeão é o controle
  expect(p.items).toHaveLength(3);
  const orig = (await lerCampeao(c.id)).teardown.sections.hook.data.spoken;
  for (const i of p.items) {
    expect(i.hook.onScreenText).toBeTruthy();
    expect(i.hook.speech, 'fala do gancho = a original (não editável)').toBe(orig);
  }
  const it = p.items[0];
  expectErro(await as('membroA').patch(`/variation-batches/${b.id}/items/${it.id}`, { hook: { speech: 'QA new speech' } }), 400, 'VALIDATION_ERROR');
  const ok = expectOk(await as('membroA').patch(`/variation-batches/${b.id}/items/${it.id}`, { hook: { onScreenText: 'QA: YOUR BANK HIDES THIS' } }));
  expect(ok.hook.onScreenText).toBe('QA: YOUR BANK HIDES THIS');
  // sem elenco: não há rosto a gerar
  expect(p.castings ?? []).toHaveLength(0);
  const e = expectOk(await as('membroA').get(`/variation-batches/${b.id}/estimate`));
  const geracao = (e.lines ?? e.items?.flatMap((x: any) => x.lines ?? []) ?? []).filter((l: any) => ['VIDEO', 'TTS', 'LIPSYNC', 'TRANSCRIBE', 'IMAGE'].includes(l.kind));
  expect(geracao.reduce((s: number, l: any) => s + l.amountUsd, 0)).toBe(0);
  expect(e.costUsd).toBe(0);
});

test('HK-02 launch NEW_HOOKS TEXT: cada criativo = 1 cena SOURCE_CUT cobrindo o campeão, 0 provider_tasks, custo 0, sem take; render remix-keep', async () => {
  const c = await campeaoPaineis('membroA', 'A');
  const { launch } = await lancar(c.id, [{ kind: 'NEW_HOOKS', count: 2 }], { keepEdit: true, hookMode: 'TEXT' });
  expect(launch.creatives).toHaveLength(2);
  for (const cr of launch.creatives) {
    await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED', 'SCENES_FAILED']);
    expect((await q('select state from creatives where id = $1', [cr.id]))[0].state).toBe('RENDER_READY');
    const cenas = await q('select pipeline, source_start_sec, source_end_sec, status from scenes where creative_id = $1 and not stale', [cr.id]);
    expect(cenas).toHaveLength(1);
    expect(cenas[0]).toMatchObject({ pipeline: 'SOURCE_CUT', status: 'READY' });
    expect(Number(cenas[0].source_start_sec)).toBe(0);
    expect(Number(cenas[0].source_end_sec)).toBeGreaterThanOrEqual(14.9);
    expect(await tarefasDoCriativo(cr.id)).toHaveLength(0);
    expect(await custoDoCriativo(cr.id)).toBe(0);
    expect(await takesDoCriativo(cr.id)).toHaveLength(0);
    expect(expectOk(await as('membroA').get(`/creatives/${cr.id}`)).take).toBeNull();
  }
});

test('HK-03 peça do gancho escrito: áudio decodificado md5-idêntico ao campeão, corpo (fora da caixa da headline) PSNR ≥ 40 dB, mesmo nº de frames; dentro da faixa da headline o texto mudou', async () => {
  const P = paineis();
  const ref = P.fixtures.find((f) => f.file === 'paineis-caixa-15s.mp4')!;
  const c = await campeaoPaineis('membroA', 'A');
  const { launch } = await lancar(c.id, [{ kind: 'NEW_HOOKS', count: 2 }], { keepEdit: true, hookMode: 'TEXT' });
  const mapa = (await lerCampeao(c.id)).teardown.editMap;
  const h = mapa.layers.find((l: any) => l.kind === 'headline');
  const caixa = h.background.box ?? h.box;
  for (const cr of launch.creatives) {
    await ateEstado(cr.id, ['RENDER_READY', 'RENDER_FAILED']);
    const ed = expectOk(await as('membroA').get(`/creatives/${cr.id}/edit`));
    const peca = await baixar('membroA', (ed.previewRender ?? ed.latestRender).video.url, `hk03-${cr.id}.mp4`);
    // headline fixa o vídeo todo: troca no intervalo inteiro dela (§13.4) → a caixa sai da comparação até o fim da camada
    const r = qaVideo(['gancho', '--campeao', fixturePath('paineis-caixa-15s.mp4'), '--peca', peca, '--caixa', `${caixa.x},${caixa.y},${caixa.w},${caixa.h}`, '--ate-frame', String(h.endFrame)]);
    console.log('[qa] HK-03', JSON.stringify(r));
    expect(r.peca.frames).toBe(ref.probe.frames);
    expect(r.audioMd5.peca, 'áudio do corpo md5-idêntico').toBe(ref.audioMd5);
    // decisão do coordenador (06/10): corpo = PSNR >= 40 dB fora da região alterada; md5 do vídeo fora (exigiria render sem perdas)
    expect(r.foraFramesAbaixoDe40, `corpo (fora da headline): PSNR mín ${r.foraPsnrMin} no frame ${r.foraPsnrMinFrame}`).toBe(0);
    expect(r.ganchoFramesSemMudancaTotal, `headline sem o texto novo nos frames ${r.ganchoFramesSemMudanca}`).toBe(0);
  }
});

// ═════════════════ isolamento das rotas novas ═════════════════

test('I-KE-01 rotas do §13 com id de outro workspace → 404 e nada muda no banco de B', async () => {
  const cB = await campeaoComMapa('B', editMapRef());
  const crB = await criarCriativoNoEstado('B', 'RENDER_READY');
  const antes = await q('select id, state from creatives where workspace_id = $1 order by id', [WS.B]);
  expectErro(await as('membroA').get(`/champions/${cB.id}`), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post(`/champions/${cB.id}/batches`, { requests: [{ kind: 'NEW_HOOKS', count: 2 }], settings: { keepEdit: true, hookMode: 'TEXT' } }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post(`/creatives/${crB.id}/take/regenerate`, { expectedCostUsd: 1 }), 404, 'NOT_FOUND');
  expectErro(await as('membroA').post(`/creatives/${crB.id}/scenes/0/regenerate`, { confirm: true, expectedCostUsd: 1 }), 404, 'NOT_FOUND');
  expect(await q('select id, state from creatives where workspace_id = $1 order by id', [WS.B])).toEqual(antes);
  expect(await q('select id from variation_batches where champion_id = $1', [cB.id])).toHaveLength(0);
});
