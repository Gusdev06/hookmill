// Sonda L1 do render no Remotion Lambda (docs/contratos/render-lambda-v1.md §9). Dono: arquiteto.
// Mede tempo de parede, custo (costs.accruedSoFar), nº de funções, mídia baixada e PSNR local × Lambda.
// Credenciais: REMOTION_AWS_* no ambiente (carregue do .env da raiz sem imprimir) + STORAGE_* lidos de api/.env.easypanel.
//
// Uso (da raiz do projeto):
//   set -a; source <(grep '^REMOTION_AWS_' .env); set +a
//   node scripts/sonda-lambda-l1.mjs deploy                    # função (MEMS, padrão 3008), bucket + ciclo de vida, bundle + site
//   npm run build:bundle -w video && SITE=hookmill-dev BUNDLE_DIR=video/dist/bundle node scripts/sonda-lambda-l1.mjs deploy
//                                                              # republica o site de dev (REMOTION_SERVE_URL do api/.env)
//   node scripts/sonda-lambda-l1.mjs midia                     # sobe as fixtures pro Supabase (prefixo temporário) e assina
//   node scripts/sonda-lambda-l1.mjs local <caso>              # render local de referência (headline | noticia)
//   node scripts/sonda-lambda-l1.mjs render <nome> <caso> <mem> <fpl> [ini-fim] [s3out]
//   node scripts/sonda-lambda-l1.mjs analisar <nome>           # nb_frames, áudio, PSNR RGB contra o local
//   node scripts/sonda-lambda-l1.mjs resumo | limpar
// Saída e estado em video/out/sonda-lambda-l1/ (fora do git). Teto de gasto da sonda: TETO_USD (padrão 0,45).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = require('@remotion/lambda'); // 4.0.533 (mesma do remotion)
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, PutBucketLifecycleConfigurationCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.REMOTION_AWS_REGION || 'us-east-1';
const DIR = path.join(raiz, 'video', 'out', 'sonda-lambda-l1');
const ESTADO = path.join(DIR, 'estado.json');
const TETO_USD = Number(process.env.TETO_USD ?? 0.45);
const PREFIXO = 'sonda-lambda-l1/';
const FIXTURES = path.join(raiz, 'video', 'public', 'fixtures');
mkdirSync(DIR, { recursive: true });

const estado = () => (existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, 'utf8')) : { funcoes: {}, renders: {} });
const salvar = (e) => writeFileSync(ESTADO, JSON.stringify(e, null, 2));
if (!process.env.REMOTION_AWS_ACCESS_KEY_ID) throw new Error('REMOTION_AWS_* fora do ambiente');

// Supabase (S3 compatível) — lido do arquivo, nunca impresso
const envDe = (f) => Object.fromEntries(readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const sb = envDe(path.join(raiz, 'api', '.env.easypanel'));
const supa = new S3Client({ endpoint: sb.STORAGE_ENDPOINT, region: sb.STORAGE_REGION, forcePathStyle: sb.STORAGE_FORCE_PATH_STYLE !== 'false', credentials: { accessKeyId: sb.STORAGE_ACCESS_KEY_ID, secretAccessKey: sb.STORAGE_SECRET_ACCESS_KEY } });
const aws = new S3Client({ region: REGION, credentials: { accessKeyId: process.env.REMOTION_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.REMOTION_AWS_SECRET_ACCESS_KEY } });

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const gitSha = () => sh('git', ['-C', raiz, 'rev-parse', '--short', 'HEAD']).trim();

// ---------- deploy ----------
async function deploy() {
  const e = estado();
  for (const mem of (process.env.MEMS ?? '3008').split(',').map(Number)) { // L1 comparou 3008,2048; fica 3008
    const r = await L.deployFunction({
      region: REGION, memorySizeInMb: mem, diskSizeInMb: 4096, timeoutInSeconds: 300,
      createCloudWatchLogGroup: true, cloudWatchLogRetentionPeriodInDays: 7,
    });
    e.funcoes[mem] = r.functionName;
    console.log(`função ${mem} MB: ${r.functionName} (já existia: ${r.alreadyExisted})`);
  }
  const { bucketName } = await L.getOrCreateBucket({ region: REGION });
  e.bucket = bucketName;
  // Ciclo de vida: as 4 regras do Remotion (deleteAfter) + 7 dias pra tudo em renders/. sites/ fica.
  const regras = [['1-day', 1], ['3-days', 3], ['7-days', 7], ['30-days', 30]].map(([k, d]) => ({ ID: `delete-after-${k}`, Status: 'Enabled', Filter: { Prefix: `renders/${k}` }, Expiration: { Days: d } }));
  regras.push({ ID: 'hookmill-renders-7-dias', Status: 'Enabled', Filter: { Prefix: 'renders/' }, Expiration: { Days: 7 } });
  await aws.send(new PutBucketLifecycleConfigurationCommand({ Bucket: bucketName, LifecycleConfiguration: { Rules: regras } }));
  console.log(`bucket ${bucketName}: ciclo de vida ok (renders/ 7 dias)`);

  // bundle de produção (mesmo bundle.mjs, em pasta própria pra não mexer no video/dist/bundle que a API lê)
  // BUNDLE_DIR=video/dist/bundle: publica o bundle do `npm run build:bundle -w video` (o mesmo que a API local usa)
  let bundleDir = process.env.BUNDLE_DIR ? path.resolve(raiz, process.env.BUNDLE_DIR) : path.join(DIR, 'bundle');
  if (!process.env.BUNDLE_DIR) {
    const { bundle } = require(require.resolve('@remotion/bundler', { paths: [path.join(raiz, 'video')] }));
    rmSync(bundleDir, { recursive: true, force: true });
    await bundle({ entryPoint: path.join(raiz, 'video', 'src', 'index.ts'), outDir: bundleDir, publicDir: path.join(raiz, 'video', 'public') });
    rmSync(path.join(bundleDir, 'public', 'fixtures'), { recursive: true, force: true });
  }
  const siteName = process.env.SITE || `hookmill-l1-${gitSha()}`; // dev: SITE=hookmill-dev (URL fixa no api/.env)
  const t0 = Date.now();
  const site = await L.deploySiteFromBundle({ region: REGION, bucketName, bundleDir, siteName });
  e.bundleDir = bundleDir; e.serveUrl = site.serveUrl; e.siteName = site.siteName;
  console.log(`site ${site.siteName} em ${((Date.now() - t0) / 1000).toFixed(1)} s: ${JSON.stringify(site.stats)}`);
  salvar(e);
}

// ---------- mídia no Supabase ----------
const ARQS = ['cena-1.mp4', 'cena-2.mp4', 'cena-3.mp4', 'cena-4.mp4', 'cena-5.mp4', 'real-take.mp4', 'real-kling-2.mp4'];
async function midia() {
  const e = estado();
  e.midia = {};
  for (const f of ARQS) {
    const key = PREFIXO + f;
    await supa.send(new PutObjectCommand({ Bucket: sb.STORAGE_BUCKET, Key: key, Body: readFileSync(path.join(FIXTURES, f)), ContentType: 'video/mp4' }));
    const url = await getSignedUrl(supa, new GetObjectCommand({ Bucket: sb.STORAGE_BUCKET, Key: key }), { expiresIn: 21600 });
    e.midia[`fixtures/${f}`] = { url, bytes: statSync(path.join(FIXTURES, f)).size };
  }
  e.midiaAssinadaEm = new Date().toISOString();
  salvar(e);
  console.log(`${ARQS.length} arquivos em ${sb.STORAGE_BUCKET}/${PREFIXO}, URLs válidas por 6 h`);
}

// ---------- props ----------
const trocarUrls = (obj, m) => JSON.parse(JSON.stringify(obj), (k, v) => (typeof v === 'string' && m[v] ? m[v].url : v));
async function props(caso) {
  const e = estado();
  const m = e.midia;
  if (caso === 'headline') {
    const amostra = JSON.parse(readFileSync(path.join(FIXTURES, 'amostra.json'), 'utf8'));
    const p = { templateId: 'headline', format: 'VERTICAL_9_16', language: 'en', scenes: amostra.scenes, captionStyle: 'word', captionPosition: 'bottom', headline: 'I found out without touching their phone', ctaText: 'Try it free today', endCard: true };
    return { composition: 'Criativo', inputProps: trocarUrls(p, m) };
  }
  if (caso === 'noticia') {
    const { selectComposition } = require(require.resolve('@remotion/renderer', { paths: [path.join(raiz, 'video')] }));
    const c = await selectComposition({ serveUrl: e.bundleDir, id: 'Moldura-9x16-05-noticia', inputProps: {} });
    const p = { ...c.props, video: { ...c.props.video, timeline: [{ startSec: 0, endSec: 30 }] } };
    return { composition: 'Moldura', inputProps: trocarUrls(p, m) };
  }
  throw new Error(`caso ${caso}?`);
}

const OPC = { codec: 'h264', imageFormat: 'jpeg', pixelFormat: 'yuv420p', offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024 };

// ---------- render local de referência (mesmo bundle e props) ----------
async function local(caso) {
  const e = estado();
  const R = require(require.resolve('@remotion/renderer', { paths: [path.join(raiz, 'video')] }));
  const { composition, inputProps } = await props(caso);
  const comp = await R.selectComposition({ serveUrl: e.bundleDir, id: composition, inputProps });
  const out = path.join(DIR, `local-${caso}.mp4`);
  const t0 = Date.now();
  await R.renderMedia({ serveUrl: e.bundleDir, composition: comp, inputProps, outputLocation: out, ...OPC, concurrency: 4, x264Preset: 'medium' });
  console.log(`local ${caso}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${comp.durationInFrames} frames → ${out}`);
}

// ---------- render no Lambda ----------
const gastoTotal = (e) => Object.values(e.renders).reduce((s, r) => s + (r.custoUsd ?? 0), 0);
async function render(nome, caso, mem, fpl, faixa, s3out) {
  const e = estado();
  if (gastoTotal(e) >= TETO_USD) throw new Error(`teto de US$ ${TETO_USD} atingido (${gastoTotal(e).toFixed(4)})`);
  const functionName = e.funcoes[mem];
  const { composition, inputProps } = await props(caso);
  const frameRange = faixa ? faixa.split('-').map(Number) : undefined;
  const outName = s3out
    ? { bucketName: sb.STORAGE_BUCKET, key: `${PREFIXO}saida-${nome}.mp4`, s3OutputProvider: { endpoint: sb.STORAGE_ENDPOINT, accessKeyId: sb.STORAGE_ACCESS_KEY_ID, secretAccessKey: sb.STORAGE_SECRET_ACCESS_KEY, region: sb.STORAGE_REGION, forcePathStyle: true } }
    : `${nome}.mp4`;
  const t0 = Date.now();
  const sub = await L.renderMediaOnLambda({
    region: REGION, functionName, serveUrl: e.serveUrl, composition, inputProps, ...OPC,
    x264Preset: 'medium', concurrencyPerLambda: 1, framesPerLambda: Number(fpl), frameRange,
    maxRetries: 1, timeoutInMilliseconds: 60_000, privacy: s3out ? 'no-acl' : 'private', deleteAfter: '1-day',
    downloadBehavior: { type: 'play-in-browser' }, outName, logLevel: process.env.LOG ?? 'verbose',
  });
  console.log(`${nome}: submetido em ${Date.now() - t0} ms, renderId ${sub.renderId}`);
  let p;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    p = await L.getRenderProgress({ renderId: sub.renderId, bucketName: sub.bucketName, functionName, region: REGION, ...(s3out ? { s3OutputProvider: outName.s3OutputProvider } : {}) });
    process.stdout.write(`\r${nome}: ${(p.overallProgress * 100).toFixed(0)}% frames ${p.framesRendered} lambdas ${p.lambdasInvoked} US$ ${p.costs.accruedSoFar.toFixed(4)}   `);
    if (p.done || p.fatalErrorEncountered) break;
    if (Date.now() - t0 > 420_000) { console.log('\nsem fim em 7 min'); break; }
  }
  const paredeS = (Date.now() - t0) / 1000;
  console.log('');
  const reg = {
    caso, mem: Number(mem), fpl: Number(fpl), faixa: frameRange ?? null, s3out: !!s3out, functionName, renderId: sub.renderId, bucket: sub.bucketName,
    paredeS, timeToFinishS: p.timeToFinish != null ? p.timeToFinish / 1000 : null, custoUsd: p.costs.accruedSoFar, custoExibido: p.costs.displayCost,
    chunks: p.renderMetadata?.totalChunks ?? null, lambdasInvoked: p.lambdasInvoked, funcoes: p.lambdasInvoked + 1,
    frames: p.renderMetadata ? (frameRange ? frameRange[1] - frameRange[0] + 1 : p.renderMetadata.frameRange?.[1] + 1) : null,
    estimatedBillingMs: p.estimatedBillingDurationInMilliseconds ?? null, outputSizeInBytes: p.outputSizeInBytes ?? null,
    erros: (p.errors ?? []).map((x) => `${x.chunk ?? ''} ${x.message?.slice(0, 200)}`), fatal: p.fatalErrorEncountered, cloudWatchLogs: sub.cloudWatchLogs,
    em: new Date().toISOString(),
  };
  if (p.done && !p.fatalErrorEncountered) {
    const arq = path.join(DIR, `${nome}.mp4`);
    const cli = s3out ? supa : aws;
    const Bucket = s3out ? sb.STORAGE_BUCKET : p.outBucket;
    const Key = s3out ? outName.key : p.outKey;
    const o = await cli.send(new GetObjectCommand({ Bucket, Key }));
    await pipeline(o.Body, createWriteStream(arq));
    reg.arquivo = arq; reg.bytesSaida = statSync(arq).size; reg.saidaEm = s3out ? `supabase:${Bucket}/${Key}` : `s3:${Bucket}/${Key}`;
    if (!s3out) await aws.send(new DeleteObjectCommand({ Bucket, Key })); // finalize apaga depois da cópia (§2.5)
  }
  e.renders[nome] = reg;
  salvar(e);
  console.log(JSON.stringify({ nome, paredeS: reg.paredeS, custoUsd: reg.custoUsd, chunks: reg.chunks, funcoes: reg.funcoes, erros: reg.erros, total: gastoTotal(e).toFixed(4) }));
}

// ---------- análise ----------
const probe = (f) => JSON.parse(sh('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_packets,duration,r_frame_rate', '-of', 'json', f])).streams;
function psnrRgb(a, b, ini, n) {
  // PSNR por frame em RGB (gbrp), b = Lambda, a = local cortado na mesma faixa
  const log = path.join(DIR, 'psnr.tmp.log');
  const filtro = `[0:v]trim=start_frame=${ini}:end_frame=${ini + n},setpts=PTS-STARTPTS,format=gbrp[a];[1:v]setpts=PTS-STARTPTS,format=gbrp[b];[a][b]psnr=stats_file=${log}`;
  execFileSync('ffmpeg', ['-v', 'error', '-i', a, '-i', b, '-lavfi', filtro, '-f', 'null', '-'], { stdio: 'ignore' });
  const v = readFileSync(log, 'utf8').trim().split('\n').map((l) => { const m = l.match(/psnr_avg:(\S+)/); return m[1] === 'inf' ? Infinity : Number(m[1]); });
  rmSync(log);
  const fin = v.filter(Number.isFinite);
  return { frames: v.length, min: Math.min(...v), media: fin.length ? fin.reduce((s, x) => s + x, 0) / fin.length : Infinity, inf: v.length - fin.length };
}
function analisar(nome) {
  const e = estado();
  const r = e.renders[nome];
  const ref = path.join(DIR, `local-${r.caso}.mp4`);
  const s = probe(r.arquivo), sr = probe(ref);
  const v = s.find((x) => x.codec_type === 'video'), a = s.find((x) => x.codec_type === 'audio');
  const vr = sr.find((x) => x.codec_type === 'video'), ar = sr.find((x) => x.codec_type === 'audio');
  const ini = r.faixa ? r.faixa[0] : 0;
  const n = Number(v.nb_read_packets);
  const ps = psnrRgb(ref, r.arquivo, ini, n);
  r.analise = {
    video: `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}`, nbFrames: n, nbFramesLocal: Number(vr.nb_read_packets),
    framesEsperados: r.faixa ? r.faixa[1] - r.faixa[0] + 1 : Number(vr.nb_read_packets),
    audio: a ? `${a.codec_name} ${Number(a.duration).toFixed(2)} s` : 'SEM ÁUDIO', audioLocal: ar ? `${ar.codec_name} ${Number(ar.duration).toFixed(2)} s` : 'SEM ÁUDIO',
    psnr: { min: +ps.min.toFixed(2), media: +ps.media.toFixed(2), framesInf: ps.inf, frames: ps.frames },
  };
  salvar(e);
  console.log(nome, JSON.stringify(r.analise));
}

// Mídia baixada: linhas "Downloading <url>" do CloudWatch (logLevel verbose) na janela do render × tamanho do arquivo.
// O usuário de deploy não lê log: usa o perfil padrão do aws CLI (gusta-cli), só leitura.
function bytes(nome) {
  const e = estado();
  const r = e.renders[nome];
  const fim = Date.parse(r.em) + 5000, ini = fim - (r.paredeS + 15) * 1000;
  const out = JSON.parse(sh('aws', ['logs', 'filter-log-events', '--region', REGION, '--log-group-name', `/aws/lambda/${r.functionName}`, '--start-time', String(Math.round(ini)), '--end-time', String(Math.round(fim)), '--filter-pattern', '"Downloading http"', '--output', 'json']));
  const porArq = {};
  let total = 0, n = 0;
  for (const ev of out.events ?? []) {
    const m = ev.message.match(/Downloading https?:\/\/[^\s]*?\/(sonda-lambda-l1\/[^?\s]+)/);
    if (!m) continue;
    const f = `fixtures/${m[1].slice(PREFIXO.length)}`;
    const b = e.midia[f]?.bytes ?? 0;
    porArq[f] = (porArq[f] ?? 0) + 1; total += b; n++;
  }
  r.midiaBaixada = { downloads: n, bytes: total, porArquivo: porArq };
  salvar(e);
  console.log(nome, JSON.stringify(r.midiaBaixada));
}

function resumo() {
  const e = estado();
  console.log(`site ${e.siteName} ${e.serveUrl}\nfunções ${JSON.stringify(e.funcoes)}\nbucket ${e.bucket}`);
  for (const [n, r] of Object.entries(e.renders)) console.log(`${n} | ${r.caso} ${r.mem}MB fpl ${r.fpl} ${r.faixa ? r.faixa.join('-') : 'inteiro'}${r.s3out ? ' s3out' : ''} | parede ${r.paredeS?.toFixed(1)} s | US$ ${r.custoUsd?.toFixed(4)} | chunks ${r.chunks} funções ${r.funcoes} | PSNR min ${r.analise?.psnr.min} | nb ${r.analise?.nbFrames}/${r.analise?.framesEsperados} | áudio ${r.analise?.audio} | erros ${r.erros.length}`);
  console.log(`total US$ ${gastoTotal(e).toFixed(4)}`);
}

async function limpar() {
  const l = await supa.send(new ListObjectsV2Command({ Bucket: sb.STORAGE_BUCKET, Prefix: PREFIXO }));
  for (const o of l.Contents ?? []) await supa.send(new DeleteObjectCommand({ Bucket: sb.STORAGE_BUCKET, Key: o.Key }));
  console.log(`apagados ${(l.Contents ?? []).length} objetos de ${sb.STORAGE_BUCKET}/${PREFIXO}`);
}

const [cmd, ...a] = process.argv.slice(2);
const cmds = { deploy, midia, local: () => local(a[0]), render: () => render(...a), analisar: () => analisar(a[0]), bytes: () => bytes(a[0]), resumo, limpar };
if (!cmds[cmd]) { console.error('comando: deploy | midia | local <caso> | render <nome> <caso> <mem> <fpl> [ini-fim] [s3out] | analisar <nome> | resumo | limpar'); process.exit(1); }
await cmds[cmd]();
