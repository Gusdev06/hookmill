# QA amostra grátis + templates Meta + Still working + CPA · 2026-10-29 · maquina-qa
Escopo: working tree do `main` (nada commitado). Banco `maquina_test`. API de teste na 3141 e web na 3236, as duas derrubadas no fim. Configuração: `META_MODE=mock`, `META_CRON=off`, IA em mock, render fake. Nada pago, nada no `maquina` nem na 3001.

## Resumo (5 linhas)
1. Amostra funciona de ponta a ponta em 1440 e 390: conta nova SAMPLE e OWN, 4 peças grátis (HEADLINE ×2, CHAT_DM, PERSON_MOTION), prévia 480p e todas as rotas por `:id` com 402. O admin INTERNAL libera em Settings e as mesmas 4 peças destravam sem render novo. A 2ª amostra mostra "You already used your free sample".
2. **Furo de paywall [backend]:** `POST /meta/publish-batch` publica as peças travadas da amostra: 202 e 4 anúncios criados PAUSED no mock.
3. **Regressão corrigida [backend, custos]:** o teto de gasto mensal via US$ 0 em todo workspace normal. Corrigi `custos.service.ts`.
4. Templates (criar o padrão pela tela, importar, publicar 1, lote de 10 → 8+2 numa campanha só), "Still working" e faixa de CPA passam em 1440 e 390.
5. Suíte da API: as falhas que restam já existiam antes destas mudanças (lista abaixo). tsc api/web/contratos ok, lint web com 0 erros, `db:diff` vazio.

## Falhas
**F1 [maquina-backend] publish-batch ignora a amostra travada.** `api/src/meta/publicacao.service.ts` (`publishBatch`, ~l.314) não chama `AmostraService`. O `SampleCreativeGuard` só cobre as rotas `/creatives/:id/...`.
Repro: conta nova SAMPLE e OWN → amostra pronta → conectar a Meta mock → `POST /meta/templates` → `POST /meta/publish-batch { creativeIds: <peças da amostra>, templateId }` → **202**, 4 `meta_publications` PAUSED (com a Meta live, seriam anúncios reais).
Esperado: 402 `locked`. Spec: `testes/specs/qa-2910/amostra-templates.spec.ts` (soft assert "publish-batch deveria dar 402").

**F2 [maquina-backend] (corrigido por mim, revisar) gasto do mês ignorava custos ligados a lote ou criativo.** Em `custos.service.ts › monthSpent`, `NOT: SAMPLE_COSTS` com o filtro JSON `settings.sample` dá NULL em lote sem a chave, e `NOT(NULL)` descarta a linha.
Prova: `pecas.int` com 0,80 em `cost_entries` e `monthSpent = 0`; `SPEND_CAP_EXCEEDED` não disparava e um 1:1 extra entrava no zip (13 → 14 arquivos).
Correção: total − soma da amostra (`OR: SAMPLE_COSTS`). Mock do `custos.service.spec.ts` ajustado. Agora `pecas.int` 10/10, `amostra.int` ok e `custos` 6/6.

## Suíte da API
| | resultado | falhas |
|---|---|---|
| unit | 1496/1498 antes | `cliente.spec` (**regressão do CPA**: faltava `targetCpa: null`, corrigido) e `frame.spec:85` CAPTION_PROTECTED (pré-existente: `frame.ts` não mudou hoje, mudou no commit 1a4edff de 28/10) |
| integração (série, `maquina_test`) | 172/181 | `iteracao.int` ×3: pré-existentes, todas do `ITERATE_TEMPLATES=on` (com `=off`, 18/18); `b2-fluxo.int` ×1 e `app.int` ×1: pré-existentes (o `walking_quiz` já está no HEAD); `pecas.int` ×3: **regressão F2**, corrigida |
| 18 specs com `access: 'INTERNAL'` | rodaram | sem falha atribuível ao `access` |

## E2E no navegador (`qa2910-1440` e `qa2910-390`)
- Amostra: `/auth/me` = SAMPLE. 4 peças, nenhuma STATIC, `locked`, `files: []`. Prévia h264 480x854.
- Blur: o render fake é um quadro liso, então a prova roda a mesma `gerarPrevia` no podcast real. `blurdetect` 0,2–2,8 s = 6,1 contra 3,5–7,5 s = 29,8. Os quadros estão em `test-results/qa-2910/<proj>/previa-podcast-*.png`.
- 402 `locked` em: zip, formatos, retry de peça, `GET /creatives/:id`, editor, edit, download, publish, `/files/:id` e `POST /iterate {championId}`.
- Library sem a peça. `GET /creatives` lista o criativo, mas sem URL de mp4.
- Destravado: zip 202, detalhe 200, renders 4 → 4.
- Templates: o padrão sai CBO, REUSE, 4–8 e US$ 20/dia. O import do mock abre preenchido com "Not copied". Publicar 1 dá PAUSED e grava `reuseCampaignId`. O lote de 10 vira 2 ad sets (8 e 2, o 2º `belowMin`), na mesma campanha.
- Still working: `config.running` tem o lote; aparece o cartão com Open e a linha do Meta "Open — working".
- CPA: faixa inválida trava a tela; PATCH 400 em min>max, min=0 e moeda inválida; null volta pra 200; nó Goal do Brain = "CPA 100–150 USD".
- Telas: `testes/test-results/telas/qa2910-{1440,390}/`.

## Não testado
- Seletor de template na tela Send: o criativo escolhido já estava publicado, então a tela mostrou o resultado e não o formulário.
- "Send to Meta (N)" do Download com um lote destravado.
- Meta live (import e estrutura), SSE com URLs, `SAMPLE_DAILY_MAX` (fora do escopo).
- A prévia sobre um render real da API (o render fake é liso; a função foi provada no podcast).
- Nota de UX: workspace sem mercado abre o template com Locations vazio, e o Save cai na aba Ad set com erro. É coerente, mas a pessoa não entende de cara.

## Mudanças minhas
- `testes/`: `harness/db.ts` (personas INTERNAL), `playwright.config.ts` (projetos qa2910), `specs/qa-2910/amostra-templates.spec.ts`.
- `api/`: `src/custos/custos.service.ts` + `.spec.ts` (F2) e `src/workspaces/cliente.spec.ts` (targetCpa).

Rodar: `cd testes && E2E_API_PORT=3141 E2E_WEB_PORT=3236 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261029000200_amostra_e_meta_templates E2E_LIMITES_V2=1 E2E_COM_WEB=1 npx playwright test --project=qa2910-1440 --project=qa2910-390`
