# Troca de texto queimado (legenda e texto fixo em caixa) — contrato v1
Data: 2026-11-05 · Dono: maquina-arquiteto · Status: **F0 FECHADO em documento (§15, 05/11).** Nada de código até o ok do Gusta.
> **Leia a §16 e a §15 primeiro: elas valem sobre todo o resto, e a §16 vale sobre a §15 onde marcada.** As §0 a §14 ficam como histórico; o que foi substituído está marcado com **[SUBST. §15.x]** ou riscado. Mapa em §15.2.
Origem: o Gusta viu os testes em 05/11 e aprovou ("ficou incrível"). `decisions/log.md`, 05/11.
Vale **por cima** de `legenda-protegida-v1.md` (acrescenta um passo entre desviar e bloquear) e de `headline-e-legenda-v1.md` §1.3 (faixa sólida). Não mexe em `editor-universal-v1.md`: só encaixa depois do F-U2 dele (§8).
Evidência: `research_notes/limpar-legenda-teste-2026-11-04/` (vídeos, `scripts/` copiados do scratchpad em 05/11, com o caminho de fontes do `leg.py` agora relativo, `scripts/medidas/`, `originais/`, estes dois sem MP4 no git), `research_notes/limpar-texto-teste-2026-11-04/README.md`, `references/limpar-texto-video.md`, `leitura-lambda-v1.md`, `templates-creditos-v1.md`.

---

## 0. Resumo **[histórico; resumo vigente em §15.0]**
1. **O que foi aprovado é menos do que foi registrado.** A versão N não apaga nada: é o mesmo texto redesenhado por cima do original, com contorno 2 px mais grosso (§1). Trocar o texto de verdade (outro idioma, outro gancho) exige apagar, e isso **ainda não foi visto pelo Gusta**. A sonda S2 (§10) responde isso antes de qualquer código.
2. **Conceito central: a "placa".** Um vídeo do campeão sem o texto antigo, gerado **uma vez por campeão** e guardado. O texto novo é uma camada Remotion (`remix-keep`, já existe) por cima da placa. Assim, 12 peças e 10 edições no editor não refazem o trabalho de pixel, e o editor continua fiel ao render.
3. **Lugar no produto:** dois caminhos. (a) **Automático:** formato hoje bloqueado por `burned_captions` passa a sair, com a legenda refeita no estilo original. (b) **Escolhido:** template novo "Legenda nova" (mesmo texto ou tradução). A `HEADLINE` em caixa passa a repintar a caixa em vez da placa lisa.
4. **Velocidade: o tempo de 13 min a 1 h não era do método.** Isolado, a parte de pixel leva **6 s (N) a 36 s (com apagar)** por vídeo de 21-30 s no Mac. O gargalo real é o **ajuste de fonte, ~300 s de CPU**, que precisa ser trocado (§3.2).
5. **Onde roda:** Lambda nova `hookmill-legenda` (Python + OpenCV, arm64, 3008 MB), chamada pela API, com divisão em pedaços acima de 45 s. Custo estimado **US$ 0,01-0,04 por campeão**. **Edição continua 1 crédito.**
6. **Se não servir, nada quebra:** portões medidos na leitura (§4) e queda na proteção de hoje. Depois do render, conferência por pixel e por visão (§6).

## 1. O que os testes provam e o que não provam
Conferido em 05/11 no código (`scripts/trocar.py`) e nos arquivos. A coluna direita de `0X-antes-depois.mp4`, o que o Gusta viu, é a N (PSNR contra N 43-45 dB; contra A 34-38 dB; contra C 38-40 dB).

| variante | apaga a antiga? | texto | área da letra antiga (ou do apagado) à vista: média | p95 |
|---|---|---|---|---|
| **N (aprovada)** | **não** | o mesmo da fala | **2,3-8,1 %** | **22,5-65,4 %** |
| A | sim, TELEA | o mesmo | 23,1-29,7 % | 36,9-66,6 % |
| C (A + contorno +2) | sim | o mesmo | 14,2-24,1 % | 29,9-61,4 % |
| V (destaque novo) | sim | o mesmo | 15,7-45,6 % | 26,2-59,1 % |

**Três divergências com o registro de 05/11:**
- O log diz "apagar por trecho (inpaint)". A N não faz inpaint. O "borrão" de 2,3-8,1 % na N é **letra antiga vazando**, não borrão.
- **Nenhum teste de legenda usou texto diferente.** A, C, V e N escrevem as mesmas palavras. Com palavras novas, a letra antiga não fica coberta: a N sozinha não serve, e o borrão do "limpo" aparece onde o texto novo não cobre. Em 05 e 13 esse borrão é visível na roupa e no cabelo (`0X-limpo.mp4`). Foi esse tipo de resultado que o Gusta reprovou em 28/10, embora lá fosse remoção por IA e sem texto por cima.
- A média esconde os piores quadros. No 13, o p95 de 65 % vem de trechos em que a legenda escreve diferente da fala ("28 MILES", IoU 0,24).

**O que N já prova:** detecção por trecho sem IA, casamento de fonte, posição e karaokê com o tempo da fala, e aparência nativa quando o texto é o mesmo. Corrige até erro da original ("ORACIóN" virou "ORACIÓN" no 02).

**Texto fixo em caixa** (`limpar-texto-teste`): caminho separado e já resolvido. Repintar a caixa com a cor amostrada por quadro não deixa resíduo, mantém gradiente e translucidez e aceita texto de qualquer tamanho. Testado com texto novo.

## 2. Onde entra no produto
### 2.1 Modos **[SUBST. §15.2: `overlay` sai; `box` e `erase` ficam]**
| modo | o que faz | placa | quando |
|---|---|---|---|
| `overlay` | mesmo texto por cima, contorno +2 | nenhuma (usa o original) | muda só estilo, destaque ou correção de grafia |
| `erase` | apaga por trecho e escreve o texto novo | inpaint | texto novo, ou template que precisa da faixa |
| `box` | repinta a caixa e escreve o texto novo | repintura | headline ou texto fixo em caixa opaca |
Um campeão pode usar `erase` e `box` na mesma placa. Trecho de `overlay` com vazamento acima do limite (§6.1) vira `erase` só naquele trecho.

### 2.2 Regra do resíduo **[SUBST. §15.6.5: só vale quando a legenda nova muda de lugar]**
Sem placa, vale a proteção de hoje. **Com placa `erase`**, a faixa deixa de ser protegida e passa a ser uma "área de resíduo", com a regra invertida: em todo instante, ela precisa estar **(a)** sob a nossa legenda, **(b)** sob um elemento opaco do template ou **(c)** fora do quadro por reenquadramento. Nunca à vista.
Função pura nova: `checarResiduo(input)`, irmã de `checarLegendaProtegida`, e usa a mesma grade de 0,1 s. A nossa legenda **acompanha o vídeo** (mesma transformação `pinturaNaCaixa`) e continua em cima do resíduo.
Com "versão sem legenda" enviada pela pessoa, nada muda: ela tem prioridade, e não existe resíduo.

### 2.3 O que passa a poder, por template **[SUBST. §15.4 e §15.6; `caption-swap` fora da 1ª entrega]**
| template | hoje com legenda queimada | com a troca |
|---|---|---|
| Molduras (18) | desvia, reduz ou bloqueia | Slot pode ficar sobre a faixa. A legenda vai junto com o vídeo. Se o slot cobrir a legenda nova, ela sobe para o espaço livre **desde que o resíduo fique coberto** |
| `HEADLINE` | `HEADLINE_NO_ROOM` frequente | Placa ou faixa pode cruzar a faixa da legenda. Em caixa: `box` no lugar da faixa com cor única |
| Split, Versus, Value stack | só com área livre | Painel pode cobrir a faixa. O resíduo fica coberto pelo painel |
| CUT, REVIEW, NATIVE_SEARCH | desvia | Sem mudança por padrão (os cortes preservam a legenda original) |
| CHAT_DM, PERSON_MOTION | regras próprias | Fora da v1 |
| **Novo `caption-swap`** "Legenda nova" | não existe | Peça do vídeo inteiro com a mesma edição, só a legenda muda: mesmo texto ou tradução |
**Mover a legenda para outro lugar, deixando a área antiga à vista:** fora da v1. Depende de a S2 mostrar um apagado aceitável sem texto por cima.

### 2.4 Como aparece pra pessoa **[SUBST. §15.3, §15.4]**
- **Automático (resgate):** a nova ordem de `decidirLegenda` é: candidatos sem encolher (scale 1 e menor afastamento, revisão 29/10) → **`swap`** → último recurso (encolher e faixa) → `blocked`. O formato bloqueado volta para o `allowed`, sem pergunta. A peça mostra o selo "Caption rewritten in the original style" (`captionNote: 'swapped'`). O `fit` fica `ok` em vez de `soft`.
- **Escolhido:** o card "Legenda nova" na galeria, com seletor de idioma no Plan (padrão = idioma original). O Plan mostra o texto por trecho, editável, como os textos de moldura.
- ~~**"Gerar mesmo assim"** e~~ **"Enviar versão sem legenda"** ~~continuam, mas só aparecem~~ continua e aparece quando a troca não serve, com o motivo. "Gerar mesmo assim" saiu (regra de 05/11).
- Texto novo em legenda só no `caption-swap`. O resgate reescreve **sempre as mesmas palavras**.

## 3. Onde roda e como fica rápido
### 3.1 O que o tempo de 797-3664 s era
Medições do teste original (`scripts/medidas/tr*.log`): o processo usou só **135-215 s de CPU** em 797-3664 s de relógio. 75-94 % do tempo foi espera. Cada processo gravava **5 variantes em 5 encoders x264**, 3 processos em paralelo, com a máquina dividida com outros trabalhos. Por isso `t_inpaint` (1026 s no 05) passa do CPU total da rodada: é tempo de relógio contaminado, não custo do algoritmo.

Sonda isolada de 05/11 (`scripts/bench.py`, Mac M5, 1 variante, 1 encoder crf 16 veryfast, carga de fundo ~5; sem o recorte fino `ret`):
| vídeo | duração, faixa medida | `detectar` | N total | apagar total | só `cv2.inpaint` | CPU total N / apagar |
|---|---|---|---|---|---|---|
| 02, 716×1278 | 30 s, 96 px | 4,2 s | **5,6 s** | **16,0 s** | 10,6 s | 28 / 32 s |
| 05, 720×1280 | 30 s, 220 px | 6,9 s | **6,2 s** | **31,3 s** | 21,4 s | 24 / 50 s |
| 13, 720×960 | 21 s, 439 px | 6,0 s | **6,5 s** | **36,0 s** | 18,5 s | 15 / 40 s |
| 02: `ajustar` (fonte e alinhamento) | 30 s | **378 s de relógio, 295 s de CPU, 1 núcleo**; mesmo resultado da rodada original | | | | |

**Leitura:** com 1 variante, o apagar custa 0,5-1,7 s por segundo de vídeo no Mac. Compor em uint8 só no retângulo da legenda quase não muda o total, porque compor já é pequeno. O **`ajustar` é o gargalo real**: uma grade de 22 fontes × 54 combinações de espaçamento × 10 trechos, cada uma desenhada em PIL, mais a programação dinâmica do alinhamento. Na Lambda passaria do timeout.

### 3.2 O que muda em cada etapa **[hipóteses medidas na S1; ver §15.6.2. ROI não deu ganho; temporal é mais lento que TELEA]**
| etapa | hoje | no produto | ganho esperado |
|---|---|---|---|
| **fonte** | grade cega em PIL | Parte do `fontId` da visão (já vem do `describeEdit`), compara 3-5 candidatas pela largura com tabela de avanços (sem desenhar) e só então confere o IoU em 3 trechos | ~300 s → < 5 s (S1 mede) |
| **alinhamento** | programação dinâmica desenhando texto | Mesma programação dinâmica, usando largura calculada e tempo da fala. Trecho com IoU baixo cai na leitura por visão (§5.1) | idem |
| **`detectar`** | 2 decodificações do quadro inteiro | `captionBox` e camadas da leitura já dão a faixa aproximada: 1 decodificação, `crop` no ffmpeg | ~2× |
| **`erase`** | TELEA raio 5 em cada quadro, linha inteira da faixa | Comparar na S1: raio 3, ROI por palavra e **preenchimento temporal** (copiar o pixel de quadros próximos em que a letra não o cobre; TELEA só no que sobrar). Tende a ser mais nítido e mais rápido em talking head | 2-5× (hipótese) |
| **encoder** | quadro inteiro | Na N, nenhum: não há placa. Em `erase`, recodifica só a placa, crf 14 | — |
| **RAM** | pico 0,4-1,6 GB, cache de 4 variantes em float32 | Duas passadas por stream: máscara por trecho, depois pixels. Só a faixa em memória. Cache LRU em uint8. Alvo ≤ 1 GB num vídeo de 120 s | — |

### 3.3 Onde roda
| opção | avaliação | veredito |
|---|---|---|
| VPS | 2 vCPU divididos com o Lab, a API e o ffmpeg; é o que `leitura-lambda` tirou de lá | não |
| Novas ops na `hookmill-leitura` | A imagem é Node. Reescrever TELEA e componentes em TS, ou misturar Python numa imagem que já está em produção | não |
| **Lambda dedicada `hookmill-legenda`** | Python 3.12, numpy, OpenCV headless, Pillow e ffmpeg estático. Roda o código que produziu os pixels aprovados, deploy independente, mesmo padrão sem Docker (`scripts/leitura-lambda.mjs`) | **sim** |
| Remotion Lambda | Não processa pixel do vídeo | só o texto |
| GPU | Sem modelo; não há o que acelerar | não |

**Python × Node:** Python só dentro desta função, atrás de uma porta TS, igual à `LeituraMidia`. Custo aceito: um runtime a mais, em troca de não reescrever nem aprovar de novo o que já foi aprovado. Se a S1 mostrar que o temporal + ROI dispensam o TELEA, reavaliar Node depois.

**Interface (ops síncronas, URLs assinadas, sem credencial de storage, como `leitura-lambda` §3.2):**
- `detectar` → trechos, máscara resumida, estilo, portões. Roda na análise, junto com o Claude. Só para campeão com camada `caption` ou caixa.
- `placa` → pedaço `[iniFrame, fimFrame)` da placa por PUT assinado.
- `juntar` → concatena os pedaços com `-c copy` (GOP fechado em cada início).

~~**Pedaços:** até 45 s = 1 invocação. Acima, 4 pedaços em paralelo cortados em trocas de trecho. Cota: **10 execuções simultâneas divididas com o Remotion** (pedido de 1000 PENDING desde 25/10), então no máximo 4 por campeão. Throttling = refaz em série; estouro de prazo = cai na proteção.~~ **[SUBST. §15.6.4: 4 execuções em todo vídeo, balanceadas; a S1 leu cota de 1000; estouro = peça não oferecida]**

**Sem fallback para a VPS.** `CAPTION_SWAP_IMPL=off|local|lambda` (padrão off). `local` = Python no Mac, para desenvolvimento. Testes usam fake.

### 3.4 Metas e custo **[SUBST. §15.6.2: metas de tempo reescritas com a S1]**
Fator Mac → Lambda de 3008 MB: 3-4× (`leitura-lambda` §6.2: 12 → 31-46 s e 39 → 117 s). Portões da S1:
| vídeo | `detectar` + estilo | placa `erase` | tempo total para a 1ª peça (sem contar o render) | custo Lambda |
|---|---|---|---|---|
| 30 s | ≤ 30 s (na análise, em paralelo: sem espera nova) | **≤ 60 s** (hoje estimado 55-140 s sem otimizar) | ≤ 60 s | ~US$ 0,004-0,008 |
| 120 s | ≤ 60 s | **≤ 120 s** com 4 pedaços (sem otimizar: 225-720 s em série, estimado) | ≤ 120 s | ~US$ 0,015-0,03 |
Tudo acima é **estimativa a partir do Mac**. Só a S1 mede de verdade.

| item de custo por campeão (1 vez) | US$ |
|---|---|
| Lambda (US$ 0,0000392/s a 2,94 GB) | 0,004-0,03 |
| Leitura por visão dos trechos (1 folha, Haiku) | ~0,005 (a confirmar) |
| **Total por campeão** | **~0,01-0,04** |
| Por peça, além do render de hoje (~US$ 0,02-0,04) | conferência US$ 0,008; tradução ~US$ 0,01 (só `caption-swap`) |
A placa guardada ocupa ~8-14 MB por 30 s em crf 16 (medido), ~10-20 MB em crf 14 (estimado).

## 4. Detecção automática e quando NÃO serve **[portões SUBST. §15.6.1; `captionTrack` e catálogo seguem, ajustados por §15.7 e §15.8]**
**Dados gravados** em `editMap.captionTrack` (JSON, sem coluna): `{ version, trechos: [{ iniFrame, fimFrame, box, iou, texto, herdado }], estilo: { fontId, tamPx, tracking, espaco, strokePx, sombra: [dx, dy], corTexto, corDestaque, corTraco, caixaDestaque?, palavrasPorPagina, linhas }, atrasoSec, portoes, veredito: { swap: boolean; reason } }`.

**Catálogo de fontes.** Hoje o `FontId` tem 9. O teste apontou **Gabarito em 2 de 3 campeões**, e ela não está no catálogo. Entram Gabarito, Poppins 700/900, TikTok Sans, Manrope e Archivo expandido (conferir licença de cada uma). **Avenir, Helvetica Neue, Futura e Arial Black do teste são do sistema do Mac: não podem ir pro bundle.** Melhor IoU observado 0,74-0,81.

**Render do texto.** O Remotion ainda não faz o que o Pillow fez nos testes: precisa de sombra dura com deslocamento (hoje só `textShadow` com desfoque; 05 tem [5, 3]), caixa de destaque com degradê (02) e contorno que bata em px (`WebkitTextStroke`). O maquina-video estende o estilo do `remix-keep`. A S2 compara Pillow × Remotion.

**Portões (valores iniciais; a S3 calibra em 20 campeões):**
| portão | medida | valor inicial | razão `reason` |
|---|---|---|---|
| Detectou | quadros com fala cobertos por trechos bons | ≥ 80 % | `not_detected` |
| Letra com contorno | o detector pede letra clara com contorno escuro a ≤ 6 px; sem contorno não acha | detectou | `no_outline` |
| Fonte | IoU mediano e trechos herdados | ≥ 0,6; ≤ 15 % | `font_mismatch` |
| Rosto | faixa cruza o rosto `main` (`faceTrack`) | > 10 % dos quadros = fora | `over_face` |
| Fundo | energia de detalhe em volta das letras | S3 define | `busy_background` |
| Animação | variação de largura e altura dentro do trecho, entrada com escala | > 8 % = fora | `animated` |
| Linhas | a v1 testada é de 1 linha | 2 linhas só se a S2 aprovar | `multi_line` |
| Idioma | CJK e RTL sem teste | fora na v1 | `script_unsupported` |
Os portões `over_face` e `busy_background` só valem para `erase`. O `overlay` não apaga nada e continua possível, se o texto for o mesmo.

**Fallback ~~:~~ [SUBST. §15.1 regra 4: reprovado = peça não oferecida; não há proteção por cobertura]:** qualquer portão reprovado = `swap` não é candidato e `decidirLegenda` segue como hoje. Tudo na função pura, a mesma no plano e no build. `captionTrack` nulo (campeão antigo, função desligada) = proteção de hoje. Campeão antigo é medido sob demanda no 1º `use` que precisar.

**Texto em caixa:** usa o que já existe (`layerPresence`, `solidBackground`, `background.kind`), mais o corte seco do trecho e a amostragem por quadro. Serve quando a caixa é opaca e parada. Caixa que se move continua `headline_moves`.

## 5. Texto novo
### 5.1 Fonte da verdade por trecho
Whisper erra grafia e a legenda original às vezes escreve diferente da fala. **Proposta:** 1 folha com os recortes de todos os trechos, lida pelo Haiku uma vez por campeão (`texto` do trecho). O tempo vem da transcrição. Divergência entre os dois não é erro: o texto escrito vale pro desenho, a fala vale pro tempo. A S2 confirma se a folha é legível o bastante.

### 5.2 Variantes **[§15.6: 1ª entrega só "mesmo texto"; tradução e gancho pendentes do Gusta. `box` aqui: §15.5]**
| variante | quem escreve | tempo | regra |
|---|---|---|---|
| **Mesmo texto** (resgate e padrão) | ninguém. Só as palavras lidas, com grafia normalizada | palavra a palavra pela transcrição + `atrasoSec` medido (0,13-0,24 s nos testes) | **Sem IA gerativa.** Nada novo por construção |
| **Tradução** (`caption-swap`) | IA, trecho a trecho | mesmo intervalo de cada trecho. Destaque distribuído por caracteres, porque não há tempo por palavra traduzida | **Nada inventado:** mesmos números (`inventedNumbers`), sem promessa nova, marca intacta. Cabe na caixa do trecho (largura ≤ 115 %), mesmo nº de linhas. 1 reparo; falhou = peça fora |
| **Reescrita de gancho** | — | — | **Fora da v1.** Legenda que diz outra coisa que a fala parece erro, e pode prometer o que o áudio não diz. Gancho novo = `HEADLINE` (já existe, §13) |
| **Headline e texto em caixa** | IA pelas regras do `HEADLINE` | intervalo medido da camada | `validatePlan` de hoje. Com `box`, caixa pode crescer na mesma cor se o texto novo não couber |
Lembrete: tradução muda a legenda, **não o áudio**. É legenda em outro idioma sobre a fala original. Dublar é outro produto.

## 6. Conferência depois do render
### 6.1 Por pixel, grátis, na Lambda **[SUBST. §15.6.1: "área à vista" não é portão. O E2 + W1 aprovado mede 31-40 % de média, estes limites o reprovariam]**
Ao montar a placa e de novo no input final: fração da pegada antiga à vista por quadro (a métrica da §1). Limites iniciais: média ≤ 10 %, p95 ≤ 30 % por trecho. Acima disso no `overlay`, aquele trecho vira `erase`. Acima disso no `erase`, a peça cai fora. A S3 calibra. A função devolve os **6 piores quadros**.

### 6.2 Por visão
Reaproveita `checkCaption` (`legenda-protegida-v1` §4.2, Haiku, US$ 0,008), rodando **nos 6 piores quadros** em vez de espalhados. Modo `swap` com 2 problemas novos: `ghost` (letra antiga vazando, duas legendas) e `smear` (borrão à vista). Mesma regra de veredito (F9/F10). Reprovou = formato `failed`, `CAPTION_RESIDUE`, `retryHint: 'retry'`. ~~O retry vai pro passo seguinte (`erase` em vez de `overlay`, depois a proteção de hoje) e a peça sai do zip.~~ **[SUBST. §15.6.3: `overlay` e proteção por cobertura saíram; sem retry de outro caminho]** A peça sai do zip. Falha final = crédito devolvido pela regra T4.

## 7. Banco, tipos e rotas **[SUBST. §15.8]**
- **Banco, aditivo:** `champions.caption_plate_file_id` (FK `files`, null), `champions.caption_plate_status`, `FileKind CHAMPION_PLATE` (fora do `CHAMPION_CLEAN_VIDEO`, que é a versão **enviada** e significa "sem resíduo"). Proxy do editor §8 acrescenta o tipo novo.
- **Job:** `CAPTION_PLATE`, único por campeão (trava), idempotente. Peça espera em `queued` com etapa `preparing_caption`. Polling de `GET /iterate/:id`, sem evento novo.
- **Tipos:** `captionMode: 'avoid' | 'replace' | 'swap'`; `IteratePiece.captionNote: 'replaced' | 'swapped' | null`; `EditMap.captionTrack?`; `AutoInsight.captionSwap?: { available; reason? }`; `AutoVariationType + 'CAPTION_SWAP'` (código `CAPTION-<idioma>`).
- **Erros:** síncrono 422 `CAPTION_SWAP_UNAVAILABLE { reason }`; assíncronos `CAPTION_SWAP_FAILED`, `CAPTION_RESIDUE`.
- **Rotas:** `POST /ad-templates/caption-swap/use` (já existe a genérica); `PATCH /iterate/:id/items/:itemId/texts` com `path` por trecho (já existe); idioma em `settings` do lote, rota definida no F0.
- **Placa como base:** `RemixKeepRenderInput.baseVideoUrl` = placa, `audioPassthroughUrl` = campeão. `comporSobreOCampeao` já compõe sobre qualquer base. Precisa bater em frames, conferido pelo `contarFrames` de hoje.

## 8. Relação com o editor universal **[segue valendo, depois da fase F3 da §15.9; `overlay` saiu]**
**Sim, a legenda trocada vira camada editável, depois do F-U2.** O F-U1 e o F-U2 não dependem de nada daqui e não mudam.
- O manifesto da peça troca a camada `burned` (travada) por `caption` (`kind` e controle `words` já existem no contrato). `captionWords` com `t:<wordIndex>` já cobre a edição das palavras.
- A API entrega a placa como vídeo da peça e o proxy dela. `AutoPieceSource.guard` ganha `residueBands`.
- Regra nova em `checarEdicao`: `residue_exposed` (block), que usa a `checarResiduo` da §2.2.
- Mudar texto, cor ou fonte **não refaz a placa**: o Export continua um re-render grátis (`editor-universal` §9).
- **Peça sem placa** (`overlay`): só estilo e grafia são editáveis. Texto diferente pede a placa, e o primeiro Export com texto novo enfileira o job.

## 9. Preço
**Edição = 1 crédito, sem cobrança à parte, para o resgate e para o `caption-swap`.** Custo nosso ≤ US$ 0,10 por peça no pior caso (placa de 120 s + tradução + render + conferência) contra crédito ≥ US$ 0,86, e a placa é paga uma vez por campeão. Tudo cai em `cost_entries`. A leitura e os portões não cobram (A5). Falhou = devolve (T4, A3). 4:5 e 1:1 continuam grátis. Export no editor continua grátis.

## 10. Sondas antes do código **[S1 e S2 feitas; novas sondas em §15.9]**
| sonda | o que responde | custo | portão |
|---|---|---|---|
| **S0** feita 05/11 | onde foi o tempo; a N é sem inpaint; `ajustar` é o gargalo | US$ 0 | — |
| **S1 velocidade** (maquina-video) | Função Python real em conta, 3008 MB, nos 3 vídeos + 1 de 120 s. `ajustar` novo, TELEA r5/r3, ROI, temporal; 1 × 4 pedaços; RSS e custo. Inclui: o estilo achado pelo ajuste rápido é o mesmo da grade? | ~US$ 0,05 de AWS | Tabela da §3.4 |
| **S2 texto diferente** (maquina-video + ia) | **A pergunta central.** Os 3 campeões com tradução EN/PT e texto mais curto e mais longo, TELEA × temporal, Pillow × Remotion, 1 campeão de 2 linhas | ~US$ 0,05 de IA | **O Gusta vê e aprova.** Se reprovar: a v1 fica só com `box`, `overlay` e os portões não abrem |
| **S3 amplitude** (qa) | Portões em 20 campeões reais, % que passa, calibra limites | US$ 0 (local), + ~US$ 0,20 de visão se incluir leitura | ≥ 50 % dos campeões com legenda passam; senão, reavaliar valor |

## 11. Fases e divisão **[SUBST. §15.9]**
Nada abaixo toca as pastas do editor universal nem do Ad Radar até F3. Os itens F1 e F1b ficam em pastas novas.
| fase | entrega | quem | depende |
|---|---|---|---|
| **F0** | Este contrato revisto, tipos aditivos, migração, `api.md`, fontes novas no catálogo | arquiteto | S1, S2, ok do Gusta |
| **F1 motor** | `hookmill-legenda`, script de deploy, porta `api/src/medicao/troca/`, ops `detectar`/`placa`/`juntar`, portões, conferência por pixel | **video** | F0 |
| **F1 leitura e job** | `captionTrack` na análise, job `CAPTION_PLATE`, custo | **backend** | porta |
| **F1b caixa** | `box` na placa, `HEADLINE` usa a placa em caixa (independente do `erase`; **pode sair antes**) | **video** + backend | F0 |
| **F2 `caption-swap`** | Tipo, regra do plano, card, tradução (`translateCaption`, validação, fake), `checkCaption` modo swap, Remotion com sombra dura e destaque, seletor de idioma, texto por trecho no Plan, selo na peça | **ia**, **video**, **backend**, **frontend** | F1. **Demonstração ao Gusta aqui** |
| **F3 resgate** | `decidirLegenda` com `swap`, `checarResiduo`, `allowed`, `fit`, avisos no Plan | **video** + backend + frontend | F2 e F-U1 fundidos, porque mexe em `legendaProtegida.ts` e nos builders |
| **F4 editor** | Camada `caption` na peça com placa, `residue_exposed`, proxy | **video** + backend + frontend | F3 e F-U2 |
| QA | Em cada fase, só o recorte; suíte completa no fim | **qa** | — |

## 12. Decisões do arquiteto **[itens 3, 5 e 6 revistos em §15.2]**
1. Placa por campeão e texto no Remotion: um desenhador de texto só. O Pillow fica só nos testes.
2. Python só dentro da função dedicada, sem fallback para a VPS.
3. Avoid continua antes de swap: o que não precisa tocar no original não toca.
4. Mover a legenda deixando o resíduo à vista e CJK/RTL ficam fora da v1.
5. `overlay` só com as mesmas palavras. O resgate nunca muda o que está escrito.
6. `CAPTION_SWAP_IMPL` padrão off; liga por workspace interno antes de abrir.

## 13. Pro Gusta **[estado em §15.2]**
1. **Rever a aprovação com olho certo.** O que vc viu e aprovou foi mesmo texto, sem apagar. Autoriza a **S2** (texto diferente, ~US$ 0,05) e vê o resultado antes de qualquer código? **É o que decide o produto.**
2. **Autoriza a S1** (função Python na conta AWS, ~US$ 0,05)? Exige o perfil admin e cria recurso novo na conta.
3. **Resgate automático:** formato bloqueado passa a sair com a legenda refeita e um selo, sem perguntar (recomendado). Ou prefere uma opção explícita por lote?
4. **Reescrita de gancho na legenda:** fora da v1 (recomendado), gancho novo fica com a `HEADLINE`. Vc quer mesmo assim uma legenda que diga algo diferente da fala?
5. **Tradução:** legenda em outro idioma com o áudio original. É o que vc imagina, ou esperava dublagem junto?
6. **Preço:** Edição = 1 crédito, sem extra (recomendado).
7. **AWS:** vale cobrar os dois pedidos parados (concorrência 1000, pendente desde 25/10; memória 10240 MB, chamado 179345186300484). Com 6 vCPU, parte dos pedaços deixa de ser necessária.

---

## 14. F1b fechado (2026-11-05): headline em caixa, copiada do criativo
Dono: maquina-arquiteto. Status: **histórico; revisto pela §15.5.** Medições, régua de fonte e escada de texto seguem valendo onde a §15.5 não diz o contrário. Só cobre o modo `box`. Não decide nada de `erase`, `caption-swap` ou resgate (dependem da S2).
Requisito (Gusta, 05/11): "ele tem q analisar como esta a headline, e copiar a do criativo somente mudando as palavras". Vale por cima de `headline-e-legenda-v1.md` §1.3 e §1.4 no caso de caixa, e por cima das §3, §5.2 e §7 deste contrato no que elas dizem sobre caixa.
Evidência nova: `research_notes/headline-caixa-f0-2026-11-05/` (scripts e painéis; custo US$ 0, Mac, com a S2 rodando ao lado). `editMap` lido do banco local `maquina` só com SELECT. As fontes de teste vieram do `@fontsource`. Medições em Pillow e numpy, não em Remotion: o desenho final só a demonstração confere.

### 14.0 Resumo
1. **[SUBST. §15.5.1: a medida passa a morar na função Python, única para solto e caixa.]** **Dá pra fazer sem `hookmill-legenda` e sem S1.** Fundo da caixa = imagem pequena medida uma vez (1,5 KB no 02), texto pelo `remix-keep` que já existe. Sem migração, sem job e sem rota nova.
2. **Limite:** a caixa fica parada. O vulto que se mexe atrás da faixa do 02 congela. Se o Gusta reprovar isso na demonstração, aí sim depende de placa por quadro e da S1 (§14.2).
3. **A leitura de hoje não copia.** Nos dois vídeos do teste ela erra o suficiente para a peça sair errada (§14.1), então o F1b começa corrigindo a medição.
4. **O catálogo é o maior buraco de fidelidade:** nenhuma fonte de texto corrido abaixo de 700. O 02 e o 06 têm peso médio. Montserrat 500/600 resolve os dois no teste.

### 14.1 O que a leitura entrega e o que falta
**O que aconteceria hoje nos vídeos do teste** (lido do `editMap` e do `buildHeadlineInput`; não renderizei a peça):
| vídeo | real (medido) | o que a leitura gravou | efeito na peça |
|---|---|---|---|
| **02** `cmw1l7ts4…` | faixa até o quadro **198** (6,6 s) | `endFrame` **2377** (79 s), `source: vision+pixel`. Provável causa: o quadro de referência é o meio do intervalo da visão, depois do corte, e sem faixa nele a cor fica a da visão | faixa azul sobre a cena por mais 73 s |
| **06** `cmw1kocsl…` | caixa vermelha 0-335, o gancho | a caixa está certa, mas `headlineDoCampeao` pega a **maior** camada: `headline-2`, o CTA final, sem fundo | troca o CTA com placa e deixa o gancho antigo |
| **02 e 06** | Peso médio, caixa baixa | `inter-800` tamanho 58 (real ~62-66); `roboto-condensed-700` | Letra visivelmente mais pesada (`v02-painel.png`, `v06-painel.png`) |
| **Falso positivo** | `snapinsta` e `v1-outra` | caixa "pill" de 720×900 e 720×1280: o quadro inteiro | a placa cobriria tudo |

**Campo a campo:**
| dado | hoje | fonte | F1b |
|---|---|---|---|
| Palavras | sim, sem quebra de linha ("line breaks as spaces") | visão | `describeEdit` passa a devolver `\n` |
| Fonte e peso | `fontId` do catálogo, só ≥ 700 fora Anton e Bebas | visão, sem conferir | medido, §14.1.2 |
| Tamanho | `fontSizeRel` da visão. A medição por pixel prometida em `headline-e-legenda` §1.3 **não existe no código** | visão | medido |
| Entrelinha | **fixa em 1,15** | constante | medida |
| Cor do texto, contorno, sombra | hex e booleano | visão | cor e sombra medidas; contorno segue da visão, conferido na prova |
| Caixa alta | booleano | visão | `caseStyle`: `upper`, `sentence` ou `title` |
| **Sublinhado** | **não existe** | — | medido |
| Destaque | só cor, um trecho | visão | `emphasis`: cor, sublinhado ou caixa, um trecho que pode cruzar linhas |
| Alinhamento | `align` | visão | medido por linha |
| Posição do texto | caixa da faixa | visão + pixel | 1ª linha de base e `textBox` medidos |
| Caixa | 1 quadro, degradê só vertical | `solidBackground` | medida na mediana do trecho, 2D |
| Intervalo | `layerPresence`, referência no meio | pixel, errado no 02 | âncora onde a caixa existe, corte exato |
| Quebra de linha do texto novo | `ajustarTexto` no render, passo de 4 % | composição | `lines` explícitas, a mesma função no plano, no build e no editor |

#### 14.1.1 Como medir (a partir do `trocar_texto.py`)
Só o recorte da caixa, no trecho. Custo medido: **0,7-2,8 s no Mac** por vídeo, incluindo decodificar o recorte do intervalo. Função nova `medirHeadlineCaixa` em `api/src/medicao/camadas.ts`, chamada no `refinar`.
1. **Intervalo.** 2 amostras por segundo no recorte, âncora perto do início da visão, corrida de cor próxima, corte exato por quadro. Resultado: **198, 335 e 191 quadros** (02, 06, 05). Bate com a medição à mão do teste (198 e 335) e com a leitura no 05.
2. **Mediana temporal** do trecho, como no script: tira tudo que se move.
3. **Máscara da letra.** O script usa `claro > 150`, que só serve pra letra clara. Trocar por contraste local contra a mediana grande (`medianBlur`) e alfa pela projeção no eixo fundo → texto. Limpa nos 3 vídeos.
4. **Linhas, entrelinha e alinhamento.** Projeção por linha e por coluna. Medido no 02: larguras 664, 540 e 563 px.
5. **Sublinhado.** Linha de pixels com corrida contínua > 20 % da largura. Achou sozinho, no 02, y 153-158 (x 303-641) e y 220-225 (x 76-604), o mesmo que o `c02.json` tinha à mão.
6. **Peso.** `stemPx` = 2 × p90 da distância à borda da máscara. 02 = 7,6; 06 = 3,8. Separa bem: `inter-800` dá 9,6 no 02 (+26 %) e 5,7 no 06 (+50 %).
7. **Cor do texto e fundo.** Mediana dos pixels internos. A placa é a convolução normalizada do método B, sobre a mediana. **[Dilatação SUBST. §16.2 A5]** A dilatação da máscara soma contorno e sombra (o 05 tem sombra: com 9 px sobra halo, p99 27).
8. **Sombra.** `{dx, dy, blurPx, color}`, medida pelo halo escuro em volta da máscara. **Sem validação ainda:** o 05 é o caso da demonstração. Se não medir bem, fica o booleano de hoje e a prova reprova.

#### 14.1.2 Fonte: o que acontece quando a exata não existe
Fonte igual quase nunca vai existir: o original costuma usar fonte comercial. A meta é a **mais próxima em desenho e igual em peso, tamanho e posição**.
**Evidência, redesenhando as palavras originais** (cos = similaridade com a letra original; `v0X-fontes2.json`, busca local, então vale como ordem de grandeza):
| vídeo | hoje (a leitura) | melhor do catálogo atual | melhor com pesos novos | melhor geral |
|---|---|---|---|---|
| 02 (traço 7,6) | `inter-800`: 0,682, traço 9,6 | `roboto-condensed-700`: 0,691, traço 9,6 | **`montserrat-600`: 0,749, traço 7,6** | Raleway 600: 0,837, traço 7,4, mas o "2" sai em numeral antigo |
| 06 (traço 3,8) | `roboto-condensed-700`: 0,606, traço 5,7 | `montserrat-900`: 0,673, traço 6,6 | **`montserrat-500`: 0,722, traço 3,8** | o mesmo |
Referência do olho: a Inter Bold do teste no 02 dá 0,709 e traço 9,3, e o README registrou "dá pra notar lado a lado". Por isso o corte de "igual" está logo acima disso.

**Catálogo, aditivo:** `montserrat-500/600/700`, `inter-500/600/700`, `poppins-500/600`. Raleway 600 só se os numerais de linha funcionarem no `.woff2` (senão fica fora). Conferir a licença no pacote. Cada fonte precisa de tabela própria no `metricas-fontes.mjs`; os atalhos do `MEDIDA` (`oswald` → `anton`, `roboto-condensed` → `inter`) saem, porque o plano mediria errado.
**Escolha em 2 passos:**
1. Pré-seleção sem desenho: largura por linha, altura de x e traço, com tabela offline. **Não basta sozinha:** os 5 primeiros dela ficaram em 2º, 21º, 29º, 17º e 26º na comparação desenhada do 02. Serve pra filtrar peso, e fica com 5 candidatas + a família da visão.
2. **Prova do original:** 1 still Remotion, no motor do render final, com as palavras originais nas candidatas. O TS compara com a máscara, com ajuste de deslocamento de ±4 px sem redesenhar. Uma vez por campeão; o resultado vai no `editMap`.

**[SUBST. §16.2 A3: valores e método]** **Régua automática de "ficou igual"** (valores iniciais, calibrados em só 2 vídeos; a demonstração e 20 campeões ajustam):
| medida, redesenhando as palavras originais | `same` | `close` | `far` |
|---|---|---|---|
| Similaridade (cos) | ≥ 0,70 | ≥ 0,60 | < 0,60 |
| Traço contra o original | ± 15 % | ± 30 % | fora |
| Largura de cada linha | ± 2 % | ± 4 % | fora |
| 1ª linha de base e entrelinha | ± 2 px (a 720 de largura) | ± 4 px | fora |
| Cor do texto e do fundo | ΔRGB médio ≤ 8 | ≤ 16 | fora |
| Intervalo | ± 1 quadro | ± 1 quadro | fora |

| resultado | o que acontece |
|---|---|
| `same` | Peça normal |
| `close` | Peça sai, com a marca "Closest font" no Plan e na peça |
| `far` | `HEADLINE` não é oferecido: `headline_font_far` no `allowed`. Métrica gravada para decidir que fonte entra no catálogo. Fica em aberto (§14.8) |
**A régua final é o olho do Gusta:** a automática só impede regressão depois que ele aprovar. Número não aprova sozinho.

### 14.2 Onde roda
**É possível sem `hookmill-legenda` e sem S1**, se a caixa puder ficar parada.
| etapa | onde | recurso novo? |
|---|---|---|
| `medirHeadlineCaixa` | `refinar` (`etapas.ts`), o mesmo código em `ANALYZE_IMPL=local` ou `lambda`, ffmpeg + TS | Não. Em `lambda` pede atualizar a imagem da `hookmill-leitura` pelo script existente; até lá, cai na medida sob demanda na API |
| Prova do original | still no Remotion Lambda já existente, ou local em dev | Não. Pede novo deploy do site do Remotion (fontes e composição) |
| Pintura | `remix-keep` + `comporSobreOCampeao`, como a `HEADLINE` de hoje | Não |

**A placa é uma imagem 2D pequena**, não vídeo: 1/8 da caixa, PNG em data URI, com `background-size: 100% 100%`. Medido: 89×30 px = **1541 bytes** em base64 no 02, 60×16 = **374 bytes** no 06. Vai no `editMap` e nas props: Player e Lambda desenham igual, sem arquivo e sem URL assinada.
Precisa ser 2D porque o degradê 180° de hoje não cobre o que há nos vídeos: a variação horizontal é maior que a vertical no 02 (22,8 × 7,4) e no 06 (12,2 × 4,0).
**Parada serve? [respondido: sim, §16.4]**
| vídeo | desvio temporal do fundo (média; p99, em níveis) | leitura |
|---|---|---|
| 06 | 0,54; 3,3 | Parada de fato |
| 05 | 0,27; 3,7 | Parada de fato |
| 02 | 3,77; 17,7 | Translúcida, vulto da cabeça se move |
Na média, a placa parada do 02 fica a 3,56 níveis do método B por quadro (pior quadro 6,69; p99 16,7). Em `v02-placa-painel.png` (original, por quadro, parada), a diferença é só a sombra suave. **Provável que não se note, mas quem decide é o Gusta vendo** (§14.7).

**O que não dá pra fazer sem S1:** repintar por quadro. O texto precisa ir sobre um vídeo já repintado, o que exige passada antes do render, arquivo, job e migração da §7. O `removelogo` do ffmpeg como atalho levou 13 s em 198 quadros e 7,9 s em 335 no Mac, o que não escala para intervalo de 2 min na VPS, onde não rodei. Se o Gusta reprovar a placa parada, o `box` passa a depender da S1, e as §3 e §7 voltam a valer para a caixa.

### 14.3 Quando não é caixa opaca parada
**Portões do `box`**, todos na medição, gravados em `headlineLook.verdict`:
| portão | medida | valor inicial | razão |
|---|---|---|---|
| Há caixa | fundo chapado cruza o texto, área ≤ 2,5× o bloco de texto e ≤ 40 % do quadro | a área tira os falsos positivos do `snapinsta` e `v1-outra` | `no_box` |
| Não se move | caixa medida no início, meio e fim do trecho | diferença ≤ 1 % do quadro | `box_moves` |
| Corte seco | entrada e saída em ≤ 3 quadros | fade fora da v1 | `fades` |
| Nada muda dentro | desvio temporal p99 dentro da caixa | ≤ 40 (02 = 17,7; sem caixa = 93,7) | `text_changes` (troca de texto ou legenda em cima da caixa) |
| Contraste | texto contra fundo | máscara separa | `low_contrast` |
| Fonte | §14.1.2 | não `far` | `font_far` |

| caso | hoje | no F1b |
|---|---|---|
| **Caixa opaca parada** | Faixa com cor de 1 quadro, fonte e tamanho da visão | **`copy: 'box'`**, cópia medida |
| **Texto solto sobre a cena** | Placa opaca cobre o texto antigo (cor mediana, ou preto/branco; 2 % de margem) | ~~**Igual, sem prometer apagar nem copiar.** `copy: 'plate'`, com aviso no Plan: "A new plate covers the original text". Ver §14.8. Só muda com a S2~~ **[SUBST. §15.5: apaga e redesenha, molde `tiktok-followcatch`; reprovado = não oferece]** |
| **Caixa que se move** | `headline_moves` só pega 2 camadas com o mesmo texto em caixas diferentes. Uma camada só escapa: o intervalo encurta e o texto antigo volta depois | `box_moves` bloqueia com `headline_moves`, agora medido. Fora da v1 |
| **Fade, ou texto que muda dentro** | Passa, com intervalo errado | Bloqueia, `headline_moves`, com o detalhe em `verdict.reason` |
| **Duas headlines em sequência** | A maior é trocada, a outra fica | A camada-alvo é **a primeira no tempo com `verdict.box`**, senão a regra de hoje. O CTA final deixa de ser pego no lugar do gancho |
| **Sem headline** | `add`: faixa na cor da marca | Igual. Não há o que copiar |
| **Campeão antigo** | `editMap` sem o campo | Mede sob demanda ~~no plano, na API~~ pela função (§15.5.1), e grava. Falhou = `not_measured`: com `HEADLINE_BOX=on`, bloqueia com `headline_low_confidence`, porque o intervalo da leitura antiga não é confiável (caso do 02) |
**Legenda [ampliado por §15.5.4]:** nenhuma regra muda, com uma exceção estrita: caixa `box` **sem crescer** não pinta nenhum pixel que a caixa original já não ocupava, então fica isenta de `protectedBands` e de `burned_captions`. Legenda em cima da caixa cai em `text_changes`. Caixa que cresce segue a regra de hoje na parte nova.

### 14.4 Texto que não cabe
Uma função pura em `video/src/lib/`, `ajustarHeadlineCaixa(look, texto)`, usada no plano, no `PATCH …/texts`, no build, no Player e no editor. Devolve `{ lines, sizePx, boxGrow, step }`. O render não reajusta mais: recebe `lines` e tamanho prontos. Mede pela tabela, em Node e no navegador, com o mesmo resultado. A escada para no primeiro degrau que cabe:
| degrau | o que faz | aparência |
|---|---|---|
| 0 `same` | Mesmo tamanho, nº de linhas e entrelinha, quebra balanceada | Idêntica |
| 1 `rewrap` | Mesmo tamanho, usa a largura até a margem mínima da original na caixa | Idêntica |
| 2 `shrink` | Reduz até **90 %**. Substitui o piso de 80 % de `headline-e-legenda`, que muda a aparência | Quase igual |
| 3 `grow` | +1 linha, tamanho ≥ 90 %, e a caixa cresce com a mesma placa esticada: pra baixo se encosta no topo, pra cima se encosta embaixo, senão pros dois lados. Só se a parte nova não cruzar o rosto > 10 % nem a legenda protegida, e couber no quadro | Caixa maior, mesma cara |
| 4 `too_long` | Não coube | Violação |
**Texto mais curto [no solto, SUBST. §16.3; a caixa segue assim]:** mantém caixa e tamanho, nunca aumenta a letra. Com menos linhas, centra o bloco na altura do bloco original. A placa cobre o texto antigo sozinha, sem resíduo.
**Plan:**
- A IA recebe limites reais: `AutoPlanInput.headline` ganha `lines`, `charsPerLine[]`, `caseStyle`, `emphasisKind`. O `maxChars` segue, como teto.
- **[SUBST. §16.3: até 3 reescritas]** `headline_too_long` passa a vir de `ajustarHeadlineCaixa`, com 1 reparo. Falhou: peça fora, `HEADLINE_TOO_LONG`, Leave out, como hoje.
- Na edição manual, `PATCH …/texts` responde 422 `TEXT_INVALID` no degrau 4. O web roda a mesma função ao digitar e mostra o degrau: "Fits", "Slightly smaller", "Box grows", "Too long".

**Editor universal:**
- `resolverPropsHeadline` usa a mesma função; `fits: false` cai no `text_overflow` (block) que já existe. Degraus 2 e 3 geram aviso (`warn`), sem bloquear.
- Estilo, cor e posição escolhidos à mão pela pessoa valem como escolha dela e não passam pela régua de fonte.
- **Bug de hoje, independente do F1b:** mover ou reduzir `headline:box` mostra a headline antiga, porque a máscara do compositor é só a caixa nova. Regra nova `residue_exposed` (block, o nome da §8): a caixa precisa conter a caixa original durante o intervalo. Em `box`, `headline:box` perde `move` e só pode crescer. A checagem aqui é a de contenção simples; a `checarResiduo` da §2.2 segue na F3.
- `fill` manual troca a placa por cor chapada.
- Export segue re-render grátis. Peça sem `headlineLook` não muda (doc nulo continua com PSNR = ∞).

### 14.5 Tipos, rotas, migração **[tipos revistos em §15.8; agora há 1 migração]**
**Migração: nenhuma.** `headlineLook` é JSON dentro de `teardowns.edit_map`, como o `captionTrack` da §4. `FileKind`, job e colunas da §7 **não são necessários para o `box`**.
**Rotas: nenhuma nova.** Mudam o `PATCH /iterate/:id/items/:itemId/texts` (§14.4) e os campos abaixo, em `GET /iterate/:id` e no `allowed`. **Evento novo: nenhum.**
**Preço: 1 crédito por edição, sem extra** (§9). A medida e a prova não cobram (A5).
```ts
// contratos/src/index.ts, aditivo
export type FontId = /* os 9 de hoje */ | 'montserrat-500' | 'montserrat-600' | 'montserrat-700'
  | 'inter-500' | 'inter-600' | 'inter-700' | 'poppins-500' | 'poppins-600';
export type HeadlineBoxReason = 'no_box' | 'box_moves' | 'fades' | 'text_changes' | 'low_contrast' | 'font_far' | 'not_measured';
export type HeadlineEmphasis =
  | { kind: 'underline'; thicknessPx: number; offsetPx: number; color: string }
  | { kind: 'color'; color: string } | { kind: 'box'; color: string };
export interface HeadlineLook {
  version: 1; layerId: string; startFrame: number; endFrame: number;
  box: Rect; radiusPx: number;
  plate: { color: string; image: string /* data:image/png;base64, ≤ 4 KB */; temporalP99: number };
  text: { lines: string[]; textBox: Rect; firstBaselineY: number; linePitchPx: number; sizePx: number; letterSpacingEm: number;
    align: 'left' | 'center' | 'right'; caseStyle: 'upper' | 'sentence' | 'title'; color: string;
    stroke: { color: string; px: number } | null; shadow: { dx: number; dy: number; blurPx: number; color: string } | null; stemPx: number };
  emphasis: HeadlineEmphasis | null;
  font: { fontId: FontId; cos: number; stemErr: number; widthErr: number; tier: 'same' | 'close' | 'far' };
  verdict: { box: boolean; reason: HeadlineBoxReason | null };
}
// EditMap ganha: headlineLook?: HeadlineLook | null
// contratos/src/iteracao.ts: PieceHeadline ganha: copy?: 'box' | 'plate' | 'add' | null; fontTier?: 'same' | 'close' | null; fitStep?: 'same' | 'rewrap' | 'shrink' | 'grow' | null
// api/src/iteracao/headline-plano.ts: HeadlineInfo ganha copy; HeadlineBlocked ganha 'headline_font_far'
// video/src/lib/remix.ts, todos opcionais (props antigas continuam válidas):
//   textLayerSchema.background.image?; style.letterSpacingEm?; style.shadowDetail?; style.emphasis?; content(static).lines?
```
Fica para outra fase: `captionMode`, `captionTrack`, `CAPTION_PLATE`, `CHAMPION_PLATE`, `CAPTION_SWAP_*`.

### 14.6 Divisão **[SUBST. §15.9]**
| ordem | dono | entrega | arquivos | depende de |
|---|---|---|---|---|
| 0 | **video** | Demonstração §14.7 | `research_notes/headline-caixa-demo-*` | nada |
| 1 | **arquiteto** | Tipos acima, `api.md`, `modelo-de-dados.md`, nota em `headline-e-legenda` | `contratos/src/`, `docs/` | ok da demo |
| 2 | **video** | Fontes e tabelas, `medirHeadlineCaixa`, prova do original, `ajustarHeadlineCaixa`, `RemixKeep` (placa, entrelinha, sublinhado, sombra, `lines`), caminho `box` no `buildHeadlineInput`, nova escolha em `headlineDoCampeao` | `video/src/`, `video/public/fonts`, `api/src/medicao/`, `api/src/render/headline.ts` | 1 |
| 2 | **ia** | `describeEdit` com `\n`; `planAutoBatch` com os limites novos; fake | `api/src/integracoes/claude/` | 1 |
| 3 | **backend** | Medida sob demanda de campeão antigo, `headlineInfoOf` (`copy`, bloqueios), isenção da §14.3, `PATCH …/texts`, `PieceHeadline`, `guard.residueBands` | `api/src/iteracao/`, `api/src/edicao/` | função do video |
| 3 | **frontend** | Marcas `copy`, "Closest font", degrau ao digitar, i18n de `residue_exposed` e `headline_font_far` | `web/` | 1 (MSW) |
| 4 | **video** | Editor: `resolverPropsHeadline`, `manifestoHeadline`, `residue_exposed` em `checagens.ts` | `video/src/lib/editor/` | F-U2 fundido, para não colidir |
| 5 | **qa** | Só o recorte: 02, 05 e 06 + Adele Wu. Intervalo ± 1 quadro, PSNR fora da caixa ≥ 40 dB, áudio md5 igual, `nb_frames` igual, faixa some no corte, `snapinsta` sem `box` | `testes/` | tudo |
**Fora de todos:** `research_notes/limpar-legenda-teste-2026-11-05-s2/`, `legendaProtegida.ts` além da isenção, e qualquer coisa de `erase`.
`CAPTION_SWAP_IMPL` não se aplica. Chave nova `HEADLINE_BOX=off|on` (padrão off; `off` = fluxo de hoje), ligada primeiro em workspace interno.
**Risco:** `RemixKeep.tsx` e `api/src/render/headline.ts` podem ser tocados pelo F-U2. O arquiteto confere a fila antes de soltar o passo 2.

### 14.7 Demonstração, antes de qualquer código **[absorvida pela S4, §15.9. O critério de aprovação segue]**
Sonda local, fora do produto, custo US$ 0. **Render no Remotion de verdade**, não em Pillow: é ele que vai produzir a peça.
| vídeo | por quê | versões |
|---|---|---|
| **02** (`reino-del-amor-swipe/criativos-concorrente/midia/02-…`) | Faixa no topo, translúcida, sublinhado em duas linhas | mesmas palavras · texto novo do teste ("Si en 7 días no / vuelve a escribirte, / nunca fue para ti..") · texto mais longo (degrau 3) |
| **06** (mesma pasta) | Caixa estreita, peso médio, sem sublinhado | mesmas palavras · texto novo do teste · texto mais curto |
| **05 inglês** (`yougela-en/originais/05-1690340855780761-0.mp4`) | Vermelho com sombra na letra, degradê forte | mesmas palavras · texto novo · texto mais longo |
| **Adele Wu** (controle) | Texto solto sobre a cena | Só a saída da medição: `verdict.box = false`, `no_box`. Não apaga nada |
**O que o Gusta vê, nesta ordem:**
1. Cada vídeo com **as mesmas palavras**, sozinho e depois lado a lado com o original. É o teste mais duro.
2. Cada vídeo com **as palavras novas**, antes | depois, até logo depois do corte da headline.
3. O 02 com a **placa parada ao lado da versão por quadro** (`02-depois-B.mp4` do teste de 04/11).
4. Um cartão por vídeo com a fonte escolhida, o resultado da régua e o tempo gasto.

**Aprovado quando o Gusta diz, vendo:**
- **Só as palavras mudaram:** fonte (ou tão perto que não incomode), peso, tamanho, cor, sublinhado, sombra, posição e alinhamento iguais.
- **Sem marca do texto antigo** em nenhum quadro.
- A headline **some no mesmo quadro** do original.
- O texto mais longo ainda parece do criativo.
- 3 de 3 passam = código liberado. 2 de 3 = corrige e mostra de novo. Reprovou a placa parada = o `box` espera a S1 e a §14.2 é revista. Reprovou por fonte = amplia o catálogo e repete.
Depois do código há um 2º portão: 1 lote real no produto (~US$ 0,30, com ok), porque o "sim" na sonda é provisório.

### 14.8 Pro Gusta **[respondido: 1 pela §14.y; 2 pela §14.x.2]**
1. **Texto solto sobre a cena:** enquanto a S2 não responde, a `HEADLINE` segue com a placa (e o aviso) ou deixa de ser oferecida? Placa não é "copiar" e acrescenta uma tarja que não existia. **Recomendo manter, com aviso**, para não perder a peça em 5 de 25 campeões do banco local (há fixtures repetidas nessa conta).
2. **Fonte longe demais (`far`):** não oferecer a peça (recomendado), ou gerar com a mais próxima e avisar?

### 14.9 Custo por vídeo (ESTIMATIVA) **[`box` sem a função; atualizado em §15.10]**
| item | US$ |
|---|---|
| Medida, 1 vez por campeão | ~0 (0,7-2,8 s no Mac; na Lambda < 0,001) |
| Prova do original, 1 still, 1 vez por campeão | ≤ 0,002 |
| Texto pela IA, por headline | ~0,002 (`headline-e-legenda` §3.3) |
| Render `remix-keep` + composição, por peça | ~0,02 (idem, ainda a medir) |
| **Por peça** | **~US$ 0,02-0,03**; ~0,07 num campeão com 3 peças |
Contra crédito ≥ US$ 0,86. Sem custo de `hookmill-legenda`.

### 14.x Decisões do Gusta sobre o F1b (05/11)
1. ~~**Texto solto sobre a cena, até a S2:** mantém a placa de hoje, com aviso.~~ Substituída pela regra abaixo.
2. **Fonte `far`:** a peça não é oferecida. A regra é copiar a headline do criativo; gerar com fonte distante quebra a regra.

### 14.y Regra de produto do Gusta (05/11, vale sobre §2.4, §4 e §14.x.1)
**Nada cobre legenda ou headline original.** Sempre que um texto queimado atrapalhar, ele é apagado e refeito, com os recursos da esteira-spy: apagar local (máscara + TELEA) e redesenhar o texto; regeneração paga do clipe (Seedance video-edit ou Kling) quando o local não servir. "Gerar mesmo assim" e o selo "Cobre a legenda" saem do produto. Em aberto até a S2: o caminho quando o apagar local deixar borrão, e quem paga a regeneração. ~~regeneração paga do clipe (Seedance video-edit ou Kling) quando o local não servir~~ **[SUBST. §14.z: não oferece, sem IA paga]**. A §2.4, a §4 e a queda na proteção de hoje foram revistas na §15.

### 14.z Decisão do Gusta sobre a falha do apagar (05/11, S2)
Vídeo em que o apagar local não passa nos portões: **a peça não é oferecida**. Sem regeneração paga (Seedance/Kling) e sem caixa cobrindo. O veredito visual do E2 (`s2-resumo.mp4`) ainda está pendente.

### 14.w Veredito da S2 (05/11)
O Gusta aprovou E2 + W1 vendo `s2-resumo.mp4` ("FICOU LEGAL"). Portão da §10 aberto para esse caminho, limitado a pessoa falando, fundo desfocado e sem mão na faixa. O resto não é oferecido (§14.z). Caixa (W3) fora, pela §14.y.

### 14.v Headline aprovada (05/11)
Padrão aprovado pelo Gusta: `research_notes/headline-refeita-2026-11-05/` (texto solto, molde `tiktok-followcatch`, E: máscara + TELEA; redesenho medido). Sem tarja. **O emoji do original é mantido.** Pendências no relatório da peça: medição automática, solto × caixa pelo pixel, fontes do macOS no servidor, pré-processo antes do Remotion, portão (reprovado = não oferece). O §14 precisa ser revisto: texto solto deixa de ser placa.

---

## 15. F0 fechado (2026-11-05): nada cobre, tudo é apagado e refeito
Dono: maquina-arquiteto. Status: **fechado em documento. Sem código até o ok do Gusta.** Vale sobre todas as seções acima e sobre os contratos citados na §15.3.
Evidência nova desta rodada, custo US$ 0, sem AWS: `research_notes/troca-texto-f0-2026-11-05/` (`scripts/`, `fontes.json`, `fontes-folha.png`, `emoji.json`, `emoji-recorte.png`, `portoes.json`, `oferta-com-guarda.json`). O banco local foi lido só com SELECT e com o `legenda-plano-dryrun.ts`, que é só leitura. **Banco local, com fixtures repetidas: as contagens são ordem de grandeza, não produção.**

### 15.0 Resumo
1. **Ordem:** primeiro corta o que cobre (F1a), depois entra o motor. Do F1a em diante nenhuma tarja é gerada, mesmo sem motor.
2. **Saída durante a transição, medida:** com a guarda ligada, os 22 campeões locais com legenda ficam com 7 a 15 molduras oferecidas (média 11,2), nenhum com zero. Sobram também "enviar versão sem legenda" e outro template.
3. **Surpresa:** o maior caminho de cobertura não é o botão. Desde 02/11, **todo lote de template** com legenda queimada desliga a guarda e marca `captionOverride` sozinho (`plano-auto.service.ts:150-151,276`). Das 24 peças locais com a marca, 23 estão em lote lançado. A regra de 05/11 revoga a decisão de 02/11, e isso muda o resultado de lotes de template para quase todo campeão.
4. **Headline:** a medida passa a ser uma só, em Python, para solto e caixa. Solto usa o molde `tiktok-followcatch`; caixa, o `cp108`. O pixel decide qual dos dois.
5. **Fontes e emoji:** a peça aprovada usa Helvetica Neue e Apple Color Emoji, que não vão para o servidor. Proposta: Arimo 600 (OFL), cos 0,874 contra 0,899 da Helvetica, e **o emoji recortado do próprio quadro**, sem fonte. É outra peça: **o Gusta precisa ver (S4).**
6. **Legenda:** E2 + W1 em 4 execuções. Tempo: 37-66 s em 30 s (passa); 127,8 s em 128 s (passa de 2 min por 8 s; balanceado, a conta dá ~100 s, a medir).
7. **Risco central:** os portões, lidos ao pé da letra por vídeo inteiro, **reprovam os 4 vídeos** que o Gusta viu inteiros e achou bons. As medidas separam trecho bom de trecho ruim, mas ainda não dizem se a peça sai (§15.6.1, pergunta 1).

### 15.1 Regras do Gusta (05/11), não relaxar
| # | regra | fonte |
|---|---|---|
| 1 | Nada cobre legenda ou headline original. O texto antigo é apagado e refeito. Sem tarja, sem caixa nova, sem "Gerar mesmo assim", sem o selo "Cobre a legenda" | log 05/11, §14.y |
| 2 | "COPIA O FLUXO 100% QUE O /esteira-spy faz". Solta = `tiktok-followcatch`; caixa ou faixa = `cp108`. "analisar como esta a headline, e copiar a do criativo somente mudando as palavras". Peça aprovada: `research_notes/headline-refeita-2026-11-05/headline-refeita.mp4`. **O emoji do original fica** | §14.v |
| 3 | Legenda: E2 + W1, aprovada também na AWS ("ficou bem"), com portão: pessoa falando, fundo desfocado, sem mão na faixa | §14.w, log |
| 4 | Portão reprovado ou fonte distante: **a peça não é oferecida.** Sem IA paga | §14.z, §14.x.2 |
| 5 | 4 execuções por vídeo. Aceita 1-2 min a mais na primeira vez, com a placa guardada por campeão | Pedido do Gusta nesta rodada. No log, as 4 execuções ainda constam como "sem confirmação explícita" |
| — | Edição = 1 crédito. **Recomendação do arquiteto, NÃO CONFIRMADA pelo Gusta** (sem objeção até agora) | §9 |
| — | Tradução e gancho novo na legenda: **pendentes do Gusta, fora da 1ª entrega** | §13.4-5 |

### 15.2 Mapa do que foi substituído
| item antigo | agora |
|---|---|
| §0.3, §2.4 resgate | Fica automático (regra de 05/11; §13.3 respondida), só em F2 e só com as mesmas palavras |
| `overlay` / versão N (§2.1, §12.5) | **Sai.** Escreve por cima do texto original e vaza 2,3-8,1 % da letra antiga: é cobrir |
| `box` | Fica, §15.5 |
| `erase` com TELEA em legenda | Sai (E1 reprovado na S2). Legenda = E2. Headline solta = TELEA, porque foi o que o Gusta aprovou (§15.5.3) |
| W3 (caixa atrás da legenda) e E0 | Sai, §14.w. A recomendação do README da S2 foi rejeitada |
| Queda "na proteção de hoje" (§4, §6.2, §12.3) | Sai como cobertura. `avoid` (desviar sem tocar em nada) continua primeiro |
| `caption-swap`, `translateCaption`, seletor de idioma (§2.3, §5.2, antigo F2) | Fora da 1ª entrega, pendente do Gusta |
| Regeneração paga (§14.y) | Sai, §14.z |
| §12.6 `CAPTION_SWAP_IMPL` | Vira `PLATE_IMPL=off\|local\|lambda` (padrão off), §15.8 |
| §13: 1 e 2 feitas; 3 automático; 4 e 5 pendentes; 6 não confirmada; 7 | A S1 leu cota de 1000 execuções (§3.3 dizia 10). Pedido de memória: não verifiquei |

### 15.3 Caminhos antigos a retirar
**Lidos no código de 05/11, que tem F-U2 sem commit. O dono confere a linha antes de mexer.**
| caminho | onde | destino | fase |
|---|---|---|---|
| `POST`/`DELETE /iterate/:id/caption-blocked/force`, `forceCaptionBlocked`, `unforceCaptionBlocked` | `iteracao.controller.ts:84-94`, `iteracao.service.ts:472-600`, `iteracao.dto.ts:49` | Respondem **410 `CAPTION_FORCE_RETIRED`** por uma versão, depois saem | F1a |
| `captionOverride` ao criar peça: lote de template e forçada | `plano-auto.service.ts:276`, `iteracao.service.ts:567` | Para de gravar. Lote de template volta a ter guarda: apaga `if (tpl) ctx.caption = null` (`:152`) e o fit `soft` volta | F1a |
| `captionOverride` ao ler: render, validação, prévia, checagem | `edicao.service.ts:758-761,947-948`, `editor-export.service.ts:141`, `iteracao.service.ts:119,611,655-656`, `iteracao.views.ts:247`, `template.ts:153`, `lista-plano.ts:245`, `edicao.service.ts:1026` | **Nenhum caminho de render ou de validação lê mais o campo.** `semLegendaQueimada` só com `cleanVideoFileId`. `CAPTION_COVERED` passa a valer sempre | F1a |
| Lote de template sem guarda em `pecas`/plano: `templateSettingsOf` que zera `ctx.caption` | `iteracao.service.ts:611,655-656` | Sai | F1a |
| `captionBlocked[].forced`, `withForced`, contagem `forced` da estimativa | `contratos/src/iteracao.ts:190`, `iteracao.views.ts:93-98,339-347` | Sai. `captionBlocked` fica: lista o que não foi oferecido | F1a |
| `IteratePiece.captionOverride`, `captionOverrideOf` | `contratos/src/iteracao.ts:250`, `pecas.ts:367-369`, `pecas.service.ts:228-229` | Sai da resposta. `captionOverrideOf` fica só para o filtro da §15.3.1 | F1a |
| `settings.captionCandidates`, `AUTO_PLAN input.captionForce`, `readyEmpty` com candidata | `plano-auto.service.ts:54,194,248-249,386` | Para de gravar; JSON antigo é ignorado | F1a |
| `insight.captionNote` ("funciona melhor sem legenda") | `plano-auto.service.ts:151,165`, `run-screen.tsx:473` | Para de gravar; web para de mostrar | F1a |
| Web: "Generate anyway", "Undo", selo, frase de ajuda, faixa do Run | `captions.tsx:148-248,338`, `run-screen.tsx:447-517`, `client.ts:359-361`, `sample.tsx:232`, mocks, `messages/*`: `force`, `unforce`, `forcedTag`, `blockedOr`, `anyway` | Sai. Fica: enviar versão sem legenda, outro template | F1a |
| Placa do HEADLINE (`copy: 'plate'`, `spec.plateColor`, ramo "placa sobre o vídeo", `sobreVideo` no plano, F11, H1) | `render/headline.ts:176-189`, `headline-plano.ts:78-83` | Build lança `HEADLINE_PENDING`; plano bloqueia | F1a |
| `HEADLINE` `replace` em caixa com a medida atual | `render/headline.ts:172-175` | Fica desligado até o F1b: com a medida atual, o 02 teria faixa 73 s a mais e o 06 troca o CTA em vez do gancho (§14.1). Isso **é** tarja nova | F1a |
| `HEADLINE_NO_ROOM` | `render/headline.ts:214,228`, `legenda-protegida.ts:148`, `edicao.service.ts:74-101`, `messages` | **No `replace`, sai:** texto no mesmo lugar não tem por que procurar espaço, e a colisão vira `headline_near_caption` antes de gerar. **No `add`, fica:** faixa nova sem lugar não sai, e isso não cobre nada. Mensagem fica para histórico | F1a e F1b |
| Último recurso: `0,95…0,65 × cabe` e `contain`, e "faixa de cor" | `enquadramentosPreservandoLegenda`, `legendaProtegida.ts:283-325` | **Retirar quando o `swap` existir (F2).** Até lá não cobre nada e segura formatos. Pergunta 3 | F2 |
| `captionMode: 'replace'` (recortar e legendar; `forcar`, `forced_replace`) | `legendaProtegida.ts:242-276,361-381`, `headline.ts` | Sai no F2, trocado por `swap`. Até lá só em retry antigo, e não cobre | F2 |
| Avisos: `Covers the captions`, `A new plate covers…` (nunca implementado), "Closest font" quando `far` | contratos e web | Sai ou nunca entra | F1a |
| Docs: `legenda-protegida-v1` §2.1 e §8, `templates-creditos-v1` §6 (`soft`), `headline-e-legenda-v1` §1.3, decisão 02/11 | `docs/contratos/` | Marcados como revogados nesta rodada. `api.md` recebe nota; a mudança real entra com os tipos | F0 |
| Testes | `legenda-forcar.int.spec.ts`, `templates-lote.spec.ts`, `lista-plano.spec.ts`, `legenda-protegida.spec.ts`, `headline.spec.ts`, `testes/specs/iterate*/rev-2610.spec.ts` | Reescrever: passam a provar que **não** cobre | F1a |

#### 15.3.1 Efeito no que já existe (sem migração, sem reembolso retroativo)
Banco local, para dar tamanho: 24 itens com `captionOverride`, 23 em lote lançado e 1 em `PLAN_READY`; 20 FRAME, 3 HEADLINE e 1 CHAT_DM. Em HEADLINE: 8 `replace`, 6 `add`. `CAPTION_COVERED` em 3 renders.
| estado | o que acontece |
|---|---|
| Peça pronta com cobertura | **O arquivo continua, baixa como sempre, sem reembolso e sem refazer.** Só some o selo. Quem quiser pode gerar de novo pelo caminho novo |
| Peça pronta com placa de HEADLINE | Idem |
| Pedir 4:5 ou 1:1 dessa peça | Build sem cobertura: passa no `avoid` ou falha com `CAPTION_PROTECTED`. 4:5 e 1:1 não cobram |
| Retry de peça falha com a marca | Mesmo build: nasce sem cobertura ou fica `failed`; crédito por T4 |
| Editor em peça antiga | Export passa a rodar a checagem de legenda: `caption_cut`/`CAPTION_COVERED` bloqueiam. HEADLINE com placa: `editor.available: false`, `headline_plate_retired` |
| Item com a marca em `PLAN_READY` | No lançamento, `captionOverrideOf` tira do lote e não reserva crédito. No Plan, não aparece |
| Render na fila ou rodando | Fila: o build novo decide. Rodando: termina, e a checagem de visão reprova se cobriu, devolvendo pela T4. Sem kill |
| Lote lançado com formato "forçável" | O botão some. A lista `captionBlocked` antiga continua legível; `forced` ignorado |

### 15.4 Ordem que nunca volta a gerar tarja nem deixa sem saída
| etapa | moldura, corte, lista com legenda | HEADLINE com headline solta (6 de 21 locais) | HEADLINE em caixa (15 de 21) | HEADLINE `add` | saída se não couber |
|---|---|---|---|---|---|
| Hoje | Lote de template cobre sem perguntar; lote normal tem botão | Placa opaca | Faixa com medida errada | Faixa da marca | "Gerar mesmo assim" |
| **F1a** | Só `avoid`. Bloqueado = `burned_captions` | Não oferecido, `headline_pending` | Não oferecido, `headline_pending` | Igual | Versão sem legenda, outra moldura, outro template |
| **F1b** | Igual | Motor solto, atrás de portões | Motor caixa, atrás de portões | Igual | + `HEADLINE` onde passar |
| **F2** | `avoid` → `swap` com as mesmas palavras → não oferecido | Igual | Igual | Igual | + formatos resgatados |

**Regras da ordem:**
- **Deploy do F1a:** web primeiro (some o botão), API logo depois. Se alguém estiver com a tela antiga, o 410 vira toast comum. Nada de flag: se a regra é "nunca", não há por que manter o caminho ligável.
- **Motor sem pronto nunca abre sozinho:** `PLATE_IMPL=off` em produção mantém o estado do F1a. Ligar é por workspace interno, depois de S4, G0 e G1 (headline, **SUBST. §16.8**) e S1b e S3 (legenda).
- **Falha de motor = estado do F1a**, nunca cobertura. Função fora do ar: `headline_pending` e `burned_captions`, sem peça cobrada.
- **Tamanho da perda no F1a (local):** `HEADLINE` hoje oferecido em 21 de 25 campeões cai para os que não têm headline (`add`; 5 de 26 mapas) até o F1b. Molduras: em média 4,5 bloqueadas por campeão, mínimo de 7 oferecidas. `NATIVE_SEARCH` bloqueado nos 22 com legenda, e `PERSON_MOTION` em 1 (`oferta-com-guarda.json`). Pack continua `ok` se algum couber. **Template único de moldura bloqueada passa a mostrar a faixa `soft`,** o que é o maior efeito visível para quem usa.
- **Textos novos:** `headline_pending` = "This video's headline can't be rewritten yet" + as saídas. Nunca prometer data.

### 15.5 Headline
#### 15.5.1 Uma medida só, em Python
Revê §14.0.1 e §14.1.1. A esteira mede em Python, e agora a função existe e foi testada. Duas implementações (TS para caixa, Python para solto) divergiriam. Nova op `medir_headline` na `hookmill-legenda`, chamada pela API depois da leitura, ou sob demanda no campeão antigo. Sem função: `not_measured` → não oferecido. O `refinar` de `etapas.ts` não muda para a headline.
#### 15.5.2 Alvo, intervalo e solto × caixa, pelo pixel
**Alvo.** A primeira camada no tempo, `kind: headline`, ou `text` no terço superior a 70 % da altura, e **não** a maior. Conserta o 06 (§14.1). A visão só diz onde olhar.
**Intervalo** (molde `medir()`):
1. Semente: `[startVisão + 0,5 s, + 2 s]`, nunca o meio do intervalo. Conserta o 02: a referência caía depois do corte.
2. Molde: pixels claros em todos os quadros da semente; `ROI` = caixa da visão + 12 % em volta, sem entrar na faixa da legenda.
3. Anda para os dois lados enquanto a cobertura do molde for > 80 %, quadro a quadro. Corte exato.
4. Saída em `[startFrame, endFrame)`, a mesma convenção do `editMap`. **No caso do print:** a leitura diz 159, o pixel diz 161 (último quadro com texto = 160; `conferir.py`: primeiro quadro sem mudança real = 161). A causa é `etapas.ts`: a camada com `background.kind === 'none'` faz `continue` antes de `presencas`, então `source` fica `vision`. Com a medida nova, 2 quadros de texto antigo deixam de sobrar.
5. Fim em menos de 3 quadros de transição, senão `fades`. Molde fraco, `not_measured`.

**Solto × caixa**, sobre a mediana do intervalo, no anel de 7 px em volta das letras. O `background.kind` da visão não decide:
| medida | caixa (`cp108`) | solto (`followcatch`) | evidência |
|---|---|---|---|
| Desvio temporal p99 no anel | ≤ 11 opaca (teto do `cp108`); 11-40 translúcida | > 40 | 05 = 3,7; 06 = 3,3; 02 = 17,7; sem caixa = 93,7; **aprovada = 70,6** |
| Região chapada, contorno fechado em volta do texto | sim, área ≤ 2,5× o bloco e ≤ 40 % do quadro | não | tira os falsos positivos de `snapinsta` e `v1-outra` (§14.3) |
| Nem chapada nem mexendo (cena parada) | — | Solto, e os portões decidem | Sem exemplo medido |
**[SUBST. §16.4: aceita até 25, 25-40 não oferece]** **Caixa translúcida (11-40, o 02):** fora até o Gusta ver na S4. O `cp108` só mediu caixa estática (diferença ≤ 11 níveis, medida um pouco diferente deste p99). Se ele aceitar a imagem parada, entra; senão, não oferece.

#### 15.5.3 Pintura
| | solto (`followcatch`) | caixa (`cp108`) |
|---|---|---|
| Limpar | `cv2.inpaint` TELEA raio 5, só nos quadros do intervalo. Máscara = letras (`min > BRILHO`) + letras antigas redesenhadas + retângulo do emoji, dilatada em `round(17 × W / 1080)` px, ímpar (7 a 464 px; 17 a 1080 px) | Sem apagar: a imagem 2D da caixa (§14.2) repinta exatamente os pixels da caixa original |
| Saída | **Placa em vídeo**, `kind: HEADLINE`, 4 execuções + juntar | Data URI ≤ 4 KB, sem arquivo. `plate.image` no `remix-keep` |
| Texto | Remotion | Remotion |
| Fora do trecho | Só recodificado | Quadro do campeão |
**Texto sempre no Remotion** (§12.1 segue): Player, editor e Lambda desenham igual. A peça aprovada foi em Pillow; **isso não foi comparado** e entra na S4. Texto claro primeiro: letra escura sobre cena clara dá `text_not_light`, não oferecido.
**Parâmetros medidos, molde `calibrar`:** corpo pela largura da 1ª linha antiga; linha de base; entrelinha; centro por linha; sombra (sigma, dx, dy, opacidade), buscando o menor erro em volta das letras. Na aprovada: corpo 26,75 a 464 px, base 557, entrelinha 33,25, sombra `(1,3; 0; 1; 0,4)`.

#### 15.5.4 Legenda não entra na máscara
Na aprovada, a legenda começa 14 px abaixo da máscara no pior quadro (p50 18), e a diferença em `y ≥ 600` ficou em média 1,19 nível.
1. Candidato a letra precisa estar claro **em todo o intervalo**. Legenda muda de página, então cai fora.
2. `ROI` nunca cruza a envoltória de `protectedBands`.
3. **Folga, quadro a quadro:** do pixel dilatado à legenda ≥ raio + 2 px, escalado (7 px a 464; 16 px a 1080). O TELEA puxa cor da vizinhança, e letra perto mancha o buraco. Menos que isso = `headline_near_caption`, não oferecido.
4. Sem `captionTrack`, a banda vem de `protectedBands`, com a folga vertical de `faixasProtegidasDe`.
5. **Prova depois da placa:** diferença na banda da legenda ≤ 1,5 nível de média e ≤ 2 no pior quadro (aprovada: 1,19 e 1,48), e a legenda continua lá.
6. O `HEADLINE` não mexe na legenda. Não há placa combinada na 1ª entrega.
7. A isenção de `protectedBands` da §14.3 passa a valer para solto e caixa, porque **nenhum dos dois pinta fora do texto antigo mais o texto novo**, e o texto novo nunca cruza a banda.

#### 15.5.5 Portões
| portão | medida | valor inicial | razão → `allowed` |
|---|---|---|---|
| Medido | semente, molde | existem | `not_measured` → `headline_low_confidence` |
| Parado | caixa do molde no início, meio e fim | ≤ 1 % do quadro | `box_moves` → `headline_moves` |
| Corte | entrada e saída | ≤ 3 quadros | `fades` → `headline_moves` |
| Texto muda dentro | dentro do molde, trechos com cobertura < 80 % | nenhum | `text_changes` → `headline_moves` |
| Rosto | máscara dilatada cruza `faceTrack.main` | > 10 % dos quadros = fora. TELEA deixa polígono em pele (S2) | `headline_over_face` |
| Legenda | §15.5.4.3 | ≥ raio + 2 | `headline_near_caption` (novo) |
| Letra clara, só no solto | luminância do molde | ≥ 200 (molde) | `text_not_light` → `headline_low_confidence` |
| Fonte | §14.1.2, com a régua da §15.7 | não `far` | `font_far` → `headline_font_far` |
| Emoji | §15.7.2 | recorte serve | `emoji_unsupported` → `headline_low_confidence` |
| Placa, solto, depois de gerar | mesmas medidas da legenda, §15.6.1 | calibrar na S4 | `plate_rejected`, peça sai do plano |
**O portão do rosto não vale para a caixa** (07/11, Q1-B1): só o solto apaga por inpaint; a caixa é placa medida e o vulto atrás dela é aceito (§16.4). Na caixa, `rosto_frac` fica só como medida. *(video; o arquiteto confere.)*
Só um vídeo testado no solto: **os valores são iniciais e o olho do Gusta aprova.**

#### 15.5.6 Texto
**[Ampliado por §16.3: exposição, queixo e laço]** A escada da §14.4 vale para os dois, com a função renomeada `ajustarHeadlineCopia(look, texto)`. No solto, o degrau 3 não muda caixa: acrescenta uma linha, sem cruzar rosto nem banda. Texto mais curto não aumenta a letra. Emoji conta na largura da linha dele.
IA: a headline vem **sem emoji** (`validatePlan` tira e repara). O emoji é da peça, não do texto.

#### 15.5.7 Conferência (`conferir.py` vira op da função e prova do QA)
| prova | valor | aprovada |
|---|---|---|
| Nº de quadros, áudio | iguais; md5 do áudio igual | 564 = 564, igual |
| Fora da máscara, no trecho | média ≤ 1,5; pior ≤ 2 | 0,99; 1,20 |
| Fora do trecho | média ≤ 1,5; pior ≤ 2 | 0,82; 1,36 |
| Banda da legenda | §15.5.4.5 | 1,19; 1,48 |
| Primeiro quadro sem mudança | `== endFrame` | 161 |
| **[SUBST. §16.2 A2: mede na placa]** Fantasma: alto-passa nas letras antigas fora do texto novo | \|x\| ≤ 10 níveis, original ≥ 40 | 78,7 → -6,5 |
Caixa: `conferir.py` do `cp108`: faixa contra o desenho (lá 0,75), resto ≤ 1 nível (lá 0,50), áudio igual. **[Limites: §16.2]**

### 15.6 Legenda: 1ª entrega = mesmas palavras, E2 + W1
Lidas as palavras por trecho (§5.1), tempo pela transcrição. Sem tradução, sem gancho.
#### 15.6.1 Portões, em 2 tempos
**Antes da placa, em `detectar`, na leitura:**
| portão | medida | valor inicial | evidência | razão |
|---|---|---|---|---|
| Detectou | quadros com fala cobertos | ≥ 80 % | §4 | `not_detected` |
| Contorno | letra clara com contorno escuro a ≤ 6 px | sim | **A legenda branca sem contorno do print não é detectada.** Esse caso fica fora | `no_outline` |
| Fonte | IoU mediano | ≥ 0,6 | Aprovados 0,685; 0,773; 0,764. **120 s: 0,482, reprova** | `font_mismatch` |
| Estilo estável | corpo em 3 terços do vídeo | variação ≤ 5 % | Criado para o 120; não medido | `style_unstable` |
| Pessoa falando | rosto `main` nos quadros com legenda; fala nesses quadros | ≥ 90 %; ≥ 80 % | Não medido; S3 | `no_person` |
| Fundo desfocado | Laplaciano no anel, por janela de 0,5 s | ≤ 60 | Bom 36-49; ruim 73-82 (igreja, partículas). 4 vídeos | `busy_background` |
| Linhas | legenda de 1 linha | 1 | 2 linhas sem teste (S2) | `multi_line` |
| Animação | variação de largura e altura no trecho | ≤ 8 % | §4 | `animated` |
| Alfabeto | CJK, RTL | fora | §4 | `script_unsupported` |
| Emoji na legenda | detectado na visão | fora | Sem teste | `caption_emoji` |
| Duração | do vídeo | ≤ 60 s, até a S1b; depois ≤ 130 s | §15.6.3 | `too_long` |
**`over_face` (§4) sai da legenda:** o 13 tem legenda em queixo e boca, e foi aprovado. O que importa é a pele manchar, e isso se mede na placa.

**Depois da placa, antes de oferecer** (`portoes.json`: janelas de 0,5 s, com buraco por diferença original × placa, nos 4 vídeos):
| medida | bom | ruim | valor de janela | o que pega |
|---|---|---|---|---|
| `lisura` = Laplaciano no preenchido ÷ no anel | 0,70-0,88 | 0,33-0,37 | < 0,5 = ruim | Borrão em igreja e partículas |
| `trem` = variação quadro a quadro no buraco | 1,1-2,6 | 4,1-8,2 | > 3,5 = ruim | Mão, rastro |
| `degrau` = diferença de tom na borda do buraco | 1,2-1,8 | 1,9-4,2 | > 3 = ruim | Mancha. **Pele do 02 (t=19) mede 1,97: não pega, sobra para o olho** |
| Letra detectável, p95 | 0,0-0,3 % | — | > 0,5 % | Fantasma |
| Fora do buraco | — | — | média > 1,5 nível | Cor deslocada |
| Quadros | iguais | — | diferente | Pedaço perdido |
| Salto na emenda | — | S1: 39,7-41 dB contra 46-58 | Calibrar | Pulo entre pedaços |
**A área à vista (§1, §6.1) não é portão.** Ela mede 31-40 % no E2 + W1 aprovado.

**Isto separa trecho, não vídeo.** Com esses valores, **a fração de janelas ruins fica em 43 %, 40 %, 58 % e 58 % (13, 02, 05, 120)**. Há ruído: corte de cena entra em `trem`, e nada disso foi limpo. E as condições do Gusta caem em todos os 4: igreja no 13 (t=0-6), mão no 02 (t=0-2), partículas no 05 (t=25-30), mão no 120 (t=58, 67). **Ele viu os 4 inteiros e disse "ficou bem".** Sem tolerância, nenhum sai. Ver pergunta 1.
**Regra provisória, enquanto a S3 não fecha:** reprova com trecho ruim ≥ 1 s nos 3 primeiros segundos (o gancho) ou > 20 % da duração, medindo só em tomadas com legenda e sem as janelas com corte. **Não apliquei essa regra nos 4 vídeos: exige a limpeza de corte, que a S3 faz.** Lote interno só.

#### 15.6.2 Tempos
| medida, 3008 MB, arm64 | meta antiga | **meta nova** | medido na S1 | estado |
|---|---|---|---|---|
| `detectar` + estilo, 30 s | ≤ 30 s | ≤ 60 s, junto da leitura, sem espera nova | 35-55 s | passa |
| `detectar` + estilo, 120 s | ≤ 60 s | ≤ 120 s, com `captionBox` obrigatório | 81 s com dica; **283 s sem dica** | passa com dica |
| Ajuste | < 5 s | ≤ 20 s | 10,8-15,5 s | passa |
| Placa, 30 s, 4 execuções + juntar | ≤ 60 s | ≤ 90 s | 37-66 s | passa |
| Placa, 128 s, 4 execuções + juntar | ≤ 120 s | **≤ 120 s** (regra 5) | **127,8 s**; balanceado ~100 s, conta | falta medir (S1b) |
| RSS por execução | ≤ 1 GB | ≤ 1,5 GB, alerta a 2,4 GB | 0,57-0,91 GB (REPORT chega a 1,7 GB com ambiente reaproveitado) | passa |
| Custo, 30 s | 0,004-0,008 | ≤ US$ 0,012 | 0,0067-0,0093 | passa |
| Custo, 120 s | 0,015-0,03 | ≤ US$ 0,03 | 0,0185 | passa |
| Peças seguintes | — | 0 s de placa | guardada | — |
Em vez de "1ª peça ≤ 60 s": a espera é **no plano**, §15.6.5. O render segue à parte.

#### 15.6.3 O vídeo de 120 s
**Tamanho errado:** corpo 53 × 48, tracking 0,02 × 0,05, espaço 1,0 × 1,6, traço 3 × 4, contra o 02, que tem a mesma legenda; IoU 0,482. Texto também adiantado uma palavra em relação ao original (`quadros/w1-120.png`, t=10). Causa não sabida: 2 pessoas, tela final, Whisper local ou faixa dada à mão.
1. **Já não sai:** o portão de IoU reprova.
2. **Teto de 60 s até provar.** Dá 17 dos 29 campeões locais com duração conhecida.
3. **S1b repete** com a transcrição da leitura, o `fontId` da visão, `captionBox` real e sem a tela final (só quadros com rosto). Passa com corpo ± 2 % do 02 e IoU ≥ 0,6. Passou: teto de 130 s.
4. **Acima de 130 s, não oferece.** São 6 campeões locais de 120-180 s, e a conta de tempo não fecha. Sem medida, sem promessa.

**Conferência em movimento.** Medido só em quadro parado até a S1. Agora há `trem` e `salto`, mas **o Gusta é o portão do movimento:** na S3 ele vê os vídeos inteiros e marca sim ou não. Número só impede regressão depois disso.

#### 15.6.4 Execução
- **4 execuções sempre.** Vídeo curto demais para 4 pedaços de ≥ 2 s usa o que couber.
- **Pedaços balanceados pelo custo**, não pelo número de quadros. Cada `detectar` já devolve a pegada: peso de cada quadro = área do buraco × fator por tomada, com ajuste de calibração na S1b. Hoje, no 120: 57-122 s por pedaço, soma 388 s, ideal 97 s. No 05: 42-61 s, ideal 50 s. Corta em troca de tomada, se houver a ± 10 % do alvo; senão em troca de trecho.
- **Contexto de 60 quadros** de cada lado, sem atravessar corte. GOP fechado no início de cada pedaço. `juntar` = `-c copy` (1,4-1,9 s).
- **Função:** 3008 MB, arm64, efêmero 2048 MB, timeout **300 s** (a S1 usou 900; pedaço pior 122 s). Não depende do pedido de 10240 MB nem do de cota.
- **Só a faixa em memória; quadro inteiro relido por um 2º decodificador.** RSS 0,57-0,91 GB. Uma execução só chegava a 1,55 GB no 120.
- **Concorrência:** teto da aplicação `PLATE_MAX_CHUNKS=40`, para não disputar com o Remotion.
- **Erro em pedaço:** repete 1 vez. Falhou de novo: `plate_failed`, peça não oferecida. Sem fallback para VPS.
- **Fixo:** arm64, numpy 2.0.2, opencv-headless 5.0.0.93, pillow 11.3.0. **O DIS e o x264 não dão o mesmo resultado no Mac e na Lambda** (S1): o que vale é a Lambda, porque foi a versão que o Gusta viu. `PLATE_IMPL=local` é só para desenvolver, e nunca para decidir portão.
- **Otimização a medir na S1b:** as 2 máscaras (com e sem caixa) numa detecção só. O 02 pagou 54,9 s por detectar 2 vezes.

#### 15.6.5 No produto
- **Quando roda:** ao montar o plano, se o `allowed` precisa da placa. Espera no próprio plano, etapa `preparing_plate`, polling de `GET /iterate/:id`. **Antes do Gerar:** assim a reprovação depois da placa tira a peça sem reservar crédito. É a leitura honesta de "não é oferecida". Falha depois disso cai na T4.
- **Ordem em `decidirLegenda`:** `avoid` → `swap` → `blocked`. Não toca no que dá para não tocar.
- **Onde a legenda nova vai:** com o vídeo, mesma transformação `pinturaNaCaixa`. Se um elemento cobrir a legenda nova, ela sobe **só se a faixa antiga estiver coberta por elemento opaco ou fora do quadro** (`checarResiduo`, §2.2, usada só neste caso). Fora disso, não oferece. O apagado à vista sem texto em cima (W2) foi reprovado na S2.
- **Pausa de fala [SUBST. §16.2 A7: testado na S4, regra para o F2]:** o 02 mostra o apagado todo em t=17,7 (p95 = 100 %). Manter a página na tela até a próxima frase, como o original costuma fazer. **Não testado;** entra na S4.

#### 15.6.6 Cor
1. **Nunca `cv2.VideoCapture`.** Desloca 1-3 níveis no ida e volta (`montar.py`), e o amarelo do catálogo já saiu errado por isso (S1).
2. Decodificar: `scale=in_color_matrix=<origem>:in_range=<origem>:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24`.
3. Codificar: `out_color_matrix` e `out_range` iguais, e `-colorspace -color_primaries -color_trc -color_range` gravados. `cor_args` do S2 só faz isso para `bt709`, e não passa o `in_`.
4. **Origem `unknown`:** tenta `bt709`, mede fora do buraco; > 1,5 nível, tenta `smpte170m`; > 1,5 de novo, `color_shift`, não oferece. Sem chute silencioso.
5. Prova repetida na peça final, depois do Remotion: limite calibrado na S4, porque a composição recodifica.

### 15.7 Fontes e emoji no servidor
#### 15.7.1 Licenças, verificadas em 05/11
| arquivo | licença | conferido em | no servidor |
|---|---|---|---|
| Helvetica Neue | Texto do próprio arquivo: propriedade da Linotype, não pode ser reproduzida nem transferida sem aprovação por escrito. SLA do macOS Tahoe 26, §2.E: fontes para "display and print content while running the Apple Software" | `name` do `.ttc`; PDF do SLA | **Não** |
| Apple Color Emoji | © Apple Inc., todos os direitos reservados; mesmo SLA | `name` do `.ttc`; PDF do SLA | **Não** |
| Arimo, Inter, TikTok Sans, Montserrat, Roboto, Poppins, Gabarito, Manrope, Archivo, Albert Sans | **OFL-1.1.** Permite embutir em software; não pode vender só a fonte. Inter, Arimo e TikTok Sans: texto do `LICENSE` lido; Montserrat e Poppins: `LICENSE` em `node_modules`; demais: `license` do `package.json` `@fontsource` 5.3.0. TikTok Sans também no repositório oficial | `@fontsource/*` | **Sim** |
| Noto Color Emoji | OFL-1.1 (README do `googlefonts/noto-emoji`) | Repositório | Não usada na v1: desenho diferente do original |
**Não é parecer jurídico.** O caminho do emoji da §15.7.2 usa pixel do vídeo do próprio cliente; quem precisar de certeza sobre direitos de glifo em peça deve perguntar a advogado. **Avenir, Futura, Arial Black e Arial do sistema:** mesma regra, e o `leg.py` da S1 já as exclui. Cada arquivo novo entra com `LICENSE` em `video/public/fonts/licenses/`.

#### 15.7.2 Emoji: recorte do próprio quadro
1. A visão já devolve o emoji no `text` (`👀` no campeão do print).
2. **[Máscara SUBST. §16.2 A1: casco convexo por lóbulo]** Na medida: mediana do trecho na região à direita da linha; máscara = diferente do fundo do anel, fechada e preenchida; suaviza 0,7 px; PNG com alfa em data URI (mesmo mecanismo da placa).
3. **Medido na aprovada** (`emoji-recorte.png`): 432 px, sem diferença evidente lado a lado nos 5 quadros; PSNR 29,4 (mín. 28,7) na caixa toda, que inclui fundo em movimento. Só 1 vídeo e um emoji claro sobre fundo escuro.
4. **Tamanho e cor são os do original, sem medir nem escolher.** Vale para qualquer sistema em que o original foi feito.
5. **Posição:** no fim da linha dele, com o mesmo espaço medido. No começo da linha, idem.
6. **[Ampliado por §16.2 A1]** **`emoji_unsupported`, não oferece:** no meio da frase; se move ou anima; escuro sobre fundo escuro (máscara ocupando < 40 % ou > 95 % do retângulo; na aprovada, 71 %). **Regra 4.** Só emoji depende disso: não troca por Noto.
7. **Na caixa:** o emoji sai da imagem medida, junto com as letras, e entra recortado igual, por cima dela.

#### 15.7.3 Fonte
**Medido na aprovada, §14.1.2 aplicada à letra de lá, 23 abertas + a Helvetica, ajuste fino de corpo e posição:**
| fonte | cos | tinta rel. | olho (`fontes-folha.png`) |
|---|---|---|---|
| Helvetica Neue Medium (aprovada) | 0,899 | 1,215 | referência |
| **Arimo 600** | **0,874** | **1,229** | Muito perto. Desenho de Arial: "t", "G", "R" diferem de leve |
| Albert Sans 500 | 0,859 | 0,980 | Mais fina, "g" e "w" mudam |
| Inter 600 | 0,852 | 1,233 | Mais larga |
| TikTok Sans 400 | 0,843 | 0,913 | Mais fina |
| Inter 500 | 0,838 | 1,080 | |
**Recomendação:** catálogo aditivo além da §14.5: `arimo-400/500/600/700`, `tiktok-sans-400/500/600/700`, `inter-400`, `albert-sans-500`; para a legenda: `gabarito-700/900`, `manrope-800`, `poppins-700/900`, `archivo-*` na largura usada, `tiktok-sans-700`. **Conferido na S4:** Arimo 600 no Chrome dá 0,876 (§16.2 A3).
**[Método SUBST. §16.2 A3]** **Régua:** a da §14.1.2 foi calibrada na caixa, com máscara limpa. A letra solta vem do `min` de quadros, e a própria Helvetica dá 0,899. Corte inicial para o solto: `same` ≥ 0,85 e `close` ≥ 0,75, com o mesmo traço e as mesmas larguras. **Calibrado em 1 vídeo.** `far` = não oferecido.
**Proibido** `/System/Library` em código de produto: `grep` no QA, e a função só carrega arquivos da própria imagem.
**`close`:** continua com a marca "Closest font" (§14.1.2). O Gusta pode tirar a marca depois de ver; a regra não muda.

### 15.8 Banco, tipos, rotas, erros
**1 migração, aditiva**, depois de `20261110000100_editor_universal`, com `npm run db:migrate`:
```prisma
enum PlateKind { HEADLINE CAPTION }
enum PlateStatus { QUEUED RUNNING READY REJECTED FAILED }
model ChampionPlate {   // esboço; o F0b escreve com relações e índices
  id          String @id @default(cuid())
  workspaceId String
  championId  String
  kind PlateKind
  layerKey String     // HEADLINE: layerId; CAPTION: 'caption'
  version Int         // sobe quando muda o método; placa antiga não vale
  status PlateStatus
  fileId String?      // FileKind CHAMPION_PLATE
  reason String?      // razão do portão ou da falha
  metrics Json?       // conferência e tempos, sem pixel
  costUsd Decimal?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([championId, kind, layerKey, version])
}
// FileKind + CHAMPION_PLATE; JobType + CHAMPION_PLATE
```
Tabela no lugar das 2 colunas da §7, porque são 2 tipos, com resultado de reprovação que precisa ficar guardado para não reprocessar. **O `CHAMPION_CLEAN_VIDEO` não muda:** é o enviado pela pessoa. Com ele não há placa e não há portão.

**Tipos, `contratos/`, aditivos, escritos pelo arquiteto depois do ok:**
```ts
export type HeadlineCopyKind = 'box' | 'loose';
// HeadlineLook, §14.5, version: 2. Muda:
//  kind: HeadlineCopyKind;
//  plate: { color; image; temporalP99 } | null;   // só no box
//  plateRef: { kind: 'HEADLINE'; layerKey: string; version: number } | null;  // só no loose
//  emoji: { char: string; image: string; x: number; y: number; w: number; h: number; lineIndex: number; side: 'start' | 'end'; gapPx: number } | null;
//  text.lines, shadow e stroke como na §14.5.
//  verdict.reason ganha 'text_not_light' | 'emoji_unsupported' | 'near_caption' | 'plate_rejected' | 'plate_failed'.
// HeadlineBlocked ganha 'headline_pending' | 'headline_font_far' | 'headline_near_caption'.
// PieceHeadline.copy: 'box' | 'loose' | 'add' | null  (sem 'plate').
// CaptionTrack, §4: trechos e estilo seguem; veredito: { swap: boolean; reason: CaptionSwapReason | null; gates: Record<string, number> }.
export type CaptionSwapReason = 'not_detected' | 'no_outline' | 'font_mismatch' | 'style_unstable' | 'no_person' | 'busy_background'
  | 'multi_line' | 'animated' | 'script_unsupported' | 'caption_emoji' | 'too_long' | 'plate_rejected' | 'plate_failed' | 'color_shift';
// captionMode: 'avoid' | 'replace' (só até F2) | 'swap'; IteratePiece.captionNote: 'replaced' | 'swapped' | null.
// SAI: captionOverride, captionBlocked[].forced, ForceCaptionBlockedBody, AutoInsight.captionNote.
// FORA da 1ª entrega: AutoVariationType 'CAPTION_SWAP', translateCaption, idioma.
```
**Rotas:** nenhuma nova. Saem as 2 do `force` (§15.3). `GET /iterate/:id` ganha etapa `preparing_plate` **[forma em §16.5: item do `checklist`]**.
**Erros:** `410 CAPTION_FORCE_RETIRED`; `HEADLINE_PENDING` (peça); `CAPTION_RESIDUE`; `PLATE_FAILED`. `HEADLINE_NO_ROOM` só em `add`.
**Env:** `PLATE_IMPL=off|local|lambda`, `PLATE_LAMBDA_FUNCTION=hookmill-legenda`, `PLATE_LAMBDA_REGION`, `PLATE_MAX_CHUNKS=40`, `LEGENDA_MAX_SEC=60`.
**Base do render:** `RemixKeepRenderInput.baseVideoUrl` = placa (já existe), e a composição usa a placa, não o campeão. Conferir `comporSobreOCampeao`: a máscara hoje é só da caixa nova, e **fora dela voltaria o quadro com o texto antigo**. Item de teste do F1b. **[Com base = placa não volta. Bug da máscara e +Y: §16.7 e §16.2 A8]**

### 15.9 Fases e agentes **[F0b feito; S1b só no F2; F1b SUBST. §16.6; editor do §14.6 passo 4 vai para F3]**
**Pré-condição:** F-U2 está sem commit, inclusive em `render/headline.ts`, `RemixKeep.tsx`, `lib/remix.ts`, `legendaProtegida.ts`, `editor-export.service.ts`, `contratos/editor.ts`. **Sem commit não há como separar as frentes** (pergunta 2). Sem worktree com symlink de `node_modules`.
| fase | dono | entrega | pastas | depende |
|---|---|---|---|---|
| **S4** demonstração | video | **Sonda local, US$ 0, fora do produto.** A aprovada em placa TELEA + Remotion + Arimo 600 + emoji recortado, lado a lado com a aprovada; a mesma com texto mais longo e mais curto. Caixa: 05, 06 e 02 (mesmas palavras, novas, longa), incluindo 02 parada × por quadro. Legenda: W1 no Remotion × Pillow no 13, com sombra dura e karaokê; pausa de fala no 02. Usa o critério da §14.7 | `research_notes/` | ok do Gusta |
| **F0b** | arquiteto | Tipos, migração, `api.md`, `modelo-de-dados.md` | `contratos/`, `docs/`, `api/prisma/` | ok do Gusta |
| **F1a** corte | backend | Tudo da §15.3 em `iteracao/`, `edicao/`, `render/template.ts` só no campo; filtros da §15.3.1 | `api/src/iteracao`, `api/src/edicao` | F-U2 fechado, F0b (só a remoção) |
| F1a | video | `HEADLINE_PENDING` no ramo placa e no `replace` de caixa, `headline-plano.ts` com backend | `api/src/render/headline.ts` | idem |
| F1a | frontend | Saem botão, selo, textos; `headline_pending`; faixa `soft` sem "anyway" | `web/` | MSW |
| F1a | qa | Só o recorte: nenhum lote de template com legenda gera cobertura; 410; peça antiga baixa; 4:5 antiga não cobre | `testes/` | tudo acima |
| **S1b** | video | AWS, ~US$ 0,05, **com ok**, na `hookmill-legenda-s1`: balanceamento, 1 detecção, `fontId`, 120 s | `research_notes/` | ok do Gusta |
| **F1b** motor | video | `api/src/medicao/troca/` (porta TS, fake, Python, ops `medir_headline`, `placa_headline`, `juntar`, `conferir`), `scripts/legenda-lambda.mjs` a partir do `deploy.mjs` da S1, `ajustarHeadlineCopia`, `RemixKeep` (placa 2D, entrelinha, sombra, sublinhado, emoji, `lines`), fontes e tabelas, `buildHeadlineInput` | `video/`, `api/src/medicao/troca/`, `api/src/render/headline.ts`, `scripts/` | S4, F0b |
| F1b | backend | Job `CHAMPION_PLATE`, tabela, `headlineInfoOf` com `copy` e bloqueios novos, escolha do alvo, medida de campeão antigo, `preparing_plate`, custo | `api/src/iteracao/`, `api/src/campeoes/` | porta |
| F1b | ia | `describeEdit` com `\n`; plano com limites por linha; sem emoji no texto; fake | `api/src/integracoes/` | F0b |
| F1b | frontend | `copy`, "Closest font", degrau ao digitar, etapa, i18n | `web/` | F0b |
| F1b | qa | 02, 05, 06, aprovada, `snapinsta` + conferência da §15.5.7. **1 lote real no produto com ok (~US$ 0,30)**, Gusta vê | `testes/` | tudo |
| **S3** | qa + video | 20 campeões reais na função: portões + **Gusta marca sim ou não** em cada vídeo inteiro. ~US$ 0,20-0,40, **com ok** | `research_notes/` | S1b |
| **F2** legenda | video | Ops `detectar`, `placa_legenda`, `decidirLegenda` com `swap`, `checarResiduo`, sai último recurso, `replace` e `CAPTION_SWAP` não entra; Remotion com karaokê e sombra | `video/`, `api/src/medicao/troca/`, `legendaProtegida.ts` | S3, S4, F-U2 |
| F2 | backend | `captionTrack` na leitura, `allowed`, `fit`, plano com placa | `api/src/iteracao/` | porta |
| F2 | ia | `checkCaption` modo swap (`ghost`, `smear`) nos 6 piores quadros | `api/src/integracoes/` | F0b |
| F2 | frontend | `captionNote: 'swapped'` | `web/` | F0b |
| **F3** editor | video + backend + frontend | §8, sem `overlay` | `video/src/lib/editor/`, `api/src/edicao/` | F2, F-U2 |
| **Depois, pendente do Gusta** | ia + todos | Tradução, gancho novo, `caption-swap` | — | Decisão dele |
**Paralelo sem colisão:** F1a tudo junto, porque são pastas diferentes. Em F1b, `render/headline.ts` é de video e `headline-plano.ts` de backend, e a assinatura de `headlineInfoOf` fica no F0b. `legendaProtegida.ts` só em F2.
**Regra do time:** QA de cada fase só no recorte; suíte completa no fim.

### 15.10 Redeploy e custo
| o quê | quando | como |
|---|---|---|
| Web (Vercel) | F1a, F1b, F2 | `prebuild` copia as fontes novas de `ARQUIVOS_DE_FONTE` |
| API (EasyPanel) | F1a, F1b, F2 | Imagem nova. **Depois do web, no F1a** |
| Banco (Neon) | F0b, antes da API do F1b | `prisma migrate deploy`, backup antes |
| **Bundle Remotion + site na Lambda** | F1b, F2, F3 (fontes, `RemixKeep`, `remix.ts`, schema) | `npm run build:bundle -w video` e `deploySiteFromBundle`, novo `REMOTION_SERVE_URL`. **F1a não precisa** se não mudar `video/src`. `render-lambda-v1` cita `npm run lambda:deploy`, que **não achei em nenhum `package.json`**; só vi `deploySiteFromBundle` em `scripts/sonda-lambda-l1.mjs`. Conferir antes do 1º deploy |
| **Função `hookmill-legenda`, nova** | F1b, atualizada em F2 | `scripts/legenda-lambda.mjs`, perfil admin. Permissão de invocação para `hookmill-remotion-deploy`, logs 7 dias |
| `hookmill-leitura` | Só se mudar `api/src/medicao/leitura/`. F1b não deveria; `captionBox` obrigatório no F2 pode pedir | `scripts/leitura-lambda.mjs deploy` |
| `hookmill-legenda-s1` | **Fica até o Gusta mandar apagar** (~US$ 0,06/mês). Serve à S1b | `deploy.mjs apagar` |
| Env | F1b | §15.8. `PLATE_IMPL` ligado primeiro em workspace interno |

**Custo por campeão, 1 vez, dos REPORT da S1 × preço público (fatura não conferida):** placa de legenda US$ 0,007-0,009 em 30 s; 0,0185 em 128 s. Headline solta: **não medida**, em princípio menor, porque o trecho é menor. Caixa: ~0. Por peça, soma a checagem por visão (~US$ 0,008, estimativa). Contra crédito ≥ US$ 0,86. **Edição = 1 crédito, não confirmada.**

### 15.11 Riscos abertos
1. **Portão por vídeo sem calibrar:** 0 de 4 pela letra, contra "ficou bem" dele. Pergunta 1 e S3.
2. **Tudo na headline solta vem de 1 vídeo.** Máscara, régua, folga, emoji e proteção de legenda.
3. **A versão de servidor nunca foi vista:** Arimo no lugar de Helvetica, emoji recortado, Chrome no lugar de Pillow. S4 pode reprovar. Se reprovar a fonte, sobe o catálogo; se reprovar sempre, a peça solta encolhe muito.
4. **Queda de oferta no F1a:** `HEADLINE` quase some até o F1b, e lote de template passa a recusar formato. Medido em banco local com fixtures.
5. **Legenda sem contorno** (TikTok nativa, como no print) **não é detectada**: esse tipo de campeão não ganha resgate. Sem teste de quanto isso pesa.
6. **Pele manchada (02, t=19) escapa dos números.** Sobra visão nos 6 piores quadros, e o olho.
7. **Emenda de pedaços** pode dar um pulo leve (S1). Não foi assistida com essa pergunta.
8. **Colisão:** F-U2 sem commit nos mesmos arquivos. Pergunta 2.
9. **Direitos de glifo:** o recorte evita licença de fonte, mas não é parecer jurídico.
10. **Tamanho no 120 sem causa conhecida:** o teto de 60 s pode ficar se a S1b não resolver.

### 15.12 Pro Gusta
1. **Trecho ruim derruba a peça inteira?** Os 4 vídeos que vc achou bons têm trecho fora do portão: igreja nos 6 s iniciais do 13, mão nos 2 s do 02, partículas nos 5 s finais do 05, mão no 120. Ao pé da letra, nenhum sai. **Recomendo:** reprova se o trecho ruim cair nos 3 primeiros segundos ou passar de 20 % da duração. Assim 13 e 02 sairiam fora, por causa do gancho, mesmo vc tendo gostado. Prefere isso ou tolerar mais?
2. **Pode commitar o F-U2 antes do F1a?** Eles mexem nos mesmos arquivos, e sem commit não dá para separar nem reverter uma frente sem a outra. **Recomendo commitar.**
3. **Faixa de cor e "encolher":** cobertura não é, mas é tarja visual em volta do vídeo (aprovada em 29/10, caso extremo). Sai já no F1a, com menos formatos na transição, ou só quando a troca de legenda existir? **Recomendo só no F2.**

### 15.13 Respostas do Gusta à §15.12 (06/11)
1. **Trecho ruim:** o Gusta delegou a decisão ("decide vc"). Decisão do Claude: a peça sai, salvo letra antiga legível em qualquer trecho ou trecho ruim acima de 20 % da duração. Borrão nos 3 primeiros segundos não reprova sozinho, porque reprovaria 13 e 02, aprovados pelo Gusta. Calibrar na S3 para os 4 vídeos que ele viu passarem.
2. **Commit do F-U2:** autorizado em branch separada. Só o editor não compila sozinho (depende de tudo sem commit desde 19cdef8), então `checkpoint/pre-f1a-editor-u2` (7d26ad4) guarda o conjunto, sem `research_notes/`, `reports/` e prints de teste. `main` e a árvore de trabalho não mudaram. Diff do F1a: `git diff checkpoint/pre-f1a-editor-u2`.
3. **Faixa de cor e "encolher":** ficam até o F2.
F1a autorizado, incluindo a revogação do desligamento automático da guarda (`plano-auto.service.ts`) e o `HEADLINE` de troca fora do ar até o F1b.

### 15.14 Veredito da S4 (06/11)
Respostas do Gusta, vendo `research_notes/s4-demo-2026-11-06/s4-resumo.mp4`:
1. **Versão de servidor aprovada:** Arimo 600 e emoji recortado do próprio vídeo.
2. **Texto novo curto demais, que expõe o apagado:** a IA reescreve até um tamanho próximo do original; se não couber, a peça não é oferecida. O limite de exposição ainda precisa ser calibrado.
3. **Caixa translúcida (02):** placa parada aceita, com o vulto congelado.
**Incorporados na §16.** Ajustes técnicos da S4 a incorporar no F0b: relatório da sonda, em especial máscara do emoji por lóbulo, fantasma medido na placa, régua no Chrome, centro único, queixo, página mantida na pausa e o vazamento de 6,3 % em `comporSobreOCampeao`.

---

## 16. F0b fechado (2026-11-06): ajustes da S4, laço de texto e F1b pronto para disparar
Dono: maquina-arquiteto. Status: **fechado em documento, com tipos e arquivo de migração escritos. Migração não aplicada. F1b ainda sem código e depende do fim do QA do F1a.** Vale sobre as §14 e §15 onde houver marca **[SUBST. §16.x]**.
Evidência: `research_notes/s4-demo-2026-11-06/` (`medidas/`, `scripts/`, `quadros/`, `s4-resumo.mp4`) e medidas novas desta rodada, locais, US$ 0, sem AWS e sem banco: exposição por retângulo, fantasma na placa, solidez do emoji, `regua_chrome.py` de novo e a máscara do compositor. **A S4 não deixou README; os números vêm dos JSON e foram refeitos onde indicado. Tudo da headline solta segue vindo de 1 vídeo.**

### 16.0 Resumo
1. O caminho aprovado na S4 vira regra: máscara do emoji por lóbulo, régua no Chrome com traço antes da correlação, centro único, conferência do fantasma na placa e +Y só onde a base é placa.
2. **Texto curto ou longo demais:** função pura mede; a IA reescreve até 3 vezes; não coube, a peça sai. Limite provisório de exposição: **E ≤ 0,15**. Pior caso: **~US$ 0,018 por lote**, estimativa.
3. **Caixa translúcida:** imagem parada aceita, com desvio p99 até 25. O único caso visto mede 18.
4. **Bug `comporSobreOCampeao`:** real, mas numa peça de hoje a diferença medida fora da máscara foi **0 nível**, porque o render já tem o mesmo vídeo por baixo. Não precisa refazer peça. Correção de 1 trecho, sem migração nem bundle (§16.7).
5. **S1b:** nada dela é necessário para a headline; ela inteira fica para o F2. A headline pede duas verificações próprias e menores: G0 e G1 (§16.8), ~US$ 0,03 no total, com ok.

### 16.1 Mapa do que foi substituído
| antes | agora |
|---|---|
| §15.7.2 itens 2 e 6: limiar 45 + preenchimento | §16.2 A1 |
| §15.5.7 fantasma na peça | §16.2 A2 |
| §14.1.2 régua, §15.7.3 corte e escolha por cos em Pillow | §16.2 A3 |
| §14.1.1 item 7, dilatação fixa | §16.2 A5 |
| §14.4 "texto mais curto: mantém"; §14.4 e §15.5.6 "1 reparo" | §16.3 |
| §15.5.2 caixa translúcida "fora até o Gusta ver" | §16.4 |
| §15.6.5 pausa de fala "não testado" | §16.2 A7, no F2 |
| §15.4 "depois de S4 e S1b (headline)"; §15.9 linhas F0b, S1b e F1b; §14.6 passo 4 (editor) | §16.6 e §16.8 |
| §15.8 "`GET /iterate/:id` ganha etapa" como campo novo | Item `preparing_plate` no `checklist` existente, em `stage: 'planning'` (§16.5) |

### 16.2 Ajustes da S4
| # | regra | evidência | quem, quando |
|---|---|---|---|
| **A1** | **Emoji: casco convexo por lóbulo.** Mediana do trecho; fundo = mediana do anel de 3 px; `base` = diferença média > 32; núcleo = erosão elíptica 3×3; componentes do núcleo = lóbulos; cada pixel de `base` vai ao lóbulo mais próximo; casco convexo de cada lóbulo com ≥ 12 px; alfa com blur 0,5; margem 2 px. **Não oferece (`emoji_unsupported`):** `ocupa` < 40 % ou > 95 %; solidez (`base` ÷ casco) < 0,70; sem lóbulo; e as regras da §15.7.2 item 6 sobre posição e movimento | A máscara antiga comia a pupila encostada na borda (`quadros/emoji-x6-v1-mascara-do-contrato.png`). Aprovada: 3 lóbulos, `ocupa` 0,797, solidez 0,832. **O corte de solidez é provisório: 1 emoji, e o casco enche concavidade com o fundo mediano** | video, V2 |
| **A2** | **Fantasma na placa, antes do texto.** Alto-passa (σ 5) nas letras antigas, sem emoji, 1 quadro a cada 10: \|média\| ≤ 3 no pior quadro e correlação com o molde ≤ 0,10. Reprovou = `plate_rejected`. Sai a prova na peça | Na peça, o texto novo e a sombra contaminam: −3,8 a −28,4, o que reprovaria a aprovada. Na placa: original 125,7, placa 0,31, pior 0,5; correlação 0,784 → 0,013. **Limites folgados e 1 vídeo; só impedem regressão** | video, V2 |
| **A3** | **Régua no Chrome; traço antes da correlação.** 1) pré-seleção sem desenho (§14.1.2), até 5 candidatas; 2) still com as palavras originais no motor do render, mesma extração de alfa no original e na prova; 3) **fora quem erra o traço em mais de ± 15 %**; 4) a maior `corr` (coeficiente de correlação de Pearson) entre as restantes. **Pillow nunca decide.** Tabela abaixo | Em Pillow, o 02 escolhia Montserrat 700 (0,778). Com o traço primeiro, a regra reproduz as 3 fontes da S4: 02 Montserrat 600; 06 Montserrat 500; 05 Albert Sans 500, que tinha sido escolhida a olho. **Montserrat 700 não foi renderizada no Chrome para o 02** | video, V2; G0 confere em Linux |
| **A4** | **Centro único por mediana.** Com `align: center`, todas as linhas novas usam 1 centro = mediana dos centros das linhas antigas, com o emoji dentro da linha dele. Centro por linha só na prova de mesmas palavras. Em `left` e `right`, a mesma ideia sobre a borda | O ajuste por linha oscila (06: 234,5 / 234,5 / 243,5; 05: 313 / 303 / 308) e faria o texto novo dançar | video, V1 |
| **A5** | **Dilatação da caixa.** 9 px sem sombra. Com sombra medida: sobe 9, 13, 17, 21, 25 até o p99 do anel externo contra o fundo suavizado ficar ≤ 12. Não convergiu = `not_measured` | 05: com 9, halo p99 27; com 21 à mão, 7. **A regra precisa dar 21 ± 4 no 05: é o teste** | video, V2 |
| **A6** | **Queixo em linha que sobe.** Quando a tinta nova passa acima do topo do bloco original: `chinY` = p95 do fundo da caixa do rosto `main` no intervalo; `topo da tinta − chinY ≥ 0,5 × corpo`. Vale para solto e para caixa que cresce. Falhou = `over_chin`, cai no laço da §16.3. Texto nunca desce em direção à legenda: isso é `bottomLimitY` | Aprovada ~40 px, longa de 3 linhas ~7 px (`quadros/solto-variantes-real.png`), **lidos a olho num quadro**. A caixa real do `faceTrack` não foi conferida neste vídeo: a QA prova longa reprovada e aprovada passando | video: V1 na função; V2 grava `chinY` e `bottomLimitY` no `look` |
| **A7** | **Legenda: página fica na pausa.** `end` da página = `start` da próxima; a última vai até o fim. **Ainda sem teste em página que atravessa corte** | `saida/legenda/02-W1-sombras-pausa.mp4`, `quadros/leg-02-pausa.png` | video, **F2** |
| **A8** | **+Y só com placa de base.** O render pela `OffthreadVideo` sai 1,65 Y abaixo da base (medido de novo; causa não isolada, os testes em `saida/cor` não ficaram). Sem correção, o retângulo aparece amplificado (`quadros/retangulo-x20-com-e-sem-correcao.png`). **Calibra por render, sem constante:** 3 quadros do intervalo, mediana de `render − base` fora da tinta; `y = −round(mediana)`, limitado a ± 4, fora disso `RENDER_ERROR`; `lutyuv` só em `[top]`. **Caixa: y = 0**, e a máscara é exatamente a imagem medida, sem o `pad` de 4 px | Mac: −1,65 → +2, sobra +0,35. Assim Mac, Lambda e VPS se ajustam sozinhos. Outros tipos de peça não mudam | video, V3 |
| **A9** | **Chrome Linux antes do F1b.** Virou o portão **G0** (§16.8). Um still sozinho não basta: mede fonte, mas não vê o x264; o +Y exige um clipe curto | S4 inteira em `chrome-headless-shell` de Mac | video, G0 |

**Régua no Chrome, caixa (`corr`; só 3 vídeos; corrige os valores da §14.1.2):**
| medida, redesenhando as palavras originais | `same` | `close` | `far` | medido |
|---|---|---|---|---|
| Traço, filtro antes de tudo | ± 15 % | ± 15 % | fora | −3 %, 0 %, 0 %. Montserrat 500 no 02: −25 %, sai |
| `corr` | ≥ 0,64 | ≥ 0,55 | < 0,55 | 02 0,672; 06 0,645; 05 0,678. Recusadas: 02/500 0,639; 05/500 0,540; 05/DM Sans 0,554 |
| Largura de cada linha | ± 3,5 % | ± 6 % | fora | Pior 3,0 % (06) |
| 1ª linha de base e entrelinha, a 720 px | ± 3 px | ± 5 px | fora | Pior 3 px (05) |
| Cor do texto e do fundo | ΔRGB ≤ 8 | ≤ 16 | fora | Dentro |
| Intervalo | ± 1 quadro | ± 1 quadro | fora | Exato |

**Solto:** `same` ≥ 0,85 e `close` ≥ 0,75, como na §15.7.3. Arimo 600 no Chrome: 0,876, tinta 1,069, largura +1,3 %. **Conferência da caixa na peça:** ≤ 1 de média e ≤ 1,5 no pior quadro; o `cp108` pedia ≤ 1 e a S4 mediu pior 1,12 no 05, com o Gusta vendo. O número de quadros é igual nos 3 (`ffprobe`: 290, 284 e 428); o `dif_quadros` 1-3 em `conferir-caixa.json` é a leitura do script, não a peça.

### 16.3 Texto que não fica próximo do original
Regra do Gusta (§15.14): texto curto demais a IA reescreve até tamanho próximo do original; não coube, a peça não é oferecida. Texto longo que encosta no queixo, igual.

**Exposição (só `loose`; caixa não expõe nada, E = 0):** `E = 1 − área(erasedRects ∩ linhas novas dilatadas) ÷ área(erasedRects)`. `erasedRects` = 1 retângulo por linha antiga, sem o emoji. Linha nova = largura pela tabela × do topo à base da tinta, dilatada `3 × W / 464` px. Função pura em `ajustarHeadlineCopia`: mesmo resultado na API e no navegador, sem render.
| versão | E | leitura |
|---|---|---|
| Mesmas palavras; longa; longa2 | 0 | Nada exposto |
| **Aprovada** | **0,029** | Gusta aprovou |
| **Curta** (`quadros/solto-curto-buraco.png`) | **0,334** | Mostrada como curta |
| **1 linha** | **0,532** | Mostrada como curta |
Valores calculados com a tinta real do Chrome. A função usa a tabela de larguras, então o aceite da V1 aceita ± 0,01 na aprovada.
**Limite: `EXPOSICAO_MAX = 0,15`, provisório.** Fica entre 0,029 e 0,334, com 1 vídeo. O veredito do Gusta não apontou qual peça reprovou, e sim o caso "curto". **Calibração, sem custo de IA:** no G1, 5 campeões soltos com texto em 3 tamanhos; o Gusta marca. A medida é só de área: um buraco no cabelo escuro aparece menos que na pele, e isso fica para depois, se a calibração pedir.

**Ordem de rejeição em `ajustarHeadlineCopia`:** escada da §14.4 (`same`, `rewrap`, `shrink` ≤ 90 %, `grow` +1 linha subindo) → não coube: `too_long` → `over_chin` (A6) → `too_short` (E > limite). No solto, a margem lateral é 5 % da largura, porque não há caixa; a `longa2` mede 32 px em 464 e passa.

**Laço, dentro do `AUTO_PLAN`, na etapa `planning`:**
1. O `<headline>` do plano passa a levar `lines`, caracteres por linha do original e alvo de **85-115 % por linha**. É orientação; o veredito é a função.
2. Depois do `validatePlan`, cada `HEADLINE` `replace` passa por `ajustarHeadlineCopia`. Essas falhas **não** vão para a chamada de reparo do plano inteiro, que custa o plano de novo. `headline_too_long` por caracteres passa a valer só no `add`.
3. Falhou: nova chamada só daquele texto, `rewriteHeadlineFit`, com o texto atual, o motivo, a medida e o alvo numérico. **No máximo 3 reescritas por headline (4 medidas no total).** Cada reescrita passa por `ajustarHeadlineCopia` e pelo `headlineViolations`: nada inventado, diferente da original e das outras do lote. Erro da chamada conta como tentativa.
4. Passou: fica, com `fitStep`. **Sem passar na 3ª: a peça sai do plano**, sem crédito reservado. Saíram todas: `insight.headlineBlocked = { reason: 'headline_no_fit', mode: 'replace' }`; em lote de template, fit `hard` com o mesmo motivo e plano vazio.
5. **Modelo:** `ANTHROPIC_HEADLINE_FIT_MODEL`, padrão `claude-haiku-4-5`. **Custo, estimativa:** ~1,2 mil tokens de entrada + 150 de saída, a US$ 1 / 5 por milhão (`catalogo/precos.ts`) = ~US$ 0,002 por chamada; pior caso, 3 peças × 3 = 9 chamadas, **~US$ 0,018 por lote**. Vira `cost_entry` LLM do lote. Não cobra crédito. O real se confere no G1.
6. **Edição manual:** `PATCH …/texts` não chama IA. Responde 422 `TEXT_INVALID`, com `rule` = `headline_too_long`, `headline_too_short` ou `headline_over_chin`, e `detail` com E ou a folga. O web roda a mesma função ao digitar.
**Caixa com texto curto:** decisão do arquiteto, não do Gusta: sem piso, porque a placa não deixa buraco e o `06-curta` foi mostrado sem objeção registrada.

### 16.4 Caixa translúcida
Imagem parada aceita (§15.14), com o vulto congelado.
| desvio p99 no anel | decisão | evidência |
|---|---|---|
| ≤ 11 | Caixa opaca | 05 3,7; 06 3,3-5,3 |
| 11-25 | **Caixa translúcida: imagem parada**, `plate.translucent = true`, sem aviso | 02: 17,7-18; contra o por quadro, média 3,84, pior 8,25, p99 16,3; movimento 0,01 × 0,08 no original |
| 25-40 | **Não oferece**, `text_changes` → `headline_moves`. A §15.5.2 aceitava até 40 sem nenhum caso visto | Só 1 vídeo translúcido |
| > 40 | Vai para solto | §15.5.2 |
Sem placa por quadro no F1b e sem `CHAMPION_PLATE` na caixa.

### 16.5 Tipos, migração, API e assinaturas
**Escrito nesta rodada:** `contratos/src/troca-texto.ts` (novo), `contratos/src/index.ts` (`EditMap.headlineLook?`, export), `contratos/src/iteracao.ts` (`PieceHeadline` e `AutoInsight.headlineBlocked?`, opcionais), `contratos/src/templates.ts` (motivos), `api/prisma/migrations/20261110000200_champion_plates/migration.sql`, `api.md`, `modelo-de-dados.md`. `tsc --noEmit` limpo em `contratos`, `api`, `web` e `video`.
**Decisão:** `FontId` não cresce agora. `api` e `video` indexam `FONT_CATALOG` por ele, e isso quebraria o F1a em teste. `CopyFontId` vale até a V1, quando o arquiteto funde.
**`api/prisma/schema.prisma` não foi tocado nesta rodada**, por restrição de escopo. O bloco exato está em `modelo-de-dados.md`, e a migração saiu dele. Entra na fase A0. Até lá, `npm run db:diff` mostra diferença, e isso é esperado.
**A0 feita (06/11):** bloco no `schema.prisma`, igual ao de `modelo-de-dados.md`; migração sem mudança. `npm run db:diff` vazio; `maquina` local já tinha a migração (`migrate status` em dia; diff banco × schema vazio); backup `.infra/backups/maquina-2026-11-06-1152.sql.gz`. Efeito do enum novo: `JobType` do contrato ganhou `CHAMPION_PLATE` (`contratos/src/index.ts`) e `JOB_CHECKLIST` ganhou `CHAMPION_PLATE: ['erasing', 'checking']` (`api/src/jobs/job.presenter.ts`, 1 linha, só para o `Record<JobType>` compilar; o B1 pode trocar as etapas). `tsc --noEmit` limpo em `contratos`, `api`, `web` e `video`. `prisma generate` rodado.

```ts
// api/src/iteracao/headline-plano.ts (backend, F1b). Puro. Sem `plateImpl`, o comportamento é o do F1a: a spec atual continua valendo.
export type HeadlineBlocked = 'headline_over_face' | 'headline_moves' | 'headline_low_confidence' | 'headline_aspect' | 'headline_pending'
  | 'headline_near_caption' | 'headline_font_far' | 'headline_plate_rejected' | 'headline_no_fit';
export interface HeadlinePlateState { status: 'QUEUED' | 'RUNNING' | 'READY' | 'REJECTED' | 'FAILED'; reason: string | null; version: number }
export interface HeadlineInfo {
  mode: 'replace' | 'add'; original: string | null; lines: number; maxChars: number; hasHighlight: boolean; language: string;
  blockedReason: HeadlineBlocked | null;
  format: VideoFormat | null;
  copy: HeadlineCopyKind | 'add' | null;   // null = bloqueado sem medida
  look: HeadlineLook | null;
  needsMeasure: boolean;                    // true: o chamador mede e chama de novo
  needsPlate: boolean;                      // true: loose sem READY; o chamador enfileira e espera
}
export function headlineInfoOf(m: EditMap | null, o: {
  screenLanguage: string; offerLanguage: string; width: number; height: number;
  plateImpl?: 'off' | 'local' | 'lambda';   // ausente = 'off'
  plate?: HeadlinePlateState | null;        // linha vigente de champion_plates
}): HeadlineInfo;
```
**Ordem da decisão em `replace`:** sem formato → `headline_aspect`; `plateImpl` off ou workspace fora de `PLATE_WORKSPACE_IDS` → `headline_pending`; `headlineLook` ausente → `needsMeasure` com `headline_pending`; `verdict.reason` pela tabela abaixo; `loose` sem `plate`, ou QUEUED, RUNNING → `needsPlate`; REJECTED → `headline_plate_rejected`; FAILED → `headline_pending` (§15.4); pronto = `blockedReason: null`. O `add` não muda.
| `verdict.reason` | `blockedReason` |
|---|---|
| `not_measured`, `text_not_light`, `emoji_unsupported`, `no_box`, `low_contrast` | `headline_low_confidence` |
| `box_moves`, `fades`, `text_changes` | `headline_moves` |
| `over_face` | `headline_over_face` |
| `near_caption` | `headline_near_caption` |
| `font_far` | `headline_font_far` |
| `plate_rejected` | `headline_plate_rejected` |
| `plate_failed` | `headline_pending` |

```ts
// video/src/lib/ajuste-headline.ts (video, V1). Pura, sem DOM e sem Node; exportada para api e web.
export function ajustarHeadlineCopia(fit: HeadlineFitLook, texto: string): HeadlineFitResult;
export const EXPOSICAO_MAX = 0.15;
// api/src/medicao/troca/porta.ts (video, V2). Publicado com o fake ANTES de o backend começar.
export const TROCA_TEXTO = Symbol('TROCA_TEXTO');
export interface TrocaTextoPort {
  medirHeadline(i: { workspaceId: string; championId: string; videoUrl: string; editMap: EditMap }): Promise<{ look: HeadlineLook | null; costUsd: number; ms: number }>;
  placaHeadline(i: { workspaceId: string; championId: string; videoUrl: string; look: HeadlineLook; version: number; outputKey: string }):
    Promise<{ status: 'READY' | 'REJECTED' | 'FAILED'; reason: string | null; metrics: Record<string, number>; sizeBytes: number | null; costUsd: number; ms: number }>;
}
export const HEADLINE_PLATE_VERSION = 1;
// api/src/integracoes (ia, I1)
rewriteHeadlineFit(i: { workspaceId: string; batchId: string; language: string; original: string; current: string;
  reject: HeadlineFitReject | 'rule'; measure: string; targetCharsPerLine: { min: number; max: number }[]; rules: string[] }): Promise<{ text: string; highlight: string | null }>;
// RemixKeepRenderInput (video, V3), opcional: placaComoBase?: boolean. true = calibra Y (A8)
```
**Etapa da espera:** `stage: 'planning'` com `checklist` `{ key: 'preparing_plate', status }`. Sem novo `AnalysisStage`, porque tela antiga segue funcionando. **Ordem no `AUTO_PLAN`:** medir → `headlineInfoOf` → placa, se `needsPlate`, esperando até 180 s → plano → laço → `PLAN_READY`. A placa vem antes do plano para a IA não escrever texto de peça que o portão vai recusar. Passou de 180 s: `headline_pending` neste lote; o job termina e serve ao próximo.
**Job:** `CHAMPION_PLATE`, trava por `championId + kind + layerKey + version`. Só roda se `HEADLINE` estiver no `allowed` e na seleção. **Env nova, além da §15.8:** `PLATE_WORKSPACE_IDS` (vazio = todos, com `PLATE_IMPL` ligado), `ANTHROPIC_HEADLINE_FIT_MODEL`. A chave `HEADLINE_BOX` da §14.6 não existe: `PLATE_IMPL` governa os dois.
**Editor:** peça `box` ou `loose` fica `editor: { available: false, reason: 'headline_plate_retired' }` até o F3. Tira o editor do F1b, que era onde mais colidia.
**Tipos da legenda:** só `CaptionSwapReason` entra agora. `CaptionTrack`, `captionNote: 'swapped'` e `captionMode: 'swap'` ficam para o F2, para não haver campo sem dono.

### 16.6 Fases do F1b
**Regra de pasta:** cada arquivo tem 1 dono. `contratos/` e `api/prisma/` = arquiteto. Trabalho na mesma árvore, sem worktree com symlink. Só o recorte em teste; suíte completa no fim, com a QA.
| onda | id | dono | entrega | arquivos | depende | aceite |
|---|---|---|---|---|---|---|
| 0 | **A0** | arquiteto | Bloco no `schema.prisma`; `db:diff` vazio; `npm run db:migrate` local | `api/prisma/schema.prisma` | Fim do QA do F1a | `db:diff` vazio, backup feito |
| 0 | **B0** | video | Bug da máscara, §16.7, com spec | `api/src/render/posprocesso.ts`, `.spec.ts` | Fim do QA do F1a; independe do resto | Fora da máscara = base ± 1, também na ffmpeg 5.1 da imagem |
| 0 | **G0** | video | §16.8, **com ok, AWS** | `research_notes/` | Ok do Gusta | Critérios da §16.8 |
| 1 | **V1** | video | Fontes, licenças, tabelas de métrica, `FONT_CATALOG`, `ajustarHeadlineCopia`, A4, A6, escada; arquiteto funde `CopyFontId` no `FontId` no mesmo passo | `video/src/lib/ajuste-headline.ts`, `video/src/lib/index.ts` (export), `video/src/lib/remix.ts` (só catálogo), `video/src/lib/metricas-fontes.ts` (gerado), `video/scripts/metricas-fontes.mjs`, `video/src/fontes.ts`, `video/public/fonts` | G0 | Aprovada E 0,029 ± 0,01; curta e 1 linha `too_short`; longa `over_chin` |
| 1 | **V2** | video | **1º a porta e o fake.** Depois Python: `medir_headline`, `placa_headline`, `juntar`, `conferir`; A1, A2, A3, A5; prova no Chrome; `scripts/legenda-lambda.mjs` | `api/src/medicao/troca/`, `scripts/legenda-lambda.mjs` | G0 | Reproduz na fixture da S4 as 3 fontes, dilatação 21 ± 4 no 05, emoji e `endFrame` 161 |
| 1 | **I1** | ia | `rewriteHeadlineFit` e fake; `describeEdit` com `\n`; `<headline>` com alvos; sem emoji no texto; `AutoPlanInput.headline` e `HeadlineSpec.look` | `api/src/integracoes/` | Tipos | Spec com fake; nada pago |
| 1 | **F1** | frontend | `copy`, "Closest font", `preparing_plate`, degrau ao digitar, mensagens de `too_short`, `over_chin` e dos 4 motivos novos; a faixa de `captions.tsx` passa a cobrir além de `headline_pending` | `web/` | Tipos; MSW; função da V1 quando sair | 2 idiomas, tela nos mocks |
| 2 | **V3** | video | `RemixKeep` e `remix.ts` (imagem 2D, entrelinha, sombra, sublinhado, emoji, `lines`, `letterSpacingEm`); `buildHeadlineInput` com `box` e `loose`; A8 em `comporSobreOCampeao` | `video/src/RemixKeep.tsx`, `video/src/lib/remix.ts`, `api/src/render/headline.ts`, `api/src/render/posprocesso.ts`, `api/src/render/contrato.ts` | V1, B0, I1 | Peça local por porta fake: PSNR fora ≥ 40 dB, áudio igual |
| 2 | **B1** | backend | Tabela e job `CHAMPION_PLATE`, `headlineInfoOf`, alvo = 1ª camada no tempo, medida de campeão antigo, espera, laço da §16.3, `PATCH …/texts`, `PieceHeadline`, isenção da §15.5.4 item 7, editor indisponível, custos | `api/src/iteracao/`, `api/src/campeoes/`, `api/src/edicao/` | A0, V1, V2 (fake), I1 | Int spec com fake: 4 tentativas no máximo, peça sai, sem crédito, `PLATE_IMPL=off` igual ao F1a |
| 3 | **G1** | video | Deploy `hookmill-legenda`; §16.8. **Com ok, AWS** | `research_notes/` | V2 | §16.8 |
| 3 | **Q1** | qa | Recorte: 02, 05, 06, aprovada, `snapinsta`, Adele Wu; §15.5.7 com A2; curta, 1 linha e longa; ida e volta do `PLATE_IMPL`. **Lote real ~US$ 0,30, com ok; o Gusta vê** | `testes/` | V3, B1, F1, G1 | Único que declara "funciona" |
| 4 | **D1** | arquiteto | Deploy na ordem da §15.10: função → site Remotion → banco com backup → API → web. `PLATE_IMPL` por workspace interno | Infra | Q1 | Ligado só no interno |
**Paralelo sem colisão:** A0, B0 e G0 juntos. Depois V1, V2, I1 e F1. V3 e B1 juntos só depois. **Pontos de contato:** `remix.ts` na V1 e na V3 são do mesmo dono, em sequência. `posprocesso.ts` na B0 e na V3, idem. `headline-plano.ts` é do backend e `headline.ts`, do video. `integracoes/contrato.ts` é da ia, por isso `HeadlineSpec` sai na I1. `legendaProtegida.ts` só em F2. `video/src/lib/editor/` fica fora, em F3.
**Evidências de produto a não copiar:** o `compor.py` da S4 usa `crop + overlay`, e o `caixa_medir.py` tem constantes por vídeo (`C`, `ESC`, `dil`). A produção mede tudo; só a lógica vem de lá.

### 16.7 Bug de `comporSobreOCampeao`
**Confirmado localmente.** `color=c=black,format=gray` dá Y = 16 na máscara, alfa 16/255 = 6,3 %. Teste sintético com base 102 e render 188: fora da máscara saiu **107** em vez de 102; dentro, 188, sem vazamento. O filtro é o mesmo no `HEAD` (`remotion-render.service.ts`) e na árvore (`posprocesso.ts`). Não conferi qual versão está no ar; nenhuma das duas escapa.
**Efeito nas peças já renderizadas: visualmente nenhum no caso medido. Sem refazer, sem reembolso, sem aviso.** Vaza 6,3 % da *diferença* entre render e base, e o `RemixKeep` sempre desenha o mesmo vídeo por baixo: essa diferença é de −1,65 Y. Com render real sobre a base, em 1 vídeo e 60 quadros, a saída ficou **a 0,0 nível da base, p99,9 = 0**, porque 0,063 × 2 arredonda para zero. Para mudar 1 nível, a diferença precisa passar de ~8. **Onde isso pode ocorrer, sem medição em peça real:** sombra ou contorno que passa dos 4 px de `pad`, cor saturada que o Chrome desloca e vídeo de fps variável, se houver desalinhamento de quadro; em todos, a fração é 6,3 %. A S4 só viu o defeito porque o render da caixa de lá não tinha vídeo por baixo: nesse caso, a imagem inteira escurece 6,3 %.
**Correção, testada localmente em ffmpeg 6.0:** `lut=c0=0` **antes** dos `drawbox`: `color=c=black:s=WxH:r=fps,format=gray,lut=c0=0,drawbox=…`. Resultado: 102 fora, 188 dentro, e o `enable` por intervalo continua certo. **Depois dos `drawbox` a correção falha:** a saída fica 106. A API usa ffmpeg 5.1 na imagem, então a B0 prova nela.
**Sai sozinha e antes?** **Sim, tecnicamente:** 1 trecho em 1 arquivo, sem migração, sem bundle e sem Lambda, porque a composição roda na API nos dois adaptadores. **Não merece deploy especial:** vai no próximo da API. A spec atual não pega o erro (`> 200` num canal passa com vazamento), então a B0 acrescenta `fora = base ± 1`. **Não mexer durante o QA do F1a**, para não mudar o render sob teste. Hotfix a partir do `HEAD` teria que ir em `remotion-render.service.ts`, porque o código ainda não foi extraído lá.

### 16.8 S1b e os portões da headline
**Da S1b, nada é necessário para a headline.** Balanceamento de pedaços, detecção única, `fontId` da legenda, IoU do 120 s, teto de 60 ou 130 s: tudo é da legenda. **A S1b inteira fica para o F2**, como pré-requisito da S3. A §15.4 deixa de citar S1b para ligar a headline. `hookmill-legenda-s1` continua até o F2 (~US$ 0,06/mês).
**A headline precisa de 2 verificações próprias, com ok do Gusta:**
| portão | o que | custo, estimativa | passa |
|---|---|---|---|
| **G0**, antes da V1 e da V2 | Site temporário com a composição da S4, sem mexer em `REMOTION_SERVE_URL`; sem as mídias de legenda. **Stills** de prova: solto, 02, 05 e 06. **Clipe de 10 quadros** com base em placa. Se o render de produção ainda for `local` na VPS, repetir lá | ≤ US$ 0,01 | Largura por linha ± 1 %, traço ± 5 %, `corr` ≥ Mac − 0,03, +Y entre −4 e +4. **Falhou:** régua recalibrada em Linux e 1 quadro para o Gusta ver antes da V1 |
| **G1**, depois da V2 | `placa_headline` e `medir_headline` na função real, 5 campeões soltos e 3 de caixa, incluindo o mais longo disponível; calibração de E da §16.3 | ≤ US$ 0,02 | Dentro do timeout de 300 s; fantasma e conferência como no Mac, ou limites refeitos com o Gusta; tempo e custo anotados |
**Motivo:** o tempo de `placa_headline` em Lambda nunca foi medido. A S4 levou 2,9 s no Mac para 564 quadros a 464 × 832. Um vídeo de 60 s a 720p recodifica ~1800 quadros. Por isso o G1 inclui o mais longo.
**Total até ligar:** ~US$ 0,03 + lote real ~US$ 0,30 (§14.7).

### 16.9 Riscos
1. **Solto segue com 1 vídeo:** E, fantasma, solidez, queixo. Os limites são provisórios; o G1 e o lote real calibram.
2. **Um arquivo novo em `migrations/` é aplicado por quem rodar `migrate deploy`.** O `testes/harness/db.ts` faz isso no setup, e o `scripts/api-start.sh`, ao subir a imagem. **Consequência:** o próximo setup de QA aplica no banco `_test`, e um deploy do F1a com esse arquivo aplicaria no Neon, sem o backup da §15.10. É aditiva e nada lê a tabela, mas o commit do F1a deve excluir essa pasta ou o backup deve vir antes.
3. **Chrome Linux pode medir diferente:** o G0 existe para isso.
4. **Caixa do rosto como queixo:** se o `faceTrack` tiver folga, o A6 recusa texto que caberia. Falha para o lado de não oferecer.
5. **Editor fora da peça copiada até o F3:** a pessoa não ajusta a peça no editor; só o texto no Plan.
6. **Fontes `close` e `same` da caixa com 3 vídeos:** `corr` 0,64 é logo abaixo do pior aprovado, então 1 vídeo novo pode cair. O efeito é não oferecer.
7. **Haiku reescrevendo copy:** não medi a qualidade dessas reescritas. O lote real é onde o Gusta vê.

**Deploy:** o que sobe quando o F1b fechar, a partir do `19cdef8` que está no ar, com as 14 migrações, backup e envs: [`deploy-f1b-plano.md`](deploy-f1b-plano.md).

### 16.10 Pro Gusta
1. **Ok para AWS:** G0 e G1 (~US$ 0,03), deploy da função `hookmill-legenda` e, no fim, 1 lote real (~US$ 0,30)?
2. **Caixa 05 e 06:** a §15.14 registra a Arimo e a translúcida do 02, mas não um "aprovado" para a fonte do 05 (Albert Sans) e do 06 (Montserrat 500). Vc viu na S4: ficaram boas? **Sem isso, a régua da caixa nasce de escolhas não aprovadas por vc.**

### 16.11 Respostas do Gusta à §16.10 (06/11)
1. **AWS:** ok para G0, G1, deploy da função `hookmill-legenda` e o lote real final (~US$ 0,30) que ele vê.
2. **Caixa 05 e 06:** aprovadas. 05 = Albert Sans 500; 06 = Montserrat 500. A régua da caixa pode nascer dessas escolhas.
3. Bugs B1–B8 do QA do F1a: corrigir. B9 fica com o arquiteto.
4. **Fonte da caixa: a régua decide (06/11, "sigo recomendações").** Vendo `research_notes/v2-2026-11-06/fontes-caixa-aprovada-x-regua.png`, o Gusta aceitou que a régua no Chrome escolha a fonte pelo `look` medido, em vez de fixar Montserrat/Albert Sans. Nos 3 casos da S4 ela escolhe TikTok Sans (02: corr 0,894 × 0,645; 06: 0,763 × 0,629; 05: empate 0,772 × 0,767). Substitui o item 2 acima no que diz respeito à fonte; o item 2 continua valendo como aprovação visual da caixa.
5. **Sem mais campeões soltos (06/11):** o Gusta não tem outros campeões com headline solta além do da S4. O limite de E (0,15) segue **provisório**, calibrado com 1 solto real + 1 sintético de 60 s na G1, e revisto no lote real da Q1.
