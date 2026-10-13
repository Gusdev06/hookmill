// Teste do CORS do storage com URL pré-assinada REAL (docs/deploy.md passo 3; estrutura.md §6 linha "arquivos").
// Dono: maquina-arquiteto. Decide duas coisas antes de abrir o produto:
//   1. GET com Range a partir do web (o @remotion/player do editor busca a mídia assim) → editor liberado ou plano B (proxy).
//   2. PUT direto do navegador (UPLOAD_MODE=direct) → senão fica UPLOAD_MODE=proxy.
// Sobe um objeto de 1 KB em _cors-check/, testa, imprime os curls equivalentes e apaga o objeto. Custo: centavos de nada.
//
// Uso (chaves só no ambiente do comando, nunca em arquivo):
//   STORAGE_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3 STORAGE_REGION=<regiao> STORAGE_BUCKET=maquina-anuncios \
//   STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... WEB_ORIGIN=https://<projeto>.vercel.app \
//   node scripts/storage-cors-check.mjs
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';

const need = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'WEB_ORIGIN'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`faltam variáveis: ${missing.join(', ')}`);
  process.exit(2);
}
const origin = process.env.WEB_ORIGIN.split(',')[0].trim();
const Bucket = process.env.STORAGE_BUCKET;
const s3 = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const Key = `_cors-check/${Date.now()}-${randomBytes(4).toString('hex')}.bin`;
const body = randomBytes(1024);
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${name}${detail ? ` · ${detail}` : ''}`);
};
const h = (res, k) => res.headers.get(k);

try {
  await s3.send(new PutObjectCommand({ Bucket, Key, Body: body, ContentType: 'application/octet-stream' }));
  const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket, Key }), { expiresIn: 600 });

  // 1a. preflight do GET com Range
  const pre = await fetch(getUrl, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
  });
  const preAllow = h(pre, 'access-control-allow-origin');
  check('preflight GET+Range', pre.status >= 200 && pre.status < 300 && (preAllow === '*' || preAllow === origin),
    `status ${pre.status}, allow-origin=${preAllow}, allow-headers=${h(pre, 'access-control-allow-headers')}`);

  // 1b. GET com Range: 206 + allow-origin + Content-Range exposto
  const rng = await fetch(getUrl, { headers: { Origin: origin, Range: 'bytes=0-99' } });
  const allow = h(rng, 'access-control-allow-origin');
  const expose = (h(rng, 'access-control-expose-headers') || '').toLowerCase();
  const exposed = expose === '*' || expose.includes('content-range');
  check('GET Range 206 com CORS', rng.status === 206 && (allow === '*' || allow === origin) && exposed,
    `status ${rng.status}, allow-origin=${allow}, expose=${expose || '(nenhum)'}, content-range=${h(rng, 'content-range')}`);
  await rng.arrayBuffer().catch(() => undefined);

  // 2. PUT direto do navegador (UPLOAD_MODE=direct)
  const putKey = `${Key}.put`;
  const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket, Key: putKey, ContentType: 'video/mp4', ContentLength: 16 }), {
    expiresIn: 600, signableHeaders: new Set(['content-type', 'content-length']),
  });
  const prePut = await fetch(putUrl, {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
  });
  const prePutAllow = h(prePut, 'access-control-allow-origin');
  const prePutOk = prePut.status >= 200 && prePut.status < 300 && (prePutAllow === '*' || prePutAllow === origin);
  check('preflight PUT (upload direto)', prePutOk, `status ${prePut.status}, allow-origin=${prePutAllow}, allow-methods=${h(prePut, 'access-control-allow-methods')}`);
  const put = await fetch(putUrl, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'video/mp4' }, body: randomBytes(16) });
  const putAllow = h(put, 'access-control-allow-origin');
  check('PUT assinado com CORS', put.ok && (putAllow === '*' || putAllow === origin), `status ${put.status}, allow-origin=${putAllow}`);
  await s3.send(new DeleteObjectCommand({ Bucket, Key: putKey })).catch(() => undefined);

  console.log('\ncurls equivalentes (URL vale 10 min):');
  console.log(`curl -si -X OPTIONS '${getUrl}' -H 'Origin: ${origin}' -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: range'`);
  console.log(`curl -si '${getUrl}' -H 'Origin: ${origin}' -H 'Range: bytes=0-99' -o /dev/null -D -`);
} catch (e) {
  check('acesso S3 (put/presign)', false, e.message);
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket, Key })).catch(() => undefined);
}

const byName = Object.fromEntries(results.map((r) => [r.name, r.ok]));
const editor = byName['preflight GET+Range'] && byName['GET Range 206 com CORS'];
const direct = byName['preflight PUT (upload direto)'] && byName['PUT assinado com CORS'];
console.log(`\nveredito: editor ${editor ? 'LIBERADO' : 'BLOQUEADO (plano B: proxy de leitura na API)'} · UPLOAD_MODE=${direct ? 'direct' : 'proxy'}`);
process.exit(editor ? 0 : 1);
