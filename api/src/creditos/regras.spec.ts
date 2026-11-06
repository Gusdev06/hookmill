// templates-creditos-v1 §4 (31/10): conta do crédito do lote de template (quote, assentar, Retry depois do estorno).
import type { PieceStatus } from '@maquina/contratos';
import { type RunLine, deliveredOf, ledgerKey, lineKeyOf, quoteOf, retryNeed, settle } from './regras';

const line = (key: string, credits: number, itemIds: string[], o: Partial<RunLine> = {}): RunLine =>
  ({ key, templateId: `t-${key}`, slug: key.toLowerCase(), tier: 'EDIT', credits, itemIds, state: 'held', delivered: null, ...o });
const st = (m: Record<string, PieceStatus>) => (id: string) => m[id] ?? 'queued';

describe('créditos do lote de template (templates-creditos-v1 §4)', () => {
  it('chave da linha e quote com teto', () => {
    expect(lineKeyOf('FRAME', 'news')).toBe('FRAME:news');
    expect(lineKeyOf('HEADLINE', null)).toBe('HEADLINE');
    const ls = Array.from({ length: 12 }, (_, k) => line(`K${k}`, 1, [`i${k}`]));
    expect(quoteOf(ls, null)).toBe(12);
    expect(quoteOf(ls, 10)).toBe(10); // pack: teto de 10
    expect(quoteOf([line('STATIC', 2, ['a'])], null)).toBe(2);
  });

  it('entregue: Edição = tudo com ≥ 1 pronta; IA = parte das prontas arredondada pra baixo', () => {
    expect(deliveredOf({ tier: 'EDIT', credits: 1 }, ['ready', 'failed', 'failed'])).toBe(1);
    expect(deliveredOf({ tier: 'EDIT', credits: 1 }, ['failed', 'left_out'])).toBe(0);
    expect(deliveredOf({ tier: 'AI', credits: 8 }, ['ready', 'ready', 'failed'])).toBe(5); // devolve 3 (a favor do cliente)
    expect(deliveredOf({ tier: 'AI', credits: 9 }, ['ready', 'ready', 'ready'])).toBe(9);
  });

  it('assentar: espera todas terminarem; cobra o que saiu e devolve o que falhou', () => {
    const run = { cap: null, held: 1, charged: 0, lines: [line('FRAME:news', 1, ['a'])] };
    expect(settle(run, st({ a: 'rendering' }))).toBeNull();
    expect(settle(run, st({ a: 'ready' }))).toMatchObject({ charge: 1, refund: 0 });
    const s = settle(run, st({ a: 'failed' }))!;
    expect(s).toMatchObject({ charge: 0, refund: 1 });
    expect(s.lines[0]).toMatchObject({ state: 'refunded', delivered: 0 });
  });

  it('pack com teto: 12 linhas = 10 reservados; 3 falham = ainda 9 entregues → cobra 9, devolve 1', () => {
    const lines = Array.from({ length: 12 }, (_, k) => line(`K${k}`, 1, [`i${k}`]));
    const statuses = Object.fromEntries(lines.map((l, k) => [`i${k}`, (k < 3 ? 'failed' : 'ready') as PieceStatus]));
    expect(settle({ cap: 10, held: 10, charged: 0, lines }, st(statuses))).toMatchObject({ target: 9, charge: 9, refund: 1 });
    // 1 só falha: 11 entregues, mas o teto segura em 10
    const one = Object.fromEntries(lines.map((l, k) => [`i${k}`, (k === 0 ? 'failed' : 'ready') as PieceStatus]));
    expect(settle({ cap: 10, held: 10, charged: 0, lines }, st(one))).toMatchObject({ charge: 10, refund: 0 });
  });

  it('Retry depois do estorno: reserva o que falta (0 se o pack já está no teto) e o reassentamento só cobra a diferença', () => {
    const lines = [line('FRAME:news', 1, ['a'], { state: 'refunded', delivered: 0 }), line('HEADLINE', 1, ['b'], { state: 'charged', delivered: 1 })];
    expect(retryNeed({ cap: null, held: 0, charged: 1, lines }, 'FRAME:news')).toBe(1);
    const back = lines.map((l) => (l.key === 'FRAME:news' ? { ...l, state: 'held' as const } : l));
    expect(settle({ cap: null, held: 1, charged: 1, lines: back }, st({ a: 'ready', b: 'ready' }))).toMatchObject({ charge: 1, refund: 0, target: 2 });
    expect(settle({ cap: null, held: 1, charged: 1, lines: back }, st({ a: 'failed', b: 'ready' }))).toMatchObject({ charge: 0, refund: 1 });
    // pack: 11 linhas entregues + 1 estornada, teto 10 → Retry não precisa reservar nada
    const pack = [...Array.from({ length: 11 }, (_, k) => line(`K${k}`, 1, [`i${k}`], { state: 'charged', delivered: 1 })), line('KX', 1, ['x'], { state: 'refunded', delivered: 0 })];
    expect(retryNeed({ cap: 10, held: 0, charged: 10, lines: pack }, 'KX')).toBe(0);
  });

  it('chaves de idempotência estáveis por run e tentativa', () => {
    expect(ledgerKey.reserve('r1', 1)).toBe('run:r1:reserve:1');
    expect(ledgerKey.refund('r1', 2)).toBe('run:r1:refund:2');
    expect(ledgerKey.sampleGrant('u1')).toBe('sample-grant:u1');
  });
});
