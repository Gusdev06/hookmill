# Onboarding v2 · modo de conta, wizard próprio, tour e Home: spec de UX/UI
Data: 2026-10-21 · Status: **proposta, aguarda o OK do Gusta** · Dono: maquina-design
Mockup navegável: https://claude.ai/artifact/PuvRF8SNr2mbpxwwBkVMiR · fonte: `projects/maquina-anuncios/design/mockup-onboarding-v2.html` (atualize SEMPRE este arquivo, pra o link não mudar). A barra "Prototype" no topo troca tela, estado, modo (Agency / Just me) e Desktop / Phone 390; ela não faz parte do produto.
Base: `feedback/tordan-loom-2026-10-20.md` (os dois Looms), `time/TIME.md`, `design/fase2-telas-novas-2026-10-12.md` (tokens e shell vigentes; esta spec **não** muda a pele), `docs/contratos/fase2-agencia.md` §3.3 (os 6 passos de hoje), e os pontos do arquiteto pra `docs/contratos/onboarding-v2.md` e `meta-v1.md` (assumidos como dados: `accountMode`, gate do `/onboarding/[step]`, Connect Meta real com health check, `tourCompletedAt` por usuário×workspace, lista de anúncios com insights de 30 dias e "vencedor" marcado).

> Dados do mockup (Mooncloth, Lumen Bikes, Dental Kirk, Tordan Oliveira, custos, CPA, contas `act_…`) são exemplo. Os números de performance vêm da Meta via API; nada aqui é métrica real.

## 1. Problema
O Tordan fez o cadastro e caiu no app inteiro: sidebar cheia, "Creatives" vazio, cliente em "Setup · step 1 of 6" e nenhum caminho de volta pro wizard. Três causas, uma por camada:
1. **Entrada sem porta.** O cadastro leva direto ao shell. O onboarding é "uma página dentro do app", então a pessoa vê tudo o que ainda não serve pra ela.
2. **Um produto pra duas vidas.** Agência (vários clientes) e dono do próprio negócio (um workspace) veem a mesma sidebar; pro segundo, seletor de cliente e "All clients" são ruído.
3. **Tela vazia antes de valor.** A Home mostra "Waiting on you" vazio e skeleton; a Meta, que traria um vencedor real na primeira entrada, era "Em breve".

## 2. Decisões e porquê
1. **Ordem fixa: Cadastro → "How will you use HookMill?" → Wizard (6 passos) → Tour (5 paradas) → Home.** Cada etapa só abre quando a anterior fechou. A pergunta de modo **não é passo do wizard**: é a tela de boas-vindas, com dois cartões grandes, uma frase do que muda em cada um e "você pode trocar depois em Settings". Sem ela escolhida não há Continue.
2. **O wizard tem shell próprio** (`/onboarding/[step]`, layout sem sidebar): topo mínimo (logo HM · avatar + nome do cliente · "Save and exit" à direita), cartão de progresso com **% grande + "Step N of 6 · nome"** e os 6 passos em régua (desktop) ou só a régua (celular), um foco por tela, barra de ação fixa com Back + ação lima. O % é `round((passo−1)/6×100)`: passo 1 = 0 %, passo 6 = 83 %, LIVE = 100 %. Passos já alcançados são clicáveis na régua; os futuros não.
3. **Gate.** Enquanto o workspace ativo está `SETUP`, OWNER/ADMIN caem em `/onboarding/[step]` de qualquer rota do app; a Home nunca aparece com o cliente em setup. MEMBER/CLIENT num workspace `SETUP` veem a tela "Setup in progress" (sem shell, com quem está configurando e "Sign out"), porque não podem editar o wizard. Cliente que já era LIVE no backfill nunca passa por isto.
4. **"Save and exit" leva a uma tela de retomada, não ao app** (`/onboarding/saved`, shell mínimo). Ela mostra o cliente com a barra de % e o botão lima "Continue setup"; no modo AGENCY lista os outros clientes (Live → "Open" entra no app daquele cliente; Setup → "Continue setup") e "New client"; no modo OWN só "Sign out" e a frase "Next time you sign in, you land right here". Por que não a Clients: ela mora no shell do app, e o shell é justamente o que a pessoa não deve ver com o cliente em setup. Pra agência com clientes LIVE, "Open" troca de workspace e entra no app normalmente (o gate é por workspace ativo).
5. **Caminho de volta em três lugares, um por situação:**
   - *Setup, AGENCY:* o cartão da tela Clients ("Setup · step 2 of 6 · Continue setup", já existe) e o seletor de cliente, que passa a mostrar "Setup 33 %" ao lado do nome. Abrir o cliente = cair no passo salvo (o gate faz isso sozinho).
   - *Setup, OWN:* não precisa de cartão: o gate manda pro wizard ao entrar; "Save and exit" vai pra tela de retomada; o próximo login volta pro passo salvo.
   - *Depois de LIVE:* **"Revisit setup" fica no Brain**, no cabeçalho, botão outline. Motivo: o wizard é o Brain sendo preenchido (negócio, oferta, público, metas); revisar setup = revisar o Brain. Abre o wizard em modo **"Edit setup"** (eyebrow muda, sem gate, régua toda clicável, "Save and exit" volta pro Brain, sem POST de complete). Cada seção do Brain com item faltando já linka "Fill" direto no passo. Settings não ganha "Revisit setup": Settings é configuração (nome, idioma, membros, modo de conta, **Connections**), não conhecimento.
6. **Connect Meta é um componente só (`MetaConnect`) em dois lugares:** passo 2 do wizard e **Settings › Connections**. Mesmos estados, mesmos textos. A Home sem Meta manda pra Settings › Connections, não pro wizard (a pessoa já está LIVE).
7. **Passo 2 real, com "Skip for now" honesto.** Fluxo: *Continue with Facebook* (botão azul da Meta; é a única cor de marca de terceiro permitida, porque é o botão deles) → *Reading your ad accounts…* (beam no cartão, checklist com o que já leu) → *escolher ad account* (lista de rádio com nome, `act_`, moeda e chip Active / No permission; conta sem permissão fica visível mas desabilitada, com a instrução de como pedir acesso) + *Page* (`Select`) → *Account health* (4 checagens: conta ativa, pagamento válido, pixel disparando, negócio verificado) → Continue. Verde = All good. Âmbar (pixel sem compra em 7 dias) = pode continuar, aviso de que a Home vai marcar. Vermelho (sem permissão) = Continue desabilitado, "Check again" e "Choose another account". Erro do OAuth = alerta vermelho com causa em linguagem de gente ("The window was closed before it finished, or a popup blocker stopped it") e "Try again". "Skip for now" é outline, sempre visível até conectar; o lima é Continue, desabilitado até o health check passar. Na barra: "Optional now. Everything else works without it; results and the winner on Home need it."
8. **Passo 6 vira a porta do tour.** Depois do `POST /workspace/onboarding/complete` o alerta verde diz "Mooncloth is live" e o lima vira **"Start the tour"** (não "Go to Home"). O painel escuro à direita mostra o que a Meta já leu (212 ads, melhor CPA × média da conta): é a ponte pro que o tour vai mostrar.
9. **Tour obrigatório, 5 paradas, sobre as telas reais** (`TourProvider` no shell do app, dispara quando `tourCompletedAt == null` e o workspace é LIVE): **Brain → Iterate a winner → New concepts → Eddy → Home.** Sem skip, sem X, sem Esc na primeira vez; "Back" e "Next", contador "Tour · N of 5" com 5 pontos. A parada 2 tem duas versões: com vencedor da Meta, o spotlight cai no cartão "From Mooncloth's Meta account" com o anúncio marcado ("$19.40 CPA, 38 % under average", botão "Iterate it"); sem Meta ou sem vencedor, cai na área de upload ("Start from an ad that worked"). A parada 4 (Eddy) é honesta: a seção Em breve existente, e o texto diz "Not live yet". A parada 5 fecha na Home sobre o painel de resultados; "Finish" grava `tourCompletedAt`. O passo do tour fica em `sessionStorage`; fechar a aba e voltar retoma na mesma parada.
10. **Brain na parada 1: versão 2D.** O anel de progresso conta de 0 até o % real (≈ 2 s) enquanto as seções acendem em ordem (check lima, "parcial" âmbar, vazio). É o "cérebro sendo montado" do Tordan sem custo de WebGL. O 3D fica como pendência (§9, Q6) com o que exigiria.
11. **Sidebar no modo OWN:** some o seletor de cliente; no lugar, um **cartão de identidade do workspace** (avatar + nome + linha de status da Meta: "Meta · synced 4 min ago" verde ou "Meta not connected" âmbar), que leva a Settings › Connections. O rodapé troca "All clients" por **"Settings"** (hoje Settings só existe no menu da conta). Papel exibido: "Owner" em vez de "Agency admin". Nada de "New client". Trocar pra Agency fica em Settings › Account mode.
12. **Home vira placar.** Com Meta: cabeçalho com chip "Synced with Meta 4 min ago" e ações Iterate / New concepts; seletor 7 / 30 days; **4 KPIs** (Spend com barra do teto mensal · Cost per purchase contra a meta ou o período anterior · ROAS · Active ads com "N new · N tiring"); **Top ads** (3 linhas: miniatura, nome, dias rodando, Spend, CPA, ROAS, chip WORKING / STEADY / TIRING e botão Iterate; o vencedor tem fundo lima-claro e o Iterate lima); à direita **Waiting on you** (os cartões de hoje, com contagem) e o **cartão do Brain** (% e o que falta); embaixo **Recent creatives** (a lista de hoje, com filtros; o Review da sidebar continua apontando pra `?filter=needs_you`). Sem Meta: no lugar dos KPIs um cartão **"No results here yet"** com o que vai aparecer, "Connect Meta" e "What we read"; nada de skeleton. Primeira leitura: cartão com beam, "Reading 30 days from Mooncloth US · 4 of 6 ad sets · about 1 minute left · you can leave". Meta com token vencido: alerta âmbar "Meta stopped answering 2 days ago" + "Reconnect", KPIs com a data do último dado.
13. **Sem gráfico nesta versão.** Barra do teto e chips de tendência bastam pro que o Tordan pediu ("visão de performance, mais genérica"). Gráfico de linha entra com Campaigns.

## 3. Tokens
Sem mudança nos tokens da F0 (`fase2-telas-novas` §3). Dois tokens novos:
| Token | Valor | Uso |
|---|---|---|
| `--meta` | `#1877F2` | só o botão "Continue with Facebook" e o quadrado "f" do cartão de conexão (é a cor do botão deles; não vira acento nem status) |
| `--warn-dot` | `#D9A21B` | ponto do status âmbar no escuro e barra `warnb` |
Overlay do tour: `rgba(22,24,27,.62)` (ink a 62 %) via `box-shadow` do spotlight; não é token de cor de superfície.

## 4. Componentes
| Peça | shadcn / próprio | Nota |
|---|---|---|
| Tela de modo | `RadioGroup` com itens em cartão (próprio `ModeCard`) | `aria-checked`, Continue (`brand`, `lg`) desabilitado até escolher; hint na barra muda por opção |
| Shell mínimo | próprio `MinimalShell {client?, eyebrow?, right}` | layout de `/onboarding/*` e `/welcome`; `sticky` com `top: env(safe-area-inset-top)` |
| Progresso do wizard | próprio `SetupProgress {step}` (substitui o `WizardRail` de 280 px no onboarding) | % em mono 22 px; 6 botões-passo (`disabled` nos futuros); no celular só a régua; `role="group"` + `aria-current="step"` |
| Barra de ação | a mesma da F0 | 2 botões (Back + lima) ou 3 (Back + Skip outline + lima) com `grid-template-columns: auto 1fr 1fr` no celular |
| Connect Meta | próprio `MetaConnect {state, account, page, health}` | estados: `idle · connecting · choose · checking · ok · warning · blocked · error`; dentro: `Button` (variante nova `meta`), lista de contas = `RadioGroup` em cartões (`AccountRow`), `Select` pra Page, `HealthList` (4 linhas com ícone `ok / warn / bad / wait`), `Alert` `destructive` no erro |
| Tela de retomada | `MinimalShell` + `ClientTile` (o mesmo do Clients) | lima = Continue setup; outros clientes = outline |
| Tour | próprio `TourProvider` + `Spotlight` + `Coachmark` | `Coachmark` = `Card` 360 px com `role="dialog" aria-modal`, foco preso dentro; `Spotlight` = `div` absoluto com `box-shadow: 0 0 0 9999px overlay, 0 0 0 2px --accent`, raio 14, padding 8 em volta do alvo; **sem** `Dialog` do Radix (ele bloqueia a rolagem e não deixa o alvo visível) |
| Home | `KpiTile` (próprio), `AdRow` (próprio), `WaitingCard` (existe), `BrainCard` (existe), `ToggleGroup` 7 / 30 days, `StatusChip` com `working / steady / tiring` (3 valores novos do mesmo componente) | `KpiTile` tem `font-variant-numeric: tabular-nums` |
| Sidebar OWN | `WorkspaceIdentity` (próprio) no lugar do `ClientSwitcher`; `NavLink` Settings no rodapé | decide por `session.user.accountMode` |
| Settings › Connections | `MetaConnect` em modo `settings` (+ Change account, Check again, Disconnect outline-vermelho com confirmação) e o cartão **Account mode** | |

### Padrão do coachmark (vale pra qualquer tour futuro)
- **Alvo:** um `id` estável por parada (`#t-brain`, `#t-winner`, `#t-upload`, `#t-concepts`, `#t-eddy`, `#t-kpis`). O `TourProvider` navega pra rota da parada, espera o alvo existir (`MutationObserver`, timeout 3 s → pula pra próxima parada e registra), rola o alvo pra ~90 px do topo (`scrollIntoView` com `block:'start'` e `scroll-margin-top`).
- **Spotlight:** retângulo do alvo + 8 px, raio 14, borda 2 px lima; o escurecimento é o `box-shadow` de 9999 px (ink a 62 %). Muda de parada animando `top/left/width/height` em 300 ms `cubic-bezier(.2,.7,.2,1)`. Um `div` invisível por cima da tela (`.tour-lock`) bloqueia cliques fora do coachmark.
- **Coachmark:** 360 px, à **direita** do alvo quando cabe (`left = alvo.right + 16`), senão **abaixo** (`top = alvo.bottom + 14`), nunca cobrindo o alvo. Entrada: fade + `translateY(8px → 0)` em 200 ms. Conteúdo: eyebrow "Tour · N of 5" + 5 pontos, título 17 px 800, corpo 14 px, botões Back (ghost, à esquerda) e Next (tinta) ou Finish (lima, só na última). Sem X. `prefers-reduced-motion`: sem transição e sem contagem animada.
- **Celular (≤ 760 px):** spotlight igual; coachmark sempre **abaixo do alvo**, largura total menos 16 px de gutter, botões dividindo a largura. Se o alvo for mais alto que a tela, o spotlight pega só a parte visível (altura máx. = viewport − 160 px) e o coachmark fica fixo embaixo com `safe-area-inset-bottom`.
- **Teclado:** foco preso no coachmark; Tab circula Back/Next; Enter = Next. Esc não fecha na primeira vez (decisão do Tordan); num replay, Esc fecha.

## 5. Telas e estados
| Tela | Rota | Estados no mockup | Observações |
|---|---|---|---|
| How will you use HookMill? | `/welcome` | nothing picked · agency · just me | aparece uma vez por usuário (`accountMode == null`); Continue grava e cria/abre o workspace |
| Wizard · Business | `/onboarding/business` | default · saving | mesmo conteúdo de hoje, shell novo |
| Wizard · Connect Meta | `/onboarding/meta` | not connected · connecting · choose account · health ok · health warning · no permission · login failed | `connecting` mostra o checklist do que já leu; a pessoa pode sair |
| Wizard · passos 3–5 | `/onboarding/{offer,audience,goals}` | (não no mockup) | conteúdo de hoje no shell novo; o `WizardRail` sai, o `SetupProgress` entra |
| Wizard · Build the Brain | `/onboarding/brain` | completing · incomplete · live | lima = Start the tour; Back volta pro passo 5 |
| Resume | `/onboarding/saved` | default (varia por modo) | sem shell do app |
| Setup in progress (MEMBER/CLIENT) | `/onboarding/waiting` | (não no mockup) | "Tordan is setting Mooncloth up · step 2 of 6" + Sign out; se o usuário tem outro workspace LIVE, lista pra trocar |
| Brain | `/brain` | default | "Revisit setup" no cabeçalho; anel de % |
| Settings › Connections | `/settings/connections` | connected · not connected | + cartão Account mode |
| Home | `/` | meta connected · no meta · first sync · meta needs attention | carregando = skeleton **só dos 4 KPIs e das 3 linhas**, com os títulos reais; nunca a página inteira |
| Tour | sobre `/brain`, `/iterate/new`, `/creatives/new`, `/eddy`, `/` | 1 Brain · 2 Winner · 2 Upload · 3 New concepts · 4 Eddy · 5 Home | |
Erro de carregamento de qualquer tela: `Alert destructive` com Retry, no mesmo lugar do conteúdo (padrão de hoje).

## 6. Responsivo (390 px provado no mockup com "Phone 390")
- Tela de modo: cartões empilham; barra de ação fixa embaixo.
- Wizard: topo mostra só o logo-marca + avatar + nome + "Save and exit"; o cartão de progresso vira % + "Step N of 6 · nome" + régua; o painel escuro "Why connect" desce pra baixo do conteúdo; barra de ação fixa com 2 ou 3 botões na largura.
- Lista de contas: uma coluna, chip de status à direita; alvo de toque 44 px.
- Home: KPIs em 2 × 2; linhas de Top ads viram miniatura + nome, com Spend/CPA/ROAS em linha embaixo e o Iterate na largura; Waiting on you em uma coluna; chips de período rolam.
- Tour: coachmark embaixo do alvo, largura total; o spotlight nunca sai da tela.
- Sidebar: o topo escuro do celular mostra o seletor (AGENCY) ou o cartão de identidade sem a linha da Meta (OWN).

## 7. Idioma (EN padrão; chave PT-BR em `next-intl`)
| Chave | EN | PT-BR |
|---|---|---|
| `welcome.title` | How will you use HookMill? | Como você vai usar o HookMill? |
| `welcome.sub` | This sets up your workspace. You can change it later in Settings. | Isso define o seu espaço de trabalho. Dá pra trocar depois em Configurações. |
| `welcome.agency.title` / `.sub` | Agency / I run ads for clients. | Agência / Eu rodo anúncios pra clientes. |
| `welcome.own.title` / `.sub` | Just me / I run my own ads. | Só eu / Eu rodo os meus próprios anúncios. |
| `welcome.pick` | Pick one to continue. | Escolha uma opção pra continuar. |
| `setup.progress` | {pct}% set up | {pct}% configurado |
| `setup.stepOf` | Step {n} of 6 · {name} | Passo {n} de 6 · {name} |
| `setup.saveExit` | Save and exit | Salvar e sair |
| `setup.editEyebrow` | Edit setup | Editar configuração |
| `saved.title` | {name}'s setup is saved at step {n} | A configuração de {name} ficou salva no passo {n} |
| `saved.continue` | Continue setup | Continuar configuração |
| `saved.others` | Your other clients | Seus outros clientes |
| `meta.title` / `.sub` | Connect Meta / So Home shows real results and the tour can start from an ad that already works. | Conectar a Meta / Pra Home mostrar resultados de verdade e o tour começar por um anúncio que já funciona. |
| `meta.cta` | Continue with Facebook | Continuar com o Facebook |
| `meta.skip` | Skip for now | Pular por enquanto |
| `meta.reading` | Reading your ad accounts… | Lendo as suas contas de anúncio… |
| `meta.chooseAccount` | Which ad account is {name}'s? | Qual conta de anúncios é a de {name}? |
| `meta.choosePage` | Which Page runs the ads? | Qual Página roda os anúncios? |
| `meta.noPermission` | No permission | Sem permissão |
| `meta.health.title` | Account health | Saúde da conta |
| `meta.health.ok` | All good | Tudo certo |
| `meta.health.warn` | 1 thing to look at | 1 ponto pra olhar |
| `meta.health.blocked` | Blocked | Bloqueada |
| `meta.check.account` / `.payment` / `.pixel` / `.verified` | Ad account active / Payment method valid / Pixel firing / Business verified | Conta de anúncios ativa / Forma de pagamento válida / Pixel disparando / Negócio verificado |
| `meta.pixelWarn` | Pixel: no purchase events in 7 days | Pixel: sem eventos de compra há 7 dias |
| `meta.blockedBody` | You can't manage ads on this account. Ask the account owner to give you Advertiser (or higher) in Meta Business settings → Ad accounts → People. Then press Check again. | Você não pode gerenciar anúncios nesta conta. Peça ao dono pra te dar Anunciante (ou acima) em Configurações do Negócio → Contas de anúncios → Pessoas. Depois clique em Verificar de novo. |
| `meta.loginFailed` | Facebook didn't finish the login | O Facebook não concluiu o login |
| `meta.checkAgain` / `.changeAccount` / `.disconnect` | Check again / Change account / Disconnect | Verificar de novo / Trocar conta / Desconectar |
| `brain.building` / `.ready` | Building {name}'s Brain / {name}'s Brain is ready | Montando o Cérebro de {name} / O Cérebro de {name} está pronto |
| `brain.live` | {name} is live | {name} está no ar |
| `brain.startTour` | Start the tour | Começar o tour |
| `brain.revisit` | Revisit setup | Revisar configuração |
| `tour.counter` | Tour · {n} of 5 | Tour · {n} de 5 |
| `tour.back` / `.next` / `.finish` | Back / Next / Finish | Voltar / Avançar / Concluir |
| `tour.1.title` | We're building {name}'s Brain | Estamos montando o Cérebro de {name} |
| `tour.2a.title` | This ad is already working | Este anúncio já está funcionando |
| `tour.2b.title` | Start from an ad that worked | Comece por um anúncio que funcionou |
| `tour.3.title` | Or start from a blank page | Ou comece do zero |
| `tour.4.title` | Eddy will read your campaigns | O Eddy vai ler as suas campanhas |
| `tour.5.title` | Home is your scoreboard | A Home é o seu placar |
| `home.synced` | Synced with Meta {ago} | Sincronizado com a Meta {ago} |
| `home.results` | Results | Resultados |
| `home.kpi.spend` / `.cpa` / `.roas` / `.active` | Spend / Cost per purchase / ROAS / Active ads | Gasto / Custo por compra / ROAS / Anúncios ativos |
| `home.kpi.ofCap` | of {cap} monthly cap | de {cap} de teto mensal |
| `home.topAds` | Top ads | Melhores anúncios |
| `home.tag.working` / `.steady` / `.tiring` | Working / Steady / Tiring | Funcionando / Estável / Cansando |
| `home.noMeta.title` | No results here yet | Ainda sem resultados aqui |
| `home.noMeta.cta` | Connect Meta | Conectar a Meta |
| `home.firstSync` | Reading 30 days of results from {account} | Lendo 30 dias de resultados de {account} |
| `home.metaStale.title` | Meta stopped answering {ago} | A Meta parou de responder {ago} |
| `home.reconnect` | Reconnect | Reconectar |
| `shell.ownRole` | Owner | Dono |
| `shell.metaOk` / `.metaOff` | Meta · synced {ago} / Meta not connected | Meta · sincronizada {ago} / Meta não conectada |
| `settings.connections` | Connections | Conexões |
| `settings.accountMode` | Account mode | Modo da conta |
"Cost per purchase" troca pelo resultado derivado do tipo de negócio (`Cost per lead`, `Cost per install`), como já faz o passo 5.

## 8. O que o frontend precisa da API
Bate com os pontos do arquiteto; o que vai além está marcado **pedir ao arquiteto**.
| Tela | Precisa | Fonte |
|---|---|---|
| Welcome | `PATCH /auth/me { accountMode: 'AGENCY' \| 'OWN' }`; `GET /auth/me` devolve `accountMode` (null = ainda não escolheu) | onboarding-v2 |
| Welcome, OWN | o workspace criado no cadastro vira o workspace da pessoa (sem criar outro); nome do negócio no passo 1 | onboarding-v2 |
| Welcome, AGENCY | `POST /workspaces` (New client) direto do Continue, já trocando a sessão | fase2-agencia §3.2 |
| Gate | `GET /workspace` com `status` + `onboarding.step` (já existe); a regra "OWNER/ADMIN em SETUP → `/onboarding/[step]`" mora num `proxy`/middleware do web | onboarding-v2 |
| Setup in progress (MEMBER/CLIENT) | **pedir ao arquiteto:** quem está configurando (`onboarding.updatedBy: { name }`) pra frase "Tordan is setting Mooncloth up"; sem isso a tela mostra só o passo | — |
| Wizard, passos 1/3/4/5/6 | sem mudança (fase2-agencia §3.3) | |
| Connect Meta (passo 2 e Settings) | `GET /meta/oauth/url` → URL do login (popup) · callback grava o token · `GET /meta/accounts` → `{ id, name, actId, currency, canManage: boolean, status }[]` + `pages[]` · `PUT /meta/connection { adAccountId, pageId }` · `POST /meta/health` → `{ account, payment, pixel, verified }` cada um `'ok' \| 'warn' \| 'bad'` + `detail` + `adsCount`, `activeCount` · `DELETE /meta/connection` | meta-v1 (nomes de rota a confirmar com o arquiteto) |
| Connect Meta, erros | `OAUTH_CANCELLED`, `OAUTH_FAILED`, `META_NO_PERMISSION` (por conta), `META_RATE_LIMITED` (mostrar "Meta asked us to wait a minute") | **pedir ao arquiteto** os códigos |
| Tour | `GET /auth/me` → `tourCompletedAt` **por usuário×workspace**; `POST /workspace/tour/complete` | onboarding-v2 |
| Tour, parada 2 | `GET /meta/ads?period=30d` com `winner: true` em no máximo 1 item, `cpa`, `accountAvgCpa`, `spend`, `roas`, `daysRunning`, `thumbnailUrl` | meta-v1 |
| Pick a winner | o mesmo `GET /meta/ads` alimenta "From Mooncloth's Meta account"; "Iterate it" = `POST /champions` a partir de `metaAdId` | **pedir ao arquiteto:** campeão criado a partir de um anúncio da Meta (baixar o vídeo do ad) |
| Home | `GET /meta/insights?period=7d\|30d` → `{ spend, cpa, cpaTarget?, cpaPrev, roas, roasPrev, activeAds, newThisWeek, tiring, syncedAt, syncState: 'ok' \| 'first_sync' \| 'stale', syncProgress? }` + `topAds[3]` (mesmo formato de `GET /meta/ads` + `trend: 'working' \| 'steady' \| 'tiring'`) | meta-v1; **pedir ao arquiteto** a regra do `trend` e o `syncProgress` ("4 of 6 ad sets") |
| Home, Waiting on you e Brain | sem mudança (`meta.waitingOnYou`, `brainCompleteness()` no web) | fase2-agencia §3.6 e §5 |
| Sidebar OWN | `accountMode` + estado da conexão Meta (`GET /meta/connection` → `{ connected, syncedAt, state }`) | meta-v1 |
| Seletor de cliente (AGENCY) | `GET /auth/me.workspaces[]` com `status` e `onboarding.step` pra mostrar "Setup 33 %" | **pedir ao arquiteto** (hoje o `me` só traz id e nome) |
| Settings › Account mode | `PATCH /auth/me { accountMode }`; trocar OWN → AGENCY não cria nada; AGENCY → OWN só com 1 workspace (senão 409) | **pedir ao arquiteto** a regra do 409 |
Polling: Home com Meta segue o `eventos.md` (30 s; 5 s só em `first_sync`). O passo 2 em `connecting` faz polling de 2 s no `GET /meta/accounts` até responder.

## 9. Perguntas em aberto pro Gusta (com recomendação)
1. **Tela de modo antes ou depois de nomear o negócio?** Recomendo **antes** (como o Tordan pediu): a escolha define se o passo 1 pergunta "Client name" ou "Business name" e se o Continue cria um cliente.
2. **"Save and exit" na agência: tela de retomada ou Clients?** Recomendo a **tela de retomada** (shell mínimo) e manter o cartão do Clients como segundo caminho. Se preferir cair direto no Clients, basta trocar o destino; o gate continua segurando o cliente em setup.
3. **"Revisit setup" no Brain** (recomendado) ou também em Settings? Recomendo só no Brain, com Connect Meta em Settings › Connections. Dois lugares pra mesma coisa é o que gerou o "frankenstein".
4. **Tour sem skip, inclusive sem Esc.** Recomendo manter como o Tordan pediu na **primeira** vez, porque são 5 paradas de 1 frase (menos de 2 minutos), e permitir Esc num replay ("Replay tour" no menu da conta). Risco: usuário convidado (MEMBER) também passa pelo tour na primeira entrada em cada workspace; se achar demais, limitar a OWNER/ADMIN.
5. **Parada 4 (Eddy) com a seção Em breve.** Recomendo manter e dizer "Not live yet" na cara, em vez de tirar a parada: o Tordan quer que a pessoa saiba que o Eddy existe. Alternativa: tirar e o tour vira 4 paradas.
6. **Brain 3D.** Recomendo **2D agora** (anel + seções acendendo). O 3D exigiria: three.js (~600 KB) ou o `apps/3d-brain/` adaptado, WebGL no celular (gasta bateria, falha em webview antigo), um modelo de nós/arestas que o Brain v0 não tem (hoje são 13 campos, não um grafo), fallback 2D obrigatório pra `prefers-reduced-motion`, e mais uns 3 dias de frontend. Vale quando o Brain tiver Learnings e Competitors (aí tem grafo de verdade).
7. **Home com 4 KPIs sem gráfico.** Recomendo assim; gráfico de linha entra com Campaigns. Se quiser um sinal de tendência já, um sparkline de 30 pontos dentro do KPI de Spend é o único que eu adicionaria.
8. **Botão azul da Meta** (`#1877F2`). É a única cor de terceiro na interface; recomendo manter porque é o botão de login deles e a pessoa reconhece. Alternativa: botão tinta com o "f" azul só no ícone.
9. **Membro/cliente convidado num workspace em setup.** Recomendo a tela "Setup in progress" (sem shell). Alternativa mais simples: deixar entrar no app só-leitura com um banner; mas é o mesmo "app vazio" que o Tordan rejeitou.

## 10. O que ficou de fora (de propósito)
- Pagamento e planos (arquitetura `accountMode` já nasce pronta pra isso; nenhuma tela de cobrança).
- Passos 3, 4 e 5 do wizard: não mudam de conteúdo, só de shell; não estão no mockup.
- Campaigns, Eddy real, Send to Meta: seguem Em breve; a Home linka "All ads" pro Campaigns Em breve.
- Convite por e-mail, lembrete pra quem parou no meio do setup (vale depois: e-mail "Mooncloth is 17 % set up" em 48 h).
- Tela de login e cadastro (sem mudança).
