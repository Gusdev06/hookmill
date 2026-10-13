// Fumaça do harness: roda SEM API. Prova que o banco de teste, o reset e a fábrica funcionam.
import { test, expect } from '../../harness/fixtures.ts';
import { businessTables, currentDatabase, q, readSnapshot, WS, PERSONAS } from '../../harness/db.ts';
import { guardTestBucket, guardTestDb } from '../../harness/env.ts';
import { STATES, criarCriativoNoEstado, criarOferta, estadoNoBanco } from '../../harness/fabrica.ts';

test.describe.configure({ mode: 'serial' });

test('trava recusa banco de dev, banco remoto e bucket que não é de teste', () => {
  expect(() => guardTestDb('postgresql://maquina:maquina@localhost:5433/maquina?schema=public')).toThrow(/BLOQUEADO/);
  expect(() => guardTestDb('postgresql://postgres.x:y@aws-0-sa-east-1.pooler.supabase.com:6543/postgres_test')).toThrow(/BLOQUEADO/);
  expect(() => guardTestBucket('maquina-anuncios')).toThrow(/BLOQUEADO/);
  expect(() => guardTestDb('postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public')).not.toThrow();
});

test('conecta no maquina_test com o schema do contrato aplicado', async () => {
  expect(await currentDatabase()).toBe('maquina_test');
  const tables = await businessTables();
  for (const t of ['users', 'workspaces', 'memberships', 'offers', 'creatives', 'scripts', 'faces', 'scenes', 'renders', 'files', 'jobs', 'provider_tasks', 'cost_entries', 'change_requests', 'invites', 'refresh_tokens']) {
    expect(tables).toContain(t);
  }
});

test('reset por teste: suja o banco (parte 1)', async () => {
  await criarOferta('A');
  await criarCriativoNoEstado('B', 'RENDER_READY');
  const [{ n }] = await q<{ n: string }>('select count(*) n from offers');
  expect(Number(n)).toBe(2);
});

test('reset por teste: o teste seguinte começa limpo e com as identidades intactas (parte 2)', async () => {
  for (const t of ['offers', 'creatives', 'scripts', 'faces', 'scenes', 'renders', 'files']) {
    const [{ n }] = await q<{ n: string }>(`select count(*) n from "${t}"`);
    expect(Number(n), t).toBe(0);
  }
  const snap = readSnapshot();
  expect(await q('select * from workspaces order by id')).toEqual(snap.workspaces);
  expect(await q('select * from users order by id')).toEqual(snap.users);
  expect(await q('select * from memberships order by id')).toEqual(snap.memberships);
  const ws = await q<{ workspace_id: string; n: string }>('select workspace_id, count(*) n from memberships group by 1 order by 1');
  expect(ws).toEqual([
    { workspace_id: WS.A, n: '4' },
    { workspace_id: WS.B, n: '2' },
  ]);
  expect((await q('select id from users')).length).toBe(Object.keys(PERSONAS).length);
});

test('fábrica põe um criativo em cada um dos 15 estados, com pré-requisitos coerentes', async () => {
  for (const s of STATES) {
    const c = await criarCriativoNoEstado('A', s);
    expect(await estadoNoBanco(c.id), s).toBe(s);
    const [row] = await q('select selected_script_id, selected_face_id, final_render_id, edit_dirty from creatives where id = $1', [c.id]);
    const idx = STATES.indexOf(s);
    expect(Boolean(row.selected_script_id), `${s} roteiro escolhido`).toBe(idx >= STATES.indexOf('AVATAR_PENDING'));
    expect(Boolean(row.selected_face_id), `${s} rosto escolhido`).toBe(idx >= STATES.indexOf('ENGINE_PENDING'));
    expect(Boolean(row.final_render_id), `${s} render final`).toBe(s === 'APPROVED');
    expect(row.edit_dirty, `${s} editDirty`).toBe(s === 'EDIT_PENDING');
  }
  const [{ n }] = await q<{ n: string }>("select count(*) n from creatives where workspace_id = $1", [WS.A]);
  expect(Number(n)).toBe(STATES.length);
});
