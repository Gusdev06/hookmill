// Helpers das sondas S1/S2 (§13.15). Chave do api/.env (nunca impressa). Saída em ./out.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ENV = readFileSync('/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/api/.env', 'utf8');
const env = (k) => (ENV.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
const KEY = env('WAVESPEED_API_KEY');
const BASE = 'https://api.wavespeed.ai/api/v3';
export const HERE = dirname(new URL(import.meta.url).pathname);
export const OUT = join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const H = { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

export function log(line) {
  console.log(line);
  appendFileSync(join(OUT, 'log.txt'), `${new Date().toISOString()} ${line}\n`);
}

export async function balance() {
  const r = await (await fetch(`${BASE}/balance`, { headers: H })).json();
  return r.data.balance;
}

export async function upload(path) {
  const bytes = readFileSync(path);
  const r = await (await fetch(`${BASE}/media/uploads`, { method: 'POST', headers: H, body: JSON.stringify({ filename: basename(path), size: bytes.byteLength }) })).json();
  const d = r.data;
  const put = await fetch(d.upload.url, { method: 'PUT', headers: d.upload.headers ?? {}, body: bytes });
  if (!put.ok) throw new Error(`PUT ${put.status}`);
  return d.download_url;
}

export async function run(model, body, { label, estUsd, maxMs = 15 * 60_000 } = {}) {
  log(`[${label}] ESTIMATIVA US$ ${estUsd.toFixed(3)} → ${model}`);
  const b0 = await balance();
  const res = await fetch(`${BASE}/${model}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok || (j.code && j.code !== 200)) throw new Error(`[${label}] submit ${res.status}: ${JSON.stringify(j).slice(0, 500)}`);
  const id = j.data.id;
  log(`[${label}] submetido ${id}`);
  const t0 = Date.now();
  let d = j.data;
  while (!['completed', 'failed'].includes(d.status)) {
    if (Date.now() - t0 > maxMs) throw new Error(`[${label}] timeout ${id}`);
    await new Promise((r) => setTimeout(r, 4000));
    d = (await (await fetch(`${BASE}/predictions/${id}/result`, { headers: H })).json()).data;
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  await new Promise((r) => setTimeout(r, 3000));
  const b1 = await balance();
  const spent = +(b0 - b1).toFixed(4);
  log(`[${label}] ${d.status} em ${secs}s · saldo ${b0.toFixed(4)} → ${b1.toFixed(4)} (Δ US$ ${spent}) · ${d.error || ''} ${JSON.stringify(d.outputs)}`);
  if (d.status !== 'completed') throw new Error(`[${label}] ${d.error}`);
  const rec = { label, model, id, secs: +secs, estUsd, balanceDeltaUsd: spent, outputs: d.outputs, at: new Date().toISOString() };
  appendFileSync(join(OUT, 'custos.jsonl'), JSON.stringify(rec) + '\n');
  return { ...rec, raw: d };
}

/** Baixa e valida decodificando inteiro (WaveSpeed trunca sem erro); 3 tentativas. */
export async function download(url, path) {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(url);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { stdio: 'pipe' });
      return path;
    } catch (e) {
      log(`download inválido (${i}/3) ${path}: ${String(e.stderr ?? e).slice(0, 200)}`);
    }
  }
  throw new Error(`download falhou 3x: ${url}`);
}

export function probe(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate,nb_frames', '-of', 'json', path]).toString());
}

export const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });

export async function whisper(path, label) {
  const url = await upload(path);
  const dur = +probe(path).format.duration;
  const r = await run('wavespeed-ai/openai-whisper-with-video', { video: url, language: 'en', task: 'transcribe', enable_timestamps: true }, { label: `whisper ${label}`, estUsd: Math.ceil(dur) * 0.002 });
  let src = r.outputs[0];
  if (typeof src === 'string' && /^https?:/.test(src)) src = await (await fetch(src)).text();
  writeFileSync(join(OUT, `whisper-${label}.json`), typeof src === 'string' ? src : JSON.stringify(src));
  return src;
}

// Higgsfield Soul V2 (rosto)
export async function soul(prompt, aspect, path) {
  const auth = { authorization: `Key ${env('HF_API_KEY_ID')}:${env('HF_API_KEY_SECRET')}`, 'content-type': 'application/json' };
  log(`[soul] ESTIMATIVA US$ 0.006 (${aspect})`);
  const r = await (await fetch('https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard', { method: 'POST', headers: { ...auth, 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ prompt, aspect_ratio: aspect, resolution: '1080p', batch_size: 1 }) })).json();
  let s;
  for (;;) {
    await new Promise((res) => setTimeout(res, 3000));
    s = await (await fetch(`https://api.higgsfield.ai/requests/${r.request_id}/status`, { headers: auth })).json();
    if (['completed', 'failed', 'nsfw', 'canceled'].includes(s.status)) break;
  }
  if (s.status !== 'completed') throw new Error(`soul ${s.status}`);
  log(`[soul] ok ${r.request_id} → ${s.images[0].url}`);
  const b = Buffer.from(await (await fetch(s.images[0].url)).arrayBuffer());
  writeFileSync(path, b);
  appendFileSync(join(OUT, 'custos.jsonl'), JSON.stringify({ label: 'soul', model: 'higgsfield-ai/soul/v2/standard', id: r.request_id, estUsd: 0.006, outputs: [s.images[0].url] }) + '\n');
  return s.images[0].url;
}
export { existsSync, statSync, join };
