// 11/11: prova do render `template` na Lambda com o site do worktree (mesma chamada do lambda-render.port).
// Rodar: npx ts-node -T src/dev/lambda-template-prova.ts <renderId do banco maquina_previas>
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { montarPlano } from '../render/lambda/plano';
const env: Record<string, string> = {};
for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=([^#\n]*)/); if (m) env[m[1]] = m[2].trim(); }
process.env.REMOTION_AWS_ACCESS_KEY_ID = env.REMOTION_AWS_ACCESS_KEY_ID; process.env.REMOTION_AWS_SECRET_ACCESS_KEY = env.REMOTION_AWS_SECRET_ACCESS_KEY;
(async () => {
  const c = new Client({ connectionString: 'postgresql://maquina:maquina@localhost:5433/maquina_previas' }); await c.connect();
  const r = (await c.query('select input from renders where id=$1', [process.argv[2]])).rows[0]; await c.end();
  const input = { ...r.input, renderId: `prova-${Date.now()}` };
  const plano = await montarPlano(input, { ffmpeg: 'ffmpeg' });
  const L = require('@remotion/lambda/client');
  const t0 = Date.now();
  const res = await L.renderMediaOnLambda({
    region: env.REMOTION_AWS_REGION || 'us-east-1', functionName: env.REMOTION_LAMBDA_FUNCTION, serveUrl: env.REMOTION_SERVE_URL,
    composition: plano.compositionId, inputProps: plano.props, ...plano.codificacao, concurrencyPerLambda: 1,
    framesPerLambda: Number(env.RENDER_LAMBDA_FRAMES_PER_LAMBDA || 150), maxRetries: 1, privacy: 'private', outName: `${input.renderId}.mp4`, overwrite: true, logLevel: 'error',
  });
  for (;;) {
    await new Promise((s) => setTimeout(s, 3000));
    const p = await L.getRenderProgress({ renderId: res.renderId, bucketName: res.bucketName, functionName: env.REMOTION_LAMBDA_FUNCTION, region: env.REMOTION_AWS_REGION || 'us-east-1' });
    if (p.fatalErrorEncountered) { console.log('FALHOU', JSON.stringify(p.errors?.[0]).slice(0, 600)); process.exit(1); }
    if (p.done) { console.log('pronto em', ((Date.now() - t0) / 1000).toFixed(1), 's; lambdas', p.lambdasInvoked, '; custo', p.costs?.displayCost, '; saída', p.outputFile); break; }
  }
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
