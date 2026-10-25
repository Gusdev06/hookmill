// Fronteira com a AWS (Remotion Lambda + S3), pra trocar por falso no Jest. Nada aqui roda sem chamada explícita.
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

/** Recorte do que o adaptador usa do @remotion/lambda/client (4.0.533). Tipos frouxos de propósito: o falso não depende do SDK. */
export interface ProgressoLambda {
  done: boolean;
  overallProgress: number;
  framesRendered: number;
  encodingStatus: { framesEncoded: number } | null;
  renderMetadata: { frameRange?: [number, number]; startedDate: number; totalChunks?: number; videoConfig?: { fps?: number } } | null;
  costs: { accruedSoFar: number };
  errors: { message: string; name: string; frame: number | null; isFatal: boolean; willRetry: boolean }[];
  fatalErrorEncountered: boolean;
  outBucket: string | null;
  outKey: string | null;
  outputFile: string | null;
  currentTime: number;
  timeoutTimestamp: number;
}

export interface ClienteRemotionLambda {
  renderMediaOnLambda(o: Record<string, unknown>): Promise<{ renderId: string; bucketName: string; cloudWatchLogs?: string }>;
  getRenderProgress(o: { functionName: string; bucketName: string; renderId: string; region: string; logLevel?: 'error' }): Promise<ProgressoLambda>;
  /** Lança se a assinatura não bater (mesma regra do validateWebhookSignature: HMAC-SHA512 de JSON.stringify(body)). */
  validateWebhookSignature(o: { secret: string; body: unknown; signatureHeader: string }): void;
}

export interface SaidaS3 {
  baixar(o: { region: string; bucket: string; key: string; destino: string }): Promise<void>;
  apagar(o: { region: string; bucket: string; key: string }): Promise<void>;
}

/**
 * Cliente real. As credenciais vêm de REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY (o SDK do Remotion lê sozinho).
 * `require` sem tipo DE PROPÓSITO: os .d.ts do @remotion/lambda-client importam `next` (pages-router-webhook), e o
 * global.d.ts do Next deixa `process.env.NODE_ENV` readonly em toda a api (quebra o typecheck dos specs).
 */
interface ModuloLambdaClient {
  renderMediaOnLambda(o: unknown): Promise<{ renderId: string; bucketName: string; cloudWatchLogs?: string }>;
  getRenderProgress(o: unknown): Promise<unknown>;
  validateWebhookSignature(o: { secret: string; body: unknown; signatureHeader: string }): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const moduloLambda = (): ModuloLambdaClient => require('@remotion/lambda/client') as ModuloLambdaClient;

export const clienteRemotionReal = (): ClienteRemotionLambda => ({
  renderMediaOnLambda: (o) => moduloLambda().renderMediaOnLambda(o),
  getRenderProgress: async (o) => (await moduloLambda().getRenderProgress(o)) as ProgressoLambda,
  validateWebhookSignature: (o) => moduloLambda().validateWebhookSignature(o),
});

/** S3 do Remotion (bucket remotionlambda-*), com a mesma chave do render.
 *  RENDER_LAMBDA_S3_ACCELERATE=on usa o Transfer Acceleration (o bucket precisa estar com ele ligado): da API no
 *  Mac em Bali o S3 us-east-1 dava ~60 KB/s e o acelerado 1,46 MB/s (medido 25/10). Na VPS deixe off. */
export const saidaS3Real = (env: NodeJS.ProcessEnv = process.env): SaidaS3 => {
  const clientes = new Map<string, import('@aws-sdk/client-s3').S3Client>();
  const cliente = async (region: string) => {
    const { S3Client } = await import('@aws-sdk/client-s3');
    if (!clientes.has(region)) {
      const id = env.REMOTION_AWS_ACCESS_KEY_ID, secret = env.REMOTION_AWS_SECRET_ACCESS_KEY;
      const useAccelerateEndpoint = env.RENDER_LAMBDA_S3_ACCELERATE === 'on';
      clientes.set(region, new S3Client({ region, useAccelerateEndpoint, ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret } } : {}) }));
    }
    return clientes.get(region)!;
  };
  return {
    baixar: async ({ region, bucket, key, destino }) => {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3');
      const r = await (await cliente(region)).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!r.Body) throw new Error(`s3://${bucket}/${key} sem corpo`);
      await pipeline(r.Body as Readable, createWriteStream(destino));
    },
    apagar: async ({ region, bucket, key }) => {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
      await (await cliente(region)).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
};
