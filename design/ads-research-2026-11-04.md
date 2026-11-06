# Ad Radar (Meta Ads Research) · spec de UX/UI · 2026-11-04
Dono: maquina-design · Status: **proposta, aguarda o Gusta aprovar vendo o mockup.** Nenhum código mexido.
Mockup navegável: https://claude.ai/artifact/TJQ1xyEsLUyR8wk5oN7WaP · fonte `design/mockup-ads-research.html` (atualize SEMPRE este arquivo; a barra amarela troca Desktop/Phone 390 e o estado).
Base: pedido do Gusta de 04/11 ("Meta Ads Research": anúncios da Ad Library dos concorrentes, transformar um em campeão e variar com Templates). Linguagem visual, tokens e shell = `mockup-templates.html` / `mockup-tour-v2.html` (fundo `#eeeeea`, sidebar ink, lima só na ação principal, Archivo + IBM Plex Mono). Referência de mercado: aba Research do Superscale (`reports/superscale-reverse-engineer-2026-10-29.md`).
Contrato: `docs/contratos/ads-research-v1.md` **ainda não existia** quando esta spec foi escrita; o §8 lista o que o design assume. Se o contrato divergir, vale o contrato e esta spec se ajusta.

## 0. Em 6 linhas
1. Item novo **"Ad Radar"** no topo do grupo *Make ads* da sidebar, acima de Templates (é o passo antes dele).
2. 1ª vez = tela de setup: sugestões do Cérebro (com o motivo) + colar link; até **10 concorrentes**; pesquisa **não gasta crédito**.
3. Feed em grade, **ordenado por "rodando há mais tempo"**, selo **Likely winner** (ativo ≥ 30 d **ou** ≥ 5 versões), vídeo toca mudo no hover.
4. Clique no card = detalhe (player grande à esquerda, dados e texto à direita). Ação lima: **Use as champion**.
5. "Use as champion" abre **Templates fixado nesse anúncio**, com a leitura (~1 min, grátis) rodando na faixa do topo; os cards passam de "Checking fit…" para Fits / Needs a face. Mesmo padrão do vencedor da Meta (tour-v2 §2.3).
6. Do concorrente fica a **estrutura** (gancho, ritmo, formato); oferta, voz e claims vêm do Cérebro. A tela diz isso.

## 1. Problema e decisão
- **Hoje:** pra variar um anúncio de concorrente a pessoa baixa o vídeo por fora e sobe no passo do anúncio. Não há como ver o que o mercado está rodando dentro do HookMill, e o Cérebro tem a categoria Competitors vazia (`soon-pages.tsx:100`).
- **Decisão:** uma seção própria que acompanha os concorrentes do workspace, guarda a mídia do nosso lado e entrega o anúncio pronto como fonte de Templates.
- **Por quê:** (1) "anúncio que roda há muito tempo" é o melhor sinal público de vencedor, já que a Ad Library não mostra gasto; ordenar por isso responde direto "o que eu devo copiar"; (2) reusar o passo de leitura + galeria fixada não cria fluxo novo de geração; (3) concorrentes acompanhados alimentam o Cérebro.

## 2. Nome (decisão do Gusta)
| opção | EN / PT-BR | prós | contras |
|---|---|---|---|
| **Ad Radar** (recomendo) | Ad Radar / Radar de anúncios | curto, cabe na sidebar, diz "vigiar"; é o mesmo nome do radar interno que já existe (`projects/mentoria-spy/ad-radar/`) | menos explícito sobre "concorrente" |
| Competitor Ads | Competitor Ads / Anúncios dos concorrentes | autoexplicativo | longo na sidebar em PT; trava o escopo (no futuro: anúncios por nicho, não só concorrente) |
| Research | Research / Pesquisa | é o que o Superscale usa; aceita Trends depois | genérico; não diz o que tem dentro |
O mockup usa **Ad Radar**. A rota sugerida é `/radar` (independe do nome final).

## 3. Fluxo
`Sidebar › Ad Radar → [Setup, só na 1ª vez] → Feed → Detalhe → Use as champion → Templates fixado (lendo → Fits) → Plan → Generate` (daí em diante, igual a Templates).
Atalho: "Use as champion" também existe no card (sem abrir o detalhe). "Save" guarda no **Saved** do Radar e o anúncio aparece numa aba nova **Saved ads** no passo do anúncio de Templates.

## 4. Telas
### 4.1 Setup (1ª vez, workspace sem concorrentes)
- Esquerda: card **Suggested from your Brain**: linha com avatar, nome, **motivo** ("Named on your site's comparison page", "Same category and price range in your Brain", "Shows up in your audience's interests", "Mentioned in 3 customer reviews") e estimativa "≈ 40 active ads". Botão Add/Added (toggle, `aria-pressed`). Top 3 vêm marcados.
- Card **Add one we missed**: campo único que aceita link de página do Facebook, @ do Instagram ou link da Ad Library (`?view_all_page_id=`). Erro inline (ver §5).
- Direita (painel ink, como o painel de custo do Plan): "Competitors N of 10", país (vem do mercado do Cérebro, "Change"), "Included in your plan. Research uses no credits; Templates do.", "First sync takes a few minutes per competitor. You can leave", "We check every competitor once a day". Lima: **Start research · N competitors** (desabilitado com 0).
### 4.2 Feed
De cima pra baixo:
1. Cabeçalho (eyebrow Make ads, h1, 1 linha) + "Updated 2 h ago · next check 06:00".
2. Faixa (alerta) quando houver: sync em andamento, erro, limite.
3. **Faixa de concorrentes** (chips com avatar, nome, "38 active"): "All competitors" + um por concorrente (filtro de 1 seleção) + "+ Add competitor · 4 of 10". Chip em sync tem Border Beam azul e "reading 18 of ~40"; chip com erro tem o texto em vermelho "didn't answer".
4. Abas **All ads / Saved (n)**.
5. Filtros: Status `Active | All | Inactive` (padrão Active) · Formato `All | Video | Image` · Running `any / 7+ / 30+ / 90+ dias` · País · Idioma · à direita Ordenar `Running longest` (padrão) / `Newest first` / `Most versions`.
6. Linha de resumo: "126 ads · 41 likely winners" + a regra do selo em texto pequeno ("“Likely winner” = active 30+ days or 5+ versions"). A regra fica visível porque é proxy, não dado da Meta.
7. Grade `auto-fill minmax(196px,1fr)`.

**Card do anúncio** (todos com a mesma altura de bloco):
- Mídia em moldura **4:5** fixa (`object-fit: cover`; o original 9:16/1:1 aparece inteiro no detalhe). Canto sup. esquerdo: selo lima **Likely winner** ou cinza **Inactive**. Canto sup. direito: `VIDEO 0:41` / `IMAGE`.
- Vídeo: no desktop toca **mudo no hover** (com barrinha de progresso embaixo); só 1 por vez. No celular não toca no card; toque abre o detalhe.
- Linha: avatar + nome do concorrente + **"214 d"** (mono, à direita; inativo = "ended").
- 2 linhas do texto principal.
- Pílulas: plataformas (`FB · IG · AN`), país (só desktop), "9 versions" (só se > 1).
- Ações: **Use as champion** (botão ink, não lima: lima numa grade de 40 cards quebra a regra de 1 lima por tela) + Save (ícone bookmark, `aria-pressed`). No celular o botão vira "Use".
### 4.3 Detalhe
- Desktop: `Sheet` da direita, 860 px, duas colunas: **player ink** (vídeo no formato original, controles, nada por cima) | painel de 360 px.
- Painel: pílulas Active / Likely winner / formato · headline · caixa lima-clara **Why "likely winner"** ("Running 214 days with 9 versions live. Meta doesn't show competitors' spend; brands rarely keep a losing ad on for a month.") · lista Started / Running / Platforms / Country / Language / Button / Goes to (domínio) · **versões** (miniaturas v1…v6 clicáveis, troca o player; "9 versions running · same ad, different text") · texto completo + Copy · **Open in Meta Ad Library ↗** · "Library ID … · last checked 2 h ago".
- Rodapé fixo: lima **Use as champion** + Save.
- Celular: tela cheia, player em cima (520 px), dados embaixo, ações fixas no rodapé.
### 4.4 Use as champion → Templates
- Abre `/templates?researchAdId=<id>` com a faixa fixada (`pinned`, a mesma do vencedor): miniatura + "Champion · Nightfold · “I stopped waking up at 3am”" + etapa real da leitura (Saved the video → Transcribing 0:41 → Finding hook, body and offer → Checking face and captions) + barra + "about 1 min, free. You can pick templates now." + **Change ad**.
- Nota fixa embaixo: "From a competitor ad we keep the structure: the hook, the pacing, the format. Your offer, product, voice and claims come from your Brain. Their logo, product shots and claims don't come along."
- Cards: "Checking fit…" durante a leitura, depois `Fits` / `Needs a face` (regras de `fit` já existentes). Pode marcar template antes da leitura acabar; o Generate só libera com `fit` resolvido.
- Se o anúncio já foi lido antes (outro usuário do workspace), pula direto pro estado lido.

## 5. Estados
| estado | onde | o que aparece |
|---|---|---|
| 1ª vez | Radar | Setup (§4.1) |
| 1ª sincronização | Feed | card "First sync · 1 of 3 competitors done · you can leave this page" com uma linha por concorrente (done / reading 18 of ~40 + barra / waiting); anúncios entram na grade conforme cada concorrente termina; skeletons no fim; badge "syncing" no item da sidebar. Saiu e voltou: retoma no mesmo ponto (estado vem da API) |
| carregando | Feed | skeleton de 10 cards (4 no celular); faixa e filtros já desenhados |
| erro de 1 concorrente | Feed | `Alert destructive`: "Meta's Ad Library didn't answer for Softwake. Last good sync was yesterday at 06:10. We'll try again in 15 minutes; the other competitors are up to date." + **Retry now**. Os anúncios já salvos dele continuam visíveis |
| erro geral (API fora) | Feed | mesmo alerta, sem grade, com Retry |
| link inválido | Setup / Add | erro inline: "We couldn't find a Facebook page at that link. Open the brand's page on Facebook and copy the address from the browser, or paste their Ad Library link." |
| concorrente sem anúncios | Feed (chip selecionado) | vazio tracejado: "Duskwear has no active ads in the United States. Their last ad stopped on Sep 12, 2026. We check every day…" + Show 12 past ads · Check other countries · Stop following |
| limite (10/10) | Feed + Add | alerta âmbar "You're following 10 of 10 competitors. Remove one to add another." ; o modal Add vira lista com Remove. Saved não some ao remover |
| filtros sem resultado | Feed | "No ads match these filters" + Clear filters |
| Saved vazio | aba Saved | "Nothing saved yet. Tap the bookmark… Saved ads also show up in Templates." |
| mídia expirou na Meta | card/detalhe | não deve acontecer: a mídia é copiada pro R2 na sync (§8). Se faltar: pôster cinza "Video unavailable" e o card perde "Use as champion" |
| CLIENT (só leitura) | Radar | vê o feed e o detalhe; sem Add, sem Use as champion, sem Save |
| amostra grátis | Setup | limite de **3** concorrentes (proposta), mesmo resto; Use as champion leva pra Templates com as regras da amostra |

## 6. Responsivo (provado no mockup em 390 px)
- Sidebar vira topbar ink com menu; pílula de saldo no topo.
- Faixa de concorrentes rola na horizontal.
- Filtros viram botão **Filters · n** que abre um bottom sheet (Status, Format, Running, Country, Language; "Show N ads"); Ordenar fica visível ao lado.
- Grade de 2 colunas; botão "Use" + bookmark.
- Detalhe em tela cheia com ações fixas embaixo (safe-area). Setup em 1 coluna, painel ink depois das sugestões.

## 7. Componentes e tokens (frontend)
- **Tokens:** os de `web/src/app/globals.css`, nenhum novo. Lima: Start research (setup), Use as champion (só no detalhe), selo Likely winner (fundo lima com texto ink, é estado de "bom", como o anel de vencedor da Home). Azul = sync em andamento; vermelho = erro; âmbar = limite.
- **shadcn:** `Tabs` (All/Saved) · `ToggleGroup` (Status, Formato; chips de concorrente) · `Select` (Running, País, Idioma, Ordenar) · `Card` · `Sheet` (detalhe `side="right"`, celular `side="bottom"` em altura cheia; filtros `side="bottom"`) · `Dialog` (Add competitor) · `Input` · `Badge` · `Progress` · `Skeleton` · `Alert` · `Avatar` · `ScrollArea` horizontal (faixa de concorrentes, versões) · `Sonner` ("Saved · also in Templates › Saved ads").
- Próprios: `CompetitorChip` (com variante `syncing` usando o Border Beam do libraries.dev, único efeito da tela, só em espera), `ResearchAdCard`, `AdPlayer` (reusar o player da Biblioteca), `WhyWinner`, `VersionStrip`. Reusar `pinned` do Templates.
- Vídeo do card: `<video muted playsinline loop preload="none" poster>` só no hover (desktop) via `pointerenter`; `prefers-reduced-motion` = pôster parado.

## 8. O que o frontend precisa da API (para o maquina-arquiteto conferir no contrato)
| tela | precisa |
|---|---|
| Setup | `GET /research/suggestions` → `{ name, pageId?, handle?, reason, estActiveAds? }[]` (do Cérebro: site, reviews, interesses Meta) · `POST /research/competitors/resolve { input }` → página encontrada ou `422 PAGE_NOT_FOUND` · `GET /research/limits` → `{ used, max, country }` |
| Concorrentes | `GET /research/competitors` → `{ id, name, handle, avatarUrl, pageId, activeCount, totalCount, sync: { status: 'queued'\|'running'\|'done'\|'failed', read, estTotal, lastOkAt, nextAt, error? } }[]` · `POST /research/competitors` (lote) · `DELETE /research/competitors/:id` (`409 LIMIT_REACHED` no POST) · `POST /research/competitors/:id/sync` (Retry) |
| Feed | `GET /research/ads?competitorId&status=active\|inactive\|all&format&minDays&country&lang&sort=longest\|newest\|versions&saved=1&cursor` → `{ id, competitorId, format, durationSec, posterUrl, mediaUrl (R2), aspect, primaryText, headline, cta, linkDomain, platforms[], countries[], lang, startedAt, endedAt?, active, daysRunning, versionsCount, likelyWinner, libraryId, libraryUrl, lastCheckedAt, saved }` + `totals { ads, likelyWinners }`. **Paginação por cursor.** `likelyWinner` calculado no servidor (regra configurável) |
| Detalhe | `GET /research/ads/:id` + `versions[] { posterUrl, mediaUrl, primaryText, headline }` |
| Save | `PUT/DELETE /research/ads/:id/save` · Templates: aba Saved ads no passo do anúncio lê `GET /research/ads?saved=1` |
| Use as champion | `POST /research/ads/:id/champion` → cria/reaproveita o **anúncio-fonte** (mesma entidade do upload/Meta winner, `source: 'research'`) e dispara a leitura; devolve `adId`. Templates abre com esse `adId` e usa `GET /templates?adId=` (já existe) |
| Polling | 5 s enquanto algum concorrente estiver `running`; senão 60 s |

**Riscos que o arquiteto precisa resolver (não são de design, mas mudam a tela):**
1. **Fonte dos dados.** A API oficial da Ad Library da Meta só devolve anúncios políticos/sociais e anúncios veiculados na UE/Reino Unido; anúncio comercial nos EUA/Brasil precisa de scraper (ex.: Apify). Custo por anúncio e limite por dia definem o "10 concorrentes, 1 checagem/dia" desta spec. Se o custo for alto, a pesquisa passa a gastar crédito e o setup ganha a linha de custo.
2. **Mídia expira.** Os links de vídeo da Ad Library vencem; a sync precisa copiar mídia + pôster pro R2 (no mínimo dos anúncios ativos e dos salvos).
3. **"Versões":** a Ad Library agrupa "N ads use this creative"; o contrato define se versão = mesmo criativo com textos diferentes (o que o mockup assume).

## 9. i18n (chaves novas, namespace `radar`)
`radar.title` Ad Radar / Radar de anúncios · `radar.lede` What your competitors are running on Facebook and Instagram right now… / O que os seus concorrentes estão rodando agora no Facebook e no Instagram… · `radar.setup.*` (suggested, why, paste, pasteError, summary, start) · `radar.sync.*` · `radar.filters.*` · `radar.sort.{longest,newest,versions}` · `radar.card.{use,useShort,save,saved,days,ended,versions}` · `radar.winner.{badge,rule,why}` · `radar.detail.*` · `radar.empty.{noads,nomatch,saved}` · `radar.limit.*` · `radar.champion.note` ("From a competitor ad we keep the structure…" / "Do anúncio do concorrente a gente mantém a estrutura: gancho, ritmo e formato. Oferta, produto, voz e claims vêm do seu Cérebro. Logo, imagens de produto e claims deles não vêm junto."). O conteúdo dos anúncios aparece no idioma original.

## 10. Aceite
- 1440: grade sem card sozinho esticado; todos os cards com a mesma altura de bloco; no máximo 1 botão lima visível (setup: Start; feed: nenhum; detalhe aberto: Use as champion).
- Ordem padrão = `daysRunning desc`; o selo só aparece em anúncio ativo.
- Hover toca só 1 vídeo, mudo; sair do card pausa.
- Use as champion chega em Templates com o anúncio fixado, leitura visível com etapa real, e nunca cobra crédito antes do Generate.
- 390: faixa de concorrentes e versões rolam dentro do próprio contêiner; página sem rolagem horizontal; detalhe e filtros completáveis com o polegar.
- EN e PT-BR com as chaves do §9.

## 11. Decisões pro Gusta
1. **Nome:** Ad Radar (recomendo) · Competitor Ads · Research.
2. **Lugar na sidebar:** topo de *Make ads*, acima de Templates (recomendo) ou no grupo Workspace, ao lado do Cérebro.
3. **Pesquisa sem crédito, limitada por concorrentes** (10 no pago, 3 na amostra, 1 checagem/dia). Recomendo, se o custo do scraper couber (risco 1 do §8).
4. **Regra do Likely winner:** ativo ≥ 30 dias **ou** ≥ 5 versões rodando. Ajustável depois.
5. **Do concorrente só a estrutura**, oferta e claims do Cérebro, com a nota visível em Templates. Recomendo sim (evita copiar claim e marca alheios).

## Ajuste do Gusta (04/11)
- Botões do card sempre alinhados: ações presas no rodapé do card (`margin-top: auto`), na mesma linha entre cards vizinhos, mesmo com textos/pílulas de alturas diferentes. Vale pra implementação.
