# Render: tempo e memória medidos
Dono: maquina-video · Medido em 05/10/2026 (V1 pelo CLI, V2 pelo RenderService da API) · Remotion 4.0.533 · Node 24

## Como foi medido
- Máquina: Mac Apple Silicon, 16 GB de RAM. Ainda não medi numa VPS, então os números servem de piso: CPU de VPS é mais lenta.
- Amostra: 5 cenas Pruna 704x1280 já existentes no AIS-OS (`video/public/fixtures/`, nada pago), legenda com tempos do mlx-whisper local, end card de 2,5 s. Total de **32 s** (960 frames), saída 1080 de largura, 30 fps, H.264 + AAC.
- Comando: `video/scripts/medir-render.sh <composição> <concurrency> [flags do CLI]`. Ele roda `npx remotion render` e mede a cada 0,5 s a soma do RSS da árvore de processos (node + Chrome + compositor). No macOS o RSS conta a memória compartilhada do Chrome mais de uma vez, então o pico real é um pouco menor que o anotado.

## Resultado de referência: render pela API (V2, bundle de produção)
`api/src/render/amostra-real.ts` usa o `RemotionRenderService` de verdade, com `video/dist/bundle` e as cenas servidas por HTTP local (como as URLs assinadas do storage). Mede com `video/scripts/medir-processo.sh`.
| template · formato | abas do Chrome (`RENDER_FRAMES_CONCURRENCY`) | tempo | pico RSS (soma) | Chrome | node (API) | compositor | avisos de progresso |
|---|---|---|---|---|---|---|---|
| headline · 9:16 | 1 (padrão) | **110 s** | **1,7 GB** | 1,2 GB | 0,23 GB | 0,31 GB | 189 (1,7/s) |
| bold · 1:1 | 2 | 58 s | 2,2 GB | 1,6 GB | 0,27 GB | 0,32 GB | 107 |
Saída conferida: H.264 1080x1920 30 fps + AAC, 32 s, 27 MB. O pôster é o frame de 1,5 s. Li a folha de frames: gancho, legenda, CTA e end card ok.

## Molduras (composição `Moldura`, 25/10/2026)
`node video/scripts/molduras.mjs video 05-noticia <formato>` medido com `video/scripts/medir-processo.sh`: Notícia, 30 s do take quadrado de 31 s (`real-take.mp4`, 960x960 24 fps), 1 aba, cache de 256 MB, jpeg 90. O node inclui o webpack do bundle (na API ele cai para cerca de 0,2 GB, como na tabela de cima).
| formato | tempo do render | pico RSS (soma) | Chrome | node | compositor |
|---|---|---|---|---|---|
| 9:16 | 128 s | 1,9 GB | 1,0 GB | 0,7 GB | 0,2 GB |
| 4:5 | 111 s | 1,6 GB | 1,1 GB | 0,2 GB | 0,3 GB |
| 1:1 | 81 s | 2,4 GB (ffmpeg 0,4 GB no fim) | 1,2 GB | 0,5 GB | 0,3 GB |
Saída conferida: H.264 1080x1920/1350/1080, 30 fps, AAC, 30,0 s; folha de frames a cada 5 s em `video/out/molduras-producao-2026-10-25/video/`. Mesma ordem de grandeza do Criativo: a regra de 4 GB de RAM na VPS continua valendo.

## Remotion Lambda: sonda L1 (25/10/2026, arquiteto)
Plano e tabela completa em `docs/contratos/render-lambda-v1.md` §5.0. Script: `scripts/sonda-lambda-l1.mjs` (deploy, mídia no Supabase, render local de referência, render no Lambda, bytes baixados pelo CloudWatch, PSNR, nb_frames e áudio). Saída em `video/out/sonda-lambda-l1/`. us-east-1, função `remotion-render-4-0-533-mem3008mb-disk4096mb-300sec`, site `hookmill-l1-f557563`.
| peça | memória · fpl | parede | custo Lambda | mídia baixada |
|---|---|---|---|---|
| headline 9:16, 32 s | 3008 · 150 (7 pedaços) | 61-67 s | US$ 0,011 | 41,5 MB |
| headline 9:16, 32 s | 2048 · 150 | 79-88 s | US$ 0,011 | 41,5 MB |
| headline, 600 frames | 3008 · 75 (8 pedaços) | 41 s | US$ 0,008 | 41,1 MB |
| headline, 160 frames | 3008 · 20 (8 pedaços) | 11 s | US$ 0,0025 | 27,8 MB |
| Moldura Notícia 9:16, 30 s | 3008 · 150 (6 pedaços) | 50 s | US$ 0,010 | 45,7 MB |
- **Regra:** 3008 MB, `framesPerLambda` 150 enquanto a cota for 10. 2048 não economiza nada.
- **PSNR Mac × Lambda:** 31-32 dB no mínimo, só pela rasterização da fonte (CoreText × FreeType). Fora da borda dos glifos: 42,7-46,5 dB. Lambda × Lambda é determinístico (memória e frio/quente: idênticos). Comparação de render pra aceite tem que usar referência Linux.
- nb_frames ok em todos. Áudio: Notícia idêntico; no scratch, o mesmo áudio deslocado < 1 ms por cena.

## Medição anterior pelo CLI (V1; o node do CLI inclui o webpack)
| composição | formato | concurrency | tempo | pico RSS (soma) | Chrome | node (CLI) | compositor |
|---|---|---|---|---|---|---|---|
| headline | 9:16 | 1 | 111 s | 2,3 GB | 1,2 GB | 0,7 GB | 0,3 GB |
| bold | 9:16 | 2 | 68 s | 2,4 GB | 1,4 GB | 0,6 GB | 0,2 GB |
| clean | 9:16 | 2 | 68 s | 2,9 GB | — | — | — |
| bold (legenda em linha) | 4:5 | 2 | 62 s | 2,8 GB | — | — | — |
| headline (legenda no topo) | 1:1 | 2 | 56 s | 2,4 GB | — | — | — |

Na API, com o bundle pré-compilado, o node cai de 0,7 GB para 0,23 GB (tabela de cima).

## O que quebrou e o que ficou decidido
1. **`<Video>` do `@remotion/media` derrubou o Chrome** em renders longos com concurrency 1: o navegador caiu nos frames 746, 317 e 757 em 3 tentativas. Depois da queda, o Remotion reabre o navegador e cada frame passa a levar cerca de 14 s, então o render de 32 s levou **37 min**. Com cache de 256 MB (`--media-cache-size-in-bytes`) a queda continuou. **Troquei para `<OffthreadVideo>`** (a extração de frames sai do navegador e vai pro compositor em Rust). Rodei 6 renders completos depois disso, sem nenhuma queda.
2. **Por padrão, o cache de vídeo usa metade da RAM livre** quando o render começa. Numa VPS isso é perigoso. O `RenderService` tem que fixar `offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024`. Esse cache derrubou o compositor de 635 MB pra cerca de 270 MB sem perder tempo.
3. Duas abas são cerca de 1,9x mais rápidas que uma e custam uns 500 MB a mais.
4. **O download do Chrome em tempo de render derrubou o processo.** O `ensureBrowser()` tentou baixar o Chrome Headless Shell, o download travou e o timer do Remotion lançou um erro fora de qualquer `catch`, o que mata o Node. Na API isso derrubaria tudo. Regra: o Chrome é baixado no build da imagem (`npx remotion browser ensure`) e o caminho vai em `REMOTION_BROWSER_EXECUTABLE`.

## Recomendação pro RenderService (V2) e pro deploy
- Implementado em `api/src/render/`: `RENDER_SERVICE` (token) + `RenderModule`. Usa `renderMedia` com h264/jpeg/yuv420p, 1 aba, cache de 256 MB, fila FIFO com `RENDER_CONCURRENCY` (1), progresso em % inteiro 0-100, no máximo 2 avisos/s, e `RenderError` com o frame que falhou.
- Variáveis novas, que **o arquiteto precisa pôr no `api/.env.example`**: `REMOTION_BROWSER_EXECUTABLE` (obrigatória em produção) e `RENDER_FRAMES_CONCURRENCY` (opcional, padrão 1).
- Ordem de grandeza na VPS: um render de 30 s deve levar de 2 a 4 min com 1 aba (estimativa, a medir).
- **VPS: mínimo de 4 GB de RAM** pra API + 1 render. Com 2 GB a chance de o Chrome cair é real. Se a VPS tiver 8 GB, dá pra subir pra concurrency 2.
- Docker: rode `npx remotion browser ensure` no build e defina `REMOTION_BROWSER_EXECUTABLE`. O ffmpeg já vem no compositor do Remotion. A imagem precisa das libs de sistema do Chrome (lista em remotion.dev/docs/docker) e do `video/dist/bundle` (`npm run build -w video`).

## Pendente
- Medir na VPS de verdade (A2).
- **Licença do Remotion: ponto de revisão.** Hoje cabe no gratuito (vale para empresas de até 3 pessoas; somos 2, Gusta + Tordan, confirmado em 05/10). Revisar quando a Máquina virar agência ou SaaS com mais gente ou clientes renderizando, porque aí entra a licença de empresa.

## Medição (feature 2, V3: `api/src/medicao/`)
Medido em 06/10/2026 (Mac M-series, ffmpeg 6.0). Aceite do port do `analisar_estrutura.py` (clonar-edicao): `.py` e TS nos mesmos vídeos do swipe local, mídia fora do git (`projects/mentoria-spy/`).

| vídeo | cortes de layout .py → TS | maior diferença de corte | faixas | tempo .py → TS |
|---|---|---|---|---|
| `gram-detect/escalados/top3-ig-e-whatsapp/wpp-01-esther-vicman-…mp4` (360x640, 56,8 s) | 6 → 6 | 0,073 s (30,594 × 30,667: whip de 0,27 s) | 7 segmentos, mesmas faixas, 0 px | 6,8 s → 1,4 s |
| `gram-detect/referencias/2026-08-31-ladprofit-breaking-news-myoguard.mp4` (320x570, 45,4 s) | 0 → 0 | — | 1 segmento, 4 faixas, 0 px | 3,3 s → 0,7 s |
| `criativos/cp108-headline-vermelho-2026-10-06/REFERENCIA-108.mp4` (720x1280, 49 s) | 7 → 7 | 0,029 s | 8 segmentos, mesmas faixas, máx. 1 px | 11,9 s → 3,1 s |

**Aceite: passou** (cortes ±0,1 s, faixas ±2 px). Frames olhados: folha com as fronteiras medidas desenhadas sobre o meio de cada segmento (v1 e v3) e folha frame a frame das janelas disputadas (whip em 30,5 s do v1; flash preto de 4 frames em 41,2 s do v3, onde o TS marca 41,200 = 1º frame preto e o .py 41,188).

Diferenças deliberadas do `.py` (em `layout.ts`):
- **Refino do corte sem limiar absoluto.** O `.py` faz busca binária com "distância < 8". O TS decodifica todos os frames da janela e marca o 1º que passa da **meia altura do penhasco** (metade da maior distância ao layout antigo na janela). Em corte seco dá o mesmo frame. Num 4º vídeo (1080x1920, `hook-heading-22-caras…/149-…mp4`, fora do aceite) os dois discordam em 0,4 s (1,6 × 2,0): é movimento de câmera contínuo (sem corte de verdade, conferido na folha), o salto total era 6,6 e o `.py` nunca passa do 8, então devolve a borda da janela. Os dois chamam isso de corte de layout: falso positivo herdado (a estrutura de faixas da amostra muda com o celular entrando no quadro). Por isso a medição só alimenta texto no 10/10; no `REMIX_EDIT` conferir frame antes de cortar.
- **Varredura em stream**: um ffmpeg com `select` na grade do passo (mesmos frames que o `-ss` do `.py`, conferido por md5; o filtro `fps=` escolhe outros frames e desalinhava os candidatos). 1 frame em memória por vez.
- **Segmentos contíguos** de 0 ao fim (o `.py` deixa buraco onde descarta trecho < 0,3 s, ex.: começa em 0,062).
- `role`: o `.py` não distingue rosto de painel; sai `caption` / `unknown` (faixa lisa) / `panel`. `face` fica pra quem olha o frame (Claude no teardown).
- Herdado sem mudança: o candidato a corte usa `max(6, 4 × mediana dos saltos)`; borda perfeitamente nítida vira platô na suavização e a fronteira cai no 1º ponto dele (viés de até (k-1)/2 px, 4 px em 1920 de altura); a borda de baixo de um painel às vezes não aparece (v3).

**Memória e tempo em 1080x1920, 30,5 s** (`measureLayout` + `validateFull`): processo node 193 → pico 314 MB (+120 MB; o `.py` usa 200 MB), 4,0 s de medição + 0,5 s de decodificação inteira. Os ffmpeg filhos são um por vez.
Regras que valem no código: `silencedetect` com `-hide_banner`, nunca `-v error` (no `validateFull` o `-v error` é proposital: queremos só as linhas de erro). Truncado (moov no começo, mdat cortado) é pego pelo `validateFull` (Jest).

## remix-keep (feature 2, §13.6) e trilha do rosto (§13.1)
Medido em 06/10/2026 (Mac M-series, 16 GB, com outros agentes rodando na máquina: o tempo variou 125-176 s entre renders iguais). Script: `api/src/render/remix-real.ts <campeão> <clipe> <saída> swap|hook` (RenderService de verdade, arquivos por HTTP local, nada pago).
Caso: campeão `zap-working-late-v2-latino.mp4` (720x960, 30 fps, 913 frames) + clipe Pruna já existente `clipes/v3-asiatico.mp4` (960x960, 24 fps, 31 s).

| etapa | tempo | pico RSS (soma) | saída |
|---|---|---|---|
| `faceTrack` (layout + células + YuNet 5 amostras/s em worker + refino) | 4,1 s | node ~330 MB | região x 0-337, y 118-443, frames 0-913, 0 bloqueio |
| render swap, jpeg + crf 18 (1ª tentativa) | 84 s | 2,1 GB | **reprovado**: PSNR fora da região 29,8 dB |
| render swap, **png + crf 12 + bt709** (vigente) | 125-176 s | 1,4-2,3 GB (Chrome ~0,9-1,2 GB) | 913 frames, PSNR fora da região **41,0 dB** (mín 40,5), região ≠ campeão em todos os 913 frames (máx 17 dB), md5 do áudio = campeão (`6d7e5e5f…`) |
| render hook (headline redesenhada) | 135 s | 1,7 GB | 913 frames, PSNR fora da faixa 41,8 dB, md5 do áudio = campeão |

O que quebrou e ficou decidido:
1. **jpeg (qualidade 80) no meio + saída sem tag de cor** = 29,8 dB contra o campeão. O frame do Remotion em png é idêntico ao campeão (PSNR infinito, conferido com `renderStill`); a perda era o jpeg, o crf 18 e a matriz de cor (saída sem tag lida como bt601 → desvio de ~1,5 nível). `RENDER_REMIX = { imageFormat: 'png', crf: 12, colorSpace: 'bt709' }` (em `video/src/lib/formatos.ts`). O scratch segue em jpeg/crf 18.
2. **Render mudo + remux** `-c:v copy -c:a copy` do `audioPassthroughUrl`; depois conta os pacotes de vídeo: diferente do `canvas.frameCount` = `RENDER_ERROR` (as peças manuais da esteira saíram com 913 num campeão de 909 frames, esticadas até o áudio).
3. **Encaixe sem saber o tamanho do clipe**: o clipe fica no tamanho natural (`objectFit: none`, deslocado pelo `crop`) dentro de uma caixa do tamanho do crop escalada pra região. Nada de ffprobe no render: a composição vai igual pro Lambda.
4. **YuNet em worker_thread** (código em string, `eval`): não trava o event loop da API e evita o erro de realm do onnxruntime dentro do Jest. Modelo em `api/src/medicao/modelos/`; no `dist/` ele é procurado em `YUNET_MODEL_PATH`, ao lado do .js ou em `src/medicao/modelos/` (falta o `assets` no `nest-cli.json`, ver pendências).
5. **Células** por guilhotina (linhas → colunas → linhas) com diferença POR PIXEL entre linhas vizinhas e escolha de fronteira por força (o `.py` pegava a borda de texto em y=87 e perdia a da caixa em y=118). Limite conhecido: painel com listras verticais de alto contraste na altura toda (barras de teste) esconde a borda lateral da caixa; não aparece em tela de app real.
6. **Fundo da headline**: a barra do zap é um degradê vertical (vermelho 240 → 80), não cor única. `solidBackground` devolve `linear-gradient(...)` reconstruído das medianas das linhas de fundo (linha de letra é interpolada); o render pinta com `background: <color>`. ⚠️ Isso estende o campo `color` do contrato (hex OU gradiente CSS): o arquiteto precisa registrar.
7. **Presença da camada**: penhasco na distância ao frame de referência, aceito só se o salto passar de 1/4 do contraste do próprio recorte (a barra do zap "pulsa" 2,4 níveis a partir do frame 150; sem isso a headline durava só 5 s).

VPS: o remix em png usa mais CPU que o scratch; 1 aba continua cabendo em 4 GB. Medir na VPS (A2).

### Correções da rodada do QA (06/10 noite)
- Bloqueios do vídeo real: 2ª passada do YuNet **recortada na região** (o quadro inteiro reduzido a 640 deixava o rosto borrado nítido: 0,86 → recortado 0,50 = `low_confidence`); `multiple_faces` também conta rosto de tamanho parecido (≥ 60 % da altura) fora da região (dois rostos lado a lado); a câmera de segurança do zap (0,44) não conta.
- Células: borda só vale se for nítida em cada quarto do comprimento (listra da câmera embaixo não corta a caixa em cima); faixa fina com o mesmo conteúdo dos dois lados (legenda sobre o rosto em tela cheia) é fundida; níveis de dentro exigem ≥ 1/5 da borda mais forte; duas partições (y→x→y e x→y→x) e a região é a menor célula que contém o rosto. Fixture `cheia-caixa`: 2 trechos, o 1º `fullFrame`, borda no frame 150.
- `solidBackground`: semente = linha mais pura; caixa da visão que passa da faixa não arrasta o fundo; texto direto sobre vídeo = `null`. Faixa: fixture 0-119 exato; zap 0-116 (a barra real termina em 115-117 conforme a coluna).
- Limite aberto: legenda que cobre a borda da caixa o vídeo todo (`legenda-cruza`) junta a caixa com a célula de baixo; o bloqueio `caption_straddles_face` sai igual.

### Correção do PSNR (06/10 noite, 2ª rodada do QA)
O "41 dB" do meu aceite era o PSNR do ffmpeg (YUV); o `qa_video.py` mede em RGB por frame e dava 35,8 dB na mesma peça. A API não divergia do script: era o método. Correção: o RenderService **compõe a peça sobre o campeão decodificado** (máscara de alfa por frame com as regiões e as caixas das camadas; fora dela o pixel é o do campeão, só a codificação final crf 12 mexe), copia as tags de cor do campeão e o áudio (`-c:a copy`). Cada render tem a própria pasta (`RENDER_TMP_DIR/<renderId>/`), porque o backend apaga `dirname(outputPath)`. Resultado pelo `qa_video.py`: zap swap RGB mín **45,97 dB** (119 s, pico 1,8 GB); harness (porta 3111, mock): PC-01 48,1, PC-02 48,4, HK-03 50,3 dB, todos verdes.

### Avatar principal e painel em volta do rosto (bug do Gusta, AdLibNote, 06/10 noite)
- Principal = trilha de rosto (≥ 0,8) mais persistente × maior (`mainAvatar`); os outros rostos são b-roll. `multiple_faces` só com 2 rostos dentro da caixa do principal ou rosto de tamanho parecido (≥ 60 %) colado nela.
- Quando a célula tem outro rosto persistente dentro (AdLibNote: a borda câmera/app é escuro contra escuro e a guilhotina deixa 720x726), a região vira o painel do principal (`painel.ts`): candidatas a borda pelos picos nítidos em volta do rosto, cada retângulo medido pelo apoio dos 4 lados (fração do lado com borda nítida em todas as amostras), fica o menor com apoio ≥ 0,8 (porta no fundo tem apoio parcial e perde). AdLibNote: x0 y119 336x326; zap: x0 y118 336x325; fixtures do QA iguais.
- Fica de fora: desempate por boca × RMS da fala (só entra se duas trilhas empatarem em persistência × tamanho).

### Avatar principal no tempo + custo do faceTrack (07-08/10)
- Identidade: SFace (OpenCV Zoo, Apache-2.0, 37 MB, `api/src/medicao/modelos/baixar.sh`, fora do git; sem ele cai pra posição/tamanho). Principal = grupo de identidade mais persistente × maior no vídeo inteiro (cosseno ≥ 0,45; no podcast: mesma pessoa 0,65-0,97, convidada 0,0-0,3, b-roll ≤ 0,2). `timeline` classifica cada trecho em main / other_person / broll; só main vira região e só main bloqueia.
- Custo (CPU do processo, máquina com load 25-85 de outros agentes: a parede variou 2-4x): zap 30 s antes 44 s de CPU → 10-11 s; podcast 49 s → ~19 s; AdLibNote ~10 s; sintético 3 s 1,6 s. O que caiu: spin-wait do onnxruntime (desligado), identidade só no 1º rosto de cada corrida contínua (não por frame), YuNet a 3 amostras/s + 2/s recortado só nos trechos main, borda refinada com seek (antes decodificava o vídeo inteiro por borda), quadros do layout numa decodificação só, painel só quando a célula tem outro rosto. Medir de novo numa máquina parada / na VPS.

## V5: Trocar avatar com Kling/Seedance mantendo a edição (§13.15, 08/10)
Código: `api/src/medicao/troca-motor.ts` (`concatClips`, `trimToFrames`, `lastFrame`, `timeStretch`, `identityScore`, também como métodos do `MediaAnalysisService`), `api/src/render/troca-motor.ts` (`audioSplice` → `montarAudioSplice`, `mesclarPalavras`, exportado em `render/index.ts`), `video/src/RemixKeep.tsx` (`style.highlightBackground` opcional: caixa atrás da palavra atual). Jest: `medicao/troca-motor.spec.ts` (12) + `render/troca-motor.spec.ts` (6). Aceite: `api/src/render/troca-motor-real.ts <campeão> <saída> A|B [palavras.json legenda.json]`, motor/lipsync/transcrição **mock** (frames do próprio campeão espelhados e com outra cor, nada pago), cadeia e render de verdade.

| caso | cadeia (janelas, emenda, encaixe) | render | pico RSS (árvore) | resultado `qa_video.py peca` |
|---|---|---|---|---|
| podcast (A), 49 s, 4 trechos main | 44 s | 180 s | 2,2 GB | 1470 frames, **áudio md5 = campeão**, fora da região mín **47,4 dB**, região ≠ campeão em todos os 610 frames, 1 rosto em todos |
| zap (A), 30 s, 1 trecho de 30,4 s = **3 janelas encadeadas pelo último frame**, lipsync mock devolvendo 1 frame a menos (912 → `trimToFrames` 913) | 49 s | 106 s | 2,2 GB | 913 frames, áudio md5 =, fora mín **44,9 dB**, 913/913 diferentes, 1 rosto em todos |
| podcast (B), voz mock com ratio 1,05 / 0,95 / 1,00 / 1,07 (STRETCH/STRETCH/EXACT/STRETCH) | 45 s | 144 s | 2,3 GB | 1470 frames, fora da região e da legenda mín **47,4 dB**, 0 frame sem rosto; áudio: voz nova nos 4 trechos (correlação com o campeão 0,00-0,03), fora deles SNR 28-31 dB contra o campeão (perda da recodificação AAC 192 k, sem atraso: lag 0) |

Medido no Mac M-series com outros agentes rodando (tempos variam 2x). O `ok: false` do (B) no script é só o md5 do áudio, que por definição muda.

Decidido / achado:
1. **Borda do trecho com quadro de transição.** A → preto → B dá dois saltos iguais e o refino ficava com o preto: o rosto novo piscava onde o original era preto (podcast 352, 406, 606, 853). O `faceTrack` agora tira das bordas do trecho até 3 frames com a região chapada (desvio da luminância < 6). Podcast: [0,133) [228,352) [407,606) [854,1008).
2. **Ordem da emenda:** `trimToFrames` em cada janela (pedaço usado, não o genSec inteiro) → `lastFrame` da janela JÁ cortada (é o frame que aparece na emenda) → `concatClips` → `trimToFrames` no nº de frames do trecho. Depois do lipsync v2v, `trimToFrames` de novo (o `sync/lipsync-2` devolve 1 frame a menos; repõe o último).
3. `timeStretch(factor)`: factor = duração de saída / de entrada; no reencaixe (B) = duração do trecho / duração do corte (= 1/f).
4. `identityScore`: amostra sem rosto conta 0 (o clipe que perde o rosto reprova). Fixture: mesmo rosto 0,8+, rosto trocado < 0,363.
5. Karaokê redesenhado: a caixa da palavra (box-shadow 0,14em) entra na conta da largura, senão vazava 3 px da caixa e o PSNR fora caía pra 37 dB.
6. **Não dá "PCM idêntico fora dos trechos" com AAC**: o áudio montado é recodificado (AAC 192 k), e fora dos trechos fica ~30 dB de SNR, inaudível. Pra ficar idêntico, só emendando nos quadros AAC (pós-10/10).

## Editor F1 (spike, portão) — 09/10/2026
Contrato: `docs/contratos/editor-v1.md` §7, §8, §10. Código: `video/src/lib/editor.ts` (tipos do EditDoc, `layoutPadrao`, `aplicarDoc`, `ZONAS`/`ESCALA_TIPO` agora moram aqui), `video/src/player.ts` (entrada `@maquina/video/player`), `video/src/fontes.ts` (10 `.woff2` em `video/public/fonts`, `staticFile`), `Gancho`/`Legenda`/`Cta` guiados por `transform`. `EndCard` sem mudança (a correção do `clipStartSec` é F2b e muda o end card de take fatiado, de propósito).
- **(a) Doc nulo = render de antes.** `video/scripts/editor-f1/render-aceite.sh antes|depois` (bundle congelado, mesmos parâmetros do CLI) + `psnr.sh`. 7 peças: 5 `Amostras` + SCENES real (3 cenas Kling, headline, legenda no topo) + LIPSYNC real (take Pruna de 31 s fatiado em 4 cenas, bold). **PSNR RGB = inf em 100 % dos frames nas 7** (960 ×5, 1099, 981), framemd5 e áudio iguais. Controle negativo (clean × bold) = 0/960 inf. Tempo por peça: 43-92 s com concurrency 3 (igual antes e depois).
- **(b) Player × renderStill** (`player-fixtures.json`: 3 docs × frames 0, 45, 300 e último; `stills.mjs`, `player-prints.mjs`, `comparar.py`). Rodado aqui numa página de teste provisória (fora do repo, mesma entrada `@maquina/video/player`, Chrome headless do Remotion): com clipe preto (`basePreto`) **diferença 0 em todos os 12 frames** (≤ 2 exigido). Com a mídia real (`base`) as camadas batem, mas o fundo difere até 20 níveis (média 3-4): o `<video>` do Chrome converte cor diferente do OffthreadVideo (ffmpeg). Isso é do decodificador, não do layout; a prévia fica uns níveis mais clara. A verdade continua sendo o vídeo renderizado. Falta rodar o mesmo na página do web (maquina-frontend).

## Editor F2b (video do zero) — 09/10/2026
Código: `video/src/lib/editor.ts` (`resolverProps`, `validarDoc`, `normalizarDoc`, `layoutPadrao`, `estiloPadrao`, `cenasDoDoc`, `corteDaCena`), `Gancho`/`Legenda`/`Cta` com `estiloCamada` (LayerStyle: fonte do catálogo, cor, destaque, fundo Nenhum/Caixa/Pílula/Palavra, contorno, sombra, caixa alta, alinhamento; sem `style` no doc = caminho de hoje), `EndCard` com `trimBefore = clipStartSec`. Testes: `video/test/editor.spec.ts` (`npm test -w video`, 29 casos, uma regra do §5.4 por caso).
- **resolverProps emenda fatias contíguas do mesmo clipe** numa cena só (= `renderPieces` da API, palavras com `r3`), então doc nulo num take fatiado sai igual ao de hoje. Aparar o meio de uma fatia quebra a continuidade e a cena volta a ser separada. A duração emendada é a soma das fatias: a API deve mandar a última fatia até o fim do arquivo (hoje `renderPieces` usa a duração do arquivo).
- **Doc nulo × antes do F1** (`render-aceite.sh f2b` + `psnr.sh antes f2b`): 6 peças PSNR = inf em 100 % dos frames, framemd5 e áudio iguais. `real-take` (o único com `clipStartSec` > 0 na última cena): inf em 891/981. Os 75 frames do end card (906-980) mudam de propósito (congela o fim da fatia, 30,17 s do take, e não 7,17 s); os 14 frames 892-905 diferem 51-82 dB só pelo encoder (lookahead do x264 vê o end card novo): o `renderStill` dos frames 895 e 905 dá PNG com md5 igual antes e depois. Frame lado a lado: `video/out/f2b-stills/endcard-real-take.jpg`.
- **Amostras** (`video/scripts/editor-f2b/amostras.mjs`, headline 9:16, mídia local): `mover` (gancho/legenda/CTA movidos e girados), `estilo` (Bebas sem fundo com contorno, Anton em pílula com destaque rosa, CTA Poppins em caixa roxa, palavra corrigida e escondida), `cenas` (s3 aparada, s1, s5, s2 aparada 1-5 s, s4 apagada; 624 frames). 99-106 s / 62 s com concurrency 3. Folhas em `video/out/f2b-amostras/folha-*.jpg` + `zoom.jpg`, conferidas.
- **`data-layer` (pedido do F2c, 09/10):** `[data-layer="hook"]`, `[data-layer="caption"]` e `[data-layer="cta"]` marcam o div posicionado de cada camada (o que tem `top` em px, `translate` em %, `scale` e `rotate`); no `RemixKeep`, `[data-layer="<textLayer.id>"]` marca o bloco de texto na `box` da camada (o fundo `Fundo` fica fora). A camada só existe no DOM nos frames em que aparece. 8 `renderStill` antes × depois (Amostras headline 9:16 e bold 4:5, docs `mover` e `estilo`, RemixKeep de exemplo): md5 igual nos 8. Junto, corrigido o `align` esquerda/direita do CTA com estilo do editor: a pílula encostava na borda da faixa (largura do canvas) e saía do quadro; agora encosta na borda da caixa `boxWidth` centrada em x, com a largura máxima mantida (`video/out/dl-stills/cta-align.jpg`: antes, direita, esquerda).

## Variação automática v1: template `auto-edit` (V1, 13/10/2026)
Script: `api/src/render/auto-edit-real.ts <saida> [tipos] [formatos]` (RemotionRenderService de verdade, bundle compilado na hora, mídia servida por HTTP local, captura da página de fixture com o Chromium do Remotion). Campeão = `video/public/fixtures/real-take.mp4` (31 s, 960x960, 24 fps, fala real, palavras do mlx-whisper em `reais.json`); rosto medido (YuNet), paleta e pausas medidas. Medido com `video/scripts/medir-processo.sh`, 1 aba do Chrome, Mac Apple Silicon 16 GB **com a máquina carregada** (load 4-14, outros agentes rodando): na VPS espere mais lento.

| tipo (duração da peça) | 9:16 | 4:5 | 1:1 |
|---|---|---|---|
| CUT-15S (12,4 s) | 57 s | 33 s | 31 s |
| COLD-OPEN (32,4 s) | 102 s | 89 s | 76 s |
| HOOK-TEXT (31 s) | 92 s | 80 s | 94 s |
| ENDCARD (33 s) | 115 s | 89 s | 84 s |
| LAYOUT-SPLIT-LP (31 s) | 85 s | 77 s | 73 s |
| LAYOUT-STORY (31 s) | 90 s | 80 s | 76 s |
| LAYOUT-REVIEW (31 s) | 84 s | 90 s | 74 s |
| NATIVE-SEARCH (31 s) | 92 s | 82 s | 76 s |
| STATIC (PNG) | 1,2 s | 0,8 s | 0,7 s |
| HOOK-TEXT com capa, `contain_blur` (painéis 720x960, 15 s) | 81 s (149 s antes do desfoque barato) | — | — |

- **Lote inteiro (9 peças × 3 formatos + 1) = 2017 s (34 min), pico 2,05 GB** de RSS somado (Chrome 1,19 GB, compositor 0,38 GB, node do script com ts-node 0,42 GB). Um lote de 11 peças = 33 renders ≈ 40 min nesta máquina com a fila de 1 (D5: os 9:16 saem primeiro, ~15 min).
- Regra de ~3 s de render por segundo de peça no 9:16 e ~2,5 s no 4:5/1:1. O 1º render paga o bundle (~15 s) se `REMOTION_BUNDLE_DIR` estiver vazio.
- `nb_frames` conferido em todos (= soma do timeline, +60 no ENDCARD); áudio AAC presente, dura o mesmo que o vídeo (o end card é mudo).
- **Desfoque:** `filter: blur(40px)` no quadro inteiro custava ~2x no `contain_blur`. Agora o fundo é pintado a 1/8 do tamanho com blur de 5 px e ampliado 8x (mesmo visual). Vale pro fundo do end card.
- **Emendas:** os tempos de palavra do Whisper erram 0,1-0,2 s no fim da palavra (take de teste: "everything," acaba em 16,20 s no áudio e em 16,36 s na transcrição). Encaixar só na pausa entre palavras (`snapSpans`) deixava corte em -21 dB (fala). O RenderService agora move cada borda interna pro vale de energia mais fundo do áudio a ±0,3 s (`api/src/render/emendas.ts`, janela de 60 ms) antes de renderizar. Medido a ±20 ms de cada emenda no campeão: CUT -43 a -45 dB, COLD-OPEN -33/-34 dB (antes: -21/-19). Volume com rampa de 40 ms em cada borda.
- **Pendente pro deploy:** `video/dist/bundle` NÃO foi recompilado (a API da 3001 lê dele e o Gusta estava testando); sem `npm run build:bundle -w video` o render `auto-edit` falha em `selectComposition`. `dist/lib` já está recompilado.
- Captura da página (`capturarPagina`): 1,6 s pro HTML de fixture, PNG 1080x3458 (3 telas de celular). Sem `allowPrivateHosts`, localhost dá `PAGE_FORBIDDEN` (SSRF).
- Folhas de frames: `video/out/auto-edit-v1/folha-{VERTICAL_9_16,PORTRAIT_4_5,SQUARE_1_1}.jpg`.
