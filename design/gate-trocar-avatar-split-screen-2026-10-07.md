# Gate "Manter a edição" erra o alvo em split-screen — spec do classificador de região

Data: 2026-10-07 · Autor: maquina-ia · Status: **proposta** (contrato só o arquiteto muda; precisa do ok do Gusta antes de qualquer código) · Nada de geração nesta tarefa.
Base: `docs/contratos/feature-2-variar-campeao.md` §13.1, §13.3 item 6, §13.12. Lição da casa: YuNet escolhe rosto **por score (≥ 0,8), nunca por área** (área pega falso rosto); split-screen agrava.

## Decisão em 4 linhas
O gate está rodando `low_confidence`/`no_face` **em toda a trilha de rosto**, inclusive em trechos cuja "região" é um painel de b-roll (rosto escuro/pequeno/virado dentro do painel) — por isso reprova com "Não dá pra manter a edição" exatamente nos timestamps das caixas de split-screen (0:33–0:34, 0:36–0:40, 0:42, 0:45, 0:48–0:49). A §13.12 já consertou isso pra `multiple_faces` e `overlay_over_face` (só contam pro avatar principal), **mas esqueceu `low_confidence` e `no_face`**. A troca É possível: no gancho (0:00) o avatar está em tela cheia e frontal e não há aviso nenhum. Fix = classificar cada trecho (tela cheia / split / b-roll puro) **antes** do gate e avaliar os bloqueios **só na trilha do avatar principal**; painel de b-roll é preservado, nunca reprova.

## 1. Classificador de região por trecho (antes do gate)
Dono natural: `api/src/medicao/` (video), reaproveitando o que já existe — nada novo de ML. Roda sobre a saída de `measureLayout` (já mede **faixas × colunas → `cells`**, §13.1) e da trilha `faceTrack`, mais o `mainSpeaker`/`otherFaces` da visão (§13.12). As entradas "Caixa X% do quadro" do teardown **são** os painéis medidos — os mesmos timestamps do bloqueio. Não inventa medida: classifica o que o `clonar-edicao`/`measureLayout` já apura.

Cada trecho (`FaceTrackSegment`) ganha `regionClass`:
- **`FULL_AVATAR`** — a célula da região = quadro inteiro (`fullFrame: true`) e o rosto detectado cai dentro de `mainSpeaker.box`. É o avatar em tela cheia (ex.: o gancho, 0:00).
- **`SPLIT`** — há ≥ 2 células ocupadas no segmento (faixas/colunas), e uma delas é a caixa do avatar (a que contém o rosto da trilha do principal). A caixa do avatar é a região trocável; as outras células (b-roll/tela/CCTV) são **painel preservado**.
- **`BROLL_ONLY`** — todas as células do segmento são b-roll/screen-recording (painel, tela de app, câmera de segurança) e o(s) rosto(s) ali caem em `otherFaces`, nunca em `mainSpeaker.box`. Nenhuma região trocável.

Como decidir a caixa do avatar dentro do `SPLIT` (reaproveitando o que já existe, em ordem):
1. a célula que contém o centro do rosto da **trilha do avatar principal** em ≥ 80 % das amostras (regra do `faceTrack`, §13.1 item 3);
2. empate/dúvida → a célula cujo rosto cai dentro de `mainSpeaker.box` (a visão é dica, a medição decide — §13.12);
3. rosto de uma célula que só aparece em `otherFaces` (b-roll, CCTV, tela, painel vizinho) **não** vira caixa de avatar, mesmo sendo o único rosto do segmento.

Saída: a trilha do avatar principal = conjunto de trechos `FULL_AVATAR` ∪ (caixa do avatar dos `SPLIT`). Só ela entra no gate e no render.

## 2. Nova regra do gate (o alvo certo)
Regra geral, substitui a avaliação global do §13.3 item 6: **todo bloqueio de "mantém a edição" é avaliado SÓ na trilha do avatar principal.** Harmoniza `low_confidence`/`no_face` com o que a §13.12 já fez pra `multiple_faces`/`overlay_over_face`.
- **`low_confidence`** — só bloqueia se o YuNet ficar abaixo de 0,8 em > 20 % das amostras **da caixa do avatar principal** no trecho. Rosto escuro/pequeno/virado **dentro de painel de b-roll** (`BROLL_ONLY`, ou célula não-avatar de um `SPLIT`) → vai pra `otherFaces`, **não reprova** (não vai ser trocado).
- **`no_face`** — só se **nenhum** trecho tiver avatar principal (`FULL_AVATAR` ou caixa de avatar em `SPLIT`). Vídeo que é só b-roll com rostos incidentais = `no_face` legítimo (não há quem trocar).
- **`multiple_faces`** / **`overlay_over_face`** — como a §13.12 já definiu (2+ rostos persistentes **dentro da mesma caixa** do avatar; overlay cobrindo ≥ 20 % dos frames **do rosto do principal**). O classificador só deixa explícito que a "caixa do avatar" num `SPLIT` é a unidade de referência.
- **Split-screen = trocar só dentro da caixa do avatar, preservar o resto.** Já é o comportamento do render `remix-keep` (§13.3 item 4-5: a região do avatar recebe o clipe novo via `fitCrop`; célula fora da região fica intacta, PSNR ≥ 40 dB contra o campeão, §13.9). O fix é só não **reprovar** antes de chegar lá.

## 3. Como volta pra UI
Forma atual (api.md §822): `keepEdit: { SWAP_AVATAR: KeepEditAvailability }`, com `KeepEditAvailability = { available, blockers: [{ reason, startSec, endSec }] }`. O caso descrito passa de `available: false` (+ "Não dá pra manter a edição") para `available: true` com os painéis sinalizados como preservados. Proposta **aditiva** (não quebra quem já lê o shape; o arquiteto decide o nome):
```ts
// aditivo em KeepEditAvailability
preserved?: { startSec: number; endSec: number; cells: number }[];  // painéis de b-roll que ficam intactos
swapBoxes?: { startSec: number; endSec: number }[];                 // trechos com caixa de avatar trocável
```
UI: selo **verde** com a nota "**painéis preservados, avatar trocado nas caixas X/Y**" (X = nº de trechos `SPLIT`/`FULL_AVATAR` trocáveis, Y = total de trechos com painel). Sem `swapBoxes` = comportamento de antes. Os timestamps 0:33–0:49 aparecem como **preservados**, não como bloqueio. `blockers` só carrega o que de fato impede a troca do avatar principal.

## 4. Riscos, limites e o que testar (sonda barata antes de geração cara)
- **Risco 1 — classificação errada da caixa do avatar no `SPLIT`:** se o avatar aparecer espremido e escuro numa caixa pequena, o YuNet pode cair abaixo de 0,8 e virar `low_confidence` legítimo (aí o bloqueio está certo — a troca ficaria ruim). Limite: decidir a caixa por **score + `mainSpeaker.box`**, nunca por área (lição YuNet); registrar o score mediano da caixa do avatar no `EditMap` pra auditar.
- **Risco 2 — avatar que migra de célula** (tela cheia num trecho, caixa noutro): já coberto pela trilha do principal (§13.12 "a mais persistente"); o classificador precisa costurar os trechos pela mesma identidade, não por célula.
- **Risco 3 — b-roll com rosto grande e nítido** (ex.: depoimento dentro do painel) que a visão marque como `mainSpeaker` por engano: a medição decide (trilha do principal), a visão é só dica; manter assim.
- **Testes (tudo mock/local, grátis — `MediaAnalysisService` roda de verdade em mock, §4.4):**
  1. Fixture que já existe `testes/fixtures/campeoes/` (com fala e split screen) + criar uma variante com rosto escuro/virado **dentro do painel** de b-roll: asserir `regionClass` por trecho, `keepEdit.SWAP_AVATAR.available = true`, `preserved[]` com os timestamps dos painéis, `blockers` vazio.
  2. Fixture só-b-roll (rostos incidentais, nenhum avatar) → `no_face` legítimo, `available: false`.
  3. Fixture avatar em caixa pequena e escura (score < 0,8 > 20 % na caixa do avatar) → `low_confidence` legítimo, `available: false`.
  4. Regressão: o gancho em tela cheia (`FULL_AVATAR`, frontal) nunca gera blocker.
- **Sonda paga (só com ok do Gusta, valor avisado antes):** `describeEdit` no campeão real `zap-working-late-v2-latino.mp4` (~US$ 0,12, Claude com visão, §13.2) pra conferir `mainSpeaker`/`otherFaces` nos painéis. **Nenhuma geração de Pruna/Soul nesta validação** — o classificador e o gate são medição + regra, grátis. Geração cara (Trocar avatar ~US$ 0,78) só no Q8/F2-G4b, já orçada, com ok do Gusta.
- **Donos sugeridos (arquiteto roteia):** video (`regionClass` no `faceTrack`/`measureLayout`), backend (gate em `campeoes/` lê só a trilha do principal; `preserved[]`/`swapBoxes` no `keepEdit`), ia (`describeEdit` já entrega `mainSpeaker`/`otherFaces`), frontend (selo verde + nota), qa (as 4 fixtures). É **mudança de contrato** (campos aditivos em `KeepEditAvailability` + `regionClass` no `FaceTrackSegment`) → só o arquiteto aplica, depois do ok do Gusta.
