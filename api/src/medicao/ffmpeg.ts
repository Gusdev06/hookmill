// Chamadas de ffmpeg/ffprobe do sistema. Sem shell (argv direto), com timeout, stdout em Buffer.
// Dentro de uma etapa da leitura (`comPrazo`, F3 do QA 01/11): no máximo LEITURA_FFMPEG_MAX processos ao mesmo tempo
// (fila, somando todas as leituras do processo) e prazo da etapa: ao estourar, os processos dela morrem e nenhum novo sobe.
import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';

export interface Bins { ffmpeg: string; ffprobe: string }

export class MediaToolError extends Error {
  constructor(public tool: string, public exitCode: number | null, public stderr: string, message: string) {
    super(message);
    this.name = 'MediaToolError';
  }
}

export interface RunResult { stdout: Buffer; stderr: string; code: number | null }

// ───────── prazo + teto de processos da leitura ─────────

/** Prazo de uma etapa da leitura estourou: os ffmpeg dela foram mortos. */
export class PrazoEsgotado extends Error {
  constructor(public etapa: string, public ms: number) { super(`${etapa}: prazo de ${Math.round(ms / 1000)} s esgotado`); this.name = 'PrazoEsgotado'; }
}

interface Etapa { nome: string; fim: number; sinal: AbortSignal }
const etapaAtual = new AsyncLocalStorage<Etapa>();

/** Teto de processos ffmpeg/ffprobe simultâneos das leituras (todas as do processo somadas). */
export function maxProcessosLeitura(): number {
  const n = Number(process.env.LEITURA_FFMPEG_MAX);
  return Number.isInteger(n) && n > 0 ? n : 2;
}
let ocupadas = 0;
const fila: (() => void)[] = [];
/** Vaga na fila de processos (só dentro de uma etapa). Devolve quem libera. Etapa abortada = rejeita. */
async function vaga(e: Etapa): Promise<() => void> {
  if (e.sinal.aborted) throw e.sinal.reason;
  if (ocupadas < maxProcessosLeitura()) ocupadas++;
  else {
    // espera alguém soltar: a vaga passa direto de quem solta pra quem espera (`ocupadas` não muda)
    await new Promise<void>((ok, falha) => {
      const entrar = () => { e.sinal.removeEventListener('abort', sair); ok(); };
      const sair = () => { const i = fila.indexOf(entrar); if (i >= 0) fila.splice(i, 1); falha(e.sinal.reason); };
      fila.push(entrar);
      e.sinal.addEventListener('abort', sair, { once: true });
    });
  }
  let solta = false;
  return () => {
    if (solta) return;
    solta = true;
    const prox = fila.shift();
    if (prox) prox(); else ocupadas--;
  };
}

/**
 * Roda `fn` como etapa da leitura: todo ffmpeg/ffprobe lançado dentro dela entra na fila de processos e morre quando o
 * prazo estoura. Estourou = rejeita com PrazoEsgotado (depois de esperar até 5 s o `fn` desmontar).
 */
export async function comPrazo<T>(nome: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const ac = new AbortController();
  const e: Etapa = { nome, fim: Date.now() + ms, sinal: ac.signal };
  const p = etapaAtual.run(e, fn);
  let timer: NodeJS.Timeout | undefined;
  const estouro = new Promise<never>((_, falha) => {
    timer = setTimeout(() => { const err = new PrazoEsgotado(nome, ms); ac.abort(err); falha(err); }, ms);
  });
  try {
    return await Promise.race([p, estouro]);
  } catch (err) {
    if (err instanceof PrazoEsgotado) await Promise.race([p.catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))]);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type Matar = (f: () => void) => void;

/** Sobe o processo (na fila e no prazo da etapa, se houver uma): `sobe` recebe o timeout efetivo e registra quem mata. */
async function lancar<T>(timeoutMs: number, sobe: (timeoutMs: number, aoMatar: Matar) => Promise<T>): Promise<T> {
  const e = etapaAtual.getStore();
  if (!e) return sobe(timeoutMs, () => undefined);
  const liberar = await vaga(e);
  let matar: (() => void) | null = null;
  const aoAbortar = () => matar?.();
  e.sinal.addEventListener('abort', aoAbortar, { once: true });
  try {
    return await sobe(Math.min(timeoutMs, Math.max(1, e.fim - Date.now())), (f) => { matar = f; if (e.sinal.aborted) f(); });
  } finally {
    e.sinal.removeEventListener('abort', aoAbortar);
    liberar();
  }
}

/** Roda e junta stdout/stderr. Saída != 0 rejeita, salvo `allowFail`. */
export function run(bin: string, args: string[], opts: { timeoutMs?: number; allowFail?: boolean } = {}): Promise<RunResult> {
  return lancar(opts.timeoutMs ?? 10 * 60_000, (timeoutMs, aoMatar) => runCru(bin, args, { ...opts, timeoutMs }, aoMatar));
}

function runCru(bin: string, args: string[], opts: { timeoutMs?: number; allowFail?: boolean }, aoMatar: Matar): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    aoMatar(() => p.kill('SIGKILL'));
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.stderr.on('data', (b: Buffer) => {
      err += b.toString('utf8');
      if (err.length > 4_000_000) err = err.slice(-2_000_000); // silencedetect de 120 s cabe folgado; isso é só teto
    });
    const timer = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 10 * 60_000);
    p.on('error', (e) => { clearTimeout(timer); reject(new MediaToolError(bin, null, '', `${bin}: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      const r = { stdout: Buffer.concat(out), stderr: err, code };
      if (code !== 0 && !opts.allowFail) {
        reject(new MediaToolError(bin, code, err, `${bin} saiu com ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
      } else resolve(r);
    });
  });
}

/**
 * Lê frames rgb24 crus em stream, um por vez, sem acumular o vídeo na memória
 * (render/medição numa VPS pequena: 1 frame 1080x1920 = 6 MB, não 120 deles).
 */
export function streamFrames(bin: string, args: string[], frameBytes: number, onFrame: (buf: Buffer, index: number) => void,
  timeoutMs = 10 * 60_000): Promise<number> {
  return lancar(timeoutMs, (t, aoMatar) => streamFramesCru(bin, args, frameBytes, onFrame, t, aoMatar));
}

function streamFramesCru(bin: string, args: string[], frameBytes: number, onFrame: (buf: Buffer, index: number) => void,
  timeoutMs: number, aoMatar: Matar): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    aoMatar(() => p.kill('SIGKILL'));
    let pend: Buffer[] = [];
    let pendLen = 0;
    let n = 0;
    let err = '';
    let failed: Error | null = null;
    p.stdout.on('data', (b: Buffer) => {
      if (failed) return;
      pend.push(b);
      pendLen += b.length;
      if (pendLen < frameBytes) return;
      const all = pend.length === 1 ? pend[0] : Buffer.concat(pend, pendLen);
      let off = 0;
      while (all.length - off >= frameBytes) {
        try { onFrame(all.subarray(off, off + frameBytes), n++); } catch (e) { failed = e as Error; p.kill('SIGKILL'); return; }
        off += frameBytes;
      }
      const rest = all.subarray(off);
      pend = rest.length ? [Buffer.from(rest)] : [];
      pendLen = rest.length;
    });
    p.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-20_000); });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(new MediaToolError(bin, null, '', `${bin}: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return reject(failed);
      if (code !== 0) return reject(new MediaToolError(bin, code, err, `${bin} saiu com ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
      resolve(n);
    });
  });
}

/**
 * Igual ao streamFrames, mas com contrapressão: `onFrame` assíncrono pausa o stdout do ffmpeg até terminar
 * (inferência mais lenta que a decodificação não acumula frames na memória).
 */
export function streamFramesAsync(bin: string, args: string[], frameBytes: number,
  onFrame: (buf: Buffer, index: number) => Promise<void>, timeoutMs = 20 * 60_000): Promise<number> {
  return lancar(timeoutMs, (t, aoMatar) => streamFramesAsyncCru(bin, args, frameBytes, onFrame, t, aoMatar));
}

function streamFramesAsyncCru(bin: string, args: string[], frameBytes: number,
  onFrame: (buf: Buffer, index: number) => Promise<void>, timeoutMs: number, aoMatar: Matar): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    aoMatar(() => p.kill('SIGKILL'));
    let pend: Buffer[] = [];
    let pendLen = 0;
    let n = 0;
    let err = '';
    let failed: Error | null = null;
    let busy: Promise<void> = Promise.resolve();
    let closed: number | null | undefined;
    const finish = () => {
      clearTimeout(timer);
      if (failed) return reject(failed);
      if (closed !== 0) return reject(new MediaToolError(bin, closed ?? null, err, `${bin} saiu com ${closed}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
      resolve(n);
    };
    p.stdout.on('data', (b: Buffer) => {
      if (failed) return;
      pend.push(b);
      pendLen += b.length;
      if (pendLen < frameBytes) return;
      const all = Buffer.concat(pend, pendLen);
      const whole = Math.floor(all.length / frameBytes);
      const chunk = all.subarray(0, whole * frameBytes);
      const rest = all.subarray(whole * frameBytes);
      pend = rest.length ? [Buffer.from(rest)] : [];
      pendLen = rest.length;
      p.stdout.pause();
      busy = busy.then(async () => {
        for (let off = 0; off < chunk.length && !failed; off += frameBytes) {
          try { await onFrame(chunk.subarray(off, off + frameBytes), n++); } catch (e) { failed = e as Error; p.kill('SIGKILL'); }
        }
        if (!failed) p.stdout.resume();
      });
    });
    p.stderr.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-20_000); });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(new MediaToolError(bin, null, '', `${bin}: ${e.message}`)); });
    p.on('close', (code) => { closed = code; void busy.then(finish); });
  });
}
