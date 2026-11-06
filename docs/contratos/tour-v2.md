# Tour v2 — adendo de contrato
Data: 2026-11-04 · Dono: maquina-arquiteto (escrito pelo maquina-backend a pedido) · Status: **implementado na API** (spec `design/tour-v2-2026-11-04.md`, APROVADA pelo Gusta em 04/11: Skip já na 1ª vez, Eddy fora, Biblioteca = 5ª dica, CLIENT faz Cérebro → Revisar).
Tipos: `contratos/src/onboarding-v2.ts` (seção tour-v2). Vale por cima de `onboarding-v2.md` §3.4 só no que muda aqui.

## 0. Em 5 linhas
1. `GET /workspace/tour?v=2` devolve as paradas v2 por papel + o vencedor da Meta + as dicas já vistas. **Sem `?v=2` a resposta legada continua igual** (paradas v1), com os campos novos como aditivos: o web atual não quebra até trocar.
2. Dicas: `POST /workspace/tour/tips { tip }` (idempotente) e `DELETE /workspace/tour/tips` ("Show tips again"). Coluna `memberships.tour_tips_seen text[]` (por usuário × workspace).
3. `POST /events`: eventos do tour e das dicas em lote (≤ 50, props ≤ 2 KB), 204. Tabela própria `product_events`, leitura por SQL.
4. 4 marcos de ativação no `Workspace` (`first_batch_at`, `first_generate_at`, `first_ready_at`, `first_send_at`), gravados só na 1ª vez, na mesma transação da ação. Sem rota de leitura nesta entrega (SQL/admin depois).
5. Migração `20261105000200_tour_v2` (aditiva, com backfill dos marcos a partir do que já existia).

## 1. `GET /workspace/tour`
Todos os papéis (GET; CLIENT lê). Query `v`: `'2'` = v2; ausente ou `'1'` = legado; outro valor = 400.

```ts
// ?v=2
interface TourStateV2 {
  completedAt: string | null;           // do membership; Skip também chama POST /workspace/tour/complete
  stops: TourStopV2[];                  // 'brain' | 'templates' | 'credits' | 'review'
  winnerMetaAdId: string | null;
  winnerName: string | null;
  tipsSeen: TipKey[];                   // 'adSource' | 'plan' | 'result' | 'send' | 'library'
}
// sem v (legado): TourState { completedAt; stops: TourStop[] (v1); winnerMetaAdId?; winnerName?; tipsSeen? }
```
- **Paradas:** OWNER/ADMIN/MEMBER = `brain, templates` + `credits` se a conta **não** é unlimited (`payerOf(workspace).pool !== null`: INTERNAL não tem a parada). CLIENT = `brain, review`.
- **Vencedor:** anúncio com `verdict = WINNER`, **de vídeo** (`videoId` não nulo; templates só remixam vídeo), na conexão Meta `ACTIVE` com conta escolhida, de **menor CPA 30 d**; empate = nome, depois `metaAdId`. `null` com `META_MODE=off`, sem conexão ativa ou sem vencedor de vídeo. Mesmo valor pra todos os papéis.
- **Legado:** `iterate` entra com qualquer WINNER (qualquer formato), como antes.

## 2. Dicas
| rota | corpo | resposta | papéis |
|---|---|---|---|
| `POST /workspace/tour/tips` | `SeeTipBody { tip: TipKey }` | 200 `TipsSeenResponse { tipsSeen }` (idempotente; ordem em que foram vistas; sem repetição mesmo com 2 abas) | todos (`@ClientAllowed`) |
| `DELETE /workspace/tour/tips` | — | 200 `{ tipsSeen: [] }` | todos (`@ClientAllowed`) |
`tip` fora da lista = 400 `VALIDATION_ERROR`. A 5ª dica `library` (decisão 04/11) aparece quando a 1ª peça aprovada chega na Biblioteca: a condição é do web (alvo `#t-library`); a API só guarda a chave.

## 3. `POST /events`
Corpo `ProductEventsBody { events: ProductEventInput[] }`, `ProductEventInput { name: TourEventName; at?: string; props?: object }`. 204 sem corpo. Todos os papéis (`@ClientAllowed`); throttle global.
- `name` ∈ `tour_started, tour_stop_viewed, tour_stop_next, tour_stop_back, tour_stop_missing, tour_skipped, tour_completed, tip_shown, tip_dismissed, tip_action` (spec §6). Outro nome = 400.
- 1 a 50 eventos (`EVENTS_MAX_PER_REQUEST`); `props` serializado ≤ 2048 caracteres (`EVENT_PROPS_MAX_CHARS`). Qualquer violação = 400 e **nada** do lote é gravado.
- `workspaceId`, `userId` e `role` vêm da sessão (o que vier dentro de `props` fica só em `props`). Os demais campos do §6 (`locale`, `viewport`, `variant`, `replay`, `stop`, `n`, `total`, `msOnStop`, `msTotal`, `tip`, `how`, `action`, `source`, `target`) vão em `props`.
- `at` = hora do cliente; ausente, inválida, > 1 dia no futuro ou > 30 dias no passado = hora do servidor.
- Tabela `product_events (id, workspace_id, user_id, role, name, props jsonb, at, created_at)`, índice `(workspace_id, name, at)`. Um `INSERT` em lote por requisição.

## 4. Marcos de ativação (`Workspace`)
| coluna | gravada em | quando |
|---|---|---|
| `first_batch_at` | `IteracaoService.create` (tx do lote) | 1º lote AUTO criado: `POST /iterate`, `POST /ad-templates/use`, `POST /ad-templates/:slug/use` |
| `first_generate_at` | `IteracaoService.start` (tx do AUTO_START) | 1º Gerar (`POST /iterate/:id/start`) que passou; barrado (402/409) não conta. A amostra que lança sozinha (sem template) não conta |
| `first_ready_at` | `EdicaoService.settleAuto` (tx do AUTO_APPROVE) | 1ª peça pronta (`approvedAt`) |
| `first_send_at` | `MetaPublicacaoService` (tx que assenta a publicação) | 1º anúncio **criado** na Meta (`publishedAt`); publicação que falha não conta |
Helper: `api/src/workspaces/ativacao.ts` `markActivation(db, workspaceId, marco, at)` = `UPDATE … WHERE id = ? AND <marco> IS NULL`. Backfill na migração: mínimo de `variation_batches.created_at`/`launched_at` (mode AUTO), `creatives.approved_at` (com `variation_item_id`) e `meta_publications.published_at`.
Métrica principal (spec §6): `first_generate_at − onboarding_completed_at` (mediana).
