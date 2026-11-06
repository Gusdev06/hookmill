// Pós-processo do render com ffmpeg/ffprobe, comum aos adaptadores `local` e `lambda` (render-lambda-v1 §1 itens 11-13).
// Extraído do RemotionRenderService sem mudar comportamento: o local chama as mesmas funções de antes.
import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { RENDER_REMIX } from '@maquina/video';
import { RenderError, type RemixKeepRenderInput } from './contrato';
import { montarAudioSplice } from './troca-motor';

const execFileP = promisify(execFile);

export interface Ff { ffmpeg: string; ffprobe: string }

/**
 * Peça final do remix-keep: o campeão DECODIFICADO é a base (nunca passa por RGB/navegador), e só as áreas que mudam
 * (regiões do rosto e caixas das camadas, cada uma no seu intervalo de frames) vêm do render do Remotion, por uma
 * máscara de alfa desenhada por frame. Fora da máscara o pixel é o do campeão; a única perda é a codificação final
 * (crf 12). Pelo navegador inteiro dava 35,8 dB RGB (PSNR do QA), abaixo dos 40. Áudio do campeão copiado (-c:a copy).
 */
export async function comporSobreOCampeao(ff: Ff, input: RemixKeepRenderInput, mudo: string, saida: string): Promise<void> {
  const { width: W, height: H, fps, frameCount } = input.canvas;
  const pad = 4;   // contorno/sombra da letra passa um pouco da caixa
  const caixa = (r: { x: number; y: number; w: number; h: number }, p: number) => {
    const x = Math.max(0, Math.floor(r.x - p)), y = Math.max(0, Math.floor(r.y - p));
    return { x, y, w: Math.min(W, Math.ceil(r.x + r.w + p)) - x, h: Math.min(H, Math.ceil(r.y + r.h + p)) - y };
  };
  const areas: { r: { x: number; y: number; w: number; h: number }; s: number; e: number }[] = [];
  for (const o of input.overlays) areas.push({ r: caixa(o.region, 0), s: o.startFrame, e: o.endFrame });
  for (const l of input.textLayers) {
    // caixa copiada (troca-texto §16.2 A8): a máscara é exatamente a imagem medida, sem o `pad`; o texto fica dentro dela
    if (l.background.image && l.background.box) { areas.push({ r: caixa(l.background.box, 0), s: l.startFrame, e: l.endFrame }); continue; }
    areas.push({ r: caixa(l.box, pad), s: l.startFrame, e: l.endFrame });
    if (l.background.kind !== 'none' && l.background.box) areas.push({ r: caixa(l.background.box, 0), s: l.startFrame, e: l.endFrame });
  }
  const boxes = areas.map((a) => `drawbox=x=${a.r.x}:y=${a.r.y}:w=${a.r.w}:h=${a.r.h}:c=white:t=fill:enable='between(n\\,${a.s}\\,${a.e - 1})'`);
  // editor universal F-U2: com o vídeo em outra caixa/enquadramento, o quadro inteiro muda: vale o render, sem o campeão por baixo.
  // Aparado: base e áudio entram a partir de `inFrame` (o áudio copiado corta no pacote AAC mais perto).
  const ev = input.edicao?.video;
  const inicio = ev?.inFrame ? ['-ss', String(ev.inFrame / fps)] : [];
  const fimAudio = ['-t', String(frameCount / fps)];
  // `lut=c0=0` ANTES dos drawbox (troca-texto §16.7): `color=black` em gray sai Y=16 (faixa limitada), ou seja, alfa
  // 16/255 = 6,3 % do render vazando fora da máscara. Depois dos drawbox a correção falha (zera a borda do branco também).
  // Nº exato de frames por `trim` NO FILTRO, nunca `-frames:v` na saída: na ffmpeg 5.1 (a da imagem da API), `-frames:v`
  // fecha o arquivo quando o encoder recebe o N-ésimo frame e o áudio copiado perde o atraso do x264 (5 s de peça saíam
  // com 3,23 s de áudio no preset medium). O `-t` vai na ENTRADA do áudio (limita o copiado à duração do vídeo): na saída, com áudio de início negativo (02 real, lista de edição), ele cortava 1 quadro do vídeo.
  const fim = `trim=end_frame=${frameCount}`;
  // A8: +Y só com placa de base, calibrado neste render (o OffthreadVideo sai ~1-2 Y abaixo da base, e muda por máquina)
  const dy = input.placaComoBase && !ev?.pintura ? await calibrarY(ff, input, mudo) : 0;
  const corrige = dy ? `,lutyuv=y=clip(val${dy > 0 ? '+' : ''}${dy}\\,0\\,255)` : '';
  const filtro = ev?.pintura ? `[0:v]format=yuv420p,${fim}[v]` : [
    `color=c=black:s=${W}x${H}:r=${fps},format=gray,lut=c0=0${boxes.length ? ',' + boxes.join(',') : ''}[m]`,
    `[0:v]format=yuv420p,setpts=round(N/(${fps}*TB))${corrige}[top]`,
    `[top][m]alphamerge[ta]`,
    // quadro n da base = quadro n do render, pelo índice: campeão com buraco no tempo (02 real: último quadro 2/30 s depois
    // do penúltimo) virava quadro duplicado ou perdido na saída CFR (289 ou 291 contra 290). `round`: sem ele, N/(30*TB) em
    // 1/90000 dá 2999, o render fica 1 tique adiantado e o framesync pega a máscara do quadro anterior (máscara 1 quadro a mais)
    `[1:v]format=yuv420p,setpts=round(N/(${fps}*TB))[base]`,
    `[base][ta]overlay=format=yuv420:eof_action=pass:shortest=0,${fim}[v]`,
  ].join(';');
  const cor = await corDoCampeao(ff, input.baseVideoUrl);
  // (B) voz do motor: o áudio é montado antes (campeão + voz nos trechos main) e entra no lugar do passthrough
  const audioMontado = input.audioSplice ? path.join(path.dirname(saida), 'audio.montado.m4a') : null;
  if (audioMontado) {
    await montarAudioSplice({ ffmpeg: ff.ffmpeg, ffprobe: ff.ffprobe }, input.audioPassthroughUrl, input.audioSplice!, input.canvas, audioMontado);
  }
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', mudo, ...inicio, '-i', input.baseVideoUrl, ...inicio, ...fimAudio, '-i', audioMontado ?? input.audioPassthroughUrl,
    '-filter_complex', filtro, '-map', '[v]', '-map', '2:a:0?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(RENDER_REMIX.crfFinal), '-pix_fmt', 'yuv420p', ...cor,
    '-c:a', 'copy', '-movflags', '+faststart', saida];
  try {
    await execFileP(ff.ffmpeg, args, { maxBuffer: 16 * 1024 * 1024 });
  } finally {
    await rm(mudo, { force: true });
    if (audioMontado) await rm(audioMontado, { force: true });
  }
}

/** Quadro `n` do vídeo como Y (plano de luma, faixa do arquivo), W×H bytes. */
async function quadroY(ff: Pick<Ff, 'ffmpeg'>, arquivo: string, n: number, W: number, H: number): Promise<Buffer> {
  const { stdout } = await execFileP(ff.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', arquivo,
    '-vf', `select=eq(n\\,${n}),format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: W * H + 1024 });
  if (stdout.length < W * H) throw new RenderError('RENDER_ERROR', n, `calibração A8: quadro ${n} ilegível em ${path.basename(arquivo)}`);
  return stdout;
}

/** Limite da correção de Y (A8): fora disso o render está errado de outro jeito, e corrigir esconderia. */
export const A8_LIMITE_Y = 4;

/**
 * troca-texto §16.2 A8: `y = −round(mediana(render − base))` em 3 quadros do intervalo das camadas de texto, fora da tinta
 * (caixas das camadas e dos rostos com folga de 8 px). Limitado a ± A8_LIMITE_Y; fora = RENDER_ERROR. Sem constante: Mac,
 * Lambda e VPS se ajustam sozinhos (G0: −2 no Lambda, −1 na VPS).
 */
export async function calibrarY(ff: Pick<Ff, 'ffmpeg'>, input: RemixKeepRenderInput, mudo: string): Promise<number> {
  const { width: W, height: H, frameCount } = input.canvas;
  const camadas = input.textLayers.length ? input.textLayers : [{ startFrame: 0, endFrame: frameCount, box: { x: 0, y: 0, w: 0, h: 0 }, background: { box: null } }];
  const a = Math.min(...camadas.map((l) => l.startFrame)), b = Math.min(frameCount, Math.max(...camadas.map((l) => l.endFrame)));
  const quadros = [...new Set([0.2, 0.5, 0.8].map((t) => Math.min(b - 1, Math.max(a, Math.floor(a + t * (b - a))))))];
  const fora = new Uint8Array(W * H).fill(1);
  const tira = (r: { x: number; y: number; w: number; h: number }, p: number) => {
    const x0 = Math.max(0, Math.floor(r.x - p)), x1 = Math.min(W, Math.ceil(r.x + r.w + p));
    const y0 = Math.max(0, Math.floor(r.y - p)), y1 = Math.min(H, Math.ceil(r.y + r.h + p));
    for (let y = y0; y < y1; y++) fora.fill(0, y * W + x0, y * W + Math.max(x0, x1));
  };
  for (const l of input.textLayers) { tira(l.box, 8); if (l.background.box) tira(l.background.box, 8); }
  for (const o of input.overlays) tira(o.region, 8);
  const hist = new Float64Array(511);
  let n = 0;
  for (const q of quadros) {
    const [r, s] = await Promise.all([quadroY(ff, mudo, q, W, H), quadroY(ff, input.baseVideoUrl, q, W, H)]);
    for (let i = 0; i < W * H; i++) if (fora[i]) { hist[r[i] - s[i] + 255]++; n++; }
  }
  if (!n) return 0;
  let acc = 0, k = 0;
  for (; k < 511; k++) { acc += hist[k]; if (acc >= n / 2) break; }
  const mediana = k - 255;
  const y = -Math.round(mediana);
  if (Math.abs(y) > A8_LIMITE_Y) throw new RenderError('RENDER_ERROR', quadros[0], `calibração A8: render − placa = ${mediana} Y (limite ± ${A8_LIMITE_Y})`);
  return y;
}

/** Tags de cor do campeão (a QA converte pra RGB pela tag: peça sem tag e campeão bt709 = desvio de 1-2 níveis). */
export async function corDoCampeao(ff: Ff, url: string): Promise<string[]> {
  try {
    const { stdout } = await execFileP(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=color_space,color_primaries,color_transfer,color_range', '-of', 'json', url]);
    const st = JSON.parse(String(stdout)).streams?.[0] ?? {};
    const out: string[] = [];
    const ok = (v: unknown) => typeof v === 'string' && v !== 'unknown' && v !== '';
    if (ok(st.color_space)) out.push('-colorspace', st.color_space);
    if (ok(st.color_primaries)) out.push('-color_primaries', st.color_primaries);
    if (ok(st.color_transfer)) out.push('-color_trc', st.color_transfer);
    if (ok(st.color_range)) out.push('-color_range', st.color_range);
    return out;
  } catch {
    return [];
  }
}

/** Nº de frames de vídeo do arquivo (pacotes contados, não o nb_frames do cabeçalho). */
export async function contarFrames(ff: Pick<Ff, 'ffprobe'>, arquivo: string): Promise<number> {
  const { stdout } = await execFileP(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets', '-of', 'default=nw=1:nk=1', arquivo]);
  return parseInt(String(stdout).trim(), 10);
}

/** Largura, altura, fps e nº de frames (pacotes contados) do vídeo baixado. */
export async function sondarVideo(ff: Pick<Ff, 'ffprobe'>, arquivo: string): Promise<{ width: number; height: number; fps: number; frames: number }> {
  const { stdout } = await execFileP(ff.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_packets', '-of', 'json', arquivo]);
  const st = JSON.parse(String(stdout)).streams?.[0] ?? {};
  const [n, d] = String(st.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { width: Number(st.width), height: Number(st.height), fps: d ? n / d : 0, frames: parseInt(String(st.nb_read_packets), 10) };
}

/** L-D5: pôster pelo ffmpeg no MP4 pronto (sem renderStill, sem 2º render na licença). JPEG q2 ≈ o 85 do renderStill. */
export async function posterPorFfmpeg(ff: Pick<Ff, 'ffmpeg'>, video: string, poster: string, sec: number): Promise<void> {
  await execFileP(ff.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, sec)), '-i', video,
    '-frames:v', '1', '-q:v', '2', poster]);
}
