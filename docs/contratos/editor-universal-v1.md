# Editor universal de template v1 — contrato
Data: 2026-11-04 · Dono: maquina-arquiteto · Status: **desenho APROVADO pelo Gusta em 04/11** (protótipo https://claude.ai/artifact/LttAWTT3FpPjTbNPrAdfei, spec `design/editor-universal-2026-11-04.md`, fonte `design/mockup-editor-universal.html`, com os 3 pontos da §0). **Este contrato aguarda o ok dele antes de código.**
Tipos: `contratos/src/editor.ts`, bloco "editor universal v1" (+ `IteratePiece.editor` em `iteracao.ts`). São **aditivos** (F-U0): o typecheck do `contratos`, da `api` e do `web` passa sem mudança. A troca dos tipos da v1 pelos da v3 é um passo do F-U1 (§12).

**O que este contrato faz com os anteriores**
- `editor-v1.md` (09/10): **continua valendo** pro criativo do zero até o F-U2: Player = render, `EditDoc` salvo na API, `resolverProps`, revisão otimista, `EDIT_CONFLICT`, PSNR = ∞ com doc nulo. Este contrato **estende** o v1: 1 tela pra todo template, doc v3 e checagens novas. A **D4 fica revisada**: no celular dá pra editar tudo pelos campos, sem arrastar (§7.4). O F3/F4 dele (remix-keep) vira o F-U4.
- `editor-molduras-e1.md` (26/10): **absorvido**. Foi aprovado mas não foi construído: não existe `resolverPropsMoldura`, e `rect`/`fill`/`version: 2` não entraram no `contratos`. A "v2" deixa de existir: o doc v3 inclui `rect`/`fill`. **D-E1-1 revogada** (a caixa do vídeo move e redimensiona). D-E1-2 (caixa não gira), D-E1-3 (confirmar número), D-E1-4 (`-ED`), D-E1-5 (checagem de texto) e D-E1-6 (proxy sempre) continuam, estendidas a todo template.
- `templates-lista-v1.md` §6: alinhado. O `resolverPropsLista`/`validarDocLista` seguem o padrão da §5 daqui e entram no F-U3, não "junto do E1". Até lá vale a edição no Plan (grátis) e a peça LIST_OVERLAY responde `editor.available: false` (`auto_type_not_editable`).
- `estatico-montado-e-molduras-v1.md` D8 (`frame_editor_not_enabled`): revogada pra FRAME e HEADLINE no F-U1. Pro STATIC ela vale até o F-U4.

## 0. Resumo
1. **Uma tela pra toda peça de todo template.** O template declara um **manifesto** (camadas + controles de um catálogo fechado de 9 tipos). A API entrega o manifesto no `GET /editor` e o painel se monta sozinho. Template novo não pede tela nova.
2. **Um doc só, o `EditDoc` v3**, que é a v1 com `templateOpts`, `video` {enquadramento, caixa, corte}, `items`, `clipSwaps`, `confirmations` e `formatOverrides`. Cada composição tem **um resolver puro** em `@maquina/video/lib` (`base + doc → props + layout`), usado pelo web (Player) e pela API (render). **Doc nulo = render idêntico ao de hoje**, e isso é o portão de cada fase.
3. **Decisões do Gusta de 04/11:** (1) o vídeo do cliente vira camada: mover e redimensionar a caixa, reenquadrar, zoom, posição, auto reframe, aparar; não gira. (2) No celular edita tudo pelos campos, sem arrastar. (3) O export bloqueia com rosto ou legenda queimada cobertos ou cortados. Número fora da fala e do Brain gera aviso âmbar, "It's true, keep it", e o export espera a confirmação.
4. **Export = re-render grátis** (sem crédito, sem geração paga): fila do Lambda, checagem de legenda e de texto por visão. Se falhar, a peça anterior continua. Se passar, a peça ganha o selo **Edited**, o código ganha **-ED** e os formatos 4:5/1:1 voltam a "pedir de novo" (grátis).
5. **Rollout:** F-U1 = molduras (18) + HEADLINE no editor novo (texto, estilo, caixas, cor, formato); F-U2 = vídeo do cliente + criativo do zero na tela nova; F-U3 = Versus/Value stack, Chat DM, b-roll do split; F-U4 = Pessoa + motion, estático, remix-keep e "Duplicate and edit".

## 1. O que existe hoje no código (lido em 04/11)
| peça | onde | estado |
|---|---|---|
| editor do criativo do zero | `web/src/components/editor/` (editor, stage com alças, timeline, panel com `Num`/`Swatches`/`Seg`, model, use-editor); `api/src/edicao/editor.*` (GET/PUT, `EDIT_CONFLICT`, `EditorSaves` em memória); `video/src/lib/editor.ts` (`layoutPadrao`, `resolverProps`, `validarDoc`, `normalizarDoc`, espelho do `EditDoc` v1) | em produção, só `scratch` |
| remix-keep no editor | `editor.service.ts` → 422 `remix_editor_not_enabled` | F3 do v1 nunca feito |
| peça AUTO no editor | `assertNotAutoPiece` → 409 `variation_locked` | fechado |
| entrada do Player | `video/src/player.ts` exporta `Criativo`, `RemixKeep`, `AutoEdit` | **não exporta** `Moldura` nem `Template` |
| molduras | `video/src/lib/molduras.ts`: `frameLayout` (`videoBox`, `slots`), `fitText` (piso de 36 px), `reframeNaCaixa`, `frameReframeSchema` (`cover`/`contain_blur`), `faixasNaSaida`, `brand.color` | prontas pra resolver |
| guarda | `checarLegendaProtegida` (`legendaProtegida.ts`), `ProtectedBand`, `FaceTrackSegment`, `enquadramentosPreservandoLegenda` | reaproveita |
| b-roll | `api/src/edicao/trilha-broll.ts`: principal + até 2 alternativas por trecho, **já baixadas** | base do "Swap clip" |
| colunas | `creatives.edit_doc`, `edit_revision`, `renders.doc`, `renders.edit_revision` (servem pra peça AUTO, que tem `Creative`) | reaproveita |

## 2. Templates, composições e resolvers
| `EditTemplateKey` | tipo AUTO | composição | base (builder de hoje) | resolver / validador (`@maquina/video/lib`) | fase |
|---|---|---|---|---|---|
| `frame:<id>` (18) | `FRAME` | `Moldura` | `buildFrameInput` (`api/src/edicao/frame-input.ts`) | `resolverPropsMoldura` / `validarDocMoldura` | F-U1 (vídeo no F-U2; b-roll do split no F-U3) |
| `headline` | `HEADLINE` | `RemixKeep` | `buildHeadlineInput` (`headline-input.ts`) | `resolverPropsHeadline` / `validarDocHeadline` | F-U1 (vídeo no F-U2) |
| `scratch` | — (criativo do zero) | `Criativo` | `montarScratchSource` | `resolverProps` de hoje, embrulhado como `resolverPropsCriativo` | F-U2 (até lá, o editor v1 de hoje sem mudança) |
| `list:versus`, `list:value-stack` | `LIST_OVERLAY` | `Template` | `buildTemplateInput` | `resolverPropsLista` / `validarDocLista` (templates-lista-v1 §6) | F-U3 |
| `chat-dm` | `CHAT_DM` | `Template` | `buildTemplateInput` | `resolverPropsChatDm` / `validarDocChatDm` | F-U3 |
| `person-motion` | `PERSON_MOTION` | `Template` | `buildTemplateInput` | `resolverPropsPersonMotion` / `validarDocPersonMotion` | F-U4 |
| `remix-keep` | — (variação manual) | `RemixKeep` | `remixKeepInput` + `remix_base` | `resolverRemix` (editor-v1 §6) | F-U4 |
| `static` | `STATIC` montado | `Estatico` (imagem) | builder do estático | `resolverPropsEstatico` | F-U4 (E3) |
Os outros tipos AUTO (CUT, COLD_OPEN, HOOK_TEXT, ENDCARD, SPLIT_LP, STORY, REVIEW, NATIVE_SEARCH) **ficam fora** e respondem `editor.available: false` (`auto_type_not_editable`). Entram depois, cada um com manifesto e resolver próprios, sem mudar a tela.

## 3. Manifesto
### 3.1 Forma (tipos `EditManifest`, `LayerDecl`, `ControlDecl`)
- `manifestoDe(templateKey, base): EditManifest` é **puro** e mora no `@maquina/video/lib`, ao lado do resolver da composição. A API chama e entrega no `GET`. O web **não** recalcula (usa o que veio). O manifesto é "do template, refinado pela peça": ex. `dek` opcional só onde o template tem `dek`; Chat DM com `clientImage: false` quando o vídeo está escondido; `formats` só com os formatos que a peça aceita.
- **Camadas** (`layers[]`): `id` estável, `kind` (8 tipos: `video`, `broll`, `text`, `box`, `list`, `chat`, `caption`, `burned`), `labelKey`, `editable` (10 booleanos, sempre completos), `limits` (`maxChars`, `maxLines`, `minFontPx`), `optional`, `lockedReason`, `leavesEmptyCover`. A ordem do array = a ordem na lista de camadas (de cima pra baixo = da frente pra trás).
- **Controles** (`controls[]`): catálogo **fechado** de 9 tipos (`segmented`, `toggle`, `color`, `format`, `rows`, `messages`, `words`, `clips`, `guides`). Os grupos aparecem nesta ordem fixa: `appearance` → `position` → `format` → [grupo do template, com `groupLabelKey`] → `content` → `guides`. Um grupo só aparece se tiver controle. `segmented`/`toggle` com `relayout: true` refazem o layout do template e mantêm texto, estilo, tempos e correções (sem pedir confirmação; dá pra desfazer).
- `defaults` = os valores de `templateOpts` com que a base foi montada. O doc grava só o que difere (o servidor normaliza).
- `formats[0]` é o **formato principal** (peça AUTO = `9x16`). O Export renderiza ele.

### 3.2 Ids de camada por família (estáveis; viram `data-layer` nos elementos da composição)
| família | camadas |
|---|---|
| moldura | `video` (o do cliente), `video:2` (2ª fonte: trecho do campeão, imagem ou trilha de b-roll; `kind: 'broll'`), `slot:<campo>` pra cada texto do `frameTextsSchemas` (aninhado com ponto: `slot:headline.lead`, `slot:price.to`; listas viram **uma** camada com itens: `slot:items` no ranking, `slot:slideSteps` no call, item `i1…`), `box:<nome>` pra cada caixa do `frameLayout.slots` sem texto (cartão, faixa, placa), `brand` (nome/@ do workspace: move, não edita texto), `burned` (legenda queimada, travada) |
| HEADLINE | `video`, `headline` (texto), `headline:box` (faixa/placa), `burned` |
| lista | `video`, `list` (`kind: 'list'`, itens `l1…`, `head:bad`/`head:good`/`title` como linhas fixas do Conteúdo), `burned` |
| chat-dm | `caption` (nossa legenda, liga/desliga), `header`, `thread` (`kind: 'chat'`, itens `m1…`), `input` (barra de mensagem, opcional), `video` (bolha, escondida = só a voz) |
| split com b-roll | `video`, `broll` (trechos `c1…`), `strip` (faixa com textos que trocam no tempo, itens `h1…`) |
| scratch | `hook`, `caption`, `cta` (os da v1) + `video` no F-U2 (só aparar por cena, como hoje; sem caixa) |

### 3.3 O que cada família declara (aba Template), por fase
| família | appearance | position | grupo próprio | content | fase |
|---|---|---|---|---|---|
| molduras | `color` `brand` (from workspace; já existe em `brand.color`) | — | — | `rows` com os `slot:*` (estáticos: tempo = "whole") e `itemsOf: 'slot:items'` onde houver | F-U1. **Sem looks novos** (Ink/Paper) nas molduras: só o que a composição já desenha. Look novo = design + aprovação |
| split (`split_stack`/`split_torn` com `broll_track`) | `segmented` `strip` (red/yellow/brand) | `segmented` `ratio` (50/60/40, relayout), `toggle` `swap` (relayout) | `clips` (b-roll) | `rows` `itemsOf: 'strip'` (timed) | F-U3 (precisa da composição aceitar ratio/swap) |
| HEADLINE | — | — | — | `rows` `['headline']` | F-U1 |
| lista | `segmented` `look` (ink/paper/brand), `color` `brand` | `segmented` `place` (auto/top, relayout) + `segmented` `columns` no Versus | — | `rows` `itemsOf: 'list'` (timed) | F-U3 |
| chat-dm | `segmented` `theme` (dark/light), `color` `bubble`, `toggle` `captions` | — | — | `rows` `['header']`, `messages` `thread`, `words` `caption` | F-U3 |
| scratch | — (template e legenda continuam no `EditSettings`/Edit) | — | — | `rows` `['hook','cta']`, `words` `caption` | F-U2 |
`format` aparece em todo template com mais de 1 formato. `guides` aparece em todos.

## 4. `EditDoc` v3
```ts
interface EditDocV3 {
  version: 3;
  clips: EditClip[];                 // só scratch (= v1). auto-piece: []
  trim: null;                        // obsoleto (o F4 do v1 nunca saiu). Aparar = video.trim
  layers: EditDocLayerV3[];          // = v1 + rect + fill. Geometria aqui = formato PRINCIPAL
  captionWords: CaptionWordFix[];    // nossa legenda (= v1; remix/auto: `t:<wordIndex>`)
  templateOpts?: TemplateOpts;       // key do controle → valor (string | boolean); ausente = manifest.defaults
  video?: VideoEdit | null;          // { layerId, framing?: { fit, zoom, panX, panY } | null, box?: Rect | null, trim?: { inSec, outSec } | null }
  items?: Record<LayerId, ItemEdit[]>;   // { id, text?, atSec?, side? } só os mexidos
  clipSwaps?: ClipSwap[];            // { clipId, fileId } (alternativa já baixada)
  confirmations?: TextConfirmation[];// { path, numbers[], byUserId, at } (D-E1-3)
  formatOverrides?: Partial<Record<FormatCode, FormatGeometry>>;  // geometria dos outros formatos
}
```
**Regras**
- **Coordenadas** em fração do canvas (como a v1). Texto usa `transform` (centro, escala, giro, largura de quebra); caixa, lista, chat e b-roll usam `rect` (sem girar, D-E1-2). `video.framing.panX/panY` em fração do canvas, `zoom` 0,5–3 sobre a base (`cover` cobre a caixa; `contain_blur` cabe com laterais desfocadas, o `contain_blur` do `frameReframeSchema`).
- **`video.framing` nulo = auto reframe** (o de hoje, `reframeNaCaixa`/`enquadramentosPreservandoLegenda`: maior escala com rosto + legenda queimada inteiros). O botão "Auto reframe" grava `framing: null`. **Mudar `video.box` zera `framing`** (o servidor normaliza), como diz a spec §4.1.
- **Tempo:** scratch segue a v1 (linha do tempo de saída). **auto-piece: segundos na linha do tempo do vídeo do cliente, antes do aparar** (`atSec`, `timing.fromSec`, `video.trim`). Assim a linha presa a uma palavra continua presa quando se apara. Saída = fonte − `trim.inSec`. Item fora do corte fica escondido (issue `info` `item_out_of_range`), não é apagado.
- **Formatos:** a geometria de `layers[]` e `video` vale pro formato principal. `formatOverrides[fmt]` guarda a geometria de outro formato. **Formato sem override = layout do template naquele formato**, com texto, estilo, `templateOpts`, itens, tempos, trocas de clipe e correções do doc (eles valem em todos). Motivo: coordenada normalizada de 9:16 não serve em 1:1, e é exatamente a regra "mudar formato refaz o layout e mantém o resto" da spec §3.
- **Itens:** só editar `text`, `atSec` e `side` dos que o plano criou. Adicionar ou apagar item fica fora da v1 (precisa de regra de quantidade por template).
- **Limites:** os da v1 (camadas ≤ 50, `captionWords` ≤ 2000, `text` ≤ 300, doc ≤ 64 KB) + itens ≤ 40 por camada, `clipSwaps` ≤ 20, `confirmations` ≤ 50, `trim` ≥ 1 s. `EditDocLimitsV3`.
- **Compatibilidade:** `docV3De(doc)` (video/lib) sobe um doc v1 pra v3 sem perda (`version: 3`, `trim: null`, resto igual). O resolver aceita os dois (`AnyEditDoc`). O `PUT` sempre grava v3 a partir do F-U2 (scratch) / F-U1 (peça AUTO). Docs v1 salvos não precisam de migração de dado.
- **Ordem de aplicação** (todo resolver): base do builder → `templateOpts` (relayout pela função de layout do template: `frameLayout`, `posicionarLista`…) → `video.box` → `video.framing` (ou auto) → `rect`/`fill` das caixas → texto, itens e estilo → `fitText`/`medirLista` na caixa final → `timing`/`atSec` → `video.trim` (corta a duração e desloca tudo) → `clipSwaps`.

## 5. Resolvers e checagens no `@maquina/video/lib`
```ts
type FormatCode = '9x16' | '4x5' | '1x1';
interface ResolvidoEditor<P> { props: P; layout: EditLayout }   // EditLayout: contratos/src/editor.ts
resolverPropsMoldura(base: MolduraProps, doc: AnyEditDoc | null, ctx: { format: FormatCode }): ResolvidoEditor<MolduraProps>
resolverPropsHeadline(base: RemixKeepProps, doc, ctx): ResolvidoEditor<RemixKeepProps>
resolverPropsLista(base: TemplateProps /* versus|value-stack */, doc, ctx): ResolvidoEditor<TemplateProps>      // F-U3
resolverPropsChatDm(base: TemplateProps /* chat-dm */, doc, ctx): ResolvidoEditor<TemplateProps>                // F-U3
resolverPropsPersonMotion(base: TemplateProps /* person-motion */, doc, ctx): ResolvidoEditor<TemplateProps>    // F-U4
resolverPropsCriativo(fonte: ScratchSource, settings, doc): ResolvidoEditor<CriativoProps>   // embrulha o resolverProps de hoje, F-U2
resolverRemix(base, champion, doc): ResolvidoEditor<RemixKeepProps>                          // F-U4
validarDoc<Familia>(doc, base, ctx): EditDocError[]          // ESTRUTURA → 400 (EditDocRuleV3)
checarEdicao(layout: EditLayout, guard: EditorGuard, textos, facts, doc): EditIssue[]   // UMA função pra todas as famílias
normalizarDocV3(doc, base, manifest): EditDocV3 | null      // tira o que é igual ao padrão; zera framing se a caixa mudou
manifestoDe(templateKey, base): EditManifest
numerosNaoConfirmados(texto, facts, confirmations, path): string[]   // a mesma normalização do inventedNumbers da API
```
- **Um resolver por composição**, puro, sem React, sem I/O, < 2 ms. Mesmo código no web (Player) e na API (`buildInput` do export). Sem isso o editor deixa de ser WYSIWYG (ajuste 1 do editor-v1).
- **Aceite de doc nulo (portão de cada família):** (a) `resolver(base, null).props` **deep-equal** a `base` (Jest, todas as fixtures); (b) render com doc nulo vs render de hoje **PSNR = ∞ frame a frame** (18 molduras × 3 formatos + 2 HEADLINE no F-U1; mesma build do Chrome). (c) Player × `renderStill` com 3 docs de teste: ≤ 2 níveis RGB fora das bordas de texto (critério do F1 do editor-v1).
- **`layout` é a fonte única da geometria:** alças, guias, contorno vermelho e checagens leem o `EditLayout`. Nada de geometria recalculada à parte no web.
- **Proxy é troca de URL:** a composição calcula todo px a partir das dimensões **declaradas** nas props (as do original), nunca do vídeo decodificado. Assim o proxy 540p entra no lugar do original sem mudar layout nem `fitText`. Aceite: still do Player com proxy × original no mesmo layout (posição das caixas idêntica; só a nitidez muda). Isso substitui o `mediaMode` do E1 (mais simples: nenhuma escala no resolver).
- `@maquina/video/player` passa a exportar `Moldura`, `Template` e `metadadosMoldura`/`metadadosTemplate` (F-U1: `Moldura` e `RemixKeep`; F-U3: `Template`).

## 6. Checagens (as mesmas no web a cada mudança e no `PUT`)
### 6.1 Estrutura (400 `VALIDATION_ERROR`, não salva)
Os `EditDocRule` da v1 + `unknown_template_opt`, `bad_template_opt_value` (valor fora das `options` ou cor que não é hex), `unknown_item`, `item_time_out_of_range` (fora de 0..duração), `too_many_items`, `unknown_clip`, `unknown_clip_alternative` (fileId que não é alternativa daquele trecho), `rect_out_of_range` (caixa de texto fora de −0,25..1,25), `video_box_out_of_canvas` (a caixa do vídeo precisa caber no canvas), `video_zoom_out_of_range`, `video_pan_out_of_range`, `trim_too_short`, `format_not_supported`, `not_editable` (mexe no que `editable`/`lockedReason` trava; substitui o 422 `EDIT_NOT_SUPPORTED` por camada) e `bad_confirmation` (número confirmado que não está no texto). `details.fields[].rule` = `EditDocRuleV3`.

### 6.2 Posição e conteúdo (salva; volta em `issues[]`; vira pílula)
Mudança em relação à v1: **o autosave salva mesmo com pílula vermelha**. A pessoa está no meio do arrasto, e perder a edição seria pior. Quem bloqueia é o **Export**.
| regra | quando falha (`EditLayout` × `EditorGuard`, em todos os instantes amostrados do intervalo visível) | nível |
|---|---|---|
| `caption_covered` | qualquer camada (texto, caixa, lista, chat, b-roll, 2ª fonte) cruza uma `ProtectedBand` (já com folga) projetada no canvas | block |
| `face_covered` | uma camada cobre > 10 % da área do rosto `main` em > 10 % das amostras do intervalo dela | block |
| `caption_cut` (novo) | o enquadramento põe parte de uma `ProtectedBand` fora da caixa do vídeo ou do canvas | block |
| `face_cut` (novo) | < 90 % da área do rosto `main` fica visível (dentro da caixa e do canvas) em > 10 % das amostras | block |
| `text_overflow` | `fitText`/`medirLista` não cabe no piso (`limits.minFontPx`; 36 px nas molduras, 30/26 na lista) | block |
| `too_long` (novo) | caracteres visíveis > `limits.maxChars` (texto ou item) | block |
| `invented_number` | número no texto (camada ou item) que não está em `facts.numbers` nem em `confirmations` daquele `path` | **confirm**: âmbar, "It's true, keep it" grava a confirmação; "Undo this edit" desfaz; o Export espera |
| `low_contrast` | contraste texto × fundo < 3 | warn |
| `item_out_of_range` | item cai fora do `video.trim` (fica escondido) | info |
| `no_client_image` | `manifest.clientImage = false` (Chat DM com vídeo escondido): rosto/legenda não se aplicam | info |
- Sem rosto no `faceTrack` = regras de rosto não rodam. Sem `protectedBands` = regras de legenda não rodam. A pílula some (não fica verde à toa).
- "Nada inventado" é **só número** no editor (`numerosNaoConfirmados`, a mesma normalização do `inventedNumbers` da API, movida pro video/lib). Afirmação sem número não é checada aqui. A checagem de texto por visão depois do render (D-E1-5) confere o que foi desenhado.
- Export liberado só com zero `block` e zero `confirm` pendente no formato principal.

## 7. API
### 7.1 Rotas
| método e rota | entrada | saída | erros | quem chama |
|---|---|---|---|---|
| `GET /creatives/:id/editor` | — | `EditorStateV3` (§7.2). Scratch continua `EditorState` v1 até o F-U2 | 404; 402 amostra travada (guard de hoje); 409 `INVALID_STATE` (peça sem 9:16 `READY`, criativo do zero fora de `EDITABLE`); 422 `EDIT_NOT_SUPPORTED` `{ reason: 'auto_type_not_editable' \| 'remix_editor_not_enabled' }` | abrir o editor (card do lote, Biblioteca, Edit/Revisão) |
| `PUT /creatives/:id/editor` | `PutEditorBodyV3 { baseRevision, doc: EditDocV3 \| null, settings? }` (`settings` só scratch) | `PutEditorResponseV3 { revision, doc (normalizado), settings, issues, dirty: true, savedAt }` | 400 `VALIDATION_ERROR` (§6.1); 404; 409 `EDIT_CONFLICT` `{ revision, savedBy, savedAt }`; 409 `INVALID_STATE` (`readOnly`, export em curso); 422 `EDIT_NOT_SUPPORTED` | autosave 800 ms |
| `POST /creatives/:id/editor/export` (nova) | `ExportEditorBody { revision }` | `202 EditorExportView` | 409 `EDIT_CONFLICT` (revision ≠ atual); 409 `INVALID_STATE` `reason: 'nothing_to_export' \| 'export_running' \| 'render_running'`; 422 `EDIT_BLOCKED` `{ issues }` (novo código); 402 `SPEND_CAP_EXCEEDED` (teto do workspace); 429 `RATE_LIMITED` | botão Export |
| `POST /creatives/:id/editor/export/recheck` (nova) | `{}` | `202 EditorExportView` | 409 `INVALID_STATE` (último export não falhou por checagem: `canRecheck: false`) | "Retry check" |
| `GET /creatives/:id/broll-alternatives?clipId=` (nova, F-U3) | — | `BrollAlternativesResponse` (as alternativas **já baixadas** daquele trecho; hoje até 2) | 404 (clipId) | "Swap clip" |
| `POST /creatives/:id/render` | sem mudança | sem mudança | sem mudança | etapa Edit do criativo do zero (o editor usa o `export`) |
| `POST /iterate/pieces/:id/formats` | sem mudança | — | — | "Make 4:5/1:1" depois do export: renderiza com o doc (`formatOverrides[fmt]` + o que vale pra todos). Grátis como hoje (vídeo) |
Papéis: os de hoje do editor (`OWNER`, `ADMIN`, `MEMBER`; `CLIENT` só lê: `GET` com `readOnly`). O export é grátis pro cliente, mas o custo é nosso, então passa pelo `assertWithinCap` (≈ US$ 0,04) e por um limite de `EDITOR_EXPORTS_PER_DAY` por workspace (padrão 300, env da API).

### 7.2 `EditorStateV3` (o que cada parte da tela usa)
`version: 3`, `revision`, `base` (`scratch | remix-keep | auto-piece`), `composition`, `templateKey`, `manifest`, `doc`, `source` (`AutoPieceSource` na peça AUTO: `formats[]` com a `base` de cada formato aceito, montada pelo builder de hoje **sem** doc e com URL do proxy; `guard` = `protectedBands` + `faceTrack` + dimensões da fonte; `words`), `settings` (só scratch), `facts.numbers`, `provenance` (por `path`: origem, campo do Brain, citação, âncora, texto original da IA; alimenta "Transcript / Brain › campo / You edited · was …"), `issues` (do doc salvo), `proxy { status, etaSec }`, `urlsExpireAt`, `fonts`, `brandColor`, `readOnly`, `dirty`, `exported`, `export` (em curso ou último que falhou), `editedInEditor`, `code`/`baseCode`, `piece { id, batchId }`.
- A `base` de 4:5/1:1 vem montada no `GET` (é puro e barato). Formato que a peça não aceita vem `supported: false, base: null`.
- `proxy.status = 'building'`: a `base` vem com as URLs originais e o web refaz o `GET` depois de `etaSec` (no máximo 3 vezes; depois fica no original).
- `provenance` sai do plano da peça (lista e chat já têm fonte/âncora; molduras e HEADLINE: o backend preenche com o que o plano tiver, senão `source: 'template'` e `quote: null`).

### 7.3 Estados e o que muda na peça
- **Peça AUTO abre no editor** quando o 9:16 está `READY`. O `assertNotAutoPiece` deixa de valer no `GET`/`PUT` do editor (continua no `PATCH /edit` e no `generate`).
- **`readOnly`**: `approved` (criativo do zero `APPROVED`) ou `published` (peça com anúncio publicado pela integração Meta). O `GET` responde, o `PUT`/export dão 409 `INVALID_STATE`. "Duplicate and edit" fica pro F-U4 (§11, pendência do Gusta).
- **Salvar** não muda a peça servida: só `edit_doc` + `edit_revision` + `edit_saved_by/at`. O card mostra "edição não exportada" (`editor.pendingExport`), e o **Download fica desligado** enquanto ela existir. O web oferece "Discard edits" (= `PUT doc: null`).

### 7.4 Celular (D4 revisada)
Mesma API. Abaixo de 900 px o web não mostra alças nem arrasto no canvas (tocar seleciona). **Tudo** o que o arrasto faz vira campo na aba Camada: X/Y/W/H, giro, Top/Middle/Bottom/Centralizar, zoom e pan do vídeo por slider, Auto reframe, aparar e "quando aparece" por campo numérico. Some só a linha do tempo gráfica.

### 7.5 Card da peça e Biblioteca (`IteratePiece.editor`, `PieceEditorView`)
`{ available, reason, edited, pendingExport, export }`. `IteratePiece.code` passa a vir **com `-ED`** quando `edited` (derivado na vista e no zip, sem mudar `variation_items.code`, que é único no lote e chave do Meta). O `LibraryItem.editedInEditor` já existe (selo Edited). Botões do card: Download | Edit, 2 colunas iguais no rodapé (regra de 04/11).

## 8. Proxies 540p
- **O quê:** H.264 baseline, 540 de largura, mesmo fps, GOP 1 s, crf 28, AAC 96k quando tem áudio (o b-roll é mudo). ~3–5 MB por 30 s.
- **De quais arquivos:** `CHAMPION_VIDEO`, `CHAMPION_CLEAN_VIDEO` (quando a peça usa a versão sem legenda) e os clipes da trilha de b-roll, **incluindo as alternativas** (o Swap toca o proxy).
- **Quando (D-E1-6 mantida):** job `PROXY` na fila da API (ffmpeg, CPU) no fim da análise de todo lote de template/Iterate e quando a trilha de b-roll é montada. Se o `GET /editor` não acha o proxy, enfileira e responde `building`.
- **Onde:** `files` com `FileKind` novo `PROXY` e `files.proxy_of_file_id` (FK pro original, `onDelete: Cascade`). Apagados junto com o original.
- **Custo:** US$ 0 de provedor; ~2–4 s de CPU por 30 s de vídeo.

## 9. Export
1. `POST …/editor/export { revision }`: trava por criativo; confere `revision` = atual, zero `block`/`confirm` no formato principal (recalculado no servidor com o mesmo `checarEdicao`), nada em render, revisão ≠ última exportada.
2. Cria um `Render` (formato principal, `priority: 10`, `doc` + `editRevision` = snapshot), com `buildInput` = builder de hoje + `resolverProps<Família>(base com URLs **originais**, doc)`. Vai pro Lambda (`RenderPort`). Etapas pelo SSE `editor.export`: `saving` → `rendering` (com %) → `caption_check` (só se o campeão tem legenda protegida; `legenda-protegida-v1` §4.2) → `text_check` (só os textos editados; D-E1-5) → `done`.
3. **Passou:** a peça passa a servir este render. Os renders de 4:5 e 1:1 ficam `stale` (o card volta a "Make 4:5/1:1", grátis). `editDirty = false`, `exported = { revision, at }`, selo Edited, código `-ED`. O zip troca a original pela editada (D-E1-4).
4. **Falhou** (render ou checagem): o render fica `FAILED` com `errorCode` (`RENDER_ERROR` / `CAPTION_COVERED` / `TEXT_MISMATCH`), `failedFrame` e `fail_detail { rule, atSec, layerId }` (coluna nova). **A peça continua servindo o render anterior.** O web mostra o banner vermelho com "Jump to 0:04.2" (seleciona `layerId`) e "Retry check" (`recheck`, só quando a falha foi de checagem: roda as checagens de novo no mesmo arquivo; se passar, vira o passo 3).
5. **Custo por export:** Lambda ~US$ 0,01–0,02 + checagem de legenda ~US$ 0,008 (se protegida) + de texto ~US$ 0,008 ≈ **US$ 0,02–0,04**. Sem crédito e sem geração paga. Entra no `cost_entries` como hoje (render + visão).
6. A peça servida = o último render `READY` do formato que **passou nas checagens**. A vista do lote, o zip e o Meta já leem "último READY"; o backend garante que um export reprovado não vire `READY`.

## 10. Conflito e tempo real
- Igual à v1: `baseRevision` no `PUT`; diferente = 409 `EDIT_CONFLICT { revision, savedBy, savedAt }`. Banner âmbar com "Load his version" (refaz o `GET`) e "Copy my text first" (o web copia os textos locais pro clipboard antes de recarregar). Sem merge.
- **`savedBy`/`savedAt` passam a ser colunas** (`creatives.edit_saved_by_id`, `creatives.edit_saved_at`, gravadas no mesmo `update` da revisão). É a pendência pós-v1 do editor-v1 §10, que vira necessária agora: com mais gente editando peças do lote, a memória da API perde o nome a cada deploy. O `EditorSaves` em memória sai.
- SSE no canal do criativo (a peça AUTO tem `Creative`): `editor.updated` (de hoje) a cada `PUT`; `editor.export` (novo) a cada etapa do export; `render.updated` continua. Outra aba com mudança local não salva mostra o banner de conflito; sem mudança local, recarrega sozinha.
- O lote (`GET /iterate/:id`) reflete `editor.pendingExport`/`edited`/`export` no polling de hoje.

## 11. Banco (migração aditiva `20261110000100_editor_universal`, escrita pelo arquiteto depois do ok)
```prisma
enum FileKind { /* … */ PROXY }                           // proxy 540p (§8)
model File {
  proxyOfFileId String? @map("proxy_of_file_id")         // original de onde saiu o proxy
  proxyOf       File?   @relation("FileProxy", fields: [proxyOfFileId], references: [id], onDelete: Cascade)
  proxies       File[]  @relation("FileProxy")
  @@index([proxyOfFileId])
}
model Render {
  failDetail Json? @map("fail_detail")                   // { rule, atSec, layerId } do export reprovado (§9.4)
}
model Creative {
  editSavedById String?   @map("edit_saved_by_id")       // FK users, SetNull (§10)
  editSavedAt   DateTime? @map("edit_saved_at")
}
```
Sem tabela nova. `edit_doc` continua `Json?` (v1 e v3 convivem; o `version` decide). Backup antes, `npm run db:diff`, janela de reinício do 3001 combinada com o Gusta (regra de sempre).

## 12. Rollout
Ordem geral: **arquiteto (F-U0) → video (portão de cada fase) → backend e frontend em paralelo (frontend com MSW desde o 1º dia) → qa**. Pastas: video em `video/src/lib/editor/` (novo: `manifesto.ts`, `checagens.ts`, `resolver-moldura.ts`, `resolver-headline.ts`…) e `video/src/player.ts`; backend em `api/src/edicao/editor*` + `api/src/edicao/proxy*` + `api/src/iteracao/iteracao.views.ts`; frontend em `web/src/components/editor/` + `web/src/app/(app)/creatives/[id]/editor/` + o card do lote. Ninguém mexe na pasta do outro. Os agentes dos templates de lista (`video/`, `api/src/iteracao/`, `api/src/integracoes/claude/`) seguem sem depender disto.

### F-U0 · contrato (arquiteto) — feito aqui, falta o ok
Este arquivo, tipos aditivos (typecheck passa), migração da §11 (depois do ok), linhas do `api.md` e do `eventos.md`, revogar a D8 pra FRAME/HEADLINE no `estatico-montado-e-molduras-v1.md`, nota de "absorvido" no `editor-molduras-e1.md`.

### F-U1 · molduras (18) + HEADLINE no editor novo · entrega primeiro pro Gusta: "abro qualquer peça de moldura do lote, mudo texto, cor, fonte e caixa, vejo os avisos e exporto de graça"
| agente | entrega | depende de |
|---|---|---|
| **video** (portão) | `docV3De`, `manifestoDe` pra `frame:*` e `headline` (§3.2–3.3), `resolverPropsMoldura` e `resolverPropsHeadline` (`{ props, layout }`; aplica `templateOpts.brand`, `rect`/`fill`, texto/estilo dos `slot:*`, itens de `slot:items`/`slot:slideSteps`, `formatOverrides`), `validarDocMoldura`/`validarDocHeadline` (estrutura), `checarEdicao` com `caption_covered`, `face_covered`, `text_overflow`, `too_long`, `invented_number`, `low_contrast` (as de vídeo entram no F-U2), `numerosNaoConfirmados` (porta do `inventedNumbers`), `normalizarDocV3`; `data-layer` estável nos elementos da `Moldura` e da `RemixKeep`; px só das dimensões declaradas (proxy = troca de URL); `@maquina/video/player` exporta `Moldura` + `metadadosMoldura`; troca o espelho `EditDoc` pro v3 (§13). **Aceite:** props deep-equal com doc nulo (todas as fixtures), PSNR = ∞ nas 18 × 3 + 2 HEADLINE, Player × still ≤ 2 níveis com 3 docs, proxy × original no mesmo layout | F-U0 |
| **backend** | `GET`/`PUT` v3 pra peça FRAME/HEADLINE (`AutoPieceSource` com a base dos 3 formatos pelos builders de hoje, `guard`, `words`, `facts`, `provenance`, `issues`), `assertNotAutoPiece` fora do editor, estrutura → 400 e issues → resposta, `readOnly`, colunas `edit_saved_*` (sai o `EditorSaves`), jobs `PROXY` + `FileKind PROXY`, `POST …/export` e `…/recheck` (§9), `fail_detail`, peça servida = último READY aprovado, 4:5/1:1 `stale`, `-ED` derivado (vista + zip), `IteratePiece.editor`, SSE `editor.export`, `EDIT_BLOCKED` no `ErrorCode` + `ApiErrorCode` (com o arquiteto, no mesmo passo), `EDITOR_EXPORTS_PER_DAY`, `assertWithinCap` | F-U0; funções do video (fake até chegarem) |
| **frontend** | tela nova em `/creatives/:id/editor` pra `base: 'auto-piece'`: camadas (esquerda; chips no celular) · canvas com Player + alças (reusa `stage.tsx`) · painel com abas **Template** (montada do manifesto; no F-U1 os controles `color`, `format`, `rows`, `guides`; `segmented`/`toggle` prontos mas sem uso real ainda) e **Camada** (tipos `text`, `box`, `burned` travada; `video` mostra "vem no próximo passo"); pílulas e contorno vermelho; "It's true, keep it"/"Undo this edit"; desfazer/refazer (100 passos, 1 por gesto); autosave 800 ms; banner de export com etapas; banner de checagem reprovada com "Jump to"/"Retry check"; conflito; abertura com etapas e skeleton; celular por campos (D4 revisada); **Edit** no card do lote (Download \| Edit) e "Open in editor" na Biblioteca; MSW com as 4 peças do protótipo. O editor do criativo do zero de hoje **não muda** no F-U1 | F-U0 (tipos); video (resolver) pra trocar o MSW pelo real |
| **ia** | nada novo (reusa o `validatePlan` e as checagens por visão). Só confirma que o `textCheck` aceita "só os textos editados" | — |
| **qa** | recorte: doc nulo = hoje (PSNR), WYSIWYG Player × render, caixa sobre legenda/rosto bloqueia o export, número novo pede confirmação e a confirmação libera, export reprovado mantém a anterior, `-ED` no zip, conflito em 2 abas, 390 px editando tudo por campos, proxy × original | tudo do F-U1 |
**Portão do F-U1:** o Gusta abre 3 peças reais de moldura e 1 HEADLINE de um lote, edita e exporta, vendo funcionar (regra "aprova vendo").

### F-U2 · vídeo do cliente + criativo do zero na tela nova
- **video:** `video` no resolver das molduras e da HEADLINE (`box`, `framing`, auto reframe, `trim` com deslocamento de tudo), `caption_cut` e `face_cut` no `checarEdicao`, `resolverPropsCriativo` (embrulha o `resolverProps` de hoje e devolve `layout`), manifesto `scratch` (inclui `words` e o estilo da nossa legenda). Aceite: PSNR = ∞ com doc nulo de novo, `nb_frames` = `trim`, áudio cortado no pacote AAC mais perto (editor-v1 §6.3).
- **backend:** `trim` no build (corta no passo final + áudio), scratch passa a responder `EditorStateV3` (o `PUT` grava v3), `video.box`/`framing` na validação.
- **frontend:** aba Camada tipo `video` (Preencher/Caber, zoom, pan, Auto reframe, "Reframe on canvas" com duplo clique, aparar), linha do tempo com o corte; criativo do zero migra pra tela nova (cenas, aparar/reordenar/apagar da v1 dentro da mesma linha do tempo); o editor antigo sai.
- **qa:** reenquadrar que corta legenda ou rosto bloqueia; aparar desloca as linhas; criativo do zero sem regressão (o e2e da v1 continua passando).

### F-U3 · Versus/Value stack, Chat DM e b-roll do split
- **video:** `resolverPropsLista`/`validarDocLista` (templates-lista-v1 §6: `posicionarLista` → `rect` do painel → linhas → `medirLista`, com `place`, `look`, `columns`, `items[list]` com `atSec`), `resolverPropsChatDm` (`theme`, `bubble`, `captions`, `items[thread]` com `side`/`atSec`, legenda, bolha do vídeo), split com `ratio`/`swap`/`strip` + `clipSwaps` na `Moldura`. `Template` no `@maquina/video/player`.
- **backend:** `LIST_OVERLAY` e `CHAT_DM` no editor, `GET …/broll-alternatives`, proxy das alternativas, `provenance` por item.
- **frontend:** controles `messages`, `clips` e `rows` com tempo (a tabela "At · Line · From" do Iterate vira o controle `rows timed`), aba Camada `list`/`chat`/`broll`/`caption`.

### F-U4 · Pessoa + motion, estático, remix-keep e "Duplicate and edit"
`resolverPropsPersonMotion`; estático (E3: mesmo editor sem linha do tempo e sem vídeo; export = re-render da imagem, que **custa** se for GPT Image 2: decisão do Gusta antes); `resolverRemix` (o F3/F4 do editor-v1, com o aceite de áudio md5 e PSNR fora da região); "Duplicate and edit" de peça aprovada (precisa de regra de código/lote).

## 13. O que quebra quando os tipos da v1 virarem aliases (F-U1/F-U2)
Hoje **nada quebra**: os tipos novos são aditivos e o typecheck de `contratos`, `api` e `web` passa (rodado em 04/11). A troca acontece em 2 passos, cada um no mesmo PR do agente dono:
1. **F-U1 (video + backend):** `video/src/lib/editor.ts` (espelho `EditDoc` com `version: 1` → aceitar `AnyEditDoc`); `api/src/edicao/editor.dto.ts` (`@IsIn([1]) version` → `[1, 3]` + DTOs de `templateOpts`/`video`/`items`/`clipSwaps`/`confirmations`/`formatOverrides`); `api/src/edicao/editor-doc.ts`, `editor.service.ts`, `edicao.service.ts` (`editorAvailable` pra peça AUTO), `api/src/criativos/views.ts` (`Render.doc` passa a ser `AnyEditDoc`).
2. **F-U2 (frontend + backend):** `contratos/src/index.ts` `Render.doc: AnyEditDoc | null`; `EditorState` vira alias de `EditorStateV3`; quebram `web/src/components/editor/{context,entry,model,use-editor}.ts(x)`, `web/src/components/wizard/edit-step.tsx`, `web/src/lib/api/client.ts`, `web/src/mocks/{db,handlers-editor}.ts`, `web/src/app/dev/editor-f1/player-teste.tsx`.
Os specs de `api/src/edicao/editor*.spec.ts` e `editor.int.spec.ts` acompanham o passo 1.

## 14. Custo
| item | custo |
|---|---|
| abrir/editar/salvar, Player | US$ 0 |
| proxies | US$ 0 de provedor (CPU da VPS) |
| export de 1 peça | ≈ US$ 0,02–0,04 (Lambda + 1–2 checagens por visão). Sem crédito |
| "Make 4:5/1:1" depois do export | igual a hoje (grátis no vídeo) |
| Retry check | ≈ US$ 0,008–0,016 |

## 15. Decisões do arquiteto (aceitas se o Gusta não disser o contrário)
1. **Autosave salva mesmo com aviso vermelho**; quem bloqueia é o Export (a v1 recusava no `PUT`).
2. **Geometria por formato:** posições valem pro formato que você está editando; os outros formatos voltam ao layout do template com os mesmos textos/cores/tempos até você mexer neles.
3. **Proxy = troca de URL** (sem `mediaMode` no resolver).
4. **Rota própria de export** (`POST …/editor/export`) em vez de reaproveitar `POST /render`: garante exportar a revisão que está na tela e carrega as checagens.
5. **`-ED` derivado** na vista e no zip; `variation_items.code` não muda.
6. **Quem salvou vira coluna** (`edit_saved_by_id/at`), saindo da memória da API.
7. Molduras **sem looks novos** no F-U1 (só cor da marca e o que já desenham); look novo passa por design.
8. Itens: editar texto/tempo/lado; **adicionar ou apagar linha/mensagem fica fora** da v1.

## 16. Pro Gusta
1. **Ok neste contrato** (libera F-U0 → F-U1).
2. **Limite de export grátis:** 300 por workspace por dia (≈ US$ 12 no pior caso). Ok ou outro número?
3. **Peça aprovada/publicada:** abre só leitura. "Duplicate and edit" fica pro F-U4: ok adiar?
4. **Estático no F-U4:** re-render de imagem do GPT Image 2 custa geração paga (o `staticImageUsd` de hoje). O export do estático segue grátis pro cliente ou cobra crédito? Decide quando chegar lá.
5. **Janela de reinício do 3001** pra migração da §11 (aditiva).
