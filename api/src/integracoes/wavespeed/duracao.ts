// Duração de uma mídia por URL (ffprobe lê só o cabeçalho pela rede). Usada pra cobrar o que a WaveSpeed
// cobra: segundos de áudio no lipsync e segundos de mídia na transcrição. Falhou = null (quem chama estima).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export type ProbeSeconds = (url: string) => Promise<number | null>;

export const ffprobeSeconds: ProbeSeconds = async (url) => {
  try {
    const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url], { timeout: 20_000 });
    const s = Number(stdout.trim());
    return Number.isFinite(s) && s > 0 ? s : null;
  } catch {
    return null;
  }
};
