# Ad Radar: sonda R1, descoberta automática em 3 Brains reais (04/11/2026)
Dono: maquina-ia · Contrato: [`ads-research-v1.md`](ads-research-v1.md) §2 e §12 · Autorização: Gusta, "Aprovação (04/11, noite)" (até US$ 1,50; token do Trendcat).
Script (fora do repo): `/private/tmp/claude-501/-Users-gustagoat-Documents-AIS-OS-projects-maquina-anuncios/a6a8e875-7a1e-4f4d-a32d-85540f527dcd/scratchpad/r1/` (`run.mjs` = D1–D5, `d2b.mjs` = experimento de confirmação por nome, `tables.py`, `out/<brain>/*.json` com cada etapa, `out/ledger.json` com cada chamada e o custo real). Banco `maquina` lido em modo somente leitura. Código da API e a API da 3001 não foram tocados.

**Gasto total das 3 rodadas: US$ 1,4206.** Rodada 3 ([§7](#7-rodada-3-termos-tipados-e-troca-de-termo-fraco-0411-noite)): US$ 0,3655 do teto de 0,50 (Claude 0,0665 + Apify 0,2991, 26 runs; conta de 1,5817 a 1,8810). Rodada 1: US$ 0,5608 (Claude 0,1030 + Apify 0,4578, 43 runs; conta `trendcat` de US$ 0,7104 a 1,1687). Rodada 2 ([§6](#6-rodada-2-com-os-ajustes-0411-noite)): US$ 0,4943 do teto de 0,50 (Claude 0,0818 + Apify 0,4125, 33 runs; conta de 1,1687 a 1,5815). Os deltas da conta batem com a soma dos runs.
**Custo por descoberta: rodada 1 US$ 0,098–0,135 (média 0,122); rodada 2 US$ 0,151–0,188 (média 0,165); rodada 3 US$ 0,067–0,164 (média 0,122)**, contra os ~US$ 0,20 estimados. Tempo de 46 a 163 s.

## Pra o Gusta: marque "acertou/errou" em cada linha (rodada 1; a rodada 2 está no §6)
- **Negrito = os 5 que ela seguiria; R = reserva.** A ordem é a do contrato (D5: score do juiz, depois anúncios vistos). A coluna "D5 ajustado" mostra a ordem que eu recomendo (§4, ajuste 4).
- "Ativos vistos" é **o que apareceu nas sondas** (até 10 por candidato do Claude e até 40 por termo), não o total da Página: a Ad Library não dá o total por esse actor. O total aparece na importação (até 150).
- "Mais antigo visto" = o `start_date` mais antigo entre os anúncios dessas sondas, que vêm por impressões, então o mais antigo da Página pode ser ainda mais velho.
- "Suspeita" é a minha leitura, não a do juiz.

### Brain 1: The Kingdom of Love (corrente de oração pra reconquistar o amor), workspace `cmw1jm4v…` · país inferido **US** (market "Global", funil em inglês) · termos: `prayer for love` · `get him back` · `love spell`
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | suspeita | D5 ajustado | acertou? |
|---|---|---|---|---|---|---|---|---|---|
| **1** | [Zara Valon](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=641548699046935) | 2 | 125 d | termo | 88 | Vende "Feitiço de Obsessão" personalizado pra a pessoa pensar em você; 66 mil curtidas | — | 4 | |
| **2** | [Lara Devine of Devine Revelations](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=109259478686878) | 2 | 302 d | termo | 85 | "Feitiço de Obsessão de Vênus" pra reconquistar o ex | — | 3 | |
| **3** | [Amara - The Turkish Oracle](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1106023699254098) | 4 | 71 d | termo | 82 | Rituais pra fazer a pessoa voltar | — | 1 | |
| **4** | [Amanda Reyes](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1019849597885765) | 4 | 42 d | termo | 80 | "Feitiço proibido" pra reconquistar o ex | — | 2 | |
| **5** | [Isabella Garcia](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=629448426929186) | 1 | 73 d | termo, 1 anúncio | 78 | Feitiço de amor | Página pequena (1 anúncio na amostra) | 8 | |
| R6 | [Leila Garcia](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=812421085290571) | 1 | 73 d | termo, 1 anúncio | 76 | Ritual pra fazer o homem voltar | Mesmo dia de início da Isabella Garcia: pode ser o mesmo anunciante | 9 | |
| R7 | [Oranum](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=157978064229997) | 3 | 272 d | Claude | 75 | Leitura com vidente, inclui amor | Vizinho (vidente ao vivo), não corrente de oração | 6 | |
| R8 | [Kasamba](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=215604521805778) | 10 | 177 d | Claude | 72 | Vidente 24 h | Vizinho, como o Oranum | 5 | |
| R9 | [Astrologer & spiritualist USA](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=391526107381761) | 1 | 201 d | termo, 1 anúncio | 70 | Astrologia e "cura espiritual" | Página genérica de "spell caster" | 7 | |
| R10 | [The Daya Program](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1334028699791431) | 1 | 41 d | termo, 1 anúncio | 68 | Manifestação pra atrair amor | — | 10 | |
| R11 | [Best Psychic And Spiritual Healer In USA](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1027768517081454) | 1 | 41 d | termo, 1 anúncio | 68 | Astrologia védica | Página genérica de "spell caster" | 11 | |
| R12 | [Wiccanbrew](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1392944117587464) | 1 | 28 d | termo, 1 anúncio | 65 | Feitiços wicca | — | 12 | |
| R13 | [Dr Ajoro Spell Caster](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1276649622190944) | 0 | 102 d | termo, 1 anúncio | 60 | Feitiço de amor | Sem anúncio ativo na amostra; perfil típico de golpe | 13 | |

Funil: Claude propôs 7 (Maria Duval, Psychic Source, Keen, Oranum, Kasamba, Astrology.com, Hyperlink Love Spells) → **2 confirmados** (Oranum, Kasamba); 2 sem nenhum anúncio (`ADS_NOT_FOUND`, cobrado US$ 0,0008 cada); 3 com anúncios de outras Páginas (busca por `keen.com` trouxe jogo, aviação e remédio). Termos: `prayer for love` voltou 0; os outros 2 trouxeram 59 Páginas, 15 com ≥ 2 anúncios. O juiz julgou 61 Páginas e aprovou 13 (reprovou Hallow, PrayerSong, apps de novela e páginas de saúde). **Os 5 de cima são funis de feitiço/reconquista em VSL, o mesmo formato da oferta.** O Claude não conhecia nenhum deles: todos vieram dos termos.
Custo US$ 0,1330 (D1 0,0077 · D2 0,0341 · D3 0,0609 · D4 0,0303) · 140 s.

### Brain 2: Pocketwise (app de finanças pessoais), workspace "HookMill — exemplos" · sem market, ramo nem site → país **US** (padrão, oferta em inglês com US$) · termos: `budget app` · `track spending` · `cancel subscriptions`
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | suspeita | D5 ajustado | acertou? |
|---|---|---|---|---|---|---|---|---|---|
| **1** | [Rocket Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=633318986770616) | 17 | 78 d | Claude + termo | 95 | App que rastreia gastos e acha economia; mesma promessa | — | 1 | |
| **2** | [Copilot Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=113463060054159) | 4 | 15 d | Claude | 90 | App de orçamento e gastos | — | 2 | |
| **3** | [Hiatus](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=858637057592811) | 4 | 301 d | termo | 85 | Gastos e assinaturas | — | 3 | |
| **4** | [Shistesprurttunt Brogliplapu](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1259916997210525) | 1 | 13 d | termo, 1 anúncio | 80 | Anuncia o "SubGuard", rastreador de assinaturas | **Nome sem sentido**: Página descartável | 11 | |
| **5** | [The Sheetflow](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1177742422082457) | 1 | 9 d | termo, 1 anúncio | 80 | Orçamento pessoal | Provável planilha, não app | 12 | |
| R6 | [EveryDollar](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1536851196550018) | 14 | 70 d | Claude + termo | 75 | App de orçamento com muita verba | Devia estar nos 5 | 4 | |
| R7 | [Muse](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1300124196515361) | 2 | 0 d | termo | 75 | Assinaturas e economia | — | 6 | |
| R8 | [GGCPlanners](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=105087407590363) | 1 | 81 d | termo, 1 anúncio | 75 | Planner financeiro | Provável planner/planilha | 13 | |
| R9 | [Offline Leger](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1400195623166302) | 1 | 19 d | termo, 1 anúncio | 75 | App de orçamento | — | 14 | |
| R10 | [Sub Manager Gotyourback](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=126486283889262) | 5 | 10 d | termo | 70 | Rastreia e cancela assinaturas | — | 5 | |
| R11 | [Budget Canvas](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1054634881061557) | 0 | 260 d | termo, 1 anúncio | 70 | App grátis de orçamento | Sem anúncio ativo na amostra | 15 | |
| R12 | [Subtracker](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1204160889439572) | 4 | 13 d | termo | 65 | Assinaturas | — | 8 | |
| R13 | [Axtell Ohm Lindsay](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1092246193962759) | 2 | 12 d | termo | 65 | App grátis de orçamento | Nome de pessoa: Página descartável | 10 | |
| R14 | [Subсаddу](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=721885631006297) | 5 | 19 d | termo | 60 | Acha e cancela cobranças | Nome com letras cirílicas: Página descartável | 7 | |
| R15 | [Simple Academy Insights](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1186241871247342) | 2 | 24 d | termo | 60 | Rastreia e cancela assinaturas | — | 9 | |

Funil: Claude propôs 7 (Rocket Money, YNAB, Monarch Money, Copilot Money, Simplifi, PocketGuard, Goodbudget) → **2 confirmados** (Rocket Money e Copilot, **os 2 pelo nome da Página, nenhum pelo domínio**: anúncio de app aponta pra loja de apps, não pro site); YNAB e Simplifi com 1 anúncio só; Monarch e PocketGuard sem nada por domínio; Goodbudget trouxe a Edmunds. Termos: 120 anúncios, 40 Páginas, 22 com ≥ 2. Juiz: 39 julgadas, 17 aprovadas (2 ficaram fora do limite de 5 + 10).
Custo US$ 0,1346 (D1 0,0075 · D2 0,0198 · D3 0,0902 · D4 0,0172) · 121 s.

### Brain 3: Geraew (plataforma de IA pra influencer digital, vídeo e imagem), workspace `cmvz0czv…` · sem market → país inferido **BR** (site `.com.br`) · termos: `influencer digital IA` · `vídeos com IA` · `criar sem aparecer`
Escolhi a Geraew porque é oferta real do Gusta, tem Brain preenchido, é em português e não tem market (testa a inferência de país). Não foi preciso montar Brain à mão.
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | suspeita | D5 ajustado | acertou? |
|---|---|---|---|---|---|---|---|---|---|
| **1** | [HeyGen](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=103228746153839) | 10 | 105 d | Claude | 92 | Vídeo com avatar de IA sem câmera nem estúdio | Vizinho (avatar falante, B2B) | 1 | |
| **2** | [Runway](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1369755289823565) | 1 | 13 d | termo, 1 anúncio | 90 | Gerador de vídeo com IA | Ferramenta profissional, público diferente | 5 | |
| **3** | [Arcads AI](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=332742426590967) | 5 | 144 d | Claude | 88 | UGC e anúncios com IA | — | 3 | |
| **4** | [Dreamina](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=531699063370865) | 1 | 5 d | termo, 1 anúncio | 87 | Vídeo 4K com IA (CapCut) | — | 7 | |
| **5** | [Varvos](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1001203829746458) | 11 | 179 d | termo | 85 | Vídeo com IA em segundos pra rede social | **Provavelmente o concorrente mais direto no Brasil** | 2 | |
| R6 | [Kairogen.ai](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1167116993147066) | 1 | 25 d | termo, 1 anúncio | 83 | Vídeo com áudio nativo | — | 6 | |
| R7 | [Jay Maker AI](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=578814011989326) | 2 | 21 d | termo | 80 | Cria e publica vídeo com IA "sem aparecer" | Mesma promessa da Geraew | 4 | |

Funil: Claude propôs 8 (Higgsfield, Krea, HeyGen, Creatify, Arcads, Freepik, Leonardo AI, Synthesia) → **2 confirmados** (HeyGen e Arcads). 5 trouxeram outras Páginas: `leonardo.ai` trouxe dentistas e advogados chamados Leonardo; `higgsfield.ai` trouxe o Iman Gadzhi, que cita a ferramenta. **2 dos 3 termos voltaram 0** como frase exata (`influencer digital IA`, `criar sem aparecer`). Só `vídeos com IA` trouxe Páginas (14). Juiz: 16 julgadas, 7 aprovadas. **Faltou o nicho exato** (plataforma brasileira de influencer de IA): termos ruins + poucas Páginas = reserva curta (2).
Custo US$ 0,0976 (D1 0,0090 · D2 0,0469 · D3 0,0316 · D4 0,0101) · 114 s.

## 1. Custo e tempo medidos
| | estimativa (§2.2) | Kingdom | Pocketwise | Geraew | leitura |
|---|---|---|---|---|---|
| D1 propor (Sonnet 5.5, effort medium) | 0,03 | 0,0077 | 0,0075 | 0,0090 | ~1,5k tokens de entrada + 0,5k de saída: 1/4 da estimativa |
| D2 confirmar (7–8 sondas de 10) | 0,06 | 0,0341 | 0,0198 | 0,0469 | sonda vazia custa US$ 0,0008 (item `ADS_NOT_FOUND`) |
| D3 varrer (3 × 40) | 0,09 | 0,0609 | 0,0902 | 0,0316 | termo que volta 0 custa US$ 0,0008 |
| D4 julgar (Haiku 4.5) | 0,01 | 0,0303 | 0,0172 | 0,0101 | escala com o nº de Páginas (61 Páginas = 11,5k tokens de entrada) |
| **Total** | **0,20** | **0,1330** | **0,1346** | **0,0976** | **média 0,122; trava de 0,30 com folga** |
| Tempo | 1–2 min | 140 s | 121 s | 114 s | D3 em série domina (15–27 s por termo); D2 em paralelo |
- Fora das 3 descobertas: a 1ª rodada do Kingdom com `keyword_unordered` (US$ 0,1312, §2) e o experimento D2b, de confirmação por nome (12 sondas, US$ 0,0643, §3).
- **Limite da conta FREE da Apify: 5 runs simultâneos.** O D2 com 7–8 sondas em paralelo levou `402 concurrent-runs-limit-exceeded` em 2 (não cobrado). Agora roda 4 por vez, com nova tentativa. A conta própria (R7) precisa de mais concorrência, ou o D2 roda em fila.

## 2. O que confirma e o que derruba no §2
| item do §2 | veredito |
|---|---|
| Pipeline D1→D5 acha concorrente real sem o cliente digitar nada | **Confirma, com os ajustes abaixo.** Nos 3 Brains a lista tem concorrentes que o Gusta reconhece (a julgar) e o juiz barrou o lixo óbvio (apps de novela, saúde, caridade e, na 1ª rodada, o Hallow pra uma oferta de feitiço). |
| ≈ US$ 0,20 por descoberta | **Derruba pra baixo: US$ 0,10–0,14.** O D1 custa 1/4 do previsto. O D4 pode passar de US$ 0,01 quando entram muitas Páginas. |
| D2 confirma por **domínio** com `keyword_unordered` | **Derruba como regra única.** Só 4 de 22 candidatos confirmaram por domínio, mais 2 só pelo nome da Página (apps: o anúncio vai pra loja de apps). O texto da busca é quebrado em palavras: `leonardo.ai` vira "Leonardo" (dentistas, advogados), `keen.com` vira "keen" (jogo, remédio). Marcas grandes que o Claude conhece muitas vezes **não anunciam naquele país** (Higgsfield, Krea, Freepik e Synthesia no BR; Monarch e PocketGuard nos EUA). |
| ≥ 3 anúncios ativos pra passar | **Confirma.** Barrou "YYNAB loan companies" (golpe com nome parecido) e o Quicken com 1 anúncio. |
| D3 com `keyword_unordered` e `limit=40` | **Derruba.** Na 1ª rodada do Kingdom, as 21 Páginas que passaram eram de outro nicho (novelas, saúde, caridade): o actor casa qualquer palavra. A descoberta seguiu 1 concorrente só. Com **`keyword_exact_phrase`**, o mesmo Brain achou os 4 funis de feitiço do topo. |
| D3 "fica quem tem ≥ 2 anúncios na amostra" | **Ajustar.** No nicho do Kingdom, 7 dos 13 aprovados tinham 1 anúncio na amostra (anunciante pequeno, muitas Páginas). Sem eles, a reserva quase some. Ao mesmo tempo, as Páginas descartáveis (nome sem sentido) vêm justamente dessas. |
| Termos de 1–3 palavras no idioma do mercado | **Ajustar.** Em frase exata, 3 dos 9 termos voltaram 0 (`prayer for love`, `influencer digital IA`, `criar sem aparecer`). Termo de 3 palavras inventado pelo modelo raramente aparece igual no anúncio. |
| D4 juiz Haiku | **Confirma.** 116 Páginas julgadas, nenhuma sem veredito, nenhum "mesmo nicho" óbvio errado; o motivo em PT-BR serve direto pro card. Ponto fraco: dá score alto a Página descartável (nome sem sentido) porque só olha o texto. |
| D5 ordem score → anúncios vistos | **Ajustar.** O score pesa sozinho: Página com 1 anúncio e score 80 passa à frente da EveryDollar (14 anúncios, score 75) e da Varvos (11 anúncios, 2º lugar no ajustado). |
| País (§2.3) | **Confirma.** "Global" → US com motivo; sem market → BR pelo `.com.br`; sem nada → US. |
| Próprio cliente fora | Não testado de verdade: nenhum dos 3 anuncia com o domínio do Brain (o filtro roda, mas não pegou nada). |
| Reserva até 10 | Confirma no Pocketwise (10) e no Kingdom (8). **Falha no Geraew (2)** porque os termos voltaram vazios. |

## 3. Experimento D2b: confirmar pelo nome em vez do domínio (US$ 0,0643)
Rodei de novo os 12 candidatos que falharam por domínio, buscando `"<marca>"` em frase exata e casando com o nome da Página. Só **1 de 12 virou confirmado** (Monarch, pela Página "Monarch", 5 anúncios). Higgsfield, Krea, Freepik, Leonardo e Synthesia continuam sem Página própria no BR, assim como Keen e Astrology.com nos EUA. Conclusão: o problema principal não é o método de confirmar, é que **o Claude sugere marca famosa que não anuncia naquele país**. Quem acha os concorrentes reais é o D3. Nome da Página entra como 2ª regra no D2, de graça (já vem na mesma sonda).

## 4. Ajustes recomendados (pro contrato e pra porta)
1. **D3 em `keyword_exact_phrase`** (a URL leva `q="<termo>"&search_type=keyword_exact_phrase`). É o ajuste que mais muda o resultado. D2 continua em `keyword_unordered` (domínio entre aspas some).
2. **Termos: 2 palavras, mais genéricos, 4 em vez de 3**, e o D1 recebe a regra "frase que um anúncio do nicho diria literalmente". Termo que volta 0 custa só US$ 0,0008. Opcional: se um termo voltar 0, tentar 1 termo reserva (custo ≤ US$ 0,03).
3. **D2 com 2 regras na mesma sonda:** Página com mais anúncios que linkam o domínio; senão, Página cujo nome contém a marca (pega app que aponta pra loja). No D1, pedir **"marcas que você sabe que anunciam em <país>"** e no máximo 6 (as que não anunciam lá custam sonda à toa).
4. **D5 ajustado:** só pode ser **seguido** quem tem ≥ 2 anúncios na amostra. Página com 1 anúncio vai só pra reserva. Ordem: faixa de 10 pontos do score → anúncios vistos → mais antigo. Nos 3 Brains isso troca as Páginas descartáveis e de 1 anúncio por EveryDollar, Varvos, Jay Maker e Sub Manager.
5. **Sinal de Página descartável** pro juiz e pro D5: nome sem vogais coerentes, nome de pessoa aleatório, letras de outro alfabeto no meio, 0 ativos na amostra. Mandar ao juiz o nº de anúncios vistos e o mais antigo, com a regra "Página descartável ou de golpe não é concorrente a estudar".
6. **Estimativa e trava:** baixar a estimativa da tela pra **US$ 0,15** (pior caso medido 0,135); manter a trava de US$ 0,30. O D4 tem que caber: limitar a 40 Páginas por julgamento (as de 1 anúncio entram por último).
7. **Concorrência da Apify:** fila de no máximo 4 runs por descoberta e tratar `402 concurrent-runs-limit-exceeded` como "tente de novo", não como falha (nada é cobrado).
8. **Card do concorrente:** "N anúncios ativos" precisa vir da importação (a sonda só vê até 10/40). Até a importação terminar, mostrar "≥ N".

## 5. Pendente
- O Gusta marcar acertou/errou nas 3 tabelas. Com isso dá pra medir a precisão do juiz (e se o D5 ajustado acerta mais que o do contrato).
- Rodar de novo com os ajustes 1–5 aplicados (≈ US$ 0,40 pros 3 Brains) só depois do julgamento dele, pra comparar.
- R7 (conta própria da Apify) continua bloqueando o live. A conta Trendcat está em US$ 1,17 de US$ 5 no ciclo (até 28/11).

## 6. Rodada 2, com os ajustes (04/11, noite)
Liberada pelo Gusta com teto de US$ 0,50 (antes de ele julgar a rodada 1). Script `run2.mjs` (mesma pasta), resultados em `out/r2-*/`. Ajustes aplicados:
- termos em frase exata, **4 termos de 2 palavras** ("frase que um anúncio do nicho diz literalmente");
- D1 sugere até 6 marcas "que você sabe que anunciam nesse país";
- confirmação com 2 regras na mesma sonda (domínio, senão nome da Página);
- **só segue quem tem ≥ 2 anúncios na amostra** (1 anúncio vai só pra reserva);
- juiz recebe anúncios vistos, o mais antigo e um sinal de Página descartável (nome sem sentido, alfabetos misturados, 0 ativos), limitado às 40 Páginas mais fortes;
- ordem "D5 ajustado": faixa de 10 do score → anúncios vistos → mais antigo.

**Custo: US$ 0,4943** (Kingdom 0,1557 · Pocketwise 0,1510 · Geraew 0,1876). A 4ª busca por termo encarece (todo termo de 2 palavras trouxe 40 anúncios, contra 0 a 1 de vários termos de 3 palavras na rodada 1). **A Geraew bateu no teto antes do juiz**: as sondas da Apify já tinham rodado, então retomei a partir dos mesmos runs (baixar o dataset de novo é grátis) e julguei 25 Páginas em vez de 40 pra caber. Por isso o tempo dela não foi medido. Kingdom: 153 s · Pocketwise: 163 s.

### 6.1 Lado a lado (negrito = seguidos; R = reserva)
| Brain | rodada 1 | rodada 2 |
|---|---|---|
| **Kingdom of Love** | **Zara Valon · Lara Devine · Amara · Amanda Reyes · Isabella Garcia** · R: Leila Garcia, Oranum, Kasamba + 5 "spell casters" (13 no total) | **Sacred Prayer · Light of the Heavens** · sem reserva (2 no total) |
| **Pocketwise** | **Rocket Money · Copilot Money · Hiatus · Shistesprurttunt Brogliplapu · The Sheetflow** · R: EveryDollar, Muse, Sub Manager e mais 7 (15) | **Rocket Money · Rowan by Rocket Money · MoneypilotApp · OnePay · EveryDollar** · R: Copilot Money, junead.kh (Treasury), Albert, Wealth Architect + 6 de 1 anúncio (15) |
| **Geraew** | **HeyGen · Runway · Arcads AI · Dreamina · Varvos** · R: Kairogen.ai, Jay Maker AI (7) | **HeyGen · Varvos · Runway · Jay Maker AI · Lore Osorio** · R: Gabriel Souza, Dreamina, Método IA na Prática (8) |
| custo por descoberta | 0,133 · 0,135 · 0,098 | 0,156 · 0,151 · 0,188 |

### 6.2 O que melhorou e o que piorou
| | leitura |
|---|---|
| **Pocketwise: melhorou** | As Páginas descartáveis saíram dos 5 ("Shistesprurttunt Brogliplapu", The Sheetflow, Axtell, Subсаddу sumiram ou caíram pra reserva) e entraram anunciantes com escala: OnePay (37 anúncios vistos), Rocket Money (28), Rowan, que é um 2º produto da Rocket Money, e MoneyPilot. A confirmação pelo nome pegou o Albert. Perdeu o Hiatus (301 dias no ar), porque nenhum dos 4 termos novos o trouxe. |
| **Geraew: melhorou** | Os 4 termos trouxeram anúncios (na rodada 1, 2 de 3 voltaram 0). Apareceu o **nicho exato no Brasil**: quem vende "influencer digital com IA" (Lore Osorio, Gabriel Souza, Método IA na Prática), embora seja curso/método e não plataforma. A Varvos subiu pro 2º lugar. Perdeu a Arcads, porque o Claude não a sugeriu desta vez (o D1 varia de uma rodada pra outra). |
| **Kingdom: piorou muito** | 2 seguidos e nenhum na reserva. O "2 palavras" gerou termos genéricos: `get back` trouxe 37 Páginas (financeira, remédio de cachorro, Credit Karma) e `true love` trouxe apps de namoro. O termo que achava os funis de feitiço da rodada 1 (`love spell`) não foi gerado. Os 2 que ficaram (Sacred Prayer, Light of the Heavens) vendem **corrente de oração, o mesmo formato da oferta**, e começaram há 7–8 dias. O Gusta confirmou (04/11) que **não são clones e são concorrentes válidos**. No D2, a Kasamba voltou **0 itens** (na rodada 1 trouxe 10 na mesma busca): o actor oscila. |
| Ordem só com ≥ 2 anúncios | Funcionou: nenhum seguido com 1 anúncio nos 3 Brains. |
| Sinal de Página descartável | Não foi posto à prova: as Páginas descartáveis da rodada 1 não voltaram nas buscas novas, e nenhuma Página escolhida foi marcada. Fica sem evidência. |
| Confirmação por nome | Pegou 3 de 18 (Rocket Money, Copilot, Albert, todos apps). Por domínio: 2 (Oranum, HeyGen). As marcas famosas que não anunciam no país continuam vindo (Higgsfield, Krea e Freepik de novo no BR). |

### 6.3 Leitura e próximo ajuste
- **O que define a qualidade é o termo de busca.** "2 palavras" foi bom pra app e pra Brasil, e ruim pra nicho cujo vocabulário de anúncio é específico (feitiço). Recomendação: o D1 gera 6 termos de 2–3 palavras (2 da promessa, 2 do tipo de produto, 2 da dor), a descoberta busca os 4 primeiros e **descarta o termo difuso**: muitas Páginas com 1 anúncio cada (ex.: `get back`, 37 Páginas e só 3 com ≥ 2). Nesse caso troca pelo 5º/6º termo. Custo extra ≤ US$ 0,03 por troca.
- **Custo:** estimativa da tela de US$ 0,20 (pior caso medido 0,188), trava de US$ 0,30. Limitar o juiz a 25–30 Páginas segura o D4 em ~US$ 0,02 sem perder os fortes (eles entram primeiro).
- **D1 não é estável** (Arcads entrou numa rodada e não na outra; Kasamba sumiu no actor). Os concorrentes seguidos têm que ficar entre descobertas (o §2.1 já diz que descoberta nova não remove ninguém).

### 6.4 Rodada 2: marque "acertou/errou"
"Ativos vistos" e "mais antigo visto" valem como na rodada 1 (só a amostra das sondas).

**Kingdom of Love** · US · termos `love prayer` · `get back` · `sacred prayer` · `true love` · Claude propôs 6, confirmou 1 (Oranum, que o juiz reprovou com score 45); 85 Páginas achadas, 40 julgadas, 2 aprovadas
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | na rodada 1? | acertou? |
|---|---|---|---|---|---|---|---|---|
| **1** | [Sacred Prayer](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1275040072361167) | 18 | 8 d | termo | 72 | Corrente de oração sagrada pra pessoa de fé; 18 anúncios em 8 dias | nova | **acertou** (Gusta, 04/11: não é clone, concorrente válido) |
| **2** | [Light of the Heavens](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1143910505472618) | 9 | 7 d | termo | 68 | Oração sagrada e bênçãos ("desejos silenciosos"); 9 anúncios em 7 dias | nova | **acertou** (Gusta, 04/11) |

**Pocketwise** · US · termos `forgotten subscriptions` · `spending tracker` · `savings goals` · `budgeting app` · Claude propôs 6, confirmou 3 (Rocket Money, Copilot, Albert); 43 Páginas achadas, 40 julgadas
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | na rodada 1? | acertou? |
|---|---|---|---|---|---|---|---|---|
| **1** | [Rocket Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=633318986770616) | 28 | 37 d | Claude + termo | 85 | Rastreia gastos e acha economia, a mesma promessa | sim | |
| **2** | [Rowan by Rocket Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1308292892363653) | 4 | 1 d | termo | 80 | Gastos e cancelamento de assinaturas esquecidas | nova | |
| **3** | [MoneypilotApp](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1404959272699607) | 3 | 22 d | termo | 80 | Acha assinaturas esquecidas e pede reembolso | nova | |
| **4** | [OnePay](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=112615890193140) | 37 | 50 d | termo | 75 | App de finanças/poupança, muita verba | nova | |
| **5** | [EveryDollar](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1536851196550018) | 5 | 75 d | termo | 70 | Orçamento e gastos, 416 mil curtidas | sim | |
| R6 | [Copilot Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=113463060054159) | 4 | 16 d | Claude + termo | 75 | Gastos e finanças pessoais | sim | |
| R7 | [junead.kh](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=750719594794401) | 2 | 9 d | termo | 75 | Anuncia o Treasury (orçamento automático) | nova | |
| R8 | [Albert](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=545979195556302) | 6 | 183 d | Claude | 60 | App de finanças pessoais | nova | |
| R9 | [Wealth Architect](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1257850024068275) | 2 | 14 d | termo | 65 | Orçamento e metas | nova | |
| R10 | [Debbie](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=101652881632021) | 1 | 56 d | termo, 1 anúncio | 70 | Gastos com recompensa por bom hábito | nova | |
| R11 | [The Sheetflow](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1177742422082457) | 1 | 10 d | termo, 1 anúncio | 70 | Orçamento e assinaturas | sim | |
| R12 | [treasury.sh](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=824530090733128) | 1 | 9 d | termo, 1 anúncio | 75 | Treasury (mesmo produto da junead.kh) | nova | |
| R13 | [Text Pally](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1297153556820423) | 1 | 7 d | termo, 1 anúncio | 75 | Cancela assinaturas por SMS | nova | |
| R14 | [Sub Manager Gotyourback](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=126486283889262) | 1 | 0 d | termo, 1 anúncio | 70 | Acha e cancela cobranças recorrentes | sim | |
| R15 | [Planned - Your Personal Financial Coach](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1143221912213362) | 1 | 34 d | termo, 1 anúncio | 65 | Coach financeiro e gastos | nova | |

**Geraew** · BR · termos `influencer digital` · `vídeos com IA` · `sem aparecer` · `criar vídeos` · Claude propôs 6, confirmou 1 (HeyGen); 52 Páginas achadas, 25 julgadas (teto)
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | na rodada 1? | acertou? |
|---|---|---|---|---|---|---|---|---|
| **1** | [HeyGen](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=103228746153839) | 10 | 106 d | Claude | 90 | Vídeo com IA sem câmera nem estúdio | sim | |
| **2** | [Varvos](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1001203829746458) | 11 | 180 d | termo | 85 | Vídeo com IA em segundos pra rede social, mesmo público | sim | |
| **3** | [Runway](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1369755289823565) | 4 | 14 d | Claude + termo | 80 | Gerador de vídeo com IA | sim | |
| **4** | [Jay Maker AI](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=578814011989326) | 2 | 22 d | termo | 80 | Cria e publica vídeo com IA "sem aparecer" | sim | |
| **5** | [Lore Osorio](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1323068490891096) | 3 | 10 d | termo | 70 | Ensina criar influencer digital 3D com IA (criadora, não plataforma) | nova | |
| R6 | [Gabriel Souza](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1098066073395080) | 3 | 6 d | termo | 75 | Método pra criar influencer de IA sem aparecer (curso) | nova | |
| R7 | [Dreamina](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=531699063370865) | 2 | 6 d | termo, 1 anúncio por termo | 75 | Vídeo 4K com IA (CapCut/Seedance) | sim | |
| R8 | [Método IA na Prática](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1437683736091843) | 1 | 6 d | termo, 1 anúncio | 60 | Curso de influencer digital pra vender | nova | |

## 7. Rodada 3: termos tipados e troca de termo fraco (04/11, noite)
Liberada pelo Gusta com teto de US$ 0,50. Script `run3.mjs`, resultados em `out/r3-*/`. Fica tudo da rodada 2 (confirmação domínio → nome, seguir só com ≥ 2 anúncios, sinal de Página descartável, D5 ajustado). O que mudou:
- o Claude gera **6 termos de 2–3 palavras, tipados** (2 de promessa, 2 de tipo de produto, 2 de dor), com o jargão que os anúncios do nicho usam;
- a descoberta busca 4 (promessa 1, produto 1, dor 1, produto 2), **em paralelo**;
- termo fraco é trocado por um dos 2 reservas, no máximo 2 trocas. Fraco = **vazio** (0–1 Página) ou **difuso** (≥ 8 Páginas e ≥ 80 % delas com 1 anúncio). As Páginas de 1 anúncio de um termo difuso não entram;
- juiz limitado a **25 Páginas**;
- teto por Brain;
- **busca por termo com 30 anúncios em vez de 40**, pra caber troca dentro dos US$ 0,50.

**Custo: US$ 0,3655** (Kingdom 0,0674 · Pocketwise 0,1345 · Geraew 0,1636; média 0,122). Tempo de 46 s a 87 s (era 114–163 s), graças às buscas em paralelo. A conta da Apify bate com a soma dos runs.

**Duas falhas da rodada no Kingdom, pra registro:**
1. O Claude devolveu **0 marcas** pro Kingdom: com "só marcas que você sabe que anunciam nesse país" ele preferiu não chutar. Nenhuma sonda de marca rodou (D2 = US$ 0). É o comportamento honesto, e quem acha os concorrentes desse nicho é a busca por termo de qualquer jeito.
2. A regra de "vazio" contava 0 Página e deixou passar um termo com 1 Página só (`prayers of love`). Corrigi pra 0–1 Página antes do Pocketwise e da Geraew. Por isso o Kingdom ficou com 2 termos úteis em vez de 4, e o 2º reserva (`afraid of losing`) não foi usado.

### 7.1 Termos gerados e trocados
| Brain | promessa | produto | dor | buscados → resultado (Páginas, com ≥ 2, % com 1 anúncio) | trocas |
|---|---|---|---|---|---|
| Kingdom | get your ex back · love will return | prayer chain · prayers of love | love has gone cold · afraid of losing | `get your ex back` 17/7/59 % · `prayer chain` 17/7/59 % · `love has gone cold` vazio · `prayers of love` 1 Página (devia ter sido trocado) | `love has gone cold` → `love will return` (também 1 Página) |
| Pocketwise | stop overspending · start saving money | budgeting app · track your spending | forgotten subscriptions · where your money goes | `stop overspending` 14/4/71 % · `budgeting app` 17/7/59 % · `forgotten subscriptions` 7/3/57 % · `track your spending` 10/4/60 % | nenhuma (nenhum termo fraco) |
| Geraew | influenciador digital · sem aparecer | vídeos com IA · influencer virtual | conteúdo sem aparecer · vídeos UGC | `influenciador digital` 18/3/**83 % (difuso)** · `vídeos com IA` 12/5/58 % · `conteúdo sem aparecer` 9/4/56 % · `influencer virtual` 2/2/0 % | `influenciador digital` → `sem aparecer` (7/2/71 %) |

### 7.2 Lado a lado com as rodadas 1 e 2 (negrito = seguidos; R = reserva)
| Brain | rodada 1 | rodada 2 | rodada 3 |
|---|---|---|---|
| **Kingdom** | **Zara Valon · Lara Devine · Amara · Amanda Reyes · Isabella Garcia** · R: 8 (videntes e "spell casters") | **Sacred Prayer · Light of the Heavens** (válidos, Gusta) · R: 0 | **Santiago Herrera · Zara Valon · Psychic Rituals · Me and My EX · Lovon** · R: Peak Masculine, Eric Zillmann, womanifestationcoach |
| **Pocketwise** | **Rocket Money · Copilot · Hiatus · Shistesprurttunt Brogliplapu · The Sheetflow** · R: 10 | **Rocket Money · Rowan · MoneypilotApp · OnePay · EveryDollar** · R: 10 | **Rocket Money · Intuit Credit Karma · EveryDollar · Abby Lawson · Copilot Money** · R: junead.kh (Treasury), Rowan, Wealth Architect |
| **Geraew** | **HeyGen · Runway · Arcads · Dreamina · Varvos** · R: 2 | **HeyGen · Varvos · Runway · Jay Maker AI · Lore Osorio** · R: 3 | **Professor Anderson Silva · HeyGen · Varvos · Arcads AI · Jay Maker AI** · R: IA Academy, Runway, Dreamina, Kairogen.ai |
| custo (K · P · G) | 0,133 · 0,135 · 0,098 | 0,156 · 0,151 · 0,188 | 0,067 · 0,135 · 0,164 |

### 7.3 O que melhorou e o que piorou
| | leitura |
|---|---|
| **Geraew: a melhor das 3 rodadas** | Juntou os bons das anteriores (HeyGen, Varvos, Arcads, Jay Maker; Runway e Dreamina na reserva) e achou o **Professor Anderson Silva** (28 anúncios vistos, vende "influenciadores virtuais em minutos"), o mais parecido com a oferta até agora. A troca do termo difuso funcionou: `influenciador digital` (83 % de Páginas com 1 anúncio) saiu. |
| **Kingdom: voltou a ter 5 + reserva** | O termo de promessa `get your ex back` trouxe funis de reconquista (Santiago Herrera, Me and My EX, Lovon, Peak Masculine), e `prayer chain` trouxe Zara Valon e Psychic Rituals. **Perdeu** Sacred Prayer e Light of the Heavens (válidos pro Gusta) e Lara Devine, Amara e Amanda Reyes: cada rodada vê um pedaço diferente do nicho. Parte dos novos é reconquista "psicológica", não espiritual (o próprio juiz diz isso no motivo). |
| **Pocketwise: estável, com 2 vizinhos** | Rocket Money, EveryDollar e Copilot aparecem pela 3ª vez. Entraram Credit Karma (finanças, mas o produto central é score de crédito) e Abby Lawson (blogueira que vende planilha de orçamento): vizinhos, não app igual. Saíram OnePay e MoneyPilot. Reserva curta (3) por causa do limite de 25 no juiz. |
| Juiz com 25 Páginas | Mais barato (US$ 0,014–0,015) e sem perder os fortes. Encurtou a reserva no Pocketwise. |
| Sinal de Página descartável | Marcou só a womanifestationcoach (0 ativos vistos), que ficou em último na reserva. Nenhum seguido com cara de descartável nas 3 Brains. |

### 7.4 Rodada 3: marque "acertou/errou"
"Rodadas anteriores" diz em qual rodada a Página já tinha aparecido.

**Kingdom of Love** · US · 0 marcas do Claude · 36 Páginas achadas, 25 julgadas
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | rodadas anteriores | acertou? |
|---|---|---|---|---|---|---|---|---|
| **1** | [Santiago Herrera](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1331501043370061) | 4 | 22 d | termo | 80 | Método em vídeo pra recuperar o ex (psicológico, não espiritual) | nova | |
| **2** | [Zara Valon](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=641548699046935) | 2 | 126 d | termo | 85 | Leitura psíquica e reconquista do ex | R1 | |
| **3** | [Psychic Rituals](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=926006400589201) | 2 | 13 d | termo | 85 | Rituais e magia de amor pra reconquista | nova | |
| **4** | [Me and My EX](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=139398295931743) | 2 | 8 d | termo | 80 | Leitura grátis sobre o ex e a chance de voltar | nova | |
| **5** | [Lovon](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=471806239351671) | 6 | 22 d | termo | 75 | Conselho de relacionamento pra reconquistar (prático, não espiritual) | nova | |
| R6 | [Peak Masculine](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1372953459237516) | 2 | 16 d | termo | 75 | Método pra recuperar a ex, pra homens | nova | |
| R7 | [Eric Zillmann](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1244416042095664) | 2 | 1 d | termo | 70 | Método pra reacender o desejo no casamento | nova | |
| R8 | [womanifestationcoach](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=107771614942341) | 0 | 494 d | termo | 60 | Coach de manifestação pra atrair uma pessoa (marcada como possível descartável) | nova | |

**Pocketwise** · US · Claude propôs 6, confirmou 2 (Rocket Money e Copilot, pelo nome) · 47 Páginas achadas, 25 julgadas
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | rodadas anteriores | acertou? |
|---|---|---|---|---|---|---|---|---|
| **1** | [Rocket Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=633318986770616) | 25 | 37 d | Claude + termo | 92 | Gastos, economia e cancelar assinaturas esquecidas | R1 R2 | |
| **2** | [Intuit Credit Karma](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=215196865464) | 12 | 75 d | termo | 85 | Acompanhamento de gastos e dicas (o produto central é score de crédito) | nova | |
| **3** | [EveryDollar](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1536851196550018) | 5 | 75 d | termo | 88 | App de orçamento da Ramsey | R1 R2 | |
| **4** | [Abby Lawson - Organizing, Decorating, Blogging](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=134784953366415) | 8 | 453 d | termo | 70 | Vende um "Dashboard de Finanças" (planilha), blogueira | nova | |
| **5** | [Copilot Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=113463060054159) | 4 | 16 d | Claude + termo | 75 | App de finanças pessoais | R1 R2 | |
| R6 | [junead.kh](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=750719594794401) | 2 | 9 d | termo | 72 | Anuncia o Treasury (orçamento automático) | R2 | |
| R7 | [Rowan by Rocket Money](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1308292892363653) | 4 | 1 d | termo | 65 | Gastos e assinaturas (da Rocket Money) | R2 | |
| R8 | [Wealth Architect](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=1257850024068275) | 2 | 14 d | termo | 55 | Orçamento e planejamento | R2 | |

**Geraew** · BR · Claude propôs 6, confirmou 2 (HeyGen e Arcads, pelo domínio) · 35 Páginas achadas, 25 julgadas
| # | Página (link da Ad Library) | ativos vistos | mais antigo visto | de onde veio | score | por que é concorrente (juiz) | rodadas anteriores | acertou? |
|---|---|---|---|---|---|---|---|---|
| **1** | [Professor Anderson Silva](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=710515328821897) | 28 | 64 d | termo | 85 | Vende "influenciadores virtuais em minutos" pra criador e afiliado | nova | |
| **2** | [HeyGen](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=103228746153839) | 10 | 106 d | Claude | 88 | Vídeo com IA pra criador | R1 R2 | |
| **3** | [Varvos](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1001203829746458) | 6 | 180 d | termo | 82 | Vídeo com IA em segundos | R1 R2 | |
| **4** | [Arcads AI](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=332742426590967) | 5 | 145 d | Claude | 80 | UGC e anúncios com IA | R1 | |
| **5** | [Jay Maker AI](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=578814011989326) | 2 | 22 d | termo | 78 | Vídeo com IA "sem aparecer" | R1 R2 | |
| R6 | [IA Academy](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1457535280768704) | 2 | 5 d | termo | 72 | Curso de influencer virtual com IA | nova | |
| R7 | [Runway](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1369755289823565) | 1 | 14 d | termo, 1 anúncio | 85 | Gerador de vídeo com IA | R1 R2 | |
| R8 | [Dreamina](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=531699063370865) | 1 | 6 d | termo, 1 anúncio | 80 | Vídeo 4K com IA (CapCut) | R1 R2 | |
| R9 | [Kairogen.ai](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=BR&view_all_page_id=1167116993147066) | 1 | 26 d | termo, 1 anúncio | 75 | Vídeo com áudio nativo | R1 | |

## 8. Recomendação final: o que vira regra no código
Tudo abaixo vale pra `proposeCompetitors`/`judgeCompetitors` (maquina-ia) e pro `discovery.service.ts` (maquina-backend). Substitui o §2.2 do contrato.
| etapa | regra |
|---|---|
| **D1 propor** | `claude-sonnet-5-5`, effort `medium`, saída `json_schema` estrita. Devolve: `countryCode` + motivo; **até 6 marcas "que você sabe que anunciam nesse país"** (0 é resposta válida); **6 termos de 2–3 palavras tipados** (`promise`, `product`, `pain`, 2 de cada) com o jargão dos anúncios do nicho. Prompt agnóstico (o nicho vem só do Brain). |
| **D2 confirmar marca** | Busca do domínio em `keyword_unordered`, país, `limitPerSource=10`. A Página é a que tem mais anúncios linkando o domínio; **senão, a Página cujo nome contém a marca** (app linka a loja). Passa com ≥ 3 ativos na amostra. No máximo 4 runs simultâneos. |
| **D3 varrer termos** | **`keyword_exact_phrase`** (`q="<termo>"`), país, **`limitPerSource=30`**, 4 termos em paralelo (promessa 1, produto 1, dor 1, produto 2). Termo **vazio** (0–1 Página) ou **difuso** (≥ 8 Páginas e ≥ 80 % com 1 anúncio) é trocado por um reserva, até 2 trocas. As Páginas de 1 anúncio de um termo difuso não entram. |
| **D4 julgar** | `claude-haiku-4-5`, 1 chamada, **até 25 Páginas** (≥ 2 anúncios primeiro, depois por anúncios vistos). Cada Página leva `adsSeen`, `oldestDays` e `suspectDisposable` (nome sem sentido, alfabetos misturados, 0 ativos). Página descartável ou golpe não é concorrente. O motivo sai em PT-BR (vai pro card). |
| **D5 escolher** | Aprovado = `sameNiche` e `score ≥ 50`. **Só segue quem tem ≥ 2 anúncios na amostra**; Página com 1 anúncio vai só pra reserva. Ordem: faixa de 10 do score → anúncios vistos → anúncio mais antigo. 5 seguidos e até 10 de reserva. |
| **Memória entre descobertas** (novo) | **Cada rodada viu um pedaço diferente do nicho** (o Kingdom teve 3 listas quase sem interseção, todas com concorrentes válidos). Então: (a) seguido nunca sai por descoberta nova (já está no §2.1); (b) **aprovados de descobertas anteriores voltam como reserva** sem custo, se ainda tiverem anúncio ativo; (c) gravar por workspace os **termos que renderam aprovados** e reaproveitar 2 deles no "Procurar de novo", com 2 termos novos. Pede `CompetitorCandidate` guardado além da última descoberta (hoje o §4 guarda só a última). |
| **Custo e tetos** | Estimativa na tela **US$ 0,15** (medido US$ 0,067–0,188; média US$ 0,12 nas rodadas 1 e 3), trava `ADS_RESEARCH_DISCOVERY_MAX_USD` = **US$ 0,30**. Cada run com `maxTotalChargeUsd`. `402 concurrent-runs-limit-exceeded` = tentar de novo (não é cobrado). Termo/domínio sem resultado custa US$ 0,0008 (item `ADS_NOT_FOUND`): descartar o item e gravar o custo. Custo real = `usageTotalUsd` relido ~15 s depois do fim. |
| **Card** | "N anúncios ativos" vem da importação, não da sonda (a sonda vê até 10/30); até lá, "≥ N". |
- **Ainda em aberto:** o `MIN_SCORE` de 50 e o peso entre "mesmo produto" e "nicho vizinho" (Credit Karma, Abby Lawson, HeyGen B2B, reconquista psicológica no Kingdom) dependem das marcações do Gusta nas tabelas. Com elas calibramos o prompt do juiz antes do código.
