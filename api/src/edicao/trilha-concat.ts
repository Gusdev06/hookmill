// Bug em live 25/10 (re-render das 6 molduras de 2 fontes): cada trilha tinha 19 arquivos; no Lambda cada pedaço baixa
// todos do Supabase → centenas de GETs ao mesmo tempo → 429. Correção: a trilha de UMA variante vira 1 MP4 mudo, montado
// na API com ffmpeg (cada trecho cortado, cover 1080×1920, 30 fps, h264, na duração exata do trecho; clipe curto
// desacelera até 0,6x e segura o último quadro, como a composição faz) e o `broll_track` aponta todos os clipes pra esse
// arquivo único, com `srcStartSec`/`srcEndSec` = posição dele no arquivo. A composição (video/src/molduras/base.tsx,
// TrilhaBroll) toca cada clipe com trimBefore/trimAfter no próprio arquivo: sem mudança no video.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { BrollTrack } from './trilha-broll';

const run = promisify(execFile);
export const CONCAT = { width: 1080, height: 1920, fps: 30, minRate: 0.6 } as const;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Frames de cada clipe na grade de 30 fps (soma exata da duração da peça, sem deriva de arredondamento). */
export function posicoesNoArquivo(track: BrollTrack, fps: number = CONCAT.fps): { frames: number; srcStartSec: number; srcEndSec: number }[] {
  let acc = 0;
  return track.clips.map((c) => {
    const fim = Math.round(c.toSec * fps);
    const ini = Math.round(c.fromSec * fps);
    const frames = Math.max(1, fim - ini);
    const out = { frames, srcStartSec: r3(acc / fps), srcEndSec: r3((acc + frames) / fps) };
    acc += frames;
    return out;
  });
}

/** O `broll_track` com todos os clipes no arquivo único (proveniência e fala de cada clipe original intactas). */
export function trilhaNoArquivo(track: BrollTrack, fileUrl: string): BrollTrack {
  const pos = posicoesNoArquivo(track);
  return { kind: 'broll_track', clips: track.clips.map((c, k) => ({ ...c, fileUrl, srcStartSec: pos[k].srcStartSec, srcEndSec: pos[k].srcEndSec })) };
}

/** Chave do cache: muda se qualquer clipe/trecho mudar (trilha nova = arquivo novo). */
export function chaveDaTrilha(track: BrollTrack): string {
  const canon = track.clips.map((c) => `${c.fromSec}-${c.toSec}|${c.fileUrl.split('?')[0]}|${c.srcStartSec}-${c.srcEndSec}`).join('\n');
  return createHash('sha1').update(canon).digest('hex').slice(0, 16);
}

/** Filtro do trecho: cover no quadro, 30 fps, desacelera até 0,6x se curto, segura o último quadro até a duração. */
export function filtroDoTrecho(srcLen: number, durSec: number, o = CONCAT): string {
  const rate = srcLen >= durSec ? 1 : Math.max(o.minRate, srcLen / durSec);
  const tocando = srcLen / rate;
  const segurar = Math.max(0, durSec - tocando);
  return [
    `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase`, `crop=${o.width}:${o.height}`, 'setsar=1',
    ...(rate < 1 ? [`setpts=PTS/${r3(rate)}`] : []),
    `fps=${o.fps}`,
    // sempre com folga: o arquivo real pode ser mais curto que o trecho declarado (corte da ia, fim do vídeo); o
    // `-frames:v` corta no nº exato de frames do trecho
    `tpad=stop_mode=clone:stop_duration=${r3(segurar + durSec + 0.5)}`,
  ].join(',');
}

export interface ConcatDeps {
  /** baixa a URL pro caminho (com espera e nova tentativa no 429 do storage) */
  baixar(url: string, path: string): Promise<void>;
  ffmpeg?: string;
  ffprobe?: string;
}

/** Frames de vídeo de um arquivo (ffprobe -count_frames). */
export async function contarFrames(path: string, ffprobe = process.env.FFPROBE_PATH || 'ffprobe'): Promise<number> {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', path], { timeout: 60_000 });
  return Number(String(stdout).trim()) || 0;
}

/** Monta o MP4 único da trilha num diretório temporário. Devolve o caminho (quem chama sobe e apaga `dir`). */
export async function concatenarTrilha(track: BrollTrack, d: ConcatDeps): Promise<{ path: string; dir: string; durationSec: number }> {
  const ff = d.ffmpeg ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const dir = await mkdtemp(join(tmpdir(), 'trilha-'));
  try {
    const pos = posicoesNoArquivo(track);
    const baixados = new Map<string, string>();
    const partes: string[] = [];
    for (const [k, c] of track.clips.entries()) {
      const chave = c.fileUrl.split('?')[0];
      let src = baixados.get(chave);
      if (!src) {
        src = join(dir, `src-${baixados.size}${/\.png(\?|$)/i.test(c.fileUrl) ? '.png' : '.mp4'}`);
        await d.baixar(c.fileUrl, src); // em série: nada de rajada no storage
        baixados.set(chave, src);
      }
      const durSec = pos[k].frames / CONCAT.fps;
      const imagem = src.endsWith('.png');
      const srcLen = imagem ? durSec : Math.max(0.04, c.srcEndSec - c.srcStartSec);
      const out = join(dir, `parte-${k}.mp4`);
      const codificar = async (inicio: number) => {
        const entrada = imagem ? ['-loop', '1', '-t', String(r3(durSec + 0.2)), '-i', src] : ['-ss', String(inicio), '-t', String(r3(srcLen)), '-i', src];
        await run(ff, [
          '-hide_banner', '-v', 'error', '-y', ...entrada, '-an',
          '-vf', filtroDoTrecho(srcLen, durSec), '-frames:v', String(pos[k].frames),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(CONCAT.fps), out,
        ], { timeout: 180_000, maxBuffer: 1 << 20 });
        return contarFrames(out, d.ffprobe);
      };
      // o arquivo pode já ser só o trecho cortado (srcStartSec relativo ao vídeo original): sem frames no início pedido =
      // codifica do começo do arquivo; ainda curto = erro (nunca uma trilha fora de sincronia com a fala)
      let n = await codificar(c.srcStartSec);
      if (n < pos[k].frames && !imagem && c.srcStartSec > 0) n = await codificar(0);
      if (n !== pos[k].frames) throw new Error(`trilha: trecho ${k} saiu com ${n} de ${pos[k].frames} frames`);
      partes.push(out);
    }
    const lista = join(dir, 'lista.txt');
    await writeFile(lista, partes.map((p) => `file '${p}'`).join('\n'));
    const path = join(dir, 'trilha.mp4');
    await run(ff, ['-hide_banner', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-an', '-movflags', '+faststart', path], { timeout: 180_000 });
    const total = pos.reduce((a, p) => a + p.frames, 0) / CONCAT.fps;
    return { path, dir, durationSec: r3(total) };
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
}

/** GET com espera exponencial no 429/5xx do storage (rate limit do Supabase); 4 tentativas. */
export async function baixarComEspera(url: string, path: string, o: { tentativas?: number; esperaMs?: number; fetchImpl?: typeof fetch } = {}): Promise<void> {
  const f = o.fetchImpl ?? fetch;
  const n = o.tentativas ?? 4;
  let espera = o.esperaMs ?? 800;
  for (let k = 1; ; k++) {
    const r = await f(url);
    if (r.ok) {
      await writeFile(path, Buffer.from(await r.arrayBuffer()));
      return;
    }
    if ((r.status === 429 || r.status >= 500) && k < n) {
      await new Promise((res) => setTimeout(res, espera));
      espera *= 2;
      continue;
    }
    throw new Error(`b-roll: download ${r.status}`);
  }
}

/**
 * Chave do objeto a partir da URL assinada do NOSSO storage (path style: `/<…>/<bucket>/<chave>?X-Amz-…`). A trilha do lote
 * fica gravada com URLs assinadas (6 h); retry depois disso re-assina pela chave. URL de fora do bucket = null.
 */
export function chaveDoStorage(url: string, bucket: string): string | null {
  try {
    const u = new URL(url);
    const partes = u.pathname.split('/').filter(Boolean);
    const k = partes.indexOf(bucket);
    return k >= 0 && k < partes.length - 1 ? decodeURIComponent(partes.slice(k + 1).join('/')) : null;
  } catch {
    return null;
  }
}
