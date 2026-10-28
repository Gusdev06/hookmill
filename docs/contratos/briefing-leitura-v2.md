# Briefing por link v2 — leitura em camadas: contrato
Data: 2026-10-22 · Dono: maquina-arquiteto · Status: **proposta, aguardando ok do Gusta** (decisões D1–D5 do §9).
Gatilho: teste live de 22/10 — quiz 100 % JS (`https://thekingdomoflove.vercel.app`) devolveu 135 caracteres por HTTP puro e o job `OFFER_EXTRACT` caiu em `PAGE_UNREADABLE`. Pedido do Gusta: **"ele precisa ler todo tipo de página, deve ser capaz de scrollar, ver subpágina, ler imagens… tudo"**.
Base: [`api.md` §4](api.md) (`POST /offers/extract`, `Job`, checklist), [`estrutura.md` §2.1](estrutura.md) (`ClaudeService.extractOffer`), `docs/integracoes.md` (extractOffer, custos), código atual `api/src/integracoes/claude/{pagina,subdominios,prompts,claude.service}.ts`, passo 1 já em curso da ia `api/src/integracoes/claude/render-pagina.ts` + `api/src/common/util/navegador.ts`, Chromium headless do Remotion (`api/src/medicao/captura-pagina.ts`, custo US$ 0). Pedido original dos subdomínios: 16/10.

## 0. Resumo em 5 linhas
1. A leitura vira **4 camadas em cascata**, cada uma só roda se a anterior não bastou: HTTP puro (hoje) → **render headless com scroll** (US$ 0) → **subpáginas** da mesma oferta por prioridade (checkout, preço, sobre, FAQ, depoimentos, garantia, obrigado) → **imagens** (print fatiado + maiores `<img>`) lidas pelo Claude com visão.
2. Tetos duros por briefing: **6 páginas, 8 imagens, ~110 mil caracteres de texto, 75 s de leitura, US$ 0,25**. Pior caso ≈ **2 min** e **US$ 0,22**; caso comum (landing estática) continua ≈ 10 s e US$ 0,02.
3. O briefing passa a dizer **de onde veio cada campo** (página principal, checkout, imagem 3…): `ExtractSources` ganha `readMode`, `pages`, `imagesRead`, `fieldOrigins`; o web mostra "Lido de: página principal, checkout, 3 imagens".
4. Checklist do job ganha etapas `fetching_page → rendering_page → reading_subpages → reading_images → extracting → detecting_language`, com `progress`. Etapa que não precisou rodar é marcada feita na hora.
5. **Fora da v2:** clicar nas etapas de quiz/funil e transcrever VSL (anotado no §6). Quando nada der, o `action` continua `paste_page_text`.

## 1. Camadas (D1)
| # | camada | quando roda | o que lê | tempo | custo |
|---|---|---|---|---|---|
| a | **HTTP puro** (`pagina.ts`, hoje) | sempre, primeiro | HTML → texto, `title`, `description`, `alt`, links | ≤ 15 s | 0 |
| b | **Render headless + scroll** (`render-pagina.ts`, passo 1 da ia) | texto de (a) < 2 000 caracteres **ou** marcador de SPA (`<div id="root"\|"__next"\|"app">` com body quase vazio, `<noscript>` pedindo JS) **ou** (d) precisa de print | abre no chrome-headless-shell do Remotion, viewport celular 390×844 @2x, `networkidle2`, rola até o fim (lazy-load, seções "ao rolar"), lê `innerText` + alt + `<noscript>` + links internos (href + texto da âncora) + print da página inteira (só se (d) pedir) | ≤ 20 s navegação + ≤ 30 s scroll, teto 35 s | 0 |
| c | **Subpáginas** (§2) | sempre que a principal foi lida (a ou b) e houver link candidato | até 6 páginas da mesma oferta, por prioridade, cada uma por (a) e, se vier vazia, por (b) | ≤ 30 s no total, 2 em paralelo, ≤ 8 s cada | 0 |
| d | **Imagens** (§3) | gatilho do §3.1 | print fatiado em telas + maiores `<img>` + poster de vídeo, mandadas ao Claude na **mesma chamada** do briefing | +5 s de print; a chamada do Claude cresce ~10 s | ~US$ 0,01 por imagem, teto 8 |
| e | **Quiz/funil multi-etapa** | — | **fora da v2** (§6) | — | — |
| f | **Vídeo/VSL** | — | **fora** (§6); só o poster/thumb entra em (d) | — | — |

Regras da cascata:
- (a) e (b) são **a mesma leitura da mesma URL**; a melhor das duas vence (mais texto). Se (b) não tiver binário (`REMOTION_BROWSER_EXECUTABLE` ausente e nada em `node_modules/.remotion`), a cascata segue como hoje e o `readMode` registra `http`.
- Orçamento total de **leitura = 75 s de relógio** (a+b+c+d). Estourou = segue pro `extracting` com o que leu; nunca falha por teto se já tem ≥ 200 caracteres.
- `PAGE_UNREADABLE` só depois de (a) **e** (b) devolverem < 200 caracteres **e** (d) não ter imagem pra ler (página vazia de verdade). Página com < 200 caracteres mas com imagens → vai pra visão; o texto das imagens conta.

## 2. Subpáginas (D2)
### 2.1 Candidatas
Links da página principal (HTML de (a) ∪ DOM renderizado de (b)) cujo host é **o domínio registrável da oferta ou subdomínio dele** (`offerDomain` do `subdominios.ts`; domínio de plataforma — `vercel.app`, `hotmart.com`… — conta como da oferta só se for o host colado). Mais os subdomínios de funil do crt.sh que já existem (16/10). Se a página renderizada **não tiver nenhum link interno** (SPA/quiz), **sondar até 4 caminhos convencionais** do mesmo host: `/checkout`, `/pricing|/precos|/planos|/plans`, `/oferta|/offer`, `/obrigado|/thank-you` — GET por (a), 5 s cada, só entra se 200 e ≥ 200 caracteres.

### 2.2 Prioridade (papel pela âncora **ou** pela URL; primeira regra que casar)
| ordem | `role` | padrões (âncora e path, sem acento, case-insensitive) |
|---|---|---|
| 1 | `checkout` | checkout, comprar, buy, pay, pagamento, carrinho, cart, order, assinar, subscribe, join, get started, quero |
| 2 | `pricing` | pricing, preco(s), price, planos, plans, valor, investimento, oferta, offer |
| 3 | `about` | sobre, about, quem somos, who we are, nossa historia, our story, fundador |
| 4 | `faq` | faq, perguntas, duvidas, questions, how it works, como funciona |
| 5 | `testimonials` | depoimentos, testimonials, reviews, resultados, results, cases, alunos |
| 6 | `terms` | garantia, guarantee, reembolso, refund, termos, terms (NÃO privacidade/cookies) |
| 7 | `thankyou` | obrigado, thank-you, thanks, confirmacao, success, upsell |
| 8 | `other` | qualquer outro link interno de 1 nível (`/x`, não `/blog/x`) — só preenche vaga que sobrar |

Dentro da mesma prioridade: primeiro o link que **estiver no CTA principal** (botão, `<a>` dentro de `<button>`, classe/`role=button`), depois ordem de aparição.

### 2.3 Checkout externo de plataforma (1 exceção)
Se o CTA principal aponta pra host de checkout conhecido (`pay.hotmart.com`, `pay.kiwify.com.br`, `checkout.cakto.com.br`, `pay.kirvano.com`, `checkout.stripe.com`, `*.lemonsqueezy.com`, `buy.stripe.com`, `*.gumroad.com`, `ticto`, `perfectpay`, `eduzz`, `monetizze`, `braip` — lista em código, editável), ler **exatamente uma** página externa como `role: 'checkout'`, por (a) e depois (b), teto 10 s. Bloqueou/vazio = pula em silêncio. Justificativa: preço, parcelamento e garantia moram lá; é o que o briefing mais erra hoje.

### 2.4 Limites, dedupe, exclusões
- **Máximo 6 subpáginas** (principal fora da conta), **30 s** no total, **8 000 caracteres por subpágina** (como hoje `RELATED_PAGE_CHARS`), **60 000 na principal** (hoje `MAX_PAGE_CHARS`) → teto de texto ≈ 108 mil caracteres ≈ 27 mil tokens.
- Dedupe: URL normalizada (sem `#`, sem `utm_*`/`fbclid`/`gclid`, sem `/` final, host minúsculo); mesma `<link rel=canonical>` = mesma página; dois textos com os primeiros 500 caracteres iguais = mesma página (fica a de maior prioridade). Subpágina que redireciona pra principal ou pra fora da oferta (fora do §2.3) = descartada.
- **Não seguir:** login/signin/entrar/acesso/minha-conta/register/cadastro/logout; privacidade/privacy/cookies/politica-de-cookies/lgpd; hosts sociais (instagram, facebook, tiktok, youtube, x/twitter, linkedin, whatsapp/wa.me, t.me), `mailto:`/`tel:`; alternativas de idioma (`hreflang`, path `/en/`, `/es/` etc. diferente do path da principal); arquivos (`.pdf .zip .mp4 .jpg .png`); `/blog/`, `/post/`, `/noticias/`, paginação (`?page=`); âncoras de subdomínio na lista `SKIP` do `subdominios.ts` (help, docs, status, admin…).

## 3. Imagens (D3)
### 3.1 Gatilho (qualquer um)
1. Texto total (principal + subpáginas) **< 1 500 caracteres**; ou
2. Principal com **≥ 3 `<img>` de largura natural ≥ 400 px** e texto < 4 000 caracteres (landing "de banner"); ou
3. Nenhum padrão de preço/moeda (`R$ \d`, `US?\$ ?\d`, `€ ?\d`, `\d+x de`, `/mês`, `/month`) em todo o texto lido **e** existe palavra de compra (comprar, buy, assinar, checkout…); ou
4. Página de quiz ou VSL detectada (`quiz`/`vsl` na URL ou title; `<video>`, iframe vturb/youtube/vimeo/wistia/panda ocupando a primeira tela).

### 3.2 O que entra (teto **8 imagens** por job, nesta ordem até fechar)
1. **Print da página principal fatiado em telas** de 390×844 CSS @2x (= 780×1688 px): as **4 primeiras telas** (o resto da página raramente muda o briefing).
2. **Poster do vídeo** da primeira tela (`<video poster>`, thumbnail do YouTube/Vimeo/Vturb via `og:image` ou URL conhecida), 1 imagem.
3. **Maiores `<img>`** da principal: largura natural ≥ 200 px, não `.svg`/`.gif`, não `alt` de logo/ícone, ordenadas por área, sem repetir `src` — até fechar as 8.
4. Se sobrar vaga: 1 tela da página `checkout`/`pricing` (print renderizado), porque é onde o preço fica em imagem.

Imagens entram como blocos `image` (base64 PNG/JPEG, redimensionadas pra lado maior ≤ 1 568 px) **na mesma mensagem** do briefing, antes do texto; cada uma com rótulo `[image N — page: <role> <url> — src: …]`.

### 3.3 Custo (D4 — modelo)
Visão cobra ≈ `(largura × altura) / 750` tokens, com downscale pra ~1,15 MP → **≤ ~1 600 tokens por imagem**. 8 imagens ≈ 12 800 tokens de entrada.
| modelo | entrada/saída por M | 8 imagens (entrada) | saída extra (`imageNotes`, ~1 200 tokens) | visão por job |
|---|---|---|---|---|
| **`claude-opus-5-5`** (`ANTHROPIC_MODEL` atual, aprovado 05/10, tem visão) | US$ 4 / 20 | US$ 0,051 | US$ 0,024 | **≈ US$ 0,08** |
| `claude-fable-5-1` (pedido do tech lead hoje) | US$ 10 / 50 | US$ 0,128 | US$ 0,060 | ≈ US$ 0,19 |
Recomendação: **ficar no `claude-opus-5-5`**, que é o modelo que a API já roda em tudo (uma tabela de preço, um cache, uma sonda); Fable 5.1 custa 2,5× e o ganho pra transcrever preço e promessa de um banner é zero. Troca de modelo é só a env `ANTHROPIC_MODEL`; a tabela `custo.ts` já tem o preço dos dois (Fable entra como "desconhecido" = 10/50, correto). **Teto de visão por job: US$ 0,10** (garantido pelo teto de 8 imagens, não por corte depois).

## 4. Modelo de dados e contrato
### 4.1 Tipos (ia, `integracoes/claude/pagina.ts` e `contrato.ts`; o arquiteto recopia pro `estrutura.md` §2.1 depois do ok)
```ts
export type ReadMode = 'pasted'|'http'|'rendered'|'crawled'|'vision';   // o mais "fundo" que precisou rodar
export type PageRole = 'main'|'checkout'|'pricing'|'about'|'faq'|'testimonials'|'terms'|'thankyou'|'other';
export interface PageImage { index: number; src: string; alt: string|null; kind: 'screenshot'|'img'|'poster'; widthPx: number; heightPx: number; read?: string }  // read = o que o Claude viu (imageNotes)
export interface ReadPage { url: string; role: PageRole; title: string|null; text: string; truncated: boolean; via: 'http'|'rendered'; images: PageImage[] }
export interface PageText {              // compat: os campos de hoje continuam = página principal
  url: string; title: string|null; description: string|null; text: string; truncated: boolean; links?: string[];
  pages: ReadPage[];                     // pages[0].role === 'main'; substitui `related` (removido)
  readMode: ReadMode;
}
export interface FieldOrigin { role: PageRole; url: string; imageIndex?: number }   // imageIndex presente = veio de imagem
export interface ExtractSources {
  readMode: ReadMode;
  pages: { url: string; role: PageRole; via: 'http'|'rendered'; chars: number }[];
  imagesRead: PageImage[];               // só as que entraram na chamada, com `read`
  fieldOrigins: Partial<Record<'name'|'kind'|'what'|'audience'|'promise'|'pains'|'proof'|'offerAndPrice'|'cta'|'notes', FieldOrigin[]>>;
  /** @deprecated = pages.filter(p => p.role !== 'main').map(p => p.url); mantido 1 versão pro web atual */
  relatedUrls: string[];
}
// extractOffer: mesma assinatura; onStage passa a aceitar os 6 stages do §4.3; retorno OfferBriefDraft & Usage & ExtractSources.
// Usage.costUsd já inclui a visão (é a mesma chamada; `recordLlmCost` grava LLM ktoken_in/ktoken_out como hoje; sem linha nova).
```

**No pacote `@maquina/contratos` (`contratos/src/index.ts`, publicado 22/10):** `ReadMode`, `PageRole`, `PageImageRef` (= `PageImage` sem base64), `ReadPageRef` (= `pages[]` do `ExtractSources`), `FieldOrigin`, `FieldOrigins`, `OfferReadMeta` (= `ExtractSources` − `relatedUrls` + `costUsd` + `readAt`), `OfferExtractOutput` com os campos v2 opcionais (`readMode`, `pages`, `imagesRead`, `fieldOrigins`, `costUsd`, `readMeta`, `relatedUrls` deprecated), `Offer.readMeta`, `CreateOfferBody.readMeta`, `UpdateOfferBody.readMeta` (aceita `null`). Publicado pelo backend em 22/10 e revisado pelo arquiteto: bate com este contrato; é a forma oficial. Não existe `ExtractSources` nem `OfferExtractOutputV2`/`OfferV2` no pacote: `ExtractSources` é tipo interno da ia (`integracoes/contrato.ts`); o web usa `OfferExtractOutput`, `Offer` e `OfferReadMeta` direto e apaga o bloco provisório de `web/src/lib/api/types.ts` (renomes: `PageImageRead` → `PageImageRef`, `OfferExtractOutputV2` → `OfferExtractOutput`, `OfferV2` → `Offer`, `ExtractSources` → `OfferReadMeta`, `OriginKey` → `OfferBriefField | 'name'`).

### 4.2 Saída do job (`api.md` §4 — `Job.output` do `OFFER_EXTRACT`)
`{ name, language, sourceUrl, brief, fieldSources, readMode, pages, imagesRead, fieldOrigins, costUsd, relatedUrls }`. `fieldSources` segue **`page|user` por campo** (é o que a `Offer` persiste; não muda). `fieldOrigins` é o detalhe por campo pro web mostrar; `imagesRead[].read` é o texto curto que o modelo tirou de cada imagem.

**D5 — persistir na oferta.** Coluna nova aditiva `offers.read_meta Json?` = `{ readMode, pages, imagesRead (sem base64), fieldOrigins, costUsd, readAt }`, gravada no `POST /offers` (web manda `readMeta` do output) e no apply do `reread`. Sem ela, "lido de" só aparece durante o wizard e some ao abrir a oferta depois. Migração `20261023000000_offer_read_meta` pelo arquiteto, `npm run db:backup` antes (regra do TIME.md).

### 4.3 Checklist e progresso do job (`api.md` §4; backend)
| stage | progress | quando é emitido |
|---|---|---|
| `fetching_page` | 10 | antes de (a) |
| `rendering_page` | 25 | antes de (b); se (b) não precisou rodar, emitido e concluído na hora |
| `reading_subpages` | 45 | antes de (c); idem se não houver candidata |
| `reading_images` | 60 | antes do print/seleção de (d); idem se não disparou |
| `extracting` | 80 | antes da chamada do Claude |
| `detecting_language` | 95 | como hoje (idioma sai na mesma resposta) |
`etaSec` por stage: 5 / 20 / 25 / 10 / 20 / 1. Texto colado (`pageText`): só `extracting` e `detecting_language` (os outros 4 concluídos na hora), `readMode: 'pasted'`.
Falha: `PAGE_FORBIDDEN` / `PAGE_UNREADABLE` → `action: 'paste_page_text'` (já existe); `RATE_LIMITED` → `retry`. `failReason` ganha 2 frases novas (backend, `falhas.ts`), escolhidas pelo detalhe do `IntegracaoError`: `login_wall` → "This page is behind a login. Paste the page text, or use the public sales page link."; `empty_after_render` → "The page has no readable text, even after loading it in a browser. Paste the page text or fill the fields manually."
`EXTRACT_ESTIMATE_USD` (custos) sobe de **0,05 → 0,25** (teto do cap do workspace; o custo real gravado continua o da chamada). **Só backend:** o web nunca exibiu a estimativa da leitura (o 0,05 não aparece em tela nenhuma; o usuário só vê `SPEND_CAP_EXCEEDED` quando o cap barra), então a troca não tem efeito no frontend.

### 4.4 Quem grava `offers.read_meta` (D6 — arquiteto, 22/10, a pedido do frontend)
Lacuna: no onboarding passo 1 com oferta já existente a leitura vira `POST /offers/:id/reread` + `PATCH /offers/:id` (aplicar campos), nunca `POST /offers`; se só o `POST` levasse `readMeta`, o passo 3 não mostraria origens.
- **Regra única: quem aplica o briefing manda o `readMeta`.** O web repassa `output.readMeta` do job `OFFER_EXTRACT` no "apply", tanto em `POST /offers` (oferta nova, wizard) quanto em `PATCH /offers/:id` (reread no wizard e onboarding com oferta existente). O backend só persiste (`POST`/`PATCH` já aceitam; `PATCH` aceita `null` pra limpar). Nenhuma escrita automática ao concluir o job: `read_meta` fica coerente com o que foi aplicado, e reread descartado não sobrescreve a leitura anterior.
- `PATCH /offers/:id` aceita também `fieldSources` (mapa campo → `page|user`, QA bug 14, 22/10): o apply da leitura manda `page` nos campos aplicados e o backend grava o enviado; sem `fieldSources`, todo campo enviado vira `user` (autosave, como antes).
- `GET /offers` e `GET /offers/:id` devolvem `readMeta` sempre (`null` = criada à mão ou antes da v2). Aplicou só parte dos campos: `fieldOrigins` continua completo; `fieldSources` (`page|user`) é a verdade sobre o que está salvo.

**Aditivo 28/10 (resultado-v1, A2/A3):** `OfferExtractOutput.business: BusinessSuggestion` (`industry`, `market`, `brandColor`, `brandColorSource`, `resultType`, `shortCode`) e, na porta da ia, `ExtractSources.business` (do Claude) + `ExtractSources.brandColor` (do DOM: CTAs renderizados > `theme-color`; nunca do modelo; `integracoes/claude/cor-marca.ts`). O schema do briefing ganha `industry`, `market` (string, "" = não sabe) e `resultType` (enum com `UNKNOWN`), sem união nova (limite de 16). Regras completas em [`fase2-agencia.md`](fase2-agencia.md) "Mudanças 28/10" §1.2.

## 5. Prompt (ia, `prompts.ts`)
- `BRIEF_SYSTEM`: trocar o parágrafo de "Related pages" por: as páginas vêm rotuladas por `role` (`main`, `checkout`, `pricing`, …) e **a principal lidera**; `checkout`/`pricing` são a fonte preferida de `offerAndPrice` (preço, parcelas, garantia, bônus) mesmo contradizendo a principal, porque é onde se paga; `terms` só pra garantia/reembolso; `thankyou` só pra upsell/bônus em `notes`. Imagens: "transcreva literalmente o texto que aparece (preço, promessa, prova social, botão); descreva o produto em 1 frase; nunca invente o que não está legível". Novo campo obrigatório `sources`: pra cada campo preenchido, lista de `{ role, imageIndex? }` de onde saiu — e `imageNotes`: `[{ index, text }]` com ≤ 40 palavras por imagem lida.
- `briefUserMessage`: `<page role="main" url="…" via="rendered" cut="true?">…</page>` repetido por página na ordem do §2.2; blocos de imagem **antes** do texto, rotulados `[image N — page: role url — src]`; cabeçalho diz `Read mode: crawled+vision — 1 main page, 3 subpages, 5 images` pro modelo saber o que tem.
- `BRIEF_SCHEMA`: `sources` e `imageNotes` entram no schema (saída estruturada, como hoje); backend converte `sources` em `fieldOrigins` (role → url pela lista `pages`).
- `cache_control` continua no system; o texto das páginas não cacheia (varia por oferta).

## 6. Fora da v2 (anotado, não decidido pra sempre)
- **Quiz/funil multi-etapa (clicar "Começar/Next" até 7 telas): fora.** Motivos: (1) cada clique dispara pixel/eventos do funil **do próprio usuário** (lead falso, métrica contaminada); (2) quizzes têm 10–30 etapas e o que o briefing precisa — promessa, público, preço — está na **tela 1** (render + print) e na página de oferta/checkout que o §2.1 encontra pelos links ou pelas rotas convencionais; (3) é interação com estado (inputs, validação), classe de problema diferente de "ler". Se o QA (§8) mostrar que a tela 1 + checkout não bastam no quiz de referência, v3 avalia "clicar só botões sem input, até 5 telas, sem enviar formulário".
- **VSL/vídeo: fora.** Só o poster entra como imagem (§3.2). Transcrever VSL = baixar mídia de player de terceiros (Vturb, YouTube) + Whisper (WaveSpeed, ~US$ 0,01/min) — v3, se o briefing continuar fraco em página só-VSL.

## 7. Segurança e limites (D2 inclui)
- **SSRF**: igual hoje (`assertPublicHost` em cada hop + interceptação de sub-recurso pra IP privado no headless), aplicada **a cada subpágina e ao checkout externo**.
- **robots.txt: ignorado.** É a oferta do próprio usuário, ≤ 7 páginas por job, sem recorrência; não somos crawler. UA de navegador (como hoje; UA de bot é bloqueada por Cloudflare e afins).
- **Sem cookies, sem login, sem formulário**: perfil de navegador novo por job (`mkdtemp`, já é assim), nunca digita, nunca submete, nunca clica (v2). Página com `<input type=password>` visível ou redirect pra `/login|/signin|/entrar` com texto < 1 000 caracteres = `PAGE_UNREADABLE` detalhe `login_wall`. 401/403/451/desafio de bot seguem `PAGE_FORBIDDEN`.
- Tetos: 75 s de leitura, 3 MB por resposta HTTP (hoje), 108 mil caracteres de texto, 8 imagens, 6 subpáginas + 1 checkout externo, 1 chamada do Claude (timeout 60 s), US$ 0,25 de estimativa. Tudo constante em código com nome; sem env nova.
- Print e imagens **não vão pro storage** (vivem no tmp do job e morrem com ele); só `imagesRead[].read` e `src` ficam no output. Se o Gusta quiser ver a imagem lida no web, v3 sobe como `File PAGE_CAPTURE` (já existe o kind).

## 8. Tarefas por dono (ordem: ia → backend → frontend → qa; arquiteto no fim)
| dono | entrega | pastas | depende |
|---|---|---|---|
| **maquina-ia** | (b) fechar `render-pagina.ts` como leitor injetável do `fetchPage`; (c) `subpaginas.ts` novo (prioridade §2.2, exclusões §2.4, rotas convencionais, checkout externo §2.3), absorvendo o `subdominios.ts`; (d) `imagens.ts` (gatilho §3.1, seleção §3.2, fatiamento do print, redimensionar ≤ 1 568 px); `PageText.pages`/`readMode`; prompt §5 + schema; `ExtractSources` novo; 6 stages; testes com fixtures locais (HTML estático, SPA com `innerText` só após JS, página com preço só em `<img>`), mock `FakeClaudeService` devolvendo `fieldOrigins` e `imageNotes` (gatilho `mock-vision` na URL) | `api/src/integracoes/`, `api/src/common/util/navegador.ts` | ok do Gusta |
| **maquina-backend** | `STAGE_PROGRESS` com os 6 stages + `etaSec`; `job.presenter` `OFFER_EXTRACT` com 6 chaves; `OfferExtractOutput` com `readMode/pages/imagesRead/fieldOrigins/costUsd`; `sources` → `fieldOrigins`; `falhas.ts` com as 2 frases; `EXTRACT_ESTIMATE_USD = 0.25` (só backend, §4.3); `POST`/`PATCH /offers` aceitam `readMeta` (feito), `GET /offers`/`:id` devolvem sempre; nada automático ao concluir o job (§4.4 D6) | `api/src/ofertas/`, `api/src/jobs/`, `api/src/common/errors/`, `api/src/custos/` | tipos da ia (`contrato.ts`); tipos do pacote já publicados |
| **maquina-frontend** | checklist com 6 etapas (i18n `offers.checklist.rendering_page` "Loading the page in a browser", `reading_subpages` "Reading checkout, pricing and about pages", `reading_images` "Reading images and banners"; PT-BR idem); bloco "Lido de: página principal, checkout, 3 imagens" (substitui `AlsoRead`), tooltip por campo com a origem (`fieldOrigins`); frase do `login_wall`; mocks em `web/src/mocks/db.ts` com `readMode: 'vision'`; **apagar o bloco provisório de `web/src/lib/api/types.ts` e importar os tipos do pacote** (renomes no §4.1); mandar `output.readMeta` no apply — `POST /offers` (nova) e `PATCH /offers/:id` (reread no wizard e onboarding com oferta existente) — e ler `offer.readMeta` do `GET` no passo 3 (§4.4) | `web/` | output do backend; `@maquina/contratos` (já publicado) |
| **maquina-qa** | 5 páginas de referência, cada uma com o esperado por campo e `readMode`: (1) estática — landing HTML simples; (2) **SPA/quiz** `https://thekingdomoflove.vercel.app` (esperado: `rendered` ou `vision`, briefing com promessa da tela 1 e preço se achar checkout); (3) landing com **preço só em imagem** (esperado `vision`, `offerAndPrice` com `imageIndex`); (4) oferta com **checkout em subdomínio** (esperado `crawled`, `offerAndPrice` com `role: checkout`); (5) **página atrás de login** (esperado `PAGE_UNREADABLE` + frase `login_wall` + `action paste_page_text`). Medir tempo e `costUsd` reais de cada (ok do Gusta antes das chamadas pagas: ≤ US$ 1,25 no total). Só o QA declara "funciona". | `testes/` | tudo acima |
| **maquina-arquiteto** | recopiar tipos pro `estrutura.md` §2.1 e `api.md` §4; migração `offer_read_meta` (D5); revisão contra este contrato | `docs/`, `api/prisma/` | ok do Gusta |

**Sem conflito de pasta**: ia só em `integracoes/` + `common/util/navegador.ts` (já é dela desde o passo 1); backend não toca em `integracoes/`; `medicao/captura-pagina.ts` (vídeo) só re-exporta `acharNavegador` — nada mais muda lá.

## 9. Decisões pro Gusta (recomendação em negrito)
| # | decisão | recomendação |
|---|---|---|
| **D1** | Cascata de 4 camadas com os tetos do §1 (6 subpáginas, 8 imagens, 75 s, US$ 0,25) | **aprovar** |
| **D2** | Subpáginas: prioridade §2.2, **1 checkout externo de plataforma** (§2.3), rotas convencionais quando não há link, robots.txt ignorado, nunca clica/digita | **aprovar** |
| **D3** | Imagens só com gatilho (§3.1), print 4 telas + poster + maiores `<img>`, na mesma chamada do briefing | **aprovar** |
| **D4** | Modelo da visão: **`claude-opus-5-5`** (atual, ≈ US$ 0,08 por 8 imagens) vs `claude-fable-5-1` (≈ US$ 0,19, 2,5×, sem ganho pra ler banner) | **Opus 5.5** |
| **D5** | Quiz multi-etapa e VSL **fora da v2** (§6); persistir `offers.read_meta` (coluna aditiva) pra "lido de" sobreviver ao wizard | **fora + persistir** |
| **D6** | (arquiteto, 22/10, §4.4) `readMeta` vai no apply: `POST /offers` (nova) ou `PATCH /offers/:id` (reread/onboarding), sempre do `output` do job; backend só persiste. Tipos v2 do pacote são a forma oficial (§4.1), web apaga o bloco provisório | decidido |

**Aprovação:** Gusta aprovou D1–D5 como recomendado em 22/10 (via tech lead). D6 é desdobramento técnico, sem custo nem mudança de produto.

## 10. Custo e tempo por briefing
| cenário | leitura | Claude | total tempo | custo |
|---|---|---|---|---|
| landing estática com texto (comum) | 5–10 s (a + 2 subpáginas) | 10 s | **~20 s** | ~US$ 0,02–0,04 |
| SPA/quiz (caso de 22/10) | 15 s (a falha, b renderiza) + 15 s (c) + 5 s (d) | 25 s | **~60 s** | ~US$ 0,10 |
| **pior caso** (b + 6 subpáginas + checkout externo + 8 imagens, texto no teto) | 75 s (teto) | ≤ 60 s (27 k tokens de texto + 12,8 k de imagem, saída ~2 k) | **≤ ~2 min 15 s** | **≈ US$ 0,22** (entrada 0,16 + saída 0,04 + margem); cap 0,25 |
Texto colado: como hoje (~10 s, ~US$ 0,01). Polling do web continua 1,5 s; `etaSec` por stage evita barra parada.
