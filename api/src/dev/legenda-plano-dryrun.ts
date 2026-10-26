// legenda-protegida-v1, prova do plano (SÓ LEITURA): monta o contexto do plano de um lote AUTO como o PlanoAutoService faz
// e mostra o que sai do `allowed` com `burned_captions` (tipos e molduras), sem Claude, sem escrita no banco.
// Uso: npx ts-node --transpile-only src/dev/legenda-plano-dryrun.ts <batchId>
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { editMapOf } from '../campeoes/champion-views';
import { faixasDoCampeao } from '../campeoes/faixas-protegidas';
import { planCtxOf, withCaptionGuard } from '../iteracao/contexto';
import { captionBlockedOf } from '../iteracao/plano-auto.service';
import { regrasDeMidiaFallback } from '../iteracao/portas';
import { allowedFor, allowedFrames } from '../iteracao/regras';

async function main() {
  const batchId = process.argv[2];
  if (!batchId) throw new Error('uso: legenda-plano-dryrun.ts <batchId>');
  const prisma = new PrismaClient();
  try {
    const id = batchId === 'latest' ? (await prisma.variationBatch.findFirstOrThrow({ where: { mode: 'AUTO' }, orderBy: { createdAt: 'desc' } })).id : batchId;
    const b = await prisma.variationBatch.findUniqueOrThrow({
      where: { id },
      include: { offer: true, workspace: true, items: { orderBy: { index: 'asc' } }, champion: { include: { teardown: true, videoFile: { select: { width: true, height: true } } } } },
    });
    const teardown = b.champion.teardown;
    const src = { offer: b.offer, workspace: b.workspace, champion: b.champion, teardown };
    const ctx = withCaptionGuard(planCtxOf(src, regrasDeMidiaFallback, { captured: !!b.pageCaptureFileId }), { ...src, video: b.champion.videoFile, language: b.language });
    const em = editMapOf(teardown?.editMap);
    const dims = { width: b.champion.videoFile?.width ?? 0, height: b.champion.videoFile?.height ?? 0 };
    const allowed = allowedFor(ctx);
    const out = {
      batch: b.id, champion: b.championId, video: dims, cleanVersion: b.champion.cleanVideoFileId,
      storedProtectedBands: em?.protectedBands?.length ?? null,
      protectedBands: faixasDoCampeao(em, dims),
      captionsAuto: ctx.captionsAuto,
      allowed: allowed.map((a) => `${a.type} max ${a.max}${a.blockedReason ? ` (${a.blockedReason})` : ''}`),
      frames: allowedFrames(ctx).map((f) => `${f.template}: ${f.allowed ? 'ok' : f.blockedReason}`),
      guard: ctx.caption?.blocked ?? [],
      ...captionBlockedOf(ctx, allowed),
      // validação com os textos reais do plano já salvo (a mesma conta do validatePlan; 2ª fonte = a de amostra)
      itemsDoPlanoSalvo: b.items
        .filter((it) => ['FRAME', 'HEADLINE', 'CUT', 'REVIEW', 'NATIVE_SEARCH'].includes(it.autoType ?? ''))
        .map((it) => {
          const p = ((it.payload ?? {}) as { params?: Record<string, unknown> }).params ?? {};
          const r = ctx.caption?.check({ type: it.autoType as never, params: it.autoType === 'FRAME' ? { ...p, second: null } : p }) ?? null;
          return `${it.code} ${it.autoType}${p.template ? ` ${p.template}` : ''}: ${r ? `burned_captions (${r})` : 'ok'}`;
        }),
    };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
