// Invocador real da função de leitura (@aws-sdk/client-lambda, Invoke síncrono). Credenciais: as do render
// (REMOTION_AWS_*), que podem invocar a função pela política de recurso dela (scripts/leitura-lambda.mjs).
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { EventoLeitura, RespostaLeitura } from './contrato';
import { ErroInvocacao, type InvocadorLambda } from './lambda';

export interface InvocadorAwsConfig {
  region: string;
  functionName: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  /** Espera máxima de uma invocação (a função tem 600 s de teto). */
  timeoutMs: number;
}

export class InvocadorAws implements InvocadorLambda {
  private readonly cli: LambdaClient;
  constructor(private readonly cfg: InvocadorAwsConfig) {
    this.cli = new LambdaClient({
      region: cfg.region,
      maxAttempts: 1, // retentativa = fallback local, não outra invocação de 5 min
      credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
      requestHandler: { requestTimeout: cfg.timeoutMs, connectionTimeout: 10_000 } as never,
    });
  }

  async invocar(evento: EventoLeitura): Promise<RespostaLeitura> {
    let out;
    try {
      out = await this.cli.send(new InvokeCommand({ FunctionName: this.cfg.functionName, InvocationType: 'RequestResponse', Payload: Buffer.from(JSON.stringify(evento)) }));
    } catch (e) {
      const name = (e as Error).name ?? '';
      if (/TooManyRequests|Throttl|Rate exceeded/i.test(`${name} ${(e as Error).message}`)) throw new ErroInvocacao('throttle', `${name}: ${(e as Error).message}`);
      if (/Timeout|ETIMEDOUT|socket hang up/i.test(`${name} ${(e as Error).message}`)) throw new ErroInvocacao('timeout', `${name}: ${(e as Error).message}`);
      throw new ErroInvocacao('rede', `${name}: ${(e as Error).message}`);
    }
    const txt = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '';
    if (out.FunctionError) {
      // erro não tratado no handler (timeout da função, memória, exceção fora do try): {errorType, errorMessage}
      let msg = txt.slice(0, 500);
      try { const j = JSON.parse(txt); msg = `${j.errorType ?? 'Error'}: ${j.errorMessage ?? ''}`; } catch { /* texto cru */ }
      throw new ErroInvocacao(/timed out/i.test(msg) ? 'timeout' : 'function_error', `${out.FunctionError}: ${msg}`);
    }
    try {
      return JSON.parse(txt) as RespostaLeitura;
    } catch {
      throw new ErroInvocacao('resposta', `resposta não é JSON: ${txt.slice(0, 200)}`);
    }
  }
}
