// Sonda §13.13 (elenco diverso): planVariations REAL com 3 SWAP_AVATAR em DIVERSE + 3 rostos Soul V2 com o facePromptV2.
// Original simulado = o caso que falhou em 07/10 (homem branco, ~30, camisa navy). Sem banco, sem webhook.
// Uso (de api/):  npx ts-node --transpile-only src/integracoes/sondas/sonda-elenco.ts         → conta tokens (grátis) e estima
//                 ... --yes [outDir]                                                        → roda (teto US$ 0,05)
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { EditMap, OfferBriefDraft, TranscriptWord, VariationItemDraft } from '../contrato';
import { ClaudeLiveService, planParams } from '../claude/claude.service';
import { CLAUDE_PRICES } from '../claude/custo';
import { planContext, planSystem } from '../claude/prompts-campeao';
import { DIVERSE_CASTING_SCHEMA, diverseCasting, diverseCastingUserMessage } from '../claude/elenco';
import { SdkClaudeTransport } from '../claude/transporte';
import { MemoryCostStore } from '../store/memoria.store';
import { mockTeardown } from '../mock/fake-claude.service';
import { HiggsfieldClient, SOUL_V2_ENDPOINT, hfFinalStatus } from '../higgsfield/cliente';
import { FACE_MODEL } from '../catalogo/precos';
import { facePromptV2 } from '../wavespeed/prompts-midia';

const CAP_USD = 0.05;
const OUT_TOK = 900; // saída por elenco com effort low (pior caso razoável)
const yes = process.argv.includes('--yes');
const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(process.cwd(), '..', 'tmp-sonda-elenco');
const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const price = CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-opus-5-5'];
const usd = (i: number, o: number) => (i * price.input + o * price.output) / 1e6;

const offer: OfferBriefDraft = {
  name: 'Orbit Budget', language: 'en', kind: 'App', what: 'Budgeting app that finds forgotten subscriptions.',
  audience: 'Adults 20-50 who feel their money disappears every month', promise: 'Find what you are losing in one minute',
  pains: 'Money vanishes, forgotten subscriptions', proof: null, offerAndPrice: '7-day free trial', cta: 'Start your free trial', notes: null,
};
const SENT = ['I was losing three hundred dollars a month and had no idea.', 'This app found every subscription I forgot.', 'Start your free trial today.'];
const words: TranscriptWord[] = [];
let t = 0.2;
for (const s of SENT) { for (const w of s.split(' ')) { words.push({ word: w, startSec: +t.toFixed(2), endSec: +(t + 0.3).toFixed(2) }); t += 0.38; } t += 0.5; }
const teardown = mockTeardown('EN', words, { durationSec: t + 0.5, width: 720, height: 1280, fps: 30, hasAudio: true, cuts: [], segments: [], palette: [], silences: [] }, null, 4);
const profile = { gender: 'male' as const, ageBand: '28-35', ethnicity: 'White', hair: 'short brown hair', clothing: 'navy button-up shirt', setting: 'home office', lighting: 'soft window light from the left', framing: 'chest up, face centered', pose: 'seated, facing the camera, looking into the lens' };
const editMap = { profile, layers: [], cells: [], faceTrack: [] } as unknown as EditMap;
const SLOTS = [0, 1, 2].map((index) => ({ kind: 'SWAP_AVATAR' as const, index }));
const BATCH = `sonda-elenco-${new Date().toISOString().slice(0, 10)}`;

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY vazio');
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });
  const p = planParams(teardown, words);
  const context = planContext({ offer, teardown, transcript: words, hookEndSec: p.hookEndSec, notes: null });
  const user = diverseCastingUserMessage({ index: 0, count: 3, casting: diverseCasting({ batchId: BATCH, position: 1, gender: 'male', originalEthnicity: 'White' }), genderNote: 'required: matches the voice that will speak', others: [2, 3].map((position) => diverseCasting({ batchId: BATCH, position, gender: 'male', originalEthnicity: 'White' })), profile, avoidLevers: [], diagnosisLanguage: 'English', language: 'en' });
  const counted = await client.messages.countTokens({ model, system: planSystem('en'), messages: [{ role: 'user', content: [{ type: 'text', text: context }, { type: 'text', text: user }] }] });
  const inTok = counted.input_tokens + Math.ceil(JSON.stringify(DIVERSE_CASTING_SCHEMA).length / 3.5);
  const claudeEst = 3 * usd(inTok, OUT_TOK);
  const facesEst = 3 * FACE_MODEL.usdPerImage;
  console.log(`modelo ${model}: ${inTok} tok entrada + ~${OUT_TOK} saída por elenco × 3 ≈ US$ ${claudeEst.toFixed(4)}; rostos 3 × ${FACE_MODEL.usdPerImage} = US$ ${facesEst.toFixed(3)}; total ≈ US$ ${(claudeEst + facesEst).toFixed(4)} (teto ${CAP_USD})`);
  // pior caso dos 3 elencos passa do teto: roda 1, mede, e só segue se o custo real couber
  if (usd(inTok, OUT_TOK) + facesEst > CAP_USD) return console.log('PARADO: nem 1 elenco + 3 rostos cabem no teto');
  if (!yes) return console.log('(dry-run) rode com --yes pra gastar');

  mkdirSync(outDir, { recursive: true });
  const costs = new MemoryCostStore();
  const items: { index: number; draft?: VariationItemDraft; error?: string }[] = [];
  const transport = new SdkClaudeTransport(client, { model, effort: 'low', fallbacks: true });
  // 1 elenco primeiro (mede o custo real por chamada); os outros 2 só se couberem no teto junto com os 3 rostos
  const svc = new ClaudeLiveService(transport, costs, { model });
  const cbs = { onSharedCasting: () => undefined, onItemDone: (_k: string, index: number, draft: VariationItemDraft) => items.push({ index, draft }), onItemFailed: (_k: string, index: number, error: string) => items.push({ index, error }) };
  const base = { workspaceId: 'sonda', batchId: BATCH, jobId: 'sonda', language: 'en', offer, teardown, transcript: words, avoidLevers: [], notes: null, editMap, hookMode: 'TEXT' as const, castingStyle: 'DIVERSE' as const, castingGender: 'male' as const };
  const u1 = await svc.planVariations({ ...base, slots: SLOTS.slice(0, 1) }, cbs);
  const outTok = Math.round(costs.entries.filter((e) => e.unit === 'ktoken_out').reduce((a, e) => a + e.units, 0) * 1000);
  console.log(`elenco 1: US$ ${u1.costUsd.toFixed(4)} (saída ${outTok} tok)`);
  const more = u1.costUsd * 3 + facesEst <= CAP_USD ? 2 : u1.costUsd * 2 + facesEst * 2 / 3 <= CAP_USD ? 1 : 0;
  const u2 = more ? await svc.planVariations({ ...base, slots: SLOTS.slice(1, 1 + more) }, cbs) : { costUsd: 0 };
  if (more < 2) console.log(`só ${1 + more} elenco(s) cabem no teto`);
  const u = { costUsd: u1.costUsd + u2.costUsd };
  console.log(`plano: US$ ${u.costUsd.toFixed(4)}`);
  items.sort((a, b) => a.index - b.index);
  for (const it of items) console.log(`\n#${it.index} ${it.error ?? JSON.stringify(it.draft)}`);

  const hf = new HiggsfieldClient({ keyId: process.env.HF_API_KEY_ID ?? '', keySecret: process.env.HF_API_KEY_SECRET ?? '' });
  const faces = await Promise.all(items.filter((it) => it.draft && 'castingDescription' in it.draft).map(async (it) => {
    const prompt = facePromptV2((it.draft as { castingDescription: string }).castingDescription, '9:16');
    const r0 = await hf.submit(SOUL_V2_ENDPOINT, { prompt, aspect_ratio: FACE_MODEL.aspectRatio, resolution: FACE_MODEL.resolution, batch_size: 1 }, randomUUID());
    const t0 = Date.now();
    let r = r0;
    while (!hfFinalStatus(r)) {
      if (Date.now() - t0 > 5 * 60_000) throw new Error(`timeout ${r0.requestId}`);
      await new Promise((res) => setTimeout(res, 3000));
      r = await hf.status(r0.requestId);
    }
    if (!r.images[0]) return { index: it.index, error: `${r.status} ${r.error}` };
    const buf = Buffer.from(await (await fetch(r.images[0])).arrayBuffer());
    const file = join(outDir, `rosto-${it.index}.png`);
    writeFileSync(file, buf);
    return { index: it.index, request: r0.requestId, file, bytes: buf.length, prompt };
  }));
  console.log(JSON.stringify(faces, null, 2));
  writeFileSync(join(outDir, 'resultado.json'), JSON.stringify({ batchId: BATCH, model, planUsd: u.costUsd, facesUsd: faces.filter((f) => 'file' in f).length * FACE_MODEL.usdPerImage, items, faces, costs: costs.entries }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
