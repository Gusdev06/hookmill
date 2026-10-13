// Q1 (13/10): tempo REAL de um lote de 11 peças (33 renders) com RENDER_IMPL=remotion na API do QA (porta 3122, mock nas
// integrações, maquina_test). Render é local e grátis. Campeão real (podcast-aceite, 49 s, 720x1280).
// Rodar (de testes/, com a API de mock parada pra não dividir a fila): npm run iterate:tempo
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { PODCAST, assentou, ateLote, getLote, lotePronto, oferta } from '../../harness/iterate.ts';

const seg = (ms: number) => `${(ms / 1000).toFixed(0)} s (${(ms / 60000).toFixed(1)} min)`;

test('IT-TEMPO lote de 11 peças, render real: 9:16 de todas pronto em X, tudo em Y', async () => {
  await oferta('A');
  const b = await lotePronto('donoA', PODCAST);
  expect(b.status, JSON.stringify(b.error)).toBe('PLAN_READY');
  // o mock planeja 9-10 peças com este campeão (CUT sai no reparo, ENDCARD bloqueado por has_end_card): completa até 11
  // duplicando HOOK_TEXT (GANCHO 3) e, se faltar, STATIC — tipos que o próprio catálogo permite repetir (D2)
  const itens = await q(`select * from variation_items where batch_id = $1 order by index`, [b.id]);
  const extras: [string, string, (p: any) => any][] = [
    ['HOOK_TEXT', 'HOOK-TEXT-3', (p) => ({ ...p, params: { ...p.params, text: 'Watch this before you pay again' } })],
    ['NATIVE_SEARCH', 'NATIVE-SEARCH-3', (p) => ({ ...p, params: { ...p.params, query: 'why do my bills keep going up' } })],
  ];
  let idx = itens.length;
  for (const [tipo, code, muda] of extras) {
    if (idx >= 11) break;
    const base = itens.find((i: any) => i.auto_type === tipo);
    if (!base || itens.some((i: any) => i.code === code)) continue;
    await q(
      `insert into variation_items (id, workspace_id, batch_id, kind, index, is_control, included, status, lever, rationale, payload, auto_type, code, axis, change, in_zip, updated_at)
       values ($1,$2,$3,$4,$5,false,true,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,true,now())`,
      [`qa_item_${randomUUID().slice(0, 12)}`, base.workspace_id, b.id, base.kind, idx++, base.status, base.lever, base.rationale, JSON.stringify(muda(base.payload)),
       base.auto_type, code, base.axis, `${base.change} (QA)`],
    );
  }
  const plano = (await getLote('donoA', b.id)).data;
  const n = plano.pieces.length;
  expect(n).toBe(11);
  const t0 = Date.now();
  expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: n }), 202);
  let t916: number | null = null;
  const fim = await ateLote('donoA', b.id, (x) => {
    if (t916 === null && x.pieces.every((p: any) => p.previewReady || p.status === 'failed')) t916 = Date.now();
    return assentou(x);
  }, { timeoutMs: 14_000_000, oQue: 'lote de 11 com render real' });
  const tTudo = Date.now() - t0;
  const renders = await q<any>(`select vi.code, vi.auto_type, r.format, r.status, r.started_at, r.finished_at, r.duration_sec, r.fail_reason,
                                   extract(epoch from (r.finished_at - r.started_at)) seg
                              from renders r join creatives c on c.id = r.creative_id join variation_items vi on vi.id = c.variation_item_id
                             where c.variation_batch_id = $1 and not r.stale order by r.started_at`, [b.id]);
  const porFormato = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'].map((f) => {
    const rs = renders.filter((r: any) => r.format === f);
    return `${f}: ${rs.length} renders, ${rs.reduce((a: number, r: any) => a + Number(r.seg ?? 0), 0).toFixed(0)} s de render`;
  });
  const lento = [...renders].sort((a: any, z: any) => Number(z.seg) - Number(a.seg)).slice(0, 3).map((r: any) => `${r.code} ${r.format} ${Number(r.seg).toFixed(0)} s (saída ${r.duration_sec} s)`);
  const falhas = fim.pieces.filter((p: any) => p.status !== 'ready').map((p: any) => `${p.code}:${p.status}:${p.errorCode}:${p.failReason}`);
  const resumo = [
    `peças ${n}, renders ${renders.length}, prontas ${fim.summary.ready}, falhas ${fim.summary.failed}`,
    `9:16 de todas pronto em ${t916 ? seg(t916 - t0) : 'n/d'}`,
    `tudo assentado em ${seg(tTudo)}`,
    ...porFormato,
    `mais lentos: ${lento.join(' | ')}`,
    `falhas: ${falhas.join(' | ') || 'nenhuma'}`,
  ];
  console.log(`[qa] TEMPO\n${resumo.join('\n')}`);
  test.info().annotations.push({ type: 'tempo', description: resumo.join(' · ') });
  writeFileSync(join(process.cwd(), 'test-results', 'iterate-tempo.json'), JSON.stringify({ resumo, renders, pieces: fim.pieces.map((p: any) => ({ code: p.code, status: p.status, files: p.files })) }, null, 2));
  // saídas reais: 1080 de largura, duração e áudio (amostra: 9:16 e 1:1 de 1 peça de vídeo, PNG do STATIC)
  const dir = mkdtempSync(join(tmpdir(), 'qa-tempo-'));
  const amostra = fim.pieces.find((p: any) => p.status === 'ready' && p.type === 'STORY') ?? fim.pieces.find((p: any) => p.status === 'ready' && p.type !== 'STATIC');
  for (const f of amostra.files) {
    const path = join(dir, f.name);
    writeFileSync(path, Buffer.from(await (await fetch(f.url)).arrayBuffer()));
    const pr = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames:format=duration', '-of', 'json', path], { encoding: 'utf8' });
    test.info().annotations.push({ type: `saída ${f.name}`, description: pr.replace(/\s+/g, ' ') });
    const j = JSON.parse(pr);
    const v = j.streams.find((s: any) => s.codec_type === 'video');
    expect(v.width).toBe(1080);
    expect(v.height).toBe(f.format === '9x16' ? 1920 : f.format === '4x5' ? 1350 : 1080);
    expect(j.streams.some((s: any) => s.codec_type === 'audio'), `${f.name} com áudio`).toBe(true);
  }
  expect(fim.summary.failed, falhas.join(' | ')).toBe(0);
});
