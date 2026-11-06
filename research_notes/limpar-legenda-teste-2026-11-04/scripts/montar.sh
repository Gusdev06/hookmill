#!/bin/bash
# montar.sh <id> <dir_trecho> <saida_dir> <nome>  — junta o áudio original e faz o lado a lado com rótulos
set -e
id=$1; o=$2; out=$3; nome=$4
F="/System/Library/Fonts/HelveticaNeue.ttc"
mkdir -p "$out"
for k in A C V N limpo; do
  ffmpeg -v error -y -i "$o/$k.mp4" -i "v$id.mp4" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 128k -shortest "$out/$nome-$k.mp4"
done
lab() { echo "drawtext=fontfile=$F:text='$1':x=14:y=h-64:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=10"; }
ffmpeg -v error -y -i "v$id.mp4" -i "$o/A.mp4" -i "$o/V.mp4" -filter_complex \
 "[0:v]$(lab ORIGINAL)[a];[1:v]$(lab 'NOVA fiel')[b];[2:v]$(lab 'NOVA destaque novo')[c];[a][b][c]hstack=3,format=yuv420p[v]" \
 -map "[v]" -map 0:a -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 128k -shortest "$out/$nome-antes-depois.mp4"
