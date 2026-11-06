# Sonda S1 — E2 + W1 na AWS (05/11/2026)
Contrato: `docs/contratos/troca-texto-queimado-v1.md` §3, §10, §14.y-w. Fora do produto. Função Python real, arm64, 3008 MB, 2 vCPU. Fonte dos tempos: linha REPORT do CloudWatch e relógio do cliente, cada chamada em `medidas/invocacoes.jsonl`.

## Resultado: nenhum portão de tempo da §3.4 passa como está. Custo passa.
| vídeo | `detectar` + estilo (faturado) | ajuste novo | placa E2, 1 função | placa E2, 4 pedaços + juntar | RSS da árvore 1 função / 4 pedaços | custo com 1 função / 4 pedaços |
|---|---|---|---|---|---|---|
| 13, 21 s | 38,0 s | 10,8 s | 108,6 s | 45,4 s | 1441 / 746 MB | US$ 0,0065 / 0,0078 |
| 02, 30 s | 54,9 s (2 detecções, ver abaixo) | 12,7 s | 115,7 s | 37,4 s | 680 / 568 MB | US$ 0,0067 / 0,0067 |
| 05, 30 s | 35,3 s | 14,6 s | 188,5 s | 66,3 s | 781 / 620 MB | US$ 0,0088 / 0,0093 |
| 120, 128 s | 283 s sem dica; 81,4 s com faixa dada | 15,5 s | 489,5 s | 127,8 s | 1555 / 909 MB | US$ 0,0223 / 0,0185 |

Custo = detectar + ajuste + placa, sem W1 (no produto é Remotion). W1 Pillow, à parte: 26-36 s nos curtos, 110 s no 120. GB-s: 485-656 nos curtos, 1384-1669 no 120.

| portão §3.4 | meta | medido | veredito |
|---|---|---|---|
| `detectar` + estilo, 30 s | ≤ 30 s | 35-55 s (sem a 1ª passada, com captionBox: ~29-48 s, por subtração) | não passa |
| placa, 30 s | ≤ 60 s | 1 função 109-189 s; 4 pedaços 37-66 s | 1 função não; 4 pedaços: 13 e 02 sim, 05 não por 6 s |
| 1ª peça, 30 s | ≤ 60 s | igual à placa, se detectar corre junto com a análise | idem |
| custo, 30 s | US$ 0,004-0,008 | 0,0065-0,0093 | passa, 05 um pouco acima |
| `detectar` + estilo, 120 s | ≤ 60 s | 283 s sem dica; 81 s com faixa e 2 detecções; ~50 s com 1 detecção (conta, não medido) | não passa como medido |
| placa, 120 s, 4 pedaços | ≤ 120 s | 127,8 s; pedaços 57-122 s, desbalanceados | não passa por 8 s |
| custo, 120 s | US$ 0,015-0,03 | 0,0185 | passa |
| ajuste (§3.2) | < 5 s | 10,8-15,5 s (fonte + alinhamento: 2,4-4,2 s nos curtos, 5,7 no 120; traço, sombra e cor: 4-11 s) | não passa inteiro; a parte que era o gargalo passa nos curtos |
| RAM (§3.2) | ≤ 1 GB em 120 s | 1 função 1,55 GB (REPORT 1,71); 4 pedaços 0,91 GB (REPORT até 1,03, com ambiente reaproveitado) | só em pedaços, no limite |

**Onde o tempo vai (placa 05):** máscara 35 s, fluxo 12 s, propagação 22 s, preenchimento (sanidade, TELEA, costura) 75 s, regravar 32 s.

## Estimativa × medido
- **Fator Mac → Lambda:** contrato 3-4×; medido 4,2× (E2 do 13), 4,8× (E2 do 120), 4,5-6× (ajuste), 6,5× (TELEA). Base do erro: o código é quase todo 1 núcleo.
- **Placa 30 s:** contrato estimava 55-140 s sem otimizar; deu 109-189 s já com só a faixa em memória. **120 s em série:** 225-720 s estimado, 489 s medido, dentro.
- **Ganho `erase` 2-5× (hipótese):** não veio. ROI por palavra: ganho 0 (TELEA r5 46,33 × 46,33 s no 13; E2 05 188 × 186 s). TELEA custa pela área do buraco, não da imagem. r3 é 2,5× mais rápido que r5 (46 → 19 s, 95 → 38 s), com 36-42 dB de diferença, só no E1 (já reprovado). Temporal é mais lento que TELEA: 71-117 s contra 46-95 s.
- **Custo da sonda:** contrato ~US$ 0,05; medido US$ 0,129 de Lambda, porque rodei a mais (120 s com e sem dica, 4 pedaços nos curtos, TELEA separado).
- **Cota:** o contrato fala em 10 execuções; `get-account-settings` lê **1000** hoje. Sem throttling nas chamadas de 4 em paralelo.

## Estilo: ajuste novo × grade
| vídeo | fonte, tr, esp, traço, sombra | tam | alinhamento | IoU médio novo / grade |
|---|---|---|---|---|
| 02 | iguais | 47 × 48 | 31 de 31 | 0,685 / 0,685 (rodada Mac) |
| 05 | iguais | 66 × 67 | 35 de 38 | 0,773 / 0,786 (rodada Mac) |
| 13 | iguais | 58 × 59 | 30 de 30 | 0,764 / 0,764 (rodada Mac) |
| 120 | **diverge** do 02, que tem a mesma legenda: tam 53 × 48, tr 0,02 × 0,05, esp 1,0 × 1,6, traço 3 × 4 | | sem grade própria | 0,482 / 0,507 |
Olhei folhas de 02, 05 e 13 (`quadros/estilo-*.png`): não distingo a olho nos dois instantes de cada. No 120 a legenda nova sai visivelmente mais apertada (`quadros/w1-120.png`). Ou seja: passou nos 3 curtos e falhou no longo, onde há 2 pessoas e uma transcrição pior (Whisper small local). Não sei qual dos dois causou.
- **Sem o `fontId` da visão:** todas as 16 fontes empacotadas competem. Com o `fontId` a etapa fica mais curta; não medi.
- **O ajuste exige detectar sem `--caixa`.** A grade do 02 foi feita assim (IoU 0,685; com `--caixa`, 0,495); a placa precisa da com caixa. Por isso 2 detecções. Dá para calcular as duas máscaras na mesma passada; não medi.
- **Achado:** o amarelo da grade (249,252,9) veio do `VideoCapture` do Mac. Pelo ffmpeg, o mesmo caminho dos pixels, dá 251,238,0. O VideoCapture da Lambda dá 252,239,1. O ajuste novo lê a cor pelo ffmpeg.

## Conferência: Lambda × versão local aprovada
**Não é igual bit a bit.** Com o estilo da grade (mesma entrada). Faixa da legenda:
| comparação | PSNR mediana | p5 | mín | SSIM média |
|---|---|---|---|---|
| placa 13 / 02 / 05 | 43,9 / 44,2 / 43,7 | 42,8 / 34,5 / 38,3 | 42,5 / 30,5 / 37,0 | 0,990 / 0,985 / 0,986 |
| inteiro 13 / 02 / 05 | 41,3 / 41,2 / 40,8 | 39,5 / 37,2 / 36,0 | 39,3 / 32,2 / 34,9 | 0,986 / 0,986 / 0,983 |
| 4 pedaços × 1 função: 13 / 02 / 05 / 120 | 43,5 / 46,1 / 44,0 / 99 | 40,5 / 44,5 / 39,2 / 43,7 | 40,4 / 43,9 / 37,6 / 36,7 | 0,990 / 0,991 / 0,990 / 0,997 |
A área à vista (31,2/55,0; 40,1/100; 35,4/61,6) bate com o S2 nos 3 vídeos.

- **Causa, medida:** o refatorado no Mac dá placa e inteiro do 13 **idênticos** ao S2 (PSNR inf). Os quadros decodificados no 02 têm o mesmo md5 no Mac e na Lambda. O fluxo DIS, com a mesma entrada, dá outro hash (e não muda com 2 ou 10 threads no Mac). O x264 também sai diferente (44-45 dB fora do buraco, sem cara de defeito).
- **A olho (`quadros/*-piores.png`):** onde E2 fica bom, não vejo diferença (13 t=3,6, 5,5, 20; 05 t=13,2). Onde E2 já falha, o defeito muda de forma. **Pior caso, 02 t=18,2-18,7:** a mancha ao lado do pescoço fica maior e laranja na Lambda, menor e vermelho-escura no Mac; no W1 o texto novo cobre quase toda, sobra um traço nos dois. 02 t=1,3 (mão) e 05 t=19,3, 27-30 (suéter, partículas): defeito parecido nos dois.
- **Pedaços:** 3844 quadros certos. Sem salto na troca 961 (120) e 450 (05). Salto medido, pequeno, em 675 (05) e, no 13, em 158 e 316 (39,7 e 41,0 dB contra 58,7 e 46,7): é início de GOP em cena quase parada. Pode aparecer como um pulo leve. Não assisti em movimento.
- **Regra do §14.w vale:** mão na faixa no 120 (t=58,7, 67,6) fica ruim em qualquer caminho; não é oferecido.

## O que não foi medido
Movimento (só quadros parados); fatura AWS (o custo é conta dos REPORT × preço público, Cost Explorer atrasa ~24 h); estilo com `fontId`; 1 detecção com as 2 máscaras; cortes de pedaço balanceados por custo; r3 dentro do E2; outras memórias; x86; Pillow × Remotion; legenda de 2 linhas; grade do 120.

## Vídeos
- `entrada/v120.mp4` → `projects/reino-del-amor-swipe/criativos-concorrente/midia/02-1985335258774350-0.mp4` (128,3 s, 716×1278, 2 pessoas e tela final). W1 dele usa a própria fala, só para medir tempo. Faixa dada à mão, [900, 1040], imitando o `captionBox`. Sem a dica, a detecção pega o quadro inteiro por causa da tela final.
- `w120.json`: Whisper small local com só o canal esquerdo; a mistura estéreo cancela a voz nesse arquivo e o Whisper alucinava.

## Reproduzir
Em `scripts/`: `deploy.mjs` (`S1_BUILD`, `S1_WHL`, wheels aarch64 numpy 2.0.2, opencv-headless 5.0.0.93, pillow 11.3.0), `etapa1-detectar-ajustar.mjs`, `etapa2-curtos.mjs`, `etapa3-longo.mjs {pedacos|um|w1}`, `etapa4-05-pedacos.mjs [13]`, `comparar.py`, `folha.py`, `costura.py`, `difbanda.py`, `ver.py`. `lambda/` tem o código da função (cópia do S2, com a troca de execução descrita em `placa_s1.py`).

## Recursos criados (ficam até o Gusta mandar apagar)
Conta 903373620308, us-east-1:
- Função `arn:aws:lambda:us-east-1:903373620308:function:hookmill-legenda-s1`
- Role `arn:aws:iam::903373620308:role/hookmill-legenda-s1-role`, só `AWSLambdaBasicExecutionRole`; arquivos por URL assinada
- ECR `903373620308.dkr.ecr.us-east-1.amazonaws.com/hookmill-legenda-s1`, 3 imagens
- Log group `/aws/lambda/hookmill-legenda-s1`, retenção 7 dias
- `s3://remotionlambda-useast1-9dano8maol/legenda-s1/`, 54 objetos, 398 MB; fora do `renders/`, então sem expiração automática

Parado: ~US$ 0,06/mês (ECR ~530 MB estimados, S3 398 MB). Função parada: 0.
Remover, em `scripts/`: `S1_BUILD=/tmp/s1 S1_WHL=/tmp node deploy.mjs apagar`
