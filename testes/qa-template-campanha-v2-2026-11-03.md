# QA Q1 · template de campanha v2 (meta-templates-v2) · 2026-11-03 · maquina-qa
Escopo: working tree do `main` (nada commitado). Tudo em mock, gasto zero: API do QA na **3161** (`META_MODE=mock`, `META_CRON=off`, `maquina_test`, build próprio em `testes/.cache/api-qa`) e web de teste na **3256** (next dev, **sem MSW**, ligado nessa API). Nenhuma chamada à Graph real. Nada na 3000/3001 nem no banco `maquina`. As duas portas foram derrubadas no fim, e o `web/tsconfig.json` foi restaurado com `git checkout` (o next dev e o next build acrescentam `.next-qa-*`). O `next-env.d.ts` não mudou.

## Resumo (5 linhas)
1. **A API v2 funciona em mock:** o CRUD com os 6 campos, as 34 regras do §3 (400 com o `field/rule` certo), o 422 do mínimo do total (diário × dias), as 3 listas, a importação (Awareness, total, públicos, idiomas) e as permissões passam (API 7/7).
2. **A porta recebe o corpo certo:** espiei os corpos Graph do mock por HTTP. Total na campanha (CBO) ou no conjunto (ABO), `end_time`, `start_time` só quando é futuro, `locales`, públicos, `instagram_user_id`, REACH/IMPRESSIONS/`page_id` e `ON_VIDEO`/`ON_POST`. O template v1 sai sem nenhuma chave nova.
3. **Navegador, 1440 e 390:** passam F1, os 6 campos com a prévia do @, ABO, o erro de envio que reabre o editor no nível certo, e F2 com Import e Custom. Nenhuma tela rola na horizontal. O console fica limpo, fora os 400/422 esperados.
4. **Bugs:** **F4 está quebrado.** Com a Meta expirada o editor não abre (nem o novo), porque `GET /meta/templates` responde 422. O resumo de template v2 no Settings e no lote mente ("CBO —/day · Link clicks"). As pendências 1 a 3 se confirmam.
5. **Suíte:** tsc ok nos 5 workspaces. Lint com 0 erros (2 warnings). `next build` ok. Jest unit da API 1621/1621, video 88/88, integração da API 212/212 em série (1 pulado).

## Veredito por item
| # | item | veredito | prova |
|---|---|---|---|
| 1a | CRUD com os 6 campos (Awareness/Engagement + goal, LIFETIME, agendamento AT/AFTER_DAYS, idiomas, Instagram, públicos incluir/excluir) | **passa**. POST 201 devolve igual. Engagement aceita THRUPLAY/2s/POST_ENGAGEMENT/null. PATCH pra ABO+LIFETIME+REUSE dá 200. O v1 continua sem as chaves novas no `present()` | API teste 2 |
| 1b | Validações §3 | **passa**, 34 casos: `isIn` (objetivo, budgetType, goal), `isInt` (diário, total, AFTER_DAYS 0/366), `zeroForLifetime`, `notAllowed`, `lifetimeCboNeedsNewCampaign`, `notForObjective` (goal em Sales; pixel ou só evento em Awareness/Engagement → `adset.pixelId`), `isLocalDateTime` (data inválida, com offset), `inPast` (início, fim AT), `minDuration24h` (< 24 h, fim ≤ início), `requiredForLifetime`, `isLocaleList`, `isAudienceList`, `includedAndExcluded`, `isInstagramAccount`, `notAvailable` com `ig_mock_gone`/`ca_mock_gone` (incluir e excluir) | `evidencias.json › validacoes` |
| 1c | Mínimo do total | **passa**: 3499 em 7 dias dá 422 `{minimumMinor:3500, currency:'USD', budgetType:'LIFETIME', days:7}`, e 3500 dá 201. AT→AT de 3 d 1 h dá `days:4`. Início null + AT a 2,5 d dá `days:3`. O DAILY continua `{minimumMinor:500, currency}`. Ordem certa: 400 antes do 422. ABO+LIFETIME+REUSE dá 201 | API teste 3 |
| 1d | 3 listas + `minDailyBudgetMinor` | **passa**: IG PAGE primeiro (`ig_mock_page`, `ig_mock_1`) com `pageLookup:'ok'`. Públicos com `usable` certo (small/flagged = false). 8 idiomas em ordem de nome, com 6 e 24. `minDailyBudgetMinor:500` e fuso `America/New_York`. MEMBER recebe 200, CLIENT 403 e sem token 401 | API teste 1 |
| 1e | Importação | **passa**. `mock_cmp_awareness` vira AWARENESS + REACH + pixel null + `@hookmill.demo` + LEARN_MORE, e salva com 201. `mock_cmp_life` vira LIFETIME 30000 + NEW_CAMPAIGN + AFTER_DAYS 30 com `adjusted` ("Ran 2026-10-24 – 2026-11-23 → runs 30 days"), e salva com 201. `mock_adset_cbo_1` copia idioma, públicos e AFTER_DAYS 7, e manda `flexible_spec` e cidade pra `unsupported`. Objeto inexistente dá 404 | API teste 5 |
| 1f | Publicar v2 (lote LIFETIME + AFTER_DAYS) | **passa**: lote de 3 com 1 campanha (`lifetime_budget:30000`, sem `daily_budget`) e 1 conjunto (`end_time` ≈ agora + 7 d, sem `start_time`, `locales:[6,24]`, públicos, REACH/IMPRESSIONS, `promoted_object.page_id`, sem `destination_type`). 3 criativos com `instagram_user_id:'ig_mock_1'` (sem `instagram_actor_id`). `endTime` igual em todo o lote, gravado em `settings` | `evidencias.json › lote v2` |
| 1g | Outras formas na porta | **passa**: ABO+LIFETIME põe o total no conjunto e `start_time` com offset `+0000`, com fim − início = 4 d exatos. Engagement THRUPLAY vai com `ON_VIDEO`, POST_ENGAGEMENT com `ON_POST`. Início salvo no passado vira "agora" (sem `start_time`). `[mock:meta-destination]` dá FAILED com "destination_type not available…" | API teste 6 |
| 1h | Template v1 publica igual a antes | **passa**: `settings` sem nenhuma das 9 chaves novas. Campanha com `daily_budget` e conjunto com `OFFSITE_CONVERSIONS` + pixel. Sem `start/end_time`, `locales`, públicos, `lifetime_budget` e `instagram_user_id` | API teste 6d |
| 1i | Gate do envio | **passa**: IG sumido dá 400 `ad.instagramAccount/notAvailable` + `templateId`. Público sumido dá `notAvailable`. Fim AT a 3 h dá `minDuration24h`. Fim vencido dá `inPast`. Total baixo dá 422 com `days:7`, tanto no 1 quanto no `publish-batch` | API teste 6e |
| 1j | Permissões | **passa**: CLIENT recebe GET 200 e 403 em POST/PATCH/DELETE/import/publish/publish-batch. MEMBER cria. B não vê o template de A e recebe 404 em PATCH/DELETE/publicar com o template de A. A publicar criativo de B dá 404. 0 publicações em B | API teste 7 |
| 1k | Custom não aceita objetivo novo (P4) | **passa**: 400 `objective/isIn`. Na tela o Custom continua no seletor, com o formulário de antes | API teste 3, `f2-02-custom.png` |
| 2a | **F1** sem template, editor, salvar, publicar | **passa** nos 2 tamanhos: cartão vazio, editor com a faixa azul, nome "Tests · CBO 4–8 · US", padrão marcado e travado, **orçamento vazio**, **REUSE padrão**. Save sem orçamento fica na Campanha com "Enter a daily budget." e a bolinha 1. "Below Meta's minimum… $5.00" + "Use $5.00". Salvar volta com `?template=<id>` + toast. Publicar sai PAUSED com `template_id` | `f1-01…06.png` |
| 2b | 6 campos pela tela + prévia @ | **passa** nos 2 tamanhos. Awareness + Lifetime trava "A new campaign for each batch" com a explicação. Pixel some e aparece Performance goal. 7 dias ("Ends 7 days after it starts", fuso da conta). Idioma, incluir LAL, excluir Buyers, aviso de Advantage+ e selo "Not usable". Hint "At least $35.00 for 7 days". Prévia com `@hookmill.demo`. Árvore: "Awareness · CBO $300.00 total / Maximize reach · 7 days · US · 18–65 · EN · audiences +1 −1 / @hookmill.demo". Salvo igual ao contrato, e o corpo na porta tem total, `end_time`, `locales`, públicos e IG | `v2-01…06.png`, `v2.json` |
| 2c | ABO move o orçamento | **passa**: desligar Advantage+ tira o orçamento da Campanha e cria "Budget & schedule" com "Daily budget per ad set". Save no nível Ad com orçamento vazio pula pro **Ad set** e o nó do Conjunto ganha a bolinha. Engagement tira o pixel e Sales devolve. Lifetime sem fim mostra "A lifetime budget needs an end." | `abo-01…05.png` |
| 2d | Erro do envio pula pro nível | **passa**: IG sumido mostra o alerta, e Edit template abre no **Ad** com "Not in this ad account anymore. Pick another." e a prévia `@gone.acct`. Fim vencido abre no **Ad set** com "That time has already passed." | `env-01…03.png` |
| 2e | **F2** seletor | **passa**: "QA padrão (default)" pré-selecionado, opções [padrão, segundo, Custom]. Edit abre com os dados e New template vem com o padrão desmarcado. Import abre o editor com o diálogo, `mock_cmp_life` → "Copied from…" + "Adjusted: …30 days" + total 300 + NEW travado. Salvar volta selecionado (`source: IMPORTED`) | `f2-01…06.png` |
| 2f | **F3** Settings | **passa no fluxo**: migalha Settings › Templates, sem Import, com Archive. Salvar volta pra lista e preserva os campos v2. Archive mostra o toast e o template sai da lista. **Falha no resumo**: bug F2 abaixo | `f3-01…03.png` |
| 2g | **F4** Meta expirada | **falha** (bug B1): o envio mostra "Your Meta login expired" + "Reconnect with Facebook" e esconde o Publish (ok), mas **não há Edit**. O editor (novo ou existente) abre "Couldn't open the template · Your Meta login expired" em vez do editor com a faixa âmbar | `f4-01…03.png`, `f4.json` |
| 2h | 390 sem rolagem lateral | **passa**: `scrollX` = 0 depois de `scrollTo(400)` em 13 telas (envio, editor nos 3 níveis, diálogo, Settings, expirado) | `*.json` do 390 |
| 2i | Console | **passa**: só aparecem os 400 do publish de propósito e os 422 do F4 (bug B1). Nenhum `pageerror` | `*.json` |
| 3 | Pendências dos agentes | 1 **confirmada** (o seletor do import não lista Awareness; `GET /meta/campaigns` sem `mock_cmp_awareness`). 2 **confirmada e pior que o descrito** (bug F2). 3 **confirmada**: o diálogo é o antigo, com busca e "Use" por linha, sem os níveis Campaign/Ad set/Ad, sem "Reading…" e sem sheet no 390 (`f2-04-importar-dialogo.png` do 390). 4 **não testado** (lote do Iterate no navegador). 5 **confirmada**, com efeito real: bug B2 | — |

## Bugs (prioridade)
**B1 [alta · maquina-backend (+ maquina-frontend) · F4 quebrado] Com a Meta expirada o editor de template não abre.** `GET /meta/templates` responde **422 `META_TOKEN_INVALID`** quando a conexão está `TOKEN_INVALID`, porque `MetaTemplatesService.list` → `selected()` → `conexao.usable()`. O contrato v1 só prevê `META_SELECTION_MISSING` nessa rota. O `/meta/locales` (e as outras listas) também dá 422, o que aí é esperado. O editor trata o erro da lista como fatal.
- Repro: conectar a Meta (mock) e criar um template. Depois `update meta_connections set status='TOKEN_INVALID'`, abrir `/creatives/<id>/send` e então `/publish/template/<id>?return=…` ou `/publish/template/new?return=…`.
- Visto: no envio não há "Edit". O editor mostra "Couldn't open the template. Your Meta login expired." + Retry.
- Esperado (spec §3 F4 e §6): o envio mostra o alerta + Reconnect, Publish desabilitado e **Edit**. O editor abre com a faixa âmbar "Meta connection expired.", Save desabilitado e o rascunho mantido.
- Sugestão (decisão do arquiteto): a lista lê do banco sem exigir token válido (só a seleção), e o editor não trava se as listas de IG/públicos/idiomas falharem.
- Prints: `testes/test-results/qa-0311-telas/qa0311-1440/f4-01-send-expirado.png`, `f4-02-editor-novo-expirado.png`, `f4-03-editor-existente-expirado.png` (e os mesmos no `qa0311-390/`).

**F2 [média · maquina-frontend] O resumo de template v2 em Settings › Templates e no diálogo do lote mostra dados errados.** `useTemplateSummary().line()` (`web/src/hooks/use-meta-templates.ts:83-96`) não conhece os campos v2. Com LIFETIME o `dailyBudgetMinor` é 0 e sai "CBO —/day". Com Awareness/Engagement não há pixel e sai "Link clicks". Não mostra total, dias, idiomas, públicos nem @. O mesmo `line()` alimenta o diálogo do lote (`batch-send.tsx:216`).
- Repro: criar um template Awareness + LIFETIME 300 + AFTER_DAYS 7 + EN + IG e abrir `/settings/connections/templates`.
- Visto: "New campaign each batch · CBO —/day · Link clicks · US, 18–65 · Advantage+ audience · auto placements · 4–8 ads".
- Esperado (contrato §8): "Awareness · CBO · US$ 300 total", "Reach · 7 days · US · EN · +N audiences", "@conta". O envio de 1 peça (`TemplatePublish`) já faz isso certo e dá pra reaproveitar.
- Print: `testes/test-results/qa-0311-telas/qa0311-1440/f3-01-lista.png`.

**B2 [média · maquina-backend] O PATCH salva um template que já não publica.** Um PATCH que não manda `adset`/`ad` não rechecа o relógio (`inPast`/`minDuration24h`) nem o `notAvailable` (`templates.service.ts › check`, `touched`). O próprio código diz que é de propósito ("um template salvo não vence por mudar só o nome"). O efeito:
- Com IG sumido + fim AT vencido no banco, um PATCH `{name}` dá **200** e um PATCH `{campaign:{… dailyBudgetMinor:2500}}` também dá **200**.
- Quando a campanha muda pra LIFETIME, o mínimo do total usa `days` do fim já vencido. Como `days` sai `null`, a checagem do mínimo é pulada.
- A publicação barra depois, com 400 `inPast` + `templateId`, então nada quebra na Meta. O problema é o "Saved" verde de um template que não serve.
- Decisão do arquiteto: aceitar (como hoje) ou rechecar ao menos quando `campaign.budgetType`/total mudam.
- Repro: API teste 4 (`evidencias.json › "PATCH só nome…"` e `"PATCH só campanha…"`).

**F3 [baixa · maquina-ia (mock)] Não dá pra importar a campanha de Awareness pelo seletor.** `MOCK_IMPORT_ONLY` deixa `mock_cmp_awareness` fora do sync, então `GET /meta/campaigns` (o diálogo) não lista. Só dá pra importar pela API direto. É só no mock, mas por isso **o caminho "importar Awareness pela tela" nunca foi visto**.
- Repro: Import no editor. A lista tem Prospecting, Testing e Launch, sem "Brand awareness" (`f2.json › tem Awareness: false`).

**F4 [baixa · maquina-frontend] O diálogo de importar não é o do mockup.** O mockup tem nível Campaign/Ad set/Ad, escolha por rádio, Cancel/Import e "Reading…" durante a leitura, e sheet de baixo no celular. O implementado tem busca + "Use" por linha e Dialog centralizado também no 390. Funciona (F2 passou nos 2 tamanhos). Falta decidir se fica assim.

**F5 [baixa · maquina-frontend, texto]** A faixa do import mostra o nome técnico: "Adjusted: **adset.schedule**: Ran …". O diálogo mostra "1 ad **sets**". `ruleMessage` traduz qualquer `isAudienceList`/`isLocaleList` como "Up to 20/50", inclusive quando o problema é id repetido ou longo.

**B3 [baixa · maquina-backend, texto]** O 422 `META_BUDGET_TOO_LOW` do LIFETIME vem com `message: "Daily budget is below the minimum for this account."`. A tela usa `details` e mostra o texto certo, mas a mensagem da API está errada pro total.

**Observação (sem bug):** trocar o objetivo pra Awareness mantém o CTA "Shop now" que já estava. O contrato só põe LEARN_MORE como padrão quando não há CTA (import/publicação). No 390 o rodapé não mostra "N fields need attention": o erro aparece na bolinha da aba (desenho do §10).

## Suíte
| comando | resultado |
|---|---|
| `npm run typecheck -w contratos/api/web/video/testes` | 5 × exit 0 |
| `cd web && npx eslint` | 0 erros, 2 warnings |
| `cd web && NEXT_DIST_DIR=.next-qa-build npx next build` | exit 0 (rotas `/publish/template/[id]` e `/settings/connections/templates/[id]` compiladas); `tsconfig.json` restaurado, `.next-qa-build` apagado |
| `cd api && npx jest --testPathIgnorePatterns '\.int\.spec\.ts$'` | **107 suítes, 1621/1621** |
| `cd video && npx jest` | 4 suítes, 88/88 |
| `cd api && npx jest --runInBand --testPathPattern '\.int\.spec\.ts$'` (26 suítes, **em série**: todas usam o mesmo `maquina_test` e o reset de uma apaga o dado da outra) | **25 suítes passam e 1 é pulada: 212 passam, 1 pulado, 0 falhas** (inclui `meta-templates.int` e `meta.int`) |
| Playwright `playwright.qa0311.config.ts` (api + 1440 + 390) | **17 passam, 4 falham**: F3 ×2 (o resumo v2, bug F2) e F4 ×2 (bug B1). O fluxo do F3 passa |
| Specs Playwright antigos (qa-2910, qa-0111) | não rodei: o template v1 deles foi coberto pelo teste 6d e pelo F1/F2 contra a API real |

## Não testado
- **Sonda real na Graph (Q2/P3, parada pelo Gusta).** Nada aqui prova que a Meta aceita esses corpos (riscos 1, 2 e 8 do §12: ON_VIDEO/ON_POST em beta, IG ligado à Página, nomes na v25).
- Lote vindo do Iterate no navegador (`batch-send.tsx`): só li o código, que tem o mesmo resumo do bug F2.
- Importar Awareness pela tela (bug F3) e importar no nível ad set/ad pela tela.
- Engagement e "On a date" (início/fim) preenchidos pela tela: cobertos só pela API.
- Conta `act_mock_2` (IG vazio, `pageLookup:'unavailable'`, hint "Don't see it?").
- Horário de verão na resolução do agendamento (fica no `templates.spec` do backend).
- Discard changes (AlertDialog) e rascunho em `sessionStorage` durante a reconexão (bloqueado pelo B1).

## Mudanças minhas (só `testes/`)
- `harness/api-qa-espiao.cjs` (novo): sobe o mesmo build/AppModule/configureApp da API do QA, com `/__qa/meta-sent` e `/__qa/meta-sent/reset` fora do `/api/v1`, que leem o `FakeMetaService.sent`. Só sobe com `META_MODE=mock`, nunca na 3000/3001.
- `playwright.qa0311.config.ts` (novo); `specs/qa-0311-api/templates-v2.spec.ts` e `specs/qa-0311/template-v2-ui.spec.ts` (novos).
- Nenhum código de produção alterado. Sem commit.

## Rodar de novo (de `testes/`)
- API: `E2E_API_PORT=3161 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261101000100_templates_cold_open_endcard npx playwright test -c playwright.qa0311.config.ts --project=qa0311-api`
- Navegador: o mesmo + `E2E_WEB_PORT=3256 E2E_COM_WEB=1` e `--project=qa0311-1440 --project=qa0311-390`. Depois: `git checkout web/tsconfig.json`.
- Evidência: `testes/test-results/qa-0311-api/evidencias.json`. Prints e notas: `testes/test-results/qa-0311-telas/qa0311-1440/` e `qa0311-390/`.

## Incidente da 3001 (~15:33)
A API do Gusta na 3001 caiu enquanto o meu jest de integração rodava, e o coordenador religou. Eu só matei os processos `scratchpad/servers.mjs`, `api-qa-espiao.cjs` e `next dev --port 3256` (~15:30). Nenhum desses padrões casa com `node dist/main.js`, e logo depois a 3001 (PID 40563) ainda estava de pé. Nenhum spec da API mata processo. A causa não está provada. Suspeito de carga da máquina durante o jest em série (`troca.int` levou 161 s). Daqui pra frente: matar só pelo PID do que eu subir.
