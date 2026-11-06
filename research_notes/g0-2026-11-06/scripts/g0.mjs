// G0 (troca-texto §16.8): a composição da S4 no Chrome Linux. Dono: video. Fora do produto.
// Uso (da raiz do projeto, credenciais carregadas sem imprimir):
//   node research_notes/g0-2026-11-06/scripts/g0.mjs bundle
//   node research_notes/g0-2026-11-06/scripts/g0.mjs local <rótulo> [browserExecutable]
//   node research_notes/g0-2026-11-06/scripts/g0.mjs lambda      # site temporário g0-s4-20261106, renders, apaga o site
// Não toca REMOTION_SERVE_URL nem a função: só invoca a função existente com outro serveUrl.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url)); const G0 = path.dirname(AQUI);
const S4 = path.resolve(G0, '../s4-demo-2026-11-06');
const BUNDLE = '/tmp/g0-bundle', PUBLIC = '/tmp/g0-public';
const SAIDA = path.join(G0, 'saida');
const jobs = JSON.parse(fs.readFileSync(path.join(AQUI, 'jobs-g0.json'), 'utf8'));
const modo = process.argv[2];
const OPC = { muted: true, crf: 10, colorSpace: 'bt709', codec: 'h264', imageFormat: 'png', pixelFormat: 'yuv420p' }; // = render.mjs da S4
const TETO_PARAR = 0.05;
const log = (o) => { fs.appendFileSync(path.join(SAIDA, 'log.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); console.log(JSON.stringify(o)); };

if (modo === 'bundle') {
  const { bundle } = require('@remotion/bundler');
  fs.rmSync(BUNDLE, { recursive: true, force: true });
  const t = Date.now();
  await bundle({ entryPoint: path.join(S4, 'remotion/src/index.ts'), publicDir: PUBLIC, outDir: BUNDLE, rootDir: path.join(S4, 'remotion') });
  log({ etapa: 'bundle', s: (Date.now() - t) / 1000 });
}

if (modo === 'local') {
  const R = require('@remotion/renderer');
  const rot = process.argv[3]; const browserExecutable = process.argv[4] || null;
  const dir = path.join(SAIDA, rot); fs.mkdirSync(dir, { recursive: true });
  for (const j of jobs) {
    const t = Date.now();
    const composition = await R.selectComposition({ serveUrl: BUNDLE, id: 'Sonda', inputProps: j.props, browserExecutable, logLevel: 'error' });
    if (j.tipo === 'still') await R.renderStill({ serveUrl: BUNDLE, composition, inputProps: j.props, frame: j.frame, imageFormat: 'png', output: path.join(dir, j.nome + '.png'), overwrite: true, browserExecutable, logLevel: 'error' });
    else await R.renderMedia({ serveUrl: BUNDLE, composition, inputProps: j.props, ...OPC, concurrency: 2, outputLocation: path.join(dir, j.nome + '.mp4'), overwrite: true, browserExecutable, logLevel: 'error' });
    log({ modo: 'local', rot, job: j.nome, s: (Date.now() - t) / 1000 });
  }
}

if (modo === 'lambda') {
  const L = require('@remotion/lambda');
  const region = process.env.REMOTION_AWS_REGION || 'us-east-1';
  const functionName = process.env.REMOTION_LAMBDA_FUNCTION;
  const bucketName = new URL(process.env.REMOTION_SERVE_URL).hostname.split('.')[0];
  const siteName = 'g0-s4-20261106';
  const dir = path.join(SAIDA, 'lambda'); fs.mkdirSync(dir, { recursive: true });
  let custo = 0;
  const baixar = async (url, f) => { const r = await fetch(url); if (!r.ok) throw new Error(`download ${r.status}`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); };
  const t0 = Date.now();
  const site = await L.deploySiteFromBundle({ region, bucketName, bundleDir: BUNDLE, siteName });
  log({ etapa: 'site', siteName: site.siteName, s: (Date.now() - t0) / 1000, stats: site.stats });
  try {
    for (const j of jobs) {
      if (custo > TETO_PARAR) { log({ parou: 'teto', custo }); break; }
      const t = Date.now();
      if (j.tipo === 'still') {
        const r = await L.renderStillOnLambda({ region, functionName, serveUrl: site.serveUrl, composition: 'Sonda', inputProps: j.props, frame: j.frame, imageFormat: 'png', privacy: 'public', logLevel: 'error', maxRetries: 0 });
        await baixar(r.url, path.join(dir, j.nome + '.png'));
        custo += r.estimatedPrice.accruedSoFar;
        log({ modo: 'lambda', job: j.nome, s: (Date.now() - t) / 1000, usd: r.estimatedPrice.accruedSoFar, renderId: r.renderId });
        await L.deleteRender({ region, bucketName: r.bucketName, renderId: r.renderId }).catch((e) => log({ deleteRender: String(e) }));
      } else {
        const r = await L.renderMediaOnLambda({ region, functionName, serveUrl: site.serveUrl, composition: 'Sonda', inputProps: j.props, ...OPC, framesPerLambda: 10, privacy: 'public', logLevel: 'error', maxRetries: 0 });
        let p;
        for (;;) { await new Promise((ok) => setTimeout(ok, 1500)); p = await L.getRenderProgress({ region, functionName, bucketName: r.bucketName, renderId: r.renderId });
          if (p.fatalErrorEncountered) throw new Error(JSON.stringify(p.errors).slice(0, 800)); if (p.done) break; }
        await baixar(p.outputFile, path.join(dir, j.nome + '.mp4'));
        custo += p.costs.accruedSoFar;
        log({ modo: 'lambda', job: j.nome, s: (Date.now() - t) / 1000, usd: p.costs.accruedSoFar, lambdas: p.lambdasInvoked, renderId: r.renderId });
        await L.deleteRender({ region, bucketName: r.bucketName, renderId: r.renderId }).catch((e) => log({ deleteRender: String(e) }));
      }
    }
  } finally {
    const d = await L.deleteSite({ region, bucketName, siteName }).catch((e) => ({ erro: String(e) }));
    log({ etapa: 'site apagado', siteName, d, custoTotalUsd: custo });
  }
}
