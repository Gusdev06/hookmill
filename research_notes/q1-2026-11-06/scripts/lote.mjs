// Q1 (troca-texto §16.6), lote real: os vídeos da S4 sobem pela API como um usuário (upload → campeão → lote do template
// HEADLINE → texto → Gerar), com PLATE_IMPL=lambda (hookmill-legenda) e RENDER_IMPL=lambda só no workspace do teste.
// A leitura da visão roda em mock (sem Claude): as camadas da headline vêm da S4 e são gravadas no editMap, como no QA.
// Uso: node lote.mjs <api-base> <email> <senha> <casos...>   (casos: s4-solto s4-05 s4-02 s4-06)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(AQUI, '../../..');
const require = createRequire(path.join(ROOT, 'testes', 'package.json'));
const pg = require('pg');
const [API, EMAIL, SENHA, ...CASOS] = process.argv.slice(2);
const DB = process.env.Q1_DB;
const SAIDA = path.resolve(AQUI, '..');
const S4 = path.join(ROOT, 'research_notes', 's4-demo-2026-11-06', 'origem');
const CS = JSON.parse(fs.readFileSync(path.join(ROOT, 'research_notes', 'v2-2026-11-06', 'casos-s4.json'), 'utf8'));
const VIDEO = { 's4-02': 'c02.mp4', 's4-05': 'c05.mp4', 's4-06': 'c06.mp4', 's4-solto': 'original.mp4' };
const LINGUA = { 's4-02': 'es', 's4-05': 'en', 's4-06': 'es', 's4-solto': 'en' };
// texto novo (o mesmo "novo" da S4/V3; a IA não roda neste lote)
const NOVO = {
  's4-solto': 'Tired of scrolling his endless following list?',
  's4-05': "If he doesn't text you back within an hour, I’ll pay you $50",
  's4-02': 'Si hoy no te escribe ni te busca, es porque nunca fue para ti..', // sem número novo (invented_number)
  's4-06': 'Él ya está con otra? Te propongo algo. Si en 7 días no te escribe, dime mentirosa',
};
const SEM_ROSTO = new Set((process.env.Q1_SEM_ROSTO ?? '').split(',').filter(Boolean));
const db = new pg.Pool({ connectionString: DB });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const log = (o) => { fs.appendFileSync(path.join(SAIDA, 'lote-log.jsonl'), JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n'); console.log(JSON.stringify(o)); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
async function call(method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data, error: j.error };
}
async function ate(fn, ok, ms, oque) {
  const fim = Date.now() + ms;
  for (;;) { const v = await fn(); if (ok(v)) return v; if (Date.now() > fim) throw new Error(`timeout: ${oque}`); await dorme(2000); }
}

const l = await call('POST', '/auth/login', { email: EMAIL, password: SENHA });
token = l.data.accessToken;
const me = await call('GET', '/auth/me');
const ws = me.data.workspace?.id ?? me.data.workspaces?.[0]?.id ?? me.data.currentWorkspaceId;
const user = me.data.user?.id ?? me.data.id;
log({ etapa: 'login', ws, user });
const resultado = [];
for (const caso of CASOS) {
  const t0 = Date.now();
  const arq = path.join(S4, VIDEO[caso]);
  const oid = `q1_offer_${caso.replace(/\W/g, '')}_${Date.now().toString(36)}`;
  await q(`insert into offers (id, workspace_id, name, language, what, audience, pains, promise, proof, cta, field_sources, created_by_id, updated_at)
           values ($1,$2,$3,$4,'An app','Women','He stopped answering','Know what he does',$6,'Download','{}'::jsonb,$5,now())`, [oid, ws, `Q1 ${caso}`, LINGUA[caso], user, caso === 's4-05' ? "4.8 rating. If he doesn't call you within two minutes, I'll pay you $50" : '4.8 rating']);
  const bytes = fs.readFileSync(arq);
  const up = await call('POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: VIDEO[caso], mimeType: 'video/mp4', sizeBytes: bytes.length });
  if (up.status !== 201) throw new Error(`upload ${up.status} ${JSON.stringify(up.error)}`);
  const put = await fetch(up.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', ...(up.data.headers ?? {}), ...(up.data.url.startsWith(API) ? { authorization: `Bearer ${token}` } : {}) }, body: bytes });
  if (!put.ok) throw new Error(`PUT ${put.status} ${await put.text()}`);
  const cp = await call('POST', `/uploads/${up.data.uploadId}/complete`, {});
  if (cp.status !== 200) throw new Error(`complete ${cp.status} ${JSON.stringify(cp.error)}`);
  const ch = await call('POST', '/champions', { offerId: oid, uploadId: up.data.uploadId, rights: 'OWN' });
  if (ch.status !== 202) throw new Error(`champion ${ch.status} ${JSON.stringify(ch.error)}`);
  const cid = ch.data.id;
  await ate(() => q(`select status from champions where id = $1`, [cid]), (r) => ['READY', 'FAILED'].includes(r[0]?.status), 600_000, 'análise');
  // a medida de depois da análise (camadas do mock) tem que terminar antes de gravar a camada da S4
  await ate(() => q(`select (edit_map ? 'headlineLook') tem from teardowns where champion_id = $1`, [cid]), (r) => r[0]?.tem, 300_000, 'medida pós-análise').catch(() => null);
  const [td] = await q(`select edit_map from teardowns where champion_id = $1`, [cid]);
  const c = CS.find((x) => x.nome === caso);
  const layer = { id: 'headline-1', kind: 'headline', startFrame: c.layer.startFrame ?? 0, endFrame: c.layer.endFrame ?? c.frames, box: c.layer.box,
    background: c.layer.background ?? { kind: 'none', color: null, box: null },
    style: { fontId: 'inter-800', uppercase: false, fontSizePx: 40, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: true, align: 'center', ...(c.layer.style ?? {}) },
    text: c.layer.text, wordsPerPage: null, source: 'vision' };
  // legenda queimada real (02, 06, solto) vira camada `caption`: sem ela o mock diria "sem legenda" e o remix-keep somaria a
  // legenda automática (karaokê) da transcrição MOCK por cima. No 05 (sem legenda) a camada só desliga a automática, que
  // sairia com palavras inventadas pelo mock: o lote real mostra só a headline.
  const CAP = { 's4-solto': { x: 90, y: 610, w: 290, h: 80 }, 's4-02': { x: 60, y: 900, w: 600, h: 130 }, 's4-06': { x: 80, y: 690, w: 560, h: 110 }, 's4-05': { x: 60, y: 1050, w: 600, h: 120 } }[caso];
  const fc = td.edit_map.frameCount || c.frames;
  const caption = { id: 'cap-1', kind: 'caption', startFrame: 0, endFrame: fc, box: CAP, background: { kind: 'none', color: null, box: null }, text: null, wordsPerPage: 3, source: 'vision',
    style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 40, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' } };
  const { headlineLook: _x, ...resto } = td.edit_map;
  await q(`update teardowns set edit_map = $2::jsonb where champion_id = $1`, [cid, JSON.stringify({ ...resto, layers: [layer, caption], protectedBands: c.bandas ?? (caso === 's4-05' ? [] : [{ ...CAP, startSec: 0, endSec: fc / (td.edit_map.fps || 30) }]), ...(SEM_ROSTO.has(caso) ? { faceTrack: [] } : {}) })]);
  await q(`delete from champion_plates where champion_id = $1`, [cid]);
  // campeão "antigo" (sem medida): a galeria/Use do template não mede sob demanda (achado Q1-B5); o lote normal mede (Lambda) e faz a placa
  const n = await call('POST', '/iterate', { championId: cid });
  if (n.status !== 202) throw new Error(`iterate ${n.status} ${JSON.stringify(n.error)}`);
  const nb = await ate(() => call('GET', `/iterate/${n.data.id}`), (r) => r.data && !['ANALYZING', 'PLANNING'].includes(r.data.status), 900_000, 'lote normal');
  log({ caso, loteNormal: nb.data.status, headlineBlocked: nb.data.insight?.headlineBlocked ?? null });
  // lote do template HEADLINE: plano (mock)
  const use = await call('POST', '/ad-templates/new-headline/use', { championId: cid });
  if (use.status !== 202) { log({ caso, cid, bloqueado: use.status, erro: use.error }); resultado.push({ caso, cid, bloqueado: use.error }); continue; }
  let b = await ate(() => call('GET', `/iterate/${use.data.id}`), (r) => r.data && !['ANALYZING', 'PLANNING'].includes(r.data.status), 900_000, 'plano');
  const look = (await q(`select edit_map->'headlineLook' l from teardowns where champion_id = $1`, [cid]))[0].l;
  fs.writeFileSync(path.join(SAIDA, `look-${caso}.json`), JSON.stringify(look, null, 1));
  const hs = (b.data.pieces ?? []).filter((p) => p.type === 'HEADLINE');
  log({ caso, cid, plano: b.data.status, pecas: hs.length, blocked: b.data.template?.fit ?? b.data.insight?.headlineBlocked, look: look && { kind: look.kind, f: [look.startFrame, look.endFrame], font: look.font, verdict: look.verdict?.reason } });
  if (!hs.length) { resultado.push({ caso, cid, bloqueado: b.data.template?.fit }); continue; }
  for (const p of hs.slice(1)) await call('PATCH', `/iterate/${b.data.id}/items/${p.id}`, { included: false });
  const tx = await call('PATCH', `/iterate/${b.data.id}/items/${hs[0].id}/texts`, { texts: [{ path: 'text', value: NOVO[caso] }] });
  if (tx.status !== 200) throw new Error(`texto ${tx.status} ${JSON.stringify(tx.error)}`);
  // destaque: no produto vem do plano da IA (hasHighlight do original); o PATCH só troca o texto. Aqui o QA grava o trecho
  // que a IA marcaria, para o 02 mostrar o sublinhado do original
  const DESTAQUE = { 's4-02': 'es porque nunca fue para ti..' };
  if (DESTAQUE[caso]) await q(`update variation_items set payload = jsonb_set(payload, '{params,highlight}', to_jsonb($2::text)) where id = $1`, [hs[0].id, DESTAQUE[caso]]);
  b = await call('GET', `/iterate/${b.data.id}`);
  const st = await call('POST', `/iterate/${b.data.id}/start`, { expectedPieces: b.data.pieces.length, expectedCostUsd: b.data.cost?.generateEstimateUsd ?? 0, ...(b.data.template && { expectedCredits: b.data.template.quote }) });
  if (st.status !== 202) throw new Error(`start ${st.status} ${JSON.stringify(st.error)}`);
  const fim = await ate(() => call('GET', `/iterate/${b.data.id}`), (r) => (r.data?.pieces ?? []).every((p) => ['ready', 'failed', 'left_out'].includes(p.status)), 1_800_000, 'render');
  const p = fim.data.pieces.find((x) => x.id === hs[0].id);
  const [r] = await q(`select r.id, r.input, r.impl, r.cost_usd, r.duration_sec, r.status, r.error_code, r.started_at, r.finished_at from renders r join creatives c on c.id = r.creative_id where c.variation_item_id = $1 and not r.stale order by r.created_at desc limit 1`, [hs[0].id]);
  let peca = null;
  if (p?.status === 'ready') {
    fs.mkdirSync(path.join(SAIDA, 'pecas'), { recursive: true });
    peca = path.join(SAIDA, 'pecas', `${caso}.mp4`);
    fs.writeFileSync(peca, Buffer.from(await (await fetch(p.files[0].url)).arrayBuffer()));
  }
  let placa = null;
  const [pl] = await q(`select c.metrics, c.cost_usd, f.storage_key from champion_plates c left join files f on f.id = c.file_id where c.champion_id = $1 and c.status = 'READY'`, [cid]);
  fs.writeFileSync(path.join(SAIDA, `render-input-${caso}.json`), JSON.stringify(r?.input ?? null, null, 1));
  const custos = await q(`select kind, provider, model, unit, units, amount_usd, created_at from cost_entries where champion_id = $1 or variation_batch_id in (select id from variation_batches where champion_id = $1) or creative_id in (select id from creatives where champion_id = $1) order by created_at`, [cid]);
  const linha = { caso, cid, batch: b.data.id, status: p?.status, errorCode: p?.errorCode, peca, render: r && { id: r.id, impl: r.impl, cost_usd: r.cost_usd, duration_sec: r.duration_sec, s: (new Date(r.finished_at) - new Date(r.started_at)) / 1000 }, placa: pl ?? null, custos, s: (Date.now() - t0) / 1000, texto: NOVO[caso] };
  if (p?.status === 'ready' && look?.kind === 'loose') {
    const u = (await call('GET', `/iterate/${b.data.id}`)).data; void u;
  }
  log(linha);
  resultado.push(linha);
}
fs.writeFileSync(path.join(SAIDA, 'lote.json'), JSON.stringify(resultado, null, 1));
await db.end();
