// Ajudantes do QA do F1b (troca-texto-queimado-v1 §16.6 Q1). Campeão REAL (os 4 vídeos da S4) subido pela API em mock;
// a leitura da visão é mock, então as camadas da headline vêm da S4 (research_notes/v2-2026-11-06/casos-s4.json) e são
// gravadas no editMap do banco de teste, como no headline-copia.int.spec. Medida, régua no Chrome e placa: Python + Chrome
// LOCAIS (PLATE_IMPL=local, US$ 0). Dono: maquina-qa.
import { expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { as, call, expectOk, tokenOf } from './api.ts';
import { q } from './db.ts';
import { ROOT_DIR } from './env.ts';
import { ateLote, oferta, subirArquivo } from './iterate.ts';

export const S4 = join(ROOT_DIR, 'research_notes', 's4-demo-2026-11-06', 'origem');
export const SAIDA = process.env.Q1_SAIDA ?? '/tmp/q1/saida';
export type Caso = 's4-02' | 's4-05' | 's4-06' | 's4-solto';
const CASOS = JSON.parse(readFileSync(join(ROOT_DIR, 'research_notes', 'v2-2026-11-06', 'casos-s4.json'), 'utf8')) as any[];
export const VIDEO: Record<Caso, string> = { 's4-02': 'c02.mp4', 's4-05': 'c05.mp4', 's4-06': 'c06.mp4', 's4-solto': 'original.mp4' };
export const LINGUA: Record<Caso, string> = { 's4-02': 'es', 's4-05': 'en', 's4-06': 'es', 's4-solto': 'en' };
export const HEADLINE = 'new-headline';

export function notaQ1(nome: string, dados: unknown): void {
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(join(SAIDA, `${nome}.json`), JSON.stringify(dados, null, 1));
}

/** Upload do vídeo real + POST /champions (análise em mock) → READY; espera a medida de depois da análise acabar. */
export async function campeaoReal(caso: Caso, ws: 'A' | 'B' = 'A'): Promise<{ championId: string; offerId: string; baseMap: any }> {
  const persona = ws === 'A' ? 'donoA' : 'donoB';
  // 05: o "$50" da headline original não estava no Brain do mock e caía em invented_number (Q1-B3, corrigido no a7a03a9).
  // O contorno (o "$50" no proof) só volta com Q1_CONTORNO_50=1; por padrão o teste prova a correção sem ele.
  const o = await oferta(ws, { language: LINGUA[caso], ...(caso === 's4-05' && process.env.Q1_CONTORNO_50 === '1' ? { proof: 'If he doesn\'t call you within two minutes, I\'ll pay you $50' } : {}) });
  const s = await subirArquivo(persona, resolve(S4, VIDEO[caso]));
  expect(s.complete?.status, JSON.stringify(s.complete?.body)).toBe(200);
  const c = await call('POST', '/champions', { body: { offerId: o.id, uploadId: s.uploadId, rights: 'OWN' }, token: await tokenOf(persona) });
  expect(c.status, JSON.stringify(c.body)).toBe(202);
  await expect.poll(async () => (await q(`select status from champions where id = $1`, [c.data.id]))[0].status, { timeout: 240_000 }).toBe('READY');
  // a medida de depois da análise (decisão 06/11) roda com as camadas do mock: espera ela gravar (ou não ter o que medir)
  const fim = Date.now() + 120_000;
  while (Date.now() < fim) {
    const [r] = await q(`select (edit_map ? 'headlineLook') tem from teardowns where champion_id = $1`, [c.data.id]);
    if (r?.tem) break;
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  const [td] = await q(`select edit_map from teardowns where champion_id = $1`, [c.data.id]);
  return { championId: c.data.id, offerId: o.id, baseMap: td.edit_map };
}

/** Camada da headline da S4 no editMap (sem a medida: o próximo lote mede como em campeão antigo). */
export async function camadaS4(championId: string, caso: Caso, baseMap: any, o: { semRosto?: boolean } = {}): Promise<void> {
  const c = CASOS.find((x) => x.nome === caso);
  const layer = {
    id: c.layer.id ?? 'headline-1', kind: 'headline', startFrame: c.layer.startFrame ?? 0, endFrame: c.layer.endFrame ?? c.frames,
    box: c.layer.box, background: c.layer.background ?? { kind: 'none', color: null, box: null },
    style: { fontId: 'inter-800', uppercase: false, fontSizePx: 40, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: true, align: 'center', ...(c.layer.style ?? {}) },
    text: c.layer.text, wordsPerPage: null, source: 'vision',
  };
  const { headlineLook: _l, ...resto } = baseMap;
  // semRosto: contorno antigo do QA para o over_face na caixa (02, Q1-B1, corrigido no a7a03a9); só com Q1_SEM_ROSTO=1
  const mapa = { ...resto, layers: [layer], protectedBands: c.bandas ?? [], ...(o.semRosto ? { faceTrack: [] } : {}) };
  await q(`update teardowns set edit_map = $2::jsonb where champion_id = $1`, [championId, JSON.stringify(mapa)]);
  await q(`delete from champion_plates where champion_id = $1`, [championId]);
}

export const lookDe = async (championId: string) => (await q(`select edit_map->'headlineLook' l from teardowns where champion_id = $1`, [championId]))[0]?.l ?? undefined;
export const placasDe = (championId: string) => q(`select status, reason, version, layer_key, metrics, file_id, cost_usd from champion_plates where champion_id = $1`, [championId]);
export const planejado = (persona: 'donoA' | 'donoB', id: string) => ateLote(persona, id, (b: any) => !['ANALYZING', 'PLANNING'].includes(b.status), { oQue: 'plano', timeoutMs: 420_000 });
export const novoLote = async (championId: string, persona: 'donoA' | 'donoB' = 'donoA') => planejado(persona, expectOk(await as(persona).post('/iterate', { championId }), 202).id);
export const fitHeadline = async (championId: string, persona: 'donoA' | 'donoB' = 'donoA') =>
  expectOk(await as(persona).post('/ad-templates/fits', { slug: HEADLINE, sources: [{ championId }] })).items[0].fit;
export const texto = (batchId: string, itemId: string, value: string) => as('donoA').patch(`/iterate/${batchId}/items/${itemId}/texts`, { texts: [{ path: 'text', value }] });

/** Q1-B1 corrigido: o 02 roda com o rosto real; o contorno antigo (faceTrack vazio) só com Q1_SEM_ROSTO=1. */
export const SEM_ROSTO_02 = process.env.Q1_SEM_ROSTO === '1';
