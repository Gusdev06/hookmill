// Harness do §13 (manter a edição + take único). Dono: maquina-qa.
// - campeão de painéis de verdade pela API (upload + análise em mock), com o mapa da edição
// - mapa da edição fabricado (bloqueios explícitos que, em mock, dependem da visão)
// - provider_tasks por criativo (cena OU take), custo, download de arquivo e a conferência de vídeo (qa_video.py)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { aguardar, as, expectOk, tokenOf } from './api.ts';
import { q, WS, type Persona } from './db.ts';
import { ENV, TESTES_DIR } from './env.ts';
import { campeaoReal, criarCampeao, FIXTURES_DIR, type CampeaoFabricado } from './f2.ts';

type WsKey = keyof typeof WS;
export const QA_VIDEO = join(TESTES_DIR, 'ferramentas', 'qa_video.py');
export const SAIDA = join(TESTES_DIR, 'test-results', 'keep-edit');

export interface Paineis {
  grade: { width: number; height: number; fps: number; frames: number; audioSec: number };
  caixas: Record<'rosto' | 'topo' | 'camera' | 'app' | 'rodape', { x: number; y: number; w: number; h: number }>;
  fixtures: { file: string; audioMd5: string; probe: any; esperado: any; yunet: any }[];
}
export function paineis(): Paineis {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'paineis.json'), 'utf8'));
}
export const fixturePath = (file: string) => join(FIXTURES_DIR, file);

/** Campeão de painéis de verdade (upload + análise mock: a medição e o YuNet rodam de verdade). */
export async function campeaoPaineis(persona: Persona, ws: WsKey, file = 'paineis-caixa-15s.mp4', notes?: string): Promise<CampeaoFabricado> {
  const c = await campeaoReal(persona, ws, file, notes);
  if (process.env.QA_CORRIGIR_HEADLINE === '1') await corrigirHeadline(c.id);
  return c;
}
/** DIAGNÓSTICO (QA_CORRIGIR_HEADLINE=1), nunca vale como "passou": põe a headline do mapa na faixa chapada medida
 *  (0,0,720,119) e tira o caption_straddles_face que vinha dela, pra testar o que vem DEPOIS do mapa (take, render)
 *  enquanto o refino por pixel não estiver certo. */
export async function corrigirHeadline(championId: string): Promise<void> {
  const [t] = await q<{ id: string; edit_map: any }>('select id, edit_map from teardowns where champion_id = $1', [championId]);
  const m = t?.edit_map;
  if (!m) return;
  const top = { x: 0, y: 0, w: 720, h: 119 };
  for (const l of m.layers) if (l.kind === 'headline') Object.assign(l, { box: top, background: { kind: 'solid', color: '#d40f0f', box: top }, source: 'vision+pixel' });
  for (const k of ['SWAP_AVATAR', 'NEW_HOOKS']) {
    const a = m.keepEdit[k];
    a.blockers = a.blockers.filter((b: any) => b.reason !== 'caption_straddles_face');
    a.available = a.blockers.length === 0;
  }
  await q('update teardowns set edit_map = $2::jsonb where id = $1', [t.id, JSON.stringify(m)]);
}
export const lerCampeao = (id: string, p: Persona = 'membroA') => as(p).get(`/champions/${id}`).then((r) => expectOk(r));

// ───────────── mapa da edição fabricado ─────────────
const BOX = { x: 0, y: 119, w: 336, h: 324 };
const ESTILO = { fontId: 'montserrat-900', uppercase: true, fontSizePx: 40, lineHeight: 1.1, color: '#ffffff', highlightColor: null,
  strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' };
type Bloqueio = 'not_mapped' | 'no_face' | 'multiple_faces' | 'low_confidence' | 'caption_straddles_face' | 'overlay_over_face' | 'hook_text_over_video';
/** EditMap do caso de referência (grade de paineis-caixa) com os bloqueios pedidos. Só setup: o 422 e o detalhe
 *  do campeão têm que refletir o que está gravado (§13.7). `editMap: null` = campeão analisado antes do §13. */
export function editMapRef(bloq: { SWAP_AVATAR?: Bloqueio[]; NEW_HOOKS?: Bloqueio[] } = {}) {
  const hit = (r: Bloqueio) => ({ reason: r, startSec: r === 'not_mapped' ? null : 0, endSec: r === 'not_mapped' ? null : 15 });
  const av = (bs: Bloqueio[] = []) => ({ available: bs.length === 0, blockers: bs.map(hit) });
  return {
    version: 1, width: 720, height: 960, fps: 30, frameCount: 450,
    cells: [{ startFrame: 0, endFrame: 450, cells: [{ x: 0, y: 0, w: 720, h: 119 }, BOX, { x: 0, y: 443, w: 336, h: 397 }, { x: 336, y: 119, w: 384, h: 721 }, { x: 0, y: 840, w: 720, h: 120 }] }],
    faceTrack: [{ startFrame: 0, endFrame: 450, region: BOX, fullFrame: false, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.15, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.9 }],
    layers: [
      { id: 'headline', kind: 'headline', startFrame: 0, endFrame: 450, box: { x: 0, y: 0, w: 720, h: 119 },
        background: { kind: 'solid', color: '#d40f0f', box: { x: 0, y: 0, w: 720, h: 119 } }, style: ESTILO,
        text: 'I FOUND OUT WHY MY BILLS KEPT GOING UP EVERY MONTH.', wordsPerPage: null, source: 'vision+pixel' },
      { id: 'caption', kind: 'caption', startFrame: 0, endFrame: 400, box: { x: 160, y: 770, w: 400, h: 60 },
        background: { kind: 'none', color: null, box: null }, style: { ...ESTILO, highlightColor: '#ffe600', strokeColor: '#000000', strokeWidthPx: 4 },
        text: null, wordsPerPage: 3, source: 'vision' },
    ],
    overlaysOverFace: [],
    profile: { gender: 'female', ageBand: '25-34', ethnicity: 'white', hair: 'shoulder-length wavy brown', clothing: 'black tank top',
      setting: 'outdoors, trees', lighting: 'soft daylight', framing: 'chest up', pose: 'facing camera' },
    keepEdit: { SWAP_AVATAR: av(bloq.SWAP_AVATAR), NEW_HOOKS: av(bloq.NEW_HOOKS) },
  };
}
/** Campeão READY da fábrica com o editMap pedido (null = não mapeado). */
export async function campeaoComMapa(ws: WsKey, editMap: unknown | null): Promise<CampeaoFabricado> {
  const c = await criarCampeao(ws, 'READY');
  await q('update teardowns set edit_map = $2::jsonb where id = $1', [c.teardownId, editMap === null ? null : JSON.stringify(editMap)]);
  return c;
}

// ───────────── provedor e custo ─────────────
/** Toda provider_task de um criativo: pela cena (pipelines antigos) OU pelo take (§13.5). */
export async function tarefasDoCriativo(creativeId: string): Promise<{ id: string; kind: string; status: string; take_id: string | null; scene_id: string | null; input: any }[]> {
  return q(
    `select p.id, p.kind, p.status, p.take_id, p.scene_id, p.input from provider_tasks p
      left join scenes s on s.id = p.scene_id left join takes t on t.id = p.take_id
      where s.creative_id = $1 or t.creative_id = $1 order by p.submitted_at`, [creativeId]);
}
export const contar = (ts: { kind: string }[], kind: string) => ts.filter((t) => t.kind === kind).length;
export async function custoDoCriativo(creativeId: string): Promise<number> {
  const [r] = await q<{ s: string | null }>('select sum(amount_usd) s from cost_entries where creative_id = $1', [creativeId]);
  return Number(r.s ?? 0);
}
export async function takesDoCriativo(creativeId: string) {
  return q(`select id, generation, kind, status, attempt, seed, source_start_sec, source_end_sec, duration_sec, clip_file_id, error_code, stale
              from takes where creative_id = $1 order by generation, created_at`, [creativeId]);
}
export async function estadoCriativo(id: string): Promise<string> {
  const [r] = await q<{ state: string }>('select state from creatives where id = $1', [id]);
  return r?.state;
}
export const ateEstado = (id: string, ok: string[], timeoutMs = Number(process.env.QA_RENDER_MS ?? 600_000)) =>
  aguardar(() => estadoCriativo(id), (s) => ok.includes(s), { timeoutMs, intervalMs: 1000, oQue: `criativo ${id} em ${ok.join('|')}` });

// ───────────── arquivos e conferência de vídeo ─────────────
/** Baixa um FileRef (url assinada, ou /files da API com Bearer seguindo o 302) pra test-results/keep-edit/. */
export async function baixar(persona: Persona, url: string, nome: string): Promise<string> {
  mkdirSync(SAIDA, { recursive: true });
  const abs = url.startsWith('http') ? url : `${new URL(ENV.apiUrl).origin}${url}`;
  const headers: Record<string, string> = {};
  if (abs.startsWith(new URL(ENV.apiUrl).origin)) headers.authorization = `Bearer ${await tokenOf(persona)}`;
  const r = await fetch(abs, { headers, redirect: 'follow' });
  if (!r.ok) throw new Error(`[qa] download ${abs}: ${r.status}`);
  const p = join(SAIDA, nome);
  writeFileSync(p, Buffer.from(await r.arrayBuffer()));
  return p;
}
export function qaVideo(args: string[]): any {
  const r = spawnSync('python3', [QA_VIDEO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`[qa] qa_video ${args[0]} falhou: ${r.stderr.slice(-1500)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}
export function gravarJson(nome: string, v: unknown): string {
  mkdirSync(SAIDA, { recursive: true });
  const p = join(SAIDA, nome);
  writeFileSync(p, JSON.stringify(v));
  return p;
}
