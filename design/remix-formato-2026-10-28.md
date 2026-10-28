# Iterate a winner com Remix e quiz · spec de UX/UI
Data: 2026-10-28 (v2, mesma data) · Status: **mockup pra o Gusta ver; nada aprovado.** A4 e A5 do teste manual (`testes/teste-manual-gusta-2026-10-28.md`) são provisórios até ele ver. As Q1–Q13 de 27/10 também seguem provisórias. · Dono: maquina-design
Mockup navegável: https://claude.ai/artifact/2Y1Pc8MZrMuT4rGhURwH9h · fonte `design/mockup-remix-formato.html` (atualize SEMPRE este arquivo, pra o link não mudar). A barra "Prototype" tem o estado de cada tela, **Batch: First / Next** (o 2º lote abre com as respostas salvas), **Ranking: Analysis only / With Meta** e **Desktop / Phone 390** (`#phone` no link abre no celular). A barra não faz parte do produto.
Base: tela atual do Iterate (`web/messages/en.json` › `iterate.analyze` / `generate` / `download`), `design/variacao-auto-v1-2026-10-12.md`, `brainstorms/2026-10-27-hookmill-variacoes-de-formato-ia.md` (Q1–Q13) e `design/campanhas-v1-2026-10-22.md` (shell e tokens). **Mesma pele do app:** tema claro com sidebar escura (decisão de 12/10), lima como único acento, cor só pra status. Preço não decidido: custo de IA aparece como "X credits"; estático segue "~$0.40" como no produto.

> Os dados do mockup (Mooncloth, "I tried 11 sleep masks", CPA, roteiros) são exemplo. Os códigos de peça seguem o padrão do produto (HEADLINE-1, NATIVE-SEARCH, STATIC-F1, FRAME-QUESTION-BOX…).

## O que mudou nesta versão (A4 + A5)
1. **Saiu o item "Remix format" da sidebar.** Tudo acontece dentro de "Iterate a winner". O remix de formato e a troca de avatar viram o 3º bloco do lote.
2. **Quiz de 3 perguntas** entre o vencedor e o plano: uma pergunta por tela, todas puláveis, "Let HookMill choose" marcado por padrão.
3. **As respostas viram "Client preferences"** na tela do plano e voltam pré-marcadas no próximo lote do mesmo cliente (selo "Saved", botão "Use saved answers").
4. **O lote ganha o bloco "With AI · uses credits"**, opt-in, liberado pela pergunta 2.
5. **Os templates grátis "Chat / DM" e "Person + motion"** entram no bloco New audience com o selo "New template" e preço "Free".
6. Ficam como estavam: Why it sells (agora "Why this ad works"), aprovação de roteiro e avatar, geração com etapas reais, peças, player e chat lateral.

## 1. Problema
O lote do Iterate (11 peças do `pregadora-amostra` no teste) sai só com edições grátis: não oferece troca de avatar, não oferece outro formato e não usa os templates novos. O Gusta perguntou por que não (A4). Ao mesmo tempo, a pessoa não tem como dizer o que quer do anúncio (A5). Se ela não souber, o HookMill decide sozinho, como hoje (decisão de 12/10). Um item de menu separado pro Remix dividiria um mesmo trabalho ("variar este vencedor") em duas portas.

## 2. Decisões e porquê
1. **Um fluxo só, com trilho de 6 passos:** Winner · Your goals · Plan · Approve AI · Generate · Pieces. Sem nenhuma peça de IA ligada, o passo "Approve AI" aparece tracejado com "· no AI" e é pulado. Por quê: o lote é a unidade que a pessoa entende ("peças deste anúncio"). O formato e o avatar são mais uma alavanca dentro dele, não outro produto.
2. **Tela Winner = a tela atual do Iterate:** área de upload ("Upload an ad that works") + "Or pick from your Library" com o filtro Winners/All video. O botão de cada card agora é **Iterate** (lima no vencedor). Anúncio de imagem fica desabilitado com "Iterate works on video ads".
3. **A análise começa assim que a pessoa escolhe o vencedor e roda durante o quiz.** No topo do quiz, uma pílula mostra a etapa real ("Finding the blocks · 3/5 · ≈ 12 s"); no fim vira "Ad analyzed · plan ready". Por quê: o quiz preenche os ~30 s de espera em vez de somar tempo. Se a pessoa termina antes da análise, o plano abre no estado "analisando" com as etapas.
4. **Quiz: 3 perguntas, uma por tela, com respostas que mudam o lote de verdade.**
   - **Q1 "What do you want from this ad?"** (escolha única): Stretch its life · Find a new audience · Both · Let HookMill choose (padrão). Define a mistura: Stretch = 6 peças de Stretch + 3 de New audience; New audience = 2 + todas; Both e Let HookMill choose = 4 + todas. Em "Let HookMill choose", o plano explica a escolha numa linha ("the winner is still working, so more pieces go to a new audience").
   - **Q2 "Can we use AI that spends credits?"** (escolha única): Free only · Yes, up to a limit (abre um campo "Up to [400] credits per batch · balance 1,200") · Let HookMill choose (padrão). O efeito no bloco With AI:
     - *Free only:* o bloco fica tracejado e "Off", com o switch "Allow AI". Ligar o switch muda a preferência pra "Up to 400 credits" e avisa num toast.
     - *Yes:* o bloco vem ligado, com as peças que batem com a Q3 já marcadas e o medidor do limite.
     - *Let HookMill choose:* o bloco vem ligado, mas **nada marcado**. Um alerta azul diz "Suggested, not checked" e as sugestões levam o selo tracejado "Suggested". Por quê: gastar crédito exige um sim explícito; "deixa a gente escolher" não pode virar cobrança.
   - **Q3 "What do you want to see?"** (múltipla): New headline · Frames · Static · Chat / motion · New face · New format (podcast, discovery…) · Let HookMill choose (padrão, exclusivo: marcar outra coisa desmarca ele, e desmarcar tudo volta pra ele). New face e New format levam a etiqueta "AI · credits". Se a Q2 for "Free only", essas duas opções ficam desabilitadas com o motivo em âmbar e o link "Allow AI credits" (volta pra Q2).
   - Rodapé: Back (ou "Skip, let HookMill choose everything" na Q1) · Skip question · **Continue / See the plan**. No celular, o rodapé gruda embaixo e o botão principal ocupa a largura.
5. **Preferências do cliente** (decisão A5: "aprendizado"). No plano, um bloco cinza "Client preferences · Mooncloth" mostra GOAL / AI / WANTS como chips, o botão "Edit answers" (volta pro quiz) e a frase "Saved for Mooncloth. The next batch opens with these answers pre-checked." No 2º lote (proto "Batch: Next"), a Q1 abre com a faixa lima "Pre-filled from Mooncloth's last batch (Oct 28)" + **Use saved answers** (pula direto pro plano), e cada opção salva leva o selo "Saved".
6. **Tela Plan = a tela atual do lote, com 3 blocos.** Coluna esquerda (sticky no desktop): o vencedor com CPA/compras/hook rate, os blocos que a IA achou (os destacados ficam em toda peça), **Why this ad works** (Hook, Proof, Persona, CTA, cada um com a frase editável, 1 linha de detalhe e a evidência "video 0:00–0:03" ou "Brain › Audience") e **Kept in every piece** (cadeado). Entrou a linha Persona porque New face e New person dependem dela. Coluna direita:
   - **Stretch its life**, "Same concept, fresh edit. Meta reads these as the same ad.": HEADLINE-1/2, CUT-PROOF-FIRST, COLD-OPEN, HOOK-TEXT-1, ENDCARD-60N.
   - **New audience**, "Different first frame and layout. Meta reads these as new ads.": NATIVE-SEARCH, FRAME-QUESTION-BOX, FRAME-REVIEW, **CHAT-DM** e **PERSON-MOTION** (selo "New template", "Free"), STATIC-F1/F2 (~$0.40).
   - Cada peça: miniatura, código mono, tipo, 1 linha do que muda e o preço ("Free" em verde, "~$0.40" em cinza). A peça que bate com a Q3 leva "YOU ASKED". A peça cuja categoria a pessoa não pediu sai do lote e aparece numa linha tracejada no fim do bloco: "Left out because you didn't ask for them: Static · 2 · **Add back**".
   - **With AI · uses credits** (borda tinta, selo OPT-IN, switch On/Off), em dois grupos: *New face* (AVATAR-FACE "só rosto, o mais barato", 3 rostos; AVATAR-PERSONA "pessoa + cenário + persona", 3 personas do Brain) e *New format* (REMIX-DISCOVERY, REMIX-PODCAST Beta, + "Add a format"). Cada linha tem checkbox, código, "Because …" ligado a uma linha do Why (o link "↑ From: Proof" acende a linha na coluna esquerda), "1 person · 3 pieces · 1 video + 2 hooks · 9:16", **"X credits"**, barrinhas de custo relativo e **Swap** (só nos formatos). Com Meta: alerta verde "Ranked with your Meta results" e, no formato que já vendeu, o chip "Sold before" + a linha do número. Embaixo, o medidor "Your limit: 400 credits · X of 400 credits".
   - Linha final: "Every piece comes in 9:16. Make 4:5 or 1:1 later" (igual ao produto).
7. **Barra preta do plano**:
   - Sem IA: "11 pieces · 11 files · about 3 min · 2 statics ~$0.80 in images · no AI credits" + **Generate 11 pieces**.
   - Com IA: "17 pieces · 11 free + 6 with AI · AI X credits · free pieces start now; AI waits for your approval" + **Generate without AI** (outline) e **Generate 11 · review 2 AI →** (lima).
   - Por quê: as peças grátis não dependem de aprovação, então começam a renderizar na hora; só a IA espera. A pessoa não fica parada aprovando roteiro enquanto nada roda.
8. **Approve AI** = a tela de aprovação de antes, só com os itens de IA ligados (uma aba por código, com check verde quando aprovado). No cabeçalho, a pílula ao vivo "Free pieces: 4/11 ready".
   - *Formatos (Discovery, Podcast…):* avatar no cenário (Host/Guest no podcast), New face / New script, "2 of 3 free swaps left", ganchos primeiro (ordenados pela nota, o arriscado começa desmarcado) e o roteiro cena a cena com a etiqueta verde de origem.
   - *AVATAR-FACE:* 3 rostos lado a lado, New face e o roteiro original **sem edição** ("Same hook, voice and cut as the winner").
   - *AVATAR-PERSONA:* prévia da pessoa e as 3 personas do Brain, cada uma com a fala de abertura editável e a etiqueta "Brain › Audience".
   - Por item: **Leave out of batch** e **Approve AVATAR-FACE**. Barra: "1 of 2 AI items approved · 6 AI pieces · X credits · charged when you click Generate" + **Generate AI pieces (6)**, que só habilita com tudo aprovado. É o único botão que cobra crédito.
9. **Generate**: os cards de IA com Border Beam e as etapas reais (rosto: gerar 3 rostos → trocar quadro a quadro → casar luz e pele → render 9:16; podcast: vozes ×2, host e convidado, lipsync de cada um, plano/contraplano, render). Abaixo, o bloco "Free pieces 7/11" em lista: código, barra, "Rendering · 62%" / "Creating the image" / "Waiting in line" / "Ready". Falha de IA: card vermelho, "Finished steps are saved. Retrying is free." + "Retry this step".
10. **Pieces**: agrupadas como no zip e no Ads Manager: Stretch its life ("Goes to a test ad set beside the winner"), New audience ("Goes to a new ad set") e **With AI**, uma seção por item (FACE 1/2/3, PERSONA 1/2/3 ou HOOK A/B/C + FULL VIDEO / SAME BODY). O seletor 9:16 / 4:5 / 1:1 e o player grande ficam como antes; o nome do anúncio é `MC·REMIX-PODCAST·HA` ou `MC·HEADLINE-1`. O ZIP leva 3 pastas: stretch, new-audience, ai.
11. **Chat lateral "Ask HookMill"** fica, com a mesma regra: o cartão de plano agora tem **Add to batch**, que põe o REMIX-PODCAST marcado no bloco With AI e volta pro plano (não cobra). Ajuste de peça funciona em qualquer peça, grátis ou de IA.
12. **Cardápio "Add a format" / "Swap"** (Dialog no desktop, bottom sheet no celular): abas 1 person · 2 people · Avatar. A aba Programmatic saiu, porque Chat/DM e Person + motion agora são templates grátis no New audience (o cabeçalho do dialog diz isso). Specialist continua travado com o motivo; Street interview fica "Wave 2"; item já no lote fica "In batch".

## 3. Tokens
Sem token de marca novo. Herdados de `campanhas-v1` (`--bg`, `--card`, `--ink*`, `--accent*`, `--ok/warn/bad/info*`, Archivo + IBM Plex Mono, raios 8/10/12/16/18). Os literais que sobravam viraram token: `--ok-line #B7DEC5`, `--ok-text #0B4D31`, `--chat-bg/-l/-r/-who` (mock de iMessage), `--video-bg/-ink/-fg` (miniaturas e player). Etiquetas "YOU ASKED", "OPT-IN", "AI · credits" e "Saved" usam a receita da etiqueta de variável: `--accent-soft` + `--accent-ink` + borda `--accent-edge`, mono 10 px. "Suggested" usa `t-dash` (tracejado cinza) de propósito, pra não parecer marcado.

## 4. Componentes (shadcn)
| Peça | shadcn / próprio | Nota |
|---|---|---|
| Trilho de passos | próprio `FlowRail` | `aria-current="step"`; feito = check tinta+lima; pulado = borda tracejada + "· no AI", `disabled` |
| Pergunta do quiz | `RadioGroup` (Q1, Q2) / grupo de `Checkbox` (Q3) em cards grandes (`role=radio/checkbox`) | "Let HookMill choose" ocupa a linha toda, com `Badge` "Default"; na Q3 ele é exclusivo |
| Limite de crédito | `Input type=number` dentro de `Card`, fora do item de rádio | aparece só com "Yes" marcado |
| Progresso do quiz | próprio (3 segmentos) + pílula da análise (Thinking Orbs pequeno) | a pílula atualiza sozinha, sem re-render da pergunta |
| Faixa "Pre-filled" | `Alert` com o fundo lima suave + `Button` "Use saved answers" | só a partir do 2º lote |
| Client preferences | próprio `PrefsStrip` (`Badge` por resposta) + `Button` ghost "Edit answers" | |
| Bloco do lote | `Card` com cabeçalho + lista (`ul`) | Stretch / New audience iguais; "Left out" = rodapé tracejado com `Button` link "Add back" |
| Bloco With AI | `Card` + `Switch` + lista com `Checkbox` | off = borda tracejada; `Alert` info (suggested) / ok (Meta) / destructive (acima do limite) |
| Medidor de limite | `Progress` | vermelho acima do limite e o botão principal desabilita |
| Linha de IA | próprio `AiPieceRow` | `Because` + link pra linha do Why; `CostTier` (3 barras); `Button` ghost Swap |
| Cardápio | `Dialog` (desktop) / `Drawer` (celular) + `Tabs` | travado = `aria-disabled` + motivo |
| Aprovação | `Tabs` por código + o layout de antes; `AVATAR-FACE` e `AVATAR-PERSONA` têm variante própria | |
| Geração | `Card` + `Progress` + lista de etapas + Border Beam (IA); lista simples (grátis) | Beam só em espera |
| Peças / Player / Chat | como na v1 desta spec | |
| Barra de total | próprio `SummaryBar` sticky, fundo `--ink`, 1 ou 2 botões | |

## 5. Estados por tela
- **Winner:** pronto · carregando (skeleton de 4 cards) · vazio ("No winners yet" + Connect Meta / Mark a winner). O upload segue os estados do produto atual (enviando, checando, falhou).
- **Your goals:** 1º lote (tudo em "Let HookMill choose") · próximo lote (pré-marcado + "Saved" + Use saved answers) · Q2 = Yes (campo do limite aberto) · Q3 com IA bloqueada pela Q2. A pílula da análise passa por 5 etapas e termina em "plan ready".
- **Plan:** analisando (Beam + 5 etapas + "You can close this page…", Generate desabilitado) · erro ("The file stops playing at 0:19 of 0:31… Nothing was charged." + Try again / Upload another file) · pronto sem IA · pronto com IA marcada · com IA sugerida e não marcada · IA desligada (Free only) · **acima do limite** (medidor vermelho, alerta "These AI items go over your 400-credit limit" + "Raise to 600", botão principal desabilitado) · com Meta (ranking + "Sold before").
- **Approve AI:** pronto · trocando rosto/roteiro (spinner, prévia esmaecida com Beam, aprovação desfeita) · trocas grátis esgotadas · rosto falhou ("Nothing was charged and this swap doesn't count" + Retry) · item tirado do lote (se não sobrar nenhum, vai direto pra Generate só com as grátis).
- **Generate:** rodando (grátis + IA) · uma etapa de IA falhou (Retry grátis) · terminou ("View pieces").
- **Pieces:** tudo pronto · parcial (item de IA com "Rendering · ≈ 2 min") · peça atualizando depois do ajuste.
- **Chat:** vazio com sugestões · pensando (etapas) · plano (Add to batch) · antes/depois · confirmação.

## 6. Responsivo (390 px)
- **Shell:** a sidebar vira a barra superior com o botão de chat + menu.
- **Quiz:** coluna única de opções (a Q3 tem 2 colunas no desktop e 1 no celular). O rodapé gruda embaixo e o Continue ocupa a largura, acima de Back/Skip.
- **Plan:** a coluna do vencedor/Why vai pro topo (deixa de ser sticky abaixo de 1080 px). Na linha de peça, o preço desce pra baixo da descrição. Na linha de IA, a miniatura some e custo + Swap descem numa linha.
- **Barra do plano:** os 2 botões empilham na largura toda.
- **Approve:** avatar em cima, depois ganchos e roteiro.
- **Generate:** na lista das grátis, a barra some e fica só o status.
- **Peças:** 2 colunas.
- **Cardápio, player e chat:** viram bottom sheet.
- **Chat aberto entre 761 e 1240 px:** a sidebar encolhe pra ícones e o plano vira 1 coluna.

## 7. O que o frontend precisa da API
| Tela | Precisa |
|---|---|
| Winner | o que existe hoje (`iterate.new`: upload, Library de vencedores); ao escolher, `POST /iterations` {creativeId} já dispara a análise |
| Your goals | `GET /clients/:id/iterate-preferences` → {goal, ai: free\|yes\|auto, capCredits, wants[], savedAt} ou vazio; `GET /iterations/:id` com `analysis.stage` + `steps[]` pra pílula (polling ou SSE); saldo de créditos do workspace |
| Plan | `PUT /iterations/:id/answers` {goal, ai, capCredits, wants[]} → recalcula e devolve o plano; salva as preferências do cliente (mesmo endpoint ou `PUT /clients/:id/iterate-preferences`). Plano: `why[]` {key: hook\|proof\|persona\|cta, value, detail, evidence}, `blocks[]` {kind, tc, kept}, `kept[]`, `pieces[]` {code, group: stretch\|new, type, detail, wantKey?, askedByUser, isNewTemplate, costUsd?}, `leftOut[]` {wantKey, count}, `ai` {enabled, suggestedOnly, items[] {id, code, cls, name, desc, people, out, tier, costCredits, reason{whyKey, text}, learned?{cpa, avgCpa, n}, beta, checked}}, `capCredits`, `aiEstimateCredits`, `overCap`; `PATCH /iterations/:id/pieces` (add back, check/uncheck AI, swap, add format); `GET /formats` (catálogo com locked{reason}, wave, beta); `PATCH` da linha do Why |
| Generate (grátis) | `POST /iterations/:id/generate` {scope: "free"} (o que existe hoje) — chamado ao sair do plano |
| Approve AI | por item: `script.scenes[]`, `speakers`, `hooks[]` {text, jevScore, policyRisk?}, `avatarPreview[]`, `personas[]` (AVATAR-PERSONA), `freeSwapsLeft`; `POST …/face`, `POST …/script` (assíncronos); `PATCH` de fala; `POST …/approve`; `DELETE …` (leave out); `POST /iterations/:id/generate` {scope: "ai"} — único que debita crédito e devolve o custo final |
| Generate | `GET /iterations/:id/jobs`: grátis {code, status, pct} + IA {steps[], current, pct, etaSec, error?{step, retryable}}; `POST …/retry` |
| Pieces | `pieces[]` {code, group: stretch\|new\|ai, variable, renders{916,45,11}, adName}; ZIP com 3 pastas; Send to Meta separando os conjuntos |
| Chat | como na v1; o `plan/approve` agora cria um item de IA marcado no plano (não cobra) |

## 8. O que precisa do OK do Gusta
1. O quiz roda **enquanto** a análise roda (não depois), e a pílula da etapa fica no topo do quiz.
2. "Let HookMill choose" na Q2 **sugere sem marcar** a IA (não gasta crédito sem um sim explícito).
3. O que a pessoa não pediu na Q3 sai do lote e aparece em "Left out · Add back" (em vez de ficar no lote desmarcado).
4. As peças grátis começam a renderizar ao sair do plano; só a IA espera a aprovação. O botão principal fica "Generate 11 · review 2 AI".
5. O 2º lote abre pré-marcado com as respostas salvas + o atalho "Use saved answers".
6. Seguem da v1: ganchos acima do roteiro, cobrança só no "Generate AI pieces", nome do chat ("Ask HookMill"), barrinhas de custo enquanto não há preço.
