# Headline nova e legenda sempre (variação AUTO) — adendo v1
Data: 2026-10-25 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 25/10 ("pode"), H1–H9 com a recomendação do arquiteto**
Origem: decisões do Gusta de 25/10, depois do teste ao vivo das molduras. Vale **por cima** de `variacao-auto-v1.md` §6.1 (revisão 25/10) e §7, e de `estatico-montado-e-molduras-v1.md` §B2 só no que este arquivo muda.
O que já existe e é reaproveitado (lido no código em 25/10):
- `editMap.layers` do `describeEdit` (`feature-2-variar-campeao.md` §13.2), que traz `kind` (`headline` | `caption` | `text`), caixa, intervalo, texto literal, fundo (`solid` / `pill` / `none`) e estilo (`fontId` do catálogo, peso, caixa alta, cor, destaque, contorno, sombra, alinhamento, tamanho). Refino por pixel: `layerPresence` e `solidBackground` em `api/src/medicao/camadas.ts`, que também medem degradê.
- O render **`remix-keep`** (`video/src/RemixKeep.tsx`, `RemixKeepRenderInput`) faz exatamente "mesma edição, só o texto muda". Ele pinta `textLayers` (fundo e depois texto, estático ou karaokê) sobre o campeão. A API compõe o resultado **sobre o campeão decodificado**, com máscara por frame: fora das caixas o pixel é o do campeão, e o áudio é copiado sem recodificar (`comporSobreOCampeao`, PSNR fora ≥ 45 dB medido em 06/10). Já roda no Lambda (`RENDER_LAMBDA_KINDS` inclui `remix-keep`).
- O "gancho escrito" do `NEW_HOOKS` (§13.4 opção (a)): é a camada de headline redesenhada sobre o próprio fundo. É a mesma mecânica, só que antes servia ao lote manual.
- O `HOOK_TEXT` (saiu do catálogo em 25/10) desenhava um texto novo **só nos primeiros ~3 s**, por cima do vídeo reenquadrado na composição `AutoEdit`.
- A legenda palavra a palavra (`video/src/componentes/Legenda.tsx`, do criativo do zero) e o karaokê do `RemixKeep`.
- As fontes CJK em fatias (Noto Sans TC/SC/JP/KR em `video/public/fonts/cjk/`, `fontes.ts` com `cjkDe`/`ehCJK`), que hoje só a `Moldura` usa.

---

## 0. Resumo em 5 linhas
1. **`HEADLINE` é um tipo novo**, não o `HOOK_TEXT` repaginado: troca (ou acrescenta) a headline do vídeo inteiro pelo render `remix-keep`, sem mexer em corte, áudio, ritmo nem enquadramento. Precisa de migração **aditiva** do enum (`AutoVariationType` + `HEADLINE`).
2. **Campeão com headline:** 3 peças, cada uma com uma headline nova no mesmo lugar e no mesmo estilo. Se a original está numa faixa sólida, a faixa é repintada; se está sobre o vídeo, uma placa no estilo da original cobre a caixa antiga (sem inpaint). **Campeão sem headline:** 2 peças com faixa na cor da marca dentro da área segura.
3. **Legenda sempre:** se o campeão não tem legenda queimada, **todas** as peças de vídeo do lote ganham legenda palavra a palavra (CUT, REVIEW, NATIVE_SEARCH, FRAME e HEADLINE), sem colidir com texto de moldura nem com texto queimado. Junto entram as fontes CJK e a quebra sem espaço pra zh/ja.
4. **Contagem:** ITERATION = `HEADLINE` (3, ou 2 no campeão sem headline) + `CUT` (até 2). A regra de 40 % continua; no lote de 8 o reparo tira `CUT` antes de `HEADLINE`.
5. **Custo:** sem provedor de mídia. Texto do plano ~US$ 0,002 por headline; render `remix-keep` no Lambda ~US$ 0,015 por peça (png, estimativa a medir); legenda e fontes = US$ 0.

---

## 1. Tipo `HEADLINE`
### 1.1 Catálogo (entra em `variacao-auto-v1.md` §6.1)
| tipo | código EN / PT | eixo | entra quando | precisa | máx. no lote |
|---|---|---|---|---|---|
| `HEADLINE` | `HEADLINE-1`, `-2`, `-3` / `HEADLINE-1`, `-2`, `-3` | ITERATION | **modo `replace`:** o `editMap` tem camada `kind: 'headline'` (ou `text` presente em ≥ 50 % da duração, no topo ou no meio, que não é legenda) e ela não está bloqueada (§1.4). **Modo `add`:** sem camada assim | Brain (o que a oferta promete, prova, dor) + transcrição | `replace`: **3** · `add`: **2** (H6) |
- Uma variável por peça: só a headline muda. A fala, os cortes e o resto das camadas ficam como no campeão.
- **"Nada inventado"** (§6.2.5 do variacao-auto): número, preço, prazo ou porcentagem só se estiverem no Brain ou na transcrição. As 3 headlines do lote são **diferentes entre si** (ângulos diferentes: dor, promessa, prova) e diferentes da original (comparação normalizada).
- Idioma = o da headline original (`replace`) ou `offer.language` (`add`) (H4).

### 1.2 Tipos (✅ fechados 25/10: tipo ligado de ponta a ponta)
- `HEADLINE` nativo no `AutoVariationType` e `AutoHeadlineDraft` no `AutoParamsDraft`. Os apelidos `*WithHeadline` e o cast de `pecas.service.ts` saíram.
- Vista: `IteratePiece.headline?: PieceHeadline | null` (`{ mode, original, text, highlight }`, só na peça HEADLINE) e `AutoInsight.captionsAuto?: boolean` (ausente = false). Os apelidos do web (`*V` em `web/src/lib/api/types.ts`) agora apontam pros tipos do contrato; o frontend pode tirá-los.
- `HeadlineSpec` oficial em `api/src/integracoes/contrato.ts` (= o local do video): `mode`, `text`, `highlight`, `language`, `brandColor`, `plateColor?`, `captions?`. O `api/src/render/headline.ts` reexporta.
- Erros da peça (`IterateAsyncErrorCode` + `AUTO_FAIL_REASON` + i18n do web): `HEADLINE_TOO_LONG`, `HEADLINE_OVER_FACE`, `HEADLINE_NO_ROOM`, `HEADLINE_LOW_CONFIDENCE`, todos com `retryHint: 'leave_out'`.
- **Notas da implementação:** (1) o `no_room` do modo `add` **só aparece no render** (`HEADLINE_NO_ROOM` no `buildHeadlineInput`), e não no `allowed` do plano como a §1.3 previa: a peça entra no plano e pode falhar com Leave out. (2) A cor da placa (`plateColor`) hoje **vem pronta** do backend, medida sobre o editMap. Medir a mediana do fundo **no quadro real do campeão** (§1.3) fica pendente pro video; sem ela, vale a cor de contraste do H1.

Histórico da TRANSIÇÃO (25/10):
- Migração `20261025000300_auto_headline` (`ADD VALUE 'HEADLINE'`) aplicada em `maquina` (backup `maquina-2026-10-25-1952.sql.gz`) e `maquina_test`.
- Ficou **fora** do `AutoVariationType` e do `AutoParamsDraft` até a fusão, pra não quebrar quem ainda não ligou o tipo: `AutoVariationTypeWithHeadline` (`contratos/src/iteracao.ts`, reexportado em `api/src/integracoes/contrato.ts`), `AutoHeadlineDraft` + `AutoParamsDraftWithHeadline` e `AutoPlanInput.headline?`. Na fusão, o arquiteto põe `'HEADLINE'` no `AutoVariationType` e `AutoHeadlineDraft` no `AutoParamsDraft`, e tira o cast provisório de `pecas.service.ts`.
- **Código (`codeFor`, `api/src/iteracao/regras.ts`, quem liga é o backend):** EN `HEADLINE-<n>`, PT `HEADLINE-<n>` (n = 1, 2, 3 na ordem do plano; igual nas duas línguas, como `LAYOUT-*`).
Texto original:
```ts
// contratos/src/iteracao.ts
export type AutoVariationType = … | 'HEADLINE';           // migração: ALTER TYPE "AutoVariationType" ADD VALUE 'HEADLINE' (aditiva)
// api/src/integracoes/contrato.ts — AutoParamsDraft ganha:
| { type: 'HEADLINE'; mode: 'replace' | 'add'; text: string; highlight: string | null; sources: Record<string, CopySource> }
//   text: a headline inteira; highlight: trecho do `text` que leva a cor de destaque (null = nenhum; só se a original tem destaque)
//   limite: replace = nº de caracteres da original × 1,2 (mín. 20, máx. 90); add = 60
// AutoPlanInput ganha (backend preenche a partir do editMap):
headline?: { mode: 'replace' | 'add'; original: string | null; lines: number; maxChars: number; hasHighlight: boolean; language: string };
```
`HOOK_TEXT` continua no enum e no código de leitura (lotes antigos). As regras de texto dele (limite, "nada inventado", sem marca) são reaproveitadas no `validatePlan` do `HEADLINE`.

### 1.3 Como a headline nova é desenhada (maquina-video, `buildHeadlineInput`, função pura como `buildFrameInput`)
Entrada: `HeadlineSpec` (params validados) + `AutoEditContext` (campeão, `editMap`, cor da marca). Saída: `RemixKeepRenderInput` com `canvas` = o do campeão, `baseVideoUrl` = `audioPassthroughUrl` = campeão, `overlays: []` e `textLayers` assim:
| caso | fundo da camada nova | onde | estilo |
|---|---|---|---|
| **faixa sólida** (`background.kind: 'solid'` ou `pill`, inclusive degradê medido) | `solid` / `pill` com a **cor medida** (`solidBackground`), caixa = a faixa medida inteira | a caixa da original, no intervalo dela (normalmente o vídeo todo) | o da original |
| **sobre o vídeo** (`background.kind: 'none'`) | **placa** sólida que cobre a caixa antiga + margem de 4 % da altura do quadro, cantos 0,15 em, cor = **mediana dos pixels de fundo** dentro da caixa no frame de referência (os pixels do texto ficam de fora pela máscara de contraste), opacidade 100 % (H1) | idem | o da original |
| **sem headline** (`add`) | faixa `solid` na `brandColor` (sem marca: a 1ª cor da paleta medida), texto branco ou preto pelo contraste (WCAG ≥ 4,5) | topo da **área segura** (`SAFE_AREA` do formato do campeão), altura ≤ 22 % do quadro, largura total. Se a faixa cobre o rosto (`faceTrack`) em > 10 % dos frames, desce pra logo abaixo do rosto. Se ainda colide (com rosto ou `burnedTextBands`), a peça não é oferecida (`blockedReason: 'no_room'`) (H3) | Montserrat 800, caixa alta, centralizado, destaque na cor contrária |
**Estilo da original (decisão: visão + medição).** A visão já roda no `describeEdit` da análise, sem custo novo: `fontId` do catálogo fechado, peso, caixa alta, cor do texto, cor de destaque, contorno, sombra e alinhamento. A medição é por pixel (`camadas.ts`, já existe): caixa, cor do fundo e degradê, nº de linhas (corridas de linhas de texto na caixa) e **altura da linha em px**, que dá o tamanho. O render ajusta com `fitText` na **mesma caixa e no mesmo nº de linhas** (até +1 linha se não couber), com tamanho entre 80 % e 100 % do original. Não coube nem assim = violação no plano (`headline_too_long`), e a ia reescreve no reparo.
- `textLayers[].startFrame/endFrame` = intervalo medido da original (`layerPresence`). Headline que some no meio do vídeo continua sumindo no mesmo frame.
- O compositor da API (`comporSobreOCampeao`) usa como máscara a caixa da camada nova (faixa, placa ou faixa adicionada). Fora dela o vídeo é o campeão bit a bit (só a codificação final crf 12).

### 1.4 Bloqueios (o plano não oferece; motivo no `allowed`)
- `headline_over_face`: a placa ou a faixa cobre o rosto principal (`faceTrack`) em > 10 % dos frames.
- `headline_moves`: a camada muda de caixa no meio do vídeo (mais de 1 intervalo com caixas diferentes). Na v1 só headline parada.
- `headline_low_confidence`: a visão não deu `fontId` ou a medição não achou a caixa. Fica fora em vez de sair torto.
- Campeão com 2+ camadas de headline ao mesmo tempo: a v1 troca **só a maior** e as outras ficam.

### 1.5 Formatos
`remix-keep` sai no tamanho do campeão. **O `HEADLINE` só existe no aspecto do campeão** (`PieceFormat.supported = false` nos outros, o mesmo mecanismo das molduras, 409 `format_not_supported`) (H2). Campeão 9:16 dá a peça 9:16, que é a do Gerar. Campeão 1:1 ou 4:5 dá a peça só nesse aspecto, e o 9:16 dela fica sem suporte (o zip avisa).

## 2. Legenda sempre
### 2.1 Quando
`lot.captionsAuto = true` quando o campeão **não tem legenda queimada**: nenhuma camada `kind: 'caption'` cobrindo ≥ 50 % do tempo de fala (`layerPresence`). O backend calcula na análise e grava no lote (`variation_batches.insight` JSON: `captionsAuto`). Sem coluna nova.
### 2.2 Onde e como (maquina-video)
- **Todas as peças de vídeo do lote** com `captionsAuto`: `CUT`, `REVIEW`, `NATIVE_SEARCH` (`AutoEdit`), `FRAME` (`Moldura`) e `HEADLINE` (`remix-keep`, camada `karaoke`). `STATIC` (imagem) não.
- **Palavras** = transcrição do campeão (`words`), remapeadas pelo `timeline` da peça (CUT corta, então as palavras de trecho cortado saem; emenda movida pro silêncio vale pras palavras também).
- **Estilo padrão do lote** (o mesmo em todas as peças, H5): palavra a palavra com destaque, Montserrat 800, branco com contorno preto, destaque na `brandColor`, 2-4 palavras por página, terço de baixo da área segura.
- **Colisão:** `AutoEdit` = terço de baixo, acima do CTA do formato. `Moldura` = **dentro da `videoBox`**, no terço de baixo dela, fora de todo `slot` de texto da moldura e de `burnedTextBands`. Template sem altura livre ≥ 2 linhas no tamanho mínimo (36 px) = legenda numa linha só com 2 palavras por página; se nem assim couber, sem legenda **naquela** moldura (registrado no render, não falha). `HEADLINE` `add` = embaixo, nunca na faixa nova.
- **CJK (achado do video):** a `Legenda` e o karaokê do `RemixKeep` passam a usar a pilha de fontes com a Noto CJK em fatias (a mesma da `Moldura`, `fontes.ts`). Pra zh e ja: palavras do Whisper **juntadas sem espaço**, quebra de linha por caractere (`word-break: keep-all` só no ko, que tem espaço) e página por nº de caracteres (≤ 8 caracteres zh/ja por página) em vez de palavras. O ko segue as regras latinas.
- O `Player` do web já copia `public/fonts` inteiro (CJK incluso), então a prévia mostra igual.

## 3. Catálogo, contagem, diversidade e custo
### 3.1 Lote (substitui a revisão 25/10 da §6.1 do variacao-auto)
| tipo | eixo | máx. |
|---|---|---|
| `HEADLINE` | ITERATION | 3 (`replace`) ou 2 (`add`) |
| `CUT` | ITERATION | 2 |
| `REVIEW` | DIVERSITY | 1 |
| `NATIVE_SEARCH` | DIVERSITY | 2 |
| `STATIC` | DIVERSITY | 2 |
| `FRAME` | DIVERSITY | 8 (templates diferentes) |
Máximo possível = 18, então o lote de 8 a 12 sempre fecha.
### 3.2 Regra dos 40 %
`DIVERSITY ≥ ceil(0,4 × n)` dá 8 → 4, 9 → 4, 10 → 4, 11 → 5, 12 → 5. Logo ITERATION ≤ n − ceil(0,4n): 8 → 4, 9 → 5, 10 → 6, 11 → 6, 12 → 7. O pior caso de ITERATION é 3 HEADLINE + 2 CUT = 5, que só aperta **no lote de 8** (passa de 4).
**Recomendação (ajuste mínimo, H7): mantém 40 %.** A ia mira lote de 10-12, que hoje é o normal com as molduras. Se sair 8, o reparo determinístico tira primeiro o `CUT-20S` e depois o `CUT-15S`, **nunca o `HEADLINE`** (é a alavanca que o Gusta pediu). A troca do §6.2.4 nunca cria ITERATION.
### 3.3 Custo por peça (estimativa até medir)
| peça | provedor | Lambda (render) | total |
|---|---|---|---|
| `HEADLINE` | US$ 0 (texto sai no `planAutoBatch`, ~US$ 0,002 por headline) | `remix-keep` png crf 10: ~US$ 0,015 (a L3 mede) + composição em CPU na API | **~US$ 0,02** |
| legenda (qualquer peça) | 0 | +2-5 % do tempo de render | ~0 |
| fontes CJK | 0 | bundle maior (já está no site) | 0 |
O `generateEstimateUsd` não muda por causa do HEADLINE (vídeo = 0 no botão, como hoje). O custo do Lambda entra no custo do lote quando o render for pra lá (`render-lambda-v1.md` §10).

## 4. Divisão do trabalho
| agente | entrega | arquivos | depende de |
|---|---|---|---|
| **arquiteto** | migração `ADD VALUE 'HEADLINE'` (`maquina` e `maquina_test`, com backup), tipos (§1.2), `codeFor` EN/PT, `modelo-de-dados.md`, §6.1 do variacao-auto | `api/prisma/`, `contratos/src/`, `api/src/integracoes/contrato.ts`, `docs/` | ok do Gusta |
| **ia** | `planAutoBatch`: escreve as 3 (ou 2) headlines a partir do `headline` do input (limites, nº de linhas, destaque, idioma, fontes por texto); reparo com `headline_too_long`; `describeEdit` confere que a camada de headline traz `fontId`, cor, destaque, peso e alinhamento (sem campo novo); fake com `[mock:headline-none]`, `[mock:headline-over-video]` | `api/src/integracoes/claude/` (auto-plano), `mock/` | tipos |
| **backend** | `allowed` com `HEADLINE` (modo, máx., bloqueios §1.4); `validatePlan` (nada inventado, distintas entre si e da original, limites); reparo que preserva HEADLINE (§3.2); `captionsAuto` no `insight`; monta `HeadlineSpec` e chama `buildHeadlineInput`; formato só no aspecto do campeão; `captionsAuto` repassado pros builders de AUTO e FRAME | `api/src/iteracao/`, `api/src/edicao/` | tipos; `buildHeadlineInput` (video) |
| **video** | `buildHeadlineInput` (§1.3: faixa repintada, placa, faixa adicionada, `fitText` na caixa e nas linhas); legenda no `AutoEdit` e na `Moldura` com as regras de colisão (§2.2); karaokê/legenda CJK (fontes, sem espaço, página por caractere); testes de função pura | `video/src/`, `api/src/render/headline.ts` (novo, como `frame.ts`) | tipos |
| **frontend** | rótulo e i18n do `HEADLINE` (código, "headline original → nova" na peça), formato sem suporte (já existe nas molduras), selo "legenda adicionada" no lote | `web/` | tipos (MSW primeiro) |
| **qa** | casos: faixa sólida (zap, degradê), headline sobre vídeo (placa), campeão sem headline (faixa, desvio do rosto, `no_room`), headline com destaque, campeão zh-TW (Amnayalife) com legenda CJK, `captionsAuto` em CUT/FRAME/REVIEW/NATIVE; critério do remix: PSNR fora da caixa nova ≥ 40 dB contra o campeão, áudio md5 = campeão, nb_frames igual; folha de frames da headline e da legenda (sem fonte de reserva, sem colisão) | `testes/` | tudo acima |

## 5. Ordem
1. Arquiteto: tipos e migração (meio dia, depois do ok).
2. Em paralelo: ia (plano), video (`buildHeadlineInput`, legenda, CJK), frontend (MSW).
3. Backend liga (`allowed`, validação, builder, `captionsAuto`).
4. QA com mock, depois 1 lote real (Lambda, ~US$ 0,30).

## 6. Decisões abertas (com recomendação)
| # | decisão | recomendação |
|---|---|---|
| **H1** | Placa sobre o vídeo: cor | Mediana do fundo dentro da caixa, opacidade 100 %, com cantos. Se a mediana tiver contraste < 3 com a cor do texto original, usa preto (texto claro) ou branco (texto escuro). **28/10 (F11): no `replace` a placa e a faixa repintada são sempre opacas (alpha 1, `rgba`/`#rrggbbaa` medidos viram a mesma cor opaca) e cobrem a caixa da headline original + margem** — com 85 % a headline antiga vazava em cinza. |
| **H2** | Formatos do HEADLINE | Só o aspecto do campeão. Reenquadrar pra outro aspecto mudaria a edição, que é o que o tipo promete não mudar. |
| **H3** | Faixa adicionada colide com o rosto | Desce pra logo abaixo do rosto; se ainda colidir, não oferece (`no_room`), e o lote completa com outro tipo. |
| **H4** | Idioma da headline nova | O da headline original (replace) ou `offer.language` (add). |
| **H5** | Estilo da legenda adicionada | Um estilo único por lote (Montserrat 800, branco com contorno, destaque `brandColor`). Copiar estilo de outra peça não faz sentido, porque o campeão não tem legenda. |
| **H6** | Quantas no campeão sem headline | Exatamente 2 (o mínimo pedido): segura ITERATION ≤ 4 no lote de 8. |
| **H7** | 40 % de diversidade | Mantém; o reparo tira CUT antes de HEADLINE; a ia mira 10-12. |
| **H8** | Enum | Tipo novo `HEADLINE` com migração aditiva. Reusar `HOOK_TEXT` misturaria duas coisas com render, duração e contagem diferentes, e os lotes antigos de `HOOK_TEXT` abririam como headline. |
| **H9** | Headline que se move ou muda de texto no meio (2+ headlines em sequência) | Fora da v1 (`headline_moves`). Conta quantos campeões caem nisso no teste antes de investir. |
