import type { ChampionStatus, VariationBatchStatus } from '@maquina/contratos';
import { AppException } from '../common/errors/app-exception';
import { keyframeTimes } from '../campeoes/analise.service';
import { CHAMPION_EVENTS, CHAMPION_TRANSITIONS, ChampionEvent, ChampionStateMachine, championAllowedFrom } from '../campeoes/champion-state-machine';
import { adArchiveIdOf } from '../campeoes/limites';
import { availableKinds, championAction } from '../campeoes/champion-views';
import { allowedChanges } from '../revisao/revisao.service';
import { assertVariationGenerate } from '../criativos/state-machine';
import { BATCH_EVENT_MODE, BATCH_EVENTS, BATCH_TRANSITIONS, BatchEvent, BatchStateMachine, batchAllowedFrom } from './batch-state-machine';
import { hookEndOf, itemBlocks, nearestFormat, originalHook, type TeardownSnapshot } from './plano';

/** Banco em memória com o compare-and-set do Prisma (updateMany where status in [...]). */
function fakeDb(model: 'champion' | 'variationBatch', status: string, mode = 'MANUAL') {
  const row: Record<string, unknown> = { id: 'x1', status, archivedAt: null, mode };
  const m = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      if (where.id !== row.id || !where.status.in.includes(row.status) || (where.archivedAt === null && row.archivedAt !== null)) return { count: 0 };
      if (where.mode !== undefined && where.mode !== row.mode) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findUnique: jest.fn(async () => ({ status: row.status, archivedAt: row.archivedAt, mode: row.mode })),
  };
  return { row, prisma: { [model]: m } as any };
}

const CHAMPION_STATES: ChampionStatus[] = ['RESOLVING', 'ANALYZING', 'READY', 'FAILED'];
const BATCH_STATES: VariationBatchStatus[] = ['PLANNING', 'PLAN_READY', 'PLAN_FAILED', 'LAUNCHED', 'ANALYZING', 'ANALYSIS_FAILED'];

describe('máquina do campeão (§3.1): uma transição válida por teste', () => {
  const VALID = CHAMPION_EVENTS.flatMap((ev) =>
    CHAMPION_TRANSITIONS[ev].from.flatMap((from) => CHAMPION_TRANSITIONS[ev].to.map((to) => [ev, from, to] as [ChampionEvent, ChampionStatus, ChampionStatus])),
  );
  it.each(VALID)('%s: %s → %s', async (event, from, to) => {
    const { row, prisma } = fakeDb('champion', from);
    await expect(new ChampionStateMachine(prisma).transition({ championId: 'x1', event, from, to })).resolves.toEqual({ to });
    expect(row.status).toBe(to);
  });

  const INVALID = CHAMPION_EVENTS.flatMap((ev) => CHAMPION_STATES.filter((s) => !championAllowedFrom(ev).includes(s)).map((s) => [ev, s] as [ChampionEvent, ChampionStatus]));
  it.each(INVALID)('%s em %s → 409 INVALID_STATE e nada muda', async (event, from) => {
    const { row, prisma } = fakeDb('champion', from);
    const err = await new ChampionStateMachine(prisma).transition({ championId: 'x1', event, to: CHAMPION_TRANSITIONS[event].to[0] }).catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.details).toEqual({ state: from, allowed: championAllowedFrom(event) });
    expect(row.status).toBe(from);
  });

  it('arquivado = 404', async () => {
    const { row, prisma } = fakeDb('champion', 'READY');
    row.archivedAt = new Date();
    const err = await new ChampionStateMachine(prisma).transition({ championId: 'x1', event: 'ANALYZE_AGAIN', to: 'ANALYZING' }).catch((e) => e);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('tabela igual ao contrato', () => {
    expect(CHAMPION_TRANSITIONS).toEqual({
      RESOLVED: { from: ['RESOLVING'], to: ['ANALYZING'] },
      RESOLVE_FAILED: { from: ['RESOLVING'], to: ['FAILED'] },
      ANALYSIS_DONE: { from: ['ANALYZING'], to: ['READY'] },
      ANALYSIS_FAILED: { from: ['ANALYZING'], to: ['FAILED'] },
      ATTACH_VIDEO: { from: ['FAILED'], to: ['ANALYZING'] },
      ANALYZE_AGAIN: { from: ['FAILED', 'READY'], to: ['ANALYZING'] },
    });
  });
});

describe('máquina do lote (§3.2): uma transição válida por teste', () => {
  const VALID = BATCH_EVENTS.flatMap((ev) =>
    BATCH_TRANSITIONS[ev].from.flatMap((from) => BATCH_TRANSITIONS[ev].to.map((to) => [ev, from, to] as [BatchEvent, VariationBatchStatus, VariationBatchStatus])),
  );
  it.each(VALID)('%s: %s → %s', async (event, from, to) => {
    const { row, prisma } = fakeDb('variationBatch', from, BATCH_EVENT_MODE[event]);
    await expect(new BatchStateMachine(prisma).transition({ batchId: 'x1', event, from, to })).resolves.toEqual({ to });
    expect(row.status).toBe(to);
  });

  it.each(VALID)('%s: %s → %s no lote do OUTRO modo = 404 e nada muda', async (event, from, to) => {
    const other = BATCH_EVENT_MODE[event] === 'AUTO' ? 'MANUAL' : 'AUTO';
    const { row, prisma } = fakeDb('variationBatch', from, other);
    const err = await new BatchStateMachine(prisma).transition({ batchId: 'x1', event, from, to }).catch((e) => e);
    expect(err.code).toBe('NOT_FOUND');
    expect(row.status).toBe(from);
  });

  const INVALID = BATCH_EVENTS.flatMap((ev) => BATCH_STATES.filter((s) => !batchAllowedFrom(ev).includes(s)).map((s) => [ev, s] as [BatchEvent, VariationBatchStatus]));
  it.each(INVALID)('%s em %s → 409 INVALID_STATE (LAUNCHED é final)', async (event, from) => {
    const { row, prisma } = fakeDb('variationBatch', from, BATCH_EVENT_MODE[event]);
    const err = await new BatchStateMachine(prisma).transition({ batchId: 'x1', event, to: BATCH_TRANSITIONS[event].to[0] }).catch((e) => e);
    expect(err.code).toBe('INVALID_STATE');
    expect(row.status).toBe(from);
  });

  it('nada sai de LAUNCHED', () => {
    expect(BATCH_EVENTS.filter((e) => batchAllowedFrom(e).includes('LAUNCHED'))).toEqual([]);
  });

  it('tabela AUTO igual ao contrato (variacao-auto-v1 §3.1)', () => {
    const auto = Object.fromEntries(BATCH_EVENTS.filter((e) => BATCH_EVENT_MODE[e] === 'AUTO').map((e) => [e, BATCH_TRANSITIONS[e]]));
    expect(auto).toEqual({
      AUTO_READING_DONE: { from: ['ANALYZING'], to: ['PLANNING'] },
      AUTO_FAILED: { from: ['ANALYZING', 'PLANNING'], to: ['ANALYSIS_FAILED'] },
      AUTO_PLAN_DONE: { from: ['PLANNING'], to: ['PLAN_READY'] },
      AUTO_RETRY: { from: ['ANALYSIS_FAILED'], to: ['ANALYZING', 'PLANNING'] },
      AUTO_START: { from: ['PLAN_READY'], to: ['LAUNCHED'] },
    });
    // ANALYZING/ANALYSIS_FAILED só existem no AUTO; PLAN_FAILED só no MANUAL
    const manualFrom = BATCH_EVENTS.filter((e) => BATCH_EVENT_MODE[e] === 'MANUAL').flatMap(batchAllowedFrom);
    expect(manualFrom).not.toContain('ANALYZING');
    expect(manualFrom).not.toContain('ANALYSIS_FAILED');
  });
});

describe('regras puras da feature 2', () => {
  it('link: só anúncio único da Ad Library', () => {
    expect(adArchiveIdOf('https://www.facebook.com/ads/library/?id=123456&country=BR')).toBe('123456');
    expect(adArchiveIdOf('https://facebook.com/ads/library?id=9')).toBe('9');
    expect(adArchiveIdOf('https://www.facebook.com/ads/library/?q=abc')).toBeNull();
    expect(adArchiveIdOf('https://evil.com/ads/library/?id=1')).toBeNull();
    expect(adArchiveIdOf('https://www.facebook.com/ads/library/?id=12a')).toBeNull();
    expect(adArchiveIdOf('not a url')).toBeNull();
  });

  it('availableKinds: nunca trava por rights; sem fala = NO_SPEECH; fora do build = NOT_ENABLED', () => {
    expect(availableKinds({ status: 'READY', hasSpeech: true })).toEqual([
      { kind: 'SWAP_AVATAR', available: true, reason: null }, { kind: 'NEW_HOOKS', available: true, reason: null },
      { kind: 'COPY_NEW', available: false, reason: 'NOT_ENABLED' }, { kind: 'REMIX_EDIT', available: false, reason: 'NOT_ENABLED' },
    ]);
    expect(availableKinds({ status: 'READY', hasSpeech: false })[0]).toEqual({ kind: 'SWAP_AVATAR', available: false, reason: 'NO_SPEECH' });
    expect(availableKinds({ status: 'ANALYZING', hasSpeech: true })[0]).toEqual({ kind: 'SWAP_AVATAR', available: false, reason: null });
  });

  it('ação do campeão FAILED: sem vídeo ou vídeo inválido = upload_video; resto = analyze_again', () => {
    expect(championAction({ status: 'FAILED', videoFileId: null, errorCode: 'AD_NOT_FOUND' })).toBe('upload_video');
    expect(championAction({ status: 'FAILED', videoFileId: 'f', errorCode: 'MEDIA_INVALID' })).toBe('upload_video');
    expect(championAction({ status: 'FAILED', videoFileId: 'f', errorCode: 'PROVIDER_ERROR' })).toBe('analyze_again');
    expect(championAction({ status: 'READY', videoFileId: 'f', errorCode: null })).toBeNull();
  });

  it('pedidos de ajuste por tipo (§3.3)', () => {
    expect(allowedChanges({ origin: 'SCRATCH', variationKind: null, voiceSource: 'CATALOG' }, [])).toEqual(['SCENE', 'LINE', 'TEXT', 'FACE']);
    expect(allowedChanges({ origin: 'VARIATION', variationKind: 'SWAP_AVATAR', voiceSource: 'CHAMPION_AUDIO' }, ['AUDIO_LIPSYNC'])).toEqual(['SCENE', 'TEXT', 'FACE']);
    expect(allowedChanges({ origin: 'VARIATION', variationKind: 'SWAP_AVATAR', voiceSource: 'CATALOG' }, ['TTS_LIPSYNC'])).toEqual(['SCENE', 'LINE', 'TEXT', 'FACE']);
    expect(allowedChanges({ origin: 'VARIATION', variationKind: 'NEW_HOOKS', voiceSource: 'CATALOG' }, ['TTS_LIPSYNC', 'REUSE'])).toEqual(['SCENE', 'LINE', 'TEXT']);
  });

  it('frames-chave: t0, cortes e fim; no máximo 16, ordenados', () => {
    const k = keyframeTimes(30, [{ atSec: 5 }, { atSec: 12.5 }]);
    expect(k[0]).toEqual({ atSec: 0, reason: 't0' });
    expect(k.find((x) => x.reason === 'end')!.atSec).toBeCloseTo(29.9);
    expect(k.filter((x) => x.reason === 'cut').map((x) => x.atSec)).toEqual([5, 12.5]);
    expect(k.length).toBeLessThanOrEqual(16);
    expect(keyframeTimes(120, Array.from({ length: 40 }, (_, i) => ({ atSec: i * 3 + 1 }))).length).toBeLessThanOrEqual(16);
  });

  it('formato mais próximo do aspecto do campeão', () => {
    expect(nearestFormat(720, 1280)).toBe('VERTICAL_9_16');
    expect(nearestFormat(1080, 1350)).toBe('PORTRAIT_4_5');
    expect(nearestFormat(1080, 1080)).toBe('SQUARE_1_1');
    expect(nearestFormat(1920, 1080)).toBe('SQUARE_1_1');
  });

  const snap: TeardownSnapshot = {
    durationSec: 8, width: 720, height: 1280,
    words: Array.from({ length: 16 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 })),
    sections: {
      hook: { status: 'ok', naReason: null, data: { endSec: 2, visual: '', onScreenText: 'H', spoken: 'x' } },
      structure: { status: 'ok', naReason: null, data: { blocks: [
        { label: 'hook', function: '', startSec: 0, endSec: 2, onScreen: '', speech: '' },
        { label: 'body', function: '', startSec: 2, endSec: 8, onScreen: '', speech: '' },
      ] } },
    } as any,
  };

  it('controle = gancho original literal; gancho novo desloca o corpo (literal) pela duração nova', () => {
    expect(hookEndOf(snap)).toBe(2);
    expect(originalHook(snap)).toEqual({ speech: 'w0 w1 w2 w3', onScreenText: 'H', durationSec: 2 });
    const b = itemBlocks('NEW_HOOKS', snap, { speech: 'new', durationSec: 3 });
    expect(b[0]).toMatchObject({ label: 'hook', startSec: 0, endSec: 3, speech: 'new' });
    expect(b[1]).toMatchObject({ startSec: 3, endSec: 9, speech: 'w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14 w15' });
    expect(itemBlocks('SWAP_AVATAR', snap).map((x) => x.speech).join(' ')).toBe(snap.words.map((w) => w.word).join(' '));
  });
});

describe('POST /generate em variação (esclarecimento 5): só com engine/modelo/voz/formato iguais', () => {
  const c = { state: 'ENGINE_PENDING' as const, origin: 'VARIATION', engine: 'LIPSYNC', engineModel: 'pruna-lipsync', voiceId: null, format: 'VERTICAL_9_16' };
  const same = { engine: 'LIPSYNC', engineModel: 'pruna-lipsync', format: 'VERTICAL_9_16' };
  it('iguais: passa', () => expect(() => assertVariationGenerate(c, same)).not.toThrow());
  it.each([
    ['engine', { ...same, engine: 'SCENES' }],
    ['engineModel', { ...same, engineModel: 'kling-3.0' }],
    ['voiceId', { ...same, voiceId: 'v1' }],
    ['format', { ...same, format: 'SQUARE_1_1' }],
  ])('%s diferente = 409 variation_locked', (_k, dto) => {
    const err = (() => { try { assertVariationGenerate(c, dto); } catch (e) { return e as AppException; } })();
    expect(err?.code).toBe('INVALID_STATE');
    expect(err?.details).toEqual({ state: 'ENGINE_PENDING', allowed: [], reason: 'variation_locked' });
  });
  it('criativo do zero: nunca trava', () => expect(() => assertVariationGenerate({ ...c, origin: 'SCRATCH' }, { ...same, format: 'SQUARE_1_1' })).not.toThrow());
});
