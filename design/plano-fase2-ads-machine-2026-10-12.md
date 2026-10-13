# Plano: implementar a fase 2 no visual do mockup "Ads Machine"
Data: 2026-10-12 · Status: **aprovado; F0 concluída (12/10), F1 contrato em andamento**
Decisão: `decisions/log.md` (12/10). Análise das telas: `design/analise-mockup-ads-machine-2026-10-12.md`.

Legenda: ✅ já existe, só muda o layout · 🛠 existe, mas precisa adaptar (front e/ou API) · ⏳ **Em breve** (a seção aparece, sem função) · 🆕 tela que o mockup não tem, a criar no visual dele

## 1. Mapa tela a tela
### Shell e componentes
| Mockup | O que fazemos |
|---|---|
| Design system | 🛠 trocar os tokens do `globals.css` (claro `#EEEEEA`, cards `#FDFDFB`, borda `#DCDDD7`, texto `#15171A`, lima `#C8F03C`, sidebar `#16181B`, status verde/âmbar/vermelho/azul do mockup), fontes Archivo + IBM Plex Mono, e os raios de 16–18 px. O editor (`editor.css`) também. |
| Sidebar | 🛠 substitui o header com abas. WORKSPACE: Home ✅, Campaigns ⏳, Eddy ⏳, Brain 🛠. ADSGUN: Iterate a winner ✅, New concepts 🛠, Review ✅, **Library ✅** (não está no mockup, mas mantemos). Rodapé: All clients, conta e EN/PT. |
| Seletor de cliente | ✅ cliente = **workspace**. Multi-workspace e `switch-workspace` já existem na API. |
| WizardRail / FlowBar / AdFrame | 🛠 trocar o trilho atual do wizard e do variar por eles. |

### Agência
| Mockup | O que fazemos |
|---|---|
| Clients | 🛠 lista dos workspaces do usuário, com status Setup (passo X de 6) / Live / Paused e "waiting on you" ✅ (contagem que já temos). Gasto e CPA ficam ⏳. Botão "New client" = criar workspace + onboarding. |

### Onboarding do cliente (6 passos)
| Passo | O que fazemos |
|---|---|
| 1 Business | 🛠 "ler o site" = a leitura de página que a Oferta já faz. Nome e idioma ✅. **Time e convite ✅** (já existe). Indústria, mercado e tipo de negócio são campos novos simples (🛠 API). |
| 2 Connect Meta | ⏳ tela inteira com o selo Em breve e o botão "Pular por enquanto". |
| 3 Product & offer | 🛠 os campos do brief que já existem (o que é, oferta e preço, prova, CTA, LP) no layout do mockup. Lista de produtos, objeções e "why people buy" ficam ⏳ dentro da tela. |
| 4 Audience & voice | 🛠 "pra quem é" e "dores" do brief ✅. Sliders de voz, palavras sim/nunca e brand kit ⏳. |
| 5 Goals & guardrails | 🛠 **teto de gasto mensal ✅** (`monthlySpendCapUsd` já existe). CPA alvo, budget de teste, aprovações e autonomia do Eddy ⏳. |
| 6 Build the Brain | ⏳ precisa de 90 dias do Meta. A tela mostra o Brain montado a partir da oferta e os dois caminhos pra começar ✅. |

### Always on
| Mockup | O que fazemos |
|---|---|
| Home | ✅ "Make new ads" e "Waiting for you" (criativos e lotes esperando a pessoa). KPIs do Meta e "Eddy's read" ⏳. Card do Brain 🛠 (% calculado dos campos preenchidos). |
| Campaigns | ⏳ |
| Eddy | ⏳ |
| Brain | 🛠 seções: Business & offer ✅ (as ofertas do cliente; a tela Offers de hoje vira isto), Audience ✅, Proof ✅, Creative library ✅ (link pra Library), Voice & rules ⏳, Competitors ⏳, Goals 🛠 (só o teto), Learnings ⏳. "Teach the Brain" ⏳. |
| Brain › Voice & rules | ⏳ (o campo "notas / o que evitar" do brief aparece aqui como "Custom instructions" ✅). |

### Caminho 1: iterar um vencedor (= Variar campeão)
| Mockup | O que fazemos |
|---|---|
| Pick a winner | ✅ upload e link da Ad Library. "Pick from Meta" ⏳. Escolher da Library ✅. |
| Breakdown | ✅ o diagnóstico (blocos, "por que vende", editar). Métricas contra a média da conta ⏳. |
| Iteration plan | 🛠 junta os nossos passos Variações + Ganchos + Estimativa numa tela só, no formato de cards com toggle e contagem. Tipos de hoje ✅ (rosto, gancho, layout; copy segue Em breve). Tipos do mockup que não temos ⏳: openers novos, cortes 15/20s, formatos 4:5/1:1, CTAs, voz nova. Resumo do lote com custo e o teto ✅. |
| Geração do lote | 🆕 a nossa tela Lote no visual novo (não existe no mockup). |
| Review & select | 🛠 grade de selecionar usando as variações prontas do lote. Score e "Eddy's pick" ⏳. |
| Ad preview | 🛠 = o nosso OK final: player, o que mudou, roteiro. **"Request a change" continua sendo a lista fechada de 4 caminhos** (decisão da v1); o texto livre do mockup não entra. Score MiroFish ⏳. Os checks são os que já temos. |
| Editor no vídeo | 🆕 o editor v1 (09/10) com a pele nova. |
| Send to Meta | ⏳ por enquanto a saída real é **baixar o vídeo e mandar pra Library** ✅. |

### Caminho 2: conceitos novos (= criativo do zero, wizard v1)
| Mockup | O que fazemos |
|---|---|
| What we know | 🛠 o resumo do Brain ✅. Mapa ângulo × consciência, gaps e formatos ⏳. |
| Concepts | ⏳ os 6 conceitos ainda não são gerados. O fluxo segue com 1 conceito = a oferta escolhida. |
| Scripts | ✅ o nosso passo Roteiros (3 roteiros) no layout das abas do mockup. "10 hooks com score" e o dimensionamento pelo budget ⏳. |
| Rosto | 🆕 |
| Motor | 🆕 |
| Geração | 🆕 |
| Edição + Editor | 🆕 |
| Review & select / Ad preview | 🛠 o mesmo do caminho 1. |
| Send to Meta | ⏳ igual ao caminho 1. |

## 2. Fases
1. **F0 Design (maquina-design):** um mockup próprio só das telas 🆕 (rosto, motor, geração, lote, edição e editor), no visual do Ads Machine, mais um componente padrão de "Em breve". Usamos o artifact do mockup como referência, sem editar o dele. **OK do Gusta.**
2. **F1 Contrato (maquina-arquiteto):** só o mínimo de API: campos novos do workspace (indústria, mercado, tipo de negócio, passo do onboarding, status) e um endpoint pra listar clientes com status e pendências. Nada de Meta. **OK do Gusta.**
3. **F2 Base visual (maquina-frontend):** tokens, fontes, sidebar, WizardRail, FlowBar, AdFrame e o componente Em breve.
4. **F3 Telas ✅/🛠:** Clients, onboarding, Home, Brain, caminho 1 e caminho 2, reaproveitando os componentes que já existem.
5. **F4 Telas ⏳:** Campaigns, Eddy, Connect Meta, Goals e Send to Meta, como placeholders fiéis ao mockup e com o selo.
6. **F5 Telas 🆕** da F0.
7. **QA (maquina-qa)** em desktop e mobile, EN/PT, com mocks. Só ele declara "funciona".

Nada pago: nenhuma geração nova é necessária, os testes usam os mocks que já existem.

## 3. Pontos que assumi (corrija se discordar)
- O idioma padrão continua EN e o PT-BR se mantém (o mockup é só em EN).
- A Library continua na sidebar.
- "Request a change" continua sendo a lista fechada.
- O placeholder "Em breve" mostra a tela do mockup esmaecida, com os dados de exemplo, em vez de uma tela vazia. Assim dá pra ver o que vem.
