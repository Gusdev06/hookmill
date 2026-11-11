// Banco e bucket de TESTE dos specs da api (10/10). Antes, os *.int.spec.ts usavam o banco do api/.env, o `maquina`, que
// tem os dados do Gusta e a mesma fila de render da API LIVE na 3001. Agora o jest.setup-env força o `maquina_test` local
// e o bucket de teste, e o PrismaService confere o banco de verdade (current_database) ao subir dentro do Jest.
// Mesmo banco e bucket do e2e do QA (testes/harness/env.ts): não rode os dois ao mesmo tempo (o harness faz TRUNCATE).

// 07/11 (templates-ia-previas-v1 §13 B0): cada frente tem o próprio banco de teste `maquina_<x>_test` (ex.: o worktree
// with-ai-previas usa `maquina_previas_test`), pra não disputar o `maquina_test` da F1b. A trava continua: só nome
// `maquina_test` ou `maquina_<x>_test` e só host local (jest.setup-env); o PrismaService confere o current_database.
export const BANCO_DE_TESTE = 'maquina_test';
/** Nomes aceitos como banco de teste: `maquina_test` ou `maquina_<x>_test` (x = minúsculas/dígitos). */
const PADRAO_BANCO_DE_TESTE = /^maquina(?:_[a-z0-9]+)?_test$/;
/** Banco de dev de onde se deriva o de teste: `maquina` → `maquina_test`, `maquina_<x>` → `maquina_<x>_test`. */
const PADRAO_BANCO_DE_DEV = /^maquina(?:_[a-z0-9]+)?$/;
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

/** `maquina_test` ou `maquina_<x>_test`. Qualquer outro nome (o `maquina` do dev, `postgres`, `maquina_previas`) = false. */
export function ehBancoDeTeste(banco: string | null | undefined): boolean {
  return !!banco && PADRAO_BANCO_DE_TESTE.test(banco);
}

/**
 * URL do banco de teste a partir da URL de dev: mesmo host, porta, credencial e query; só o banco muda.
 * `maquina` → `maquina_test`; `maquina_<x>` → `maquina_<x>_test` (cada worktree no seu); já de teste = mantém;
 * outro nome → `maquina_test`. Fora de localhost (ou URL inválida) = '' : nada conecta num banco remoto.
 */
export function urlDoBancoDeTeste(url: string | undefined): string {
  const u = parse(url);
  if (!u || !LOCAIS.includes(u.hostname)) return '';
  const atual = nomeDoBanco(url) ?? '';
  const banco = ehBancoDeTeste(atual) ? atual : PADRAO_BANCO_DE_DEV.test(atual) ? `${atual}_test` : BANCO_DE_TESTE;
  u.pathname = `/${banco}`;
  return u.toString();
}

/** Banco de teste em uso no processo do Jest (o jest.setup-env já validou nome e host). Pros int specs conferirem o current_database. */
export function bancoDeTesteAtivo(): string | null {
  return nomeDoBanco(process.env.DATABASE_URL);
}

/** Trava: falha alto se o banco não for de teste (ex.: o `maquina` do dev ou o `maquina_previas` do worktree). */
export function exigirBancoDeTeste(banco: string | null | undefined, onde: string): void {
  if (!ehBancoDeTeste(banco)) {
    throw new Error(`[api-test] BLOQUEADO (${onde}): banco "${banco}". Os testes da api só rodam num banco local maquina_test ou maquina_<x>_test; o maquina é do dev e da API LIVE.`);
  }
}

/** Trava do storage: só o bucket de teste. */
export function exigirBucketDeTeste(bucket: string | undefined, onde: string): void {
  if (bucket !== BUCKET_DE_TESTE) throw new Error(`[api-test] BLOQUEADO (${onde}): bucket "${bucket}". Os testes da api só usam o ${BUCKET_DE_TESTE}.`);
}
