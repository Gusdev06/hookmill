#!/usr/bin/env bash
# Baixa o SFace (OpenCV Zoo, Apache-2.0, 37 MB) pra identidade do avatar principal. Grande demais pro git: o build da
# imagem roda este script (ou aponta SFACE_MODEL_PATH). Sem o modelo, a trilha cai pra posição/tamanho (sem identidade).
set -euo pipefail
# shasum (macOS) ou sha256sum (Debian/Docker slim, sem perl)
if command -v shasum >/dev/null 2>&1; then SUM="shasum -a 256"; else SUM="sha256sum"; fi
cd "$(dirname "$0")"
F=face_recognition_sface_2021dec.onnx
SHA=0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
if [ ! -f "$F" ] || ! echo "$SHA  $F" | $SUM -c - >/dev/null 2>&1; then
  curl -fsSL -o "$F.tmp" "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/$F"
  echo "$SHA  $F.tmp" | $SUM -c - >/dev/null
  mv "$F.tmp" "$F"
fi
echo "ok $F"
