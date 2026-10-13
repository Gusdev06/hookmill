// §13.15 (Trocar avatar com Kling/Seedance mantendo a edição): emenda das janelas, corte no nº exato de frames, último
// frame pro encadeamento, time-stretch da voz do motor e identidade (SFace) do clipe contra o rosto escolhido.
// Só caminhos locais, ffmpeg do sistema (argv, sem shell). Assinaturas na §13.15.7.
import { stat } from 'node:fs/promises';
import { run, MediaToolError, type Bins } from './ffmpeg';
import { cosine, detectFaces, type Face } from './rostos';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Qualidade intermediária: o clipe ainda passa pelo render (crf 12 no fim); crf 14 aqui não aparece na peça. */
const H264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p'];
/** Voz do motor: AAC alto (vai ser recodificada uma vez no áudio montado, 192 kbps). */
const AAC = ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000'];

interface Info { w: number; h: number; fps: number; dur: number; audio: boolean; frames: number }

async function info(bins: Bins, file: string): Promise<Info> {
  const r = await run(bins.ffprobe, ['-v', 'error', '-count_packets', '-show_entries',
    'stream=codec_type,width,height,avg_frame_rate,r_frame_rate,nb_read_packets:format=duration', '-of', 'json', file], { timeoutMs: 120_000 });
  const j = JSON.parse(r.stdout.toString('utf8'));
  const v = (j.streams ?? []).find((s: any) => s.codec_type === 'video');
  if (!v) throw new MediaToolError('ffprobe', 0, '', `sem vídeo: ${file}`);
  const rate = (s: string | undefined) => { if (!s) return 0; const [n, d] = s.split('/').map(Number); return d ? n / d : n || 0; };
  return {
    w: Number(v.width), h: Number(v.height), fps: rate(v.avg_frame_rate) || rate(v.r_frame_rate),
    dur: Number(j.format?.duration ?? 0), audio: (j.streams ?? []).some((s: any) => s.codec_type === 'audio'),
    frames: Number(v.nb_read_packets) || 0,
  };
}

/** Conta pacotes de vídeo (a grade de verdade, não o cabeçalho). */
async function contar(bins: Bins, file: string): Promise<number> {
  return (await info(bins, file)).frames;
}

/**
 * Emenda as janelas na ordem, recodificando na fps e no tamanho da 1ª (as do motor já saem iguais; o scale é seguro
 * contra 1 px de diferença). Com som só se TODAS têm som (ENGINE_VOICE); senão sai muda. Sem buraco: concat por filtro,
 * PTS recontados. Cada janela já deve vir cortada no pedaço usado (trimToFrames), senão a sobra de genSec entra no meio.
 */
export async function concatClips(bins: Bins, paths: string[], outPath: string): Promise<{ durationSec: number }> {
  if (!paths.length) throw new RangeError('concatClips sem janelas');
  const infos = await Promise.all(paths.map((p) => info(bins, p)));
  const { w, h, fps } = infos[0];
  const comSom = infos.every((i) => i.audio);
  const parts: string[] = [];
  const ins: string[] = [];
  paths.forEach((p, i) => {
    ins.push('-i', p);
    parts.push(`[${i}:v]fps=${fps},scale=${w}:${h}:flags=lanczos,setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`);
    if (comSom) parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
  });
  const lista = paths.map((_, i) => (comSom ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
  parts.push(`${lista}concat=n=${paths.length}:v=1:a=${comSom ? 1 : 0}${comSom ? '[v][a]' : '[v]'}`);
  await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...ins, '-filter_complex', parts.join(';'),
    '-map', '[v]', ...(comSom ? ['-map', '[a]', ...AAC] : ['-an']), ...H264, '-r', String(fps), '-movflags', '+faststart', outPath]);
  return { durationSec: r3((await info(bins, outPath)).dur) };
}

/**
 * Exatamente `frameCount` frames na `fps` pedida (a do campeão), a partir do instante 0. Clipe curto: repete o último
 * frame (tpad clone) e completa o som com silêncio. Áudio, se houver, cortado em frameCount/fps. Confere a contagem.
 */
export async function trimToFrames(bins: Bins, videoPath: string, frameCount: number, fps: number, outPath: string): Promise<void> {
  if (!(frameCount >= 1) || !Number.isInteger(frameCount)) throw new RangeError(`frameCount inválido: ${frameCount}`);
  const i = await info(bins, videoPath);
  const alvo = frameCount / fps;
  const falta = Math.max(0, alvo - i.dur) + 2 / fps;
  const vf = `fps=${fps},tpad=stop_mode=clone:stop_duration=${falta.toFixed(3)},setpts=PTS-STARTPTS`;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', videoPath, '-vf', vf, '-frames:v', String(frameCount)];
  if (i.audio) args.push('-af', `apad,atrim=0:${alvo.toFixed(6)},asetpts=PTS-STARTPTS`, ...AAC);
  else args.push('-an');
  args.push(...H264, '-r', String(fps), '-fps_mode', 'cfr', '-movflags', '+faststart', outPath);
  await run(bins.ffmpeg, args);
  const n = await contar(bins, outPath);
  if (n !== frameCount) throw new MediaToolError('ffmpeg', 0, '', `trimToFrames: ${n} frames, pedido ${frameCount}`);
}

/**
 * Último frame DECODIFICADO, em png (entrada da janela seguinte no motor). Decodifica só o fim (-sseof) e fica com o
 * último que sair (-update 1). Passe o clipe já cortado no pedaço usado: o frame tem que ser o que aparece na emenda.
 */
export async function lastFrame(bins: Bins, videoPath: string, outPath: string): Promise<string> {
  for (const fim of [2, 6, 0]) {
    const seek = fim ? ['-sseof', `-${fim}`] : [];
    await run(bins.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...seek, '-i', videoPath, '-an',
      '-update', '1', '-fps_mode', 'passthrough', '-compression_level', '3', outPath], { allowFail: true });
    if ((await stat(outPath).catch(() => null))?.size) return outPath;
  }
  throw new MediaToolError('ffmpeg', null, '', `lastFrame: nada decodificado em ${videoPath}`);
}

/**
 * Estica (factor > 1, mais lento) ou encolhe (factor < 1) vídeo e voz juntos: setpts × factor e atempo 1/factor (tom
 * preservado). Saída na mesma fps (frames repetidos/descartados pelo fps). `factor` = duração de saída / de entrada.
 * O reencaixe (B) usa 0,92-1,08; o nº exato de frames sai do trimToFrames depois.
 */
export async function timeStretch(bins: Bins, videoPath: string, factor: number, outPath: string): Promise<void> {
  if (!(factor >= 0.5 && factor <= 2)) throw new RangeError(`timeStretch: factor ${factor} fora de 0,5-2`);
  const i = await info(bins, videoPath);
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', videoPath,
    '-vf', `setpts=${factor.toFixed(6)}*(PTS-STARTPTS),fps=${i.fps}`];
  if (i.audio) args.push('-af', `asetpts=PTS-STARTPTS,atempo=${(1 / factor).toFixed(6)}`, ...AAC);
  else args.push('-an');
  args.push(...H264, '-r', String(i.fps), '-movflags', '+faststart', outPath);
  await run(bins.ffmpeg, args);
}

/** Maior rosto confiável da amostra por score (nunca por área: pega planta e quadro na parede). */
const melhor = (faces: Face[]) => faces.filter((f) => f.emb).sort((a, b) => b.score - a.score)[0];

/**
 * Identidade do clipe contra o rosto escolhido (SFace, cosseno). Amostra sem rosto conta 0 (o clipe que perde o rosto
 * reprova igual a um que troca de pessoa). Limiares (§13.15.3): mediana ≥ 0,363 e nenhuma amostra < 0,30.
 * Sem o modelo SFace = erro (o backend decide; não dá pra aprovar sem medir).
 */
export async function identityScore(bins: Bins, videoPath: string, refImagePath: string, sampleFps = 2):
  Promise<{ median: number; min: number; samples: number }> {
  const img = await run(bins.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', refImagePath]);
  const [rw, rh] = img.stdout.toString('utf8').trim().split(',').map(Number);
  const ref = melhor((await detectFaces(bins, refImagePath, { w: rw, h: rh, fps: 0 }, { sampleFps: 0, minScore: 0.6, embed: true, embedMin: 0.6 }))[0]?.faces ?? []);
  if (!ref?.emb) {
    throw new MediaToolError('sface', null, '', `identityScore: sem rosto ou sem modelo SFace na referência ${refImagePath}`);
  }
  const i = await info(bins, videoPath);
  const amostras = await detectFaces(bins, videoPath, { w: i.w, h: i.h, fps: i.fps }, { sampleFps, minScore: 0.6, embed: true, embedMin: 0.6 });
  const s = amostras.map((a) => { const f = melhor(a.faces); return f?.emb ? cosine(f.emb, ref.emb!) : 0; });
  if (!s.length) return { median: 0, min: 0, samples: 0 };
  const o = [...s].sort((a, b) => a - b);
  const m = o.length >> 1;
  return { median: r3(o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2), min: r3(o[0]), samples: s.length };
}
