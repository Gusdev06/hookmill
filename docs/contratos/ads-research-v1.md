# Meta Ads Research (pesquisa de concorrentes na Ad Library) — contrato v1
Data: 2026-11-04 · Dono: maquina-arquiteto · Status: **APROVADO pra construir (04/11, noite), em `ADS_RESEARCH_MODE=mock`. Comece pela seção "Construção 04/11" logo abaixo: ela vale por cima do resto.** Nome na UI: **Ad Radar** (`/radar`). Sondas: [R0](ads-research-r0-2026-11-04.md) (US$ 0,155), [R1](ads-research-r1-2026-11-04.md) (US$ 1,42).
Origem: pedido do Gusta de 04/11 ("uma seção na sidebar que traz TODOS os anúncios da Biblioteca de Anúncios dos principais concorrentes do cliente, pra pesquisar e transformar em campeão/template").
Fontes lidas: `api/src/integracoes/adlibrary/ad-library.service.ts` (porta Apify do campeão por link), `docs/integracoes.md` §Ad Library, `feature-2-variar-campeao.md` (D1: nada trava por `rights`), `templates-creditos-v1.md` (créditos, quem paga), `agencia.ts` (`BusinessSuggestion.industry/market`), `projects/mentoria-spy/ad-radar/README.md` (método e custos), `decisions/log.md` do AIS-OS (21/10: ad-radar desligado por estourar a Apify), `reports/superscale-reverse-engineer-2026-10-29.md`.
Convenções, envelope e erros: [`api.md` §1](api.md). Tempo real: **polling** (§8). Tipos: `contratos/src/research.ts`.

## Construção 04/11 (noite) — APROVADO pra construir; vale por cima de TODO o resto deste arquivo
Liberação do Gusta (04/11): construir o **Ad Radar** com o mockup aprovado (https://claude.ai/artifact/TJQ1xyEsLUyR8wk5oN7WaP, v2; fonte `design/mockup-ads-research.html`) em **`ADS_RESEARCH_MODE=mock`**. Live só com a conta Apify própria (R7). Onde a spec de design (`design/ads-research-2026-11-04.md`) divergir deste contrato, vale o contrato (a própria spec diz isso).

### C.1 Nome, rotas e onde mora
| o quê | valor |
|---|---|
| Nome na UI | **Ad Radar** (EN) · **Radar de anúncios** (PT-BR); i18n no namespace `radar.*` |
| Rota web | **`/radar`** (`web/src/app/(app)/radar/`); detalhe = `Sheet` na mesma rota (`/radar?ad=<id>`), sem rota própria |
| Sidebar | **topo do grupo "Make ads", acima de Templates** (NavKey `radar`, ícone de radar). `ADS_RESEARCH_MODE=off` → item com "Soon" |
| API | continua **`/research/*`** (nome interno; não renomear). Módulo `api/src/research/`; tipos `contratos/src/research.ts` |
| Removidos | **dentro do Ad Radar** (menu da barra de concorrentes → "Removidos (n)", `Sheet` com Desfazer), não em Configurações (§2.5 antigo): fica onde a pessoa removeu e não mexe em `settings/` |
| "Use as champion" | abre **`/templates?researchAdId=<id>`** com a faixa fixada (mesmo padrão do vencedor da Meta). Templates ganha a aba **"Saved ads"** no passo do anúncio, lendo `GET /research/ads?saved=true` |

Endpoints que a spec de design §8 imaginou e **não existem** (usar o equivalente): `GET /research/suggestions` e `POST /research/competitors/resolve` → não há (descoberta automática, G2); `GET /research/limits` → `GET /research/status`.limits; `DELETE /research/competitors/:id` → `POST …/dismiss`; `POST …/:id/sync` → `POST …/:id/refresh`; `POST /research/ads/:id/champion` → `researchAdId` em `fits`/`use`/`iterate` (§6.1). Polling a **3 s** (§8), não 5 s. "Reading 18 of ~40" no chip não existe (o actor não dá progresso): chip mostra "Syncing…".

### C.2 Direto × vizinho (decisão do Gusta, 04/11)
- O juiz (D4) devolve `relation: 'direct' | 'adjacent' | 'none'` por Página (no lugar de `sameNiche`). **direct** = mesmo tipo de produto pro mesmo público; **adjacent** = mesmo público com produto vizinho (ex.: app de orçamento × score de crédito); **none** = outro público, varejista genérico, mídia, o próprio cliente, Página descartável ou golpe.
- **Aprovado** = `relation ≠ none` e `score ≥ ADS_RESEARCH_MIN_SCORE` (50).
- **Ordem do D5:** `relation` (DIRECT antes de ADJACENT) → faixa de 10 do `score` → anúncios vistos → anúncio mais antigo.
- **Seleção dos seguidos:** só Página com **≥ 2 anúncios** na amostra; enche as vagas com diretos e só completa com vizinhos se faltar direto. Página com 1 anúncio vai só pra reserva.
- **Reserva** (até 10): o resto dos aprovados na mesma ordem (diretos primeiro). Remover qualquer seguido → entra o 1º da reserva **que tenha ≥ 2 anúncios vistos**; sem ninguém assim, entra o 1º da reserva (a importação diz quantos tem).
- **Seguido nunca sai** por descoberta nova (§2.1): um vizinho seguido não é trocado sozinho por um direto achado depois; o direto novo vai pro topo da reserva.
- `Competitor.relation` e `nicheScore` gravados ao seguir (MANUAL = DIRECT). Na UI: a barra lista **diretos primeiro** (depois por `counts.active` desc); vizinho ganha a pílula **"Adjacent niche" / "Nicho vizinho"** e o "por que este" diz a ponte. O grid de anúncios não muda de ordem por relação (segue `sort`).

### C.3 Pipeline da descoberta — regra final (substitui o §2.2; origem: R1 §8)
| etapa | regra |
|---|---|
| **D1 propor** | `ADS_RESEARCH_PROPOSE_MODEL` (`claude-sonnet-5-5`), effort `medium`, `json_schema` estrito, sem busca na web. Entrada: resumo do Brain, `blocked` (Páginas e domínios removidos), `reuseTerms` (os termos da memória, pra não repetir). Saída: `countryCode` + `countryReason`; **até 6 marcas "que você sabe que anunciam nesse país"** (`{ brand, domain, why }`, 0 é válido; nunca o cliente); **6 termos de 2–3 palavras tipados** (`promise` ×2, `product` ×2, `pain` ×2) com o jargão literal dos anúncios do nicho, sem marca. Prompt agnóstico (o nicho vem só do Brain). |
| **D2 confirmar marca** | Por marca: `KEYWORD`, `searchType: 'unordered'`, `q=<domínio>`, país, `limit=10`. Página = a com mais anúncios linkando o domínio; **senão, a Página cujo nome contém a marca**. Passa com ≥ 3 ativos na amostra (`TOO_FEW_ADS` / `NOT_FOUND`). |
| **D3 varrer termos** | `KEYWORD`, **`searchType: 'exact_phrase'`** (`q="<termo>"`), país, **`limit=30`**. Busca 4 termos em paralelo: promessa 1, produto 1, dor 1, produto 2 (no "Procurar de novo": **2 da memória + 2 novos**, C.4). Termo **EMPTY** (0–1 Página) ou **DIFFUSE** (≥ 8 Páginas e ≥ 80 % com 1 anúncio) é trocado por um reserva do mesmo D1, até 2 trocas; Páginas de 1 anúncio de termo difuso não entram. Agrupa por `page_id`. |
| **Concorrência** | no máximo `ADS_RESEARCH_APIFY_CONCURRENCY` (4) runs ao mesmo tempo por descoberta; `402 concurrent-runs-limit-exceeded` = tentar de novo (não é cobrado, `ResearchSync.attempts`). Item `ADS_NOT_FOUND`/`PAGE_PRIVATE` é descartado e o custo gravado. |
| **D4 julgar** | `ADS_RESEARCH_JUDGE_MODEL` (`claude-haiku-4-5`), 1 chamada, **até 25 Páginas** (≥ 2 anúncios primeiro, depois por anúncios vistos). Cada Página: nome, curtidas, hosts dos links, 3 textos, `adsSeen`, `oldestDays`, `suspectDisposable` (nome sem sentido, alfabetos misturados, 0 ativos). Saída: `{ pageId, relation, score 0–100, reason }`, `reason` em **PT-BR** (vai pro card). Fora sempre: domínio do site do cliente e `pageId` da conexão Meta dele. |
| **D5 escolher** | C.2. 5 seguidos (plano) e até 10 de reserva. Grava `CompetitorCandidate` de **todas** as Páginas avaliadas (status, `relation`, `rank`, `termId`). |
| **Importar** | Coleta `INITIAL` de cada seguido novo (§3). Card mostra "≥ N anúncios" até a importação terminar (`Competitor.activeIsLowerBound`). |
| **Custo** | Estimativa na tela `ADS_RESEARCH_DISCOVERY_ESTIMATE_USD` (**US$ 0,15**; medido 0,067–0,188). Trava `ADS_RESEARCH_DISCOVERY_MAX_USD` (0,30): passou, para as sondas restantes e escolhe com o que tem. Cada run com `maxTotalChargeUsd`; custo real = `usageTotalUsd` relido ~15 s depois. |
| **SAMPLE** | Mesmo D1; D2 só as 2 primeiras marcas; D3 2 termos (promessa 1, produto 1), sem troca; juiz até 15 Páginas; 1 seguido, sem reserva; sem memória. ≈ US$ 0,08 + importação de 100 (0,075). |
- **Calibração em aberto:** `MIN_SCORE` 50 e o texto do juiz pra direto × vizinho se ajustam com as marcações do Gusta nas tabelas da R1, **antes do live** (em mock não muda nada).

### C.4 Memória entre descobertas (nova; muda o §4)
Cada rodada vê um pedaço diferente do nicho (R1: o Kingdom deu 3 listas quase sem interseção, todas válidas). Então:
1. **Seguido nunca sai** por descoberta nova.
2. **Candidatos ficam guardados** (não só os da última descoberta): `competitor_candidates` acumula por workspace. No D5, os **aprovados de descobertas anteriores** (status `RESERVE`, mesmo `countryCode`, não seguidos nem bloqueados) **que ainda têm anúncio ativo na base global** (`AdSource.lastActiveCount > 0` ou algum `LibraryAd` da Página `isActive` visto nos últimos 30 dias) entram de novo na disputa da reserva **sem custo**, copiados na descoberta nova com `origin: MEMORY` e o score antigo. A reserva vigente = `RESERVE` da última descoberta concluída.
   - Exceção: descoberta `BRAIN_CHANGED` **rejulga** os de memória no D4 (o Brain mudou, o veredito velho não vale); eles contam no limite de 25.
3. **Termos que renderam** (`research_terms.approved_count > 0`, mesmo país) são guardados; o **"Procurar de novo"** (`MANUAL`) busca **2 deles** (mais aprovados, mais recentes; `origin: REUSED`) **+ 2 novos** do D1 (promessa 1 e dor 1, ou o que vier). `ONBOARDING` e `BRAIN_CHANGED` não reaproveitam termos.
4. **Retenção:** candidatos aprovados (`FOLLOWED`/`RESERVE`) e termos ficam; rejeitados/`NOT_FOUND`/`TOO_FEW_ADS` com mais de 180 dias saem. Bloqueio = `Competitor` `DISMISSED` (Página e domínio), nunca expira.

### C.5 Modelo de dados final (migração `20261107000100_ads_research`, aplicada em `maquina` e `maquina_test`)
Fonte da verdade: `api/prisma/schema.prisma`, seção "ads-research-v1". O §4 vale com estas diferenças:
- **`ResearchSync`**: `sourceId` **opcional** (sonda por termo/domínio não vira fonte) + `kind` (`PAGE`|`KEYWORD`), `query`, `countryCode`, `targetAdId` (coleta `MEDIA`: o anúncio que está em `refreshing`), `attempts`, `notBefore` (fila do teto global pro dia seguinte).
- **`CompetitorDiscovery`**: + `stage` (texto, como `Job.stage`), `countryReason`, `reserved`, `notBefore` (debounce de 24 h e fila; `autoPendingAt` da view = `notBefore` da `BRAIN_CHANGED` em `QUEUED`).
- **`CompetitorCandidate`**: acumula (C.4) + `relation`, `termId`, `suspectDisposable`; `CandidateOrigin` ganha `MEMORY`.
- **`ResearchTerm`** (nova): `term`, `kind` (`PROMISE`|`PRODUCT`|`PAIN`), `origin` (`NEW`|`REUSED`), `outcome` (`SEARCHED`|`EMPTY`|`DIFFUSE`|`UNUSED`), `pagesFound`, `pagesMultiAd`, `approvedCount`.
- **`Competitor`**: + `relation` (`DIRECT`|`ADJACENT`), `nicheScore`, `retiredAt`.
- **`Champion.researchAdId`** com FK pra `library_ads` (`SetNull`) e **`@@unique([workspaceId, researchAdId])`** (1 campeão por workspace × anúncio, à prova de corrida; arquivado = desarquiva e reaproveita).
- **`CostEntry`** + `researchSyncId` e `discoveryId` (FK, `SetNull`). **Ledger:** teto do workspace = soma de `cost_entries.amount_usd` do mês com um desses preenchido; teto global diário = soma de `research_syncs.cost_usd` + parte Claude das descobertas do dia (`competitor_discoveries.cost_usd` menos as sondas, que já estão nos syncs). Custo real do provedor mora no sync/descoberta; o `CostEntry` é a parte atribuída (rateio da semanal). Provider `APIFY` kind `SCRAPE`; Claude = `ANTHROPIC` `LLM`.
- **Fila própria, sem `Job`:** a coleta semanal não tem `createdById` nem workspace; `research_syncs` e `competitor_discoveries` (`status` + `notBefore`) são a fila, tocada por `@Interval` no backend. Nenhum `JobType` novo.
- Nada removido nem alterado em tabela existente além das 3 colunas opcionais.

### C.6 Selo "Likely winner" (mockup aprovado)
`winner` = ativo **e** (`daysRunning ≥ ADS_RESEARCH_WINNER_DAYS` (30) **ou** `collationCount ≥ ADS_RESEARCH_WINNER_VERSIONS` (5)). `testing`/`new`/`stopped` como no §5.3. A UI mostra a regra em texto ("active 30+ days or 5+ versions"), vinda de `ResearchStatus.winnerDays/winnerVersions`. "Versões" = `collationCount`.

### C.7 Tipos (`contratos/src/research.ts`, atualizado) e API
- Novos: `CompetitorRelation`, `CandidateOrigin` (+`MEMORY`), `CandidateStatus`, `ResearchTermKind`, `DiscoveryTermView`.
- `Competitor` + `relation`, `nicheScore`, `activeIsLowerBound`. `DiscoveryCandidateView` + `relation`, `rank`, `suspectDisposable`, `term`. `CompetitorDiscoveryView.last` + `reserved`, `terms[]`, `costUsd` (listas e custo só pra `INTERNAL`; cliente recebe `[]`/`null`); view + `estimateUsd`. `ResearchStatus` + `winnerVersions`. `ResearchAdPage` + `winners`.
- `ApiErrorDetails.SPEND_CAP_EXCEEDED` ganha `scope?: 'research'` (`contratos/src/index.ts`).
- Rotas, entradas, erros e quem chama: **sem mudança** no §7.

### C.8 Portas (maquina-ia) — assinatura final (substitui a do §10)
```ts
interface AdLibraryResearchService {
  status(): Promise<{ available: boolean; reason: 'quota' | 'not_configured' | null; retryAfter: string | null }>;
  scrape(i: { kind: 'PAGE' | 'KEYWORD'; query: string; searchType?: 'unordered' | 'exact_phrase'; countryCode: string; limit: number; ref: string }):
    Promise<{ items: LibraryAdDraft[]; errors: { code: string; message: string }[]; runId: string; costUsd: number }>;
  // erro tipado: AD_LIBRARY_UNAVAILABLE (quota/not_configured), PROVIDER_TIMEOUT, PROVIDER_ERROR, RETRYABLE (402 concurrent-runs)
}
// ClaudeService:
proposeCompetitors(i: { brain: BrainDigest; blocked: { pageNames: string[]; domains: string[] }; reuseTerms: string[]; maxBrands: number }):
  Promise<{ countryCode: string; countryReason: string; brands: { brand: string; domain: string; why: string }[];
            terms: { term: string; kind: 'promise' | 'product' | 'pain' }[] } & Usage>;
judgeCompetitors(i: { brain: BrainDigest; pages: { pageId: string; pageName: string; likeCount: number | null; hosts: string[]; texts: string[];
                      adsSeen: number; oldestDays: number | null; suspectDisposable: boolean }[] }):
  Promise<{ items: { pageId: string; relation: 'direct' | 'adjacent' | 'none'; score: number; reason: string }[] } & Usage>;
```
- `suspectDisposable` é calculado no backend (regra determinística), não pelo Claude. A porta não grava custo.
- **Mock (determinístico pelo `industry`):** D1 devolve 3 marcas (1 vira `NOT_FOUND`) e 6 termos; a base fake tem 9 Páginas `mock-page-1…9`: "Rival A–D" **diretos** com ≥ 2 anúncios, "Rival E–F" **vizinhos** com ≥ 2, "Rival G" direto com **1** anúncio, "Rival H" `none` (`REJECTED_NICHE`), "Rival I" descartável (`suspectDisposable`, `none`). PAID segue **A, B, C, D, E** (4 diretos + 1 vizinho); reserva **G, F** (diretos primeiro). 2ª descoberta (`MANUAL`) devolve "Rival J–K" novos (diretos) e traz G/F de volta como `MEMORY`; reaproveita 2 termos. Gatilhos do §10 continuam (`mock-no-competitors`, `mock-discovery-fail`, `mock-quota`, `mock-slow`; Páginas `mock-empty`, `mock-suspect`, `mock-gone`, `mock-big`) + `mock-only-adjacent` (juiz marca tudo vizinho: segue 5 vizinhos) e `mock-diffuse` (1º termo difuso, testa a troca). Custo fake: US$ 0,008 por sonda D2, 0,023 por D3, 0,02 por chamada Claude (pra exercitar os tetos), 0 nos testes que não olham custo.

### C.9 Envs
Todas no `api/.env.example` (bloco "Ad Radar"): modo/cron/descoberta, `ADS_RESEARCH_APIFY_TOKEN` (conta própria R7; vazio = `APIFY_TOKEN`), `ADS_RESEARCH_ACTOR` (vazio = `APIFY_AD_LIBRARY_ACTOR`), modelos do D1/D4, `MIN_SCORE`, limites por acesso, janelas, tetos (estimativa 0,15, trava 0,30, mensal 4 / 10 / 0,30, global 10/dia, 30 amostras/dia), concorrência 4, selo (30 dias / 5 versões / 7), aposentar 30, retenção 90, timeout 6 min. Produção: `AD_LIBRARY_MODE=off` (R11) e `ADS_RESEARCH_MODE=off` até o R7.

### C.10 Divisão do trabalho (substitui o §14)
Ordem: **arquiteto (feito) → ia ∥ backend (mock desde o início) → frontend (depois do pacote skullet) → qa → R7 → live.** Ninguém mexe em `video/`, `web/src/components/editor/` nem `api/src/edicao/` (maquina-video na F-U1).
| # | dono | arquivos | depende de |
|---|---|---|---|
| 1 | maquina-arquiteto | `schema.prisma` + migração, `contratos/src/research.ts` + `index.ts`, `api/.env.example`, este contrato (**feito 04/11**); revisão de cada entrega | — |
| 2 | **maquina-ia** | **1º (destrava o backend, entregar antes de tudo):** tipos das portas em `api/src/integracoes/contrato.ts` (C.8) e tokens em `portas.ts`. Depois: `integracoes/adlibrary/research.service.ts` (live/off, `searchType`, concorrência, 402 = `RETRYABLE`, `maxTotalChargeUsd`, releitura do `usageTotalUsd`), `adlibrary/fake-research.service.ts` (C.8), `adlibrary/mapear.ts` (estende `mapAdItem`: DCO/DPA, THREADS/WHATSAPP, curtidas, `oe` → `mediaExpiresAt`, itens com `error` separados), `integracoes/claude/concorrentes.ts` (prompts + `json_schema` do D1/D4, agnósticos), `claude.service.ts` (`proposeCompetitors`, `judgeCompetitors`), `mock/fake-claude.service.ts`, `integracoes.module.ts` (modo por `ADS_RESEARCH_MODE`), testes de unidade (`*.spec.ts` ao lado) | migração (feita) |
| 3 | **maquina-backend** | `api/src/research/` **novo**: `research.module.ts`, `research.config.ts` (envs C.9), `discovery.service.ts` (gatilhos §2.1, D1–D5 com C.2/C.3, memória C.4, bloqueio, trava de custo, `suspectDisposable`), `selecao.ts` (D5 puro, com spec), `sync.service.ts` (coletas, fusão por `ad_archive_id`, 30 %, limite adaptativo, aposentar, fila `notBefore`, `@Interval` semanal com `ADS_RESEARCH_CRON`), `media.service.ts` (§6.1/6.3), `caps.service.ts` (teto do workspace, global, amostras/dia, rateio, ledger C.5), `retencao.service.ts`, `research.controller.ts` (status/discovery), `competitors.controller.ts`, `ads.controller.ts`, `research.views.ts`, `dto/*`; ganchos: fim do onboarding e Brain/oferta mudou → `discovery.enqueue()` (`api/src/workspaces/`, `api/src/ofertas/`, só a chamada); `campeoes/` (`fromResearchAd`: acha/cria campeão por `researchAdId`), `templates/templates.dto.ts`+`service` e `iteracao/iteracao.dto.ts`+`service` (`researchAdId`, "exatamente um"); `common/errors` (`SPEND_CAP_EXCEEDED` com `scope`); `app.module.ts` (registrar); testes int `api/src/research/*.int.spec.ts` | portas da ia (tipos; usa os fakes) |
| 4 | **maquina-frontend** | **Só depois de fechar o pacote skullet** (ele está em `sidebar.tsx`, `messages/*.json`, `routes.ts`, `components/templates/`, `settings/`). Novos: `web/src/app/(app)/radar/page.tsx`, `web/src/components/research/*` (`radar-screen`, `competitor-bar` + `competitor-chip`, `discovery-state` (procurando / vazio / falhou), `ad-grid` + `research-ad-card` (botões no rodapé, alinhados), `ad-detail-sheet`, `filters` (+ bottom sheet 390), `removed-sheet`, `why-winner`, `version-strip`), `web/src/hooks/use-research.ts` (polling 3 s, C.1), `web/src/lib/api/research.ts`. Tocar: `components/shell/sidebar.tsx` (NavKey `radar` no topo de Make ads), `lib/routes.ts` (`radarHref`, `templatesHref` com `researchAdId`), `components/templates/ad-step.tsx` (aba Saved ads) e a faixa fixada da galeria (`?researchAdId=`), `messages/en.json` + `pt-BR.json` (`radar.*`), esconder o campo de link do campeão quando `adLibrary.available=false` + `not_configured` (R11). Até o backend subir: `web/src/mocks/research.ts` com os tipos do contrato | mockup v2 + skullet fechado + backend (ou mocks) |
| 5 | maquina-qa | `testes/research/*`: descoberta no onboarding → 5 seguidos (4 diretos + 1 vizinho) + reserva → remover (entra G; não volta na re-descoberta) → "Procurar de novo" (G/F `MEMORY`, 2 termos reaproveitados) → restaurar → grid/filtros/selo → salvar → Use as champion (URL válida e vencida) → lote; tetos (`scope: 'research'`), 429, 30 %, isolamento entre workspaces, CLIENT só leitura, amostra; 1440 e 390 | 2, 3, 4 |
Conflito de pasta: ia só em `api/src/integracoes/`; backend em `api/src/research/` + os ganchos listados (nenhum arquivo em comum com a ia, que entrega `contrato.ts` primeiro e não mexe mais na interface sem avisar). O `npm run db:migrate` não precisa rodar de novo (só se o schema mudar, e quem muda é o arquiteto).

### C.11 Ainda com o Gusta
- **R7** conta Apify própria do HookMill com teto mensal → bloqueia o live (`ADS_RESEARCH_APIFY_TOKEN`).
- **Marcações acertou/errou da R1** → calibra `MIN_SCORE` e o prompt direto × vizinho antes do live.
- Construindo com as propostas de **R1** (anúncio de concorrente em template de Edição: pode, com aviso antes do Gerar), **R2** (pesquisa sem crédito) e **R3** (amostra: descoberta curta + 1 concorrente); se ele discordar de alguma, muda pouco código.
- `AD_LIBRARY_MODE=off` na API de produção (R11): troca de env no EasyPanel, faço quando ele mandar.

## Revisão 04/11 (tarde): R0 + 3 decisões do Gusta — vale por cima de qualquer trecho antigo
| # | decisão do Gusta (04/11) | efeito no contrato |
|---|---|---|
| G1 | **Teto por workspace: US$ 4/mês** (INTERNAL US$ 10; global diário pode ser revisto) | §9 |
| G2 | **O cliente não cola nada: o HookMill descobre e traz os concorrentes sozinho**, sem ele pedir. Substitui a entrada manual e antecipa o antigo R4 | §2 reescrito (descoberta automática); o cliente só **remove** concorrente errado |
| G3 | Sai a entrada "URL de anúncio"; decidir o campeão por link da Ad Library (quebrado pelo actor) | §6.4 |

**O que a R0 mudou** (medido, US$ 0,155 em 12 runs): custo = **US$ 0,00075 por item + US$ 0,00005 por run** (não há o "custo fixo de ~US$ 0,006"); item de erro (`PAGE_PRIVATE`, slug errado) **é cobrado** como anúncio; `scrapeAdDetails` não muda o preço e nos EUA não traz alcance UE; URLs do fbcdn valem **~4,4 dias** (não horas), CORS aberto, `<video>` toca direto, vídeo até 720p; **72 % dos anúncios têm vídeo** (DCO é ~1/3 e traz o vídeo nos `cards`); carimbo `<100`, país, gasto e alcance **não vêm** nos EUA; plataformas incluem `THREADS` e `WHATSAPP`, formato inclui `DPA`; `limitPerSource` é exato e a ordem por impressões é estável; **o actor não resolve mais anúncio único por `?id=`** (`count: 1` dá erro cobrado, `count: 10` volta 0); domínio como fonte trouxe **13 % de ruído** (Halloween numa busca por `hallow.com`); latência ~7–8 s + 0,11 s/anúncio (200 anúncios ≈ 30–40 s).

## 0. Em 7 linhas
1. Item novo na sidebar, grupo "Make ads": **Research** (`/research`). O HookMill **descobre sozinho** os principais anunciantes do nicho do cliente no país dele e segue até **5** (SAMPLE 1). O cliente não adiciona; só tira o que não é concorrente, e a vaga é preenchida pela reserva.
2. **Descoberta** (§2): o Claude lê o Brain e propõe marcas + domínios + termos do nicho → a Ad Library confirma cada um com sondas de 10 anúncios (≈ US$ 0,008 cada) → um juiz barato confere o nicho → entram os mais fortes. **≈ US$ 0,20 por descoberta.**
3. Coleta pelo actor da Apify (`curious_coder/facebook-ads-library-scraper`, US$ 0,75/1.000 anúncios), por **Página + país**. A API oficial `ads_archive` não serve (§1).
4. Sincroniza **ao seguir** (até 150 anúncios), **toda semana** e **sob demanda** (1×/24 h por concorrente). Custo: **US$ 0,15–0,50 por concorrente/mês**; teto **US$ 4/mês por workspace**.
5. Anúncios e Páginas são **globais** (dedupe por `ad_archive_id`): dois workspaces que seguem a mesma Página pagam **uma** coleta, rateada.
6. Grid ordenado por **há mais tempo no ar** (proxy de vencedor). Ações: **Usar em template** (vira campeão, sem fluxo novo), **Salvar**, **Abrir na Ad Library**.
7. Modo `mock | live | off`. Campeão por link da Ad Library: **desligado em produção** (`AD_LIBRARY_MODE=off`) e escondido no web; o Research substitui (§6.4).

## 1. Viabilidade: de onde vêm os anúncios
| caminho | anúncio comercial do Brasil/EUA? | vídeo baixável? | custo | decisão |
|---|---|---|---|---|
| **Graph API `ads_archive`** (oficial) | **Não.** Fora de tema político/social, só devolve anúncio **entregue na UE** (DSA, último ano). | **Não.** Só `ad_snapshot_url`. | grátis, com app Meta + verificação de identidade | **Fora da v1** (não sondado; a página da doc deu 403 ao fetch). |
| **Apify, actor `curious_coder/facebook-ads-library-scraper`** | **Sim**, por Página (`facebook.com/<slug>` ou `view_all_page_id`) ou palavra-chave, com filtro de país | **Sim** (`snapshot.videos[]` e `cards[]` de DCO), URL válida ~4,4 dias | **US$ 0,00075/item + US$ 0,00005/run** (R0, exato) | **Escolhido.** Já integrado e sondado. |
| Scraper próprio | sim | sim | proxy + manutenção; risco de bloqueio vira nosso | Não. |

**O que vem por anúncio (R0, 172 anúncios):** `ad_archive_id`, `page_id`, `page_name`, foto e curtidas da Página, `start_date`/`end_date` (100 %), `is_active`, `collation_count` (null em 17 %), `publisher_platform[]`, `display_format` (VIDEO 42 %, DCO 31 %, IMAGE 9 %, CAROUSEL, DPA), texto, título, CTA, `link_url`, mídia. **Não vem:** gasto, impressões, país de entrega, carimbo `<100` e alcance UE (fora da UE), idioma. Por isso "vencedor" é proxy (§5.3), país é parâmetro da busca e idioma é detectado do texto.

## 2. Como os concorrentes entram: descoberta automática (G2)
O cliente **não** cola link, nome, domínio nem @. O HookMill encontra os concorrentes a partir do Brain e segue os melhores sozinho.

### 2.1 Quando roda
| gatilho | condição | limite |
|---|---|---|
| **Fim do onboarding** (`Onboarding.completedAt` preenchido) ou 1ª leitura de oferta pronta, o que vier primeiro | Brain com pelo menos `industry` **ou** uma oferta lida; `market` ajuda, mas não é obrigatório (§2.3) | 1 vez |
| **Brain mudou** (`industry`, `market` ou a oferta principal) | impressão digital do Brain (`inputHash`) diferente da última descoberta | debounce de 24 h; no máximo 1 automática a cada 30 dias |
| **Vaga aberta sem reserva** | o cliente removeu e a reserva acabou, ou um concorrente ficou 30 dias sem anúncio ativo (vira `RETIRED`) | só oferece o botão (não roda sozinho) |
| **"Procurar de novo"** (botão) | pedido do cliente | 1× a cada 7 dias (429 `RATE_LIMITED` `retryAfter`) |
- Descoberta nova **não remove** quem está seguido; só preenche vaga e renova a reserva. Quem o cliente removeu nunca volta (§2.5).
- Roda com o workspace em `ADS_RESEARCH_MODE ≠ off`. SAMPLE: só depois do e-mail verificado (antiabuso, `amostra-gratis-v1` §6).

### 2.2 Pipeline — SUBSTITUÍDO pela C.3 (regra final da R1 §8)
| etapa | o quê | custo estimado |
|---|---|---|
| **D1. Propor** (Claude, `claude-sonnet`, sem busca na web, saída em esquema estrito) | Lê o Brain: ramo, mercado, ofertas (promessa, público, preço), site e páginas lidas, idioma. Devolve `countryCode` (ISO-2), **até 8 candidatos** `{ marca, domínio, por quê }` (anunciantes que vendem a mesma coisa pro mesmo público; nunca o próprio cliente) e **até 3 termos do nicho** (1–3 palavras, no idioma do mercado, sem nome de marca). Recebe a lista de removidos como "não sugerir". | ≈ 4k tokens de entrada + 1k de saída ≈ **US$ 0,03** |
| **D2. Confirmar por domínio** (Apify) | Pra cada candidato: busca `q=<domínio>`, `keyword_unordered`, `country=<countryCode>`, `limitPerSource=10` (o actor exige ≥ 10). A Página do candidato = a que tem mais anúncios cujo `link_url` cai no domínio (R0: 26 de 30 na busca `hallow.com` eram da Hallow). Passa se a Página tem **≥ 3 anúncios ativos** no país. Isso descarta o ruído do domínio (13 % na R0) sem chutar slug, e o slug errado (`PAGE_PRIVATE`, cobrado) deixa de existir. | 10 × 0,00075 + 0,00005 ≈ **US$ 0,008 por candidato**, até 8 = **US$ 0,06** |
| **D3. Varrer o nicho** (Apify) | Pra cada termo: `keyword_unordered`, país, **`limitPerSource=40`**. Agrupa por `page_id`; fica quem tem ≥ 2 anúncios na amostra. Acha anunciante que o LLM não conhece. Com limite pequeno a conta é outra: o run de US$ 3,47 do ad-radar foi frase **sem limite**, milhares de itens. | 40 × 0,00075 ≈ **US$ 0,03 por termo**, até 3 = **US$ 0,09** |
| **D4. Julgar** (Claude, `claude-haiku`, 1 chamada pra todos) | Pra cada Página candidata (nome, curtidas, host dos links, 3 textos de anúncio) contra o resumo do Brain: `sameNiche`, `score` 0–100 e `reason` de 1 linha. Fora: outro nicho, o próprio cliente (domínio do site ou `pageId` da conexão Meta), marketplace/varejista genérico, Página de mídia. | ≈ 6k + 0,5k tokens ≈ **US$ 0,01** |
| **D5. Escolher** (sem custo) | Ordem: `score` do juiz, depois anúncios ativos vistos, depois o anúncio mais antigo no ar. Segue os primeiros até o limite do plano; os próximos (até 10) ficam de **reserva**, já validados. | 0 |
| **Total por descoberta** | | **≈ US$ 0,20** (PAID). Trava: orçamento de US$ 0,30 por descoberta (`ADS_RESEARCH_DISCOVERY_MAX_USD`); passou, para as sondas restantes e escolhe com o que tem. Cada run leva `maxTotalChargeUsd` na Apify. |
- Os preços do Claude são estimativas pela tabela vigente em 04/11; o custo gravado é o `usage` real de cada chamada (`CostEntry` LLM) e o `usageTotalUsd` de cada run (lido ~15 s depois do fim, R0).
- **SAMPLE (versão curta):** 4 candidatos, 1 termo, sem reserva: ≈ 0,03 + 0,03 + 0,03 + 0,01 = **≈ US$ 0,10**, mais a importação de 1 × 100 (US$ 0,075) = **≈ US$ 0,18 por conta de amostra**, custo nosso.
- Os anúncios das sondas (D2/D3) já entram na base global (`LibraryAd`), então o grid não fica vazio enquanto a importação roda.
- Descoberta sem nenhum aprovado = status `EMPTY`; a tela explica ("não achamos anunciantes ativos do seu nicho em <país>") e oferece "Procurar de novo" quando o Brain mudar. **Nada de digitar concorrente** (G2).

### 2.3 País
`AdSource` é **Página + país** (R0: país como parâmetro, não `ALL`). País = `market` do Brain convertido em ISO-2 pelo D1; sem `market`, o D1 infere do site (domínio de país, moeda, idioma); sem nada, `US`. O card diz "ativos em <país>". Trocar o `market` no Brain dispara a re-descoberta (§2.1).

### 2.4 Quantos entram
| acesso | seguidos | reserva | anúncios por concorrente | sync automático | atualizar agora |
|---|---|---|---|---|---|
| `SAMPLE` | 1 | 0 | 100 | não | não |
| `PAID` | 5 | até 10 | **150** (era 200; cabe no teto, §9) | semanal | 1× / 24 h |
| `INTERNAL` | 15 | até 10 | 300 | semanal | 1× / 6 h |
Configurável por env (§10).

### 2.5 Remover (o cliente não adiciona, mas tira)
- **Faz sentido e é obrigatório:** a descoberta erra (marca de outro nicho, parceiro, o próprio cliente com outra Página) e o cliente precisa limpar sem suporte.
- `POST /research/competitors/:id/dismiss { reason }`, com `reason` = `not_competitor` · `not_relevant` · `own_brand` · `other`. O concorrente vira `DISMISSED`, some do grid e dos filtros, e a vaga é preenchida **na hora** pelo 1º da reserva, sem custo de descoberta (a importação dele custa a coleta normal).
- Removido vira lista de bloqueio do workspace (Página **e** domínio): nenhuma descoberta futura o traz de volta, e o D1 recebe a lista como "não sugerir".
- **Desfazer:** `POST /research/competitors/:id/restore` (em Configurações → Research → "Removidos"). Volta se houver vaga; sem vaga = 409 `INVALID_STATE` `competitor_limit`.
- Os anúncios **salvos** de um removido continuam em "Salvos".
- **Sem "adicionar manual" pro cliente na v1** (G2). A equipe (`INTERNAL` OWNER) tem `POST /research/competitors { pageId | pageUrl, countryCode? }` pra teste e suporte (R10).

## 3. Sincronização
| gatilho | entrada do actor |
|---|---|
| **Seguir** (importação) | `urls: [<view_all_page_id da Página>]`, `scrapePageAds.countryCode: <país>`, `activeStatus: 'active'`, `sortBy: 'impressions_desc'`, `limitPerSource: <teto do plano>`, sem `scrapeAdDetails` (não muda o preço e não traz nada fora da UE), 512 MB, `maxTotalChargeUsd = (limit + 30) × 0,00075 + 0,001` |
| **Semanal** (cron) | igual, com `limitPerSource = min(teto, lastActiveCount + 30)`: Página com 40 ativos não paga 150 (R0, recomendação 1). Fonte sem seguidor ativo não sincroniza (`PAUSED`). |
| **Atualizar agora** | igual à semanal. Dentro da janela = 429 `RATE_LIMITED` `{ retryAfter }`. |
| **Mídia** (§6.1) | igual à semanal, disparada por "Usar"/"Carregar vídeo" com a URL vencida; não conta na janela do "Atualizar agora", conta no teto |
| **Fonte já existe** | nada; o seguidor novo vê os dados na hora (se a última coleta tem > 7 dias, enfileira uma) |
- Run por fonte, espera dentro do trabalho (`waitForFinish`), teto de 6 min (sobra: 150 anúncios ≈ 25–30 s). Sem webhook.
- **Itens com `error`** (ex.: `PAGE_PRIVATE`) são descartados antes do mapeamento e o custo é gravado igual. Página que sumiu (`PAGE_PRIVATE` numa fonte que já funcionou) = coleta `FAILED` `AD_NOT_FOUND`; 3 seguidas = concorrente `RETIRED`.
- **Trava de 30 %** (aprendizado do ad-radar): coleta com < 30 % dos ativos da última válida (e a anterior ≥ 10) vira `SUSPECT` e não é fundida.
- **Fusão** por `ad_archive_id`; anúncio da fonte ausente numa coleta válida = `isActive = false`, `stoppedAt = hoje`.
- 1 coleta por fonte por vez (409 `INVALID_STATE` `sync_running`). Cron: ≤ 20 fontes por tique, 30 s entre elas, só com `ADS_RESEARCH_CRON≠off` e modo `live`.
- **Concorrente aposentado:** 30 dias sem nenhum anúncio ativo = `RETIRED` (sai do grid padrão, vaga aberta, a reserva assume).

## 4. Modelo de dados (migração aditiva `2026110x_ads_research`) — versão final na C.5 e no `schema.prisma`
Anúncios e fontes são **públicos e globais**; seguir, descobrir, remover e salvar são por workspace.
```prisma
enum AdSourceStatus        { ACTIVE  PAUSED }
enum ResearchTrigger       { INITIAL  SCHEDULED  MANUAL  MEDIA  DISCOVERY }
enum ResearchSyncStatus    { QUEUED  RUNNING  SUCCEEDED  SUSPECT  FAILED }
enum LibraryAdFormat       { VIDEO  IMAGE  CAROUSEL  DCO  DPA  OTHER }
enum CompetitorStatus      { ACTIVE  DISMISSED  RETIRED }
enum CompetitorOrigin      { DISCOVERED  MANUAL }                 // MANUAL só pela equipe (R10)
enum DismissReason         { not_competitor  not_relevant  own_brand  other }
enum DiscoveryTrigger      { ONBOARDING  BRAIN_CHANGED  MANUAL }
enum DiscoveryStatus       { QUEUED  RUNNING  SUCCEEDED  EMPTY  FAILED }
enum CandidateOrigin       { LLM  KEYWORD  BOTH }
enum CandidateStatus       { FOLLOWED  RESERVE  REJECTED_NICHE  NOT_FOUND  TOO_FEW_ADS  BLOCKED }

model AdSource {                 // Página da Meta + país (a coleta)
  id, pageId String, countryCode String           // ISO-2
  displayName String, avatarKey String?, likeCount Int?
  status AdSourceStatus @default(ACTIVE)
  lastSyncAt DateTime?, lastValidSyncAt DateTime?, nextSyncAt DateTime?
  lastActiveCount Int @default(0)                  // base da trava de 30 % e do limite adaptativo
  consecutiveFailures Int @default(0)
  createdAt, updatedAt
  @@unique([pageId, countryCode]) @@map("ad_sources")
}
model LibraryAd {
  id, adArchiveId String @unique, pageId String?, pageName String
  format LibraryAdFormat                           // DCO/CAROUSEL com vídeo em card conta como tendo vídeo (hasVideo)
  hasVideo Boolean
  primaryText String?, headline String?, ctaText String?, linkUrl String?, linkHost String?
  cards Json?                                      // [{ headline, body, linkUrl, mediaKind, posterUrl, videoUrl }]
  platforms String[]                               // FACEBOOK | INSTAGRAM | MESSENGER | AUDIENCE_NETWORK | THREADS | WHATSAPP
  startDate DateTime? @db.Date, endDate DateTime? @db.Date, isActive Boolean, stoppedAt DateTime? @db.Date
  collationCount Int?                              // null em 17 % (R0)
  euReach Int?, lowImpressions Boolean @default(false)   // só fora dos EUA; o card não depende deles
  language String?                                 // ISO 639-1 detectado do texto (lib local)
  posterKey String?                                // poster copiado na coleta (a URL vence em ~4,4 dias e o sync é semanal)
  videoKey String?                                 // vídeo no nosso storage: só ao salvar/usar (§6)
  videoSourceUrl String?, mediaExpiresAt DateTime? // URL fbcdn + validade (`oe` hex → epoch)
  width Int?, height Int?, durationSec Decimal? @db.Decimal(8,3)
  firstSeenAt, lastSeenAt, createdAt, updatedAt
  @@index([pageId]) @@index([isActive, startDate]) @@map("library_ads")
}
model AdSourceAd { sourceId, adId, firstSeenAt, lastSeenAt  @@id([sourceId, adId]) @@index([adId]) @@map("ad_source_ads") }
model CompetitorDiscovery {
  id, workspaceId, trigger DiscoveryTrigger, status DiscoveryStatus
  inputHash String                                 // impressão digital do Brain usado
  countryCode String?, keywords String[]
  candidatesFound Int @default(0), followed Int @default(0)
  costUsd Decimal @default(0) @db.Decimal(12,4)
  errorCode String?, failReason String?, requestedById String?
  createdAt, startedAt DateTime?, finishedAt DateTime?
  @@index([workspaceId, createdAt]) @@map("competitor_discoveries")
}
model CompetitorCandidate {
  id, discoveryId, workspaceId, sourceId String?   // null se não achou Página
  brandName String?, domain String?, pageId String?, pageName String?
  origin CandidateOrigin, status CandidateStatus, rank Int?
  activeAdsSeen Int @default(0), oldestDays Int?, nicheScore Int?, reason String?
  createdAt
  @@index([workspaceId, status, rank]) @@map("competitor_candidates")
}
model Competitor {
  id, workspaceId, sourceId, name String
  origin CompetitorOrigin, discoveryId String?, reason String?   // "por que este" (do juiz), mostrado no card do concorrente
  status CompetitorStatus @default(ACTIVE)
  dismissedAt DateTime?, dismissedById String?, dismissReason DismissReason?
  domain String?                                   // bloqueio por domínio também
  createdById String?, createdAt, updatedAt
  @@unique([workspaceId, sourceId]) @@index([workspaceId, status]) @@map("competitors")
}
model ResearchSync {
  id, sourceId, trigger ResearchTrigger, status ResearchSyncStatus
  requestedByWorkspaceId String?, requestedById String?, discoveryId String?
  apifyRunId String? @unique, requestedLimit Int
  itemsRaw Int @default(0), itemsError Int @default(0), adsActive Int @default(0), adsNew Int @default(0), adsStopped Int @default(0)
  costUsd Decimal @default(0) @db.Decimal(12,4), errorCode String?, failReason String?
  createdAt, startedAt DateTime?, finishedAt DateTime?
  @@index([sourceId, createdAt]) @@map("research_syncs")
}
model SavedAd { id, workspaceId, adId, savedById, note String?, createdAt  @@unique([workspaceId, adId]) @@map("saved_ads") }
// existentes, colunas novas (opcionais):
model Champion  { researchAdId String? @map("research_ad_id") }    // @@index([workspaceId, researchAdId])
model CostEntry { researchSyncId String? @map("research_sync_id"); discoveryId String? @map("discovery_id") }
```
- As sondas da descoberta (D2/D3) gravam `ResearchSync` com `trigger: DISCOVERY` e `sourceId` da Página achada (D3 cria a fonte de cada Página que passou; a busca por termo não vira fonte).
- Mídia global fora de `File` (chaves `research/<adArchiveId>/…`, assinadas na leitura); ao usar, `CopyObject` pra `ws/<workspaceId>/CHAMPION_VIDEO/…`.
- **Retenção:** anúncio que nenhuma fonte ativa vê há 90 dias, não salvo nem usado = apaga linha e chaves. Candidatos de descobertas antigas: guarda só os da última por workspace.
- **Custo e rateio:** descoberta = custo inteiro no workspace (`discoveryId`). INITIAL/MANUAL/MEDIA = no workspace que pediu. SCHEDULED = rateado entre os seguidores com folga no teto.

## 5. Listagem: ordenação, filtros e o card
### 5.1 Ordenação (`sort`)
`longest_running` (**padrão**: ativos primeiro, `startDate` asc) · `newest` · `most_variations` (`collationCount` desc, nulos no fim) · `eu_reach` (só aparece se houver fonte fora dos EUA com o dado).
### 5.2 Filtros (`GET /research/ads`)
`competitorId[]` · `status` (`active` padrão · `inactive` · `all`) · `format[]` · `hasVideo` · `minDays` · `startedAfter`/`startedBefore` · `platform[]` · `language[]` · `tier[]` · `q` · `saved=true` · cursor (`limit` ≤ 60). País = o do concorrente (fonte); sem filtro de país por anúncio.
### 5.3 Selo (proxy, calculado na leitura)
`winner` = ativo e ≥ 30 dias (o carimbo `<100` entra só onde existir) · `testing` = ativo, 7–29 dias · `new` = ativo, < 7 dias · `stopped` = inativo (`killedFast` se durou < 7 dias). `daysRunning` = (hoje ou `stoppedAt`) − `startDate`. A UI diz "provável vencedor". Limiares por env.
### 5.4 O card (`ResearchAdCard`)
Prévia (poster; vídeo toca se `media.playable`) · duração · formato · foto + nome da Página · selo · "No ar há N dias" (ou "Rodou N dias, parou em DD/MM") · "N variações" (se > 1) · plataformas · texto + título + CTA · host do link · idioma · salvo · "usado em N lotes". Ações no rodapé, alinhadas entre cards: **Usar em template** (só com vídeo), **Salvar**, **Abrir na Ad Library**, **Copiar texto**. Card do **concorrente** (barra de cima): nome, foto, país, "por que este" (do juiz), contagens, última coleta, menu **Remover**.

## 6. Ações
### 6.1 Usar em template
- Fonte nova `researchAdId` onde já existem `championId`/`metaAdId`/`uploadId`: `POST /templates/fits`, `POST /ad-templates/:slug/use`, `POST /ad-templates/use`, `POST /iterate`.
- O backend acha ou cria o campeão do workspace pra esse anúncio (`Champion.researchAdId`, 1 por workspace × anúncio; o 2º uso reaproveita a análise). `rights = THIRD_PARTY`, `sources = ['AD_LIBRARY']`, `adLibraryUrl` = link do anúncio, `adMeta` preenchido da `LibraryAd`.
- Vídeo: `videoKey` existe → copia, campeão nasce `ANALYZING`. URL do fbcdn ainda vale (`mediaExpiresAt` > agora + 10 min) → baixa agora. **Venceu → coleta `MEDIA` da fonte** (≈ US$ 0,03–0,11, 20–30 s) e o campeão espera em `RESOLVING`; se o anúncio não vier mais (parou), falha `AD_NOT_FOUND` com ação `upload_video`. **Não usa mais o `AdLibraryService.resolve()`** (não funciona, R0).
- Vídeo de DCO/carrossel: o 1º card com vídeo (o detalhe deixa escolher outro na v1.1).
- Erros síncronos: 404 (anúncio fora das fontes/salvos do workspace); 409 `INVALID_STATE` `ad_has_no_video`; 409 `SPEND_CAP_EXCEEDED` `scope: 'research'` (só quando precisa da coleta `MEDIA`); 503 `AD_LIBRARY_UNAVAILABLE`. Créditos: os do template.
- Web: abre `/templates?researchAdId=<id>`. Aviso R1 antes do Gerar em template de Edição.
### 6.2 Salvar
`PUT /research/ads/:id/save { note? }` / `DELETE`. Salvar com URL válida baixa o vídeo pro storage em segundo plano; vencida, baixa quando alguém usar.
### 6.3 Carregar vídeo
`POST /research/ads/:id/media` → `202`, `media.status = 'refreshing'`: coleta `MEDIA` da fonte e baixa o vídeo pro storage. Polling em `GET /research/ads/:id`.
### 6.4 Campeão por link da Ad Library (G3)
- **Situação:** `POST /champions { adLibraryUrl }` chama `ApifyAdLibraryService.resolve()` com `?id=` + `count: 1`, que hoje **não funciona** (erro cobrado com `count: 1`, 0 itens com `count: 10`). Nunca foi validado ao vivo.
- **Proposta (a mais simples):**
  1. **Agora, sem código:** `AD_LIBRARY_MODE=off` na API de produção. O `GET /champions/config` já devolve `adLibrary.available = false` e o web já desliga o campo com o motivo; quem mandar `adLibraryUrl` recebe 503 `AD_LIBRARY_UNAVAILABLE` e nenhum campeão é criado.
  2. **Na próxima passada do frontend:** **esconder** o campo de link (em vez de mostrar desligado) quando `adLibrary.available = false` com `reason: 'not_configured'`. O caminho pra "trazer um anúncio da Ad Library" passa a ser o Research (§6.1), que resolve pela Página dona.
  3. **Não consertar o `resolve()`** agora. Resolver um link solto exigiria achar a Página dona (o link `?id=` não diz qual é) e coletar a Página inteira até achar o `ad_archive_id`. Fica pra v2 se alguém pedir, usando a mesma coleta `MEDIA`.
- Campeões antigos com `adLibraryUrl`/`adMeta` continuam como estão (só leitura).

## 7. API
Todas exigem sessão e workspace ativo. `CLIENT` (fase2-agencia) = só leitura; descobrir, remover, restaurar, atualizar, salvar e usar = 403.
| método e rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `GET /research/status` | — | `ResearchStatus` (inclui a descoberta) | — | tela Research |
| `GET /research/discovery` | — | `CompetitorDiscoveryView` | — | estado "procurando concorrentes" |
| `POST /research/discovery` | — | `202 CompetitorDiscoveryView` | 409 `INVALID_STATE` `discovery_running` · 409 `INVALID_STATE` `brain_incomplete` · 429 `RATE_LIMITED` `{ retryAfter }` · 409 `SPEND_CAP_EXCEEDED` `scope: 'research'` · 402 `PAYMENT_REQUIRED` `research_tier` (SAMPLE já descobriu) · 503 `AD_LIBRARY_UNAVAILABLE` | "Procurar de novo" |
| `GET /research/competitors` | `?status=active|dismissed|retired` (padrão `active`) | `{ items: Competitor[] }` | — | barra de concorrentes; Configurações → Removidos |
| `PATCH /research/competitors/:id` | `UpdateCompetitorBody` | `Competitor` | 400 · 404 | renomear |
| `POST /research/competitors/:id/dismiss` | `DismissCompetitorBody` | `DismissCompetitorResponse` (`replacement` = quem entrou da reserva, ou `null`) | 404 · 409 `INVALID_STATE` `not_active` | Remover |
| `POST /research/competitors/:id/restore` | — | `Competitor` | 404 · 409 `INVALID_STATE` `competitor_limit` · `not_dismissed` | Desfazer |
| `POST /research/competitors/:id/refresh` | — | `202 Competitor` | 404 · 409 `sync_running` · 429 `RATE_LIMITED` · 409 `SPEND_CAP_EXCEEDED` · 503 · 402 `research_tier` | Atualizar agora |
| `POST /research/competitors` (**só equipe**, `INTERNAL` OWNER) | `AddCompetitorBody` | `202 Competitor` | 403 (não equipe) · 400 `VALIDATION_ERROR` `research_source_invalid` · 409 `competitor_limit` · `already_following` | suporte/teste (R10) |
| `GET /research/ads` | `ListResearchAdsQuery` | `ResearchAdPage` | 400 | grid |
| `GET /research/ads/:id` | — | `ResearchAdDetail` | 404 | detalhe |
| `POST /research/ads/:id/media` | — | `202 ResearchAdDetail` | 404 · 409 `media_refreshing` / `no_media` · 409 `SPEND_CAP_EXCEEDED` · 503 | Carregar vídeo |
| `PUT /research/ads/:id/save` · `DELETE …/save` | `SaveResearchAdBody` | `ResearchAdCard` · `204` | 404 | Salvar |
| (existentes) fits/use/iterate | `+ researchAdId?` | iguais | §6.1 | Usar em template |
**Nenhum código de erro novo** (só `details.reason`/`rule`); `SPEND_CAP_EXCEEDED` ganha `scope: 'research'`. Visibilidade: o workspace lê anúncios das fontes que segue (`ACTIVE`) e dos que salvou/usou; o resto é 404.

## 8. Status no web: polling
Polling a **3 s** de `GET /research/discovery` enquanto `status ∈ {QUEUED, RUNNING}`, de `GET /research/competitors` enquanto alguma coleta está `QUEUED/RUNNING`, e de `GET /research/ads/:id` durante `media.status = 'refreshing'`. Justificativa: tudo é raro e curto (descoberta ≈ 1–2 min, coleta ≈ 30 s), o estado mora no banco e o produto inteiro já faz polling. Terminou → o web invalida `GET /research/ads`.

## 9. Custo e teto (números da R0)
Fórmula de uma coleta: `itens × 0,00075 + 0,00005`.
| item | custo |
|---|---|
| descoberta PAID (§2.2) | ≈ **US$ 0,20** (trava US$ 0,30) |
| descoberta SAMPLE | ≈ US$ 0,10 |
| importação 150 / 100 | US$ 0,11 / 0,075 |
| semanal, 40 ativos (limite adaptativo 70) | 4,33 × 0,053 = **US$ 0,23/mês** |
| semanal, 150 (teto) | 4,33 × 0,113 = **US$ 0,49/mês** |
| coleta `MEDIA` | igual a uma semanal (US$ 0,03–0,11) |
- **PAID com 5 concorrentes, 1º mês, pior caso** (todos no teto): 0,20 + 5 × 0,11 + 5 × 0,49 = **US$ 3,20**, sobra US$ 0,80 (≈ 7 "atualizar agora" ou "carregar vídeo"). **Típico** (40–60 ativos): 0,20 + 5 × 0,05 + 5 × 0,25 ≈ **US$ 1,70**. Meses seguintes: US$ 1,15–2,45.
- **Teto por workspace: US$ 4/mês (G1)**; `INTERNAL` US$ 10; `SAMPLE` US$ 0,30 (cobre a descoberta curta + 1 importação). Conferido antes de cada descoberta/coleta pedida, com a estimativa; estourou = 409 `SPEND_CAP_EXCEEDED { scope: 'research', spentUsd, capUsd, estimateUsd }`. Descoberta automática com o teto estourado não roda (fica `QUEUED` até o dia 1). Fonte compartilhada: quem está no teto não recebe rateio. Não conta no `monthlySpendCapUsd` (a pesquisa não trava o Gerar).
- **Teto global** `ADS_RESEARCH_DAILY_GLOBAL_USD`: proposta **US$ 10/dia** (era 5). Conta: cada conta PAID nova custa ≈ US$ 0,75 no 1º dia (descoberta + 5 importações) e cada amostra ≈ US$ 0,18; US$ 5 travaria em ~6 PAID ou ~25 amostras num dia. Passou: descoberta e importação **entram na fila** pro dia seguinte (não falham); "atualizar agora" = 503 `AD_LIBRARY_UNAVAILABLE` `reason: 'quota'`. Mais um teto só pras amostras: `ADS_RESEARCH_SAMPLE_DISCOVERIES_PER_DAY` (padrão 30 ≈ US$ 5,40).
- **Conta da Apify** com teto próprio (R7): 50 workspaces PAID ≈ US$ 60–120/mês de pesquisa.
- **Créditos:** incluído no plano (R2).

## 10. Modos, envs e mock
`ADS_RESEARCH_MODE = mock | live | off` (sem a env, segue `INTEGRACOES_MODE`); `ADS_RESEARCH_CRON=off`; `ADS_RESEARCH_DISCOVERY=off` (desliga só a descoberta automática); `APIFY_TOKEN`/`APIFY_AD_LIBRARY_ACTOR` reaproveitados (conta R7); limites: `ADS_RESEARCH_MAX_COMPETITORS_{SAMPLE,PAID,INTERNAL}`, `ADS_RESEARCH_RESERVE_MAX` (10), `ADS_RESEARCH_MAX_ADS_{…}` (100/150/300), `ADS_RESEARCH_REFRESH_HOURS_{PAID,INTERNAL}`, `ADS_RESEARCH_DISCOVERY_EVERY_DAYS` (7, manual) e `_AUTO_EVERY_DAYS` (30), `ADS_RESEARCH_DISCOVERY_MAX_USD` (0,30), `ADS_RESEARCH_MONTHLY_CAP_USD` (4) `[_INTERNAL` 10 `|_SAMPLE` 0,30`]`, `ADS_RESEARCH_DAILY_GLOBAL_USD` (10), `ADS_RESEARCH_SAMPLE_DISCOVERIES_PER_DAY` (30), `ADS_RESEARCH_WINNER_DAYS` (30), `ADS_RESEARCH_NEW_DAYS` (7), `ADS_RESEARCH_RETIRE_DAYS` (30), `ADS_RESEARCH_SYNC_TIMEOUT_MS` (360000). Produção: `AD_LIBRARY_MODE=off` (§6.4).
- **Portas** (dono: maquina-ia), em `integracoes/adlibrary/` e `integracoes/claude/`:
  ```ts
  interface AdLibraryResearchService {
    status(): Promise<{ available: boolean; reason: 'quota' | 'not_configured' | null; retryAfter: string | null }>;
    /** coleta de Página (view_all_page_id) ou busca por termo/domínio; sempre com país e limite ≥ 10; itens com `error` separados */
    scrape(i: { kind: 'PAGE' | 'KEYWORD'; query: string; countryCode: string; limit: number; ref: string }):
      Promise<{ items: LibraryAdDraft[]; errors: { code: string; message: string }[]; runId: string; costUsd: number }>;
  }
  // ClaudeService ganha:
  proposeCompetitors(i: { brain: BrainDigest; blocked: { pageNames: string[]; domains: string[] }; max: number; maxKeywords: number }):
    Promise<{ countryCode: string; keywords: string[]; candidates: { brand: string; domain: string; why: string }[] } & Usage>;
  judgeCompetitors(i: { brain: BrainDigest; pages: { pageId: string; pageName: string; likeCount: number | null; hosts: string[]; texts: string[] }[] }):
    Promise<{ items: { pageId: string; sameNiche: boolean; score: number; reason: string }[] } & Usage>;
  ```
  Prompts agnósticos de oferta (nunca nomear nicho no sistema; o nicho vem só do Brain). A porta não grava `CostEntry`: devolve o custo e o backend grava/rateia.
- **Mock:** `FakeAdLibraryResearchService` determinístico pela `query` (24 anúncios por Página: 16 vídeo com os fixtures atuais, 5 imagem, 3 DCO; `startDate` de 1 a 90 dias; custo 0) e `FakeClaude.proposeCompetitors/judgeCompetitors` determinísticos pelo `industry` do Brain: 6 candidatos "Rival A…F" (`mock-page-1…6`), juiz aprova 5 e reprova 1 (`REJECTED_NICHE`), então PAID segue 5 e guarda 0–1 de reserva; um candidato vira `NOT_FOUND` pra testar a sonda. Gatilhos no `industry`: `mock-no-competitors` (`EMPTY`), `mock-discovery-fail` (`FAILED`), `mock-quota` (503), `mock-slow` (20 s). Gatilhos na Página: `mock-empty`, `mock-suspect`, `mock-gone` (`PAGE_PRIVATE`), `mock-big` (300). Testes automatizados sempre em mock.
- **Off:** a sidebar mostra o item com "Soon"; `GET /research/status` = `available: false, reason: 'not_configured'`.

## 11. Riscos (registrados)
- **ToS da Meta:** coleta automatizada viola os termos; a Apify assume a coleta, mas o actor pode quebrar (já quebrou o anúncio único, R0). Mitigação: porta isolada, trava de 30 %, modo `off`.
- **Direito autoral / takedown no anúncio do cliente:** template de Edição republica a filmagem do concorrente → denúncia de PI pode derrubar o anúncio e marcar a conta de anúncio do cliente. Decisão R1.
- **Descoberta errada:** marca de outro nicho, o próprio cliente ou um parceiro. Mitigação: confirmação por domínio na Ad Library (D2), juiz de nicho (D4), exclusão do domínio/Página do cliente, "Remover" com bloqueio permanente e reserva.
- **Descoberta automática custa sem o cliente pedir:** limitada a 1 no onboarding + 1 automática/30 dias, trava de US$ 0,30 por descoberta, teto do workspace e global, amostra só com e-mail verificado e teto diário de amostras.
- **Guardar mídia de terceiros:** vídeo só ao salvar/usar; retenção de 90 dias; takedown = rota de admin que apaga e bloqueia a Página (v1.1).
- **LGPD:** Página pode ser de pessoa física; base = legítimo interesse sobre dado tornado público pelo anunciante, retenção de 90 dias, exclusão sob pedido; constar na política de privacidade antes de vender pra fora.

## 12. Sonda R0: feita (04/11)
Resultado em [`ads-research-r0-2026-11-04.md`](ads-research-r0-2026-11-04.md) (US$ 0,155, conta `trendcat`). Pendente: reteste da URL do fbcdn perto do `oe` (~08/11). **Sonda R1 (nova, antes de ligar a descoberta live, até US$ 1,50 com ok):** rodar a descoberta inteira em 3 Brains reais (ex.: um app, uma loja, um infoproduto em PT-BR) e medir custo real, quantos candidatos o D2 confirma, ruído do D3 com `limit=40` e acerto do juiz (o Gusta olha a lista e diz quais erram).

## 13. Decisões
| # | pergunta | estado |
|---|---|---|
| G1 | Teto por workspace | **US$ 4/mês, decidido 04/11** (INTERNAL US$ 10) |
| G2 | Como os concorrentes entram | **Descoberta automática, decidido 04/11** (§2) |
| G3 | Entrada "URL de anúncio" | **Saiu, decidido 04/11.** Campeão por link: proposta no §6.4, falta ok (R11) |
| **R1** | Anúncio de concorrente pode ir pra template de **Edição** (republica o vídeo dele)? | Proposta: pode, com aviso obrigatório antes do Gerar, `rights = THIRD_PARTY`, sem travar (D1). **Pendente** |
| R2 | Pesquisa cobra crédito? | Proposta: incluída no plano. **Pendente** |
| R3 | SAMPLE: descoberta curta + 1 concorrente com 100 anúncios (≈ US$ 0,18 por conta, nosso) | **Pendente** |
| R5 | Alerta de anúncio novo/"escalou" e sync diário | Fase 2 |
| R6 | Anúncio de imagem → template Estático | Fase 2 |
| **R7** | Conta própria da Apify do HookMill com teto mensal (a R0 usou a do Trendcat, FREE, teto US$ 5; a `manageable_outfield` está estourada até 19/11) | **Pendente, bloqueia o live** |
| R8 | Nome na sidebar: "Research" / "Pesquisa", grupo "Make ads", entre Templates e Concepts | **Pendente** |
| R9 | PAID: 150 anúncios por concorrente (era 200) pra caber no teto de US$ 4; reserva de 10 | **Pendente** |
| R10 | Adicionar manual só pela equipe (o cliente não adiciona) | **Pendente** |
| R11 | Campeão por link: `AD_LIBRARY_MODE=off` já + esconder o campo no web; não consertar o `resolve()` | **Pendente** |
| R12 | Teto global US$ 10/dia (era 5) + 30 descobertas de amostra/dia | **Pendente** |
| R13 | Quando a descoberta roda: onboarding + Brain mudou (máx. 1 automática/30 dias) + botão 1×/7 dias | **Pendente** |
| R14 | Sonda R1 (até US$ 1,50) antes de ligar a descoberta live | **Pendente** |

## 14. Divisão do trabalho (depois do ok) — SUBSTITUÍDA pela C.10
Ordem: **design → arquiteto (migração) → ia + backend em paralelo (mock desde o início) → frontend → sonda R1 → qa.**
| dono | arquivos | depende de |
|---|---|---|
| maquina-design | `design/mockup-research.html` + nota datada: "procurando concorrentes", grid, barra de concorrentes com "por que este" e Remover, descoberta vazia, Removidos em Configurações, limite, coleta incompleta, modal do card, aviso R1 | este contrato |
| maquina-arquiteto | `api/prisma/schema.prisma` + migração (§4); `contratos/src/research.ts` (feito); `api/.env.example` (§10); `AD_LIBRARY_MODE=off` na produção (R11); revisão | ok do Gusta |
| maquina-ia | `integracoes/adlibrary/research.service.ts` (live/off), `fake-research.service.ts`, `mapear.ts` (estende `mapAdItem`: DCO/DPA, THREADS/WHATSAPP, curtidas, `oe`, itens com `error`), `integracoes/claude/` (`proposeCompetitors`, `judgeCompetitors`, prompts e esquemas, fakes), `contrato.ts`, `integracoes.module.ts`, testes de unidade | migração |
| maquina-backend | `api/src/research/` novo: `research.module.ts`, `discovery.service.ts` (gatilhos, pipeline D1–D5, reserva, bloqueio, trava de custo), `competitors.controller.ts`, `ads.controller.ts`, `sync.service.ts` (coletas, fusão, 30 %, limite adaptativo, aposentar, `@Interval` semanal), `media.service.ts`, `caps.service.ts` (teto do workspace, global, rateio), `retencao.service.ts`, `dto/*`; ganchos no onboarding/Brain (`inputHash`); `campeoes/` (`fromResearchAd`), `templates/` e `iteracao/` (`researchAdId`); `common/` (`SPEND_CAP_EXCEEDED` com `scope`); testes int | migração, portas (mock) |
| maquina-frontend | `web/src/app/(app)/research/`, `web/src/components/research/*`, `web/src/hooks/use-research.ts`, `web/src/lib/api/research.ts`, `sidebar.tsx` (item `research`), Configurações → Removidos, `messages/en.json` + `pt-BR.json`, `lib/routes.ts`; galeria aceita `?researchAdId=`; esconder o campo de link do campeão (R11) | mockup aprovado + backend ou `web/src/mocks/` |
| maquina-qa | `testes/research/*`: onboarding → descoberta → 5 seguidos + reserva → remover (vaga preenchida, não volta na re-descoberta) → restaurar → grid → salvar → usar em template (URL válida e vencida) → lote; tetos, 429, 30 %, isolamento, CLIENT só leitura, amostra; 1440/390 | tudo acima |

## Aprovação do Gusta (04/11, noite) — revisão da descoberta automática
- Aprovadas as recomendações R9 (150 anúncios por concorrente, reserva de 10), R10 (adicionar manual só equipe), R11 (campeão por link: `AD_LIBRARY_MODE=off` e esconder o campo), R12 (teto global US$ 10/dia, 30 descobertas de amostra/dia), R13 (quando a descoberta roda, como no §2).
- **Sonda R1 autorizada** (≤ US$ 1,50): descoberta completa em 3 Brains reais; o Gusta julga se acertou os concorrentes antes do código.
- Pendente: R7 (conta Apify própria) pra ligar em produção.
- **Sonda R1 feita (04/11):** [`ads-research-r1-2026-11-04.md`](ads-research-r1-2026-11-04.md), US$ 0,56 no total, US$ 0,10–0,14 por descoberta. Derruba o D3 em `keyword_unordered` (trocar por frase exata), o D2 só por domínio e o D5 só por score; ajustes no §4 de lá. Falta o Gusta marcar acertou/errou nas 3 tabelas.
- **Sonda R1, rodada 2 (04/11, noite), com os ajustes:** US$ 0,49 (total das 2 rodadas US$ 1,06), US$ 0,15–0,19 por descoberta. Melhorou Pocketwise e Geraew e piorou o Kingdom (termos de 2 palavras genéricos demais). A qualidade depende do termo de busca. Próximo ajuste: 6 termos de 2–3 palavras e descartar termo difuso (§6 da R1).
- **Sonda R1, rodada 3 (04/11, noite):** US$ 0,37 (total das 3 rodadas US$ 1,42), média US$ 0,12 por descoberta, 46–87 s. Termos tipados + troca de termo fraco deram a melhor lista na Geraew e recuperaram o Kingdom. **Recomendação final pro §2.2 (o que vira regra no código) no §8 da R1**, inclusive a memória entre descobertas (cada rodada vê um pedaço diferente do nicho).
