# Templates de lista v1: Versus e Value stack (`LIST_OVERLAY`)
Data: 2026-11-04 · Dono: maquina-arquiteto · Status: **templates APROVADOS pelo Gusta em 04/11 (protótipo); este contrato aguarda o ok dele antes de código**
Fonte: spec `design/templates-ruimbom-lista-2026-11-04.md` (§9 = o que cada agente faz), protótipo `design/mockup-templates-ruimbom-lista.html` (https://claude.ai/artifact/MtagqbYZzAxUWr6k2cMGUP).
Decisões do Gusta (04/11): um motor `ListOverlay`, 2 cards, 1 crédito cada (EDIT), chip `frames` na galeria com tipo interno próprio `LIST_OVERLAY`, posição padrão entre o queixo e a legenda queimada (topo = reserva; 1:1 ao lado do rosto), **sem a nossa legenda** nestes dois na v1.
Tipos: `contratos/src/lista.ts` (+ `IteratePiece.list`, `TemplateFitReason` `no_list`/`no_room`, `TemplateNeed` `min_12s`). Typecheck do `contratos` passa.

---

## 0. Resumo
1. **Tipo AUTO novo `LIST_OVERLAY`** (DIVERSITY, máx. 2 por lote, 1 por `templateId`), **só no lote de template** (como `COLD_OPEN`/`ENDCARD`): o quiz do Iterate não oferece. Chave da linha no catálogo/RunLine: `LIST_OVERLAY:versus` e `LIST_OVERLAY:value-stack`.
2. **Plano:** 2ª etapa do mesmo `planAutoBatch`, 1 chamada por template (como `CHAT_DM`), escreve as linhas com fonte e palavra-âncora. Backend valida "nada inventado" (número só da fala ou de `proof`; preço só de `offerAndPrice`).
3. **Render:** composição `Template` (já existe) despacha pelos ids `versus`/`value-stack` pro `ListOverlay.tsx`. Funções puras do video: `posicionarLista`, `agendaLista`, `medirLista`.
4. **Fit:** `no_speech`, `short_video` (< 12 s), `no_list` (novo, hard), `burned_captions` (soft, sem lugar por causa da legenda) e `no_room` (novo, hard, sem lugar sem legenda: o rosto ocupa o quadro).
5. **Editor:** herda o `EditDoc` v2 do E1, com resolver próprio `resolverPropsLista`. Entra no editor junto com o E1. Na v1 a edição é no Plan (texto + look + colunas), grátis.

## 1. Tipo `LIST_OVERLAY` e regras do plano (`allowedFor`)
| item | valor |
|---|---|
| `AutoVariationType` | `LIST_OVERLAY` (TRANSIÇÃO: entra no union na T-B1, junto com os Records exaustivos; até lá `ListOverlayType` em `lista.ts`) |
| eixo / pasta | DIVERSITY / `2-new-audience` (igual a `FRAME`) |
| `TYPE_MAX` | 2 (no máximo 1 peça por `templateId`; chave de duplicata `LIST_OVERLAY:<templateId>`) |
| `SWAP_TO` | `FRAME` (sem troca de fato: no lote de template o tipo que não cabe sai, não é trocado) |
| código EN / PT | `VERSUS` / `VERSUS` · `VALUE-STACK` / `PILHA-VALOR` (`MC_1104_VERSUS_9x16.mp4`) |
| quem libera | `PlanCtx.listTemplates: ListTemplateId[]`, preenchido pelas `keys` do `settings.template` (`LIST_OVERLAY:<id>`), inclusive pack e seleção. Iterate normal: vazio = o tipo não aparece |
| `WANT_OF` | nenhum (não entra no quiz na v1) |

`allowedFor` devolve 1 `AllowedType` por template liberado (`{ type: 'LIST_OVERLAY', templateId, max: 0|1, blockedReason }`; o `AllowedType` ganha `templateId?: ListTemplateId`), avaliado nesta ordem (o primeiro que falha é o motivo):
| # | regra | motivo | nível no fit |
|---|---|---|---|
| 1 | `ctx.hasSpeech` | `no_speech` | hard |
| 2 | duração da fala ≥ 12 s (`needs: min_12s`) | `short_video` | hard |
| 3 | `listMoments(ctx) ≥ 2` **ou** `brainPoints(ctx, id) ≥ 3` | `no_list` | hard |
| 4 | `posicionarLista` no 9:16 ≠ `none` | `burned_captions` se a causa é a faixa protegida; `no_room` se não há faixa protegida | soft / hard |
- `listMoments(ctx)` (puro, `regras.ts`): blocos do teardown com `fn ∈ {problem, mechanism, proof}` + 1 se há CTA falado (`spokenCta`). É a estimativa sem custo; a contagem real (âncoras) sai do plano e decide o `fill` (§2.3).
- `brainPoints(ctx, id)`: frases com ≥ 2 palavras (split em `\n . ! ? ;`). Versus = `min(frases(pains), frases(promise + what + proof))`. Value stack = `frases(promise + what + proof)`.
- Regra 4 usa os mesmos dados da guarda de legenda (`ctx.caption`, `faceTrack`, `protectedBands`): o backend chama `posicionarLista` (do video) com o `need` do template e guarda o resultado em `ctx.list[id] = { placement, maxPairs }`. `burned_captions` aceita o "Gerar mesmo assim" de 29/10 (o painel cobre a legenda, `captionOverride`); `no_room` não tem "mesmo assim" (cobriria o rosto, nunca permitido).
- `TemplateNeed` do catálogo: `['speech', 'min_12s']`. Rosto **não** é obrigatório (sem `faceTrack`, a zona livre começa em 45 % da altura).

## 2. Saída do plano (maquina-ia escreve em `api/src/integracoes/contrato.ts`; arquiteto revisa)
Etapa 2 do `planAutoBatch` (`auto-plano-template.ts` ganha `LIST_SCHEMA`), 1 chamada por template marcado, mesmo prefixo cacheado. O plano (etapa 1) só escolhe o tipo. O modo **não** é escolha da IA (vem do `templateId`).
```ts
export type ListTemplateId = 'versus' | 'value-stack';
/** texto de tela com rastreio. source 'generic' só em heads.bad e title (rótulo do template traduzido). */
export interface ListTextDraft {
  text: string;
  source: 'transcript' | 'brain' | 'both' | 'generic';
  field: 'pains' | 'promise' | 'what' | 'proof' | 'offerAndPrice' | 'cta' | 'name' | null;  // obrigatório em brain/both; 'name' = offer.name
  anchorWordIndex: number | null;   // índice GLOBAL de TranscriptWord; obrigatório em transcript/both; null nos outros
}
export interface ListLineDraft extends ListTextDraft {
  side: 'bad' | 'good' | null;      // Versus: obrigatório · Stack: null
  kind: 'item' | 'proof' | 'price' | 'cta';  // Versus: sempre 'item'
}
export interface AutoListOverlayDraft {
  type: 'LIST_OVERLAY';
  templateId: ListTemplateId;
  order: 'by_speech' | 'alternate'; // Stack: sempre 'by_speech'
  heads: { bad: ListTextDraft; good: ListTextDraft } | null;  // Versus
  title: ListTextDraft | null;                                 // Stack
  lines: ListLineDraft[];
}
```
No esquema estrito (sem opcional): `null` vira `""`/`-1`, como nos outros templates; o parse converte. Entra na união `AutoParamsDraft`.

### 2.1 Limites (caracteres visíveis; CJK 1 = 1)
| peça | máx. | linhas | fonte aceita |
|---|---|---|---|
| `heads.bad` | 14 | 1 | alternativa citada na fala (`transcript`) ou rótulo traduzido ("Other ways"/"Outros jeitos", `generic`) |
| `heads.good` | 14 | 1 | `brain` + `field: 'name'` (offer.name encurtado) |
| célula Versus | 24 | 2 | `bad`: `pains` + fala · `good`: `promise`/`what`/`proof` + fala |
| `title` (Stack) | 18 | 1 | rótulo traduzido (`generic`) ou o da fala ("3 reasons…") |
| `item` | 30 | 2 | fala; completa com `promise`/`what` |
| `proof` | 30 | 2 | número que está na fala **ou** em `proof` |
| `price` | 34 | 2 | só `offerAndPrice` |
| `cta` | 22 | 1 | `cta` da oferta ou a frase de CTA da fala |

Quantidades: **Versus** 3-4 pares (`bad` = `good`; o 4º só se `ctx.list.versus.maxPairs = 4`, zona ≥ 480 px). **Value stack** até **5 barras**: `item` 2-4 + `proof` 0-1 + `price` 0-1 + `cta` 1, com `item + proof ≥ 3`. Sem preço no Brain, nada de barra `price` (entra mais 1 item). *Nota: a §3.3 da spec citava "3 itens + prova + preço + CTA" (6), mas o `need` da §3.1 mede 5 barras; vale 5.*

### 2.2 Prompt (ia)
Pares erro → acerto a partir de `pains` × `promise`/`what`/`proof` e da transcrição; preferir a frase dita (com âncora) ao texto do Brain; número só se está na fala ou em `proof`; preço só de `offerAndPrice`; idioma = `screenLanguage`; agnóstico de oferta (nunca nomeia nicho, concorrente, plataforma ou pessoa); `order: 'alternate'` só quando a fala não separa os lados. `change` (uiLocale): "A fala vira uma tabela de antes × depois" / "Cada benefício vira uma barra que fica".

### 2.3 Validação (maquina-backend, `iteracao/lista-plano.ts`, puro e testado; reparo = 1 nova chamada com `violations`, como o §6.3)
| regra | violação |
|---|---|
| limites e quantidades do §2.1; `side`/`kind` coerentes com o template | `text_too_long`, `template_shape` |
| `source` transcript/both sem `anchorWordIndex` válido; brain/both sem `field`; `generic` fora de `heads.bad`/`title` | `source_span_missing`, `source_invalid` |
| `inventedNumbers`/`inventedClaims` em todo texto (fontes: Brain, transcrição) | `invented_number`, `invented_claim` |
| `kind: 'proof'`: o número está na fala ou em `offer.proof` (normalizado) | `proof_not_in_brain` |
| `kind: 'price'`: `field = 'offerAndPrice'`, `offerAndPrice` preenchido e todo número do texto está nele | `price_not_in_brain` (novo) |
| marca, URL (`brandTerms` + `http`) | `template_has_brand` |
| `by_speech`: âncoras crescentes (Stack: na ordem; Versus: dentro de cada coluna) | `anchor_order` (novo) |
Reparo ainda violando: a peça sai do plano (`not_planned`).
**`fill`:** depois de validar, `anchored = linhas com anchorWordIndex`. `anchored < 2` → `fill: 'pending'`, linhas sem âncora marcadas `fromFill`, e a peça fica **fora do lote e do quote** (`included: false`) até `PATCH …/list { acceptFill: true }`. Sem chamada nova (as linhas do Brain já vieram). O mock `[mock:list-thin]` força esse estado; `[mock:list-no-room]` força `posicionarLista = none`.

### 2.4 `finalizePlan` (backend)
Converte âncora em segundos com `agendaLista` (video, §3.2), extrai `quote` (frase da transcrição que contém a âncora, ≤ 120), ids estáveis das linhas (`l1`…), `look: 'ink'`, `columns: 2` (Versus), `brand` (`frameBrandOf`, a cor do `look: 'brand'`), placement nos 3 formatos (`supported: false` no formato em que `posicionarLista` dá `none`). Grava em `variation_items.payload.params` (`ListSpec` = draft validado + `look`, `columns`, `fill`, tempos).

## 3. Render (maquina-video)
### 3.1 Props da composição (`video/src/lib/listaOverlay.ts`, zod; espelho em `api/src/render/contrato.ts`)
```ts
// TemplateRenderInput ganha 2 membros e o format deixa de ser só 9:16 nesses dois
| { templateId: 'versus' | 'value-stack'; format: VideoFormat; props: ListOverlayProps }

export interface ListOverlayProps {
  mode: 'two-col' | 'one-col' | 'stack';
  look: 'ink' | 'paper' | 'brand';
  brandColor: string;                                    // FrameBrand.color, já legível no escuro (coresDaMarca)
  source: { videoUrl: string; width: number; height: number; fps: number; durationSec: number };  // vídeo inteiro, com áudio, sem corte
  guard: { faceSafeBand: Rect | null; protectedBands: ProtectedBand[] };  // px da fonte (o que entrou no posicionarLista)
  placement: ListPlacement;                              // saída do posicionarLista (o builder calcula; o resolver recalcula)
  heads: { bad: string; good: string } | null;
  title: string | null;
  lines: { id: string; side: 'bad' | 'good' | null; kind: 'item' | 'proof' | 'price' | 'cta'; text: string; atSec: number;
           fit: FittedText }[];                          // medirLista (fitText com os máximos do §2.1)
  sfx: { pop: string; ding: string } | null;
}
```
O wrapper `TemplateRenderInput` já traz `language`, `brand`, `safeArea`, `durationInFrames` (= duração do vídeo) e `checkpoints` (3 instantes: depois da 1ª linha, no meio, e o último quadro com a tabela inteira). `calcularTemplate` passa a ler `format` (1080×1920 / 1080×1350 / 1080×1080). **Sem legenda nossa:** `captionsAuto` do lote é ignorado nesse tipo.

### 3.2 Funções puras (testadas, `video/src/lib/listaOverlay.ts`)
```ts
export function needLista(mode: ListMode, rows: number): number;   // 284 (2 col, 3 linhas) · 364 (1 col) · 372 (stack, 5 barras)
export function posicionarLista(i: {
  format: VideoFormat;
  source: { width: number; height: number; durationSec: number };
  faceSafeBand: Rect | null;          // px da fonte; null = zona começa em 45 % da altura
  protectedBands: ProtectedBand[];    // legenda-protegida-v1 (união com a folga de 4 %/2 % e a linha extra; já detectada)
  need: number;                       // px da saída (needLista)
}): ListPlacement;
export type ListPlacement =
  | { mode: 'body'; reason: 'free_below_face' | 'below_captions' | 'no_captions'; video: CoverFit; panel: Rect; maxPairs: 3 | 4 }
  | { mode: 'top';  reason: 'small_zone'; video: { box: Rect; frame: MolduraVideo }; panel: Rect; scale: number; maxPairs: 3 }
  | { mode: 'side'; reason: 'square'; video: { box: Rect; frame: MolduraVideo }; panel: Rect; maxPairs: 3 }
  | { mode: 'none'; reason: 'burned_captions' | 'no_room' };
export function agendaLista(lines: { anchorWordIndex: number | null; side: ListSide | null }[], words: TranscriptWord[],
  durationSec: number, order: ListOrder): number[];    // at = início da âncora − 0,10 s; sem âncora = maior pausa ≥ 0,4 s entre vizinhas, senão o meio
export function medirLista(props: Omit<ListOverlayProps, 'lines'> & { lines: Omit<ListOverlayProps['lines'][number], 'fit'>[] }):
  { lines: FittedText[]; overflow: string[] };         // overflow = ids abaixo do piso (Versus 30 px, Stack 26 px, §3.2-3.3 da spec)
```
- Regras de `posicionarLista` = §3.1 da spec, sem mudança: `body` (cover, zona livre por posição da legenda, painel 968 px, altura `min(zona, need × 1,45)`), `top` (painel em y 170 / 50, altura `need × 1,3`, vídeo encolhido com `enquadramentosPreservandoLegenda`; escala < 0,6 = `none`), `side` (1:1, caixa de 600 px, Versus vira 1 coluna). Faixa protegida = **união no vídeo inteiro** (o painel é estático). `none.reason` = `burned_captions` quando existe faixa protegida, senão `no_room`.
- `checarLegendaProtegida` ganha o painel como elemento (retângulo a partir do `atSec` da 1ª linha). O build (`buildTemplateInput`) chama `posicionarLista` + `medirLista` de novo: `none` = `CAPTION_PROTECTED`; overflow = `TEMPLATE_TEXT_OVERFLOW` (`leave_out`). Depois do render: checagem de legenda (§4.2 do legenda-protegida) e `templateCheck` (F1.5 do iterate-v2) nos `checkpoints`, mesmos códigos e retry.
- Lambda: o bundle muda (composição nova) → `npm run lambda:deploy` do site. `RENDER_LAMBDA_KINDS` já tem `template`.

## 4. Catálogo (migração de dados, maquina-backend)
2 migrações aditivas (backup antes, `npm run db:diff`): `20261106000100_list_overlay_enum` (`ALTER TYPE "AutoVariationType" ADD VALUE 'LIST_OVERLAY'`) e `20261106000200_templates_lista` (INSERT, idempotente com `ON CONFLICT (slug) DO NOTHING`):
| campo | `versus` | `value-stack` |
|---|---|---|
| id / internalKey | `tpl_versus` / `LIST_OVERLAY:versus` | `tpl_value_stack` / `LIST_OVERLAY:value-stack` |
| autoType / frameId | `LIST_OVERLAY` / null | `LIST_OVERLAY` / null |
| tier / credits / outputs / pack | EDIT / **1** / 1 / false | EDIT / **1** / 1 / false |
| category | `frames` | `frames` |
| nameEn / namePt | Versus / Versus | Value stack / Pilha de valor |
| descEn / descPt | textos da §2 da spec | textos da §2 da spec |
| outEn / outPt | `1 video` / `1 vídeo` | idem |
| needs | `{speech,min_12s}` | `{speech,min_12s}` |
| order | **5** (primeiro do chip `frames`) | **6** |
| status / beta | **DRAFT** / false | **DRAFT** / false |
- `availabilityOf`: `LIST_OVERLAY` = disponível (entra no `TEMPLATE_ONLY_TYPES`, que já liga o tipo só no lote de template). O portão até ter exemplo é o `DRAFT` (o cliente não vê; a equipe testa pelo Admin). Ir pra `LIVE` = Admin (`PATCH status`) depois do Gusta ver os 2 exemplos. Ao ficar `LIVE`, entram no pack automaticamente (`packKeysOf`).
- Fit da galeria (`templateFitOf`): a chave `LIST_OVERLAY:<id>` vira `ctx.listTemplates = [id]` e lê o `AllowedType` daquele `templateId`.

## 5. API e vista (sem rota nova, exceto 1)
- `IteratePiece.list: PieceList` (`contratos/src/lista.ts`): `templateId`, `mode`, `look`, `order`, `heads`/`title`, `lines[]` (`id`, `side`, `kind`, `text`, `maxChars`, `atSec`, `source`, `field`, `quote`, `fromFill`), `placement[]` por formato (modo + motivo), `fill`, `preview` (props do 9:16 com URL assinada pro `@remotion/player`; recalculadas a cada PATCH).
- **Texto no Plan:** o `PATCH /iterate/:id/items/:itemId/texts` (A7) passa a aceitar LIST_OVERLAY. `IterateTemplateRun.texts` traz os `EditableText` com `path` `list.heads.bad`, `list.heads.good`, `list.title`, `list.lines.<id>`. Mesma validação do §2.3 → 422 `TEXT_INVALID { violations }` (inclui `price_not_in_brain`, `invented_number`).
- **Nova:** `PATCH /iterate/:id/items/:itemId/list` · body `UpdateListOptionsBody { look?, columns?, acceptFill? }` (≥ 1 campo) · `200 IterateBatch` · erros: 409 `INVALID_STATE` (não `PLAN_READY`), 422 `EDIT_NOT_SUPPORTED` (item não é LIST_OVERLAY; `columns` em Value stack), 400 `VALIDATION_ERROR` · quem chama: Plan (ToggleGroup de look/colunas, botão "Fill from Brain"). Grátis.
- Erros/estados: os de hoje. `captionBlocked` com `type: 'LIST_OVERLAY'` e `template: null` não basta pra 2 templates: o item ganha `listTemplate?: ListTemplateId` (TRANSIÇÃO) e o `ForceCaptionBlockedBody` também (`listTemplate?`).
- Cobrança: a de hoje (1 crédito por linha com ≥ 1 peça `ready`; 4:5 e 1:1 grátis).

## 6. Editor
**Herda o mesmo `EditDoc` v2 do E1** (`rect`, `fill`, `text`, `style`; `clips = []`, `trim = null`, `captionWords = []`), com camadas `head:bad`, `head:good`, `title`, `line:<id>` (texto/estilo) e `box:panel` (caixa). **Precisa de resolver próprio**, `resolverPropsLista(input, doc)` + `validarDocLista(doc, input)`, no padrão do E1 (um resolver por composição, como `resolverPropsMoldura`/`resolverPropsHeadline`), porque o layout vem do `posicionarLista` e não do `frameLayout`. Ordem: `posicionarLista` → `rect` do painel (só dentro da zona livre; fora = `caption_covered`/`face_covered`) → texto/estilo das linhas → `medirLista`. Tempo das linhas (`timing`) fica pro E2. **Hoje o E1 não está construído** (nenhum `resolverPropsMoldura` no `video/lib`): até ele ir pro ar, a peça LIST_OVERLAY responde `editorAvailable: false` (`auto_type_not_editable`) e a edição é a do Plan (§5). `resolverPropsLista` entra na mesma leva do E1.

## 7. Divisão do trabalho
Ordem: arquiteto (este contrato + tipos, feito) → **T-B1** backend (enum/Records, portão do typecheck) → video, ia e backend em paralelo → frontend → qa.
| agente | entrega | arquivos | depende de |
|---|---|---|---|
| **maquina-backend** | T-B1: `LIST_OVERLAY` no `AutoVariationType` (contratos, com o arquiteto) + `AXIS_OF`/`TYPE_MAX`/`SWAP_TO`/códigos; T-B2: `allowedFor` (§1, `listMoments`, `brainPoints`, `ctx.listTemplates`, `ctx.list`), validação/reparo (§2.3), `fill`, `finalizePlan` (§2.4), `buildTemplateInput` dos 2 ids, checagens pós-render, vista `list`, `texts` paths, rota `PATCH …/list`, `captionBlocked.listTemplate`; T-B3: catálogo (`availabilityOf`, `templateFitOf`) + as 2 migrações | `api/src/iteracao/regras.ts`, `api/src/iteracao/lista-plano.ts` (novo), `api/src/iteracao/plano-auto.service.ts`, `api/src/iteracao/iteracao.views.ts`, `api/src/iteracao/iteracao.controller.ts` + DTO, `api/src/render/template.ts`, `api/src/edicao/pecas.ts`, `api/src/templates/catalogo.ts`, `api/prisma/schema.prisma`, `api/prisma/migrations/20261106000100_list_overlay_enum/`, `…/20261106000200_templates_lista/`, `docs/contratos/api.md` (linha da rota; arquiteto revisa) | T-B1 antes de tudo; video (`posicionarLista`, `agendaLista`) por fake até chegar |
| **maquina-video** | `ListOverlay.tsx` com as animações da §4 da spec (`surge`/`entrada`/`Icone`/`Sfx`), registro dos ids no `Template`, `calcularTemplate` por formato; `needLista`, `posicionarLista`, `agendaLista`, `medirLista` + schema zod; painel no `checarLegendaProtegida`; testes (sem legenda, legenda baixa, no meio, que muda de lugar, sem rosto, 3 formatos, `none` com e sem faixa; agenda com/sem âncora); 2 exemplos 9:16 com o avatar Pocketwise (19,7 s); `lambda:deploy` com ok do Gusta | `video/src/templates/ListOverlay.tsx` (novo), `video/src/templates/registro.tsx`, `video/src/templates/Template.tsx`, `video/src/lib/listaOverlay.ts` (novo) + `listaOverlay.test.ts`, `video/src/lib/templatesFormato.ts` (ids e schema da união), `video/src/lib/legendaProtegida.ts`, `video/src/lib/index.ts` (export), `api/src/render/contrato.ts` (espelho dos tipos) | este contrato |
| **maquina-ia** | `LIST_SCHEMA` + regras do prompt (§2.2) + parse pro `AutoListOverlayDraft`; despacho na etapa 2 do `planAutoBatch`; fake com `[mock:list-thin]`, `[mock:list-no-room]` e um par com número inventado (pra testar o reparo) | `api/src/integracoes/contrato.ts`, `api/src/integracoes/claude/auto-plano-template.ts` (ou `auto-plano-lista.ts` novo), `api/src/integracoes/claude/auto-plano.ts`, `api/src/integracoes/mock/fake-template.ts` | T-B1 (o union) |
| **maquina-frontend** | Plan: tabela "At · Line · From" a partir de `piece.list` (texto editável pelo PATCH de texts, contador `n/máx`, etiqueta da fonte, citação), ToggleGroup de look/colunas → `PATCH …/list`, alerta "Too few items" (`fill: 'pending'`) com Fill from Brain, prévia com `@remotion/player` (`preview.props`); MSW. Nada de tela nova | `web/src/components/iterate/`, `web/src/components/templates/`, `web/src/mocks/` | tipos (feito); video (`@maquina/video/player` exporta `ListOverlay`) |
| **maquina-qa** | recorte: fit (5 motivos), plano mock (Versus/Stack/thin/no-room), validação nada inventado/preço, render real local dos 2 (folha de frames: nenhuma célula cortada, painel fora da legenda e do rosto em todos os quadros, `nb_frames` = duração) | `testes/` | tudo |

## 8. Custo
Plano ≈ US$ 0,02-0,05 (etapa 2, prefixo cacheado) + Lambda ≈ US$ 0,01-0,02 por formato + checagem por visão US$ 0,008 (legenda, se queimada) + US$ 0,008 (`templateCheck`) ≈ **≤ US$ 0,09 por peça**. 1 crédito fecha com a regra de 31/10. `Fill from Brain` e os PATCH: US$ 0.

## 9. Pro Gusta
Nada bloqueia o código. Só confirmar 2 escolhas do arquiteto: (a) os 2 cards em **primeiro** no chip `frames` (order 5 e 6; muda no Admin); (b) o piso de fonte da spec (30 px Versus / 26 px Stack) fica **abaixo dos 36 px** das molduras, como no protótipo que ele viu.
