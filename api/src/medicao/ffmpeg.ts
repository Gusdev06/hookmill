// Chamadas de ffmpeg/ffprobe do sistema. Sem shell (argv direto), com timeout, stdout em Buffer.
import { spawn } from 'node:child_process';

export interface Bins { ffmpeg: string; ffprobe: string }

export class MediaToolError extends Error {
  constructor(public tool: string, public exitCode: number | null, public stderr: string, message: string) {
    super(message);
    this.name = 'MediaToolError';
  }
}

export interface RunResult { stdout: Buffer; stderr: string; code: number | null }

/** Roda e junta stdout/stderr. Saída != 0 rejeita, salvo `allowFail`. */
export function run(bin: string, args: string[], opts: { timeoutMs?: number; allowFail?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
