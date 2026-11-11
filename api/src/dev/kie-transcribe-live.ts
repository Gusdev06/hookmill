// 11/11: prova ao vivo da transcrição pelo Kie no serviço real (memória, sem banco). Rodar: npx ts-node -T src/dev/kie-transcribe-live.ts <url pública>
import { readFileSync } from 'node:fs';
import { KieJobsClient } from '../integracoes/kie/jobs';
import { MemoryCostStore, MemoryTaskStore } from '../integracoes/store/memoria.store';
import { WaveSpeedClient } from '../integracoes/wavespeed/cliente';
import { WaveSpeedGenerationService } from '../integracoes/wavespeed/generation.service';
const env: Record<string, string> = {};
for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=([^#\n]*)/); if (m) env[m[1]] = m[2].trim(); }
(async () => {
  const tasks = new MemoryTaskStore(), costs = new MemoryCostStore();
  const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'nao-usar' }), tasks, costs, { emit: () => true } as never, { webhookUrl: null, kie: new KieJobsClient({ apiKey: env.KIE_API_KEY }) });
  const t0 = Date.now();
  const s = await svc.submitTranscribe({ workspaceId: 'w', championId: 'c', mediaUrl: process.argv[2] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    if (await svc.reconcile({ minAgeMs: 0, timeoutMs: 600_000, provider: 'KIE' })) break;
  }
  const t = await svc.parseTranscript(s.providerTaskId);
  console.log('ok em', Date.now() - t0, 'ms; idioma', t.language, ';', t.words.length, 'palavras');
  console.log(t.words.slice(0, 5), t.words.slice(-2));
  console.log('custo', costs.entries);
})().catch((e) => { console.error('FALHOU', e.code, e.message, e.details); process.exit(1); });
