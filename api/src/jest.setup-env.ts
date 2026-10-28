// Roda antes de CADA arquivo de teste (jest.setupFiles), antes de qualquer import do spec.
// Garante que nenhum teste sobe integração LIVE nem enxerga chave paga, mesmo com api/.env em `live`:
// o dotenv/config dos specs não sobrescreve variável já definida (string vazia conta como definida).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { BUCKET_DE_TESTE, ehLocal, exigirBancoDeTeste, nomeDoBanco, urlDoBancoDeTeste } from './common/testing/ambiente-teste';

process.env.NODE_ENV = 'test';
process.env.INTEGRACOES_MODE = 'mock';
process.env.AD_LIBRARY_MODE = 'mock';
for (const k of ['ANTHROPIC_API_KEY', 'WAVESPEED_API_KEY', 'HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'APIFY_TOKEN', 'WAVESPEED_WEBHOOK_SECRET']) {
  process.env[k] = '';
}

// Banco e storage de TESTE (10/10; 27/10 sem pulo silencioso). Os *.int.spec.ts nunca tocam o `maquina` (dados do Gusta +
// fila da API LIVE na 3001) nem o storage remoto do api/.env (Supabase). Sempre o `maquina_test` local (mesmo host, porta e
// credencial do api/.env quando ele é local; senão TEST_DATABASE_URL ou o padrão do QA) e o MinIO local (TEST_STORAGE_* ou
// o padrão abaixo), seja qual for o storage do api/.env. Antes, storage remoto no .env zerava o DATABASE_URL e as 18 int
// specs pulavam com exit 0 (verde falso). Agora: storage/banco fora de localhost = erro, nunca pulo.
const arquivo = join(__dirname, '..', '.env');
const doArquivo: Record<string, string> = existsSync(arquivo) ? parse(readFileSync(arquivo)) : {};
const falhar = (msg: string): never => {
  throw new Error(`[api-test] BLOQUEADO (jest.setup-env): ${msg}`);
};

// storage: env do PROCESSO local vale (ex.: rodar com STORAGE_ENDPOINT=http://localhost:9000 na mão); o do api/.env é ignorado.
const storageDoProcesso = process.env.STORAGE_ENDPOINT;
if (storageDoProcesso && !ehLocal(storageDoProcesso)) falhar(`STORAGE_ENDPOINT "${storageDoProcesso}" não é local. Os testes só usam o MinIO local.`);
const storageLocal = !!storageDoProcesso;
process.env.STORAGE_ENDPOINT = storageDoProcesso || process.env.TEST_STORAGE_ENDPOINT || 'http://localhost:9000';
if (!ehLocal(process.env.STORAGE_ENDPOINT)) falhar(`TEST_STORAGE_ENDPOINT "${process.env.STORAGE_ENDPOINT}" não é local.`);
// credencial: a do processo (se veio junto com o endpoint local), senão TEST_STORAGE_*, senão a do MinIO do docker-compose
const doProcesso = (k: string) => (storageLocal ? process.env[k] : undefined);
process.env.STORAGE_ACCESS_KEY_ID = doProcesso('STORAGE_ACCESS_KEY_ID') || process.env.TEST_STORAGE_ACCESS_KEY_ID || 'maquina';
process.env.STORAGE_SECRET_ACCESS_KEY = doProcesso('STORAGE_SECRET_ACCESS_KEY') || process.env.TEST_STORAGE_SECRET_ACCESS_KEY || 'maquina-dev-secret';
process.env.STORAGE_REGION = doProcesso('STORAGE_REGION') || process.env.TEST_STORAGE_REGION || 'us-east-1';
process.env.STORAGE_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_BUCKET = BUCKET_DE_TESTE;

// banco: sempre o maquina_test em localhost; nunca vazio (vazio = int specs pulando em silêncio)
const urlDeTeste =
  process.env.TEST_DATABASE_URL ||
  urlDoBancoDeTeste(process.env.DATABASE_URL || doArquivo.DATABASE_URL) ||
  'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public';
if (!ehLocal(urlDeTeste)) falhar('TEST_DATABASE_URL fora de localhost.');
exigirBancoDeTeste(nomeDoBanco(urlDeTeste), 'jest.setup-env');
process.env.DATABASE_URL = urlDeTeste;
process.env.DIRECT_URL = urlDeTeste;

// render, Meta e b-roll: nada live e nenhuma credencial paga herdada do api/.env (RENDER_IMPL=lambda + chave AWS,
// META_MODE=live, PEXELS). Spec que precisa de outro modo seta no topo do próprio arquivo (roda depois deste setup).
// Opt-in explícito pra herdar do api/.env: API_TEST_PERMITIR_LIVE=1 (nunca na suíte normal nem no QA).
if (process.env.API_TEST_PERMITIR_LIVE !== '1') {
  process.env.RENDER_IMPL = 'fake';
  process.env.META_MODE = 'mock';
  for (const k of [
    'RENDER_LAMBDA_KINDS', 'REMOTION_AWS_ACCESS_KEY_ID', 'REMOTION_AWS_SECRET_ACCESS_KEY', 'REMOTION_LAMBDA_FUNCTION', 'REMOTION_SERVE_URL',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'PEXELS_API_KEY',
  ]) {
    process.env[k] = '';
  }
}
