#!/bin/bash
# API do QA Q1 (prévias): build próprio do QA, banco maquina_previas_test, porta 3151, tudo mock. AI_PREVIEWS via $1 (on|off)
W=/data/cerebros/gusta/projects/maquina-anuncios-wt-previas
DB='postgresql://maquina:maquina@localhost:5433/maquina_previas_test?schema=public'
cd $W
exec env NODE_ENV=test PORT=3151 PUBLIC_API_URL=http://localhost:3151 WEB_ORIGIN=http://localhost:3246 \
  DATABASE_URL="$DB" DIRECT_URL="$DB" JWT_ACCESS_SECRET=qa-segredo-de-teste-nao-usar-em-lugar-nenhum-0123456789abcdef0123 \
  STORAGE_ENDPOINT=http://localhost:9000 STORAGE_BUCKET=maquina-anuncios-test STORAGE_ACCESS_KEY_ID=maquina STORAGE_SECRET_ACCESS_KEY=maquina-dev-secret STORAGE_FORCE_PATH_STYLE=true \
  INTEGRACOES_MODE=mock ANTHROPIC_API_KEY= WAVESPEED_API_KEY= HF_API_KEY_ID= HF_API_KEY_SECRET= APIFY_TOKEN= PEXELS_API_KEY= WAVESPEED_WEBHOOKS=off \
  AD_LIBRARY_MODE=mock ADS_RESEARCH_MODE=mock ADS_RESEARCH_CRON=off ADS_RESEARCH_DISCOVERY=off META_MODE=mock META_CRON=off \
  RENDER_IMPL=fake RENDER_REMIX_IMPL=fake RENDER_LAMBDA_KINDS= REMOTION_AWS_ACCESS_KEY_ID= REMOTION_AWS_SECRET_ACCESS_KEY= REMOTION_LAMBDA_FUNCTION= REMOTION_SERVE_URL= \
  ANALYZE_IMPL=local ANALYZE_LAMBDA_FUNCTION= AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_SESSION_TOKEN= AWS_PROFILE= \
  TEST_MODE=off TEMPLATES=on ITERATE_TEMPLATES=on AI_TEMPLATES_ENABLED=on AI_PREVIEWS=${1:-on} SIGNUP_ENABLED=true \
  RENDER_TMP_DIR=/tmp/maquina-render-qprev DEFAULT_MONTHLY_SPEND_CAP_USD=200 \
  node testes/harness/api-qa.mjs
