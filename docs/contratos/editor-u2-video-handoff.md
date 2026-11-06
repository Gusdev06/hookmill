# F-U2 vídeo do cliente: handoff maquina-video → maquina-frontend
Data: 2026-11-05 · Dono: maquina-video · Complementa `editor-universal-v1.md` (linhas 14, 81, 89-91, 168, 230). Vale pra molduras (18) e HEADLINE. Fora daqui: `scratch`, b-roll do split, Versus/Pilha, troca de legenda.
Tudo vem de `@maquina/video` (lib). O web **não recalcula geometria**: lê `layout` do resolver.

## 1. O doc (`EditDocV3.video`)
```ts
video?: {
  layerId: 'video';                      // sempre 'video'
  box?: { x, y, w, h } | null;           // fração do canvas. null = caixa do template
  framing?: { fit: 'cover' | 'contain_blur'; zoom: number; panX: number; panY: number } | null;  // null = Auto reframe
  trim?: { inSec: number; outSec: number } | null;   // segundos do vídeo do cliente, ANTES do aparar. null = inteiro
} | null
```
- **`zoom`** 0,5–3 sobre a base: `cover` = 1 cobre a caixa; `contain_blur` = 1 cabe inteiro, com o próprio vídeo desfocado atrás.
- **`panX`/`panY`** -1..1, fração da largura/altura do **canvas**: distância do centro do conteúdo ao centro da caixa. 0/0 = centrado.
- Sem limite de "encostar": pan e zoom < 1 podem mostrar o fundo (cor da marca na moldura, preto na HEADLINE). Quem avisa é a pílula.
- O vídeo **não gira** (`editable.rotate` = false).
- Com `framing` manual a peça fica **sem o push-in** de 6 % (o que a pessoa enquadrou é o que sai). No Auto reframe o push-in continua.
- Em formato que não é o principal, `box`/`framing` moram em `doc.formatOverrides[fmt].video`. `trim` é um só, em `doc.video.trim`, e vale nos 3 formatos.

## 2. Funções exportadas
```ts
resolverPropsMoldura(base, doc, ctx)  // { props, layout, textos }. Assinatura igual à do F-U1
resolverPropsHeadline(base, doc, ctx) // idem
checarEdicao(layout, guard, textos, facts, doc)  // agora também caption_cut e face_cut
validarDocMoldura / validarDocHeadline           // agora validam `video`
normalizarDocV3(doc, base, manifest, anterior?)  // 4º parâmetro novo: doc anterior (ver §5)
comVideoEditado(doc, patch, ctx?)     // NOVA: aplica um gesto no doc, ver abaixo
```
**`comVideoEditado(doc: AnyEditDoc | null, patch: { box?: Rect | null; framing?: VideoFraming | null; trim?: { inSec; outSec } | null }, ctx?: { format: FormatCode; principal: FormatCode }): EditDocV3 | null`**
Devolve doc novo (imutável), grava no lugar certo pelo formato e aplica a regra "mudar `box` zera `framing`" quando o patch traz `box` sem `framing`. Doc que sobra vazio = `null`.
- Auto reframe: `comVideoEditado(doc, { framing: null })`.
- Voltar à caixa do template: `comVideoEditado(doc, { box: null })`.
- Remover o aparar: `comVideoEditado(doc, { trim: null })`.

## 3. Manifesto: camada `video`
`manifest.layers.find((l) => l.kind === 'video' && l.id === 'video')`. A camada `video:2` segue travada (F-U3).
```ts
{
  id: 'video', kind: 'video', labelKey: 'editor.layer.video', optional: false, lockedReason: null, limits: null,
  editable: { move: true, resize: true, reframe: true, trim: true, /* resto */ false },
  video: {                      // NOVO em LayerDecl, só nesta camada
    zoomMin: 0.5, zoomMax: 3, panAbsMax: 1,
    minBoxFrac: 0.1,            // w e h mínimos da caixa, fração do canvas
    minTrimSec: 1,
    trimMinSec: number,         // início permitido (segundos do arquivo)
    trimMaxSec: number,         // fim permitido
    fits: ['cover', 'contain_blur'],
  },
}
```
Sem controle novo em `manifest.controls`: tudo é da aba Camada, tipo `video`.

## 4. Layout: `layout.video` (nunca null nestas 2 famílias)
```ts
{
  layerId: 'video',
  box: Rect,          // caixa final, fração do canvas (contorno e alças)
  sourceRect: Rect,   // quadro inteiro do arquivo projetado no canvas (pode passar da caixa)
  visibleRect: Rect,  // NOVO: o que de fato aparece (caixa ∩ canvas ∩ área útil do vídeo). w/h 0 = nada visível
  fit: 'cover' | 'contain_blur',
  auto: boolean,      // true = sem framing manual
  framing: VideoFraming, // NOVO: sempre preenchido, mesmo no auto: valores atuais pra sliders e como ponto de partida
                      // do "Reframe on canvas" (arrastar: panX += dx/canvas.width; panY += dy/canvas.height)
  edited: boolean,    // NOVO: o doc mexeu na caixa ou no enquadramento
  checksCaption: boolean, // NOVO: false quando a legenda queimada foi recortada (nossa legenda no lugar): regras de legenda não valem
  trim: { inSec, outSec },  // corte efetivo, segundos do arquivo (sem aparar = o vídeo inteiro)
}
```
A camada `layout.layers` de id `video` tem `rect` = `layout.video.box`.

**Tempo depois do aparar:** `layout.durationSec`, `fromSec`/`toSec` das camadas, `issue.atSec` e o quadro do Player estão **no tempo da saída**. Arquivo = saída + `layout.video.trim.inSec`. A duração do Player vem das props resolvidas: `metadadosMoldura(props)` (moldura) e `props.canvas.frameCount` (HEADLINE, em `props.canvas.fps`).

**Seek no Player:** instante `t` do arquivo = `frame = round((t - trim.inSec) * fps)`. Enquanto a alça do aparar é arrastada, o doc ainda não mudou: use o `trim` que já está aplicado nas props.

## 5. Normalização e a regra da caixa
O servidor devolve no `PUT` o doc normalizado:
- `box` igual à caixa do template some; `trim` igual ao vídeo inteiro some; `video` sem nada vira ausente; doc vazio vira `null`.
- **Mudar `box` zera `framing`** quando o doc mudou a caixa e manteve o `framing` anterior. Se o `framing` também mudou no mesmo `PUT` (mexeu na caixa e no zoom em menos de 800 ms, ou desfez), vale o que o cliente mandou.
- Desfazer funciona: o web manda o doc antigo inteiro.

## 6. Códigos
**Estrutura (400 `VALIDATION_ERROR`, `details.fields[]`; não salva):**
| `rule` | `field` | quando |
|---|---|---|
| `unknown_layer` | `video.layerId` | `layerId` diferente de `video` |
| `video_box_out_of_canvas` | `video.box` | fora de 0..1, ou `w`/`h` < `minBoxFrac` |
| `video_zoom_out_of_range` | `video.framing.zoom` | fora de 0,5..3 |
| `video_pan_out_of_range` | `video.framing.panX`, `.panY` | fora de -1..1 |
| `bad_template_opt_value` | `video.framing.fit` | `fit` desconhecido |
| `trim_too_short` | `video.trim` | `outSec - inSec` < 1 |
| `trim_out_of_range` | `video.trim` | fora de `trimMinSec..trimMaxSec`, ou `inSec >= outSec` |
| `format_not_supported` | `formatOverrides.<fmt>` | formato que a peça não aceita, ou o principal |

Em `formatOverrides.<fmt>.video` valem as mesmas regras de `box` e `framing`, com o `field` nesse caminho.

**Pílulas (salva e volta em `issues[]`; o Export dá 422 `EDIT_BLOCKED`):**
| `rule` | `level` | `layerId` | `atSec` | `detail` | quando |
|---|---|---|---|---|---|
| `caption_cut` | `block` | `video` | 1º instante da faixa | `{ visiblePct }` | parte da legenda queimada fora de `visibleRect` |
| `face_cut` | `block` | `video` | 1º instante ruim | `{ visiblePct }` (pior amostra) | < 90 % do rosto visível em > 10 % das amostras (uma a cada 0,25 s) |

As duas só rodam com `layout.video.edited = true`: enquadramento intocado não trava o Export de quem só mexeu no texto. As regras `caption_covered` e `face_covered` continuam e seguem a caixa e o enquadramento novos.

## 7. O que continua igual
- `doc = null` devolve a **mesma** `base` (`props === base`) e render idêntico.
- Autosave salva com pílula vermelha; só o Export bloqueia.
- Mover o vídeo **não** reposiciona os textos da moldura (o layout deles fica o da base). Se a legenda cair embaixo de um texto, a pílula avisa.
- `post_card`: com a caixa movida, o vídeo sai de dentro do cartão e o espaço dele no cartão fica vazio.
- `contain_blur` decodifica o vídeo 2 vezes no render e no Player; pode pesar em celular fraco. `proxy.status` e URL não mudam nada aqui (proxy é troca de URL).

## 8. Tipos
Espelho em `contratos/src/editor.ts`: `LayerDecl.video?: VideoLayerLimits`, e os campos novos de `EditLayout['video']`. Os tipos já existentes (`VideoEdit`, `VideoFraming`) não mudaram.
