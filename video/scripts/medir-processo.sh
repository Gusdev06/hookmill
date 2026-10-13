#!/usr/bin/env bash
# Mede tempo e pico de memória (soma do RSS da árvore de processos) de qualquer comando.
# Uso: video/scripts/medir-processo.sh <rótulo> <comando...>
set -uo pipefail
ROTULO="$1"; shift
MEM="/tmp/maquina-medida-${ROTULO}.mem"; : > "$MEM"
inicio=$(date +%s)
"$@" &
PID=$!
pico=0; detalhe=""
arvore() { local p=$1; echo "$p"; for c in $(pgrep -P "$p" 2>/dev/null); do arvore "$c"; done; }
while kill -0 "$PID" 2>/dev/null; do
  pids=$(arvore "$PID" | tr '\n' ',' | sed 's/,$//')
  kb=$(ps -o rss= -p "$pids" 2>/dev/null | awk '{s+=$1} END {print s+0}')
  echo "$(( $(date +%s) - inicio )) $((kb/1024))" >> "$MEM"
  if [ "$kb" -gt "$pico" ]; then
    pico=$kb
    detalhe=$(ps -o rss=,comm= -p "$pids" 2>/dev/null | awk '{n=$2; sub(/.*\//,"",n); m[n]+=$1} END {for (k in m) printf "%s=%dMB ", k, m[k]/1024}')
  fi
  sleep 0.5
done
wait "$PID"; status=$?
echo "[$ROTULO] status=$status tempo_s=$(( $(date +%s) - inicio )) pico_rss_mb=$((pico/1024)) | $detalhe"
