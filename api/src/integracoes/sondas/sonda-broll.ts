// Sonda live do b-roll Pexels (§B3.1). SÓ LEITURA no banco: pega 1 trecho (bloco do teardown) do campeão de um lote,
// roda search (Haiku monta as buscas, Pexels, folhas, Haiku escolhe olhando) e fetch (baixa, corta, "sobe" num sink
// local). Salva as folhas, o clipe e o motivo em sondas/out/. Sem candidato = imagem de reserva só com --fallback.
// Uso (de api/): npx ts-node --transpile-only src/integracoes/sondas/sonda-broll.ts <batchId> [--block=N] [--fallback] --yes
// Custo: ~US$ 0,02 (Haiku) por trecho; Pexels gratuito (conta dividida com a Launchwing: 2-4 buscas); reserva +0,22.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionsOf } from '../../campeoes/champion-views';
import { SdkClaudeTransport } from '../claude/transporte';
import { MemoryCostStore } from '../store/memoria.store';
import { WaveSpeedClient } from '../wavespeed/cliente';
import { PexelsBrollService, type BrollSink } from '../broll/broll.service';
import { ffmpegOf } from '../broll/folha';
import { PexelsClient } from '../broll/pexels';
import { isIntegracaoError } from '../erros';

async function main() {
  const batchId = process.argv[2];
  const blockArg = process.argv.find((a) => a.startsWith('--block='));
  const prisma = new PrismaClient();
  try {
    const b = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, include: { offer: true, champion: { include: { teardown: true } } } });
    const sections = sectionsOf(b.champion.teardown!.sections)!;
    const blocks = sections.structure.status === 'ok' && sections.structure.data ? sections.structure.data.blocks : [];
    const k = blockArg ? Number(blockArg.slice(8)) : Math.max(0, blocks.findIndex((x) => x.function.toLowerCase() === 'proof'));
    const blk = blocks[k];
    if (!blk) throw new Error('bloco não encontrado');
    const language = b.champion.language || b.offer.language;
    console.log(`lote ${b.id} (status ${b.status}), bloco ${k} ${blk.label} ${blk.startSec}-${blk.endSec}s (${blk.function}): "${blk.speech}"`);
    if (!process.argv.includes('--yes')) return console.log('nada rodou (passe --yes)');

    const dir = join(__dirname, 'out', `broll-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    mkdirSync(dir, { recursive: true });
    const sink: BrollSink = { put: async (i) => { const f = join(dir, `final.${i.mimeType === 'video/mp4' ? 'mp4' : 'png'}`); writeFileSync(f, i.bytes); return { fileUrl: `file://${f}` }; } };
    const costs = new MemoryCostStore();
    const pexels = new PexelsClient({ apiKey: process.env.PEXELS_API_KEY! });
    const svc = new PexelsBrollService({
      pexels, costs, sink, ffmpeg: ffmpegOf(),
      transport: new SdkClaudeTransport(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 }), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: false }),
      wavespeed: process.env.WAVESPEED_API_KEY ? new WaveSpeedClient({ apiKey: process.env.WAVESPEED_API_KEY }) : null,
      onSheet: (n, id, jpeg) => writeFileSync(join(dir, `folha-${n}-pexels-${id}.jpg`), jpeg),
    });
    const t0 = Date.now();
    try {
      const out = await svc.search({
        workspaceId: b.workspaceId, variationBatchId: b.id, jobId: 'sonda-broll', speech: blk.speech, language,
        minSec: Math.max(2, Math.round((blk.endSec - blk.startSec) * 10) / 10), providers: ['pexels'], limit: 6,
        offer: { name: b.offer.name, kind: b.offer.kind, what: b.offer.what, audience: b.offer.audience },
      } as never);
      const c = out.candidates[0];
      console.log(`buscas: ${out.queries.join(' | ')}`);
      console.log(`escolhido: ${c.provenance.sourceUrl} (${c.provenance.creator}) ${c.provenance.startSec}-${c.provenance.endSec}s, células ${c.pick.cells?.join('-')}`);
      console.log(`motivo: ${c.pick.reason}`);
      console.log(`outros aceitos: ${out.candidates.slice(1).map((x) => x.provenance.sourceUrl).join(', ') || 'nenhum'}`);
      const got = await svc.fetch({ workspaceId: b.workspaceId, variationBatchId: b.id, candidateId: c.candidateId });
      writeFileSync(join(dir, 'escolha.json'), JSON.stringify({ block: blk, search: out, fetch: got }, null, 2));
      console.log(`clipe: ${got.fileUrl}`);
    } catch (e) {
      if (!(isIntegracaoError(e) && e.code === 'BROLL_NO_MATCH')) throw e;
      console.log(`sem candidato: ${e.message} ${JSON.stringify(e.details)}`);
      if (process.argv.includes('--fallback')) {
        const img = await svc.fallbackImage({ workspaceId: b.workspaceId, variationBatchId: b.id, subject: String(e.details?.fallbackSubject ?? '') });
        console.log(`reserva: ${img.fileUrl}`);
      }
    }
    const total = costs.entries.reduce((a, x) => a + x.amountUsd, 0);
    console.log(`em ${((Date.now() - t0) / 1000).toFixed(0)}s; custo US$ ${total.toFixed(4)}; Pexels: ${pexels.requests} pedido(s), restam ${pexels.remaining} nesta hora → ${dir}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
