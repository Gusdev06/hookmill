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

  it('DATABASE_URL/DIRECT_URL = banco de teste local (maquina_test ou maquina_<x>_test via TEST_DATABASE_URL); bucket de teste', () => {
    const url = process.env.DATABASE_URL ?? '';
    if (url) {
      expect(t.ehLocal(url)).toBe(true);
      expect(t.ehBancoDeTeste(t.nomeDoBanco(url))).toBe(true);
      expect(t.bancoDeTesteAtivo()).toBe(t.nomeDoBanco(url));
      // TEST_DATABASE_URL explícita manda (ex.: maquina_previas_test do worktree with-ai-previas)
      if (process.env.TEST_DATABASE_URL) expect(url).toBe(process.env.TEST_DATABASE_URL);
    }
    expect(process.env.DIRECT_URL).toBe(url);
    expect(process.env.STORAGE_BUCKET).toBe('maquina-anuncios-test');
  });

  it('troca só o nome do banco; remoto ou inválido vira vazio', () => {
    expect(t.urlDoBancoDeTeste('postgresql://u:p@localhost:5433/maquina?schema=public')).toBe('postgresql://u:p@localhost:5433/maquina_test?schema=public');
    expect(t.urlDoBancoDeTeste('postgresql://u:p@127.0.0.1/maquina')).toBe('postgresql://u:p@127.0.0.1/maquina_test');
    // B0 (07/11): cada worktree deriva o próprio banco de teste; nunca cai no maquina_test de outra frente
    expect(t.urlDoBancoDeTeste('postgresql://u:p@localhost:5433/maquina_previas?schema=public')).toBe('postgresql://u:p@localhost:5433/maquina_previas_test?schema=public');
    expect(t.urlDoBancoDeTeste('postgresql://u:p@localhost:5433/maquina_previas_test')).toBe('postgresql://u:p@localhost:5433/maquina_previas_test');
    expect(t.urlDoBancoDeTeste('postgresql://u:p@localhost:5433/postgres')).toBe('postgresql://u:p@localhost:5433/maquina_test');
    expect(t.urlDoBancoDeTeste('postgresql://u:p@db.supabase.co:5432/postgres')).toBe('');
    expect(t.urlDoBancoDeTeste('lixo')).toBe('');
    expect(t.urlDoBancoDeTeste(undefined)).toBe('');
  });

  it('falha alto no maquina (ou em qualquer banco que não seja o de teste)', () => {
    expect(() => t.exigirBancoDeTeste('maquina', 'x')).toThrow(/BLOQUEADO/);
    expect(() => t.exigirBancoDeTeste(null, 'x')).toThrow(/BLOQUEADO/);
    expect(() => t.exigirBancoDeTeste('maquina_test', 'x')).not.toThrow();
    expect(() => t.exigirBancoDeTeste('maquina_previas_test', 'x')).not.toThrow();
    // sem sufixo _test, prefixo errado ou nome com lixo = bloqueado
    for (const banco of ['maquina_previas', 'postgres', 'producao_test', 'maquina_test_old', 'maquina__test', 'maquina_Previas_test', 'x_maquina_test', '']) {
      expect(() => t.exigirBancoDeTeste(banco, 'x')).toThrow(/BLOQUEADO/);
    }
    expect(() => t.exigirBucketDeTeste('maquina-anuncios', 'x')).toThrow(/BLOQUEADO/);
  });
});
