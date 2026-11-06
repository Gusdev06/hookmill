// deploy.mjs — função da sonda S1 (contrato troca-texto-queimado §10). Mesmo padrão sem Docker do scripts/leitura-lambda.mjs:
// base oficial public.ecr.aws/lambda/python:3.12 arm64 + 1 camada (handler, wheels numpy/opencv/pillow nas MESMAS versões do Mac, fontes, ffmpeg estático).
// Credencial: perfil default = gusta-cli, admin. Nunca as REMOTION_AWS_*. A role só tem CloudWatch Logs: arquivos entram e saem por URL assinada.
// Uso: node deploy.mjs build | deploy | apagar
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..', '..', '..');
const REGION = 'us-east-1', NOME = 'hookmill-legenda-s1', ROLE = `${NOME}-role`, MEM = 3008;
const DIR = process.env.S1_BUILD; if (!DIR) throw new Error('defina S1_BUILD (pasta de build)');
const FF = path.join(raiz, '.infra', 'leitura-lambda', 'cache', 'ffmpeg-arm64-static.tar.xz');
const FF_SHA = 'f4149bb2b0784e30e99bdda85471c9b5930d3402014e934a5098b41d0f7201b1';
const WHL = process.env.S1_WHL;
const BASE = { repo: 'lambda/python', tag: '3.12', arch: 'arm64' };
const PARTE = 8 * 1024 * 1024;
for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) if (process.env[k]) throw new Error(`${k} no ambiente: use só o perfil default`);
const log = (...a) => console.log('[s1]', ...a);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sh = (c, a, o = {}) => execFileSync(c, a, { stdio: ['ignore', 'pipe', 'inherit'], ...o });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function build() {
  const ctx = path.join(DIR, 'ctx'); rmSync(ctx, { recursive: true, force: true });
  const task = path.join(ctx, 'var', 'task'), bin = path.join(ctx, 'opt', 'bin'); mkdirSync(task, { recursive: true }); mkdirSync(bin, { recursive: true });
  for (const f of readdirSync(path.join(aqui, 'lambda'))) if (f.endsWith('.py')) cpSync(path.join(aqui, 'lambda', f), path.join(task, f));
  cpSync(path.join(raiz, 'research_notes/limpar-legenda-teste-2026-11-05-s2/scripts/fontes'), path.join(task, 'fontes'), { recursive: true });
  for (const w of readdirSync(WHL)) if (w.endsWith('.whl')) sh('unzip', ['-q', '-o', path.join(WHL, w), '-d', task]);
  if (sha(readFileSync(FF)) !== FF_SHA) throw new Error('ffmpeg sha');
  const tmp = path.join(DIR, 'ffx'); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  sh('tar', ['-xJf', FF, '-C', tmp]); const p = sh('ls', [tmp]).toString().trim().split('\n')[0];
  for (const b of ['ffmpeg', 'ffprobe']) { cpSync(path.join(tmp, p, b), path.join(bin, b)); }
  sh('chmod', ['-R', 'a+rX', ctx]); for (const b of ['ffmpeg', 'ffprobe']) chmodSync(path.join(bin, b), 0o755);
  const tarPath = path.join(DIR, 'camada.tar');
  sh('tar', ['--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root', '--no-mac-metadata', '--no-xattrs', '--no-acls', '--format', 'pax', '-cf', tarPath, '-C', ctx, 'var/task', 'opt/bin'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const t = readFileSync(tarPath), gz = gzipSync(t, { level: 6 }); writeFileSync(path.join(DIR, 'camada.tar.gz'), gz);
  log(`camada ${(t.length / 1e6).toFixed(0)} MB → ${(gz.length / 1e6).toFixed(0)} MB gz`);
  return { diffId: `sha256:${sha(t)}`, digest: `sha256:${sha(gz)}`, size: gz.length, path: path.join(DIR, 'camada.tar.gz') };
}

const MANIF = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].join(', ');
async function base() {
  const tok = (await (await fetch(`https://public.ecr.aws/token/?scope=repository:${BASE.repo}:pull`)).json()).token;
  const get = async (p, accept) => { const r = await fetch(`https://public.ecr.aws/v2/${BASE.repo}/${p}`, { headers: { authorization: `Bearer ${tok}`, accept: accept ?? MANIF } }); if (!r.ok) throw new Error(`base ${p}: ${r.status}`); return r; };
  let man = await (await get(`manifests/${BASE.tag}`)).json();
  if (man.manifests) { const m = man.manifests.find((x) => x.platform?.architecture === BASE.arch && x.platform?.os === 'linux'); man = await (await get(`manifests/${m.digest}`)).json(); }
  const cache = path.join(DIR, 'blobs'); mkdirSync(cache, { recursive: true });
  const blob = async (d) => { const f = path.join(cache, d.replace(':', '_')); if (!existsSync(f) || `sha256:${sha(readFileSync(f))}` !== d) writeFileSync(f, Buffer.from(await (await get(`blobs/${d}`, '*/*')).arrayBuffer())); return f; };
  const config = JSON.parse(readFileSync(await blob(man.config.digest), 'utf8')); const layers = [];
  for (const l of man.layers) layers.push({ ...l, path: await blob(l.digest) });
  return { man, config, layers };
}

async function pushImagem(camada) {
  const E = require('@aws-sdk/client-ecr'), cli = new E.ECRClient({ region: REGION });
  try { await cli.send(new E.CreateRepositoryCommand({ repositoryName: NOME, imageScanningConfiguration: { scanOnPush: false }, tags: [{ Key: 'projeto', Value: 'hookmill' }, { Key: 'sonda', Value: 'legenda-s1' }] })); log('repositório criado'); } catch (e) { if (e.name !== 'RepositoryAlreadyExistsException') throw e; }
  const subir = async (d, arq) => {
    const chk = await cli.send(new E.BatchCheckLayerAvailabilityCommand({ repositoryName: NOME, layerDigests: [d] })); if (chk.layers?.[0]?.layerAvailability === 'AVAILABLE') return;
    const buf = Buffer.isBuffer(arq) ? arq : readFileSync(arq); const { uploadId } = await cli.send(new E.InitiateLayerUploadCommand({ repositoryName: NOME }));
    for (let o = 0; o < buf.length; o += PARTE) { const f = Math.min(buf.length, o + PARTE); await cli.send(new E.UploadLayerPartCommand({ repositoryName: NOME, uploadId, partFirstByte: o, partLastByte: f - 1, layerPartBlob: buf.subarray(o, f) })); }
    await cli.send(new E.CompleteLayerUploadCommand({ repositoryName: NOME, uploadId, layerDigests: [d] })); log(`blob ${d.slice(7, 19)} ${(buf.length / 1e6).toFixed(1)} MB`);
  };
  const b = await base(); for (const l of b.layers) await subir(l.digest, l.path); await subir(camada.digest, camada.path);
  const cfg = structuredClone(b.config); cfg.config.Cmd = ['handler.handler']; cfg.rootfs.diff_ids = [...cfg.rootfs.diff_ids, camada.diffId]; cfg.history = [...(cfg.history ?? []), { created: new Date().toISOString(), created_by: 'legenda-s1 deploy.mjs' }]; cfg.created = new Date().toISOString();
  const cb = Buffer.from(JSON.stringify(cfg)), cd = `sha256:${sha(cb)}`; await subir(cd, cb);
  const oci = b.man.mediaType === 'application/vnd.oci.image.manifest.v1+json' || (!b.man.mediaType && b.man.config.mediaType?.includes('oci'));
  const m = { schemaVersion: 2, mediaType: oci ? 'application/vnd.oci.image.manifest.v1+json' : 'application/vnd.docker.distribution.manifest.v2+json', config: { mediaType: b.man.config.mediaType, size: cb.length, digest: cd },
    layers: [...b.man.layers.map(({ mediaType, size, digest }) => ({ mediaType, size, digest })), { mediaType: oci ? 'application/vnd.oci.image.layer.v1.tar+gzip' : 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: camada.size, digest: camada.digest }] };
  const r = await cli.send(new E.PutImageCommand({ repositoryName: NOME, imageManifest: JSON.stringify(m), imageManifestMediaType: m.mediaType, imageTag: `s1-${Date.now().toString(36)}` }));
  const uri = (await cli.send(new E.DescribeRepositoriesCommand({ repositoryNames: [NOME] }))).repositories[0].repositoryUri;
  return `${uri}@${r.image.imageId.imageDigest}`;
}

async function role() {
  const I = require('@aws-sdk/client-iam'), cli = new I.IAMClient({ region: REGION });
  try { return (await cli.send(new I.GetRoleCommand({ RoleName: ROLE }))).Role.Arn; } catch (e) { if (e.name !== 'NoSuchEntityException') throw e; }
  const r = await cli.send(new I.CreateRoleCommand({ RoleName: ROLE, Description: 'Sonda S1 legenda: so CloudWatch Logs', Tags: [{ Key: 'projeto', Value: 'hookmill' }, { Key: 'sonda', Value: 'legenda-s1' }], AssumeRolePolicyDocument: JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }] }) }));
  await cli.send(new I.AttachRolePolicyCommand({ RoleName: ROLE, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' })); log('role criada'); await dormir(12000); return r.Role.Arn;
}

async function funcao(uri) {
  const Lm = require('@aws-sdk/client-lambda'), cli = new Lm.LambdaClient({ region: REGION }); const arn = await role();
  const cfg = { FunctionName: NOME, Role: arn, MemorySize: MEM, Timeout: 900, EphemeralStorage: { Size: 2048 }, Description: 'Sonda S1 legenda (research_notes/legenda-s1-aws-2026-11-05). Fora do produto.' };
  const pronta = async () => { for (let i = 0; i < 100; i++) { const f = await cli.send(new Lm.GetFunctionConfigurationCommand({ FunctionName: NOME })); if (f.State === 'Failed') throw new Error(f.StateReason); if (f.State === 'Active' && f.LastUpdateStatus !== 'InProgress') return f; await dormir(3000); } throw new Error('não ficou pronta'); };
  let ex = true; try { await cli.send(new Lm.GetFunctionCommand({ FunctionName: NOME })); } catch (e) { if (e.name === 'ResourceNotFoundException') ex = false; else throw e; }
  if (!ex) {
    for (let i = 0; ; i++) { try { await cli.send(new Lm.CreateFunctionCommand({ ...cfg, PackageType: 'Image', Code: { ImageUri: uri }, Architectures: ['arm64'], Tags: { projeto: 'hookmill', sonda: 'legenda-s1' } })); break; } catch (e) { if (i < 6 && /cannot be assumed|role/i.test(e.message)) { await dormir(8000); continue; } throw e; } }
  } else { await pronta(); await cli.send(new Lm.UpdateFunctionCodeCommand({ FunctionName: NOME, ImageUri: uri, Architectures: ['arm64'] })); await pronta(); await cli.send(new Lm.UpdateFunctionConfigurationCommand(cfg)); }
  const f = await pronta();
  const C = require('@aws-sdk/client-cloudwatch-logs'), cl = new C.CloudWatchLogsClient({ region: REGION }), g = `/aws/lambda/${NOME}`;
  try { await cl.send(new C.CreateLogGroupCommand({ logGroupName: g })); } catch (e) { if (e.name !== 'ResourceAlreadyExistsException') throw e; }
  await cl.send(new C.PutRetentionPolicyCommand({ logGroupName: g, retentionInDays: 7 }));
  return f;
}

async function apagar() {
  const Lm = require('@aws-sdk/client-lambda'); await new Lm.LambdaClient({ region: REGION }).send(new Lm.DeleteFunctionCommand({ FunctionName: NOME })).catch((e) => log(e.name));
  const E = require('@aws-sdk/client-ecr'); await new E.ECRClient({ region: REGION }).send(new E.DeleteRepositoryCommand({ repositoryName: NOME, force: true })).catch((e) => log(e.name));
  const I = require('@aws-sdk/client-iam'), ci = new I.IAMClient({ region: REGION });
  await ci.send(new I.DetachRolePolicyCommand({ RoleName: ROLE, PolicyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' })).catch(() => {}); await ci.send(new I.DeleteRoleCommand({ RoleName: ROLE })).catch((e) => log(e.name));
  const C = require('@aws-sdk/client-cloudwatch-logs'); await new C.CloudWatchLogsClient({ region: REGION }).send(new C.DeleteLogGroupCommand({ logGroupName: `/aws/lambda/${NOME}` })).catch(() => {});
  execFileSync('aws', ['s3', 'rm', '--recursive', 's3://remotionlambda-useast1-9dano8maol/legenda-s1/'], { stdio: 'inherit' });
  log('apagado');
}

mkdirSync(DIR, { recursive: true }); const cmd = process.argv[2];
if (cmd === 'build') build();
else if (cmd === 'deploy') { const c = build(); const u = await pushImagem(c); const f = await funcao(u); log(JSON.stringify({ arn: f.FunctionArn, imagem: u, mem: f.MemorySize, role: f.Role })); }
else if (cmd === 'apagar') await apagar();
else { console.log('uso: deploy.mjs build|deploy|apagar'); process.exit(1); }
