// Prova de que nenhum teste da api sobe integração LIVE, mesmo com api/.env em `live` e chaves reais.
import 'dotenv/config';
import { integracoesMode } from './integracoes';

describe('ambiente de teste (jest.setupFiles)', () => {
  it('modo das integrações é mock depois do dotenv/config', () => {
    expect(process.env.INTEGRACOES_MODE).toBe('mock');
    expect(integracoesMode()).toBe('mock');
  });

  it.each(['ANTHROPIC_API_KEY', 'WAVESPEED_API_KEY', 'HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'APIFY_TOKEN'])('%s fica vazia (dotenv não sobrescreve)', (k) => {
    expect(process.env[k]).toBe('');
  });
});

describe('banco e bucket de teste (jest.setupFiles, 10/10)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const t = require('./common/testing/ambiente-teste') as typeof import('./common/testing/ambiente-teste');

  it('DATABASE_URL/DIRECT_URL = maquina_test local (ou vazio fora de localhost); bucket de teste', () => {
    const url = process.env.DATABASE_URL ?? '';
    if (url) {
      expect(t.ehLocal(url)).toBe(true);
      expect(t.nomeDoBanco(url)).toBe('maquina_test');
    }
    expect(process.env.DIRECT_URL).toBe(url);
    expect(process.env.STORAGE_BUCKET).toBe('maquina-anuncios-test');
  });

  it('troca só o nome do banco; remoto ou inválido vira vazio', () => {
    expect(t.urlDoBancoDeTeste('postgresql://u:p@localhost:5433/maquina?schema=public')).toBe('postgresql://u:p@localhost:5433/maquina_test?schema=public');
    expect(t.urlDoBancoDeTeste('postgresql://u:p@127.0.0.1/maquina')).toBe('postgresql://u:p@127.0.0.1/maquina_test');
    expect(t.urlDoBancoDeTeste('postgresql://u:p@db.supabase.co:5432/postgres')).toBe('');
    expect(t.urlDoBancoDeTeste('lixo')).toBe('');
    expect(t.urlDoBancoDeTeste(undefined)).toBe('');
  });

  it('falha alto no maquina (ou em qualquer banco que não seja o de teste)', () => {
    expect(() => t.exigirBancoDeTeste('maquina', 'x')).toThrow(/BLOQUEADO/);
    expect(() => t.exigirBancoDeTeste(null, 'x')).toThrow(/BLOQUEADO/);
    expect(() => t.exigirBancoDeTeste('maquina_test', 'x')).not.toThrow();
    expect(() => t.exigirBucketDeTeste('maquina-anuncios', 'x')).toThrow(/BLOQUEADO/);
  });
});
