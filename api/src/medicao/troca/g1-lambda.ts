/**
 * G1 da troca de texto (troca-texto §16.8): `medir_headline` e `placa_headline` na função real `hookmill-legenda`, pela porta
 * de verdade (TrocaTextoOrquestrada + ExecutorLambda). Arquivos num bucket S3 TEMPORÁRIO criado e apagado aqui (nunca o
 * storage do produto). Credencial: cadeia padrão da AWS (perfil admin), nunca as REMOTION_AWS_*. A prova de fonte roda no
 * Chrome local, como na API. Grava por invocação: op, Billed Duration, memória, custo e tempo de parede.
 *
 * Uso (de api/): REMOTION_BROWSER_EXECUTABLE=... npx ts-node --transpile-only src/medicao/troca/g1-lambda.ts <casos.json> <saida-dir>
 * casos.json: o formato do troca-real.ts (+ "derivado": true no sintético).
 */
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EditLayer, EditMap } from '@maquina/contratos';
import { ExecutorLambda, InvocadorTrocaAws, PRECO_GBS_ARM, PRECO_INVOCACAO, type InvocadorTroca } from './executor-lambda';
import type { EventoTroca } from './evento';
import { TrocaTextoOrquestrada } from './orquestra';
import { ProvaPuppeteer, pastaDeFontes } from './prova';

interface Caso { nome: string; video: string; W: number; H: number; fps: number; frames: number; derivado?: boolean; layer: Partial<EditLayer> & { box: EditLayer['box']; text: string }; bandas?: EditMap['protectedBands'] }
interface Chamada { caso: string; op: string; fase?: string; billedMs: number | null; memMb: number | null; custoUsd: number; paredeMs: number; ok_op?: boolean; frio?: boolean; pico_MB?: number; total_s?: number; erro?: string }

const REGION = 'us-east-1';
const TETO_USD = 0.10;

async function main() {
  const [arqCasos, saida] = process.argv.slice(2);
  if (!arqCasos || !saida) throw new Error('uso: g1-lambda.ts <casos.json> <saida-dir>');
  for (const k of ['AWS_ACCESS_KEY_ID', 'REMOTION_AWS_ACCESS_KEY_ID']) if (process.env[k]) throw new Error(`${k} no ambiente: use só o perfil admin da cadeia padrão`);
  mkdirSync(saida, { recursive: true });
  const casos = (JSON.parse(readFileSync(arqCasos, 'utf8')) as Caso[]).map((c) => ({ ...c, video: path.resolve(path.dirname(arqCasos), c.video) }));
  const s3 = new S3Client({ region: REGION });
  const bucket = `hookmill-g1-tmp-${randomUUID().slice(0, 8)}`;
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log('bucket temporário', bucket);
  const storage = {
    tmpPrefix: 'tmp',
    presignPut: (key: string, o: { contentType: string; expiresInSec: number }) => getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: o.contentType }), { expiresIn: o.expiresInSec }),
    presignGet: (key: string, o: { expiresInSec: number }) => getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: o.expiresInSec }),
    remove: async (key: string) => { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
  const chamadas: Chamada[] = [];
  let atual = '';
  const real = new InvocadorTrocaAws({ region: REGION, functionName: 'hookmill-legenda', accessKeyId: null, secretAccessKey: null, timeoutMs: 330_000 });
  const inv: InvocadorTroca = {
    async invocar(ev: EventoTroca) {
      const gasto = chamadas.reduce((s, c) => s + c.custoUsd, 0);
      if (gasto > TETO_USD) throw new Error(`teto de US$ ${TETO_USD} passado (US$ ${gasto.toFixed(4)}): parado`);
      const t0 = Date.now();
      const r = await real.invocar(ev);
      const gbs = ((r.billedMs ?? 0) / 1000) * ((r.memMb ?? 3008) / 1024);
      const c: Chamada = { caso: atual, op: String(ev.op), ...(ev.fase ? { fase: String(ev.fase) } : {}), billedMs: r.billedMs, memMb: r.memMb, custoUsd: gbs * PRECO_GBS_ARM + PRECO_INVOCACAO,
        paredeMs: Date.now() - t0, ok_op: r.resposta.ok_op, frio: r.resposta.frio, pico_MB: r.resposta.pico_arvore_MB, total_s: r.resposta.total_s, ...(r.resposta.erro ? { erro: String(r.resposta.erro).slice(0, 300) } : {}) };
      chamadas.push(c);
      console.log('chamada', JSON.stringify(c));
      return r;
    },
  };
  const fontesDir = pastaDeFontes(process.env.TROCA_FONTES_DIR);
  const porta = new TrocaTextoOrquestrada(new ExecutorLambda(inv, storage, { urlTtlSec: 3600, memMb: 3008 }),
    new ProvaPuppeteer({ browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null, fontesDir }), { log: console, maxPedacos: 4 });
  const resumo: Record<string, unknown> = {};
  try {
    for (const c of casos) {
      atual = c.nome;
      const key = `entrada/${c.nome}.mp4`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(c.video), ContentType: 'video/mp4' }));
      const videoUrl = await storage.presignGet(key, { expiresInSec: 3600 });
      const layer: EditLayer = {
        id: c.layer.id ?? 'headline-1', kind: c.layer.kind ?? 'headline', startFrame: c.layer.startFrame ?? 0, endFrame: c.layer.endFrame ?? c.frames,
        box: c.layer.box, background: c.layer.background ?? { kind: 'none', color: null, box: null },
        style: { fontId: 'inter-800', uppercase: false, fontSizePx: 40, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: true, align: 'center', ...(c.layer.style ?? {}) },
        text: c.layer.text, wordsPerPage: null, source: 'vision',
      };
      const editMap = { version: 1, width: c.W, height: c.H, fps: c.fps, frameCount: c.frames, cells: [], faceTrack: [], layers: [layer], overlaysOverFace: [], profile: null,
        keepEdit: { SWAP_AVATAR: { available: false, blockers: [] }, NEW_HOOKS: { available: false, blockers: [] } }, protectedBands: c.bandas ?? [] } as EditMap;
      const t0 = Date.now();
      const m = await porta.medirHeadline({ workspaceId: 'g1', championId: c.nome, videoUrl, editMap });
      const look = m.look!;
      writeFileSync(path.join(saida, `${c.nome}-look.json`), JSON.stringify(look, null, 1));
      const linha: Record<string, unknown> = { derivado: !!c.derivado, medir: { s: (Date.now() - t0) / 1000, custoUsd: m.costUsd }, kind: look.kind, intervalo: [look.startFrame, look.endFrame],
        verdict: look.verdict, font: look.font, linhas: look.text.lines };
      if (look.kind === 'loose' && look.verdict.ok) {
        const t1 = Date.now();
        const outKey = `placas/${c.nome}.mp4`;
        const p = await porta.placaHeadline({ workspaceId: 'g1', championId: c.nome, videoUrl, look, version: 1, outputKey: outKey });
        linha.placa = { ...p, s: (Date.now() - t1) / 1000 };
        if (p.status === 'READY') {
          const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: outKey }));
          writeFileSync(path.join(saida, `${c.nome}-placa.mp4`), Buffer.from(await obj.Body!.transformToByteArray()));
        }
      }
      resumo[c.nome] = linha;
      console.log(c.nome, JSON.stringify(linha));
    }
  } finally {
    writeFileSync(path.join(saida, 'chamadas.json'), JSON.stringify(chamadas, null, 1));
    writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
    // apaga o bucket temporário inteiro
    for (;;) {
      const l = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
      if (!l.Contents?.length) break;
      for (const o of l.Contents) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key! }));
    }
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log('bucket apagado; custo Lambda US$', chamadas.reduce((s, c) => s + c.custoUsd, 0).toFixed(5), 'em', chamadas.length, 'invocações');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
