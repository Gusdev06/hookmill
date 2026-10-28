/**
 * Prova local (sem Lambda, nada pago) dos templates grátis do Iterate v2 (F1) com o campeão REAL Amnayalife (lote
 * cmvnlm4yd000l22emdoob1j5a, zh-TW, legenda queimada, 720x1280): roteiro (fixture = protótipo aprovado de 28/10, no formato
 * do planAutoBatch) → validação do plano (nada inventado) → finalizePlan → buildTemplateInput → renderMedia local da
 * composição `Template`. Também valida o roteiro do MOCK (fake-template) no mesmo campeão. Banco dev: SÓ LEITURA.
 * Vídeo baixado do storage (STORAGE_*) e servido por HTTP local; Remotion na porta 3022 (nunca 3001).
 *
 * Uso (de api/): ITERATE_TEMPLATES=on npx ts-node --transpile-only src/render/templates-campeao-real.ts [saida-dir] [chat|person|todos]
 */
import 'dotenv/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { PrismaClient } from '@prisma/client';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { EditMap, TranscriptWord } from '@maquina/contratos';
import { TEMPLATE_COMPOSITION_ID } from '@maquina/video';
import type { AutoPlanDraft, AutoPlanInput, TemplateSpec } from '../integracoes/contrato';
import { wordAt } from '../integracoes/claude/auto-plano-template';
import { mockChatDm, mockPersonMotion } from '../integracoes/mock/fake-template';
import { draftOf } from '../ofertas/ofertas.service';
import { planCtxOf } from '../iteracao/contexto';
import { regrasDeMidiaFallback } from '../iteracao/portas';
import { allowedFor, finalizePlan, validatePlan } from '../iteracao/regras';
import type { AutoEditContext } from './auto-edit';
import { CHAT_AMNAYALIFE, PERSON_AMNAYALIFE } from './fixtures/templates-amnayalife';
import { buildTemplateInput } from './template';

const LOTE = 'cmvnlm4yd000l22emdoob1j5a';
const PORTA_REMOTION = 3022;
const raizVideo = path.resolve(__dirname, '../../../video');

async function main() {
  process.env.ITERATE_TEMPLATES = 'on';
  const saida = path.resolve(process.argv[2] ?? path.join(raizVideo, 'out', 'f1-templates-2026-10-28'));
  const so = process.argv[3] ?? 'todos';
  mkdirSync(path.join(saida, 'stills'), { recursive: true });
  const prisma = new PrismaClient();
  const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: LOTE }, include: { offer: true, workspace: true, champion: { include: { videoFile: true, teardown: true } } } });
  const ch = b.champion!;
  const td = ch.teardown!;
  const arquivo = path.join(saida, '_campeao.mp4');
  if (!existsSync(arquivo)) {
    const s3 = new S3Client({
      endpoint: process.env.STORAGE_ENDPOINT, region: process.env.STORAGE_REGION, forcePathStyle: true,
      credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY! },
    });
    const o = await s3.send(new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET!, Key: ch.videoFile!.storageKey }));
    await pipeline(o.Body as Readable, createWriteStream(arquivo));
  }
  const servidor = http.createServer((req, res) => {
    const { size } = statSync(arquivo);
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const h = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (range) {
      const a = Number(range[1]), z = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${z}/${size}`, 'Content-Length': z - a + 1 });
      return void createReadStream(arquivo, { start: a, end: z }).pipe(res);
    }
    res.writeHead(200, { ...h, 'Content-Length': size });
    createReadStream(arquivo).pipe(res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/campeao.mp4`;

  // 1. contexto do plano (o mesmo do PlanoAutoService) e o que entra no `allowed`
  const ctx = planCtxOf({ offer: b.offer, workspace: b.workspace, champion: ch, teardown: td }, regrasDeMidiaFallback, { captured: true });
  const allowed = allowedFor(ctx);
  console.log('allowed (templates):', JSON.stringify(allowed.filter((a) => a.type === 'CHAT_DM' || a.type === 'PERSON_MOTION')), 'faceShare', ctx.templates?.faceShare.toFixed(2), 'bands', ctx.templates?.bands.length);

  // 2. roteiros: fixture (protótipo aprovado) e mock, validados pela regra do plano
  const words = (td.transcript as unknown as { words: TranscriptWord[] }).words;
  const person = { ...PERSON_AMNAYALIFE, beats: PERSON_AMNAYALIFE.beats.map(({ atSec, ...b }) => ({ ...b, atWord: wordAt(words, atSec), untilWord: null })) };
  const sections = td.sections as unknown as AutoPlanInput['teardown'];
  const blocks = (sections.structure.data?.blocks ?? []).map((_, index) => ({ index, fn: index === 0 ? 'hook' as const : 'other' as const }));
  const plano = (items: AutoPlanDraft['items']): AutoPlanDraft => ({ blocks, why: { hook: { text: 'h', source: 'video', brainField: null, ref: '' }, proof: { text: 'p', source: 'video', brainField: null, ref: '' }, cta: { text: 'c', source: 'video', brainField: null, ref: '' } }, kept: [{ label: 'a', blockIndex: 0 }, { label: 'b', blockIndex: null }], items });
  const item = (params: AutoPlanDraft['items'][number]['params']) => ({ type: params.type as never, change: 'x', rationale: 'x', whyKey: 'proof' as const, params });
  const input: AutoPlanInput = {
    workspaceId: b.workspaceId, batchId: b.id, jobId: 'prova', uiLocale: 'PT_BR', screenLanguage: b.language, offer: draftOf(b.offer),
    workspace: { name: b.workspace.name, industry: null, market: null }, page: { captured: true, text: null }, teardown: sections, transcript: words,
    media: { durationSec: ctx.durationSec, cuts: 0, silences: ctx.silences, hasWrittenHook: true, hasEndCard: false }, keyframes: [], allowed: [], rules: { min: 1, max: 12, minDiversityPct: 40 },
  };
  const mocks = [mockChatDm(input), mockPersonMotion(input)].filter((x): x is NonNullable<typeof x> => !!x);
  const viol = (d: AutoPlanDraft) => validatePlan(d, ctx, allowed).filter((v) => v.item !== null);
  const relatorio: Record<string, unknown> = {};
  for (const [nome, d] of [['fixture', plano([item(CHAT_AMNAYALIFE), item(person as never)])], ['mock', plano(mocks.map((m) => item(m)))]] as const) {
    const v = viol(d);
    relatorio[`violacoes_${nome}`] = v;
    console.log(`violações (${nome}):`, v.length ? v.map((x) => `${x.item}:${x.rule} ${x.detail}`).join(' | ') : 'nenhuma');
  }
  const finais = finalizePlan(plano([item(CHAT_AMNAYALIFE), item(person as never)]), ctx, regrasDeMidiaFallback);

  // 3. build + render local
  const editMap = td.editMap as unknown as EditMap;
  const meas = td.measurements as { palette?: string[] } | null;
  const actx = (renderId: string): AutoEditContext => ({
    renderId, type: 'CHAT_DM', params: {} as never, language: b.language,
    source: { videoUrl: url, width: ch.videoFile!.width ?? 720, height: ch.videoFile!.height ?? 1280, fps: editMap.fps, durationSec: Number(ch.durationSec), hasAudio: true },
    editMap, words, silences: ctx.silences, blocks: [], hookEndSec: null, palette: meas?.palette ?? [], brandName: b.workspace.name, page: null,
  });
  const serveUrl = await bundle({ entryPoint: path.join(raizVideo, 'src', 'index.ts'), publicDir: path.join(raizVideo, 'public') });
  for (const f of finais) {
    const id = f.type === 'CHAT_DM' ? 'chat' : 'person';
    if (so !== 'todos' && so !== id) continue;
    const input = buildTemplateInput(f.params as TemplateSpec, actx(`prova-${id}`), 'VERTICAL_9_16');
    const { kind: _k, renderId: _r, ...props } = input;
    writeFileSync(path.join(saida, `${f.code}.input.json`), JSON.stringify(input, null, 1));
    const composition = await selectComposition({ serveUrl, id: TEMPLATE_COMPOSITION_ID, inputProps: props, port: PORTA_REMOTION });
    const nome = `MC_1028_${f.code}_9x16`;
    let pico = 0;
    const amostra = setInterval(() => { pico = Math.max(pico, process.memoryUsage().rss); }, 250);
    const t0 = Date.now();
    await renderMedia({ composition, serveUrl, inputProps: props, codec: 'h264', outputLocation: path.join(saida, `${nome}.mp4`), imageFormat: 'jpeg', jpegQuality: 90, pixelFormat: 'yuv420p', audioCodec: 'aac', concurrency: 4, port: PORTA_REMOTION, offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024 });
    clearInterval(amostra);
    const med = { segundosDeVideo: +(composition.durationInFrames / 30).toFixed(2), frames: composition.durationInFrames, segundosDeRender: +((Date.now() - t0) / 1000).toFixed(1), picoRssNodeMB: Math.round(pico / 1e6), concurrency: 4 };
    relatorio[nome] = { ...med, checkpoints: input.checkpoints };
    console.log(nome, JSON.stringify(med));
    for (const c of input.checkpoints) {
      await renderStill({ composition, serveUrl, inputProps: props, frame: Math.min(composition.durationInFrames - 1, Math.round(c.atSec * 30)), output: path.join(saida, 'stills', `${f.code}-${c.atSec.toFixed(1).padStart(5, '0')}s.png`), imageFormat: 'png', port: PORTA_REMOTION });
    }
  }
  writeFileSync(path.join(saida, 'relatorio.json'), JSON.stringify(relatorio, null, 1));
  servidor.close();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
