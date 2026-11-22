// Cria a peça AUTO (frame/headline) no banco de teste e guarda o id em .cache/qa-editor-simples.json. Dono: maquina-qa.
import { writeFileSync, mkdirSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { ateLote } from '../../harness/iterate.ts';
import { assentou } from '../../harness/iterate.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { campeao, comCreditos, conectarMetaMock, gerar, novoLote, prepararWs, setLayers } from '../../harness/f1a.ts';
import { CACHE_DIR } from '../../harness/env.ts';

test.setTimeout(1_200_000);
test('SETUP peça AUTO pronta pro editor', async () => {
  await prepararWs(); await comCreditos(100); await conectarMetaMock();
  const { championId, baseMap } = await campeao();
  await setLayers(championId, baseMap, { captionY: 820, captionH: 120 });
  const b = await novoLote(championId);
  await gerar(b);
  const fim = await ateLote('donoA', b.id, assentou, { timeoutMs: 600_000 });
  const prontas = fim.pieces.filter((p: any) => p.status === 'ready' && p.files?.length);
  expect(prontas.length).toBeGreaterThan(0);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(`${CACHE_DIR}/qa-editor-simples.json`, JSON.stringify({ pieces: prontas.map((p: any) => ({ id: p.id, creativeId: p.creativeId })), batchId: b.id }));
  console.log('PECAS', JSON.stringify(prontas.map((p: any) => p.creativeId)));
  await esperarJobsQuietos(180_000);
});
