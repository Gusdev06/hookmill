# Remover legenda queimada com IA: pesquisa (28/10/2026)

Pesquisa sem gasto: nenhuma chamada paga, nenhum código de produto. Preços da WaveSpeed tirados de `wavespeed models` / `wavespeed schema` (CLI v0.4.2, catálogo ao vivo em 28/10) e das páginas dos modelos. O resto vem das páginas públicas. **Nada aqui teve a qualidade testada.**

## O caso
Campeão 9:16, 15–90 s, karaokê palavra a palavra queimado no vídeo, às vezes grande e no centro, por cima do rosto. Esse é o pior caso pra qualquer inpainter: o modelo precisa reconstruir boca e queixo que **nunca aparecem** embaixo da legenda. Quando a palavra muda a cada ~0,3 s, o trecho coberto muda junto e alguns frames vizinhos mostram o rosto, o que ajuda os modelos com propagação temporal (ProPainter, STTN, E2FGVI). Uma legenda fixa sobre a boca não tem como ser recuperada; o modelo só pode inventar.

Vantagem nossa: a visão (`claude/edicao.ts`) já devolve as **caixas e os frames das legendas** (`layers[]`), e a medição já tem a trilha do rosto. Com isso dá pra gerar a **máscara em vídeo** sem OCR. Os modelos que pedem máscara ficam viáveis.

## Opções

| Opção | Entrada | Preço | Duração máx. | Resolução | Tempo | Licença comercial | Texto grande sobre rosto |
|---|---|---|---|---|---|---|---|
| WaveSpeed `wavespeed-ai/video-watermark-remover` | só `video` (detecta sozinho) | US$ 0,01/s (mín. 3 s) → 60 s = US$ 0,60 | 10 min | não informada | 5–20 s de processamento por s de vídeo | não informada ("depende do provedor") | a página promete "captions, burned-in subs", sem relato de rosto. Sem máscara não dá pra mirar a área |
| WaveSpeed `wavespeed-ai/video-eraser` | `video` + `prompt` e/ou `mask_image` (máscara **estática**) | US$ 0,02/s → 60 s = US$ 1,20 | 10 min | não informada | não informado | não informada | máscara fixa cobre toda a faixa da legenda, então apaga mais rosto do que o necessário |
| WaveSpeed `bria/video-eraser/mask` | `video` + `mask_video` | US$ 0,05/s | **5 s por pedido** (60 s = 12 pedidos + emenda) | não informada | ~20 s por pedido | Bria treina com dados licenciados (confirmar nos termos) | sem relato |
| WaveSpeed `bria/video-eraser/prompt` | `video` + `prompt` | US$ 0,14/s | 5 s (provável, mesma família) | não informada | não informado | idem Bria | o prompt "text" sem máscara é arriscado |
| WaveSpeed `wavespeed-ai/void-video-inpainting/mask` | `video` + `prompt` + `mask_video` (quadmask) ou `mask_prompt` (SAM-3) | US$ 0,05 de base (unidade não confirmada) | não informada | não informada | não informado | não informada | é inpainting generativo, então tende a inventar rosto. Descrição da página copiada errada (fala de ERNIE Image) |
| fal.ai `bria/video/erase/mask` | `video_url` + `mask_video_url` | US$ 0,14/s → 60 s = US$ 8,40 | não informada | não informada | não informado | **sim, "commercial use"**, treinado com dados licenciados | sem relato |
| Replicate `jd7h/propainter` | vídeo + máscara | ~US$ 0,05/run (L40S, ~51 s, varia muito com a entrada) | limitada pela VRAM (corta em `subvideo_length`) | `resize_ratio` (baixa a resolução) | ~1 min | **não**: ProPainter usa a NTU S-Lab License 1.0 (não comercial) | melhor propagação temporal do grupo. Inventa rosto quando a área nunca aparece |
| Open-source `YaoFANGUK/video-subtitle-remover` (VSR), no RunPod | vídeo (detecção por PaddleOCR ou caixa `-c`) | só GPU: ~US$ 0,4–0,8/h numa 4090/L40S no RunPod | sem limite | nativa | STTN rápido, ProPainter lento | repo Apache-2.0. **Atenção:** o modo ProPainter herda a licença não comercial, e STTN/LAMA precisam ter a licença conferida | o próprio README recomenda STTN pra gente real. A comunidade relata borrão/"mancha" quando a legenda é grande |
| Open-source E2FGVI / DiffuEraser / MiniMax-Remover, no RunPod | vídeo + máscara | só GPU | VRAM | nativa | min/clipe | E2FGVI não comercial (confirmar). DiffuEraser e MiniMax-Remover declaram licença aberta (confirmar antes de uso comercial) | os de difusão (DiffuEraser) inventam detalhe melhor que os de fluxo. Ainda não verificado |
| Higgsfield | — | — | — | — | — | — | não achei ferramenta de remoção de texto em vídeo (tem reframe, upscale, remove_background de imagem). Não serve |

## Recomendação pra sonda (≤ US$ 2, só com ok do Gusta)
1. **`wavespeed-ai/video-watermark-remover`**: mais barato, automático, sem máscara, conta já existe. É a linha de base.
2. **`bria/video-eraser/mask` na WaveSpeed**: máscara em vídeo gerada pelas nossas caixas de legenda, com proveniência comercial melhor. Mostra se a máscara precisa resolve o problema da legenda sobre o rosto. Limite de 5 s por pedido, então a sonda usa trechos de 5 s.

O caminho RunPod (VSR com STTN) fica pra depois, se as duas falharem no rosto. Ele é barato em escala, mas pede worker próprio e conferência de licença.

## Plano da sonda (estimativa US$ ~1,10)
- **Vídeos:** 3 campeões dev com karaokê real (um com legenda no rodapé, um com **legenda grande no centro sobre o rosto**, um com fundo em movimento). Se as fixtures servirem: `testes/fixtures/campeoes/fala-split-20s.mp4` e `400px-12s.mp4`, sem confirmar que têm legenda queimada. Os sintéticos não reproduzem o pior caso, então prefira campeões reais.
- **Corte:** um trecho de 10 s de cada (ffmpeg, local, grátis), mais um sub-trecho de 5 s dele pra Bria.
- **A:** watermark-remover em 3 × 10 s = **US$ 0,30**.
- **B:** máscara local (caixas da visão, dilatadas em 8 px, ou caixa manual no 1º teste) → bria mask em 3 × 5 s = **US$ 0,75**.
- **Ao baixar:** valide decodificando o arquivo inteiro (armadilha do download truncado), confira duração, fps, resolução e se o áudio veio.
- **Julgamento:** contact sheet lado a lado (original | A | B) em 6 frames por vídeo, com foco em boca e queixo. Notas: resto de texto, borrão, rosto deformado, flicker entre frames e mudança de cor fora da máscara.
- **Critério:** passa se não sobrar texto legível e o rosto não deformar no caso "centro sobre o rosto". Se só passar no rodapé, a opção sai como "só legenda fora do rosto".
- Registrar o resultado em `docs/integracoes.md`.


## Decisão do Gusta — 28/10, após a sonda
Os dois removedores foram rejeitados por qualidade. **Sonda interrompida, não repetir chamadas e não oferecer remoção com IA no produto.** Seguir com templates que preservam a legenda original e posicionamento dos elementos nas áreas livres. Sem posição segura: excluir o formato antes de gerar. Quatro pedidos já tinham sido enviados (estimativa conjunta US$ 0,70); a terceira dupla não foi enviada. Um pedido estava pendente quando o processo foi interrompido; custo final ainda não conciliado.
