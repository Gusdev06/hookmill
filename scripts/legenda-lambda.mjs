// Função AWS Lambda `hookmill-legenda` da troca de texto (troca-texto-queimado-v1 §15.6.4, §15.10, §16). Dono: video.
// Monta a imagem SEM Docker, como scripts/leitura-lambda.mjs e o deploy.mjs da S1: base oficial
// public.ecr.aws/lambda/python:3.12 x86_64 + 1 camada com o código (api/src/medicao/troca/py, o MESMO do PLATE_IMPL=local),
// as wheels fixadas (numpy 2.0.2, opencv-python-headless 5.0.0.93, pillow 11.3.0; sha256 do PyPI conferido), as fontes OFL
// de video/public/fonts e o ffmpeg/ffprobe estático amd64 (md5 do publicador conferido, sha256 fixado).
// x86_64 desde 06/11 (G1): no arm64 a pré-seleção em Pillow dava outro corpo e outra fonte que a VPS e a API (x86). Sobe pro ECR pela API do ECR e cria/atualiza
// a função (3008 MB, x86_64, efêmero 2048 MB, timeout 300 s), a role (só CloudWatch Logs: arquivos por URL assinada),
// a permissão de invocação do usuário da API e os logs (7 dias). Idempotente.
//
// Credencial: a cadeia padrão da AWS (perfil admin) — NUNCA as REMOTION_AWS_* (o usuário do render não cria ECR/IAM).
// Uso (da raiz):
//   node scripts/legenda-lambda.mjs build                  # só a camada (.infra/legenda-lambda/), sem AWS
//   node scripts/legenda-lambda.mjs deploy                 # build + push + role + função + permissão + logs
//   node scripts/legenda-lambda.mjs status
//   node scripts/legenda-lambda.mjs invocar <evento.json>  # 1 invocação, imprime a resposta e o REPORT (teste do G1)
//   node scripts/legenda-lambda.mjs apagar                 # função, repositório, role e logs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGION = process.env.PLATE_LAMBDA_REGION || 'us-east-1';
const NOME = process.env.PLATE_LAMBDA_FUNCTION || 'hookmill-legenda';
const ROLE = `${NOME}-role`;
const INVOCADOR = process.env.LEGENDA_INVOCADOR_USER || 'hookmill-remotion-deploy'; // usuário IAM da API (REMOTION_AWS_*)
const MEM = Number(process.env.PLATE_LAMBDA_MEM_MB || 3008);
const DIR = path.join(raiz, '.infra', 'legenda-lambda');
const PY = path.join(raiz, 'api', 'src', 'medicao', 'troca', 'py');
const FONTES = path.join(raiz, 'video', 'public', 'fonts');
const FONTES_LEG = path.join(PY, 'fontes_legenda');
const BASE = { repo: 'lambda/python', tag: '3.12', arch: 'amd64' };
const ARQ_LAMBDA = 'x86_64';
// 7.0.2-static; md5 7fa72b652e19bf84c9461e332ea1cdf3 = o .md5 publicado em 06/11
const FFMPEG = { url: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz', sha256: 'abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67' };
// §15.6.4: versões fixas, as da S1 (o x264 e o DIS mudam de resultado entre versões)
// Raqm do Pillow (kerning, igual ao Chrome) carrega a libfribidi pelo dlopen; a imagem da AWS não tem. Pacote do Debian 12
// (o mesmo da VPS), sha1 eb2357f7… conferido no snapshot.debian.org em 06/11; LGPL-2.1, ligação dinâmica, copyright junto.
const FRIBIDI = { url: 'http://deb.debian.org/debian/pool/main/f/fribidi/libfribidi0_1.0.8-2.1_amd64.deb', sha256: '87fce56627aab7b2968501d370aa3ed6d1c792119efa765e71a690bdfe570e62' };
const WHEELS = [['numpy', '2.0.2'], ['opencv-python-headless', '5.0.0.93'], ['pillow', '11.3.0']];
const PARTE = 8 * 1024 * 1024;

for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
  if (process.env[k] && process.env[k] === process.env[`REMOTION_${k}`]) throw new Error(`${k} = REMOTION_${k}: use o perfil admin, não a chave do render`);
}
const log = (...a) => console.log('[legenda-lambda]', ...a);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: ['ignore', 'pipe', 'inherit'], ...o });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── build ─────────

async function baixar(url, dst, sha256) {
  if (existsSync(dst) && sha(readFileSync(dst)) === sha256) return dst;
  log(`baixando ${path.basename(dst)}…`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (sha(b) !== sha256) throw new Error(`sha256 de ${path.basename(dst)} não confere`);
  writeFileSync(dst, b);
  return dst;
}

/** Wheel cp312 manylinux x86_64 da versão fixada (as mesmas tags que o pip instala na VPS), pelo JSON do PyPI (sha256 de lá). */
async function wheel(nome, versao) {
  const j = await (await fetch(`https://pypi.org/pypi/${nome}/${versao}/json`)).json();
  const ok = (f) => /manylinux.*x86_64/.test(f.filename) && (/cp312-cp312/.test(f.filename) || /cp3\d-abi3/.test(f.filename) || /cp37-abi3/.test(f.filename));
  const f = j.urls.filter((u) => u.packagetype === 'bdist_wheel' && ok(u)).sort((a, b) => a.filename.localeCompare(b.filename)).pop();
  if (!f) throw new Error(`sem wheel x86_64 para ${nome} ${versao}`);
  return baixar(f.url, path.join(DIR, 'cache', f.filename), f.digests.sha256);
}

async function build() {
  mkdirSync(path.join(DIR, 'cache'), { recursive: true });
  const ctx = path.join(DIR, 'ctx');
  rmSync(ctx, { recursive: true, force: true });
  const task = path.join(ctx, 'var', 'task'), bin = path.join(ctx, 'opt', 'bin');
  mkdirSync(task, { recursive: true }); mkdirSync(bin, { recursive: true });
  for (const f of readdirSync(PY)) if (f.endsWith('.py')) cpSync(path.join(PY, f), path.join(task, f));
  // fontes: só as .woff2 do catálogo e as licenças (§15.7.1); nada de fonte do sistema
  mkdirSync(path.join(task, 'fontes', 'licenses'), { recursive: true });
  for (const f of readdirSync(FONTES)) if (f.endsWith('.woff2')) cpSync(path.join(FONTES, f), path.join(task, 'fontes', f));
  for (const f of readdirSync(path.join(FONTES, 'licenses'))) cpSync(path.join(FONTES, 'licenses', f), path.join(task, 'fontes', 'licenses', f));
  // fontes da LEGENDA (F2, leg_fontes.py): TTFs OFL empacotados em py/fontes_legenda (Gabarito, Poppins 800/900, Montserrat, Archivo, Manrope, Inter, TikTok Sans)
  mkdirSync(path.join(task, 'fontes_legenda'), { recursive: true });
  for (const f of readdirSync(FONTES_LEG)) if (f.endsWith('.ttf')) cpSync(path.join(FONTES_LEG, f), path.join(task, 'fontes_legenda', f));
  for (const [n, v] of WHEELS) sh('unzip', ['-q', '-o', await wheel(n, v), '-d', task]);
  // libfribidi em /var/task/lib (está no LD_LIBRARY_PATH da imagem Python da AWS)
  const deb = await baixar(FRIBIDI.url, path.join(DIR, 'cache', path.basename(FRIBIDI.url)), FRIBIDI.sha256);
  const dx = path.join(DIR, 'fribidi'); rmSync(dx, { recursive: true, force: true }); mkdirSync(dx, { recursive: true });
  sh('ar', ['x', deb], { cwd: dx });
  const dataTar = readdirSync(dx).find((f) => f.startsWith('data.tar'));
  sh('tar', ['-xf', dataTar], { cwd: dx });
  mkdirSync(path.join(task, 'lib'), { recursive: true });
  cpSync(path.join(dx, 'usr/lib/x86_64-linux-gnu/libfribidi.so.0.4.0'), path.join(task, 'lib', 'libfribidi.so.0'));
  mkdirSync(path.join(task, 'licenses'), { recursive: true });
  cpSync(path.join(dx, 'usr/share/doc/libfribidi0/copyright'), path.join(task, 'licenses', 'libfribidi0-copyright'));
  const tar = await baixar(FFMPEG.url, path.join(DIR, 'cache', 'ffmpeg-amd64-static.tar.xz'), FFMPEG.sha256);
  const tmp = path.join(DIR, 'ffx'); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  sh('tar', ['-xJf', tar, '-C', tmp]);
  const p = readdirSync(tmp)[0];
  for (const b of ['ffmpeg', 'ffprobe']) { cpSync(path.join(tmp, p, b), path.join(bin, b)); chmodSync(path.join(bin, b), 0o755); }
  sh('chmod', ['-R', 'a+rX', ctx]);
  const tarPath = path.join(DIR, 'camada.tar');
  const gnu = process.platform === 'darwin' ? ['--no-mac-metadata', '--no-xattrs', '--no-acls'] : [];
  sh('tar', ['--owner=0', '--group=0', '--numeric-owner', ...gnu, '--format', 'pax', '-cf', tarPath, '-C', ctx, 'var/task', 'opt/bin'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const t = readFileSync(tarPath), gz = gzipSync(t, { level: 6 });
  writeFileSync(path.join(DIR, 'camada.tar.gz'), gz);
  const fontes = readdirSync(path.join(task, 'fontes')).filter((f) => f.endsWith('.woff2')).length;
  log(`camada ${(t.length / 1e6).toFixed(0)} MB → ${(gz.length / 1e6).toFixed(0)} MB gz; ${fontes} fontes; wheels ${WHEELS.map((w) => w.join(' ')).join(', ')}`);
  return { diffId: `sha256:${sha(t)}`, digest: `sha256:${sha(gz)}`, size: gz.length, path: path.join(DIR, 'camada.tar.gz') };
}

// ───────── imagem (ECR sem Docker) ─────────

const MANIF = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].join(', ');

async function base() {
  const tok = (await (await fetch(`https://public.ecr.aws/token/?scope=repository:${BASE.repo}:pull`)).json()).token;
  const get = async (p, accept) => { const r = await fetch(`https://public.ecr.aws/v2/${BASE.repo}/${p}`, { headers: { authorization: `Bearer ${tok}`, accept: accept ?? MANIF } }); if (!r.ok) throw new Error(`base ${p}: ${r.status}`); return r; };
  let man = await (await get(`manifests/${BASE.tag}`)).json();
  if (man.manifests) { const m = man.manifests.find((x) => x.platform?.architecture === BASE.arch && x.platform?.os === 'linux'); man = await (await get(`manifests/${m.digest}`)).json(); }
  const cache = path.join(DIR, 'blobs'); mkdirSync(cache, { recursive: true });
  const blob = async (d) => { const f = path.join(cache, d.replace(':', '_')); if (!existsSync(f) || `sha256:${sha(readFileSync(f))}` !== d) writeFileSync(f, Buffer.from(await (await get(`blobs/${d}`, '*/*')).arrayBuffer())); return f; };
  const config = JSON.parse(readFileSync(await blob(man.config.digest), 'utf8'));
  const layers = [];
  for (const l of man.layers) layers.push({ ...l, path: await blob(l.digest) });
  return { man, config, layers };
}

async function pushImagem(camada) {
  const E = require('@aws-sdk/client-ecr'), cli = new E.ECRClient({ region: REGION });
  try { await cli.send(new E.CreateRepositoryCommand({ repositoryName: NOME, imageScanningConfiguration: { scanOnPush: false }, tags: [{ Key: 'projeto', Value: 'hookmill' }] })); log('repositório criado'); }
  catch (e) { if (e.name !== 'RepositoryAlreadyExistsException') throw e; }
  await cli.send(new E.PutLifecyclePolicyCommand({ repositoryName: NOME, lifecyclePolicyText: JSON.stringify({ rules: [{ rulePriority: 1, description: 'guarda 3 imagens', selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 3 }, action: { type: 'expire' } }] }) }));
  const subir = async (d, arq) => {
    const chk = await cli.send(new E.BatchCheckLayerAvailabilityCommand({ repositoryName: NOME, layerDigests: [d] }));
    if (chk.layers?.[0]?.layerAvailability === 'AVAILABLE') return;
    const buf = Buffer.isBuffer(arq) ? arq : readFileSync(arq);
    const { uploadId } = await cli.send(new E.InitiateLayerUploadCommand({ repositoryName: NOME }));
    for (let o = 0; o < buf.length; o += PARTE) { const f = Math.min(buf.length, o + PARTE); await cli.send(new E.UploadLayerPartCommand({ repositoryName: NOME, uploadId, partFirstByte: o, partLastByte: f - 1, layerPartBlob: buf.subarray(o, f) })); }
    await cli.send(new E.CompleteLayerUploadCommand({ repositoryName: NOME, uploadId, layerDigests: [d] }));
    log(`blob ${d.slice(7, 19)} ${(buf.length / 1e6).toFixed(1)} MB`);
  };
  const b = await base();
  for (const l of b.layers) await subir(l.digest, l.path);
  await subir(camada.digest, camada.path);
  const cfg = structuredClone(b.config);
  cfg.config.Cmd = ['handler.handler'];
  cfg.rootfs.diff_ids = [...cfg.rootfs.diff_ids, camada.diffId];
  cfg.history = [...(cfg.history ?? []), { created: new Date().toISOString(), created_by: 'scripts/legenda-lambda.mjs' }];
  cfg.created = new Date().toISOString();
  const cb = Buffer.from(JSON.stringify(cfg)), cd = `sha256:${sha(cb)}`;
  await subir(cd, cb);
  const oci = b.man.mediaType === 'application/vnd.oci.image.manifest.v1+json' || (!b.man.mediaType && b.man.config.mediaType?.includes('oci'));
  const m = { schemaVersion: 2, mediaType: oci ? 'application/vnd.oci.image.manifest.v1+json' : 'application/vnd.docker.distribution.manifest.v2+json',
    config: { mediaType: b.man.config.mediaType, size: cb.length, digest: cd },
    layers: [...b.man.layers.map(({ mediaType, size, digest }) => ({ mediaType, size, digest })), { mediaType: oci ? 'application/vnd.oci.image.layer.v1.tar+gzip' : 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: camada.size, digest: camada.digest }] };
  const r = await cli.send(new E.PutImageCommand({ repositoryName: NOME, imageManifest: JSON.stringify(m), imageManifestMediaType: m.mediaType, imageTag: `v-${Date.now().toString(36)}` }));
  const uri = (await cli.send(new E.DescribeRepositoriesCommand({ repositoryNames: [NOME] }))).repositories[0].repositoryUri;
  return `${uri}@${r.image.imageId.imageDigest}`;
}

// ───────── role, função, permissão, logs ─────────

async function role() {
  const I = require('@aws-sdk/client-iam'), cli = new I.IAMClient({ region: REGION });
  try { return (await cli.send(new I.GetRoleCommand({ RoleName: ROLE }))).Role.Arn; } catch (e) { if (e.name !== 'NoSuchEntityException') throw e; }
  const r = await cli.send(new I.CreateRoleCommand({ RoleName: ROLE, Description: 'hookmill-legenda: so CloudWatch Logs; arquivos por URL assinada', Tags: [{ Key: 'projeto', Value: 'hookmill' }],
    AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }));
  await cli.send(new I.AttachRolePolicyCommand({ RoleName: ROLE, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' }));
  log('role criada');
  await dormir(12000);
  return r.Role.Arn;
}

async function lambda() {
  const Lm = require('@aws-sdk/client-lambda');
  return { Lm, cli: new Lm.LambdaClient({ region: REGION }) };
}

async function pronta({ Lm, cli }) {
  for (let i = 0; i < 100; i++) {
    const f = await cli.send(new Lm.GetFunctionConfigurationCommand({ FunctionName: NOME }));
    if (f.State === 'Failed') throw new Error(f.StateReason);
    if (f.State === 'Active' && f.LastUpdateStatus !== 'InProgress') return f;
    await dormir(3000);
  }
  throw new Error('função não ficou pronta');
}

async function funcao(uri) {
  const L = await lambda(), { Lm, cli } = L;
  const arn = await role();
  const cfg = { FunctionName: NOME, Role: arn, MemorySize: MEM, Timeout: 300, EphemeralStorage: { Size: 2048 },
    Description: 'HookMill troca de texto: medir_headline, placa_headline, juntar, conferir (troca-texto-queimado-v1 §16)',
    Environment: { Variables: { OMP_NUM_THREADS: '2' } } };
  let existe = true;
  try { await cli.send(new Lm.GetFunctionCommand({ FunctionName: NOME })); } catch (e) { if (e.name === 'ResourceNotFoundException') existe = false; else throw e; }
  if (!existe) {
    for (let i = 0; ; i++) {
      try { await cli.send(new Lm.CreateFunctionCommand({ ...cfg, PackageType: 'Image', Code: { ImageUri: uri }, Architectures: [ARQ_LAMBDA], Tags: { projeto: 'hookmill' } })); break; }
      catch (e) { if (i < 6 && /cannot be assumed|role/i.test(e.message)) { log('role ainda propagando…'); await dormir(8000); continue; } throw e; }
    }
    log(`função ${NOME} criada`);
  } else {
    await pronta(L);
    await cli.send(new Lm.UpdateFunctionCodeCommand({ FunctionName: NOME, ImageUri: uri, Architectures: [ARQ_LAMBDA] }));
    await pronta(L);
    await cli.send(new Lm.UpdateFunctionConfigurationCommand(cfg));
    log(`função ${NOME} atualizada`);
  }
  const f = await pronta(L);
  const conta = f.FunctionArn.split(':')[4];
  try {
    await cli.send(new Lm.AddPermissionCommand({ FunctionName: NOME, StatementId: 'api-hookmill-invoca', Action: 'lambda:InvokeFunction', Principal: `arn:aws:iam::${conta}:user/${INVOCADOR}` }));
    log(`permissão de invocação pro usuário ${INVOCADOR}`);
  } catch (e) { if (e.name !== 'ResourceConflictException') throw e; }
  const C = require('@aws-sdk/client-cloudwatch-logs'), cl = new C.CloudWatchLogsClient({ region: REGION }), g = `/aws/lambda/${NOME}`;
  try { await cl.send(new C.CreateLogGroupCommand({ logGroupName: g })); } catch (e) { if (e.name !== 'ResourceAlreadyExistsException') throw e; }
  await cl.send(new C.PutRetentionPolicyCommand({ logGroupName: g, retentionInDays: 7 }));
  return f;
}

async function status() {
  const { Lm, cli } = await lambda();
  const f = await cli.send(new Lm.GetFunctionCommand({ FunctionName: NOME }));
  const c = f.Configuration;
  console.log(JSON.stringify({ funcao: c.FunctionName, arn: c.FunctionArn, imagem: f.Code.ImageUri, memoria: c.MemorySize, timeout: c.Timeout, disco: c.EphemeralStorage?.Size, arquitetura: c.Architectures, estado: c.State, atualizado: c.LastModified }, null, 2));
}

async function invocar(arq) {
  const { Lm, cli } = await lambda();
  const out = await cli.send(new Lm.InvokeCommand({ FunctionName: NOME, InvocationType: 'RequestResponse', LogType: 'Tail', Payload: readFileSync(arq) }));
  const rep = Buffer.from(out.LogResult ?? '', 'base64').toString('utf8').split('\n').find((l) => l.startsWith('REPORT')) ?? '';
  console.log(Buffer.from(out.Payload ?? []).toString('utf8'));
  console.log(rep);
}

async function apagar() {
  const { Lm, cli } = await lambda();
  await cli.send(new Lm.DeleteFunctionCommand({ FunctionName: NOME })).catch((e) => log('função:', e.name));
  const E = require('@aws-sdk/client-ecr');
  await new E.ECRClient({ region: REGION }).send(new E.DeleteRepositoryCommand({ repositoryName: NOME, force: true })).catch((e) => log('repositório:', e.name));
  const I = require('@aws-sdk/client-iam'), ci = new I.IAMClient({ region: REGION });
  await ci.send(new I.DetachRolePolicyCommand({ RoleName: ROLE, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' })).catch(() => undefined);
  await ci.send(new I.DeleteRoleCommand({ RoleName: ROLE })).catch((e) => log('role:', e.name));
  const C = require('@aws-sdk/client-cloudwatch-logs');
  await new C.CloudWatchLogsClient({ region: REGION }).send(new C.DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${NOME}` })).catch(() => undefined);
  log('apagado');
}

const cmd = process.argv[2];
if (cmd === 'build') await build();
else if (cmd === 'deploy') { const c = await build(); const u = await pushImagem(c); const f = await funcao(u); log(JSON.stringify({ arn: f.FunctionArn, imagem: u, mem: f.MemorySize, timeout: f.Timeout })); }
else if (cmd === 'status') await status();
else if (cmd === 'invocar') await invocar(process.argv[3]);
else if (cmd === 'apagar') await apagar();
else { console.log('uso: legenda-lambda.mjs build | deploy | status | invocar <evento.json> | apagar'); process.exit(1); }
