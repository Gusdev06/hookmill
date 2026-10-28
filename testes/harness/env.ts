// Ambiente dos testes + travas de segurança. Dono: maquina-qa.
// Regra: os testes só tocam o banco `maquina_test` local e o bucket de teste. Nunca `maquina` (dev), nunca produção.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TESTES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_DIR = resolve(TESTES_DIR, '..');
export const CACHE_DIR = join(TESTES_DIR, '.cache');

const envFile = join(TESTES_DIR, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.E2E_API_PORT ?? 3101);
const webPort = Number(process.env.E2E_WEB_PORT ?? 3210); // nunca 3000/3001 (dev do Gusta e dos outros agentes)

export const ENV = {
  webPort,
  webUrl: process.env.E2E_WEB_URL ?? `http://localhost:${webPort}`,
  comWeb: process.env.E2E_COM_WEB === '1',
  apiPort: port,
  apiUrl: process.env.E2E_API_URL ?? `http://localhost:${port}/api/v1`,
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public',
  storageBucket: process.env.E2E_STORAGE_BUCKET ?? 'maquina-anuncios-test',
  ownerEmail: process.env.E2E_OWNER_EMAIL ?? 'qa@teste.local',
  password: process.env.E2E_OWNER_PASSWORD ?? 'teste12345',
  // sem --watch: a API de teste não pode reiniciar no meio do teste quando o backend salva um arquivo em api/src.
  // 09/10: build PRÓPRIO em testes/.cache/api-qa (nunca api/dist: é o dist que a 3001 LIVE usa no `nest start --watch`)
  apiCmd: process.env.E2E_API_CMD ?? 'node testes/harness/api-qa.mjs',
  noApi: process.env.E2E_NO_API === '1',
  // editor F2d: render de verdade (Remotion local, CPU, US$ 0) só nos casos de não regressão e WYSIWYG
  renderReal: process.env.E2E_RENDER_REAL === '1',
};
/** Build da API do QA (harness/api-qa.mjs). */
export const QA_API_DIST = join(CACHE_DIR, 'api-qa', 'dist');

/** Trava: aborta se a URL do banco não for localhost E de um banco terminado em `_test`. */
export function guardTestDb(url: string = ENV.databaseUrl): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[qa] E2E_DATABASE_URL inválida: ${url}`);
  }
  const host = u.hostname;
  const db = u.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1'].includes(host)) {
    throw new Error(`[qa] BLOQUEADO: banco de teste fora de localhost (${host}). Testes nunca rodam em banco remoto.`);
  }
  if (!db.endsWith('_test')) {
    throw new Error(`[qa] BLOQUEADO: banco "${db}" não termina em _test. O banco de dev (maquina) e o de produção são intocáveis.`);
  }
}

/** Trava: a API dos testes é SEMPRE a que o Playwright sobe (porta própria, mock). Nunca a dev (3000/3001),
 *  nunca remota, nunca uma URL que aponte pra outra porta que não a do webServer. */
export function guardTestApi(url: string = ENV.apiUrl, port: number = ENV.apiPort): void {
  const u = new URL(url);
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error(`[qa] BLOQUEADO: API de teste fora de localhost (${u.hostname}).`);
  if ([3000, 3001].includes(port) || [3000, 3001].includes(Number(u.port))) throw new Error('[qa] BLOQUEADO: 3000/3001 são do dev (podem estar em live = dinheiro real).');
  if (Number(u.port) !== port) throw new Error(`[qa] BLOQUEADO: E2E_API_URL (${u.port}) não é a porta da API que o harness sobe (${port}).`);
}

/** Trava: o bucket dos testes tem que ser o de teste. */
export function guardTestBucket(bucket: string = ENV.storageBucket): void {
  if (!bucket.endsWith('-test')) throw new Error(`[qa] BLOQUEADO: bucket "${bucket}" não é de teste.`);
}

/** Env do web (Next dev) que o Playwright sobe pro fluxo no navegador: aponta pra API de teste, sem MSW. */
export function webTestEnv(): Record<string, string> {
  return {
    NEXT_PUBLIC_API_URL: ENV.apiUrl,
    NEXT_PUBLIC_API_MOCKING: 'disabled',
    NEXT_PUBLIC_DEFAULT_LOCALE: 'en',
    SESSION_COOKIE_SECRET: 'qa-cookie-secret-de-teste-0123456789abcdef',
    NEXT_TELEMETRY_DISABLED: '1',
    // 09/10: o dev do web (3000) trava web/.next/dev/lock; o do QA usa outro distDir (next.config lê NEXT_DIST_DIR; /.next-*/ é ignorado)
    NEXT_DIST_DIR: '.next-qa',
  };
}

/** Env injetado na API que o Playwright sobe pros testes. Process env ganha do api/.env no @nestjs/config. */
export function apiTestEnv(): Record<string, string> {
  guardTestDb();
  guardTestApi();
  guardTestBucket();
  return {
    NODE_ENV: 'test',
    PORT: String(ENV.apiPort),
    PUBLIC_API_URL: `http://localhost:${ENV.apiPort}`,
    WEB_ORIGIN: ENV.webUrl,
    DATABASE_URL: ENV.databaseUrl,
    DIRECT_URL: ENV.databaseUrl,
    JWT_ACCESS_SECRET: 'qa-segredo-de-teste-nao-usar-em-lugar-nenhum-0123456789abcdef0123',
    JWT_ACCESS_TTL: '15m',
    REFRESH_TTL_DAYS: '30',
    INVITE_TTL_DAYS: '7',
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: ENV.storageBucket,
    STORAGE_ACCESS_KEY_ID: 'maquina',
    STORAGE_SECRET_ACCESS_KEY: 'maquina-dev-secret',
    STORAGE_FORCE_PATH_STYLE: 'true',
    SIGNED_URL_TTL_SEC: '21600',
    // Nada pago: integrações sempre em mock e sem chave nenhuma.
    INTEGRACOES_MODE: 'mock',
    ANTHROPIC_API_KEY: '',
    WAVESPEED_API_KEY: '',
    WAVESPEED_WEBHOOK_SECRET: 'qa-webhook-secret',
    WAVESPEED_WEBHOOKS: 'off',
    RENDER_CONCURRENCY: '1',
    RENDER_TMP_DIR: '/tmp/maquina-render-test',
    DEFAULT_MONTHLY_SPEND_CAP_USD: '200',
    // Feature 2 (06/10). O api/.env do dev tem chaves reais (Higgsfield, e a Apify pode entrar): toda env que o
    // harness não define cai no api/.env, então as chaves pagas vão em branco aqui e a Ad Library fica em mock.
    AD_LIBRARY_MODE: 'mock',
    APIFY_TOKEN: '',
    HF_API_KEY_ID: '',
    HF_API_KEY_SECRET: '',
    UPLOAD_MODE: 'proxy',
    // variacao-auto-v1 §2 (13/10): limites da spec (500 MB, 4 s-3 min) com E2E_LIMITES_V2=1; sem ele, os da feature 2
    UPLOAD_MAX_BYTES: process.env.E2E_LIMITES_V2 === '1' ? '524288000' : '209715200',
    CHAMPION_MIN_SEC: process.env.E2E_LIMITES_V2 === '1' ? '4' : '5',
    CHAMPION_MAX_SEC: process.env.E2E_LIMITES_V2 === '1' ? '180' : '120',
    MEDIA_PROMPTS: 'v2',
    // incidente 22/10 (TIME.md): 2ª API nunca roda o cron da Meta nem fala com a Meta de verdade
    META_MODE: 'mock',
    META_CRON: 'off',
    // editor F2d: fake (ffmpeg sintético) por padrão; E2E_RENDER_REAL=1 = RemotionRenderService de verdade (local, grátis)
    RENDER_IMPL: ENV.renderReal ? 'remotion' : 'fake',
    // 27/10: com RENDER_IMPL=fake o remix-keep ainda vai pro Remotion LOCAL de verdade (edicao.service › portFor), e desde
    // 25/10 todo lote AUTO tem 3 HEADLINE (remix-keep): ~90 s de CPU por peça, lote de 5+ min. Fake por padrão;
    // E2E_REMIX_REAL=1 (ou E2E_RENDER_REAL=1) volta ao render real (grátis, local) pra conferir a HEADLINE de verdade.
    RENDER_REMIX_IMPL: ENV.renderReal || process.env.E2E_REMIX_REAL === '1' ? 'remotion' : 'fake',
    // 27/10: o api/.env do dev passou a ter RENDER_IMPL=lambda + credenciais AWS do Remotion Lambda, PEXELS_API_KEY e
    // META_MODE=live. Tudo que custa ou fala com fora vai em branco na API do QA (nada pago, regra 3 do TIME.md).
    RENDER_LAMBDA_KINDS: '',
    REMOTION_AWS_ACCESS_KEY_ID: '',
    REMOTION_AWS_SECRET_ACCESS_KEY: '',
    REMOTION_LAMBDA_FUNCTION: '',
    REMOTION_SERVE_URL: '',
    PEXELS_API_KEY: '',
    // META_APP_ID/SECRET ficam: o mock da Meta usa (sem eles o META_SYNC do mock falha; conferido no meta.int 27/10)
  };
}
