// Roda uma vez por execução: trava de banco, schema do zero no maquina_test e identidades fixas. Dono: maquina-qa.
import { applySchema, closeDb, currentDatabase, q, seedIdentities, type SchemaMode } from './db.ts';
import { ENV, guardTestApi, guardTestBucket, guardTestDb } from './env.ts';

export default async function globalSetup(): Promise<void> {
  guardTestDb();
  guardTestBucket();
  if (!ENV.noApi) {
    guardTestApi();
    await confirmarApiEmMock();
  }
  // 13/10 (Q1 variação auto): E2E_SKIP_SCHEMA=1 = nenhum comando Prisma; só confere que a migração exigida já está no banco
  let mode: SchemaMode | 'conferido' = 'conferido';
  if (process.env.E2E_SKIP_SCHEMA === '1') {
    const exige = process.env.E2E_EXIGE_MIGRACAO ?? '20261014000000_variacao_auto';
    const [m] = await q(`select finished_at from _prisma_migrations where migration_name = $1`, [exige]);
    if (!m?.finished_at) throw new Error(`[qa] maquina_test sem a migração ${exige} aplicada (E2E_SKIP_SCHEMA=1 não roda Prisma)`);
  } else mode = applySchema();
  const dbName = await currentDatabase();
  const snap = await seedIdentities({ useApiSeed: !ENV.noApi });
  await closeDb();
  console.log(`[qa] banco ${dbName} pronto (schema via ${mode}); identidades: ${snap.users.length} usuários, ${snap.workspaces.length} workspaces, senha via ${snap.seedMode}`);
  if (!ENV.noApi) await confirmarApiNoBancoDeTeste();
  if (ENV.comWeb) {
    // editor (09/10): o Player busca a mídia das URLs assinadas com fetch; o web de teste (3210) precisa estar no CORS do bucket de TESTE
    const { garantirCorsDoBucketDeTeste } = await import('./editor.ts');
    console.log(`[qa] CORS do bucket de teste pra ${ENV.webUrl}: ${await garantirCorsDoBucketDeTeste(ENV.webUrl)}`);
  }
  if (snap.seedMode === 'sintetico' && !ENV.noApi) {
    console.warn('[qa] AVISO: api sem script "seed" (B1 não entregue): login das personas vai falhar.');
  }
}

/** 09/10 (E2E_REUSE): a API que responde tem que enxergar o banco de TESTE. Os ids fixos (qa_user_dono_a, qa_ws_alfa) só
 *  existem no maquina_test, recém-semeado: login + /auth/me com esses ids = mesma base. Senão aborta antes de qualquer teste. */
async function confirmarApiNoBancoDeTeste(): Promise<void> {
  const base = ENV.apiUrl;
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ENV.ownerEmail, password: ENV.password }) });
  if (login.status === 429) return; // throttle: o primeiro teste confere de novo pelo tokenOf
  const tok = (await login.json().catch(() => null))?.data?.accessToken;
  const me = tok ? await (await fetch(`${base}/auth/me`, { headers: { authorization: `Bearer ${tok}` } })).json().catch(() => null) : null;
  const txt = JSON.stringify(me ?? {});
  if (!txt.includes('qa_user_dono_a') || !txt.includes('qa_ws_alfa')) {
    throw new Error(`[qa] BLOQUEADO: a API em ${base} não está no banco de teste recém-semeado (login/me: ${login.status} ${txt.slice(0, 200)}).`);
  }
}

/** A API que responde na porta de teste tem que ser a nossa e estar em mock. O webServer sobe antes do globalSetup
 *  (reuseExistingServer: false = falha se a porta já estiver ocupada). Se o /health disser o modo, live aborta;
 *  se ainda não disser (pedido ao backend em 06/10), confere pela rota que só existe em mock. */
async function confirmarApiEmMock(): Promise<void> {
  const base = ENV.apiUrl;
  const h = await fetch(`${base}/health`).then((r) => r.json()).catch((e) => { throw new Error(`[qa] API de teste não respondeu em ${base}: ${e.message}`); });
  const modo = h?.data?.integracoes ?? h?.integracoes;
  if (modo && modo !== 'mock') throw new Error(`[qa] BLOQUEADO: a API em ${base} está em INTEGRACOES_MODE=${modo}. Testes só em mock.`);
  // MockMediaController só é registrado em mock: 404 aqui = API em live
  const m = await fetch(`${base}/mock-media/audio/0123456789abcdef.wav?sec=1`);
  if (m.status === 404) throw new Error(`[qa] BLOQUEADO: ${base} não tem a rota /mock-media (API em live?). Nada roda.`);
}
