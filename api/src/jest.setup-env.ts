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

// Banco e bucket de TESTE (10/10): os *.int.spec.ts nunca tocam o `maquina` (dados do Gusta + fila da API LIVE na 3001).
// Sempre o `maquina_test` local (mesmo host, porta e credencial do api/.env; só troca o banco). Banco ou storage fora de
// localhost = DATABASE_URL vazio: os int specs pulam e nada conecta em servidor remoto.
const arquivo = join(__dirname, '..', '.env');
const doArquivo: Record<string, string> = existsSync(arquivo) ? parse(readFileSync(arquivo)) : {};
const storageEndpoint = process.env.STORAGE_ENDPOINT || doArquivo.STORAGE_ENDPOINT;
const urlDeTeste = ehLocal(storageEndpoint) ? urlDoBancoDeTeste(process.env.DATABASE_URL || doArquivo.DATABASE_URL) : '';
if (urlDeTeste) exigirBancoDeTeste(nomeDoBanco(urlDeTeste), 'jest.setup-env');
process.env.DATABASE_URL = urlDeTeste;
process.env.DIRECT_URL = urlDeTeste;
process.env.STORAGE_BUCKET = BUCKET_DE_TESTE;
