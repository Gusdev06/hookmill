# T1 real — Templates IA com prévias (F10 podcast dupla), 09/11/2026

Autorizado pelo Gusta em 09/11 (teto US$ 4 / 2 vídeos). API própria do worktree `with-ai-previas` em live na 3161 (`t1-api.sh`), banco `maquina_previas`, workspace INTERNAL "T1 prévias (09/11)" com teto mensal de US$ 4, `TEST_MODE=off`, render Remotion local, WaveSpeed por polling. Oferta fictícia "Renda extra com IA", R$ 97, PT.

## Resultado: PASSOU

| item | resultado |
|---|---|
| Prévias | 4 em 273 s (`PLAN_READY`), ângulos distintos (emprego, ordem, preço R$ 97, "um dia"), 4 duplas, 8 pessoas diferentes, voz no gênero do rosto, nenhum fato fora da oferta |
| P4 (aprovar mais depois) | A aprovada → vídeo pronto → voltei e aprovei D no mesmo lote → pronto |
| Tempo até MP4 | A ≈ 6,5 min (39,7 s de vídeo); D ≈ 5,5 min (29,7 s) |
| Download | os 2 MP4 decodificam inteiros (1080×1920) |
| Frame 0 vs. imagem aprovada | igual nos 4 falantes |
| Troca de pessoa / 2ª pessoa / mão inventada | nenhuma nas folhas 1 fps (`folha-A.jpg`, `folha-D.jpg`) |
| Alternância, legenda, CTA | ok: corta entre host e presenter, legenda palavra a palavra, card final |

## Custo real (`cost-entries.json`, 40 linhas) — US$ 2,08 de US$ 4

LLM 0,20 · imagens 0,048 · TTS 0,059 · lipsync 1,625 · transcrição 0,148. Prévias ≈ US$ 0,25 (estimativa 0,19–0,21). Vídeo ≈ US$ 0,92 cada (estimativa 0,85–1,30).

## Achados
1. **Prévia B (Bruno):** a foto tem outra pessoa cortada na borda e uma mão no quadro. É o risco de "segunda pessoa" do Pruna, que já aparece na imagem. Não aprovei. Sugestão: checagem na imagem da prévia (YuNet com mais de 1 rosto → refaz sozinho, ou avisa no card).
2. **Títulos, ângulos e "changes" em inglês** com o workspace em `PT_BR` (o contrato pede no idioma da interface). As falas saíram em PT, certo. O planejador provavelmente lê o idioma do usuário, não o do workspace.
3. **`cost.totalUsd` do lote** fica em 0,2496 depois dos vídeos: não soma TTS, lipsync e transcrição, que estão em `cost_entries`.
4. **Chave Anthropic** do `maquina-anuncios/api/.env` da VPS estava inválida (401). Trocada em 09/11 pela chave que o Gusta mandou (backup `.env.bak-2026-11-09`). A API de dev da VPS não chamava o Claude antes disso.

Arquivos: `batch-previas.json`, `batch-final.json`, `cost-entries.json`, `previas/*.png`, `AI-F10-A.mp4`, `AI-F10-D.mp4`, `t1.log`, `api.log`.
