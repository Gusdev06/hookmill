# Anúncios da Meta por oferta, contrato v1
Data: 2026-11-04 · Dono: maquina-arquiteto · Status: **PROPOSTA, aguardando o ok do Gusta** (decisões no §11). Tipos já no pacote como **opcionais** (`contratos/src/meta.ts` bloco "meta-oferta-v1" + `contratos/src/campanhas.ts`), `tsc` do `contratos` verde. Nada de código em `api/` nem `web/` antes do ok.
Origem: pedido do Gusta de 04/11. A conta de anúncios conectada tem anúncios de vários produtos, mas no HookMill a pessoa trabalha uma oferta. Hoje `GET /meta/ads` mistura tudo. Resultado: o campeão sugerido pode ser de outro produto, e a leitura, o plano e o fit da iteração saem errados.
Vale **por cima** de `meta-v1.md` e `campanhas-v1.md` só no que muda aqui. Envelope, papéis e erros: `api.md` §1.

## 0. Em 5 linhas
1. O sync passa a ler o **link de destino** de cada criativo (`object_story_spec`, `asset_feed_spec`, `url_tags`). Ele fica guardado em 3 colunas novas do `meta_ad_snapshots` e é reaproveitado entre syncs, porque o criativo da Meta não muda depois de criado.
2. O casamento anúncio → oferta é uma **função pura, calculada na leitura** (não no sync). Ordem de força: correção manual → publicado pelo HookMill → campeão importado → link (mesma página ou caminho) → nome → irmão do mesmo conjunto/campanha → só o domínio. Empate entre ofertas não decide nada.
3. `GET /meta/ads` e `GET /meta/campaigns` aceitam `offerId` (a oferta ativa, mandada pelo web). Com ele, cada linha ganha `offer.fit` (`this`, `unknown` ou `other`) e a lista sai **agrupada nessa ordem**. Nenhum anúncio some: os de outros produtos ficam no fim, numa seção própria.
4. A correção manual mora numa tabela nova, `meta_offer_links`, por anúncio ou por campanha. Ela sobrevive ao sync porque usa os ids da Meta. As rotas são `PUT /meta/offer-links` e `DELETE /meta/offer-links`.
5. Conta sem link legível (post existente, cadastro, mensagem) ou oferta sem URL: o casamento cai pra nome, irmãos e correção manual. A tela mostra um aviso com o que fazer, e nada é escondido.

## 1. Escopo
**Entra:** leitura do link no sync, regra de casamento, `offerId` em `GET /meta/ads` e `GET /meta/campaigns` (e no detalhe da campanha), correção manual, veredito recalculado dentro da oferta, mudanças nas 4 telas (§8).
**Não entra:** seletor global de oferta no cabeçalho (fica como pendência, §12). Cérebro 3D ligando anúncio à oferta. Bloqueio de iterar anúncio de outro produto (é só confirmação no web). Resolver link de post existente pela Página (exige token de página por anúncio). Apelidos de oferta (`aliases`), que hoje a correção por campanha cobre.

## 2. De onde vem o link (sync)

### 2.1 Campos da Graph (v25.0)
O link mora no **AdCreative**, não no Ad. A listagem `act_/ads` continua **leve**, como manda o bug live de 22/10: pedir `object_story_spec` inteiro em conta grande devolve code 1 ("reduce the amount of data"). O link sai do mesmo lookup por criativo que já existe pro `video_id` (`fillStoryVideoIds`). Ele é ampliado assim:

```
GET /{creative_id}?fields=object_story_spec{link_data{link},video_data{video_id,call_to_action{type,value{link,lead_gen_form_id,app_link}}},template_data{link}},asset_feed_spec{link_urls{website_url}},url_tags,object_type
```

Os campos são lidos nesta ordem, e o primeiro que trouxer URL http(s) define a `destinationSource`:

| ordem | campo | `destinationSource` | exemplo |
|---|---|---|---|
| 1 | `object_story_spec.video_data.call_to_action.value.link` | `video_cta` | anúncio de vídeo com botão "Saiba mais" |
| 2 | `object_story_spec.link_data.link` | `story_link` | imagem/link |
| 3 | `object_story_spec.template_data.link` | `template` | catálogo/dinâmico |
| 4 | `asset_feed_spec.link_urls[].website_url` (até 5, todos guardados) | `asset_feed` | criativo flexível / Advantage+ |

Quando nenhum link http(s) é achado, a origem diz o motivo:

| situação | `destinationSource` | `destinationUrls` |
|---|---|---|
| `call_to_action.value.lead_gen_form_id` presente | `lead_form` | `[]` |
| link `wa.me`, `api.whatsapp.com`, `m.me`, `messenger.com`, `ig.me`, ou CTA `MESSAGE_PAGE`/`WHATSAPP_MESSAGE` | `messaging` | `[]` |
| sem `object_story_spec` nem `asset_feed_spec` (anúncio de post existente, `object_story_id`) | `existing_post` | `[]` |
| lookup ok, mas nada acima | `none` | `[]` |
| lookup falhou (erro da Graph num criativo) | `null` (vai de novo no próximo sync) | `[]` |

O `url_tags` (string de query que a Meta cola no link, em geral UTM) é guardado à parte. Ele **não** entra no casamento por link, só no reforço por nome (§3.4).

**Sonda S1, obrigatória antes do merge do backend:** conferir na conta real do Gusta que (a) esse `fields` com sub-seleção não reacende o code 1 no lookup individual; (b) `asset_feed_spec{link_urls{website_url}}` vem com o token do usuário; (c) o `call_to_action.value.link` do vídeo é o mesmo link que o Gerenciador mostra. Resultado anotado em `api/src/integracoes/meta/PORTA.md`. Se (a) falhar, o lookup pede só `object_story_spec{link_data{link},video_data{call_to_action}}` e `asset_feed_spec` numa segunda chamada.

### 2.2 Custo e cache
- **Cache por criativo.** Antes de gravar o snapshot novo, o `sync.service` monta `metaCreativeId → { destinationUrls, destinationSource, urlTags }` a partir dos snapshots atuais da mesma conexão e conta, só das linhas com `destinationSource != null`. Quem já está no mapa não é relido. O criativo da Meta é imutável depois de criado (só nome e status mudam), então o link não envelhece.
- **Teto por sync:** `LINK_LOOKUP_MAX = 250` criativos novos, `LINK_LOOKUP_PARALLEL = 5` por vez, sem retry (`retries: 0`), igual ao lookup de hoje. Esse lookup **substitui** o `fillStoryVideoIds`: uma chamada por criativo traz o `video_id` e o link juntos. Não é uma chamada a mais.
- **Prioridade:** o lookup passa a rodar **depois** dos insights, em ordem de gasto em 30 d decrescente. Assim, se a conta tiver mais de 250 criativos novos, os que gastam são lidos primeiro. O que sobrar fica com `destinationSource = null` e entra no próximo sync. A linha sai com `offer.linkPending = true`.
- **Etapa no checklist:** nenhuma etapa nova. O lookup conta dentro de `reading_insights`, porque o `scoring` já é a etapa seguinte.

### 2.3 Encurtadores
Só pros hosts da lista `SHORTENERS` = `bit.ly`, `bitly.com`, `tinyurl.com`, `t.co`, `cutt.ly`, `ow.ly`, `rebrand.ly`, `is.gd`, `shorturl.at`, `rb.gy`, `t.ly`, `tiny.cc`, `buff.ly`, `lnkd.in`, `encurtador.com.br`. O sync segue o redirecionamento com `fetch(url, { method: 'HEAD', redirect: 'manual' })`, lê o `Location`, para no primeiro host fora da lista e faz no máximo 3 saltos. Timeout de 3 s por salto, teto de 50 encurtadores por sync. Ele **nunca** baixa o corpo nem chama host fora da lista, então não abre SSRF. Falhou: guarda o próprio link encurtado, e o casamento por link não acha nada pra ele (cai pro nome). O link guardado em `destinationUrls` é o **final**.

### 2.4 Migração `20261105000100_meta_offer_match` (backend aplica; `npm run db:backup` antes, regra do TIME.md)

```prisma
model MetaAdSnapshot {
  // ... campos de hoje
  destinationUrls   String[] @default([]) @map("destination_urls")  // meta-oferta-v1 §2: links http(s) como lidos (já sem encurtador), ≤ 5, cada ≤ 2048
  destinationSource String?  @map("destination_source")             // video_cta | story_link | template | asset_feed | lead_form | messaging | existing_post | none; null = não lido ainda
  urlTags           String?  @map("url_tags")                       // creative.url_tags (≤ 1024); só reforço de nome
}

// meta-oferta-v1 §5: correção manual "este anúncio/campanha é (ou não é) desta oferta". Sobrevive ao sync (chave = ids da Meta).
enum MetaOfferDecision {
  BELONGS
  NOT_BELONGS
}

model MetaOfferLink {
  id          String            @id @default(cuid())
  workspaceId String            @map("workspace_id")
  adAccountId String            @map("ad_account_id")  // vale pra conta, não pra conexão (reconectar não perde)
  level       MetaObjectLevel   // só AD ou CAMPAIGN (ADSET recusado no DTO)
  objectId    String            @map("object_id")       // metaAdId ou campaignId
  offerId     String            @map("offer_id")
  decision    MetaOfferDecision
  createdById String            @map("created_by_id")
  createdAt   DateTime          @default(now()) @map("created_at")
  updatedAt   DateTime          @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  offer     Offer     @relation(fields: [offerId], references: [id], onDelete: Cascade)
  createdBy User      @relation("MetaOfferLinkCreatedBy", fields: [createdById], references: [id])

  @@unique([workspaceId, adAccountId, level, objectId, offerId])
  @@index([workspaceId, adAccountId])
  @@map("meta_offer_links")
}
```
Mais as relações inversas: `Workspace.metaOfferLinks`, `Offer.metaOfferLinks` e `User.metaOfferLinksCreated`. As colunas novas do snapshot são aditivas e começam vazias. O 1º sync depois do deploy lê os links, até 250 criativos.

**Por que não `offer_id`/`offer_match` no snapshot (a ideia inicial):** o snapshot é apagado e regravado a cada sync. E o vínculo depende de coisas que mudam fora do sync: oferta nova, URL da oferta editada, correção manual. Gravado no sync, ficaria velho até o próximo. Calculado na leitura, custa nada, porque o `GET /meta/ads` já carrega os até 500 snapshots na memória pra filtrar e ordenar (`sync.service.ts → ads()`).

## 3. Regra de casamento (determinística)
Arquivo novo e puro: `api/src/meta/oferta-match.ts`, com testes em `oferta-match.spec.ts`. Usa `tldts` (já é dependência) e a lista `PLATFORM_DOMAINS` de `api/src/integracoes/claude/subdominios.ts`, que passa a ser exportada (hoje é `const`).

### 3.1 Normalizar uma URL → `UrlKey | null`
1. `trim`. Sem esquema, prefixa `https://`. Faz o parse com `new URL`, e se falhar devolve `null`. Só `http:`/`https:`.
2. **Desembrulhar redirecionador conhecido** (sem rede), até 2 vezes. `l.facebook.com/l.php`, `lm.facebook.com/l.php` e `l.instagram.com/` usam o param `u`. `www.google.com/url` usa `q` ou `url`. `out.reddit.com` usa `url`. A URL desembrulhada volta pro passo 1.
3. **host:** minúsculo, sem ponto final, sem prefixo `www.` ou `m.` (`bare`). **site** = `getDomain(host, { allowPrivateDomains: true })`. Exemplo: `foo.vercel.app` é site próprio, não `vercel.app`.
4. **path:** minúsculo, `%`-decodificado, `//` vira `/`, sem `/` final, sem `index.html|index.php|index.htm` final. Vazio vira `/`.
5. **query e fragmento:** descartados, **exceto** a identidade de plataforma (§3.2).
6. **platform:** se `site ∈ PLATFORM_DOMAINS` (hotmart, kiwify, clickbank, cartpanda etc.), a chave vira `{ platform: site, product: <id do produto> }` pela tabela do §3.2. Sem id reconhecível, `product = null` e essa URL **não casa por link** com nada: `pay.hotmart.com` sozinho é de todo mundo.

`UrlKey = { host, site, path, platform: string | null, product: string | null }`.

### 3.2 Identidade de produto em plataforma de terceiros
| plataforma (site) | URL | `product` |
|---|---|---|
| `hotmart.com` | `pay.hotmart.com/X12345678Y`, `go.hotmart.com/X1…?ap=…` | 1º segmento do path |
| `kiwify.com.br`, `kiwify.app` | `pay.kiwify.com.br/AbC123` | 1º segmento |
| `eduzz.com` | `chk.eduzz.com/123456`, `sun.eduzz.com/123456` | 1º segmento numérico |
| `monetizze.com.br` | `app.monetizze.com.br/checkout/KAB123` | segmento depois de `checkout` |
| `cakto.com.br` | `pay.cakto.com.br/abc_123` | 1º segmento |
| `perfectpay.com.br` | `checkout.perfectpay.com.br/pay/PPU38…` | segmento depois de `pay` |
| `ticto.com.br` (e `ticto.app`) | `checkout.ticto.app/O12AB` | 1º segmento |
| `kirvano.com`, `braip.com`, `greenn.com.br` | `pay.kirvano.com/uuid`, `ev.braip.com/checkout/xyz`, `payfast.greenn.com.br/123` | último segmento não genérico (`checkout`, `pay`, `ref` não contam) |
| `clickbank.net` | `hop.clickbank.net/?vendor=ABC&affiliate=x`, `abc.hop.clickbank.net` (antigo), `abc.pay.clickbank.net` | param `vendor`, ou o 1º rótulo do subdomínio antigo; minúsculo |
| `digistore24.com` (e `checkout-ds24.com`) | `www.digistore24.com/product/123456` | segmento depois de `product` (ou `redir`) |
| `stripe.com` | `buy.stripe.com/abc123` | 1º segmento |
| `mycartpanda.com` (CartPanda, subdomínio por loja) | `loja.mycartpanda.com/checkout/123:1` | **subdomínio + 1º número do path**: `loja/123` |
| `myshopify.com` | `loja.myshopify.com/products/x` | já é site próprio pelo PSL privado (`loja.myshopify.com`): segue a regra normal, não é plataforma |

Plataforma nova = uma linha nesta tabela e um caso no spec. Hoje `mycartpanda.com` não está em `PLATFORM_DOMAINS`, e o backend o acrescenta.

### 3.3 Força do casamento por link (anúncio × oferta)
**Referências da oferta** (`refs(offer)`), todas normalizadas pelo §3.1:
- `offer.sourceUrl`;
- `offer.readMeta.pages[].url` com `role ∈ main | offer | quiz_step | checkout | pricing | other` (fora: `terms`, `faq`, `about`, `testimonials` e `thankyou`, porque anúncio não aponta pra eles);
- `settings.link` das `MetaPublication` não `FAILED` de criativos desta oferta: é o link que a própria pessoa usou ao publicar por ela;
- `workspace.websiteUrl` **só se** o workspace tiver exatamente 1 oferta não arquivada. Com 2 ou mais, o site da empresa não diz qual produto é.

A força de um par (URL do anúncio, ref) é a **maior** que valer:

| força | nome | regra | exemplo (ref → anúncio) |
|---|---|---|---|
| 3 | `exact` | mesma `host` e mesmo `path`; ou mesma `platform` e mesmo `product` | `meusite.com/vsl` → `https://www.meusite.com/vsl/?utm_source=fb` |
| 2 | `prefix` | mesma `host`, o `path` da ref não é `/`, e um path é prefixo do outro **em fronteira de segmento** | `meusite.com/curso` → `meusite.com/curso/v2` |
| 1 | `domain` | mesmo `site` (não plataforma), path diferente | `meusite.com/curso` → `lp.meusite.com/outro` |
| 0 | — | o resto | `meusite.com/curso` → `outrosite.com/curso`; `pay.hotmart.com/A1` → `pay.hotmart.com/B2` |

A força do anúncio pra oferta é o máximo sobre todas as suas `destinationUrls` × `refs(offer)`.

Contra-exemplos que a spec tem que cobrir: `meusite.com/curso` **não** é prefixo de `meusite.com/cursos`, porque não está em fronteira de segmento. Path de ref `/` com anúncio `/qualquer` dá força 1, não 2. `l.facebook.com/l.php?u=https%3A%2F%2Fmeusite.com%2Fvsl` vira `meusite.com/vsl`. `bit.ly/abc` resolvido no sync vira o destino final.

### 3.4 Reforço por nome
- **Agulha da oferta:** `slug(offer.name)` = minúsculo, sem acento (NFD sem marcas), só `[a-z0-9]`. Precisa de **pelo menos 4 caracteres** e não pode estar em `GENERIC_NAMES` (`oferta`, `offer`, `produto`, `product`, `curso`, `course`, `teste`, `test`, `app`, `ebook`, `mentoria`, `promo`, `black`, `vsl`, `quiz`). Se não passar, a oferta não casa por nome.
- **Palheiro do anúncio:** `slug(campaignName + adsetName + name + urlTags + utm_campaign/utm_content das destinationUrls)`.
- Casa se o palheiro **contém** a agulha. "Spy Gram" casa com "SPYGRAM | CBO", "spy-gram_v3" e `utm_campaign=spy_gram`.
- Se duas ofertas casam e uma agulha contém a outra (`spy` e `spygram`), vence a mais longa. Se nenhuma contém a outra, é empate e o nome não decide.

### 3.5 Atribuição (um anúncio → no máximo uma oferta)
Entram **todas** as ofertas do workspace, inclusive as arquivadas, pra que anúncio de produto arquivado vá pra "outros" e não pra "sem certeza". As regras rodam em ordem, e **a primeira que der uma oferta única vence**. `excluded` = ofertas com `NOT_BELONGS` pra este anúncio (nível AD) ou pra campanha dele (nível CAMPAIGN).

| # | regra | `match` | `confidence` |
|---|---|---|---|
| 1 | `BELONGS` no nível AD | `manual` | `high` |
| 2 | `BELONGS` no nível CAMPAIGN (da campanha do anúncio) | `manual_campaign` | `high` |
| 3 | publicado pelo HookMill: `MetaPublication.metaAdId` → `creative.offerId` | `hookmill` | `high` |
| 4 | importado como campeão: `Champion.metaAdId` (não arquivado) → `offerId`; se houver mais de um, o mais recente | `champion` | `high` |
| 5 | link força 3 ou 2, numa oferta só (fora `excluded`); empate na força máxima entre ofertas = segue | `link` | `high` |
| 6 | nome (§3.4), numa oferta só (fora `excluded`) | `name` | `low` |
| 7 | irmão: **sem link legível** (`destinationUrls` vazio) e todos os outros anúncios do mesmo **conjunto** já atribuídos pelas regras 1-5 apontam pra mesma oferta (pelo menos 1). Se o conjunto não decidir, tenta a mesma coisa na **campanha** | `sibling` | `low` |
| 8 | link força 1 numa oferta só (fora `excluded`) | `domain` | `low` |
| — | nada | `none` | — |

Se a regra 1, 2, 3 ou 4 apontar uma oferta que está em `excluded`, vale o `NOT_BELONGS`: a regra é pulada e a próxima é avaliada.

### 3.6 `fit` relativo à oferta pedida (`?offerId=X`)
- `this`: atribuído a X.
- `other`: atribuído a outra oferta; **ou** `NOT_BELONGS` pra X (anúncio ou campanha); **ou** `match = none` com link legível, com X tendo pelo menos 1 ref e a força do anúncio pra **todas** as ofertas igual a 0. Esse último é o `foreign_link`: o anúncio aponta pra um site que não é de nenhuma oferta do HookMill. É o caso principal, a conta com produtos que nem estão cadastrados.
- `unknown`: o resto. Sem link legível e sem nome, empate entre ofertas, link ainda não lido, ou X sem nenhuma ref (oferta criada à mão sem URL).

`noneReason` (só quando `offerId` da linha é `null`): `foreign_link` | `no_link` | `link_pending` | `ambiguous` | `offer_has_no_url` | `excluded`.

### 3.7 Exemplos (oferta X = "Spy Gram", `sourceUrl = https://spygram.app/quiz`, checkout `pay.kiwify.com.br/Ab12`; oferta Y = "Zap Spy", `sourceUrl = https://zapspy.com.br`)
| anúncio (campanha · link) | resultado pra `?offerId=X` |
|---|---|
| "CBO 01" · `https://spygram.app/quiz?utm_source=fb` | `this`, `link` (força 3) |
| "CBO 02" · `https://spygram.app/quiz/step-2` | `this`, `link` (força 2) |
| "CBO 03" · `https://pay.kiwify.com.br/Ab12?src=ad` | `this`, `link` (plataforma + produto) |
| "CBO 04" · `https://pay.kiwify.com.br/Zz99` | `other`, `none`/`foreign_link` (produto Kiwify de outro) |
| "ZAPSPY ABO" · sem link (`existing_post`) | `other` (atribuído a Y por `name`) |
| "Teste novo" · `https://zapspy.com.br/promo` | `other`, `link` Y (força 2) |
| "Teste 2" · `https://outroproduto.com/vsl` | `other`, `foreign_link` |
| "SPY GRAM | lead" · `lead_form` | `this`, `name` |
| "Criativo 7" · `existing_post`, no conjunto dos anúncios "CBO 01/02" | `this`, `sibling` |
| "Criativo 8" · `existing_post`, campanha só de posts | `unknown`, `no_link` |
| "CBO 01" marcado `NOT_BELONGS` pra X | `other`, `manual` |
| "Teste 2" marcado `BELONGS` X | `this`, `manual` |

## 4. Leitura: `GET /meta/ads` e `GET /meta/campaigns`

### 4.1 Query nova (as duas rotas e `GET /meta/campaigns/:id`)
| campo | regra |
|---|---|
| `offerId?: string` | cuid de oferta **do workspace** (arquivada pode). De outro workspace ou inexistente = **404 `NOT_FOUND`** `details: { resource: 'offer' }`. Ausente = comportamento de hoje, sem grupos. A linha vem com `offer`, mas `fit = null`. |
| `offerScope?: 'all' \| 'this' \| 'unknown' \| 'other'` | só com `offerId`, senão **400 `VALIDATION_ERROR`** `rule: 'requires_offer'`. Padrão `all`. |

### 4.2 Ordem e filtros com `offerId`
1. Os filtros de hoje (`format`, `verdict`, `trend`, `q`, `origin`, `campaignId`, `adsetId`, `status`) são aplicados **antes**. O `verdict` usa o veredito do §4.3.
2. `meta.offer.counts` = `{ this, unknown, other }` com esses filtros, **antes** do `offerScope` (mesmo papel do `counts` de status).
3. O `offerScope` filtra.
4. Ordenação: **grupo primeiro** (`this` → `unknown` → `other`), depois o `sort`/`dir` de hoje **dentro** do grupo. Sem `sort` vale o `compareAds` de hoje (WINNER antes, depois gasto).
5. `meta.totals` e a paginação por cursor seguem sobre a lista já filtrada e ordenada. O cursor continua sendo offset, e os grupos não quebram a paginação.
6. `GET /meta/campaigns`: a campanha é `this` se tiver pelo menos 1 anúncio `this`, `other` se todos os anúncios forem `other`, e `unknown` no resto. Ordenação igual: grupo, depois o sort. A linha ganha `offerMix: { this, unknown, other }` (contagem de anúncios). O detalhe `GET /meta/campaigns/:id?offerId=` devolve os anúncios com `offer` e ordena cada conjunto pelo grupo.

### 4.3 Veredito dentro da oferta
Com `offerId`, se o grupo `this` (com `format=video`) tiver **pelo menos 3 anúncios elegíveis** (mesma regra mínima de gasto/resultados de `meta-v1` §5), o `verdict` das linhas `this` é **recalculado na leitura** contra a mediana de CPA **só desses**. Assim o "campeão" é campeão do produto, não da conta. Linhas `unknown`/`other` mantêm o veredito da conta. `meta.offer.verdictScope` diz qual valeu (`offer` | `account`), e `meta.offer.medianCpa`, a mediana usada. O snapshot não muda, e `meta.summary` continua da conta inteira.

### 4.4 Cobertura de link (aviso "conta sem link legível")
`meta.offer.links = { read, pending, unreadable }`, contados sobre a lista do passo 1:
- `read` = tem `destinationUrls`;
- `pending` = `destinationSource` null;
- `unreadable` = `lead_form` | `messaging` | `existing_post` | `none`.

`meta.offer.offerHasUrl` = a oferta pedida tem pelo menos 1 ref (§3.3).

### 4.5 Forma da linha (`MetaAdRow.offer`, opcional no tipo até o backend entregar; a API manda sempre)
Ver `MetaAdOfferInfo` em `contratos/src/meta.ts`: `fit`, `offerId`, `offerName`, `match`, `confidence`, `noneReason`, `destinationUrl` (o 1º), `destinationHost`, `linkPending`, `manual` (`{ level, decision }` da correção que valeu pra **oferta pedida**, pro "Desfazer") e `canEdit`.

## 5. Correção manual

### 5.1 Rotas
| rota | corpo | resposta | papéis | erros |
|---|---|---|---|---|
| `PUT /meta/offer-links` | `MetaOfferLinkBody { level: 'AD' \| 'CAMPAIGN'; objectId; offerId; belongs: boolean }` | `200 MetaOfferLinkResult` | OWNER, ADMIN, MEMBER (CLIENT 403 `FORBIDDEN`) | 400 `VALIDATION_ERROR` (`level` ADSET, `objectId` vazio ou > 64); 404 `NOT_FOUND` `{ resource: 'offer' \| 'ad' \| 'campaign' }` (objeto fora do snapshot da conta atual); 409 `META_SELECTION_MISSING` (sem conta escolhida) |
| `DELETE /meta/offer-links?level=&objectId=&offerId=` | — | `200 MetaOfferLinkResult` com `decision: null` | iguais | iguais; apagar o que não existe = 200 idempotente |

### 5.2 Semântica (numa transação)
- `belongs: true` grava `BELONGS (level, objectId, X)`, **apaga os `BELONGS` do mesmo objeto pra outras ofertas** (o anúncio é de um produto só) e apaga o `NOT_BELONGS` de X do mesmo objeto.
- `belongs: false` grava `NOT_BELONGS (level, objectId, X)` e apaga o `BELONGS` de X do mesmo objeto. Não atribui outra oferta. Pra dizer "é da oferta Y", o web manda `belongs: true` com Y.
- Nível AD vale mais que nível CAMPAIGN (regra 1 antes da 2). Marcar a campanha não apaga as marcas por anúncio dentro dela.
- `MetaOfferLinkResult.affectedAds` = anúncios do snapshot atual cujo `fit` pra X mudou, pro toast "12 ads moved to Other products".
- Não escreve na Meta, então não grava `MetaChange`. O web invalida as chaves `mk.ads*` e `mk.campaigns*`.

## 6. Conta sem link legível e oferta sem URL
- **Nada some e nada bloqueia.** Sem link, o casamento usa manual, hookmill, champion, nome e irmão. O que sobrar é `unknown`, e `unknown` aparece **antes** de `other`.
- `links.read = 0` e `links.unreadable > 0`: aviso no topo do passo/lista: "We can't see where these ads link to (posts, lead forms or messages). Mark the ones from {offer}." ("Não conseguimos ver pra onde esses anúncios levam. Marque os que são de {offer}.") O mesmo aviso aparece se `this = 0` e `unknown > 0`.
- `links.pending > 0`: linha discreta "Still reading N ad links, next sync finishes it."
- `offerHasUrl = false`: aviso "Add the link of {offer} so we can find its ads" ("Adicione o link de {offer} pra acharmos os anúncios dela"), com botão pra editar a oferta. Nesse caso o `foreign_link` não acontece: nada vira `other` só pelo link.

## 7. Iterar anúncio de outro produto
`POST /iterate { metaAdId, offerId }` e `POST /ad-templates/use` **não mudam e não bloqueiam**. O web, ao escolher uma linha `fit = 'other'`, abre a confirmação: "This ad looks like it's from {offerName ?? 'another product'}. Use it for {offer} anyway?", com as opções "Use anyway" e "Pick another". Se a pessoa confirmar, o web manda junto um `PUT /meta/offer-links { level: 'AD', belongs: true }`. Isso é lembrar a escolha, não uma etapa a mais.

## 8. Telas
A **oferta ativa** é um estado só do web nesta v1 (`web/src/lib/active-offer.ts`, novo). A chave fica no `localStorage` como `hm.activeOffer.<workspaceId>`. Ela é gravada sempre que a pessoa escolhe oferta no Iterate, nos Templates, na Campanhas ou abre uma oferta. Pra resolver qual vale:
1. a escolhida na tela;
2. a gravada, se ainda existir e não estiver arquivada;
3. a única oferta não arquivada;
4. o `defaultOfferId` do `GET /iterate/config`, onde a tela já tem;
5. sem `offerId` (comportamento de hoje).

| tela | arquivo | o que muda |
|---|---|---|
| Templates · passo do anúncio | `web/src/components/templates/ad-step.tsx` | O seletor de oferta sobe pro **topo**, preenchido com a oferta ativa e mostrado sempre que houver mais de 1 oferta. Não espera mais o 422. A lista "From your Meta account" passa a chamar `api.meta.ads({ limit: 20, offerId })` e mostra 2 seções: **"{offer}"** (`this`, depois `unknown` com o chip "Not sure") e **"Other products"** (`other`), recolhida por padrão com a contagem. Cada linha tem o menu "Not from {offer}" / "From {offer}" / "From another offer…". Linha `other` → confirmação do §7. Avisos do §6 acima da lista. |
| Iterate · Pick from Meta | `web/src/components/iterate/new-screen.tsx` (lista `adsQ`, ~l. 400) | `adsQ += offerId` (o `offerId` do seletor ou o `defaultOfferId`). Mesmas 2 seções, menu, confirmação e avisos. A busca por `metaAdId` pré-selecionado (`?metaAdId=`) continua sem `offerId`. Trocar a oferta no seletor refaz a lista. |
| Campanhas | `web/src/components/campaigns/campaigns-screen.tsx` | Seletor de oferta na barra de filtros (padrão: a ativa; opção "All offers" = sem `offerId`). Abas **"{offer} (n)" · "Not sure (n)" · "Other products (n)"** com `offerScope` e `meta.offer.counts`. Aba padrão: `this`, ou `unknown` se `this = 0`. Coluna/chip da oferta atribuída (`offer.offerName`, com a dica do `match`). Menu da linha de anúncio e da linha de campanha (nível CAMPAIGN: "All ads in this campaign are from {offer}"). Na visão por campanha, a linha mostra `offerMix`. |
| Home · "melhor pra iterar" | `web/src/app/(app)/page.tsx` (~l. 132) | `api.meta.ads({ verdict: 'WINNER', limit: 1, offerId })` com a oferta ativa. Se a linha vier `fit = 'other'`, o card **não** sugere iterar e cai pro passo "upload", como sem vencedor. O texto ganha o nome da oferta ("Best ad for {offer}"). Sem oferta ativa = igual a hoje. |
| Tour e onboarding (`goals-brain-steps.tsx`, `eddy-moments.tsx`) | — | **Não mudam** nesta v1. Rodam com 1 oferta recém-criada, e mandar `offerId` ali é opcional. |
| Mocks | `web/src/mocks/handlers-meta.ts`, `web/src/mocks/campaigns.ts` | `offer` nas linhas, `meta.offer`, as 2 rotas de `offer-links`. Massa com os 3 grupos e uma conta "só posts" pro aviso. |
| i18n | `web/messages/en.json`, `web/messages/pt-BR.json` | Seções, abas, menu, confirmação e os 3 avisos do §6. |

## 9. Arquivos

**Backend (`maquina-backend`; o lookup é de `maquina-integracoes`/ia, quem já mexe em `integracoes/meta`):**
- `api/prisma/schema.prisma` + `api/prisma/migrations/20261105000100_meta_offer_match/migration.sql` (§2.4)
- `api/src/integracoes/contrato.ts`: `MetaAdSnapshotDraft += destinationUrls: string[]; destinationSource: MetaDestinationSource | null; urlTags: string | null`; `MetaSyncInput += knownCreativeLinks?: Record<string, { destinationUrls: string[]; destinationSource: MetaDestinationSource; urlTags: string | null }>`
- `api/src/integracoes/meta/leitura.ts`: lookup único por criativo (§2.1) no lugar do `fillStoryVideoIds`, depois dos insights e por gasto (§2.2), encurtadores (§2.3); `api/src/integracoes/meta/mock.service.ts` (links fake: casa, prefixo, Kiwify, estrangeiro, post, lead); `off.service.ts` sem mudança; `PORTA.md` (sonda S1)
- `api/src/integracoes/claude/subdominios.ts`: `export` de `PLATFORM_DOMAINS` + `mycartpanda.com` (só isso)
- `api/src/meta/oferta-match.ts` + `oferta-match.spec.ts` (novos, puros: §3 inteiro, com os exemplos do §3.7 como casos)
- `api/src/meta/sync.service.ts`: cache por criativo ao gravar; `ads()` com `offerId`/`offerScope`, grupos, veredito da oferta, `meta.offer`
- `api/src/meta/campanhas.service.ts` (+ `campanhas.views.ts`): `offerId`/`offerScope` em lista e detalhe, `offerMix`
- `api/src/meta/oferta-links.service.ts` (novo) + rotas em `meta.controller.ts` + DTOs em `meta.dto.ts` (`MetaAdsQueryDto`/`MetaCampaignsQueryDto`/`MetaCampaignDetailQueryDto += offerId, offerScope`; `MetaOfferLinkBodyDto`, `MetaOfferLinkQueryDto`)
- Testes de integração: `api/src/meta/*.int.spec.ts` da rota nova e do agrupamento (o QA roda a suíte completa no fim, conforme a regra do recorte)

**Frontend (`maquina-frontend`):**
- `web/src/lib/api/client.ts` (`meta.offerLinks.put/delete`), `web/src/lib/active-offer.ts` (novo)
- `web/src/components/templates/ad-step.tsx`, `web/src/components/iterate/new-screen.tsx`, `web/src/components/campaigns/campaigns-screen.tsx`, `web/src/app/(app)/page.tsx`
- Componentes compartilhados novos (sugestão): `web/src/components/meta/offer-fit-menu.tsx` (menu da correção) e `web/src/components/meta/offer-sections.tsx` (as 2 seções e os avisos), usados pelos 3 pickers
- `web/src/mocks/handlers-meta.ts`, `web/src/mocks/campaigns.ts`, `web/messages/en.json`, `web/messages/pt-BR.json`

**Arquiteto (feito):** este contrato e os tipos opcionais em `contratos/src/meta.ts` e `contratos/src/campanhas.ts`.

## 10. Ordem
A0 (arquiteto, feito: tipos) → **ok do Gusta** → S1 (sonda na conta real) ‖ F1 (web contra os mocks) → B1 (migração + `oferta-match.ts` + spec) → B2 (lookup no sync + cache) ‖ B3 (`ads()`/`campaigns()` com `offerId` + rotas de correção) → F2 (web contra a API) → Q (QA: os 12 exemplos do §3.7 numa conta mock + conta real do Gusta).

## 11. Decisões (recomendadas; viram aprovadas com o ok)
- **D1.** O link vem do lookup **por criativo**, que já existe pro `video_id` e agora traz os dois, com cache entre syncs (criativo é imutável) e teto de 250 por sync priorizado por gasto. A listagem continua leve.
- **D2.** O casamento é **calculado na leitura**, não gravado no snapshot. Snapshot só guarda o link bruto. Motivo: oferta nova, URL editada e correção manual valem na hora, sem esperar o sync.
- **D3.** A correção manual fica numa tabela própria (`meta_offer_links`), por anúncio ou campanha, chaveada por `adAccountId` + id da Meta. Sobrevive a sync e a reconexão. `BELONGS` é exclusivo (um produto por anúncio).
- **D4.** Ordem das regras: manual → manual da campanha → HookMill → campeão → link exato/prefixo → nome → irmão → só domínio. Empate não decide.
- **D5.** Link lido que não bate com **nenhuma** oferta vai pra "Other products" (`foreign_link`). É o que resolve a conta com produtos que nem estão no HookMill. Só vale quando a oferta tem URL.
- **D6.** Lista agrupada `this` → `unknown` → `other`. Nada some. "Not sure" fica junto da oferta (com chip), "Other products" recolhido.
- **D7.** Com 3 ou mais elegíveis na oferta, o veredito WINNER é recalculado **dentro da oferta**. Abaixo disso, vale o da conta (`verdictScope` diz qual).
- **D8.** `workspace.websiteUrl` só conta com 1 oferta ativa. Checkout de plataforma só casa com id de produto (o domínio da Hotmart sozinho não diz nada).
- **D9.** Iterar anúncio de outro produto não é bloqueado: o web confirma e lembra a escolha.
- **D10.** "Oferta ativa" é estado do web (`localStorage`) nesta v1. Nenhuma coluna nova em workspace ou membro.
- **D11.** Nenhum código de erro novo. `NOT_FOUND` com `resource` e `VALIDATION_ERROR` com `requires_offer`.

## 12. Pendências pro Gusta
1. **Ok no contrato** (D1-D11), principalmente a **D5**: anúncio com link de site desconhecido vai direto pra "outros produtos". A alternativa é deixá-lo em "Not sure".
2. **D7**, veredito dentro da oferta: mínimo de 3 elegíveis está bom, ou prefere sempre o da conta?
3. **Seletor global de oferta** no cabeçalho (vira a "oferta ativa" de verdade, guardada no servidor por membro). Fica pra v2 ou já entra?
4. **Sonda S1** na sua conta: preciso de um sync real depois do B2 pra conferir os campos do link (§2.1), principalmente em criativo flexível/Advantage+ e em anúncio de post existente.
5. O **cérebro 3D** ligando o anúncio da Meta à oferta certa, usando a mesma função: entra numa v1.1?

## Aprovação do Gusta (04/11)
- D5: link pra site que não é de nenhuma oferta do HookMill → **"outros produtos"** (aprovado).
- D7: campeão recalculado dentro da oferta com **≥ 3** anúncios elegíveis (aprovado).
- Oferta ativa: seletor por tela, guardada no navegador (v1, aprovado). Seletor global no servidor fica pra v2.
- Sync real (só leitura) na conta dele depois da leitura do link: **autorizado**.
- Status: APROVADO; implementar depois da caça de bugs do Codex (evitar edição concorrente).
