// Executor lambda das ops (PLATE_IMPL=lambda): invoca a função `hookmill-legenda` (scripts/legenda-lambda.mjs). Dono: video.
// Arquivos entram e saem por GET/PUT pré-assinado; a role da função só tem CloudWatch Logs. Custo = REPORT da invocação
// (Billed Duration × memória × preço arm64), lido do LogResult, sem Cost Explorer.
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { randomUUID } from 'node:crypto';
import type { EventoTroca, ExecutorTroca, RespostaTroca, SaidaTroca } from './evento';

/** Preço público do Lambda arm64 em us-east-1, por GB-s (verificado em 05/11 na S1). */
export const PRECO_GBS_ARM = 0.0000133334;
export const PRECO_INVOCACAO = 0.0000002;

export interface InvocadorTroca {
  invocar(payload: EventoTroca): Promise<{ resposta: RespostaTroca; billedMs: number | null; memMb: number | null }>;
}

export interface StorageDaTroca {
  presignPut(key: string, opts: { contentType: string; expiresInSec: number }): Promise<string>;
  presignGet(key: string, opts: { expiresInSec: number }): Promise<string>;
  remove(key: string): Promise<void>;
  /** prefixo dos temporários (pedaços); fora de `renders/`, com expiração própria no bucket */
  tmpPrefix: string;
}

/** Lê "Billed Duration: 1234 ms" e "Memory Size: 3008 MB" da linha REPORT (LogType Tail, base64). */
export function lerReport(logBase64: string | undefined): { billedMs: number | null; memMb: number | null } {
  if (!logBase64) return { billedMs: null, memMb: null };
  const t = Buffer.from(logBase64, 'base64').toString('utf8');
  const b = /Billed Duration:\s*(\d+)\s*ms/.exec(t), m = /Memory Size:\s*(\d+)\s*MB/.exec(t);
  return { billedMs: b ? Number(b[1]) : null, memMb: m ? Number(m[1]) : null };
}

export class InvocadorTrocaAws implements InvocadorTroca {
  private readonly cli: LambdaClient;
  constructor(private readonly cfg: { region: string; functionName: string; accessKeyId: string | null; secretAccessKey: string | null; timeoutMs: number }) {
    this.cli = new LambdaClient({
      region: cfg.region, maxAttempts: 1,
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
      requestHandler: { requestTimeout: cfg.timeoutMs, connectionTimeout: 10_000 } as never,
    });
  }

  async invocar(payload: EventoTroca) {
    const out = await this.cli.send(new InvokeCommand({
      FunctionName: this.cfg.functionName, InvocationType: 'RequestResponse', LogType: 'Tail', Payload: Buffer.from(JSON.stringify(payload)),
    }));
    const txt = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '';
    const rep = lerReport(out.LogResult);
    if (out.FunctionError) {
      let msg = txt.slice(0, 500);
      try { const j = JSON.parse(txt); msg = `${j.errorType ?? 'Error'}: ${j.errorMessage ?? ''}`; } catch { /* texto cru */ }
      return { resposta: { op: String(payload.op), ok_op: false, proc_ok: false, erro: `${out.FunctionError}: ${msg}` }, ...rep };
    }
    return { resposta: JSON.parse(txt) as RespostaTroca, ...rep };
  }
}

export class ExecutorLambda implements ExecutorTroca {
  readonly impl = 'lambda' as const;
  constructor(private readonly inv: InvocadorTroca, private readonly storage: StorageDaTroca, private readonly cfg: { urlTtlSec: number; memMb: number }) {}

  async executar(ev: EventoTroca) {
    const t0 = Date.now();
    const { resposta, billedMs, memMb } = await this.inv.invocar(ev);
    const gbs = ((billedMs ?? 0) / 1000) * ((memMb ?? this.cfg.memMb) / 1024);
    return { r: resposta, costUsd: gbs * PRECO_GBS_ARM + PRECO_INVOCACAO, ms: Date.now() - t0 };
  }

  async destino(nome: string, contentType: string, chaveFinal?: string): Promise<SaidaTroca> {
    const key = chaveFinal ?? `${this.storage.tmpPrefix.replace(/\/$/, '')}/${randomUUID()}/${nome}`;
    return { destino: await this.storage.presignPut(key, { contentType, expiresInSec: this.cfg.urlTtlSec }), ref: key };
  }

  async origem(s: SaidaTroca): Promise<string> {
    return this.storage.presignGet(s.ref, { expiresInSec: this.cfg.urlTtlSec });
  }

  async publicar(s: SaidaTroca, chave: string): Promise<void> {
    if (s.ref !== chave) throw new Error(`placa em ${s.ref}, esperada em ${chave}`);
  }

  async apagar(s: SaidaTroca): Promise<void> {
    await this.storage.remove(s.ref);
  }
}
