const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public' } } });
(async () => {
  const rows = await db.variationBatch.findMany({ where: { workspace: { name: 'AI templates QA' } }, select: { id: true, status: true, createdAt: true,
    jobs: { select: { status: true, type: true, errorCode: true } },
    creatives: { select: { state: true, scenes: { select: { index: true, status: true, errorCode: true } }, renders: { select: { status: true, errorCode: true } } } },
    templateRun: { select: { status: true, held: true, charged: true, refunded: true } },
  }, orderBy: { createdAt: 'desc' }, take: 10 });
  console.log(JSON.stringify(rows, null, 2));
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
