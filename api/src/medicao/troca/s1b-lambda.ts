/**
 * S1b / S3 da legenda (troca-texto §15.9, §16.8): `detectarLegenda` e `placaLegenda` na função de TESTE (não a de produção), pela porta
 * de verdade (TrocaTextoOrquestrada + ExecutorLambda). Bucket S3 temporário criado e apagado aqui. Credencial: cadeia padrão da AWS
 * (perfil admin), nunca as REMOTION_AWS_*. Grava por invocação: op, Billed Duration, memória, custo e tempo de parede. Teto de custo.
 *
 * Uso (de api/): LEGENDA_FUNCTION=hookmill-legenda-f2 npx ts-node --transpile-only src/medicao/troca/s1b-lambda.ts <casos.json> <saida-dir> [--sem-placa]
 * casos.json: [{ nome, video, words: "arquivo whisper .json" | [{word,startSec,endSec}], captionBox?, fontIdVisao?, legendaMaxSec?, faceTrack?: "all" | "none" }]
 * Caminhos relativos ao casos.json.
 */
import { CreateBucketCommand, DeleteBucketCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EditLayer, EditMap, Rect, TranscriptWord } from '@maquina/contratos';
import { ExecutorLambda, InvocadorTrocaAws, PRECO_GBS, PRECO_INVOCACAO, type InvocadorTroca } from './executor-lambda';
import type { EventoTroca } from './evento';
import { TrocaTextoOrquestrada } from './orquestra';
import { ProvaPuppeteer, pastaDeFontes } from './prova';

interface Caso { nome: string; video: string; words: string | TranscriptWord[]; captionBox?: Rect; fontIdVisao?: string; legendaMaxSec?: number; faceTrack?: 'all' | 'none'; semPlaca?: boolean }
interface Chamada { caso: string; op: string; billedMs: number | null; memMb: number | null; custoUsd: number; paredeMs: number; ok_op?: boolean; frio?: boolean; pico_MB?: number; total_s?: number; erro?: string; ini?: unknown; fim?: unknown }

const REGION = 'us-east-1';
const TETO_USD = Number(process.env.LEGENDA_TETO_USD || 0.12);
const FUNCAO = process.env.LEGENDA_FUNCTION || 'hookmill-legenda-f2';
if (FUNCAO === 'hookmill-legenda') throw new Error('esta sonda não roda na função de PRODUÇÃO (hookmill-legenda); use uma função de teste');

const sonda = (v: string) => {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets', '-of', 'json', v]).toString()).streams[0];
  const [a, b] = String(j.r_frame_rate).split('/').map(Number);
  return { W: Number(j.width), H: Number(j.height), fps: a / b, n: Number(j.nb_read_packets) };
};
const lerWords = (w: string | TranscriptWord[], base: string): TranscriptWord[] => {
  if (typeof w !== 'string') return w;
  const j = JSON.parse(readFileSync(path.resolve(base, w), 'utf8'));
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.words)) return j.words;
  return (j.segments as Array<{ words: Array<{ word: string; start: number; end: number }> }>).flatMap((s) => s.words.map((x) => ({ word: x.word, startSec: x.start, endSec: x.end })));
};

async function main() {
  const [arqCasos, saida] = process.argv.slice(2);
  const semPlaca = process.argv.includes('--sem-placa');
  if (!arqCasos || !saida) throw new Error('uso: s1b-lambda.ts <casos.json> <saida-dir> [--sem-placa]');
  for (const k of ['AWS_ACCESS_KEY_ID', 'REMOTION_AWS_ACCESS_KEY_ID']) if (process.env[k]) throw new Error(`${k} no ambiente: use só o perfil admin da cadeia padrão`);
  mkdirSync(saida, { recursive: true });
  const base = path.dirname(path.resolve(arqCasos));
  const casos = (JSON.parse(readFileSync(arqCasos, 'utf8')) as Caso[]);
  const s3 = new S3Client({ region: REGION });
  const bucket = `hookmill-s1b-tmp-${randomUUID().slice(0, 8)}`;
  await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  console.log('bucket temporário', bucket, 'função', FUNCAO, 'teto US$', TETO_USD);
  const storage = {
    tmpPrefix: 'tmp',
    presignPut: (key: string, o: { contentType: string; expiresInSec: number }) => getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: o.contentType }), { expiresIn: o.expiresInSec }),
    presignGet: (key: string, o: { expiresInSec: number }) => getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: o.expiresInSec }),
    remove: async (key: string) => { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
  const chamadas: Chamada[] = [];
  let atual = '';
  const real = new InvocadorTrocaAws({ region: REGION, functionName: FUNCAO, accessKeyId: null, secretAccessKey: null, timeoutMs: 330_000 });
  const inv: InvocadorTroca = {
    async invocar(ev: EventoTroca) {
      const gasto = chamadas.reduce((s, c) => s + c.custoUsd, 0);
      if (gasto > TETO_USD) throw new Error(`teto de US$ ${TETO_USD} passado (US$ ${gasto.toFixed(4)}): parado`);
      const t0 = Date.now();
      const r = await real.invocar(ev);
      const gbs = ((r.billedMs ?? 0) / 1000) * ((r.memMb ?? 3008) / 1024);
      const c: Chamada = { caso: atual, op: String(ev.op), ini: ev.ini, fim: ev.fim, billedMs: r.billedMs, memMb: r.memMb, custoUsd: gbs * PRECO_GBS + PRECO_INVOCACAO,
        paredeMs: Date.now() - t0, ok_op: r.resposta.ok_op, frio: r.resposta.frio, pico_MB: r.resposta.pico_arvore_MB, total_s: r.resposta.total_s, ...(r.resposta.erro ? { erro: String(r.resposta.erro).slice(0, 400) } : {}) };
      chamadas.push(c);
      console.log('chamada', JSON.stringify(c));
      return r;
    },
  };
  const porta = new TrocaTextoOrquestrada(new ExecutorLambda(inv, storage, { urlTtlSec: 3600, memMb: 3008 }),
    new ProvaPuppeteer({ browserExecutable: null, fontesDir: pastaDeFontes(process.env.TROCA_FONTES_DIR) }), { log: console, maxPedacos: 4, manterPlacaReprovada: !!process.env.LEGENDA_BAIXAR_SEMPRE });
  const resumo: Record<string, unknown> = {};
  try {
    for (const c of casos) {
      atual = c.nome;
      try {
      const video = path.resolve(base, c.video);
      const v = sonda(video);
      const key = `entrada/${c.nome}.mp4`;
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: readFileSync(video), ContentType: 'video/mp4' }));
      const videoUrl = await storage.presignGet(key, { expiresInSec: 3600 });
      const words = lerWords(c.words, base);
      const layer: EditLayer = {
        id: 'cap', kind: 'caption', startFrame: 0, endFrame: v.n, box: c.captionBox ?? { x: 0, y: Math.round(v.H * 0.6), w: v.W, h: Math.round(v.H * 0.15) },
        background: { kind: 'none', color: null, box: null }, style: { fontId: (c.fontIdVisao ?? 'montserrat-700') as never, uppercase: true, fontSizePx: 40, lineHeight: 1.1, color: '#ffffff', highlightColor: null, strokeColor: '#000000', strokeWidthPx: 3, shadow: true, align: 'center' },
        text: null, wordsPerPage: 3, source: 'vision',
      };
      const face = c.faceTrack === 'none' ? [] : [{ startFrame: 0, endFrame: v.n, region: { x: 0, y: 0, w: v.W, h: v.H }, fullFrame: true, facesMax: 1, minScore: 0.9, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.15, w: 0.4, h: 0.3 } }] }];
      const editMap = { version: 1, width: v.W, height: v.H, fps: v.fps, frameCount: v.n, cells: [], faceTrack: face, layers: [layer], overlaysOverFace: [], profile: null,
        keepEdit: { SWAP_AVATAR: { available: false, blockers: [] }, NEW_HOOKS: { available: false, blockers: [] } }, protectedBands: [] } as unknown as EditMap;
      const t0 = Date.now();
      const art = `artefatos/${c.nome}.npz`;
      const d = await porta.detectarLegenda({ workspaceId: 's1b', championId: c.nome, videoUrl, editMap, words, durationSec: v.n / v.fps, captionBox: c.captionBox ?? null, fontIdVisao: c.fontIdVisao ?? null, legendaMaxSec: c.legendaMaxSec ?? 130, artefatoKey: art });
      const tr = d.captionTrack!;
      writeFileSync(path.join(saida, `${c.nome}-captionTrack.json`), JSON.stringify(tr, null, 1));
      const linha: Record<string, unknown> = { detectar: { s: (Date.now() - t0) / 1000, custoUsd: d.costUsd }, veredito: tr.veredito, estilo: tr.estilo, trechos: tr.trechos.length, atrasoSec: tr.atrasoSec, caixa: tr.caixa, faixa: tr.faixa, quadros: tr.quadros };
      if ((tr.veredito.swap || tr.artefato) && !semPlaca && !c.semPlaca) {
        const t1 = Date.now();
        const outKey = `placas/${c.nome}.mp4`;
        const p = await porta.placaLegenda({ workspaceId: 's1b', championId: c.nome, videoUrl, captionTrack: tr, version: 1, outputKey: outKey });
        linha.placa = { ...p, s: (Date.now() - t1) / 1000 };
        if (p.status === 'READY' || process.env.LEGENDA_BAIXAR_SEMPRE) {
          try {
            const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: outKey }));
            writeFileSync(path.join(saida, `${c.nome}-placa.mp4`), Buffer.from(await obj.Body!.transformToByteArray()));
          } catch { /* reprovada: a porta apaga a placa */ }
        }
      }
      resumo[c.nome] = linha;
      writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
      console.log(c.nome, JSON.stringify(linha).slice(0, 1500));
      } catch (e) {
        if (/teto de US\$/.test((e as Error).message)) throw e;
        resumo[c.nome] = { erro: (e as Error).message.slice(0, 400) };
        writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
        console.log(c.nome, 'ERRO', (e as Error).message.slice(0, 300));
      }
    }
  } finally {
    writeFileSync(path.join(saida, 'chamadas.json'), JSON.stringify(chamadas, null, 1));
    writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
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
