#!/usr/bin/env bash
# Aceite (a) do F1 do editor (docs/contratos/editor-v1.md §3.4/§10): as 7 peças com doc nulo, render antes × depois.
# Uso: scripts/editor-f1/render-aceite.sh <rotulo>   (ex.: antes | depois). Saída: out/f1-<rotulo>/<peca>.mp4
# Bundle uma vez (o código fica congelado durante os 7 renders), mesmos parâmetros do remotion.config.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."
R="$1"; CONC="${2:-3}"; OUT="out/f1-$R"; BUN="out/f1-bundle-$R"
rm -rf "$OUT" "$BUN"; mkdir -p "$OUT"
npx remotion bundle src/index.ts --out-dir="$BUN" --log=error > /dev/null
for c in Amostra-clean-9x16 Amostra-bold-9x16 Amostra-headline-9x16 Amostra-bold-4x5 Amostra-headline-1x1; do
  s=$(date +%s); npx remotion render "$BUN" "$c" "$OUT/$c.mp4" --concurrency="$CONC" --log=error; echo "$c $(( $(date +%s) - s ))s"
done
for p in real-scenes real-take; do
  s=$(date +%s); npx remotion render "$BUN" Criativo "$OUT/$p.mp4" --props="scripts/editor-f1/$p.json" --concurrency="$CONC" --log=error; echo "$p $(( $(date +%s) - s ))s"
done
