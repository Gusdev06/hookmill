# Render no Remotion Lambda (AWS) — plano + contrato v1
Data: 2026-10-25 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 25/10** ("OK", L-D1–L-D11 com a recomendação; L0 feita). Antes: **PROPOSTA** (nada de código, conta AWS ou gasto até o ok do Gusta).
Origem: decisão do Gusta de 25/10: o render sai da VPS e vai direto pro Remotion Lambda, sem passar por VPS maior nem worker próprio.
Vale **por cima** de `eventos.md` §4 (o webhook "reservado para o futuro" muda de formato, ver §6) e de `estrutura.md` §2.2 só no que este arquivo muda. O render local continua existindo (dev, testes, rollback).

Evidência lida pra escrever: `api/src/render/{remotion-render.service,contrato,fila,progresso,render.module,emendas,troca-motor}.ts`, `api/src/edicao/edicao.service.ts` (fila `kick/drain/process/processAuto`), `api/src/recuperacao/recuperacao.service.ts`, `api/src/medicao/captura-pagina.ts`, `api/src/common/util/mutex.ts`, `video/src/{Root,AutoEdit,RemixKeep,fontes}.tsx|ts`, `video/src/molduras/base.tsx`, `video/src/componentes/{Cenas,EndCard,midia}.ts(x)`, `video/src/lib/formatos.ts`, `video/scripts/bundle.mjs`, `docs/render.md`, `docs/deploy.md`, `api/prisma/schema.prisma` (`Render`, `CostEntry`).

Fontes oficiais (lidas em 25/10/2026; Remotion do projeto = **4.0.533**):
- [L1] https://www.remotion.dev/docs/lambda/setup · [L2] https://www.remotion.dev/docs/lambda/permissions · [L3] https://www.remotion.dev/docs/lambda/rendermediaonlambda
- [L4] https://www.remotion.dev/docs/lambda/webhooks · [L5] https://www.remotion.dev/docs/lambda/getrenderprogress · [L6] https://www.remotion.dev/docs/lambda/deployfunction
- [L7] https://www.remotion.dev/docs/lambda/deploysite (deprecated → `bundle()` + `deploySiteFromBundle()`) · [L8] https://www.remotion.dev/docs/lambda/concurrency · [L9] https://www.remotion.dev/docs/lambda/limits
- [L10] https://www.remotion.dev/docs/lambda/runtime · [L11] https://www.remotion.dev/docs/lambda/region-selection · [L12] https://www.remotion.dev/docs/lambda/custom-destination
- [L13] https://www.remotion.dev/docs/lambda/how-lambda-works (seção "Will each chunk download all assets?") · [L14] https://www.remotion.dev/docs/lambda/cost-example · [L15] https://www.remotion.dev/docs/lambda/checklist
- [L16] https://www.remotion.dev/docs/lambda/without-iam · [L17] https://www.remotion.dev/docs/lambda/faster-progress-polling
- [P1] https://www.remotion.pro/license · [P2] https://www.remotion.dev/docs/license/faq
- [A1] https://aws.amazon.com/lambda/pricing/ · [A2] https://aws.amazon.com/s3/pricing/ · [A3] https://aws.amazon.com/ec2/pricing/on-demand/ (transferência de dados) · [S1] https://supabase.com/pricing

---

## 0. Resumo em 5 linhas
1. **Só o `renderMedia` vai pro Lambda.** O que é ffmpeg (emendas no silêncio antes; composição sobre o campeão, áudio montado, contagem de frames e pôster depois) e a captura de página com Chrome continuam na API. A API deixa de rodar Chrome pra render, mas ainda roda ffmpeg.
2. **Fluxo:** bundle versionado por commit no S3 (`hookmill-<sha>`), função `remotion-render-4-0-533-…` em **us-east-1**. A API submete sem esperar (`renderMediaOnLambda`), acompanha por polling a cada 3 s (o webhook do Remotion **só avisa o fim**, assinado com HMAC-SHA512), baixa a saída, pós-processa e sobe pro Supabase como hoje.
3. **Custo estimado (a sonda L1 mede):** ~US$ 0,01-0,02 de Lambda por vídeo 9:16 de 30 s, mais ~US$ 0,005 de transferência e US$ 0,01 de licença quando ela entrar. **Total ~US$ 0,02-0,04 por vídeo.** O risco de custo é o egress do Supabase: cada pedaço baixa a mídia inteira, por isso `framesPerLambda` fica alto (150).
4. **Cota:** conta nova pode ter só **10** execuções simultâneas. Peça **1000** de "Concurrent executions" em us-east-1 **no dia da L0**, uns 7 dias antes da L4.
5. **Licença:** hoje cabe no Free (empresa de até 3 pessoas, uso comercial liberado). Na 4ª pessoa, contando freelancer, entra o **Automators: US$ 0,01 por render, mínimo de US$ 100/mês**. A API fica com um `RenderPort` de 3 adaptadores (`fake`, `local`, `lambda`) escolhidos por env e por tipo de peça, então a migração e o rollback são só trocar variável.

---

## 1. Inventário: o que o render faz hoje e para onde vai
Legenda: **λ** = roda no Lambda · **API** = fica na API · **ADAPTA** = muda pra funcionar.

| # | o que é | onde está hoje | destino | por quê / como |
|---|---|---|---|---|
| 1 | `bundle()` na 1ª chamada (dev) ou `REMOTION_BUNDLE_DIR` (prod) | `obterServeUrl` | **ADAPTA** | Vira site no S3 pelo `deploySiteFromBundle()` [L7], com o mesmo `video/dist/bundle` do `npm run build:bundle -w video`. A API recebe só `REMOTION_SERVE_URL`. Isso acontece no deploy, não no render. |
| 2 | `ensureBrowser` + `REMOTION_BROWSER_EXECUTABLE` (Chrome headless shell baixado no build) | render | **λ** pro render, **API** pra captura | O Lambda traz o próprio Chrome com codecs proprietários [L10]. A API **continua precisando** do Chrome: `medicao/captura-pagina.ts` (print da LP pro SPLIT-LP) e `common/util/navegador.ts` (briefing) usam puppeteer-core com esse binário. O Dockerfile não muda nessa parte. |
| 3 | `selectComposition` (roda o `calculateMetadata`) | render | **λ** | Quem resolve as props no Lambda é a função principal [L13]. A API não precisa mais do `totalFrames` antes: ele chega no progresso. Os builders (`auto-edit.ts`, `frame.ts`, remix) já sabem o nº de frames, e é ele que define o `framesPerLambda`. |
| 4 | `renderMedia` (h264, jpeg q90 ou png, yuv420p, crf, colorSpace, muted, aac, 1 aba) | render | **λ** | `renderMediaOnLambda` aceita as mesmas opções de codificação: `codec`, `imageFormat`, `jpegQuality`, `pixelFormat`, `crf`, `colorSpace`, `muted`, `audioCodec`, `x264Preset` [L3]. `concurrency` (abas) vira `concurrencyPerLambda`, que fica em 1. Fixe `x264Preset: 'medium'`, que é o padrão da v4 e o mesmo de hoje; a v5 muda o padrão pra `veryfast` [L3]. |
| 5 | `offthreadVideoCacheSizeInBytes: 256 MB` | `RENDER_PADRAO` | **λ** | Mesma opção no Lambda [L3]. Continua fixa pra não depender da memória da função. |
| 6 | `<OffthreadVideo>` e `<Img>` com URL assinada do Supabase (cenas, campeão, clipes, captura da LP, foto do produto) | `Cenas`, `EndCard`, `AutoEdit`, `RemixKeep`, `molduras/base.tsx` | **λ, com cuidado de custo** | O Lambda baixa pela internet, porque a URL do Supabase é pública e assinada. **Cada pedaço baixa todos os arquivos que aparecem no trecho dele** [L13]: a mesma mídia sai do Supabase N vezes e o egress é pago. Ver §2.4 e §4. |
| 7 | `resolverSrc` → `staticFile` pra caminho relativo (fixtures locais) | `componentes/midia.ts` | **λ (só prod)** | No Lambda, `staticFile` aponta pro site no S3. A mídia de teste não vai pro bundle (`bundle.mjs` apaga `public/fixtures`). URL `http://localhost` (versitygw, mock-media da API) **não chega no Lambda**: dev usa o adaptador `local`, e teste com Lambda usa mídia no Supabase/S3 (§9, L4). |
| 8 | Fontes `.woff2` por `staticFile` + `loadFont` (10 arquivos, latin) | `video/src/fontes.ts` | **λ sem mudança** | Vão no `public/` do bundle e são servidas pelo site do S3. A função ainda traz Noto, emoji e CJK de reserva (CJK só no arm64, que é o padrão `runtimePreference: 'cjk'`) [L10][L6]. |
| 9 | `metricas-fontes.ts` (tabela de largura medida no Chrome do render) + `fitText` (Moldura) + `measureText` (RemixKeep, no navegador) | video | **λ, conferir** | A tabela é estática e dá o mesmo resultado em qualquer lugar. O que pode mudar é o desenho final se o Chrome do Lambda for de versão diferente do headless shell local. Com o mesmo Remotion (4.0.533) a expectativa é a mesma versão. **A L3 prova**: PSNR local × Lambda nos 18 templates. |
| 10 | `emendasNoSilencio` (ffmpeg lê o áudio do campeão e move as emendas pro vale de energia) | `renderAutoEdit`, antes do render | **API** | É leve (só áudio) e muda as props. Roda antes do `submit`. |
| 11 | remix-keep: render mudo (png/crf 10) → `comporSobreOCampeao` (ffmpeg: máscara alfa por frame, campeão decodificado como base, crf 12, tags de cor por `ffprobe`) → `montarAudioSplice` (voz do motor, AAC 192k) → `contarFrames` | render | **λ** pro render mudo, **API** pro resto | O Lambda não tem gancho de pós-processo. A composição sobre o campeão existe porque o navegador sozinho não passava de 35,8 dB (render.md). A API baixa o intermediário e roda o mesmo ffmpeg de hoje. É CPU na VPS (libx264 medium crf 12 na resolução do campeão), mas sem Chrome: algo como 0,3 GB e não 2 GB. Tirar isso da VPS = L-D6. |
| 12 | `contarFrames` (ffprobe `-count_packets`) no auto-edit e no remix | render | **API** | Roda no arquivo baixado, antes de subir. Diferente do esperado = `RENDER_ERROR`, como hoje. |
| 13 | pôster: `renderStill` no frame de 1,5 s | render | **API (ffmpeg)** | Proposta: `ffmpeg -ss 1.5 -frames:v 1` no MP4 baixado. Assim não invoca outro Lambda nem conta um 2º render na licença [P2] ("1 render = geração bem-sucedida de vídeo… ou still"). L-D5. |
| 14 | `FilaLimitada` (`RENDER_CONCURRENCY=1`) + `drain()` que espera cada render terminar | render + edicao | **ADAPTA** | Vira despachante: pega `QUEUED` no banco, submete e **não espera**. O teto é `RENDER_LAMBDA_MAX_INFLIGHT` (§5.3). A fila local continua no adaptador `local`. |
| 15 | progresso `onProgress` → `limitarProgresso` (2/s) → `render.updated` | render + edicao | **ADAPTA** | Vem do polling `getRenderProgress` (§5.4). O web não muda: o formato do `Render` é o mesmo. |
| 16 | `RENDER_TMP_DIR/<renderId>/` (o backend sobe e apaga) | render + edicao | **API** | O adaptador lambda baixa a saída pra essa mesma pasta no `finalize`. O backend continua recebendo um `RenderResult` com caminhos locais, sem mudança no `storage.put`. |
| 17 | `ldd` do Chrome/compositor/onnxruntime e `ffmpeg -version` no build | Dockerfile | **API** | Continua: ffmpeg (item 11-13), Chrome (item 2) e onnxruntime (medição) seguem na imagem. Só sai a dependência do Chrome **pro render**. |
| 18 | `checagem-texto.ts` ("textCheck") | edicao | **API, fora do render** | É visão do Haiku em cima da imagem do GPT Image 2 (STATIC, engine `IMAGE_GEN`). Não passa pelo Remotion. |
| 19 | `RENDER_FRAMES_CONCURRENCY` (1 em prod, 8 local) | config | **só local** | No Lambda o paralelismo vem do nº de pedaços. |
| 20 | gatilhos de mock (`mockRenderFail`, `INTEGRACOES_MODE=mock`) | edicao | **API** | Continuam antes do `submit`: valem com qualquer adaptador. |

---

## 2. Arquitetura alvo

### 2.1 Site e função (deploy, não render)
- **Site:** `npm run build:bundle -w video` → `deploySiteFromBundle()` com `siteName = hookmill-<git sha curto>` no bucket `remotionlambda-useast1-*` que o Remotion cria [L7]. **Um site por commit**: render em andamento continua no site antigo. O `Render` grava o `serveUrl` usado (`renders.serve_url`), então dá pra reproduzir o render. Limpeza: ficam os últimos 10 sites.
- **Função:** `deployFunction()` [L6], idempotente (mesma versão, memória e timeout = devolve a que já existe):
  - `memorySizeInMb`: **3008** (✅ confirmado na L1, 25/10: 2048 custou o mesmo, US$ 0,011, e foi 30 % mais lento, 79-88 s × 61-67 s; ver §5.0). Hoje o Chrome usa 1,2 GB + compositor 0,3-0,6 GB + cache 256 MB, e 2048 fica apertado com fonte 1080. Até 3008 MB a função tem 2 vCPU [L10]. Baixar 25 % de memória baixa 25 % do custo [L15].
  - `diskSizeInMb`: **4096**. A saída pode ter no máximo metade do disco [L15], e o disco guarda os pedaços e a mídia baixada. O campeão mais longo hoje é de 85 s ≈ 58 MB (deploy.md).
  - `timeoutInSeconds`: **300**. A função principal espera o render inteiro. O máximo é 900 [L9], e a doc recomenda ≤ 120 pra pedaço [L6]. ✅ L1: `timeToFinish` de 45-80 s com 150 frames por pedaço; 300 sobra.
  - `region: 'us-east-1'` (§3), `createCloudWatchLogGroup: true`, **`cloudWatchLogRetentionPeriodInDays: 7`** (L1; o padrão é 14).
  - **Deployado na L1 (25/10):** função `remotion-render-4-0-533-mem3008mb-disk4096mb-300sec` (a de 2048 da comparação foi apagada em 25/10), bucket `remotionlambda-useast1-9dano8maol`, site `hookmill-l1-f557563` (bundle da árvore de trabalho sobre o commit `f557563`, com mudanças do time em `video/src` ainda sem commit: **não** é o site de produção; o da L2 sai do `npm run lambda:deploy`). Ciclo de vida do bucket: as 4 regras `renders/<n>-day(s)` do Remotion + `hookmill-renders-7-dias` (`renders/`, 7 dias); `sites/` não expira. ⚠️ `getOrCreateBucket({ enableFolderExpiry: true })` **substitui** a configuração inteira e apaga a regra de 7 dias: não use, ou recoloque a regra (script da L1, `deploy`).
- **Regra de versão:** `@remotion/lambda` **exatamente** 4.0.533, igual ao `remotion`. Atualizar o Remotion = deploy de função nova (a antiga e a nova convivem) [L1].
- **Quem roda:** script da raiz `npm run lambda:deploy` (arquiteto, L2). Lê `REMOTION_AWS_*` do `.env` **do Gusta**, imprime `REMOTION_SERVE_URL` e `REMOTION_LAMBDA_FUNCTION`, e esses dois valores vão pro EasyPanel. CI fica pra depois.

### 2.2 Submissão
```ts
renderMediaOnLambda({
  region, functionName, serveUrl, composition: compositionId, inputProps: props,
  codec: 'h264', imageFormat, jpegQuality, pixelFormat: 'yuv420p', crf?, colorSpace?, muted?, audioCodec?,
  x264Preset: 'medium', offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, concurrencyPerLambda: 1,
  framesPerLambda: RENDER_LAMBDA_FRAMES_PER_LAMBDA,   // 150 (§2.4); a doc pede ≥ 5 e ≤ 200 funções [L8]
  maxRetries: 1,                                      // pedaço com erro da lista "flaky" [L3]
  timeoutInMilliseconds: 60_000,                      // delayRender (fontes + mídia remota); padrão 30 s
  privacy: 'private', downloadBehavior: { type: 'play-in-browser' },
  outName: `${renderId}-a${attempt}.mp4`,             // determinístico por tentativa
  webhook: webhookUrl ? { url: webhookUrl, secret: RENDER_WEBHOOK_SECRET, customData: { r: renderId, a: attempt } } : undefined,
  licenseKey: REMOTION_LICENSE_KEY || undefined,       // quando houver licença (§7)
  logLevel: 'error',
})  // → { renderId: externalId, bucketName, cloudWatchLogs, ... }
```
- `inputProps` acima de ~200 KB: o SDK JS sobe pro S3 sozinho [L3, e a mesma lógica descrita na doc do SDK Python]. Hoje o maior input é o remix-keep com karaokê e fica bem abaixo disso, mas não precisa limitar.
- Estado guardado no `Render` antes de devolver: `impl='lambda'`, `externalId`, `externalBucket`, `serveUrl`, `attempt`, `submittedAt` (§8).

### 2.3 Progresso e fim: polling principal, webhook pro fim
- **O webhook do Remotion só avisa o fim** (`success` / `error` / `timeout`); não há webhook de progresso [L4]. O progresso vem de `getRenderProgress` [L5].
- **Poller** (backend, `@Interval` a cada `RENDER_LAMBDA_POLL_MS=3000`): pega `renders` com `status=RENDERING`, `impl='lambda'`, `externalId` preenchido e sem `finalizingAt`. Faz até 20 chamadas em paralelo. Cada chamada invoca um Lambda curto, custo desprezível. A doc tem `skipLambdaInvocation: true`, que lê direto do S3 e é mais rápido, mas exige permissões a mais [L5][L17]: liga se a L4 mostrar gargalo.
- **Webhook** `POST /api/v1/webhooks/render` (substitui o reservado em `eventos.md` §4):
  - Cabeçalhos do Remotion: `X-Remotion-Signature: sha512=<hex>` (HMAC-SHA512 do corpo cru com o segredo), `X-Remotion-Status`, `X-Remotion-Mode` [L4]. A validação usa `validateWebhookSignature()` do `@remotion/lambda/client` no corpo **cru**, como no webhook da WaveSpeed. Assinatura inválida = `401` e nada gravado.
  - Corpo: `renderId` (= nosso `externalId`), `bucketName`, `customData { r, a }`, `type`. No sucesso vêm também `outputUrl`, `outputFile`, `timeToFinish`, `costs`, `lambdaErrors`; no erro, `errors[]` [L4].
  - Responde `200` na hora e põe o render na mesma rotina do poller (`settle(renderId)`). Webhook perdido ou API reiniciando: o poller pega no próximo ciclo.
  - Dev sem túnel: `RENDER_LAMBDA_WEBHOOK=off`, só polling (o mesmo padrão do `WAVESPEED_WEBHOOKS=off`).

### 2.4 Mídia do Supabase chegando no Lambda
- A URL assinada do Supabase (S3 SigV4) é gerada **no `submit`**, nunca na hora de entrar na fila. TTL ≥ 2 h (`SIGNED_URL_TTL_SEC=21600` atende). Cada tentativa gera de novo.
- **Egress multiplicado:** cada pedaço baixa os arquivos do seu trecho [L13]. Num vídeo de 30 s com 900 frames, o padrão do Remotion (`framesPerLambda` = max(900/~79, 20) = 20, ou seja **45 pedaços** [L8]) poderia baixar um campeão de 27 MB **45 vezes** (≈ 1,2 GB por render). Por isso:
  1. `framesPerLambda = 150` → 6 pedaços em 30 s, 18 em 85 s. É mais lento que 45 pedaços, mas usa 6x menos cota e egress. ✅ L1 (§5.0): egress de 41,5 MB × ~190 MB (fpl 20) no vídeo de 32 s; **fica 150** com a cota de 10. Com a cota de 1000, avaliar 75 na L4 (~40 s em vez de ~65 s, +20 % de Lambda e +50 % de egress).
  2. O teto de duração do campeão (`CHAMPION_MAX_SEC`) continua valendo.
  3. Se a L4 mostrar egress alto: L-D4 (copiar a mídia uma vez pro bucket do Remotion na mesma região antes do render, ou pôr CDN na frente).
- A doc do Remotion avisa que muitos pedaços baixando ao mesmo tempo podem estourar limite do servidor de origem [L13]. O Supabase Storage tem limite próprio, e a L4 vê se aparecem 429/503 nos downloads.
- `<Img>` e `<OffthreadVideo>` não precisam de CORS: o vídeo é extraído pelo compositor e a imagem não vai pra canvas. `chromiumOptions.disableWebSecurity` fica desligado.

### 2.5 Saída: S3 → API → Supabase (v1)
- A saída fica no bucket do Remotion (`renders/<externalId>/<outName>`, privada). No `finalize` o adaptador baixa pro `RENDER_TMP_DIR/<renderId>/video.mp4` (GET autenticado com a chave do render) e faz o pós-processo (remix, nb_frames, pôster). O backend sobe pro Supabase com o `storage.put` de hoje e apaga a pasta. O arquivo passa pela VPS uma vez (27 MB entrando e 27 MB saindo num vídeo de 30 s).
- Limpeza no S3: o `finalize` apaga o objeto depois da cópia. Por segurança, regra de ciclo de vida de 1 dia no prefixo `renders/` (o `deleteAfter` do Remotion [L3], que a sonda confirma), pra cobrir render que ninguém finalizou.
- Alternativa (L-D3): `outName` com `s3OutputProvider` escrevendo **direto no bucket do Supabase** [L12]. Tira a cópia, mas exige `privacy: 'no-acl'`, a chave S3 do Supabase **dentro do Lambda** e compatibilidade S3 que não provamos. Também não serve pro remix-keep, que precisa de pós-processo. Fica como otimização se a L1 provar que funciona.

### 2.6 Fontes e assets
Nada muda no `video/`: fontes e miniaturas vão no `public/` do bundle e o site do S3 serve. Regra nova (video): **nenhum asset de render fora do `public/` nem em `localhost`**. A L3 roda um teste que falha se uma prop de produção tiver `http://localhost` ou `127.0.0.1`.

### 2.7 Idempotência, retentativa e recuperação
| caso | regra |
|---|---|
| webhook e poller ao mesmo tempo, ou webhook repetido | `settle` pega o render com `updateMany where { id, status:'RENDERING', externalId, finalizingAt: null } set finalizingAt=now`. Só quem atualizar 1 linha finaliza; o outro sai. |
| webhook de tentativa antiga (`customData.a` ≠ `attempt`, ou `externalId` diferente) | `200` sem efeito. |
| erro "flaky" num pedaço | o próprio Remotion tenta de novo (`maxRetries: 1`) [L3]. |
| `timeout` do Remotion, ou sem progresso por mais de `timeoutInSeconds + 60 s` | 1 tentativa nova (`attempt+1`, URLs assinadas de novo). Na 2ª falha: `FAILED`, `errorCode=RENDER_TIMEOUT`. |
| erro determinístico (props, `delayRender` vencido, exceção na composição) | `FAILED`, `RENDER_ERROR`, `failedFrame` quando o erro trouxer o frame. Sem tentativa nova. |
| `TooManyRequestsException` / `Rate exceeded` ao invocar (cota de concorrência) | **não é falha**: volta pra `QUEUED` com `attempt` igual e espera ≥ 15 s (`notBefore`). O despachante baixa o teto em tempo de execução. |
| falha no `finalize` (download, ffmpeg, upload) | a chave final no storage é determinística por render, então refazer não duplica arquivo. Até 3 tentativas (`finalizingAt` com mais de 10 min = solto de novo), depois `FAILED`. |
| API reinicia (boot, `recuperacao.service`) | `impl='lambda'` com `externalId` → **não** volta pra fila, o poller retoma. `impl='lambda'` sem `externalId` e `submittedAt` > 2 min (caiu entre invocar e gravar) → `QUEUED`. Pode render 2x uma vez só (~US$ 0,02, aceito). `impl='local'` → regra de hoje (`RENDERING` → `QUEUED`). |
| `RENDER_IMPL` mudou com render no ar | o poller trata **toda** linha `impl='lambda'`, seja qual for o `RENDER_IMPL` atual (é o que segura o rollback, §9 L5). |

### 2.8 Estados atuais × Lambda (o web não muda)
| momento | `Render.status` | `stage` | `progress` | SSE |
|---|---|---|---|---|
| despachante pegou, montando input / emendas / assinando URLs | `RENDERING` | `bundling` (= "preparando"; mantém o valor de hoje) | 0 | `render.updated` |
| `submit` ok, sem progresso ainda | `RENDERING` | `bundling` | 0 | — |
| `getRenderProgress`: `framesRendered < totalFrames` | `RENDERING` | `rendering` | `floor(overallProgress*100)`, teto 99 | `render.updated` (máx. 2/s, `limitarProgresso`) |
| todos os frames feitos, ainda codificando | `RENDERING` | `encoding` | idem | `render.updated` |
| `done` / webhook `success` → `finalize` (baixa, remix, nb_frames, pôster, upload) | `RENDERING` | `uploading` | 99 | `render.updated` |
| arquivo no storage | `READY` | null | 100 | `render.updated` + transição do criativo (igual hoje) |
| erro / timeout depois das tentativas | `FAILED` | null | — | `render.updated`; `errorCode` `RENDER_ERROR` ou **`RENDER_TIMEOUT` (novo)**, `failReason` humano por i18n |
`frame`/`totalFrames` vêm de `framesRendered` e do nº de frames da composição. Os eventos internos `render.progress` / `render.finished` (`eventos.md` §5) são emitidos pelo despachante, seja qual for o adaptador.

---

## 3. Região: **us-east-1 (N. Virgínia)**
- O render é lote, não interativo. O usuário (BR ou EUA) baixa o vídeo do **Supabase**, não do Lambda, então a região do render não muda a latência dele. A API na VPS só manda controle (KB). O Gusta em Bali só usa o console. A região tem que ficar perto **da mídia** (Supabase) e ser barata.
- us-east-1 é a região padrão e a mais testada do Remotion [L11], tem os exemplos de custo [L14], e o Lambda arm64 custa ~US$ 0,0000133334/GB-s, igual à maioria das regiões [L11][A1]. São Paulo (`sa-east-1`) é suportada [L11] e o Lambda custa o mesmo, mas a transferência de saída da AWS lá costuma ser bem mais cara [A3, a confirmar].
- **Resolvido 25/10:** o Supabase está em `us-east-1` (host do pooler). Texto original: a região do projeto Supabase compartilhado (`grbwshqevyahuukfdpfx`) não está registrada em nenhum doc. Se for `us-east-1`, a escolha é óbvia. Se for `sa-east-1`, a recomendação **continua us-east-1**: o egress do Supabase custa o mesmo pra qualquer destino, e o resto é mais barato. A L1 mede o tempo de download da mídia e reabre a decisão se ele dominar o render (L-D2).
- Função e bucket do site **na mesma região** (exigência) [L11].

## 4. Cotas da AWS
- O padrão é 1000 execuções simultâneas por região, mas **conta nova pode começar com só 10** [L1][L9]. Cada render usa 1 função principal + 1 por pedaço: com `framesPerLambda=150`, um vídeo de 30 s usa ~7; com o padrão do Remotion usaria ~46.
- **Pedir:** Service Quotas → AWS Lambda → **Concurrent executions** → **1000** em **us-east-1**. Pelo console (o `npx remotion lambda quotas increase` só funciona com a conta root [L9]). A doc do Remotion tem um modelo de justificativa [L9].
- **Quando:** **no dia da L0**, antes da sonda. Com 10, a L1 já funciona (1 render de 7 funções) e a L2 com 1 render por vez. A L4 (50-100 lotes) **exige** a cota. A AWS costuma responder em dias e às vezes pede mais justificativa: conte **≥ 7 dias** antes da L4.
- Com 1000: ~140 renders de 30 s ao mesmo tempo (7 funções cada). O teto do despachante (`RENDER_LAMBDA_MAX_INFLIGHT`) fica em **80 %** da cota dividido pelas funções por render. Não suba a cota além do que a L4 provou: ela não é teto de gasto (§10, rate limit + alarme de orçamento).

## 5. Custo

### 5.0 Medido na sonda L1 (25/10/2026, `scripts/sonda-lambda-l1.mjs`)
Scratch `headline` 9:16 de 32 s (960 frames, 5 cenas, fixtures de `amostra.json`) e Moldura `news` (Notícia) 9:16 de 30 s (900 frames, `real-take.mp4`). Mídia no Supabase de produção (`hookmill/sonda-lambda-l1/`, URL assinada de 6 h, apagada no fim). jpeg, h264 crf padrão, `x264Preset: 'medium'`, cache 256 MB, `concurrencyPerLambda: 1`, `maxRetries: 1`. Com a cota de 10, os testes de 75 e 20 frames por pedaço usaram `frameRange` (600 e 160 frames) pra caber em 8 pedaços.
| render | memória | fpl | frames | pedaços (funções) | parede | `timeToFinish` | `accruedSoFar` | mídia baixada do Supabase | PSNR RGB vs local Mac (mín / média) |
|---|---|---|---|---|---|---|---|---|---|
| headline frio | 3008 | 150 | 960 | 7 (8) | 67,4 s | 60,7 s | US$ 0,0112 | 41,5 MB (2,4x os 17 MB da mídia) | 32,1 / 38,8 |
| headline quente | 3008 | 150 | 960 | 7 (8) | 61,0 s | 57,0 s | US$ 0,0111 | 41,5 MB | 32,1 / 38,8 |
| headline frio | 2048 | 150 | 960 | 7 (8) | 87,9 s | 80,4 s | US$ 0,0116 | 41,5 MB | 32,1 / 38,8 |
| headline quente | 2048 | 150 | 960 | 7 (8) | 79,0 s | 74,0 s | US$ 0,0111 | 41,5 MB | 32,1 / 38,8 |
| headline | 3008 | 75 | 600 | 8 (9) | 40,6 s | 35,2 s | US$ 0,0083 | 41,1 MB | 32,1 / 38,5 |
| headline | 3008 | 20 | 160 | 8 (9) | 11,3 s | 9,2 s | US$ 0,0025 | 27,8 MB | 32,1 / 36,5 |
| headline, saída por `s3OutputProvider` no Supabase | 3008 | 150 | 300 | 2 (3) | 60,3 s | 57,1 s | US$ 0,0043 | (log em `warn`) | 32,1 / 37,8 |
| **Moldura Notícia** | 3008 | 150 | 900 | 6 (7) | 49,7 s | 44,6 s | US$ 0,0097 | 45,7 MB (6x o take de 7,6 MB) | 31,2 / 31,4 |

**Total da sonda: US$ 0,070 de Lambda** (soma do `accruedSoFar`, que bate com GB-s × US$ 0,0000133334), mais S3, CloudWatch e egress da AWS abaixo de US$ 0,01. nb_frames igual ao esperado em todos, AAC presente com a duração do vídeo e nenhum erro de pedaço.
- **Mídia baixada** = linhas `Downloading` do CloudWatch × tamanho do arquivo. Bate com o modelo "cada pedaço baixa cada arquivo que aparece no seu trecho" [L13] nas 3 configurações. Extrapolado pro vídeo inteiro de 960 frames: **fpl 150 = 41,5 MB · fpl 75 ≈ 61 MB · fpl 20 ≈ 190 MB** (11x a mídia).
- **Custo por vídeo de 32 s:** fpl 150 ≈ US$ 0,011; fpl 75 ≈ US$ 0,013 (13 pedaços, exige cota ≥ 15); fpl 20 ≈ US$ 0,015 (48 pedaços). Fica no piso da estimativa da §5.1.
- **Memória:** 2048 custa o mesmo que 3008, porque fica 30 % mais lento na mesma proporção em que fica mais barato por segundo. **Fica 3008.** Frio × quente: ~6 s de diferença.
- **Tempo:** com fpl 150 o vídeo de 32 s sai em ~60-67 s (Mac M com 1 aba: 100 s; VPS estimada em 2-4 min). Fpl 75 dá ~40 s no vídeo inteiro. A costura no fim leva ~10-15 s fixos (81 → 100 %).
- **PSNR local (Mac) × Lambda < 40 dB, mas não é defeito do Lambda.** A diferença fica **só na borda dos glifos**: o Mac rasteriza fonte com CoreText e o Lambda com FreeType (Linux). Mesma fonte, mesma quebra de linha, mesma posição (folhas em `video/out/sonda-lambda-l1/cmp/`). Fora da borda dos glifos (máscara de 6 px onde a diferença passa de 24 níveis; 1,2 % da tela no headline, 10,6 % na Notícia), com 1 frame por segundo: **mín 42,7 dB no headline e 46,5 dB na Notícia**. **Lambda × Lambda:** 2048 × 3008 e frio × quente saem **idênticos** (PSNR infinito nos 960 frames); fpl 75 e 20 × 150 ficam ≥ 42 dB (só a codificação muda na fronteira dos pedaços). O render da VPS também é Linux, então **o critério da L3 muda**: a referência passa a ser um render Linux (VPS ou o próprio Lambda), ou PSNR fora da borda dos glifos ≥ 40 dB + folha de frames conferida.
- **Áudio:** na Notícia é igual ao local (SNR 74,9 dB). No headline é o mesmo áudio deslocado 0,3-0,7 ms por cena em relação ao local (correlação 0,9999 com o deslocamento, RMS por segundo igual). Inaudível, mas md5 do áudio não serve de critério no scratch.
- **`s3OutputProvider` direto no Supabase funcionou** (`privacy: 'no-acl'`, `forcePathStyle: true`; o `getRenderProgress` precisa do mesmo `s3OutputProvider`). A chave do Supabase vai no payload do Lambda, por isso esse render rodou com `logLevel: 'warn'`. **L-D3 continua S3 → API → Supabase na v1** (o remix precisa de pós-processo); o caminho direto fica provado como otimização.
- ⚠️ Com `logLevel: 'verbose'` a URL assinada inteira vai pro CloudWatch. Produção usa `'error'` (§2.2) e retenção de 7 dias.

### Estimativa original (antes da L1)
### 5.1 Por vídeo 9:16 1080x1920, 30 s (900 frames), `framesPerLambda=150`, 3008 MB
| parcela | conta | US$ |
|---|---|---|
| Lambda, render dos pedaços | o render.md mede ~110 s de CPU com 1 aba num Mac M pra 32 s. No Lambda (2 vCPU mais lentos) suponho ~150-200 s × 2,94 GB ≈ 440-590 GB-s | 0,006-0,008 |
| Lambda, sobrecarga (7 funções: browser, download da mídia, ~5 s cada) + principal (~60-90 s esperando) | ~100 + ~180-260 GB-s | 0,004-0,005 |
| **Lambda total** | × US$ 0,0000133334/GB-s arm64 [A1][L11]; batendo com a doc, 1 min de vídeo local sai US$ 0,017-0,021 com 2048 MB [L14] | **~0,010-0,014** |
| polling (~30 chamadas curtas) + requisições | desprezível [A1: US$ 0,20/milhão] | < 0,001 |
| S3 (saída de 27 MB por < 1 dia + PUT/GET) | [A2] | < 0,001 |
| transferência S3 → VPS (27 MB) | ~US$ 0,09/GB pra internet em us-east-1 [A3, a confirmar] | ~0,0025 |
| egress do Supabase (mídia × 6 pedaços ≈ 6 × 27 MB ≈ 160 MB, mais a cópia da saída) | Pro inclui 250 GB/mês; acima, ~US$ 0,09/GB [S1, a confirmar] | 0 até a franquia, depois ~0,015 |
| licença Remotion (quando entrar, §7) | US$ 0,01/render [P1] | 0 hoje · 0,01 |
| **Total por vídeo** | | **~US$ 0,013 hoje · ~0,02-0,04 com licença e fora da franquia** |
- Com o padrão de 45 pedaços, o egress do Supabase sozinho seria ~1,2 GB/render (~US$ 0,11 fora da franquia). É **a parcela que mais pesa**, e a L1 mede de verdade (logs do Supabase).
- remix-keep: Lambda parecido (png e crf 10 pesam mais), mais a CPU da composição na VPS (sem custo marginal) e o download de um intermediário maior.
- Lote de 11 peças 9:16: ~US$ 0,15-0,45. 1000 vídeos/mês: ~US$ 15-40 de AWS + licença.

### 5.2 Comparação com a VPS
| | VPS de hoje (Hostinger, 4 GB / 2 CPU **compartilhada com o Lab**) | Lambda |
|---|---|---|
| custo marginal | US$ 0 (plano fixo já pago) | ~US$ 0,01-0,04/vídeo |
| vazão | 1 render por vez; 30 s ≈ 2-4 min na VPS (estimativa do render.md, nunca medido lá) → ~15-30 vídeos/h; lote de 11 ≈ 25-45 min; 10 lotes ≈ 4-7 h | ~30-90 s por vídeo (estimativa), ~140 em paralelo com cota 1000 → 100 lotes (1.100 vídeos) ≈ 10-20 min |
| risco | render pesa CPU do Lab; Chrome pode cair com pouca RAM | custo variável sem teto natural (§10), dependência da AWS |
Pra 2 pessoas a VPS sai mais barata. A vazão do Lambda é o que permite vender: um cliente pedindo 3 lotes não trava os outros.

## 6. Contrato: `RenderPort` e mudanças de banco, env e eventos
### 6.1 Porta (dono: maquina-video, `api/src/render/contrato.ts`)
A interface `RenderService.render(input, onProgress): Promise<RenderResult>` **é substituída** por uma porta assíncrona: um render de minutos não pode viver numa promessa que morre quando a API reinicia.
```ts
export type RenderImpl = 'fake' | 'local' | 'lambda';

export interface RenderSubmission {
  impl: RenderImpl;
  externalId: string;            // local/fake = renderId; lambda = renderId do Remotion
  bucket: string | null;         // lambda
  serveUrl: string | null;       // site usado (reprodução)
  attempt: number;
}

export interface RenderSnapshot {
  state: 'running' | 'done' | 'failed' | 'timeout';
  progress: RenderProgress;                              // mesmo tipo de hoje
  costUsd: number | null;                                // lambda: costs.accruedSoFar
  error: { message: string; failedFrame: number | null; retryable: boolean } | null;
}

export interface RenderPort {
  readonly impl: RenderImpl;
  templates(): ReturnType<RenderService['templates']>;   // igual hoje
  /** Monta props (+ emendas no silêncio), submete e devolve rápido. Não espera o render. */
  submit(input: RenderInput, o: { attempt: number; webhookUrl: string | null }): Promise<RenderSubmission>;
  /** Estado atual. local/fake: memória do processo; lambda: getRenderProgress. */
  snapshot(sub: RenderSubmission): Promise<RenderSnapshot>;
  /** Saída pronta → arquivos locais em RENDER_TMP_DIR/<renderId>/ (baixa, compõe o remix, confere nb_frames, tira o pôster).
   *  Devolve o MESMO RenderResult de hoje; o backend sobe e apaga como hoje. Lança RenderError. */
  finalize(input: RenderInput, sub: RenderSubmission): Promise<RenderResult>;
  /** Só lambda. Corpo cru + cabeçalhos → evento, ou null se a assinatura for inválida. */
  parseWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>): { externalId: string; renderId: string; attempt: number; status: 'success' | 'error' | 'timeout'; costUsd: number | null } | null;
  /** Só local/fake: aviso imediato (dispensa polling). O despachante assina. */
  onEvent?(fn: (renderId: string, snap: RenderSnapshot) => void): void;
}
export const RENDER_PORT = Symbol('RENDER_PORT');
```
- **`local`** = o `RemotionRenderService` de hoje por dentro (fila `FilaLimitada`, Chrome local). O `submit` põe na fila e devolve. O `finalize` devolve o resultado já pronto em disco.
- **`fake`** = o `fake-render.service` de hoje, no mesmo formato. Todos os `*.int.spec.ts` continuam com `RENDER_IMPL=fake`.
- **`lambda`** = novo, em `api/src/render/lambda/`. Usa `@remotion/lambda/client` (`renderMediaOnLambda`, `getRenderProgress`, `validateWebhookSignature`) e `@aws-sdk/client-s3` (já é dependência) pra baixar e apagar a saída.
- **Escolha por env e por tipo:** `RENDER_IMPL=local|lambda|fake` define o padrão. `RENDER_LAMBDA_KINDS=scratch,auto-edit,frame,remix-keep` diz quais `kind` vão pro Lambda quando `RENDER_IMPL=lambda`; os outros ficam no `local`. É com isso que a L3 migra composição por composição e a L5 volta atrás sem deploy. (O valor de hoje `remotion` fica como sinônimo de `local`.)
- A fábrica do `edicao.module.ts` (backend) que hoje mistura fake e real no remix passa a pedir a porta pelo `kind`.

#### 6.1.1 Implementado na L2 (maquina-video, 25/10) — o que o backend liga
Código em `api/src/render/` (`contrato.ts`, `portas.ts`, `servico-como-porta.ts`, `posprocesso.ts`, `lambda/`). Nada disso está ligado ainda: a fila de hoje (`RENDER_SERVICE` + `renderer.render()`) continua igual até o backend trocar. `@remotion/lambda` **4.0.533** exato na api (`npm run check:remotion` ok).
Diferenças em relação ao §6.1 acima (o resto é igual):
- **Token:** `RENDER_PORTS` (exportado de `api/src/render`), tipo `RenderPorts`. **Não** é um `RENDER_PORT` único (o nome já existe no `edicao.service` do backend). `ports.para(input)` = adaptador pra render **novo** (`RENDER_IMPL` + `RENDER_LAMBDA_KINDS`); `ports.porImpl(render.impl)` = adaptador de linha existente (null = local), usado por poller, webhook, finalize e recuperação; `ports.todos()` pra assinar `onEvent`. O lambda é montado sempre que `REMOTION_LAMBDA_FUNCTION` + `REMOTION_SERVE_URL` existem, seja qual for o `RENDER_IMPL` (rollback, §2.7). `RENDER_IMPL=lambda` sem eles = erro no boot. Sem `RENDER_IMPL`: `fake` com `INTEGRACOES_MODE=mock`, `local` no live (a regra do `renderImpl()` de hoje). O ajuste do remix-keep em mock (`RENDER_REMIX_IMPL`) continua com o backend.
- **`release(input, sub)`** (novo, obrigatório): chamar **depois** do `storage.put` dar certo. Apaga a saída no S3 (lambda) / esquece o render (local/fake). O `finalize` não apaga nada, então pode ser repetido (até 3x, §2.7).
- **`finalize`** devolve `RenderResult & { costUsd }` (lambda: `costs.accruedSoFar` final). Pôster por ffmpeg (L-D5), `nb_frames` conferido no auto-edit e no remix, remix composto sobre o campeão na API (L-D6), as mesmas funções do local (`posprocesso.ts`).
- **`RenderThrottledError`** (`code 'RENDER_THROTTLED'`, `retryAfterMs`, `reason 'throttled'|'transient'`): o `submit` lança no throttling da AWS e em rede/5xx → **volta pra `QUEUED`, mesmo `attempt`, `notBefore = agora + retryAfterMs`** (15 s padrão). O `snapshot`/`finalize` lançam a mesma coisa = "sem notícia neste ciclo", não é falha.
- **`RenderError` no `submit`** = `FAILED` sem retentativa: entrada inválida ou **mídia que o Lambda não alcança** (localhost, 127.x, rede privada, caminho relativo/fixture, URL assinada valendo menos que `RENDER_LAMBDA_MIN_URL_TTL_SEC`=7200). As URLs têm que ser assinadas no `process` (já é assim hoje no `edicao.service`) com `SIGNED_URL_TTL_SEC` ≥ 2 h.
- **`snapshot`** → `running | done | failed | timeout`. `error.retryable=true` em `timeout` e em pedaço morto por throttling: o backend faz `attempt+1` (uma vez; na 2ª falha `RENDER_TIMEOUT` pro timeout, `RENDER_ERROR` pro resto). `retryable=false` = `FAILED RENDER_ERROR` com `failedFrame`. Progresso já no formato do §2.8 (teto 99; `bundling` = preparando).
- **Ajudas puras** (exportadas): `decidirWebhook(evento, linha)` → `settle | ignorar` (duplicado, atrasado, outra impl); `prazoEstourado(submittedAt, agora, REMOTION_LAMBDA_TIMEOUT_SEC)` pro render sem metadados (§2.7); `lambdaConfig(get)` com `pollMs`, `maxInflight`, `maxInflightPerWorkspace`, `webhook` lidos da env.

O que o **backend** precisa chamar (a ordem):
1. **Despachante:** claim do `QUEUED` (com `notBefore` vencido) → `RENDERING`/`bundling` → monta o `RenderInput` (URLs assinadas agora) → `port = ports.para(input)` → `sub = await port.submit(input, { attempt, webhookUrl })` → grava `impl, externalId, externalBucket=sub.bucket, serveUrl, attempt, submittedAt`. `webhookUrl` = `${API_PUBLIC_URL}/api/v1/webhooks/render` ou null com `RENDER_LAMBDA_WEBHOOK=off`. `RenderThrottledError` → `QUEUED` + `notBefore`. Teto `maxInflight`/`maxInflightPerWorkspace` só pra `impl='lambda'`.
2. **local/fake:** `port.onEvent((renderId, snap) => …)` substitui o `onProgress` de hoje (mesmo `limitarProgresso`); `done` → `settle`.
3. **Poller** (`@Interval(pollMs)`): linhas `impl='lambda'`, `RENDERING`, `externalId` preenchido, `finalizingAt` null → `ports.porImpl('lambda').snapshot(sub)` → grava `stage/progress/frame/totalFrames/costUsd`; `done` → `settle`; `failed/timeout` → regra acima; `prazoEstourado` sem metadados → trata como `timeout`.
4. **Webhook** `POST /api/v1/webhooks/render` (corpo cru): `ev = ports.porImpl('lambda').parseWebhook(raw, headers)`; null → 401. Senão `decidirWebhook(ev, linha)`; `settle` → mesma rotina do poller; sempre 200.
5. **settle:** claim por `finalizingAt` (§2.7) → `stage uploading` → `res = await port.finalize(input, sub)` → `storage.put` (como hoje) → `READY` → `await port.release(input, sub)` → apaga a pasta. `CostEntry` `AWS_LAMBDA/RENDER` com `externalRef=externalId` e `res.costUsd`.
6. **Recuperação:** §2.7 sem mudança (lambda com `externalId` fica com o poller; local volta pra fila — o `snapshot` do local depois de restart devolve `failed retryable`).

### 6.2 Banco (arquiteto, migração aditiva, `npm run db:migrate` com backup)
```prisma
model Render {
  // … campos de hoje …
  impl          String?   // 'local' | 'lambda' | 'fake'; null = renders antigos (local)
  externalId    String?   @map("external_id")      // renderId do Remotion Lambda
  externalBucket String?  @map("external_bucket")
  serveUrl      String?   @map("serve_url")        // site hookmill-<sha>
  attempt       Int       @default(0)
  submittedAt   DateTime? @map("submitted_at")
  notBefore     DateTime? @map("not_before")       // espera depois de throttling
  finalizingAt  DateTime? @map("finalizing_at")    // trava do settle (webhook × poller)
  costUsd       Decimal?  @map("cost_usd") @db.Decimal(12, 4)
  @@index([impl, status])
}
enum Provider { … AWS_LAMBDA }
enum CostKind { … RENDER }
model CostEntry { … externalRef String? @unique @map("external_ref") }   // = externalId: custo gravado 1x por tentativa
```
`ErrorCode` ganha `RENDER_TIMEOUT` (texto humano no i18n do web: "The render took too long. Render again.").

### 6.3 Env (`api/.env.example`, arquiteto)
```bash
# Render: fake (testes) | local (Chrome na API, padrão dev) | lambda (prod)
RENDER_IMPL=local
RENDER_LAMBDA_KINDS=scratch,auto-edit,frame,remix-keep   # só com RENDER_IMPL=lambda
# Remotion Lambda (render-lambda-v1). Chave do usuário IAM de RENDER (§9 L0); nunca no git, nunca no chat.
REMOTION_AWS_REGION=us-east-1
REMOTION_AWS_ACCESS_KEY_ID=
REMOTION_AWS_SECRET_ACCESS_KEY=
REMOTION_LAMBDA_FUNCTION=          # saída do npm run lambda:deploy
REMOTION_SERVE_URL=                # idem (site hookmill-<sha>)
RENDER_LAMBDA_FRAMES_PER_LAMBDA=150
RENDER_LAMBDA_MAX_INFLIGHT=20      # renders no ar ao mesmo tempo (sobe depois da cota e da L4)
RENDER_LAMBDA_MAX_INFLIGHT_PER_WORKSPACE=10
RENDER_LAMBDA_POLL_MS=3000
RENDER_LAMBDA_WEBHOOK=on           # off = só polling (dev sem túnel)
RENDER_WEBHOOK_SECRET=             # openssl rand -hex 32
REMOTION_LICENSE_KEY=              # vazio enquanto Free (§7)
```
`REMOTION_BROWSER_EXECUTABLE`, `RENDER_TMP_DIR`, `FFMPEG_PATH`/`FFPROBE_PATH` **continuam** (captura de página e pós-processo).

### 6.4 Eventos (`eventos.md` §4 atualizado quando aprovar)
- Webhook de entrada `POST /api/v1/webhooks/render`: o formato é o do Remotion (§2.3), **não** o `X-Render-Signature` sha256 reservado antes. Rota pública, sem JWT, com corpo cru (igual WaveSpeed) e throttle.
- O SSE não muda: o web recebe `render.updated` com o mesmo `Render`.

## 7. Licença do Remotion
- **Free:** "individuals and companies of up to 3 people", com uso comercial ilimitado [P1]. A HookMill hoje é Gusta + Tordan, então **cabe**, mesmo vendendo a SaaS a terceiros: o critério é o tamanho da empresa, não o uso. Freelancer, estúdio e agência contratados **somam** no limite de 4 [P2].
- **Na 4ª pessoa:** "Remotion for **Automators**" (ferramentas de vídeo automatizado, editores, prompt-to-video, Player embutido): **US$ 0,01 por render, mínimo de US$ 100/mês** (10.000 renders) [P1]. O render que conta é o que dá certo: "1 render is the successful generation of a video… or still image" [P2]. Prévia no Player não conta [P2]. Pôster por `renderStill` contaria como 2º render, e é mais um motivo pro pôster por ffmpeg (L-D5).
- O checklist manda comprar antes de lançar se a empresa tem mais de 3 pessoas [L15]. Com Automators, servidor sem telemetria exige relatório mensal verificável; o Remotion 5 vai tornar a telemetria obrigatória [P2]. Por isso `licenseKey` já está no contrato (`REMOTION_LICENSE_KEY`).
- É proibido deixar o cliente subir código Remotion próprio [P2]. A HookMill não faz isso.

## 8. O que ainda limita escala depois do Lambda
| peça | hoje | com 1 cópia da API + Lambda | quando 2 cópias |
|---|---|---|---|
| CPU da API | Chrome do render (a maior parte) | **sai o Chrome**; fica o ffmpeg do remix-keep (composição crf 12), a medição (YuNet/SFace, 10-19 s de CPU por campeão), emendas e captura de página | vira gargalo antes de mutex e SSE: medir na L4 |
| `KeyedMutex` (por criativo, em memória) | ok com 1 cópia | ok | **trocar** por `pg_advisory_xact_lock(hash(creativeId))` ou `SELECT … FOR UPDATE` (o compare-and-set no banco já existe) |
| SSE (`eventos.service`, em memória) | ok | ok | **trocar** o barramento por Postgres `LISTEN/NOTIFY` (sem infra nova) |
| `@Interval` / `@Cron` (iteracao `iterate-advance`, meta sync, uploads, zip, reconciliador WaveSpeed, **poller do render**) | ok | ok (todos idempotentes por claim no banco) | **líder** por `pg_try_advisory_lock` por laço, ou claim por linha |
| fila de render | serial | despachante com claim no banco (`updateMany where status='QUEUED'`) | já serve pra N cópias |
| pool do banco | `connection_limit=5` | webhooks + poller + finalizes concorrentes: **subir pra 10** e medir na L4 | por cópia |
**Recomendação: 2 cópias da API não é agora.** Com o Lambda, uma cópia só orquestra centenas de renders (é I/O). Abrir a fase "S" (escala da API: os 3 itens acima) quando aparecer o 1º destes gatilhos: CPU da API > 70 % sustentado na L4, deploy sem queda virar requisito de cliente, ou a VPS do Lab sofrer. Estimativa: ~2-3 dias de backend + qa.

**Provedores (WaveSpeed, Anthropic):** com o render paralelo, o gargalo passa a ser a cota deles. Não há número de cota registrado nos docs, e eu não invento: o da Anthropic depende do tier da organização (console), e o da WaveSpeed sai do painel ou dos 429 medidos. **Recomendação:** um `ProviderLimiter` por provedor (dono: ia, junto com o backend):
- teto de tarefas no ar, contado no banco (`count(provider_tasks where provider=X and status='SUBMITTED')`), o que já funciona com N cópias, mais um teto por minuto;
- 429 / `Retry-After` = espera exponencial e devolve pra fila, sem virar `FAILED`;
- justiça por workspace (um lote grande não toma tudo);
- os limites ficam em env (`LIMIT_WAVESPEED_INFLIGHT`, `LIMIT_ANTHROPIC_RPM`…) e os números saem da L4 + console.
Entra **antes da L4 com provedor real**. A L4 com mock só prova que o limitador segura.

## 9. Fases
Regras: nenhuma fase começa sem o ok do Gusta; gasto acima de US$ 1 só com ok explícito daquela rodada; só o qa declara "funciona".

| fase | dono | o que é | critério de pronto | custo |
|---|---|---|---|---|
| **L0** | **Gusta** (o arquiteto guia, sem ver credencial) | conta AWS, IAM, cota, orçamento (passo a passo abaixo) | `npx remotion lambda policies validate` ok e `npx remotion lambda quotas` mostrando a cota, rodados pelo Gusta (ou por um agente que lê o `.env` dele sem imprimir); pedido de cota aberto; alarme de orçamento ativo | US$ 0 |
| **L1** ✅ 25/10 (§5.0; US$ 0,07) | arquiteto (script de sonda em `scripts/`) + video (props das amostras) | sonda: `deploySiteFromBundle` + `deployFunction` + **6 renders reais** do scratch `headline` 9:16 de 32 s (fixtures de `amostra.json`, mídia num prefixo temporário do bucket ou no Supabase com URL assinada): `framesPerLambda` 20/75/150 × memória 2048/3008, 1 frio e 1 quente; 1 teste de `s3OutputProvider` → Supabase | tabela com tempo de parede, `costs.accruedSoFar`, nº de funções, bytes baixados do Supabase, PSNR RGB local × Lambda (mesmo bundle e props) ≥ 40 dB, nb_frames e áudio iguais; números entram nas §5 e §2.1 deste doc | **≤ US$ 0,50** (6-8 renders a ~US$ 0,01-0,03 + S3) |
| **L2** | video (`api/src/render/lambda/`, porta e adaptadores `local`/`fake` no novo formato) + backend (despachante, poller, webhook, `settle`, recuperação, custo) + arquiteto (migração §6.2, env, `npm run lambda:deploy`) | adaptador `lambda` atrás de `RENDER_IMPL` + `RENDER_LAMBDA_KINDS=scratch` | Jest: adaptador com cliente Remotion falso (sucesso, erro, timeout, throttling, webhook duplicado/atrasado/assinatura errada, restart no meio); int.spec com `fake` sem regressão; **2 renders reais** do scratch pela API local apontando pro Lambda (mídia no Supabase), `READY` no web com progresso aparecendo | ~US$ 0,05 |
| **L3** | video (composições e pós-processo) + qa (suíte de comparação) | `RENDER_LAMBDA_KINDS` cresce: `auto-edit` (8 tipos × 3 formatos), **`frame` (Moldura, 18 templates × 3 formatos, inclusive `call_dialog` de 2 fontes)**, `remix-keep` (intermediário no Lambda + composição na API, swap A e B) | por peça (critério revisto 25/10 pela L1, §5.0: Mac × Linux nunca passa de ~32 dB na borda das letras): **referência = render Linux** (o `local` na VPS/Docker, mesmo bundle e props) com PSNR RGB ≥ 40 dB por frame; **sem render Linux**, PSNR RGB contra o local do Mac ≥ 40 dB **fora da borda dos glifos** (máscara de 6 px onde a diferença passa de 24 níveis, como em `scripts/sonda-lambda-l1.mjs`) + folha de frames conferida (mesma fonte, mesma quebra de linha, sem fonte de reserva) (remix: os critérios do render.md, fora da região ≥ 40 dB contra o campeão, áudio md5 = campeão no A), nb_frames igual, sem fonte de reserva (folha de frames conferida), `FRAME_TEXT_OVERFLOW` igual ao local; teste de "nenhuma prop com localhost" | ~80-100 renders ≈ **US$ 2-3** |
| **L4** | qa (roteiro e medição) + backend (limitadores) + arquiteto (painel de custo) | carga com **integrações mock** (WaveSpeed/Claude falsos, mídia mock **no Supabase** pra o Lambda alcançar) e render **real** no Lambda: 10 → 50 → 100 lotes simultâneos (lote = 11 peças 9:16), com ok do Gusta antes de cada degrau | 0 render perdido ou duplicado no `READY`; throttling da AWS não vira `FAILED`; p50/p95 do tempo de lote; CPU/RAM da API e pool do banco; egress do Supabase por render; custo real ÷ estimado; SSE chegando | 10 lotes ≈ US$ 2-5 · 50 ≈ 10-25 · 100 ≈ 25-50 (L-D7) |
| **L5** | arquiteto (deploy, env, runbook em `docs/deploy.md`) + qa (vigia de 48 h) + Gusta (EasyPanel) | corte: `RENDER_IMPL=lambda` com todos os `kind` no EasyPanel, `RENDER_CONCURRENCY` local em 1 como reserva | 48 h sem `FAILED` novo atribuível ao Lambda; custo/dia dentro do alarme. **Rollback:** `RENDER_IMPL=local` (ou tirar um `kind` do `RENDER_LAMBDA_KINDS`) + restart. O que já está no Lambda termina pelo poller (§2.7), e o que está `QUEUED` vai pra fila local. Chrome e render local ficam na imagem **≥ 30 dias** | custo do uso real |

### L0 — ✅ feita 25/10 pelo CLI (Gusta criou a conta e o `gusta-cli`; o resto foi pelo CLI, registro em `docs/infra/README.md`). Pendente: MFA do root. Texto original: o que o Gusta faz no console (~30-40 min, US$ 0)
Credencial **nunca** passa pelo chat nem pelo terminal compartilhado: vai direto do console pro `.env` dele.
1. Criar a conta AWS (e-mail da empresa, cartão). Na conta **root**: ligar **MFA**, criar o acesso de administrador pro dia a dia (IAM Identity Center ou usuário admin com MFA) e não usar mais a root.
2. **Billing → Budgets → Create budget**: mensal de **US$ 20**, alertas por e-mail em 50 / 80 / 100 %. Ligar também *Cost Anomaly Detection*.
3. Seletor de região no topo: **US East (N. Virginia) us-east-1**.
4. **IAM → Policies → Create policy → JSON**: colar o JSON de `npx remotion lambda policies role` (o arquiteto gera na hora, versão 4.0.533, e salva em `docs/infra/remotion-role-policy.json`; não é segredo). Nome exato **`remotion-lambda-policy`** [L1].
5. **IAM → Roles → Create role** → caso de uso **Lambda** → anexar `remotion-lambda-policy` → nome exato **`remotion-lambda-role`** [L1].
6. **IAM → Users → Create user** `hookmill-remotion-deploy`, **sem** acesso ao console → depois **Add inline policy → JSON** com `npx remotion lambda policies user` (arquivo `docs/infra/remotion-user-policy.json`), nome `remotion-user-policy` [L1].
7. No usuário: **Security credentials → Create access key** [L1]. Copiar as duas chaves **direto** pro `projects/maquina-anuncios/.env` do Mac dele (já está no `.gitignore`):
   `REMOTION_AWS_ACCESS_KEY_ID=…` · `REMOTION_AWS_SECRET_ACCESS_KEY=…` · `REMOTION_AWS_REGION=us-east-1`
8. **Service Quotas → AWS services → AWS Lambda → Concurrent executions → Request increase → 1000** (us-east-1), com a justificativa do modelo da doc [L9].
9. Avisar no chat **só** "L0 feita". O validate e o quotas (critério da L0) rodam no Mac dele.
10. (Na L5, não agora) criar o usuário de **produção** `hookmill-api-render`, com a mesma política no início (a doc não separa deploy de render [L2]) ou com o recorte que a L2 provar por `simulatePermissions`. Essa chave vai **só** no EasyPanel. A de deploy nunca sai do Mac. (L-D8)

## 10. Proteções de custo (entram na L2, não depois)
- O alarme de orçamento da AWS (L0) só avisa, não bloqueia. Quem bloqueia é a API: `RENDER_LAMBDA_MAX_INFLIGHT`, teto por workspace, e o teto de lote/créditos que já existe. O checklist pede rate limit [L15].
- `CostEntry` (`AWS_LAMBDA`/`RENDER`) por tentativa, com `costs.accruedSoFar` do Remotion (só Lambda [L5]), aparece no painel de custos de hoje.
- `CHAMPION_MAX_SEC` e o tamanho máximo continuam (a saída tem que caber em metade do disco [L15]).

## 11. Decisões abertas
| # | decisão | recomendação |
|---|---|---|
| **L-D1** | Região | **us-east-1** (§3). |
| **L-D2** | Região do Supabase compartilhado | ✅ **Resolvida 25/10: `us-east-1`** (host do pooler `aws-0-us-east-1.pooler.supabase.com` em `api/.env.easypanel`). Mídia e render na mesma região. A recomendação continua us-east-1 em qualquer caso; a L1 mede o download e reabre se ele dominar. |
| **L-D3** | Saída: S3 → API → Supabase ou `s3OutputProvider` direto no Supabase | **S3 → API → Supabase** na v1: um caminho só, também serve pro remix, e a chave do Supabase não vai pro Lambda. O direto vira otimização se a L1 provar. |
| **L-D4** | Egress da mídia (cada pedaço baixa tudo) | `framesPerLambda=150` agora; copiar a mídia pro S3 ou pôr CDN **só se** a L4 mostrar egress acima da franquia. |
| **L-D5** | Pôster: `renderStillOnLambda` ou ffmpeg na API | **ffmpeg na API** (frame de 1,5 s do MP4): sem invocação extra e sem 2º render na licença. O qa confere se não há diferença visível. |
| **L-D6** | Composição do remix-keep (ffmpeg) | **Fica na API** na v1. Ir pra Lambda própria (imagem com ffmpeg) só se a L4 mostrar a CPU da API como gargalo. |
| **L-D7** | L4 até 100 lotes com render real (~US$ 25-50) | **10 e 50 reais**. O degrau de 100 com render real só se o 50 mostrar algo que não escala de forma linear; senão, roda o 100 com o adaptador `fake` (prova API, banco, SSE e limitadores sem gastar). |
| **L-D8** | Uma chave AWS ou duas | **Duas**: deploy (só no Mac do Gusta) e render (só no EasyPanel), criadas na L0 e na L5. |
| **L-D9** | Licença | **Free agora.** Assinar o **Automators (mín. US$ 100/mês)** no dia em que entrar a 4ª pessoa, incluindo freelancer ou agência, ou antes do 1º cliente pagante se o Gusta preferir se proteger. A decisão é dele. |
| **L-D10** | 2 cópias da API (mutex/SSE/intervals) | **Depois**, com os gatilhos da §8. Antes da L4 com provedor real entra só o `ProviderLimiter`. |
| **L-D11** | `skipLambdaInvocation` no polling | Desligado na v1 (menos permissão). Liga se a L4 mostrar o poller lento. |
