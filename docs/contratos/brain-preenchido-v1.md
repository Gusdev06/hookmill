# Cérebro preenchido v1 · adendo do Brain 3D (mais nós vindos do setup)
Data: 2026-11-04 · Dono: maquina-arquiteto · Status: **os 4 itens foram aprovados pelo Gusta em 04/11**. As regras abaixo (§2-§6) são do arquiteto e ainda precisam do visto dele. **Os tipos já estão em `contratos/src/brain.ts`**: o pacote passa no typecheck, e api e web quebram nos pontos esperados (§8).
Base: [`brain-3d-v1.md`](brain-3d-v1.md) (vale tudo o que este adendo não muda), [`kit-marca-v1.md`](kit-marca-v1.md) (`brand_assets`), [`briefing-leitura-v2.md`](briefing-leitura-v2.md) D5 (`offers.read_meta.pages`), [`lacunas-home-eddy-v1.md`](lacunas-home-eddy-v1.md) §3 (`needsYou`/`statusLabel`). Pedido do Gusta: "o mapa do Cérebro parecer mais preenchido".

## 0. Resumo
1. **Seis kinds novos, nenhuma categoria nova.** `brand_asset` (logo, arquivo ou vídeo demo), `brand_color` (cor do logo), `offer_field` (what/promise/offerAndPrice/cta), `pain` (item de `pains`), `proof_item` (item de `proof`) e `source` (site do cliente ou página que a leitura usou). Cores: brand, provas e fontes ficam em `business`; campos em `offers`; dores em `audience`.
2. **Não há migração nem custo de IA.** Tudo vem de colunas que já existem: `brand_assets` + `files`, `offers.what/promise/offer_and_price/cta/pains/proof/field_sources/read_meta` e `workspaces.website_url`. A montagem ganha 1 consulta (`brand_assets`) e passa de 8 pra 9 (o limite é 10).
3. **Os nós novos entram cedo e com teto.** Ficam logo depois do centro, negócio e metas (marca e site) e logo depois do núcleo das ofertas (campos, dores, provas e páginas). O teto somado é de **160 nós** (`BRAIN_MAX_SETUP_DETAIL`), e os criativos continuam com pelo menos ~500 dos 800.
4. **Dores e provas viram itens por uma regra determinística (§2).** Cada item tem um id estável, `sha1` do texto normalizado, e o teto é de 8 itens por oferta. O nó `audience` continua e as dores penduram nele. O nó `proof` continua como pai, e os `proof_item` só aparecem quando a divisão dá **≥ 2 itens**.
5. **O cache do servidor passa a ser derrubado na escrita.** Hoje, depois de mexer no kit, o servidor segue entregando o grafo velho por até 60 s mesmo com o web invalidando a query. O backend chama `BrainCache.invalidate(workspaceId)` no kit, nas ofertas e no `PATCH /workspace`.

## 1. Nós novos (`kind` → `category`)
| kind | category | 1 nó por | fonte | entra quando | id (`<kind>:<chave>`) · `refId` |
|---|---|---|---|---|---|
| `brand_asset` | business | `BrandAsset` | `kind`, `label`, `offerId`, `createdAt` + `File.mimeType/storageKey/durationSec` | sempre: LOGO (1), DEMO_VIDEO (≤ 5, todos), FILE (os **8** mais recentes, `BRAIN_MAX_BRAND_FILES`) | `brand_asset:<assetId>` · assetId |
| `brand_color` | business | cor distinta do logo (`BrandAsset.colors` do LOGO, até 5) | hex | o nó do logo entrou e `colors` não está vazio | `brand_color:<rrggbb minúsculo>` · `rrggbb` |
| `offer_field` | offers | campo preenchido de oferta incluída | `what`, `promise`, `offerAndPrice`, `cta` (ordem fixa `BRAIN_OFFER_FIELDS`) + `fieldSources[campo]` | `filled(campo)` | `offer_field:<offerId>:<campo>` · `<offerId>:<campo>` |
| `pain` | audience | item de `Offer.pains` (§2) | texto do item | ≥ 1 item | `pain:<offerId>:<h12>` · `<offerId>:<h12>` |
| `proof_item` | business | item de `Offer.proof` (§2) | texto do item | a divisão deu **≥ 2** itens (com 1 item o nó `proof` já é o item) | `proof_item:<offerId>:<h12>` · `<offerId>:<h12>` |
| `source` | business | URL normalizada distinta (§4) | `Workspace.websiteUrl` + `Offer.readMeta.pages[]` das ofertas incluídas | site preenchido ou oferta com `readMeta` | `source:<h12>` · `h12` |

`h12` são os 12 primeiros hex do `sha1` do texto normalizado com o `normaliza()` do gancho (trim, minúsculas, espaços colapsados). O hash é **por oferta**: a mesma dor em 2 ofertas vira 2 nós, porque dor e prova são da oferta. O `NODE_ID` do service (`^([a-z_]+):(.{1,200})$`) já aceita chave com `:`.

**O que muda nos nós que já existem**
- **`business`**: passa a entrar também quando há asset no kit ou alguma fonte (`businessOn ||= brandAssets.length > 0 || sources.length > 0`). Assim o kit e as fontes sempre têm onde pendurar. Se tipo, setor, mercado e site estiverem vazios, o rótulo cai pro host da 1ª fonte e, sem fonte, pro `Workspace.name`. Hoje o `corta(...)!` quebraria. Corrige o que o kit-marca-v1 §5 deixava em aberto ("kit sem nenhum desses não cria o nó").
- **`audience`**: continua 1 por oferta, entra quando há `audience` ou `pains`, e as dores viram filhos dele. Rótulo: `corta(audience, 80)` e, com `audience` vazio, `corta(offer.name, 80)`. Não usa mais a 1ª dor, pra não repetir o rótulo do filho. O summary não muda.
- **`proof`**: continua 1 por oferta (id, `uses_proof`, "Edit in setup"). Com ≥ 2 itens o rótulo vira o **1º item** e os filhos são `proof_item`. Com 1 item, nada muda.
- **`offer`**: o summary continua `promise ?? what`, que agora também aparecem como nó.

### 1.1 Rótulos (`label` ≤ 80, `summary` ≤ 200, com `corta()`)
| kind | label | summary |
|---|---|---|
| `brand_asset` | `BrandAsset.label`; se vazio, um fallback em EN: `Logo`, `Brand file <n>`, `Demo video <n>` (n = ordem por `createdAt` asc dentro do kind, começando em 1). O web, com `meta.customLabel === null`, mostra o i18n (§7) | nome da oferta quando `offerId`; senão null |
| `brand_color` | `#RRGGBB` (maiúsculo) | null |
| `offer_field` | texto do campo | texto do campo (200) |
| `pain`, `proof_item` | texto do item | texto do item (200) |
| `source` | `host + path + search`, sem protocolo, sem `www.`, sem `/` final (ex. `heirloomjar.com/quiz/3`) | URL completa |

### 1.2 Peso (0..1)
`brand_asset` LOGO 0,5, os outros 0,4 · `brand_color` 0,2 · `offer_field` 0,35 · `pain` 0,3 · `proof_item` 0,3 · `source` site 0,45, página 0,3.

### 1.3 `needsYou` / `statusLabel`
Valem `false` e `null` em todos os kinds novos, pela regra de lacunas-home-eddy-v1 §3.1 pra "outros".

## 2. Divisão de `pains` e `proof` (regra única, `dividirItens(texto, max)`)
É função pura no `brain.montagem.ts` e o mock do web replica o mesmo algoritmo:
1. `filled(texto)` falso → `[]`. Troca `\r\n` por `\n`.
2. **Linhas:** se há ≥ 2 linhas não vazias, cada linha é um candidato.
3. Senão, **ponto e vírgula:** se há `;`, divide em `;`.
4. Senão, **bullet inline:** se há ≥ 2 ocorrências de `•` ou ` - ` / ` – ` / ` — ` cercados de espaço, divide nelas.
5. Senão, **frases:** divide em `/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}"“'¿¡])/u` (pontuação final + espaço + maiúscula, dígito ou aspas).
6. Em cada candidato: tira o marcador inicial `/^\s*(?:[-*•·–—]|\d{1,2}[.)])\s+/`, faz trim e tira `;` e `,` do fim. O ponto final fica.
7. Descarta candidatos com menos de 3 caracteres. Deduplica por `normaliza()` mantendo o 1º. Corta em `max` (`BRAIN_MAX_PAINS_PER_OFFER` = `BRAIN_MAX_PROOFS_PER_OFFER` = 8).
8. Nenhum candidato válido, mas texto preenchido → `[corta(texto, 200)]`.

O teto de 8 é regra da divisão, não amostragem: `counts.pain.total` e `counts.proof_item.total` contam **depois** do teto. O drawer do pai (`audience`, `proof`) continua mostrando o texto inteiro. `meta.index`/`meta.of` dão a posição ("2 of 5"). Exemplos que entram nos testes:
- `"Falta de tempo\nCansaço\n- Dinheiro curto"` → 3.
- `"Sem tempo; sem dinheiro; sem foco"` → 3.
- `"Já tentou de tudo. Nada funcionou! E o tempo passa."` → 3.
- `"Mais de 10.000 alunas"` → 1, e com 1 não há `proof_item` (o "10.000" não quebra: o ponto não vem seguido de espaço).

## 3. Amostragem (`brain-3d-v1` §1.3 com os passos novos em **negrito**)
Os kinds novos dividem o orçamento `BRAIN_MAX_SETUP_DETAIL = 160`. Item que passa do orçamento é pulado e conta em `total > shown` (`truncated`), mas **não marca `cheio`**: a amostragem segue pros criativos. O teto de 800 continua valendo pra tudo.
1. `workspace`, `business`, `goal`.
2. **Kit:** o LOGO com suas `brand_color` (uma unidade), os DEMO_VIDEO (mais recentes primeiro) e os FILE (os 8 mais recentes).
3. **Site:** `source` do `websiteUrl`.
4. Núcleo das ofertas, como hoje: `offer` + `audience` + `proof` + `instructions`, até 30.
5. **Detalhe das ofertas,** oferta por oferta na mesma ordem: `offer_field` (ordem fixa), `pain`, `proof_item`, `source` das páginas (`readMeta.pages` na ordem gravada, com `main` primeiro, até 6 por oferta, `BRAIN_MAX_SOURCES_PER_OFFER`, e até 12 fontes no workspace contando o site, `BRAIN_MAX_SOURCES`).
6. Daqui pra frente nada muda: criativos vencedores, lotes, anúncios WINNER e assim por diante.

`?offerId=` recorta pra oferta: entram os assets com `offerId` null ou igual ao filtro, o site, as páginas só daquela oferta e os campos, dores e provas só dela. Com `limitar: false` (drawer), nenhum teto novo vale, e o drawer acha qualquer nó que exista.

Conta pra um cliente típico (1 a 3 ofertas): 1 logo + 5 cores + 1 demo + 3 arquivos + 4 campos, 5 dores, 4 provas e 4 páginas por oferta dão **~25 a 60 nós a mais**. Esse é o "mais preenchido" que o Gusta pediu, sem tirar espaço dos criativos.

## 4. Fontes (`source`)
- **De onde vêm:** `Workspace.websiteUrl` (site do cadastro) e `Offer.readMeta.pages[]` (`ReadPageRef { url, role, via, chars }`), gravado no apply da leitura (briefing-leitura-v2 D5/D6). O "Read from: main page, quiz step · 1 image" do onboarding é esse mesmo `readMeta`, e não há outra fonte persistida. O `sources: [{ field, role, imageIndex }]` do commit 4feea0e é a **saída interna do modelo**: vira `readMeta.fieldOrigins`, e o Brain não o lê direto. As imagens lidas (`imagesRead`) **não viram nó**: não dá pra ligar uma imagem à página com segurança (`PageImageRef` não tem a URL da página). A contagem aparece no drawer da oferta (`offer.imagesRead`, §6).
- **Normalização da chave:** `new URL()` (inválida = ignora); host em minúsculas sem `www.`; path sem `/` final (a raiz vira vazio); query mantida; hash, protocolo e porta padrão descartados. `h12 = sha1(host + path + search)`. Assim o site `https://x.com` e a página `https://www.x.com/` viram **o mesmo nó**, com `isWebsite: true` e `roles: ['main']`.
- **`meta.url`** é a primeira URL vista (site antes de página). `roles` é a união dos `role` das páginas, sem repetição, na ordem em que aparecem. `offers` conta as ofertas cuja leitura usou a página e `readAt` é o `readMeta.readAt` mais recente entre elas.

## 5. Arestas novas (`from → to`)
| kind | de → para | regra |
|---|---|---|
| `has_brand` | `business` → `brand_asset` | asset sem `offerId`, ou com `offerId` de oferta fora do grafo (arquivada, fora dos 30 ou fora do recorte) |
| `for_offer` (já existe) | `brand_asset` → `offer` | asset com `offerId` cuja oferta está no grafo. Nesse caso **não** sai `has_brand`. O LOGO sempre usa `has_brand`, porque é da marca toda |
| `has_color` | `brand_asset` (LOGO) → `brand_color` | cor do logo |
| `has_field` | `offer` → `offer_field` | campo preenchido |
| `has_pain` | `audience` → `pain` | item da oferta |
| `has_proof` | `proof` → `proof_item` | item da oferta (≥ 2) |
| `read_from` | `business` → `source` | toda fonte |
| `read_from` | `offer` → `source` | página que está no `readMeta.pages` daquela oferta |

O teto de 2 500 arestas continua. Nenhum nó novo fica solto: o `business` sempre existe quando há kit ou fonte (§1).

## 6. Drawer (`GET /brain/node/:id`, padrão `detalhe()`)
| kind | `fields` (chave → valor) | `media` | `open` |
|---|---|---|---|
| `brand_asset` | `brand.kind` (LOGO/FILE/DEMO_VIDEO), `brand.label`, `brand.mimeType`, `brand.sizeBytes`, `brand.durationSec` (vídeo), `brand.colors` (LOGO, `"#AABBCC, #…"`), `brand.offerName` (nome da oferta ou null), `brand.createdAt` (ISO), `brand.downloadUrl` (URL assinada 6 h; o web usa no "Open file" do PDF) | imagem: `{ videoUrl: null, posterUrl: <assinada> }` · PDF: `null` · DEMO_VIDEO: `{ videoUrl: <assinada>, posterUrl: null }` | `{ route: 'brand', id: assetId }` |
| `brand_color` | `brand.hex`, `brand.logo` (rótulo do logo) | null | `{ route: 'brand' }` |
| `offer_field` | `offer.<campo>` (texto inteiro), `offer.readFrom` (`JSON.stringify(FieldOrigin[])` de `readMeta.fieldOrigins[campo]` ou null), `offer.fieldSource` (`page`/`user`/null), `offer.offerName` | null | `{ route: 'setup', step: 3 }` |
| `pain` | `pain.item` (texto inteiro do item), `pain.position` (`index + 1`), `pain.of`, `pain.offerName` | null | `{ route: 'setup', step: 4 }` |
| `proof_item` | `proof.item`, `proof.position`, `proof.of`, `proof.offerName` | null | `{ route: 'setup', step: 3 }` |
| `source` | `source.url`, `source.roles` (papéis separados por vírgula; o web traduz cada um por `offers.role.*`), `source.via` (do 1º `ReadPageRef`), `source.chars`, `source.readAt`, `source.offers` (nomes separados por ` · `), `source.isWebsite` (1/0) | null | site: `{ route: 'setup', step: 1 }`; página: `{ route: 'offer', id: <1ª oferta que a leu> }` |
| `offer` (muda) | + `offer.imagesRead` (`readMeta.imagesRead.length` ou null) | — | — |
| `business` (muda) | sem mudança nas chaves. O backend pode ler o kit dos `dados` em vez da consulta à parte | o mesmo | o mesmo |

`meta.setupStep`: `offer_field` 3, `pain` 4, `proof_item` 3. O `SETUP_STEP` do backend ganha essas 3 chaves. `brand_asset`, `brand_color` e `source` não têm `setupStep`.
Miniatura no grafo: `meta.thumbnailUrl` do `brand_asset` vai assinada pelo `assinar()`, como no criativo. Hoje o `thumbKeys` só preenche `creative`/`batch`, e o backend estende pra `brand_asset` de imagem. É o arquivo original (até 25 MB, porque o kit não gera miniatura). O web carrega com `loading="lazy"` e só na List e no drawer. Gerar miniatura do kit fica fora deste adendo.

## 7. i18n que o frontend escreve (EN e PT-BR, `web/messages/en.json` e `pt-BR.json`)
- `brain.g.edge.has_brand` "brand" / "marca" · `has_color` "color" / "cor" · `has_field` "detail" / "detalhe" · `has_pain` "pain" / "dor" · `has_proof` "proof" / "prova" · `read_from` "read from" / "lido de". (O tipo de chave do next-intl já quebra o `brain-drawer.tsx:327` sem elas.)
- `brain.g.kind.brand_asset.LOGO` "Logo" / "Logo" · `.FILE` "Brand file {n}" / "Arquivo da marca {n}" · `.DEMO_VIDEO` "Demo video {n}" / "Vídeo demo {n}". São os fallbacks de `customLabel: null`, e o `n` sai da posição do nó no kind, igual ao label.
- Eyebrow do drawer (`brain.g.eyebrow.*`): `brand_asset` "Brand kit" / "Kit da marca", `brand_color` "Brand color" / "Cor da marca", `offer_field` "Offer detail" / "Detalhe da oferta", `pain` "Pain" / "Dor", `proof_item` "Proof" / "Prova", `source` "Source" / "Fonte", `website` "Website" / "Site".
- `brain.g.drawer.field.*` (rótulo = 2º segmento da chave, como o renderer faz hoje; `of`, `via`, `isWebsite` e `downloadUrl` não viram linha): `item` "Text" / "Texto", `position` "{index} of {of}" / "{index} de {of}", `offerName` "Offer" / "Oferta", `logo` "Logo" / "Logo", `readFrom` "Read from" / "Lido de", `fieldSource` "From your page" / "Da sua página" (só quando `page`), `imagesRead` "Images read" / "Imagens lidas", `hex` "Color" / "Cor", `kind` (já existe, "Type"), `label` "Name" / "Nome", `mimeType` "Format" / "Formato", `sizeBytes` "Size" / "Tamanho", `durationSec` "Length" / "Duração", `colors` "Logo colors" / "Cores do logo", `createdAt` "Added" / "Adicionado em", `url` "Address" / "Endereço", `roles` "Read as" / "Lido como", `chars` "Text read" / "Texto lido", `readAt` "Read on" / "Lido em", `offers` "Used by" / "Usado por".
- `brain.g.drawer.openFile` "Open file" / "Abrir arquivo" · `openBrand` "Open the brand kit" / "Abrir o kit da marca" · `openPage` "Open page" / "Abrir página" (link externo `rel="noopener noreferrer"`).
- `brain.g.ghost.business` (muda) EN "Comes from setup, step 1, or the brand kit" / PT "Vem do setup, passo 1, ou do kit da marca".
O papel da página (`main`, `quiz_step`…) reaproveita `offers.role.*`, que já existe.

## 8. O que backend e frontend tocam
**Typecheck em 04/11, depois dos tipos novos:** o `contratos` passa. A **api tem 2 erros**: `brain.montagem.ts:21` (`BRAIN_CATEGORY_OF` sem os 6 kinds) e `brain.service.ts:281` (o `switch` de `detalhe()` não cobre os kinds novos). O **web tem 3 erros**: `lib/brain-graph.ts:17` (`CATEGORY_OF`), `mocks/handlers-brain.ts:66` (o índice cai do `CATEGORY_OF`) e `components/brain/brain-drawer.tsx:327` (chave `edge.<kind>` sem i18n).

| # | dono | arquivos | o quê | verificação |
|---|---|---|---|---|
| B6 | maquina-backend | `api/src/brain/brain.montagem.ts` | espelhar `BRAIN_NODE_KINDS`, `BRAIN_CATEGORY_OF` e as constantes novas; `SETUP_STEP` + `offer_field`/`pain`/`proof_item`; `dividirItens()` e `normalizaUrl()` puras e exportadas; `DadosOferta` + `fieldSources`, `readMeta` (`pages`, `fieldOrigins`, `imagesRead.length`, `readAt`); `BrainDados.brandAssets`; nós §1, regra do `business`/`audience`/`proof` (§1), amostragem §3, arestas §5 | `brain.montagem.spec.ts`: exemplos §2; site e página iguais = 1 nó; asset com oferta → `for_offer`, sem oferta ou de oferta arquivada → `has_brand`; LOGO → cores; 1 prova = sem `proof_item`; 30 ofertas cheias ≤ 160 nós novos e criativos ainda entram; nenhuma aresta pendurada; `?offerId` recorta |
| B6 | maquina-backend | `api/src/brain/brain.service.ts` | `carregar()`: `offers.select` + `fieldSources`, `readMeta`; consulta `brandAsset.findMany` (com `file { storageKey, mimeType, sizeBytes, durationSec }`, `offer { archivedAt }`), total de 9 consultas; `assinar()` e `node()` assinam a miniatura de `brand_asset`; `detalhe()` com os 6 `case` (§6) + `offer.imagesRead`; `open()` (§6); o `business` pode usar `dados.brandAssets` | `brain.int.spec.ts`: drawer de LOGO/FILE PDF/DEMO_VIDEO (media certa, `downloadUrl`), de `source` e de `pain`; ≤ 10 queries |
| B6 | maquina-backend | `api/src/brain/brain.cache.ts`, `brain.module.ts`, `api/src/brand-kit/brand-kit.service.ts` + `.module.ts`, `api/src/ofertas/ofertas.service.ts` + módulo, `api/src/workspaces/workspaces.service.ts` + módulo | `BrainCache.invalidate(workspaceId)` (derruba as chaves `<wid>\|`, sem o limite de 10 s do `fresh`); `BrainModule` exporta `BrainCache`; kit (create/update/remove), ofertas (create/update/archive/reread apply) e `PATCH /workspace` chamam depois de gravar. O `BrainModule` não importa ninguém, então não há ciclo | int: subir asset → `GET /brain/graph` logo em seguida já traz o nó |
| F6 | maquina-frontend | `web/src/lib/brain-graph.ts` | `BRAIN_KINDS` e `CATEGORY_OF` com os 6 kinds; `searchText` inclui `meta.url` do `source` e `meta.hex` da cor; `isMediaNode` continua só criativo/anúncio (o kit não entra na galeria G) | web `tsc` |
| F6 | maquina-frontend | `web/src/components/brain/brain-drawer.tsx` | `SETUP_KINDS` + `offer_field`, `pain`, `proof_item`. Ramos novos: `brand_asset` (Player com pôster/vídeo, "Open file" pro PDF, swatches das cores, "Open the brand kit" → `/brain` aba Brand pra OWNER/ADMIN/MEMBER); `brand_color` (swatch grande + hex); `source` (papéis por `offers.role.*`, "Open page" externo, ofertas). Eyebrow por kind (§7); label do `brand_asset` com `customLabel === null` pelo i18n; `open.route === 'brand'` | desktop, 390 px, CLIENT sem botões de edição |
| F6 | maquina-frontend | `web/src/components/brain/brain-list.tsx`, `brain-globe.tsx` (só se desenhar miniatura/cor) | List: miniatura do `brand_asset` com `loading="lazy"`; `brand_color` com bolinha da própria cor; subtítulo do `source` com o papel. Globo: opcional, `brand_color` pintado com o próprio hex (o halo continua a cor da categoria) | visual no mock |
| F6 | maquina-frontend | `web/src/mocks/handlers-brain.ts` | gerar os 6 kinds no mock (logo + 3 cores, 1 PDF, 1 PNG, 1 demo; 4 campos; dores e provas com a mesma `dividirItens` portada; site + 2 páginas com `quiz_step`) e drawer por kind | `npm run dev` com MSW |
| F6 | maquina-frontend | `web/messages/en.json`, `web/messages/pt-BR.json` | chaves do §7 | web `tsc` (chaves tipadas) |
| A6 | maquina-arquiteto | `contratos/src/brain.ts` (**feito 04/11**), este arquivo, `api.md` (1 linha) | tipos + contrato | `contratos` typecheck ok |
| Q6 | maquina-qa | `testes/` | cliente novo só com site → `business` + `source`; cliente cheio (kit, 3 ofertas com dores e provas em lista, quiz lido) → contar nós novos ≤ 160, criativos presentes; trocar o logo → nó novo na hora; CLIENT; mobile List | só o qa declara "funciona" |
Pastas sem conflito: B6 só em `api/`, F6 só em `web/`, Q6 em `testes/`. B6 e F6 podem rodar em paralelo, com o F6 em cima do MSW.

## 9. Decisões deste adendo (arquiteto, aguardam visto do Gusta)
- **P1 Sem categoria nova:** kit, cores, provas e fontes ficam em `business`. Um cliente cheio põe ~25 a 35 nós ali, e o setor do globo comporta isso. Se ficar ilegível no QA, a saída é uma categoria `brand` própria (custo: 1 cor + 1 chip; nenhum dado muda).
- **P2 Asset com `offerId`** liga à oferta (`for_offer`), não ao negócio. O logo sempre liga ao negócio.
- **P3 `proof` vira pai + itens** só com ≥ 2 itens. Com 1 item, um filho repetiria o pai.
- **P4 Dores sempre como itens** (≥ 1), penduradas no `audience`, que continua com o texto de "pra quem é".
- **P5 Imagens lidas não viram nó**, porque não há como ligar a imagem à página. Ficam como contagem no drawer da oferta.
- **P6 Fora deste adendo:** a cor do cadastro (`Workspace.brandColor`) como nó (só as do logo, como foi aprovado) e a geração de miniatura do kit.
