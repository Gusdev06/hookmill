# Editor no vídeo v1 (estilo CapCut) — contrato
Data: 2026-10-09 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 09/10/2026** (decisões D1-D4 no §11). Ordem: F1 (spike, portão) → F2 → F3 → F4.
Pedido do Gusta (09/10): depois que o vídeo renderiza, abrir um editor e mexer em tudo direto no vídeo. Escopo v1 confirmado:
(1) arrastar, redimensionar e girar gancho, legenda e CTA; (2) timeline pra puxar o início e o fim de cada texto;
(3) editar texto e estilo (fonte, tamanho, cor, fundo, corrigir palavra da legenda); (4) aparar o começo e o fim de cada cena e reordenar as cenas.
Vale pro criativo do zero (`Criativo`: clean, bold, headline) e pras variações que mantêm a edição do campeão (`RemixKeep`).

## Mudanças 09/10 (aprovação do Gusta)
- **D1:** editar variação está liberado. A peça ganha o selo "editado" (`editedInEditor`, §5.1).
- **D2:** no remix, mover uma camada com fundo chapado deixa a barra vazia no lugar original. Aceito, **com aviso na tela** (`EditorLayerInfo.leavesEmptyCover`).
- **D3:** apagar cena entra na v1 do criativo do zero (`EditClip.enabled`).
- **D4:** arrastar, redimensionar e girar são só no desktop. No celular dá pra mexer em texto, estilo e correção de palavra.
- Remix (F3): vale como escrito. Texto, estilo, posição e tempo de **todas as camadas redesenháveis**, não só do gancho.
- "Continuar pro OK final" fica bloqueado enquanto houver edição não exportada (§5.3).
- Trocar de template depois de editar **pede confirmação e reposiciona** as camadas (§3.2).
- Fora da v1: dividir cena, texto novo, animação, música.

## Ajustes do arquiteto 09/10 (F0, depois do F2b do video)
- **§7.1 `ResolvedLayer`:** vale a forma do video. `transform` é **nullable** (null = posição automática de hoje, inclusive a legenda "top" que desce durante o gancho) e `style`/`fontScalePx` são **opcionais** (ausente = desenho de hoje). Motivo: doc nulo/parcial sai idêntico ao render atual sem o resolver inventar padrão.
- **§2 `CaptionWordFix.text: ''`:** a palavra sai da lista de palavras; o destaque fica na palavra anterior durante o tempo dela (o tempo continua contando).
- **Remix-keep antes do F3:** `GET` e `PUT /editor` de variação remix-keep respondem `422 EDIT_NOT_SUPPORTED` com `details: { reason: 'remix_editor_not_enabled' }` (novo `EditorLockReason`, some no F3), e `GET /edit` traz `editorAvailable: false`.
- **§5.1 `labelKey`:** do zero, `editor.layer.hook` | `editor.layer.caption` | `editor.layer.cta` (= `editor.layer.${id}`; o web traduz). As do remix entram no F3.
- **Campos novos obrigatórios desde o F2a:** `editedInEditor` (`CreativeRow`, `LibraryItem`; o item do lote herda pelo `CreativeRow`), `Render.doc` + `Render.editRevision` (null = render antigo), `EditResponse.hasEditorChanges` + `editorAvailable`.
- **§5.1 `ScratchSource` (pro maquina-backend):** o `resolverProps` emenda fatias contíguas do mesmo clipe numa peça só (igual ao `renderPieces`). Em `TAKE_SLICE`, a API manda a **última fatia do take até o fim do arquivo** (`durationSec` = fim do clipe − `clipStartSec`), senão a emenda corta a cauda.

## 0. Resumo em 5 linhas
1. **Abordagem do loop, com 3 ajustes:** o `@remotion/player` toca **a mesma composição** do render, com uma camada de manipulação por cima e uma timeline embaixo. As mudanças viram um **documento de edição** (`EditDoc`) salvo na API. "Exportar" chama o `POST /render` que já existe. Não há geração paga.
2. **Ajuste 1, uma função pura só:** `resolverProps(fonte, settings, doc)` mora em `@maquina/video/lib`. O web usa pra montar as props do Player e a API usa pra montar o `RenderInput`. Sem isso o editor vira "parecido" e deixa de ser WYSIWYG.
3. **Ajuste 2, nada muda com doc nulo:** o `EditDoc` é **opcional por cima** do `EditSettings` (coluna nova `edit_doc`). Com `edit_doc = null`, o render sai **idêntico frame a frame** ao de hoje (aceite do QA). Os renders antigos continuam reproduzíveis.
4. **Ajuste 3, o remix-keep entra com limites:** dá pra mexer em texto, estilo, posição e tempo das camadas que **já são redesenhadas, ou que dá pra redesenhar porque têm fundo chapado**. Texto queimado no vídeo do campeão sem fundo, fora da região do rosto, fica travado: não há como apagar o original. Aparar começo e fim do vídeo inteiro entra numa fase depois. **Reordenar e cortar no meio ficam bloqueados**, porque quebram o áudio passthrough e o teste de uma alavanca só.
5. **Entrega de mais valor primeiro:** F2 = editor completo no criativo do zero (os 4 itens). O F1 é um spike de 1 dia que prova Player = render e trava o resto se falhar. O remix-keep vem no F3.

## 1. O que entra e o que não entra
| item | criativo do zero (`Criativo`) | variação `remix-keep` |
|---|---|---|
| mover, redimensionar e girar gancho, legenda e CTA | sim | sim nas camadas editáveis (§6.2); travado no resto, com motivo |
| timeline de cada texto (início e fim) | sim | sim nas camadas editáveis; a cobertura do original continua no intervalo original |
| texto e estilo (fonte do catálogo, tamanho, cor, fundo, contorno, caixa alta, alinhamento) | sim | sim nas camadas editáveis |
| corrigir palavra da legenda | sim (por palavra da cena) | só no karaokê redesenhado (dentro da região do rosto, ou em todo o vídeo no `ENGINE_VOICE`) |
| apagar cena (D3) | sim (pelo menos 1 cena fica) | **não** (mesmo motivo de reordenar, §6.4) |
| aparar começo e fim de cada cena | sim | **não** (as cenas da variação são trechos do campeão presos ao áudio dele). Só começo e fim **do vídeo inteiro**, no F4 |
| reordenar cenas | sim | **bloqueado** (§6.4) |
| end card | liga e desliga como hoje (texto = CTA) | não existe |
| dividir cena, texto novo livre, animação/keyframe, música, transição | fora da v1 | fora da v1 |

## 2. Documento de edição (`EditDoc`)
Mora em `@maquina/contratos` (arquivo novo `contratos/src/editor.ts`, exportado pelo index). Todas as coordenadas são **normalizadas ao canvas**, e o tempo é em segundos **na linha do tempo de saída** (depois dos cortes).
```ts
export interface EditDoc {
  version: 1;
  /** Criativo do zero: ordem e corte das cenas. Lista vazia = ordem e duração originais. remix-keep: sempre []. */
  clips: EditClip[];
  /** remix-keep (F4): começo e fim do vídeo inteiro, em frames da grade do campeão. Nulo = vídeo inteiro. Do zero: sempre null. */
  trim: { inFrame: number; outFrame: number } | null;
  /** Só as camadas mexidas. Camada ausente = como o template (ou o campeão) desenha. */
  layers: EditDocLayer[];
  /** Correções de palavra da legenda. */
  captionWords: CaptionWordFix[];
}

export interface EditClip {
  sceneId: string;          // Scene.id da geração vigente
  enabled: boolean;         // D3: false = cena apagada do vídeo (continua no doc pra poder voltar). ≥ 1 cena enabled
  attempt: number;          // Scene.attempt quando o corte foi feito; mudou (cena regerada) = o corte volta pro clipe inteiro
  inSec: number;            // relativo ao início da cena (0 = 1º frame dela; em TAKE_SLICE, relativo à fatia)
  outSec: number;           // > inSec + 0,3 e ≤ duração da cena; o resolver arredonda pra frame (1/fps)
}

export type LayerId = 'hook' | 'caption' | 'cta' | string;   // do zero: os 3 fixos; remix-keep: EditLayer.id do editMap (§6.2)

export interface EditDocLayer {
  id: LayerId;
  visible?: boolean;                              // false = some (remix-keep: só se dá pra cobrir o original, §6.2)
  transform?: LayerTransform | null;              // null/ausente = posição padrão
  timing?: { fromSec: number; durationSec: number } | null;  // null/ausente = automático (§3.3)
  text?: string;                                  // gancho, CTA e texto estático do remix. A legenda não tem: vem das palavras
  style?: Partial<LayerStyle>;                    // por cima do estilo padrão da camada
}

export interface LayerTransform {
  x: number;            // centro da camada, fração da largura do canvas. Faixa aceita -0,25..1,25
  y: number;            // centro, fração da altura. Faixa aceita -0,25..1,25
  scale: number;        // 0,25..4; 1 = tamanho padrão da camada (fonte do template ou medida no campeão)
  rotationDeg: number;  // -180..180, em volta do centro
  boxWidth: number;     // largura da caixa de quebra de linha, fração da largura do canvas, 0,1..1,5
}

export interface LayerStyle {
  fontId: FontId;                                 // catálogo fechado FONT_CATALOG (9 fontes, já empacotadas)
  color: string;                                  // hex
  highlightColor: string | null;                  // legenda: cor da palavra da vez
  background: { kind: 'none' | 'box' | 'pill' | 'word'; color: string | null };  // word = caixa só atrás da palavra da vez
  strokeColor: string | null; strokeWidthPx: number;  // px na fonte de tamanho 1×
  uppercase: boolean; shadow: boolean; align: 'left' | 'center' | 'right';
}

export interface CaptionWordFix {
  /** do zero: `${sceneId}@${attempt}:${wordIndex}` (índice em Scene.words). remix-keep: `t:${wordIndex}` (índice na transcrição
   *  do campeão, ou nas palavras mescladas do ENGINE_VOICE). Regerar a cena muda o attempt e a correção cai sozinha. */
  key: string;
  text: string;          // '' = a palavra sai da lista; o destaque fica na anterior durante o tempo dela
}
```
Regras:
- **Tamanho:** o canto da camada mexe no `scale`. A lateral mexe no `boxWidth`, e o texto quebra de novo. O campo "Tamanho" do painel mostra `scale` em % (ou em px equivalentes, decisão do design).
- **Limites:** `layers` ≤ 50, `captionWords` ≤ 2000, `text` ≤ 300 caracteres, documento ≤ 64 KB. Cores em hex `#RRGGBB` ou `#RRGGBBAA`. No `EditDoc` não entra gradiente; o gradiente medido no campeão continua vindo do `editMap`.
- **Duração mínima:** cada clipe tem ≥ 0,3 s (9 frames) e o vídeo tem ≥ 1 s. Do zero, `clips` tem que listar **todas** as cenas vigentes uma vez só (`clips_must_cover_scenes`), apagadas inclusive (`enabled: false`), com pelo menos uma ativa (`no_enabled_clip`). Cena regerada ou nova que surge depois entra `enabled: true` no fim.

## 3. Como convive com o `EditSettings`
### 3.1 Divisão de responsabilidade
- `EditSettings` (coluna `edit_settings`, sem mudança) segue sendo o **ajuste rápido**: template, modo e posição da legenda, texto do gancho e do CTA, end card. Continua editável pela etapa Edit e pelo `PATCH /edit`.
- `EditDoc` (coluna nova `edit_doc`, nula por padrão) é o **ajuste fino** por cima dele. O texto do gancho e do CTA continua no `EditSettings`. O editor manda as duas coisas no mesmo `PUT` (§5), pra não haver dois lugares com o mesmo texto.
- `resolverProps` aplica nesta ordem: template → `EditSettings` → `EditDoc`.

### 3.2 Interações (o backend aplica no PATCH e no PUT; o resolver é tolerante de qualquer forma)
| mudança | efeito no `EditDoc` |
|---|---|
| trocar `templateId` | **com doc que tenha `transform` em alguma camada, o web pede confirmação antes** ("as camadas voltam pra posição do template novo"). Confirmado, o backend apaga todo `transform`, ou seja, reposiciona. Mantém texto, `timing`, cortes, cenas apagadas e correções. `style` parcial continua por cima do estilo do template novo. O painel tem "Voltar ao padrão" por camada |
| trocar `captionPosition` | apaga `layers[caption].transform` (o botão é "pôr a legenda em cima, no meio ou embaixo") |
| `captionStyle: 'off'` | a camada `caption` fica oculta. O doc é mantido; voltar pra `word`/`line` recupera |
| gancho vazio, ou template sem gancho | a camada `hook` some; o doc dela é mantido |
| regerar 1 cena (`attempt + 1`) | o corte dela volta pro clipe inteiro e as correções de palavra dela caem (a chave tem o attempt) |
| Generate novo (`generation + 1`) | `clips = []` e `captionWords = []`; `layers` é mantido |
| pedido de ajuste `TEXT` | sem mudança: volta pro Edit com o doc intacto |

### 3.3 Tempo automático (`timing` nulo), igual ao de hoje
`hook` = 0 até `min(3 s, cenas)`. `cta` = os últimos `min(3 s, cenas)` antes do end card. `caption` = do começo ao fim das cenas, sempre seguindo as palavras. Com `timing` manual, o resolver limita ao total. Na legenda, o `timing` é uma **janela de visibilidade**: as páginas e o destaque continuam vindo das palavras.

### 3.4 Compatibilidade e migração
- Sem migração de dado: `edit_doc` nasce nulo em todo criativo. Doc nulo, ou `{ clips: [], layers: [], captionWords: [] }`, = render de hoje.
- O `Render` ganha `doc` (cópia do `EditDoc` no momento do render, como já se faz com `settings`). `input` continua guardando o `RenderInput` completo, então qualquer render antigo se reproduz.
- **Aceite de não regressão (QA):** as 5 composições `Amostras` + 2 criativos reais (1 SCENES, 1 LIPSYNC take) renderizados antes e depois do F1 com doc nulo têm que dar **PSNR = ∞ frame a frame** (mesma build do Chrome e mesmos parâmetros). O md5 do arquivo não serve: o encoder pode variar.

## 4. Banco (migração aditiva `20261009120000_editor_v1`, escrita pelo arquiteto depois do ok)
```prisma
model Creative {
  // ...
  editDoc      Json? @map("edit_doc")                    // EditDoc; null = só o template
  editRevision Int   @default(0) @map("edit_revision")   // +1 a cada PATCH /edit e PUT /editor (concorrência otimista)
}
model Render {
  // ...
  doc          Json? @map("doc")                          // cópia do EditDoc usado
  editRevision Int?  @map("edit_revision")                // revisão renderizada (o dirty passa a comparar isto)
}
```
- O "dirty depois do render" (`RENDERING → RENDER_READY | EDIT_PENDING`) passa a comparar `creative.edit_revision` com `render.edit_revision`, em vez de comparar o JSON dos settings. Render antigo com revisão nula usa a regra de hoje.
- Sem tabela nova. O documento é pequeno, lido e gravado inteiro, e sempre junto do criativo.
- Cache da base do remix (§6.1): `creatives.remix_base Json?`, com o `RemixKeepRenderInput` guardando **fileIds** no lugar das URLs. É montado no 1º render ou na 1ª abertura do editor, e invalidado quando o take ou uma cena `SWAP_VIDEO` muda. Detalhe interno do backend; entra na mesma migração.

## 5. API (mesmas convenções do `api.md` §1)
| método e rota | entrada | saída | erros |
|---|---|---|---|
| `GET /creatives/:id/editor` | — | `EditorState` (abaixo) | 404; 409 `INVALID_STATE` sem cenas prontas, em `APPROVED` ou em `SCENES_GENERATING` de Generate novo; 422 `EDIT_NOT_SUPPORTED` (`reason: 'remix_editor_not_enabled'`) em remix-keep até o F3 |
| `PUT /creatives/:id/editor` | `{ baseRevision: number, doc: EditDoc \| null, settings?: Partial<EditSettings> }` (`doc: null` = voltar tudo ao padrão) | `{ revision, doc: EditDoc \| null (normalizado), settings: EditSettings, dirty: true }` | 400 `VALIDATION_ERROR` (regras §5.4); 404; 409 `INVALID_STATE` (estado fora de `EDITABLE` ou `APPROVED`); 409 `EDIT_CONFLICT`; 422 `EDIT_NOT_SUPPORTED` |
| `PATCH /creatives/:id/edit` | sem mudança | sem mudança | sem mudança (o remix-keep continua `409 variation_locked` aqui: template, legenda e end card do remix não existem) |
| `POST /creatives/:id/render` | sem mudança | `202 Render` (agora com `doc`) | sem mudança |
| `GET /creatives/:id/edit` | — | + `hasEditorChanges: boolean`, `editorAvailable: boolean` | sem mudança |

Estados: os mesmos do `PATCH /edit` (`SCENES_GENERATING`, `SCENES_FAILED`, `EDIT_PENDING`, `RENDERING`, `RENDER_FAILED`, `RENDER_READY`). `PUT` em `RENDER_READY` passa pra `EDIT_PENDING` e liga `editDirty` (mesma transição `EDIT_CHANGED`). Em `RENDERING`, o render em curso termina e o criativo cai em `EDIT_PENDING`, igual ao de hoje.

### 5.1 `EditorState`
```ts
export interface EditorState {
  revision: number;
  base: 'scratch' | 'remix-keep';
  composition: 'Criativo' | 'RemixKeep';      // id registrado no bundle e exportado pro web
  settings: EditSettings;
  doc: EditDoc | null;
  /** Ingredientes com URL assinada. O web chama resolverProps(fonte, settings, doc) a cada mudança, sem ir na API. */
  source: ScratchSource | RemixSource;
  urlsExpireAt: string;                        // ISO; o web refaz o GET 10 min antes (6 h de validade, api.md §1)
  layers: EditorLayerInfo[];                   // o que existe, o padrão de cada uma e o que dá pra mexer
  capabilities: { trimScenes: boolean; reorderScenes: boolean; trimVideo: boolean; fixCaptionWords: boolean;
                  locked: { what: 'reorder' | 'trim_scenes' | 'trim_video' | 'caption_words'; reason: EditorLockReason }[] };
  fonts: { id: FontId; label: string }[];      // = FONT_CATALOG
  dirty: boolean; latestRender: Render | null; previewRender: Render | null;
  editedInEditor: boolean;                     // D1: selo "editado"
}
export interface ScratchSource {
  format: VideoFormat; fps: 30; language: string;
  scenes: { sceneId: string; index: number; label: string; attempt: number; durationSec: number; clipStartSec: number;
            clip: FileRef; thumbnail: FileRef | null; words: { word: string; startSec: number; endSec: number }[] }[];
}
export interface RemixSource {
  canvas: { width: number; height: number; fps: number; frameCount: number };
  base: RemixKeepProps;                        // input do remix-keep de hoje (URLs assinadas), sem o doc aplicado
  champion: { layers: EditLayer[]; words: TranscriptWord[] };  // camadas do editMap e palavras (teardown ou mescladas do ENGINE_VOICE)
}
export interface EditorLayerInfo {
  id: LayerId; role: 'hook' | 'caption' | 'cta' | 'text'; labelKey: string;
  defaults: { transform: LayerTransform; timing: { fromSec: number; durationSec: number }; style: LayerStyle; text: string | null };
  editable: { move: boolean; text: boolean; style: boolean; timing: boolean; hide: boolean };
  lockedReason: EditorLockReason | null;
  /** D2 (remix): mover ou esconder esta camada deixa a barra do fundo original vazia no lugar dela. O web mostra o aviso
   *  na tela assim que a camada sai da caixa original (e o fantasma da cobertura). */
  leavesEmptyCover: boolean;
}
export type EditorLockReason =
  | 'burnt_no_background'          // remix: texto queimado no campeão, sem fundo chapado, fora da região do rosto
  | 'outside_redrawn_interval'     // remix: karaokê redesenhado só nos trechos main; fora deles é o original
  | 'remix_reorder_unsupported'    // remix: reordenar e cortar no meio (§6.4)
  | 'remix_scene_trim_unsupported' // remix: cena = trecho do campeão; só começo e fim do vídeo inteiro
  | 'trim_video_not_enabled';      // remix: aparar o vídeo inteiro, até o F4
```
`defaults` saem de `layoutPadrao(...)` (§7.2): é com eles que o web desenha as alças mesmo quando o doc não tem a camada.

**Selo "editado" (D1):** `editedInEditor = true` quando o render final (ou o vigente, antes de aprovar) saiu com `doc` não vazio. Vem em `CreativeRow`, `CreativeDetail`, no item da Biblioteca e no item do lote (feature 2). O web mostra o selo na peça, e mais forte em variação, porque ali a peça deixou de testar uma alavanca só. Derivado de `renders.doc`; não é coluna nova.

### 5.2 Celular (D4)
A API é a mesma. O web, abaixo do breakpoint `tablet`, não mostra alças nem a timeline de arrastar: dá pra editar texto, estilo e correção de palavra pelo painel, com a prévia no Player. Cortes, reordenar e apagar cena também ficam só no desktop.

### 5.3 Exportar antes do OK final
Com edição não exportada (`editDirty = true`, ou seja, `edit_revision` ≠ revisão do último render READY), "Continuar pro OK final" fica desabilitado na Edit e no editor, com a dica "Exporte pra continuar". O `POST /approve` já responde `409 INVALID_STATE` com `editDirty` ligado (sem mudança).

### 5.4 Validação
- O DTO (`class-validator`, `whitelist` + `forbidNonWhitelisted`) confere forma e faixas. Depois vem a semântica pela função pura `validarDoc(doc, fonte)`, em `@maquina/video/lib`, a mesma que o web usa pra avisar antes de salvar. Os erros saem como `400 VALIDATION_ERROR` com `details.fields[].rule`: `unknown_scene`, `clips_must_cover_scenes`, `no_enabled_clip`, `trim_out_of_range`, `clip_too_short`, `video_too_short`, `unknown_layer`, `bad_color`, `unknown_font`, `doc_too_large`, `unknown_word`.
- `EDIT_CONFLICT` (409, código novo): `baseRevision ≠ edit_revision`. `details: { revision, savedBy: UserRef, savedAt }`. O web recarrega e avisa ("Tordan salvou há 10 s"); não tem merge.
- `EDIT_NOT_SUPPORTED` (422, código novo): o doc mexe no que `capabilities`/`editable` dizem ser travado. `details: { layerId?: string, what?: string, reason: EditorLockReason }`.
- **Normalização no servidor:** corta `in`/`out` pro clipe, descarta corte e correção de cena regerada ou stale, arredonda pra frame e tira do doc as camadas iguais ao padrão. O `PUT` devolve o doc normalizado, e o web troca o local por ele.

## 6. remix-keep: o que dá e o que não dá (aceite do §13.10 da feature 2)
### 6.1 Como fica a montagem
- A base (overlays do rosto, camadas redesenhadas, `audioPassthroughUrl`/`audioSplice`) continua vindo do `remixKeepInput(...)` de hoje, cacheada em `remix_base`. O `resolverRemix(base, champion, doc)` aplica o doc por cima, **sem mexer em overlay, base, áudio nem `frameCount`**.
- Camada mexida com fundo chapado (`solid`/`pill`): no intervalo e na caixa **originais** fica uma **cobertura** com o fundo medido, pra o texto antigo não reaparecer. Por cima vem a camada nova, com transformação, tempo, texto e estilo novos. Se a camada for movida, o fundo original fica sem texto: é o preço de não ter o eraser, e a UI mostra a cobertura como "fantasma".
- **Aceite que continua valendo:** áudio **md5 = campeão** (o editor não mexe no áudio), `nb_frames` = campeão, e PSNR ≥ 40 dB **fora da região alterada**. A região alterada passa a incluir as coberturas e as caixas novas (rotacionadas = caixa envolvente + 4 px). A máscara do `comporSobreOCampeao` é gerada da mesma lista, então o critério continua sendo medido do mesmo jeito.

### 6.2 Camadas editáveis no remix
| caso | editável? |
|---|---|
| camada já redesenhada no render (gancho do NEW_HOOKS, karaokê dentro da região do rosto nos trechos main, toda a legenda no `ENGINE_VOICE`) | sim, tudo, no intervalo redesenhado. Fora dele: `outside_redrawn_interval` |
| camada do `editMap` com fundo `solid`/`pill` (barra de headline, tarja de texto) | sim, vira redesenhada com cobertura |
| camada sem fundo (`none`) que cai inteira na região do rosto **durante todo** o intervalo dela | sim (o rosto novo já cobre o original) |
| camada sem fundo fora da região (karaokê branco com contorno sobre o vídeo do campeão) | **não**, `burnt_no_background`. Só com o eraser (pós-10/10) |
| esconder (`visible: false`) | só nos 3 primeiros casos |

### 6.3 Aparar o vídeo inteiro (F4, viável)
`trim.inFrame`/`outFrame`: o RenderService renderiza a grade inteira e corta no passo final de composição (que já recodifica o vídeo). O áudio sai com `-c:a copy` cortado **no pacote AAC mais perto** do corte (no máximo meio pacote, cerca de 11 ms a 48 kHz). O aceite muda: `nb_frames = out − in`, e o md5 dos pacotes de áudio = os mesmos pacotes do campeão. No `ENGINE_VOICE` (áudio já recodificado) o corte vai no `montarAudioSplice`. O Player usa `inFrame`/`outFrame` próprios dele, então a prévia é exata.

### 6.4 Bloqueado no remix, e por quê
- **Reordenar cenas e cortar no meio:** os trechos do campeão estão presos ao áudio original (fala e música contínuas). Mudar a ordem obriga a emendar o áudio em pontos que não são corte de fala, com estalo nas emendas, e o md5 não se aplica mais. Também teria que mover junto overlays, trilha do rosto e karaokê (frames absolutos da grade do campeão). E, do lado do produto, muda a história do controle, então a variação deixa de testar uma alavanca só (§1.2 da feature 2). Fica para um `REMIX_EDIT` de verdade (pós-10/10), com recodificação de áudio e aceite próprio.
- **Aparar uma cena do meio:** é o mesmo caso de "cortar no meio".
- **Trocar template, modo e posição da legenda, end card:** não existem no remix (`PATCH /edit` continua `variation_locked`).

## 7. Render e composições (maquina-video)
### 7.1 Schemas zod (só campos **opcionais**: input antigo continua válido)
- `criativoSchema` + `layers?: { hook?: ResolvedLayer; caption?: ResolvedLayer; cta?: ResolvedLayer }`, onde `ResolvedLayer = { visible: boolean; transform: LayerTransform | null; fromFrame: number; durationInFrames: number; text?: string; style?: LayerStyle; fontScalePx?: number }` (null/ausente = desenho de hoje; ajuste 09/10). A resolução já vem pronta do `resolverProps`: a composição não sabe o que é doc. As cenas **não mudam de forma**: o corte vira `clipStartSec` + `durationSec` (já existem), a ordem é a do array e a correção de palavra já chega aplicada em `words`.
- Ausente `layers` = caminho de hoje. Os componentes `Gancho`, `Legenda` e `Cta` passam a desenhar a partir de um `transform` (o padrão vem de `layoutPadrao`, reproduzindo exatamente os `%`, zonas e `ESCALA_TIPO` de hoje). A regra "legenda no topo desce pro meio enquanto o gancho aparece" só vale com a legenda sem `transform`.
- `textLayerSchema` (remix) + `rotationDeg?: number`. Topo + `covers?: { startFrame; endFrame; box: Rect; color: string; kind: 'solid' | 'pill' }[]`, pintadas depois da base e antes dos overlays.
- **Correção junto:** o `EndCard` congela o último frame **sem** considerar `clipStartSec`. Com corte (ou fatia de take que não começa em 0), ele mostraria o frame errado. Passa a usar `trimBefore = clipStartSec` igual à `CenaClip`.

### 7.2 Funções puras novas em `@maquina/video/lib` (sem React, importadas pela API e pelo web)
`layoutPadrao(templateId, format, settings, cenasSec)` → defaults por camada · `resolverProps(fonte, settings, doc)` → `CriativoProps` · `resolverRemix(base, champion, doc)` → `RemixKeepProps` · `validarDoc(doc, fonte)` → `{ field, rule }[]` · `normalizarDoc(doc, fonte)`. Testes Jest no `video/` (fixtures, doc nulo = props de hoje).

### 7.3 RenderService
- `buildInput` (backend) chama `resolverProps`/`resolverRemix` com o doc do criativo e grava `render.doc` + `render.editRevision`. O `RenderService.render(input)` não muda de assinatura.
- `comporSobreOCampeao`: a máscara inclui `covers` e usa a caixa envolvente das camadas rotacionadas. F4: `trim` no filtro final + corte do áudio no pacote.
- O tempo de render é o mesmo. Nada pago.

## 8. Player no browser
- **Pacote:** o web instala `remotion` e `@remotion/player` **na mesma versão do `video/`** (4.0.533, presa exata; o Remotion exige todos os pacotes iguais) e importa as composições de uma entrada nova `@maquina/video/player` (exporta `Criativo`, `RemixKeep` e o cálculo de metadados, sem `registerRoot`). `next.config`: `transpilePackages: ['@maquina/video']`. O editor é client-only (`dynamic(..., { ssr: false })`).
- **URLs das cenas:** chegam assinadas no `EditorState.source` (clipes, base do campeão, overlays). `<video>` cross-origin toca sem CORS, mas o Remotion pode buscar a mídia com `fetch` (pré-carga e áudio), então **o bucket precisa de CORS** pra origem do web (`GET`, `HEAD`, `Range`; expõe `Content-Length`, `Content-Range`, `Accept-Ranges`). Tarefa de infra do arquiteto no Supabase Storage (prod) e no versitygw (dev). `GET /files/:id` não serve pro Player (exige header de auth). Antes de `urlsExpireAt`, o web refaz o `GET /editor` e troca as URLs.
- **Fontes:** hoje o `video/src/fontes.ts` importa `.woff2` como asset do webpack do Remotion, e o Next não garante esse import. Proposta: as 10 fontes passam pra `video/public/fonts/` (o `package.json` do video já publica essa pasta) e são carregadas com `staticFile('fonts/…')`. No render, `staticFile` aponta pro bundle. No Player, aponta pra `/fonts/…` do web, porque um `prebuild` do web copia `video/public/fonts` → `web/public/fonts`. O `measureText` (`@remotion/layout-utils`) roda no browser só depois do `loadFont` resolver (já é assim no `useFonte`).
- **Prévia vs export:** a prévia é o Player, e o export é o render. Os dois usam o mesmo componente, as mesmas props e as mesmas fontes. Pode haver diferença de quebra de linha em Safari ou Firefox (o motor de texto é outro), por isso o editor é **suportado no Chrome/Edge**: nos outros mostra um aviso e funciona. A verdade final é o vídeo renderizado da revisão.
- **Desempenho:** 1080 × 1920 com 4-6 clipes no Player é leve no Chrome. Pra arrastar, o Player roda em tamanho de tela (`compositionWidth` real, CSS reduzido), as props são memoizadas e o `resolverProps` roda em < 1 ms. A timeline usa as miniaturas das cenas, sem decodificar vídeo.

### 8.1 Licença do Remotion (Player)
- O `<Player>` conta como **automação** na licença do Remotion: na licença de empresa ele cai no plano *Remotion for Automators*, US$ 0,01 por render com mínimo de US$ 100/mês. Prévia no Player **não conta** como render (FAQ oficial, lido em 09/10/2026).
- **Hoje:** cabe na licença gratuita (empresa de até 3 pessoas; somos 2). O FAQ diz que, elegível ao gratuito, dá pra "launch a SaaS", inclusive com Player. Única restrição relevante: não vender o Remotion como produto em si (um editor de vídeo genérico baseado em Remotion se aproxima disso). O nosso vende criativo de anúncio; o editor é uma etapa.
- **Gatilho de revisão** (já anotado em `docs/render.md`): ao passar de 3 pessoas, entra a licença de empresa. O custo provável é o mínimo de US$ 100/mês do Automators (renders + Player). O editor não cria custo novo, mas **deixa mais claro** que somos um caso de automação.

## 9. Tempo real (SSE do criativo)
- Evento novo `editor.updated` `{ revision, savedBy: UserRef, savedAt }`, emitido a cada `PUT /editor` e `PATCH /edit`. Outra aba aberta recarrega o doc (ou avisa, se tiver mudança local não salva).
- `scene.updated` / `take.updated` durante o editor: o web refaz o `GET /editor` (o servidor normaliza os cortes). `render.updated`: sem mudança (barra do "Exportar").
- Polling: sem mudança.

## 10. Plano faseado
| fase | o quê | dono(s) | depende de | entrega |
|---|---|---|---|---|
| **F0** | este contrato + migração + tipos no `@maquina/contratos` + CORS do storage | arquiteto | ok do Gusta | contrato aprovado |
| **F0d** | mockup do editor (Player central, alças, painel de camada, timeline com faixas de cena e de texto, estados travados do remix, conflito, aviso de navegador) + spec | design | F0 | mockup aprovado pelo Gusta |
| **F1** spike (1 dia, **portão**) | entrada `@maquina/video/player`, fontes via `staticFile`, `layoutPadrao`, componentes guiados por `transform` com doc nulo idêntico, Player numa página de teste do web com as fixtures | video (+ frontend só pra página de teste) | F0 | (a) PSNR = ∞ nas 7 peças com doc nulo; (b) Player × `renderStill` nos frames 0, 45, 300 e no último, com 3 docs de teste: diferença máxima ≤ 2 níveis RGB fora das bordas de texto. Falhou = parar e rever a abordagem |
| **F2a** backend do zero | colunas, `GET`/`PUT /editor`, validação e normalização, `EDIT_CONFLICT`, SSE `editor.updated`, `buildInput` com doc, dirty por revisão | backend | F0, F1 (funções puras) | Jest + int |
| **F2b** video do zero | `resolverProps`, `validarDoc`, `normalizarDoc`, `layers` no schema, correção do `EndCard` | video | F1 | Jest + renders de amostra |
| **F2c** editor do zero | rota `/creatives/[id]/editor` (botão "Editar no vídeo" na Edit e na Revisão), Player + manipulação (arrastar, canto = escala, lateral = largura, alça de giro, encaixe no centro e nas zonas seguras do 9:16), painel de texto e estilo, timeline (faixas de texto arrastáveis pelas pontas, cenas arrastáveis pra reordenar, aparar pelas pontas e apagar (D3)), corrigir palavra (clique na palavra na prévia ou na lista), desfazer/refazer local, autosave 800 ms com `baseRevision`, "Exportar" = `POST /render` | frontend | F0d, F2a (ou MSW), F2b | e2e |
| **F2d** QA do zero | não regressão (doc nulo), WYSIWYG Player × render, conflito em 2 abas, regerar cena com corte, Generate novo, i18n EN/PT-BR, 390 px (D4: no celular texto, estilo e correção de palavra; arrastar, redimensionar, girar, tempos e cenas só no desktop) | qa | F2a-c | "funciona" |
| **F3** remix-keep | `remix_base`, `resolverRemix`, `covers`, máscara rotacionada, `EditorLayerInfo` com travas, UI dos travados | backend + video + frontend + qa | F2 | aceite §13.10 inalterado: áudio md5, `nb_frames`, PSNR fora da região ≥ 40 dB nas peças PC-01/PC-02/HK-03 e no podcast |
| **F4** remix aparar vídeo inteiro | `trim` + corte do áudio no pacote | video + backend + frontend + qa | F3 | aceite §6.3 |

Paralelismo: F0d e F1 andam juntos. F2a e F2b em paralelo depois do F1. F2c começa com MSW assim que o F0d e os tipos existem. Ninguém mexe na pasta do outro: as funções puras ficam em `video/src/lib/editor.ts` (video); o módulo `api/src/edicao/` ganha `editor.controller.ts`/`editor.service.ts` (backend); `web/src/app/(app)/creatives/[id]/editor/` + `web/src/components/editor/` (frontend).

**Primeira entrega com mais valor:** o F2 sozinho já resolve o dia a dia (mover a legenda que tampa o rosto, corrigir a palavra que o Whisper errou, mudar a cor do CTA, aparar o respiro do começo da cena) em todo criativo do zero, sem gastar com geração. Se precisar cortar escopo, o F2c sai em duas levas: (1) camadas + texto/estilo + palavra; (2) timeline de cenas (aparar, reordenar e apagar).

### Pendências pós-v1 (decisão do Gusta)
- **Quem salvou por último no `EDIT_CONFLICT`/`editor.updated`:** na v1 o `savedBy`/`savedAt` fica **em memória** na API (`EditorSaves`). Depois de reiniciar a API, o 409 cai no autor do criativo e no `updatedAt` dele, o que pode mostrar o nome errado no aviso "X salvou há N s". Proposta do backend: colunas `creatives.edit_saved_by_id` (FK `users`, nula) e `creatives.edit_saved_at` (nula), gravadas no mesmo `update` que sobe a `edit_revision`. Migração aditiva, **não feita**: entra quando o Gusta aprovar, junto do resultado do QA.

### Riscos
1. **Diferença entre Player e render** (fonte, `measureText`, motor de texto de outro navegador). Mitigação: portão do F1, fontes só do catálogo empacotado, Chrome como alvo, revisão sempre do vídeo renderizado.
2. **Regressão silenciosa nos renders de hoje** ao trocar posições fixas por `transform`. Mitigação: aceite PSNR = ∞ com doc nulo antes de qualquer outra coisa.
3. **CORS/URL expirada** no Player (tela preta depois de 6 h). Mitigação: CORS no bucket (F0) e refresh pelo `urlsExpireAt`.
4. **Versão do Remotion presa em dois pacotes** (web e video). Mitigação: `npm run check:remotion` na raiz falha se as versões divergirem.
5. **Remix: expectativa de "editar tudo"** quando metade do texto é pixel do campeão. Mitigação: travas com motivo na UI desde o mockup.
6. **Dois editores ao mesmo tempo** (Gusta e Tordan). Mitigação: revisão otimista + `EDIT_CONFLICT`; sem merge na v1.
7. **3001 em modo LIVE:** a migração e a edição do `contratos/src/index.ts` reiniciam a API. Entram na janela de reinício que o Gusta liberar (igual ao §13.15.9).

## 11. Decisões do Gusta (aprovadas 09/10)
- **D1 · Editar variação:** liberado. Selo "editado" na peça (`editedInEditor`, §5.1).
- **D2 · Remix, cobertura sem texto:** aceita. Mover ou esconder uma camada com fundo chapado deixa a barra vazia no lugar original, **com aviso na tela** (`leavesEmptyCover`).
- **D3 · Apagar cena:** entra na v1, só no criativo do zero (`EditClip.enabled`).
- **D4 · Celular:** arrastar, redimensionar e girar só no desktop na v1. No celular: texto, estilo e correção de palavra (§5.2).
- **Remix (F3):** texto, estilo, posição e tempo de todas as camadas redesenháveis (§6.2).
- **Remix: reordenar, apagar e cortar no meio ficam bloqueados na v1** (motivo no §6.4).
- **Também aprovado:** "Continuar pro OK final" bloqueado com edição não exportada (§5.3); trocar de template depois de editar pede confirmação e reposiciona (§3.2).
- **Fora da v1:** dividir cena, texto novo, animação, música.
