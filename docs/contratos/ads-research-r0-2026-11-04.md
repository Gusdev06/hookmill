# Ad Radar: sonda R0 (04/11/2026)
Dono: maquina-ia · Contrato: [`ads-research-v1.md`](ads-research-v1.md) §12 · Autorização: Gusta, §"Aprovação" (até US$ 0,50, token do Trendcat).
Script (fora do repo): `/private/tmp/claude-501/-Users-gustagoat-Documents-AIS-OS-projects-maquina-anuncios/a6a8e875-7a1e-4f4d-a32d-85540f527dcd/scratchpad/r0/` (`run.mjs`, `an.py`, `out/*.json` com o dataset e o run de cada rodada). API da 3001 e código intocados.

**Gasto total: US$ 0,1552** (12 runs). Conta `trendcat` (plano FREE, teto US$ 5/ciclo, ciclo 29/10–28/11): uso foi de US$ 0,5550 para US$ 0,7103. O delta da conta bate com a soma dos runs.

## 1. Números

Actor `curious_coder~facebook-ads-library-scraper`, memória 512 MB, `scrapePageAds.activeStatus=active`, `sortBy=impressions_desc`, `countryCode=US`.

| run | fonte | pedido | itens | custo real (usageTotalUsd) | latência (fim a fim / runtime) | com vídeo |
|---|---|---|---|---|---|---|
| hallow | `facebook.com/hallowapp` (marca grande, oração) | 30, sem details | 30 | US$ 0,02255 | 13,2 s / 10,7 s | 21/30 (70 %) |
| abide | `facebook.com/abideapp` (média, oração) | 30, sem details | 30 | US$ 0,02255 | 11,2 s / 9,6 s | 24/30 (80 %) |
| duolingo_det | `facebook.com/duolingo` (marca grande, app) | 50, **com** details | 12 (só 12 ativos nos EUA) | US$ 0,00905 | 11,9 s / 10,1 s | 9/12 (75 %) |
| hallow_pid100 | `ads/library/?view_all_page_id=531203563996048` | 100, sem details | 100 | US$ 0,07505 | 20,6 s / 18,9 s | 69/100 (69 %) |
| dominio_hallow | `q=hallow.com&search_type=keyword_unordered` | 30 | 30 | US$ 0,02255 | 10,3 s / 8,6 s | 20/30 |
| glorify_det / pray_det | `facebook.com/glorifyapp`, `/praydotcom` (slug errado) | 30 | 1 item de erro `PAGE_PRIVATE` | US$ 0,0008 cada | ~6 s | — |
| um_anuncio, um_anuncio2 | `ads/library/?id=<adId>`, `count: 1` | 1 | 1 item de erro | US$ 0,0008 cada | 3–6 s | — |
| um_anuncio10 / _svc10 / _abide / _full | `ads/library/?id=<adId>` (4 variações), `count: 10` | 10 | **0** | US$ 0,00005 cada | 7–16 s | — |

**Taxa de vídeo:** 123 de 172 anúncios reais com vídeo = **72 %** (vídeo direto em `snapshot.videos` ou dentro de `cards` de DCO).

### Modelo de custo confirmado
- **US$ 0,00075 por item no dataset** (= US$ 0,75/1k; o "~0,20/1k" do README do ad-radar está desatualizado) **+ US$ 0,00005 por run** (`apify-actor-start`, 1 evento por GB de memória, mínimo 1). Pay-per-event: o compute **não** é cobrado de nós. Conferido em todos os runs: `30 × 0,00075 + 0,00005 = 0,02255`.
- **`scrapeAdDetails` não muda o preço** (mesmo US$ 0,00075/item). Nos EUA ele só acrescenta `transparency_by_location` (todos `null`): alcance UE não aparece pra filtro US.
- **Item de erro é cobrado como anúncio** (slug inexistente, `count` inválido). O custo fixo de ~US$ 0,006/run do contrato não existe: a hipótese veio do campeão de 1 anúncio, que hoje nem funciona (§3).
- **O `usageTotalUsd` demora 5–15 s pra assentar** depois do `SUCCEEDED` (li US$ 0,00005 em runs de 30 itens logo no fim). Ler o run de novo antes de gravar o custo.

### Latência e limite
- ~7–8 s de partida + ~0,11 s/anúncio. **200 anúncios: estimativa de 30–40 s.** A faixa do contrato (40–90 s) é folgada; o teto de 6 min sobra.
- **`limitPerSource` foi respeitado exatamente** (30 → 30, 100 → 100; o "até +30" do schema não apareceu).
- **A ordem por impressões é estável:** os 30 primeiros do run por slug são os mesmos 30 primeiros do run por `view_all_page_id`, na mesma ordem.
- Posição (`position`) repete em variações agrupadas: 30 itens = 26 posições, todos com `ad_archive_id` distinto.

## 2. Campos reais (172 anúncios)
| campo | o que veio |
|---|---|
| `start_date` / `end_date` | 100 %. Em anúncio ativo, `end_date` ≈ hoje: o "no ar há X dias" sai certo. Hallow: de 16 a 200 dias; Abide: de 5 a 173. |
| `is_active` | 100 % `true` (filtro ativo). |
| `snapshot.display_format` | `VIDEO` 72, **`DCO` 53**, `IMAGE` 16, `CAROUSEL` 1, `DPA` 1 (no domínio). **DCO tem 2–11 `cards`, muitos com `video_hd_url`.** |
| `publisher_platform` | `FACEBOOK`, `INSTAGRAM`, `AUDIENCE_NETWORK`, `MESSENGER`, **`THREADS`** e **`WHATSAPP`** (o contrato lista 4). |
| `collation_count` | `null` em 17 % (24/142); o resto de 1 a 6. |
| `snapshot.page_profile_picture_url` | 100 %. Também vem `snapshot.page_like_count` (Hallow 627.700). |
| texto, CTA, `link_url` | 100 % (no topo ou no 1º card). |
| `impressions_with_index.impressions_text` | **sempre `null`** (o carimbo `<100` não aparece nos EUA). |
| país | **não vem**: `targeted_or_reached_countries: []`, `snapshot.country_iso_code: null`. Confirma o contrato: país é filtro da busca. |
| `spend`, `reach_estimate`, `total_active_time` | sempre `null`. |
| mídia | vídeo HD no máximo **720p** (720×1280 ou 720×720); imagem original 1080–1620 px; `watermarked_*` também vem. `extra_videos` sempre vazio. |

## 3. URLs de mídia e fonte
- **Validade (`oe`): 104–108 h depois da coleta (~4,4 dias)**, em vídeo, poster e imagem. Não são "horas", como dizia o aprendizado do ad-radar. `cache-control: max-age=1209600`.
- **Download:** 6 arquivos (4 vídeos, 2 imagens), todos HTTP 200; os vídeos **decodificados inteiros** com `ffmpeg -f null` sem erro (12,9 s a 26,7 s, h264+aac). Sem truncamento nesta amostra.
- **Navegador:** sem Referer ou com `Origin` de outro site = 200, com `access-control-allow-origin: *` e `cross-origin-resource-policy: cross-origin`. **Com Referer de outro site** (`app.hookmill.ai`, `localhost`) = **302** pra `video.xx.fbcdn.net`, que responde 200 com o mesmo CORS e o **mesmo arquivo** (byte a byte). O `<video src>` direto do fbcdn toca (segue o redirect); `Range` = 206 (seek funciona).
- **Reteste após ~15 min:** às 05:24 UTC (~20 min depois da coleta das 05:03), 3 vídeos e 3 posters do Hallow: todos 200. O vídeo baixado de novo é **idêntico byte a byte** ao das 05:05. O teste de 4 dias (perto do `oe`, 08/11 ~14h UTC) não foi feito.
- **Slug de Página:** `facebook.com/<slug>` funciona quando o slug existe (hallowapp, abideapp, duolingo; o `page_id` real vem no item). Slug errado devolve **1 item `{ error: "Page is private", errorCode: "PAGE_PRIVATE" }`, cobrado** (US$ 0,00075).
- **Domínio como fonte:** `hallow.com` trouxe 26 Hallow + 2 de uma Página-satélite (Jonathan Roumie, embaixador, link `try.hallow.com`) + **2 de ruído** (Halloween: Fright-Rags e um filme do Tubi). **13 % de lixo**, e sobe em domínio com palavra comum.
- **URL de anúncio único (`?id=`) NÃO funciona hoje:** com `count: 1` o actor recusa (`"Maximum charged results" option must be atleast 10`) e cobra o item de erro; com `count: 10`, em 4 variações (só `?id=`, com `active_status/country=ALL`, 2 anúncios diferentes), devolve **0 itens** (log: `pushCount: 0, fetchCount: 0`).

## 4. O que confirma e o que derruba no contrato
| item do contrato | veredito |
|---|---|
| Actor da Apify como fonte (§1) | **Confirma.** Funciona por slug e por `view_all_page_id`, com os campos que o card precisa. |
| US$ 0,75/1k | **Confirma** (exato). Custo fixo por run: **US$ 0,00005**, não ~US$ 0,006. |
| Latência 40–90 s pra 200 | **Confirma com folga** (estimado 30–40 s). |
| `limitPerSource` + ordem por impressões | **Confirma** (exato e estável). |
| "URLs do fbcdn expiram em horas" | **Derruba**: ~4,4 dias. O poster pode ser servido direto do fbcdn até o `oe`; o vídeo só precisa ir pro storage quando alguém salva ou usa (§6 do contrato segue certo). |
| `<video>` toca o fbcdn direto | **Confirma** (CORS `*`, redirect por Referer é transparente). |
| URL de anúncio `?id=` vira fonte `PAGE` (§2) | **Derruba.** O actor não resolve anúncio único. Ou o campo recusa `?id=` com dica ("cole o link da Página"), ou outro caminho resolve a Página. |
| Plataformas (4) e formatos | **Ajustar:** + `THREADS`, `WHATSAPP`; `DCO` é ~1/3 dos anúncios e tem vídeo nos `cards`; existe `DPA`. |
| Carimbo `<100`, alcance UE no card | **Não aparece nos EUA.** Card não depende deles. |
| Custo por concorrente/mês (§9) | **Confirma a faixa.** Semanal (4,33 coletas/mês) com 200: **US$ 0,65/mês**; com 60: **US$ 0,20/mês**; importação de 200: US$ 0,15 uma vez. |
| Limites SAMPLE 1 / PAID 5 | **Confirma**, com uma ressalva no teto abaixo. SAMPLE (1 × 100, sem atualização): **US$ 0,075**. |
| Teto de US$ 3/mês por workspace | **Apertado no pior caso.** 5 concorrentes no teto de 200: **US$ 3,25/mês** só do semanal; no 1º mês, com as 5 importações, **US$ 4,00**. Com 60 ativos cada: US$ 1,00/mês (US$ 1,23 no 1º). Concorrente real varia muito: Hallow passa de 100 ativos nos EUA, Duolingo tem 12. |

## 5. Recomendações (pro arquiteto e pro dono da porta)
1. **Teto do PAID: US$ 4/mês** (ou manter US$ 3 e descontar a importação do teto). Alternativa: coleta semanal com `limit = min(200, lastActiveCount + 30)`; quem tem 60 ativos não paga 200.
2. **País como parâmetro da fonte** (padrão = mercado do cliente, ex.: `US`), não `ALL`. Menos ruído, menos itens e o "nos EUA" fica explícito no card.
3. **Toda coleta passa `maxTotalChargeUsd = (limit + 30) × 0,00075 + 0,001`** na query do run: trava dura na Apify, além do teto nosso. Precisa permitir ≥ 10 itens, senão o actor falha (e cobra o item de erro).
4. **Filtrar itens com `error`** antes do mapeamento: `PAGE_PRIVATE` vira `AD_NOT_FOUND`/"Página não encontrada", não anúncio. Gravar o custo mesmo assim.
5. **Ler o run de novo ~15 s depois do fim** antes de gravar o custo (ou calcular `itens × 0,00075 + 0,00005 × GB` e conferir depois).
6. **Mapeamento:** `DCO` com vídeo em card conta como vídeo (o `mapAdItem` já pega `cards[]` com vídeo); acrescentar `THREADS`/`WHATSAPP`, `DPA`, `page_like_count`; `mediaExpiresAt` = `oe` (hex → epoch) do vídeo.
7. **Domínio:** manter na v1, mas o grid agrupa por Página e o cliente pode **ocultar** Página de ruído naquela fonte.
8. **Fonte `?id=`:** recusar na v1 com dica. **Bug no campeão por link:** o `ApifyAdLibraryService.resolve()` (`count: 1` com `?id=`) não funciona live hoje. Com `count: 1` dá erro de "Maximum charged results" (e é cobrado); com 10, volta 0 itens. Não sei há quanto tempo está assim, porque o caminho nunca foi validado live. Precisa de outro meio (outro actor, ou pedir a URL da Página e achar o anúncio por `ad_archive_id` na coleta da Página) e de decisão do Gusta.
9. **R7 continua valendo:** a conta usada aqui é a do Trendcat (FREE, teto US$ 5/ciclo, US$ 0,71 usados). O volume de 5 workspaces PAID no teto (~US$ 16–20/mês) já estoura ela. A conta própria do HookMill tem que existir antes do live.
