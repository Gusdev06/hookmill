/**
 * Prova do caminho Moldura (kind 'frame') no Remotion Lambda pelo adaptador de verdade (render-lambda-v1, molduras §B2).
 * Sobe o take de fixture pro storage de dev (STORAGE_*, Supabase `hookmill-dev`), assina, monta o FrameRenderInput com o
 * buildFrameInput (o mesmo do FRAME_BUILDER), submit → snapshot (polling) → finalize → release. Custo: ~US$ 0,01.
 *
 * Uso (de api/, com o api/.env no ambiente): npx ts-node --transpile-only src/render/lambda/moldura-real.ts [template] [saida-dir]
 *   template: news (padrão) | question_box (rosto do faceAtSec) | call (2ª fonte: foto do produto)
 */
import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FrameSpec } from '../../integracoes/contrato';
import type { AutoEditContext } from '../auto-edit';
import { buildFrameInput } from '../frame';
import { lambdaConfig } from './config';
import { LambdaRenderPort } from './lambda-render.port';

const env = (k: string) => process.env[k];
const raizVideo = path.resolve(__dirname, '../../../../video');

async function main() {
  const template = (process.argv[2] ?? 'news') as FrameSpec['template'];
  const saida = path.resolve(process.argv[3] ?? path.join(raizVideo, 'out', 'sonda-lambda-l1', 'moldura-real'));
  mkdirSync(saida, { recursive: true });
  const s3 = new S3Client({
    endpoint: env('STORAGE_ENDPOINT'), region: env('STORAGE_REGION'), forcePathStyle: true,
    credentials: { accessKeyId: env('STORAGE_ACCESS_KEY_ID')!, secretAccessKey: env('STORAGE_SECRET_ACCESS_KEY')! },
  });
  const Bucket = env('STORAGE_BUCKET')!;
  const subir = async (arq: string, tipo: string) => {
    const Key = `_lambda-prova/${Date.now()}-${path.basename(arq)}`;
    await s3.send(new PutObjectCommand({ Bucket, Key, Body: readFileSync(arq), ContentType: tipo }));
    return { Key, url: await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 21600 }) };
  };
  const take = await subir(path.join(raizVideo, 'public/fixtures/real-take.mp4'), 'video/mp4');
  const foto = template === 'call' ? await subir(path.join(raizVideo, 'public/fixtures/rosto-kling.jpg'), 'image/jpeg') : null;

  const ctx = {
    renderId: `prova-${template}-${Date.now()}`, type: 'FRAME', params: { type: 'FRAME' }, language: 'pt',
    source: { videoUrl: take.url, width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true },
    editMap: {
      width: 960, height: 960, fps: 24, frameCount: 745, layers: [],
      faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
    },
    words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Coluna Leve', page: null,
  } as unknown as AutoEditContext;
  const textos: Record<string, unknown> = {
    news: { topic: 'Saúde', headline: { lead: 'Rotina de 10 minutos mostra:', highlight: 'a dor da manhã começa na noite' }, dek: 'Movimentos leves antes de deitar soltam a lombar.', cta: 'Toque no botão e veja' },
    question_box: { question: 'Por que eu acordo com *mais dor* do que quando fui dormir?' },
    call: { title: 'Rotina noturna · Coluna Leve', slideTitle: 'Noite 1: *soltar a lombar*', slideSteps: ['Respirar e soltar o quadril', 'Gato-vaca bem devagar'] },
  };
  const spec = {
    template, texts: textos[template], screenLanguage: 'pt', brand: { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' },
    faceAtSec: template === 'question_box' ? 3.2 : null, second: foto ? { kind: 'product_photo', fileUrl: foto.url } : null, suggestedPrimaryText: null,
  } as unknown as FrameSpec;
  const input = buildFrameInput(spec, ctx, 'VERTICAL_9_16');

  const cfg = lambdaConfig((k) => (k === 'RENDER_LAMBDA_WEBHOOK' ? 'off' : k === 'RENDER_TMP_DIR' ? path.join(saida, 'tmp') : env(k)));
  const porta = new LambdaRenderPort(cfg, { templates: () => [] });
  const t0 = Date.now();
  const sub = await porta.submit(input, { attempt: 0, webhookUrl: null });
  console.log(`submit ok: ${sub.externalId} (${cfg.functionName}, ${cfg.serveUrl})`);
  for (;;) {
    await new Promise((r) => setTimeout(r, cfg.pollMs));
    const s = await porta.snapshot(sub);
    process.stdout.write(`\r${s.state} ${s.progress.stage} ${s.progress.progress}% frame ${s.progress.frame}/${s.progress.totalFrames} US$ ${s.costUsd ?? '-'}   `);
    if (s.state !== 'running') { console.log(''); if (s.state !== 'done') throw new Error(JSON.stringify(s.error)); break; }
  }
  const r = await porta.finalize(input, sub);
  const final = path.join(saida, `${template}-9x16.mp4`);
  copyFileSync(r.outputPath, final);
  copyFileSync(r.posterPath, path.join(saida, `${template}-9x16-poster.jpg`));
  await porta.release(input, sub);
  for (const k of [take.Key, foto?.Key].filter(Boolean) as string[]) await s3.send(new DeleteObjectCommand({ Bucket, Key: k }));
  console.log(JSON.stringify({ template, paredeS: (Date.now() - t0) / 1000, durationSec: r.durationSec, width: r.width, height: r.height, sizeBytes: r.sizeBytes, costUsd: r.costUsd, arquivo: final }));
}

main().catch((e) => { console.error(e); process.exit(1); });
