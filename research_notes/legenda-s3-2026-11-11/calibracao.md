# Calibração dos portões da legenda com a S3 (12/11/2026)

Escopo do F2 (decisão do Gusta, 12/11): **legenda branca simples, 1 linha, caixa alta**. Caixa mista e 2 linhas continuam reprovando (F2b).
Verdade usada: o Gusta aprovou **30, 27, 54, 07 e 09** nas 3 versões. Os outros 7 (00, 26, 05, 29, 11, 37, 02) foram reprovados **na saída da 1ª versão do detector** (que mirava a headline, deixava CTA manchado, etc.). Depois do conserto do detector, 26, 05 e 37 saem visualmente limpos (ver abaixo): o veredito dele sobre eles precisa ser refeito.
Medidas: **Lambda de teste `hookmill-legenda-f2`** (x86_64) para 30, 27, 54, 07, 09, 26 e 37; Mac (detector novo, placa local) para 00, 29, 11, 02 e 05 (mesmos arquivos de 720 px). Pré-placa Lambda × Mac: iguais até a 3ª casa em 6 de 7 (30, 27, 54, 09, 26, 37); o 07 deu IoU 0,806 na Lambda contra 0,643 no Mac (fonte/Raqm; as duas passam o limite novo).
Regra: **limite novo = pior aprovado + folga mínima**. A função é `avaliarPortoesLegenda` / `avaliarPlacaLegenda` (`api/src/medicao/troca/legenda.ts`, constantes `PORTOES_LEGENDA` e `PORTOES_PLACA`; testes em `troca.spec.ts` com os números abaixo).

## Decisão final (12/11): limites apertados
O Gusta delegou: **voltar ao mais justo que ainda aprova os que saem limpos (30, 27, 54, 07 e 26/05) e reprova o 09 e o 37.** A 1ª calibração (coluna "folgado") passava o 09 e deixava `iou`, janelas ruins e letra p95 sem poder de separar. A coluna "final" é a que está em `PORTOES_LEGENDA` / `PORTOES_PLACA` e fixada em `troca.spec.ts`.

| portão | inicial (contrato) | folgado (só 5 aprovados, com o 09) | **final** | de onde vem o valor final |
|---|---|---|---|---|
| `cobertura` (≥) | 0,80 | 0,75 | **0,79** | pior que passa: 26/05 = 0,795 (folga 0,005). O 09 mede 0,764 → `not_detected` |
| `iou_mediana` (≥) | 0,60 | 0,28 | **0,365** | pior que passa: 26 = 0,368. O 37 mede 0,363 (folga 0,003), o 09 0,291, o 02 0,273 |
| `herdados` (≤) | 0,15 | 0,88 | **0,495** | pior que passa: 26 = 0,489. O 37 mede 0,500 (folga 0,006), o 09 0,858 |
| `estilo_var` (≤) | 0,05 | 0,05 | **0,04** | pior que passa: 07 = 0,031. O 00 mede 0,074 |
| `fundo_lap` (≤) | 60 | 45 | **40** | pior que passa: 30 = 37,6. 29 e 11 medem 47,1 e 52,7 |
| `animacao` (≤) | 0,08 | 0,03 | **0,02** | pior que passa: 07 = 0,005. 02 mede 0,023, 29 e 11 0,47 e 0,46 |
| `pessoa_fala` (≥) | 0,80 | 0,72 | **0,74** | pior que passa: 54 = 0,744. 29 e 11 medem 0,694 e 0,628 (faceTrack suposto) |
| `linhas` (≤) | 1 | 1 | **1** | detector: vão > 33 % da altura da letra e massa ≥ 40 % da maior |
| `ruim_pct` (≤, placa) | 0,20 | 0,80 | **0,80** | pior que passa: 07 = 0,77. 37 mede 0,83. **Não separa o 07 do 09 (0,77 × 0,74)** |
| `ruim_gancho_s` (≤) | < 1 | 2,5 | **1,5** | pior que passa: 1,0 (30, 07). 09 = 2,0; 37 = 3,0 |
| `letra_p95_pct` (≤) | 0,5 | 17 | **4** | pior que passa: 07 = 3,45 (Lambda). 09 = 8,44 (Lambda) / 15,15 (Mac): as setas brancas |
| `fora_buraco_media` (≤) | 1,5 | 1,65 | **1,3** | pior que passa: 54 = 1,22. 09 = 1,56; 37 = 1,51 |
| `cor_deslocamento` (≤) | 1,5 | 1,65 | **1,3** | mesma medida da anterior, com matriz de cor desconhecida |

**Quem reprova o quê agora:**
- **09:** `not_detected` já no pré-placa (cobertura 0,764 < 0,79; também IoU 0,291 e 86 % herdados). Pós-placa, mesmo se passasse, reprova por letra p95 (8,44 > 4), fora do buraco (1,56 > 1,3) e gancho (2,0 > 1,5).
- **37:** `font_mismatch` no pré-placa por margem mínima (IoU 0,363 < 0,365; herdados 0,500 > 0,495). Pós-placa reprova por janelas ruins (0,83 > 0,80), gancho (3,0 > 1,5) e fora do buraco (1,51 > 1,3).
- **26 / 05:** passam (cobertura 0,795 ≥ 0,79; IoU 0,368 ≥ 0,365; herdados 0,489 ≤ 0,495) e a placa da Lambda é limpa (janelas ruins 0).
- **00** `font_mismatch` (herdados 0,566), **29** e **11** `not_detected`, **02** `animated` (0,023 > 0,02): continuam reprovados.
- **Atenção às margens:** `iou` e `herdados` separam o 37 do 26 por **0,003** e **0,006**. É calibração de 7 vídeos, não é folga estatística. O `checkCaption` por visão (6 piores quadros) é a 2ª camada, não o único filtro.

## Valores por vídeo (pré-placa)
| vídeo | veredito do Gusta | cobertura | IoU | herdados | animação | estilo_var | fundo | linhas | pessoa_fala | resultado com os limites novos |
|---|---|---|---|---|---|---|---|---|---|---|
| 30 | aprovado | 0,909 | 0,760 | 0,439 | 0 | 0,018 | 37,6 | 1 | 0,828 | swap, placa ok |
| 27 | aprovado | 0,945 | 0,500 | 0,062 | 0 | 0,028 | 35,6 | 1 | 0,817 | swap, placa ok |
| 54 | aprovado | 0,951 | 0,497 | 0,125 | 0 | 0,027 | 35,0 | 1 | 0,744 | swap, placa ok |
| 07 | aprovado | 0,982 | 0,806 | 0,404 | 0,005 | 0,031 | 14,9 | 1 | 0,840 | swap, placa ok (letra 3,45 ≤ 4) |
| 09 | aprovado (reprova nos limites finais) | 0,764 | 0,291 | 0,858 | 0,014 | 0,018 | 29,5 | 1 | 0,943 | `not_detected`; placa também reprova |
| 00 | reprovado (alvo errado) | 0,970 | 0,419 | 0,566 | 0,015 | **0,074** | 14,0 | 1 | 0,856 | `style_unstable` |
| 26 (= 05) | reprovado (alvo errado) | 0,795 | 0,368 | 0,489 | 0 | 0 | 5,3 | 1 | 0,850 | **swap, placa ok** (placa limpa) |
| 37 | reprovado (caixa vermelha pela metade) | 0,997 | 0,363 | 0,500 | 0 | 0 | 28,9 | 1 | 0,788 | `font_mismatch` (margem 0,003); placa também reprova |
| 29 | reprovado | **0,597** | 0,374 | 0,825 | **0,472** | 0 | **47,1** | **2** | **0,694** | `not_detected` |
| 11 | reprovado | **0,638** | 0,286 | 0,906 | **0,464** | 0 | **52,7** | 1 | **0,628** | `not_detected` |
| 02 | reprovado (caixa mista) | 0,993 | **0,273** | 0,206 | 0,023 | 0 | 35,1 | 1 | 0,900 | `animated` (0,023 > 0,02); também IoU |

## Valores por vídeo (pós-placa, Lambda; janelas de 0,5 s em quadros)
| vídeo | ruim_pct | gancho_s | lisura mín | trem máx | degrau máx | letra p95 | fora do buraco | status |
|---|---|---|---|---|---|---|---|---|
| 30 | 0,04 | 1,0 | 0,55 | 1,75 | 4,3 | 0 | 1,20 | READY |
| 27 | 0,09 | 0,5 | 0,44 | 2,02 | 4,5 | 0 | 1,21 | READY |
| 54 | 0,10 | 0 | 0,47 | 11,2 | 4,8 | 0 | 1,22 | READY (r4, depois do conserto do áudio) |
| 07 | 0,77 | 1,0 | 0,40 | 5,98 | 7,1 | 3,45 | 0,94 | passa nos limites finais (reprovava pelos iniciais) |
| 09 | 0,74 | 2,0 | 0,42 | 7,58 | 16,2 | 8,44 | 1,56 | **reprova** nos limites finais (r4, janela corrigida a 60 fps) |
| 26 | 0 | 0 | (liso) | 0 | 0 | 0 | 0,08 | READY (r4) |
| 37 | 0,83 | 3,0 | 0,48 | 5,17 | 7,1 | 0 | 1,51 | **reprova** (janelas, gancho, fora do buraco) |
- Dois bugs de execução achados e corrigidos na Lambda: (1) o áudio mais curto, com `-shortest`, cortava 3 quadros da placa (54, 26: `plate_failed`); (2) a janela de 15 quadros fixa virava 0,25 s a 60 fps no 09 e o gancho contava o dobro (4,5 s impossível).
- Custo da calibração na Lambda: r3 US$ 0,0889 (7 vídeos) + r4 US$ 0,0511 (54, 26, 09 de novo) = **US$ 0,140**.
