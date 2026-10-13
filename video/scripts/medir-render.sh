#!/usr/bin/env bash
# Render de amostra pelo CLI do Remotion medindo tempo e pico de memória (soma do RSS de node + Chrome + ffmpeg).
# Uso: scripts/medir-render.sh <composicao> [concurrency]   ex.: scripts/medir-render.sh Amostra-bold-9x16 2
set -uo pipefail   # sem -e: o processo some no meio da amostragem
cd "$(dirname "$0")/.."
COMP="${1:-Amostra-clean-9x16}"; CONC="${2:-2}"; shift $(( $# > 2 ? 2 : $# )); EXTRA=("$@")
OUT="out/${COMP}-c${CONC}.mp4"; LOG="out/${COMP}-c${CONC}.log"
mkdir -p out; : > "out/${COMP}-c${CONC}.mem"
inicio=$(date +%s)
npx remotion render "$COMP" "$OUT" --concurrency="$CONC" --log=info "${EXTRA[@]+"${EXTRA[@]}"}" > "$LOG" 2>&1 &
PID=$!
pico=0
arvore() { local p=$1; echo "$p"; for c in $(pgrep -P "$p" 2>/dev/null); do arvore "$c"; done; }
while kill -0 "$PID" 2>/dev/null; do
  pids=$(arvore "$PID" | tr '\n' ',' | sed 's/,$//')
  kb=$(ps -o rss= -p "$pids" 2>/dev/null | awk '{s+=$1} END {print s+0}')
  if [ "$kb" -gt "$pico" ]; then
    pico=$kb
    ps -o rss=,comm= -p "$pids" 2>/dev/null | awk '{n=$2; sub(/.*\//,"",n); m[n]+=$1} END {for (k in m) printf "%s=%dMB ", k, m[k]/1024}' > "out/${COMP}-c${CONC}.pico" || true
  fi
  echo "$(( $(date +%s) - inicio )) $((kb/1024)) $(grep -o 'Rendered [0-9]*' "$LOG" | tail -1)" >> "out/${COMP}-c${CONC}.mem"
  sleep 0.5
done
wait "$PID"; status=$?
fim=$(date +%s)
echo "pico por processo: $(cat "out/${COMP}-c${CONC}.pico")"
echo "composicao=$COMP concurrency=$CONC status=$status tempo_s=$((fim-inicio)) pico_rss_mb=$((pico/1024)) saida=$OUT"
