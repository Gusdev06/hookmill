#!/bin/bash
# resumo.sh — s2-resumo.mp4 (melhores) e s2-falhas.mp4 (piores trechos). Rode dentro de work/.
V=../videos; I=../inteiros
PAD="scale=1440:-2,pad=1440:1280:0:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p"
L=""; A=""; i=0
for c in "13-E2-W1-tr 3" "13-E2-W2-cu 3" "05-E2-W1-tr 3" "05-E0-W3-tr 3" ; do set -- $c
  A="$A -ss $2 -t 9 -i $V/$1.mp4"; L="$L[$i:v]$PAD[v$i];[$i:a]aresample=48000[a$i];"; i=$((i+1)); done
ffmpeg -v error -y $A -filter_complex "$L[v0][a0][v1][a1][v2][a2][v3][a3]concat=n=4:v=1:a=1[v][a]" -map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 128k ../s2-resumo.mp4
T=$(mktemp -d)
python3 ../scripts/escrever.py 05 E2 W1 tr $T/a.mp4 25 30 >/dev/null
python3 ../scripts/escrever.py 02 E2 W1 tr $T/b.mp4 0 3 >/dev/null
python3 ../scripts/escrever.py 13 E2 W2 cu $T/c.mp4 4.2 6.6 >/dev/null
P2="scale=1440:-2,pad=1440:1280:0:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p"
for x in a b c; do ffmpeg -v error -y -i $T/$x.mp4 -vf "$P2" -c:v libx264 -crf 20 -preset veryfast -c:a aac -ar 48000 -b:a 128k -colorspace bt709 -color_primaries bt709 -color_trc bt709 $T/p$x.mp4; done
printf "file '$T/pa.mp4'\nfile '$T/pb.mp4'\nfile '$T/pc.mp4'\n" > $T/l.txt; ffmpeg -v error -y -f concat -safe 0 -i $T/l.txt -c copy ../s2-falhas.mp4
rm -rf $T
