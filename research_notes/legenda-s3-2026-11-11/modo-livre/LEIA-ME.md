# Modo livre (12/11): 15 vídeos da S3 na `hookmill-legenda-f2` com o Python novo

Entradas = cópias de 720p (crf 23) de `videos/NN-original.mp4` (as de 1080 sumiram): reprocessadas 2x, daí 07 e 54 caírem (letra 4,17 / not_detected) contra o 1080 original. Custo AWS: 0,050 + 0,030 + 0,039 = US$ 0,119.

| id | decisão (modo livre) | placa | observação |
|----|----------------------|-------|------------|
| 00 | padrão | REJECTED (gancho 2 s) | |
| 02 | padrão | REJECTED (letra 4,42 > 4) | |
| 05=26 | copiado | READY | |
| 07 | copiado | REJECTED (letra 4,17) no 720; OK no 1080 (3,4) | |
| 09 | bloqueado not_detected | - | no 1080 (0,764) seria padrão, mas placa reprova (letra 8,4, fora 1,56) |
| 11 | bloqueado not_detected | - | |
| 21 | bloqueado not_detected (720); no 1080 padrão | - | |
| 27 | copiado | READY | |
| 29 | bloqueado not_detected | - | no 1080: busy_background |
| 30 | copiado | READY | |
| 37 | padrão | REJECTED color_shift | |
| 54 | bloqueado not_detected (720); copiado no 1080 | - | |
| 55 | bloqueado not_detected | - | |
| 60 | copiado | REJECTED color_shift | |

Nenhum vídeo real ficou em "padrão + placa READY": a placa (letra/cor/gancho) é que barra os que o estilo não copiava. Para provar o VISUAL do padrão, as 3 peças foram renderizadas com `estilo` FORÇADO para `padrao` em placas READY reais (26 live, 27 question_box, 30 ranking): `folha-*.png` (linha de cima = original, de baixo = peça; quadros 15/40/65/90 %).
