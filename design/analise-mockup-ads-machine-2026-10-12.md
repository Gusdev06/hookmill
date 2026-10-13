# Análise do mockup "Ads Machine" (proposta de novo mockup)
Data: 2026-10-12 · Status: **análise pra discussão. Nada aprovado, nada vira código.**
Fonte: https://claude.ai/artifact/SoGZfUzZq6wsheSCpMx9Tp (artifact tipo Design, autor fora da org; rodapé "Draft v0.1 · 12 Oct 2026 · for Tordan and Gustavo"). São 28 telas `.dc.html` e o canvas. A cópia local fica no scratchpad da sessão.
Cliente fictício: **Mooncloth** (máscara de dormir, US). Os números são todos de exemplo.

## 0. O que é, em uma frase
Não é um redesign do HookMill: é **outro produto, maior**. É uma plataforma de agência multi-cliente que conecta no Meta do cliente, **lê os resultados todo dia** (o analista "Eddy"), guarda a memória do cliente (o "Brain"), **gera criativos** (o "Adsgun", com 2 caminhos: iterar um vencedor ou testar conceitos novos) e **publica no Meta com 1 clique**, fechando o loop.

Os três personagens:
- **Adsgun** faz os anúncios. Os dois caminhos terminam em Review → Send to Meta.
- **Eddy** é o analista. Puxa o Meta todo dia, explica em linguagem simples e propõe mudanças (pausar, escalar, cortar budget) que alguém aprova.
- **Brain** é a memória editável do cliente: oferta, público, voz, regras, prova, biblioteca, concorrentes, metas e aprendizados. Adsgun e Eddy usam em toda rodada.

## 1. Telas e features

### Estrutura / componentes
| Tela | Features |
|---|---|
| **Main** (mapa do protótipo) | Índice das 4 seções: Onboarding, Caminho 1 (iterar), Caminho 2 (conceitos) e Always on. Explica Adsgun, Eddy e Brain. |
| **Sidebar** | Logo; seletor de cliente ("Mooncloth · Client workspace"). WORKSPACE: Home, Campaigns, Eddy (badge 3), Brain. ADSGUN: Iterate a winner, New concepts, Review (badge 42). Rodapé: All clients, usuário "Tordan · Agency admin". |
| **WizardRail** | Trilho de 6 passos do onboarding com %, "About 20 minutes, progress saves", Save and exit. |
| **FlowBar** | Barra horizontal de 5 passos dos fluxos do Adsgun (iterar ou conceitos), com passos feitos e atual e Exit. |
| **AdFrame** | Miniatura 9:16 / 4:5 / 1:1 com o gancho escrito, o rótulo e a duração. |

### Agência
| Tela | Features |
|---|---|
| **Clients** | Lista de clientes da agência com resumo ("2 live · $7,100 managed · 6 ads waiting on clients"). Card por cliente com status (**Setup passo X de 6 / Live / Paused**), gasto de 30 dias, CPA contra a meta (% acima/abaixo) e a próxima pendência ("Eddy has 2 proposals", "6 new ads waiting", "Waiting on client to connect Meta, reminder after 3 days"). Pausar preserva o Brain e os resultados. CTA "Onboard a new client" (~20 min). Tem clientes de e-commerce, clínica local (CPL), med spa e app (installs). |

### Onboarding do cliente (6 passos, ~20 min, feito pela agência junto com o cliente)
| Passo | Features |
|---|---|
| **1 Business** | URL do site → **lê o site** (14 páginas) e preenche produtos, preços, reviews, FAQ, logo e cores. Campos: nome, indústria, mercado, moeda/fuso. Tipo de negócio (define a meta padrão: compra × lead). **Time e papéis**: o *Client owner* aprova anúncios, *Agency admin* (Tordan, Gustavo), convite por email. |
| **2 Connect Meta** | Login com Meta (o cliente escolhe business, conta, Página e pixel) ou **link seguro por email** pro cliente conectar do celular. A conexão é **"pelo Meta Ads MCP"**. Mostra os ativos (Business, Ad account, Página, Instagram, Pixel) com "Change". **Health check**: conta ativa, pagamento, pixel recebendo compra, business verificado, CAPI não configurado (aviso). Lista o que pode e o que não pode fazer: criar só com aprovação, pausar em vez de deletar, nunca acima do teto, não mexe em billing. Permissões: `ads_read · ads_management · business_management`. |
| **3 Product & offer** | Produtos achados no site com o toggle **Advertise / Upsell only**. Oferta principal e LP (com checagem de velocidade e acima da dobra). **"Why people buy, in their words"** tirado das reviews. **Prova utilizável**: nota, garantia, **creators com direito de uso** (rosto e voz reaproveitáveis). **Objeções e respostas** tiradas do FAQ (usadas no corpo dos anúncios). |
| **4 Audience & voice** | Grupos de comprador (persona, dor, desejo), com "Add a group". **Voz** em 3 sliders (Calm↔Energetic, Playful↔Serious, Casual↔Polished) com um gancho de exemplo. **Palavras que usamos / nunca usamos** (sem claim de saúde por política do Meta). **Brand kit**: logo, cores, fontes (upload se faltar) e **pasta de footage do Google Drive** (38 clipes). |
| **5 Goals & guardrails** | Resultado: Purchases / Leads / App installs. **CPA alvo** (mostra a média de 90 dias), budget mensal, **budget por rodada de teste** (o Adsgun dimensiona o lote por ele) e **teto de gasto diário** da conta. Aprovações: o cliente aprova todo anúncio, as mudanças do Eddy precisam de aprovação e campanhas novas começam pausadas por 2 semanas. Autonomia do Eddy: **só propostas** (recomendado) ou **auto-otimizar dentro dos limites** (libera depois de 3 semanas de boas propostas). |
| **6 Build the Brain** | Animação do que a máquina fez: puxou 90 dias (212 ads, $27.8k), **assistiu e transcreveu todo vídeo**, **quebrou cada ad em hook/body/CTA**, achou vencedores e cansados, montou o Brain (86%, com o que falta). **Primeira leitura do Eddy**: melhor ad, ad cansando, gap. Escolha por onde começar: iterar o vencedor (sugerido), conceitos novos, ou pular pra Home. |

### Always on
| Tela | Features |
|---|---|
| **Home** (do cliente) | 4 KPIs (gasto/budget, compras/receita, **CPA contra a meta**, ROAS) e "Synced with Meta 4 min ago". **Eddy's read**: 3 insights com tag TIRING / GAP / WORKING, cada um com a ação ligada ("24 fresh versions ready"). Atalhos Iterate / New concepts. **Waiting for you**: iterações pra escolher, conceitos pra escolher, propostas do Eddy. Card do Brain com % e o que falta. |
| **Campaigns** | Gráfico de CPA diário de 30 dias com a linha da meta, hover e toggle "Show as a list" (acessibilidade). Resumo "What's happening" em linguagem simples. **Tabela em árvore** campanha → ad set → ad (status, gasto, compras, CPA, ROAS) com **tag do Eddy** por linha (Scale +20%, Tiring, Winner, Over target, Audience maxed, Reads after $300). **"What's winning, part by part"**: ranking de **ganchos** por hook rate, **corpos** por hold rate e **CTAs** por CTR, com aviso de amostra pequena ("Eddy won't call a winner on less than $1,000"). |
| **Eddy** | Chat com o analista: resposta com números, ad de evidência embutido e **fonte citada** ("SOURCE · 3 ADS · LAST 14 DAYS"); perguntas sugeridas; **"Save to the Brain"** num insight. **Decision board**: cards PAUSE / SCALE / TRIM com Why + Expected, Approve / Deny / Undo ("applied in Meta at 10:42"; negado = não sugere de novo na semana). Card de NEW TEST ligado aos conceitos. Aviso "Auto-optimize off". |
| **Brain** | Completude (%) com o que falta. "Teach the Brain" (campo livre → vira regra). 8 seções com toggle "Used in every run / Paused": Business & offer, Audience, Voice & rules, Proof, **Creative library** (212 ads quebrados em partes), **Competitors** (Ad Library), Goals, Learnings. **"What the Brain learned"**: aprendizados com fonte, amostra e **confiança (High/Medium/Low/Rule)**, Keep / Forget / Undo. |
| **Brain › Voice & rules** | Sliders de tom com amostra ao vivo, palavras sim/nunca, **regras com toggle** (sem claim de saúde travado; cliente real só com OK escrito; nunca criança; garantia em todo CTA; nunca citar concorrente), instruções livres, "lines that sound like us" (referência, não cópia), onde a regra é aplicada, **versionamento** ("Version 7 · edited by Tordan"). |

### Caminho 1: iterar um vencedor
| Passo | Features |
|---|---|
| **Pick a winner** | Upload (MP4/MOV/JPG/PNG, 500 MB; vale ad de outra conta ou arquivo cru de creator, e pede os resultados) **ou escolher do Meta** (melhores por CPA em 90 dias, com gasto, CPA e hook rate e chip Winner/tiring). Sugestão do Eddy. |
| **Breakdown** | Ad quebrado em **Hook / Body / CTA com timecode**, fala e o que aparece na tela. Métricas do ad contra a média da conta (hook rate, hold rate, CTR, CPA contra a meta). Diagnóstico do cansaço (frequência 3.4). **Keep / Change**. |
| **Iteration plan** | Tipos de iteração com toggle e contagem: **novos hooks (10)**, **novos openers** (mesma fala, 3s de imagem nova, 4), **cortes curtos** 15/20s (4), **formatos 4:5 e 1:1** (6), novos CTAs (3, opcional) e **nova voz (travada até ter consentimento do creator)**. Resumo do lote: total, tempo (~min), **custo de geração**, budget de teste, o que foi mantido do original. |
| **Review & select** | Grade de 24 versões com filtro por tipo, **score** e **"Eddy's pick"**, Select / Select Eddy's picks / Clear, contador "8 of 24 · $1,200 over 5 days". |
| **Ad preview** | Mock do anúncio no feed (Sponsored, copy, Shop now) "como aparece em Reels/Stories"; navegação ‹ ›. Mostra **o que mudou**, o roteiro (Hook NEW, Body e CTA "original"), o **porquê do score: "MiroFish played it to 1,000 simulated light sleepers"**, checks (sem claim de saúde, segue a voz, legenda fora dos botões do Reels). **Request a change** (texto livre → o Adsgun gera nova versão) / Reject / Select. |
| **Send to Meta** | Destino: campanha de teste nova (recomendado) ou ad set existente (com o trade-off explicado). Budget/dia × dias com checagem contra o round e o teto. Começo **pausado** ou live. **Nomenclatura automática** (`MC_ITER_1012_H01_5AM_9x16`) pra o Eddy ranquear as partes depois. Checklist pré-envio. Progresso (campanha → ad set → upload) → IDs criados, "Eddy reports back after $300 or 48h". |

### Caminho 2: conceitos novos
| Passo | Features |
|---|---|
| **What we know** | Resumo do Brain. **Mapa de ângulos testados: ângulo × nível de consciência** (Unaware → Ready), heatmap com nº de ads de 90 dias. **Gaps** (comparação nunca testada, founder story, pouco topo de funil, segmento sub-explorado). Mix de formatos. Sinal de concorrente vindo da Ad Library. |
| **Concepts** | 6 conceitos, cada um com **ângulo, nível de consciência, formato (demo, talking head, creator, faceless b-roll, carrossel), gancho e WHY** ligado a um gap. Toggle, "Suggest six more", "Add your own idea". Cada conceito = um ad set. |
| **Scripts** | Abas por conceito: **10 ganchos (top 6 com score), 2 corpos, 2 CTAs**, editáveis; nota de dependência ("precisa da Ana na câmera ou OK escrito pra versão IA"). **Dimensionamento pelo budget**: "120 possible ads, makes the best 18", 6 por conceito. |
| **Review & select** | 18 ads agrupados por conceito, score, mínimo de **3 por conceito** (aviso) e "Select all". |
| **Send to Meta** | 1 campanha com **1 ad set por conceito** a $100/dia, checagem do teto somando com o teste de iteração já rodando, checklist (incluindo "OK escrito da Ana pros vídeos de founder com IA"). O Eddy compara os conceitos depois de $300 por ad set. |

## 2. Mapa: o que já existe no HookMill × o que é novo
| No mockup novo | No HookMill hoje | Leitura |
|---|---|---|
| Iterate a winner (Pick → Breakdown → Plan → Review) | **Variar campeão** (Campeão → Diagnóstico → Variações → Ganchos → Estimativa → Lote), `api/src/campeoes`, `variacoes`, `medicao` | Mesmo núcleo. O Breakdown é o nosso diagnóstico de blocos. Os tipos mudam: eles têm hooks/openers/cortes/formatos/CTA/voz e nós rosto/gancho/copy/layout. |
| New concepts → Scripts | **Wizard v1** (Oferta → Roteiros), `ofertas`, `roteiros` | O nosso parte de 1 oferta → 3 roteiros. O deles parte do mapa de ângulos e gera conceitos × ganchos × corpos × CTAs em escala. |
| Brain | Oferta/briefing + "memória de vencedores" no roteiro | O deles é muito mais amplo (voz, regras, prova, concorrentes, aprendizados com confiança). |
| Library de partes | `biblioteca` + marcar vencedor | O deles ranqueia **partes** (gancho/corpo/CTA) por métrica real. |
| Clients (agência) | `workspace` | Encaixa: workspace = cliente, e precisa de um nível "agência" acima. |
| Review + score | `revisao` (OK final) | O deles tem score/simulação (MiroFish) e "Eddy's pick". O nosso não tem score. |
| Eddy, Campaigns, Send to Meta, Meta connect | **não existe** | É o grosso do escopo novo: leitura e escrita no Meta Ads. |
| Rosto/avatar, Motor (Kling/Seedance × avatar+lipsync), Geração, **Editor no vídeo** | **existe** (`rostos`, `geracao`, `render`, `edicao`, editor v1 aprovado em 09/10) | **Some do mockup novo.** Lá "gerar" é uma caixa preta de ~min e custo. O editor CapCut-like não aparece. |

## 3. Choques com decisões já tomadas
1. **Escopo.** O TIME.md diz que a v1 é "criativo do zero num wizard… **Sem chat na v1**". O mockup tem chat (Eddy) e "Request a change" em texto livre. O wizard v1 tinha trocado isso por uma lista fechada de 4 caminhos justamente pra não virar o clonador.
2. **Visual.** Spec v1: **tema escuro único, Geist, primário branco, cor só pra status**. Mockup: **tema claro** (`#EEEEEA`), Archivo + IBM Plex Mono e acento **lima `#C8F03C`**. Trocar o design system mexe no `web/` inteiro.
3. **Custo.** A v1 só mostra custo na Estimativa. O mockup mostra no Iteration plan ("Generation cost ~$31"); combina com o variar-campeão (que tem o preço no botão de análise).
4. **Público.** O HookMill era "uso interno Gusta + Tordan, depois agência e escola". O mockup já nasce **agência com cliente final logando** (Ana aprova). Isso pede papéis, convite de cliente e aprovação por cliente.
5. **Meta.** O mockup conecta "pelo Meta Ads MCP" com `ads_management`. Num SaaS com cliente de terceiro isso exige **app Meta com App Review / Advanced Access** pra `ads_management` e `business_management`, além de business verificado. Isso é semanas e risco, não feature. (O MCP do pipeboard que a gente usa é uma conexão nossa e não serve como OAuth de cliente.) E nas contas em contingência a regra da operação é **nunca ler o Meta direto**, então pra oferta própria a leitura talvez tenha que vir da UTMify.
6. **Score por simulação.** O "MiroFish played it to 1,000 simulated light sleepers" depende do MiroFish (painel no Pod RunPod, meta de 100 sims/dia ≤ US$ 5). Ainda não há validação de que o score prevê o CPA.

## 4. O que o mockup novo faz melhor (vale roubar mesmo sem mudar tudo)
- **Breakdown com métrica por parte** (hook rate / hold rate / CTR contra a média da conta) e a lista Keep / Change explícita.
- **Tipos de iteração baratos** que hoje a gente não tem: **opener novo com a mesma fala**, **cortes 15/20s**, **reformatar 4:5 e 1:1**. Todos são Remotion/ffmpeg, sem gerar IA, quase de graça.
- **Mapa ângulo × consciência** com gaps, que dá estratégia antes de gerar.
- **Nomenclatura automática** (`MC_ITER_1012_H01_5AM_9x16`), que permite ranquear partes depois.
- **Dimensionar o lote pelo budget de teste** ("$1,500 → 6 ads por conceito, 3 ad sets × $100 × 5 dias").
- **Brain com aprendizado + confiança + Keep/Forget** e regras de voz com toggle (claim de saúde travado).
- **Consentimento como trava** (voz nova travada sem OK do creator; founder IA só com OK escrito).
- **Guardrails**: teto diário, começar pausado, aprovação, e autonomia que só libera com histórico.

## 5. Perguntas pra discutir
1. **Isso substitui o HookMill ou é a fase 2 dele?** Minha leitura: o "Adsgun" é o HookMill. O resto (Eddy, Campaigns, Send to Meta, Clients) é produto novo em cima.
2. **Quem é o usuário da v1?** Ainda nós dois (interno), ou agência com cliente logando já agora?
3. **Meta read/write entra na v1?** Se entrar, alguém precisa abrir já o App Review do Meta. Se não, dá pra começar com **export (CSV/zip com nomes padronizados) + leitura via UTMify/pipeboard** pras nossas contas.
4. **Onde ficam rosto, motor, geração e editor** no fluxo novo? O mockup pula tudo isso, e é onde mora o código que já existe.
5. **Visual:** fica o escuro estilo Vercel (já implementado) ou migra pro claro com lima?
6. **Score:** MiroFish entra como feature ou fica fora até ser validado contra o CPA real?
7. **Quem é Eddy/Adsgun/Brain na marca?** O produto se chama HookMill (06/10); "Ads Machine" e "Adsgun" são nomes do mockup.
