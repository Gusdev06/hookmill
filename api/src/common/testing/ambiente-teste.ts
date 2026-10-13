// Banco e bucket de TESTE dos specs da api (10/10). Antes, os *.int.spec.ts usavam o banco do api/.env, o `maquina`, que
// tem os dados do Gusta e a mesma fila de render da API LIVE na 3001. Agora o jest.setup-env força o `maquina_test` local
// e o bucket de teste, e o PrismaService confere o banco de verdade (current_database) ao subir dentro do Jest.
// Mesmo banco e bucket do e2e do QA (testes/harness/env.ts): não rode os dois ao mesmo tempo (o harness faz TRUNCATE).

export const BANCO_DE_TESTE = 'maquina_test';
export const BUCKET_DE_TESTE = 'maquina-anuncios-test';
const LOCAIS = ['localhost', '127.0.0.1'];

const parse = (url: string | undefined): URL | null => {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

export const ehLocal = (url: string | undefined): boolean => {
  const u = parse(url);
  return !!u && LOCAIS.includes(u.hostname);
};

/** Nome do banco da URL (sem a barra e sem query). */
export function nomeDoBanco(url: string | undefined): string | null {
  const u = parse(url);
  return u ? decodeURIComponent(u.pathname.replace(/^\//, '')) || null : null;
}

/**
 * URL do banco de teste a partir da URL de dev: mesmo host, porta, credencial e query; só o banco vira `maquina_test`.
 * Fora de localhost (ou URL inválida) = '' : os int specs pulam e nada conecta num banco remoto.
 */
export function urlDoBancoDeTeste(url: string | undefined): string {
  const u = parse(url);
  if (!u || !LOCAIS.includes(u.hostname)) return '';
  u.pathname = `/${BANCO_DE_TESTE}`;
  return u.toString();
}

/** Trava: falha alto se o banco não for o de teste (ex.: o `maquina` do dev). */
export function exigirBancoDeTeste(banco: string | null | undefined, onde: string): void {
  if (banco !== BANCO_DE_TESTE) {
    throw new Error(`[api-test] BLOQUEADO (${onde}): banco "${banco}". Os testes da api só rodam no ${BANCO_DE_TESTE} local; o maquina é do dev e da API LIVE.`);
  }
}

/** Trava do storage: só o bucket de teste. */
export function exigirBucketDeTeste(bucket: string | undefined, onde: string): void {
  if (bucket !== BUCKET_DE_TESTE) throw new Error(`[api-test] BLOQUEADO (${onde}): bucket "${bucket}". Os testes da api só usam o ${BUCKET_DE_TESTE}.`);
}
