// Sonda live do checkCaption (legenda-protegida-v1 §4.2). Extrai 6 quadros de cada MP4 (+ recorte largo da região onde a
// legenda queimada pode estar, já que o render antigo não grava a faixa transformada), lê a fala nesses instantes da
// transcrição do campeão (banco, SÓ LEITURA) e pergunta ao Haiku. Mostra o veredito e o custo. ~US$ 0,007 por vídeo.
// Uso (de api/): npx ts-node --transpile-only src/integracoes/sondas/sonda-legenda.ts <batchId> <mp4> [<mp4>…] --yes
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { transcriptOf } from '../../campeoes/champion-views';
import { ffmpegRunner } from '../claude/checagem-texto';
import { captionFramesOf } from '../claude/checagem-legenda';
import { ClaudeLiveService } from '../claude/claude.service';
import { SdkClaudeTransport } from '../claude/transporte';
import { MemoryCostStore } from '../store/memoria.store';

const TIMES = [6, 20, 34, 48, 62, 76];
/** recorte largo: do terço de cima ao fundo (1080×1920), onde a legenda do campeão pode cair depois do reenquadramento */
const BAND = { x: 0, y: 576, w: 1080, h: 1056 };

async function main() {
  const [batchId, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const prisma = new PrismaClient();
  try {
    const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { champion: { include: { teardown: true } } } });
    const t = transcriptOf(b.champion.teardown!.transcript);
    const words = t?.words ?? [];
    const near = (s: number) => words.filter((w) => w.endSec >= s - 1.2 && w.startSec <= s + 1.2).map((w) => w.word);
    if (!process.argv.includes('--yes')) return console.log(TIMES.map((s) => `${s}s: ${near(s).join(' ')}`).join('\n'));
    const run = ffmpegRunner(process.env.FFMPEG_PATH || 'ffmpeg', 60_000);
    const costs = new MemoryCostStore();
    const svc = new ClaudeLiveService(new SdkClaudeTransport(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 }), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: false }), costs, { model: 'claude-opus-5-5', runFfmpeg: run });
    const dir = join(__dirname, 'out', `legenda-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(dir, { recursive: true });
    for (const mp4 of rest) {
      const name = basename(mp4, '.mp4');
      const frames = await captionFramesOf(run, null, mp4, TIMES, BAND);
      frames.forEach((f, k) => { writeFileSync(join(dir, `${name}-${k + 1}.png`), f.image); if (f.crop) writeFileSync(join(dir, `${name}-${k + 1}-faixa.png`), f.crop); });
      const before = costs.entries.reduce((a, e) => a + e.amountUsd, 0);
      const out = await svc.checkCaption({
        workspaceId: b.workspaceId, creativeId: 'sonda', variationBatchId: b.id, renderId: name, mode: 'avoid', language: t?.language ?? 'zh',
        frames: frames.map((f, k) => ({ atSec: f.atSec, frameUrl: join(dir, `${name}-${k + 1}.png`), bandUrl: join(dir, `${name}-${k + 1}-faixa.png`), expectedWords: near(f.atSec) })),
      });
      console.log(`${name}: ${out.status.toUpperCase()} (US$ ${(costs.entries.reduce((a, e) => a + e.amountUsd, 0) - before).toFixed(4)})`);
      for (const f of out.frames) console.log(`   ${String(f.atSec).padStart(2)}s ${f.ok ? 'ok     ' : (f.problem ?? '').padEnd(7)} lido: ${f.seen ?? '—'}`);
    }
    console.log(`custo total US$ ${costs.entries.reduce((a, e) => a + e.amountUsd, 0).toFixed(4)} → ${dir}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
