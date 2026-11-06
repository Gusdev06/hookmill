# G0 (troca-texto §16.8): composição da S4 no Chrome Linux, 2026-11-06

**Veredito: passou nos 4 critérios.** Custo real US$ 0,00029 (`costs.accruedSoFar` do Remotion), contra o teto de US$ 0,01. O site temporário `g0-s4-20261106` foi apagado (28,7 MB), e os renders também (`deleteRender`). `REMOTION_SERVE_URL` e a função não foram alterados: só foram chamados com outro `serveUrl`.

## O que rodou
- Bundle de `../s4-demo-2026-11-06/remotion/src` (composição `Sonda`) com o `public/` da S4 mais `midia/g0-base.mp4`, que tem 10 quadros, bt709, feitos do quadro original do solto.
- Função `remotion-render-4-0-533-mem3008mb-disk4096mb-300sec`, us-east-1, `@remotion/lambda` 4.0.533.
- Os mesmos 5 jobs também rodaram na VPS (Debian 12) com o chrome-headless-shell linux do Remotion (`vps-shell`) e com o `/usr/bin/chromium` 156 (`vps-chromium`).
- Stills `solto` (fundo transparente, palavras originais), `02`, `05` e `06` (palavras originais e fonte aprovada: 02 Montserrat 600, 05 Albert Sans 500, 06 Montserrat 500), no quadro 10. Clipe de 10 quadros com base em placa, nos ajustes do `render.mjs` da S4 (png, crf 10, bt709, yuv420p, mudo).

## Como mediu (limitação)
Os mp4 da S4 (`origem/`, `saida/`, `midia/`) só existem no Mac (`projects/**/*.mp4` fica fora do sync). A referência veio dos PNG da S4:
- Caixa: `caixa-0X-med.png` (mediana original) e a coluna Mac de `caixa-0X-prova.png`.
- Solto: `solto-prova-originais.png`, cujo zoom 3× por vizinho mais próximo foi revertido sem perda; ROI (60,528)-(410,605).

Mac e Linux passam pela mesma régua da S4 (`regua_caixa.py` e `regua_chrome.py`) em 1 quadro. O Linux ainda passa por 1 x264 crf 10, para ter paridade com o Mac.
**Validação da medida:** o `corr` do Mac medido assim reproduz o JSON da S4, feito com o vídeo inteiro: 0,672, 0,678 e 0,645.
**Solto:** o Linux foi composto sobre a prova do Mac sem a tinta (inpaint). O `corr` e a tinta dependem desse fundo, por isso o `corr` Linux sai um pouco abaixo. A largura e o traço usam a régua robusta da caixa, por faixa de linha, na janela do alfa real ± 10 px, porque a mão clara do fundo virava "tinta".
`regua_chrome.py` não roda aqui como está, porque lê os mp4 do Mac. O dado do Chromium Linux é o `vps-chromium` abaixo.

## Números (Lambda; `vps-shell` e `vps-chromium` deram o mesmo)
| prova | largura por linha, Linux × Mac | traço, Linux × Mac | `corr` Linux / Mac (mínimo Mac − 0,03) | passa |
|---|---|---|---|---|
| solto (Arimo 600) | 0,0 %, +0,37 % (269/269, 271/270 px) | 3,82 / 3,82 (0 %) | 0,872 / 0,888 (≥ 0,858) | sim |
| 02 (Montserrat 600) | 0, 0, 0 % | 7,64 / 7,39 (+3,4 %) | 0,676 / 0,672 | sim |
| 05 (Albert Sans 500) | 0, 0, 0 % | 5,73 / 5,73 | 0,680 / 0,678 | sim |
| 06 (Montserrat 500) | 0, 0, 0 % | 3,82 / 3,82 | 0,645 / 0,645 | sim |

**+Y no clipe (A8):** 10 quadros, bt709. A mediana de `render − base` fora da tinta (quadros 2, 5 e 8) é −2,0 no Lambda, o que dá `y = +2`, igual ao Mac (−1,65, `y = +2`). Na VPS local é −1,0, o que dá `y = +1`. Os dois ficam dentro de ±4, e a diferença entre máquinas confirma a regra de calibrar por render, sem constante.

**Lambda × VPS:** nas caixas, diferença máxima de 1 nível. No solto, os pixels do texto são idênticos; só 11 px do topo do emoji (x 360-385) diferem, até 21 níveis.

**Tempo:** still 0,55-0,68 s quente (o 1º, frio, levou 4,85 s); clipe 7,2 s em 1 lambda. Deploy do site 1,7 s.

## Arquivos
- `folha-g0.png`: original, Mac e Lambda das 4 provas, mais 1 quadro do clipe. Conferida a olho.
- `saida/<lambda|vps-shell|vps-chromium>/`: stills, clipe, `cmp-*.png` e `medidas.json`; `saida/log.jsonl`.
- `ref/`: recortes nativos tirados dos PNG da S4.
- `scripts/`: `recortes.py`, `separar.py`, `medir.py`, `g0.mjs` (`bundle` | `local <rótulo> [chrome]` | `lambda`) e `jobs-g0.json`. Venv do Python fora do repo: opencv-python-headless, numpy.
