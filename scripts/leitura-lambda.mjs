// Função AWS Lambda da leitura do anúncio (docs/contratos/leitura-lambda-v1.md §4). Dono: arquiteto.
// Monta a imagem SEM Docker (a máquina do Gusta não tem): base oficial public.ecr.aws/lambda/nodejs:22 + 1 camada
// com o handler (esbuild de api/src/medicao/leitura/handler.ts, o MESMO código da API), onnxruntime-node linux,
// os modelos YuNet/SFace e o ffmpeg/ffprobe estático (sha256 conferido). x86_64 (padrão) ou arm64. Sobe pro ECR pela API do ECR e cria/atualiza a
// função, a role e a permissão de invocação do usuário do render. Idempotente: rodar de novo = nova versão da imagem.
//
// Credencial: a cadeia padrão da AWS (perfil `default` = gusta-cli, admin) — NUNCA as REMOTION_AWS_* (o usuário do render
// não cria ECR/IAM). Uso (da raiz):
//   node scripts/leitura-lambda.mjs deploy [--mem 3008] [--arch x86_64|arm64]   # build + push + role + função + permissão + logs
//   node scripts/leitura-lambda.mjs build                 # só o contexto e a camada (.infra/leitura-lambda/)
//   node scripts/leitura-lambda.mjs status                # função, imagem, memória
//   node scripts/leitura-lambda.mjs memoria <MB>          # só troca a memória (e as threads do ONNX)
//   node scripts/leitura-lambda.mjs apagar                # função, repositório (com imagens), role e logs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGION = process.env.ANALYZE_LAMBDA_REGION || 'us-east-1';
const NOME = process.env.ANALYZE_LAMBDA_FUNCTION || 'hookmill-leitura';
const REPO = NOME;
const ROLE = `${NOME}-role`;
const INVOCADOR = process.env.LEITURA_INVOCADOR_USER || 'hookmill-remotion-deploy'; // usuário IAM da API (REMOTION_AWS_*)
// arquitetura: --arch arm64 | x86_64 (padrão arm64: bate bit a bit com o Mac; x86_64 é ~18 % mais rápido com diferença de subpixel, §4 do contrato)
const ARCH = (() => { const i = process.argv.indexOf('--arch'); return i > 0 ? process.argv[i + 1] : (process.env.LEITURA_ARCH || 'arm64'); })();
if (!['x86_64', 'arm64'].includes(ARCH)) throw new Error(`--arch ${ARCH} inválido (x86_64 | arm64)`);
const BASE = { repo: 'lambda/nodejs', tag: process.env.LEITURA_BASE_TAG || '22', arch: ARCH === 'arm64' ? 'arm64' : 'amd64' };
const ORT_ARCH = ARCH === 'arm64' ? 'arm64' : 'x64';
const FFMPEG = {
  // ffmpeg 7.0.2 estático (johnvansickle), sha256 conferido em 31/10/2026
  arm64: { url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz', sha256: 'f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1' },
  x86_64: { url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz', sha256: 'abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67' },
}[ARCH];
const DIR = path.join(raiz, '.infra', 'leitura-lambda');
const PARTE = 8 * 1024 * 1024;

for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
  if (process.env[k] && process.env[k] === process.env[`REMOTION_${k}`]) throw new Error(`${k} = REMOTION_${k}: use o perfil admin (gusta-cli), não a chave do render`);
}

const log = (...a) => console.log('[leitura-lambda]', ...a);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const sh = (cmd, args, o = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...o });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (nome, d) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : d; };

// ───────── build: contexto da camada ─────────

async function baixarFfmpeg() {
  const tar = path.join(DIR, 'cache', `ffmpeg-${ARCH}-static.tar.xz`);
  mkdirSync(path.dirname(tar), { recursive: true });
  if (!existsSync(tar) || sha(readFileSync(tar)) !== FFMPEG.sha256) {
    log(`baixando ffmpeg estático ${ARCH}…`);
    const r = await fetch(FFMPEG.url);
    if (!r.ok) throw new Error(`ffmpeg: HTTP ${r.status}`);
    writeFileSync(tar, Buffer.from(await r.arrayBuffer()));
  }
  const got = sha(readFileSync(tar));
  if (got !== FFMPEG.sha256) throw new Error(`ffmpeg: sha256 ${got} ≠ ${FFMPEG.sha256} (a release mudou: confira e atualize o pin)`);
  return tar;
}

async function build() {
  const ctx = path.join(DIR, 'ctx');
  rmSync(ctx, { recursive: true, force: true });
  const task = path.join(ctx, 'var', 'task');
  const bin = path.join(ctx, 'opt', 'bin');
  mkdirSync(task, { recursive: true });
  mkdirSync(bin, { recursive: true });

  log('esbuild do handler (api/src/medicao/leitura/handler.ts)…');
  sh(path.join(raiz, 'node_modules', '.bin', 'esbuild'), [
    path.join(raiz, 'api', 'src', 'medicao', 'leitura', 'handler.ts'), '--bundle', '--platform=node', '--target=node22', '--format=cjs',
    '--external:onnxruntime-node', `--outfile=${path.join(task, 'index.js')}`, '--log-level=warning', '--legal-comments=none',
  ]);

  // onnxruntime-node só com o binário linux da arquitetura (o pacote traz todas as plataformas: 287 MB)
  const ort = path.join(raiz, 'node_modules', 'onnxruntime-node');
  const ortDst = path.join(task, 'node_modules', 'onnxruntime-node');
  mkdirSync(ortDst, { recursive: true });
  cpSync(path.join(ort, 'package.json'), path.join(ortDst, 'package.json'));
  cpSync(path.join(ort, 'dist'), path.join(ortDst, 'dist'), { recursive: true });
  cpSync(path.join(ort, 'bin', 'napi-v6', 'linux', ORT_ARCH), path.join(ortDst, 'bin', 'napi-v6', 'linux', ORT_ARCH), { recursive: true });
  cpSync(path.join(raiz, 'node_modules', 'onnxruntime-common'), path.join(task, 'node_modules', 'onnxruntime-common'), { recursive: true });

  const modelos = path.join(raiz, 'api', 'src', 'medicao', 'modelos');
  for (const m of ['face_detection_yunet_2023mar.onnx', 'face_recognition_sface_2021dec.onnx']) {
    if (!existsSync(path.join(modelos, m))) throw new Error(`modelo ausente: ${m} (rode bash api/src/medicao/modelos/baixar.sh)`);
    mkdirSync(path.join(task, 'modelos'), { recursive: true });
    cpSync(path.join(modelos, m), path.join(task, 'modelos', m));
  }

  const tarFf = await baixarFfmpeg();
  const tmp = path.join(DIR, 'cache', 'ffx');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  sh('tar', ['-xJf', tarFf, '-C', tmp]);
  const pasta = sh('ls', [tmp]).toString().trim().split('\n')[0];
  for (const b of ['ffmpeg', 'ffprobe']) cpSync(path.join(tmp, pasta, b), path.join(bin, b));
  writeFileSync(path.join(task, 'BUILD.json'), JSON.stringify({ commit: gitSha(), arch: ARCH, ffmpeg: pasta, quando: new Date().toISOString() }, null, 2));

  sh('chmod', ['-R', 'a+rX', ctx]);
  for (const b of ['ffmpeg', 'ffprobe']) chmodSync(path.join(bin, b), 0o755);

  // camada: tar determinístico (root:root, sem metadados do macOS)
  const tarPath = path.join(DIR, 'camada.tar');
  rmSync(tarPath, { force: true });
  // GNU tar (Linux/VPS) não tem --uid/--no-mac-metadata: mesmo resultado com --owner/--group numéricos
  const gnuTar = process.platform === 'linux';
  const donoTar = gnuTar
    ? ['--owner=0', '--group=0', '--numeric-owner', '--no-xattrs', '--no-acls', '--format', 'pax']
    : ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root', '--no-mac-metadata', '--no-xattrs', '--no-acls', '--format', 'pax'];
  sh('tar', [...donoTar, '-cf', tarPath, '-C', ctx, 'var/task', 'opt/bin'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const tarBuf = readFileSync(tarPath);
  const gz = gzipSync(tarBuf, { level: 6 });
  writeFileSync(path.join(DIR, 'camada.tar.gz'), gz);
  const camada = { diffId: `sha256:${sha(tarBuf)}`, digest: `sha256:${sha(gz)}`, size: gz.length, path: path.join(DIR, 'camada.tar.gz') };
  log(`camada: ${(tarBuf.length / 1e6).toFixed(1)} MB → ${(gz.length / 1e6).toFixed(1)} MB gz, ${camada.digest.slice(0, 19)}`);
  return camada;
}

function gitSha() {
  try { return sh('git', ['-C', raiz, 'rev-parse', '--short', 'HEAD']).toString().trim() + (sh('git', ['-C', raiz, 'status', '--porcelain', 'api/src/medicao']).toString().trim() ? '+dirty' : ''); } catch { return 'desconhecido'; }
}

// ───────── base pública (public.ecr.aws) ─────────

const MANIFESTOS = [
  'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

async function base() {
  const tok = (await (await fetch(`https://public.ecr.aws/token/?scope=repository:${BASE.repo}:pull`)).json()).token;
  const get = async (p, accept) => {
    const r = await fetch(`https://public.ecr.aws/v2/${BASE.repo}/${p}`, { headers: { authorization: `Bearer ${tok}`, accept: accept ?? MANIFESTOS } });
    if (!r.ok) throw new Error(`base ${p}: HTTP ${r.status}`);
    return r;
  };
  let man = await (await get(`manifests/${BASE.tag}`)).json();
  if (man.manifests) {
    const m = man.manifests.find((x) => x.platform?.architecture === BASE.arch && x.platform?.os === 'linux');
    if (!m) throw new Error(`base sem ${BASE.arch}`);
    man = await (await get(`manifests/${m.digest}`)).json();
    man.__digest = m.digest;
  }
  const cache = path.join(DIR, 'cache', 'blobs');
  mkdirSync(cache, { recursive: true });
  const blob = async (digest) => {
    const f = path.join(cache, digest.replace(':', '_'));
    if (!existsSync(f) || `sha256:${sha(readFileSync(f))}` !== digest) {
      const r = await get(`blobs/${digest}`, '*/*');
      writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      if (`sha256:${sha(readFileSync(f))}` !== digest) throw new Error(`blob ${digest} corrompido`);
    }
    return f;
  };
  const config = JSON.parse(readFileSync(await blob(man.config.digest), 'utf8'));
  const layers = [];
  for (const l of man.layers) layers.push({ ...l, path: await blob(l.digest) });
  log(`base ${BASE.repo}:${BASE.tag} ${BASE.arch} ${man.__digest ?? ''} (${layers.length} camadas)`);
  return { man, config, layers };
}

// ───────── ECR ─────────

async function ecr() {
  const E = require('@aws-sdk/client-ecr');
  return { E, cli: new E.ECRClient({ region: REGION }) };
}

async function subirBlob({ E, cli }, digest, arquivoOuBuf) {
  const chk = await cli.send(new E.BatchCheckLayerAvailabilityCommand({ repositoryName: REPO, layerDigests: [digest] }));
  if (chk.layers?.[0]?.layerAvailability === 'AVAILABLE') return;
  const buf = Buffer.isBuffer(arquivoOuBuf) ? arquivoOuBuf : readFileSync(arquivoOuBuf);
  const { uploadId } = await cli.send(new E.InitiateLayerUploadCommand({ repositoryName: REPO }));
  for (let off = 0; off < buf.length; off += PARTE) {
    const fim = Math.min(buf.length, off + PARTE);
    await cli.send(new E.UploadLayerPartCommand({ repositoryName: REPO, uploadId, partFirstByte: off, partLastByte: fim - 1, layerPartBlob: buf.subarray(off, fim) }));
  }
  await cli.send(new E.CompleteLayerUploadCommand({ repositoryName: REPO, uploadId, layerDigests: [digest] }));
  log(`  blob ${digest.slice(0, 19)} (${(buf.length / 1e6).toFixed(1)} MB) enviado`);
}

async function garantirRepo({ E, cli }) {
  try {
    await cli.send(new E.CreateRepositoryCommand({ repositoryName: REPO, imageScanningConfiguration: { scanOnPush: false }, imageTagMutability: 'MUTABLE', tags: [{ Key: 'projeto', Value: 'hookmill' }] }));
    log(`repositório ECR ${REPO} criado`);
  } catch (e) {
    if (e.name !== 'RepositoryAlreadyExistsException') throw e;
  }
  // só as 5 últimas imagens ficam
  await cli.send(new E.PutLifecyclePolicyCommand({ repositoryName: REPO, lifecyclePolicyText: JSON.stringify({ rules: [{ rulePriority: 1, description: 'mantem 5', selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 5 }, action: { type: 'expire' } }] }) }));
}

async function pushImagem(camada) {
  const c = await ecr();
  await garantirRepo(c);
  const b = await base();
  for (const l of b.layers) await subirBlob(c, l.digest, l.path);
  await subirBlob(c, camada.digest, camada.path);
  const cfg = structuredClone(b.config);
  cfg.config = cfg.config ?? {};
  const envBase = (cfg.config.Env ?? []).filter((e) => !/^(FFMPEG_PATH|FFPROBE_PATH|YUNET_MODEL_PATH|SFACE_MODEL_PATH|LEITURA_TMP_DIR)=/.test(e));
  cfg.config.Env = [...envBase, 'FFMPEG_PATH=/opt/bin/ffmpeg', 'FFPROBE_PATH=/opt/bin/ffprobe',
    'YUNET_MODEL_PATH=/var/task/modelos/face_detection_yunet_2023mar.onnx', 'SFACE_MODEL_PATH=/var/task/modelos/face_recognition_sface_2021dec.onnx',
    'LEITURA_TMP_DIR=/tmp/leitura'];
  cfg.config.Cmd = ['index.handler'];
  cfg.rootfs.diff_ids = [...cfg.rootfs.diff_ids, camada.diffId];
  cfg.history = [...(cfg.history ?? []), { created: new Date().toISOString(), created_by: `scripts/leitura-lambda.mjs ${gitSha()}` }];
  cfg.created = new Date().toISOString();
  const cfgBuf = Buffer.from(JSON.stringify(cfg));
  const cfgDigest = `sha256:${sha(cfgBuf)}`;
  await subirBlob(c, cfgDigest, cfgBuf);
  const oci = b.man.mediaType === 'application/vnd.oci.image.manifest.v1+json' || (!b.man.mediaType && b.man.config.mediaType?.includes('oci'));
  const manifesto = {
    schemaVersion: 2,
    mediaType: oci ? 'application/vnd.oci.image.manifest.v1+json' : 'application/vnd.docker.distribution.manifest.v2+json',
    config: { mediaType: b.man.config.mediaType, size: cfgBuf.length, digest: cfgDigest },
    layers: [
      ...b.man.layers.map(({ mediaType, size, digest }) => ({ mediaType, size, digest })),
      { mediaType: oci ? 'application/vnd.oci.image.layer.v1.tar+gzip' : 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: camada.size, digest: camada.digest },
    ],
  };
  const txt = JSON.stringify(manifesto);
  const tag = `${gitSha().replace('+', '-')}-${Date.now().toString(36)}`;
  const r = await c.cli.send(new c.E.PutImageCommand({ repositoryName: REPO, imageManifest: txt, imageManifestMediaType: manifesto.mediaType, imageTag: tag }));
  const conta = (await c.cli.send(new c.E.DescribeRepositoriesCommand({ repositoryNames: [REPO] }))).repositories[0].repositoryUri;
  const uri = `${conta}@${r.image.imageId.imageDigest}`;
  log(`imagem ${tag} → ${uri}`);
  return uri;
}

// ───────── IAM + Lambda ─────────

async function garantirRole() {
  const I = require('@aws-sdk/client-iam');
  const cli = new I.IAMClient({ region: REGION });
  try {
    return (await cli.send(new I.GetRoleCommand({ RoleName: ROLE }))).Role.Arn;
  } catch (e) {
    if (e.name !== 'NoSuchEntityException') throw e;
  }
  const r = await cli.send(new I.CreateRoleCommand({
    RoleName: ROLE, Description: 'HookMill: leitura do anúncio (só CloudWatch Logs)', Tags: [{ Key: 'projeto', Value: 'hookmill' }],
    AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }),
  }));
  await cli.send(new I.AttachRolePolicyCommand({ RoleName: ROLE, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }));
  log(`role ${ROLE} criada; esperando propagar…`);
  await dormir(12_000);
  return r.Role.Arn;
}

// vCPU da Lambda: 1 a cada 1769 MB, arredondado pra cima (3008 MB = 2 núcleos visíveis)
const threadsDe = (mem) => String(Math.max(1, Math.min(6, Math.ceil(mem / 1769))));

// MEDICAO_TEMPO=1 no ambiente do deploy = a função loga o tempo de cada parte da trilha (CloudWatch)
const envDaFuncao = (mem) => ({ MEDICAO_ONNX_THREADS: threadsDe(mem), ...(process.env.MEDICAO_TEMPO ? { MEDICAO_TEMPO: '1' } : {}) });

async function lambda() {
  const Lm = require('@aws-sdk/client-lambda');
  return { Lm, cli: new Lm.LambdaClient({ region: REGION }) };
}

async function esperarPronta({ Lm, cli }) {
  for (let i = 0; i < 120; i++) {
    const f = (await cli.send(new Lm.GetFunctionConfigurationCommand({ FunctionName: NOME })));
    if (f.State === 'Active' && f.LastUpdateStatus !== 'InProgress') {
      if (f.LastUpdateStatus === 'Failed') throw new Error(`atualização falhou: ${f.LastUpdateStatusReason}`);
      return f;
    }
    if (f.State === 'Failed') throw new Error(`função falhou: ${f.StateReason}`);
    await dormir(3000);
  }
  throw new Error('função não ficou pronta em 6 min');
}

async function garantirFuncao(uri, mem) {
  const L = await lambda();
  const { Lm, cli } = L;
  const roleArn = await garantirRole();
  const cfg = {
    FunctionName: NOME, Role: roleArn, MemorySize: mem, Timeout: 600, EphemeralStorage: { Size: 2048 },
    Description: 'HookMill: leitura de mídia do anúncio (ffmpeg + YuNet/SFace). docs/contratos/leitura-lambda-v1.md',
    Environment: { Variables: envDaFuncao(mem) },
  };
  let existe = true;
  try { await cli.send(new Lm.GetFunctionCommand({ FunctionName: NOME })); } catch (e) { if (e.name === 'ResourceNotFoundException') existe = false; else throw e; }
  if (!existe) {
    for (let i = 0; ; i++) {
      try {
        await cli.send(new Lm.CreateFunctionCommand({ ...cfg, PackageType: 'Image', Code: { ImageUri: uri }, Architectures: [ARCH], Tags: { projeto: 'hookmill' } }));
        break;
      } catch (e) {
        if (i < 6 && /cannot be assumed|role/i.test(e.message)) { log('role ainda propagando…'); await dormir(8000); continue; }
        throw e;
      }
    }
    log(`função ${NOME} criada`);
  } else {
    await esperarPronta(L);
    await cli.send(new Lm.UpdateFunctionCodeCommand({ FunctionName: NOME, ImageUri: uri, Architectures: [ARCH] }));
    await esperarPronta(L);
    await cli.send(new Lm.UpdateFunctionConfigurationCommand(cfg));
    log(`função ${NOME} atualizada`);
  }
  const f = await esperarPronta(L);
  // a API invoca com a chave do render: política de RECURSO na função (sem mexer na política do usuário; o freio de
  // orçamento, Deny * no usuário, continua valendo)
  const conta = f.FunctionArn.split(':')[4];
  try {
    await cli.send(new Lm.AddPermissionCommand({ FunctionName: NOME, StatementId: 'api-hookmill-invoca', Action: 'lambda:InvokeFunction', Principal: `arn:aws:iam::${conta}:user/${INVOCADOR}` }));
    log(`permissão de invocação pro usuário ${INVOCADOR}`);
  } catch (e) {
    if (e.name !== 'ResourceConflictException') throw e;
  }
  await garantirLogs();
  return f;
}

async function garantirLogs() {
  const C = require('@aws-sdk/client-cloudwatch-logs');
  const cli = new C.CloudWatchLogsClient({ region: REGION });
  const grupo = `/aws/lambda/${NOME}`;
  try { await cli.send(new C.CreateLogGroupCommand({ logGroupName: grupo })); } catch (e) { if (e.name !== 'ResourceAlreadyExistsException') throw e; }
  await cli.send(new C.PutRetentionPolicyCommand({ logGroupName: grupo, retentionInDays: 7 }));
}

// ───────── comandos ─────────

async function status() {
  const { Lm, cli } = await lambda();
  const f = await cli.send(new Lm.GetFunctionCommand({ FunctionName: NOME }));
  const c = f.Configuration;
  console.log(JSON.stringify({ funcao: c.FunctionName, arn: c.FunctionArn, imagem: f.Code.ImageUri, memoria: c.MemorySize, timeout: c.Timeout, disco: c.EphemeralStorage?.Size, arquitetura: c.Architectures, estado: c.State, atualizado: c.LastModified, env: c.Environment?.Variables }, null, 2));
}

async function memoria(mem) {
  const L = await lambda();
  await esperarPronta(L);
  await L.cli.send(new L.Lm.UpdateFunctionConfigurationCommand({ FunctionName: NOME, MemorySize: mem, Environment: { Variables: envDaFuncao(mem) } }));
  await esperarPronta(L);
  log(`memória ${mem} MB, ${threadsDe(mem)} threads ONNX`);
}

async function apagar() {
  const { Lm, cli } = await lambda();
  await cli.send(new Lm.DeleteFunctionCommand({ FunctionName: NOME })).catch((e) => log('função:', e.name));
  const { E, cli: ce } = await ecr();
  await ce.send(new E.DeleteRepositoryCommand({ repositoryName: REPO, force: true })).catch((e) => log('repositório:', e.name));
  const I = require('@aws-sdk/client-iam');
  const ci = new I.IAMClient({ region: REGION });
  await ci.send(new I.DetachRolePolicyCommand({ RoleName: ROLE, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' })).catch(() => undefined);
  await ci.send(new I.DeleteRoleCommand({ RoleName: ROLE })).catch((e) => log('role:', e.name));
  const C = require('@aws-sdk/client-cloudwatch-logs');
  await new C.CloudWatchLogsClient({ region: REGION }).send(new C.DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${NOME}` })).catch(() => undefined);
  log('apagado');
}

const cmd = process.argv[2];
mkdirSync(DIR, { recursive: true });
if (cmd === 'build') await build();
else if (cmd === 'deploy') {
  const mem = Number(arg('--mem', '3008'));
  const camada = await build();
  const uri = await pushImagem(camada);
  const f = await garantirFuncao(uri, mem);
  log(`pronto: ${f.FunctionName} (${f.MemorySize} MB, ${f.Architectures}) — ANALYZE_LAMBDA_FUNCTION=${f.FunctionName}`);
} else if (cmd === 'status') await status();
else if (cmd === 'memoria') await memoria(Number(process.argv[3]));
else if (cmd === 'apagar') await apagar();
else {
  console.log('uso: node scripts/leitura-lambda.mjs deploy [--mem 3008] [--arch x86_64|arm64] | build | status | memoria <MB> | apagar');
  process.exit(1);
}
