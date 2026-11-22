# QA da legenda móvel (commit 690b78a + correção 60818c2, local) — 20 a 22/11/2026

## VEREDITO FINAL: PASSA (commit 690b78a + correção 60818c2). Push liberado do ponto de vista do QA, com as ressalvas no fim.

## RETESTE com 60818c2 (22/11): PASSA no navegador
Stack reiniciada (API 3111 pegou o DTO novo). Spec `testes/specs/qa-legenda-movel/`, rodada final em `qa-legenda-movel-2026-11-20/final6/` (`resultados-*.json` + prints):
| Projeto | Passos ok |
|---|---|
| 1440 EN | 24/24 |
| 1440 PT | 24/24 |
| 390 EN | 22/22 |
| 390 PT | 22/22 |
Sem 400 em nenhum projeto, sem erro de console. Cor e tamanho salvam; "Baixar vídeo" exporta e baixa (POST export antes do GET download); `render.input.captions.edicao` sai completo: 1440 EN `{cy:0.8591, scale:1.23, color:#ffe14a, stroke:#000000, highlight:#ff5fa2}`, PT `{cy:0.8445,...}`, 390 idem; recarregar mantém posição ("Moved down 11%"/"Desceu 11%"); "Voltar tudo ao original" zera. Celular: vídeo `position: sticky` no topo na aba Estilo DEPOIS de rolar (`top:0, scroll:400`, vídeo 284 px), botões 48 px, swatches 38 px; em Textos/Vídeo não é fixo; topo sem Refazer e sem código; sem arrasto (alça ausente, arrasto de toque não move). B1 abaixo = CORRIGIDO.

Nota de método: nas rodadas intermediárias o banco de teste acumula peças; um 390 EN mostrou a legenda "já movida" porque o spec pegou uma peça mexida por uma rodada anterior (artefato do meu teste, corrigido no spec escolhendo só as peças do setup atual). Não é bug do produto.

**Veredito parcial (antes do reteste do 60818c2): NÃO PASSA.** Posição (arrasto, setas, botões, encaixe, avisos, sem limite duro, desfazer/refazer, export, recarregar) funciona. Cor e tamanho da legenda NÃO salvam (API devolve 400), então "Baixar vídeo" fica travado depois de mexer em cor/tamanho.

## Como foi testado
Stack de teste do repo: API 3111 (mock, banco `maquina_test`) + web 3210. 3000/3001 intocadas. Spec `testes/specs/qa-legenda-movel/` (config `testes/playwright.qalegenda.config.ts`), prints em `testes/qa-legenda-movel-2026-11-20/{final,final2}/`. Peças: frame "news" (legenda nossa, `caption` no manifesto) = R; headline remix-keep com legenda queimada (`burned`) = B/H. Nada pago.

## Passou (evidência: final2/resultados-*.json)
- Camada `caption` clicável; clicar abre Estilo com cartão destacado, contorno azul, zonas "interface do app" (desktop), alça só no desktop.
- Arrasto vertical: 1 PUT por gesto, x não muda, linha pontilhada da posição original, sem faixa de aviso durante o arrasto; encaixe a 1,4% com chip e sai do doc.
- SEM limite duro: arrasto até y=0,951 e y=0,050; só avisa (área segura / título), Baixar habilitado.
- Setas 1% (0,99) e Shift 5% (5,01); botões Mais alto/Mais baixo 2% (1,98); segurar 1,5 s = ~19% e 1 passo no desfazer; refazer restaura; Voltar ao lugar.
- Avisos caption_over_text e caption_off_safe só warn, com "Voltar ao lugar".
- Export só com posição: POST export antes do download, `render.input.captions.edicao.cy=0.8591`; "Baixar de novo" sem mudar não exporta; recarregar mantém ("Moved down 10%"); "Voltar tudo ao original" zera.
- Legenda queimada: sem hit `caption`, cartão de cadeado, faixa info + "Ver enquadramento" (vai pra aba Vídeo), arrastar não grava PUT, Baixar liberado.
- Headline: sem cartão de controles da legenda.
- Testes: video jest 325/325; `tsc` web, api e `eslint` do editor: exit 0.

## Bugs
**B1 (ALTA, bloqueia o merge) Cor e tamanho da legenda não salvam: PUT /creatives/:id/editor devolve 400.**
1. Peça de template com legenda nossa, editor, aba Estilo.
2. Clicar Pequena/Grande: 400 `doc.layers.0.style.size notAllowed`. Clicar qualquer cor: 400 `layers[0].style.fontId/background/strokeColor/strokeWidthPx/uppercase/shadow/align not_editable`.
3. Tela: banner "This change can't be saved" + "The export didn't start"; Baixar vídeo fica sem baixar (timeout). Print `final/ed-1440-en-FALHA-Baixar_com_legenda_movida_co.png`.
Reproduz direto na API (sem navegador): PUT `{doc:{layers:[{id:'caption',style:{color:'#111111'}}]},baseRevision}` = 400.
Causa: (a) `api/src/edicao/editor.dto.ts:35-45` `LayerStyleDto` não tem `size` e a API usa `forbidNonWhitelisted` (`api/src/common/http/validation.ts:24-25`); (b) `video/src/lib/editor/legenda.ts:78` itera `Object.keys(l.style)` e o DTO instanciado traz as chaves não usadas como `undefined`, que viram `not_editable`. Os jest passam porque chamam o lib sem o DTO. Dono: api + video.
As 3 falhas do spec (Baixar com cor, Baixar de novo, recarregar, tamanho) eram esse mesmo bug (cascata: doc inválido não salva, export não começa). Com cor/tamanho fora do caminho, Baixar/recarregar passam: bug real do produto, não instabilidade do teste.

**Suíte da API completa (build:lib antes): 161 de 166 suítes passam, 2304 testes; 5 suítes falharam com 2 workers.** Rodando de novo só elas em série: `editor.int` e `render-lambda.int` passam (instabilidade por carga); persistem 3:
- `editor-universal.int.spec.ts:413` espera `face_cut` level `block` e recebe `warn`: teste velho, o código virou warn no commit c1159b6 (15/11), anterior ao commit testado.
- `templates-creditos.int.spec.ts:225,366` e `headline-copia.int.spec.ts:446` (esperam status `failed`, recebem `ready`/`left_out`): não tocam legenda nem editor; provável teste desatualizado depois do "plano B / left_out" de 13/11. Não consegui rodar a base 44ee80f pra provar que já falhavam (exigiria mexer no checkout); **não atribuo ao commit, mas fica a conferir pelo dono**.

## Itens fechados no reteste (22/11)
- **Export com tamanho, cor e posição, e o resultado visível:** a partir do `render.input` exportado (peça news, 1440 EN) renderizei um quadro com o Remotion local (`render-antes.png` vs `render-depois.png`, frame 66): depois da edição a legenda está mais baixa, em amarelo, com a palavra falada "THE" em rosa e maior (escala 1,23). Não abri o MP4 do mock (é um arquivo falso de teste); o quadro foi renderizado de verdade com o mesmo input que o export gravou.
- **Aceite do doc nulo** (`video/scripts/editor-universal/aceite-doc-nulo.mjs`): base = bundle do commit anterior 44ee80f (extraído por `git archive`, apagado depois), "depois" = código atual com `resolverProps(base, null)`; **56/56 casos idênticos frame a frame** (879 quadros, `NTH=15`, ou seja 1 quadro a cada 15; não conferi os quadros intermediários). Saída em `video/out/editor-universal/resultado.json`.
- **Testes do video:** jest 326/326 (10 suítes); `tsc` web, `tsc` api, `eslint src/components/editor`: exit 0.
- **Suíte da API completa depois do 60818c2 (build:lib feito):** 159 suítes passam, 7 falharam com 2 workers; rodadas em série, 4 passam (`render-lambda`, `campanhas`, `amostra`, `iteracao`: carga e uma colisão de porta 3197 com outro processo). Persistem as mesmas 3 suítes (6 testes) de antes, sem relação com legenda/editor: `editor-universal.int.spec.ts:413` (espera `block`, o código virou `warn` em c1159b6, 15/11, antes deste commit: teste velho, dono api/video), `templates-creditos.int.spec.ts:225,366` e `headline-copia.int.spec.ts:446` (+ Q1-B5). Estes dois últimos NÃO provei que já falhavam na base (não rodei a API no commit anterior); pelo conteúdo (status de falha/"left_out", plano B de 13/11) parecem testes desatualizados, **dono confere**.
- **Peça sem legenda trocada / headline:** peça headline (`headline:text`, `burned`, `video`): manifesto igual ao de antes, sem cartão de controles da legenda, só o cartão de cadeado; a legenda queimada não arrasta e não grava PUT. Não havia na stack peça de template com `captionMode 'avoid'` (todos os 6 frames do setup nasceram com a nossa legenda), então "template sem legenda trocada" está coberto só pela peça headline queimada, não por um frame 'avoid'.

## Não testado / ressalvas
- `caption_over_face` (legenda em cima do rosto) não foi exercitada no navegador: as peças mock não têm rosto detectado (`face: null`); só os jest do video cobrem.
- Export medido no `render.input` e num quadro Remotion; o MP4 do mock não prova nada. Render real não feito (custo/escopo).
- Editor simples antigo (`testes/specs/qa-editor-simples/`): não rodei de novo; no meu spec nada regrediu nas partes comuns (Baixar com/sem mudança, aviso único, Baixar nunca trava, sem rolagem lateral, i18n sem chave crua em 4 projetos).
- Um quadro com legenda Grande e baixa se sobrepõe ao botão CTA do template news (`render-depois.png`); aparece só como aviso quando o CTA conta como texto. Não é regressão nem bug da spec (decisão "só avisa"), só observação de UX.
- Alguém mais mexeu em `reports/templates-ia-background-2026-11-04/verification.json` (modificado no git, não fui eu).

## Estado deixado
Servidores de teste 3111/3210 derrubados; 3000/3001 intocadas; sem commit/push; sem gasto. Arquivos novos só em `testes/`: este relatório, `playwright.qalegenda.config.ts`, `specs/qa-legenda-movel/`, `qa-legenda-movel-2026-11-20/` (`final6/` = rodada final; `final`..`final5` = rodadas intermediárias, algumas com o bug B1 e peças contaminadas; `render-antes/depois.png`).
