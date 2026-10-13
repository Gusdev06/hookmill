// MediaAnalysisService (contrato em ./contrato.ts, §6.2 da feature 2). Só caminhos locais, sem storage, sem regra de negócio.
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rect } from '@maquina/contratos';
import { MediaInvalidError, type FaceTrackResult, type MediaAnalysisService } from './contrato';
import { run, streamFrames, MediaToolError, type Bins } from './ffmpeg';
import { measureLayout, DEFAULT_LAYOUT, type LayoutMeasure, type LayoutOptions } from './layout';
import { detectFaces } from './rostos';
import { panelAroundFace } from './painel';
import type { RgbFrame } from './celulas';
import { buildFaceTrack, fitCrop, refineEdge, regionStats, sameRect, timeline, trackBlockers } from './trilha';
import { boxDistances, presenceRun, solidBackground } from './camadas';
import { concatClips, identityScore, lastFrame, timeStretch, trimToFrames } from './troca-motor';
import { captionBox } from './legenda';

export class NoAudioError extends Error {
  constructor(path: string) { super(`sem trilha de áudio: ${path}`); this.name = 'NoAudioError'; }
}

export interface MedicaoConfig { ffmpeg: string; ffprobe: string; layout?: Partial<LayoutOptions> }

type Probe = Awaited<ReturnType<MediaAnalysisService['probe']>>;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function parseRate(s: string | undefined): number {
  if (!s) return 0;
  const [n, d] = s.split('/').map(Number);
  return d ? n / d : n || 0;
}

export class FfmpegMediaAnalysisService implements MediaAnalysisService {
  private readonly bins: Bins;
  private readonly layout: LayoutOptions;
  constructor(cfg: MedicaoConfig = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }) {
    this.bins = { ffmpeg: cfg.ffmpeg, ffprobe: cfg.ffprobe };
    this.layout = { ...DEFAULT_LAYOUT, ...cfg.layout };
  }

  async probe(path: string): Promise<Probe> {
    let json: any;
    try {
      const r = await run(this.bins.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { timeoutMs: 60_000 });
      json = JSON.parse(r.stdout.toString('utf8'));
    } catch (e) {
      throw new MediaInvalidError('undecodable', `ffprobe não leu o arquivo: ${(e as Error).message}`);
    }
    const streams: any[] = json.streams ?? [];
    const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    if (!v) throw new MediaInvalidError('no_video', 'nenhuma trilha de vídeo');
    let width = Number(v.width), height = Number(v.height);
    const rot = Number(v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate ?? 0);
    if (Math.abs(rot) % 180 === 90) [width, height] = [height, width];
    const durationSec = Number(json.format?.duration ?? v.duration);
    if (!width || !height || !Number.isFinite(durationSec)) throw new MediaInvalidError('undecodable', 'sem dimensão ou duração');
    const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate);
    return { durationSec: r3(durationSec), width, height, fps: Math.round(fps * 1000) / 1000, hasAudio: streams.some((s) => s.codec_type === 'audio'), videoCodec: String(v.codec_name) };
  }

  /** Decodifica vídeo e áudio inteiros; qualquer erro do decodificador (arquivo truncado incluso) = undecodable.
   *  Aqui -v error é o certo: queremos só as linhas de erro (a regra do -hide_banner vale pro silencedetect). */
  async validateFull(path: string): Promise<void> {
    const p = await this.probe(path);
    const args = ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', path, '-map', '0:v:0'];
    if (p.hasAudio) args.push('-map', '0:a:0');
    args.push('-f', 'null', '-');
    const r = await run(this.bins.ffmpeg, args, { allowFail: true, timeoutMs: 15 * 60_000 });
    if (r.code !== 0 || r.stderr.trim()) {
      throw new MediaInvalidError('undecodable', `não decodifica inteiro: ${r.stderr.trim().split('\n').slice(0, 3).join(' | ') || `exit ${r.code}`}`);
    }
  }

  async extractAudio(videoPath: string, outPath: string): Promise<{ durationSec: number }> {
    const p = await this.probe(videoPath);
    if (!p.hasAudio) throw new NoAudioError(videoPath);
    await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', videoPath, '-map', '0:a:0', '-vn',
      '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath]);
    return { durationSec: await this.audioDuration(outPath) };
  }

  /** Corta cada trecho (recodifica: corte exato, não no pacote). Saída m4a mono 44,1 kHz, um arquivo por trecho, na ordem. */
  async sliceAudio(audioPath: string, segments: { startSec: number; endSec: number }[], outDir: string): Promise<string[]> {
    await mkdir(outDir, { recursive: true });
    const out: string[] = [];
    for (const [i, s] of segments.entries()) {
      if (!(s.endSec > s.startSec)) throw new RangeError(`trecho ${i} vazio: ${s.startSec}-${s.endSec}`);
      const f = join(outDir, `slice-${String(i).padStart(3, '0')}.m4a`);
      await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-ss', s.startSec.toFixed(3), '-i', audioPath,
        '-t', (s.endSec - s.startSec).toFixed(3), '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', f]);
      out.push(f);
    }
    return out;
  }

  /** Pós-10/10 (REMIX_EDIT). Recodifica H.264 + AAC pra cortar no frame exato. */
  async cutVideo(videoPath: string, segments: { startSec: number; endSec: number }[], outDir: string): Promise<string[]> {
    await mkdir(outDir, { recursive: true });
    const out: string[] = [];
    for (const [i, s] of segments.entries()) {
      if (!(s.endSec > s.startSec)) throw new RangeError(`trecho ${i} vazio: ${s.startSec}-${s.endSec}`);
      const f = join(outDir, `cut-${String(i).padStart(3, '0')}.mp4`);
      await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-ss', s.startSec.toFixed(3), '-i', videoPath,
        '-t', (s.endSec - s.startSec).toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', f]);
      out.push(f);
    }
    return out;
  }

  /** JPG por instante, lado maior <= maxSide (não amplia). Instante além do fim é puxado pro último frame. */
  async keyframes(videoPath: string, atSec: number[], outDir: string, maxSide: number): Promise<{ atSec: number; path: string }[]> {
    await mkdir(outDir, { recursive: true });
    const p = await this.probe(videoPath);
    const last = Math.max(0, p.durationSec - Math.max(0.05, p.fps ? 1.5 / p.fps : 0.05));
    const landscape = p.width >= p.height;
    const scale = landscape
      ? `scale='min(${maxSide},iw)':-2`
      : `scale=-2:'min(${maxSide},ih)'`;
    const out: { atSec: number; path: string }[] = [];
    for (const [i, t] of atSec.entries()) {
      const at = Math.min(Math.max(0, t), last);
      const f = join(outDir, `kf-${String(i).padStart(3, '0')}-${Math.round(t * 1000)}ms.jpg`);
      // perto do fim o -ss pode cair depois do último quadro (áudio mais longo que o vídeo): o ffmpeg não grava nada.
      // Recua e tenta de novo; se nada sair, pula só este frame em vez de derrubar a análise inteira.
      let ok = false;
      for (const back of [0, 0.25, 0.5, 1, 2]) {
        const seek = Math.max(0, at - back);
        try {
          await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', seek.toFixed(3), '-i', videoPath,
            '-frames:v', '1', '-vf', scale, '-q:v', '3', f]);
          if ((await stat(f).catch(() => null))?.size) { ok = true; break; }
        } catch {
          // tenta mais cedo
        }
        if (seek === 0) break;
      }
      if (ok) out.push({ atSec: t, path: f });
    }
    return out;
  }

  /** silencedetect a -35 dB. NUNCA -v error aqui: o filtro escreve no nível info e o -v error engole tudo. */
  async silences(audioPath: string, minSec = 0.3): Promise<{ startSec: number; endSec: number }[]> {
    const r = await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-i', audioPath, '-af', `silencedetect=noise=-35dB:d=${minSec}`, '-f', 'null', '-']);
    const out: { startSec: number; endSec: number }[] = [];
    let open: number | null = null;
    for (const line of r.stderr.split(/\r?\n/)) {
      const s = line.match(/silence_start:\s*(-?[\d.]+)/);
      if (s) { open = Math.max(0, Number(s[1])); continue; }
      const e = line.match(/silence_end:\s*([\d.]+)/);
      if (e && open !== null) { out.push({ startSec: r3(open), endSec: r3(Number(e[1])) }); open = null; }
    }
    if (open !== null) out.push({ startSec: r3(open), endSec: await this.audioDuration(audioPath) }); // silêncio até o fim
    return out;
  }

  async measureLayout(videoPath: string): Promise<LayoutMeasure> {
    const p = await this.probe(videoPath);
    return measureLayout(this.bins, videoPath, { w: p.width, h: p.height, fps: p.fps || 30, dur: p.durationSec }, this.layout);
  }

  async frameCount(videoPath: string): Promise<number> {
    const r = await run(this.bins.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets',
      '-of', 'default=nw=1:nk=1', videoPath], { timeoutMs: 5 * 60_000 });
    const n = parseInt(r.stdout.toString('utf8').trim(), 10);
    if (!Number.isFinite(n) || n < 1) throw new MediaInvalidError('undecodable', 'sem frames de vídeo');
    return n;
  }

  async detectFaces(file: string, sampleFps = 5, opts: { minScore?: number; crop?: Rect } = {}) {
    if (/\.(png|jpe?g|webp|bmp)$/i.test(file)) {
      // imagem: o ffprobe não dá duração (probe recusaria); 1 amostra, frame 0
      const r = await run(this.bins.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { timeoutMs: 60_000 });
      const [w, h] = r.stdout.toString('utf8').trim().split(',').map(Number);
      if (!w || !h) throw new MediaInvalidError('undecodable', 'imagem sem dimensão');
      return detectFaces(this.bins, file, { w, h, fps: 0 }, { sampleFps: 0, ...opts });
    }
    const p = await this.probe(file);
    return detectFaces(this.bins, file, { w: p.width, h: p.height, fps: p.fps }, { sampleFps, ...opts });
  }

  async faceTrack(videoPath: string, layoutIn?: LayoutMeasure): Promise<FaceTrackResult> {
    const p = await this.probe(videoPath);
    const fps = p.fps || 30;
    const frameCount = await this.frameCount(videoPath);
    const marca = process.env.MEDICAO_TEMPO ? (() => { let t = Date.now(), c = process.cpuUsage().user; return (o: string) => { const n = process.cpuUsage().user; console.log(`[medicao] ${o}: ${Date.now() - t} ms, cpu ${Math.round((n - c) / 1000)} ms`); t = Date.now(); c = n; }; })() : () => undefined;
    const layout = layoutIn ?? await this.measureLayout(videoPath);
    marca('layout');
    const toF = (s: number) => Math.min(frameCount, Math.max(0, Math.round(s * fps)));
    const cells = layout.segments.map((s, i) => ({
      startFrame: i === 0 ? 0 : toF(s.startSec),
      endFrame: i === layout.segments.length - 1 ? frameCount : toF(s.endSec),
      cells: s.cells,
      cellsAlt: s.cellsAlt,
    }));
    // 0,5 aqui: a trilha usa ≥ 0,8 pra presença e conta o que ficou entre 0,5 e 0,8 como baixa confiança
    // identidade (SFace) nos rostos ≥ 0,6: separa a apresentadora da convidada e da mulher do b-roll
    const samples = await detectFaces(this.bins, videoPath, { w: p.width, h: p.height, fps }, { sampleFps: 3, minScore: 0.5, embed: 'sparse', embedMin: 0.6 });
    marca('yunet+identidade');
    // quadros pro painel do principal: só quando a célula tem outro rosto dentro (preguiçoso, 5 seeks por segmento)
    const quadros = new Map<number, RgbFrame[]>();
    const quadrosDe = (i: number): RgbFrame[] => quadros.get(i) ?? [];
    for (const [i] of cells.entries()) quadros.set(i, []);
    const pedidos: { li: number; cell: Rect; face: Rect }[] = [];
    // 1ª montagem só anota onde precisa de painel; os quadros são lidos depois, e a trilha é refeita com os painéis
    let draft = buildFaceTrack(samples, cells, { width: p.width, height: p.height }, undefined, (li, cell, face) => { pedidos.push({ li, cell, face }); return cell; });
    if (pedidos.length) {
      for (const li of new Set(pedidos.map((x) => x.li))) {
        const c = cells[li];
        for (let j = 0; j < 5; j++) {
          const t = (c.startFrame + ((c.endFrame - c.startFrame) * (j + 0.5)) / 5) / fps;
          const r = await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', videoPath,
            '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { allowFail: true });
          if (r.stdout.length >= p.width * p.height * 3) quadrosDe(li).push({ data: r.stdout.subarray(0, p.width * p.height * 3), w: p.width, h: p.height });
        }
      }
      draft = buildFaceTrack(samples, cells, { width: p.width, height: p.height }, undefined, (li, cell, face) => {
        const fs = quadrosDe(li);
        return fs.length ? panelAroundFace(fs, cell, face).rect : cell;
      });
    }
    // bordas entre amostras: frame exato pelo pico de diferença da própria região (±2 frames de folga)
    for (const e of draft.edges) {
      const seg = draft.segments[e.segment];
      const lo = Math.max(1, e.lo - 2), hi = Math.min(frameCount - 1, e.hi + 2);
      const diffs = await this.regionDiffs(videoPath, seg.region, lo - 1, hi);
      const f = refineEdge(e.lo, [...Array(Math.max(0, e.lo - 2 - lo)).fill(0), ...diffs]);
      if (e.side === 'start') seg.startFrame = Math.min(seg.endFrame - 1, Math.max(lo, f));
      else seg.endFrame = Math.max(seg.startFrame + 1, Math.min(hi + 1, f));
    }
    marca('trilha+painel+bordas');
    // trechos vizinhos refinados de lados diferentes podem se cruzar em 1-2 frames: a borda fica no início do seguinte
    const ord = [...draft.segments].sort((x, y) => x.startFrame - y.startFrame);
    for (let i = 1; i < ord.length; i++) if (ord[i - 1].endFrame > ord[i].startFrame) ord[i - 1].endFrame = ord[i].startFrame;
    // frame de transição (preto/chapado do corte: A → preto → B dá dois saltos iguais e o argmax pode ficar com o preto)
    // não é do trecho: sem isso o rosto novo pisca onde o original tinha o quadro preto (podcast: 352, 406, 606, 853)
    for (const sg of draft.segments) {
      const n = Math.min(3, Math.floor((sg.endFrame - sg.startFrame) / 4));
      if (n < 1) continue;
      const ini = await this.regionStd(videoPath, sg.region, sg.startFrame, n);
      let k = 0; while (k < ini.length && ini[k] < 6) k++;
      const fim = await this.regionStd(videoPath, sg.region, sg.endFrame - n, n);
      let j = 0; while (j < fim.length && fim[fim.length - 1 - j] < 6) j++;
      sg.startFrame += k; sg.endFrame -= j;
    }
    // 2ª passada recortada em cada região (uma por região distinta): confiança e rostos de verdade dentro dela
    const porRegiao = new Map<string, Awaited<ReturnType<typeof detectFaces>>>();
    for (const seg of draft.segments) {
      const k = JSON.stringify(seg.region);
      if (!porRegiao.has(k)) {
        const r = { x: Math.round(seg.region.x), y: Math.round(seg.region.y), w: Math.round(seg.region.w) & ~1, h: Math.round(seg.region.h) & ~1 };
        // 2 amostras/s bastam pras proporções (low_confidence > 20 %, 2 rostos > 10 %), e só dentro dos trechos dela
        const trechos = draft.segments.filter((sg) => JSON.stringify(sg.region) === k);
        porRegiao.set(k, await detectFaces(this.bins, videoPath, { w: p.width, h: p.height, fps }, { sampleFps: 2, minScore: 0.3, crop: r,
          frames: trechos.map((sg) => [sg.startFrame, sg.endFrame] as [number, number]) }));
      }
    }
    marca('2a passada');
    for (let i = 0; i < draft.segments.length; i++) {
      const seg = draft.segments[i];
      const st = regionStats(seg, porRegiao.get(JSON.stringify(seg.region))!, samples);
      seg.facesMax = st.facesMax;
      seg.minScore = st.minScore;
      draft.stats[i] = { startFrame: seg.startFrame, endFrame: seg.endFrame, samples: st.samples, multiFaceSamples: st.multiFaceSamples, lowConfidenceSamples: st.lowConfidenceSamples };
    }
    // células do EditMap: por segmento de layout, a partição (y→x→y ou x→y→x) de onde veio a região do rosto
    const outCells = cells.map((c) => {
      const usaAlt = draft.segments.some((sg) => sg.startFrame < c.endFrame && sg.endFrame > c.startFrame
        && !c.cells.some((x) => sameRect(x, sg.region)) && (c.cellsAlt ?? []).some((x) => sameRect(x, sg.region)));
      return { startFrame: c.startFrame, endFrame: c.endFrame, cells: usaAlt ? c.cellsAlt! : c.cells };
    });
    return { width: p.width, height: p.height, fps, frameCount, cells: outCells, segments: draft.segments, stats: draft.stats,
      blockers: trackBlockers(draft, fps), otherFaceCells: draft.otherFaceCells,
      timeline: timeline(draft.segments, samples, frameCount) };
  }

  /** diffs[k] = diferença média da região entre o frame (from+k+1) e o (from+k), k = 0..to-from-1. */
  private async regionDiffs(file: string, region: Rect, from: number, to: number): Promise<number[]> {
    const w = Math.max(2, Math.round(region.w) & ~1), h = Math.max(2, Math.round(region.h) & ~1);
    const f = Math.min(1, 160 / Math.max(w, h));
    const sw = Math.max(2, Math.round(w * f)), sh = Math.max(2, Math.round(h * f));
    const bytes = sw * sh * 3;
    let prev: Buffer | null = null;
    const out: number[] = [];
    // seek na entrada até o frame `from` e só os frames da janela (antes: select decodificava o vídeo inteiro por borda)
    const fps = (await this.probe(file)).fps || 30;
    await streamFrames(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', (Math.max(0, from - 0.5) / fps).toFixed(4), '-i', file, '-an',
      '-frames:v', String(to - from + 1), '-vf', `crop=${w}:${h}:${Math.round(region.x)}:${Math.round(region.y)},scale=${sw}:${sh}:flags=area`,
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], bytes, (buf) => {
      if (prev) { let t = 0; for (let i = 0; i < bytes; i++) t += Math.abs(buf[i] - prev[i]); out.push(t / bytes); }
      prev = Buffer.from(buf);
    });
    // índice k de out = frame from+k+1; refineEdge espera diffs a partir de (lo-2) com lo-2 = from+1
    return out;
  }

  /** Desvio-padrão da luminância da região (reduzida) em `count` frames a partir de `from`. Quadro chapado ≈ 0. */
  private async regionStd(file: string, region: Rect, from: number, count: number): Promise<number[]> {
    const w = Math.max(2, Math.round(region.w) & ~1), h = Math.max(2, Math.round(region.h) & ~1);
    const f = Math.min(1, 96 / Math.max(w, h));
    const sw = Math.max(2, Math.round(w * f)), sh = Math.max(2, Math.round(h * f));
    const fps = (await this.probe(file)).fps || 30;
    const out: number[] = [];
    // seek até meio frame antes, igual ao regionDiffs: o 1º frame decodificado é o `from`
    await streamFrames(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', (Math.max(0, from - 0.5) / fps).toFixed(4), '-i', file, '-an',
      '-frames:v', String(count), '-vf', `crop=${w}:${h}:${Math.round(region.x)}:${Math.round(region.y)},scale=${sw}:${sh}:flags=area`,
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], sw * sh, (buf) => {
      let m = 0; for (let i = 0; i < buf.length; i++) m += buf[i];
      m /= buf.length;
      let v = 0; for (let i = 0; i < buf.length; i++) v += (buf[i] - m) ** 2;
      out.push(Math.sqrt(v / buf.length));
    });
    return out;
  }

  async layerPresence(videoPath: string, box: Rect, refAtSec: number): Promise<{ startFrame: number; endFrame: number }> {
    const p = await this.probe(videoPath);
    const refFrame = Math.max(0, Math.round(refAtSec * (p.fps || 30)));
    const { d, contrast } = await boxDistances(this.bins, videoPath, box, refFrame);
    return presenceRun(d, Math.min(refFrame, d.length - 1), contrast);
  }

  async solidBackground(videoPath: string, atSec: number, approxBox: Rect) {
    const p = await this.probe(videoPath);
    return solidBackground(this.bins, videoPath, { w: p.width, h: p.height }, atSec, approxBox);
  }

  fitCrop(clip: { w: number; h: number }, clipFace: Rect, region: { w: number; h: number }, faceInRegion: Rect): Rect {
    return fitCrop(clip, clipFace, region, faceInRegion);
  }

  async captionBox(videoPath: string, atSec: number[], approxBox: Rect | null): Promise<Rect | null> {
    const p = await this.probe(videoPath);
    return captionBox(this.bins, videoPath, { w: p.width, h: p.height }, atSec, approxBox);
  }

  // ── §13.15 (Trocar avatar com Kling/Seedance) ──
  concatClips(paths: string[], outPath: string) { return concatClips(this.bins, paths, outPath); }
  trimToFrames(videoPath: string, frameCount: number, fps: number, outPath: string) { return trimToFrames(this.bins, videoPath, frameCount, fps, outPath); }
  lastFrame(videoPath: string, outPath: string) { return lastFrame(this.bins, videoPath, outPath); }
  timeStretch(videoPath: string, factor: number, outPath: string) { return timeStretch(this.bins, videoPath, factor, outPath); }
  identityScore(videoPath: string, refImagePath: string, sampleFps?: number) { return identityScore(this.bins, videoPath, refImagePath, sampleFps); }

  /** k-means determinístico (semente por quantis de luminância) sobre os frames reduzidos a 64x64. Hex por peso, maior primeiro. */
  async palette(framePaths: string[], k: number): Promise<string[]> {
    const px: number[] = [];
    for (const f of framePaths) {
      const r = await run(this.bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', f, '-frames:v', '1',
        '-vf', 'scale=64:64', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      for (let i = 0; i + 2 < r.stdout.length; i += 3) px.push(r.stdout[i], r.stdout[i + 1], r.stdout[i + 2]);
    }
    return kmeansHex(Uint8Array.from(px), k);
  }

  private async audioDuration(path: string): Promise<number> {
    const r = await run(this.bins.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { timeoutMs: 60_000 });
    return r3(Number(r.stdout.toString('utf8').trim()));
  }
}

export function kmeansHex(rgb: Uint8Array, k: number, iters = 12): string[] {
  const n = Math.floor(rgb.length / 3);
  if (!n || k < 1) return [];
  const lum = (i: number) => 0.299 * rgb[3 * i] + 0.587 * rgb[3 * i + 1] + 0.114 * rgb[3 * i + 2];
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => lum(a) - lum(b));
  const kk = Math.min(k, n);
  let c = Array.from({ length: kk }, (_, j) => {
    const i = order[Math.min(n - 1, Math.floor(((j + 0.5) / kk) * n))];
    return [rgb[3 * i], rgb[3 * i + 1], rgb[3 * i + 2]];
  });
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const sum = c.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < c.length; j++) {
        const d = (rgb[3 * i] - c[j][0]) ** 2 + (rgb[3 * i + 1] - c[j][1]) ** 2 + (rgb[3 * i + 2] - c[j][2]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      assign[i] = best;
      const s = sum[best];
      s[0] += rgb[3 * i]; s[1] += rgb[3 * i + 1]; s[2] += rgb[3 * i + 2]; s[3]++;
    }
    c = c.map((old, j) => (sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : old));
  }
  const count = new Array(c.length).fill(0);
  for (let i = 0; i < n; i++) count[assign[i]]++;
  const hex = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  const seen = new Set<string>();
  return c
    .map((col, j) => ({ h: `#${hex(col[0])}${hex(col[1])}${hex(col[2])}`, n: count[j] }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => x.h)
    .filter((h) => (seen.has(h) ? false : (seen.add(h), true)));
}

export { MediaToolError };
