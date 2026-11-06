# V2 (troca-texto §16.6), 2026-11-06: porta, fake, Python e prova no Chrome

Tudo local, US$ 0, sem AWS. A função `hookmill-legenda` NÃO foi publicada (é o G1). Só rodou o `build` da camada.

## Veredito do aceite da §16.6
| item | resultado | evidência |
|---|---|---|
| `endFrame` 161 (solto) | **passa** na fixture | Intervalo [0, 161). Caixas: 05 [0, 191), 02 [0, 198), 06 [0, 335), iguais à S4 |
| Dilatação 21 ± 4 no 05 | **passa: 17** (na borda) | p99 do anel por dilatação: 9 → 46,6; 13 → 21,8; 17 → 5,5; 21 → 2,9. A S4 mediu 27/7 na peça composta; nenhuma variante da medida reproduz esses números |
| Emoji (A1) | **passa** | ocupa 0,677, solidez 0,789, 2 lóbulos, bbox x 359 (S4: 0,797, 0,832, 3 lóbulos, x 359). Achado sem coordenada fixa (raio inscrito da esclera ≫ meio traço) |
| As 3 fontes | **falha em 02 e 06** e empata no 05 | Ver "Achado" |
| Solto: Arimo 600 | **passa** | corr 0,758 (`close`); a S4 deu 0,876 no vídeo real em movimento |
| A2 fantasma na placa | **passa** | Pior média 0,16 e corr 0,011 (limites 3 e 0,10); original 48,4/0,48. Máscara 13 646 px (S4: 13 581) |

**Fixture:** os mp4 da S4 só existem no Mac (`projects/**/*.mp4` fica fora do sync). Montei vídeos sintéticos com os pixels reais da S4: a mediana da caixa (`caixa-0X-med.png`) colada sobre um fundo que se mexe, e o quadro original do solto (G0). Assim, intervalo, caixa, fontes, A5 e emoji usam pixels reais; o movimento da cena é sintético. **Rodar no vídeo real:** `casos-s4.json` (abaixo).

## Achado: a régua escolhe TikTok Sans nas 3 caixas
Com o catálogo inteiro da V1, a regra "traço ± 15 %, depois a maior `corr`" no Chrome escolhe:
| vídeo | aprovada (§16.11) | `corr` da aprovada | régua escolhe | `corr` |
|---|---|---|---|---|
| 02 | Montserrat 600 | 0,645 | **TikTok Sans 600** | **0,894** |
| 05 | Albert Sans 500 | 0,767 | TikTok Sans 500 | 0,772 (empate) |
| 06 | Montserrat 500 | 0,629 | **TikTok Sans 500** | **0,763** |
A S4 nunca testou TikTok Sans nem as fontes que a V1 trouxe depois. A olho (`fontes-caixa-aprovada-x-regua.png`), a TikTok Sans é a fonte do original: o "2", o "g" e o "q" do 02 e o "$" do 05 batem. São criativos de TikTok, e essa é a fonte nativa do editor. **O Gusta precisa ver o quadro e decidir:** aceitar a régua, que muda o que ele aprovou, ou fixar a aprovada.

## Desvios do contrato, decididos aqui (para o arquiteto)
1. **Traço = 2 × área ÷ perímetro** (largura média contínua) em vez de 2 × p90 da distância à borda. O p90 anda em degraus de ~0,4 px; no traço fino do solto (2,5 px), ±15 % virava 1 degrau e tirava a Arimo 600 (+16,6 %). Na caixa os erros relativos ficam iguais (Montserrat 500 no 02: −20 %, sai).
2. **Solto:** o alfa medido e o desenhado passam pela mesma transferência (compor sobre o fundo e aplicar o limiar 110-235). Saem também os blobs que não são letra (pele clara que passa do limiar em cena parada).
3. **O emoji sai só da faixa da linha dele.** A S4 zerava a coluna inteira e cortava o "’s" da linha 1, o que deslocava o centro.
4. **`proc_ok` no handler.** O `ok` do processo sobrescrevia o `ok` da medida, e um vídeo reprovado virava erro de infraestrutura. O teste pegou.

## Tempos (VPS x86, 4 vCPU; a Lambda deve ser ~4× mais lenta, pela S1)
Medida mais prova e régua: caixa 15-24 s, solto 5 s. Placa do solto, 240 quadros em 4 pedaços: 14,7 s, pico de 70 MB por pedaço. Camada da função: 255 MB (111 MB gz).

## Rodar no vídeo real (pedir ao Gusta)
Copiar do Mac, sem symlink (`cp -L`), para `research_notes/s4-demo-2026-11-06/origem/`: **`c02.mp4`, `c05.mp4`, `c06.mp4` e `original.mp4`**. Opcionais, para comparar a placa: `remotion/public/midia/placa-solta.mp4` e `origem/aprovada.mp4`. Depois, de `api/`:
`TROCA_PYTHON=<venv>/bin/python REMOTION_BROWSER_EXECUTABLE=<chrome-headless-shell> npx ts-node --transpile-only src/medicao/troca/troca-real.ts ../research_notes/v2-2026-11-06/casos-s4.json /tmp/v2-s4`

## Arquivos
- `fontes-caixa-aprovada-x-regua.png`: original × aprovada × escolha da régua, stills do Chrome.
- `fixture-sintetica-resumo.json`: tudo o que o `troca-real.ts` mediu nas 4 fixtures.
- `casos-s4.json`: casos do aceite no vídeo real.

## Aceite no vídeo real (06/11, à tarde): vídeos da S4 recebidos; o Gusta decidiu que a régua escolhe a fonte
| item | real | sintético | S4 |
|---|---|---|---|
| `endFrame` solto | **161** | 161 | 161 |
| Intervalos 05 / 02 / 06 | **[0,191) / [0,198) / [0,335)** | iguais | 191 / 198 / 335 |
| Dilatação 05 | **17** (halo 5,5) | 17 | 21 ± 4 |
| Caixa 02 translúcida (p99) | **17,0** | 0 (fundo parado na fixture) | 17,7 |
| Emoji: ocupa / solidez / bbox | **0,797 / 0,834 / x 357, y 568, 31×25** | 0,677 / 0,789 / 31×28 | 0,797 / 0,832 / 31×25 |
| Fonte 05 / 02 / 06 | **TikTok Sans 500 / 600 / 500** (corr 0,772 / 0,894 / 0,763) | iguais | aceito (§16.11 item 4) |
| Fonte solto | **Arimo 600 `close`, corr 0,819, traço +10,7 %** | Arimo 600, 0,758 | Arimo 600, 0,876 |
| A2 fantasma (pior média / corr) | **0,46 / 0,033** | 0,16 / 0,011 | 0,5 / 0,013 |
| Placa | **READY, 564 quadros, 4 pedaços, 23 s, 70 MB/pedaço** | 240 q, 14,7 s | 2,9 s no Mac, 1 processo |

**Corrigido para o vídeo real (2 erros de medida, sem mexer em limite):**
1. **Transição:** o solto saía `fades` com 322 quadros. O texto sai seco (cobertura 0,99 no quadro 160, 0,28 no 161) e fica em 0,28 por bordas paradas da cena dentro do molde. Agora transição é cobertura intermediária que ainda muda.
2. **Fundo da régua do solto:** era o da mediana e o alvo vinha do mínimo. Com isso, a Arimo 600 dava traço +15,7 % (saía do filtro) e corr 0,745. Com o fundo do mínimo: +10,7 % e 0,819.
Arquivos: `s4-real-resumo.json` (4 casos, antes da correção 2) e `s4-real-solto-resumo.json` (solto, depois).
