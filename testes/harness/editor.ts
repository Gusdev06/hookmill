// Harness do editor no vídeo v1 (docs/contratos/editor-v1.md, F2d). Dono: maquina-qa.
// - fábrica: criativo do zero editável (cenas com falas e palavras de verdade, duração no arquivo, take fatiado opcional),
//   com MP4 de verdade no bucket de teste quando o Player ou o render real precisam tocar a mídia (mock-media da API de teste)
// - cliente do editor (GET/PUT), leitura do banco, SSE, render e comparação com o resolverProps do @maquina/video
// Só setup de teste: a API muda estado pela máquina dela; aqui só se fabrica o ponto de partida.
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { aguardar, as, expectOk, tokenOf } from './api.ts';
import { PERSONAS, WS, q, type Persona } from './db.ts';
import { ENV } from './env.ts';
import { criarCriativoNoEstado, type CreativeState, type CriativoFabricado } from './fabrica.ts';

const require = createRequire(import.meta.url);
type WsKey = keyof typeof WS;
const id = (p: string) => `qa_${p}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ───────────── tipos mínimos (o pacote @maquina/contratos é só tipos; aqui basta a forma) ─────────────
export interface Palavra { word: string; startSec: number; endSec: number }
export interface EditClip { sceneId: string; enabled: boolean; attempt: number; inSec: number; outSec: number }
export interface EditDocLayer { id: string; visible?: boolean; transform?: any; timing?: { fromSec: number; durationSec: number } | null; text?: string; style?: any }
export interface EditDoc { version: 1; clips: EditClip[]; trim: { inFrame: number; outFrame: number } | null; layers: EditDocLayer[]; captionWords: { key: string; text: string }[] }
export interface EditSettings { templateId: string; captionStyle: 'word' | 'line' | 'off'; captionPosition: 'top' | 'middle' | 'bottom'; headline: string | null; ctaText: string; endCard: boolean }

/** Lib do video (dist/lib, a mesma que a API carrega). O Player usa video/src (via Next); ED-C-WYS-00 confere que batem. */
export const videoLib = (): any => require('@maquina/video');

export const doc = (p: Partial<EditDoc> = {}): EditDoc => ({ version: 1, clips: [], trim: null, layers: [], captionWords: [], ...p });

// ───────────── cenas ─────────────
export interface CenaSpec { label: string; durSec: number; speech: string; /** o que a transcrição "ouviu" (palavra diferente do roteiro = suspeita na UI) */ heard?: string }
export const CENAS: CenaSpec[] = [
  { label: 'hook', durSec: 3, speech: 'Stop scrolling right now.' },
  { label: 'problem', durSec: 4, speech: 'You pay for apps you forgot about.' },
  { label: 'product', durSec: 5, speech: 'This app finds every subscription in seconds.', heard: 'This app finds every subscripshun in seconds.' },
  { label: 'cta', durSec: 3, speech: 'Tap the link and start today.' },
];
/** Palavras espalhadas na cena, relativas ao início dela (0,2 s de respiro no começo, 0,3 s no fim). */
export function palavrasDe(texto: string, durSec: number): Palavra[] {
  const ws = texto.split(/\s+/).filter(Boolean);
  const a = 0.2;
  const step = (durSec - 0.3 - a) / ws.length;
  return ws.map((word, i) => ({ word, startSec: r3(a + i * step), endSec: r3(a + i * step + step * 0.85) }));
}

export const SETTINGS: EditSettings = { templateId: 'headline', captionStyle: 'word', captionPosition: 'bottom', headline: 'Stop wasting money', ctaText: 'Start free today', endCard: true };

// ───────────── bucket de teste (S3 local) ─────────────
let s3c: any = null;
function s3() {
  if (s3c) return s3c;
  const { S3Client } = require('@aws-sdk/client-s3');
  s3c = new S3Client({ endpoint: 'http://localhost:9000', region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: 'maquina', secretAccessKey: 'maquina-dev-secret' } });
  return s3c;
}
export async function subirObjeto(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!ENV.storageBucket.endsWith('-test')) throw new Error('[qa] bucket não é de teste');
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  await s3().send(new PutObjectCommand({ Bucket: ENV.storageBucket, Key: key, Body: body, ContentType: contentType }));
}
/** O web de teste roda em outra origem (3210): sem ela no CORS do bucket de TESTE, o Player não busca a mídia com fetch.
 *  Só acrescenta (nunca tira) e só no bucket de teste. O `infra:cors` do arquiteto só põe a 3000 (anotado no relatório). */
export async function garantirCorsDoBucketDeTeste(origin: string): Promise<'ja-tinha' | 'acrescentou'> {
  if (!ENV.storageBucket.endsWith('-test')) throw new Error('[qa] bucket não é de teste');
  const { GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');
  let rules: any[] = [];
  try {
    rules = (await s3().send(new GetBucketCorsCommand({ Bucket: ENV.storageBucket }))).CORSRules ?? [];
  } catch { /* sem CORS ainda */ }
  if (rules.some((r) => (r.AllowedOrigins ?? []).includes(origin))) return 'ja-tinha';
  const base = rules[0] ?? { AllowedMethods: ['GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type', 'ETag'], MaxAgeSeconds: 3600, AllowedOrigins: [] };
  const next = [{ ...base, AllowedOrigins: [...new Set([...(base.AllowedOrigins ?? []), origin])] }, ...rules.slice(1)];
  await s3().send(new PutBucketCorsCommand({ Bucket: ENV.storageBucket, CORSConfiguration: { CORSRules: next } }));
  return 'acrescentou';
}
/** MP4 de verdade do mock (testsrc2 + seno, 360x640, 30 fps) servido pela API de teste: grátis, determinístico. */
export async function clipeMock(semente: string, sec: number): Promise<Buffer> {
  const seed = createHash('sha256').update(semente).digest('hex').slice(0, 16);
  const r = await fetch(`${ENV.apiUrl}/mock-media/video/${seed}.mp4?format=VERTICAL_9_16&sec=${sec}`);
  if (!r.ok) throw new Error(`[qa] mock-media ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ───────────── fábrica ─────────────
export interface OpcoesEditor {
  state?: CreativeState;
  settings?: Partial<EditSettings>;
  cenas?: CenaSpec[];
  /** LIPSYNC: um take só, fatiado em TAKE_SLICE (as fatias usam o MESMO clipe; a última vai até o fim do arquivo) */
  take?: boolean;
  /** sobe MP4 de verdade pro bucket de teste (Player e render real tocam a mídia) */
  clipesReais?: boolean;
  /** doc do render READY da fábrica (selo "editado") */
  renderDoc?: EditDoc | null;
  editDoc?: EditDoc | null;
}
export interface CenaFabricada { sceneId: string; index: number; attempt: number; durSec: number; words: Palavra[]; clipFileId: string; speech: string; label: string }
export interface CriativoEditor extends CriativoFabricado { cenas: CenaFabricada[]; settings: EditSettings; takeId: string | null }

const COM_CENAS: CreativeState[] = ['SCENES_GENERATING', 'SCENES_FAILED', 'EDIT_PENDING', 'RENDERING', 'RENDER_FAILED', 'RENDER_READY', 'APPROVED'];

/**
 * Criativo do zero pronto pro editor (padrão RENDER_READY, template headline, 4 cenas de 3/4/5/3 s com falas e palavras).
 * A partir de SCENES_GENERATING já nasce com `edit_settings` (= Generate novo / cena regerando depois de editar, o caso em
 * que o editor poderia estar aberto).
 */
export async function criarCriativoEditor(ws: WsKey, o: OpcoesEditor = {}): Promise<CriativoEditor> {
  const state = o.state ?? 'RENDER_READY';
  const base = await criarCriativoNoEstado(ws, state);
  const settings: EditSettings = { ...SETTINGS, ...o.settings };
  const specs = o.cenas ?? CENAS;
  if (specs.length < 1 || specs.length > 4) throw new Error('[qa] 1..4 cenas');
  const out: CriativoEditor = { ...base, cenas: [], settings, takeId: null };
  if (!COM_CENAS.includes(state)) return out;

  await q(`update creatives set edit_settings = $2::jsonb, edit_doc = $3::jsonb, edit_revision = 0 where id = $1`, [
    base.id, JSON.stringify(settings), o.editDoc ? JSON.stringify(o.editDoc) : null,
  ]);
  const scenes = await q<{ id: string; index: number; status: string; clip_file_id: string | null }>(
    `select id, index, status, clip_file_id from scenes where creative_id = $1 order by index`, [base.id]);
  // sobra de cena (fábrica cria 4): sai com o clipe
  for (const s of scenes.slice(specs.length)) {
    await q('delete from scenes where id = $1', [s.id]);
    if (s.clip_file_id) await q('delete from files where id = $1', [s.clip_file_id]);
  }
  let t = 0;
  const total = specs.reduce((a, s) => a + s.durSec, 0);
  // take: um arquivo só pras fatias
  let takeFile: { id: string; key: string } | null = null;
  if (o.take) {
    const fid = id('file');
    const key = `ws/${WS[ws]}/take_clip/${fid}.mp4`;
    await q(`insert into files (id, workspace_id, kind, storage_key, mime_type, size_bytes, duration_sec, width, height) values ($1,$2,'SCENE_CLIP',$3,'video/mp4',1024,$4,360,640)`, [fid, WS[ws], key, total]);
    takeFile = { id: fid, key };
    const tid = id('take');
    const allWords = specs.flatMap((s, i) => {
      const off = specs.slice(0, i).reduce((a, x) => a + x.durSec, 0);
      return palavrasDe(s.heard ?? s.speech, s.durSec).map((w) => ({ word: w.word, startSec: r3(w.startSec + off), endSec: r3(w.endSec + off) }));
    });
    await q(
      `insert into takes (id, workspace_id, creative_id, generation, kind, status, progress, attempt, speech, duration_sec, clip_file_id, words, updated_at)
       values ($1,$2,$3,1,'TTS_LIPSYNC','READY',100,1,$4,$5,$6,$7::jsonb,now())`,
      [tid, WS[ws], base.id, specs.map((s) => s.speech).join(' '), total, fid, JSON.stringify(allWords)],
    );
    await q(`update creatives set engine = 'LIPSYNC' where id = $1`, [base.id]);
    out.takeId = tid;
  }
  for (const [i, spec] of specs.entries()) {
    const s = scenes[i];
    const words = palavrasDe(spec.heard ?? spec.speech, spec.durSec);
    const ready = s.status === 'READY';
    if (o.take && takeFile) {
      await q(
        `update scenes set label = $2, start_sec = $3, end_sec = $4, speech = $5, words = $6::jsonb, pipeline = 'TAKE_SLICE', take_id = $7,
                take_start_sec = $3, take_end_sec = $4, clip_file_id = $8 where id = $1`,
        [s.id, spec.label, t, t + spec.durSec, spec.speech, ready ? JSON.stringify(words) : null, out.takeId, ready ? takeFile.id : null],
      );
      if (s.clip_file_id) await q('delete from files where id = $1 and not exists (select 1 from scenes where clip_file_id = $1)', [s.clip_file_id]);
    } else {
      await q(
        `update scenes set label = $2, start_sec = $3, end_sec = $4, speech = $5, words = $6::jsonb, pipeline = 'SCENE_VIDEO' where id = $1`,
        [s.id, spec.label, t, t + spec.durSec, spec.speech, ready ? JSON.stringify(words) : null],
      );
      if (s.clip_file_id) await q('update files set duration_sec = $2, width = 360, height = 640 where id = $1', [s.clip_file_id, spec.durSec]);
    }
    out.cenas.push({ sceneId: s.id, index: i, attempt: 1, durSec: spec.durSec, words: ready ? words : [], clipFileId: (o.take ? takeFile?.id : s.clip_file_id) ?? '', speech: spec.speech, label: spec.label });
    t += spec.durSec;
  }
  out.sceneIds = out.cenas.map((c) => c.sceneId);

  // render READY da fábrica = "exportado na revisão 0", com os mesmos ajustes do criativo. created_at em UTC e no passado:
  // o Postgres local roda em Asia/Makassar (now() sem fuso = UTC+8) e o Prisma grava UTC; sem isto o render da fábrica
  // ficaria "8 h no futuro" e seria sempre o latestRender/previewRender da API.
  await q(
    `update renders set settings = $2::jsonb, edit_revision = 0, doc = $3::jsonb, total_frames = $4,
            created_at = (now() at time zone 'utc') - interval '10 minutes',
            started_at = (now() at time zone 'utc') - interval '10 minutes', finished_at = (now() at time zone 'utc') - interval '9 minutes'
      where creative_id = $1`,
    [base.id, JSON.stringify(settings), o.renderDoc ? JSON.stringify(o.renderDoc) : null, Math.round((total + (settings.endCard ? 2.5 : 0)) * 30)],
  );
  await q(`update creatives set created_at = (now() at time zone 'utc') - interval '10 minutes', updated_at = (now() at time zone 'utc') - interval '9 minutes',
           state_changed_at = (now() at time zone 'utc') - interval '9 minutes' where id = $1`, [base.id]);

  if (o.clipesReais) {
    if (takeFile) await subirObjeto(takeFile.key, await clipeMock(takeFile.key, total), 'video/mp4');
    else {
      for (const c of out.cenas) {
        const [f] = await q<{ storage_key: string }>('select storage_key from files where id = $1', [c.clipFileId]);
        if (f) await subirObjeto(f.storage_key, await clipeMock(f.storage_key, c.durSec), 'video/mp4');
      }
    }
    // vídeo do render (a Edição e o OK final tocam) e as miniaturas dos rostos
    for (const f of await q<{ storage_key: string; kind: string }>(
      `select f.storage_key, f.kind from files f where f.workspace_id = $1 and f.id in (select file_id from renders where creative_id = $2)`, [WS[ws], base.id])) {
      await subirObjeto(f.storage_key, await clipeMock(f.storage_key, Math.min(30, total)), 'video/mp4');
    }
  }
  return out;
}

/** Remix-keep (F3): só pra provar a trava (422/editorAvailable false/entrada travada). */
export async function criarRemixKeep(ws: WsKey, state: CreativeState = 'RENDER_READY'): Promise<CriativoEditor> {
  const c = await criarCriativoEditor(ws, { state });
  await q(`update creatives set edit_settings = $2::jsonb where id = $1`, [
    c.id, JSON.stringify({ templateId: 'remix-keep', captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: '', endCard: false }),
  ]);
  return c;
}

// ───────────── cliente ─────────────
export const getEditor = (p: Persona, cid: string) => as(p).get(`/creatives/${cid}/editor`);
export const putEditor = (p: Persona, cid: string, body: unknown) => as(p).put(`/creatives/${cid}/editor`, body);
export async function salvar(p: Persona, cid: string, d: EditDoc | null, settings?: Partial<EditSettings>): Promise<any> {
  const st = expectOk(await getEditor(p, cid));
  return expectOk(await putEditor(p, cid, { baseRevision: st.revision, doc: d, ...(settings ? { settings } : {}) }));
}

export interface LinhaCriativo { state: CreativeState; edit_doc: EditDoc | null; edit_revision: number; edit_dirty: boolean; edit_settings: EditSettings; updated_at: string }
export async function linha(cid: string): Promise<LinhaCriativo> {
  const [r] = await q<LinhaCriativo>('select state, edit_doc, edit_revision, edit_dirty, edit_settings, updated_at from creatives where id = $1', [cid]);
  return r;
}

export async function ultimoRender(cid: string): Promise<any> {
  const [r] = await q('select * from renders where creative_id = $1 order by created_at desc limit 1', [cid]);
  return r;
}
/** Espera o último render do criativo sair da fila (READY/FAILED) e o criativo sair de RENDERING. */
export async function esperarRender(cid: string, timeoutMs = 120_000): Promise<any> {
  await aguardar(async () => (await q<{ state: string }>('select state from creatives where id = $1', [cid]))[0]?.state, (s) => s !== 'RENDERING', { timeoutMs, intervalMs: 300, oQue: `render de ${cid}` });
  return ultimoRender(cid);
}

// ───────────── SSE ─────────────
export interface Evento { event: string; data: any }
/** Abre o SSE do criativo e coleta eventos até `parar` (ou o tempo). Devolve também o status do GET. */
export async function ouvirSse(p: Persona, cid: string, acao: () => Promise<unknown>, parar: (evs: Evento[]) => boolean, timeoutMs = 10_000): Promise<{ status: number; eventos: Evento[] }> {
  const ctrl = new AbortController();
  const r = await fetch(`${ENV.apiUrl}/creatives/${cid}/events`, { headers: { authorization: `Bearer ${await tokenOf(p)}` }, signal: ctrl.signal });
  const eventos: Evento[] = [];
  if (r.status !== 200 || !r.body) {
    ctrl.abort();
    return { status: r.status, eventos };
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  // espera o snapshot antes da ação (assim o evento da ação não se perde)
  const lerAte = async (ok: () => boolean, ate: number) => {
    while (!ok() && Date.now() < ate) {
      const res = await Promise.race([reader.read(), new Promise<null>((res) => setTimeout(() => res(null), Math.max(1, ate - Date.now())))]);
      if (!res || res.done) break;
      buf += dec.decode(res.value);
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const bloco = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(bloco)?.[1];
        const dataLines = bloco.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        if (ev) {
          let data: any = dataLines;
          try { data = JSON.parse(dataLines); } catch { /* texto */ }
          eventos.push({ event: ev, data });
        }
      }
    }
  };
  const fim = Date.now() + timeoutMs;
  await lerAte(() => eventos.some((e) => e.event === 'snapshot'), Math.min(fim, Date.now() + 5000));
  await acao();
  await lerAte(() => parar(eventos), fim);
  ctrl.abort();
  return { status: 200, eventos };
}

// ───────────── comparação do render com o resolverProps ─────────────
/** Tira a query (assinatura, validade) das URLs: o render e o GET assinam em momentos diferentes. E arredonda os números
 *  em 1e-6: o `renders.input` passa pelo motor do Prisma (Json), que relê o float com 1 ULP de diferença
 *  (1.6749999999999998 → 1.675). O render usa o input em memória; a cópia gravada é só pra reproduzir. */
export function semAssinatura<T>(x: T): T {
  return JSON.parse(JSON.stringify(x), (_k, v) =>
    typeof v === 'string' && /^https?:\/\//.test(v) ? v.split('?')[0] : typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v);
}

/** Uma cena do RenderInput por id de arquivo (a URL assinada traz a chave ws/<ws>/<kind>/<fileId>.mp4). */
export const chaveDaUrl = (url: string) => decodeURIComponent(new URL(url).pathname).replace(/^\/[^/]+\//, '');

export const PERSONA_NOME = (p: Persona) => PERSONAS[p].name;
