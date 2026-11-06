# Sonda S2 — apagar a legenda queimada e escrever texto diferente (05/11/2026)
Contrato: `docs/contratos/troca-texto-queimado-v1.md` §1, §3 e §10. Fora do produto. Custo real: **US$ 0** (textos escritos à mão, tudo local em CPU).

**Veja primeiro:** `s2-resumo.mp4` (36 s, melhores) e depois `s2-falhas.mp4` (10 s, onde quebra).

## Veredito
- **Apagar sem IA não fica limpo em todo vídeo.** Nenhuma combinação sem caixa passou nos 3 vídeos.
- **E2 + W1 (temporal, mesmo tamanho) fica bom em pessoa falando com fundo desfocado:** 13 de t=7 a 21, 05 no suéter e no pescoço. Não vi letra antiga nos quadros conferidos. Sobra degrau de tom na pele do pescoço quando o texto novo é curto (13 t=12, 14,7, 17,5).
- **E2 falha em três casos.** Partículas do 05 (t=25-30): borrão à vista. Mão em movimento no 02 (t=0-2): mancha e rastro. Pele do 02 (t=3, 19,5, 26,8): manchas de tom. Na igreja do 13 (t=0-6), o texto curto deixa borrão nas laterais.
- **E1 (TELEA) deixa polígonos claros sobre pele e boca** (13 t=10, 12,1, 17,5; 05 t=14,5). Reprovado.
- **Menor (W2) piora, não melhora, sem caixa:** com 1 linha, deixa 50-57 % da área apagada à vista, contra 31-43 % no W1.
- **W3 (caixa opaca) é o único sem defeito de pixel nos 3 vídeos,** e dispensa apagar (E0). A letra antiga fica escondida, não some: tirar a caixa revela a original. A caixa também muda a cara da peça, troca de largura entre páginas e, com 2 linhas, sobe até perto da boca no 13.

**Recomendação:** `E0 + W3` com 1 linha, como padrão. É a única que passou em tudo, e sem processar pixel nenhum. Se o Gusta não aceitar a caixa, `E2 + W1` só atrás de portão (pessoa falando, fundo desfocado, sem mão na faixa). `E1` e `W2` sem caixa ficam fora.

## Medidas
Área à vista = fração da pegada antiga (letra + contorno + sombra) não coberta pelo texto novo, por quadro, no vídeo inteiro: a mesma conta da §1. **Ela não distingue E1 de E2,** porque só depende do texto e da máscara. A diferença de qualidade aparece nos quadros e no teste de verdade abaixo.
Letra detectável = pixels que o detector (claro + contorno escuro) ainda acha na placa, junto da letra antiga e fora do texto novo, sobre a área da letra. Não enxerga fantasma fraco: por isso os quadros foram conferidos a olho.

### 13: matriz completa (pior caso medido: A p95 66,6 %; legenda sobre queixo e boca)
| combinação | área à vista média % | p95 % | letra detectável média % | p95 % | olhando os quadros |
|---|---|---|---|---|---|
| E1 W1 tr / cu / lo | 31,2 / 31,3 / 43,6 | 55,0 / 48,0 / 53,1 | 0,1 / 0,1 / 0,0 | 0,5 / 0,5 / 0,1 | polígonos no rosto onde não cobre |
| E1 W2 tr / cu / lo | 50,9 / 51,9 / 41,1 | 77,5 / 70,6 / 57,1 | 0,1 / 0,1 / 0,0 | 0,5 / 0,5 / 0,0 | idem, mais à vista |
| E1 W3 tr / cu / lo | 1,4 / 1,4 / 1,4 | 0 / 0 / 0 | 0 | 0 | quadros não conferidos; mesma caixa do E2 W3 |
| **E2 W1 tr / cu / lo** | 31,2 / 31,3 / 43,6 | 55,0 / 48,0 / 53,1 | 0,0 | 0,3 / 0,3 / 0,0 | bom no rosto; borrão leve na igreja; degrau no pescoço |
| E2 W2 tr / cu / lo | 50,9 / 51,9 / 41,1 | 77,5 / 70,6 / 57,1 | 0,0 | 0,3 / 0,3 / 0,0 | laterais à vista na igreja |
| E2 W3 tr / cu / lo | 1,4 / 1,4 / 1,4 | 0 / 0 / 0 | 0 | 0 | limpo; borrão só nas pausas sem caixa |
| **E0 W3 tr / cu / lo** (extra, não pedido) | 0,0 | 0,0 | 0,0 | 0,0 | limpo; caixa fica até nas pausas |

### 05 e 02
| combinação | 05 média / p95 % | 02 média / p95 % |
|---|---|---|
| E1 W1 tr (a mais simples sem caixa) | 35,4 / 61,6 | 40,1 / 100 |
| E2 W1 tr | 35,4 / 61,6 | 40,1 / 100 |
| E2 W1 cu | 38,8 / 63,4 | 43,4 / 100 |
| E2 W2 tr | 50,0 / 83,1 | 55,9 / 100 |
| E2 W2 cu | 53,7 / 71,6 | 57,3 / 100 |
| E2 W3 lo | 0,9 / 0,0 | 5,7 / 100 |
| E0 W3 tr | 0,1 / 0,0 | 0,0 / 0,0 |
Letra detectável: 0,0-0,1 % em todas. O p95 de 100 % no 02 vem das pausas da fala: a legenda antiga segue na tela sem texto novo, e o apagado fica todo à vista (t=17,7). Manter o texto na tela até a próxima frase deve reduzir isso; não testei.

### Teste de verdade (máscara deslocada para área sem legenda, comparada ao pixel real, mediana)
| vídeo, deslocamento | E1 PSNR / SSIM | E2 PSNR / SSIM |
|---|---|---|
| 13, +70 px | 27,10 / 0,850 | 25,88 / 0,823 |
| 05, -100 px | 24,43 / 0,778 | 25,64 / 0,817 |
| 02, -80 px | inválido | inválido |
**No 13, o número favorece o E1, embora a olho o E2 pareça melhor.** Não tratei isso como prova de nenhum dos dois: borrão costuma pontuar bem em PSNR, e essa explicação é hipótese minha. No 05, parte dos quadros de t=13-17 tem legenda real na zona medida. No 02, a faixa é tão baixa que a máscara deu a volta e caiu sobre a legenda: descartado.

### Tempo e memória (1 processo, Mac M5, máquina dividida: carga 5-11)
| vídeo | máscara | só TELEA (E1) | só temporal (E2) | total: 2 placas + 2 encoders | CPU Python | pico RAM | buraco com pixel real / TELEA |
|---|---|---|---|---|---|---|---|
| 02, 30 s | 5,7 s | 9,7 s | 18,9 s | 38,7 s | 38,7 s | 1,58 GB | 75,2 % / 24,8 % |
| 05, 30 s | 7,9 s | 21,4 s | 52,7 s | 93,8 s | 79,0 s | 1,04 GB | 54,4 % / 45,6 % |
| 13, 21 s | 6,0 s | 6,5 s | 19,7 s | 36,5 s | 38,0 s | 1,62 GB | 46,3 % / 53,7 % |
Escrever o texto e medir levou 16-108 s por combinação, com até 4 em paralelo e outros renders na máquina: não é número de produto. O E0 não tem custo de placa, só o da detecção. RAM acima do alvo de 1 GB da §3.2, e o pico depende da tomada mais longa, porque o E2 guarda a tomada inteira em memória. A velocidade na Lambda é da S1.

## Como foi feito
- **Pegada** (`scripts/pegada.py`): detecção por trecho de `detectar.py`. Tirei o recorte pelo texto da fala, que deixava letra sobrando (o "Y" do 02).
- **E1:** TELEA raio 5 por quadro, igual ao `trocar.py`, sobre essa pegada.
- **E2** (`scripts/placa.py`): por tomada, fluxo óptico DIS, carrega o pixel real para frente e para trás (até 120 quadros), funde pela idade e usa TELEA só no que sobrar, com estabilização. Três travas nasceram de erro visto nos quadros: buraco +3 px e ±2 quadros (fantasma de compressão), erro local do fluxo e faixa de brilho do entorno. Sem GPU e sem IA.
- **Escrever** (`scripts/escrever.py`, Pillow): W1 = fonte, contorno, sombra e karaokê medidos; W2 = 75 %; W3 = 85 %, caixa `#0C0C0C` que cobre a pegada de toda a página. Textos em `scripts/textos.py`; tempo pela frase do Whisper e karaokê por caracteres.
- **Janelas dos antes-depois:** 12 s (13: t=3-15; 05: 2-14; 02: 14-26). As medidas são do vídeo inteiro. O 05 e o 02 não mostram o pior trecho nessa janela: ele está em `s2-falhas.mp4`.
- **Reproduzir:** em `work/`, rode `detectar.py` para cada vídeo (`--caixa` no 02), depois `placa.py <id>`, `rodar-matriz.sh`, `rodar-outros.sh` e `resumo.sh`. Os `.npz` foram apagados por tamanho e são refeitos por esses passos.

## O que mais apareceu
- **Conferi quadros parados, não o vídeo em movimento.** Tremor no tempo não foi avaliado: isso fica para o Gusta ao assistir. Olhei folhas de 13 E1-W1-tr, E2-W1-tr/lo, E2-W2-tr/cu, E2-W3-tr/lo, E0-W3-tr; de 05 e 02 E2-W1-tr/cu, E2-W2-cu, E2-W3-lo, E0-W3-tr; e as placas E1 e E2 dos 3. As demais combinações têm só a medida.
- **Nenhum dos 3 vídeos tem legenda de 2 linhas.** A faixa de 3 linhas no topo do 02 é texto fixo em caixa, outro caminho do contrato. Testei só o inverso: texto novo de 2 linhas sobre legenda antiga de 1. Apagar legenda de 2 linhas segue sem teste.
- **Erro de cor nos testes de 04/11:** as placas saíam em BT.601 sobre fonte BT.709 e a pele mudava de tom. Corrigido aqui em `cor_args`; o F1 precisa disso.
- **Só Pillow.** A comparação Pillow × Remotion da §10 não foi feita, porque `video/src` estava fora do escopo.
- **Tradução EN** porque os 3 vídeos estão em espanhol. Os textos não passaram por revisão de copy; "SANTO DE CAUSAS IMPOSIBLES" (13, curta) e "DESCUBRÍ ALGO INCREÍBLE" (02, curta) forçam o sentido original.
- **Testado em 3 vídeos.** Os portões `busy_background` e `over_face` seguem para a S3.

## Arquivos
`s2-resumo.mp4`, `s2-falhas.mp4`; `videos/<id>-<E>-<W>-<T>.mp4` (35 antes-depois, com rótulo e áudio); `inteiros/` (6 versões inteiras); `quadros/` (folhas conferidas); `work/resultados.json`, `work/placa-*.json`, `work/placa-*-E1.mp4` e `-E2.mp4` (placas sem texto).
T: `tr` = tradução, `cu` = mais curta, `lo` = mais longa.
