// Sonda live da TRILHA de b-roll (25/10). SÓ LEITURA no banco: corta a fala do campeão de um lote em trechos de 2-5 s
// nas pausas (como o backend fará), roda `searchTrack` (Haiku: buscas de todos os trechos numa chamada; Pexels dedup com
// teto; folhas; escolha em lotes; baixa cada vídeo 1x e corta) num sink local. Mostra trecho → clipe → motivo e o custo.
// Uso (de api/): npx ts-node --transpile-only src/integracoes/sondas/sonda-broll-trilha.ts <batchId> --yes   (~US$ 0,10)
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcriptOf } from '../../campeoes/champion-views';
import { SdkClaudeTransport } from '../claude/transporte';
import type { BrollSegment, TranscriptWord } from '../contrato';
import { MemoryCostStore } from '../store/memoria.store';
import { PexelsBrollService, type BrollSink } from '../broll/broll.service';
import { ffmpegOf } from '../broll/folha';
import { PexelsClient } from '../broll/pexels';
import { isNone } from '../broll/trilha';

/** Trechos de 2-5 s cortados na maior pausa disponível (ou no limite de 5 s). */
export function segmentsOf(words: TranscriptWord[]): BrollSegment[] {
  const out: BrollSegment[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    out.push({ startSec: cur[0].startSec, endSec: cur[cur.length - 1].endSec, text: cur.map((w) => w.word).join(' ').replace(/\s+([,.!?])/g, '$1') });
    cur = [];
  };
  for (let k = 0; k < words.length; k++) {
    cur.push(words[k]);
    const len = cur[cur.length - 1].endSec - cur[0].startSec;
    const gap = k + 1 < words.length ? words[k + 1].startSec - words[k].endSec : 1;
    if ((len >= 2 && (gap >= 0.25 || /[.!?。！？]$/.test(words[k].word))) || len >= 5) flush();
  }
  flush();
  // contíguos na linha do tempo da peça (sem buraco): cada trecho vai até o começo do próximo
  return out.map((s, k) => ({ ...s, startSec: k === 0 ? 0 : s.startSec, endSec: k + 1 < out.length ? out[k + 1].startSec : s.endSec }));
}

async function main() {
  const batchId = process.argv[2];
  const prisma = new PrismaClient();
  try {
    const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { offer: true, champion: { include: { teardown: true } } } });
    const t = transcriptOf(b.champion.teardown!.transcript);
    const maxArg = process.argv.find((a) => a.startsWith('--max='));
    const segments = segmentsOf(t?.words ?? []).slice(0, maxArg ? Number(maxArg.slice(6)) : undefined);
    const language = b.champion.language || t?.language || b.offer.language;
    console.log(`lote ${b.id} (status ${b.status}), ${segments.length} trechos, idioma ${language}`);
    if (!process.argv.includes('--yes')) return console.log(segments.map((s, k) => `  ${k + 1}. ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)} ${s.text}`).join('\n'));

    const dir = join(__dirname, 'out', `broll-trilha-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(dir, { recursive: true });
    let n = 0;
    const sink: BrollSink = { put: async (i) => { const f = join(dir, `clipe-${++n}.mp4`); writeFileSync(f, i.bytes); return { fileUrl: `file://${f}` }; } };
    const costs = new MemoryCostStore();
    const pexels = new PexelsClient({ apiKey: process.env.PEXELS_API_KEY! });
    const svc = new PexelsBrollService({
      pexels, costs, sink, ffmpeg: ffmpegOf(),
      transport: new SdkClaudeTransport(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 }), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: false }),
      onSheet: (_n, id, jpeg) => writeFileSync(join(dir, `folha-pexels-${id}.jpg`), jpeg),
    });
    const t0 = Date.now();
    const out = await svc.searchTrack({ workspaceId: b.workspaceId, batchId: b.id, segments, language, offer: { name: b.offer.name, kind: b.offer.kind, what: b.offer.what, audience: b.offer.audience }, notes: b.offer.notes });
    out.picks.forEach((p, k) => {
      const s = segments[k];
      console.log(`${String(k + 1).padStart(2)}. ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s "${s.text.slice(0, 60)}"`);
      console.log(isNone(p) ? `    → SEM CLIPE (reserva: ${p.fallbackSubject})` : `    → ${p.provenance.sourceUrl} [${p.srcStartSec}-${p.srcEndSec}s] — ${p.reason}`);
    });
    writeFileSync(join(dir, 'trilha.json'), JSON.stringify({ segments, ...out }, null, 2));
    const total = costs.entries.reduce((a, x) => a + x.amountUsd, 0);
    const uniq = new Set(out.picks.filter((p) => !isNone(p)).map((p) => (isNone(p) ? '' : p.provenance.sourceUrl))).size;
    console.log(`em ${((Date.now() - t0) / 1000).toFixed(0)}s; custo US$ ${total.toFixed(4)} por lote (${segments.length} trechos); Pexels ${out.pexelsRequests} pedidos; ${uniq} vídeos distintos → ${dir}`);
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
