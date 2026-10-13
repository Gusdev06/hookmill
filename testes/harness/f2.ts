// Harness da feature 2 "variar campeão" (docs/contratos/feature-2-variar-campeao.md). Dono: maquina-qa.
// - fixtures de vídeo (gerar.mjs → manifest.json), upload em 3 passos (POST /uploads → PUT url → complete)
// - fábrica: campeão, teardown, lote, itens, elencos, rostos e criativos de variação direto no maquina_test,
//   em qualquer estado das máquinas do campeão e do lote (só setup; a API real só muda estado pela máquina dela).
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { call, tokenOf, type Res } from './api.ts';
import { PERSONAS, WS, q, type Persona } from './db.ts';
import { ENV, TESTES_DIR } from './env.ts';
import { criarCriativoNoEstado, criarOferta, type CreativeState, type CriativoFabricado, type OfferRow } from './fabrica.ts';

type WsKey = keyof typeof WS;
const id = (p: string) => `qa_${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const ownerOf = (ws: WsKey) => (ws === 'A' ? PERSONAS.donoA.id : PERSONAS.donoB.id);

// ───────────── fixtures ─────────────
export const FIXTURES_DIR = join(TESTES_DIR, 'fixtures', 'campeoes');
export interface Fixture {
  file: string; mimeType: string; sizeBytes: number; md5: string; prova: string; decodificaInteiro: boolean;
  probe: { ok: boolean; durationSec: number; width: number | null; height: number | null; videoCodec: string | null; hasVideo: boolean; hasAudio: boolean };
  esperado: { complete: 'READY' | { status: number; code: string; details: Record<string, unknown> }; warnings?: string[]; analise?: unknown; hasSpeech?: boolean };
}
interface Manifest { fixtures: Fixture[]; simulados: { nome: string; sizeBytes: number; mimeType: string; esperado: { status: number; code: string; details: Record<string, unknown> } }[] }
let manifest: Manifest | null = null;
export function manifesto(): Manifest {
  if (manifest) return manifest;
  const p = join(FIXTURES_DIR, 'manifest.json');
  if (!existsSync(p)) throw new Error('[qa] sem fixtures da feature 2: rode `node testes/fixtures/campeoes/gerar.mjs` (ffmpeg local, grátis)');
  manifest = JSON.parse(readFileSync(p, 'utf8')) as Manifest;
  for (const f of manifest.fixtures) {
    if (!existsSync(join(FIXTURES_DIR, f.file))) throw new Error(`[qa] fixture ${f.file} sumiu: rode de novo o gerar.mjs`);
  }
  return manifest;
}
export function fixture(file: string): Fixture & { path: string } {
  // §13: fixtures de painéis (gerar-paineis.mjs → paineis.json) entram pelo mesmo caminho de upload
  const pj = join(FIXTURES_DIR, 'paineis.json');
  if (file.startsWith('paineis-') && existsSync(pj)) {
    const p = (JSON.parse(readFileSync(pj, 'utf8')).fixtures as any[]).find((x) => x.file === file);
    if (p) return { ...p, prova: p.prova, decodificaInteiro: true, esperado: { complete: 'READY' }, path: join(FIXTURES_DIR, p.file) };
  }
  // aceite com campeão real (cópia local fora do git, aceite.json)
  const aj = join(FIXTURES_DIR, 'aceite.json');
  if (file.startsWith('podcast-') && existsSync(aj)) {
    const p = (JSON.parse(readFileSync(aj, 'utf8')).fixtures as any[]).find((x) => x.file === file);
    if (p) return { ...p, decodificaInteiro: true, esperado: { complete: 'READY' }, path: join(FIXTURES_DIR, p.file) };
  }
  const f = manifesto().fixtures.find((x) => x.file === file);
  if (!f) throw new Error(`[qa] fixture desconhecida: ${file}`);
  return { ...f, path: join(FIXTURES_DIR, f.file) };
}

// ───────────── upload em 3 passos (api.md §18) ─────────────
/** PUT cru na `url` que o POST /uploads devolveu, seguindo `method/headers` como o web faz.
 *  Em `proxy` a url é da própria API: manda o Bearer junto (rota autenticada como as outras). */
export async function putCru(persona: Persona | null, url: string, body: Buffer, headers: Record<string, string> = {}): Promise<Res> {
  const h: Record<string, string> = { ...headers };
  const apiOrigin = new URL(ENV.apiUrl).origin;
  if (persona && url.startsWith(apiOrigin)) h.authorization = `Bearer ${await tokenOf(persona)}`;
  if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/octet-stream';
  const r = await fetch(url, { method: 'PUT', headers: h, body: new Uint8Array(body) });
  const text = await r.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* storage direto responde XML/vazio */ }
  return { status: r.status, body: parsed, data: parsed?.data, headers: r.headers };
}

export interface Subida { create: Res; put: Res | null; complete: Res | null; uploadId: string | null }
/** POST /uploads → PUT → POST complete com uma fixture. `declarar` sobrescreve o que vai no POST (tamanho, mime, nome). */
export async function subir(
  persona: Persona,
  file: string,
  opts: { declarar?: Partial<{ sizeBytes: number; mimeType: string; filename: string }>; semPut?: boolean; semComplete?: boolean; corpo?: Buffer } = {},
): Promise<Subida> {
  const f = fixture(file);
  const bytes = opts.corpo ?? readFileSync(f.path);
  const body = { purpose: 'CHAMPION_VIDEO', filename: f.file, mimeType: f.mimeType, sizeBytes: bytes.length, ...opts.declarar };
  const create = await call('POST', '/uploads', { body, token: await tokenOf(persona) });
  if (create.status !== 201) return { create, put: null, complete: null, uploadId: null };
  const { uploadId, url, headers } = create.data;
  const put = opts.semPut ? null : await putCru(persona, url, bytes, headers ?? {});
  const complete = opts.semComplete ? null : await call('POST', `/uploads/${uploadId}/complete`, { body: {}, token: await tokenOf(persona) });
  return { create, put, complete, uploadId };
}

// ───────────── teardown de exemplo (12 seções, TeardownSections) ─────────────
export const SECTION_KEYS = ['identification', 'metaCopy', 'transcript', 'hook', 'structure', 'layout', 'visual', 'audio', 'offerProofCta', 'whySells', 'stealVsVary', 'replicationPlan'] as const;
const ok = <T>(data: T) => ({ status: 'ok', naReason: null, data });
export const WORDS = 'Stop scrolling. You are paying for apps you forgot about. Last month I found three subscriptions I never used. This app lists every recurring charge. Tap the link today.'
  .split(' ')
  .map((word, i) => ({ word, startSec: Number((i * 0.55).toFixed(2)), endSec: Number((i * 0.55 + 0.45).toFixed(2)) }));
export const TEARDOWN_SECTIONS = {
  identification: ok({ summary: 'QA: 20 s, 9:16, en', signals: ['20 s', '9:16'] }),
  metaCopy: { status: 'na', naReason: 'QA: sem link da Ad Library', data: null },
  transcript: ok({ keywords: [{ sentence: 'Stop scrolling.', keyword: 'scrolling' }] }),
  hook: ok({ endSec: 3, visual: 'QA: talking head close-up', onScreenText: 'Stop scrolling', spoken: 'Stop scrolling. You are paying for apps you forgot about.' }),
  structure: ok({ blocks: [
    { label: 'hook', function: 'pattern interrupt', startSec: 0, endSec: 3, onScreen: 'Stop scrolling', speech: 'Stop scrolling. You are paying for apps you forgot about.' },
    { label: 'proof', function: 'story', startSec: 3, endSec: 9, onScreen: '', speech: 'Last month I found three subscriptions I never used.' },
    { label: 'product', function: 'mechanism', startSec: 9, endSec: 15, onScreen: '', speech: 'This app lists every recurring charge.' },
    { label: 'cta', function: 'cta', startSec: 15, endSec: 20, onScreen: 'Link below', speech: 'Tap the link today.' },
  ] }),
  layout: ok({ summary: 'QA: full head, then split at 8 s', segments: [{ startSec: 0, endSec: 8, description: 'full head' }, { startSec: 8, endSec: 20, description: 'split 55/45' }] }),
  visual: ok({ palette: [{ hex: '#c8906a', role: 'skin' }], typography: 'sans', captions: 'line', uiElements: 'none', person: 'woman, 30s, medium shot, kitchen', broll: 'none', motion: 'static' }),
  audio: ok({ voice: 'female, calm', music: 'none', sfx: 'none' }),
  offerProofCta: ok({ promise: 'find forgotten money', mechanism: 'reads statements', proof: 'personal story', ctaSpoken: 'Tap the link today.', ctaOnScreen: 'Link below' }),
  whySells: ok({ avatar: 'adults', awarenessLevel: 'problem aware', painDesire: 'wasted money', bigIdea: 'hidden subscriptions', beliefObjection: 'I already check', retentionEngine: 'open loop', verdict: ['hook', 'proof', 'simple cta'] }),
  stealVsVary: ok({ steal: ['open with the loss'], vary: [{ lever: 'curiosity', idea: 'question hook' }] }),
  replicationPlan: ok({ suggestions: [{ kind: 'NEW_HOOKS', lever: 'curiosity', idea: 'question' }, { kind: 'SWAP_AVATAR', lever: 'avatar', idea: 'older man' }] }),
};
export const MEASUREMENTS = {
  durationSec: 20, width: 720, height: 1280, fps: 30, hasAudio: true,
  cuts: [{ atSec: 8, kind: 'layout' }, { atSec: 14, kind: 'content' }],
  segments: [{ startSec: 0, endSec: 8, bands: [{ y0: 0, y1: 1280, pct: 100, role: 'face' }] },
             { startSec: 8, endSec: 20, bands: [{ y0: 0, y1: 704, pct: 55, role: 'face' }, { y0: 704, y1: 1280, pct: 45, role: 'panel' }] }],
  palette: ['#c8906a', '#3a2a20'], silences: [{ startSec: 3.1, endSec: 3.6 }], keyframes: [],
};

async function arquivo(ws: WsKey, kind: string, mime: string, ext: string, extra: { durationSec?: number; width?: number; height?: number } = {}): Promise<string> {
  const fid = id('file');
  await q(`insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes, duration_sec, width, height) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    fid, WS[ws], kind, `ws/${WS[ws]}/${kind.toLowerCase()}/${fid}.${ext}`, mime, 1024, extra.durationSec ?? null, extra.width ?? null, extra.height ?? null,
  ]);
  return fid;
}

// ───────────── campeão ─────────────
export type ChampionStatus = 'RESOLVING' | 'ANALYZING' | 'READY' | 'FAILED';
export interface CampeaoFabricado { id: string; workspaceId: string; offer: OfferRow; status: ChampionStatus; videoFileId: string | null; teardownId: string | null }
export async function criarCampeao(
  ws: WsKey,
  status: ChampionStatus,
  opts: { offer?: OfferRow; hasSpeech?: boolean; rights?: 'OWN' | 'THIRD_PARTY'; editedSections?: string[]; comVideo?: boolean; name?: string; errorCode?: string } = {},
): Promise<CampeaoFabricado> {
  const offer = opts.offer ?? (await criarOferta(ws));
  const cid = id('champion');
  const comVideo = opts.comVideo ?? status !== 'RESOLVING';
  const video = comVideo ? await arquivo(ws, 'CHAMPION_VIDEO', 'video/mp4', 'mp4', { durationSec: 20, width: 720, height: 1280 }) : null;
  const audio = comVideo ? await arquivo(ws, 'CHAMPION_AUDIO', 'audio/mp4', 'm4a', { durationSec: 20 }) : null;
  const hasSpeech = opts.hasSpeech ?? true;
  await q(
    `insert into champions (id, workspace_id, offer_id, name, status, rights, rights_declared_by_id, rights_declared_at, video_file_id, audio_file_id,
                            duration_sec, language, has_speech, error_code, fail_reason, created_by_id, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())`,
    [
      cid, WS[ws], offer.id, opts.name ?? `QA Champion ${ws} ${status}`, status, opts.rights ?? 'THIRD_PARTY',
      opts.rights === 'OWN' ? ownerOf(ws) : null, opts.rights === 'OWN' ? new Date().toISOString() : null,
      video, audio, comVideo ? 20 : null, comVideo ? 'en' : null, status === 'READY' && hasSpeech,
      status === 'FAILED' ? (opts.errorCode ?? 'PROVIDER_ERROR') : null, status === 'FAILED' ? 'QA: analysis failed' : null, ownerOf(ws),
    ],
  );
  let teardownId: string | null = null;
  if (status === 'READY') {
    teardownId = id('teardown');
    await q(
      `insert into teardowns (id, workspace_id, champion_id, transcript, measurements, sections, edited_sections, model, analyzed_at, updated_at)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,'qa-fake',now(),now())`,
      [
        teardownId, WS[ws], cid,
        JSON.stringify({ language: 'en', text: hasSpeech ? WORDS.map((w) => w.word).join(' ') : '', words: hasSpeech ? WORDS : [], wpm: hasSpeech ? 150 : 0, wordsSource: 'whisper' }),
        JSON.stringify(MEASUREMENTS), JSON.stringify(TEARDOWN_SECTIONS), opts.editedSections ?? [],
      ],
    );
  }
  return { id: cid, workspaceId: WS[ws], offer, status, videoFileId: video, teardownId };
}
export async function statusCampeao(championId: string): Promise<ChampionStatus> {
  const [r] = await q<{ status: ChampionStatus }>('select status from champions where id = $1', [championId]);
  return r?.status;
}

// ───────────── lote ─────────────
export type BatchStatus = 'PLANNING' | 'PLAN_READY' | 'PLAN_FAILED' | 'LAUNCHED';
export interface LoteFabricado {
  id: string; workspaceId: string; champion: CampeaoFabricado; status: BatchStatus;
  items: { id: string; kind: string; index: number; isControl: boolean; castingId: string | null }[];
  castings: { id: string; scope: 'SHARED' | 'ITEM'; faceIds: string[]; selectedFaceId: string | null }[];
}
/** Lote com 1 SWAP_AVATAR + N NEW_HOOKS (+ controle). `rostosEscolhidos` = elencos já com rosto escolhido (pronto pro launch). */
export async function criarLote(
  ws: WsKey,
  status: BatchStatus,
  opts: { champion?: CampeaoFabricado; swaps?: number; hooks?: number; rostosEscolhidos?: boolean; voiceSource?: 'CATALOG' | 'CHAMPION_AUDIO' } = {},
): Promise<LoteFabricado> {
  const champion = opts.champion ?? (await criarCampeao(ws, 'READY'));
  const swaps = opts.swaps ?? 1;
  const hooks = opts.hooks ?? 3;
  const bid = id('batch');
  const requests = [...(swaps ? [{ kind: 'SWAP_AVATAR', count: swaps }] : []), ...(hooks ? [{ kind: 'NEW_HOOKS', count: hooks }] : [])];
  const settings = {
    format: 'VERTICAL_9_16', voiceId: 'Wise_Woman', voiceSource: opts.voiceSource ?? 'CHAMPION_AUDIO', engine: null, engineModel: null,
    edit: { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: 'Start now', endCard: true },
  };
  await q(
    `insert into variation_batches (id, workspace_id, champion_id, offer_id, status, language, requests, settings, teardown_snapshot, estimated_cost_usd, launched_at, created_by_id, updated_at)
     values ($1,$2,$3,$4,$5,'en',$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,now())`,
    // teardown_snapshot = o que o backend grava no POST /batches (variacoes.service snapshotOf): seções + palavras + medidas
    [bid, WS[ws], champion.id, champion.offer.id, status, JSON.stringify(requests), JSON.stringify(settings),
     JSON.stringify({ sections: TEARDOWN_SECTIONS, words: WORDS, durationSec: 20, width: 720, height: 1280 }),
     status === 'LAUNCHED' ? 1.93 : null, status === 'LAUNCHED' ? new Date().toISOString() : null, ownerOf(ws)],
  );
  const itemStatus = status === 'PLANNING' ? 'WRITING' : status === 'PLAN_FAILED' ? 'FAILED' : 'READY';
  const castings: LoteFabricado['castings'] = [];
  const items: LoteFabricado['items'] = [];
  const escolhido = opts.rostosEscolhidos ?? status === 'LAUNCHED';

  async function casting(scope: 'SHARED' | 'ITEM', description: string) {
    const cid = id('casting');
    await q(`insert into variation_castings (id, workspace_id, batch_id, scope, description, updated_at) values ($1,$2,$3,$4,$5,now())`, [cid, WS[ws], bid, scope, description]);
    const faceIds: string[] = [];
    if (status !== 'PLANNING') {
      for (let pos = 0; pos < 4; pos++) {
        const fid = id('face');
        faceIds.push(fid);
        const file = await arquivo(ws, 'FACE_IMAGE', 'image/png', 'png');
        await q(
          `insert into faces (id, workspace_id, creative_id, casting_id, batch, position, description, status, file_id, updated_at)
           values ($1,$2,null,$3,1,$4,$5,'READY',$6,now())`,
          [fid, WS[ws], cid, pos, description, file],
        );
      }
    }
    const selected = escolhido && faceIds.length ? faceIds[0] : null;
    if (selected) await q('update variation_castings set selected_face_id = $2 where id = $1', [cid, selected]);
    castings.push({ id: cid, scope, faceIds, selectedFaceId: selected });
    return cid;
  }
  async function item(kind: string, index: number, isControl: boolean, castingId: string | null, payload: unknown) {
    const iid = id('item');
    await q(
      `insert into variation_items (id, workspace_id, batch_id, kind, index, is_control, included, status, lever, rationale, payload, casting_id, error_code, fail_reason, updated_at)
       values ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10::jsonb,$11,$12,$13,now())`,
      [iid, WS[ws], bid, kind, index, isControl, itemStatus,
       itemStatus === 'READY' ? `QA lever ${kind} ${index}` : null, itemStatus === 'READY' ? 'QA rationale' : null, JSON.stringify(payload), castingId,
       itemStatus === 'FAILED' ? 'PROVIDER_ERROR' : null, itemStatus === 'FAILED' ? 'QA: plan failed' : null],
    );
    items.push({ id: iid, kind, index, isControl, castingId });
  }
  const blocos = (hookSpeech?: string) => TEARDOWN_SECTIONS.structure.data.blocks.map((b, i) => ({
    label: b.label, startSec: b.startSec, endSec: b.endSec, speech: i === 0 && hookSpeech ? hookSpeech : b.speech, visualPrompt: '',
  }));
  for (let i = 0; i < swaps; i++) {
    const c = await casting('ITEM', `QA cast ${i}: man in his 50s, garage, warm light`);
    await item('SWAP_AVATAR', i, false, c, { blocks: blocos() });
  }
  if (hooks) {
    const shared = await casting('SHARED', 'QA shared cast: woman in her 30s, kitchen, natural light');
    const orig = TEARDOWN_SECTIONS.hook.data.spoken;
    await item('NEW_HOOKS', -1, true, shared, { hook: { speech: orig, onScreenText: 'Stop scrolling' }, hookDurationSec: 3, blocks: blocos(orig) });
    for (let i = 0; i < hooks; i++) {
      const sp = `QA hook ${i}: did you know your bank hides this?`;
      await item('NEW_HOOKS', i, false, shared, { hook: { speech: sp, onScreenText: `QA hook ${i}` }, hookDurationSec: 3, blocks: blocos(sp) });
    }
  }
  return { id: bid, workspaceId: WS[ws], champion, status, items, castings };
}
export async function statusLote(batchId: string): Promise<BatchStatus> {
  const [r] = await q<{ status: BatchStatus }>('select status from variation_batches where id = $1', [batchId]);
  return r?.status;
}

// ───────────── criativo de variação ─────────────
/** Criativo v1 da fábrica marcado como variação (origin VARIATION) de um lote já LAUNCHED, com o pipeline de cena do tipo. */
export async function criarCriativoVariacao(
  ws: WsKey,
  state: CreativeState,
  kind: 'SWAP_AVATAR' | 'NEW_HOOKS',
  opts: { voiceSource?: 'CATALOG' | 'CHAMPION_AUDIO'; lote?: LoteFabricado } = {},
): Promise<CriativoFabricado & { lote: LoteFabricado; itemId: string }> {
  const voiceSource = opts.voiceSource ?? (kind === 'SWAP_AVATAR' ? 'CHAMPION_AUDIO' : 'CATALOG');
  const lote = opts.lote ?? (await criarLote(ws, 'LAUNCHED', { voiceSource }));
  const it = lote.items.find((i) => i.kind === kind && !i.isControl)!;
  const c = await criarCriativoNoEstado(ws, state, { offer: lote.champion.offer });
  await q(
    `update creatives set origin = 'VARIATION', champion_id = $2, variation_batch_id = $3, variation_item_id = $4, variation_kind = $5,
            voice_source = $6, engine = case when engine is null then null else 'LIPSYNC'::"Engine" end,
            engine_model = case when engine_model is null then null else 'pruna-lipsync' end where id = $1`,
    [c.id, lote.champion.id, lote.id, it.id, kind, voiceSource],
  );
  const pipeline = kind === 'SWAP_AVATAR' && voiceSource === 'CHAMPION_AUDIO' ? 'AUDIO_LIPSYNC' : 'TTS_LIPSYNC';
  await q(`update scenes set pipeline = $2 where creative_id = $1`, [c.id, pipeline]);
  return { ...c, lote, itemId: it.id };
}

// ───────────── higiene entre testes ─────────────
/** Espera os jobs assíncronos (análise, plano, regerar item) terminarem antes do TRUNCATE do próximo teste.
 *  Sem isso o reset apaga o lote no meio do plano e a API cai (bug reportado ao backend em 06/10: erro de banco
 *  num job em segundo plano derruba o processo). O bug segue aberto: a reprodução está no CASOS.md. */
export async function esperarJobsQuietos(timeoutMs = 30_000): Promise<void> {
  const ate = Date.now() + timeoutMs;
  while (Date.now() < ate) {
    // jobs E renders: o reset por TRUNCATE não cancela render em andamento na API; sem esperar, a fila de render
    // (RENDER_CONCURRENCY=1) atravessa os testes e o seguinte estoura o tempo esperando a vez
    const [r] = await q<{ n: number }>(`select ((select count(*) from jobs where status in ('QUEUED','RUNNING'))
                                              + (select count(*) from renders where status in ('QUEUED','RENDERING')))::int n`);
    if (!r.n) return;
    await new Promise((res) => setTimeout(res, 300));
  }
}

/** Campeão de verdade pela API (upload + análise em mock), com vídeo e áudio no storage de teste.
 *  Necessário quando o teste gera cenas AUDIO_LIPSYNC (o backend corta o áudio real do campeão). */
export async function campeaoReal(persona: Persona, ws: WsKey, file = 'fala-split-20s.mp4', notes?: string): Promise<CampeaoFabricado> {
  const offer = await criarOferta(ws);
  const s = await subir(persona, file);
  if (s.complete?.status !== 200) throw new Error(`[qa] upload falhou: ${JSON.stringify(s.complete?.body)}`);
  const c = await call('POST', '/champions', { body: { offerId: offer.id, uploadId: s.uploadId, rights: 'THIRD_PARTY', ...(notes ? { notes } : {}) }, token: await tokenOf(persona) });
  if (c.status !== 202) throw new Error(`[qa] POST /champions: ${c.status} ${JSON.stringify(c.body)}`);
  const t0 = Date.now();
  const ate = t0 + Number(process.env.QA_ANALISE_MS ?? 60_000);
  for (;;) {
    const [r] = await q<{ status: ChampionStatus; video_file_id: string; error_code: string | null }>('select status, video_file_id, error_code from champions where id = $1', [c.data.id]);
    if (r.status === 'READY') { if (process.env.QA_ANALISE_MS) console.log(`[qa] análise ${file}: ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
    if (r.status === 'READY') return { id: c.data.id, workspaceId: WS[ws], offer, status: 'READY', videoFileId: r.video_file_id, teardownId: null };
    if (r.status === 'FAILED' || Date.now() > ate) {
      const [j] = await q('select error_code, fail_reason from jobs where champion_id = $1 order by created_at desc limit 1', [c.data.id]);
      throw new Error(`[qa] análise do campeão real terminou ${r.status}: job ${JSON.stringify(j)} (flaky reportado pelo backend? devolver com isso)`);
    }
    await new Promise((res) => setTimeout(res, 500));
  }
}
