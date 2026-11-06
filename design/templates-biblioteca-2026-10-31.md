# Biblioteca de templates · proposta · 2026-10-31
Dono: maquina-design · Status: **PROPOSTA, precisa do ok do Gusta vendo o mockup** · Mockup (não publicado): `design/mockup-templates.html` (barra amarela no topo troca tela e estado).
Origem: ideia do Gusta de 31/10 ("biblioteca de templates, cada template custa crédito; templates de IA geram novos, os de moldura/headline são mais baratos"), referência visual Superscale "Video Templates".
Vale por cima de: `docs/contratos/variacao-auto-v1.md`, `iterate-v2-quiz-templates-ia.md`, `amostra-gratis-v1.md` só no que muda aqui. Decisão que continua valendo: **crédito = o combo todo** (28/10).

## 1. Problema e decisão
- **Hoje:** a pessoa sobe um vencedor, responde um quiz e o Claude escolhe o que fazer. Ela não vê antes o que cada variação parece, e não existe preço por peça.
- **Decisão:** a entrada vira uma **galeria de templates** (cards 9:16 com o vídeo de exemplo tocando). A pessoa escolhe o formato que quer ver, aponta o anúncio, vê o plano e o custo e gera. O "escolhe por mim" de hoje continua, como um **pack** dentro da galeria.
- **Por quê:** (1) o vídeo de exemplo vende o formato melhor que qualquer descrição; (2) preço por template deixa o crédito óbvio ("1 crédito = 1 template de edição"); (3) o pipeline não muda: um template é só o lote AUTO com o tipo travado.

## 2. Fluxo (o que o mockup mostra)
`Templates → (detalhe) → Ad → [Reading, se o anúncio nunca foi lido] → Plan + custo → Generate → Download`
1. **Templates:** busca, abas All / Edit / With AI, chips de categoria, card com vídeo, selo 9:16, `EXAMPLE · PLACEHOLDER`, nome, preço em créditos, 2-3 linhas, "used N×", **Use template**. Clique no card = detalhe; no botão = direto pro passo Ad.
2. **Detalhe (sheet):** player maior, "You get", custo, tempo, idioma, **"Your ad needs"** (rosto, fala, 15 s…). Uma ação lima: **Use this template**.
3. **Ad:** abas Meta winners (com gasto e CPA) / Upload / Library. Cada linha diz se o template cabe: `Fits`, `Needs a face`, `Captions over the face`, ou `Not read yet · ~1 min`.
4. **Reading:** só se o anúncio nunca foi lido. Etapas reais (baixou, transcrevendo 0:31 de 0:58, achando gancho/corpo/CTA, rosto e legenda, checando se o template cabe), barra, "pode sair". Grátis. Thinking Orbs + Border Beam (espera).
5. **Plan:** prévia do template + **os textos que vão sair, editáveis** e com a fonte ("from: Brain › promise"); painel escuro com custo, saldo antes → depois, "se falhar o crédito volta". Lima: **Generate · 1 credit**.
   - **5b, template de IA:** igual ao F3 de hoje: o preparo (roteiro + 3 rostos) é grátis, a pessoa aprova e só então paga. Lima: **Approve and generate · 8 credits**. 3 trocas de rosto grátis.
   - **5c, pack "Let HookMill pick":** lista dos templates de edição que cabem (marcados, pode desmarcar) + IA sugerida desmarcada (tracejado). Total ao vivo.
6. **Generating:** etapas reais, % de render, "crédito reservado, cobrado quando ficar pronto". Enquanto espera: outros templates que cabem no mesmo anúncio.
7. **Download:** player grande no palco escuro, Download MP4, 4:5 e 1:1 (grátis), Send to Meta, "mesmo anúncio, outro template".

**Estados (seletor "State" no mockup):**
| estado | onde | comportamento |
|---|---|---|
| Template não cabe, **suave** (`burned_captions`) | Plan | faixa âmbar: "Upload the version without captions" (lima) · "Generate anyway" (procuramos espaço; sem espaço, crédito volta) · "Pick another template" |
| Template não cabe, **duro** (`no_face`, `no_speech`, `short_video`) | Ad (pílula na linha) e Plan | sem "Generate anyway"; só trocar de anúncio ou de template |
| Saldo insuficiente | Plan / Approve | painel diz "You need N more credits", Generate desabilitado, lima vira **Get credits**. Plano e leitura ficam salvos |
| Get credits (sem gateway) | tela Credits | faixa "Checkout isn't open yet. Talk to us", e-mail como texto + Copiar; pacotes com "Price to be set"; histórico (ledger) |
| Amostra grátis | galeria, Plan, Download | faixa escura "Free sample · 3 of 4 left"; cards de edição com "Free sample"; IA e Static com "Paid plan"; resultado com 3 s nítidos e o resto borrado, lima **Unlock full videos** |
| Biblioteca carregando | galeria | skeleton dos cards |
| Busca sem resultado | galeria | "No template matches…" + Clear search |
| Library vazia | Ad › Library | "Nothing in your Library yet" + ir pros Meta winners |

## 3. (a) Catálogo de hoje → templates
Custo real estimado por **uso** (o que o template entrega), com os preços de `api/src/integracoes/catalogo/precos.ts` e dos contratos. Render Lambda ≈ US$ 0,011 por 30 s (sonda L1); checagem de texto por visão ≈ US$ 0,008/render; tokens do plano ≈ US$ 0,01–0,03 por template (a ia mede). **A leitura do anúncio** (Whisper US$ 0,002/s + Claude) ≈ US$ 0,10–0,25 por anúncio, **uma vez por anúncio**, e não cobra crédito (estimativa; o real sai das `cost_entries`).

| template (card) | tipo interno | tier | entrega | custo real estimado (US$) |
|---|---|---|---|---|
| Breaking news, Meme POV, Post card, Question box, Top 5, Live, Call (+ Cinema, Story, Read the caption, POV testimonial, Direct offer) | `FRAME:<id>` B1 (12 molduras) | Edit | 1 vídeo | ≈ 0,02–0,04 |
| Split screen, Split torn, Meet dialog, Gossip page ×3 | `FRAME:<id>` B2 (6, b-roll Pexels grátis) | Edit | 1 vídeo | ≈ 0,02–0,04 |
| New headline | `HEADLINE` ×3 | Edit | 3 vídeos | ≈ 0,06–0,09 |
| Short cuts | `CUT` 15 s + 20 s | Edit | 2 vídeos | ≈ 0,04–0,06 |
| Cold open · Offer end card · Native search | `COLD_OPEN` · `ENDCARD` · `NATIVE_SEARCH` | Edit | 1 vídeo | ≈ 0,02–0,04 |
| Layouts (Split LP, Story, Review) | `SPLIT_LP` · `STORY` · `REVIEW` | Edit | 1 vídeo | ≈ 0,02–0,04 |
| Chat DM | `CHAT_DM` | Edit | 1 vídeo, só 9:16 | ≈ 0,02–0,03 (contrato F1.8) |
| Person + motion | `PERSON_MOTION` | Edit | 1 vídeo, só 9:16 | ≈ 0,02–0,03 |
| Static ad | `STATIC` (GPT Image 2 high 2k) | Edit | 1 imagem | 0,41 · pior caso com refação 0,81 |
| New face | `AVATAR_FACE` | AI | 3 vídeos | ≈ 2,3 (3 × rosto 0,006 + take ~30 s × 0,025) |
| New persona | `AVATAR_PERSONA` | AI | 3 vídeos | ≈ 2,6 |
| Found it by accident | `REMIX_DISCOVERY` | AI | 1 vídeo + 2 ganchos | Pruna ≈ 1,1 · Kling ≈ 6,8 |
| Podcast clip | `REMIX_PODCAST` | AI, **beta escondido** | 1 vídeo + 2 ganchos | Pruna ≈ 1,3 · Kling ≈ 7 (fora até a sonda) |

`HOOK_TEXT` entra no card "New headline" (o mesmo gesto pro usuário). Specialist e Street interview ficam fora (contrato F3.1).

## 4. (b) Preço em créditos (proposta; o valor do crédito fica com o Gusta)
Regra: **1 template de edição = 1 crédito**, qualquer que seja o nº de vídeos que ele entrega (é o que o Gusta disse: "cada template vai custar um crédito"). IA custa mais e cobre o combo todo (preparo, geração, refações).

| tier | créditos | custo pior caso (US$) | valor do crédito pra margem 3× |
|---|---|---|---|
| Edit (moldura, headline, corte, chat, pessoa+motion, layouts) | **1** | ≤ 0,09 | ≥ US$ 0,27 |
| Static | **2** | 0,81 (com refação) | ≥ US$ 1,22 (típico 0,62) |
| New face | **8** | ≈ 2,3 | ≥ US$ 0,86 |
| New persona | **9** | ≈ 2,6 | ≥ US$ 0,87 |
| Found it by accident (motor Pruna) | **6** | ≈ 1,1 | ≥ US$ 0,55 |
| Pack "Let HookMill pick" | soma dos marcados, **teto de 10** (até 12 vídeos de edição) | ≤ 1,0 | — |

- **Leitura:** com o crédito vendido a **≈ US$ 1 (≈ R$ 5–6)**, tudo fecha com 3× ou mais, menos o Static no pior caso (2,5×). Abaixo de US$ 0,86 a IA fica abaixo de 3×.
- **Motor do Remix:** o preço fixo pressupõe Pruna. Se a IA escolher Kling (decisão 28/10 "motor pela IA"), o custo vai a US$ 6,8 e o template perde dinheiro a 6 créditos. **Recomendo:** Pruna dentro deste template; Kling vira um template separado ("Cinematic", ~20 créditos) se valer.
- **Falha:** crédito reservado no Generate, cobrado quando a peça fica pronta, devolvido se falhar de vez. Na IA, devolve a parte da peça que falhou (1/3).
- 4:5 e 1:1 não cobram (como hoje).

## 5. (c) Backend: o que é novo e o que se reaproveita
**Novo**
1. **Catálogo de templates** (tabela `Template`): `slug`, nome e descrição EN/PT, `tier`, `credits`, `internal` (`{ type: AutoVariationType; frameId?: FrameTemplateId; count?: number }`), `needs` (chaves dos `blockedReason`), `category`, `order`, `status` (`DRAFT` | `LIVE` | `HIDDEN`), `exampleVideoKey` + `posterKey` (R2), `uses` (contador). Sem vídeo de exemplo = não aparece pro cliente.
2. **Créditos:** `balance` + **ledger** append-only (`CreditEntry`: `delta`, `kind` `grant|reserve|charge|refund|manual`, `templateRunId`, `balanceAfter`, `byId`). Reserva no Generate, liquida no `RENDER_READY`/`DONE`, estorna no `failed` definitivo. Onde mora (conta ou workspace) segue o P1 da amostra (proposta: conta).
3. **Rotas:** `GET /templates?adId=` (lista + `fit` por anúncio já lido) · `GET /templates/:slug` · `POST /templates/:slug/use { source }` → cria o lote com o tipo travado (pula o quiz) e devolve o id · `POST /iterate/:id/start { expectedCredits }` (409 `CREDITS_CHANGED`, 402 `INSUFFICIENT_CREDITS { need, balance }`) · `GET /credits` · `GET /credits/ledger` · admin: `POST/PATCH /admin/templates`, `POST /admin/templates/:slug/example` (URL pré-assinada R2), `POST /admin/credits/grant`.
4. **Compatibilidade antes de cobrar:** `allowedFor` passa a responder "este tipo neste anúncio" (`fit: 'ok' | 'soft' | 'hard'` + `reason`). `soft` = `burned_captions` (libera "Generate anyway"); `hard` = `no_face`, `no_speech`, `short_video`.

**Reaproveita sem mudar a ideia:** leitura do campeão (cacheada por anúncio), `planAutoBatch` com `allowed` = só o tipo do template (o Claude escreve só os textos daquele template), validação "nada inventado", render Lambda, checagem por visão, item de IA do F3 (preparo grátis → aprovação → geração), `cost_entries`, Library, Download, Send to Meta, prévia borrada da amostra.

**Muda na amostra:** de "1 lote de até 4 peças" pra **"4 usos de template de edição"** (o Gusta disse "os 4 primeiros grátis"). Static e IA ficam travados na amostra.

## 6. (d) Navegação
- **Recomendo:** "Iterate a winner" vira **"Templates"** no grupo Make ads (`Templates · New concepts · Review · Library`). O quiz e o auto de hoje viram o card **"Let HookMill pick"** dentro da galeria; não some, mas deixa de ser a porta.
- **Entrada pelo anúncio também:** em Campaigns, "Make variations" numa linha vencedora abre Templates com o anúncio já escolhido; os cards mostram `Fits` / `Needs a face` e o fluxo pula o passo Ad.
- **Saldo sempre visível:** medidor no rodapé da sidebar (desktop) e pílula na barra do topo (celular), ambos levam a Get credits.
- **Recomendação sobre o pack:** fica, com teto de 10 créditos. É o caminho mais rápido pra quem não sabe o que testar, e o teto deixa o pack mais barato que escolher 12 um a um.

## 7. (e) Vídeos de exemplo
- O Gusta sobe pelo **Admin · Templates** (só staff): tabela com miniatura, tipo interno, tier, créditos editáveis, usos, status e "Upload / Replace video". Sem vídeo = `Needs example`, escondido do cliente.
- Arquivo: MP4 9:16, até 60 s. Fica no R2 (`templates/<slug>/example.mp4` + pôster gerado por ffmpeg). No card toca mudo em loop quando entra na tela (`preload="none"`, pôster antes); no detalhe toca com som ao clicar.
- Os vídeos devem ser do próprio HookMill (ofertas nossas), nunca de cliente.

## 8. Tokens e componentes (frontend)
- **Tokens:** os de `web/src/app/globals.css`, sem token novo. Lima só na ação da tela (Use this template, Continue, Generate, Get credits quando falta saldo). Preço de IA em pílula tinta (`--ink`), edição em pílula clara; status por cor (verde Fits, âmbar não cabe/espera, azul rodando).
- **shadcn:** `Tabs` (All/Edit/With AI, fontes do anúncio) · `ToggleGroup` pros chips · `Input` busca · `Card` · `Sheet` (detalhe; `side="bottom"` no celular) · `RadioGroup` (lista de anúncios) · `Checkbox` (pack) · `Badge` (preço, fit) · `Progress` · `Skeleton` · `Alert` (não cabe, sem checkout) · `Table` (ledger, admin) · `Sonner` (toasts). Reusar `FlowBar`, `IterActionBar`, painel escuro do Iterate e o `TypeThumb`.
- **Vídeo do card:** `<video muted playsinline loop preload="none" poster>` com IntersectionObserver; só 1 com som por vez. `prefers-reduced-motion` = pôster parado.

## 9. Responsivo (provado no mockup em 390 px)
- Galeria em 2 colunas, chips rolando na horizontal, abas ocupando a largura, descrição em 2 linhas, botão do card largura cheia.
- Detalhe abre como sheet de baixo; lista de anúncios empilha (métrica e fit embaixo do nome).
- Barra de ação fixa embaixo em todos os passos (com safe-area), Back some no celular (o voltar do sistema faz o papel).
- Sidebar vira drawer; saldo fica na barra do topo.

## 10. O que cada tela pede à API
| tela | precisa |
|---|---|
| Templates | `GET /templates` (slug, nome, desc, tier, credits, category, out, exampleUrl, posterUrl, uses, beta) · `GET /credits` · `access`/amostra restante |
| Ad | Meta winners (já existe, com gasto e CPA) · uploads · Library · `GET /templates?adId=` pra `fit` por linha |
| Reading | `GET /iterate/:id` (etapas e checklist da análise, já existe) |
| Plan | plano do tipo travado com textos + `source` · `PATCH` dos textos (grátis) · `estimate { credits, balance }` · `fit` |
| Approve (IA) | item de IA do F3 (rostos, trocas grátis restantes) |
| Generating / Download | `GET /iterate/:id` (já existe) · formatos 4:5/1:1 · Send to Meta |
| Credits | `GET /credits/ledger` · contato (sem checkout) |
| Admin | CRUD do catálogo + upload pré-assinado |

## 11. Decisões pro Gusta
1. **Templates substitui "Iterate a winner" na sidebar** e o auto vira o pack. Recomendo sim.
2. **Tabela de créditos:** Edit 1 · Static 2 · New face 8 · New persona 9 · Found it by accident 6 · pack teto 10.
3. **Valor do crédito:** em aberto. Pra margem ≥ 3× na IA, ≥ US$ 0,86 (≈ R$ 5); recomendo ≈ US$ 1.
4. **Amostra = 4 usos de template de edição** (no lugar de 1 lote de 4 peças). Recomendo sim.
5. **Remix com Kling** vira template separado e mais caro, em vez do motor escolhido pela IA dentro do mesmo preço. Recomendo sim.
6. "Generate anyway" só pra legenda queimada; rosto ou fala faltando bloqueiam. Recomendo sim.
