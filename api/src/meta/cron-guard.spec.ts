// Incidente 22/10: uma API em META_MODE=mock no banco compartilhado rodou o cron da Meta na conexão REAL do Gusta e a
// deixou TOKEN_INVALID. Regras: (1) crons só em live; (2) fora de live nunca tocar conexão com metaUserId ≠ mock_user;
// (3) META_CRON=off desliga os crons em qualquer modo.
import { ConfigService } from '@nestjs/config';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { MOCK_META_USER, isForeignToMode, markTokenInvalid, metaAuthOf, ownConnectionsWhere, tokenKeyOf } from './comum';
import { cifrar } from '../integracoes';
import { MetaSyncService } from './sync.service';

const cfg = (env: Record<string, string>) => new AppConfig(new ConfigService(env));

describe('(1)+(3) metaCronEnabled', () => {
  it('só META_MODE=live liga; META_CRON=off desliga em qualquer modo', () => {
    expect(cfg({ META_MODE: 'live' }).metaCronEnabled).toBe(true);
    expect(cfg({ META_MODE: 'live', META_CRON: 'OFF' }).metaCronEnabled).toBe(false);
    expect(cfg({ META_MODE: 'mock' }).metaCronEnabled).toBe(false);
    expect(cfg({}).metaCronEnabled).toBe(false); // padrão = mock
    expect(cfg({ META_MODE: 'off' }).metaCronEnabled).toBe(false);
    expect(cfg({ META_MODE: 'live', META_CRON: 'on' }).metaCronEnabled).toBe(true);
  });

  it('tick: mock e live+META_CRON=off não consultam nada; live consulta (sync e health)', async () => {
    const old = { ...process.env };
    process.env.NODE_ENV = 'development'; // o tick pula sozinho em test+BOOT_RECOVERY=off; aqui queremos a regra do modo
    try {
      for (const [env, runs] of [[{ META_MODE: 'mock' }, false], [{ META_MODE: 'off' }, false], [{ META_MODE: 'live', META_CRON: 'off' }, false], [{ META_MODE: 'live' }, true]] as const) {
        const prisma = { metaConnection: { findMany: jest.fn().mockResolvedValue([]) }, job: { findFirst: jest.fn() } };
        const config = cfg(env as Record<string, string>);
        const svc = new MetaSyncService(prisma as never, config, {} as never, {} as never, {} as never);
        await svc.tick();
        expect([env, prisma.metaConnection.findMany.mock.calls.length]).toEqual([env, runs ? 2 : 0]);
      }
    } finally {
      process.env = old;
    }
  });
});

describe('(2) fora de live, conexão real é intocável', () => {
  const real = { metaUserId: '10229876543', tokenCiphertext: null as string | null, status: 'ACTIVE' };
  const mock = { metaUserId: MOCK_META_USER, tokenCiphertext: null as string | null, status: 'ACTIVE' };

  it('isForeignToMode / ownConnectionsWhere', () => {
    expect(isForeignToMode(real, 'mock')).toBe(true);
    expect(isForeignToMode(real, 'off')).toBe(true);
    expect(isForeignToMode(real, 'live')).toBe(false);
    expect(isForeignToMode(mock, 'mock')).toBe(false);
    expect(ownConnectionsWhere('mock')).toEqual({ metaUserId: 'mock_user' });
    expect(ownConnectionsWhere('live')).toEqual({});
  });

  it('tickSync/tickHealth em mock filtram por metaUserId mock_user (defesa extra além do gate do tick)', async () => {
    const prisma = { metaConnection: { findMany: jest.fn().mockResolvedValue([]) }, job: { findFirst: jest.fn() } };
    const svc = new MetaSyncService(prisma as never, cfg({ META_MODE: 'mock' }), {} as never, {} as never, {} as never);
    await svc.tickSync();
    await svc.tickHealth();
    for (const call of prisma.metaConnection.findMany.mock.calls) expect(call[0].where.metaUserId).toBe('mock_user');
    const live = new MetaSyncService(prisma as never, cfg({ META_MODE: 'live' }), {} as never, {} as never, {} as never);
    prisma.metaConnection.findMany.mockClear();
    await live.tickSync();
    expect(prisma.metaConnection.findMany.mock.calls[0][0].where).not.toHaveProperty('metaUserId');
  });

  it('markTokenInvalid fora de live só casa conexão do mock; em live, qualquer uma', async () => {
    const old = process.env.META_MODE;
    const prisma = { metaConnection: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    try {
      process.env.META_MODE = 'mock';
      await markTokenInvalid(prisma as never, 'c1');
      expect(prisma.metaConnection.updateMany.mock.calls[0][0].where).toEqual({ id: 'c1', status: 'ACTIVE', metaUserId: 'mock_user' });
      process.env.META_MODE = 'live';
      await markTokenInvalid(prisma as never, 'c1');
      expect(prisma.metaConnection.updateMany.mock.calls[1][0].where).toEqual({ id: 'c1', status: 'ACTIVE' });
    } finally {
      process.env.META_MODE = old;
    }
  });

  it('metaAuthOf (gargalo de toda chamada à porta): mock + conexão real = 503 META_NOT_CONFIGURED, sem decifrar', () => {
    const mockCfg = cfg({ META_MODE: 'mock', JWT_ACCESS_SECRET: 's' });
    const key = tokenKeyOf(mockCfg);
    const tok = cifrar('mock', key);
    expect(() => metaAuthOf({ ...real, tokenCiphertext: tok } as never, mockCfg)).toThrow(AppException);
    try {
      metaAuthOf({ ...real, tokenCiphertext: tok } as never, mockCfg);
    } catch (e) {
      expect((e as AppException).code).toBe('META_NOT_CONFIGURED');
    }
    expect(metaAuthOf({ ...mock, tokenCiphertext: tok } as never, mockCfg)).toEqual({ accessToken: 'mock' });
    const liveCfg = cfg({ META_MODE: 'live', META_TOKEN_KEY: key });
    expect(metaAuthOf({ ...real, tokenCiphertext: tok } as never, liveCfg)).toEqual({ accessToken: 'mock' });
  });

  it('kick e startIfIdle em mock não abrem job pra conexão real', async () => {
    const jobs = { create: jest.fn() };
    const svc = new MetaSyncService({} as never, cfg({ META_MODE: 'mock' }), jobs as never, {} as never, {} as never);
    await expect(svc.kick(real as never, 'u', true)).rejects.toMatchObject({ code: 'META_NOT_CONFIGURED' });
    expect(await svc.startIfIdle(real as never, 'u')).toBeNull();
    expect(jobs.create).not.toHaveBeenCalled();
  });
});
