// Sonda do §13 (I5): describeEdit REAL num criativo NOSSO + 1 gancho escrito (hookMode TEXT) com o EditMap que saiu.
// Sem banco, sem Whisper (transcrição vazia: a legenda fica com o intervalo que a visão viu) e sem WaveSpeed.
// Trilha do rosto escrita à mão com a medida do lote (caixa x 0-336, y 119-443, o vídeo todo) até o V4a existir.
// Uso (de api/):  npx ts-node --transpile-only src/integracoes/sondas/sonda-edicao.ts <video.mp4> [saida.json]
//                 → só extrai frames, conta tokens (grátis) e mostra o custo estimado
//                 ... --yes → roda (teto US$ 0,30 somando as chamadas)
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { DescribeEditInput, EditMap, OfferBriefDraft, Rect, VariationItemDraft } from '../contrato';
import { ClaudeLiveService } from '../claude/claude.service';
import { CLAUDE_PRICES } from '../claude/custo';
import { SdkClaudeTransport, type ClaudeCall, type ClaudeResult, type ClaudeTransport } from '../claude/transporte';
import { MemoryCostStore } from '../store/memoria.store';
import { mockTeardown } from '../mock/fake-claude.service';

const CAP_USD = 0.3;
const [video, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const yes = process.argv.includes('--yes');
const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const effort = (process.env.ANTHROPIC_EFFORT || 'medium') as 'medium';
const price = CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-opus-5-5'];
const usd = (inTok: number, outTok: number) => (inTok * price.input + outTok * price.output) / 1e6;

const offer: OfferBriefDraft = {
  name: 'Spy Zap', language: 'en', kind: 'Mobile app', what: 'Shows who someone talks to on WhatsApp and when they are online.',
  audience: 'Women who suspect their partner is cheating', promise: 'Know the truth without asking', pains: 'Anxiety, lies',
  proof: null, offerAndPrice: null, cta: 'Tap the link and check', notes: null,
};

class Capture implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  async run(c: ClaudeCall): Promise<ClaudeResult> {
    this.calls.push(c);
    throw new Error('dry');
  }
}

async function countIn(client: Anthropic, c: ClaudeCall): Promise<number> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (c.context) content.push({ type: 'text', text: c.context });
  for (const img of c.images ?? []) {
    content.push({ type: 'text', text: img.caption });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  }
  content.push({ type: 'text', text: c.user });
  const r = await client.messages.countTokens({ model, system: c.system, messages: [{ role: 'user', content }] });
  return r.input_tokens + Math.ceil(JSON.stringify(c.schema).length / 3.5);
}

function ff(args: string[]) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

async function main() {
  if (!video) throw new Error('uso: sonda-edicao.ts <video.mp4> [saida.json] [--yes]');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY vazio em api/.env');
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });

  const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets:format=duration', '-of', 'json', video]).toString());
  const st = pr.streams[0];
  const [fn, fd] = String(st.r_frame_rate).split('/').map(Number);
  const grid = { width: st.width, height: st.height, fps: fn / (fd || 1), frameCount: Number(st.nb_read_packets), durationSec: Number(pr.format.duration) };
  const dir = mkdtempSync(join(tmpdir(), 'sonda-edicao-'));

  // frames-chave (até 16, lado maior 768) e recortes de faixa (até 6, resolução cheia, lado maior 1024)
  const times = [0, 1, 3, 5, 8, 11, 14, 17, 20, 23, 26, Math.max(0, grid.durationSec - 0.3)].map((t) => Math.round(t * 100) / 100);
  const keyframes = times.map((t, i) => {
    const p = join(dir, `k${i}.jpg`);
    ff(['-ss', String(t), '-i', video, '-frames:v', '1', '-vf', "scale='if(gt(iw,ih),768,-2)':'if(gt(iw,ih),-2,768)'", '-q:v', '3', p]);
    return { atSec: t, reason: i === 0 ? 't0' : i === times.length - 1 ? 'end' : 'block', url: `file://${p}` };
  });
  const band = (y: number, h: number): Rect => ({ x: 0, y, w: grid.width, h });
  const cropSpecs: { atSec: number; box: Rect }[] = [
    { atSec: 1, box: band(0, 119) }, // faixa de cima
    { atSec: 1, box: band(Math.round(grid.height * 0.86), grid.height - Math.round(grid.height * 0.86)) }, // faixa de baixo
    { atSec: 5, box: band(Math.round(grid.height * 0.76), Math.round(grid.height * 0.1)) }, // legenda
    { atSec: 20, box: band(Math.round(grid.height * 0.76), Math.round(grid.height * 0.1)) },
  ];
  const textCrops = cropSpecs.map((c, i) => {
    const p = join(dir, `c${i}.jpg`);
    ff(['-ss', String(c.atSec), '-i', video, '-frames:v', '1', '-vf', `crop=${c.box.w}:${c.box.h}:${c.box.x}:${c.box.y}`, '-q:v', '2', p]);
    return { ...c, url: `file://${p}` };
  });
  const localFetch = (async (url: string) => new Response(readFileSync(String(url).replace('file://', '')), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;

  const faceTrack = [{ startFrame: 0, endFrame: grid.frameCount, region: { x: 0, y: 119, w: 336, h: 324 }, fullFrame: false, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.15, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.9 }];
  const input: DescribeEditInput = { workspaceId: 'sonda', championId: 'sonda', jobId: 'sonda', video: grid, keyframes, textCrops, faceTrack, transcript: { language: 'en', words: [] } };
  console.log(`grade: ${grid.width}x${grid.height} @ ${grid.fps} fps, ${grid.frameCount} frames, ${grid.durationSec.toFixed(2)} s; ${keyframes.length} frames + ${textCrops.length} recortes`);

  const cap = new Capture();
  await new ClaudeLiveService(cap, new MemoryCostStore(), { model, fetchImpl: localFetch }).describeEdit(input).catch(() => undefined);
  const inTok = await countIn(client, cap.calls[0]);
  const est = usd(inTok, 3500);
  const estHook = usd(4000, 800);
  console.log(`describeEdit: ${inTok} tokens de entrada (contados) + ~3500 de saída ≈ US$ ${est.toFixed(3)}; 1 gancho escrito ≈ US$ ${estHook.toFixed(3)}; total ≈ US$ ${(est + estHook).toFixed(3)} (teto ${CAP_USD})`);
  if (!yes) return console.log('(dry-run) rode com --yes pra gastar');
  if (est + estHook > CAP_USD) return console.log('PARADO: estimativa passa do teto');

  const transport = new SdkClaudeTransport(client, { model, effort, fallbacks: true });
  const costs = new MemoryCostStore();
  const t0 = Date.now();
  const draft = await new ClaudeLiveService(transport, costs, { model, fetchImpl: localFetch }).describeEdit(input);
  console.log(`describeEdit OK em ${((Date.now() - t0) / 1000).toFixed(0)}s: US$ ${draft.costUsd.toFixed(4)}`);
  console.log(JSON.stringify(draft, null, 2));
  if (outPath) writeFileSync(outPath, JSON.stringify({ grid, draft, costs: costs.entries }, null, 2));

  const ok = { available: true, blockers: [] };
  const editMap: EditMap = { version: 1, ...grid, cells: [], faceTrack, ...draft, keepEdit: { SWAP_AVATAR: ok, NEW_HOOKS: ok } };
  const teardown = mockTeardown('EN', [], { durationSec: grid.durationSec, width: grid.width, height: grid.height, fps: grid.fps, hasAudio: true, cuts: [], segments: [], palette: [], silences: [] }, null, keyframes.length);
  const items: { kind: string; draft?: VariationItemDraft; error?: string }[] = [];
  const planCosts = new MemoryCostStore();
  const u = await new ClaudeLiveService(transport, planCosts, { model }).planVariations(
    { workspaceId: 'sonda', batchId: 'sonda', jobId: 'sonda', language: 'en', offer, teardown, transcript: [], slots: [{ kind: 'NEW_HOOKS', index: 0 }], avoidLevers: [], notes: null, editMap, hookMode: 'TEXT' },
    { onSharedCasting: () => undefined, onItemDone: (kind, _i, d) => items.push({ kind, draft: d }), onItemFailed: (kind, _i, e) => items.push({ kind, error: e }) },
  );
  console.log(`gancho escrito: US$ ${u.costUsd.toFixed(4)}`, JSON.stringify(items, null, 2));
  console.log(`TOTAL REAL: US$ ${(draft.costUsd + u.costUsd).toFixed(4)}`);
  if (outPath) writeFileSync(outPath, JSON.stringify({ grid, draft, hook: items, costs: [...costs.entries, ...planCosts.entries], totalUsd: draft.costUsd + u.costUsd }, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e);
  process.exit(1);
});
