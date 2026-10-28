# Onboarding v2 · agência ou próprio, wizard fechado, volta ao setup, tour obrigatório, Home de performance
Data: 2026-10-21 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 21/10** (D1-D9 do §6 como recomendadas + spec do design). Tipos em `@maquina/contratos` (`contratos/src/onboarding-v2.ts` + aditivos em `index.ts`, `agencia.ts`, `cadastro.ts`), schema e migração `20261021000100_onboarding_v2` **já aplicados** (A2 feito 21/10). Código liberado na ordem do §7: B2 ‖ F2 (D1 já entregue) → Q2.
Base: `feedback/tordan-loom-2026-10-20.md` (vídeo 1 inteiro + vídeo 2 itens 1-6), `decisions/log.md` 21/10, [`fase2-agencia.md`](fase2-agencia.md) §3.3 (onboarding de 6 passos, `onboardingStep` só diz onde retomar) e §4 (papéis), [`fase2-cadastro.md`](fase2-cadastro.md) (signup → `/onboarding/1`), [`meta-v1.md`](meta-v1.md) (passo 2 e dados da Home), [`api.md` §1-2](api.md). Conteúdo visual (telas, textos do tour, Home nova) é do **maquina-design** em [`design/onboarding-v2-2026-10-21.md`](../../design/onboarding-v2-2026-10-21.md) (mockup https://claude.ai/artifact/PuvRF8SNr2mbpxwwBkVMiR); aqui só API, modelo e regras. Os itens "pedir ao arquiteto" da tabela §8 da spec estão fechados em §3.2 (`updatedBy`, tela Setup in progress), §3.5 (`GET /auth/me` com status e % por workspace), §3.1 (regra AGENCY → OWN) e, no meta-v1, §3.4 (erros do OAuth), §5.2-5.3 (`trend`, `sync`) e D13 (campeão a partir de um anúncio da Meta).

Nada da estrutura reabre: cliente continua = workspace, status continua derivado, os 6 passos continuam os mesmos. Este adendo muda **a entrada** (pergunta, gate, progresso, caminho de volta, tour) e liga o passo 2 ao meta-v1.

## 0. Resumo em 5 linhas
1. **`User.accountMode: AGENCY | OWN | null`**, respondido uma vez logo depois do cadastro (`PATCH /auth/me`), editável em Settings. `OWN` só muda o shell (sem seletor de cliente, sem "All clients"/"New client"); o workspace único continua embaixo. Nenhuma mudança de modelo além da coluna.
2. **Gate de setup:** com o workspace ativo em `SETUP`, OWNER/ADMIN só navegam em `/onboarding/*` (shell mínimo, sem sidebar); o resto redireciona pro passo salvo. MEMBER/CLIENT não são presos (não editam o setup). A API passa a devolver `onboarding.percent` (um número só pra barra, Clients e Home).
3. **Caminho de volta:** rota `/onboarding` (sem passo) leva ao passo salvo (ou ao 1 se concluído, modo edição); entradas em Settings ("Client setup"), Brain ("Edit in setup") e no cartão do Clients. Corrige o bug do Loom.
4. **Passo 2 "Connect Meta" vira real** (meta-v1 §3.1): conectar, escolher conta/página/pixel, health; "Skip for now" continua existindo (opcional). `META_MODE=off` esconde o passo (o wizard mostra 5).
5. **Tour obrigatório** na 1ª entrada depois do onboarding: `Membership.tourCompletedAt` (por usuário × workspace), `POST /workspace/tour/complete`; 5 paradas (Brain → Iterate a winner com vencedor real de `GET /meta/ads?verdict=WINNER` se houver → New concepts → Eddy → Home). Sem skip na 1ª vez (regra do web). Home de performance: só a lista do que a API expõe (§6).

## 1. Modelo de dados (diff em texto; migração `20261022000100_onboarding_v2`, aditiva, pelo arquiteto com `npm run db:backup` + `npm run db:diff`)
```prisma
enum AccountMode {
  AGENCY // vários clientes: seletor, Clients, New client
  OWN    // anúncios próprios: 1 workspace, shell sem seletor
}

model User {
  // ... existentes
  accountMode AccountMode? @map("account_mode") // NOVO. null = ainda não respondeu (pergunta pós-cadastro)
}

model Membership {
  // ... existentes
  tourCompletedAt DateTime? @map("tour_completed_at") // NOVO. null = ainda não fez o tour NESTE workspace
}

model Workspace {
  // ... existentes
  onboardingUpdatedById String?   @map("onboarding_updated_by_id") // NOVO. quem mexeu por último no setup (tela "Setup in progress")
  onboardingUpdatedAt   DateTime? @map("onboarding_updated_at")    // NOVO
  onboardingUpdatedBy   User?     @relation("OnboardingUpdatedBy", fields: [onboardingUpdatedById], references: [id], onDelete: SetNull)
}
```
`onboardingUpdatedBy/At` são gravados por `PATCH /workspace` (qualquer campo), `POST /workspace/onboarding/complete`, `POST /offers`/`PATCH /offers/:id` enquanto o workspace está em `SETUP`, e `PUT /meta/selection`. Backfill: null (os workspaces de hoje já estão LIVE; a tela não aparece).
**Backfill** (D2, D4): `users.account_mode = 'AGENCY'` pra todo usuário que já existe (ninguém de hoje é "próprio"; evita a pergunta aparecer pro Gusta e pro Tordan nas contas atuais); `memberships.tour_completed_at = created_at` pra todas as memberships que já existem (ninguém que já usa é preso no tour; quem quiser vê pelo "Replay tour"). Conta nova pelo signup nasce com `account_mode = null` e membership com `tour_completed_at = null`: é o caminho que o Tordan vai testar.

Por que `accountMode` no `User` e não no `Workspace`: a pergunta é sobre **quem usa** ("vai rodar como agência ou pra você mesmo?") e o que ela muda é o shell da pessoa (seletor, Clients), não o cliente. Um usuário pode ser membro de 5 workspaces; no `Workspace` a pergunta teria que ser repetida ou ficar inconsistente entre clientes, e um CLIENT convidado veria a pergunta de uma agência que não é dele. Pra "arquitetura de plano agência × próprio" (Loom 1, item 4) esse campo é o gancho: o plano/cobrança, quando vier, pendura no `User` (ou numa entidade de conta futura) e lê `accountMode` pra escolher o plano.

Por que `tourCompletedAt` na `Membership`: o tour é por pessoa **e** por cliente (o Tordan faz o tour no cliente A; um ADMIN que entra depois faz o dele). No `User` o 2º cliente não teria tour; no `Workspace` o 2º membro também não.

## 2. Tipos (`contratos/src/onboarding-v2.ts`, proposta)
```ts
type AccountMode = 'AGENCY' | 'OWN';

// aditivos em tipos existentes: APLICADOS em 21/10 como campos OPCIONAIS no pacote até B2 entregar (como a casa fez com WaitingBatchRef.mode); depois o arquiteto tira o `?`. O backend deve devolvê-los SEMPRE:
// AuthUser.accountMode?: AccountMode | null          (login, refresh, me, signup)
// WorkspaceRef.tourCompletedAt?: string | null        (só o workspace ATIVO da sessão/me, do membership do usuário nele)
// WorkspaceRef.status?: ClientStatus                  (ativo E cada item de MeResponse.workspaces[]; §3.5: "Setup 33 %" no seletor)
// WorkspaceRef.onboarding?: OnboardingSummary         (idem)
// Onboarding.percent?: number                         (0-100; 100 = concluído)
// Onboarding.steps?: OnboardingStepInfo[]             (6 itens; 5 com META_MODE=off, sem o passo 2)
// Onboarding.updatedBy?: UserRef | null               (quem mexeu por último no setup; tela "Setup in progress")
// Onboarding.updatedAt?: string | null
// UpdateMeBody.accountMode?: AccountMode              (PATCH /auth/me)
// SignupBody.accountMode?: AccountMode                (se o design puser a pergunta na própria tela de cadastro)

interface OnboardingSummary { step: OnboardingStep; percent: number; completedAt: string | null }   // versão curta pro seletor

interface OnboardingStepInfo {
  step: OnboardingStep;
  key: 'business' | 'meta' | 'offer' | 'audience' | 'goals' | 'brain';
  state: 'done' | 'current' | 'todo' | 'skipped';   // skipped: só o meta (pulado)
  enabled: boolean;                                  // meta = false com META_MODE=off (o web não mostra)
}
interface TourState { completedAt: string | null; stops: TourStop[] }   // GET /workspace/tour
type TourStop = 'brain' | 'iterate' | 'concepts' | 'eddy' | 'home';
interface TourCompleteResponse { tourCompletedAt: string }
```
`Onboarding.percent` (**regra D10, aprovada pelo Gusta 21/10**) = `completedAt ? 100 : round(counted / enabledSteps × 100)` onde **`counted` = passos com `enabled: true` e `state: 'done'` e `step < onboardingStep`** (o usuário já passou por ele: o Continue daquele passo gravou `onboardingStep = step + 1`). `onboardingStep` continua sendo só "onde retomar"; não há coluna nova. Consequências: conta nova (`onboardingStep = 1`) = **0 %** mesmo com o teto do signup preenchido; `META_MODE=off` divide por 5 (nunca mais 20 % na largada); passo pulado (`skipped`) não conta; o `state` de cada passo no `steps[]` **não muda** (goals continua `done` no trilho, pro check aparecer). Caso de borda aceito na v1: quem volta a um passo anterior pelo trilho e clica Continue regrava `onboardingStep` menor e o % cai até avançar de novo (só o Continue grava; o Back não). Se incomodar, o refinamento é a coluna `workspaces.onboarding_max_step INT NOT NULL DEFAULT 1` (maior passo já salvo; backfill = `onboarding_step`; migração aditiva do arquiteto) e a regra passa a usar `step < max(onboardingStep, onboardingMaxStep)`. Não criar agora. O estado de cada passo é **derivado** (uma função `onboardingSteps(ws, offers, metaConnection)` no backend, módulo `workspaces`, a mesma pro `GET /workspace`, pro cartão do Clients e pra Home):
| passo | `done` quando |
|---|---|
| 1 business | `resultType != null` e `name` não é o padrão vazio (resultado-v1, 28/10: era `businessType`; ver [`fase2-agencia.md`](fase2-agencia.md) "Mudanças 28/10") |
| 2 meta | conexão `ACTIVE` com conta e página escolhidas (`skipped` se `onboardingStep > 2` sem conexão) |
| 3 offer | ≥ 1 oferta ativa com `what` e `promise` |
| 4 audience | alguma oferta ativa com `audience` |
| 5 goals | `monthlySpendCapUsd != null` |
| 6 brain | `onboardingCompletedAt != null` |
Hoje o web calcula `pct = (step − 1)/6` só com a posição; o número novo reflete o que foi preenchido, fica igual na barra, no Clients e na Home, e usa os mesmos critérios que o `brainCompleteness` do web (que continua onde está, fase2 D5).

## 3. Endpoints
### 3.1 Pergunta "agência ou próprio" (rota existente, campo novo)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `PATCH /auth/me` | `{ accountMode?: 'AGENCY' \| 'OWN' }` (soma a `name`, `uiLocale`, `password`) | `AuthUser` com `accountMode` | 400 | todos (é do próprio usuário) |
| `POST /auth/signup` | `SignupBody` + `accountMode?` | igual; grava se vier | igual | pública |
| `POST /auth/login`, `/refresh`, `/switch-workspace`, `GET /auth/me` | sem mudança | `user.accountMode` e `workspace.tourCompletedAt` passam a vir | — | — |

Regras do web (sem rota nova):
- **Quando perguntar:** `user.accountMode === null` **e** o usuário é OWNER do workspace ativo → tela `/start` (fora do shell, mesmo molde do `/signup`) antes de qualquer outra coisa. Não é OWNER (foi convidado) → não pergunta; o shell trata `null` como `AGENCY`.
- **`OWN`:** sidebar sem `ClientSwitcher`, sem "All clients", sem rota `/clients` (redirect pra `/`), sem "New client"; cabeçalho mostra só o nome do workspace. "Save and exit" do onboarding vira "Log out" (não há pra onde sair). Tudo o mais igual.
- **`AGENCY`:** como hoje.
- **Mudar depois:** Settings → Account → "How you use HookMill" (`PATCH /auth/me`). **OWN → AGENCY** nunca falha e não cria nada (o workspace de hoje vira o 1º cliente). **AGENCY → OWN** é permitido mesmo com mais de 1 membership (D9): a API grava, o shell esconde o seletor e a pessoa fica no workspace ativo; a tela de Settings mostra o aviso "You're a member of N clients; switch back to agency to see them" e o `GET /auth/me.workspaces[]` continua trazendo todos (nada é apagado, nada fica inacessível: o `switch-workspace` segue funcionando por link direto). A spec do design pedia `409` nesse caso: divergência registrada em D9 com a regra exata caso o Gusta prefira o 409.

### 3.2 Gate de setup e progresso (rotas existentes, campos novos)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /workspace` | — | `Workspace` + `onboarding.percent` + `onboarding.steps` | — | todos |
| `GET /workspaces` | — | cada `ClientCard.onboarding` com `percent` (o cartão do Clients mostra "62 %") | — | todos |
| `PATCH /workspace` | sem mudança (`onboardingStep` continua livre 1..6) | idem | idem | OWNER, ADMIN |
| `POST /workspace/onboarding/complete` | sem mudança | idem (`percent: 100`) | idem | OWNER, ADMIN |

Regras do web:
- **Gate (regra final, 21/10 pós-QA):** no `AppShell`, com `workspace.status === 'SETUP'` e papel OWNER/ADMIN, **qualquer rota fora de `/start` e `/onboarding/*`** (inclusive `/settings` e `/settings/connections`) → `router.replace(onboardingHref(ws.onboarding.step))`. Senha e idioma se trocam depois do setup (o idioma já tem o toggle no shell mínimo). Simplifica o que a 1ª versão dizia ("`/settings` aba Account liberada"): uma exceção a menos e o Connect Meta do setup já é o passo 2. Em `SETUP` o shell é o **mínimo**: logo, nome do cliente, idioma, "Save and exit" (AGENCY → `/clients`; OWN → "Log out") — sem sidebar e sem topbar de navegação. Os passos já têm o trilho próprio (`OnboardingFrame`); o shell mínimo é o `AppShell` sem `Sidebar`/`MobileTopbar` quando o gate está ativo.
- **MEMBER/CLIENT** num workspace em `SETUP`: veem a tela **"Setup in progress"** (sem shell, spec do design §5 e pergunta 9: "Tordan is setting Mooncloth up · step 2 of 6 · 33 %"), com o seletor de cliente se tiverem outro workspace e "Log out". A frase usa `onboarding.updatedBy` (§2; `null` → "This client is still being set up"). Não há gate pra eles no sentido de redirect pro wizard (não podem editar); a tela substitui o app inteiro enquanto `status = SETUP`. Mudei em relação à minha 1ª versão (app normal com banner) porque a spec mostrou que é o mesmo "app vazio" que o Tordan rejeitou; a API só precisa expor `updatedBy`.
- **Barra de progresso em %:** usa `onboarding.percent` da API (desktop no trilho, phone no cabeçalho compacto); o cálculo local `pct` do `OnboardingFrame` sai.
- **Depois de `complete`:** o web invalida `["workspace"]`, `["me"]` e a sessão (o `tourCompletedAt` vem no `/auth/me`), e vai pra 1ª parada do tour (§3.4).

### 3.3 Caminho de volta ao setup (só web; bug do Loom 1, 0:24)
| rota web | o que faz |
|---|---|
| `/onboarding` (sem passo) | redirect: em `SETUP` → `onboardingHref(ws.onboarding.step)`; concluído → `/onboarding/business` em modo edição (`eyebrowEdit`, já existe) |
| Settings → "Client setup" (card com `percent` e "Edit setup") | link pra `/onboarding` |
| Brain → "Edit in setup" (já existe o mapa `BRAIN_ITEM_STEP`) | link pro passo do item |
| Clients → cartão | `clientHref()` como hoje |
| Sidebar (AGENCY e OWN), grupo Settings | item "Setup" → `/onboarding` |
Nenhuma rota de API nova: `onboardingStep` já vai pra frente e pra trás e o modo edição depois de concluído já existe (409 `onboarding_completed` só se mandar o passo).

### 3.4 Tour
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /workspace/tour` | — | `TourState`: `completedAt` do membership do usuário neste workspace; `stops` = as 5 paradas, **sem `iterate` quando não há conexão Meta ativa ou `GET /meta/ads?verdict=WINNER` está vazio** (Loom 2, 1:42: "se não houver anúncio, pula"); `eddy` fica (a tela Em breve de hoje conta como parada, o design decide o texto) | — | todos (`@ClientAllowed`) |
| `POST /workspace/tour/complete` | `{}` | `TourCompleteResponse`. Idempotente (já concluído devolve a data gravada) | — | todos (`@ClientAllowed`) |

Regras:
- **Quando roda:** `workspace.tourCompletedAt === null` (da sessão) **e** `workspace.status !== 'SETUP'` → o web entra em modo tour na 1ª tela carregada e segue as `stops` na ordem. Sem skip e sem fechar na 1ª vez (regra do web; a API não impõe nada além do estado). Ao terminar a última parada, `POST /workspace/tour/complete`, atualiza a sessão local e libera o app.
- **Parada `brain`:** o web mostra o Brain com `brainCompleteness` subindo (animação do design; o número é o real).
- **Parada `iterate`:** `GET /meta/ads?verdict=WINNER&limit=1` → mostra o anúncio com os números e o botão de iterar (vai pro "Pick from Meta" com ele pré-selecionado). Sem conexão → parada ausente de `stops`.
- **Replay:** Settings → "Replay tour" roda o mesmo tour **sem** mexer em `tourCompletedAt` (local), com skip permitido. Sem rota de reset.
- **Membro novo** (convite aceito) num workspace LIVE: tem `tourCompletedAt = null` → faz o tour na 1ª entrada. CLIENT também (as paradas que ele não pode usar aparecem só como leitura; é o papel que já barra as ações).
- `MeResponse.workspaces[]` **não** ganha `tourCompletedAt` (só o ativo; trocar de workspace já reemite a sessão pelo `switch-workspace`).

### 3.5 Seletor de cliente com "Setup 33 %" (rota existente, campos novos)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /auth/me` | — | `workspace` e cada item de `workspaces[]` ganham `status: ClientStatus` e `onboarding: OnboardingSummary` (`step`, `percent`, `completedAt`); só o `workspace` ativo ganha `tourCompletedAt` | — | todos |
| `POST /auth/login`, `/refresh`, `/switch-workspace`, `/signup`, `POST /workspaces` | sem mudança | o `workspace` da sessão vem com os mesmos campos | — | — |

Implementação (backend): a mesma `onboardingSteps()` do §2, em lote: 1 query de memberships + 1 `groupBy(workspaceId)` de ofertas ativas com `what`/`promise`/`audience` + 1 `findMany` de `MetaConnection` dos workspaces (sem N+1). O seletor mostra "Setup 33 %" quando `status = SETUP` e nada quando `LIVE`/`PAUSED` (o chip de pausado já existe no Clients). `MeResponse.workspaces[]` **não** traz `steps[]` (é a lista do seletor; o detalhe fica no `GET /workspace`).

### 3.6 Passo 2 "Connect Meta" (liga no meta-v1 §3.1; o web troca o Em breve)
- Estado inicial: `GET /meta/connection` = `null` → botão "Continue with Facebook" (`POST /meta/connect { returnTo: '/onboarding/meta' }` → abre `url` na mesma aba). Volta do callback com `?meta=connected` → `GET /meta/options` → seletor de conta, página, pixel (opcional) → `PUT /meta/selection` → health na tela (`checks` do meta-v1 §2) → **Continue** (= `PATCH /workspace { onboardingStep: 3 }`). `?meta=error&code=` → mensagem pelo `code` + tentar de novo.
- **"Connect from another browser"** (link secundário abaixo do botão azul; caso real do Gusta 22/10, Multilogin/AdsPower com o Facebook da conta logado em outro navegador): `POST /meta/connect { returnTo: '/meta/done' }` → a tela mostra a `url` com **Copy link** e a contagem até `expiresAt` (10 min) e faz polling de `GET /meta/oauth/status` a cada 3 s (meta-v1 §3.1); quando `pending = false`, refaz `GET /meta/connection` e cai no seletor de conta como no fluxo normal, ou mostra `lastError` com "Try again". No outro navegador, `/meta/done` (fora do shell, sem sessão) diz "Connected, go back to HookMill" ou o erro. Mesma regra de papéis (OWNER/ADMIN) e mesmo passo 2; Settings › Connections tem o mesmo link.
- "Skip for now" continua: `onboardingStep: 3` sem conexão; o passo fica `skipped` no `onboarding.steps` e o Settings lembra ("Connect Meta to see results").
- `META_MODE=off` (`GET /workspace/services` com `META.connected = false` e `reason off`, ou `503 META_NOT_CONFIGURED { reason: 'off' }` no `connect`): o passo some do trilho (`enabled: false`), `onboardingHref(2)` pula pro 3, o wizard vira 5 passos e o `percent` divide por 5.
- Quem não é OWNER/ADMIN vê o passo em leitura (como os outros).

## 4. Home de performance (registro; a tela é do design)
A Home vai ser redesenhada pelo maquina-design pra mostrar performance em vez do "Waiting on you" vazio + skeletons (Loom 2, 3:29). A API **não ganha rota nova** pra isso: tudo sai do que já existe ou do meta-v1. O que o design pode usar:
| bloco | fonte | observação |
|---|---|---|
| KPIs 7 d / 30 d (gasto, resultados, CPA, ROAS, CTR, hook rate) com seta de variação (`prev`), ativos, novos na semana, cansando, e "synced X min ago" / "First sync, 40 of 120 ads" | `GET /meta/summary?period=7d\|30d` (meta-v1 §3.2, §5.3 `sync`) | `sync.state`: `never` → CTA "Choose an ad account"; `first_sync` → barra com `progress`; `stale`/`failed` → aviso + "Sync now"; sem conexão = estado vazio com CTA "Connect Meta" |
| Vencedores / o que está rodando (top 3 anúncios com chip WINNER/OK/LOW_DATA, `trend` working/steady/tiring e a regra explicada) | `GET /meta/ads?sort=spend&limit=3` + `meta.summary.rule` (meta-v1 §5.2) | `creative` preenchido = publicado pelo HookMill (link pro criativo); `championId` = já iterado; `trend` = `null` mostra "—" |
| Publicado pelo HookMill (pausado / ativo / falhou, com ação) | `GET /meta/publications?limit=6` | `adsManagerUrl` pra abrir na Meta |
| Waiting on you (criativos + lotes) | `GET /creatives?filter=needs_you&limit=6` → `meta.waitingOnYou`, `meta.waitingBatches` | sem mudança (fase2 §3.6) |
| Brain % e o que falta | `GET /workspace` + `GET /offers` → `brainCompleteness()` no web | sem mudança (fase2 §5) |
| Setup % (cliente em `SETUP`, visto por MEMBER/CLIENT) | `GET /workspace` → `onboarding.percent` | §2 |
| Conexão Meta (saúde, token expirando) | `GET /meta/connection` → `health`, `tokenExpiresAt` | aviso a partir de 7 dias |
Polling: a Home continua com os 5 s do `GET /creatives` só com linha em andamento (`eventos.md` §2); os blocos da Meta carregam ao abrir e no foco (React Query), sem polling. Em `accountMode = OWN` a Home é a mesma, sem o nome do cliente no título.

## 5. Erros
Nenhum código novo. Usos novos: `400 VALIDATION_ERROR` em `accountMode` fora de `AGENCY|OWN`. O gate e o tour são regras do web sobre estado da API; a API não bloqueia rota nenhuma por `SETUP` (MEMBER/CLIENT continuam lendo).

## 6. Decisões (numeradas; recomendação em negrito)
- **D1 `accountMode` no `User`** (não no `Workspace`): **sim**, pelos motivos do §1. `null` = não respondeu; o shell trata `null` como `AGENCY`. Alternativa: coluna no `Workspace` (teria que repetir por cliente) ou entidade "Account" nova (cedo demais; fase2 D3 continua).
- **D2 Backfill dos usuários de hoje como `AGENCY`**: **sim**, pra ninguém que já usa ver a pergunta. O Tordan testa o fluxo criando conta nova pelo `/signup` (que é o que ele vai fazer de qualquer jeito). Alternativa: deixar `null` e perguntar a todos no próximo login.
- **D3 Gate só pra OWNER/ADMIN** em workspace `SETUP`: **sim**. MEMBER/CLIENT não podem editar o setup, então prendê-los no wizard seria uma tela em que não fazem nada. "Save and exit" em `OWN` vira "Log out".
- **D4 Tour no `Membership` com backfill = concluído**: **sim**. Quem já usa não é preso; "Replay tour" em Settings. Conta nova e membro novo fazem o tour. Alternativa: `null` pra todos (Gusta e Tordan seriam presos no tour no próximo login).
- **D5 `percent` calculado na API** (por conteúdo, 6 critérios do §2) **em vez de posição no web**: **sim**, um número só em barra, Clients e Home. Alternativa: manter `(step − 1)/6` no web (não reflete o que foi pulado nem o que já está preenchido).
- **D6 Parada "Iterate a winner" só com vencedor real**: **sim** (pedido do Tordan); sem conexão a parada some, o tour fica com 4. Alternativa: parada com exemplo estático (contradiz "entregar valor antes de tela vazia").
- **D7 Passo 2 continua opcional ("Skip for now")**: **sim**; conectar não é condição pra concluir o onboarding (`ONBOARDING_INCOMPLETE` continua só resultado/`offer`; desde 28/10 a chave é `resultType`). Alternativa: obrigar (travaria quem ainda não tem acesso à conta do cliente).
- **D8 A pergunta é tela própria `/start` logo após o cadastro** (ordem do Loom 1, 2:24: Registro → Agência ou próprio → Wizard), não um campo no `/signup`: **sim**, uma decisão por tela; o `SignupBody.accountMode?` fica opcional pro caso de o design preferir juntar. (A spec do design chama a tela de "Welcome" e, na opção AGENCY, chama `POST /workspaces` direto do Continue; compatível: o workspace do cadastro já existe e vira o 1º cliente, então o Continue **não** precisa criar outro. Se o design quiser criar um cliente nomeado ali, é `PATCH /workspace { name }`, não `POST /workspaces`, senão a conta nasce com 2 clientes.)
- **D10 (revisão 21/10; aprovada pelo Gusta 21/10, regra final em §2) Conta nova nasce com 17 %** porque o cadastro já grava `monthlySpendCapUsd = SIGNUP_DEFAULT_SPEND_CAP_USD` e o passo goals conta como `done`. **Recomendo mudar a regra do `percent`: um passo só conta como `done` se já foi alcançado (`step ≤ onboardingStep`, ou onboarding concluído).** Conta nova no passo 1 = 0 %; chegou no goals com o teto preenchido = conta. O `state` do passo não muda (goals continua `done` no `steps[]`, pro trilho mostrar o check), só o número da barra. Mudança de 1 linha em `onboardingPercent()` (`api/src/workspaces/onboarding.ts`), **depois do QA**. Alternativa: manter 17 % (o teto está de fato preenchido) ou zerar o teto no cadastro (perde a trava de gasto do fase2-cadastro, não recomendo).
- **D9 AGENCY → OWN com mais de 1 membership: permitido, com aviso em Settings** (mantida contra a spec do design, que pedia 409). Motivo: a troca não destrói nada e o estado é reversível; um 409 obrigaria a pessoa a sair dos outros workspaces (ou excluí-los, que não existe) só pra mudar um rótulo do shell. **Divergência registrada.** Se o Gusta preferir o 409 do design, a regra fica: `PATCH /auth/me { accountMode: 'OWN' }` com `count(memberships) > 1` → `409 INVALID_STATE { reason: 'multiple_workspaces', details: { workspaces: n } }`, mensagem "You're a member of N clients. Leave the others first, or keep the agency mode." (e aí precisaria de "Leave client" = `DELETE /workspace/members/:userId` em si mesmo, que já existe mas é só OWNER; MEMBER/CLIENT não teriam saída). É por isso que recomendo permitir.

## 7. Tarefas por agente (dependências e verificação)
| # | agente | tarefa | depende de | verificação |
|---|---|---|---|---|
| A2 | arquiteto | ok do Gusta → exportar `onboarding-v2.ts` no `index.ts` + campos opcionais do §2 em `AuthUser`, `WorkspaceRef`, `Onboarding`, `UpdateMeBody`, `SignupBody`; schema + migração `onboarding_v2` (backup, `db:diff`, backfills do §1); `api.md` §2/§3/§14/§16, `modelo-de-dados.md` | ok do Gusta | `prisma validate`, `tsc` do pacote |
| D1 | design | `design/onboarding-v2-2026-10-21.md`: tela `/start` (pergunta), shell mínimo do setup com % no topo, passo 2 real (estados: desconectado, escolhendo conta, saúde ok/não ok, pulado), 5 paradas do tour (texto + onde ancora), Home de performance com os blocos do §4, bloco Meta em Settings, "Client setup"/"Replay tour" em Settings | este contrato | mockup aprovado pelo Gusta |
| B2 | backend | `accountMode` no `PATCH /auth/me`/signup/sessão (AGENCY → OWN sem 409, D9); `tourCompletedAt` na sessão (`issue()` lê o membership) + `GET /workspace/tour` (`stops` consultando o `MetaService` só se conectado) + `POST /workspace/tour/complete` (`@ClientAllowed`); `onboardingSteps()` + `percent` + `updatedBy` no `GET /workspace`, no `GET /workspaces` e **em lote no `GET /auth/me`/sessão** (§3.5, sem N+1); gravar `onboardingUpdatedBy/At` nos 4 pontos do §1; migração aplicada com backup | A2; meta-v1 B1 pra `stops.iterate` (até lá, `stops` sem `iterate`) | Jest + int: signup novo nasce `accountMode null` e `tourCompletedAt null`; backfill deixa os atuais `AGENCY`/concluído; `percent` com os 6 critérios (0 %, pulado, 100 %); `META_MODE=off` → 5 passos e `enabled false`; `GET /auth/me` traz `status`/`percent` em todos os workspaces com 1 query por tabela; `updatedBy` muda após `PATCH /workspace` por outro usuário; OWN com 2 memberships = 200; `tour/complete` idempotente; CLIENT consegue completar o tour; api `tsc` ok |
| F2 | frontend | `/start`; shell em `OWN` (sem switcher/Clients/New client; redirect de `/clients`); gate de `SETUP` + shell mínimo; `percent` da API no trilho e no phone; `/onboarding` sem passo + entradas em Settings/Brain/sidebar; passo 2 real (meta-v1 F1 cobre a tela; aqui é a ligação no trilho, `skipped`, `enabled`); tour (5 paradas, sem skip na 1ª vez, replay em Settings); Home nova do mockup D1; Settings → Account → modo; MSW | A2 (tipos), D1 (mockup), B2 ou MSW; meta-v1 F1 | web `tsc`; sem sessão nada muda; conta nova: `/signup` → `/start` → `/onboarding/business` sem sidebar → … → complete → tour → Home; OWN esconde o seletor; `/onboarding` volta ao passo; MEMBER em SETUP não é preso; desktop e 390 px, EN/PT |
| Q2 | qa | ponta a ponta como usuário novo em mock (meta-v1 em mock): cadastro → pergunta (OWN e AGENCY, um de cada) → wizard fechado com % subindo → passo 2 conectando e pulando → complete → tour sem skip (com e sem vencedor) → Home com números; voltar ao setup por Settings/Brain/`/onboarding`; convidado MEMBER e CLIENT (sem pergunta, tour próprio, sem gate); `META_MODE=off` (5 passos, sem parada iterate); desktop e 390 px, EN/PT | B2, F2 | só o qa declara "funciona" |
| — | ia, video | nada | — | — |

Pastas sem conflito: A2 = `docs/`, `contratos/src/`, `api/prisma/`; D1 = `design/`; B2 = `api/src/auth/` (sessão, DTO do me/signup), `api/src/workspaces/` (steps, percent, tour); F2 = `web/`; Q2 = `testes/`. B2 não toca em `api/src/meta/` (só injeta o `META_SERVICE` pra `stops`). Ordem: A1+A2 juntos (uma janela de pacote), depois I1 ‖ B1 ‖ B2 ‖ D1, depois F1+F2 (F2 pode começar pelo `/start`, shell OWN, gate e volta ao setup, que não dependem do design da Home nem da Meta), depois Q1+Q2.
