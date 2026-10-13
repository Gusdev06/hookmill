# Catálogo de variações de criativo (estudo pro HookMill)
Data: 2026-10-12 · Status: **estudo pra discussão**, nada decidido.
Base: os 6 eixos que a operação já usa (`wiki/trafego-criativos/wiki/tecnicas/eixos-de-variacao-de-criativo.md`), a regra de mudar uma coisa por vez (`variar-uma-alavanca-por-vez.md`) e prática de mercado de criativo de performance. **Não há número de performance aqui**: o que cada variação rende tem que ser medido.

## Como ler
- **Custo:** 🟢 só edição (Remotion/ffmpeg, reaproveita os clipes, ~US$ 0) · 🟡 IA barata (texto, voz, lipsync curto) · 🔴 IA cara (imagem + vídeo gerado).
- **Métrica que a variação mexe:** **Parada** (thumbstop / hook rate, os 3 primeiros segundos) · **Retenção** (hold rate, quantos assistem até o fim) · **Clique** (CTR) · **Conversão** (CVR, coerência com a LP e a oferta).
- **HookMill hoje:** ✅ já faz · 🔒 existe no código, mas bloqueado · ⏳ não existe.

## A. Só edição (🟢, o mais barato e o que mais multiplica)
| # | Variação | O que muda | Mexe em | HookMill |
|---|---|---|---|---|
| 1 | **Cortes de duração** | 6s / 15s / 20s / 30s cortando o meio e mantendo gancho e CTA | Retenção | ⏳ (o editor apara cena, mas não gera os cortes em lote) |
| 2 | **Formato de tela** | 9:16 → 4:5 → 1:1 → 16:9, com a legenda reposicionada | entrega por posicionamento | ⏳ |
| 3 | **Cold open** | pega o melhor momento do meio (a prova, a reação) e joga no segundo 0 | Parada | ⏳ |
| 4 | **Abertura nova, mesma fala** | troca só a imagem dos 3 primeiros segundos: zoom, b-roll, frame congelado, contraste lado a lado | Parada | ⏳ |
| 5 | **Texto de gancho na tela** | troca a headline sobreposta, a fala continua igual | Parada | ✅ (editor e gancho do lote) |
| 6 | **Call-out de público** | "Mães de adolescente…", "Se você tem mais de 40…" em texto | Parada + Conversão | ⏳ (dá pra fazer à mão no editor) |
| 7 | **Ordem dos blocos** | prova antes do problema, oferta antes do mecanismo | Retenção | ⏳ (o editor reordena cena; o lote não) |
| 8 | **Ritmo** | tirar respiro e pausa, jump cut, acelerar 1,1× | Retenção | ⏳ |
| 9 | **Estilo de legenda** | karaokê, caixa, cor, posição, tamanho | Retenção | ✅ (template no editor) |
| 10 | **Trilha e som** | música em alta, sem música, efeitos sonoros, ASMR | Parada + Retenção | ⏳ |
| 11 | **Layout** | split screen, picture-in-picture, fundo com a LP ou um print, reação | Retenção | 🔒 (`KIND_NOT_ENABLED`) |
| 12 | **Prova inserida** | print de review, contador, antes/depois, tela do produto | Conversão | ⏳ |
| 13 | **End card e oferta em texto** | preço, garantia, bônus, urgência no final | Clique | ✅ parcial (end card) |
| 14 | **Pele nativa** | moldura de story, notificação, chat de WhatsApp/iMessage, tela de app | Parada | ⏳ |
| 15 | **Versão sem som** | o texto carrega tudo, pra quem vê no mudo | Parada | ⏳ |
| 16 | **Estático a partir do vídeo** | o melhor frame vira imagem com headline; vira também carrossel | novo formato de anúncio | ⏳ |

## B. IA barata (🟡)
| # | Variação | O que muda | Mexe em | HookMill |
|---|---|---|---|---|
| 17 | **Gancho falado novo** | fala nova nos 3 primeiros segundos com a mesma voz (TTS/clone + lipsync só no trecho) | Parada | ✅ |
| 18 | **CTA falado novo** | troca a chamada final: garantia × bundle × urgência | Clique | ⏳ |
| 19 | **Copy do anúncio** | texto principal e título no Meta (não é o vídeo) | Clique | 🔒 (copy "em breve") |
| 20 | **Idioma / dublagem** | mesmo vídeo em EN/ES/PT com lipsync | expansão de mercado | ⏳ |
| 21 | **Voz diferente** | gênero, idade, sotaque; precisa de consentimento quando é voz real | Parada | ⏳ (no mockup é travada até ter consentimento) |
| 22 | **Roteiro em outro ângulo** | mesmo formato, outra razão de compra (dor, desejo, medo, status, curiosidade) | Parada + Conversão | ✅ parcial (wizard: 3 roteiros) |
| 23 | **Nível de consciência** | o mesmo produto falado pra quem nem sabe que tem o problema × pra quem já compara solução | Conversão | ⏳ |
| 24 | **Objeção** | cada versão derruba uma objeção (preço, "funciona pra mim?", tempo) | Conversão | ⏳ |

## C. IA cara (🔴)
| # | Variação | O que muda | Mexe em | HookMill |
|---|---|---|---|---|
| 25 | **Rosto / avatar** | só a pessoa | escala do vencedor | ✅ |
| 26 | **Roupa, idade, etnia** | uma variável por vez (matriz) | escala | ⏳ (a pessoa entra via prompt de rosto) |
| 27 | **Cenário** | quarto → carro → cozinha → academia, mantendo a luz de celular | Parada | ⏳ |
| 28 | **B-roll gerado** | cenas do problema e do resultado (Kling/Seedance) | Retenção | ⏳ |
| 29 | **Formato transplantado** | o mesmo roteiro em outro formato: podcast/2 pessoas, entrevista de rua, reação, unboxing, POV, tutorial/demo, comparação, faceless b-roll + voz, VSL cantada | tudo; é teste de conceito | ⏳ |

## D. O "o que variar" (estratégia, vale pras três camadas)
Ângulo · nível de consciência · público (call-out) · objeção · mecanismo · tipo de prova · oferta. Escolhida a alavanca, as camadas A/B/C são o "como".

**Regras que já valem na operação:**
1. **Mudar uma coisa por vez.** Se duas mudam juntas, não dá pra saber o que ganhou.
2. **Ordem:** gancho (parada) → retenção (corte, ritmo, legenda, ordem) → escala (rosto, cenário, idioma). Hipótese barata primeiro.
3. **Multiplicação:** 1 gravação × 4 durações × 3 formatos × 5 ganchos de texto = 60 peças sem gerar nada novo.

## Recomendação pro HookMill (ordem de construção)
1. **"Pacote grátis" (🟢, Remotion na API):** cortes de duração (1), formatos (2), cold open (3), abertura nova (4), estilo de legenda (9) e trilha (10), todos como tipos de variação no "Iteration plan". Custo de geração zero, entrega imediata e muitas peças por campeão. Encaixa no lote que já existe.
2. **Liberar layout (11)**, que já está no código, e **CTA falado (18)**, que é o mesmo pipeline do gancho falado.
3. **Estático a partir do vídeo (16)**: um formato novo de anúncio quase de graça.
4. **Ângulo / consciência / objeção (22–24)**: o "New concepts" do mockup (mapa de ângulos). Depende do Brain mais rico.
5. **Cenário e formato transplantado (27, 29)**: caros, só pra campeão que já provou.
