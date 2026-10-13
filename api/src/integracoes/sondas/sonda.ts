// Sondas G3: 1 chamada barata por modelo, com a chave do api/.env, sem banco e sem webhook (polling).
// Uso (de api/):  npx ts-node --transpile-only src/integracoes/sondas/sonda.ts            → só mostra o plano e o custo
//                 npx ts-node --transpile-only src/integracoes/sondas/sonda.ts --yes      → roda (teto US$ 1,00)
//                 ... --yes --only=claude,tts                                             → só algumas
// Registre o resultado (modelo, custo real no billing, o que voltou) em docs/integracoes.md.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { extractWords } from '../wavespeed/normalizar';
import { WaveSpeedClient, type WsPrediction } from '../wavespeed/cliente';
import { HiggsfieldClient, SOUL_V2_ENDPOINT, hfFinalStatus } from '../higgsfield/cliente';
import { FACE_MODEL } from '../catalogo/precos';
import { SdkClaudeTransport } from '../claude/transporte';
import { costOf } from '../claude/custo';
import { BRIEF_SCHEMA, BRIEF_SYSTEM, briefUserMessage } from '../claude/prompts';
import { facePrompt, lipsyncPrompt, scenePrompt } from '../wavespeed/prompts-midia';

const CAP_USD = 1.0;
interface Probe { id: string; usd: number; optIn?: boolean; provider?: 'higgsfield'; run: (ctx: Ctx) => Promise<string> }
interface Ctx { ws: WaveSpeedClient; out: Record<string, string> }

async function wait(ws: WaveSpeedClient, p: WsPrediction, maxMs = 6 * 60_000): Promise<WsPrediction> {
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

const PROBES: Probe[] = [
  {
    // Rosto do produto desde 06/10: Soul V2 1080p 9:16 (US$ 0,006). Valida o cliente ponta a ponta (submit + status).
    id: 'soul', usd: FACE_MODEL.usdPerImage, provider: 'higgsfield',
    run: async ({ out }) => {
      const hf = new HiggsfieldClient({ keyId: process.env.HF_API_KEY_ID ?? '', keySecret: process.env.HF_API_KEY_SECRET ?? '' });
      const r0 = await hf.submit(SOUL_V2_ENDPOINT, { prompt: facePrompt('A woman in her 30s, plain t-shirt, bright living room'), aspect_ratio: FACE_MODEL.aspectRatio, resolution: FACE_MODEL.resolution, batch_size: 1 }, randomUUID());
      const t0 = Date.now();
      let r = r0;
      while (!hfFinalStatus(r)) {
        if (Date.now() - t0 > 5 * 60_000) throw new Error(`timeout esperando ${r0.requestId}`);
        await new Promise((res) => setTimeout(res, 3000));
        r = await hf.status(r0.requestId);
      }
      const fin = hfFinalStatus(r)!;
      if (fin.status !== 'COMPLETED' || !r.images[0]) throw new Error(`${r0.requestId} ${r.status} ${fin.errorCode}: ${r.error}`);
      out.face = r.images[0];
      return `request=${r0.requestId} ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out.face}`;
    },
  },
  {
    id: 'claude', usd: 0.02,
    run: async () => {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY vazio');
      const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
      const t = new SdkClaudeTransport(new Anthropic({ apiKey: key }), { model, effort: 'low', fallbacks: true });
      const text = 'Orbit Budget. The budgeting app for young couples. Find every forgotten subscription in one minute and save up to $300 a month. Try it free for 7 days. Start your free trial.';
      const r = await t.run({ system: BRIEF_SYSTEM, user: briefUserMessage({ text }), schema: BRIEF_SCHEMA, maxTokens: 4000 });
      return `stop=${r.stopReason} custo=US$ ${costOf(r.usage).totalUsd} uso=${JSON.stringify(r.usage)} json=${r.text.slice(0, 200)}`;
    },
  },
  {
    // gpt-image-2 (rosto ANTES de 06/10; hoje é a Higgsfield, sonda 'soul'). Opt-in. low = mais barata.
    id: 'face', usd: 0.02, optIn: true,
    run: async ({ ws, out }) => {
      const p = await wait(ws, await ws.submit('openai/gpt-image-2/text-to-image', { prompt: facePrompt('A woman in her 30s, plain t-shirt, bright living room'), aspect_ratio: '9:16', resolution: '1k', quality: 'low', output_format: 'png' }));
      out.face = String(p.outputs[0]);
      return out.face;
    },
  },
  {
    id: 'tts', usd: 0.005,
    run: async ({ ws, out }) => {
      const p = await wait(ws, await ws.submit('minimax/speech-2.6-turbo', { text: 'I found three hundred dollars a month I did not know I was losing.', voice_id: 'Calm_Woman', language_boost: 'English', english_normalization: true, format: 'mp3', sample_rate: 44100 }));
      out.audio = String(p.outputs[0]);
      return out.audio;
    },
  },
  {
    id: 'whisper', usd: 0.01,
    run: async ({ ws, out }) => {
      if (!out.audio) throw new Error('rode tts antes');
      const p = await wait(ws, await ws.submit('wavespeed-ai/openai-whisper-with-video', { video: out.audio, language: 'en', task: 'transcribe', enable_timestamps: true }));
      const raw = JSON.stringify(p.raw).slice(0, 600);
      let src: unknown = p.outputs[0];
      if (typeof src === 'string' && /^https?:/.test(src)) src = await (await fetch(src)).text();
      const w = extractWords(src, 5);
      return `fonte=${w.source} palavras=${JSON.stringify(w.words.slice(0, 4))} raw=${raw}`;
    },
  },
  {
    id: 'pruna', usd: 0.125, // ~4-5 s de áudio a US$ 0,025/s
    run: async ({ ws, out }) => {
      if (!out.face || !out.audio) throw new Error('rode soul e tts antes');
      const p = await wait(ws, await ws.submit('pruna-ai/p-video/avatar', { image: out.face, audio: out.audio, video_prompt: lipsyncPrompt('SOLO SHOT, warm smile'), resolution: '720p', seed: 7 }));
      return String(p.outputs[0]);
    },
  },
  // Re-sonda das cenas COM áudio nativo e fala, nos parâmetros do adapter (a 1ª sonda, 05/10, foi sem som e sem
  // fala pra economizar e por isso voltou muda). Opt-in: --only=kling,seedance --face=<url do rosto da 1ª sonda>.
  {
    id: 'kling', usd: 0.504, optIn: true, // 3 s × 0,112 × 1,5 (sound=true)
    run: async ({ ws, out }) => {
      if (!out.face) throw new Error('rode soul antes ou passe --face=<url>');
      const prompt = scenePrompt({ visualPrompt: 'SOLO SHOT, medium close-up, she leans in slightly', speech: 'I found three hundred dollars a month.', language: 'en' });
      const p = await wait(ws, await ws.submit('kwaivgi/kling-v3.0-pro/image-to-video', { image: out.face, prompt, duration: 3, sound: true, cfg_scale: 0.5 }), 10 * 60_000);
      return String(p.outputs[0]);
    },
  },
  {
    id: 'seedance', usd: 0.48, optIn: true, // 4 s em 480p com áudio (página 0,12/s; a 1ª sonda cobrou 0,108/s). Produção usa 720p (× 2)
    run: async ({ ws, out }) => {
      if (!out.face) throw new Error('rode soul antes ou passe --face=<url>');
      const prompt = scenePrompt({ visualPrompt: 'SOLO SHOT, medium close-up, she nods', speech: 'I found three hundred dollars a month.', language: 'en' });
      const p = await wait(ws, await ws.submit('bytedance/seedance-2.0/image-to-video', { image: out.face, prompt, duration: 4, resolution: '480p', aspect_ratio: '9:16', generate_audio: true }), 10 * 60_000);
      return String(p.outputs[0]);
    },
  },
];

async function main() {
  const yes = process.argv.includes('--yes');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const plan = PROBES.filter((p) => (only ? only.includes(p.id) : !p.optIn));
  const total = plan.reduce((a, p) => a + p.usd, 0);
  console.log(plan.map((p) => `  ${p.id.padEnd(9)} ~US$ ${p.usd.toFixed(3)}`).join('\n'));
  console.log(`total estimado: US$ ${total.toFixed(3)} (teto ${CAP_USD.toFixed(2)})`);
  if (total > CAP_USD) throw new Error('plano passa do teto: use --only');
  if (!yes) return console.log('nada rodou (passe --yes)');
  const key = process.env.WAVESPEED_API_KEY;
  const face = process.argv.find((a) => a.startsWith('--face='))?.slice(7);
  const ctx: Ctx = { ws: new WaveSpeedClient({ apiKey: key ?? '' }), out: face ? { face } : {} };
  for (const p of plan) {
    if (p.provider === 'higgsfield') {
      if (!process.env.HF_API_KEY_ID || !process.env.HF_API_KEY_SECRET) {
        console.log(`${p.id}: PULADA (HF_API_KEY_ID/HF_API_KEY_SECRET vazio)`);
        continue;
      }
    } else if (p.id !== 'claude' && !key) {
      console.log(`${p.id}: PULADA (WAVESPEED_API_KEY vazio)`);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await p.run(ctx);
      console.log(`${p.id}: OK em ${((Date.now() - t0) / 1000).toFixed(0)}s → ${r}`);
    } catch (e) {
      console.log(`${p.id}: FALHOU → ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
