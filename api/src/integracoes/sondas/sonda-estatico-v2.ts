// Sondas S2-S4 do estatico-montado-e-molduras-v1 §A7 (A-I, 25/10). SÓ RODAM COM OK DO GUSTA (`--yes`).
// Builder V2 (buildStaticImagePromptV2) no GPT Image 2 high 2k png + checagem de texto por visão (checkStaticText, Haiku),
// com 3 briefings fictícios DIFERENTES e agnósticos, escritos como o planAutoBatch devolveria, respeitando o "nada
// inventado" (§A3): o 2º não tem prova nem preço (sem trust, sem cta.sub, sem cards), o 3º é produto físico com teste
// grátis escrito no Brain (cta.sub ok). Sem banco, sem webhook (polling 3 s). Cada saída é baixada e DECODIFICADA inteira
// (ffmpeg; até 3 downloads) antes da checagem. Salva em sondas/out/ (fora do git).
// Uso (de api/):
//   npx ts-node --transpile-only src/integracoes/sondas/sonda-estatico-v2.ts                 → só plano, prompts e custo
//   ... --yes --s=S2      3 briefings × 9:16                                     ~US$ 1,22 (3 × 0,40 + 3 × ~0,0075)
//   ... --yes --s=S3      briefing 1 × 4:5 e 1:1                                 ~US$ 0,82
//   ... --yes --s=S4 --ref=<URL pública da captura da página>  edit, briefing 1   ~US$ 0,42
// Teto por execução: US$ 1,30. Depois: conferir o billing (WaveSpeed e Anthropic) e registrar em docs/integracoes.md.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { STATIC_IMAGE_MODEL, STATIC_TEXT_CHECK_MODEL, staticImageUsd } from '../catalogo/precos';
import { ClaudeLiveService } from '../claude/claude.service';
import { ffmpegRunner } from '../claude/checagem-texto';
import { SdkClaudeTransport } from '../claude/transporte';
import type { StaticAspect, StaticImageSpecV2 } from '../contrato';
import { MemoryCostStore } from '../store/memoria.store';
import { WaveSpeedClient, type WsPrediction } from '../wavespeed/cliente';
import { buildStaticImagePromptV2, staticTextsFor } from '../wavespeed/prompts-estatico';

const run = promisify(execFile);
const CAP_USD = 1.3;

/** 1: app (pt-BR), Brain completo menos preço. */
const APP_PT: StaticImageSpecV2 = {
  layout: 'assembled', screenLanguage: 'pt-BR', brandName: 'Coluna Leve', palette: { background: '#160C05', accent: '#FF8A3D' }, screenRefUrl: null,
  copy: {
    brandLine: 'Rotina noturna de 10 min', brandLineSource: 'what',
    tagline: 'Menos dor. Mais vida.',
    headline: { lead: 'Você não nasceu pra acordar', highlight: 'com dor.' }, headlineSource: 'pains',
    subheadline: '10 minutos antes de dormir. Sem academia, sem remédio. Do seu quarto.', subheadlineSource: 'what',
    handwritten: 'Sua manhã de volta.',
    benefits: [
      { icon: 'moon', title: 'Antes de dormir', line: 'Só 10 minutos por noite.', source: 'what' },
      { icon: 'person', title: 'Guiado passo a passo', line: 'Vídeo e voz em cada movimento.', source: 'what' },
      { icon: 'home', title: 'Sem equipamento', line: 'Na cama ou no tapete.', source: 'what' },
      { icon: 'heart', title: 'Pra quem tem dor', line: 'Movimentos leves e seguros.', source: 'audience' },
    ],
    trust: [
      { icon: 'shield', text: 'Feito pra iniciantes', source: 'audience' },
      { icon: 'clock', text: '10 minutos por noite', source: 'what' },
      { icon: 'check', text: 'Guiado em vídeo', source: 'what' },
    ],
    cta: { main: 'Comece hoje', sub: null, subSource: null },
    closing: 'Seu corpo agradece. Sua manhã também.',
  },
  visual: {
    hero: { person: 'A woman in her forties in a grey knit sweater', setting: 'sitting on the edge of her bed in a dim bedroom, one hand pressed on her lower back', emotion: 'pain', light: 'warm bedside lamp light from the left' },
    product: { kind: 'phone_screen', look: 'tilted slightly, overlapping the photo', screenTitle: 'Hoje à noite', screenTitleSource: 'what' },
    mood: 'emotional, intimate, hopeful, late evening',
  },
};
/** 2: curso (en), sem prova nem preço no Brain → sem cards, sem trust, sem cta.sub, sem manuscrito. */
const COURSE_EN: StaticImageSpecV2 = {
  layout: 'assembled', screenLanguage: 'en-US', brandName: 'Ledger Lab', palette: { background: '#05140E', accent: '#2ED47A' }, screenRefUrl: null,
  copy: {
    brandLine: 'Bookkeeping for freelancers', brandLineSource: 'what',
    tagline: null,
    headline: { lead: 'You did the work. Now', highlight: 'keep the money.' }, headlineSource: 'promise',
    subheadline: 'A short video course on tracking what comes in and what goes out.', subheadlineSource: 'what',
    handwritten: null, benefits: [], trust: [],
    cta: { main: 'Learn more', sub: null, subSource: null },
    closing: null,
  },
  visual: {
    hero: { person: 'A man in his thirties in a plain navy t-shirt', setting: 'at a small desk at home with a laptop and a stack of receipts', emotion: 'curiosity', light: 'cool window light from the right, late afternoon' },
    product: { kind: 'laptop_screen', look: 'open on the desk, angled toward the viewer', screenTitle: null, screenTitleSource: null },
    mood: 'focused, calm, a quiet weekday',
  },
};
/** 3: produto físico (es), teste grátis escrito no Brain → cta.sub; sem pessoa (hero null). */
const PRODUCT_ES: StaticImageSpecV2 = {
  layout: 'assembled', screenLanguage: 'es-MX', brandName: 'Raíz', palette: { background: '#0F0716', accent: '#B76BFF' }, screenRefUrl: null,
  copy: {
    brandLine: 'Té de hierbas para dormir', brandLineSource: 'what',
    tagline: 'Duerme. Despierta bien.',
    headline: { lead: '¿Te cuesta dormir?', highlight: 'Tómalo con calma.' }, headlineSource: 'pains',
    subheadline: null, subheadlineSource: null,
    handwritten: 'Tu noche, tranquila.',
    benefits: [
      { icon: 'leaf', title: 'Hierbas naturales', line: 'Manzanilla, tila y lavanda.', source: 'what' },
      { icon: 'moon', title: 'Una taza antes', line: 'Treinta minutos antes de dormir.', source: 'what' },
      { icon: 'gift', title: 'Prueba sin pagar', line: 'Muestra gratis en tu primer pedido.', source: 'offerAndPrice' },
    ],
    trust: [],
    cta: { main: 'Pídelo hoy', sub: 'Muestra gratis', subSource: 'offerAndPrice' },
    closing: null,
  },
  visual: {
    hero: null,
    product: { kind: 'physical_product', look: 'a small matte kraft paper pouch next to a steaming ceramic cup', screenTitle: null, screenTitleSource: null },
    mood: 'soft, cozy, late night',
  },
};

const SONDAS: Record<'S2' | 'S3' | 'S4', { spec: StaticImageSpecV2; aspect: StaticAspect; name: string }[]> = {
  S2: [{ spec: APP_PT, aspect: '9:16', name: 'app-pt' }, { spec: COURSE_EN, aspect: '9:16', name: 'curso-en' }, { spec: PRODUCT_ES, aspect: '9:16', name: 'produto-es' }],
  S3: [{ spec: APP_PT, aspect: '4:5', name: 'app-pt' }, { spec: APP_PT, aspect: '1:1', name: 'app-pt' }],
  S4: [{ spec: APP_PT, aspect: '9:16', name: 'app-pt-ref' }],
};

async function wait(ws: WaveSpeedClient, p: WsPrediction): Promise<WsPrediction> {
  const t0 = Date.now();
  let cur = p;
  while (!['completed', 'failed', 'cancelled', 'timeout', 'deleted'].includes(cur.status)) {
    if (Date.now() - t0 > STATIC_IMAGE_MODEL.timeoutMs) throw new Error(`timeout esperando ${p.id}`);
    await new Promise((r) => setTimeout(r, 3000));
    cur = await ws.result(p.id, p.getUrl);
  }
  if (cur.status !== 'completed') throw new Error(`${p.id} ${cur.status}: ${cur.error}`);
  return cur;
}

async function downloadValid(url: string, file: string): Promise<{ bytes: number; size: string; tries: number }> {
  let last: Error | null = null;
  for (let k = 1; k <= 3; k++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      const dec = await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { timeout: 60_000 });
      if (dec.stderr.trim()) throw new Error(`decodificação com erro: ${dec.stderr.trim().slice(0, 200)}`);
      const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
      return { bytes: statSync(file).size, size: stdout.trim(), tries: k };
    } catch (e) {
      last = e as Error;
    }
  }
  throw new Error(`download inválido depois de 3 tentativas: ${last?.message}`);
}

/** Comparação do §A6 (a oficial é do backend, `compararTexto`): NFC, caixa e espaços ignorados, acento conta. */
const norm = (t: string) => t.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const yes = process.argv.includes('--yes');
  const which = (process.argv.find((a) => a.startsWith('--s='))?.slice(4) ?? 'S2') as keyof typeof SONDAS;
  const ref = process.argv.find((a) => a.startsWith('--ref='))?.slice(6) ?? null;
  const plan = SONDAS[which];
  if (!plan) throw new Error('use --s=S2 | S3 | S4');
  if (which === 'S4' && !ref) throw new Error('S4 precisa de --ref=<URL pública da captura da página>');
  const per = staticImageUsd(which === 'S4' ? 1 : 0) + STATIC_TEXT_CHECK_MODEL.estimatedUsd;
  const total = plan.length * per;
  console.log(`${which}: ${which === 'S4' ? STATIC_IMAGE_MODEL.editProviderModel : STATIC_IMAGE_MODEL.providerModel} high ${STATIC_IMAGE_MODEL.resolution} png + checagem ${STATIC_TEXT_CHECK_MODEL.model}`);
  console.log(plan.map((x) => `  ${x.name.padEnd(12)} ${x.aspect.padEnd(5)} ~US$ ${per.toFixed(4)}`).join('\n'));
  console.log(`total estimado: US$ ${total.toFixed(3)} (teto ${CAP_USD.toFixed(2)})`);
  for (const x of plan) console.log(`\n--- prompt ${x.name} ${x.aspect} ---\n${buildStaticImagePromptV2({ ...x.spec, screenRefUrl: ref }, x.aspect, { safe: false, hasScreenRef: !!ref && which === 'S4' })}`);
  if (total > CAP_USD) throw new Error('plano passa do teto');
  if (!yes) return console.log('\nnada rodou (passe --yes, só com ok do Gusta)');
  const wsKey = process.env.WAVESPEED_API_KEY;
  const anKey = process.env.ANTHROPIC_API_KEY;
  if (!wsKey || !anKey) throw new Error('WAVESPEED_API_KEY / ANTHROPIC_API_KEY vazio no api/.env');

  const ws = new WaveSpeedClient({ apiKey: wsKey });
  const costs = new MemoryCostStore();
  const claude = new ClaudeLiveService(new SdkClaudeTransport(new Anthropic({ apiKey: anKey, maxRetries: 2 }), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: false }), costs, {
    model: 'claude-opus-5-5', runFfmpeg: ffmpegRunner(process.env.FFMPEG_PATH || 'ffmpeg'),
    // a checagem lê o arquivo local já validado (sem depender da URL temporária da CDN)
    fetchImpl: (async (u: string) => new Response(readFileSync(u.replace(/^file:\/\//, '')))) as unknown as typeof fetch,
  });
  const dir = join(__dirname, 'out', `estatico-v2-${which}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  for (const x of plan) {
    const t0 = Date.now();
    const spec = { ...x.spec, screenRefUrl: which === 'S4' ? ref : null };
    try {
      const prompt = buildStaticImagePromptV2(spec, x.aspect, { safe: false, hasScreenRef: which === 'S4' });
      const body = { prompt, aspect_ratio: x.aspect, resolution: STATIC_IMAGE_MODEL.resolution, quality: STATIC_IMAGE_MODEL.quality, output_format: STATIC_IMAGE_MODEL.outputFormat, ...(which === 'S4' ? { images: [ref] } : {}) };
      const p = await wait(ws, await ws.submit(which === 'S4' ? STATIC_IMAGE_MODEL.editProviderModel : STATIC_IMAGE_MODEL.providerModel, body, null));
      const url = p.outputs.find((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
      if (!url) throw new Error(`${p.id} completed sem URL`);
      const file = join(dir, `${x.name}-${x.aspect.replace(':', 'x')}.png`);
      writeFileSync(join(dir, `${x.name}-${x.aspect.replace(':', 'x')}.prompt.txt`), prompt);
      const d = await downloadValid(url, file);
      const expected = staticTextsFor(spec, x.aspect);
      const chk = await claude.checkStaticText({ workspaceId: 'sonda', creativeId: 'sonda', variationBatchId: 'sonda', renderId: x.name, imageUrl: `file://${file}`, language: spec.screenLanguage, expected });
      const wrong = chk.items.filter((it) => !it.found || norm(it.seen ?? '') !== norm(expected.find((e) => e.key === it.key)!.text));
      console.log(`${x.name} ${x.aspect}: OK em ${((Date.now() - t0) / 1000).toFixed(0)}s, prediction=${p.id}, ${d.size}, ${d.bytes} bytes, ${d.tries} download(s), checagem US$ ${chk.costUsd} → ${file}`);
      for (const w of wrong) console.log(`   texto: ${w.key} esperado "${expected.find((e) => e.key === w.key)!.text}" visto ${w.seen ? `"${w.seen}"` : '(não achado)'}${expected.find((e) => e.key === w.key)!.critical ? ' [CRÍTICO]' : ''}`);
      if (chk.extraText.length) console.log(`   texto extra: ${chk.extraText.join(' | ')}`);
      writeFileSync(join(dir, `${x.name}-${x.aspect.replace(':', 'x')}.check.json`), JSON.stringify({ expected, check: chk }, null, 2));
    } catch (e) {
      console.log(`${x.name} ${x.aspect}: FALHOU em ${((Date.now() - t0) / 1000).toFixed(0)}s → ${(e as Error).message}`);
    }
  }
  console.log('\nconfira o billing (WaveSpeed e Anthropic), a grafia de cada texto e se algum dado não pedido apareceu.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
