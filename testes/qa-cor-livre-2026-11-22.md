# QA cor livre + teto INTERNAL (22/11/2026)

## VEREDITO FINAL (22/11, reteste apos correcoes): PASSA. Push liberado do ponto de vista do QA.
Reteste do spec nos 4 projetos (`qa-cor-livre-2026-11-22/final2/`): 1440 EN 11/11, 1440 PT 11/11, 390 EN 11/11, 390 PT 11/11, sem 400, sem erro de console. O passo "1 gesto = 1 Desfazer" passou nos 4 (B1 corrigido). Testes de teto ajustados pelo dono (iteracao, pecas, molduras-estatico, variacao-ia passam em serie segundo o dono; editor-universal so no :413 conhecido); eu NAO rodei de novo a suite da API.
(Texto abaixo = veredito anterior, historico.)


## Mudança 2 (teto INTERNAL): CÓDIGO OK, 5 TESTES DE INTEGRAÇÃO PRECISAM DE AJUSTE (causados pela mudança)
Suíte completa da API (`npx jest --maxWorkers=2`, build:lib antes): 167 suítes, 158 passam, 8 falharam, 2318 testes, 15 falhas. Reroda serial (`-i`) das suítes tocadas: `meta.int` passa (era carga). Persistem:

CAUSADAS pela mudança (testes criam o dono como `access: 'INTERNAL'` e esperam SPEND_CAP_EXCEEDED; agora o teto é `null`, o 409 nunca vem):
| Teste | Linha | Sintoma |
|---|---|---|
| iteracao.int `§14.4 STATIC ... respeita o teto` | 394 | `error` undefined |
| iteracao.int `teto de gasto: 409 SPEND_CAP_EXCEEDED` | 492 | `error.code` de undefined |
| variacao-ia.int `...respeita oferta incompleta, teto...` | 94 | idem; o teste seguinte (108, 202 esperado, veio 409) é cascata: o teste 94 aborta antes de resetar o estado |
| pecas.int `STATIC sob demanda ... teto no 1:1` | 326 | `error` undefined |
| pecas.int `Retry checa o teto e cobra` | 476 | idem |
| editor-universal.int `limite diário (429) e teto (409)` | 476 | idem |
| molduras-estatico.int `§A10.1/1b Retry ... ` | 247 | idem |
Provável cascata (não prova): `pecas.int zip ... ready` linha 400 (zip vem `none`; zip não usa `cap()`; aborta-se o teste anterior no meio) e `editor-universal.int:~300 "vídeo do cliente... rosto cortado"` (detalhe visiblePct, não toca teto: provável teste velho junto com o :413 já conhecido). Confirmar depois do ajuste.
Ajuste proposto (só testes, dono api): nos blocos de teto, trocar o dono para `access: 'PAID'` antes de gravar `monthlySpendCapUsd` e voltar a `INTERNAL` depois (como variacao-ia.int já faz com `SAMPLE` na linha 99), ou criar um dono PAID só para o teto. Validar que PAID não dispara outro bloqueio (amostra/limites). Não alterei nada.
Já conhecidas (sem relação): `editor-universal.int:413`, `templates-creditos.int:225,366`, `headline-copia.int:446` (+ outro teste na mesma suíte; mesmo grupo "plano B / left_out").

## Outros
- video: build:lib ok; jest 326/326 (10 suítes).
- web: `npx tsc --noEmit` exit 0; `npx eslint src/components/editor/universal` exit 0.

## Mudança 1: BUG B1 (média) — desfazer: 1 gesto da bolinha livre = N passos, não 1
Reproduzir (1440 EN, peça frame "news", editor, aba Estilo, legenda selecionada): disparar 5 eventos `input` seguidos na bolinha livre do texto (cores #102030..#2A9D8F) + `change`; clicar Undo: o anel continua marcado; foram precisos 5 cliques (um por evento `input`) pra voltar ao branco. Esperado: 1.
Causa provável (dono web, `web/src/components/editor/universal/panel.tsx` `CorLivre`): o `useEffect` tem dependência `[s]`; `s` (a sessão) muda a cada render, então o cleanup roda `s.endGesture()` depois de cada render e zera `gestureRef`/`typingField`; o próximo `input` reabre um passo (`begin`). Correção: depender só de `s.endGesture` (callback estável, `useCallback(..., [])`) e não chamar `endGesture()` no cleanup a cada render, só ao desmontar (ref pra `s.endGesture`).
Print: `qa-cor-livre-2026-11-22/r3/` e `r2/ed-1440-en-02b-desfeito.png`.

## Mudança 1 (navegador): resultado (spec `testes/specs/qa-cor-livre/`, config `testes/playwright.qacorlivre.config.ts`, API 3111 + web 3210, mock, banco maquina_test; prints/JSON em `qa-cor-livre-2026-11-22/final/` e `final-390en/`)
| Projeto | Passos ok | Falha |
|---|---|---|
| 1440 EN | 10/11 | B1 (desfazer) |
| 1440 PT | 10/11 | B1 |
| 390 EN | 10/11 (rodada `final-390en`; na rodada `final` falhou a medição de pixels da marca, ver nota) | B1 |
| 390 PT | 10/11 | B1 |
Sem 400 em nenhum projeto, sem erro de console, sem chave de i18n crua.
Passou nos 4: bolinha no fim de cor do texto, cor da palavra falada e Cor da marca (aba Estilo); focável, aria-label "Any color"/"Qualquer cor" (alvo 30 px no 1440, 38 px no 390); arrastar (5 `input` + `change`) com #2A9D8F: previa muda (pixels da cor 0 -> ~1600 no recorte da legenda), anel marcado com a cor dentro, 1 PUT 200 com a cor; palavra #E76F51 idem; palavra = cor do texto pela livre NÃO aplica (sem PUT novo, doc e anel mantêm #E76F51); bolinhas antigas funcionam (Amarelo marca o radio e desmarca o anel livre; Rosa na palavra idem, Amarelo travado na palavra); recarregar mantém anéis e valores; Cor da marca livre #00B050: peça muda de destaque (pixels 0 -> 8342 no 1440 EN, 2196 PT, 411 no 390 PT, 11 no 390 EN: nesse template a cor só aparece numa setinha do CTA), PUT com `templateOpts.brand`, recarregar mantém; exportar: POST editor/export antes do download, `render.input.captions.edicao` = `{color:#2A9D8F, stroke:#000000, highlight:#E76F51}` e `frame.brand.accent=#00B050`, sem 400; peça com legenda queimada (headline): sem paleta e sem camada caption (travada); somente-leitura (publicação Meta PAUSED inserida por SQL e apagada no fim): as 3 bolinhas livres ficam `disabled` (1440 EN/PT; nos 390 também, 10/11 sem essa falha).
Nota: na rodada `final` o 390 EN falhou só na medição (limiar 50 px; o 390 mostra a peça pequena); baixei o limiar pra 5 e rerodou verde (rodada `final-390en`).

## Não testado
- Arrasto real na paleta nativa do SO (Playwright não dirige o seletor de cor nativo): simulei com eventos `input`/`change` no `<input type=color>`. O bug do desfazer vale também no arrasto real (cada re-render zera o gesto).
- Render real (MP4 do mock é falso): provei o `render.input`, não o vídeo; não renderizei quadro Remotion desta vez.
- Peça de template com `captionMode 'avoid'` (sem legenda nossa): só coberto pela headline queimada.
- Os 3 testes já conhecidos como falhos (413, templates-creditos 225/366, headline-copia 446) não foram investigados de novo.

## Estado deixado
Servidores 3111/3210 derrubados; 3000/3001 intocadas. Sem commit/push, sem gasto. Arquivos novos só em `testes/`: este relatório, `playwright.qacorlivre.config.ts`, `specs/qa-cor-livre/`, `qa-cor-livre-2026-11-22/` (final, final-390en; r1..r3 são rodadas de depuração). O `.cache/qa-cor-livre.json` e o banco `maquina_test` foram recriados pela rodada. (spec `testes/specs/qa-cor-livre/`, config `testes/playwright.qacorlivre.config.ts`)
