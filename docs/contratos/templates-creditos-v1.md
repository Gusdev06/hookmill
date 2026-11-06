# Biblioteca de templates com créditos — contrato v1
Data: 2026-10-31 · Dono: maquina-arquiteto · Status: **mockup e decisões APROVADOS pelo Gusta em 31/10 ("APROVADO"); backend implementado e testado no local (flag `TEMPLATES`, padrão off). Frontend depois, com base neste arquivo.**
Fontes: `design/mockup-templates.html`, `design/templates-biblioteca-2026-10-31.md`, `decisions/log.md` do AIS-OS (31/10, "mockups aprovados").
Vale **por cima** de `variacao-auto-v1.md`, `iterate-v2-quiz-templates-ia.md` e `amostra-gratis-v1.md` só no que muda aqui. Convenções, envelope e erros: [`api.md` §1](api.md). Tempo real: **polling** de `GET /iterate/:id` a 1,5 s, como hoje (o estado mora no banco; SSE não traria nada a mais). Tipos: `contratos/src/templates.ts`.

> **04/11 — adendo [`templates-multi-v1.md`](templates-multi-v1.md) (PROPOSTA):** marcar vários templates na galeria e gerar todos num lote só, preço = soma sem teto (`POST /ad-templates/use`). O pack (teto 10) e o `/:slug/use` não mudam.

## 0. Em 6 linhas
1. "Iterate a winner" vira **Templates**: galeria de cards com vídeo de exemplo. Um template é **o lote AUTO com o tipo travado**; o pipeline (leitura, plano, "nada inventado", render, checagem, Download, Send to Meta) não muda.
2. `POST /ad-templates/:slug/use { source }` cria o lote (sem quiz). A pessoa vê o plano com os textos editáveis (grátis) e o custo, e o **Gerar** (`POST /iterate/:id/start { expectedCredits }`) reserva o crédito.
3. Créditos: Edição 1 · Estático 2 · Rosto novo 8 · Persona 9 · "Achei sem querer" 6 · Podcast oculto (beta) · Remix Kling separado e sem preço. Pack "Deixa o HookMill escolher" = soma dos marcados com **teto de 10**.
4. Saldo por **conta** (quem paga é o OWNER do workspace), livro-razão append-only com chave de idempotência. Reserva no Gerar, cobra quando a peça fica pronta, **devolve se falhar**. 4:5/1:1 não cobram.
5. **Amostra grátis = 4 usos de template de Edição** (substitui o lote de 4 peças). Estático e IA travados na amostra. Resultado continua com prévia borrada até o plano pago.
6. Sem gateway: "fale com a gente" + admin credita na mão. Valor do crédito: base ≥ US$ 0,86 (31/10); pacotes a definir. O banco guarda só a quantidade.

## 1. Decisões (31/10, não reabrir)
| # | decisão |
|---|---|
| T1 | Templates substitui "Iterar um vencedor" na navegação; o quiz/auto vira o card-pack |
| T2 | Créditos: Edição 1 (inclui moldura, headline, corte, chat, pessoa+motion), Estático 2, Rosto novo 8, Persona 9, "Achei sem querer" 6 |
| T3 | Pack com teto de 10 |
| T4 | Reservado no Gerar, devolvido se a peça falhar; 4:5/1:1 grátis |
| T5 | Amostra = 4 usos de template de Edição |
| T6 | Remix com Kling = template separado (preço a definir) |
| T7 | "Gerar mesmo assim" só pra legenda queimada |
| T8 | Sem gateway: fale com a gente + admin credita |
| T9 | Valor do crédito: base ≥ US$ 0,86 (31/10); pacotes a definir; o banco guarda só a quantidade |

**Ajustes do arquiteto (não mudam decisão; o Gusta pode trocar):**
- **A1. Quem paga:** o saldo é da conta do **OWNER mais antigo** do workspace (P1 da amostra = conta). Agência: um saldo pros clientes todos. **Confirmado pelo Gusta 31/10.**
- **A2. Equipe (`INTERNAL`) não tem saldo:** uso ilimitado, sem lançamento no livro (conta só no histórico de usos). Assim Gusta e Tordan não precisam se creditar. **Confirmado pelo Gusta 31/10.**
- **A3. Cobrança parcial:** template de Edição que entrega N vídeos (Headline ×3, Cortes ×2) cobra o crédito inteiro se **pelo menos 1** vídeo sair; nenhum = devolve. IA devolve a parte das peças que falharam, arredondando a favor do cliente: cobra `floor(créditos × prontas / peças)`.
- **A4. Retry depois do estorno:** peça falhou, o crédito voltou, a pessoa clica Retry → o Retry reserva de novo o crédito daquela linha (402 sem saldo). Antes do estorno o Retry é grátis (a reserva já cobre).
- **A5. Leitura do anúncio e plano não cobram crédito** (custo nosso, como hoje). Amostra sem uso restante = 402 já no `use` (a leitura custa ~US$ 0,10-0,25 pra nós).
- **A6. Cold open e Offer end card** (no mockup) saíram do catálogo dos lotes novos em 25/10: entram como `DRAFT` indisponíveis até o Gusta pedir de volta.
  - **Atualização 31/10 (Gusta: voltam, 1 crédito, Edição, "desde que o motor ainda renderize"). Conferido pelo arquiteto: continuam `DRAFT`.** O render ainda funciona (`render/auto-edit.ts` monta `COLD_OPEN` e `ENDCARD`, a composição `AutoEdit` do `video/` e o plano do Lambda aceitam os dois, o ENDCARD já usa o logo do kit), mas o **plano** não sabe mais fazê-los: em 25/10 (commit `61fb4f2`) saíram a regra do `allowedFor` (`COLD_OPEN`: vídeo ≥ 10 s e ≥ 2 blocos; `ENDCARD`: variante pelo Brain, fora se o campeão já tem end card), os campos do esquema estrito do plano (`teaserStartSec/EndSec`, `variant/headline/subline/ctaText`) e as linhas do prompt. Ligar o card agora daria `TEMPLATE_DOESNT_FIT` em todo anúncio. **Falta (~1 dia, ia + backend):** (1) devolver as 2 regras ao `allowedFor` só no lote de template que tem essas chaves (o quiz continua sem, decisão de 25/10); (2) devolver os campos e as linhas ao esquema/prompt do plano só quando o `allowed` os tiver (o esquema estrito tem teto de tamanho, por isso o plano é em 2 etapas); (3) tirar os dois do `AUTO_TYPES_FORA` no `availabilityOf` do catálogo; (4) testes do recorte + **1 plano real por tipo** (~US$ 0,05 cada, com ok do Gusta) antes de `LIVE` com 1 crédito via migração de dados.
  - **Atualização 01/11 (feito: ia + backend; ok do Gusta pro trabalho e até US$ 0,10 de teste real). `LIVE`, 1 crédito, Edição, só no lote de template.**
    - **Regra:** `regras.ts` ganhou `TEMPLATE_ONLY_TYPES = ['COLD_OPEN','ENDCARD']` e `PlanCtx.templateOnlyTypes`. O `allowedFor` só devolve os dois quando o ctx os traz; quem preenche é o lote de template (`plano-auto` → `guardedCtx`, pelas `keys` do `settings.template`, inclusive o pack) e o fit da galeria (`templateFitOf`, pela chave do card ou pelas `packKeys`). O Iterate normal (quiz) nunca os vê (o `iteracao.int.spec` mostra o `allowed` do lote normal sem eles). Regras de antes de 25/10: `COLD_OPEN` = vídeo ≥ 10 s e ≥ 2 blocos (`short_video`); `ENDCARD` = `has_end_card` se o original já fecha com cartão (`hasEndCard` do editMap/teardown), senão ≥ 1 variante pelo Brain ou pelo CTA falado (`no_offer`). Legenda queimada = `burned_captions` (soft), como os outros. Validação/reparo/finalize já tratavam os dois (`cold_open_window`, `endcard_variant_unavailable`, `text_too_long`, `invented_number`).
    - **Plano (ia):** com `COLD_OPEN`/`ENDCARD` em `allowed`, o `planAutoBatch` usa `autoPlanSchemaFor(i)`: o esquema de 25/10 + o tipo no enum + só os campos dele (`teaserStartSec/EndSec`; `variant` com enum só das variantes liberadas + `headline/subline/ctaText`). Sem eles, é o MESMO objeto `AUTO_PLAN_SCHEMA` de antes. Pior caso (pack com os dois): 47 propriedades / 69 valores de enum, dentro do medido que compila (55/69). As regras vão no PEDIDO (`<edit_templates>`, `templateOnlyRequest`), não no sistema (o sistema fica igual em todo lote, cache). `AutoPlanInput.endcardVariants?` (novo, opcional) leva as variantes que o Brain sustenta (`endcardVariants(ctx)`).
    - **Catálogo:** saíram do `AUTO_TYPES_FORA` (`availabilityOf` = disponível); migração de dados `20261101000100_templates_cold_open_endcard` (LIVE, 1 crédito, EDIT; `offer-end-card` com `needs` vazio no lugar de `price`, porque a variante `cta` não exige preço, e descrição com "chamada"). Aplicada no `maquina_test` e no `maquina` (backup antes). **Ainda sem vídeo de exemplo:** o cliente só vê os cards depois do upload pelo Admin (`visibleToCustomer`); a equipe (`INTERNAL`) já usa.
    - **Validado:** testes do recorte com Claude mockado (unidade: regra, fit, validação, esquema, pedido, parse; integração: `templates-creditos.int.spec` usa `cold-open` e `offer-end-card` de verdade, fit `has_end_card` → 422 e, sem end card no original, lote com 1 peça do tipo). **Plano real:** `COLD_OPEN` validado em 01/11 (US$ 0,082); `ENDCARD` ainda não (ver pendência 3).
- **A7. Texto editável na v1:** molduras (`FRAME`) e Headline. Os outros tipos mostram o texto sem edição (a fala do Chat DM/Pessoa+motion já passa por regras próprias; fica pra v2).

## 2. Modelo de dados (migração aditiva `20261031000200_templates_creditos`)
```prisma
enum TemplateTier      { EDIT  STATIC  AI }                 // STATIC aparece na aba Edit, mas custa 2 e trava na amostra
enum TemplateStatus    { DRAFT  LIVE  HIDDEN }              // cliente vê só LIVE com vídeo de exemplo; DRAFT/HIDDEN só o admin
enum CreditPool        { CREDITS  SAMPLE }                  // saldo pago · usos da amostra
enum CreditEntryKind   { GRANT  RESERVE  CHARGE  REFUND  MANUAL }
enum TemplateRunStatus { DRAFT  RESERVED  SETTLED }

model Template {
  id, slug @unique, internalKey @unique ("FRAME:news" | "HEADLINE" | "CUT" | … | "PACK"),
  autoType String?            // AutoVariationType ou tipo de IA do F3 (texto: os de IA ainda não estão no enum); null no PACK
  frameId String?             // só FRAME
  pack Boolean, tier TemplateTier, credits Int? (null = sem preço = não pode ir pra LIVE; no PACK = o teto)
  outputs Int                 // vídeos/imagens que entrega (Headline 3, Cortes 2, IA 3)
  category String             // frames | headline | cuts | chat | static | avatar | persona | remix | pack
  nameEn/namePt, descEn/descPt, outEn/outPt, needs String[], order Int, status TemplateStatus, beta Boolean
  exampleKey String?, posterKey String?, exampleDurationSec Decimal?, pendingExampleKey String?
  uses Int                    // +1 por Gerar (no pack, +1 em cada template da linha)
  @@map("templates")
}
model User { creditBalance Int @default(0) "credit_balance"; sampleUses Int @default(0) "sample_uses" }   // CHECK ≥ 0 no banco
model CreditEntry {           // livro-razão append-only (nunca UPDATE/DELETE)
  id, userId (a conta), pool CreditPool, kind CreditEntryKind,
  delta Int                   // efeito no saldo: GRANT/REFUND +, RESERVE −, CHARGE 0, MANUAL ±
  amount Int                  // créditos envolvidos (no CHARGE = o cobrado)
  balanceAfter Int, idempotencyKey String @unique, templateRunId String?, workspaceId String?, byId String?, note String?, createdAt
  @@index([userId, createdAt]) @@map("credit_entries")
}
model TemplateRun {           // 1 por lote nascido de template (1-1 com VariationBatch)
  id, workspaceId, batchId @unique, templateId, accountId String? (quem paga), pool CreditPool? (null = INTERNAL, ilimitado),
  status TemplateRunStatus, cap Int? (pack 10), lines Json (RunLine[], congeladas no Gerar),
  held Int (reservado e ainda não cobrado), charged Int, refunded Int, attempt Int (nº de reservas; sufixo da idempotência),
  createdById, reservedAt?, settledAt?, createdAt, updatedAt
  @@map("template_runs")
}
```
- `VariationBatch.settings.template = { runId, slug, pack, keys: string[] }` (JSON, sem coluna). `settings.quizEnabled = false`. Amostra: também `settings.sample = true` (reaproveita a trava e a prévia borrada do `amostra-gratis-v1` §3-§4).
- **Linha** (`RunLine`) = um template dentro do lote: `{ key, templateId, slug, tier, credits, itemIds, pieces, state: 'held'|'charged'|'refunded', delivered }`. No pack, as peças são agrupadas pelo template de onde vêm (`FRAME:news`, `HEADLINE`…).
- O catálogo inicial nasce na própria migração (§3). Sem vídeo de exemplo nenhum aparece pro cliente.

## 3. Catálogo inicial (seed)
| slug | internalKey | tier | créditos | entrega | status |
|---|---|---|---|---|---|
| `breaking-news` · `meme-pov` · `post-card` · `question-box` · `top-5` · `live` · `call` · `cinema` · `story` · `read-the-caption` · `pov-testimonial` · `direct-offer` | `FRAME:<id>` (B1) | EDIT | 1 | 1 vídeo | LIVE |
| `split-screen` · `split-torn` · `meet-dialog` · `gossip-page` · `gossip-white` · `gossip-pink` | `FRAME:<id>` (B2) | EDIT | 1 | 1 vídeo | LIVE |
| `new-headline` | `HEADLINE` | EDIT | 1 | até 3 vídeos | LIVE |
| `short-cuts` | `CUT` | EDIT | 1 | 2 vídeos | LIVE |
| `review` · `native-search` | `REVIEW` · `NATIVE_SEARCH` | EDIT | 1 | 1 vídeo | LIVE |
| `chat-dm` · `person-motion` | `CHAT_DM` · `PERSON_MOTION` | EDIT | 1 | 1 vídeo (9:16) | LIVE (disponível só com `ITERATE_TEMPLATES=on`) |
| `cold-open` · `offer-end-card` | `COLD_OPEN` · `ENDCARD` | EDIT | 1 | 1 vídeo | LIVE desde 01/11 (A6; só no lote de template, migração `20261101000100`); falta vídeo de exemplo pro cliente ver |
| `static-ad` | `STATIC` | STATIC | 2 | 1 imagem | LIVE |
| `new-face` · `new-persona` · `found-it-by-accident` | `AVATAR_FACE` · `AVATAR_PERSONA` · `REMIX_DISCOVERY` | AI | 8 · 9 · 6 | 3 vídeos · 3 · 1 + 2 ganchos | DRAFT, indisponível até o F3 |
| `podcast-clip` | `REMIX_PODCAST` | AI | null | 1 + 2 ganchos | HIDDEN, beta |
| `cinematic-remix` | `REMIX_KLING` | AI | null | 1 + 2 ganchos | DRAFT (T6, preço a definir) |
| `let-hookmill-pick` | `PACK` | EDIT | 10 (teto) | até 12 vídeos | LIVE |

**Disponível** (`available`) = o tipo roda hoje no backend: tipos de Edição dos lotes novos + STATIC; `COLD_OPEN`/`ENDCARD` (A6, só no lote de template); `CHAT_DM`/`PERSON_MOTION` com `ITERATE_TEMPLATES=on`; IA só quando o F3 for construído (tipos no enum + flag própria do F3). Indisponível = card some do cliente e `use` dá 422 `TEMPLATE_UNAVAILABLE`.

## 4. Créditos
### 4.1 Quem paga e de onde sai
| acesso efetivo do workspace (`amostra-gratis-v1` P1) | conta que paga | pool |
|---|---|---|
| `INTERNAL` | — | nenhum (ilimitado, sem lançamento) |
| `PAID` | OWNER `PAID` mais antigo | `CREDITS` |
| `SAMPLE` | OWNER mais antigo | `SAMPLE` (só tier EDIT; STATIC/AI = 402 `PAYMENT_REQUIRED { reason: 'sample_tier' }`) |

### 4.2 Livro-razão (idempotente)
Toda escrita de saldo = 1 transação: `UPDATE users SET <saldo> = <saldo> + delta WHERE id = ? AND <saldo> + delta >= 0` (CAS; 0 linhas = saldo insuficiente) + `INSERT credit_entries` com `idempotencyKey` único. Chave repetida = no-op que devolve o lançamento existente (nunca debita 2 vezes).
| evento | kind | delta | chave |
|---|---|---|---|
| Admin credita/debita | `MANUAL` | ± n | a do corpo (`idempotencyKey`, obrigatória) |
| Usos da amostra (1ª consulta da conta `SAMPLE`) | `GRANT` (pool SAMPLE) | +4 (0 se a conta já gastou a amostra antiga, não é modo OWN ou herdou pela conta de anúncio, §5) | `sample-grant:<userId>` |
| Gerar | `RESERVE` | −quote | `run:<runId>:reserve:<attempt>` |
| Tudo assentado: cobrado | `CHARGE` | 0 (amount = cobrado) | `run:<runId>:charge:<attempt>` |
| Tudo assentado: devolvido | `REFUND` | +(held − cobrado) | `run:<runId>:refund:<attempt>` |

### 4.3 Conta do lote
- **Quote** = `min(cap ?? ∞, Σ créditos das linhas)`; linhas = templates com ≥ 1 peça marcada (`included`).
- **Assentar** (varredura a cada 5 s; lote `LAUNCHED`, run `RESERVED`): quando **todas** as peças das linhas estão terminais (`ready`, `failed`, `left_out`): `alvo = min(cap ?? ∞, Σ entregue)`, onde entregue = créditos da linha se ≥ 1 peça `ready` (Edição/Estático) ou `floor(créditos × prontas / peças)` (IA). `cobrar = alvo − charged`; `devolver = held − cobrar`. `held = 0`, status `SETTLED`.
- **Retry** de peça de lote `SETTLED` cuja linha não entregou: reserva `need = min(cap, Σ entregue + créditos da linha) − charged` (pode ser 0 no pack acima do teto); run volta pra `RESERVED`; a varredura assenta de novo. Sem saldo = 402 `INSUFFICIENT_CREDITS`.
- **"Gerar mesmo assim"** (`legenda-protegida-v1` §8) num lote de template: permitido em `PLAN_READY` (a peça entra na linha e no quote); em `LAUNCHED` = 409 `INVALID_STATE { reason: 'template_launched' }` (faça outro uso do template).
- **4:5 e 1:1** (`POST /iterate/pieces/:id/formats`) não mexem no crédito.
- O custo real em US$ continua em `cost_entries` (margem, teto mensal do workspace). Crédito e US$ não se misturam.

## 5. Amostra grátis (muda o `amostra-gratis-v1` §0-§2)
- Com `TEMPLATES=on`: conta `SAMPLE` ganha **4 usos** (pool `SAMPLE`) de template de **Edição** (tier EDIT, inclui o pack, que custa `min(10, linhas)` usos). `POST /iterate` (quiz) de conta `SAMPLE` = 402 `PAYMENT_REQUIRED { reason: 'sample_templates' }`: a porta da amostra é a galeria.
- Lote do template na amostra: `settings.sample = true` → prévia borrada (3 s nítidos), downloads/Meta/editor travados (402 `locked`), exatamente como hoje (§3-§4 do `amostra-gratis-v1`). Pagou (`access = PAID`) = destrava sem render novo.
- Sem lançamento automático: na amostra a pessoa também vê o plano e clica Gerar (gasta 1 uso; falhou = volta).
- Antiabuso (§6 de lá) continua: a conta que já gastou a amostra antiga, que não é `OWN` (P4) ou cuja conta de anúncio já fez amostra em outra conta recebe `GRANT 0`. 1º Gerar da amostra grava `User.sampleUsedAt`.
- Teto de custo da amostra (US$ 1 por lote) segue valendo no Gerar.
- `TEMPLATES=off` (produção até o frontend): nada muda no fluxo de hoje.

## 6. Compatibilidade por anúncio (`fit`)
> **05/11:** o "Gerar mesmo assim" do `soft` sai, e a decisão de 02/11 (lote de template sem guarda) foi revogada. `troca-texto-queimado-v1.md` §15.3.
Calculada com as **mesmas regras do plano** (`allowedFor`, `allowedFrames`, guarda da legenda) sobre o anúncio já lido, sem chamada paga.
| fit | quando | web |
|---|---|---|
| `ok` | o tipo/moldura passa | `Fits` |
| `soft` | só `burned_captions` | faixa âmbar: subir versão sem legenda (`cleanUploadId` no `use`) · **Gerar mesmo assim** · outro template |
| `hard` | `no_face`, `no_speech`, `short_video`, `no_proof`, `no_price`, `no_data`, `no_page`, motivos do Headline (`no_written_hook`…), IA sem rosto/fala/público | pílula com o motivo; sem "Gerar mesmo assim" |
| `unknown` | anúncio nunca lido (`reason: 'not_read'`) | `Not read yet · ~1 min` (a leitura roda no `use`, grátis) |
Pack: `ok` se ≥ 1 template de Edição cabe. Template indisponível: `hard` com `reason: 'coming_soon'`.

## 7. API (workspace sempre do token; CLIENT = 403 em tudo que gera ou gasta)
Prefixo **`/ad-templates`**: `GET /templates` já existe (registro de templates Remotion do wizard, `api.md` §11) e o web usa.
| método e rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `GET /ad-templates` | query `championId?` `metaAdId?` `creativeId?` `uploadId?` (no máx. 1) | `200 TemplateList { items: TemplateCard[]; pack: TemplateCard \| null; credits: CreditsSummary; fitsFor: { championId, read } \| null }` | 400 mais de 1 fonte | galeria (com `fit` se veio a fonte) |
| `GET /ad-templates/:slug` | mesma query | `200 TemplateCard` | 404 (inexistente ou não visível) | detalhe (sheet) |
| `POST /ad-templates/fits` | `{ slug: string; sources: SourceRef[] (1-50) }` | `200 { items: { source, read, championId, fit: TemplateFit }[] }` | 404 slug | passo Ad (pílula por linha) |
| `POST /ad-templates/:slug/use` | `{ uploadId \| creativeId \| metaAdId \| championId (exatamente 1); offerId?; cleanUploadId? }` | `202 IterateBatch` (com `template`) | 404; 422 `TEMPLATE_UNAVAILABLE`; 422 `TEMPLATE_DOESNT_FIT { reason }` (anúncio lido e fit `hard`); 402 `PAYMENT_REQUIRED { reason: 'sample_tier' \| 'sample_used' }`; os do `POST /iterate` (OFFER_REQUIRED, upload…) | Use template / Continue |
| `GET /iterate/:id` (existe) | — | `IterateBatch` + `template: IterateTemplateRun \| null` | — | Reading/Plan/Generating/Download |
| `PATCH /iterate/:id/items/:itemId/texts` | `{ texts: { path: string; value: string }[] }` (1-20) | `200 IterateBatch` | 409 `INVALID_STATE` (não `PLAN_READY`); 422 `TEXT_INVALID { violations: { path, rule, detail }[] }`; 422 `EDIT_NOT_SUPPORTED` (tipo sem texto editável) | editar texto no Plan (grátis) |
| `PATCH /iterate/:id/items/:itemId` (existe) | `{ included }` | `200` | os de hoje | desmarcar no pack |
| `POST /iterate/:id/start` (existe) | + `expectedCredits?: number` (obrigatório em lote de template) | `202 IterateBatch` | + 409 `CREDITS_CHANGED { credits }`; 402 `INSUFFICIENT_CREDITS { need, balance, pool }`; 402 `PAYMENT_REQUIRED { reason: 'sample_tier' }` | **Generate · N credits** |
| `POST /iterate/pieces/:pieceId/retry` (existe) | sem mudança | — | + 402 `INSUFFICIENT_CREDITS` (A4) | Retry |
| `GET /credits` | — | `200 CreditsSummary` | — | medidor da sidebar, painel do Plan |
| `GET /credits/ledger` | `cursor?` `limit? (≤ 100)` | `200 { items: CreditEntryView[]; nextCursor }` | — | tela Credits (histórico) |
| `GET /ad-templates/runs` | `cursor?` `limit?` | `200 { items: TemplateRunRef[]; nextCursor }` | — | histórico de usos |
| **admin** (só usuário `INTERNAL` que é OWNER do workspace ativo; senão 403) | | | | |
| `GET /admin/ad-templates` | — | `{ items: AdminTemplate[] }` (todos, com DRAFT/HIDDEN) | 403 | Admin · Templates |
| `PATCH /admin/ad-templates/:slug` | `{ credits?: number \| null; status?; order?; nameEn?; namePt?; descEn?; descPt?; beta? }` | `AdminTemplate` | 422 `TEMPLATE_UNPRICED` (LIVE sem preço) | editar preço/ocultar |
| `POST /admin/ad-templates/:slug/example` | `{ mimeType: 'video/mp4'; sizeBytes ≤ 60 MB }` | `{ uploadUrl, key, expiresAt }` (PUT pré-assinado, 15 min) | 400; 403 | Upload / Replace video |
| `POST /admin/ad-templates/:slug/example/complete` | `{ key }` | `AdminTemplate` (pôster tirado por ffmpeg; ≤ 60 s; vertical) | 409 `UPLOAD_INCOMPLETE`; 422 `MEDIA_INVALID` / `MEDIA_TOO_LONG` | idem |
| `POST /admin/credits/grant` | `{ email \| userId; credits: inteiro ≠ 0 (−10000…10000); note ≤ 200; idempotencyKey (8-80) }` | `{ entry: CreditEntryView; balance }` | 404; 409 `INVALID_STATE { state: 'insufficient_balance', need, balance }` (débito maior que o saldo); 400 `idempotencyKey` usada pra outra conta | creditar conta na mão |

**Fit no Plan:** `IterateBatch.template.fit` mostra o fit do template no anúncio já lido. Com `soft`, o plano pode vir **sem peça** e com `insight.captionBlocked` preenchido: o web mostra a faixa âmbar e o "Gerar mesmo assim" chama `POST /iterate/:id/caption-blocked/force` (existe). Sem espaço depois do render = peça `failed` com `CAPTION_PROTECTED` = crédito volta.

## 8. Tipos (escritos em `contratos/src/templates.ts`)
`TemplateTier`, `TemplateStatus`, `TemplateFit`, `TemplateFitReason`, `TemplateCard`, `TemplateList`, `CreditsSummary`, `CreditEntryView`, `IterateTemplateRun`, `RunLineView`, `EditableText`, `TemplateSourceRef`, `UseTemplateBody`, `TemplateFitsBody`, `UpdateItemTextsBody`, `AdminTemplate`, `UpdateTemplateBody`, `GrantCreditsBody`, `TemplateRunRef`. `IterateBatch.template?` e `StartIterateBody.expectedCredits?` entram como extensão (TRANSIÇÃO: o `iteracao.ts` ganha os campos opcionais).

## 9. Erros novos (`api.md` §1)
| código | HTTP | details |
|---|---|---|
| `INSUFFICIENT_CREDITS` | 402 | `{ need, balance, pool: 'CREDITS' \| 'SAMPLE' }` |
| `CREDITS_CHANGED` | 409 | `{ credits }` (o quote mudou entre a tela e o Gerar) |
| `TEMPLATE_UNAVAILABLE` | 422 | `{ reason: 'coming_soon' \| 'retired' \| 'disabled' }` |
| `TEMPLATE_DOESNT_FIT` | 422 | `{ reason: TemplateFitReason }` |
| `TEMPLATE_UNPRICED` | 422 | — |
| `TEXT_INVALID` | 422 | `{ violations: { path, rule, detail }[] }` |
`PAYMENT_REQUIRED.reason` ganha `'sample_tier' | 'sample_templates'`.

## 10. Flags e env (`api/.env.example`)
- `TEMPLATES=off|on` — liga a amostra por usos e o 402 do `POST /iterate` pra conta SAMPLE. As rotas de templates e créditos existem nos dois modos (o frontend decide a porta).
- `SAMPLE_TEMPLATE_USES=4` (padrão; trocar exige avisar o arquiteto). O teto do pack mora no catálogo (`credits` do `let-hookmill-pick`, editável no admin).
- `CREDITS_CONTACT_EMAIL` — e-mail do "Talk to us" (`CreditsSummary.contactEmail`; vazio = null).
- `ITERATE_TEMPLATES` continua decidindo `available` de Chat DM e Pessoa + motion; a IA espera o F3.

## 11. Divisão do trabalho
| # | dono | entrega | depende |
|---|---|---|---|
| T0 | arquiteto | este contrato, migração, tipos, backend `creditos/` + `templates/` + ganchos no `iteracao/` e no Retry, testes do recorte | — (feito 31/10) |
| T-F | frontend | galeria, detalhe, passo Ad com `fits`, Plan com textos e custo, Generating/Download, Credits, Admin · Templates, saldo na sidebar/topo; troca "Iterate a winner" → Templates | T0 (MSW pelos tipos) |
| T-D | design | vídeos de exemplo (ofertas nossas) pelo Admin | T-F admin |
| T-Q | qa | ponta a ponta: amostra 4 usos, reserva/estorno com render falhando, pack com teto, saldo insuficiente, admin, 4:5 grátis | T-F |
| T-B | backend | quando o F3 ligar: `available` dos tipos de IA, reserva no `ai/start`, estorno por peça (A3) | F3 |

## 12. Pendências do Gusta
1. ~~Valor do crédito~~ **31/10: ≥ US$ 0,86 por crédito aceito como base** (o banco continua guardando só a quantidade). **Pacotes ainda a definir** (a tela Credits segue com "Price to be set").
2. **Preço do "Cinematic remix" (Kling)**: 31/10, fica pra depois; continua `DRAFT` (a spec sugeriu ~20 créditos).
3. ~~Cold open / Offer end card voltam?~~ **31/10: sim (1 crédito, Edição). 01/11: feitos e `LIVE` (A6).** Falta: (a) **plano real**: a 1ª sonda (`sondas/sonda-plano-a6.ts`, campeão fictício em memória, só o plano) rodou o `COLD_OPEN` e o Claude devolveu um plano **sem peça** duas vezes ("no usable item", 1 chamada + 1 nova tentativa); o custo não foi gravado porque a sonda caiu antes de imprimir (estimativa US$ 0,06-0,13 pelas contas de token: ~10,2 mil de entrada + saída). Ajustes feitos depois, sem rodar: o pedido agora diz que o tipo foi escolhido pelo usuário e que o plano não pode vir vazio; a sonda grava resposta crua e custo de cada chamada mesmo em falha. **2ª rodada 01/11 (novo ok do Gusta):** `COLD_OPEN` validado (1 peça, sem violação, US$ 0,082 medido); **3ª rodada 01/11:** `ENDCARD` validado (1 peça `ENDCARD-OFFER`, sem violação, US$ 0,064 medido). Os dois planos reais estão provados; (b) vídeo de exemplo dos dois cards (Admin).
4. ~~Confirmar A1 e A2~~ **Confirmados 31/10** (o recado do coordenador chamou de A5/A7; são os A1/A2 desta tabela).
