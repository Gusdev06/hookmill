// Backoff do cron de META_SYNC (revisão do arquiteto 21/10): 5 → 15 → 60 min → 6 h por conexão, zera no sucesso;
// o tickSync pula a conexão em espera e o manual não olha o backoff. META_MODE=off: MetaModeGuard responde 503.
import { AppException } from '../common/errors/app-exception';
import { MetaModeGuard } from './meta-mode.guard';
import { SYNC_BACKOFF_STEPS_MS, SyncBackoff } from './sync-backoff';
import { MetaSyncService } from './sync.service';

const MIN = 60_000;

describe('SyncBackoff', () => {
  it('5 → 15 → 60 min → 6 h e trava no teto; sucesso zera', () => {
    const b = new SyncBackoff();
    const t0 = 1_000_000;
    expect(b.allows('c1', t0)).toBe(true);
    expect(b.fail('c1', t0) - t0).toBe(5 * MIN);
    expect(b.fail('c1', t0) - t0).toBe(15 * MIN);
    expect(b.fail('c1', t0) - t0).toBe(60 * MIN);
    expect(b.fail('c1', t0) - t0).toBe(6 * 60 * MIN);
    expect(b.fail('c1', t0) - t0).toBe(6 * 60 * MIN); // teto
    expect(b.failures('c1')).toBe(5);
    expect(SYNC_BACKOFF_STEPS_MS).toHaveLength(4);
    b.succeed('c1');
    expect(b.failures('c1')).toBe(0);
    expect(b.nextAt('c1')).toBeNull();
    expect(b.fail('c1', t0) - t0).toBe(5 * MIN); // recomeça do 1º degrau
  });

  it('allows: falso até nextAt, verdadeiro depois; conexões independentes', () => {
    const b = new SyncBackoff();
    const t0 = 5_000_000;
    const next = b.fail('a', t0);
    expect(b.allows('a', t0 + 4 * MIN)).toBe(false);
    expect(b.allows('a', next)).toBe(true);
    expect(b.allows('b', t0)).toBe(true);
  });
});

describe('MetaSyncService.tickSync com backoff', () => {
  function service(conns: { id: string; workspaceId: string; connectedById: string }[]) {
    const prisma = {
      metaConnection: { findMany: jest.fn().mockResolvedValue(conns), update: jest.fn() },
      job: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new MetaSyncService(prisma as never, { metaSyncEveryHours: 6, metaMode: 'mock' } as never, {} as never, {} as never, {} as never);
    const kick = jest.spyOn(svc, 'kick').mockResolvedValue({} as never);
    return { svc, kick };
  }

  it('conexão em backoff é pulada; depois do prazo volta; sucesso libera na hora', async () => {
    const now = 10_000_000;
    const { svc, kick } = service([{ id: 'c1', workspaceId: 'w1', connectedById: 'u1' }, { id: 'c2', workspaceId: 'w2', connectedById: 'u2' }]);
    svc.backoff.fail('c1', now);
    expect(await svc.tickSync(now)).toBe(1);
    expect(kick).toHaveBeenCalledTimes(1);
    expect(kick.mock.calls[0][0].id).toBe('c2');
    kick.mockClear();
    expect(await svc.tickSync(now + 5 * MIN)).toBe(2); // 5 min depois: c1 volta
    kick.mockClear();
    svc.backoff.fail('c1', now);
    svc.backoff.succeed('c1');
    expect(await svc.tickSync(now)).toBe(2);
  });
});

describe('MetaModeGuard', () => {
  it('off = 503 META_NOT_CONFIGURED { reason: off }; mock/live passam', () => {
    expect(() => new MetaModeGuard({ metaMode: 'off' } as never).canActivate()).toThrow(AppException);
    try {
      new MetaModeGuard({ metaMode: 'off' } as never).canActivate();
    } catch (e) {
      expect(e).toBeInstanceOf(AppException);
      expect((e as AppException).code).toBe('META_NOT_CONFIGURED');
      expect((e as AppException).body()).toMatchObject({ code: 'META_NOT_CONFIGURED', details: { reason: 'off' } });
    }
    expect(new MetaModeGuard({ metaMode: 'mock' } as never).canActivate()).toBe(true);
    expect(new MetaModeGuard({ metaMode: 'live' } as never).canActivate()).toBe(true);
  });
});
