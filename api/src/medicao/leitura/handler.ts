// Entrada da AWS Lambda `hookmill-leitura` (leitura-lambda-v1 §3). Empacotada por scripts/leitura-lambda.mjs (esbuild →
// imagem de contêiner com ffmpeg + onnxruntime-node + modelos). Roda as MESMAS etapas do adaptador local (etapas.ts).
// Nunca lança: erro vira { ok: false } (MediaInvalidError passa o reason; o resto o adaptador trata como infraestrutura).
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { FfmpegMediaAnalysisService } from '../media-analysis.service';
import { ler, medir, refinar, type Probe } from './etapas';
import type { EventoLeitura, PutRemoto, RespostaLeitura, TemposLeitura } from './contrato';

const RAIZ = process.env.LEITURA_TMP_DIR || '/tmp/leitura';
const bins = { ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', ffprobe: process.env.FFPROBE_PATH || 'ffprobe' };
const media = new FfmpegMediaAnalysisService(bins);
let fria = true;

/** Cache do contêiner quente: o vídeo (e o áudio extraído) da última análise. Um só, pra não encher o /tmp. */
let cache: { chave: string; dir: string; video: string; audio: Promise<string | null> | null } | null = null;

/** GET/PUT por node:http(s), sem fetch: o undici dentro do Jest (outro realm) falha em assert com Buffer/stream. */
function pedir(url: string, opts: { method: 'GET' | 'PUT'; headers?: Record<string, string | number>; body?: Buffer }): Promise<IncomingMessage> {
  return new Promise((ok, falha) => {
    const u = new URL(url);
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: opts.method, headers: opts.headers, timeout: 120_000 }, ok);
    req.on('timeout', () => req.destroy(new Error(`${opts.method} ${u.host}: timeout`)));
    req.on('error', falha);
    req.end(opts.body);
  });
}

async function corpoTexto(r: IncomingMessage): Promise<string> {
  let t = '';
  for await (const c of r) { if (t.length < 2000) t += c.toString(); }
  return t;
}

async function baixar(url: string, destino: string) {
  const r = await pedir(url, { method: 'GET' });
  if ((r.statusCode ?? 0) >= 300) throw new Error(`download do vídeo: HTTP ${r.statusCode} ${(await corpoTexto(r)).slice(0, 200)}`);
  await pipeline(r, createWriteStream(destino));
}

async function subir(put: PutRemoto, path: string): Promise<number> {
  const body = await readFile(path);
  const r = await pedir(put.url, { method: 'PUT', headers: { 'content-type': put.contentType, 'content-length': body.length }, body });
  const txt = await corpoTexto(r);
  if ((r.statusCode ?? 0) >= 300) throw new Error(`upload: HTTP ${r.statusCode} ${txt.slice(0, 200)}`);
  return body.length;
}

async function videoLocal(v: { url: string; cacheKey: string }): Promise<{ path: string; dir: string; hit: boolean }> {
  const chave = createHash('sha1').update(v.cacheKey).digest('hex').slice(0, 16);
  if (cache?.chave === chave && (await stat(cache.video).catch(() => null))) return { path: cache.video, dir: cache.dir, hit: true };
  await mkdir(RAIZ, { recursive: true });
  for (const d of await readdir(RAIZ)) await rm(join(RAIZ, d), { recursive: true, force: true });
  const dir = join(RAIZ, chave);
  await mkdir(dir, { recursive: true });
  const ext = v.cacheKey.match(/\.[a-z0-9]{2,4}$/i)?.[0] ?? '.mp4';
  const path = join(dir, `video${ext}`);
  await baixar(v.url, path);
  cache = { chave, dir, video: path, audio: null };
  return { path, dir, hit: false };
}

function audioDoCache(video: string, dir: string, probe: Probe): Promise<string | null> {
  if (!probe.hasAudio) return Promise.resolve(null);
  if (cache && cache.video === video && cache.audio) return cache.audio;
  const p = media.extractAudio(video, join(dir, 'audio.m4a')).then(() => join(dir, 'audio.m4a'));
  if (cache && cache.video === video) cache.audio = p;
  p.catch(() => { if (cache) cache.audio = null; });
  return p;
}

export async function handler(evento: EventoLeitura): Promise<RespostaLeitura> {
  const t0 = Date.now();
  const eraFria = fria;
  fria = false;
  const avisos: string[] = [];
  const trabalho = join(RAIZ, `job-${randomUUID()}`);
  try {
    if (!evento || evento.v !== 1) throw new Error(`evento sem versão suportada (v=${(evento as { v?: unknown })?.v})`);
    const v = await videoLocal(evento.video);
    const downloadMs = Date.now() - t0;
    await mkdir(trabalho, { recursive: true });
    const t1 = Date.now();
    let uploadMs = 0;
    const tempos = (etapaFim: number): TemposLeitura => ({ totalMs: Date.now() - t0, downloadMs, etapaMs: etapaFim - t1, uploadMs, fria: eraFria, cacheVideo: v.hit });

    if (evento.op === 'ler') {
      const r = await ler(media, v.path, v.dir, !!evento.audioPut);
      if (r.audio && cache?.video === v.path) cache.audio = Promise.resolve(r.audio.path);
      const fim = Date.now();
      let audio: { durationSec: number; sizeBytes: number } | null = null;
      if (r.audio && evento.audioPut) {
        const u = Date.now();
        audio = { durationSec: r.audio.durationSec, sizeBytes: await subir(evento.audioPut, r.audio.path) };
        uploadMs = Date.now() - u;
      }
      return { ok: true, op: 'ler', resultado: { probe: r.probe, audio }, tempos: tempos(fim), avisos };
    }

    if (evento.op === 'medir') {
      const audioPath = evento.medir ? await audioDoCache(v.path, v.dir, evento.probe) : null;
      const r = await medir(media, bins.ffmpeg, v.path, trabalho, {
        probe: evento.probe, audioPath, medir: evento.medir, segmentos: evento.segmentos, mapear: evento.mapear,
      }, (m) => avisos.push(m));
      const fim = Date.now();
      const u = Date.now();
      const keyframes = r.medidas
        ? await Promise.all(r.medidas.keyframes.map(async ({ path, ...k }, slot) => {
          const put = evento.framePuts[slot];
          if (!put) throw new Error(`sem PUT pro frame-chave ${slot}`);
          return { ...k, slot, sizeBytes: await subir(put, path) };
        }))
        : [];
      const recortes = await Promise.all(r.recortes.map(async ({ path, ...c }, slot) => {
        const put = evento.cropPuts[slot];
        if (!put) throw new Error(`sem PUT pro recorte ${slot}`);
        return { ...c, slot, sizeBytes: await subir(put, path) };
      }));
      uploadMs = Date.now() - u;
      return {
        ok: true, op: 'medir',
        resultado: { medidas: r.medidas ? { ...r.medidas, keyframes } : null, trilha: r.trilha, recortes },
        tempos: tempos(fim), avisos,
      };
    }

    if (evento.op === 'refinar') {
      const layers = await refinar(media, v.path, evento.entrada, (m) => avisos.push(m));
      return { ok: true, op: 'refinar', resultado: { layers }, tempos: tempos(Date.now()), avisos };
    }
    throw new Error(`op desconhecida: ${(evento as { op?: unknown }).op}`);
  } catch (e) {
    const err = e as Error & { reason?: string };
    return { ok: false, erro: { name: err.name || 'Error', message: String(err.message ?? e).slice(0, 2000), reason: err.reason } };
  } finally {
    await rm(trabalho, { recursive: true, force: true }).catch(() => undefined);
  }
}
