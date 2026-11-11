#!/usr/bin/env bash
# T1 (templates-ia-previas-v1 §9), 09/11/2026: API própria do worktree em LIVE na 3161, banco maquina_previas.
# Chaves pagas lidas do api/.env do checkout principal direto pro ambiente do processo (nada gravado em arquivo novo).
# Uso: bash t1-api.sh on|off
set -euo pipefail
W=/data/cerebros/gusta/projects/maquina-anuncios-wt-previas
R=$W/reports/templates-ia-previas-2026-11-09
PIDF=$R/api.pid
case "${1:-}" in
  off) [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null; pkill -f "api-t1/dist/main.js" 2>/dev/null || true; rm -f "$PIDF"; echo off; exit 0 ;;
  on) ;;
  *) echo "uso: on|off"; exit 1 ;;
esac
set -a
# shellcheck disable=SC1090
source <(grep -E '^(ANTHROPIC_API_KEY|WAVESPEED_API_KEY|HF_API_KEY_ID|HF_API_KEY_SECRET)=' /data/cerebros/gusta/projects/maquina-anuncios/api/.env | sed -E 's/[[:space:]]+#.*$//')
PORT=3161
PUBLIC_API_URL=http://localhost:3161
DATABASE_URL='postgresql://maquina:maquina@localhost:5433/maquina_previas?schema=public'
DIRECT_URL="$DATABASE_URL"
INTEGRACOES_MODE=live
WAVESPEED_WEBHOOKS=off
RENDER_IMPL=remotion
ANALYZE_IMPL=local
TEST_MODE=off
AI_PREVIEWS=on
AI_TEMPLATES_ENABLED=on
STORAGE_ENDPOINT=http://localhost:19000
set +a
# build próprio (não mexe no api/dist nem no build do QA)
cd "$W/api"
mkdir -p "$W/testes/.cache/api-t1"
ln -sfn ../../../api/src "$W/testes/.cache/api-t1/src"
node "$(node -p "require.resolve('typescript/bin/tsc')")" -p tsconfig.build.json --outDir "$W/testes/.cache/api-t1/dist" --tsBuildInfoFile "$W/testes/.cache/api-t1/build.tsbuildinfo"
node -e "const v=require('./package.json').version;require('fs').writeFileSync('$W/testes/.cache/api-t1/package.json',JSON.stringify({private:true,type:'commonjs',version:v}))"
nohup node --enable-source-maps "$W/testes/.cache/api-t1/dist/main.js" > "$R/api.log" 2>&1 &
echo $! > "$PIDF"
for i in $(seq 1 60); do curl -sf localhost:3161/api/v1/health >/dev/null && { echo "no ar (pid $(cat "$PIDF"))"; exit 0; }; sleep 2; done
echo "não subiu"; tail -40 "$R/api.log"; exit 1
