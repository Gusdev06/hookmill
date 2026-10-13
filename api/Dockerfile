# syntax=docker/dockerfile:1
# Imagem da API da HookMill: NestJS + Prisma + render Remotion (Chrome headless shell) + medição (ffmpeg, onnxruntime).
# Dono: maquina-arquiteto. Runbook: docs/deploy.md. Desenho: docs/contratos/estrutura.md §6.
#
# CONTEXTO DE BUILD = RAIZ DO MONOREPO (a api depende dos workspaces contratos e video):
#   docker build -f api/Dockerfile -t hookmill-api .
# Alvo: linux/amd64 (VPS Hostinger). Debian bookworm: glibc 2.36 (os binários do Remotion pedem >= 2.35), ffmpeg 5.1.

ARG NODE_IMAGE=node:22-bookworm-slim

# ───────────────────────── base comum ─────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
# onnxruntime-node: no linux/x64 o postinstall baixa o pacote CUDA 12 (centenas de MB, inútil sem GPU).
# "skip" mantém só os binários de CPU que já vêm no pacote (bin/napi-v6/linux/x64).
ENV ONNXRUNTIME_NODE_INSTALL=skip \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
# só os package.json: o npm ci confere o lockfile contra todos os workspaces, inclusive web/ e testes/
COPY package.json package-lock.json ./
COPY contratos/package.json contratos/
COPY api/package.json api/
COPY video/package.json video/
COPY web/package.json web/
COPY testes/package.json testes/

# ───────────────────────── build ─────────────────────────
FROM base AS build
# curl: prebuild da api baixa o SFace (api/src/medicao/modelos/baixar.sh, sha256 conferido). openssl: detecção do Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl openssl \
 && rm -rf /var/lib/apt/lists/*
# deps de build (com dev) só dos 3 workspaces da api; web/ e testes/ não entram
RUN npm ci -w api -w video -w contratos
COPY contratos/ contratos/
COPY video/ video/
COPY api/ api/
# video: dist/lib (o que a api importa) + dist/bundle (REMOTION_BUNDLE_DIR); api: prebuild (SFace) → prisma generate → nest build
RUN npm run build -w video \
 && npm run build -w api \
 && test -f video/dist/bundle/index.html \
 && test -f video/dist/lib/index.js \
 && test -f api/dist/main.js \
 && test -f api/dist/medicao/modelos/face_detection_yunet_2023mar.onnx \
 && test -f api/dist/medicao/modelos/face_recognition_sface_2021dec.onnx

# ───────────────────────── runtime ─────────────────────────
FROM base AS runtime
# Libs do Chrome headless shell (lista de remotion.dev/docs/docker, com os pacotes de runtime no lugar dos -dev),
# ffmpeg/ffprobe do sistema (medição, validação, remux), fontes de emoji e fallback, tini (PID 1 que recolhe os
# processos do Chrome e do ffmpeg), openssl (Prisma).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates openssl tini ffmpeg \
      fonts-liberation fonts-noto-color-emoji fontconfig \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 \
 && rm -rf /var/lib/apt/lists/*

# deps de produção dos 3 workspaces; tira os binários do onnxruntime de outros sistemas (~220 MB)
RUN npm ci --omit=dev -w api -w video -w contratos \
 && npm cache clean --force \
 && rm -rf node_modules/onnxruntime-node/bin/napi-v6/darwin node_modules/onnxruntime-node/bin/napi-v6/win32 \
           node_modules/onnxruntime-node/bin/napi-v6/linux/arm64

COPY --from=build /app/api/dist api/dist
COPY --from=build /app/api/prisma api/prisma
COPY --from=build /app/video/dist video/dist
COPY scripts/api-start.sh scripts/api-start.sh

ENV NODE_ENV=production \
    PORT=3001 \
    REMOTION_BUNDLE_DIR=/app/video/dist/bundle \
    REMOTION_BROWSER_EXECUTABLE=/app/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell \
    RENDER_TMP_DIR=/data/render \
    TMPDIR=/data/tmp \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

# Prisma Client do runtime (engine debian-openssl-3.0.x) + Chrome headless shell baixado AGORA, não na 1ª renderização
# (o ensureBrowser em produção travou e derrubou o Node na VPS). Depois, prova no build que nada nativo está quebrado:
# ldd sem "not found" no Chrome, no compositor do Remotion e no onnxruntime; onnxruntime carrega; ffmpeg responde.
RUN node_modules/.bin/prisma generate --schema api/prisma/schema.prisma \
 && node -e "require('@remotion/renderer').ensureBrowser().then((s) => console.log(JSON.stringify(s)))" \
 && test -x "$REMOTION_BROWSER_EXECUTABLE" \
 && if ldd "$REMOTION_BROWSER_EXECUTABLE" | grep 'not found'; then echo 'Chrome: lib de sistema faltando' >&2; exit 1; fi \
 && test -d node_modules/@remotion/compositor-linux-x64-gnu \
 && for f in $(find node_modules/@remotion/compositor-linux-x64-gnu -type f -perm -u+x) node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node; do \
      if ldd "$f" 2>/dev/null | grep 'not found'; then echo "lib faltando: $f" >&2; exit 1; fi; \
    done \
 && node -e "require('onnxruntime-node'); console.log('onnxruntime ok')" \
 && ffmpeg -hide_banner -version | head -1 && ffprobe -hide_banner -version | head -1 \
 && mkdir -p /data/render /data/tmp \
 && chown -R node:node /data

# /data = volume do EasyPanel (renders e downloads temporários; o storage é o Supabase). Precisa ser do uid 1000.
VOLUME ["/data"]
USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "scripts/api-start.sh"]
