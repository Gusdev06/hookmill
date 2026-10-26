// Gusta 25/10: dado de anúncio só com a conexão Meta conectada e saudável (mesma regra do web/meta-gate.tsx).
import type { MetaConnection } from '@prisma/client';
import { assertHealthy, blockingCheckOf, metaSaudavel } from './comum';

const conn = (over: Partial<MetaConnection> = {}) => ({ status: 'ACTIVE', tokenCiphertext: 'x', adAccountId: 'act_1', lastHealth: { checks: [{ key: 'token', level: 'ok' }] }, ...over }) as unknown as MetaConnection;
const health = (key: string, level = 'bad') => ({ checks: [{ key: 'token', level: 'ok' }, { key, level }] });
const codeOf = (f: () => unknown) => { try { f(); return null; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } };

describe('gate da Meta no servidor', () => {
  it('saudável passa; sem conexão, desconectada, token inválido e checagem bloqueante = erro que o web já trata', () => {
    expect(assertHealthy(conn())).toBeTruthy();
    expect(codeOf(() => assertHealthy(null))).toBe('META_NOT_CONNECTED');
    expect(codeOf(() => assertHealthy(conn({ status: 'DISCONNECTED' } as never)))).toBe('META_NOT_CONNECTED');
    expect(codeOf(() => assertHealthy(conn({ status: 'TOKEN_INVALID' } as never)))).toBe('META_TOKEN_INVALID');
    expect(codeOf(() => assertHealthy(conn({ lastHealth: health('token') } as never)))).toBe('META_TOKEN_INVALID');
    expect(codeOf(() => assertHealthy(conn({ lastHealth: health('scopes') } as never)))).toBe('META_PERMISSION');
    expect(codeOf(() => assertHealthy(conn({ lastHealth: health('account') } as never)))).toBe('META_ACCOUNT_UNUSABLE');
    // aviso (warn) ou checagem que não trava (ex. pixel) não bloqueia
    expect(codeOf(() => assertHealthy(conn({ lastHealth: health('scopes', 'warn') } as never)))).toBeNull();
    expect(codeOf(() => assertHealthy(conn({ lastHealth: health('pixel') } as never)))).toBeNull();
    expect(blockingCheckOf(null)).toBeNull();
  });
  it('Brain: só ACTIVE + conta + sem checagem bloqueante', () => {
    expect(metaSaudavel(conn())).toBe(true);
    expect(metaSaudavel(conn({ lastHealth: health('scopes') } as never))).toBe(false);
    expect(metaSaudavel(conn({ status: 'TOKEN_INVALID' } as never))).toBe(false);
    expect(metaSaudavel(conn({ adAccountId: null } as never))).toBe(false);
    expect(metaSaudavel(null)).toBe(false);
  });
});
