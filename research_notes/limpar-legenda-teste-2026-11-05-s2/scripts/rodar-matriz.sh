#!/bin/bash
# rodar-matriz.sh — matriz completa no 13 (pior caso medido) + 3 combinações sem apagar (E0). Rode dentro de work/, com PYTHONPATH=../scripts.
# Antes-depois de 12 s (t=3 a 15: pega o fim da igreja, fundo em movimento, e o rosto); a medida é sempre no vídeo inteiro. 4 processos em paralelo.
JANELA="3 15"
{
  for E in E1 E2; do for W in W1 W2 W3; do for T in tr cu lo; do echo "13 $E $W $T ../videos/13-$E-$W-$T.mp4 $JANELA"; done; done; done
  for T in tr cu lo; do echo "13 E0 W3 $T ../videos/13-E0-W3-$T.mp4 $JANELA"; done
} | xargs -P 4 -L 1 python3 ../scripts/escrever.py
