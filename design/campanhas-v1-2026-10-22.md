# Campaigns v1 · spec de UX/UI
Data: 2026-10-22 · Status: **proposta, aguarda o OK do Gusta** · Dono: maquina-design
Mockup navegável: https://claude.ai/artifact/6EGLLAf1PkAyYgZ8fDG6Jk · fonte `design/mockup-campanhas-v1.html` (atualize SEMPRE este arquivo, pra o link não mudar). A barra "Prototype" troca estado da página, papel (Owner/Admin · Member · Client), resultado da próxima escrita (ok · mudou no Ads Manager · Meta pede pra esperar · acesso expirou) e Desktop / Phone 390. Ela não faz parte do produto. `#phone` no fim do link abre direto no celular.
Base: `docs/contratos/campanhas-v1.md` (D1–D12; tarefa D4 do §8), `design/onboarding-v2-2026-10-21.md` (shell, tokens, sidebar, Home), `design/fase2-telas-novas-2026-10-12.md` §3 (tokens). Esta spec **não muda a pele**: tema claro com sidebar escura (decisão 12/10), lima como único acento, cor só pra status.

> Dados do mockup (Mooncloth, nomes de campanha, valores) são exemplo. Número de performance vem do snapshot da Meta.

## 1. Problema
O Tordan e o Gusta abrem o Ads Manager pra fazer três coisas por dia: ver o que está gastando e como está indo, desligar o que cansou e mexer no orçamento do que funciona. Hoje o HookMill mostra a conta só na Home (KPIs + 3 anúncios) e a rota `/campaigns` é "em breve". Sem a tela, o vencedor que o HookMill marcou e a peça que ele publicou vivem em mundos separados.

## 2. Decisões e porquê
1. **Desktop: tabela em árvore que expande no lugar (campanha → conjunto → anúncio). Celular: drill-down em cartões.** Na mesa, o que a pessoa compara é número com número entre níveis (o conjunto gasta quanto da campanha? qual anúncio puxa o CPA do conjunto?) e o lugar do orçamento (CBO na campanha, ABO no conjunto) fica visível pela linha em que ele aparece. Drill-down no desktop esconderia o pai enquanto se olha o filho. No celular, recuo de 3 níveis come a largura e a tabela não cabe, então cada nível é uma lista de cartões com migalha ("All campaigns / MC | Sleep mask / Broad US"), e o cartão do pai fica no topo do nível filho como contexto.
2. **Modo "Ads only"** (segmento ao lado do período): lista plana de anúncios com o caminho "campanha › conjunto" embaixo do nome. É o que o link "All ads" da Home abre, ordenado por gasto. Formato padrão `all` nesta tela (o `video` padrão do `GET /meta/ads` vale pro Pick from Meta).
3. **Colunas, nesta ordem:** Status (switch) · Name (nível, contagens, selo HOOKMILL, chip de aprendizado) · Budget · Spend · Purchases · Cost / purchase · CTR · Hook rate · Verdict · ações. Totais do conjunto filtrado na primeira linha (`meta.totals`). Rótulo do resultado e do custo seguem `resultType` ("Purchases"/"Cost per lead"…), como a Home.
4. **Status = switch do shadcn, à esquerda, como no Ads Manager.** O switch reflete o `status` configurado. Se o objeto está ligado mas não entrega por causa do pai, o switch fica verde-claro e aparece o texto "Not delivering · campaign off". Reprovado mostra "Rejected by Meta" em vermelho e o switch desabilitado.
5. **Orçamento mora onde mora.** Campanha CBO: "CBO $250.00/day" com lápis. Campanha ABO: "Set per ad set" cinza. Conjunto em CBO: "Campaign budget" cinza (tooltip "This ad set shares the campaign budget"). Conjunto ABO: "ABO $60.00/day" com lápis. Vitalício: valor + cadeado, sem lápis ("Lifetime budget: edit in Ads Manager"). O web decide pelo `budget.level`, `kind` e `editable`; o 422 `META_BUDGET_NOT_EDITABLE` é rede de segurança.
6. **Período 30 d / 7 d; seta só no 7 d** (contra os 7 d anteriores), embaixo do número, em mono 11 px. Cor pela direção boa da métrica: CPA caindo = verde; CTR, hook rate e resultados subindo = verde; gasto é sempre cinza (subir gasto não é bom nem ruim). Em 30 d não há seta nem espaço reservado.
7. **Veredito:** anúncio mostra chip `Winner` (tinta com texto lima, igual à Home), `OK` neutro ou `Low data` tracejado, mais a tendência `Working` verde / `Tiring` âmbar (Steady só aparece junto do Winner). Campanha e conjunto mostram a contagem ("1 winner · 1 tiring"). Imagem recebe veredito contra a régua de vídeo (D2) e hook rate "—".
8. **Selo HOOKMILL** (mono, lima-claro com borda lima) em campanha, conjunto e anúncio vindos de `MetaPublication`; filtro "Origin: HookMill" no topo. No menu da linha, "Open the HookMill creative" leva pro `/creatives/:id`.
9. **Ações por linha:** anúncio de vídeo tem botão "Iterate" visível (lima no Winner, outline nos outros); imagem tem "Iterate" desabilitado com "Iterate works on video ads". Menu ⋯ (shadcn `DropdownMenu`): Iterate this ad · Open the HookMill creative (se for nosso) · History of this item · Open in Ads Manager (link externo, nova aba).
10. **Toda escrita passa por diálogo de confirmação** (shadcn `Dialog` no desktop, bottom sheet no celular):
    - *Pausar:* "Pause ad set?" + linha do objeto + "It stops delivering now. What's inside keeps its own on/off setting…". Botão tinta "Pause".
    - *Ligar:* "Turn on ad?" + **"This starts spending today."** + orçamento que vai gastar (de onde ele mora) + gasto/CPA dos últimos 30 d. Botão lima "Turn on".
    - *Ligar com pai desligado (D6):* o mesmo diálogo ganha o bloco **"This also turns on"** com a lista dos pais (nível + nome + "Off → On") e o botão vira "Turn on 3 items". O web já sabe pelos snapshots e mostra a lista **antes** de enviar (com `includeParents: true`); se mesmo assim vier `409 META_PARENT_PAUSED`, o diálogo se redesenha com os `parents` da resposta e pede o clique de novo.
    - *Orçamento diário:* objeto, "Now · ABO $60.00/day", campo em mono grande com `$` e `/day`, atalhos −20 % / +20 % / +50 % / +100 %, linha de ajuda "min $5.00 · max this change $120.00". Erro duro, inline e com o Save desabilitado: abaixo do mínimo ("The account minimum is $5.00 a day.") e acima de 2× ("Up to $120.00 in one change (2× the current budget). Raise it in steps, or in Ads Manager."). Aviso âmbar, sem bloquear: acima de +20 % **ou** conjunto (ou campanha com conjunto) em `LEARNING` → "Big changes can restart Meta's learning phase." Rodapé: "Takes effect today. Spend and results update at the next sync."
    - Durante a escrita o botão mostra spinner + texto e fica desabilitado; nada de spinner mudo na página.
11. **Conflito "mudou no Ads Manager" (409 `META_OBJECT_CHANGED`)**: o diálogo troca de conteúdo pra "This changed in Ads Manager after our last sync", com "Our last sync: On · $50.00/day" × "Meta now: Off · $80.00/day" e "We didn't change anything." Botão tinta **"Update row"**: troca a linha pelo `current`, pisca a linha em lima-claro e o toast diz "Row updated from Meta. Check it and try again." Não reenvia sozinho.
12. **Outros erros de escrita ficam dentro do diálogo**, acima dos botões: 503 rate limit → alerta âmbar "Meta asked us to wait · Try again in 60 seconds. Nothing was changed." (Confirm desabilitado até o `retryAfterSec`); token/permissão → alerta vermelho com "Reconnect Meta"; `META_POLICY` → "Rejected by Meta's ad review"; 429 do HookMill → mesmo texto do rate limit. Toda falha também entra no History como **Failed**.
13. **History = gaveta à direita** (shadcn `Sheet`, 460 px; bottom sheet de 88 % no celular). Abre por objeto (menu da linha) ou pela conta (botão "History" no cabeçalho), com segmento "This item / Whole account". Cada item: avatar, "**Tordan** paused ad set **Retarget 30d**", de → para em mono riscado/normal, "+ pais ativados junto" quando houve `alsoChanged`, chip Applied/Failed, data, origem (Campaigns · Send to Meta) e o motivo quando falhou. Frase fixa no topo: "Changes made directly in Ads Manager don't show here." (é verdade e evita a pergunta).
14. **Papéis (D5):** OWNER/ADMIN veem switch, lápis e diálogos. MEMBER vê status como texto (bolinha + On/Off), sem lápis, com faixa azul "Only owners and admins can change Meta. You can sync and iterate."; mantém Sync now e Iterate. CLIENT: mesma leitura, sem Sync now, sem Iterate, chip "View only" ao lado do título; History visível.
15. **Atualização:** ao abrir e no foco da janela (`GET /meta/campaigns`); depois da escrita troca só a linha pelo `object` devolvido e pisca 1,6 s. "Sync now" mostra a etapa real no chip do cabeçalho ("Syncing… reading results 4 of 9") e o toast "Synced with Meta just now" no fim.

## 3. Tokens
Sem token novo de marca. Derivados de superfície pra a árvore (todos sobre `--card`):
| Token | Valor | Uso |
|---|---|---|
| `--row-l1` | `#FAFAF7` | fundo da linha de conjunto |
| `--row-l2` | `#F6F6F2` | fundo da linha de anúncio |
| `--row-hover` | `#F6F7F2` | hover de linha |
| `--info-line` | `#C3CEF6` | borda do alerta azul (já usada inline na onboarding) |
| `--scrim` | `rgba(22,24,27,.55)` | fundo de Dialog e Sheet |
Chip HOOKMILL = `--accent-soft` + `--accent-ink` + borda `--accent-edge`, mono 10 px. Switch ligado = `--ok-dot`; ligado sem entrega = `#8FC9A9` (ok-dot a ~55 %). Delta bom/ruim = `--ok`/`--bad`; neutro = `--fg-3`. Números sempre `font-variant-numeric: tabular-nums` em `--font-mono`.

## 4. Componentes
| Peça | shadcn / próprio | Nota |
|---|---|---|
| Tabela | `Table` do shadcn com `role="treegrid"`, `aria-level`, `aria-expanded` | recuo 22 px por nível; botão chevron 26 px; linha total com `--card-2`; colunas numéricas à direita; `overflow-x:auto` no wrapper (min 1060 px) |
| Cabeçalho ordenável | `Button` ghost dentro do `th` + `aria-sort` | clicar alterna asc/desc; padrão `spend desc`; CPA e Name começam `asc` |
| Status | `Switch` (`role="switch"`) + `StatusText` próprio | clicar abre o diálogo, nunca muda direto |
| Budget | próprio `BudgetCell {budget, canEdit}` | `Button` ghost com lápis quando `editable`; texto cinza nos outros casos |
| Veredito | `Badge` com variantes `win · neutral · dash · ok · warn · info · hm` | mesmas da Home (`StatusChip`) + `dash` e `hm` novas |
| Filtros | `ToggleGroup` (View · Period · Status com contagem · Origin), `Input` de busca com ícone, `Select` de ordenação (só celular) | no celular os grupos rolam na horizontal numa linha |
| Menu da linha | `DropdownMenu` | itens com ícone; "Open in Ads Manager" é `<a target=_blank>` |
| Confirmações | `Dialog` (desktop) / `Drawer` (vaul) no celular | `ObjectLine` próprio (nível, nome, caminho); `Alert` inline pros erros |
| Orçamento | `Dialog` + `Input inputMode="decimal"` + `ToggleGroup` de atalhos | validação local espelha o servidor (mín, 2×); servidor manda |
| History | `Sheet side="right"` / `Drawer` no celular | lista com cursor (`nextCursor`) e "Load more" |
| Primeira leitura | `InkPanel` com Border Beam | só aqui o beam aparece |
| Toast | `Sonner` | fundo `--ink` |

## 5. Estados
| Estado | O que aparece |
|---|---|
| Pronto | cabeçalho com chip verde "Synced with Meta 12 min ago", History, Sync now; filtros; tabela (desktop) ou totais 2×2 + cartões (celular) |
| Carregando | toolbar real + skeleton de 4 linhas com os cabeçalhos reais (celular: 3 cartões skeleton). Nunca a página inteira em skeleton |
| Primeira leitura (`sync.state first_sync`) | painel escuro com beam: "Reading your campaigns from Meta", % grande, barra, e as etapas reais do job (Campaigns 12 read · Ad sets 31 read · Ads 104 read · Results 4 of 9 reads · Winners and trends) + "You can leave this page"; skeleton embaixo |
| Sync antigo (`stale`) | chip âmbar + faixa âmbar "Last sync was 9 hours ago · Numbers are from 05:12. Changes you make still go straight to Meta." + Sync now |
| Sync falhou | chip vermelho + faixa vermelha com a causa e o horário do dado mostrado + "Sync again"; a tabela continua com o último snapshot |
| Sem Meta | cartão vazio "Connect Meta to see your campaigns" + o que vai aparecer + "Connect Meta" (OWNER/ADMIN → Settings › Connections; outros veem "Ask an admin to connect it"); sem filtros, sem History |
| Sem campanhas | "No campaigns in Mooncloth US yet" + "Send a creative to Meta" (lima) + "Open in Ads Manager" |
| Conta inutilizável (`META_ACCOUNT_UNUSABLE`) | faixa vermelha "Meta disabled ads on this account" + link pra conta; tudo visível, switches e lápis desabilitados com o motivo no tooltip |
| Truncado (`truncated: true`) | faixa azul "Showing the 500 most recent campaigns · Older ones are in Ads Manager" |
| Filtro sem resultado | "Nothing matches these filters." + "Clear filters" dentro da área da tabela |
| Busca | o pai aparece quando um filho bate; os pais com filho que bate abrem sozinhos; o trecho buscado ganha fundo lima |
| `META_MODE=off` | continua o `SoonPage` de hoje (sem mockup novo) |

## 6. Responsivo (≤ 760 px; provado com "Phone 390")
- Cabeçalho: título, conta (nome · `act_` · moeda), chip de sync em linha própria, History e Sync now dividindo a largura.
- Filtros: View, Period, Status, Origin numa faixa que rola na horizontal; busca na largura; `Select` de ordenação no lugar do clique no cabeçalho.
- Totais em 2×2 acima da lista.
- Cartão de objeto: nível em mono + nome em 2 linhas no máximo + switch 44×26 à direita; chips (status, HOOKMILL, aprendizado, veredito); grade de 4 métricas (Spend, Purchases, CPA, CTR; no anúncio de vídeo o 4º é Hook rate) com seta no 7 d; rodapé com orçamento editável (campanha/conjunto) ou "Iterate this ad" na largura + ⋯ (anúncio); botão "View N ad sets ›" / "View N ads ›" com 44 px de alvo.
- Diálogos e History viram bottom sheet com botões dividindo a largura e `safe-area-inset-bottom`.
- Nenhuma tabela larga no celular.

## 7. Idioma (chaves `campaigns.*` no `next-intl`)
| Chave | EN | PT-BR |
|---|---|---|
| `title` | Campaigns | Campanhas |
| `synced` | Synced with Meta {ago} | Sincronizado com a Meta {ago} |
| `syncNow` / `syncing` | Sync now / Syncing… | Sincronizar / Sincronizando… |
| `history` | History | Histórico |
| `view.tree` / `view.ads` | Campaigns / Ads only | Campanhas / Só anúncios |
| `period.30d` / `.7d` | Last 30 days / Last 7 days | Últimos 30 dias / Últimos 7 dias |
| `status.all/active/paused/issues` | All / Active / Paused / Issues | Todas / Ativas / Pausadas / Com problema |
| `origin.hookmill` | HookMill | HookMill |
| `search` | Search campaigns, ad sets, ads | Buscar campanha, conjunto, anúncio |
| `col.budget/spend/cpa/ctr/hook/verdict` | Budget / Spend / Cost / purchase / CTR / Hook rate / Verdict | Orçamento / Gasto / Custo / compra / CTR / Hook rate / Veredito |
| `budget.shared` / `.perAdset` / `.lifetime` | Campaign budget / Set per ad set / lifetime | Orçamento da campanha / No conjunto / vitalício |
| `status.on/off/notDelivering` | On / Off / Not delivering · {why} | Ligado / Desligado / Sem entrega · {why} |
| `status.rejected` / `.inReview` | Rejected by Meta / In review | Reprovado pela Meta / Em análise |
| `verdict.winner/ok/lowData` | Winner / OK / Low data | Vencedor / OK / Poucos dados |
| `trend.working/steady/tiring` | Working / Steady / Tiring | Funcionando / Estável / Cansando |
| `learning` / `learningLimited` | Learning / Learning limited | Aprendendo / Aprendizado limitado |
| `iterate` / `iterateFull` / `imageOnly` | Iterate / Iterate this ad / Iterate works on video ads | Iterar / Iterar este anúncio / Iterar funciona em anúncio de vídeo |
| `openAdsManager` / `openCreative` | Open in Ads Manager / Open the HookMill creative | Abrir no Gerenciador / Abrir o criativo no HookMill |
| `pause.title` / `.body` / `.cta` | Pause {level}? / It stops delivering now. What's inside keeps its own on/off setting, so it comes back the same way when you turn this on again. / Pause | Pausar {level}? / Para de entregar agora. O que está dentro mantém o próprio liga/desliga, então volta do mesmo jeito quando você religar. / Pausar |
| `on.title` / `.body` / `.cta` / `.ctaN` | Turn on {level}? / This starts spending today. / Turn on / Turn on {n} items | Ligar {level}? / Isto começa a gastar hoje. / Ligar / Ligar {n} itens |
| `on.parents` / `.parentsBody` | This also turns on / These are off, so this {level} can't deliver until they're on. | Isto também liga / Estão desligados, então este {level} não entrega até eles ligarem. |
| `budget.title` / `.new` / `.save` | Daily budget / New daily budget / Save budget | Orçamento diário / Novo orçamento diário / Salvar orçamento |
| `budget.min` | The account minimum is {v} a day. | O mínimo da conta é {v} por dia. |
| `budget.max` | Up to {v} in one change (2× the current budget). Raise it in steps, or in Ads Manager. | Até {v} numa mudança (2× o orçamento atual). Suba em passos, ou no Gerenciador. |
| `budget.learning` | Big changes can restart Meta's learning phase. Results may wobble for a few days. | Mudança grande pode reiniciar a fase de aprendizado da Meta. O resultado pode oscilar por alguns dias. |
| `budget.note` | Takes effect today. Spend and results update at the next sync. | Vale a partir de hoje. Gasto e resultado atualizam no próximo sync. |
| `err.changed.title` / `.body` / `.cta` | This changed in Ads Manager after our last sync / Meta now shows {now}. We didn't change anything. / Update row | Isto mudou no Gerenciador depois do último sync / A Meta agora mostra {now}. Não mudamos nada. / Atualizar linha |
| `err.rate` | Meta asked us to wait · Too many changes in a short time. Try again in {s} seconds. Nothing was changed. | A Meta pediu pra esperar · Muitas mudanças em pouco tempo. Tente de novo em {s} segundos. Nada foi alterado. |
| `err.token` | Meta access expired · Nothing was changed. Reconnect Meta in Settings › Connections, then try again. | O acesso à Meta expirou · Nada foi alterado. Reconecte a Meta em Configurações › Conexões e tente de novo. |
| `history.note` | Changes made in HookMill, including the ones Meta refused. Changes made directly in Ads Manager don't show here. | Mudanças feitas no HookMill, inclusive as que a Meta recusou. Mudanças feitas direto no Gerenciador não aparecem aqui. |
| `history.applied` / `.failed` / `.fromSend` | Applied / Failed / Send to Meta | Aplicada / Falhou / Enviar pra Meta |
| `empty.noMeta` | Connect Meta to see your campaigns | Conecte a Meta pra ver suas campanhas |
| `empty.noCampaigns` | No campaigns in {account} yet | Ainda não há campanhas em {account} |
| `firstSync` | Reading your campaigns from Meta · About 1 minute left. You can leave this page. | Lendo suas campanhas na Meta · Falta cerca de 1 minuto. Pode sair desta página. |
| `stale` / `failed` / `unusable` / `truncated` | ver mockup (EN e PT completos no dicionário do arquivo) | idem |
| `role.viewOnly` / `role.member` | View only / Only owners and admins can change Meta. You can sync and iterate. | Só leitura / Só dono e admin mudam a Meta. Você pode sincronizar e iterar. |
O dicionário EN/PT completo usado no mockup está no objeto `D` do `mockup-campanhas-v1.html`; o frontend pode copiar as chaves.

## 8. O que o frontend precisa da API
Tudo já está no contrato `campanhas-v1.md`; marcado **pedir ao arquiteto** o que falta.
| Tela / peça | Precisa | Fonte |
|---|---|---|
| Lista em árvore | `GET /meta/campaigns?period&status&origin&q&sort&dir` (raiz) e `GET /meta/campaigns/:id?period` ao expandir (conjuntos + anúncios). Expandir chama o detalhe uma vez e guarda no React Query | §4 |
| Busca com filho que bate | a raiz precisa dizer **quais campanhas têm filho que bate** pra abrir sozinha; **pedir ao arquiteto:** `matchedIn: ('adset'\|'ad')[]` na `MetaCampaignRow` quando `q` está presente (sem isso o web teria que buscar o detalhe de todas) | — |
| Ads only | `GET /meta/ads?format=all&status&origin&period&sort` com `campaignName`/`adsetName` na linha (**pedir ao arquiteto** os dois nomes, hoje só ids) | §3 |
| Contagem no filtro "Issues" | **pedir ao arquiteto:** `meta.counts { active, paused, issues }` no `MetaCampaignsMeta` (o mockup mostra a contagem em Issues) | — |
| Seta 7 d | `metrics7d` e `metricsPrev7d` em todos os níveis | §3 |
| Orçamento | `budget { level, kind, amountMinor, minimumMinor, editable }`; `learningStage` do conjunto; pra campanha CBO o aviso de aprendizado usa "algum conjunto em LEARNING": **pedir ao arquiteto** `anyAdsetLearning: boolean` na `MetaCampaignRow` (ou o web calcula depois de expandir) | §3 |
| Ligar com pais | pais e status já vêm no detalhe; `POST …/status { status, expected, confirm, includeParents }`; tratar 409 `META_PARENT_PAUSED { parents }` | §4.1 |
| Conflito | 409 `META_OBJECT_CHANGED { current: { status, dailyBudgetMinor } }` → "Update row" usa o `current` (sem novo GET) | §4.1 |
| Erros no diálogo | `META_POLICY`, `META_BUDGET_TOO_LOW`, `META_BUDGET_STEP_TOO_LARGE`, `META_BUDGET_NOT_EDITABLE`, `META_ACCOUNT_UNUSABLE`, `META_TOKEN_INVALID`/`META_PERMISSION`, 503 `rate_limited { retryAfterSec }`, 429 `RATE_LIMITED`, 404 `META_OBJECT_GONE` (linha some + toast "This was deleted in Ads Manager") | §4.1 |
| History | `GET /meta/changes?level&objectId&limit&cursor` → `MetaChangeRow` com `by { name }` e `alsoChanged` (**pedir ao arquiteto** os nomes dos pais ativados em `MetaChangeRow`, hoje só ids no modelo) | §4 |
| Sync | `POST /meta/sync`; `meta.sync` com etapa e progresso (`listing_campaigns … reading_insights 4/9 … scoring`) pro chip e pro painel da primeira leitura | §4 |
| Iterate | `POST /iterate { metaAdId }` → navega pro wizard de Iterate; `409 not_a_video` nunca deveria acontecer (botão desabilitado em imagem) | §4 |
| Papel | `session.role` decide switch/lápis/Iterate/Sync; `canToggle` e `budget.editable` por linha mandam no detalhe | §3 |
Polling: nenhum além de abrir/foco; durante sync rodando, 5 s no `GET /meta/campaigns` até `sync.state` sair de `running` (mesmo ritmo da Home).

## 9. Perguntas pro Gusta (com recomendação)
1. **Árvore no desktop + drill-down no celular** (recomendado) ou abas Campaigns / Ad sets / Ads como no Ads Manager? A árvore mostra onde o orçamento mora e compara níveis sem trocar de tela; abas são mais familiares pra quem vive no Ads Manager.
2. **Switch abre diálogo sempre, inclusive pra pausar.** Recomendo sim (contrato pede confirmação em tudo). Se pausar com diálogo irritar no dia a dia, dá pra pausar direto com toast "Undo" por 5 s; ligar continua sempre com diálogo.
3. **Atalhos de orçamento (−20 / +20 / +50 / +100 %)**: +100 % é o teto 2× e já mostra o aviso de aprendizado. Recomendo manter os quatro.
4. **MEMBER vê o switch desabilitado ou só o texto?** Recomendo só o texto (bolinha + On/Off) com a faixa explicando: switch cinza parece defeito.
