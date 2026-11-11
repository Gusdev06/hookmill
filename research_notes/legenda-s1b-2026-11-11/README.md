# S1b da legenda (11/11/2026): porta real na Lambda de teste

Contrato: `docs/contratos/troca-texto-queimado-v1.md` §15.6, §15.9, §16.8. Fora do produto. **Função de teste `hookmill-legenda-f2`** (x86_64, 3008 MB, 300 s; a de produção `hookmill-legenda` não foi tocada). Pela porta de verdade: `TrocaTextoOrquestrada` + `ExecutorLambda` (`api/src/medicao/troca/s1b-lambda.ts`), bucket S3 temporário apagado no fim. Vídeos e transcrições = os da S1 (13, 02, 05, 120 s).
**Custo real da S1b: US$ 0,0895** (33 invocações, pela linha REPORT x preço público x86_64; fatura não conferida). Detalhe: 13/02/05 = 0,0456; 120 s só `detectar` = 0,0062; 120 s `detectar` + placa + conferência = 0,0377.

## Tempos (Lambda, billed)
| vídeo | `detectar` | placa (maior pedaço / total) | conferência | custo (detectar + placa + conferência) | RSS máx |
|---|---|---|---|---|---|
| 13, 21 s | 80,4 s (frio) | 49,4 s / 65,9 s | 9,1 s | 0,0039 + 0,0084 | 728 MB |
| 02, 30 s | 101,5 s | 43,8 s / 61,6 s | 11,0 s | 0,0050 + 0,0090 | 554 MB |
| 05, 30 s | 93,3 s | não gerada (animated) | | 0,0046 | 223 MB |
| 120, 128 s, com `captionBox` | **300 s: estourou o timeout** (1ª versão do detector); depois da otimização **126 s (frio), 97,6 s (quente)** | **183 s / 230 s** | 42 s | 0,0048 + 0,0329 | 789 MB |
- **`detectar` em 30 s = 80-101 s: não passa (meta ≤ 60 s)**, mas esses 3 números são da 1ª versão do detector. A otimização (decodifica só a faixa, recorte no YUV antes da conversão, `select` 1/5 no passo da faixa, miniaturas em cinza direto do ffmpeg, `-ss` em vez de `trim`) cortou a conta por quadro uns 4×: 120 s (3844 quadros) passou de >300 s para 97-126 s. **Não re-medi os de 30 s depois dela** (esperado ~25-35 s). Com `captionBox`: 98 s quente, meta ≤ 120 s passa.
- **Placa de 128 s: 230 s, meta ≤ 120 s: não passa.** Os 4 pedaços saíram de 405, 628, 1201 e 1610 quadros e levaram 94, 123, 149 e 180 s: **~65 s fixos + 0,075 s por quadro**. A pegada não balanceia isso (o custo fixo domina). Com 8 pedaços de ~480 quadros dá ~100 s. Pedido ao arquiteto: `maxPedacos` 8 acima de 60 s (custo +~US$ 0,01).
- Placa de 21-30 s: 62-66 s no total (meta ≤ 90 s: passa). RSS 0,55-0,79 GB (meta ≤ 1,5 GB: passa).

## Estilo e portões (pré-placa), com o `fontId` NÃO usado (pior caso: as 16 fontes competem)
| vídeo | fonte e corpo achados (S1) | IoU mediano (S1) | herdados | animação | estilo_var | fundo (Laplaciano) | veredito |
|---|---|---|---|---|---|---|---|
| 13 | Poppins 900, 56 (Gabarito 900, 58) | 0,775 (0,747) | 0,06 | 0,025 | 0,018 | 37,1 | swap |
| 02 | Gabarito 700, 49 (Gabarito 900, 47) | 0,751 (0,745) | 0,03 | 0 | 0,021 | 38,9 | swap |
| 05 | Poppins 900, 68 (Poppins 800, 66) | 0,809 (0,813) | 0,19 | **0,10** | 0,10 | **67,1** | `animated` |
| 120 (com `captionBox`) | Gabarito 900, 67 (Gabarito 900, 53) | **0,515** (0,482) | **0,54** | 0,025 | 0 | 35,4 | `not_detected` (cobertura 0,74) |
- **120 s não passou: IoU 0,52 e 54 % de trechos herdados.** O teto de 130 s **não** é concedido; fica 60 s (`LEGENDA_MAX_SEC=60`). Causa não isolada (a hipótese de 2 pessoas e tela final não foi testada: não removi a tela final).
- A fonte "certa" (Gabarito) aparece nos 3 que a têm no catálogo; a escolha 13 = Poppins 900 em vez de Gabarito 900 vem da cor correta (§15.6.6: o detector antigo lia a matriz errada e o amarelo mudava a máscara). IoU subiu em 13 e 02.
- **05 reprova por `animated` (0,10 contra 0,08) e `busy_background` (67 contra 60), e a S2 o aprovou.** O meu Laplaciano usa anel de 31 px em volta das letras; a F0 media no anel de 15 px do buraco. Os valores NÃO são comparáveis com "bom 36-49, ruim 73-82": falta recalibrar na S3 (o Gusta marca).

## Portões pós-placa (janelas de 0,5 s, só tomadas com legenda e sem corte)
| vídeo | janelas ruins | ruim nos 3 s do gancho | letra p95 | fora do buraco | lisura mín | trem máx | degrau máx | resultado |
|---|---|---|---|---|---|---|---|---|
| 13 | 41 % (F0: 43 %) | 3,0 s | 0,99 % | 1,10 | 0,23 | 3,2 | 6,3 | REJECTED |
| 02 | 44 % (F0: 40 %) | 2,5 s | 0 % | 1,03 | 0,47 | 14,8 | 5,9 | REJECTED |
| 120 | 55 % (F0: 58 %) | 2,5 s | 0 % | 0,86 | 0,26 | 17,7 | 11,2 | REJECTED |
Os números reproduzem os da F0 (§15.6.1): **com a regra provisória (gancho ≥ 1 s ruim ou > 20 % ruim) nenhum dos 3 sai**, como a F0 previu. O Gusta aprovou 13, 02 e 05 a olho; a pergunta 1 do contrato (tolerância) segue aberta e a S3 é o que calibra. `salto_emenda_db_min` (21-26 dB) mede o PSNR entre quadros vizinhos na emenda, não é o da S1 (39-41 contra 46-58): não comparável.

## O que NÃO foi medido
Segunda versão do `detectar` nos de 30 s; balanceamento com 8 pedaços; `fontId` da visão (a legenda do 120 não tem equivalente no `FontId` do contrato: Gabarito, Poppins 800/900, Archivo largo e Manrope não estão no `FONT_CATALOG`); 120 s sem a tela final.
