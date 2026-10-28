# Format Remix (variação de formato com IA) · spec de UX/UI
Data: 2026-10-28 · Status: **mockup pra o Gusta ver; nada aprovado** (Q1–Q13 de 27/10 seguem provisórias até ele ver) · Dono: maquina-design
Mockup navegável: https://claude.ai/artifact/2Y1Pc8MZrMuT4rGhURwH9h · fonte `design/mockup-remix-formato.html` (atualize SEMPRE este arquivo, pra o link não mudar). Barra "Prototype": estado de cada tela, recomendação "From analysis / With Meta results" (Q13) e Desktop / Phone 390 (`#phone` no link abre no celular). Não faz parte do produto.
Base: `brainstorms/2026-10-27-hookmill-variacoes-de-formato-ia.md` (Q1–Q13), `reports/variacao-de-formato-com-ia-e-precos-2026-10-27.md`, `design/campanhas-v1-2026-10-22.md` (shell e tokens). **Mesma pele do app:** tema claro com sidebar escura (decisão 12/10), lima como único acento, cor só pra status. Preço não decidido: todo custo aparece como "X credits".

> Dados do mockup (Mooncloth, "I tried 11 sleep masks", CPA, roteiros) são exemplo.

## 1. Problema
Um vencedor cansa e iterar no mesmo formato (gancho, rosto) rende cada vez menos. O HookMill precisa pegar o que vende no vencedor e reconstruir em outro formato (review → podcast, DM, descoberta…). Como agora cada formato custa geração paga, a pessoa precisa entender por que cada formato foi sugerido e aprovar o que vai rodar antes de gastar.

## 2. Decisões e porquê
1. **Item novo na sidebar "Remix format" (selo NEW), em MAKE ADS, entre Iterate e New concepts.** Iterate = mesmo formato, outra alavanca. Remix = outro formato. Separar evita que a pessoa ache que Iterate já faz isso. Também abre pelo botão "Remix format" do card na Library (lima no Winner, outline nos outros; imagem desabilitada com "Remix works on video ads").
2. **Trilho de 5 passos fixo no topo** (Why it sells · Formats · Approve · Generate · Pieces), com faixa do anúncio de origem (miniatura, gasto, CPA, hook rate, "Change"). Passos já visitados são clicáveis; durante a geração o trilho trava.
3. **Why it sells = 5 linhas** (Hook type, Angle, Proof, Persona, Current format). Cada linha tem a frase forte (editável no clique), 1 linha de detalhe e a evidência em mono à direita ("video 0:09–0:22", "Brain · Audience"). Embaixo, dois blocos: **Stays the same** (ângulo, promessa, prova, oferta, CTA, com cadeado) e **Gets rebuilt** (roteiro, nº de pessoas, cenário, avatar). Frases fixas: "No testimonial, number or case that isn't in the ad or the Brain." e "The product is never generated: its shots come from the original ad." (Q2, Q8).
4. **3 cards de formato, cada um com "Because …" ligado a uma linha da análise.** O link "↑ From: Proof" acende a linha correspondente na coluna esquerda (a análise fica visível ao lado dos cards no desktop). Cada card: classe, pessoas, "1 video + 2 hooks · 9:16, 4:5, 1:1", custo "X credits" + indicador de custo relativo (3 barrinhas: programático 1, 1 pessoa 2, 2 pessoas 3) e botão **Swap**. Barra preta fixa embaixo: "3 formats · 9 pieces · Total X credits · Nothing is charged until you approve each script."
5. **Cardápio do Swap = Dialog com abas por classe:** Programmatic (Chat/DM, Us vs them, Green screen on a screenshot, 3 reasons list) · 1 person (Discovery, Storytime, Green screen, Reaction to your ad, **Specialist travado**) · 2 people (Podcast **Beta**, Street interview **Wave 2** desabilitado) · Avatar (New person + setting + persona; Face swap only, a mais barata). Travado mostra o porquê em âmbar ("Locked for health offers. Mooncloth is tagged Sleep & wellness in the Brain…"). Formato já usado em outro espaço aparece "In use".
6. **Com Meta (Q13):** alerta verde "Ranked with your Meta results" e, no card que já vendeu, chip "Sold before" + a linha do número ("Chat/DM ads cost $14.80 per purchase vs $21.10 average"). Sem Meta: alerta azul "Recommended from the analysis only".
7. **Approve = abas por formato** (check verde quando aprovado). Coluna esquerda: foto do avatar no cenário (2 quadros Host/Guest no podcast; prévia do chat no programático, "No person"), botões **New face / New script** e contador "2 of 3 free swaps left". Acabou: texto âmbar "Free swaps used. Next swap costs X credits." Coluna direita: **Hooks primeiro** (ordenados pela nota do Jev, barra + número; abaixo de 70 a barra fica âmbar; gancho com risco tem borda âmbar e "Policy risk. Health claim…" e começa desmarcado). Escolhe 3: o 1º abre o vídeo completo, os outros 2 viram "Alternative opening B/C". Depois o **roteiro cena a cena** (tempo, falante, fala editável, plano/visual e etiqueta verde de origem "Insert: mask in hand (original 0:14)", "Offer: 60-night trial (Brain · Offer)"). Botão "Approve this format" por formato; o "Generate 9 pieces" só habilita com todos aprovados e é o único que cobra.
8. **Generate = 1 card por formato com Border Beam**, barra de progresso, % e a lista de etapas reais (podcast: voz ×2, gerar host e convidado, lipsync host, lipsync convidado, corte plano/contraplano, render 3 tamanhos), "≈ N min" na etapa atual. "Go to Home" pra sair. Falha: card vermelho com a etapa que parou, "Finished steps are saved. Retrying is free." e "Retry this step".
9. **Pieces = agrupado por formato, 3 peças por grupo**, cada uma com etiquetas mono: FORMATO · HOOK A/B/C · FULL VIDEO / SAME BODY. Seletor 9:16 / 4:5 / 1:1 no cabeçalho troca todas as miniaturas. Clique abre o **player grande** (fundo preto, vídeo no centro, painel lateral com formato, variável, origem, duração, nome do anúncio `MC·REMIX·PODCAST·HB`, Send to Meta, Adjust, Download). Cabeçalho: "Send to Meta (9)" e ZIP.
10. **Chat lateral "Ask HookMill"** (coluna de 380 px que empurra o conteúdo no desktop; bottom sheet de 88 % no celular). Duas portas pro mesmo motor (Q6):
    - *Pedido livre:* sugestões em chips ("Turn this review into a podcast with a 40-year-old woman"). Resposta mostra etapas reais enquanto pensa ("Reading the original ad… Matching the request to a format… Writing the script and pricing it…") e devolve um **cartão de plano** (formato, host, guest, roteiro, gancho 1, o que foi mantido, o que recebe, X credits, "Change something" / **Approve plan**). Aprovar leva pro passo Approve com aquele formato; nada é cobrado ali.
    - *Ajuste de peça:* "Adjust" na peça abre o chat com o contexto (chips PODCAST · HOOK B). Resposta = cartão antes/depois + "Regenerates only the 4-second opening" + X credits + Apply. A peça mostra spinner "Updating the opening…" até voltar.
    - Rodapé fixo: "Nothing generates until you approve the plan and its cost."
    O chat é a 2ª porta; o cardápio continua sendo a padrão. A sidebar já reservava "Eddy" pra chat; no mockup o item virou "Chat". Nome a decidir (ver §8).

## 3. Tokens
Sem token de marca novo. Herdados de `campanhas-v1` (`--bg`, `--card`, `--ink*`, `--accent*`, `--ok/warn/bad/info*`, Archivo + IBM Plex Mono, raios 8/10/12/16/18). Novos derivados: `--warn-text #4A3100`, `--bad-text #5E1E06`, `--info-text #1D2F7A` (eram literais nos alertas), `--shadow rgba(21,23,26,.16)`. Etiqueta de variável (HOOK B) = `--accent-soft` + `--accent-ink` + borda `--accent-edge`, mono 10 px (mesma receita do chip HOOKMILL).

## 4. Componentes (shadcn)
| Peça | shadcn / próprio | Nota |
|---|---|---|
| Trilho de passos | próprio `FlowRail` (lista de `Button` pill) | `aria-current="step"`; feito vira check tinta+lima |
| Faixa de origem | próprio `SourceAdStrip` | some os KPIs < 760 px |
| Why it sells | próprio `WhyList` (`ol`) | linha editável (`contentEditable` ou `Input` inline); `hl` quando um card aponta pra ela |
| Card de formato | `Card` + `Badge` + `Button` outline | `CostTier` próprio (3 barras) |
| Cardápio | `Dialog` (desktop) / `Drawer` (celular) + `Tabs` | item = `Button` grande; travado `aria-disabled` + texto do motivo |
| Abas de aprovação | `Tabs` | check no trigger |
| Ganchos | `Toggle` em lista (multi, máx. 3) + `Progress` | ordem fixa por nota; risco = `Alert` âmbar inline |
| Roteiro | próprio `SceneList` | fala editável; `Badge` verde de origem |
| Geração | `Card` + `Progress` + lista de etapas + Border Beam | Beam só aqui e no "pensando" do chat (Thinking Orbs) |
| Peças | `Card` + `AspectRatio` + `ToggleGroup` 9:16/4:5/1:1 | |
| Player | `Dialog` full / `Drawer` no celular | vídeo protagonista, sem nada por cima além da legenda |
| Chat | `Sheet side="right"` não modal (desktop, ocupa coluna) / `Drawer` (celular) + `Textarea` | cartões de plano e de antes/depois são componentes, não markdown |
| Barra de total | próprio `SummaryBar` sticky bottom, fundo `--ink` | |

## 5. Estados por tela
- **Library:** pronto · carregando (skeleton de 4 cards) · vazio ("No winners to remix yet" + Connect Meta / Mark a winner).
- **Why it sells:** analisando (Thinking Orbs + Beam, 5 etapas reais, "≈ 25 s left") · erro ("We couldn't read this video. The file from Meta expired… Nothing was charged." + "Fetch the video again") · pronto.
- **Formats:** escolhendo (3 cards skeleton com Beam, botão desabilitado) · pronto · pronto com Meta.
- **Approve:** pronto · trocando rosto/roteiro (spinner no botão, prévia esmaecida com Beam, aprovação do formato desfeita) · trocas grátis esgotadas · rosto falhou ("Nothing was charged and this swap doesn't count" + Retry).
- **Generate:** rodando (progresso por formato) · uma etapa falhou (Retry grátis) · terminou (botão "View pieces").
- **Pieces:** tudo pronto · parcial (formato com "Rendering 4:5 and 1:1 · ≈ 2 min") · peça atualizando após ajuste.
- **Chat:** vazio com sugestões · pensando (etapas) · plano · antes/depois · confirmação.

## 6. Responsivo (390 px)
Sidebar vira barra superior com botão de chat + menu. Why it sells: análise em cima, cards embaixo, uma coluna. Linhas do Why empilham (rótulo, frase, evidência). Approve: avatar em cima, ganchos, roteiro; a nota do gancho desce pra baixo do texto. Barra de total ocupa a largura com o botão inteiro. Peças em 2 colunas. Cardápio, player e chat viram bottom sheet. Com o chat aberto entre 761 e 1240 px, a sidebar encolhe pra ícones (72 px) e os cards viram 1 coluna.

## 7. O que o frontend precisa da API
| Tela | Precisa |
|---|---|
| Library | `GET /library?winner=true&type=video` com veredito, CPA, compras, hook rate, duração, thumbnail |
| Why it sells | `POST /remix` {creativeId} → `remixId`; `GET /remix/:id` com `analysis.status` + `steps[]` e as 5 linhas {key, value, detail, evidence}; `PATCH` da linha editada; `keeps[]`/`changes[]` |
| Formats | `recommendations[3]` {formatId, reasonKey, reasonText, learned?{cpa, avgCpa, n}}; `GET /formats` (catálogo) com {class, people, costCredits, tier, locked?{reason}, beta, wave}; `PUT /remix/:id/slots` |
| Approve | por formato: `script.scenes[]` {tc, dur, lines[{speaker, text}], visual, source?}, `speakers`, `hooks[]` {text, jevScore, policyRisk?}, `avatarPreview[]` (URL por pessoa), `freeSwapsLeft`; `POST …/face`, `POST …/script` (assíncronos, devolvem status); `PATCH` de fala; `POST …/approve`; `POST /remix/:id/generate` (único que debita, devolve custo final) |
| Generate | `GET /remix/:id/jobs` por formato: {steps[], current, pct, etaSec, error?{step, retryable}}; `POST …/retry`; notificação/badge no Review ao fim |
| Pieces | `pieces[]` {formatId, variable: hookA/B/C, isFull, renders{916,45,11}: url, status, adName}; ZIP; Send to Meta com etiquetas |
| Chat | `POST /remix/chat` {text, context: remixId? pieceId?} → stream de etapas + `plan` {formatId, speakers, outline, hook1, kept, costCredits} ou `diff` {before, after, scope, costCredits}; `POST …/plan/approve` (cria slot, não cobra); `POST …/adjust/apply` (cobra) |

## 8. O que precisa do OK do Gusta
1. Remix como item próprio na sidebar (não dentro de Iterate).
2. Ganchos acima do roteiro na aprovação, com 3 escolhidos e o arriscado desmarcado por padrão.
3. Cobrança só no "Generate 9 pieces" (aprovar formato e aprovar plano no chat não cobram).
4. Chat como coluna que empurra o conteúdo, e o nome dele ("Ask HookMill" no mockup; antes estava reservado "Eddy").
5. Indicador de custo relativo (barrinhas) enquanto o preço não existe.
