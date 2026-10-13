// Detecção de rosto por frame (§13.1 item 2): YuNet 2023mar (OpenCV Zoo, MIT) via onnxruntime-node, sem OpenCV.
// O modelo tem entrada fixa 1x3x640x640 (BGR, 0-255, sem normalizar): o ffmpeg já entrega cada amostra reduzida e
// com borda preta à direita/embaixo (letterbox), então a volta pra px do vídeo é só dividir pela escala.
// Decodificação e NMS iguais ao FaceDetectorYN do OpenCV (face_detect.cpp): score = sqrt(cls * obj).
// Regra da casa: escolher rosto por SCORE, nunca por área (área pega falso rosto em planta). Limiar padrão 0,8.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Rect } from '@maquina/contratos';
import { streamFramesAsync, type Bins } from './ffmpeg';

export const YUNET_SIZE = 640;
export const YUNET_MODEL = path.join(__dirname, 'modelos', 'face_detection_yunet_2023mar.onnx');

/** kps = 5 pontos do YuNet (olho dir., olho esq., nariz, boca dir., boca esq.: x,y); emb = identidade SFace (128, norma 1). */
export interface Face { box: Rect; score: number; kps?: number[]; emb?: number[] }
export interface FaceSample { frame: number; atSec: number; faces: Face[] }

/**
 * O YuNet roda num worker_thread: (1) a inferência (~15 ms por amostra) não trava o event loop da API; (2) o
 * onnxruntime-node devolve Float32Array do realm do Node e quebra dentro do Jest (vm própria) — no worker não há isso.
 * O worker é código em string (eval) pra não depender de copiar .js pro dist; só faz session.run e devolve as saídas.
 */
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const ort = require(workerData.ort);
let s = null, sf = null;
// sem spin: com a máquina ocupada (outros renders/ffmpeg) o spin-wait do onnxruntime queimava ~5x a CPU da inferência
const opts = { intraOpNumThreads: workerData.threads, interOpNumThreads: 1, logSeverityLevel: 3,
  extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } } };
parentPort.on('message', async (m) => {
  if (m.close) { try { if (s) await s.release(); if (sf) await sf.release(); } catch (e) {} s = null; sf = null; parentPort.close(); return; }
  try {
    let res;
    if (m.sface) {
      if (!sf) sf = await ort.InferenceSession.create(workerData.sface, opts);
      res = await sf.run({ data: new ort.Tensor('float32', new Float32Array(m.chw), [1, 3, 112, 112]) });
    } else {
      if (!s) s = await ort.InferenceSession.create(workerData.model, opts);
      res = await s.run({ input: new ort.Tensor('float32', new Float32Array(m.chw), [1, 3, ${YUNET_SIZE}, ${YUNET_SIZE}]) });
    }
    const out = {};
    const bufs = [];
    for (const k of Object.keys(res)) { const d = Float32Array.from(res[k].data); out[k] = d; bufs.push(d.buffer); }
    parentPort.postMessage({ id: m.id, out }, bufs);
  } catch (e) { parentPort.postMessage({ id: m.id, error: String(e && e.message || e) }); }
});`;

/** SFace (OpenCV Zoo, Apache-2.0, 37 MB): SFACE_MODEL_PATH, ao lado deste arquivo ou em src/. null = sem identidade
 *  (a trilha cai pra posição/tamanho). Baixar: modelos/baixar.sh (sha256 conferido). */
export function sfaceModelPath(): string | null {
  const nome = 'face_recognition_sface_2021dec.onnx';
  const cands = [process.env.SFACE_MODEL_PATH, path.join(__dirname, 'modelos', nome), path.resolve(__dirname, '..', '..', 'src', 'medicao', 'modelos', nome)];
  return cands.find((c) => c && existsSync(c)) ?? null;
}

/** Caminho do modelo: YUNET_MODEL_PATH, ao lado deste arquivo, ou em src/ (dist sem os assets copiados). */
export function yunetModelPath(): string {
  const cands = [process.env.YUNET_MODEL_PATH, YUNET_MODEL, path.resolve(__dirname, '..', '..', 'src', 'medicao', 'modelos', 'face_detection_yunet_2023mar.onnx')];
  const f = cands.find((c) => c && existsSync(c));
  if (!f) throw new Error(`modelo YuNet não encontrado (${cands.filter(Boolean).join(', ')})`);
  return f;
}

let worker: Worker | null = null;
let seq = 0;
const pend = new Map<number, { ok: (o: Record<string, Float32Array>) => void; err: (e: Error) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(WORKER, { eval: true, workerData: { ort: require.resolve('onnxruntime-node'), model: yunetModelPath(), sface: sfaceModelPath(), threads: Number(process.env.MEDICAO_ONNX_THREADS) || 2 } });
  w.on('message', (m: { id: number; out?: Record<string, Float32Array>; error?: string }) => {
    const p = pend.get(m.id);
    if (!p) return;
    pend.delete(m.id);
    if (m.error) p.err(new Error(`YuNet: ${m.error}`)); else p.ok(m.out!);
  });
  w.on('error', (e) => { for (const p of pend.values()) p.err(e); pend.clear(); worker = null; });
  w.on('exit', () => { worker = null; });
  w.unref();   // não segura o processo (Jest/scripts terminam sozinhos)
  worker = w;
  return w;
}

/** Desliga o worker (fim de teste/script). Ele religa sozinho na próxima detecção. */
export async function closeFaceDetector(): Promise<void> {
  const w = worker;
  worker = null;
  if (!w) return;
  // solta a sessão dentro do worker e deixa ele sair sozinho: terminate() no meio do onnxruntime aborta o processo
  // (libc++abi recursive_mutex) na saída
  const saiu = new Promise<void>((ok) => w.once('exit', () => ok()));
  w.ref();
  w.postMessage({ close: true });
  await Promise.race([saiu, new Promise<void>((ok) => setTimeout(ok, 5000).unref())]);
}

function iou(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - inter;
  return u > 0 ? inter / u : 0;
}

/** Saídas cruas do YuNet → rostos em px da entrada 640x640, score ≥ minScore, NMS 0,3, maior score primeiro. */
export function decodeYunet(out: Record<string, Float32Array>, minScore: number, nmsIou = 0.3): Face[] {
  const cand: Face[] = [];
  for (const stride of [8, 16, 32]) {
    const cols = YUNET_SIZE / stride, rows = YUNET_SIZE / stride;
    const cls = out[`cls_${stride}`], obj = out[`obj_${stride}`], bb = out[`bbox_${stride}`], kp = out[`kps_${stride}`];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const cs = Math.min(1, Math.max(0, cls[i])), os = Math.min(1, Math.max(0, obj[i]));
        const score = Math.sqrt(cs * os);
        if (score < minScore) continue;
        const cx = (c + bb[i * 4]) * stride, cy = (r + bb[i * 4 + 1]) * stride;
        const w = Math.exp(bb[i * 4 + 2]) * stride, h = Math.exp(bb[i * 4 + 3]) * stride;
        const kps = kp ? Array.from({ length: 10 }, (_, j) => (kp[i * 10 + j] + (j % 2 ? r : c)) * stride) : undefined;
        cand.push({ box: { x: cx - w / 2, y: cy - h / 2, w, h }, score, kps });
      }
    }
  }
  cand.sort((a, b) => b.score - a.score);
  const keep: Face[] = [];
  for (const f of cand) if (!keep.some((k) => iou(k.box, f.box) > nmsIou)) keep.push(f);
  return keep;
}

/** Molde ArcFace 112x112 (o mesmo do alignCrop do OpenCV) pros 5 pontos do YuNet, na mesma ordem. */
const MOLDE = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041];

/** Alinha o rosto (semelhança por mínimos quadrados dos 5 pontos → molde) e devolve o tensor RGB 3x112x112 (0-255). */
export function alignFace(bgr: Uint8Array, w: number, h: number, kps: number[]): Float32Array {
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let j = 0; j < 5; j++) { sx += kps[2 * j]; sy += kps[2 * j + 1]; dx += MOLDE[2 * j]; dy += MOLDE[2 * j + 1]; }
  sx /= 5; sy /= 5; dx /= 5; dy /= 5;
  let num1 = 0, num2 = 0, den = 0;
  for (let j = 0; j < 5; j++) {
    const ax = kps[2 * j] - sx, ay = kps[2 * j + 1] - sy, bx = MOLDE[2 * j] - dx, by = MOLDE[2 * j + 1] - dy;
    num1 += ax * bx + ay * by; num2 += ax * by - ay * bx; den += ax * ax + ay * ay;
  }
  const a = num1 / den, b = num2 / den, n2 = a * a + b * b;
  const out = new Float32Array(3 * 112 * 112);
  for (let v = 0; v < 112; v++) for (let u = 0; u < 112; u++) {
    // destino → origem: s = R^-1 (d - md) + ms
    const qx = u - dx, qy = v - dy;
    const x = (a * qx + b * qy) / n2 + sx, y = (-b * qx + a * qy) / n2 + sy;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    for (let c = 0; c < 3; c++) {
      const get = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : bgr[(yy * w + xx) * 3 + c]);
      const val = (1 - fy) * ((1 - fx) * get(x0, y0) + fx * get(x0 + 1, y0)) + fy * ((1 - fx) * get(x0, y0 + 1) + fx * get(x0 + 1, y0 + 1));
      out[(2 - c) * 112 * 112 + v * 112 + u] = val;   // BGR → RGB (swapRB do blobFromImage)
    }
  }
  return out;
}

function rodar(msg: { chw: Float32Array; sface?: boolean }): Promise<Record<string, Float32Array>> {
  const w = getWorker();
  const id = ++seq;
  if (!pend.size) w.ref();
  return new Promise<Record<string, Float32Array>>((ok, err) => {
    pend.set(id, { ok, err });
    w.postMessage({ id, chw: msg.chw.buffer, sface: !!msg.sface }, [msg.chw.buffer as ArrayBuffer]);
  }).finally(() => { if (!pend.size) w.unref(); });
}

/** Identidade do rosto (SFace, 128 dims, norma 1); null sem modelo. Comparar por produto interno (cosseno). */
export async function faceEmbedding(bgr: Uint8Array, w: number, h: number, kps: number[]): Promise<number[] | null> {
  if (!sfaceModelPath()) return null;
  const out = await rodar({ chw: alignFace(bgr, w, h, kps), sface: true });
  const v = Array.from(out.fc1 ?? Object.values(out)[0]);
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

export const cosine = (a: number[], b: number[]) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] * b[i]; return t; };

/** Roda o YuNet num quadro 640x640 bgr24 (HWC) já com letterbox. */
export async function detectBgr640(bgr: Uint8Array, minScore: number): Promise<Face[]> {
  const N = YUNET_SIZE * YUNET_SIZE;
  const chw = new Float32Array(3 * N);
  for (let p = 0, o = 0; p < N; p++, o += 3) { chw[p] = bgr[o]; chw[N + p] = bgr[o + 1]; chw[2 * N + p] = bgr[o + 2]; }
  const out = await rodar({ chw });
  return decodeYunet(out, minScore);
}

export interface DetectOptions {
  /** amostras por segundo (padrão 5); 0 = todos os frames */
  sampleFps?: number;
  minScore?: number;
  /** recorte (px do vídeo) a analisar; padrão = quadro inteiro. Rosto pequeno numa caixa: recortar aumenta a resolução. */
  crop?: Rect;
  /** identidade (SFace) dos rostos com score ≥ embedMin (padrão 0,8). 'sparse' = só no 1º rosto de cada corrida contínua
   *  (mesma caixa e mesma cor média de uma amostra pra outra); o resto da corrida herda. true = todas. */
  embed?: boolean | 'sparse';
  embedMin?: number;
  /** só amostras dentro destes intervalos [início, fim) de frame (o resto nem passa pelo YuNet) */
  frames?: [number, number][];
}

function iouBox(a: Rect, b: Rect) { return iou(a, b); }
/** Mesma caixa (contínua) entre amostras vizinhas: IoU > 0,5 e altura ±15 %. */
const contínua = (a: Rect, b: Rect) => iouBox(a, b) > 0.5 && Math.abs(a.h - b.h) / Math.max(a.h, b.h) < 0.15;

/**
 * Rostos por amostra. Amostras em número de frame exato (select por índice, não fps=, que escolhe outro frame).
 * Imagem = 1 amostra (frame 0). Caixas em px do vídeo inteiro (o recorte é somado de volta).
 */
export async function detectFaces(bins: Bins, file: string, info: { w: number; h: number; fps: number }, opt: DetectOptions = {}):
  Promise<FaceSample[]> {
  const minScore = opt.minScore ?? 0.8;
  const crop = opt.crop ?? { x: 0, y: 0, w: info.w, h: info.h };
  const scale = YUNET_SIZE / Math.max(crop.w, crop.h);
  const sw = Math.max(2, Math.round(crop.w * scale)), sh = Math.max(2, Math.round(crop.h * scale));
  const every = opt.sampleFps && info.fps ? Math.max(1, Math.round(info.fps / opt.sampleFps)) : 1;
  const vf = [
    every > 1 ? `select='not(mod(n\\,${every}))'` : null,
    crop.w !== info.w || crop.h !== info.h ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null,
    `scale=${sw}:${sh}:flags=area`,
    `pad=${YUNET_SIZE}:${YUNET_SIZE}:0:0:black`,
  ].filter(Boolean).join(',');
  const out: FaceSample[] = [];
  const dentro = (frame: number) => !opt.frames || opt.frames.some(([a, b]) => frame >= a && frame < b);
  let anteriores: { box: Rect; cor: number[]; emb?: number[] }[] = [];
  const corMedia = (buf: Buffer, b: Rect) => {
    const x0 = Math.max(0, Math.floor(b.x)), y0 = Math.max(0, Math.floor(b.y));
    const x1 = Math.min(YUNET_SIZE, Math.ceil(b.x + b.w)), y1 = Math.min(YUNET_SIZE, Math.ceil(b.y + b.h));
    const t = [0, 0, 0]; let n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const o = (y * YUNET_SIZE + x) * 3; t[0] += buf[o]; t[1] += buf[o + 1]; t[2] += buf[o + 2]; n++; }
    return n ? t.map((v) => v / n) : t;
  };
  await streamFramesAsync(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-an', '-vf', vf,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], YUNET_SIZE * YUNET_SIZE * 3, async (buf, i) => {
    const frame = i * every;
    if (!dentro(frame)) return;
    const faces = await detectBgr640(buf, minScore);
    const res: Face[] = [];
    const atuais: { box: Rect; cor: number[]; emb?: number[] }[] = faces.map((f) => ({ box: f.box, cor: corMedia(buf, f.box) }));
    for (const [fi, f] of faces.entries()) {
      // corrida continua = mesma caixa (IoU, altura) e mesma cor média do rosto (troca de pessoa no mesmo lugar muda a cor)
      const prev = anteriores.find((a) => contínua(a.box, f.box)
        && Math.abs(a.cor[0] - atuais[fi].cor[0]) + Math.abs(a.cor[1] - atuais[fi].cor[1]) + Math.abs(a.cor[2] - atuais[fi].cor[2]) < 45);
      const elegivel = !!f.kps && f.score >= (opt.embedMin ?? 0.8);
      let emb: number[] | null = null;
      if (opt.embed === true && elegivel) emb = await faceEmbedding(buf, YUNET_SIZE, YUNET_SIZE, f.kps!);
      else if (opt.embed === 'sparse' && elegivel) emb = prev?.emb ?? await faceEmbedding(buf, YUNET_SIZE, YUNET_SIZE, f.kps!);
      if (emb) atuais[fi].emb = emb;
      res.push({
        score: Math.round(f.score * 1000) / 1000,
        box: { x: crop.x + f.box.x / scale, y: crop.y + f.box.y / scale, w: f.box.w / scale, h: f.box.h / scale },
        ...(f.kps ? { kps: f.kps.map((v, j) => (j % 2 ? crop.y : crop.x) + v / scale) } : {}),
        ...(emb ? { emb } : {}),
      });
    }
    anteriores = atuais;
    out.push({ frame, atSec: info.fps ? frame / info.fps : 0, faces: res });
  });
  return out.sort((a, b) => a.frame - b.frame);
}
