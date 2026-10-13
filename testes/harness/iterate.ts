// Harness da variação automática de campeão (docs/contratos/variacao-auto-v1.md, Q1 13/10). Dono: maquina-qa.
// Upload de verdade (POST /uploads → PUT → complete) com arquivo por caminho, oferta com o Brain inteiro (ou vazio),
// lote AUTO pela API e espera por polling (o mesmo GET /iterate/:id que o web usa).
import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { call, tokenOf, type Res } from './api.ts';
import { PERSONAS, WS, q, type Persona } from './db.ts';
import { TESTES_DIR } from './env.ts';
import { putCru } from './f2.ts';

type WsKey = keyof typeof WS;
const id = (p: string) => `qa_${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const CAMPEOES = join(TESTES_DIR, 'fixtures', 'campeoes');
/** Campeão real do Gusta (formato podcast, 49 s, 720x1280, cópia local fora do git; aceite.json). */
export const PODCAST = join(CAMPEOES, 'podcast-aceite.mp4');
export const FALA20 = join(CAMPEOES, 'fala-split-20s.mp4');
/** Recorte de 6 s do fala-split-20s (ffmpeg, 13/10): vídeo curto válido (≥ 4 s) */
export const CURTO6 = join(CAMPEOES, 'curto-6s.mp4');
export const CURTO3 = join(CAMPEOES, 'curto-3s.mp4');
export const PRODUTO_PNG = join(TESTES_DIR, 'fixtures', 'produto-qa.png');

/** Brain inteiro: página (example.com, captura grátis), prova citável, oferta com preço e garantia. */
export const BRAIN_CHEIO = {
  kind: 'Subscription app',
  what: 'A budgeting app that finds forgotten subscriptions.',
  audience: 'Adults who tried budgeting apps and gave up',
  pains: 'Paying every month for apps they forgot about',
  promise: 'Find money you forgot you were spending.',
  proof: 'I tried three budgeting apps and gave up on all of them. This one found my forgotten subscriptions in five minutes.',
  offerAndPrice: '7-day free trial, then 9.99 a month. 30-day money-back guarantee.',
  cta: 'Start your free trial',
  sourceUrl: 'https://example.com/',
};
export const BRAIN_VAZIO = { kind: null, what: null, audience: null, pains: null, promise: null, proof: null, offerAndPrice: null, cta: null, sourceUrl: null };

export interface OfertaV { id: string; name: string }
export async function oferta(ws: WsKey, over: Record<string, unknown> = {}): Promise<OfertaV> {
  const o = { id: id('offer'), name: `QA Offer ${ws}`, language: 'en', notes: null as string | null, ...BRAIN_CHEIO, ...over } as Record<string, any>;
  await q(
    `insert into offers (id, workspace_id, name, language, kind, what, audience, pains, promise, proof, offer_and_price, cta, notes, source_url, field_sources, created_by_id, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'{}'::jsonb,$15,now())`,
    [o.id, WS[ws], o.name, o.language, o.kind, o.what, o.audience, o.pains, o.promise, o.proof, o.offerAndPrice, o.cta, o.notes, o.sourceUrl,
     ws === 'A' ? PERSONAS.donoA.id : PERSONAS.donoB.id],
  );
  return { id: o.id, name: o.name };
}

export interface Subida { create: Res; put: Res | null; complete: Res | null; uploadId: string | null }
/** POST /uploads → PUT → complete com um arquivo qualquer (caminho). */
export async function subirArquivo(persona: Persona, path: string, opts: { purpose?: 'CHAMPION_VIDEO' | 'PRODUCT_IMAGE'; mimeType?: string } = {}): Promise<Subida> {
  const bytes = readFileSync(path);
  const purpose = opts.purpose ?? 'CHAMPION_VIDEO';
  const mimeType = opts.mimeType ?? (path.endsWith('.png') ? 'image/png' : path.endsWith('.mov') ? 'video/quicktime' : 'video/mp4');
  const tok = await tokenOf(persona);
  const create = await call('POST', '/uploads', { body: { purpose, filename: basename(path), mimeType, sizeBytes: statSync(path).size }, token: tok });
  if (create.status !== 201) return { create, put: null, complete: null, uploadId: null };
  const { uploadId, url, headers } = create.data;
  const put = await putCru(persona, url, bytes, headers ?? {});
  const complete = await call('POST', `/uploads/${uploadId}/complete`, { body: {}, token: await tokenOf(persona) });
  return { create, put, complete, uploadId };
}

export const getLote = async (persona: Persona, batchId: string) => call('GET', `/iterate/${batchId}`, { token: await tokenOf(persona) });

/** Polling do GET /iterate/:id (1,5 s, como o web) até `ok`. */
export async function ateLote(persona: Persona, batchId: string, ok: (b: any) => boolean, { timeoutMs = 120_000, oQue = 'lote' } = {}): Promise<any> {
  const ate = Date.now() + timeoutMs;
  let last: Res | null = null;
  while (Date.now() < ate) {
    last = await getLote(persona, batchId);
    if (last.status === 200 && ok(last.data)) return last.data;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const d = last?.data;
  throw new Error(`[qa] timeout esperando ${oQue}: status=${d?.status} phase=${d?.phase} error=${JSON.stringify(d?.error)} pieces=${JSON.stringify(d?.pieces?.map((p: any) => [p.code, p.status]))}`);
}

/** Upload + POST /iterate. Devolve o 202 e o id do lote. */
export async function iterarUpload(persona: Persona, path: string, offerId?: string): Promise<{ sub: Subida; res: Res; batchId: string | null }> {
  const sub = await subirArquivo(persona, path);
  if (sub.complete?.status !== 200) throw new Error(`[qa] upload ${basename(path)}: ${sub.complete?.status} ${JSON.stringify(sub.complete?.body)}`);
  const res = await call('POST', '/iterate', { body: { uploadId: sub.uploadId, ...(offerId ? { offerId } : {}) }, token: await tokenOf(persona) });
  return { sub, res, batchId: res.status === 202 ? res.data.id : null };
}

/** Lote em PLAN_READY a partir de um upload (o caminho completo da análise em mock). */
export async function lotePronto(persona: Persona, path: string, offerId?: string): Promise<any> {
  const { res, batchId } = await iterarUpload(persona, path, offerId);
  if (!batchId) throw new Error(`[qa] POST /iterate: ${res.status} ${JSON.stringify(res.body)}`);
  return ateLote(persona, batchId, (b) => b.status === 'PLAN_READY' || b.status === 'ANALYSIS_FAILED', { oQue: 'PLAN_READY' });
}

export const assentou = (b: any) => b.status === 'LAUNCHED' && b.phase === 'download';
export const ordemDosRenders = async (batchId: string) =>
  q<{ code: string; format: string; idx: number; created_at: string; started_at: string | null; finished_at: string | null; status: string; stale: boolean }>(
    `select vi.code, r.format, vi.index idx, r.created_at, r.started_at, r.finished_at, r.status, r.stale
       from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id
      where c.variation_batch_id = $1 order by r.created_at, r.id`, [batchId]);
