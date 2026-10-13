# Variação automática de campeão · v1 sem créditos de vídeo: spec de UX/UI
Data: 2026-10-12 · Status: **aprovada pelo Gusta em 13/10** (respostas no §10)
Mockup navegável: https://claude.ai/artifact/D9F5BwAoxCUKTihuu95Rmv · fonte: `projects/maquina-anuncios/design/mockup-variacao-auto-v1.html` (atualize SEMPRE este arquivo, pra o link não mudar). A barra "Prototype" troca tela, estado e Desktop/Phone 390; ela não faz parte do produto.
Base: decisão de 12/10 em `decisions/log.md` ("variação de campeão vira automática e começa sem créditos de vídeo"), `brainstorms/2026-10-12-hookmill-variacoes-por-objetivo.md` (a "Revisão do Gusta" e o "Começo sem créditos" valem; as respostas 1, 2, 3 e 6 caíram), `reports/Variações de criativos campeões.md`, `design/catalogo-variacoes-criativo-2026-10-12.md`.
Pele e componentes: `fase2-telas-novas-2026-10-12.md` (tokens, FlowBar, InkPanel, SoonBadge, padrão de espera). **Esta spec substitui as telas Pick a winner / Breakdown / Plan / Batch do caminho 1** (`variar-campeao-2026-10-06.md` e o bloco "soon-plan" da fase 2). O teardown do código (`web/src/components/variar/teardown-step.tsx`, 12 seções, blocos hook/problem/mechanism/proof/cta) continua sendo o motor da análise; só deixa de ser uma tela.

> Dados do mockup (Mooncloth, custos, tempos) são exemplo. As miniaturas são arte de placeholder em CSS; no produto são frames reais da peça renderizada.

## 1. Problema
O "Iterate a winner" atual põe a decisão na mão do usuário: escolher tipos, quantidades, ganchos, revisar teardown. O Gusta decidiu (12/10) que a maioria nem sabe que o criativo é campeão nem lê métrica, então a plataforma tem que decidir sozinha. Ao mesmo tempo, a v1 não pode gastar crédito de vídeo: tudo sai de edição (Remotion) sobre o vídeo original. O risco de UX passa a ser outro: **confiança**. Se a pessoa só aperta Gerar, ela precisa entender em 10 segundos o que a IA viu e o que cada peça muda, senão o lote parece aleatório.

## 2. Decisões e porquê
1. **Uma tela, progressiva.** Subir (ou escolher da Library) → analisando → "Por que esse criativo funciona" → plano do lote → custo → **Gerar**. A tela cresce de cima pra baixo; nada de passos com Continuar. Porquê: não há nada pra pessoa decidir entre os passos, então passo separado seria só clique.
2. **FlowBar com 3 passos:** Plan (Analyze) → Make (Generate) → Ship (Download). Mesmo componente das fases; o caminho 1 passa de 6 pra 3 passos.
3. **A análise começa sozinha quando o upload termina**, sem botão. O custo (~US$ 0,06, placeholder) aparece **antes**, numa linha embaixo do dropzone ("A análise começa assim que o vídeo entra. Custa cerca de US$ 0,06"). Porquê: o botão "Analisar · US$ X" era uma pergunta; centavos não justificam a parada, mas a pessoa tem que saber antes.
4. **Cartão "Why this ad works" = 3 linhas fixas: HOOK, PROOF, CTA.** Cada linha diz o que é e embaixo, em cinza, de onde veio ("Brain › Audience: tried and gave up", "From the video"). Embaixo, a fileira **"Kept in every piece"** (pílulas lima-claro): é a promessa de que o que funciona não muda. Porquê: o "porquê" vira contrato visível, e a referência ao Brain mostra que a IA cruzou com o cliente.
5. **Plano em 2 grupos com os nomes do objetivo, não do jargão:** "Stretch its life" (iteração, tag neutra) e "New audience" (diversidade, tag tinta com texto lima). Cada linha = miniatura do tipo + **código da variável** (`CUT-15S`, o mesmo do nome do arquivo) + **uma frase da única coisa que muda**. Sem checkbox, sem stepper, sem remover. Porquê: o código casa a linha do plano, o arquivo no zip e a leitura no Ads Manager.
6. **Painel escuro THIS BATCH** mostra peças, divisão, arquivos, tempo e o custo em três linhas: Analysis "US$ 0,06 · done", Rendering "US$ 0,00", Video credits "None used". Uma ação lima por tela: **"Generate N pieces"** na barra de ação fixa (o painel não repete o botão).
7. **Meta desconectado = uma linha no rodapé do cartão do porquê:** "Metrics not used · connect Meta" + selo SOON neutro. Nada de bloco grande: hoje é o estado normal, não um alerta.
8. **Música é do Brain, não da tela.** Brain › Music guarda as faixas (opcional, uma vez por cliente). No plano, sem faixa, aparece uma linha discreta tracejada "No music variation: Brain › Music has no tracks · Add tracks". Com faixa, entra 1 linha `MUSIC-T1` no grupo Stretch. Porquê: mantém o "só aperta Gerar" e não esconde que a opção existe.
9. **Geração = a tela de lote da fase 2**, agrupada em Stretch / New audience. Linha: miniatura, código, status, a frase do que muda, e no render "9:16 · frame 250 of 810". Preview liberado nas prontas. Falha de uma peça não para as outras; Download libera com a falha (a peça fica fora até Retry).
10. **Resultado = grade + 2 cartões de pasta + zip.** Os cartões de pasta trazem a instrução de onde subir (§6). Cada miniatura abre o **Preview** (palco escuro, Variation | Original, a frase do que mudou, os 3 nomes de arquivo, pasta). O único ajuste depois de gerar é **"In zip"** por peça (tira uma peça ruim do zip). Porquê: "sem ajuste" vale antes de gerar; depois, deixar de baixar uma peça ruim é limpeza, não decisão.
11. **Tudo vai pra Library sozinho** como variação do campeão (`sourceCreativeId` + `variationType` = código). O alerta de download confirma.
12. **Formatos não contam.** Toda peça sai em 9:16, 4:5 e 1:1 na mesma pasta; o plano diz isso uma vez no rodapé.

## 3. Tokens
Os mesmos de `fase2-telas-novas-2026-10-12.md` §3, sem token novo. Duas notas:
- **Iteração × diversidade** reusa tags existentes: `t-neutral` (Stretch) e `t-ink` (New audience). Não é status, então não usa verde/âmbar/vermelho/azul.
- **`code`** (novo estilo, não token): mono 12 px 600, fundo `--card-2`, borda `--line-soft`, raio 6. Usado em todo lugar que aparece o código da variável.
- Cores dentro das miniaturas (`.tf`) são dado de vídeo, não UI. A fonte de mão do tipo NATIVE-HAND (Caveat no mockup) é asset do template Remotion, não do app.

## 4. Telas e estados
Rotas sugeridas: `/iterate/new` (tela única), `/iterate/:batchId` (geração e resultado na mesma rota; a FlowBar muda pelo status do lote).

### 4.1 Analyze (tela única)
| Estado | O que aparece |
|---|---|
| **empty** | Dropzone (MP4/MOV, 500 MB, 3 min) + "Or pick from your Library" (3 últimos vencedores, "Use this") + linha do custo da análise + bloco SOON "Pick from Meta" em uma linha. Gerar desabilitado. |
| **uploading** | Linha do arquivo com %, MB, tempo restante, Cancelar. "A análise começa sozinha." |
| **analyzing** | Cartão do vencedor com os blocos aparecendo (Hook, Problem… "reading… frame 412 of 960"); cartões do porquê e do plano em esqueleto (miniaturas com Image Generation). Painel escuro com beam: "2/3 steps", barra, checklist real **Reading the video** (transcrição, cortes, blocos, melhor frame) → **Checking against the Brain** (público, oferta, prova, página) → **Planning the batch**, "about 40 s", "You can close this page", Back to Home. |
| **ready** | Cartão do vencedor (miniatura, fatos, faixa de blocos; blocos preservados em lima-claro) → Why this ad works → The batch → painel THIS BATCH → barra "11 pieces · 33 files · about 4 min · no video credits" + **Generate 11 pieces**. |
| **ready + music** | Igual, com a linha `MUSIC-T1` no Stretch e sem a linha "No music variation". |
| **no Brain** | Alerta âmbar: "Mooncloth's Brain is empty, so this read comes from the video alone" + o que mudou no plano (layouts que dependem de página/review trocados) + "Open the Brain". Tag "Video only" no cartão; as referências viram "From the video". **Não bloqueia.** |
| **short video** (sem blocos claros) | Alerta âmbar: "7 seconds and one continuous shot, so there are no blocks to cut, reorder or open on." Faixa de blocos vira um bloco só. O plano usa só texto, legenda, layouts e estático. **Não bloqueia.** Abaixo de 4 s ou sem nenhum frame utilizável = erro (abaixo). |
| **analysis failed** | Alerta vermelho com o motivo humano e a correção ("The file stops playing at 0:11 of 0:32 … export it again"), "Nothing was charged", ações Upload another file / Try again. Painel escuro mostra onde parou (✕ vermelho-claro na etapa, detalhe técnico em mono). Outros motivos previstos: vídeo abaixo de 4 s, formato não suportado, arquivo acima do limite, falha da IA (retry). |

Carregando a tela (sem dado ainda): `Skeleton` no mesmo layout.

### 4.2 Generate (lote)
| Estado | O que aparece |
|---|---|
| **in progress** | Título "Rendering 11 pieces · 6 ready", grupos Stretch/New audience, linha com beam e Image Generation na miniatura só quando renderizando, % e "formato · frame X of N". Painel escuro: "6/11", barra, Now (códigos em render), tempo, arquivos X de 33, "Video credits: None used", pode fechar. Continue desabilitado. |
| **one failed** | Alerta vermelho no topo ("LAYOUT-SPLIT-LP failed. The other 10 keep going.") + motivo na linha antes da ação: "The product page didn't load: mooncloth.com blocked our browser (403). Retry with the product photo from the Brain, or leave this piece out." Ações **Retry with photo** (tinta) / **Leave out**. Retry não custa nada. Continue liberado (a peça fica fora). |
| **all ready** | Alerta verde "11 of 11 ready in 4 min 40 s · $0.06 spent in total". Continue to download. |

### 4.3 Download (resultado)
| Estado | O que aparece |
|---|---|
| **ready** | Título "11 pieces, ready to upload" → 2 cartões de pasta com instrução → filtro All / Stretch / New audience → grade (2 colunas no celular) com miniatura + play, código, frase, tag do grupo, "In zip" → barra "11 pieces · 33 files · 212 MB" + Home + **Download zip**. |
| **preview** | Modal (no celular, tela cheia): palco escuro com o player grande e Variation | Original; ao lado, nome do tipo, "The one thing that changed", os 3 nomes de arquivo, pasta, "Leave out of zip" e "Edit in video" (abre o editor v1 só pra essa peça). |
| **downloaded** | Alerta verde com o nome do zip e "All 11 are in the Library as variations of …". |

### 4.4 Brain › Music
| Estado | O que aparece |
|---|---|
| **empty** | Aba Music no Brain. Cartão "Music for variations · Optional" com a regra, dropzone (MP3/WAV/M4A, 20 MB, até 10 faixas), checkbox de licença "Mooncloth has the rights to use these tracks in paid ads" (precisa marcar pra subir; "HookMill doesn't check licenses"). "No tracks yet. Batches from Mooncloth won't include a music variation." |
| **uploading** | Faixa nova com barra de % e Cancelar. |
| **with tracks** | Lista: play, nome, onda, duração, "Calm · 72 BPM" (detectado), remover. Painel escuro: 1 variação de música por lote, escolhe a faixa pelo andamento, voz fica por cima, tag `MUSIC-T1`. |

### 4.5 Library e Home
Sem tela nova. Home › Waiting for you ganha os itens "Plan ready" (análise pronta esperando o Gerar) e "N pieces ready". Na Library, "Vary" em todo card abre a tela única já no estado analyzing.

## 5. Catálogo dos tipos v1 (pro maquina-video) e regra de quando a IA aplica
Cada tipo muda **uma** coisa sobre o vídeo original. No mockup, tela "Catalog of v1 types", cada um tem um quadro 9:16.
**Diversidade** = muda o primeiro frame/visual (o que a Meta compara). **Iteração** = mesmo visual, edição diferente.

| Código (EN / PT) | Tipo | Eixo | O que faz | A IA aplica quando | Precisa |
|---|---|---|---|---|---|
| `CUT-15S` / `CORTE-15S` (e `-20S`) | Corte por bloco | Iteração | versão curta com blocos inteiros: gancho, prova, CTA; nunca corta no meio da frase | vídeo ≥ 25 s e ≥ 4 blocos; 15 s primeiro, 20 s se a prova pedir | blocos do teardown |
| `COLD-OPEN` | Cold open | Iteração | o momento mais forte (prova, reação) vai pro segundo 0, depois o vídeo do início | existe prova/reação visual depois de 0:05 mais forte que o frame de abertura | blocos |
| `ORDER-PROOF-1ST` / `ORDEM-PROVA-1` | Ordem dos blocos | Iteração | mesmos clipes e falas em outra ordem | prova vem depois do problema e há ≥ 4 blocos | blocos |
| `PACE-FAST` / `RITMO-RAPIDO` | Ritmo | Iteração | tira pausas e respiros, jump cut; não acelera a voz | silêncio soma ≥ 2 s ou fala < 2,3 palavras/s | transcrição com tempo |
| `HOOK-TEXT-2` / `GANCHO-TEXTO-2` | Gancho escrito na tela | Iteração | headline nova nos 3 primeiros segundos; voz igual | sempre 1 por lote; 2 se o original não tem gancho escrito | análise (Claude) |
| `CAPTION-BOX` / `LEGENDA-CAIXA` | Estilo de legenda | Iteração | caixa, karaokê, tamanho, posição | original sem legenda, legenda fraca ou dentro da zona da UI do Reels; no máx. 1 | transcrição |
| `ENDCARD-60N` / `ENDCARD-GARANTIA` | End card / oferta | Iteração | cartão de 2 s no fim com oferta/garantia/preço | Brain tem oferta ou garantia e o original não tem end card (sem Brain: usa o CTA falado) | Brain › Offer |
| `MUSIC-T1` / `MUSICA-T1` | Música | Iteração | faixa do Brain sob a voz, áudio original abaixado | **só se** Brain › Music tem faixa; 1 por lote, faixa com andamento compatível | faixas do cliente |
| `NATIVE-SEARCH` / `NATIVO-BUSCA` | Gancho nativo · busca | Diversidade | abre numa barra de busca digitando o problema | o gancho nomeia um problema que se pesquisa | análise |
| `NATIVE-DM` / `NATIVO-DM` | Gancho nativo · DM | Diversidade | abre num chat: amiga pergunta, criador responde com o gancho | gancho é confissão ou história pessoal | análise |
| `NATIVE-NOTES` / `NATIVO-NOTAS` | Gancho nativo · notas | Diversidade | abre numa nota do celular com lista curta | gancho é lista, contagem ou passos | análise |
| `NATIVE-HAND` / `NATIVO-MAO` | Gancho nativo · escrita à mão | Diversidade | número ou afirmação escrita à mão no papel | gancho carrega um número/afirmação forte | análise |
| `LAYOUT-SPLIT-LP` | Layout · split com página | Diversidade | metade de cima: página ou foto do produto; embaixo: o vídeo | Brain tem URL da página ou foto do produto | Brain › Product |
| `LAYOUT-PIP` | Layout · picture-in-picture | Diversidade | página do produto em tela cheia, criador numa janela no canto | talking head e Brain com página/foto | Brain › Product |
| `LAYOUT-STORY` | Layout · moldura de story | Diversidade | vídeo dentro da moldura de story (barras, campo de resposta) | sempre disponível; entra quando o lote ainda precisa de visual novo | nada |
| `LAYOUT-POST` | Layout · moldura de post | Diversidade | vídeo como post do feed (cabeçalho, curtidas); pensado pra 4:5 | sempre disponível; preferido ao story com vídeo calmo e longo | nada |
| `LAYOUT-REVIEW` | Layout · fundo com review | Diversidade | review real em cima, vídeo embaixo | Brain tem review ou depoimento | Brain › Proof |
| `STATIC-F1` / `ESTATICO-F1` | Estático | Diversidade | o frame mais forte + 1 headline, imagem PNG | sempre 1 por lote, do momento da prova se houver | análise |
| `_9x16 _4x5 _1x1` | Formatos | **não é variação** | toda peça nos três, legenda e layout reposicionados | sempre | — |

**Regras do lote (a IA segue):**
1. 8 a 12 peças. Pelo menos 40% diversidade. Prioridade dentro da diversidade: layouts fixos e estático, depois gancho nativo.
2. Uma variável por peça. Nunca dois tipos na mesma peça.
3. O que está em "Kept in every piece" não muda em nenhuma peça (ex.: o gancho falado nunca sai num corte).
4. Um tipo que depende do Brain sem o dado no Brain é trocado por um que não depende (story/post/notas), e o alerta "no Brain" diz isso.
5. Com Meta conectado (futuro): as métricas mudam a mistura (ex.: hook rate caindo → mais gancho nativo e cold open). Sem Meta, são ignoradas.
6. Cada linha do plano é gerada junto com a análise (é a "frase do que muda" que vai pra tela, pro preview e pro `README.txt` do zip).

## 6. Nomes de arquivo e zip
- **Arquivo:** `CLIENTE_MMDD_CODIGO_FORMATO.ext` → `MC_1012_CUT-15S_9x16.mp4`, `MC_1012_LAYOUT-SPLIT-LP_4x5.mp4`, `MC_1012_STATIC-F1_1x1.png`. Quando o lote tem duas do mesmo tipo, o número vai no código (`HOOK-TEXT-2`, `HOOK-TEXT-3`).
- **Idioma do código:** segue o idioma do **conteúdo da oferta** (oferta em inglês → `CUT-15S`; em português → `CORTE-15S`), como os roteiros. Tabela EN/PT no §5. A regra mora na API.
- **Zip:** `MC_1012_<SLUG-DO-CAMPEAO>_variations.zip` com:
  - `1-stretch-its-life/` (PT `1-esticar-a-vida/`) → **conjunto de teste do mesmo conceito, separado do conjunto do campeão**, que segue rodando. Variação nova no conjunto do campeão quase não recebe entrega; a que ganhar migra pro conjunto principal.
  - `2-new-audience/` (PT `2-publico-novo/`) → **conjunto novo**, todas as peças juntas.
  - `README.txt` em cada pasta com a instrução acima e a lista "arquivo → o que mudou".
- Os 3 formatos de cada peça ficam na mesma pasta.

## 7. Componentes
| Peça | shadcn / próprio | Nota |
|---|---|---|
| Shell, sidebar, FlowBar, ActionBar, InkPanel, StatusChip, SoonBadge, Alert, Sonner | os da fase 2 | FlowBar com 3 passos |
| Upload | `VideoDropzone` (já existe em `variar/upload.ts`) + `Progress` | some depois do upload; vira o cartão do vencedor |
| Escolher da Library | lista de `Button` outline "Use this" | |
| Cartão do vencedor | `Card` + miniatura + fatos em mono + **`BlockStrip`** (versão compacta do `BlockTimeline`, só leitura, blocos preservados em `--accent-soft`) | |
| Por que funciona | **`WhyCard`** (`Card` + `ul` de 3 linhas rótulo/texto/referência + pílulas "Kept") | rodapé com SoonBadge do Meta |
| Plano | **`BatchPlan`** (`Card` com 2 `PlanGroup`; cada `PlanRow` = `TypeThumb` + `code` + frase) | só leitura |
| Linha "sem música" | texto + `Button` variant link | |
| Espera da análise | InkPanel com `BorderBeam` + `Checklist` (já em `components/fx`) + `Skeleton` nos cartões + `ImageGeneration` nas miniaturas do plano | |
| Lote | `SceneRow` da fase 2 com `code` | |
| Resultado | `ToggleGroup` (filtro), grade de **`PieceCard`** (`Card` + `TypeThumb` + `Checkbox` "In zip"), 2 **`FolderCard`** | |
| Preview | `Dialog` (desktop) / `Sheet` side="bottom" em tela cheia (≤760 px) + `VideoPlayer` + `ToggleGroup` Variation/Original | |
| Brain › Music | `Tabs` do Brain + dropzone de áudio + `Checkbox` de licença + lista de faixas | |
| `TypeThumb` | próprio; no produto é o poster da peça; no plano (antes do render) é o ícone ilustrativo do tipo, igual aos quadros do catálogo | |

## 8. Responsivo
- **≤ 900 px:** o painel escuro desce pra baixo do plano (deixa de ser sticky).
- **≤ 760 px:** sidebar vira topo escuro; FlowBar compacta "Step N of 3" + 3 segmentos; barra de ação fixa na base, com o Generate ocupando a largura; o porquê empilha rótulo sobre o texto; a faixa de blocos esconde os tempos; linhas do lote passam a ação pra baixo; a grade do resultado fica em 2 colunas; o preview vira tela cheia.
- **Celular completa tudo:** subir pelo input file (abre a galeria), esperar, Gerar, preview, Download zip e Brain › Music. Veja "Phone 390" no mockup.

## 9. O que o frontend precisa da API
| Tela | Leitura | Escrita | Tempo real |
|---|---|---|---|
| Analyze | `GET /library?winners` (3 últimos); `GET /iterate/analysis-estimate` → custo da análise | `POST /uploads` (URL assinada); `POST /iterate {source: upload\|creative, uploadId?, creativeId?}` → cria o lote e **já começa a análise** | etapa (`reading\|brain\|planning`), %, frame X/N, blocos parciais, ETA; erro com `reason` humano + `detail` técnico + `charged:false` |
| Analyze (pronto) | `GET /iterate/:id` → `source {duration, ratio, res, cuts}`, `blocks[{fn,start,end,kept}]`, `why[{key: hook\|proof\|cta, text, ref, refSource: brain\|video}]`, `kept[]`, `plan[{code, type, axis: iteration\|diversity, change}]`, `flags {brainEmpty, shortVideo, metaConnected}`, `cost {analysis, render: 0}`, `etaMin`, `fileCount` | `POST /iterate/:id/start` | — |
| Generate | `GET /iterate/:id` → `pieces[{id, code, axis, change, status: queued\|rendering\|ready\|failed\|left_out, pct, format, frame, frames, reason, retryHint}]` | `POST /pieces/:id/retry {useProductPhoto?}`, `POST /pieces/:id/leave-out` | SSE por peça |
| Download | `pieces[].files[{format, name, url}]`, `posterUrl`; `GET /iterate/:id/zip?exclude=…` → URL assinada + `fileName` + tamanho | `PATCH /pieces/:id {inZip}` | — |
| Brain › Music | `GET /clients/:id/brain/music` → `tracks[{id, name, duration, bpm, mood, url}]` | `POST /uploads` + `POST …/music {uploadId, licenseConfirmed: true}`, `DELETE …/music/:id` | progresso do upload |

Regras que a UI assume: nomes de arquivo, código e pasta saem da API (iguais na tela, no zip e no README). Toda peça é um `Creative` com `sourceCreativeId` e `variationType = code`, salvo na Library ao ficar pronto. O lote sobrevive a sair da tela. Peça falha não invalida as outras. Layout fixo **não** usa o `KIND_NOT_ENABLED` (aquele era remix do texto queimado); é um template Remotion novo.

## 10. Pendências pro Gusta — respondidas 13/10: 1–5 OK; 6 = corte mínimo de 9 tipos
1. **Análise automática no upload** (sem botão), com o custo dito antes, numa linha. Ok?
2. **"In zip" depois de gerar** como único ajuste (tirar peça ruim do zip). Ou nem isso?
3. **Código do arquivo no idioma da oferta** (`CUT-15S` em EN, `CORTE-15S` em PT). Ou um vocabulário só?
4. **Tamanho do lote:** 8 a 12 peças, ≥ 40% diversidade, 1 música no máximo. Ok como regra fixa da IA?
5. **Peças salvas sozinhas na Library** como variação do campeão (sem passo de aprovar uma por uma).
6. Os 18 tipos do catálogo como escopo do maquina-video na v1 (ou cortar: sugestão de corte mínimo = CUT, COLD-OPEN, HOOK-TEXT, ENDCARD, SPLIT-LP, STORY, REVIEW, NATIVE-SEARCH, STATIC).
