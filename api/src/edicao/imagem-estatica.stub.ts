// SÓ TESTE (int specs do backend, rev. 23/10 §14.3): stub da porta `submitStaticImage` enquanto a R-I (maquina-ia) não
// entrega o fake dela, e pra controlar o desfecho por teste. Faz o que o contrato manda a ia fazer: grava a provider_task
// (kind STATIC_IMAGE, render_id, input.prompt), fecha em `delayMs` (COMPLETED com PNG sintético da rota mock-media, ou
// FAILED SAFETY_BLOCK / TIMEOUT), grava a cost_entry IMAGE só no COMPLETED e emite `provider.task.finished`.
// Modos (espelho dos gatilhos do §14.7): ok · reject (1ª sem `safe` recusa; o reenvio `safe` passa) · reject-all · timeout
// (1ª tentativa TIMEOUT; o reenvio passa).
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { GENERATION_SERVICE, PROVIDER_TASK_FINISHED } from '../integracoes';
import type { Submitted, SubmitStaticImageInput } from '../integracoes/contrato';
import { mockMediaUrl, seedOf } from '../integracoes/mock/midia';
import { PrismaService } from '../prisma/prisma.service';

export type StaticStubMode = 'ok' | 'reject' | 'reject-all' | 'timeout' | 'throw';

export interface StaticStub { mode: StaticStubMode; calls: SubmitStaticImageInput[]; usd: number }

const FORMAT_OF_ASPECT = { '9:16': 'VERTICAL_9_16', '4:5': 'PORTRAIT_4_5', '1:1': 'SQUARE_1_1' } as const;

export function installStaticImageStub(app: INestApplication, opts: { publicApiUrl: string; usd?: number; delayMs?: number }): StaticStub {
  const gen = app.get(GENERATION_SERVICE) as unknown as { submitStaticImage: (i: SubmitStaticImageInput) => Promise<Submitted> };
  const prisma = app.get(PrismaService);
  const bus = app.get(EventEmitter2);
  const stub: StaticStub = { mode: 'ok', calls: [], usd: opts.usd ?? 0.22 };
  const model = 'openai/gpt-image-2/text-to-image';
  gen.submitStaticImage = async (i) => {
    stub.calls.push(i);
    if (stub.mode === 'throw') throw Object.assign(new Error('stub: provider down'), { code: 'PROVIDER_UNAVAILABLE' });
    const attempt = stub.calls.filter((c) => c.renderId === i.renderId).length;
    const t = await prisma.providerTask.create({
      data: {
        workspaceId: i.workspaceId, kind: 'STATIC_IMAGE', model, externalId: `mock_static_${randomUUID()}`, status: 'SUBMITTED',
        input: { prompt: `stub ${i.spec.headline}`, aspectRatio: i.aspectRatio, safe: i.safe }, renderId: i.renderId, estimatedUsd: stub.usd,
      },
    });
    const mode = stub.mode;
    const fail = mode === 'reject-all' || (mode === 'reject' && !i.safe) ? 'SAFETY_BLOCK' : mode === 'timeout' && attempt === 1 ? 'TIMEOUT' : null;
    setTimeout(() => {
      void (async () => {
        const status = fail === 'SAFETY_BLOCK' ? 'FAILED' : fail === 'TIMEOUT' ? 'TIMEOUT' : 'COMPLETED';
        const errorCode = fail === 'SAFETY_BLOCK' ? 'SAFETY_BLOCK' : fail === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : null;
        const outputUrls = status === 'COMPLETED' ? [mockMediaUrl(opts.publicApiUrl, { kind: 'face', seed: seedOf(t.id), format: FORMAT_OF_ASPECT[i.aspectRatio] })] : [];
        await prisma.providerTask.update({ where: { id: t.id }, data: { status, outputUrls, errorCode, completedAt: new Date() } });
        if (status === 'COMPLETED') {
          await prisma.costEntry.create({
            data: {
              workspaceId: i.workspaceId, creativeId: i.creativeId, variationBatchId: i.variationBatchId, provider: 'WAVESPEED', kind: 'IMAGE',
              model, units: 1, unit: 'image', amountUsd: stub.usd, providerTaskId: t.id,
            },
          });
        }
        bus.emit(PROVIDER_TASK_FINISHED, { providerTaskId: t.id, kind: 'STATIC_IMAGE', status, outputUrls, errorCode, renderId: i.renderId });
      })().catch((e) => console.error('[static stub]', e));
    }, opts.delayMs ?? 300);
    return { providerTaskId: t.id, externalId: t.externalId, estimatedUsd: stub.usd };
  };
  return stub;
}
