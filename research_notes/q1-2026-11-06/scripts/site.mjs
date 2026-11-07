// Site Remotion temporário do Q1 (o hookmill-dev pode não ter o RemixKeep do F1b). Uso: node site.mjs deploy|apagar
// Credenciais: REMOTION_AWS_* do api/.env (carregadas por quem chama). Não mexe em REMOTION_SERVE_URL de ninguém.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(path.join(ROOT, 'api', 'package.json'));
const L = require('@remotion/lambda');
const region = process.env.REMOTION_AWS_REGION || 'us-east-1';
const bucketName = new URL(process.env.REMOTION_SERVE_URL).hostname.split('.')[0];
const siteName = 'q1-f1b-2cc035e';
if (process.argv[2] === 'deploy') {
  const t = Date.now();
  const s = await L.deploySiteFromBundle({ region, bucketName, bundleDir: path.join(ROOT, 'video', 'dist', 'bundle'), siteName });
  console.log(JSON.stringify({ serveUrl: s.serveUrl, s: (Date.now() - t) / 1000, stats: s.stats }));
} else if (process.argv[2] === 'apagar') {
  console.log(JSON.stringify(await L.deleteSite({ region, bucketName, siteName })));
}
