// Executor local das ops Python (PLATE_IMPL=local): só para desenvolver, nunca para decidir portão (§15.6.4: o que vale é
// a Lambda, onde DIS e x264 dão o resultado que o Gusta viu). Roda py/worker.py com python3 (TROCA_PYTHON) e caminhos locais.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { EventoTroca, ExecutorTroca, RespostaTroca, SaidaTroca } from './evento';

const execFileP = promisify(execFile);

/** Onde mora o Python da troca: src/medicao/troca/py (em dist, o build não copia .py: aponta para src). */
export function pastaPython(cfg?: string | null): string {
  if (cfg) return cfg;
  const aqui = path.resolve(__dirname, 'py');
  return aqui.includes(`${path.sep}dist${path.sep}`) ? aqui.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`) : aqui;
}

export interface StorageLocalDaTroca {
  /** sobe um arquivo local para a chave (FileKind CHAMPION_PLATE) */
  putFile(key: string, file: string, contentType: string): Promise<void>;
}

export interface ExecutorLocalConfig {
  python: string;
  pyDir: string;
  fontesDir: string;
  ffmpeg?: string;
  ffprobe?: string;
  timeoutMs?: number;
}

export class ExecutorLocal implements ExecutorTroca {
  readonly impl = 'local' as const;
  private dir: string | null = null;
  constructor(private readonly cfg: ExecutorLocalConfig, private readonly storage: StorageLocalDaTroca) {}

  private async base(): Promise<string> {
    this.dir ??= await mkdtemp(path.join(os.tmpdir(), 'troca-'));
    return this.dir;
  }

  async executar(ev: EventoTroca): Promise<{ r: RespostaTroca; costUsd: number; ms: number }> {
    const t0 = Date.now();
    const d = path.join(await this.base(), randomUUID());
    await mkdir(d, { recursive: true });
    const ej = path.join(d, 'ev.json'), rj = path.join(d, 'res.json');
    await writeFile(ej, JSON.stringify({ ...ev, tmp: path.join(d, 'job') }));
    try {
      await execFileP(this.cfg.python, [path.join(this.cfg.pyDir, 'worker.py'), ej, rj], {
        timeout: this.cfg.timeoutMs ?? 600_000, maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', FONTES_DIR: this.cfg.fontesDir, FFMPEG_PATH: this.cfg.ffmpeg ?? 'ffmpeg', FFPROBE_PATH: this.cfg.ffprobe ?? 'ffprobe', PATH: process.env.PATH ?? '' },
      });
      const r = JSON.parse(await readFile(rj, 'utf8')) as RespostaTroca;
      return { r, costUsd: 0, ms: Date.now() - t0 };
    } finally {
      await rm(ej, { force: true });
      await rm(rj, { force: true });
    }
  }

  async destino(nome: string): Promise<SaidaTroca> {
    const f = path.join(await this.base(), 'saida', `${randomUUID()}-${nome}`);
    await mkdir(path.dirname(f), { recursive: true });
    return { destino: f, ref: f };
  }

  async origem(s: SaidaTroca): Promise<string> {
    return s.ref;
  }

  async publicar(s: SaidaTroca, chave: string, contentType: string): Promise<void> {
    await stat(s.ref);
    await this.storage.putFile(chave, s.ref, contentType);
  }

  async apagar(s: SaidaTroca): Promise<void> {
    await rm(s.ref, { force: true });
  }
}
