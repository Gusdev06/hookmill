#!/usr/bin/env bash
# Aceite (a): antes × depois, frame a frame. PSNR (ffmpeg, RGB e YUV) tem que ser inf em todo frame;
# confere também o md5 de cada frame decodificado (framemd5) e o áudio decodificado.
# Uso: scripts/editor-f1/psnr.sh [antes] [depois]
set -uo pipefail
cd "$(dirname "$0")/../.."
A="out/f1-${1:-antes}"; B="out/f1-${2:-depois}"
for f in "$A"/*.mp4; do
  n=$(basename "$f"); g="$B/$n"
  [ -f "$g" ] || { echo "$n: falta depois"; continue; }
  na=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$f")
  nb=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$g")
  ffmpeg -v error -i "$f" -i "$g" -lavfi "[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]psnr=stats_file=$B/psnr.log" -f null - 2>/dev/null
  fin=$(grep -vc "psnr_avg:inf" $B/psnr.log); tot=$(wc -l < $B/psnr.log | tr -d ' ')
  va=$(ffmpeg -v error -i "$f" -map 0:v -f framemd5 - | grep -v '^#' | awk -F, '{print $NF}' | md5 -q)
  vb=$(ffmpeg -v error -i "$g" -map 0:v -f framemd5 - | grep -v '^#' | awk -F, '{print $NF}' | md5 -q)
  aa=$(ffmpeg -v error -i "$f" -map 0:a -f md5 - 2>/dev/null); ab=$(ffmpeg -v error -i "$g" -map 0:a -f md5 - 2>/dev/null)
  echo "$n: frames $na/$nb | PSNR RGB inf em $((tot-fin))/$tot frames | framemd5 $([ "$va" = "$vb" ] && echo igual || echo DIFERENTE) | audio $([ "$aa" = "$ab" ] && echo igual || echo DIFERENTE)"
done
