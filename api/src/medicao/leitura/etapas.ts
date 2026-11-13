// Etapas de MÍDIA da leitura do anúncio (CHAMPION_ANALYZE), sem storage, sem banco e sem IA (leitura-lambda-v1 §2).
// O MESMO código roda na API (adaptador local) e na AWS Lambda (handler.ts): nada de fork. Entrada e saída são caminhos
// locais; quem sobe os arquivos é o adaptador (local: StorageService.put; lambda: PUT pré-assinado).
import { join } from 'node:path';
import type { EditLayer, Measurements, Rect, TranscriptWord } from '@maquina/contratos';
import { clampRect } from '../../campeoes/mapa-edicao';
import type { FaceTrackResult, MediaAnalysisService } from '../contrato';
import { comPrazo, PrazoEsgotado, run } from '../ffmpeg';
import type { LayoutMeasure } from '../layout';

/** Frames-chave mandados ao Claude: até 16, lado maior 768 px (feature-2 §6.1). Espelho de campeoes/limites.ts. */
export const MAX_KEYFRAMES = 16;
export const KEYFRAME_MAX_SIDE = 768;
/** Recortes das faixas candidatas a texto (describeEdit). */
export const MAX_TEXT_CROPS = 6;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Prazo de cada etapa (F3 do QA 01/11: a leitura chegou a 9-15 min sem resposta numa máquina carregada). Folga de ~10x
 * sobre o medido no M5 com carga e cabe nos 600 s da Lambda num campeão de 180 s (CHAMPION_MAX_SEC): medir + trilha +
 * recortes = 525 s. Estourou = os ffmpeg da etapa morrem: ler/medir falham (a análise falha e o usuário tenta de novo),
 * trilha/recortes ficam de fora (campeão sem mapa, como já era) e o refino devolve as camadas da visão.
 * `LEITURA_PRAZO_FATOR` multiplica todos (teste de estouro; Lambda com memória maior).
 */
export function prazosLeitura(durationSec: number) {
  const f = Number(process.env.LEITURA_PRAZO_FATOR) > 0 ? Number(process.env.LEITURA_PRAZO_FATOR) : 1;
  const d = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 180;
  return {
    ler: 180_000 * f,
    medir: (45_000 + 1_000 * d) * f,
    trilha: (45_000 + 1_250 * d) * f,
    recortes: 30_000 * f,
    refinar: (30_000 + 500 * d) * f,
  };
}

export type Probe = Awaited<ReturnType<MediaAnalysisService['probe']>>;
export type KeyframeReason = Measurements['keyframes'][number]['reason'];
export type Segmentos = Measurements['segments'];
export interface Aviso { (msg: string): void }

/** Instantes dos frames-chave: t0, cada corte, fim; completa com instantes regulares até MAX_KEYFRAMES. */
export function keyframeTimes(durationSec: number, cuts: { atSec: number }[]): { atSec: number; reason: KeyframeReason }[] {
  const end = Math.max(0, durationSec - 0.1);
  const out: { atSec: number; reason: KeyframeReason }[] = [{ atSec: 0, reason: 't0' }];
  for (const c of cuts) if (c.atSec > 0.2 && c.atSec < end - 0.2) out.push({ atSec: r3(c.atSec), reason: 'cut' });
  out.push({ atSec: r3(end), reason: 'end' });
  const kept = out.slice(0, MAX_KEYFRAMES - 1).concat(out.length > MAX_KEYFRAMES - 1 ? [out[out.length - 1]] : []);
  const unique = [...new Map(kept.map((k) => [k.atSec, k])).values()];
  // preenche com frames regulares ("block": o Claude ainda não dividiu os blocos), sem passar de 16
  const room = MAX_KEYFRAMES - unique.length;
  const fill = Math.min(room, Math.max(0, Math.floor(durationSec / 3) - unique.length));
  for (let i = 1; i <= fill; i++) {
    const at = r3((end * i) / (fill + 1));
    if (!unique.some((k) => Math.abs(k.atSec - at) < 0.5)) unique.push({ atSec: at, reason: 'block' });
  }
  return unique.sort((a, b) => a.atSec - b.atSec);
}

// ───────── 1. ler: decodifica inteiro + probe + áudio ─────────

export interface LerSaida { probe: Probe; audio: { path: string; durationSec: number } | null }

/** validateFull (lança MediaInvalidError) → probe → extrai o áudio (m4a) se houver trilha e `extrairAudio`. */
export async function ler(media: MediaAnalysisService, videoPath: string, dir: string, extrairAudio: boolean): Promise<LerSaida> {
  return comPrazo('ler', prazosLeitura(0).ler, () => lerSemPrazo(media, videoPath, dir, extrairAudio));
}

async function lerSemPrazo(media: MediaAnalysisService, videoPath: string, dir: string, extrairAudio: boolean): Promise<LerSaida> {
  await media.validateFull(videoPath);
  const probe = await media.probe(videoPath);
  if (!probe.hasAudio || !extrairAudio) return { probe, audio: null };
  const path = join(dir, 'audio.m4a');
  const a = await media.extractAudio(videoPath, path);
  return { probe, audio: { path, durationSec: a.durationSec } };
}

// ───────── 2. medir: medições + frames-chave + trilha do rosto + recortes de texto ─────────

export interface MedirEntrada {
  probe: Probe;
  /** Caminho do áudio (silêncios). null = sem áudio. */
  audioPath: string | null;
  /** false = as medições já estão gravadas (nova tentativa): só trilha e recortes. */
  medir: boolean;
  /** Segmentos das medições gravadas (recortes de texto) quando `medir` é false. */
  segmentos?: Segmentos;
  /** false = `[mock:not-mapped]` (sem mapa): nem trilha nem recortes. */
  mapear: boolean;
}

export interface Medidas {
  durationSec: number; width: number; height: number; fps: number; hasAudio: boolean;
  cuts: Measurements['cuts']; segments: LayoutMeasure['segments']; palette: string[];
  silences: { startSec: number; endSec: number }[];
  keyframes: { atSec: number; reason: KeyframeReason; path: string }[];
}

export interface MedirSaida {
  medidas: Medidas | null;
  /** Trilha do rosto; `erro` = falhou (o mapa fica de fora e a análise segue, como hoje). null = não pedida. */
  trilha: { ok: true; valor: FaceTrackResult } | { ok: false; erro: string } | null;
  recortes: { atSec: number; box: Rect; path: string }[];
}

/**
 * Tudo que só depende do vídeo, numa chamada (na Lambda: 1 invocação). Ordem e regras iguais às do analise.service
 * antes de 31/10: measure() → faceTrack() → textCrops(). Falha nas medições derruba a análise; falha na trilha não.
 */
export async function medir(media: MediaAnalysisService, ffmpeg: string, videoPath: string, dir: string, i: MedirEntrada, aviso: Aviso = () => undefined): Promise<MedirSaida> {
  const prazo = prazosLeitura(i.probe.durationSec);
  let medidas: Medidas | null = null;
  let layout: LayoutMeasure | undefined;
  if (i.medir) [medidas, layout] = await comPrazo('medir', prazo.medir, () => medirSemPrazo(media, videoPath, dir, i));
  if (!i.mapear) return { medidas, trilha: null, recortes: [] };
  // layout recém-medido vai junto: a trilha não mede de novo (mesma função, mesmo resultado; ~8 s a menos num vídeo de 2 min)
  let trilha: MedirSaida['trilha'];
  try {
    trilha = { ok: true, valor: await comPrazo('trilha', prazo.trilha, () => media.faceTrack(videoPath, layout)) };
  } catch (e) {
    trilha = { ok: false, erro: (e as Error).message };
  }
  const segmentos = medidas?.segments ?? i.segmentos ?? [];
  let recortes: MedirSaida['recortes'] = [];
  try {
    recortes = await comPrazo('recortes', prazo.recortes, () => textCrops(ffmpeg, videoPath, segmentos, i.probe.width, dir, aviso));
  } catch (e) {
    if (!(e instanceof PrazoEsgotado)) throw e;
    aviso(`recortes de faixa: ${e.message}`);
  }
  return { medidas, trilha, recortes };
}

async function medirSemPrazo(media: MediaAnalysisService, videoPath: string, dir: string, i: MedirEntrada): Promise<[Medidas, LayoutMeasure]> {
  const layout = await media.measureLayout(videoPath);
  const silences = i.audioPath ? await media.silences(i.audioPath) : [];
  const times = keyframeTimes(i.probe.durationSec, layout.cuts);
  const frames = await media.keyframes(videoPath, times.map((t) => t.atSec), join(dir, 'frames'), KEYFRAME_MAX_SIDE);
  const palette = frames.length ? await media.palette(frames.map((f) => f.path), 6) : [];
  const medidas: Medidas = {
    durationSec: r3(i.probe.durationSec), width: i.probe.width, height: i.probe.height, fps: i.probe.fps, hasAudio: i.probe.hasAudio,
    cuts: layout.cuts, segments: layout.segments, palette, silences,
    keyframes: frames.map((f) => ({ atSec: f.atSec, path: f.path, reason: times.find((t) => Math.abs(t.atSec - f.atSec) < 0.01)?.reason ?? 'block' })),
  };
  return [medidas, layout];
}

/** Até 6 recortes em resolução cheia das faixas candidatas a texto (faixas que não são o rosto), lado maior 1024 px. */
export async function textCrops(ffmpeg: string, videoPath: string, segmentos: Segmentos, width: number, dir: string, aviso: Aviso = () => undefined) {
  const cands: { atSec: number; box: Rect }[] = [];
  for (const seg of segmentos) {
    const at = r3((seg.startSec + seg.endSec) / 2);
    for (const b of seg.bands) {
      if (b.role === 'face' || b.y1 - b.y0 < 8) continue;
      cands.push({ atSec: at, box: { x: 0, y: Math.round(b.y0), w: width, h: Math.round(b.y1 - b.y0) } });
    }
  }
  const out: { atSec: number; box: Rect; path: string }[] = [];
  for (const [i, cd] of cands.slice(0, MAX_TEXT_CROPS).entries()) {
    const path = join(dir, `crop-${i}.jpg`);
    try {
      await run(ffmpeg, [
        '-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', cd.atSec.toFixed(3), '-i', videoPath, '-frames:v', '1',
        '-vf', `crop=${cd.box.w}:${cd.box.h}:${cd.box.x}:${cd.box.y},scale='min(1024,iw)':-2`, '-q:v', '3', path,
      ], { timeoutMs: 30_000 });
      out.push({ ...cd, path });
    } catch (e) {
      aviso(`recorte de faixa ${i} falhou: ${(e as Error).message}`);
    }
  }
  return out;
}

// ───────── 3. refinar: camadas da visão medidas por pixel ─────────

export interface RefinarEntrada { layers: EditLayer[]; fps: number; frameCount: number; words: TranscriptWord[] }

/**
 * §13.2 refino por pixel: camada com fundo (solid/pill) ganha a faixa medida (caixa e cor) e o texto é preso dentro
 * dela; o intervalo vem da presença do recorte no vídeo (frames). Legenda sem fundo = caixa medida nos instantes das
 * palavras (captionBox). Falhou a medição de uma camada = fica a da visão. Prazo estourado = todas ficam as da visão.
 * A presença de todas as camadas sai de UMA decodificação (layersPresence), não de duas por camada (F3 01/11).
 */
export async function refinar(media: MediaAnalysisService, videoPath: string, i: RefinarEntrada, aviso: Aviso = () => undefined): Promise<EditLayer[]> {
  try {
    return await comPrazo('refinar', prazosLeitura(i.fps > 0 ? i.frameCount / i.fps : 0).refinar, () => refinarSemPrazo(media, videoPath, i, aviso));
  } catch (e) {
    if (!(e instanceof PrazoEsgotado)) throw e;
    aviso(`${e.message}: as camadas ficam as da visão`);
    return i.layers;
  }
}

async function refinarSemPrazo(media: MediaAnalysisService, videoPath: string, i: RefinarEntrada, aviso: Aviso): Promise<EditLayer[]> {
  const out: EditLayer[] = [...i.layers];
  const pend: { k: number; at: number; next: EditLayer }[] = [];
  for (const [k, l] of i.layers.entries()) {
    // 13/11: TODA legenda passa pelo pixel, com qualquer fundo. A legenda "pill" caía no `continue` abaixo e ficava com a
    // caixa da visão; o GPT da Kie (visão desde 11/11) devolveu o y em px da imagem de 768 e a faixa foi pro rosto (y 518
    // em vez de 1309), o que derrubou 6 de 7 peças com CAPTION_COVERED.
    if (l.kind === 'caption') {
      out[k] = await refinarLegenda(media, videoPath, l, i.fps, i.words, aviso);
      continue;
    }
    if (l.background.kind === 'none') continue;
    try {
      const at = r3((l.startFrame + l.endFrame) / 2 / i.fps);
      const sb = await media.solidBackground(videoPath, at, l.box);
      const next: EditLayer = sb ? { ...l, box: clampRect(l.box, sb.box), background: { ...l.background, color: sb.color, box: sb.box }, source: 'vision+pixel' } : l;
      pend.push({ k, at, next });
    } catch (e) {
      if (e instanceof PrazoEsgotado) throw e;
      aviso(`refino da camada ${l.id} falhou: ${(e as Error).message}`);
    }
  }
  const pres = await presencas(media, videoPath, pend.map((p) => ({ box: p.next.background.box ?? p.next.box, refAtSec: p.at })));
  for (const [j, p] of pend.entries()) {
    const pr = pres[j];
    if (pr instanceof Error) {
      aviso(`refino da camada ${p.next.id} falhou: ${pr.message}`);
      continue; // fica a da visão (out[k] = l), como quando a camada inteira falhava
    }
    out[p.k] = pr.endFrame > pr.startFrame
      ? { ...p.next, startFrame: Math.max(0, pr.startFrame), endFrame: Math.min(i.frameCount, pr.endFrame), source: 'vision+pixel' }
      : p.next;
  }
  return out;
}

/** Presença de várias caixas: uma decodificação (layersPresence) ou, sem ele, caixa a caixa. Erro na posição da caixa. */
async function presencas(media: MediaAnalysisService, videoPath: string, items: { box: Rect; refAtSec: number }[]) {
  if (!items.length) return [];
  if (media.layersPresence) {
    try {
      return await media.layersPresence(videoPath, items);
    } catch (e) {
      if (e instanceof PrazoEsgotado) throw e;
      return items.map(() => e as Error);
    }
  }
  const out: ({ startFrame: number; endFrame: number } | Error)[] = [];
  for (const it of items) {
    try {
      out.push(await media.layerPresence(videoPath, it.box, it.refAtSec));
    } catch (e) {
      if (e instanceof PrazoEsgotado) throw e;
      out.push(e as Error);
    }
  }
  return out;
}

/** (c) 08/10: legenda sem fundo = caixa medida por pixel nos instantes das palavras do intervalo dela. */
async function refinarLegenda(media: MediaAnalysisService, videoPath: string, l: EditLayer, fps: number, words: TranscriptWord[], aviso: Aviso): Promise<EditLayer> {
  if (typeof (media as Partial<MediaAnalysisService>).captionBox !== 'function') return l;
  const at = words
    .map((w) => r3((w.startSec + w.endSec) / 2))
    .filter((t) => t * fps >= l.startFrame && t * fps < l.endFrame);
  if (!at.length) return l;
  try {
    const box = await media.captionBox(videoPath, at.filter((_, k) => k % Math.max(1, Math.ceil(at.length / 24)) === 0), l.box);
    if (!box) {
      aviso(`legenda ${l.id}: o pixel não achou a faixa; fica a caixa da visão (${l.box.y}+${l.box.h})`);
      return l;
    }
    // fundo pill/solid acompanha a caixa medida (a da visão pode estar noutra altura)
    const background = l.background.kind === 'none' ? l.background : { ...l.background, box };
    return { ...l, box, background, source: 'vision+pixel' };
  } catch (e) {
    aviso(`refino da legenda ${l.id} falhou: ${(e as Error).message}`);
    return l;
  }
}
