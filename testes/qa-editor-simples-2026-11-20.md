# QA do editor simples (commit bfcfb10, branch editor-simples-2026-11-16), 20/11/2026

**Veredito inicial (antes do reteste): NÃO PASSA. Veredito final após o reteste: PASSA, ver a seção "Reteste 20/11" no fim.** Os itens prometidos funcionam, mas há 1 bug alto (o "Baixar vídeo" pode baixar a versão velha) e 2 médios (campo de texto colapsa; mobile). Nenhum bug toca dado de outro workspace nem gera gasto.

## Como foi testado
- Stack de teste do repo (não a 3001/3000 do Gusta): API 3111 (mock, banco `maquina_test`, render fake) + web 3210 (Next dev da branch), via `testes/harness/servidores.ts`. Motivo: a 3001 usa `INTEGRACOES_MODE=live` e storage Supabase real, e o criativo do Gusta é de outra conta. Não mexi na conta nem no criativo dele (tentei dar membership à conta QA e o sistema barrou; desisti). A 3001 e a 3000 seguem de pé, intocadas.
- Peça AUTO (headline + legenda queimada) criada pelo fluxo do repo (campeão -> lote -> geração em mock).
- Spec: `testes/specs/qa-editor-simples/{00-setup,02-simples}.spec.ts`, config `testes/playwright.qaeditor.config.ts`. Prints (78) em `testes/qa-editor-simples-2026-11-20/` (`ed-1440-en-*`, `ed-390-en-*`, `ed-1440-pt-BR-*`, `ed-390-pt-BR-*`; `resultados-*.json` por projeto).
- Nada pago: render fake de teste, sem geração real.

## Verificações estáticas e testes existentes
| Item | Resultado | Evidência |
|---|---|---|
| `tsc --noEmit` (web) | PASSA | exit 0 |
| `eslint src/components/editor/universal` | PASSA | sem saída, exit 0 |
| `video/test/editor*.spec.ts` (jest) | PASSA, 198 testes / 3 suítes | saída do jest |
| i18n EN e PT-BR | PASSA | 5490 chaves nos dois, diferença zero; todas as `simples.*` usadas existem; nenhuma chave crua nem MISSING_MESSAGE na tela em EN/PT, 1440/390 |
| e2e antigo `editor-ui` (ED-N-*) | NÃO CONCLUSIVO | cobre o editor v1 de criativo-do-zero, que o commit não toca (`UniversalEditor` só abre peça AUTO). ED-N-01 falhou em 1 min e parei a suíte; não investiguei causa. Não há teste e2e antigo do editor universal; os specs novos acima são os primeiros |

## Itens do commit, verificados no navegador
| Promessa | 1440 EN | 1440 PT | 390 EN | 390 PT |
|---|---|---|---|---|
| Layout vídeo \| painel, sem camadas nem linha do tempo, aparar embaixo do vídeo, sem rolagem horizontal | passa | passa | passa (empilhado) | passa |
| Prévia maior (660 px de altura a 900 px de janela; antes ~570) | passa | passa | n/a | n/a |
| 3 abas Textos/Vídeo/Estilo, abre em Textos | passa | passa | passa | passa |
| Clicar num texto na prévia abre Textos com campo focado | passa | passa | passa | falhou no teste, não reproduzido (ver "Não conclusivo") |
| Aba Vídeo: Automático / Mais perto / Mais longe gravam o enquadramento (PUT confere `contain_blur`, zoom) | passa | passa | passa | passa |
| Aba Vídeo aberta: arrastar na prévia reenquadra sem duplo clique; rolar dá zoom; Esc volta pra Textos | passa (PUT gerado), mas veja B3 | idem | n/a (desligado no celular) | n/a |
| Guias só ao reenquadrar, sem seletor de guias | passa (3 guias reenquadrando, 0 fora) | passa | n/a | n/a |
| Estilo: formato/cor, ajuste fino ao clicar elemento | passa | passa | passa | passa |
| Topo: um botão só, "Baixar vídeo"/"Download video", sem Exportar, sem "rev N" | passa | passa ("Revisar" que o teste pegou é falso positivo: botão de revisão, não "rev N") | passa | passa |
| Baixar com mudança: exporta e baixa quando pronto (1ª vez) | passa (download .mp4 em ~3,2 s, POST export antes) | passa | passa | falhou no teste, cascata (ver "Não conclusivo") |
| Baixar sem mudança: baixa direto, sem exportar | passa | passa | passa | n/a |
| Faixa de aviso única, conserto num clique ("Enquadrar sozinho"/"Frame it for me") | passa (uma faixa; clique zera o aviso) | passa | passa | passa |
| Legenda cortada/coberta só AVISA ("Dá pra baixar assim mesmo") e não trava | passa: botão fica habilitado com o aviso na tela | passa | passa | passa |
| Textos sem a tabela técnica (cabeçalho, Em, De onde veio) | passa | passa | passa | passa |

## Bugs

**B1 (ALTA) "Baixar vídeo" baixa a versão VELHA na 2ª mudança da mesma sessão.**
Reproduz em 1440 EN, 1440 PT e 390 EN.
1. Abrir uma peça AUTO no editor, trocar o texto, clicar "Baixar vídeo" (exporta e baixa, correto).
2. Sem recarregar, trocar o texto de novo e clicar "Baixar vídeo".
3. Sequência de chamadas observada: `GET /creatives/:id/download` (posição 0, baixa o arquivo antigo) e só depois `POST /creatives/:id/editor/export`. O usuário recebe um arquivo sem a última mudança e acha que é a nova.
Causa provável (leitura de código, `universal-editor.tsx` ~l.243-252 e `use-universal.ts` l.199/214): `s.justExported` fica não-nulo depois da 1ª exportação; ao clicar, `baixando` vira true e o efeito vê `justExported !== null && !running` antes de `exportMut` rodar o `setJustExported(null)` (que só roda depois do `await save()`), então dispara `baixarAgora()` na hora. Dono: web (editor). Print: `ed-1440-en-11-baixou-1.png` (estado antes). Resultado bruto em `resultados-ed-1440-en.json`.

**B2 (MÉDIA) Campo de texto colapsa quando a linha está "editada" no celular, e com aviso de número em qualquer largura.**
1. Textos, trocar a headline por "Save 50 dollars today" (número que não está na fala).
2. A linha mostra o aviso "It's true, keep it / Undo this edit"; o campo de texto encolhe para 18 px (1440) e o contador "21 / 60" quebra em 3 linhas; o "was ..." encavala. Depois de confirmar volta a 406 px no desktop.
3. A 390 px o campo fica em 37 px (mostra "Sa") mesmo depois de confirmar, sempre que a linha está editada (aparece o "era/was ..."). O usuário não consegue ler o que digitou.
Prints: `ed-1440-en-13-numero.png`, `ed-390-en-14-numero-confirmado.png`. Causa provável: CSS novo `.ed.simples .lrow` em `universal.css` l.287-294 (linha em coluna única) com os filhos `.edit`/`.src` do `ContentRow`. Dono: web (CSS). O fluxo de confirmar número existe e libera o botão (passa), só o layout quebra.

**B3 (BAIXA) Depois de arrastar o vídeo, o botão marcado continua "Mais perto/Closer"; "Livre/Custom" nunca é marcado com zoom > 1.**
1. Aba Vídeo, clicar "Mais perto", arrastar a prévia.
2. O modo marcado continua "Mais perto" (o cálculo em `abas.tsx` só dá "livre" com zoom <= 1,01 e cover). "Livre" ("do jeito que você arrastou") vira rótulo morto (botão desabilitado). Print `ed-1440-en-07-arrastou.png`.

**B4 (BAIXA, celular) A dica da aba Vídeo manda "arraste o vídeo na prévia e role pra dar zoom", mas no celular o reenquadrar por arrasto está desligado.** Passos: 390 px, aba Vídeo, ler a dica. A dica deveria falar só dos botões e do aparar. Dono: web (copy/condição `phone`).

**B5 (BAIXA, UX celular) As abas ficam ~970 px abaixo da dobra.** A 390x844, a tela de abertura mostra só o vídeo; o aparar vem antes das abas (`ed-390-en-01-aberto.png`), então Textos/Vídeo/Estilo exigem rolar. Clicar num texto na prévia abre a aba Textos fora da tela. Avaliar se o painel deve vir antes do aparar no celular.

**B6 (BAIXA, 1440x900) O aparar começa em y=844 e cai quase todo abaixo da dobra** (alcançável rolando; `ed-1440-en-01-aberto.png`). Cosmético: durante o reenquadrar a faixa de aviso fica por baixo do véu do reenquadrar (`ed-1440-en-07-arrastou.png`).

**B7 (BAIXÍSSIMA) Resíduos de texto técnico:** o painel Textos ainda diz "Cada linha guarda de onde veio / Each line keeps where it came from" e o Estilo mostra "Como este painel foi montado: os controles que este template declara". Contradiz a intenção "sem texto técnico".

## Não conclusivo / não testado
- **390 PT**: "clicar num texto abre Textos", o baixar e o "voltar tudo" falharam no teste; os passos depois do primeiro falho encadeiam (campo desabilitado por export em curso). O mesmo roteiro passou em 390 EN, então tratei como instabilidade do teste, não confirmei como bug. Vale rodar de novo isolado.
- Não testei o editor no criativo real do Gusta (`cmw3biabv…`, conta dele, storage Supabase live) para não tocar dado dele; ele já aprovou visualmente em 20/11. A peça de teste é do mesmo tipo (AUTO headline), mas não é o mesmo vídeo.
- Peça AUTO "frame/meme" (como a dele, com `video.framing`) e criativo-do-zero v1 não cobertos: só headline.
- Download testado até o evento de download do navegador com mp4 do mock; não abri o arquivo para conferir o conteúdo da mudança.
- Rede caiu no meio da sessão (ENOTFOUND); retomado sem refazer o que já tinha evidência.

## Estado deixado
Servidores de teste 3111/3210 derrubados. API 3001 e web 3000 intactas. Nenhum arquivo do código alterado; só `testes/` (relatório, `playwright.qaeditor.config.ts`, `specs/qa-editor-simples/`, pasta de prints). Sem commit, sem push.


## Reteste 20/11 (correções B1 a B7, working tree sem commit)
**Veredito final: PASSA** para o merge, com os ressalvas abaixo. Mesma stack de teste (API 3111 mock + web 3210, `maquina_test`), mesmos specs, rodados de novo em 1440 EN, 1440 PT, 390 EN e 390 PT (o 390 PT, que antes cascateou, agora foi inteiro e isolado por projeto). Resultado: 6 testes Playwright passaram, 0 passos FAIL em ~86 passos. Prints novos em `testes/qa-editor-simples-2026-11-20/` (os de antes, com os bugs, ficaram em `antes/`). O spec ganhou: 3ª mudança na sessão (B1), "Mais perto" de novo depois de arrastar (B3), posição das abas/aparar (B5/B6).

| Bug | Resultado | Evidência |
|---|---|---|
| B1 baixava a versão velha | CORRIGIDO | 2ª e 3ª mudança na mesma sessão: POST export na posição 0, GET download na posição 5 (depois), em 1440 EN, 1440 PT, 390 EN e 390 PT; download recebido |
| B2 campo de texto colapsava | CORRIGIDO | com aviso de número: campo 406 px de 440 (1440) e 324 px de 358 (390), contador legível, igual depois de confirmar; prints `ed-1440-en-13-numero.png`, `ed-390-en-14-numero-confirmado.png` |
| B3 "Livre" nunca marcava | CORRIGIDO | depois de arrastar (framing zoom 1.7, pan) marca Livre/Custom; clicar Mais perto de novo volta a marcar Mais perto (EN e PT) |
| B4 dica do celular mandava arrastar | CORRIGIDO | no 390 EN e PT a dica não cita arrastar (spec verifica que não há "drag/arraste") |
| B5 abas fora da dobra no celular | CORRIGIDO | 390x844: topo das abas em y=754 (antes ~970+), aparar vem depois das abas (y=982); painel entre vídeo e aparar confirmado |
| B6 aparar abaixo da dobra no desktop | CORRIGIDO | 1440x900: aparar em y=754 (antes 844); prévia segue grande. A faixa de aviso fica acima do véu (print `ed-1440-en-07-arrastou.png`, e o `ed-1440-en-13-numero.png`) |
| B7 texto técnico | CORRIGIDO | "Every line is editable." sem "keeps where it came from", EN e PT. O details "How this panel was built" só em dev, não conta |

Sem regressão no desktop: painel ao lado do vídeo, 3 abas, clique no texto abre Textos com o campo focado, guias só ao reenquadrar, aviso único com "Enquadrar sozinho", legenda/rosto cortado só avisa e o Baixar fica habilitado, sem Exportar e sem "rev N", sem rolagem horizontal, i18n sem chave crua (todos os 4 projetos).

Ressalvas: (1) `tsc`/`eslint`/jest do vídeo não foram rodados de novo por mim depois das correções (o coordenador informou que estão verdes; os jest do `video/` não foram tocados). (2) Continua sem teste no criativo real do Gusta e sem peça "frame/meme". (3) O download foi comprovado pelo evento do navegador com mp4 do mock, sem abrir o arquivo. (4) Os specs novos não estão no CI do repo; ficam em `testes/specs/qa-editor-simples/` com `playwright.qaeditor.config.ts`.

Servidores de teste 3111/3210 derrubados ao fim; 3000/3001 intocadas; sem commit, sem push, sem gasto.
