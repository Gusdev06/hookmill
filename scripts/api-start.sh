#!/bin/sh
# Start da api na imagem Docker (api/Dockerfile). Dono: maquina-arquiteto. Runbook: docs/deploy.md.
# 1) confere as pastas de trabalho (volume /data), 2) aplica as migrações pela DIRECT_URL, 3) sobe a API.
set -eu

for v in DATABASE_URL DIRECT_URL JWT_ACCESS_SECRET STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_ACCESS_KEY_ID STORAGE_SECRET_ACCESS_KEY PUBLIC_API_URL WEB_ORIGIN; do
  eval "val=\${$v:-}"
  if [ -z "$val" ]; then echo "start: variável $v vazia (lista em docs/deploy.md)" >&2; exit 1; fi
done

mkdir -p "$RENDER_TMP_DIR" "$TMPDIR"
for d in "$RENDER_TMP_DIR" "$TMPDIR"; do
  if ! touch "$d/.escrita" 2>/dev/null; then
    echo "start: sem permissão de escrita em $d (o volume tem que ser do usuário node, uid 1000)" >&2; exit 1
  fi
  rm -f "$d/.escrita"
done

# prisma migrate deploy usa a directUrl do schema (DIRECT_URL = pooler em modo sessão, porta 5432).
# Idempotente; com advisory lock, então dois containers subindo juntos não aplicam a mesma migração duas vezes.
node_modules/.bin/prisma migrate deploy --schema api/prisma/schema.prisma

exec node api/dist/main.js
