#!/usr/bin/env bash
# Renders the landing hero reel (composition HeroMill) LOCALLY and drops it in web/public/landing/hero/.
# Sources: design/exemplos-templates/2026-11-04 (1080p, not in git). They are downscaled to 432×768/30 fps into a
# temp public dir, so nothing heavy lands in video/public. Usage: bash video/src/landing/render-hero.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/design/exemplos-templates/2026-11-04"
OUT="$ROOT/web/public/landing/hero"
TMP="${TMPDIR:-/tmp}/heromill-$$"
PUB="$TMP/public/landing/hero"
mkdir -p "$PUB" "$OUT"
# the bundle loads the shared fonts from the public dir at boot: link them in
ln -s "$ROOT/video/public/fonts" "$TMP/public/fonts"
trap 'rm -rf "$TMP"' EXIT

# 1. intermediates: same size as the composition, 30 fps (the raw take is 25 fps), near-lossless
cp "$SRC/avatar-falando.mp4" "$TMP/avatar.mp4"
for f in avatar new-headline split-screen breaking-news meme-pov; do
  in="$SRC/$f.mp4"; [ "$f" = avatar ] && in="$TMP/avatar.mp4"
  ffmpeg -v error -y -i "$in" -an -vf "fps=30,scale=432:768:flags=lanczos" -c:v libx264 -crf 12 -preset fast -pix_fmt yuv420p "$PUB/$f.mp4"
done

cd "$ROOT/video"
# 2. lossless-ish master, then the two web encodes from it (one decode of the composition)
npx remotion render HeroMill "$TMP/master.mov" --public-dir="$TMP/public" --codec=prores --prores-profile=hq --muted --log=error
ffmpeg -v error -y -i "$TMP/master.mov" -an -c:v libvpx-vp9 -b:v 0 -crf "${VP9_CRF:-42}" -row-mt 1 -deadline good -cpu-used 1 -pix_fmt yuv420p "$OUT/hero-mill.webm"
ffmpeg -v error -y -i "$TMP/master.mov" -an -c:v libx264 -crf "${H264_CRF:-27}" -preset slow -pix_fmt yuv420p -movflags +faststart "$OUT/hero-mill.mp4"
# 3. poster = the rest frame (12.6 s, everything published; same as the HTML's final state)
npx remotion still HeroMill "$TMP/poster.png" --public-dir="$TMP/public" --frame=378 --log=error
ffmpeg -v error -y -i "$TMP/poster.png" -q:v 7 "$OUT/hero-mill.jpg"
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libaom-av1; then
  ffmpeg -v error -y -i "$TMP/poster.png" -c:v libaom-av1 -still-picture 1 -crf 34 "$OUT/hero-mill.avif" || true
fi
ls -la "$OUT"
