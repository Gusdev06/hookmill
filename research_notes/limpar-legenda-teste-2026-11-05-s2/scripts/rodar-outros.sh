#!/bin/bash
# rodar-outros.sh — 02 e 05: melhores e mais simples, escolhidas depois de olhar a matriz do 13. Rode dentro de work/, com PYTHONPATH=../scripts.
for v in 02 05; do
  if [ $v = 05 ]; then w="2 14"; else w="14 26"; fi
  for c in "E2 W1 tr" "E2 W2 tr" "E1 W1 tr" "E0 W3 tr" "E2 W3 lo" "E2 W1 cu"; do
    set -- $c; echo "$v $1 $2 $3 ../videos/$v-$1-$2-$3.mp4 $w"
  done
done | xargs -P 4 -L 1 python3 ../scripts/escrever.py
