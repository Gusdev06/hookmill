// Prova SEM render (bug 429, 25/10): a trilha gravada do lote real → 1 MP4 por variante, conferido por ffprobe. Não sobe nada, não gasta.
//   cd api && npx ts-node --transpile-only src/dev/trilha-concat-prova.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { execFileSync } from 'node:child_process';
import { montarTrilha, type TrilhaDoLote } from '../edicao/trilha-broll';
import { baixarComEspera, chaveDoStorage, concatenarTrilha, posicoesNoArquivo } from '../edicao/trilha-concat';

(async () => {
  const prisma = new PrismaClient();
  const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: 'cmvnlm4yd000l22emdoob1j5a' }, select: { settings: true } });
  const t = (b.settings as { brollTrack?: TrilhaDoLote }).brollTrack;
  if (!t) throw new Error('lote sem trilha gravada');
  const s3 = new S3Client({ region: process.env.STORAGE_REGION, endpoint: process.env.STORAGE_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY! } });
  const bucket = process.env.STORAGE_BUCKET!;
  const baixar = async (url: string, p: string) => {
    try { await baixarComEspera(url, p); } catch (e) {
      const key = chaveDoStorage(url, bucket);
      if (!key) throw e;
      await baixarComEspera(await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 600 }), p);
    }
  };
  for (const v of [0, 1, 2]) {
    const track = montarTrilha(t, v)!;
    const t0 = Date.now();
    const r = await concatenarTrilha(track, { baixar });
    const probe = execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate', '-of', 'csv=p=0', r.path]).toString().trim();
    const esperado = posicoesNoArquivo(track).reduce((a, p) => a + p.frames, 0);
    const out = `/private/tmp/claude-501/-Users-gustagoat-Documents-AIS-OS-projects-maquina-anuncios/fdffc8fa-5f3d-4686-ac0f-25f711afef1a/scratchpad/concat/variante-${v}.mp4`;
    execFileSync('cp', [r.path, out]);
    console.log(`variante ${v}: ${track.clips.length} clipes → ${probe} (esperado ${esperado} frames, ${r.durationSec} s) em ${Math.round((Date.now() - t0) / 1000)} s · ${out}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
