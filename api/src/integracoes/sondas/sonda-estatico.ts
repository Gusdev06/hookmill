// Sonda R-I (variacao-auto-v1 rev. 23/10 §14.3): 1 imagem do STATIC por aspecto (9:16, 4:5, 1:1) no GPT Image 2
// high/1k png da WaveSpeed, com o prompt do produto (buildStaticImagePrompt) pra uma oferta fictícia. Sem banco, sem webhook
// (polling a cada 3 s, como o reconciliador sem webhook). Baixa cada saída e DECODIFICA o arquivo inteiro com ffmpeg
// (download truncado sem erro já aconteceu): até 3 downloads por imagem. Salva em sondas/out/ (fora do git).
// Uso (de api/):  npx ts-node --transpile-only src/integracoes/sondas/sonda-estatico.ts         → só mostra plano, prompt e custo
//                 npx ts-node --transpile-only src/integracoes/sondas/sonda-estatico.ts --yes   → roda (~US$ 0,66; teto 0,70)
//                 ... --yes --only=9:16                                                         → só um aspecto (~US$ 0,22)
//                 ... --safe                                                                    → prompt seguro (sem pessoa)
// Depois: conferir o custo real no billing da WaveSpeed e registrar em docs/integracoes.md.
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { STATIC_IMAGE_MODEL } from '../catalogo/precos';
import type { StaticAspect, StaticImageSpec } from '../contrato';
import { WaveSpeedClient, type WsPrediction } from '../wavespeed/cliente';
import { buildStaticImagePrompt } from '../wavespeed/prompts-midia';

const run = promisify(execFile);
const CAP_USD = 0.7;
const ASPECTS: StaticAspect[] = ['9:16', '4:5', '1:1'];

/** Oferta fictícia (agnóstica): app de rotina noturna pra dor nas costas; conceito como o planAutoBatch devolveria. */
export const PROBE_SPEC: StaticImageSpec = {
  headline: 'Acorde sem dor nas costas',
  screenLanguage: 'pt-BR',
  visual: {
    object: 'A woman in her forties in a grey sweater, sitting up in bed, stretching her arms above her head',
    scene: 'a bright bedroom in the morning, rumpled white sheets, a glass of water on the nightstand',
    vibe: 'relieved and rested, soft window light from the left, early morning',
    style: 'everyday_photo',
    headlinePlacement: 'top',
  },
};

async function wait(ws: WaveSpeedClient, p: WsPrediction, maxMs = STATIC_IMAGE_MODEL.timeoutMs): Promise<WsPrediction> {
  const t0 = Date.now();
  let cur = p;
  while (!['completed', 'failed', 'cancelled', 'timeout', 'deleted'].includes(cur.status)) {
    if (Date.now() - t0 > maxMs) throw new Error(`timeout esperando ${p.id}`);
    await new Promise((r) => setTimeout(r, 3000));
    cur = await ws.result(p.id, p.getUrl);
  }
  if (cur.status !== 'completed') throw new Error(`${p.id} ${cur.status}: ${cur.error}`);
  return cur;
}

/** Baixa e decodifica o PNG inteiro (ffmpeg -f null); 3 tentativas. Devolve caminho e tamanho. */
async function downloadValid(url: string, file: string): Promise<{ bytes: number; size: string; tries: number }> {
  let last: Error | null = null;
  for (let k = 1; k <= 3; k++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      const dec = await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeout: 60_000 });
      if (dec.stderr.trim()) throw new Error(`decodificação com erro: ${dec.stderr.trim().slice(0, 200)}`);
      const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0', file]);
      return { bytes: statSync(file).size, size: stdout.trim(), tries: k };
    } catch (e) {
      last = e as Error;
    }
  }
  throw new Error(`download inválido depois de 3 tentativas: ${last?.message}`);
}

async function main() {
  const yes = process.argv.includes('--yes');
  const safe = process.argv.includes('--safe');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',') as StaticAspect[] | undefined;
  const plan = ASPECTS.filter((a) => !only || only.includes(a));
  const total = plan.length * STATIC_IMAGE_MODEL.usdPerImage;
  console.log(`modelo ${STATIC_IMAGE_MODEL.providerModel} quality=${STATIC_IMAGE_MODEL.quality} resolution=${STATIC_IMAGE_MODEL.resolution} png, safe=${safe}`);
  console.log(plan.map((a) => `  ${a.padEnd(5)} ~US$ ${STATIC_IMAGE_MODEL.usdPerImage.toFixed(3)}`).join('\n'));
  console.log(`total estimado: US$ ${total.toFixed(3)} (teto ${CAP_USD.toFixed(2)})`);
  console.log(`\nprompt (${plan[0]}):\n${buildStaticImagePrompt(PROBE_SPEC, plan[0], { safe })}\n`);
  if (total > CAP_USD) throw new Error('plano passa do teto');
  if (!yes) return console.log('nada rodou (passe --yes)');
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error('WAVESPEED_API_KEY vazio no api/.env');

  const ws = new WaveSpeedClient({ apiKey: key });
  const dir = join(__dirname, 'out', `estatico-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  await Promise.all(
    plan.map(async (aspect) => {
      const t0 = Date.now();
      try {
        const body = { prompt: buildStaticImagePrompt(PROBE_SPEC, aspect, { safe }), aspect_ratio: aspect, resolution: STATIC_IMAGE_MODEL.resolution, quality: STATIC_IMAGE_MODEL.quality, output_format: STATIC_IMAGE_MODEL.outputFormat };
        const p = await wait(ws, await ws.submit(STATIC_IMAGE_MODEL.providerModel, body, null));
        const url = p.outputs.find((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
        if (!url) throw new Error(`${p.id} completed sem URL`);
        const file = join(dir, `static-${aspect.replace(':', 'x')}.png`);
        const d = await downloadValid(url, file);
        console.log(`${aspect}: OK em ${((Date.now() - t0) / 1000).toFixed(0)}s, prediction=${p.id}, ${d.size}, ${d.bytes} bytes, ${d.tries} download(s) → ${file}`);
      } catch (e) {
        console.log(`${aspect}: FALHOU em ${((Date.now() - t0) / 1000).toFixed(0)}s → ${(e as Error).message}`);
      }
    }),
  );
  console.log('\nconfira o custo real no billing da WaveSpeed e se a headline saiu escrita certa (acentos) em cada aspecto.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
