# Templates Versus (Ruim/Bom) e Value stack (Lista que Cresce) · 2026-11-04
Dono: maquina-design · Status: **proposta, aguarda o Gusta ver o protótipo** · Nada de código antes do ok.
Protótipo: https://claude.ai/artifact/MtagqbYZzAxUWr6k2cMGUP (fonte `design/mockup-templates-ruimbom-lista.html`; usa `design/exemplos-templates/2026-11-04/avatar-falando.mp4`).
Origem: Gusta aprovou prototipar o #1 e o #2 do ranking de `research_notes/fabrica-anuncios-formatos-2026-11-04.md`. O acervo é de produto pago de terceiros: só a **estrutura** foi usada (lista que enche sincronizada à fala; duas colunas de contraste). Layout, cores, tipografia, nomes e textos são do HookMill (curvas e fontes de `video/src/templates/comum.tsx`, padrão visual do `PersonMotion`).

## 1. Problema e decisão
- **Problema:** o catálogo de Edição não tem formato que organize o argumento na tela. Os 18 de moldura mudam a embalagem e o `person-motion` troca o vídeo inteiro por um palco. Falta o overlay que acompanha a fala do próprio anúncio e deixa o resumo na tela.
- **Decisão:** **um motor, dois templates.** Componente único de "lista sincronizada" (`ListOverlay`) com os modos `two-col` (card **Versus**) e `stack` (card **Value stack**). O vídeo do cliente fica inteiro e em tela cheia; a lista vive no espaço livre entre o queixo e a legenda queimada, e só quando esse espaço não existe o vídeo encolhe pra baixo de uma faixa no topo.
- **Por quê:** (1) a pessoa continua falando, ninguém regrava e o custo é só render; (2) o espaço entre rosto e legenda é a área morta de quase todo UGC (o peito/fundo), então o overlay não briga com rosto nem legenda, que era o risco médio-alto do ranking; (3) um motor = um conjunto de testes, uma função de posicionamento e um contrato.

## 2. Nome, catálogo e preço
| | Versus | Value stack |
|---|---|---|
| slug / templateId | `versus` | `value-stack` |
| nome EN / PT | Versus / Versus | Value stack / Pilha de valor |
| descrição EN | Two columns fill line by line as you talk: what people put up with, and what your offer does instead. | Each benefit lands as a bar when it's said and stays. Ends on your price and call to action. |
| descrição PT | Duas colunas enchem linha a linha no ritmo da fala: o que as pessoas aguentam hoje e o que a sua oferta faz no lugar. | Cada benefício vira uma barra quando é dito e fica. Termina no preço e na chamada. |
| out | 1 vídeo · 9:16 (+ 4:5 e 1:1 grátis) | idem |
| tier / créditos | EDIT · **1** | EDIT · **1** |
| needs | `speech`, `min_12s` | `speech`, `min_12s` |
| tipo interno | `LIST_OVERLAY` + `templateId` (registro `video/src/templates/`, como `CHAT_DM`/`PERSON_MOTION`) | idem |

- **Categoria (decisão pro Gusta):** recomendo o chip **`frames`** na galeria. Pra quem usa, é "texto por cima do meu vídeo", que é o que as molduras são. Por dentro **não** é `FRAME:<id>`, porque o motor de molduras não tem linha do tempo por item. Alternativa: categoria nova `lists` (Lists / Listas), que só faz sentido se vierem mais formatos de lista (o Canvas, #3 do ranking, poderia entrar).
- **Custo real estimado por uso:** plano (Claude escolhe e escreve as linhas, 1 `planAutoBatch` com o tipo travado) ≈ US$ 0,02–0,05 + render Lambda ≈ US$ 0,01–0,02 por formato + checagem de legenda por visão US$ 0,008 quando há legenda queimada. Total ≤ US$ 0,09, igual aos outros de Edição, então **1 crédito** fecha com a regra de 31/10.
- Rosto **não** é obrigatório: sem `faceTrack`, a zona livre começa em 45 % da altura.

## 3. Layout
Coordenadas em px da saída (largura 1080). Vale pros dois modos; só o conteúdo do painel muda.

### 3.1 Posicionamento (função pura `posicionarLista`, no `video/lib`)
Entrada: formato, `faceSafeBand` (rosto, px da fonte), `protectedBands` (`legenda-protegida-v1`), altura mínima do conteúdo (`need`). Saída: `mode`, transformação do vídeo e retângulo do painel.

1. **`body` (padrão).** O vídeo fica em cover como hoje (rev. 29/10: pode cortar um pouco, nunca a legenda nem o rosto). A zona livre é:
   - legenda **abaixo** do rosto: do queixo + 30 px até o topo da faixa protegida − 20 px;
   - legenda **no meio** (encosta no rosto): do fim da faixa + 20 px até o limite de UI de baixo;
   - **sem legenda:** do queixo + 30 px até o limite de UI de baixo.
   Se a zona ≥ `need`, o painel ocupa largura 968 px (margem 56) e altura `min(zona, need × 1,45)`, centrado na zona.
2. **`top` (reserva).** Zona < `need`: painel no topo (y = 170 em 9:16, 50 em 4:5) com altura `need × 1,3`; o vídeo entra numa caixa embaixo, encolhido até rosto + legenda caberem inteiros (`enquadramentosPreservandoLegenda`), fundo `#0B0A10` com a grade de pontos nas sobras.
3. **`side` (só 1:1).** Vídeo numa caixa de 600 px à esquerda, enquadrado no rosto e na legenda; painel à direita (x 630, w 410, altura toda menos 70 em cima e embaixo). Versus vira 1 coluna.
4. **Sem lugar:** se no `top` a escala do vídeo ficar < 0,6, o template sai do plano com `burned_captions` (regra de 28/10). O "Generate anyway" de 29/10 vale aqui também.

| | `need` (px) | Limite de UI (topo / base) |
|---|---|---|
| Versus 2 col | 60 cabeçalho + 12 + 3 × 64 + 2 × 10 = **284** | 9:16: 200 / 340 |
| Versus 1 col | 6 × 54 + 5 × 8 = **364** | 4:5: 60 / 110 |
| Value stack | 48 título + 12 + 5 × 56 + 4 × 8 = **372** | 1:1: 50 / 50 |

Com o avatar do Pocketwise (rosto 280–1010 px, legenda baixa 1520–1640, faixa ±77): zona = 383 px → os três cabem em `body` no 9:16. Legenda no meio → zona 273 → `top`. 4:5 com legenda baixa → Versus 2 col cabe (342), Value stack vai pro `top`. Tudo isso dá pra ver no protótipo com "Guides" ligado.

### 3.2 Versus (`two-col`)
- **Cabeçalho:** 2 pílulas (altura `min(84, 19 % do painel)`, Montserrat 900 caixa alta, ✕ / ✓ desenhados). Esquerda vermelho `#FF4D4D`, direita verde `#3BE38B` (as cores do `comum.tsx`).
- **Linhas:** 3 por coluna (4 se a zona ≥ 480 px). Célula com ícone + texto Inter 800, raio 22, padding 22, altura `min(140, (painel − cabeçalho − gaps) / 3)`, fonte `clamp(30, altura × 0,36, 52)`, até 2 linhas. O texto da esquerda recebe um risco.
- **1 coluna (mesmo template, opção "1 column" e forçado no 1:1):** sem cabeçalho, 6 linhas na ordem do tempo; ✕ riscada, ✓ normal.

### 3.3 Value stack (`stack`)
- **Título** (Montserrat 900 caixa alta, altura `min(72, 13 % do painel)`).
- **Até 5 barras:** até 3 itens numerados + 1 de prova (✓) + **preço** (ícone de etiqueta, destaque) + **CTA** (seta pra baixo, pulsa). Altura `min(118, (painel − título − gaps) / 5)`, fonte `clamp(26, altura × 0,40, 48)`, 1–2 linhas. Sem preço na oferta, a barra de preço some e entra mais 1 item.

### 3.4 Variações de cor (`look`)
| look | Versus | Value stack |
|---|---|---|
| `ink` (padrão) | célula `rgba(20,18,28,.92)` com borda 3 px vermelha/verde; cabeçalho sólido | barra escura com borda; prova com borda verde; preço branco; CTA na cor da marca |
| `paper` | célula branca com sombra, esquerda em cinza riscado de vermelho | barra branca; preço amarelo `#FFE14D`; CTA preto |
| `brand` | esquerda cinza apagado; direita sólida na **cor da marca** (`coresDaMarca`, legível no escuro) | 3 tons da cor da marca; preço branco; CTA em contraste (`contraste()` do `lib/cores`) |
A cor da marca vem do `workspace.brandColor`. No protótipo: azul de exemplo `#3B5BFF`.

## 4. Tempo e easing
- **Entrada de cada linha:** `at = início da palavra-âncora − 0,10 s`. Mola do `entrada()` (stiffness 170, damping 16, mass 0,7), sobe 40 px, escala 0,9 → 1, opacidade em meia mola (`surge`).
- **Ícone:** traço desenha em 0,30 s a partir de `at + 0,05`. **Risco** da esquerda: 0,25 s a partir de `at + 0,35`.
- **Barra:** cresce da esquerda (`scaleX`, 0,35 s, ease-out cúbico); texto aparece em `at + 0,12` (0,2 s).
- **Destaque:** a linha mais nova brilha por 1,2 s (anel claro de 6–8 px). Nada sai até o fim; no último terço a tabela inteira é o resumo.
- **Preço:** pop de +6 % na entrada. **CTA:** pulso de 2,5 % depois de 0,5 s (como o `BotaoCTA`).
- **Cabeçalhos/título:** entram junto da primeira linha do lado deles (Versus: a esquerda com a 1ª fala sobre a alternativa, a direita no "this one"/nome do produto).
- **SFX** (se `sfx` ligado): `pop` em cada linha (volume 0,35), `ding` no preço e no CTA.
- **Ordem no Versus:** `by_speech` (padrão): cada coluna enche quando a fala trata daquele lado, como no exemplo. `alternate` (par a par, distribuído nos primeiros 70 % do vídeo) quando a fala não separa os lados.
- **Duração:** a do vídeo. Linha sem palavra-âncora entra na maior pausa livre ≥ 0,4 s entre a âncora anterior e a seguinte; sem pausa, no meio do intervalo.

## 5. Regras de texto
| peça | máx. caracteres | linhas | de onde vem |
|---|---|---|---|
| Cabeçalho esquerdo (Versus) | 14 | 1 | alternativa citada na fala ("budget apps") ou rótulo do template traduzido ("Other ways"/"Outros jeitos") |
| Cabeçalho direito | 14 | 1 | `offer.name` encurtado |
| Célula Versus | 24 | 2 | par erro → acerto: esquerda de `pains` + transcrição; direita de `promise`, `what`, `proof` + transcrição |
| Título (Stack) | 18 | 1 | rótulo do template traduzido ("What you get"/"O que você leva") ou o da fala ("3 reasons…") |
| Barra item | 30 | 2 | benefícios ditos na fala; completa com `promise`/`what` |
| Barra prova | 30 | 2 | número dito na fala **e** presente em `proof` (nada inventado: o número tem que estar em um dos dois) |
| Barra preço | 34 | 2 | `offerAndPrice` (só ele; sem preço na oferta, a barra não existe) |
| Barra CTA | 22 | 1 | `cta` da oferta, ou a frase de CTA da fala |
- Versus: **3 pares** (mín. 3, máx. 4). Value stack: **3–5 itens** + preço + CTA (máx. 6 barras com título, 5 no 9:16 com legenda baixa).
- Idioma = idioma do anúncio (`screenLanguage`), como os outros templates. Fontes do bundle com Noto CJK por baixo.
- Mesma validação "nada inventado" do plano: cada linha guarda `source: 'transcript' | 'brain' | 'both'`, `field` (pains/promise/proof/offerAndPrice/cta) e `anchor` (`wordIndex` ou null). Texto acima do máximo: o `fitText` encolhe até o piso; abaixo do piso, o plano reescreve (1 tentativa) ou corta a linha.
- **Fit duro:** menos de 2 momentos de lista na fala **e** Brain sem `pains`/`promise` suficientes → `blockedReason: 'no_list'` (novo). Com Brain suficiente, o plano completa e a tela mostra o aviso "Too few items" com "Fill from Brain" (estado do protótipo).

## 6. Desvio de legenda
- Usa `protectedBands` (união, com a folga de 4 %/2 % e a linha extra) e `faceSafeBand`. O painel nunca cruza nenhum dos dois, em nenhum instante.
- `checarLegendaProtegida(input)` ganha o painel como elemento (retângulo por instante: só conta a partir do `at` da 1ª linha).
- Depois do render, a checagem por visão (Haiku, §4.2 do contrato) roda como em qualquer peça com legenda queimada.
- Sem `protectedBands`: o painel pode descer até o limite de UI de baixo.
- Legenda nossa (`captionsAuto`): **não** entra nestes templates na v1. O texto na tela já é o resumo da fala; legenda + lista no mesmo espaço fica poluído. Se o Gusta quiser, a legenda entraria acima do painel com o mesmo cálculo de zona (fica pra depois).

## 7. Formatos
| formato | modo padrão | observação |
|---|---|---|
| 9:16 | `body`, reserva `top` | caso principal |
| 4:5 | `body` (escala do vídeo ≤ 1 até rosto + legenda caberem), reserva `top` | Value stack com legenda baixa costuma ir pro `top` |
| 1:1 | `side` | Versus vira 1 coluna; Stack sem mudança |
4:5 e 1:1 não cobram crédito (como hoje).

## 8. Estados na tela (galeria, plano, gerar)
| estado | onde | comportamento |
|---|---|---|
| Card na galeria | Templates | vídeo de exemplo (gerar com o avatar Pocketwise e subir pelo Admin), "Edit · 1 credit", "Fits" quando o anúncio já lido tem fala ≥ 12 s |
| Escrevendo as linhas | Plan | etapas reais (transcrição lida ✓, escolhendo 3 pares/itens, ajustando ao espaço), skeleton das linhas, "grátis até Generate, pode sair". ~10 s |
| Pronto | Plan | prévia + tabela "At · Line · From": tempo clicável (pula o vídeo), campo editável com contador `n / máx`, etiqueta da fonte (Transcript / Brain › campo / os dois) e a citação |
| Poucos itens | Plan | âmbar: "This ad has only one list-like moment…" + **Fill from Brain** (lima) / Pick another template |
| Sem lugar | Plan | âmbar suave (`burned_captions`): Upload the version without captions (lima) / Generate anyway / Pick another template |
| Gerando / Download | iguais aos outros templates | |
Componentes shadcn: `Tabs` (os 2 templates no detalhe), `ToggleGroup` (layout, look, formato), `Input` (linhas), `Badge` (fonte, preço), `Alert` (avisos), `Skeleton`, `Progress`, `Slider` (scrub da prévia), `Button` (lima só na ação da tela). Reusar `FlowBar`, `IterActionBar` e o player da prévia do Iterate.

**Responsivo (provado no protótipo em 390 px):** player em cima, largura até 400 px e altura ≤ 60 % da tela; controles em grade que vira 1 coluna; a tabela de linhas mostra a fonte embaixo do texto; toques ≥ 32 px nos segmentados.

## 9. O que cada agente implementa
**maquina-video**
1. `video/src/templates/ListOverlay.tsx` (registro em `templates/registro.tsx`, ids `versus` e `value-stack`): vídeo do campeão em tela cheia (ou caixa, no `top`/`side`) com áudio, painel por cima, todas as animações da §4 com `surge`/`entrada`/`Icone`/`Sfx` do `comum.tsx`.
2. `video/src/lib/listaOverlay.ts`: `posicionarLista(...)` (§3.1, função pura com testes: sem legenda, legenda baixa, legenda no meio, legenda que muda de lugar, sem rosto, 3 formatos) e o layout medido de cada célula/barra (`fitText` com os máximos da §5).
3. `checarLegendaProtegida` reconhece o painel.
4. Render dos 2 vídeos de exemplo com o avatar Pocketwise (9:16, 19,7 s) pra subir pelo Admin.

**maquina-ia**
1. `planAutoBatch` com `allowed: ['LIST_OVERLAY']` e `templateId`: schema de saída `{ mode, order: 'by_speech' | 'alternate', heads?: [string, string], title?: string, items: { side?: 'bad' | 'good', kind: 'item' | 'proof' | 'price' | 'cta', text, source, field, anchorWordIndex | null }[] }`.
2. Prompt: pares erro → acerto a partir de `pains` × `promise/what/proof` e da transcrição; preferir a frase dita (âncora) a texto do Brain; número só se estiver na fala ou em `proof`; preço só de `offerAndPrice`; máximos da §5 por peça; idioma da tela.
3. Validação "nada inventado" (números e preço) e o fake com `[mock:list-thin]` pro estado "Too few items".

**maquina-backend** (pra o arquiteto pôr no contrato antes): 2 linhas na tabela `Template` (§2), `LIST_OVERLAY` no enum, `no_list` em `BlockedReason`, cálculo dos tempos (âncora → segundos pelo `timeline`, pausas pra linhas sem âncora), `PATCH` das linhas no plano (grátis) e a mesma cobrança de 1 crédito.

**maquina-frontend:** só o que já existe no fluxo de templates (galeria, plano com a tabela de linhas, avisos); nada de tela nova.

## 10. O que a tela pede à API
| tela | precisa |
|---|---|
| Galeria | `GET /templates` com os 2 novos (exampleUrl, posterUrl, credits, needs, fit) |
| Plan | plano com `items[]` (texto, `at` em segundos, `source`, `field`, citação da fala), `mode`, `look`, `placement` (`body`/`top`/`side` + motivo) pra mostrar "Placement" · `PATCH` de texto e de look · `fit` com `no_list`/`burned_captions` |
| Prévia no Plan | URL do campeão + os mesmos props do render (a prévia é o componente rodando no navegador via `@remotion/player`, como o editor) |

## 11. Decisões pro Gusta
1. **Um motor, dois cards** (Versus 2 col / Value stack 1 col), 1 crédito cada. Recomendo sim.
2. **Nomes:** Versus / Versus e Value stack / Pilha de valor.
3. **Categoria:** `frames` na galeria (recomendo) ou categoria nova `lists`.
4. **Posição padrão = zona entre queixo e legenda**, faixa no topo só como reserva. Recomendo sim.
5. **Sem legenda nossa** nestes dois na v1. Recomendo sim.
