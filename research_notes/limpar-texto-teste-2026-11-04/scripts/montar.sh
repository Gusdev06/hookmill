#!/bin/bash
# montar.sh <id> <original> <dir_trecho> <seg_lado_a_lado> <saida> "<t1 t2 t3>"
set -e
id=$1; ori=$2; o=$3; dur=$4; out=$5; ts=$6
F="/System/Library/Fonts/HelveticaNeue.ttc"
for k in A B; do
  ffmpeg -v error -y -i "$ori" -i "$o/trecho-final$k.mp4" -filter_complex "[0:v][1:v]overlay=eof_action=pass,format=yuv420p[v]" \
    -map "[v]" -map 0:a -c:v libx264 -crf 18 -preset medium -c:a copy "$out/$id-depois-$k.mp4"
done
ffmpeg -v error -y -t $dur -i "$ori" -t $dur -i "$out/$id-depois-B.mp4" -filter_complex \
 "[0:v]drawtext=fontfile=$F:text='ANTES':x=20:y=h-70:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10[a];[1:v]drawtext=fontfile=$F:text='DEPOIS':x=20:y=h-70:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=10[b];[a][b]hstack,format=yuv420p[v]" \
 -map "[v]" -map 0:a -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 128k "$out/$id-antes-depois.mp4"
for t in $ts; do
  ffmpeg -v error -y -ss $t -i "$ori" -frames:v 1 /tmp/x_o.png 2>/dev/null || true
done
