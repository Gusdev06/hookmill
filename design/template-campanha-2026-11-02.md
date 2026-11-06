# Template de campanha no fluxo de publicação (formato Gerenciador) · spec de UX/UI
Data: 2026-11-02 · Dono: maquina-design · Status: **PROPOSTA, precisa do ok do Gusta vendo o mockup**
Mockup: `design/mockup-template-campanha.html` · Artifact: https://claude.ai/artifact/PefZsMQVaWQd2bcddSR3Na
Barra "Prototype": **Account** (1 sem template · 2 com templates · 3 Meta desconectada), **Jump to** (Send · Editor novo · erros de campo · salvando), **Width** (Desktop 1440 / Phone 390). Dados são exemplo.
Origem: pedido do Gusta de 02/11 (`docs/backlog.md`), Loom do Tordan 29/10 §2 e §5. Vale por cima de `design/mockup-meta-templates.html` (janela de 29/10) só no formato da tela; o contrato `docs/contratos/meta-templates-v1.md` continua valendo.

## 1. Problema
- Hoje, sem template, o "Publish to Meta" cai no formulário **Custom**. A pessoa preenche a estrutura toda a cada envio e nada fica salvo.
- O template existe (29/10), mas mora numa **janela** em Settings › Connections › Templates, com seções e nomes nossos. O Tordan (gestor de tráfego) pensa no Gerenciador: Campanha › Conjunto › Anúncio, nessa ordem e com esses nomes.

## 2. Decisões e porquê
1. **Sem template = a tela de criar abre no lugar do formulário.** O cartão "How they go up" mostra "No campaign template yet" + a estrutura em 3 chips; o botão continua sendo **Publish 10 ads to Meta** e leva pro editor com a faixa azul "Set up how your ads go up on Meta… Only the budget is missing". Ao salvar, volta pro envio com o template novo selecionado e toast "Template … saved and selected for this publish". Por quê: a pessoa clicou pra publicar, então o caminho continua sendo publicar; o template é um passo dele, feito uma vez.
2. **Página inteira, sem a sidebar do app** (como o Gerenciador ao criar). Cabeçalho com migalha "Publish to Meta › New campaign template" (ou "Settings › Templates"), nome editável, "Default for Mooncloth Ads", "Import from a campaign" e ×.
3. **Layout do Gerenciador:** coluna da estrutura à esquerda (300 px) com os 3 nós aninhados (Campanha › Conjunto › Anúncio), cada um com resumo vivo e bolinha vermelha com o nº de erros; à direita, os campos do nível em **cartões por seção**, na ordem e com os nomes da Meta. Embaixo da árvore, o plano do lote ("With 10 approved ads: Ad set 1 · 8 ads, Ad set 2 · 2 ads · below 4") e "Import its settings".
4. **Barra inferior:** Back (nível anterior; no 1º nível sai) · aviso de erros/"Becomes the default" · **Next: Ad set** · **Save template** (lima). Salvar funciona em qualquer nível, como no Gerenciador; com erro, pula pro nível do 1º erro e foca o campo.
5. **ABO move orçamento e lance pro Conjunto**, igual à Meta. Desligar "Advantage+ campaign budget" tira Budget/Bid do cartão Campanha e cria "Budget & schedule" no Conjunto. O dado continua em `campaign.dailyBudgetMinor` / `campaign.bidAmountMinor`; só a tela muda de lugar (ver §6, mapa de erro).
6. **Campo que a Meta tem e nós não: aparece desabilitado com selo "Soon"** quando ocupa lugar visível no Gerenciador (objetivos Awareness/Engagement, Buying type Reservation, Lifetime budget, A/B test, Schedule, Custom audiences, Detailed targeting, Languages, Instagram account, Carousel/Flexible). Assim a ordem fica idêntica e o Tordan vê o que falta. Lista completa em §5.
7. **Coisas só do HookMill levam o selo `HookMill`** (lima-claro): "Publish into" (reusar campanha × nova por lote) e "Ads per ad set". O resto é vocabulário da Meta.
8. **Prévia do anúncio no nível Ad** (coluna 280 px, card de feed do Facebook com o vídeo de um aprovado), atualiza ao digitar. No celular sobe pro topo, em 16:10.
9. **"Custom" sai do seletor do envio** (recomendado; decisão do Gusta, §9). Com templates, o envio mostra Select + **Edit**, **New template**, **Import from a campaign**, o resumo dos 3 níveis e o plano. Ajuste avulso = editar o template ou criar outro.
10. **Importar** abre um diálogo (sheet no celular): nível Campaign/Ad set/Ad, lista de campanhas com status, "Import". Enquanto lê, mostra o que está lendo (espera honesta). Volta pro editor preenchido, **sem salvar**, com faixa tracejada "Copied from … Not copied: …".
11. **Visual:** o do app hoje (tema claro + sidebar tinta, Archivo + IBM Plex Mono, lima só no botão principal, azul Meta só em Reconnect). Mesmos tokens de `mockup-home-v2.html` e `brand-2026-10-31.md`.

## 3. Fluxos
**F1, sem template (Account 1):** Review › Approved → `/publish` → cartão vazio → **Publish 10 ads to Meta** → editor (faixa intro, nome "Tests · CBO 4–8 · US", padrão marcado e travado porque é o 1º) → preenche o orçamento → **Save template** → Saving… → volta ao envio com o template selecionado → **Publish 10 ads** → "Sent to Meta, paused · 2 ad sets · 10 ads".
Atalho: "Import from an existing campaign" no cartão vazio abre o editor já com o diálogo de importar.
**F2, com templates (Account 2):** seletor com o padrão marcado → Edit (abre com os dados) / New template (abre limpo, padrão desmarcado) / Import. Salvar volta pro envio com aquele selecionado.
**F3, editar em Settings:** `/settings/connections/templates` → abrir um template → mesma tela, migalha "Settings › Templates", sem "Import", com **Archive** (ação existente) no rodapé à esquerda do Back. Salvar volta pra lista.
**F4, Meta desconectada (Account 3):** envio mostra alerta vermelho "Meta connection expired" + Reconnect Meta; Publish desabilitado; Edit ainda abre o editor, com faixa âmbar e **Save desabilitado** (pixels e Página vêm da conexão; `adAccountId` é obrigatório). O rascunho fica na tela enquanto reconecta.

## 4. Campos por nível (ordem da Meta) → `MetaTemplateBody`
Fonte da verdade do que o backend aceita: `web/src/components/meta/templates/template-dialog.tsx` (`build()`) e `contratos/src/meta-templates.ts`.

### Cabeçalho
| Campo na tela | Controle (shadcn) | Campo | Validação |
|---|---|---|---|
| Nome do template | `Input` sem borda, 18 px | `name` | 1–60 |
| Default for Mooncloth Ads | `Checkbox` | `isDefault` | travado `true` no 1º template e no padrão atual |

### Campaign
| Seção (Meta) | Campo na tela | Controle | Campo | Validação / nota |
|---|---|---|---|---|
| Campaign name | Campaign name | `Input` mono + variáveis + exemplo resolvido | `campaign.namePattern` | 1–120 |
| Campaign name | Publish into `HookMill` | `RadioGroup` em cartões | `campaign.destination` (`REUSE_CAMPAIGN` \| `NEW_CAMPAIGN`) | — |
| Special Ad Categories | categorias | `Collapsible` + `Checkbox` | `campaign.specialAdCategories[]` | — |
| Campaign details | Buying type | só leitura "Auction" + Soon | — | — |
| Campaign details | Campaign objective | `RadioGroup` em grade 2 col. (6 opções da Meta, 2 Soon) | `campaign.objective` | Sales/Leads/App promotion exigem pixel (erro cai no Conjunto) |
| Budget | Advantage+ campaign budget | `Switch` | `campaign.budgetMode` (on = `CBO`, off = `ABO`) | — |
| Budget (só CBO) | Budget type | `Select` "Daily" (Lifetime Soon) | — | — |
| Budget (só CBO) | Daily budget | `Input` decimal com prefixo da moeda | `campaign.dailyBudgetMinor` (× `minorFactor`) | > 0 e ≥ mínimo da conta; botão "Use US$ 5.00" no erro |
| Budget (só CBO) | Campaign bid strategy | `Select`: Highest volume / Cost per result goal / Bid cap | `campaign.bidStrategy` (`LOWEST_COST`/`COST_CAP`/`BID_CAP`) | — |
| Budget (só CBO) | Cost per result goal / Bid cap | `Input` moeda | `campaign.bidAmountMinor` | obrigatório se ≠ LOWEST_COST |
| Budget | CPA alvo do Brain | caixa lima-clara, só leitura | `Workspace.targetCpa` | só se existir |
| A/B test | — | Soon | — | — |

### Ad set
| Seção | Campo | Controle | Campo | Validação |
|---|---|---|---|---|
| Ad set name | Ad set name | `Input` mono | `adset.namePattern` | 1–120 |
| Conversion | Conversion location | só leitura "Website" (App/mensagens Soon) | — | — |
| Conversion | Performance goal | só leitura, derivado do pixel ("Maximize number of conversions" / "…link clicks") | — | — |
| Conversion | Pixel | `Select` (lista de `GET /meta/options` + pixel da conexão + "No pixel") | `adset.pixelId` | obrigatório p/ Sales/Leads/App; erro com botão "Switch objective to Traffic" |
| Conversion | Conversion event | `Select` (desabilitado sem pixel → "Link clicks") | `adset.pixelEvent` | null sem pixel |
| Budget & schedule (só ABO) | Daily budget per ad set, Bid strategy, cap | iguais aos da Campanha | `campaign.dailyBudgetMinor`, `campaign.bidStrategy`, `campaign.bidAmountMinor` | iguais |
| Schedule | — | Soon | — | — |
| Audience | Locations | `Input` mono, códigos ISO | `adset.countries[]` | 1–10, `^[A-Z]{2}$` |
| Audience | Age | 2 `Input` | `adset.ageMin`, `adset.ageMax` | 18–65, min ≤ max (erro em `adset.ageMax`) |
| Audience | Gender | `ToggleGroup` All/Men/Women | `adset.genders` | — |
| Audience | Advantage+ audience | `Switch` | `adset.advantageAudience` | — |
| Audience | Custom audiences, Detailed targeting, Languages | Soon | — | — |
| Placements | Advantage+ / Manual | `RadioGroup` | `adset.placements` = `"AUTO"` ou `{ platforms, positions }` | manual exige ≥ 1 plataforma |
| Placements (manual) | plataformas e posições | `Checkbox` aninhado | idem (`<platform>_<position>`) | posição vazia = todas da plataforma |
| Ads per ad set `HookMill` | At least / At most + plano | 2 `Input` + chips | `adset.adsPerAdset.min/max` | 1–50, min ≤ max |

### Ad
| Seção | Campo | Controle | Campo | Validação |
|---|---|---|---|---|
| Ad name | Ad name | `Input` mono + exemplo (`HEADLINE-02`) | `ad.namePattern` | 1–120 |
| Identity | Facebook Page | só leitura, vem da conexão | — (`MetaConnection.page`) | — |
| Identity | Instagram account | Soon | — | — |
| Ad setup | Format | só leitura "Single video" (Carousel/Flexible Soon) | — | — |
| Ad creative | Primary text | `Textarea` (vazio = HookMill escreve por anúncio) | `ad.primaryText` (null se vazio) | ≤ 2000 |
| Ad creative | Headline / Description | `Input` opcional | `ad.headline` / `ad.description` | ≤ 255 / ≤ 125 |
| Ad creative | Call to action | `Select` (11 CTAs) | `ad.callToAction` | — |
| Destination | Website URL | `Input` url mono | `ad.link` | `https?://…`, ≤ 2048 |
| Tracking | URL parameters | `Input` mono | `ad.urlTags` (sem `?` inicial; null se vazio) | ≤ 1024 |
| Tracking | Website events | só leitura, espelha o pixel do Conjunto | — | — |

Variáveis de nome: `{offer}` `{code}` `{date}` `{n}`; cada campo de nome mostra o exemplo resolvido ao lado.

## 5. O que a Meta tem e o template não (mostrado como Soon ou omitido)
Mostrados com "Soon": objetivos Awareness e Engagement; Buying type Reservation; Lifetime budget; A/B test; Schedule (início/fim); Conversion location App/Messaging; Custom audiences (incluir/excluir); Detailed targeting; Languages; Instagram account própria; formatos Carousel/Flexible.
Omitidos (barulho pra v1): Campaign spending limit, Budget scheduling, Ad scheduling por hora, Dynamic creative, Partnership ad, Multi-advertiser ads, Display link, Brand safety/inventory filter, Attribution setting, Value rules, Cost per result por posicionamento, Languages do texto (tradução automática).
A importação lista em `unsupported` o que encontrar desses (contrato §3) e a faixa tracejada mostra.

## 6. Estados
| Estado | Onde | Comportamento |
|---|---|---|
| Vazio (sem template) | Envio | cartão tracejado "No campaign template yet" + 3 chips da estrutura + Publish leva ao editor |
| Novo (padrões de fábrica) | Editor | CBO, Highest volume, 4–8, US 18–65, Advantage+ on, pixel da conexão, link da oferta, UTM pronta; **orçamento vazio** (proposta P2 do contrato: pedir na criação) |
| Carregando pixels | Conjunto › Pixel | `Select` com "Loading…" no hint; nunca bloqueia o resto |
| Erro de validação | Editor | mensagem embaixo do campo (`aria-describedby`), borda vermelha, bolinha com nº de erros no nó da árvore / passo do celular, contagem no rodapé; Save pula pro 1º erro |
| Orçamento abaixo do mínimo | Campanha (CBO) ou Conjunto (ABO) | cliente valida com o mínimo conhecido; 422 `META_BUDGET_TOO_LOW` usa `details.minimumMinor` e mostra "Below Meta's minimum… US$ 5.00 a day" + botão **Use US$ 5.00** |
| Pixel obrigatório | Conjunto › Pixel | 422 `META_PIXEL_REQUIRED` ou validação local; botão **Switch objective to Traffic** |
| 400 `VALIDATION_ERROR` | campo do `details.fields[].field` | mapa abaixo |
| Salvando | Editor | Save vira "Saving…" com spinner, Back/Next e campos travados (`fieldset disabled`) |
| Salvo | Envio | volta com o template selecionado + toast |
| Importando (lendo) | Diálogo | spinner + lista do que lê (campanha, 1º conjunto ativo, 1º anúncio); Import desabilitado |
| Importado | Editor | faixa tracejada "Copied from … Not copied: …"; nada salvo até Save |
| Importar falhou | Diálogo | 404 `META_OBJECT_GONE` → linha some com "This campaign was deleted on Meta"; 422 `META_PERMISSION` → "Your Meta user can't read this campaign" |
| Meta desconectada / token expirado | Envio e Editor | envio: alerta vermelho + Reconnect, Publish desabilitado. Editor: faixa âmbar, Save desabilitado, rascunho mantido |
| Publicando / publicado | Envio | "Publishing…" → cartão verde "Sent to Meta, paused · N ad sets · N ads" + Open in Campaigns / Ads Manager ↗ |
| CLIENT/MEMBER sem permissão | Editor | `readOnly` (já existe): campos desabilitados, sem Save/Archive |
| Sair com mudanças | Editor (× ou Back no 1º nível) | `AlertDialog` "Discard changes to this template?" (não está no mockup) |

**Mapa de erro → nível** (substitui `LEVEL_OF` do dialog): `adset.*` → Conjunto; `ad.*` → Anúncio; `campaign.dailyBudgetMinor` e `campaign.bidAmountMinor` → **Campanha se CBO, Conjunto se ABO**; demais `campaign.*` → Campanha; `name` → cabeçalho.

## 7. Componentes
| Peça | shadcn / próprio |
|---|---|
| Página | rota própria (ver §8), não `Dialog` |
| Árvore da estrutura | próprio `StructureTree` (`button` por nó com `aria-current`, ícone por nível, resumo de `useTemplateSummary`, `Badge` destrutivo com nº de erros) |
| Passos no celular | `Tabs` com `TabsList` de largura cheia (Campaign · Ad set · Ad) |
| Seção | `Card` (raio 14, sem sombra) com título 14 px; seção Soon com fundo `card-2` |
| Campo | `Label` + controle + hint/erro (o `F` atual) |
| Escolhas em cartão (objetivo, destino, posicionamento) | `RadioGroup` com `RadioGroupItem` dentro de `label` cartão |
| Liga/desliga | `Switch` |
| Gênero | `ToggleGroup type="single"` |
| Soon | `Badge variant="outline"` mono + linha tracejada |
| Selo HookMill | `Badge` lima-claro |
| Prévia do anúncio | próprio `AdPreview` (feed do Facebook) |
| Rodapé | barra sticky própria com `Button` ghost / outline / brand |
| Importar | `Dialog` no desktop, `Drawer` (vaul) no celular, `RadioGroup` de campanhas, `Badge` de status |
| Faixas | `Alert` variantes info / warning / destructive + uma tracejada nova (`variant="outline"`) |
| Toast | `sonner` |

## 8. Rotas e o que muda no front
- **Rota nova:** `/publish/template/new?return=<publish-url>` e `/settings/connections/templates/:id` (editar), mesmo componente `TemplateEditor` em página. O `TemplateDialog` atual vira esse componente (a lógica `draftOf`/`build`/`save` fica igual; muda a casca e a posição dos campos de orçamento no ABO).
- `return` = de onde veio. Ao salvar com `return`, navega pra ele com `?template=<id>` e o envio seleciona esse id.
- **Envio (`publish-screen.tsx`):** `list.length === 0` → cartão vazio e o botão de publicar navega pro editor (não mostra mais `PublishForm`). `TemplateChooser` perde a opção `CUSTOM` (se o Gusta aprovar) e ganha Edit / New template / Import.
- **Batch (`batch-send.tsx`):** mesmo comportamento.
- Rascunho do editor sobrevive a reconexão: guardar em `sessionStorage` por `adAccountId` enquanto a página estiver aberta.

## 9. API: o que já existe e o que falta
Já existe: `GET/POST/PATCH/DELETE /meta/templates`, `POST /meta/templates/import`, `GET /meta/campaigns`, `GET /meta/options` (pixels), `GET /meta/connection` (Página, moeda, status), `POST /meta/publish-batch`, erros `META_BUDGET_TOO_LOW` (com `minimumMinor`), `META_PIXEL_REQUIRED`, `VALIDATION_ERROR` com `fields[]`.
**Nada de backend novo é obrigatório** pra esta tela. Desejável (pro `maquina-arquiteto` decidir):
1. **Mínimo de orçamento antes do 422:** incluir `minDailyBudgetMinor` em `GET /meta/connection` (ou `/meta/options`) pra validar no cliente e mostrar o hint certo de saída. Hoje o mockup usa US$ 5.00 de exemplo.
2. **Status e resumo na lista de importação:** `GET /meta/campaigns` devolver `status`, `objective`, `budgetMode`, `dailyBudgetMinor` e contagem de ad sets/anúncios pra linha do diálogo. Se não tiver, a linha mostra só nome e status.
3. Página e Instagram por template (hoje vêm da conexão) ficam pra v2 junto com `customAudienceIds`.

## 10. Responsivo (390)
- Árvore some; vira `Tabs` de 3 passos com nº e bolinha de erro, fixa no topo da área de campos.
- Cabeçalho quebra em 2 linhas: migalha + nome; depois Import · Default · ×.
- Rodapé: Back · Next · Save template (Save sempre visível; "Next" sem o nome do nível). Alvos ≥ 44 px.
- Objetivo, campos em par e prévia viram 1 coluna; a prévia sobe pro topo do nível Ad em 16:10.
- Importar abre como sheet de baixo.
- Envio: miniaturas em 4 colunas, cartões empilhados, Publish em largura cheia.

## 11. Aceite
- Sem template, "Publish to Meta" leva ao editor; salvar volta pro envio com o template novo selecionado e publicar funciona sem passar pelo formulário Custom.
- A ordem e os nomes das seções batem com o Gerenciador lado a lado (comparar com prints antes do build, como pede o backlog).
- Desligar Advantage+ campaign budget move orçamento e lance pro Conjunto; um 422 de orçamento em ABO abre o Conjunto com o erro no campo.
- Todo erro de campo aparece embaixo do campo certo e conta no nó/passo certo.
- Em 390 px dá pra criar, importar, editar e salvar sem rolagem lateral.

## 12. Decisões pro Gusta
1. **Tirar "Custom" do seletor do envio** (recomendo): ajuste avulso vira editar ou criar template. Ou manter Custom como hoje?
2. **Editor sem a sidebar do app** (página cheia, como o Gerenciador): ok?
3. **Campos da Meta que não temos aparecem desabilitados com "Soon"** (recomendo, mantém a ordem idêntica) ou somem?
4. **Orçamento vazio no primeiro template** (força decidir) ou já preencher com o mínimo da conta?
5. **Destino padrão "One campaign for every publish"** (REUSE, P1 do contrato): confirma?
