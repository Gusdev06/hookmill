#!/usr/bin/env bash
# Web do worktree with-ai-previas na 3236, falando com a API T1 (3161). Uso: bash t1-web.sh on|off
# Só mata o processo que este script subiu (grupo do pid salvo em web.pid).
W=/data/cerebros/gusta/projects/maquina-anuncios-wt-previas; R=$W/reports/templates-ia-previas-2026-11-09
[ -f $R/web.pid ] && kill -- -$(cat $R/web.pid) 2>/dev/null; rm -f $R/web.pid
[ "$1" = off ] && { echo off; exit 0; }
cd $W/web
grep -q TURBOPACK_ROOT next.config.ts || sed -i 's|  transpilePackages: \["@maquina/video"\],|  transpilePackages: ["@maquina/video"],\n  ...(process.env.TURBOPACK_ROOT \&\& { turbopack: { root: process.env.TURBOPACK_ROOT } }), // worktree: node_modules aponta pro checkout principal|' next.config.ts
grep -n TURBOPACK next.config.ts
rm -rf .next-t1
TURBOPACK_ROOT=/data/cerebros/gusta/projects NEXT_PUBLIC_API_URL=http://localhost:3161/api/v1 NEXT_PUBLIC_DEFAULT_LOCALE=pt NEXT_DIST_DIR=.next-t1 setsid nohup npx next dev --port 3236 -H 0.0.0.0 > $R/web.log 2>&1 < /dev/null &
echo $! > $R/web.pid
sleep 6; curl -s -o /dev/null -w "login %{http_code}\n" --max-time 180 localhost:3236/pt/login; grep -i error $R/web.log | head -5
