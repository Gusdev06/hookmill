# Fase 2 · agência multi-cliente: contrato mínimo (F1)
Data: 2026-10-12 · Dono: maquina-arquiteto · Status: **aprovado pelo Gusta em 12/10** (D1-D6 do §9 como estão + ajuste: a Home conta os lotes no "waiting on you", §3.6). Tipos em `@maquina/contratos` (`contratos/src/agencia.ts` + mudanças no `index.ts`), já aplicados.

## Mudanças 12/10 (aprovação)
- **Home conta lotes:** `GET /creatives` ganha `meta.waitingOnYou` (mesma regra e mesmo número do cartão do Clients) e `meta.waitingBatches` (§3.6).
- **`brainCompleteness` mora no web** (`web/src/lib/brain.ts`), não no pacote: o `@maquina/contratos` é só tipos. O pacote tem o tipo da saída (`BrainCompleteness`). Só o web usa a função (Home e Brain), então o número continua único.
- **Build vermelho esperado até B1/B2/F1:** os tipos novos são obrigatórios. `tsc` hoje acusa no api `criativos.service.ts`, `criativos/views.ts`, `biblioteca.service.ts`, `common/errors/error-codes.ts`; no web `settings/page.tsx`, `invite-form.tsx` (rótulo do papel CLIENT) e os mocks (`db.ts`, `fixtures.ts`, `handlers.ts`). Cada dono fecha os seus.
Base: `decisions/log.md` (12/10, fase 2 + F0), [`design/plano-fase2-ads-machine-2026-10-12.md`](../../design/plano-fase2-ads-machine-2026-10-12.md) (F1), [`design/fase2-telas-novas-2026-10-12.md`](../../design/fase2-telas-novas-2026-10-12.md) (§8 e §2.11), [`design/analise-mockup-ads-machine-2026-10-12.md`](../../design/analise-mockup-ads-machine-2026-10-12.md). Convenções, envelope e erros: [`api.md` §1](api.md). Escopo: só as telas ✅/🛠 do plano. Nada das ⏳ (§8).

## Mudanças 28/10 · resultado-v1 (teste manual do Gusta, A2 + A3; `testes/teste-manual-gusta-2026-10-28.md`)
**Proposto e implementado num worktree em 28/10; falta o ok do Gusta e o QA.** A pergunta do passo 1 "What kind of business is it?" (3 opções) vira **"What counts as a result?"** (8 opções), e a leitura do site pré-preenche o passo 1.

**Modelo** (migração `20261028000100_result_type`, aditiva): enum `ResultType { PURCHASE LEAD MESSAGE APPOINTMENT SIGNUP SUBSCRIPTION APP_INSTALL OTHER }`, colunas `workspaces.result_type` (null = não escolheu) e `workspaces.result_type_other` (≤ 80, só com `OTHER`). Backfill: `ONLINE_STORE → PURCHASE`, `LOCAL_BUSINESS → LEAD`, `APP → APP_INSTALL`. `business_type` **fica** por 1 versão, gravado pela API derivado do `result_type` (a API anterior ainda lê); sai numa migração própria depois do deploy.

**API:** `Workspace` e `ClientCard` ganham `resultType` (+ `resultTypeOther` no `Workspace`); `businessType` vira `@deprecated` derivado (tabela abaixo; OTHER → null). `PATCH /workspace` e `POST /workspaces` aceitam `resultType`/`resultTypeOther`; `businessType` sem `resultType` no mesmo corpo **migra** pelo backfill. Estado final `OTHER` sem texto = `400 VALIDATION_ERROR { field: 'resultTypeOther' }`; trocar pra outro tipo limpa o texto. `ONBOARDING_INCOMPLETE.missing` passa a usar `'resultType'` (era `'businessType'`) e continua exigindo o campo. Passo 1 `done` = `resultType != null` e nome próprio. `DefaultResult` ganha `MESSAGES | APPOINTMENTS | SIGNUPS | SUBSCRIPTIONS | RESULTS`. Tudo num lugar só: `api/src/workspaces/resultado.ts`.

### §1.1 ResultType → Meta (publicação e sync)
| resultType | rótulo (EN) | objetivo (publicação v1) | `custom_event_type` do pixel | o sync conta como resultado (`action_type`, fallback) | `defaultResult` | `businessType` (compat) |
|---|---|---|---|---|---|---|
| PURCHASE | Purchase | OUTCOME_SALES | PURCHASE | omni_purchase, purchase | PURCHASES | ONLINE_STORE |
| SUBSCRIPTION | Subscription | OUTCOME_SALES | SUBSCRIBE | subscribe_total, subscribe_website | SUBSCRIPTIONS | ONLINE_STORE |
| LEAD | Lead | OUTCOME_LEADS | LEAD | lead, onsite_conversion.lead_grouped | LEADS | LOCAL_BUSINESS |
| APPOINTMENT | Appointment | OUTCOME_LEADS | SCHEDULE | schedule_total, schedule_website | APPOINTMENTS | LOCAL_BUSINESS |
| SIGNUP | Sign-up | OUTCOME_LEADS | COMPLETE_REGISTRATION | omni_complete_registration, complete_registration | SIGNUPS | LOCAL_BUSINESS |
| MESSAGE | Message | OUTCOME_TRAFFIC (v1 só publica com destino site) | — | onsite_conversion.messaging_conversation_started_7d, …total_messaging_connection (conta **sem** pixel) | MESSAGES | LOCAL_BUSINESS |
| APP_INSTALL | App install | OUTCOME_APP_PROMOTION | — (app registrado) | omni_app_install, mobile_app_install | INSTALLS | APP |
| OTHER | Other (texto) | OUTCOME_TRAFFIC | — | link_click | RESULTS | null |
Regras que não mudam: sem pixel, SALES/LEADS/APP caem pra TRAFFIC (`objectiveReason: 'no_pixel'`) e o sync conta clique (menos MESSAGE). O evento vai em `MetaPublishSettings.pixelEvent` (e `MetaPublishDefaults.pixelEvent`): o do resultType quando o objetivo é o dele; trocou o objetivo na publicação = evento padrão do objetivo (SALES → PURCHASE, LEADS → LEAD); publicação antiga sem `pixelEvent` = como antes. **Não conferido ao vivo:** os `action_type` de SUBSCRIPTION/APPOINTMENT/SIGNUP/MESSAGE (não há anúncio desses tipos numa conta conectada); o fallback cobre a variante por canal. Fora da v1: CTWA/Direct/Messenger como destino (`OUTCOME_ENGAGEMENT` + `CONVERSATIONS`), lead form nativo.

### §1.2 Pré-preenchimento pela leitura (A2)
`OfferExtractOutput.business: BusinessSuggestion` (o backend preenche sempre): `industry` e `market` (saída estruturada do Claude, string vazia = não sabe → null), `resultType` (enum + `UNKNOWN` → null; quiz que termina em checkout = PURCHASE), `brandColor` + `brandColorSource` (**nunca do modelo**: fundo computado dos CTAs visíveis no DOM renderizado, agrupado por cor e pesado por área, só cor saturada; sem render na cascata, uma sonda abre a principal sem scroll em paralelo com as subpáginas; fallback `<meta name="theme-color">`; senão null) e `shortCode` (2-6 [A-Z0-9] a partir do nome, sem repetir o `shortCode` de outro workspace de quem é membro deste). O web pré-preenche **só campo vazio** (o código só enquanto ninguém digitou nele; o nome só se for o padrão "New client"), tudo editável, com o selo "from your site" enquanto o valor é o sugerido.

## 0. Resumo em 5 linhas
1. **Cliente = Workspace.** Ganha `shortCode`, `industry`, `market`, `businessType`, `websiteUrl`, `onboardingStep`, `onboardingCompletedAt`, `pausedAt`. O `status` (SETUP / LIVE / PAUSED) é **derivado**, não salvo.
2. **Papel novo `CLIENT`** ("Client · approves ads"): lê tudo, aprova, baixa, marca vencedor, pede ajuste de texto; não gasta dinheiro e não mexe em configurações. OWNER/ADMIN = "Agency admin". Nada do que existe muda.
3. **Rotas novas:** `GET /workspaces` (tela Clients), `POST /workspaces` (New client, já troca a sessão), `POST /workspace/onboarding/complete`, `GET /creatives/:id/download`. O `PATCH /workspace` passa a aceitar os campos novos e o passo do onboarding.
4. **Brain v0 sem endpoint novo:** o web monta com `GET /workspace` + `GET /offers` + `GET /creatives?filter=approved&limit=1`. O % sai de uma função pura no web (`web/src/lib/brain.ts`), a mesma pra Home e Brain.
5. **Nome do MP4 nasce na API** (`MC_NEW_1012_A_F2_9x16.mp4`) e é congelado no OK final em `Creative.adName`.

## 1. Modelo de dados (diff do `schema.prisma`, em texto; a migração é do arquiteto, com backup)
```prisma
enum MemberRole {
  OWNER
  ADMIN
  MEMBER
  CLIENT // NOVO: cliente final da agência. Lê, aprova, baixa; não gasta nem configura (§4)
}

// NOVO. Define o resultado padrão (derivado, não salvo): ONLINE_STORE → PURCHASES, LOCAL_BUSINESS → LEADS, APP → INSTALLS.
// Produto digital/infoproduto = ONLINE_STORE (vende online, o resultado é compra).
enum BusinessType {
  ONLINE_STORE
  LOCAL_BUSINESS
  APP
}

model Workspace {
  // ... campos atuais sem mudança (id, name, uiLocale, monthlySpendCapUsd, createdAt, updatedAt)
  shortCode             String        @map("short_code") // NOVO. 2-6 [A-Z0-9]; prefixo do nome do arquivo ("MC"). Não é único
  industry              String?       // NOVO. texto livre ≤ 80 ("Sleep products", "Dental clinic")
  market                String?       // NOVO. mercado principal, texto livre ≤ 80 ("United States", "Brasil")
  businessType          BusinessType? @map("business_type") // NOVO
  websiteUrl            String?       @map("website_url") // NOVO. http(s), ≤ 2048
  onboardingStep        Int           @default(1) @map("onboarding_step") // NOVO. 1..6, onde retomar o onboarding
  onboardingCompletedAt DateTime?     @map("onboarding_completed_at") // NOVO. null = em setup
  pausedAt              DateTime?     @map("paused_at") // NOVO. não null = pausado
}

model Invite {
  role MemberRole @default(MEMBER) // sem mudança no tipo; passa a aceitar CLIENT (§3.4)
}

model Creative {
  // ... campos atuais sem mudança
  adName String? @map("ad_name") // NOVO. nome padronizado do arquivo SEM ".mp4", congelado no OK final (§6)

  @@unique([workspaceId, adName]) // NOVO (null não colide no Postgres)
}
```
**Status derivado** (uma função, `clientStatusOf(ws)`): `pausedAt != null` → `PAUSED`; senão `onboardingCompletedAt != null` → `LIVE`; senão `SETUP`. Salvar status em coluna criaria dois lugares pra mesma verdade.

**Migração** `20261012000000_fase2_agencia` (aditiva, escrita pelo arquiteto via `npm run db:diff`, com `npm run db:backup` antes, regra do TIME.md):
- `ALTER TYPE "MemberRole" ADD VALUE 'CLIENT'`; `CREATE TYPE "BusinessType"`; colunas novas.
- **Backfill dos workspaces que já existem:** `onboarding_completed_at = created_at` (eles já operam; não podem cair em Setup), `onboarding_step = 6`, `short_code` = 2 primeiras letras/dígitos do nome em maiúsculas (`'WS'` se não sobrar nada). Depois do backfill, `short_code` vira `NOT NULL`.
- Nenhuma coluna removida, nenhum enum renomeado. O que já existe continua válido.

## 2. Tipos compartilhados (em `@maquina/contratos`: `src/agencia.ts` + `Workspace`, `UpdateWorkspaceBody`, `Role`, `CreateInviteBody`, `CreativesMeta`, `CreativeDetail`, `LibraryItem` e erros no `src/index.ts`; aplicados 12/10)
```ts
type Role = 'OWNER'|'ADMIN'|'MEMBER'|'CLIENT';                 // ganha CLIENT
type BusinessType = 'ONLINE_STORE'|'LOCAL_BUSINESS'|'APP';
type DefaultResult = 'PURCHASES'|'LEADS'|'INSTALLS';           // derivado de BusinessType
type ClientStatus = 'SETUP'|'LIVE'|'PAUSED';                   // derivado (§1)

interface Onboarding { step: 1|2|3|4|5|6; totalSteps: 6; completedAt: string|null }

// GET /workspace e PATCH /workspace (substitui o `Workspace` de hoje; os 4 campos antigos continuam iguais)
interface Workspace {
  id: string; name: string; uiLocale: UiLocale; monthlySpendCapUsd: number|null;
  shortCode: string; industry: string|null; market: string|null;
  businessType: BusinessType|null; defaultResult: DefaultResult|null;
  websiteUrl: string|null;
  status: ClientStatus; onboarding: Onboarding;
}

interface WaitingOnYou {
  creatives: number;   // MESMA regra do `meta.counts.needs_you` da Home (waiting + failed, sem rascunho de 7+ dias)
  batches: number;     // lotes PLAN_READY ou PLAN_FAILED de campeão não arquivado (esperando launch ou replan)
  total: number;       // creatives + batches
}

interface ClientCard {                       // um cartão da tela Clients
  id: string; name: string; shortCode: string;
  role: Role;                                // papel do usuário NESTE workspace
  isActive: boolean;                         // é o workspace da sessão
  status: ClientStatus; onboarding: Onboarding;
  industry: string|null; businessType: BusinessType|null; websiteUrl: string|null;
  waitingOnYou: WaitingOnYou;
  updatedAt: string;
}

interface ClientsMeta {
  summary: { live: number; setup: number; paused: number; waitingTotal: number };
  canCreate: boolean;                        // papel OWNER/ADMIN no workspace ativo (mostra "New client")
}

interface CreateClientBody {
  name: string;                              // 1-80
  shortCode?: string;                        // 2-6 [A-Z0-9]; sem = derivado do nome (iniciais das palavras, senão 2 primeiras letras)
  uiLocale?: UiLocale;                       // sem = o do usuário
  websiteUrl?: string; industry?: string; market?: string; businessType?: BusinessType;
  copyTeam?: boolean;                        // padrão true: OWNER/ADMIN do workspace ativo entram com o mesmo papel (D3)
}
type CreateClientResponse = AuthSession & { client: ClientCard };   // AuthSession = o mesmo do login/switch, com `wid` novo

type UpdateWorkspaceBody = Partial<{
  name: string; uiLocale: UiLocale; monthlySpendCapUsd: number|null;     // já existiam
  shortCode: string; industry: string|null; market: string|null;
  businessType: BusinessType|null; websiteUrl: string|null;
  onboardingStep: 1|2|3|4|5|6;
  paused: boolean;                                                       // true grava pausedAt; false limpa
}>;

interface CreativeDownload {
  url: string;          // URL assinada (6 h) com Content-Disposition: attachment; filename="<fileName>"
  fileName: string;     // "MC_NEW_1012_A_F2_9x16.mp4"
  frozen: boolean;      // true = nome congelado (criativo aprovado); false = provisório, pode mudar até o OK final
  sizeBytes: number; durationSec: number|null; expiresAt: string;
}

// Brain v0: função pura em web/src/lib/brain.ts (o pacote só tem os tipos), usada pela Home (card do Brain) e pela tela Brain. Sem rota.
type BrainItem = 'businessType'|'industry'|'market'|'offer'|'what'|'promise'|'offerAndPrice'|'cta'
               |'audience'|'pains'|'proof'|'notes'|'spendCap';
interface BrainCompleteness { percent: number; missing: BrainItem[]; sections: Record<BrainSection, 'ok'|'partial'|'empty'> }
// web: brainCompleteness(ws: Workspace, offers: Offer[]): BrainCompleteness
type BrainSection = 'business_offer'|'audience'|'proof'|'custom_instructions'|'goals';
```
`CreativeDetail` e o item de `GET /library` ganham `adName: string|null` (null até o OK final).

```ts
// Home (§3.6): CreativesMeta ganha dois campos
interface WaitingBatchRef { id: string; championId: string; championName: string; offer: { id: string; name: string }; status: 'PLAN_READY'|'PLAN_FAILED'; updatedAt: string }
interface CreativesMeta extends PageMeta {
  counts: Record<CreativeFilter, number>;      // sem mudança
  waitingOnYou: WaitingOnYou;                  // NOVO, sempre presente
  waitingBatches: WaitingBatchRef[];           // NOVO, até 6 (updatedAt desc) só com filter=needs_you; senão []
}
```

## 3. Endpoints
### 3.1 Tela Clients (`/clients`)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /workspaces` | — | `ClientCard[]` + `meta: ClientsMeta`. Todos os workspaces em que o usuário é membro (não usa o `wid`). Ordem: não pausados antes; dentro deles `waitingOnYou.total desc`, depois `name asc`. Sem paginação (teto de 200; passar disso = só os 200 primeiros) | 401 | todos |

Implementação esperada: 1 query de memberships + 2 `groupBy(workspaceId)` (criativos e lotes), reaproveitando o `filterWhere('needs_you')` de `criativos.service.ts`. Nada de N+1. Gasto e CPA **não** entram (§8).

### 3.2 New client
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `POST /workspaces` | `CreateClientBody` | `201 CreateClientResponse`: cria o workspace (`onboardingStep = 1`, status `SETUP`), cria a Membership do criador como **OWNER**, copia o time se `copyTeam` e devolve **tokens novos com o `wid` do cliente novo** (igual ao `switch-workspace`). O web grava o refresh pelo `/api/session`, como no switch | 400 `VALIDATION_ERROR`, 403 `FORBIDDEN` (papel no workspace ativo não é OWNER/ADMIN) | OWNER, ADMIN |

Tudo numa transação. O nome do cliente não precisa ser único.

### 3.3 Onboarding e dados do cliente (workspace ativo, sempre pelo token)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /workspace` | — | `Workspace` (formato novo, §2) | — | todos |
| `PATCH /workspace` | `UpdateWorkspaceBody` (autosave dos passos 1 e 5, "Save and exit", pausar) | `Workspace` | 400; 403; 409 `INVALID_STATE` `{ reason: 'onboarding_completed' }` se mandar `onboardingStep` com o onboarding concluído | OWNER, ADMIN |
| `POST /workspace/onboarding/complete` | `{}` | `Workspace` (`status: LIVE`, ou `PAUSED` se pausado). **Idempotente**: já concluído devolve 200 igual | 403; **422 `ONBOARDING_INCOMPLETE`** `{ missing: ('businessType'\|'offer')[] }` (precisa do tipo de negócio e de ≥ 1 oferta não arquivada) | OWNER, ADMIN |

Regras:
- `onboardingStep` só guarda **onde retomar**. Pode ir pra frente e pra trás (1..6); a API não valida o conteúdo de cada passo. O passo 2 (Connect Meta, ⏳) é pulado pelo web mandando `onboardingStep: 3`.
- O que cada passo usa (tudo existente, só muda o layout):
  - **1 Business:** `PATCH /workspace` (nome, idioma, `websiteUrl`, `industry`, `market`, `businessType`, `shortCode`). "Ler o site" = `POST /offers/extract { url: websiteUrl }` + `GET /jobs/:id`, como hoje; o resultado pré-preenche o passo 3. Time e convite = `GET /workspace/members`, `POST /workspace/invites` (agora com `CLIENT`).
  - **3 Product & offer** e **4 Audience & voice:** `POST /offers` / `PATCH /offers/:id` (campos do brief que já existem).
  - **5 Goals & guardrails:** `PATCH /workspace { monthlySpendCapUsd }`.
  - **6 Build the Brain:** `POST /workspace/onboarding/complete` e mostra o Brain v0 (§5) + os 2 caminhos.
- **Pausar** (`paused: true`) é só um rótulo nesta fase: não bloqueia geração (D4). Pausar não mexe no onboarding; despausar volta pra `SETUP` ou `LIVE`.
- `shortCode` editado **não renomeia** arquivos já aprovados (o `adName` deles está congelado).

### 3.4 Convites (mudança pequena em rota existente)
`POST /workspace/invites` passa a aceitar `role: 'ADMIN'|'MEMBER'|'CLIENT'`. `PATCH /workspace/members/:userId` aceita `CLIENT`. Rótulos no web: OWNER/ADMIN = "Agency admin", MEMBER = "Agency member", CLIENT = "Client · approves ads". Convite continua sem e-mail (link copiado).

### 3.5 Send (saída de hoje)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /creatives/:id/download` | — | `CreativeDownload` | 404; 409 `INVALID_STATE` (criativo não está em `RENDER_READY` sem `editDirty` nem em `APPROVED`) | todos, inclusive CLIENT |
| `POST /creatives/:id/approve` | sem mudança | passa a **gravar `adName`** na mesma transação do `APPROVED` | sem mudança | OWNER, ADMIN, MEMBER, CLIENT |

- Vídeo baixado: `APPROVED` → `finalRender`; `RENDER_READY` → último render `READY` não `stale`.
- Tela Send: checkbox "Save to the Library" marcado = `POST …/approve` antes do download (se já `APPROVED`, o web pula). Download = `GET …/download` e abre a `url`.
- Content-Disposition: o backend assina a URL com `ResponseContentDisposition`. **Se o storage (versitygw local / Supabase S3) ignorar esse parâmetro**, a mesma rota passa a responder `302` pra `GET /creatives/:id/download/file`, que faz stream com o header certo. O backend confirma qual dos dois na primeira tarefa e me avisa.

### 3.6 Home: "Waiting for you" conta criativos **e** lotes (ajuste do Gusta, 12/10)
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `GET /creatives` | sem mudança | sem mudança + `meta.waitingOnYou` (sempre) + `meta.waitingBatches` (com `filter=needs_you`) | sem mudança | todos |

- **Uma regra só:** `waitingOnYou` da Home e do cartão do Clients saem da **mesma função do backend** (`waitingOnYou(workspaceIds[])`, no módulo `workspaces`, usada pelo `criativos` e pelo `GET /workspaces`). Pro workspace ativo os dois números são iguais por construção.
- `waitingOnYou.creatives` = `meta.counts.needs_you` **sem** os filtros de busca (`q`, `offerId`, `championId`, `origin`): é o número do workspace, não da lista filtrada. `counts` segue respeitando os filtros como hoje.
- `waitingOnYou.batches` = lotes `PLAN_READY`/`PLAN_FAILED` de campeão não arquivado.
- A Home mostra `waitingOnYou.total` no contador do "Waiting for you"; a lista mostra os criativos (`data`, até 6) e, depois, os lotes (`waitingBatches`), cada um com o chip `waiting` (PLAN_READY: "Plan ready, launch it") ou `failed` (PLAN_FAILED: "Plan failed, plan again") e link pra tela do lote (`/variar/lotes/:id` ou a rota que o web já usa).
- O badge do Review na sidebar continua sendo só criativos (`counts.needs_you`): Review é de vídeo, lote não entra lá.
- Polling: o mesmo da Home (5 s só com linha em andamento, `eventos.md`). Lote em `PLANNING` não conta.

## 4. Permissões por papel (resumo)
| ação | OWNER | ADMIN | MEMBER | CLIENT |
|---|---|---|---|---|
| `GET` de qualquer tela (Home, Clients, Brain, Library, Review, Settings) | sim | sim | sim | sim |
| `POST /workspaces` (New client) | sim | sim | não | não |
| `PATCH /workspace`, onboarding/complete, convites | sim | sim | não | não |
| mudar papel / remover membro | sim | não | não | não |
| ofertas, wizard, campeões, lotes, gerar, render, editor | sim | sim | sim | **não** |
| `POST …/approve`, `GET …/download`, `PUT /library/:id/winner` | sim | sim | sim | sim |
| `POST …/changes` | sim | sim | sim | só `type: 'TEXT'` (os outros regeram e custam) |

**Como o CLIENT é barrado sem marcar 60 rotas:** regra nova no `AuthGuard` global: papel `CLIENT` + método diferente de `GET`/`HEAD` = `403 FORBIDDEN`, **a menos** que a rota tenha o decorator novo `@ClientAllowed()`. Levam o decorator: `POST /creatives/:id/approve`, `POST /creatives/:id/changes` (o service barra tipo ≠ `TEXT` com 403), `PUT /library/:creativeId/winner`, `POST /auth/logout`, `PATCH /auth/me`, `POST /auth/switch-workspace`. Rota nova que o CLIENT puder usar precisa do decorator; o padrão é negar.

## 5. Brain v0 (decisão: **sem endpoint novo**)
O Brain é uma visão do workspace e das ofertas. O web monta com o que existe:
| seção | fonte | estado |
|---|---|---|
| Business & offer | `GET /workspace` (tipo, indústria, mercado, site) + `GET /offers` (`what`, `promise`, `offerAndPrice`, `cta`, LP = `sourceUrl`); a tela Offers de hoje vira esta seção | ✅ |
| Audience | `offers[].audience`, `offers[].pains` | ✅ |
| Proof | `offers[].proof` | ✅ |
| Creative library | `GET /creatives?filter=approved&limit=1` → `meta.counts.approved` + link pra Library; vencedores = soma de `offers[].winnersCount` | ✅ |
| Custom instructions (dentro de Voice & rules) | `offers[].notes` | ✅ |
| Goals | `workspace.monthlySpendCapUsd` | 🛠 só o teto |
| Voice & rules (resto), Competitors, Learnings, Teach the Brain, toggles "Used in every run" | — | ⏳ fora da conta |

**% de completude** = `brainCompleteness()` em `web/src/lib/brain.ts` (tipo da saída no pacote, §2), 13 itens com o mesmo peso: `businessType`, `industry`, `market` (workspace) · `offer` (≥ 1 oferta ativa) · `what`, `promise`, `offerAndPrice`, `cta`, `audience`, `pains`, `proof`, `notes` (preenchido em **qualquer** oferta ativa, texto não vazio) · `spendCap` (`monthlySpendCapUsd != null`). `percent = round(preenchidos / 13 × 100)`; `missing` na ordem acima vira o "o que falta". Itens ⏳ nunca entram (regra do Em breve, F0 §2.12). Por que não um `GET /brain`: seria um join do que o web já busca. Só o web calcula, numa função só, então a Home e o Brain mostram o mesmo número. Quando o Brain tiver dado próprio (voz, regras, aprendizados), aí ganha módulo e rota.

## 6. Nome padronizado do arquivo (decisão: **nasce na API**)
Formato `CLIENTE_CAMINHO_MMDD_ROTEIRO_ROSTO_FORMATO.mp4` (F0 §2.11). Função pura `adFileName(creative)` no backend, usada pelo download e pelo approve, então o criativo do zero e o do lote seguem a mesma regra.
| parte | regra | exemplo |
|---|---|---|
| CLIENTE | `workspace.shortCode` | `MC` |
| CAMINHO | `origin` `SCRATCH` → `NEW`, `VARIATION` → `ITER` | `NEW` |
| MMDD | data **UTC** de `approvedAt`; sem OK final, a data de hoje UTC | `1012` |
| ROTEIRO | zero: letra do roteiro escolhido (`A`). Variação: código do tipo + `index + 1` com 2 dígitos (`NEW_HOOKS` → `H01`, `SWAP_AVATAR` → `AV01`, `COPY_NEW` → `C01`, `REMIX_EDIT` → `L01`); controle → `CTRL` | `A` / `H03` |
| ROSTO | `F` + `(batch − 1) × 4 + position + 1` do rosto escolhido (do criativo ou do elenco); sem rosto gerado (rosto original do campeão) → `ORIG` | `F2` |
| FORMATO | `VERTICAL_9_16` → `9x16`, `PORTRAIT_4_5` → `4x5`, `SQUARE_1_1` → `1x1` | `9x16` |

- **Campo novo:** `Creative.adName` (sem extensão), gravado no `approve` e único por workspace. Colisão (dois criativos com as mesmas partes no mesmo dia) → sufixo `_2`, `_3` **no fim** (`MC_NEW_1012_A_F2_9x16_2`), pra não quebrar o parse das 6 partes. Corrida no unique (P2002) → tenta o próximo sufixo.
- Antes do OK final o nome é **provisório** (`frozen: false`): calculado na hora, com a mesma checagem de colisão contra os congelados, mas não salvo. Depois do OK não muda mais, nem se o `shortCode` mudar (é o que vai casar com o resultado no Meta depois).
- Por que não no front: o lote e a Library precisam do mesmo nome, e o sufixo de colisão depende do banco.

## 7. Erros novos (somam à tabela do `api.md` §1)
| code | http | quando | `details` |
|---|---|---|---|
| `ONBOARDING_INCOMPLETE` | 422 | `POST /workspace/onboarding/complete` sem tipo de negócio ou sem oferta | `{ missing: ('businessType'\|'offer')[] }` |
| `INVALID_STATE` (reason nova) | 409 | `PATCH /workspace { onboardingStep }` com onboarding concluído | `{ reason: 'onboarding_completed' }` |
| `FORBIDDEN` (uso novo) | 403 | CLIENT em rota sem `@ClientAllowed()`, ou `changes` com tipo ≠ `TEXT` | — |

Tempo real: nenhum evento novo. A tela Clients busca ao abrir e no foco da janela (React Query), sem polling; a contagem é a mesma da Home, que já tem o polling dela (`eventos.md`).

## 8. O que NÃO entra (ninguém coda isto na fase 2; no web aparece como Em breve, com dado de exemplo estático)
- **Meta inteiro:** Connect Meta (passo 2), health check, ler resultados, Send to Meta, campanha/ad set, nomenclatura de campanha, "Pick from Meta", métricas por parte (hook/hold rate, CTR), métricas no Breakdown, gasto 30 dias e CPA no Clients, KPIs e "Synced with Meta" na Home, Build the Brain com 90 dias.
- **Eddy:** chat, Eddy's read, decision board, propostas, autonomia, "Eddy's pick".
- **Campaigns** (gráfico, árvore, "what's winning").
- **Goals além do teto:** resultado escolhido manualmente (é derivado do tipo de negócio), CPA alvo, budget mensal, budget por rodada de teste, teto diário, regras de aprovação, "começar pausado".
- **Brain além da v0:** sliders de voz, palavras sim/nunca, regras com toggle, "lines that sound like us", versionamento, brand kit (logo, cores, fontes, pasta do Drive), Competitors, Learnings com confiança, Teach the Brain, toggles "Used in every run", lista de produtos com Advertise/Upsell, objeções, "why people buy", creators com direito de uso.
- **Score / MiroFish** e o "porquê do score" no Ad preview.
- **Caminho 2 além do de hoje:** geração de Concepts, mapa ângulo × consciência, gaps, 10 hooks com score, dimensionar lote pelo budget.
- **Tipos novos de iteração:** openers, cortes 15/20 s, formatos 4:5/1:1 no lote, CTAs novos, voz nova.
- **"Request a change" em texto livre** (segue a lista fechada de 4 caminhos) e **"Copy ad text"** (não existe texto do anúncio no modelo; o botão vira bloco Em breve).
- **Agência como entidade** (tabela Agency, cobrança, planos), moeda/fuso do cliente, excluir cliente, lembrete por e-mail, convite por e-mail, aprovação do cliente como trava obrigatória, download do lote em zip.

## 9. Decisões (aprovadas pelo Gusta em 12/10, como estão)
- **D1 Papel `CLIENT`** novo no `MemberRole` (aditivo), com a tabela do §4: o cliente aprova, baixa e pede ajuste de texto, mas não gasta. Alternativa sem papel novo: cliente entra como MEMBER e pode gerar (gastar o seu dinheiro).
- **D2 Status derivado** (`pausedAt` + `onboardingCompletedAt`), não coluna. Workspaces de hoje viram `LIVE` no backfill.
- **D3 Sem tabela de agência:** "New client" copia os OWNER/ADMIN do cliente ativo (`copyTeam`, padrão true). Com isso o Tordan entra sozinho em todo cliente que você criar. A agência como entidade fica pra quando houver mais de uma agência ou cobrança.
- **D4 Pausar = só rótulo** nesta fase (sem Meta não tem nada rodando pra pausar). Não bloqueia geração.
- **D5 Brain sem endpoint**, % por função pura (no web) com os 13 itens do §5.
- **D6 Nome do arquivo na API**, congelado no OK final (`Creative.adName`), data em UTC, código do cliente `shortCode` editável no passo 1 (padrão = iniciais do nome), sufixo `_2` no fim em colisão.

## 10. Impacto por agente (tarefas e dependências)
| # | agente | tarefa | depende de | verificação |
|---|---|---|---|---|
| A1 | arquiteto | ~~tipos no `@maquina/contratos`~~ (feito 12/10, `tsc` do pacote ok); schema + migração `fase2_agencia` (backup antes, `db:diff`); atualizar `api.md` (§1 erros, §3 Home, §14, §16) e `modelo-de-dados.md` | OK do Gusta (dado) | `prisma validate` |
| B1 | backend | `workspaces`: `GET/POST /workspaces`, `PATCH /workspace` novo, `onboarding/complete`, `copyTeam`, convite `CLIENT`; `AuthGuard` + `@ClientAllowed()`; `changes` barra CLIENT ≠ TEXT; **função única `waitingOnYou()` usada pelo Clients e pela Home** + `meta.waitingOnYou`/`waitingBatches` no `GET /creatives`; `error-codes.ts` com `ONBOARDING_INCOMPLETE` | A1 | Jest + int: 403 por papel, backfill não vira Setup, `groupBy` sem N+1, **número da Home = número do cartão do Clients**, filtros de busca não mudam o `waitingOnYou`, api `tsc` volta a passar |
| B2 | backend | `adFileName()` + `GET /creatives/:id/download` (`biblioteca`), `approve` grava `adName` com sufixo e retry no P2002; `adName` em `CreativeDetail` e Library; confirmar Content-Disposition no storage | A1 | unit da função com os 6 casos da tabela §6 + colisão |
| F1 | frontend | Clients, New client (gravar a sessão nova pelo `/api/session`), onboarding passos 1/3/4/5/6 (2 = Em breve), Brain v0 + card do Brain na Home com `web/src/lib/brain.ts`, **Home: contador = `meta.waitingOnYou.total` e lotes do `waitingBatches` na lista**, Send (approve + download), rótulo do papel CLIENT (settings e convite), esconder ações pro CLIENT, mocks MSW nos tipos novos | A1 (tipos, feito); B1/B2 ou MSW | web `tsc` volta a passar; MSW |
| Q1 | qa | ponta a ponta com mocks: criar cliente → sessão trocada → onboarding até LIVE; `ONBOARDING_INCOMPLETE`; CLIENT barrado em gerar/configurar e liberado em aprovar/baixar/TEXT; **contador da Home = cartão do Clients** com 1 criativo esperando + 1 lote `PLAN_READY` + 1 `PLAN_FAILED` (= 3), lote `PLANNING`/`LAUNCHED` e de campeão arquivado fora, badge do Review só com criativos; nome do arquivo provisório × congelado × colisão; desktop e 390 px, EN/PT | B1, B2, F1 | só o qa declara "funciona" |
| — | ia, video | **nada muda** (render e integrações intactos) | — | — |

Pastas sem conflito: A1 = `api/prisma/`, `contratos/src/`, `docs/`; B1/B2 = `api/src/workspaces`, `auth`, `common/auth`, `biblioteca`, `revisao`; F1 = `web/`; Q1 = `testes/`. B1 e B2 rodam em paralelo (arquivos diferentes; o único ponto comum é o `approve`, só no B2).

**Nota (resolvida 12/10):** a Home contava só criativos. Pelo ajuste do Gusta passa a contar os lotes com a mesma regra do Clients (§3.6), sem rota nova: os lotes vêm no `meta` do `GET /creatives`.
