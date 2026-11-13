// 13/11: conserta a legenda dos campeões já analisados cuja camada `caption` ficou só com a caixa da visão (o GPT da Kie
// errou a escala do y; a legenda "pill" pulava o refino por pixel). Mede de novo com o captionBox (o mesmo da leitura),
// atualiza box/background.box/source da camada e recalcula `editMap.protectedBands`. Só escreve com --apply.
// Rodar (de api/): npx ts-node -T src/dev/reparar-legenda-pixel.ts [--apply]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { captionBox } from '../medicao/legenda';
import { comFaixasProtegidas } from '../campeoes/faixas-protegidas';

const envOf = (p: string) => {
  const e: Record<string, string> = {};
  for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=([^#\n]*)/); if (m) e[m[1]] = m[2].trim().replace(/^"|"$/g, ''); }
  return e;
};
const prod = envOf('../.infra/env-producao-2026-10-28.env');
const apply = process.argv.includes('--apply');
const bins = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' } as never;

(async () => {
  const url = new URL(prod.DIRECT_URL);
  if (url.hostname !== 'aws-0-us-east-1.pooler.supabase.com' || url.searchParams.get('schema') !== 'hookmill') throw new Error('destino inesperado');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const s3 = new S3Client({ endpoint: prod.STORAGE_ENDPOINT, region: prod.STORAGE_REGION, forcePathStyle: true, credentials: { accessKeyId: prod.STORAGE_ACCESS_KEY_ID, secretAccessKey: prod.STORAGE_SECRET_ACCESS_KEY } });
  const dir = mkdtempSync(join(tmpdir(), 'reparo-legenda-'));
  try {
    const ts = await db.teardown.findMany({ select: { id: true, championId: true, editMap: true, transcript: true, champion: { select: { videoFileId: true } } } });
    for (const t of ts) {
      const m = t.editMap as unknown as { layers?: any[]; protectedBands?: unknown } | null;
      const alvo = (m?.layers ?? []).filter((l) => l.kind === 'caption' && l.source !== 'vision+pixel');
      if (!m || !alvo.length || !t.champion.videoFileId) continue;
      const f = await db.file.findUniqueOrThrow({ where: { id: t.champion.videoFileId } });
      const meta = { width: f.width ?? undefined, height: f.height ?? undefined, fps: undefined as number | undefined };
      const video = join(dir, `${t.championId}.mp4`);
      const o = await s3.send(new GetObjectCommand({ Bucket: prod.STORAGE_BUCKET, Key: f.storageKey }));
      writeFileSync(video, Buffer.from(await o.Body!.transformToByteArray()));
      // o `meta` do arquivo pode vir vazio: as dimensões e o fps saem do próprio vídeo (ffprobe)
      const pr = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', video]).toString().trim().split(',');
      const [num, den] = (pr[2] ?? '30/1').split('/').map(Number);
      const width = Number(pr[0]) || meta.width || 1080, height = Number(pr[1]) || meta.height || 1920, fps = den ? num / den : meta.fps ?? 30;
      const words = ((t.transcript as { words?: { startSec: number; endSec: number }[] })?.words ?? []);
      let mudou = false;
      const layers = [];
      for (const l of m.layers ?? []) {
        if (!alvo.includes(l)) { layers.push(l); continue; }
        const at = words.map((w) => Math.round(((w.startSec + w.endSec) / 2) * 1000) / 1000).filter((s) => s * fps >= l.startFrame && s * fps < l.endFrame);
        const box = at.length >= 2 ? await captionBox(bins, video, { w: width, h: height }, at, l.box) : null;
        console.log(t.championId, l.id, `${l.background?.kind} y${l.box.y}h${l.box.h}`, '→', box ? `y${box.y}h${box.h} x${box.x}w${box.w}` : 'NÃO ACHOU (fica)');
        if (!box) { layers.push(l); continue; }
        mudou = true;
        layers.push({ ...l, box, background: l.background?.kind === 'none' ? l.background : { ...l.background, box }, source: 'vision+pixel' });
      }
      if (!mudou) continue;
      const { protectedBands: _velho, ...resto } = m;
      const novo = comFaixasProtegidas({ ...resto, layers } as never, { width, height }) as { protectedBands?: { y: number; h: number }[] };
      console.log('   faixas', JSON.stringify((m.protectedBands as { y: number; h: number }[] | undefined)?.map((b) => [b.y, b.h])), '→', JSON.stringify(novo.protectedBands?.map((b) => [b.y, b.h])));
      if (apply) {
        await db.teardown.update({ where: { id: t.id }, data: { editMap: novo as unknown as Prisma.InputJsonValue } });
        console.log('   gravado');
      }
    }
    if (!apply) console.log('\n(simulação: nada gravado; use --apply)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await db.$disconnect();
  }
})();
