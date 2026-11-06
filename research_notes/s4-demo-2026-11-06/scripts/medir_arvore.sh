#!/bin/bash
# Uso: medir_arvore.sh <saida.txt> <comando...>: roda o comando e amostra a RSS da árvore inteira (node + Chrome + compositor + ffmpeg) a cada 0,5 s.
out=$1; shift
S=$(date +%s.%N 2>/dev/null || python3 -c 'import time;print(time.time())')
"$@" > "$out.log" 2>&1 &
pid=$!; pico=0
arvore(){ local p=$1; echo $p; for f in $(pgrep -P $p 2>/dev/null); do arvore $f; done; }
while kill -0 $pid 2>/dev/null; do
  ps=$(arvore $pid | tr '\n' ','); ps=${ps%,}
  r=$(ps -o rss= -p "$ps" 2>/dev/null | awk '{s+=$1}END{print s+0}')
  [ "$r" -gt "$pico" ] && pico=$r
  sleep 0.5
done
wait $pid; c=$?
E2=$(python3 -c 'import time;print(time.time())')
echo "saida=$c pico_arvore_MB=$((pico/1024))" | tee "$out"
