// Renderiza um RenderInput (JSON) com um bundle escolhido usando o MESMO RemotionRenderService da API (mesmos parâmetros:
// codec, jpeg, crf, cache, concorrência). Serve pra não regressão do editor (F2d): o input de antes num bundle de antes
// do F1 × o render da API de agora, frame a frame. Local, CPU, US$ 0. Dono: maquina-qa.
// Uso (de testes/): node ferramentas/render-com-bundle.cjs <input.json> <bundleDir> <saidaDir>
// Saída (stdout, última linha): JSON { outputPath, durationSec, width, height }.
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');

const [inputPath, bundleDir, saidaDir] = process.argv.slice(2);
if (!inputPath || !bundleDir || !saidaDir) throw new Error('uso: render-com-bundle.cjs <input.json> <bundleDir> <saidaDir>');
const API = path.resolve(__dirname, '..', '..', 'api');
const QA_DIST = path.resolve(__dirname, '..', '.cache', 'api-qa', 'dist');
process.chdir(API); // o build do QA resolve o @maquina/video e o .env a partir do api/
require('dotenv').config({ path: path.join(API, '.env') });
const { RemotionRenderService } = require(path.join(QA_DIST, 'render', 'remotion-render.service.js'));

(async () => {
  mkdirSync(saidaDir, { recursive: true });
  const input = JSON.parse(readFileSync(inputPath, 'utf8'));
  const svc = new RemotionRenderService({
    concurrency: 1,
    tmpDir: saidaDir,
    bundleDir: path.resolve(bundleDir),
    framesConcurrency: Number(process.env.RENDER_FRAMES_CONCURRENCY || 1),
    browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
  });
  let ultimo = 0;
  const r = await svc.render(input, (p) => {
    if (p.progress - ultimo >= 25) { ultimo = p.progress; process.stderr.write(`[render] ${p.stage} ${p.progress}%\n`); }
  });
  process.stdout.write(JSON.stringify({ outputPath: r.outputPath, durationSec: r.durationSec, width: r.width, height: r.height }) + '\n');
  process.exit(0);
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
