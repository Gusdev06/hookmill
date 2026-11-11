# QA Q1: Templates IA com prévias (templates-ia-previas-v1 §13), 07/11/2026

Dono: maquina-qa. Worktree `maquina-anuncios-wt-previas` (branch `with-ai-previas`). API do QA na **3151** (build próprio `testes/.cache/api-qa`, `INTEGRACOES_MODE=mock`, `RENDER_IMPL=fake`, `ANALYZE_IMPL=local`, `TEST_MODE=off`), web na **3246** (`NEXT_DIST_DIR=.next-qa`), banco **`maquina_previas_test`**. Nada pago, nenhuma chamada real. Não toquei no checkout principal, na 3001/3141 nem nos bancos `maquina`/`maquina_test`/`maquina_previas`.

## Reteste após as correções (07/11, 2ª rodada): VERDE, libera o T1

Os donos corrigiram tudo no worktree (sem commit). Retestei no mesmo ambiente (API do QA 3151, web 3246, `maquina_previas_test`, mock):

| item | resultado (comando + saída) |
|---|---|
| typecheck contratos/api/web | `npm run typecheck -w contratos -w api -w web` → EXIT 0 |
| unitários (B1) | `npx jest src/templates-ai src/creditos/regras.spec.ts src/integracoes/claude/semantic-v2.spec.ts` → 4 suites, **45/45** (antes 43/44) |
| regressão da API | `--project=qaprevias-api` → **7 passed (2.8m)** |
| **ALTO-1 reinício** | `reinicio.ts prep` → `kill -9` no node da API → `mutate` → API de volta → `check`: **R1 ok** (job inicial com `input {kind:'ai_previews'}` ficou QUEUED no boot, o sweep disparou → `SUCCEEDED`, lote `PLAN_READY` com 4 prévias). R2 ok (RUNNING → INTERRUPTED/PLAN_FAILED). R3 ok (novo ângulo retomado, ideia e elenco novos). R4 ok (rosto QUEUED → READY). R5 ok (vídeo no meio → done). Log do boot: `retomada: {"jobs":1,...}` (só o R2) |
| **MÉDIO-1 PT** | 390 e 1440 em PT, gatilhos `[mock:plan-few]` e `[mock:plan-one-fail]`: o card falho diz "Não conseguimos escrever um ângulo novo pra esta prévia. Nada foi cobrado por ela." com **um só** "Tentar de novo". O PLAN_FAILED diz "Não conseguimos escrever pelo menos 2 prévias a partir desta oferta. Nada foi cobrado. Tente com outro campeão…". O spec agora falha se aparecer inglês ou "Tentar de novo" repetido (`ui-1440-pt-13-plan-failed.png`, `ui-390-pt-14-previa-falhou.png`) |
| **B2 auto-avanço** | depois do Confirmar, a tela passa **sozinha** para o player com Download MP4 (o spec não clica mais em Watch; `ui-1440-en-8b-pronto-na-lista.png`). Volta ao player também depois do reload com 2 vídeos. O chip "Faces" saiu |
| B3 formato | o fluxo segue igual nas 4 combinações (o formato vem do `aiFormat`) |
| regressão UI | 1440 EN, 1440 PT, 390 EN e 390 PT: **2/2 em cada** (fluxo completo + estados de falha) |

Ajuste de teste nesta rodada: o "Novo ângulo" do teste de falha passou a clicar dentro do card A. Antes ele pegava o 1º botão habilitado, que às vezes era o de outra prévia. Era corrida do teste, não bug.
Continua sem teste o mesmo da 1ª rodada (falha de imagem pela oferta, cap de gasto, saldo insuficiente, Home "Waiting for you", player tocando). O visual do elenco (foto fixa no mock) fica para o T1. Limpeza feita de novo: API e web parados, `next.config.ts`/`tsconfig.json` revertidos, `.next-qa` apagado, workspaces `qprev*` removidos, templates em DRAFT/null.

---

## 1ª rodada (antes das correções)

### Veredito da 1ª rodada

**NÃO está pronto pro T1.** 1 falha ALTA: a retomada depois de reinício derruba o lote (o job inicial QUEUED vira PLAN_FAILED), e o contrato (§3.3, §9) põe isso como pré-condição. O resto passou: contrato das 4 rotas, idempotência, clique duplo, 2 abas, CLIENT 403, outro workspace 404, tetos 3/6 com scope, retry máx. 2 fora do teto, cobrança só na aprovação, estorno por peça, flag off e o fluxo inteiro na tela (1440/390, EN/PT). Depois da correção do ALTO-1, rodar de novo `reinicio.ts` (abaixo). Se der verde, libera o T1.

## Achados

### ALTO-1: reinício com o job inicial QUEUED marca o lote como PLAN_FAILED (dono: maquina-backend)
- **Esperado (§3.3):** job das prévias ainda QUEUED fica QUEUED, e o sweep dispara depois do boot.
- **Obtido:** o job vira `FAILED/INTERRUPTED` e o lote vira `PLAN_FAILED` (`ai.errorCode: INTERRUPTED`, `previews: 0`). Log do boot: `retomada: {"jobs":2,...}` (R1 + R2).
- **Causa:** o job inicial nasce em `api/src/iteracao/iteracao.service.ts:345` com `input: { batchId }`, sem o `kind: 'ai_previews'` do contrato §5.7. O filtro novo do `RecuperacaoService` (`isPreviewPlanJob`) só reconhece o job pelo `input.kind`, então o deixa cair no caminho genérico (`INTERRUPTED`). O int spec `templates-ai-previews.int.spec.ts` não pegou porque cria à mão um job com `kind: 'ai_previews'`, que a API nunca grava.
- **Reproduzir** (API do QA no ar: `testes/specs/qa-previas-api/api-qprev.sh on`):
  1. `node testes/specs/qa-previas-api/reinicio.ts prep` (cria lotes prontos)
  2. `kill -9 <pid do node .../testes/.cache/api-qa/dist/main.js>`
  3. `node testes/specs/qa-previas-api/reinicio.ts mutate` (o lote R1 volta a "/use aceito, planejador ainda não chamado": sem itens, PLANNING, o job **real** dele em QUEUED)
  4. subir a API de novo e rodar `node testes/specs/qa-previas-api/reinicio.ts check` → `R1: { jobAntes: FAILED, status: PLAN_FAILED, errorCode: INTERRUPTED, ok: false }`.
- **Correção sugerida:** gravar `kind: 'ai_previews'` no input do job do lote de prévias (o que o contrato manda), ou o filtro reconhecer o job pelo `settings.aiPreviews` do lote. E trocar o int spec para usar o job que a API cria.

### MÉDIO-1: motivo da falha em inglês na tela em PT e "Try again" repetido (donos: maquina-backend + maquina-frontend)
- O `failReason` sai fixo em inglês (`FAIL_TEXT` em `previews.service.ts`) e a tela mostra o texto cru (`ai-previews.tsx:319` e `:834`). Em PT aparece: "Could not write a new angle for this preview. Try again. Nada foi cobrado por ela." (screenshot `ui-390-pt-14-previa-falhou.png`).
- Em EN o texto repete: "Could not write at least 2 previews from this offer. Try again. Nothing was charged. Try again with another winner…" (`ui-1440-en-13-plan-failed.png`).
- Reproduzir: oferta com `[mock:plan-one-fail]` → Novo ângulo na A → card de falha. Oferta com `[mock:plan-few]` → PLAN_FAILED.
- Sugestão: a tela traduz pelo `errorCode`/`failStage` e o `failReason` fica para log.

### BAIXO
- **B1 (maquina-backend): o unitário `previews.spec.ts` está vermelho.** Em "producibleVariation v2", a fixture usa o mesmo elenco ("Maya") em todas as variações. O `cast_repeat` foi adicionado em `semantic-v2.ts` às 09:56 e passou a recusar "Three" e "Four". O spec está desatualizado, não é bug do produto. `npx jest src/templates-ai src/creditos/regras.spec.ts src/integracoes/claude/semantic-v2.spec.ts` dá 43/44.
- **B2 (maquina-frontend):** com todos os vídeos prontos, a tela segue com o título "Making 2 videos" e não passa sozinha para Assistir (estado 6 do mockup, "All ready"). Precisa clicar em Watch. O chip "Faces ×2" aparece, mas o design (§2.6) diz para manter só se o backend expuser a etapa, e ele não expõe (`ui-1440-en-11a-lista-tudo-pronto.png`).
- **B3 (maquina-frontend):** a tela descobre o formato pelo slug (`AI_PREVIEW_SLUGS` em `web/src/lib/ai-previews.ts` e `ad-step.tsx:103`). O comentário diz que a API não manda o formato, mas `TemplateCard.aiFormat` já sai na API (A2).

### Limites do mock (para o T1 conferir de verdade)
- O rosto do mock é **uma foto fixa** (mulher de regata preta) para todos os apresentadores, inclusive os masculinos (Bruno, Thiago). Em mock, "elenco diferente" e "voz no gênero do rosto" só são verificáveis pelos dados (nome, gênero, voz). Imagem do mock: 720×1280; Soul V2 real: 1152×2048.
- Os `changes[].before` do mock cortam a frase no meio ("…extra income with →"). É texto do fake (I1), não do planejador real.

## O que passou (com prova)

| área | prova |
|---|---|
| typecheck contratos/api/web | `npm run typecheck -w contratos -w api -w web` → EXIT 0 (`/tmp/qprev/typecheck.log`) |
| int specs do backend | `TEST_DATABASE_URL=…maquina_previas_test… npx jest --runInBand templates-ai.int templates-ai-previews.int` → 2 suites, 13/13 |
| API caixa-preta, 7 testes | `npx playwright test -c playwright.qaprevias.config.ts --project=qaprevias-api` → **7 passed (3.0m)** |
| flag off | API em `AI_PREVIEWS=off` + `Q1_FLAG=off` → **1 passed**: `/use` com `generation` = lote LAUNCHED → 1 MP4 (fluxo de 04/11), idempotente; `previews` = 400 notAllowed; approve/regenerate/retry em lote de prévias = 404; GET 200 |
| reinício (R2–R5) | após `kill -9` real: job RUNNING → INTERRUPTED + PLAN_FAILED (R2 ok); Novo ângulo QUEUED retomado com ideia e elenco novos (R3: "The doubt…"/Marina+Rafael → "The simplest first step"/Paula+André); rosto de prévia QUEUED submetido → READY (R4); vídeo aprovado em SCENES_GENERATING no kill termina `done` (R5) |
| UI 1440 EN, 1440 PT, 390 EN, 390 PT | `Q1_LOCALE=<en/pt> … --project=qaprevias-<1440/390>` → 2/2 em cada combinação (rodada final). Screenshots em `/tmp/qprev/shots/ui-*` |

O que os 7 testes de API cobrem:
- **`/use`:** requestId inválido 400, `generation` 400 notAllowed, sem `previews` 400, 2 fontes 400, CLIENT 403, campeão de outro workspace 404. Clique duplo com a mesma chave = 1 lote. Mesma chave com outro template = 409 `request_conflict`. A mesma chave em outro workspace não colide. Outro workspace: GET 404 e as 3 escritas 404. CLIENT lê (200) e leva 403 nas 3 escritas. Nenhuma linha de crédito.
- **Conteúdo, F04/F09/F10:** 4 prévias A–D, títulos e ângulos distintos, elenco único no lote (4 ou 8 nomes), vozes sem repetir, imagem pronta 9:16, limites de 60/140/240 caracteres, gancho = 1ª fala e diferente do campeão, F10 alternando host/presenter, `changes[].before` com ≥ 4 palavras e citando a fala real do campeão. `included: false`, `pieces: []` e 0 criativos antes da aprovação.
- **approve:** 6 corpos inválidos dão 400. Prévia de outro lote 404. `CREDITS_CHANGED {credits:5}`. Clique duplo = 1 RESERVE (saldo 50→45). Mesma chave com outro corpo 409 `request_conflict`. Prévia já aprovada 409 `preview_not_ready`. Regenerate de aprovada 409 `state: approved`. 2 abas com a mesma prévia: [202, 409 `preview_not_ready`]. Volta depois e aprova as outras 2 (3 aprovações). Assentado: `SETTLED charged 20 refunded 0`, saldo 30, 4 criativos.
- **Estorno:** `[mock:PROVIDER_ERROR]` na fala (imagens passam, lipsync falha) → peça failed, `phase: failed`, `SETTLED charged 0 refunded 5`, saldo volta a 50, 1 REFUND.
- **Novo ângulo:** clique duplo = 1 uso. 3 seguidos na A, cada um com elenco e título que nunca repetem os anteriores nem os de outra prévia viva. 4º = 429 `{scope:'preview',used:3,max:3}`. Prévia ocupada = 409. Lote = 429 `{scope:'batch',used:6,max:6}`. Elenco do lote segue único. 0 linhas de crédito.
- **Try again:** retry em prévia não falha = 409 `allowed:['FAILED']`. `[mock:plan-one-fail]` → failed/planning com `action: retry`, e o lote segue `previews_ready`. Clique duplo no retry = 1 uso. 2 retries; o 3º = 429 `{scope:'retry',used:2,max:2}`. `regenUsed` continua 1 (fora do teto). Approve de prévia failed = 409.
- **Planejador:** `plan-few`, `plan-fail` e `plan-refusal` → PLAN_FAILED com errorCode/failReason, e approve 409 `state: PLAN_FAILED`. `plan-three` → PLAN_READY com 3 prévias.

O que a UI cobre (por combinação): galeria With AI → detalhe → winner (dica dispensada) → **duplo clique em Make 4 previews = 1 lote** → 4 cards → Novo ângulo na A (elenco e título mudam, `previewRegens 1`) → aprovar B → Make 1 video → Confirmar (**duplo clique = 1 criativo**) → produzindo → Watch → Download MP4 → **Make them too** (volta com A/C/D marcadas e B "Video made") → só C → 2 vídeos → reload → Watch/Download → Biblioteca com 2 criativos aprovados. Sem rolagem horizontal em galeria, prévias, assistir e biblioteca. Título do ângulo no idioma da interface (PT: "A dúvida que trava a decisão") e gancho no idioma do campeão (EN). Falhas: tela PLAN_FAILED ("Pick another winner"/"Escolher outro campeão"). Card de prévia falha com Try again, que falha de novo e some depois de 2 usos.

Instabilidades de teste corrigidas no spec (não são bugs): a resposta 202 do `/use` às vezes já traz prévias `planned` (o mock responde na hora); os cards em espera também têm o checkbox "Approve" desabilitado, então o clique em "Novo ângulo" passou a ser feito dentro do card A. Houve 1 instabilidade não explicada a 390 EN (o Watch não apareceu em 25 s depois do reload, com o dev server compilando); passou na nova rodada.

## O que não foi testado
- Falha de **imagem** pela oferta: o mock não tem gatilho de rosto controlável pela oferta. Só o int spec cobre, mexendo direto no banco. Também ficaram de fora o timeout de 10 min da imagem e o reconciliador de `provider_tasks` com task desconhecida.
- `SPEND_CAP_EXCEEDED`, `INSUFFICIENT_CREDITS`, `PAYMENT_REQUIRED` e `OFFER_INCOMPLETE` no approve e no `/use`. Também `503 PROVIDER_UNAVAILABLE`.
- Home "Waiting for you" e `phase/approvable` na lista (adiados na A2). Retry de peça de vídeo falha pela tela.
- O player tocando o MP4 (o screenshot pegou o spinner) e o sheet de Confirmar a 390, visto só em captura de página inteira. Comparação pixel a pixel com o mockup: visual conferido nos screenshots, não por diff.
- Typecheck do `testes/`: já falha na f1b por erros fora desta frente.
- Geração real: é o T1, depende do ok do Gusta.

## Arquivos e comandos
- Specs: `testes/specs/qa-previas-api/{fx.ts,previas-api.spec.ts,flag-off.spec.ts,reinicio.ts}`, `testes/specs/qa-previas-ui/previas-ui.spec.ts`, `testes/playwright.qaprevias.config.ts` (sem globalSetup: não dá TRUNCATE no banco compartilhado com os int specs; cada spec cria e apaga os próprios workspaces).
- API do QA: `testes/specs/qa-previas-api/api-qprev.sh on|off` (cópia de `/tmp/qprev/api.sh`), um wrapper do `node testes/harness/api-qa.mjs`: porta 3151, `maquina_previas_test`, chaves pagas vazias.
- Web: `cd web && NEXT_PUBLIC_API_URL=http://localhost:3151/api/v1 NEXT_DIST_DIR=.next-qa npx next dev --port 3246`. O `turbopack.root` foi posto no `next.config.ts` só durante a sessão e **revertido**. O `next dev` acrescentou uma linha ao `web/tsconfig.json`, também **revertida**.
- Limpeza: API e web parados, `web/.next-qa` apagado, workspaces `qprev*` removidos do `maquina_previas_test`, os 3 templates de volta a `DRAFT`/`credits null`. Sem commit.
