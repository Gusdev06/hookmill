# G1 (troca-texto §16.8): `medir_headline` e `placa_headline` na função real, 2026-11-06

**Veredito: passa, com 2 achados.** As 5 medidas e as 2 placas rodaram na `hookmill-legenda` (arm64, 3008 MB, 300 s), dentro do timeout. Fantasma (A2) dentro do limite e quadros iguais nas 2 placas. Custo Lambda da rodada final: **US$ 0,0106 em 22 invocações**. Com as 2 rodadas que falharam antes: **US$ 0,025 no total**. Teto pedido: US$ 0,02 estimado, parar acima de US$ 0,10.

## O que rodou
- **Deploy** (invocação pelo usuário da API `hookmill-remotion-deploy` conferida com 1 `versoes`) com `scripts/legenda-lambda.mjs deploy`, credencial admin da cadeia padrão (`gusta-cli`), sem Docker. O deploy criou o ECR `hookmill-legenda`, a role `hookmill-legenda-role` (só logs), a função e a permissão de invocação para `hookmill-remotion-deploy`, com logs guardados por 7 dias. Imagem final: `hookmill-legenda@sha256:7c9cbfa8…`. `REMOTION_SERVE_URL` e a função de render não foram tocados.
- **Runner:** `api/src/medicao/troca/g1-lambda.ts`, a porta de verdade (`TrocaTextoOrquestrada` + `ExecutorLambda`). A prova de fonte roda no Chrome local, como na API. Os arquivos ficaram num bucket S3 **temporário** (`hookmill-g1-tmp-*`), apagado no fim de cada rodada. O storage do produto não foi usado.
- **Casos** (`casos-g1.json`): os 4 da S4 (02, 05, 06 e o solto `original.mp4`) e **`solto-longo-60s-derivado`**. Este é DERIVADO: o `original.mp4` em loop até 60 s, escalado para 720×1290, com 1800 quadros. Só existe 1 solto real.
- **Só a S4 tem headline:** os campeões de `testes/fixtures/campeoes/` não têm headline queimada, e os de painéis só existem no Mac.

## Resultado por caso
| caso | tipo | intervalo | fonte (Lambda) | corr | medir (parede) | placa |
|---|---|---|---|---|---|---|
| 05 | caixa | [0,191) | **albert-sans-500** `same` | 0,770 | 25,7 s (fria) | — |
| 02 | caixa | [0,198) | tiktok-sans-600 `same` | 0,885 | 15,2 s | — |
| 06 | caixa | [0,335) | tiktok-sans-500 `same` | **0,710** | 12,5 s | — |
| solto | solto | [0,161) | arimo-600 `close` | 0,827 | 9,1 s | READY, 564/564 quadros, 20,1 s, fantasma 0,50 / corr 0,034 |
| solto 60 s (derivado) | solto | [0,161) | arimo-600 `same` | 0,871 | 18,0 s | READY, 1800/1800 quadros, 99,6 s, fantasma 0,32 / corr 0,025 |

## Tempo e custo por invocação (rodada final; preço arm64 de us-east-1, Billed Duration × 2,94 GB)
| caso | op | cobrado s | parede s | pico MB | fria | US$ |
|---|---|---|---|---|---|---|
| 05 | medir_headline medida | 22,7 | 23,1 | 277 | sim | 0,00089 |
| 05 | medir_headline régua | 1,1 | 1,2 | 91 | | 0,00004 |
| 02 | medir_headline medida | 12,8 | 12,8 | 284 | | 0,00050 |
| 02 | medir_headline régua | 1,0 | 1,1 | 74 | | 0,00004 |
| 06 | medir_headline medida | 10,3 | 10,4 | 185 | | 0,00041 |
| 06 | medir_headline régua | 0,9 | 1,0 | 67 | | 0,00003 |
| solto | medir_headline medida | 7,1 | 7,2 | 123 | | 0,00028 |
| solto | medir_headline régua | 0,7 | 0,8 | 62 | | 0,00003 |
| solto | sondar | 0,5 | 0,6 | 54 | | 0,00002 |
| solto | placa_headline ×4 (pedaços) | 4,5 / 5,2 / 6,0 / 18,1 | até 18,4 | até 269 | 3 de 4 | 0,00132 |
| solto | juntar | 1,0 | 1,0 | 36 | | 0,00004 |
| 60 s | medir_headline medida | 16,1 | 16,1 | 172 | | 0,00063 |
| 60 s | medir_headline régua | 0,8 | 0,9 | 66 | | 0,00003 |
| 60 s | sondar | 0,9 | 1,0 | 24 | | 0,00004 |
| 60 s | placa_headline ×4 (pedaços) | 13,8 / 13,9 / 34,1 / **96,6** | até 96,6 | até 475 | | 0,00620 |
| 60 s | juntar | 1,8 | 1,9 | 54 | | 0,00007 |
Detalhe em `chamadas.json`; medida, veredito e placa em `resumo.json`; looks em `looks/`.
**Por campeão (estimativa a partir desta rodada):** caixa ≈ US$ 0,0005-0,0009; solto de 19 s ≈ US$ 0,0017 (medida + placa); solto de 60 s a 720p ≈ US$ 0,0070.

## Corrigido durante o G1 (3 defeitos que só a função real mostrou)
1. **`sondar` com URL assinada falhava na Lambda:** o ffprobe estático não abre a URL do S3. Agora a op baixa o vídeo pelo `get`, como as outras, e o erro do ffprobe sai com o stderr (`orquestra.ts`, `py/worker.py`, `py/comum.py`).
2. **Placa com quadros a menos (494 de 564) e `plate_failed`:** a ffmpeg 7.0.2 da função descarta e duplica quadros pelo tempo ao ler `rawvideo` com `trim`. No solto real, ler a partir do quadro 135 dava 358 quadros em vez de 429. Reproduzi na VPS com a mesma build estática para x86 e corrigi com `-fps_mode passthrough` no leitor de quadros (`py/comum.py`). A ffmpeg 5.1 local não tinha o problema.
3. **Junção dos pedaços** (já corrigida na V3 real, entrou neste deploy): `duration` exata por pedaço no concat.
Testes: Python OK; `src/render` e `src/medicao/troca`, 184 passam e 3 são pulados.

## Achados em aberto
1. **A fonte e o corpo saem diferentes na Lambda e na VPS.** A causa é a arquitetura arm64, não a ffmpeg: a VPS com a mesma ffmpeg 7 estática reproduz o resultado local. A pré-seleção em Pillow sai diferente no arm64:
   - **05:** o corpo vai de 60,07 para 62,4 px e a régua troca TikTok Sans 500 por **Albert Sans 500**, que é a aprovada na S4 (empate: 0,770 contra 0,772 local).
   - **06:** a corr cai de 0,763 para 0,710; continua `same`.
   - **solto:** o corpo vai de 26,87 para 26,33 px.
   - **Consequência:** a peça depende de onde a medida rodou. Proposta: rodar as **duas** fases da régua (pré-seleção Pillow e ajuste fino) no mesmo lugar em todo ambiente, ou fixar a pré-seleção pela tabela de métricas do Chrome em vez de Pillow (§16.2 A3: "Pillow nunca decide"; hoje ela ainda escolhe o corpo inicial). Decisão do arquiteto.
2. **Pedaços desbalanceados no vídeo longo:** fora do intervalo, cada quadro pesa 0,05 no `planejarPedacos`, mas na Lambda recodificar 720p não é tão barato. O último pedaço do vídeo de 60 s levou 96,6 s; num campeão de 120 s a 720p a projeção é ~200 s, perto do timeout de 300 s. Proposta: subir o peso fora do intervalo para ~0,3, ou limitar o pedaço por quadros. Não mexi.

## E (§16.3), no solto real: **limite 0,15 PROVISÓRIO** (1 vídeo)
`ajustarHeadlineCopia` no look da VPS e no da Lambda:
| texto | VPS | Lambda |
|---|---|---|
| mesmas palavras | same, E 0 | same, E 0 |
| aprovada ("Tired of scrolling his endless following list?") | same, **0,055** | same, **0,054** |
| "Want to see who he follows now?" | too_short, 0,304 | too_short, 0,320 |
| curta ("See who he follows") | too_short, 0,594 | too_short, 0,603 |
| 1 linha ("See his new follows") | too_short, 0,585 | too_short, 0,594 |
| longa2 | rewrap, 0 | rewrap, 0 |
| longa (3 linhas) | grow, 0 | grow, 0 |
O corte de 0,15 separa a aprovada (0,055) do primeiro texto curto testado (0,30). Sem rastreio de rosto no caso, o `over_chin` da longa não foi testado. A calibração da §16.3 pede 5 soltos com o Gusta marcando: falta material (só há 1 solto real).

## Custo AWS que fica
O ECR guarda até 3 imagens (lifecycle), com ~260 MB de camadas compartilhadas, ≈ US$ 0,03/mês (ESTIMATIVA, US$ 0,10/GB-mês). A função parada não custa. Os logs ficam 7 dias. Para tirar tudo: `node scripts/legenda-lambda.mjs apagar`.
