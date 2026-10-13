#!/usr/bin/env bash
# Miniaturas dos templates (public/thumbnails/<id>.png) a partir das amostras locais.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/thumbnails
for t in clean bold headline; do
  npx remotion still "Amostra-$t-9x16" "public/thumbnails/$t.png" --frame=50 --scale=0.25 --image-format=png
done
