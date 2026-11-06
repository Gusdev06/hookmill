# Editor universal de template · 2026-11-04
Dono: maquina-design · Status: **proposta, aguarda o Gusta ver o protótipo** · Nada de código antes do ok.
Protótipo: https://claude.ai/artifact/LttAWTT3FpPjTbNPrAdfei (fonte `design/mockup-editor-universal.html`; usa o `avatar.mp4` do protótipo Versus/Value stack e os posters de `web/public/landing/ex/`).
Origem: pedido do Gusta de 04/11, depois de aprovar o protótipo Versus/Value stack: "colocar essas telas em TODOS os templates; quando gerar um vídeo ele poderá editar TUDO no vídeo: arrastar o vídeo, cor, fonte etc."
Base que continua valendo: `docs/contratos/editor-v1.md` (09/10: Player = render, `EditDoc`, exportar = `POST /render`), `docs/contratos/editor-molduras-e1.md` (26/10: molduras e HEADLINE), `design/editor-v1-2026-10-09.md`, `design/templates-ruimbom-lista-2026-11-04.md`.

## 1. Problema, decisão e porquê
- **Problema:** hoje cada família de template tem (ou vai ter) o seu jeito de editar: o editor do criativo do zero (gancho/legenda/CTA), o painel da moldura do E1, a tabela de linhas do Versus/Value stack, nada no Chat DM e no Pessoa + motion. Isso é o caminho do "frankenstein" que o Gusta rejeitou no clonador. E o E1 deixou de fora justamente o que ele pediu agora: mexer no **vídeo** dele.
- **Decisão:** **uma tela só** pra qualquer peça de qualquer template, com três partes fixas: **camadas** (esquerda), **canvas** com o Player (centro) e **painel** (direita) em duas abas:
  - **Template**: montado sozinho a partir dos **controles que o template declara** (schema). Os grupos são sempre os mesmos e na mesma ordem: Aparência → Posição → Formato → [grupo do template, ex. B-roll] → Conteúdo → Guias. Um grupo só aparece se o template declarar algum controle dele.
  - **Camada**: as propriedades da camada selecionada, pelo **tipo** da camada (texto, caixa, vídeo, b-roll, lista, chat, legenda), igual em todos os templates.
  - Linha do tempo embaixo do canvas (desktop).
- **Por quê:** (1) o Gusta aprende a tela uma vez e ela vale pros 25+ templates e pros próximos; (2) template novo não pede tela nova, só declara camadas e controles (o frontend não muda); (3) o "Conteúdo" do protótipo aprovado (tempo clicável, contador, de onde veio o texto) vira o padrão de todos, então a regra "nada inventado" fica visível sempre; (4) o vídeo do cliente vira uma camada como as outras, com reenquadrar/zoom/posição/aparar, que era o pedido.

## 2. De onde abre
| origem | como | estado |
|---|---|---|
| Lote (peças AUTO) | botão **Edit** no rodapé do card da peça, ao lado de **Download** (2 botões de mesma largura, alinhados entre cards) | abre editável |
| Biblioteca | menu do item › **Open in editor** | peça aprovada abre **somente leitura** com **Duplicate and edit** (o vídeo que está no ar não muda) |
| Criativo do zero | **Edit in video** na etapa Edit e na Revisão (como hoje) | editável até o OK final |
Rota única: `/creatives/:id/editor` (já existe). No protótipo: "Pocketwise batch" no topo volta pro lote; `#batch` mostra os cards.

## 3. Modelo genérico: o template declara, o painel se monta
Cada template do registro (`video/src/templates/registro.tsx` e `video/src/lib/molduras.ts`) exporta um **manifesto de edição** puro (sem React), lido pela API e entregue no `GET /editor`:
```ts
interface EditManifest {
  templateId: string;              // 'value-stack' | 'breaking-news' | 'chat-dm' | 'split-screen' | ...
  layers: LayerDecl[];             // o que existe na peça e o que dá pra mexer em cada uma
  controls: ControlDecl[];         // o que aparece na aba Template
}
interface LayerDecl {
  id: LayerId;                     // estável por template: 'video', 'broll', 'slot:headline', 'box:cta', 'list', 'thread', 'caption'...
  kind: 'video' | 'broll' | 'text' | 'box' | 'list' | 'chat' | 'caption' | 'burned';
  labelKey: string;
  editable: { move; resize; rotate; text; style; fill; timing; hide; reframe; trim };   // booleans
  limits?: { maxChars?: number; minFontPx?: number };
  optional?: boolean;              // pode esconder
  lockedReason?: EditorLockReason | null;
}
type ControlDecl =
  | { group: 'appearance' | 'position' | 'format' | string; type: 'segmented'; key: string; options: string[] }
  | { group; type: 'toggle'; key: string }
  | { group; type: 'color'; key: string; from: 'workspace' | 'template' }   // atalho pra cor da marca
  | { group: 'format'; type: 'format' }                                     // 9:16 / 4:5 / 1:1
  | { group: 'content'; type: 'rows'; layers: LayerId[] }                   // tabela de textos (estáticos, com tempo ou com trocas no tempo)
  | { group: 'content'; type: 'messages'; layer: LayerId }                  // chat: remetente + texto + tempo
  | { group: 'content'; type: 'words'; layer: LayerId }                     // corrigir palavra da nossa legenda
  | { group: string; type: 'clips'; layer: LayerId }                        // trechos de b-roll com "Swap clip"
  | { group: 'guides'; type: 'guides' };
```
- **Catálogo fechado de 9 tipos de controle** (acima). O frontend implementa cada tipo uma vez; template novo só combina.
- `key` dos controles de aparência/posição grava em `EditDoc.templateOpts` (§8). Mudar um controle "de layout" (posição, divisão, tema, formato) **refaz o layout do template** e mantém texto, fonte, cores escolhidas, tempos e correções (mesma regra do "trocar template" do editor-v1 §3.2, só que sem pedir confirmação, porque é o mesmo template e dá pra desfazer).
- O protótipo mostra o manifesto de cada template em "How this panel was built" no fim da aba Template.

### 3.1 Os 4 templates do protótipo (o mesmo painel se adaptando)
| | Value stack | Breaking news | Chat DM | Split screen |
|---|---|---|---|---|
| Aparência | Look (Ink / Paper / Brand color) + cor da marca | Look (Paper / Ink / Brand color) + cor de destaque | Tema do chat (Dark / Light) + cor do seu balão + legenda em cima liga/desliga | Faixa (Red / Yellow / Brand color) |
| Posição | Lista: Auto (zona livre) / Faixa no topo | (não declara) | (não declara) | Divisão 50/50, 60/40, 40/60 + "seu vídeo embaixo" |
| Grupo próprio | — | — | — | **B-roll**: 3 trechos com tempo e **Swap clip** |
| Conteúdo | título + 5 barras, cada uma com tempo | kicker, headline, subtítulo, CTA (tempo = "whole") | nome do contato + **mensagens** (Me/Them clicável, tempo) + **corrigir palavra** da legenda | 3 textos da faixa que trocam no tempo |
| Camadas | seu vídeo (tela cheia, só reenquadra), lista | kicker, headline, subtítulo, seu vídeo (caixa), CTA | legenda, cabeçalho, mensagens, barra de mensagem, seu vídeo (bolha, escondido: só a voz) | seu vídeo, b-roll, faixa |
| Regras de rosto/legenda | valem | valem | não valem com o vídeo escondido (aviso diz isso) | valem no seu vídeo |

## 4. Camadas e controles por tipo (aba Camada)
Cabeçalho da aba: ícone + nome + **Hide/Show** e **Reset** à direita (sempre nessa ordem, mesmos tamanhos). Depois os avisos dessa camada, depois as seções abaixo, só as que o `editable` liberar.
| tipo | Texto | Estilo | Vídeo | Posição e tamanho | Quando aparece |
|---|---|---|---|---|---|
| `text` (slot de moldura, headline, gancho, CTA, faixa) | textarea + contador `n / máx` + "palavras de destaque"; se o texto troca no tempo, manda pro Conteúdo | fonte (catálogo de 9), tamanho em px a 1080, cor, cor de destaque, fundo (nenhum / caixa / pílula) + cor, alinhamento, caixa alta | — | X, Y, W, H, rotação + Top / Middle / Bottom / Centralizar | de / até + "Whole video" + "Start here" |
| `box` (cartão, faixa sem texto) | — | cor de fundo | — | X, Y, W, H (sem girar, D-E1-2) | — |
| `caption` (nossa legenda) | correção de palavra no Conteúdo | fonte, tamanho, cor, cor da palavra da vez | — | X, Y, W, H, rotação | de / até |
| `video` (o do cliente) | — | — | **Preencher (corta) / Caber + laterais desfocadas**, zoom 50–300 %, esquerda/direita, cima/baixo, **Auto reframe: manter rosto e legenda**, **Reframe on canvas** (desktop), **aparar início/fim** | X, Y, W, H da caixa (quando o template deixa; em tela cheia, só reenquadra). **Não gira** | — (é a base) |
| `broll` | — | — | trechos + Swap clip; preencher/caber | X, Y, W, H | — |
| `list` / `chat` | as linhas ficam no Conteúdo (botão "Open Content") | o look vem da aba Template | — | X, Y, W, H | de / até (lista) |
| `burned` (legenda queimada do original) | **travada** com o motivo: é pixel do vídeo; pra mudar, subir o vídeo sem legenda e ligar a nossa | — | — | — | — |

### 4.1 O que o vídeo do cliente aceita
- **Reenquadrar** dentro da caixa: arrastar com duplo clique (modo "Reframing", contorno lima tracejado), canto = zoom. No celular, os 3 sliders.
- **Escala** (zoom 50–300 %) e **posição** (pan X/Y em px da saída).
- **Preencher × caber**: caber usa laterais desfocadas do próprio vídeo (o `contain_blur` que já existe em `frameReframeSchema`).
- **Auto reframe**: maior escala que mantém rosto + legenda queimada inteiros, centrado nesse trecho (`enquadramentosPreservandoLegenda`, que já existe). É o padrão de toda caixa de vídeo nova e o botão de "voltar ao certo".
- **Mover/redimensionar a caixa** do vídeo nas molduras (revoga a D-E1-1). Redimensionar refaz o auto reframe.
- **Aparar** início e fim (in/out). Linhas que caem fora do corte ficam escondidas, não apagadas.
- **Não entra:** girar o vídeo, cortar no meio, trocar o vídeo (é outra peça), filtros de cor.

## 5. Regras que continuam valendo (checagens ao vivo)
As mesmas funções puras do `PUT` rodam no navegador a cada mudança e aparecem como pílulas embaixo do canvas: **Face clear · Burned caption clear · Text fits · Numbers match transcript and Brain**. Pílula vermelha = contorno vermelho na camada no canvas, nome vermelho na lista de camadas, aviso na aba Camada, **Export desligado**. Clicar na pílula seleciona a camada culpada.
| regra | quando falha | nível |
|---|---|---|
| `caption_covered` | qualquer camada (texto, caixa, lista, chat, b-roll) cruza a faixa protegida da legenda queimada | bloqueia |
| `face_covered` | camada cobre > 10 % do rosto | bloqueia |
| `caption_cut` (novo) | o reenquadramento corta a legenda queimada (fora da caixa ou do canvas) | bloqueia |
| `face_cut` (novo) | menos de 90 % do rosto visível | bloqueia |
| `text_overflow` / `too_long` | texto não cabe no piso de 36 px / passa do máximo de caracteres | bloqueia |
| `invented_number` | número digitado que não está na transcrição nem no Brain | **âmbar**, com **It's true, keep it** (D-E1-3) e **Undo this edit**; o Export espera a confirmação |
| sem imagem do cliente (Chat DM com o vídeo escondido, bolha de foto) | rosto/legenda não se aplicam | informativo |
- **Checagem pós-render** (visão: legenda protegida e texto, D-E1-5) roda no export de qualquer template. Se falhar, a peça **não é substituída** (fica a anterior) e aparece o banner vermelho com **Jump to 0:04.2** e **Retry check** (estado "Check failed" no protótipo).
- **De onde veio cada texto** fica visível no Conteúdo: Transcript / Brain › campo / os dois / Template label / "You edited · was …" depois que a pessoa muda.

## 6. Desfazer, salvar, exportar
- **Desfazer/refazer** local por peça (⌘Z / ⇧⌘Z e botões no topo), 100 passos, um passo por gesto completo (soltar o arrasto, sair do campo, clicar num segmentado). Setas movem a camada 1 px (Shift = 10 px).
- **Autosave** 800 ms com `baseRevision` (editor-v1 §5). Status no topo: "Saving…" → "Saved · rev 13 · not exported" → "Exported · rev 13".
- **Export** (botão lima, o único lima da tela) = re-render barato da peça: `POST /render` no Lambda + checagens. **Sem geração paga e sem crédito.** Desligado quando: nada mudou, há pílula vermelha, há número sem confirmação, ou já exportado. Banner azul com etapas reais: Edits saved → Rendering 9:16 (barra) → Caption check → Text check; dá pra sair da tela.
- Ao terminar: selo **Edited** no card, código com sufixo **-ED** (D-E1-4), 4:5 e 1:1 ficam pra pedir de novo (grátis). **Download** só liga quando não há edição não exportada.
- **Conflito** (Tordan salvou antes): banner âmbar com **Load his version** / **Copy my text first**. Sem merge (editor-v1).
- **Abrindo**: capa no canvas com etapas reais (peça e camadas ✓ → cópia leve 540p do vídeo, ~4 s → fontes) e skeleton no painel.

## 7. Responsivo
- **≥ 900 px:** camadas | canvas | painel; linha do tempo embaixo de camadas + canvas; arrastar, redimensionar, girar, reenquadrar no canvas; barras e ticks da linha do tempo arrastáveis.
- **< 900 px (provado em 390 px):** canvas em cima (até 380 px de largura e 58 % da altura), **chips das camadas** logo acima do canvas, depois o mesmo painel. **Sem alças nem arrasto no canvas** (D4); tocar seleciona. Tudo o que o arrasto faz no desktop o celular faz pelos campos da aba Camada: X/Y/W/H/rotação, Top/Middle/Bottom/Centralizar, zoom e pan do vídeo por slider, Auto reframe, aparar e "quando aparece" por campos numéricos. Linha do tempo gráfica escondida. "Reset all" sai do topo no celular.
- Toques ≥ 32 px; segmentados quebram linha; tabela do Conteúdo mostra a origem embaixo do texto.

## 8. Tokens e componentes
- **Tokens:** os do produto (`web/src/app/globals.css`, mesmos do protótipo aprovado): fundo `#eeeeea`, cartão `#fdfdfb`, linhas `#dcddd7`, palco `#16181b`, lima `#c8f03c` só no Export/ação principal, status ok/âmbar/vermelho/azul. Seleção no canvas `#4f7cff`; reenquadrar `#c8f03c` tracejado; erro `#ff4d4d`. Geist Sans/Mono na UI; dentro do anúncio só as fontes do bundle.
- **shadcn:** `ToggleGroup` (todo segmentado, abas Template/Camada, estados), `Tabs` (painel no celular se preferir), `Input`/`Textarea` com contador, `Select` (fonte), `Slider` (zoom, pan, scrub), `Button` (`default` = lima só no Export; `outline` resto; `sm` nos botões de linha), `Badge` (origem do texto, Edited), `Alert` (banners: `default` info, âmbar, `destructive`), `Skeleton`, `Progress` (export), `ScrollArea` (chips no celular), `Collapsible` ("How this panel was built", só em dev/admin), `Tooltip` (Export desligado explica o porquê). Reusar `editor/stage.tsx` (alças), `timeline.tsx`, `panel.tsx` (os `Num`, `Swatches`, `Seg`, `Memo` já existem) e a tabela de linhas do Iterate.
- **Botões alinhados (regra de 04/11):** rodapé de card de peça com Download | Edit em grade de 2 colunas iguais, sempre no fim do card; cabeçalho da aba Camada com Hide | Reset à direita; ações de banner sempre à direita do texto, quebrando pra baixo no celular.

## 9. O que muda nos contratos (pro arquiteto)
**editor-v1.md**
1. `EditorState` ganha `manifest: EditManifest` (§3). `layers: EditorLayerInfo[]` passa a vir do manifesto (inclui `kind`).
2. `EditDoc` (versão 3) ganha `templateOpts?: Record<string, string | boolean>` (look, place, theme, ratio, swap, strip, brand…), `video?: VideoEdit` e `items?: Record<LayerId, ItemEdit[]>`:
   - `VideoEdit = { layerId: 'video' | string; fit: 'cover' | 'contain_blur'; zoom: number; panX: number; panY: number; box?: Rect | null; trim?: { inSec; outSec } | null }` (pan em fração da saída).
   - `ItemEdit = { id: string; text?: string; atSec?: number; side?: 'me' | 'them'; confirmed?: boolean }` pra barras, mensagens e textos que trocam no tempo (hoje cada template guarda isso no próprio plano).
   - `clipSwaps?: { clipId: string; fileId: string }[]` pro b-roll.
3. `trim` do vídeo inteiro deixa de ser só do remix (F4): vale pra peça AUTO de template também.
4. **D4 revisada (decisão do Gusta):** no celular continua sem arrastar no canvas, mas **posição, tamanho, rotação, reenquadrar, tempos e aparar passam a ser editáveis por campos**. Motivo: regra do briefing "o mobile tem todas as funcionalidades".
5. Novas regras de validação: `caption_cut`, `face_cut`, `too_long`, `unknown_template_opt`, `item_out_of_range`.

**editor-molduras-e1.md**
6. Revoga **D-E1-1**: a `videoBox` move e redimensiona; reenquadrar dentro dela entra (era E2).
7. `capabilities.frame` vira parte do `manifest`. Slots/caixas continuam com os mesmos ids (`slot:<nome>`, `box:<nome>`).
8. "Nada inventado" no texto editado (D-E1-3) vale pra **todo** template, inclusive mensagens do Chat DM e barras do Value stack.

**E2 (antecipado em parte por este desenho)**
9. Entram agora: reenquadrar/escala/posição/aparar do vídeo, estilo e correção de palavra da nossa legenda, troca de clipe de b-roll. Fica pra depois: legenda nova num template que não tem, b-roll novo fora dos trechos, música, dividir cena.

**Novos templates (`LIST_OVERLAY`, `CHAT_DM`, `PERSON_MOTION`)**
10. `GET /editor` passa a responder pra eles (hoje `auto_type_not_editable`). Cada um precisa de `resolverProps<Tipo>(input, doc)` puro e `validarDoc<Tipo>`, com o mesmo aceite de doc nulo = render de hoje (PSNR infinito) antes de liberar.
11. **Estático (E3)**: mesmo editor sem linha do tempo e sem controles de vídeo (o manifesto não declara); export = re-render da imagem. Não está no protótipo.

**Rollout sugerido:** F-U1 manifesto + painel genérico nos 18 de moldura e HEADLINE (já têm resolver) · F-U2 vídeo do cliente (reenquadrar/aparar/caixa) · F-U3 Value stack/Versus, Chat DM, Split com b-roll · F-U4 Pessoa + motion e estático.

## 10. O que cada tela pede à API
| tela | precisa |
|---|---|
| Card da peça (lote/Biblioteca) | `editorAvailable`, `editedInEditor`, `code` com `-ED`, estado (aprovado → read-only) |
| Abrir editor | `GET /creatives/:id/editor` → `manifest`, `doc`, `source` com `proxyUrls` (540p) e URLs originais, `protectedBands`, `faceTrack`, palavras com tempo, `brain` (campos usados pela origem dos textos), `revision`, `urlsExpireAt`; estado de preparo do proxy (`proxy: 'ready' | 'building'` + ETA) |
| Editar | `PUT /creatives/:id/editor` `{ baseRevision, doc }` → doc normalizado + `issues[]` (mesmas regras do §5); `409 EDIT_CONFLICT` com `savedBy`/`savedAt` |
| Origem dos textos | por linha: `source`, `field`, citação da fala e `anchorWordIndex` (já no plano do Versus/Value stack; estender pros outros) |
| Swap clip | `GET /creatives/:id/broll-alternatives?clipId=` → 3–5 clipes já baixados (sem custo novo) |
| Exportar | `POST /creatives/:id/render` (sem mudança) + SSE `render.updated` com etapa (`rendering`, `caption_check`, `text_check`) e % · falha de checagem com `atSec` e `layerId` pro botão "Jump to" |

## 11. Decisões pro Gusta
1. **Uma tela só pra todos os templates**, com o painel montado pelos controles que cada template declara. Recomendo sim.
2. **O vídeo do cliente vira camada**: mover/redimensionar a caixa, reenquadrar, zoom, posição, aparar. Sem girar. Recomendo sim (revoga a D-E1-1 e antecipa parte do E2).
3. **Celular edita tudo por campos, sem arrastar** (revisa a D4: hoje no celular só texto, estilo e palavra). Recomendo sim, pela regra "mobile tem todas as funcionalidades".
4. **Rosto e legenda queimada continuam bloqueando o export** (contorno vermelho + aviso), agora também quando o reenquadramento corta a legenda ou o rosto. Recomendo sim.
5. **Número que não está na fala nem no Brain**: aviso âmbar com "It's true, keep it", export espera. Recomendo sim (é a D-E1-3 estendida a todos).
6. **Export grátis** (só re-render, sem crédito), peça exportada ganha selo Edited e código -ED. Recomendo sim.
