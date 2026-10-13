# Variar campeão (feature 2): spec de UX/UI
Data: 2026-10-06 · Status: **v2 com as respostas do Gusta (06/10)**. Mockup ainda precisa do OK final dele antes de virar código.

> **Respostas do Gusta (06/10), já aplicadas:**
> 1. Criativo de terceiro **não trava nenhum tipo**. A pergunta de dono vira um checkbox simples ("Este criativo é meu"), só como declaração e sem verificação.
> 2. A análise roda logo depois do upload, com o **preço no botão** ("Analisar · US$ 0,12", valor placeholder). É uma exceção aprovada à regra da v1 de não pôr custo em botão.
> 3. Limites por lote: 4 ganchos e 5 copies.
> 4. O tipo 3 (copy nova) fica **"Em breve"** até depois de 10/10. O card continua na tela, tracejado, com checkbox desabilitado e fora da contagem, da estimativa e do lote.
Mockup navegável: https://claude.ai/artifact/PVhu6VW1b85mfojkPmdkzd · fonte: `projects/maquina-anuncios/design/mockup-variar-campeao.html` (atualize SEMPRE este arquivo pra o link não mudar)
Base: `wizard-v1-2026-10-05.md` (tokens, componentes, regras da validação F2). Método: `.claude/skills/esteira-spy/SKILL.md` + `_shared/templates/teardown-criativo.md`.

> Dados do mockup são exemplo (Orbit Budget, Penny Pilot). Preços são placeholders: quem manda é o `estimate` da API.

## 1. Problema
A pessoa tem um criativo que já vende e quer mais peças dele sem perder o que funciona. Há três riscos de UX. O primeiro é a pessoa não entender por que o original vende e variar a coisa errada. O segundo é gastar sem ver o custo do lote. O terceiro é publicar imagem ou voz de outro anunciante.

## 2. Decisões e porquê
1. **Onde mora.** Fica no botão "Variar campeão" ao lado de "Novo criativo" no Início e no botão "Variar" em todo card da Biblioteca. O Início é onde a pessoa começa trabalho novo, e a Biblioteca é onde estão os vencedores. Vindo da Biblioteca, a origem já vem preenchida, o dono é "meu" e não há upload.
2. **Mesmo shell do wizard v1:** trilho lateral com 6 etapas (Campeão → Diagnóstico → Variações → Ganchos → Estimativa → Lote), barra "Etapa N de 6" no mobile e barra de ação fixa. "Ganchos" aparece como *pulada* (ícone tracejado, desabilitada) quando o tipo 2 não foi marcado.
3. **Dono é um checkbox de declaração** ("Este criativo é meu"), que começa marcado. Ele não trava nada: só fica gravado no lote e aparece no trilho ("Dono: Você/Terceiro"). Vindo da Biblioteca o checkbox não aparece, porque o criativo é do workspace.
4. **Nenhum tipo é travado por dono** (decisão do Gusta, 06/10). A UI não tem estado de "indisponível pra terceiro".
5. **O diagnóstico tem dois níveis.** "Por que vende" fica sempre aberto no topo, com 3 a 5 causas em ordem de peso. Embaixo vêm as outras seções em acordeão, com resumo de uma linha. Toda seção tem "Editar", e o que foi corrigido ganha a tag "Editado"; as variações usam a versão corrigida. Os "sinais de escala" do template viram a linha de fatos do cabeçalho; com criativo de terceiro, entra junto o aviso de que dia no ar não é resultado.
6. **Linha do tempo de blocos embaixo do player.** A largura de cada bloco é proporcional à duração, os tracinhos marcam os cortes e o playhead acompanha o vídeo. Tocar num bloco leva o vídeo até o início dele e abre o painel do bloco, onde a função (Gancho/Problema/Mecanismo/Prova/CTA) pode ser corrigida num `Select`.
7. **Os tipos 1 e 4 são quantificados por seleção, e os tipos 2 e 3 por stepper.** No 1 é um rosto por variação (o original aparece esmaecido), e no 4 é um layout por variação (o atual vem desabilitado). Nos tipos 2 (1 a 4) e 3 (1 a 5) a quantidade é um número.
8. **O tipo 3 está "Em breve" (depois de 10/10).** Quando sair, cada variação vira um criativo em "Esperando você" com 3 roteiros modelados no campeão, e rosto, motor e custo do vídeo são escolhidos no wizard v1. Na Estimativa ele vai entrar só pelo custo dos roteiros. Enquanto isso, o card existe com a tag "Em breve" e o resumo mostra "em breve".
9. **Custo aparece em dois lugares:** no botão "Analisar · US$ X" (pedido do Gusta) e na Estimativa do lote. Ela mostra uma tabela por tipo (qtd, unitário, tempo, subtotal), o total e a barra de gasto do mês contra o teto. Quem dá o OK explícito é o botão "Aprovar e rodar o lote". Se o lote passar do teto, aparece um `Alert` destrutivo e o botão fica desabilitado.
10. **O Lote é a tela de Geração da v1, agrupada por tipo.** Cada linha tem miniatura, nome, o que mudou, status e ação: *Revisar* se está pronta, *Abrir no wizard* se espera roteiro, *Refazer* se falhou (com o motivo em vermelho antes da ação). Border Beam e Image Generation só aparecem na linha que está gerando.
11. **A revisão é o OK final da v1** com um controle a mais: o segmented "Variação | Original" acima do player, pra comparar sem sair da tela. Aprovar leva pra Biblioteca com anel verde e o selo "Variação".
12. **Na Biblioteca**, o filtro é Todos / Originais / Variações. O card de variação traz o selo "Variação" na miniatura e a linha "↳ Variação de <campeão> · <tipo>", e o original mostra "N variações".

## 3. Tokens
Os mesmos de `wizard-v1-2026-10-05.md` §3, sem nenhum token novo. As amostras de cor do diagnóstico (`#F5F5F0` etc.) são **dado do vídeo**, não cor de UI.

## 4. Componentes
| Peça | shadcn | Reaproveita da v1? |
|---|---|---|
| Shell, header, abas, trilho, barra "Etapa N de 6", actionbar | os mesmos | **sim** (o trilho aceita um estado `skipped`) |
| Seleção da oferta | `Select` + `Button` outline "Nova oferta" | novo uso |
| Upload | **novo `VideoDropzone`** (input file nativo + drag-and-drop) + `Progress` | novo |
| Link da Ad Library | `Input` + `Button`, checklist da v1 | sim (o padrão "Ler página" da Oferta) |
| Dono | `Checkbox` + label e descrição | novo uso |
| Tipo "Em breve" | `Card` tracejado + `Checkbox` disabled + `Badge` "Em breve" | novo |
| Player | `VideoPlayer` da v1 | sim |
| Linha do tempo de blocos | **novo `BlockTimeline`** (botões flex proporcionais + playhead + ticks de corte) | novo |
| Painel do bloco | `Card` + `Select` da função | novo, simples |
| Por que vende | `Card` com `ol` numerada | novo |
| Seções do diagnóstico | `Accordion` type multiple; edição inline com `Textarea` + Salvar/Cancelar | padrão de edição dos Roteiros |
| Tipo de variação | `Card` + `Checkbox` + tags Mantém/Novo (`Badge` outline) | novo `VariationTypeCard` |
| Quantidade | **novo `Stepper`** (`ButtonGroup` com −/+ e `output` mono) | novo |
| Rostos | grade compacta de toggles (`Toggle` com check) | parecida com o Avatar |
| Layouts | toggles com miniatura (mesmo desenho dos templates do Edit) | sim (`.tpl`) |
| Gancho | card igual ao do Roteiro: bloco falado em destaque + `dl` com texto na tela, primeiro frame e "depois" | sim (`ScriptCard`) |
| Estimativa | `Table` (vira linha empilhada abaixo de 760 px) + barra de teto | novo `BatchEstimate` |
| Linhas do lote | as linhas de cena da Geração | sim |
| Comparar | `ToggleGroup` single | sim |
| Erros | `Alert` destrutivo; espera com `ThinkingOrbs` + checklist | sim |

## 5. Telas e estados
Rotas sugeridas: `/variations/new`, `/variations/:batchId/{teardown,types,hooks,estimate,batch}`. A revisão é `/creatives/:id/final` (a da v1).

1. **Campeão.** É composto por oferta (Select), origem (dropzone **ou** link) e o checkbox "Este criativo é meu". O primário "Analisar · US$ 0,12" habilita assim que o upload termina e começa a análise na hora.
   - *Vazio:* o dropzone (MP4/MOV, até 500 MB e 3 min, que são limites a confirmar com o back), "ou" e o link. O botão Analisar fica desabilitado.
   - *Enviando:* linha do arquivo com %, MB e tempo restante, mais Cancelar.
   - *Lendo link:* checklist (abriu o anúncio, baixando o vídeo, copiando o texto).
   - *Link falhou:* `Alert` com o motivo real (limite do leitor, volta em 19/10) e o passo a passo pra baixar o vídeo. O dropzone fica em destaque e "Enviar o arquivo" vira primário. O link fica salvo como origem.
   - *Pronto:* arquivo com miniatura, duração, formato, resolução e tamanho, mais Trocar.
   - *Da Biblioteca:* card do vencedor, sem o checkbox de dono e com o diagnóstico rápido.
2. **Diagnóstico.**
   - *Analisando:* o player mostra "Lendo frame X / 870". Ao lado vêm o orb, o progresso e o checklist em 5 etapas reais (recebido, transcrito, frames-chave, blocos/layout/cortes, por que vende), com o detalhe em mono. As seções aparecem como esqueleto; a transcrição já aparece preenchida porque fica pronta antes. Pode sair da tela.
   - *Pronto:* player + linha do tempo + painel do bloco à esquerda (sticky no desktop); fatos + Por que vende + acordeão à direita. "Analisar de novo" fica no cabeçalho.
   - *Erro:* motivo humano (vídeo sem faixa de áudio), checklist mostrando onde parou e as ações "Enviar outro arquivo" / "Tentar de novo".
3. **Variações.** Os 4 cards + o resumo "Este lote" (no mobile, embaixo). O dono não muda nada aqui. O tipo 3 aparece "Em breve" (tracejado, checkbox desabilitado). Continuar vai pra Ganchos se o tipo 2 estiver marcado e, se não, pra Estimativa. Fica desabilitado com 0 variação.
4. **Ganchos.** O gancho original vem primeiro, tracejado, como referência. Cada gancho novo tem Editar (fala, texto na tela e primeiro frame), Reescrever (só aquele), Remover e "Escrever mais um" (até 4). *Escrevendo:* orb + checklist + streaming do gancho em curso + esqueleto.
5. **Estimativa.** *Pronto:* tabela, total e barra de teto. *Passa do teto:* `Alert` destrutivo com "Mudar variações" / "Aumentar o teto", e o botão de rodar desabilitado.
6. **Lote.**
   - *Em andamento:* título com contagem real, ETA, "pode fechar", grupos por tipo e Revisar já liberado nas variações prontas.
   - *Uma falhou:* motivo + Refazer na linha.
   - *Tudo pronto:* barra verde, tempo total e custo gasto.
   - Quando o tipo 3 sair, as variações dele vão ficar em "Escolher roteiro → Abrir no wizard".
7. **Revisão** (OK final da v1): Variação/Original, nome, linha "Variação de…", fatos com o custo real, e Pedir ajustes / Aprovar. Pedir ajustes tem 3 caminhos fechados: refazer a variação, mudar o texto do gancho, mudar legenda/CTA.
8. **Início:** botão novo + cards do lote e das variações em "Esperando você" + linha de variação na lista, com a linha "↳ Variação de…".
9. **Biblioteca:** filtro Originais/Variações, botão Variar em todo card, selo e linha de variação.

## 6. Responsivo
Os breakpoints são os da v1.
- **≤ 900 px:** o Diagnóstico vira coluna única (player → timeline → bloco → fatos → seções), o painel do player deixa de ser sticky e o resumo das Variações e da Estimativa desce pra baixo.
- **≤ 760 px:** o acordeão põe o resumo numa segunda linha; a tabela da Estimativa vira "nome + subtotal / tempo / nota"; as linhas do lote passam a ação pra baixo; a grade de rostos tem 5 colunas compactas e a de layouts, 3.
- Todas as ações existem em 390 px, inclusive o upload (o input file abre a galeria do celular).

## 7. Idioma
O mockup abre em PT, como a v1. Termos em PT: Variar campeão, Campeão, Diagnóstico, Variações, Ganchos, Estimativa, Lote, Variação de…, É meu / De outra pessoa. Em EN: *Vary a winner, Winner, Teardown, Variations, Hooks, Estimate, Batch, Variation of…* O conteúdo gerado (ganchos, roteiros) segue o idioma da oferta escolhida, não o do campeão.

## 8. O que o frontend precisa da API
| Tela | Leitura | Escrita | Tempo real |
|---|---|---|---|
| Campeão | `GET /offers`; se veio da Biblioteca, o criativo de origem; `GET …/analysis-estimate` → preço do botão Analisar | `POST /uploads` (URL assinada, progresso no cliente); `POST /champions {offerId, source: upload\|adLibrary\|creative, url?, uploadId?, creativeId?, declaredOwn: boolean}` → a análise começa já | job do link: etapas + erro com `reason` e `retryAt` |
| Diagnóstico | `GET /champions/:id/teardown` → fatos, `blocks[{fn,start,end,spoken,onScreen,shows}]`, `cuts[]`, `verdict[]`, `sections[{id,title,summary,text,extra,edited}]`, URL do vídeo | `PATCH …/teardown/sections/:id {text}`, `PATCH …/blocks/:i {fn}`, `POST …/teardown:rerun` | etapa atual (1–5), %, frame X/N, ETA; seções chegando parciais; erro com `reason` |
| Variações | `GET …/variation-options` → tipos com `available` (false + `comingSoon` pro tipo 3 até ele sair), rostos sugeridos, layouts com miniatura e `requires` (ex.: insert de tela) | `PUT /batches/:id/plan {types:{avatar:{faceIds}, hooks:{count}, copy:{count}, layout:{layoutIds}}}` | progresso dos rostos novos |
| Ganchos | `GET …/hooks` → `{id, angle, spoken, onScreen, firstFrame}` | `POST …/hooks:generate {count}`, `PATCH …/hooks/:id`, `POST …/hooks/:id:rewrite`, `DELETE …/hooks/:id` | stream por gancho |
| Estimativa | `GET /batches/:id/estimate` → linhas por tipo `{qty, unit, subtotal, eta, note}`, total, gasto do mês, teto, `overCap` | `POST /batches/:id/start` | — |
| Lote | `GET /batches/:id` → variações `{creativeId, type, label, change, status: queued\|generating\|ready\|failed\|waiting, stage, pct, reason}` | `POST /creatives/:id/regenerate` | SSE por variação |
| Revisão | o criativo da v1 + `sourceCreativeId`, `variationType`, URL do original | `approve` / `changes` da v1 | — |
| Biblioteca | `GET /library?kind=all\|original\|variation` → `sourceCreativeId`, `sourceName`, `variationType`, `variationCount` | — | — |

Regras que a UI assume: `declaredOwn` é só um registro e não muda nenhuma regra. Toda variação é um `Creative` com `sourceCreativeId` (já previsto em `modelo-de-dados.md`) e `variationType`. O lote sobrevive a sair da tela. Variação falha não invalida as outras.

## 9. Pendências pro Gusta
1. OK final no mockup v2.
2. Quando o tipo 3 sair: confirmar se segue pelo wizard (uma variação por vez com rosto e motor próprios) ou se usa um rosto e um motor pro lote inteiro.
