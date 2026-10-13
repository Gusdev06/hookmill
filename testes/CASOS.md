# Casos de teste (Q1) · dono: maquina-qa · 2026-10-05
Fonte: `docs/contratos/api.md`, `modelo-de-dados.md`, `eventos.md`. Banco `maquina_test` (5433), bucket `maquina-anuncios-test`, API de teste na porta 3101 com `INTEGRACOES_MODE=mock`. Nada pago.

## Como rodar
| comando (de `testes/`) | o quê | precisa |
|---|---|---|
| `npm run fumaca` | trava de banco, schema, reset por teste, fábrica dos 15 estados | só `npm run infra:up` |
| `npm run contrato` | contrato + isolamento + estados (sobe a API sozinho com o env de teste) | B1/B2/I1 |
| `npm run e2e:navegador` | fluxo no navegador 1440 e 390: sobe a API (3101, sem watch) e o web (Next dev na 3210, sem MSW); screenshots em `test-results/telas/` | infra |

Reset por teste = `TRUNCATE` de tudo + reinsere as identidades fixas (mesmos ids, então o JWT em cache segue válido). Personas: `donoA`, `adminA`, `membroA` (workspace A "QA Alfa"), `donoB` (B "QA Beta"), `duplo` (MEMBER em A e B). A senha vem do seed do backend (`npm run seed -w api` contra o `maquina_test`), e o hash é reaproveitado.

## Lista (o número de casos `E-` sai da matriz)
| id | arquivo | o quê | depende de |
|---|---|---|---|
| FUM-1..5 | `fumaca/harness.spec.ts` | trava (dev, remoto, bucket), schema com 16 tabelas, reset entre testes, 15 estados na fábrica | infra (**passando**) |
| C-AUTH-01..14 | `contrato/auth.spec.ts` | health, login, 401 sem/forjado, 400 com details.fields, me, refresh rotativo, logout, switch-workspace, PATCH me, convites (410, 403, EMAIL_TAKEN), membro removido perde o refresh | B1 |
| C-WS-01..05, C-CAT-01..03 | `contrato/workspace.spec.ts` | workspace, teto (403 MEMBER), membros, último OWNER (409), services mascarado, spend, engines, voices, templates | B1, B2, I1, V2 |
| C-OF-01..07 | `contrato/ofertas-criativos.spec.ts` | CRUD de oferta, fieldSources `user`, paginação, extract → Job, reread 409 | B2, I1 |
| C-CR-01..17, C-ARQ-01 | idem | criar criativo (nome padrão, 7 steps), OFFER_INCOMPLETE, SPEND_CAP, roteiros do mock, step/chip derivados dos 15 estados, filtros/counts, OFFER_LOCKED, arquivar, leituras por etapa, estimate, ESTIMATE_CHANGED, validações, biblioteca/vencedor, SSE snapshot, `/files` 302 | B2, I1, V2 |
| C-RATE-01 | `contrato/zz-rate-limit.spec.ts` | 6º login no minuto → 429 com retryAfterSec | B1 |
| I-01 (×3 personas) | `isolamento/workspaces.spec.ts` | 35 rotas com id de B → 404 (nunca 403/200), nada do B no corpo, banco de B idêntico antes/depois | B1, B2 |
| I-02..08 | idem | listas sem B, ids cruzados (criativo de A + roteiro de B), offerId de B, workspaceId no corpo (400), nasce no workspace do token, switch, chave do storage `ws/<A>/` | B1, B2 |
| E-OK / E-409 (matriz) | `estados/transicoes.spec.ts` | 14 ações × estados de origem: permitido → destino certo no banco; proibido → 409 INVALID_STATE `{state, allowed}` e o estado não muda | B2 |
| E-SEL, E-RESET-01/02, E-APR-01/02 | idem | select com rostos/rosto já escolhido, CONFIRM_DOWNSTREAM_RESET + stale sem apagar, editDirty, APPROVED final | B2 |
| E-CAS-01/02 | idem | clique duplo em Generate e gerar rostos: um passa, um 409, um lote só | B2 |
| E-MOCK-01/02 | idem | rostos e geração+render andam sozinhos no mock até RENDER_READY | B2, I1, V2 |
| E-FALHA-01..05, E-BOOT-01 | idem | a falha vira "esperando você" e destrava: rostos (4 códigos), uma cena falha sem parar as outras, roteiros PARTIAL/fail-all, render, extração 403/unreadable/429. Boot: segunda instância da API (porta 3102) em cima de trabalho órfão | gatilhos da §17 + `[mock:RENDER_ERROR]` (passando) |
| F-00..11 | `fluxo/fluxo-inteiro.s## Estado em 05/10 (Q2)
`contrato` + `isolamento` + `estados` contra a API em mock (porta 3101, `maquina_test`): **146 passaram, 0 falharam, 0 fixme**. O C-CR-08 e o C-WS-03 seguem as "Mudanças 05/10". Os tokens são gravados em `.cache/tokens.json` por execução, então são só 5 logins por execução, mesmo quando o worker reinicia.

## Bugs abertos (Q3, 05/10)
1. **[frontend] Toast "Preview rendered" num render que falhou.** Passo a passo: criativo em RENDER_READY → abrir `/creatives/<id>/edit` → CTA text = `Start now [mock:RENDER_ERROR]` → Render preview. A tela mostra "Render failed at frame 390" + Render again (certo), mas aparece junto o toast de sucesso "Preview rendered". Prova: `test-results/telas/fluxo-1440/falha3a-render-falhou.png` e `fluxo-390/falha3a-render-falhou.png`. Provável causa: o efeito de toast em `web/src/components/wizard/edit-step.tsx` dispara quando `latestRender` volta a um render READY antigo; conferir também o `latestRender` do `GET …/edit` (backend) se o web estiver certo.
2. **[frontend, menor] No 390, o toast cobre o nome e os fatos do vídeo no Final OK** por alguns segundos (`fluxo-390/08a-review.png`).
Observação: o botão "N" do Next dev cobre o "Back" no 390, mas isso só existe em dev.

## Pendências com o arquiteto
1. **`[mock:RENDER_ERROR]`** (headline/ctaText, no `FakeRenderService`) existe na API, mas falta na §17 do `api.md`. O E-FALHA-04 depende dele.
2. **Ruído no log da API:** o reset por teste apaga um render que ainda está na fila do teste anterior, e o `Edicao` loga `No record was found for an update`. Isso vem do harness (TRUNCATE com render em andamento), não é bug. Fica de olho: em produção não há TRUNCATE.
3. **Schema do `maquina_test`:** o harness só roda `migrate deploy`. Se uma migração exigir apagar dados, alguém humano recria o banco (o Prisma bloqueia `--force-reset` quando quem roda é um agente).

## Feature 2 "variar campeão" (Q5-prep, 06/10)
Fonte: `api.md` §17-20, `feature-2-variar-campeao.md` §1-§5, `modelo-de-dados.md` (máquinas do campeão e do lote). **Pendente até o B4a/B4b**: o projeto `feature2` só existe com `E2E_F2=1`, então `npm run contrato` e `npm run e2e` não mudam.
| comando (de `testes/`) | o quê |
|---|---|
| `npm run fixtures` | gera os vídeos em `fixtures/campeoes/` (ffmpeg + `say`, grátis, ~10 s) + `manifest.json`; a mídia fica fora do git |
| `npm run feature2` | os 100 casos abaixo contra a API de teste (3101, `maquina_test`, `INTEGRACOES_MODE`/`AD_LIBRARY_MODE` = mock, chaves Higgsfield/Apify em branco) |
| `npm run fumaca` | inclui `F2-FAB-01..04` (fábrica da feature 2 contra a migração + fixtures), sem API |

Fixtures: `fala-split-20s.mp4` (fala + corte de layout em 8 s + troca de conteúdo em 14 s), `.mov` do mesmo, `hevc-10s.mp4`, `sem-audio-10s.mp4`, `sem-fala-tom-10s.mp4`, `400px-12s.mp4` (low_resolution), `pequeno-200px-8s.mp4` (too_small), `truncado-20s.mp4` (ffprobe lê, não decodifica inteiro), `curto-3s.mp4`, `longo-125s.mp4`, `so-audio.mp4` (no_video); > 200 MB e mime webm simulados por `sizeBytes`/`mimeType`.

| id | arquivo | o quê | depende de |
|---|---|---|---|
| C-UP-01..14 | `feature2/uploads.spec.ts` | POST/PUT/complete, 30 min, MEDIA_TOO_LARGE, mime, MOV/H.265, avisos, too_small/short/long/no_video, truncado passa no complete, UPLOAD_INCOMPLETE (sem PUT e tamanho diferente), 413, 410, 404/401, bytes íntegros na URL assinada | B4a, V3 |
| C-CH-01..17 | `feature2/campeoes.spec.ts` | config, upload → ANALYZING → READY (12 seções, medição real bate com a fixture, checklist), 400/404/409, gatilhos `mock-ad-*` (503 síncrono sem criar nada, AD_NOT_FOUND/AD_HAS_NO_VIDEO + PUT video), link resolvido, `[mock:analysis-fail]` + reanálise sem retranscrever, truncado → MEDIA_INVALID sem pagar transcrição, sem áudio → NO_SPEECH, lista/paginação/arquivar, PATCH rights, PATCH teardown, CONFIRM_DOWNSTREAM_RESET, batches, custo | B4a, I4a, V3 |
| C-LT-01..17 | `feature2/lotes.spec.ts` | plano com controle automático, limites, KIND_NOT_ENABLED, NO_SPEECH, `fail-item`/`fail-all` + replan, PATCH item por tipo, settings, elenco (rostos, SAFETY_BLOCK), estimate com reuso, BATCH_INCOMPLETE, ESTIMATE_CHANGED, SPEND_CAP, launch (nomes, variation, AUDIO_LIPSYNC/TTS_LIPSYNC/REUSE), REUSE sem provider_task, filtros | B4b, I4b |
| E-CH / E-LT (matriz) | `feature2/estados.spec.ts` | analyze/PUT video/pedir lote em cada estado do campeão; replan/launch/PATCH em cada estado do lote; LAUNCHED final; clique duplo (analyze e launch) | B4a, B4b |
| E-TRV-01..05 | `feature2/travas.spec.ts` | `variation_locked` (scripts, engine, generate), o que continua valendo, `changeOptions` por tipo, `change_not_available`, steps/variation no detalhe | B4b |
| I-F2-01 (×3), I-F2-02..04 | `feature2/isolamento.spec.ts` | 22 rotas + PUT do upload com id de B → 404 e banco de B idêntico; ids cruzados (oferta/upload/item/elenco/rosto de B); listas e filtros; nasce no workspace do token | B4a, B4b |
| R-01..03 | `feature2/rights.spec.ts` | **nada é recusado por rights** (D1): THIRD_PARTY passa em tudo, lança com áudio original sem aviso, trocar rights no meio não muda nada | B4a, B4b |
Não escrito ainda: fluxo no navegador 1440/390 da feature 2 (depende do mockup D2 e do F4c).

### Perguntas ao arquiteto (feature 2): respondidas em 06/10 ("Esclarecimentos 06/10" no doc da feature 2)
Casos ajustados: C-UP-14 (PUT sem Bearer = 401), C-UP-15 (complete idempotente), C-CH-10 (`upload_video`), C-CH-12 (arquivado = 404), E-LT regerar item por estado + launch com item WRITING = 422.

## Estado em 06/10 (Q5, API em mock): 101 passaram, 5 falharam (106 casos)
`E2E_F2=1 npx playwright test --project=feature2` (de `testes/`). A fábrica precisou de 2 ajustes de dado (snapshot no formato do backend, voz do catálogo) e os casos de áudio original usam campeão de verdade (`campeaoReal`).
1. **[backend] Erro num job em segundo plano derruba a API inteira.** Passo a passo: campeão READY → `POST /champions/:id/batches {requests:[{kind:'SWAP_AVATAR',count:1}]}` → apagar a linha do lote antes do plano terminar → `variacoes.service.ts:280` `variationCasting.create` lança P2003 sem `catch` no callback do `planVariations` → `Node.js` sai e `npm start` morre (todas as rotas fora do ar). Qualquer falha de banco no `saveDraft` tem o mesmo efeito; o certo é o item virar `FAILED`. O harness agora espera os jobs terminarem entre testes (`esperarJobsQuietos`), então a suíte não depende disso.
2. **[backend] Upload vencido aceita o PUT** (C-UP-13): `uploads.expires_at` no passado → `PUT /uploads/:id/content` = 200 `{ok:true}` (contrato: 410 `UPLOAD_EXPIRED`); o `complete` em seguida também não dá 410 (respondeu 422 `MEDIA_TOO_SHORT`, ou seja, leu o arquivo).
3. **[ia/backend, menor] O 202 do `POST /champions` só com link não vem em `RESOLVING`** (C-CH-07 ×2, C-CH-08): `mock-ad-notfound`/`mock-ad-novideo` já voltam `FAILED` e o link bom já volta `ANALYZING` na própria resposta. Contrato: "202 ChampionDetail em ANALYZING ou RESOLVING" e §17 "toda task mock termina em 2-5 s". O mock resolve na hora; a tela nunca mostra o checklist do RESOLVE.
### Divergências pro arquiteto decidir (os casos aceitam o que o backend faz e marcam)
- `[mock:fail-all]` → `PLAN_FAILED`, mas o controle fica `READY` (a máquina diz "todos FAILED"; ≥ 1 READY daria `PLAN_READY`). O controle não conta? Escrever no contrato.
- O item de controle já nasce `READY` no 202 (o contrato diz "itens WRITING").
- Nome do controle sai `"<campeão> · New hook · Control"`; o contrato diz `"… · Control"`.
- (backend, 06/10) `/generate` em variação passa se motor/modelo/voz/formato forem iguais aos do lote; o `api.md` §9 ainda diz que é sempre `variation_locked`. E-TRV-01 manda formato diferente.
Flaky do backend (análise do campeão FAILED): não apareceu em 4 rodadas completas aqui; o `campeaoReal` imprime o `errorCode`/`failReason` do job se acontecer.

### Pista pro backend: `api/src/app.int.spec.ts › storage: ingestFromUrl` com 404 (06/10)
O spec seta `process.env.INTEGRACOES_MODE = 'mock'` **depois** dos imports; o `@Module` do `AppModule` avalia `IntegracoesGlobalModule.forRoot()` → `IntegracoesModule.register()` → `integracoesMode()` na hora do import, e o `import 'dotenv/config'` já carregou o `api/.env`, que hoje diz `INTEGRACOES_MODE=live`. Resultado: registra o `WaveSpeedWebhookController` no lugar do `MockMediaController` → `/api/v1/mock-media/...` = 404. Prova: `env -u INTEGRACOES_MODE node -e "require('dotenv').config(); …"` em `api/` imprime `live`. **Risco**: nesse estado o spec sobe a API com Claude/WaveSpeed/Higgsfield live e as chaves do `.env` preenchidas. Correção é do backend (ex.: setar o env antes de importar o AppModule, via `jest` `setupFiles`, ou rodar com `INTEGRACOES_MODE=mock` no script).

## §13 manter a edição + take único (Q7, 06/10 noite) → portão F2-G2b (09/10)
Fonte: `feature-2-variar-campeao.md` §13 + `api.md` "Mudanças 06/10 noite". D6 decidida (Gusta, 06/10): Novos ganchos = (a) gancho escrito, definitivo.
**Pendente até B5/V4a/V4b/I5**: `keep-edit.spec.ts` só roda com `E2E_F2_KEEP=1`. Antes de rodar: `node -e "fetch('http://localhost:3001/api/v1/health').then(r=>r.json()).then(console.log)"` NÃO é usado pelos testes; a trava `guardTestApi` aborta em 3000/3001 e `confirmarApiEmMock` aborta se a API de teste não tiver `/mock-media`.
| comando (de `testes/`) | o quê |
|---|---|
| `npm run fixtures:paineis` | gera 6 campeões em painéis (720x960, 450 frames, áudio 4 frames mais longo que o vídeo, como o campeão real) + `paineis.json`; sanidade com YuNet |
| `npm run keep` | os casos abaixo contra a API de teste (3101, mock) |
| `python3 ferramentas/qa_video.py peca\|gancho\|rostos …` | conferência de peça (frames, md5 do áudio decodificado, PSNR fora da região, original piscando, 1 rosto por frame) |

Fixtures (`fixtures/campeoes/paineis-*.mp4`, rostos gerados por texto pela operação em `fixtures/rostos/`): `caixa` (referência), `cheia-caixa` (tela cheia 0-5 s com legenda dentro da região, corte no frame 150), `2-rostos` (YuNet: 2 rostos em 75/75 amostras), `legenda-cruza`, `gancho-sem-fundo`, `rosto-borrado` (YuNet ~0,6: low_confidence, não no_face).

| id | o quê |
|---|---|
| KE-TRILHA-01/02 | `mapping_edit` no checklist; trilha na caixa x0 y119 336x324 ±2 px; grade = vídeo (450), não áudio; 2 trechos com borda no frame 150 ±1 |
| KE-BLQ-01..05 | multiple_faces, no_face, low_confidence ponta a ponta; not_mapped (editMap null); caption_straddles_face / overlay_over_face / hook_text_over_video gravados → 422 `KEEP_EDIT_UNSUPPORTED` só no tipo afetado; keepEdit:false passa |
| KE-BLQ-06 (fixme) | bloqueios da visão ponta a ponta: precisa gatilho de mock do `describeEdit` |
| KE-SET-01 | padrão keepEdit, voiceSource forçado CHAMPION_AUDIO, hookMode ≠ TEXT = 400 |
| TK-01 | SWAP keepEdit: 1 take AUDIO_LIPSYNC = 1 LIPSYNC, 0 TTS, 0 TRANSCRIBE por criativo, seed 7, fatias TAKE_SLICE contíguas |
| TK-02 | do zero LIPSYNC: 1 TTS (texto inteiro) + 1 LIPSYNC + 1 TRANSCRIBE; nenhuma palavra cortada; estimativa cobra o take 1 vez |
| TK-03/04 | refazer cena = refaz o take (409 `regenerate_take` sem confirm, ESTIMATE_CHANGED, attempt 2 / seed 8, 2ª LIPSYNC); rota `take/regenerate`; changeOptions SCENE/LINE = custo do take |
| TK-05/06 | falha do take → todas as fatias FAILED, SCENES_FAILED em needs_you, destrava; > 600 s = 422 `LIPSYNC_AUDIO_TOO_LONG`, nada criado |
| RE-01/02 | re-edição = 0 provider_tasks e custo igual; remix-keep: PATCH /edit = 409 `variation_locked` |
| PC-01/02 | peça SWAP: nº de frames = campeão, md5 áudio = campeão, PSNR fora ≥ 40 dB, dentro diferente em todo frame, 1 rosto/frame |
| HK-01..03 | ganchos (a): sem controle, só onScreenText, US$ 0, 1 SOURCE_CUT, 0 provider_tasks, sem take; peça: áudio decodificado md5-idêntico + corpo fora da caixa da headline (margem 2 px de croma) com PSNR ≥ 40 dB (decisão do coordenador 06/10: md5 do vídeo sai do critério, exigiria render sem perdas) |
| I-KE-01 | rotas novas com id de B → 404, banco de B intacto |

### Estado em 06/10 noite (Q7, primeira rodada com B5/V4/I5): `npm run keep` 18 passaram, 11 falharam (29)
Reproduzir: `cd testes && npm run keep` (ou `-g "<id>"`). Diagnóstico: `QA_CORRIGIR_HEADLINE=1` põe a headline do mapa na faixa medida (0,0,720,119) pra testar o que vem depois; **não vale como passou**.
1. **[video, mock da ia]** Headline do `describeEdit` mock (`x43 y48 634x86`, branca, `source: vision`) não é refinada por pixel para a faixa chapada (`0,0,720,119`, vermelha). Ela cruza a caixa do rosto (y 119), e todo campeão no layout de referência sai com `caption_straddles_face` (0-3 s), o que bloqueia o Trocar avatar. Afeta KE-TRILHA-01, KE-BLQ-01/03, TK-01, PC-01, RE-02.
2. **[video]** Bloqueios do vídeo de verdade não aparecem: `paineis-2-rostos` (YuNet local: 2 rostos em 75/75 amostras) não gera `multiple_faces`, e `paineis-rosto-borrado` (score ~0,6) não gera `low_confidence`. Pelos gatilhos `[mock:keep-two-faces]` passa.
3. **[video]** `paineis-cheia-caixa`: 6 trechos em vez de 2. O 1º sai com `fullFrame: false` e região 720x760 (o karaokê virou faixa), e aparecem células espúrias (x168 w56) dentro da caixa.
4. **[ia]** O lipsync mock devolve clipe sem rosto detectável, então o render `remix-keep` falha com "nenhum rosto no clipe do take". Nenhuma peça SWAP sai em mock (PC-01/02). O take em si está certo: TK-01 passa até o render (1 LIPSYNC, 0 TTS/TRANSCRIBE, seed 7, fatias contíguas).
5. **[backend]** Launch NEW_HOOKS TEXT devolve `503 PROVIDER_UNAVAILABLE`. Em `variacoes.service.ts` (launch, laço de submissão) a cena `SOURCE_CUT` conta em `total` e nunca em `submitted`, e o lote já ficou `LAUNCHED`. Afeta HK-02/03.
6. **[backend]** `POST /creatives/:id/scenes/2/regenerate {}` numa fatia TAKE_SLICE responde 202, com attempt 2 e o take regerado sem confirmação. O contrato pede `409 regenerate_take` (TK-03).
7. **[backend/arquiteto]** NEW_HOOKS com `keepEdit:false` ainda nasce com `TTS_LIPSYNC` por cena + `REUSE` (C-LT-15 e C-LT-16). O §13.5 diz que nada novo nasce assim e que gancho com fala nova vira take.
Regressão `npm run feature2`: 100 passaram, 6 falharam. 2 eram casos desatualizados pelo §13 (C-CH-02 corrigido; C-LT-15 virou o item 7). Os outros 4 são bugs antigos ainda abertos: C-CH-07 ×2, C-CH-08, C-UP-13.
Ajuste do QA na rodada: a fixture tinha uma linha vertical verde em x 336–342 (a célula era medida com 342 px); corrigido, agora mede 336x323.

### Estado em 06/10 23h (rodada sozinha no `maquina_test`, depois das correções de backend/ia/video): `npm run keep` 28/29
Peças: PC-01 tem PSNR fora da região de 48,1 dB e PC-02 de 48,4 dB; HK-03 de 50,3 dB. Nos três, o nº de frames é 450 (= campeão) e o md5 do áudio decodificado é igual ao do campeão.
- **Falha [backend]:** KE-BLQ-06 `[mock:keep-overlay]`. O `editMap.overlaysOverFace` vem preenchido (frames 151-303), mas o `keepEdit.SWAP_AVATAR` sai `available: true` sem bloqueio. Falhou 3 de 3 (`-g keep-overlay --repeat-each 3`). Passou na rodada das 22h; a regressão veio com `campeoes/mapa-edicao.ts` (alterado às 23:01).
- **Ajustes:** TK-03 segue a regra da v1 (esperado acima da estimativa passa; < 90 % dá ESTIMATE_CHANGED). C-LT-11 e C-LT-16 reescritos pro §13.5 (sem REUSE; savedByReuseUsd = 0; 1 take por criativo).
- **Regressão feature2:** 100 passaram, 6 falharam. 2 eram casos desatualizados (C-LT-11/16): corrigidos, passam. Os 4 que restam são bugs antigos ainda abertos: C-CH-07 ×2, C-CH-08, C-UP-13.

### 07/10 madrugada: rodada final inválida porque o Mac dormiu (não é bug do produto)
- **Causa:** o Mac está na bateria e entrou em "Maintenance Sleep" de ~900 s a cada ~15 min (`pmset -g log`, 01:54-03:56). O `caffeinate -dimsu` não segurou.
- **Efeito:** API parada com 0 % de CPU, `fetch failed` e jobs/renders presos ~15 min. Os "stalls de 15 min" desta noite, incluindo a análise do rosto borrado (06:24→06:39), são isso.
- **O que deu pra medir:** keep 23/29 e feature2 102/4. As 10 falhas são todas timeouts das janelas de sono.
- **Ajustes do QA:**
  - C-UP-13 grava `expires_at` em UTC (`(now() at time zone 'utc') - 1 min`), porque o Postgres local roda em Asia/Makassar.
  - `esperarJobsQuietos` espera também os renders: o TRUNCATE não cancela render em andamento, e a fila atravessava os testes.
  - `ateEstado` passou pra 600 s.
- **Pra fechar o placar:** rodar com o Mac na tomada e acordado: `cd testes && npm run keep && npm run feature2`.

## Editor no vídeo v1, F2d (Q8, 09/10)
Fonte: `docs/contratos/editor-v1.md` (APROVADO 09/10: §2, §3.2, §4, §5, §9, D1-D4) + `design/editor-v1-2026-10-09.md`. API de teste na **3111** (build próprio do QA em `testes/.cache/api-qa`, nunca `api/dist`, que é o da 3001 LIVE em `nest start --watch`), `INTEGRACOES_MODE=mock`, render fake (ou Remotion local com `E2E_RENDER_REAL=1`), banco `maquina_test`, bucket `maquina-anuncios-test`. Web de teste na 3210 com `NEXT_DIST_DIR=.next-qa` (o dev da 3000 trava `web/.next/dev/lock`). Browser: Google Chrome instalado (`channel: 'chrome'`; o Chromium do Playwright 1.63 não está baixado). Nada pago.
| comando (de `testes/`) | o quê |
|---|---|
| `npm run editor` | contrato + isolamento + estados do editor (API, 50 casos) |
| `npm run editor:navegador` | navegador 1440 e 390 (Player com MP4 de verdade do mock-media no bucket de teste) |
| `npm run editor:render` | render de verdade (Remotion local): não regressão com doc nulo e WYSIWYG Player × MP4 |
| `E2E_API_PORT=3111 node harness/servidores.ts --web` + `E2E_REUSE=1 …` | sobe API+web uma vez e reaproveita (o globalSetup confere mock E banco de teste pelos ids fixos) |
Harness: `harness/editor.ts` (fábrica `criarCriativoEditor`: 4 cenas 3/4/5/3 s com falas e palavras, a 3ª com "subscripshun" ≠ roteiro; `take: true` = TAKE_SLICE; `clipesReais` sobe MP4; `semAssinatura` tira a query das URLs e arredonda 1e-6), `harness/editor-ui.ts` (espião de PUT/origens/console). O globalSetup põe a origem do web de teste no CORS do **bucket de teste** (só acrescenta).

| id | arquivo | o quê |
|---|---|---|
| ED-C-01..05 | `editor/contrato.spec.ts` | forma do EditorState (fonte assinada 6 h, `layers[].defaults` = `layoutPadrao`, `labelKey editor.layer.*`, 9 fontes, capabilities); 404/401; PUT salva + revisão + RENDER_READY→EDIT_PENDING; doc nulo; normalização (frame, meio frame, ordem original = [], camada igual ao padrão sai, doc vazio = null) |
| ED-C-06/07 | idem | 14 erros de forma (DTO: `doc.layers.0.transform.scale` etc.) e **cada regra do §5.4** (`unknown_scene`, `clips_must_cover_scenes` ×2, `no_enabled_clip`, `trim_out_of_range` ×2, `clip_too_short`, `video_too_short`, `unknown_layer`, `bad_color` ×4, `unknown_font`, `doc_too_large` ×5, `unknown_word` ×3) → 400 com `details.fields[].rule`, banco intacto |
| ED-C-08 | idem | `trim` no criativo do zero recusado (400 `trim_out_of_range` ou 422; anota qual) |
| ED-C-09/10/11 | idem | `EDIT_CONFLICT` 409 com `{revision, savedBy, savedAt}`, PATCH /edit também sobe a revisão; 2 PUT simultâneos = 1×200 + 1×409; 6 PUT encadeados |
| ED-C-12 | idem | remix-keep: GET/PUT 422 `EDIT_NOT_SUPPORTED` com `details.reason`, `editorAvailable:false`, PATCH /edit `variation_locked` |
| ED-C-13/14/15 | idem | §3.2 trocar template apaga todo `transform` e mantém o resto; `captionPosition` apaga só o da legenda; **regressão do bug do PATCH que zerava ctaText/headline** |
| ED-C-16 | idem | SSE `editor.updated` em cada PUT e PATCH |
| ED-C-17..22 | idem | export: `render.doc`/`editRevision`, `input` = `resolverProps(fonte do GET, settings, doc)`; OK final travado com edição não exportada (§5.3); PUT durante RENDERING → EDIT_PENDING; palavra `text:''`; doc nulo = input de hoje (sem `layers`); take fatiado emenda e o corte no meio quebra a emenda |
| ED-C-23..28 | idem | `hasEditorChanges`/`editorAvailable`; **regerar cena depois de um corte** (409 durante, corte e correções da cena caem com o attempt 2); **Generate novo** (clips e captionWords zerados, camadas ficam); selo `editedInEditor` (render vigente, item do lote); doc só com o corte da cena regerada |
| ED-I-01..06 | `editor/isolamento.spec.ts` | GET/PUT/PATCH/render de B por 4 personas de A (incl. membro dos dois) = 404 e banco de B igual; cena/palavra de B no doc de A = 400 sem eco; fonte e input só `ws/<A>/`; SSE de A com token de B = 404 |
| ED-E-01 ×15, ED-E-02 | `editor/estados.spec.ts` | GET/PUT/`editorAvailable` em cada um dos 15 estados (abre em EDIT_PENDING, RENDERING, RENDER_FAILED, RENDER_READY; PUT em RENDER_READY → EDIT_PENDING); falha de render (`[mock:RENDER_ERROR]`) vira needs_you e destrava até APPROVED; depois do OK final o editor fecha |
| ED-N-01..15 | `editor-ui/editor.spec.ts` (1440 e 390) | entrada pela Edição e pelo OK final, mídia carregada, só a API de teste; arrastar/escala/caixa/giro + desfazer (desktop); autosave 800 ms + baseRevision; estilo; corrigir/esconder palavra; aparar (0,3 s)/reordenar/apagar/restaurar com a legenda acompanhando; conflito em 2 abas; exportar + OK final + selo na Biblioteca/Home; confirmação de template; remix travado; PT-BR; D4 no 390; cena regerada com o editor aberto; selo no lote; Generate novo |
| ED-R-01/02 | `editor-render/render.spec.ts` | (render real) doc nulo: input = o de antes (`renderPieces`) e PSNR = ∞ bundle antes do F1 × bundle atual; WYSIWYG: print do Player × frame do MP4 exportado |

### Estado em 09/10 noite (Q8, rodada F2d com o F2a entregue)
- **API (`npm run editor`, render fake): 49 de 50 passaram.** Falha o ED-C-28 (bug 5 abaixo). Na última rodada (16 min de parede, Mac dormindo) o ED-C-24 estourou o tempo esperando o mock; passou nas anteriores (8,7 s). Jest do backend em `api/src/edicao/` rodado no `maquina_test`: 2 suítes, 12/12; `npm run typecheck -w api` limpo.
- **Render real (`npm run editor:render`): 3/3.** ED-R-01: doc nulo × bundle de antes do F1 = PSNR RGB ∞ em todos os frames, áudio igual, input = o do `renderPieces` (SCENES e take fatiado). ED-R-02 WYSIWYG: Player × MP4 nos frames 45/120/250/330, bloco máx. 23-33 (fundo testsrc2 decodificado diferente, como no F1); controle negativo com o gancho 40 px fora = 119. Folhas: `test-results/editor-render/r02-wysiwyg/lado-45.png`, `neg-lado.png`.
- **Navegador:** 1440: 11 de 14 passam (ED-N-06, 09, 14 = bugs 1, 3, 2 abaixo; o ED-N-12 é só do 390). 390: 10 de 12 passam (ED-N-09, 14 = bugs 3, 2; os 3 de arrastar são só do desktop). As falhas de tempo (ED-N-07/13 no 390 com 15-19 min) eram o Mac dormindo na bateria; rodadas de novo, passam.
- **Ambiente:** Mac na bateria (13 % → 7 %) entrando em sono a cada ~15 min (`pmset`): a parede passa de 30 min pra 1 min de CPU. Rodar na tomada.

#### Bugs abertos (F2d)
1. **[frontend, média] Vídeo com menos de 1 s trava o salvamento.** Passo a passo (ED-N-06): editor 1440 → cena 2 → Start = 3.95 (fica 0,3 s) → apagar cenas 1, 3 e 4. O web deixa (spec §2.9: mínimo 1 s de vídeo); o PUT volta 400 `video_too_short`, aparece "Not saved · retrying" e o `use-editor.ts` reenvia o mesmo doc a cada 4 s. `MIN_VIDEO_SEC` existe em `components/editor/model.ts:9` e não é usado; o `validarDoc` não roda no cliente (spec §8). Pontos: `editor.tsx` `deleteScene` (só olha `placed.length <= 1`), `panel.tsx` campos Start/End da cena (só `MIN_CLIP_SEC`), `use-editor.ts` laço de retry (re-tenta erro 400).
2. **[frontend, baixa] Selo "edited" não aparece no lote.** ED-N-14: a API manda `items[].creative.editedInEditor: true` (ED-C-27 passa), mas `components/variar/batch-step.tsx` `VariationRow` não desenha o `EditedBadge` (contrato §5.1). Tela: `test-results/telas/editor-1440/editor-14-lote.png`.
3. **[frontend, baixa] Pede confirmação de novo depois de "Switch and reposition".** ED-N-09: criativo com gancho posicionado → Edição → Bold → Switch and reposition (o banco fica sem nenhum `transform`) → Clean → o diálogo abre de novo. `components/wizard/edit-step.tsx`: o `onSwap` invalida `qk.editor` antes do PATCH do `change()` (setTimeout 0) e o `flush` não invalida o editor depois do PATCH; as flags ficam velhas.
4. **[frontend, baixa, 390] O toast cobre a dock** por uns 4 s (ex.: "X saved a newer version; it's loaded."): Texto/Estilo não dão pra tocar até sumir. Tela `editor-390/editor-07a-toast-cobre-dock.png` (parente do bug 2 da Q3).
5. **[backend, baixa] Selo "editado" e "com ajustes" sem ajuste nenhum.** ED-C-28: doc só com o corte da cena 2 → regerar a cena 2 → o render automático sai sem ajuste (input = doc nulo), mas `editedInEditor` = true e `GET /edit.hasEditorChanges` = true. O `createRender` (`edicao/edicao.service.ts`) copia o `edit_doc` cru (com o corte do attempt velho) pro `render.doc`, e o `get()` usa `docTemConteudo(c.editDoc)` cru. Normalizar (`normalizarDoc` com a fonte) antes de copiar e de contar.
6. **[backend, nota] Doc nulo grava JSON null (`'null'::jsonb`), não NULL de SQL** (`editor-doc.ts` `docJson` usa `Prisma.JsonNull`; o comentário diz "coluna nula"). Mesmo efeito na API; `where edit_doc is null` não acha.

#### Pro arquiteto / backend (não é bug do produto)
- `infra:cors` só põe a 3000; o harness acrescenta a origem do web de teste (3210) no CORS do **bucket de teste**.
- `api/src/edicao/editor.int.spec.ts` (e os outros `*.int.spec.ts`) usam o `DATABASE_URL` do `api/.env` = **`maquina`**: a suíte do backend roda nos dados do Gusta e divide a fila (jobs/renders) com a 3001 LIVE ligada no mesmo banco. Rodar só com `DATABASE_URL` do `maquina_test` (aqui: 12/12) e sem outra API no mesmo banco. Os timeouts de `b2-fluxo`/`troca.int` não fecharam aqui: rodando sozinho no `maquina_test`, o `b2-fluxo` ficou 32 min parado com 9 s de CPU (Mac dormindo).
- Contrato: 409 do GET /editor também durante a regeração de UMA cena (o texto do §5 só fala do Generate novo); `trim` no do zero = 400 `trim_out_of_range`; o 422 do remix traz `reason: 'remix_editor_not_enabled'` (fora do `EditorLockReason` até o arquiteto pôr).

### 10/10 madrugada: reteste das correções (Mac a 4-5 % na bateria, dormindo; parede ~15 min por rodada curta)
- API `npm run editor`: 49/50 na rodada cheia (ED-C-24 estourou o tempo com o Mac dormindo); sozinho: ED-C-24, ED-C-28 (bug 5) e ED-C-04 passaram (3/3, 23 s). **50/50.**
- Navegador (casos dos bugs): ED-N-07 (390, agora confere que o toast não cobre a dock), ED-N-09 e ED-N-14 em 1440 e 390: **6/6**. ED-N-06 (1440, bug 1: vídeo salvo ≥ 1 s, nenhum 400): caiu por tempo na rodada (PUT nº 2 não veio em 15 s, Mac dormindo); sozinho passou (18,7 s).
- `api/src/variacoes/variacoes.int.spec.ts` (Jest no `maquina_test`, em série, servidores do QA parados): **não fechou**. Todos os casos caem no `beforeAll`, que estoura 480 s em `readyChampion` (análise do campeão). O caminho do lote com `settings.edit` ficou sem exercitar. Rodar na tomada.
- Não rodado depois das correções: a rodada completa do navegador (só os casos dos bugs) e o render real (ED-R-01/02, que passaram antes).

## Variação automática v1 (Q1, 13/10)
Fonte: `docs/contratos/variacao-auto-v1.md` (aprovado 13/10) + `design/variacao-auto-v1-2026-10-12.md`. API do QA na **3121** (mock, render fake) ou **3122** (`RENDER_IMPL=remotion`), web do QA na **3216** (sem MSW). `E2E_SKIP_SCHEMA=1` = nenhum comando Prisma (só confere a migração `20261014000000_variacao_auto` no `maquina_test`); `E2E_LIMITES_V2=1` = limites da spec (500 MB, 4-180 s). Persona nova `clienteA` (CLIENT em A). O seed do QA agora grava `short_code` (QA/QB), que virou NOT NULL na fase 2.
| comando (de `testes/`) | o quê |
|---|---|
| `npm run iterate` | IT-01..12 (API) |
| `npm run iterate:navegador` | IU-01..04 em 1440 e 390 (EN e PT-BR) |
| `npm run iterate:tempo` | IT-TEMPO: lote de 11 peças, 33 renders de verdade (parar a API de mock antes: a fila é do banco) |
Fixtures novas: `fixtures/campeoes/curto-6s.mp4` (recorte de 6 s do fala-split-20s) e `fixtures/produto-qa.png`. A captura da página usa `https://example.com/` (o provider da API não liga `allowPrivateHosts`, então um HTML local não serve).

| id | o quê |
|---|---|
| IT-01 | config: limites, 9 tipos, ofertas, `defaultOfferId`; CLIENT 403 |
| IT-02 | validação, `OFFER_REQUIRED` (0 e >1 oferta), ids de B 404, CLIENT 403, `defaultOfferId` = última usada |
| IT-03 | upload → ANALYZING → PLAN_READY; checklist 10 chaves; regras §6.1/6.2; captura PAGE_CAPTURE; nada inventado; 0 geração paga |
| IT-04 | Brain vazio: brainEmpty, swaps no_page/no_proof, porquê só do vídeo |
| IT-05 | 6 s: shortVideo, sem CUT/COLD-OPEN, lote ≥ 4; 3 s = 422 MEDIA_TOO_SHORT |
| IT-06 | oferta pt-BR → códigos PT |
| IT-07 | gatilhos auto-fail:reading (+ retry), auto-fail:planning, auto-plan-invalid (PLAN_INVALID), page-403; Home "Analysis failed" |
| IT-08 | PLAN_CHANGED, CLIENT 403 no start, clique duplo, travas variation_locked, ordem 9:16→4:5→1:1, render-fail + retry só do 4:5, leave-out, In zip (CLIENT), zip store com 2 pastas + README, reaproveita zipKey, downloadedAt, Home 1 vez, Library (filtro, formats, media, download ?format) |
| IT-09 | nothing_to_zip; colisão do adName → `_2` |
| IT-10 | Library → Vary: cria campeão OWN; 2ª vez nasce PLANNING sem nova análise; imagem = not_a_video |
| IT-11 | D4: NO_PRODUCT_PHOTO, PUT/DELETE product-image, retry com foto (`top.kind = product_photo`) |
| IT-12 | isolamento: 9 rotas com token de B = 404, banco de A intacto; lote MANUAL = 404 em /iterate |
| IU-01/02 | navegador EN e PT-BR: upload pelo input → plano → Generate → falha + Retry → Download → preview → In zip → Download zip (arquivo PK com o nome do contrato) |
| IU-03 | >1 oferta (seletor), Leave out, Library "Use this" |
| IU-04 | CLIENT: o que a tela oferece; In zip e zip pelo CLIENT |
