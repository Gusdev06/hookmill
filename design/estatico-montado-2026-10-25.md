# Estático "anúncio montado" — spec visual (A-D)
Data: 2026-10-25 · Dono: maquina-design · Status: **proposta, espera ok do Gusta**
Contrato: `docs/contratos/estatico-montado-e-molduras-v1.md` (aprovado 25/10, D1 = 2k, D6 = 5 % / 10 %).
Mockup do `textCheck` na peça + régua dos 3 aspectos: https://claude.ai/artifact/CesTLMRJ4JnHcpSpWULFda. Fonte: `design/mockup-estatico-textcheck.html`.

Referências que viraram regra (não reinventar):
- **Aprovada:** `api/src/integracoes/sondas/out/estatico-layout-2026-10-25/layout-1792905520012.png` (S1, 2k, 1440×2560, "perfeito, gostei mt").
- **Estrutura:** `~/Downloads/WhatsApp Image 2026-10-15 at 23.10.24 (2).jpeg` (WhatsSpy; só a grade, não tema nem oferta).
- **Defeito de grafia real:** `…/layout-1792904521654.png` (1k): "Sua manhã de **vólta**." É o exemplo usado no mockup.

---

## 1. Problema, decisão e porquê
**Problema.** O estático de 23/10 (foto + headline) foi reprovado. O aprovado é um pôster de resposta direta denso, com 11 blocos. Se a regra visual ficar só no `gerar.ts` escrito à mão, cada lote sai com uma grade diferente, os blocos que faltam deixam buraco e o erro de acento ("vólta") passa sem ninguém ver.

**Decisão.**
1. A grade da referência aprovada vira **12 colunas × zonas de altura em %**, por aspecto. O prompt (maquina-ia) descreve posição por zona; o QA confere a sonda contra esta tabela.
2. Cada bloco opcional tem **uma regra de recuo** escrita: quem ocupa o espaço quando ele some. Nunca fica buraco e nunca entra texto genérico pra tapar.
3. Emoção da pessoa = **tabela fechada** (5 linhas, em inglês, pro prompt). Ícone = **24 descrições fechadas**.
4. Na peça, o `textCheck` aparece em dois níveis: um **chip na miniatura** (só quando há problema) e um **painel "Text check" no Preview** com esperado × visto lado a lado, a letra errada marcada, e as ações **Retry · US$ 0,40** e **Leave out**. A imagem nunca recebe caixa por cima: o player/imagem é o protagonista e não temos coordenada confiável do erro.

**Porquê.** O Gusta aprovou o visual; o trabalho agora é torná-lo repetível em qualquer oferta. A checagem só vale se a pessoa enxergar o erro em 2 segundos e decidir com o custo na frente (texto errado é cobrado).

---

## 2. Anatomia (os 11 blocos, na ordem de leitura)
| # | bloco (`copy`/`visual`) | papel | peso visual |
|---|---|---|---|
| 1 | Marca: `brandName` + `brandLine` | quem fala | 3º |
| 2 | `tagline` (canto sup. direito) | ritmo, respiro | 6º |
| 3 | `headline.lead` + `headline.highlight` | **a peça** | **1º** |
| 4 | `subheadline` | explica em 3 frases | 5º |
| 5 | `handwritten` (pincelada) | emoção, quebra a grade | 4º |
| 6 | Herói (`visual.hero`) | identificação | 2º (imagem) |
| 7 | Device (`visual.product`) | prova de que existe | 2º (imagem) |
| 8 | Cards `benefits[]` (coluna direita) | o que você ganha | 5º |
| 9 | Faixa de confiança `trust[]` | tira objeção | 7º |
| 10 | CTA (`cta.main` + `cta.sub`) | ação | **2º (texto)** |
| 11 | `closing` (manuscrito) | fecha o arco emocional | 6º |
Regra de leitura: headline → pessoa → CTA em Z (esquerda alta → centro → esquerda baixa); cards e tagline são leitura de segunda passada.

---

## 3. Grade e zonas
Unidades: **W** = largura do canvas, **H** = altura. Tamanho de fonte em % de W (vale em 1k, 2k, 4k). Grade de **12 colunas**, margem lateral **4,5 % W**, gutter **1,8 % W**. Colunas citadas como `c1–c12`.

### 3.1 9:16 (2k = 1440×2560) — D6: 5 % em cima e 10 % embaixo livres
| zona | y (% H) | colunas | conteúdo | tipo (% W) |
|---|---|---|---|---|
| margem de cima | 0–5 | — | só fundo | — |
| Z1 cabeçalho | 5–10,5 | marca c1–c8 · tagline c9–c12 | wordmark + `brandLine` versalete · `tagline` 2 linhas + sublinhado acento | nome 4,6 bold · brandLine 1,6, tracking .3em · tagline 1,9, tracking .25em |
| Z2 headline | 11,5–24,5 | linhas 1-2: c1–c11 · última linha: c1–c8 | `lead` branco, `highlight` acento | 8,5 extrabold, entrelinha 1,0, máx. 3 linhas |
| Z3 sub | 25–31 | c1–c7 | 2-3 frases; última em branco semibold | 2,8 regular, cinza 72 % |
| Z4 manuscrito | 31,5–36 | começa sangrando na borda esquerda até c7 | pincelada no acento, −4°, script de letras separadas | 4,0 |
| Z5 herói | 35–78 | c1–c5, sangra na borda esquerda | pessoa (tabela §4), olhando pra dentro do canvas | — |
| Z6 device | 35–76 | c4–c8, por cima do herói | celular inclinado 4–6°, tela abstrata ou referência (D4) | `screenTitle` 2,2 |
| Z7 cards | 24–75 | c9–c12 | até 5 cards, mesma altura, gap 1 % H | título 2,6 bold · linha 2,0 cinza |
| Z8 confiança | 78–83 | c1–c12 | 3 células iguais, divisória vertical 1 px branco 15 %, filetes em cima e embaixo | 2,0 versalete, tracking .2em, 2 linhas |
| Z9 CTA + fechamento | 84–90 | CTA c1–c7 · closing c8–c12 | pílula acento com círculo branco + seta · manuscrito 2 linhas + sublinhado | main 4,6 extrabold condensado · sub 1,9 versalete · closing 3,6 |
| margem de baixo | 90–100 | — | só fundo e o desvanecer do herói; **nenhum texto, nenhum botão** | — |

Diferença pro aprovado: lá o CTA ocupa 87–95 %. Com D6 ele sobe pra 84–90 %; pra caber, a faixa de confiança sobe pra 78–83 % e os cards terminam em 75 %. O resto não muda.

### 3.2 4:5 (feed) — margem 5 % nos 4 lados
Blocos (contrato §A4): marca + tagline, headline + sub, manuscrito, herói + device, **até 3 cards**, confiança, CTA 2 linhas, **sem fechamento**.
| zona | y (% H) | colunas | nota |
|---|---|---|---|
| Z1 cabeçalho | 5–11 | marca c1–c8 · tagline c9–c12 | tipo igual ao 9:16 em % W |
| Z2 headline | 12–29 | c1–c9 | 7,5 % W, máx. 3 linhas |
| Z3 sub | 30–37 | c1–c7 | |
| Z4 manuscrito | 37,5–42 | borda esq. até c7 | |
| Z5/Z6 herói + device | 41–76 | herói c1–c5 · device c4–c8 | |
| Z7 cards | 29–75 | c9–c12 | 3 cards, mais altos (título + linha) |
| Z8 confiança | 78–85 | c1–c12 | |
| Z9 CTA | 87–95 | c1–c7 | à direita fica o fundo; o CTA **não** estica |

### 3.3 1:1 — margem 5 % nos 4 lados
Blocos: marca **sem** tagline, headline (sub só se ≤ 45), herói + device **lado a lado**, até 3 cards **compactos (só ícone + título)**, CTA 2 linhas. Sem manuscrito, sem confiança, sem fechamento.
| zona | y (% H) | colunas | nota |
|---|---|---|---|
| Z1 marca | 5–11 | c1–c8 | |
| Z2 headline | 12–30 | c1–c12 | 7 % W, máx. 2 linhas (3 se o highlight quebrar sozinho) |
| Z3 sub (se ≤ 45) | 31–36 | c1–c9 | 1 linha |
| faixa do meio | 38–81 | herói c1–c4 · device c4–c7 · cards c8–c12 | cards compactos em pilha, ícone 7 % W + título 2,6 % W numa linha |
| Z9 CTA | 85–95 | c1–c7 | |

### 3.4 Constantes visuais (todos os aspectos)
- **Fundo:** `palette.background` liso com grão de filme sutil e vinheta leve; nada de gradiente colorido.
- **Acento** (`palette.accent`) só em: highlight da headline, pincelada, sublinhado da tagline e do fechamento, azulejo dos ícones dos cards, pílula do CTA, anel/indicador da tela do device, borda dos cards (acento a ~25 %). **Nunca** em texto corrido.
- Texto branco (≥ 7:1 no fundo, garantido pelo `paletaDoEstatico`); cinza do texto secundário = branco a ~70 %.
- Raios (em % W): card 2,0 · azulejo de ícone 1,6 · pílula do CTA = altura/2. Card = fundo +4 % de luminosidade, borda 1 px.
- Sans geométrica, pesos 400/600/800; CTA em condensada extrabold; manuscrito em script de letras separadas (mitigação §A6).
- Wordmark só tipográfico (D2): **sem ícone de marca**. O azulejo laranja com a coluna que aparece nas sondas é invenção do modelo; o prompt V2 proíbe.

---

## 4. O que some quando falta um bloco (recuo)
Regra geral: quem está **à esquerda e abaixo** sobe; quem está **na coluna da direita** só some, não puxa nada. Nenhum bloco estica pra tapar o espaço do outro, exceto herói e device (imagem aguenta crescer, texto não).
| falta | some | quem ocupa | 9:16 | 4:5 | 1:1 |
|---|---|---|---|---|---|
| `brandLine` | 2ª linha da marca | nome fica sozinho, centrado na altura da 1ª linha da tagline | ✓ | ✓ | ✓ |
| `tagline` | canto sup. direito | fica vazio (respiro); a marca **não** cresce | ✓ | ✓ | — |
| `subheadline` | Z3 | o manuscrito sobe pro lugar do sub; herói e device sobem 5 % H | ✓ | ✓ | ✓ |
| `handwritten` | Z4 | herói/device começam 2 % H abaixo do fim do sub | ✓ | ✓ | — |
| `benefits: []` | coluna Z7 inteira | headline usa c1–c11 em todas as linhas; herói c1–c6; device c6–c11, 15 % maior | ✓ | ✓ | ✓ (herói c1–c6, device c6–c12) |
| 3 ou 4 cards (9:16) | — | cards mantêm a altura; a coluna começa no mesmo y e o device avança até c9 no espaço vazio de baixo | ✓ | — | — |
| `trust: []` | Z8 | herói, device e cards descem até 82 % H; CTA fica onde está | ✓ | ✓ | — |
| `cta.sub` | 2ª linha do botão | pílula com a mesma altura, `main` centrado na vertical | ✓ | ✓ | ✓ |
| `closing` | c8–c12 de Z9 | fica vazio (o desvanecer do herói); CTA **não** estica | ✓ | — | — |
| `product.kind: 'none'` | Z6 | herói c1–c8, 10 % maior | ✓ | ✓ | ✓ |
| `product.kind: 'laptop_screen'` | — | notebook 3/4 em c3–c8, 40–76 % H, atrás do braço do herói | ✓ | ✓ | ✓ |
| `product.kind: 'physical_product'` | — | produto em superfície, 3/4, c4–c8, sombra de contato | ✓ | ✓ | ✓ |
| `product.screenTitle` | título da tela | tela abstrata sem texto (anéis, barras, ícones) | ✓ | ✓ | ✓ |

### 4.1 Variante sem pessoa (`safe: true`)
- Sai o herói (Z5) inteiro. Entra uma **natureza-morta do `setting`**, sem gente e sem parte de corpo (nada de mão segurando o celular), mesma luz (`hero.light`). Ex.: abajur aceso na mesinha, cama desfeita, caneca.
- O device cresce 15 % e vai pra c2–c8; a natureza-morta fica atrás dele, desfocada (profundidade de campo rasa).
- Headline, cards, confiança, CTA: iguais. A emoção não some: ela passa pra luz e pro objeto (tabela §5, coluna "sem pessoa").

---

## 5. Emoção → expressão (`hero.emotion`, em inglês pro prompt)
Comum a todas: *realistic photo, natural skin texture, not stock-looking, adult, generic everyday clothes, person on the left edge facing into the frame, never looking at the text, no logos.*
| emoção | quando (`whyKey`) | rosto (olhos, sobrancelha, boca) | corpo e mãos | luz / câmera | sem pessoa (`safe`) | proibido |
|---|---|---|---|---|---|---|
| `pain` | hook | *eyes closed or squinting, brows drawn together and up, lips pressed or slightly parted in a wince* | *one hand pressed on where it hurts (lower back, neck or temple), shoulders hunched, sitting on the edge of the bed or chair* | *warm low lamp light, deep shadows, slightly high angle* | *unmade bed at night, single lamp, cold cup* | lágrima, choro, grito, sangue, curativo, aparelho médico |
| `curiosity` | hook | *head slightly tilted, one eyebrow raised a little, eyes focused on a phone screen, closed mouth* | *leaning in, phone held at chest height, thumb paused over the screen* | *screen glow on the face mixed with soft room light, eye level* | *phone face-up on a table lit by its own screen* | boca aberta de "choque", mão na boca, cara de thumbnail |
| `relief` | proof | *eyes softly closed or looking down, faint closed-mouth smile, relaxed brows, slow exhale* | *shoulders dropped, open hand resting on chest or lap, leaning back* | *soft morning window light, eye level* | *made bed with morning light across it, open curtain* | sorriso largo, pulo, braço pro alto |
| `pride` | proof | *direct eye contact with the camera, calm confident closed-mouth smile, chin level* | *upright posture, standing, arms relaxed or loosely crossed* | *clean side light, eye level or slightly low angle* | *neatly arranged space, object of the routine set up and ready* | punho fechado, troféu, músculo, pose de coach |
| `desire` | cta | *looking slightly past the camera toward something off-frame, soft hopeful half-smile, lips slightly parted* | *body leaning forward, one hand reaching or resting near the device* | *warm rim light from behind, golden tone, eye level* | *open door or window with warm light coming in* | sensual/sexualizado, olhar fixo sedutor |
Dois STATIC no mesmo lote = emoções diferentes (contrato §A2); o QA confere pela coluna "rosto".

---

## 6. Os 24 ícones em palavras (`StaticIcon`)
Estilo comum dos **cards**: *flat white line icon, rounded stroke ends, stroke about 8 % of the icon size, centered on a rounded-square tile filled with the accent color, tile corner radius about 22 % of its size, no text, no letters, no numbers, not any company logo.*
Estilo comum da **faixa de confiança**: o mesmo desenho, *white outline only, no tile*.
| id | descrição pro prompt | cuidado |
|---|---|---|
| `moon` | *a crescent moon opening to the right, with one small four-point star near its upper tip* | |
| `sun` | *a small circle with eight short evenly spaced rays* | |
| `clock` | *a circle with two hands showing ten past ten, small dot at the center* | sem números no mostrador |
| `calendar` | *a rectangle with two rings on top and a grid of six small squares (3 by 2)* | sem número de dia |
| `check` | *a single bold check mark, not inside a circle* | |
| `shield` | *a shield outline with a small check mark inside* | |
| `lock` | *a closed padlock with a rounded shackle and a round keyhole* | |
| `heart` | *a solid rounded heart* | |
| `star` | *a solid five-point star with slightly rounded tips* | não 5 estrelas (vira avaliação inventada) |
| `lightning` | *an outlined zigzag lightning bolt* | |
| `home` | *a house outline with a pitched roof and a small door* | |
| `phone` | *a plain smartphone outline in portrait with a short line near the bottom edge* | sem notch nem botão de marca |
| `chat` | *a rounded rectangle speech bubble with a tail at the bottom left and three dots inside* | nunca balão redondo com telefone (logo do WhatsApp) |
| `chart` | *three vertical bars rising from left to right with a thin upward arrow above them* | sem número |
| `money` | *a stack of three coins seen from the side* | sem símbolo de moeda (seria texto) |
| `gift` | *a box with a ribbon cross and a bow on top* | |
| `person` | *a simple person bust: a circle for the head over a half-oval for the shoulders* | |
| `people` | *two person busts, one slightly behind and to the right of the other* | |
| `play` | *a right-pointing triangle inside a circle* | não o logo do YouTube (retângulo vermelho) |
| `leaf` | *a single leaf tilted 45 degrees with a center vein* | |
| `target` | *three concentric circles with a small arrow stuck in the center* | |
| `book` | *an open book seen from the front, two pages curving down at the middle* | |
| `spark` | *a single four-point star with concave sides* | um só, nunca o trio de brilhos |
| `route` | *a dotted path curving from a small circle at bottom left to a map pin at top right* | |

---

## 7. `textCheck` na peça (o que o frontend implementa)
Vista: `IteratePiece.textCheck?: { status: 'ok'|'mismatch'|'skipped'; items: { expected; seen; critical }[] } | null`.

### 7.1 Onde aparece
| lugar | quando | o quê |
|---|---|---|
| Miniatura na grade (resultado do lote) | `mismatch` / `skipped` | chip no canto inferior esquerdo da miniatura: `mismatch` sem crítico = âmbar **"Text error"**; com crítico = vermelho **"Wrong text"**; `skipped` = neutro **"Not checked"**. `ok` = nada (sucesso não faz barulho). |
| Linha da peça (tela de geração) | durante o render | etapa real: "Generating image · ~90 s" → "Checking spelling · ~5 s" → (se refaz) "Found a typo in the CTA. New image 2 of 2 · ~90 s". |
| Preview (modal; tela cheia em 390) | sempre num STATIC | imagem grande à esquerda (o protagonista); à direita, painel **Text check** com o resultado. No 390 o painel vai **abaixo** da imagem, e as ações ficam numa barra fixa embaixo. |
| Cartão da pasta / zip | peça com `mismatch` ainda no zip | linha "1 piece has a text error" com link pra peça. |

### 7.2 Estados do painel
| estado | origem | cabeçalho | corpo | ações |
|---|---|---|---|---|
| **generating** | `status: rendering`, sem imagem | "Generating image" + tempo | efeito Image Generation no lugar da imagem (único lugar com efeito) | — (pode sair; a peça continua) |
| **checking** | imagem pronta, checagem em curso | "Checking spelling" | imagem já visível; lista com esqueleto de 3 linhas | — |
| **retaking** (auto) | erro crítico na 1ª imagem | "Typo in critical text. Making a new image (2 of 2)" | linha esperado × visto da 1ª imagem; custo "+US$ 0,40, within the monthly limit" (corrigido pelo arquiteto 25/10: o teto é mensal do workspace) | — |
| **ok** | `status: 'ok'` | "Text checked" (verde, discreto) | "All N texts match what was written." | — |
| **mismatch (menor)** | `mismatch`, nenhum `critical` | âmbar "1 text doesn't match" | lista esperado × visto; letra errada marcada | **Retry · US$ 0,40** (contorno) · **Leave out** (ghost) |
| **mismatch (crítico)** | `mismatch` com `critical` | vermelho "Wrong text in a critical block" + "We tried twice. This is the better of the two images." | críticos primeiro, com selo "Critical" | **Leave out** (ink, primária) · **Retry · US$ 0,40** (contorno) |
| **skipped** | `status: 'skipped'` | neutro "Spelling not checked" | "The checker was unavailable. Read the text before publishing." | **Check again** (grátis, só se a API expuser; senão nenhuma) |
| **cap reached** | Retry com teto estourado | — | Retry desabilitado + "Monthly spend limit reached (US$ 8.00 of 8.00). Raise it in Settings or leave this piece out." | **Leave out** |
| **left out** | `status: left_out` | "Out of the zip" | miniatura a 45 % de opacidade | **Put back** |

Linha do item: rótulo do bloco ("Handwritten strip"), selo "Critical" quando for, e duas linhas em mono-tabular:
`Expected  Sua manhã de volta.` (letra certa em verde)
`In image  Sua manhã de vólta.` (letra errada em vermelho, sublinhada)
`seen: null` = "Missing from the image". Diferença por caractere com o mesmo `compararTexto` (NFC; caixa, espaço e quebra ignorados; acento conta), feita no front só pra marcar.

### 7.3 Microcopy EN / PT-BR
| chave | EN | PT-BR |
|---|---|---|
| chip.minor | Text error | Erro no texto |
| chip.critical | Wrong text | Texto errado |
| chip.skipped | Not checked | Não conferido |
| panel.title | Text check | Conferência do texto |
| ok | All {n} texts match what was written. | Os {n} textos batem com o que foi escrito. |
| minor.head | {n} text doesn't match | {n} texto não bate |
| critical.head | Wrong text in a critical block | Texto errado em bloco crítico |
| critical.sub | We tried twice. This is the better of the two images. | Tentamos duas vezes. Esta é a melhor das duas imagens. |
| expected | Expected | Esperado |
| seen | In image | Na imagem |
| missing | Missing from the image | Não aparece na imagem |
| critical.badge | Critical | Crítico |
| retry | Retry · US$ {cost} | Refazer · US$ {cost} |
| retry.note | New image. Images with text errors are still charged. | Imagem nova. Imagem com erro também é cobrada. |
| leave | Leave out | Deixar de fora |
| putback | Put back | Voltar pro zip |
| cap | Monthly spend limit reached (US$ {spent} of {cap}). Raise it in Settings or leave this piece out. | Teto mensal de gasto atingido (US$ {spent} de {cap}). Aumente em Configurações ou deixe a peça de fora. |
| skipped.head | Spelling not checked | Grafia não conferida |
| skipped.body | The checker was unavailable. Read the text before publishing. | A conferência ficou indisponível. Leia o texto antes de publicar. |
| stage.gen | Generating image · ~{s} s | Gerando imagem · ~{s} s |
| stage.check | Checking spelling | Conferindo a grafia |
| stage.retake | Typo in critical text. New image 2 of 2 | Erro em texto crítico. Imagem nova 2 de 2 |

### 7.4 Componentes (shadcn)
| peça | componente | variante |
|---|---|---|
| chip na miniatura | `Badge` | custom `warn` / `bad` / `neutral` (tokens do mockup fase 2) |
| Preview | `Dialog` (desktop) / `Sheet side="bottom"` tela cheia (390) | já existe no Preview do AUTO |
| painel Text check | `Card` sem sombra, borda 1 px | — |
| linha esperado × visto | lista própria (`dl`), fonte mono | — |
| selo Critical | `Badge` `bad` | — |
| alerta do cabeçalho | `Alert` | `warn` / `destructive` / default |
| Retry / Leave out | `Button` | `outline` / `ghost` (menor); `default` ink / `outline` (crítico) |
| motivo do Retry desabilitado | texto visível abaixo do botão (não `Tooltip`: no celular não tem hover) | — |
| esqueleto da checagem | `Skeleton` | — |
| espera da imagem | efeito Image Generation (libraries.dev) | só aqui |

### 7.5 Responsivo
- **1440:** Preview = imagem à esquerda com altura da viewport − 120 px (9:16 inteiro visível, sem rolar), painel de 360 px à direita. Formatos 9:16 / 4:5 / 1:1 em `Tabs` acima da imagem.
- **390:** Preview em tela cheia; imagem na largura toda (o 9:16 rola junto com a página), painel abaixo, **barra de ações fixa** embaixo com `env(safe-area-inset-bottom)`: Leave out + Retry lado a lado, 44 px de altura. O chip da grade continua no canto da miniatura (2 colunas de miniaturas).
- Texto do item quebra linha; nunca corta (headline de 60 caracteres cabe em 2 linhas a 13 px).

### 7.6 O que o frontend precisa da API
| tela | já tem (contrato) | pedido novo (pro arquiteto) |
|---|---|---|
| grade / preview | `textCheck.status`, `items[].expected/seen/critical`, `status`, `retryHint`, `cost` | **`items[].key`** (bloco: `headline`, `cta.main`, `handwritten`…) pra mostrar "Handwritten strip". O `CheckStaticTextResult` já tem `key`; falta passar pra vista. Sem ele, o front mostra só esperado × visto. |
| linha em render | `status: rendering`, `pct` | **`stage?: 'image' \| 'text_check' \| 'retake'`** + `attempt` (1 ou 2). Sem ele, o front mostra "Generating image" o tempo todo. |
| Retry | `POST /iterate/pieces/:id/retry` | aceitar Retry em peça **READY com `mismatch`** (hoje só `failed`?), cobrar e passar pelo teto; resposta 409 `cap_reached` com `{ usedUsd, capUsd }` |
| Leave out / Put back | `POST /pieces/:id/leave-out` | o inverso (`put-back`) se ainda não existir |
| texto a mais | — | opcional: `extraText[]` na vista (o checador já devolve). Texto que a imagem inventou ("iOS E ANDROID") é o caso mais grave do "nada inventado" e hoje não aparece. Ver decisão G3. |

---

> Nota do arquiteto (25/10): o 409 `SPEND_CAP_EXCEEDED` é o **teto mensal do workspace** (`details: { spentUsd, capUsd, estimateUsd }`), não um teto do lote; textos acima corrigidos (`{spent}` = `spentUsd`).

## 8. Decisões que precisam do Gusta
- **G1. Peça com erro crítico entra no zip?** Recomendo **sai do zip por padrão** (estado `left_out`, com "Put back" um clique) quando o crítico continua errado depois das 2 tentativas; erro menor fica no zip com o chip âmbar. Hoje o contrato entrega `READY` nos dois casos.
- **G2. Retry custa US$ 0,40 e a imagem errada já foi cobrada.** Recomendo mostrar o preço no próprio botão ("Retry · US$ 0.40"), sem diálogo de confirmação.
- **G3. Mostrar texto que a imagem inventou** (`extraText`) na mesma lista, como crítico. Precisa o arquiteto pôr na vista; recomendo sim.
- **G4. CTA sobe de 87–95 % pra 84–90 % no 9:16** (D6). Fica um pouco mais apertado que o aprovado; a S2 confirma.
