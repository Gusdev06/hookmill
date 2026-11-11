// Copia os 25 vídeos de exemplo + capas dos templates do storage de dev (Supabase hookmill-dev, via api/.env do
// checkout principal) pro storage local do worktree (minio, via api/.env do worktree) e grava as chaves no banco
// maquina_previas. Não mexe no hookmill-dev nem no banco `maquina`. Uso: node copiar-exemplos.cjs exemplos.json
const W = '/data/cerebros/gusta/projects/maquina-anuncios-wt-previas';
const MAIN = '/data/cerebros/gusta/projects/maquina-anuncios';
const { createRequire } = require('node:module');
const fs = require('node:fs');
const req = createRequire(`${W}/api/package.json`);
const dotenv = req('dotenv');
const { S3Client, GetObjectCommand, PutObjectCommand } = req('@aws-sdk/client-s3');
const { PrismaClient } = req('@prisma/client');
const env = (p) => dotenv.parse(fs.readFileSync(p));
const s3 = (e) => new S3Client({ endpoint: e.STORAGE_ENDPOINT, region: e.STORAGE_REGION, forcePathStyle: /true/i.test(e.STORAGE_FORCE_PATH_STYLE ?? ''),
  credentials: { accessKeyId: e.STORAGE_ACCESS_KEY_ID, secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY } });
const se = env(`${MAIN}/api/.env`), de = env(`${W}/api/.env`);
const src = s3(se), dst = s3(de);
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://maquina:maquina@localhost:5433/maquina_previas?schema=public' } } });
(async () => {
  const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  let ok = 0;
  for (const r of rows) {
    for (const key of [r.exampleKey, r.posterKey].filter(Boolean)) {
      const o = await src.send(new GetObjectCommand({ Bucket: se.STORAGE_BUCKET, Key: key }));
      const body = Buffer.from(await o.Body.transformToByteArray());
      await dst.send(new PutObjectCommand({ Bucket: de.STORAGE_BUCKET, Key: key, Body: body, ContentType: o.ContentType }));
    }
    const u = await db.template.updateMany({ where: { slug: r.slug }, data: { exampleKey: r.exampleKey, posterKey: r.posterKey, exampleDurationSec: r.exampleDurationSec } });
    if (u.count) ok++; else console.log('sem template no maquina_previas:', r.slug);
  }
  console.log(`exemplos ligados: ${ok}/${rows.length}`);
  await db.$disconnect();
})().catch((e) => { console.error('ERRO', e.name, e.message); process.exit(1); });
