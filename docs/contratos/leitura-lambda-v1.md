# Leitura do anúncio na AWS Lambda — contrato v1
Data: 2026-10-31 · Dono: maquina-arquiteto · Status: **IMPLEMENTADO atrás de `ANALYZE_IMPL` (padrão `local`)**, pedido explícito do Gusta em 31/10 ("vamos colocar a leitura do ad em uma lambda também"). Produção continua em `local` até o Gusta trocar a env no EasyPanel.
Vale por cima de `feature-2-variar-campeao.md` §6.2/§13.7 só no **onde** a medição roda. O formato de `Measurements`, `EditMap` e dos jobs não muda; o web não muda.

Evidência lida: `api/src/campeoes/analise.service.ts` (`runAnalyze`, `mapEdit`, `measure`, `refineLayers`, `textCrops`), `api/src/medicao/{media-analysis.service,ffmpeg,rostos,contrato}.ts`, `api/src/render/lambda/*`, `docs/contratos/render-lambda-v1.md`, `docs/infra/README.md`, `api/Dockerfile`, jobs e custos reais do banco `maquina` (28/10, 27/10, 24/10).

---

## 0. Resumo
1. **Só a mídia vai pra Lambda; a API continua orquestrando** (Claude, transcrição, banco, storage). Respeita a decisão de 05/10 ("sem worker de agente"): a Lambda é uma função de cálculo sem estado, igual ao Remotion Lambda.
2. **3 invocações por análise**, agrupadas pelo que depende do quê: `ler` (decodifica inteiro + probe + áudio) → `medir` (layout, silêncios, frames-chave, paleta, trilha do rosto, recortes de texto) → `refinar` (camadas da visão medidas por pixel). O contêiner quente guarda o vídeo no `/tmp`: só a 1ª baixa.
3. **A medição agora corre junto com a transcrição** (vale pro local também): ela só depende do vídeo. Antes esperava a transcrição terminar.
4. **Mesmo código, sem fork:** `api/src/medicao/leitura/etapas.ts` roda no adaptador local e no `handler.ts` da função. Imagem de contêiner no ECR com ffmpeg 7.0.2 estático + onnxruntime-node linux/arm64 + YuNet/SFace, montada **sem Docker** por `scripts/leitura-lambda.mjs`.
5. **Rollback = trocar a env.** `ANALYZE_IMPL=local|lambda`, padrão `local`. Falha de infraestrutura da Lambda (throttling, timeout, erro) refaz a etapa no local e o resto da análise segue no local.

## 1. Onde estava o tempo (medido em 31/10)

### 1.1 Análises reais no banco `maquina` (API local no Mac M5, IA live)
| campeão | duração | total do job | transcrição (WaveSpeed) | Claude (3 pares de chamadas) |
|---|---|---|---|---|
| `cmvt99btv…` 720×1280 | 123,6 s | **194 s** | 24 s de espera | ~100 s (custos gravados em 94 s, 157 s e 194 s) |
| `cmvnqu40e…` 720×1280 | 41,8 s | **197 s** | 23 s | ~90 s |
| `cmvrqg4od…` 1088×1920 | 20,0 s | **126 s** | 26 s | ~70 s |
Custo de IA por análise (CostEntry): US$ 0,23-0,67 (transcrição US$ 0,04-0,25 + Claude US$ 0,23-0,43).

### 1.2 Só a mídia, cronometrada etapa por etapa (mesmo código, Mac M5 10 núcleos, sem IA)
| etapa | 20 s 1088×1920 | 42 s 720×1280 | 124 s 720×1280 |
|---|---|---|---|
| validateFull | 0,24 | 0,31 | 1,12 |
| extractAudio | 0,18 | 0,26 | 0,92 |
| measureLayout | 1,02 | 2,37 | 8,11 |
| silences | 0,02 | 0,02 | 0,07 |
| keyframes (6/12/16) | 0,38 | 0,49 | 0,81 |
| palette | 0,09 | 0,16 | 0,21 |
| **faceTrack** (layout de novo + YuNet/SFace + bordas + 2ª passada) | **2,52** | **4,23** | **16,31** |
| textCrops | 0,22 | 0,26 | 0,29 |
| refine (camadas) | 0 | 2,26 | 1,36 |
| **total mídia** | **4,7 s** | **10,4 s** | **29,2 s** |
Leitura: no Mac a mídia é **15-25 %** do job; o resto é Claude (~50 %) e transcrição (~15 %). O `faceTrack` é metade da mídia e **mede o layout duas vezes** (`measureLayout` dentro dele: 8 s de 29 s no vídeo de 2 min). Na VPS (2 vCPU compartilhados com a API e o render) a mesma CPU vira 3-5x mais tempo de parede, e é ela que disputa com as requisições — isso não dá pra medir daqui sem mexer em produção; é estimativa.

### 1.3 O que isso decide
- O ganho de **tempo** vem de (a) a medição andar junto com a transcrição, (b) não medir o layout duas vezes e (c) tirar a CPU da VPS. Rodar o `runAnalyze` inteiro na Lambda não ganharia nada: o tempo dele é espera de rede (Claude, WaveSpeed), e Lambda cobra por segundo de espera.
- O próximo ganho grande **não é Lambda**: `analyzeChampion` e `describeEdit` não dependem um do outro e rodam em série (~40-60 s por análise). Ver §8, L-D4.

## 2. Recorte (decisão L-D1)
| parte | onde | por quê |
|---|---|---|
| download do vídeo, `validateFull`, `probe`, `extractAudio` | **λ `ler`** | CPU (decodifica tudo). O áudio volta ao storage por PUT pré-assinado. |
| `measureLayout`, `silences`, `keyframes`, `palette`, `faceTrack` (YuNet + SFace), `textCrops` | **λ `medir`** | Só dependem do vídeo: 1 invocação. A trilha recebe o layout recém-medido (sem medir de novo). Falha da trilha volta como `{ ok: false, erro }` e não derruba a medição (regra de hoje: sem mapa, a análise segue). |
| `solidBackground`, `layerPresence`, `captionBox` | **λ `refinar`** | Precisa das camadas que o Claude (`describeEdit`) devolve, então é uma 2ª ida. Contêiner quente: o vídeo já está no `/tmp`. |
| Ad Library, transcrição, `describeEdit`, `analyzeChampion`, banco, `storage.put`/registro, estados do job | **API** | Orquestração e rede. "Sem worker de agente" (05/10) continua valendo. |
| captura da página (`captura-pagina.ts`), versão sem legenda, prévia borrada, render | **API** (fora deste contrato) | Fase 2 se a VPS ainda apertar: são jobs separados e o padrão aqui serve igual. |

## 3. Interface

### 3.1 Porta (`api/src/medicao/leitura/contrato.ts`)
```ts
interface LeituraMidia { impl: 'local' | 'lambda'; abrir(a: { workspaceId; video: { storageKey }; audio: { storageKey } | null; dir }): LeituraSessao }
interface LeituraSessao {
  ler(extrairAudio: boolean): Promise<{ probe; audio: { artefato: Artefato; durationSec } | null }>;   // lança MediaInvalidError
  medir(p: { medir: boolean; segmentos?; mapear: boolean }): Promise<{ medidas | null; trilha: {ok,valor}|{ok:false,erro}|null; recortes }>;
  refinar(p: { layers; fps; frameCount; words }): Promise<EditLayer[]>;
}
type Artefato = { tipo: 'local'; path } | { tipo: 'storage'; key; sizeBytes; mimeType };
```
O `analise.service` transforma artefato em linha de `files`: `local` → `storage.put` (como antes); `storage` → `storage.registerObject` (a Lambda já subiu). Token Nest `LEITURA_MIDIA`, provido no `CampeoesModule`.

### 3.2 Evento e resposta da função (síncrona, `RequestResponse`)
```jsonc
// entrada
{ "v": 1, "op": "ler",     "video": { "url": "<GET pré-assinado>", "cacheKey": "<storageKey>" }, "audioPut": { "url": "<PUT>", "contentType": "audio/mp4" } | null }
{ "v": 1, "op": "medir",   "video": {…}, "probe": {…}, "medir": true, "segmentos": […]?, "mapear": true,
  "framePuts": [16 × { "url", "contentType": "image/jpeg" }], "cropPuts": [6 × {…}] }
{ "v": 1, "op": "refinar", "video": {…}, "entrada": { "layers": […], "fps", "frameCount", "words": […] } }
// saída
{ "ok": true, "op": "...", "resultado": {…}, "tempos": { "totalMs", "downloadMs", "etapaMs", "uploadMs", "fria", "cacheVideo" }, "avisos": [] }
{ "ok": false, "erro": { "name": "MediaInvalidError", "message", "reason": "undecodable" } }
```
- **Arquivos:** o vídeo entra por GET pré-assinado do storage (Supabase, us-east-1, mesma região). Áudio, frames-chave e recortes voltam por **PUT pré-assinado** em chaves que a API gerou (`ws/<id>/champion_audio|champion_frame/<uuid>.<ext>`); a resposta diz qual *slot* virou qual arquivo e o tamanho. Nada de credencial do storage dentro da Lambda.
- PUT pré-assinado preso só ao `Content-Type` (`StorageService.presignPut` sem `contentLength`; o fluxo de upload direto continua preso ao tamanho).
- Slot sem uso não vira objeto. Se a Lambda falhar no meio e cair no fallback, o que ela já subiu fica órfão no bucket (KB; aceito).
- `MediaInvalidError` não tem fallback (o vídeo é ruim em qualquer lugar). Qualquer outro `ok: false`, `FunctionError`, throttling, timeout ou rede = `ErroInvocacao` → fallback.

## 4. Empacotamento e infraestrutura (L-D2)
- **Imagem de contêiner** no ECR `hookmill-leitura`, **arm64** (bate bit a bit com o Mac nas medidas e no editMap e é 20 % mais barata; a x86_64 foi ~18 % mais rápida no `medir`, com diferenças de subpixel, e fica a um `--arch x86_64` de distância): base oficial `public.ecr.aws/lambda/nodejs:22` + 1 camada com `/var/task/index.js` (esbuild do `handler.ts`), `node_modules/onnxruntime-node` (só o binário linux/arm64) + `onnxruntime-common`, `/var/task/modelos/{yunet,sface}.onnx` e `/opt/bin/{ffmpeg,ffprobe}` (johnvansickle 7.0.2 estático, sha256 fixado no script). ~100 MB comprimidos na camada.
- **Sem Docker** (a máquina do Gusta não tem): `scripts/leitura-lambda.mjs` baixa a base pelo registry público, monta a camada com `tar`, e sobe pela API do ECR (`InitiateLayerUpload`/`UploadLayerPart`/`PutImage`). Idempotente. Mantém as 5 últimas imagens.
- **Função `hookmill-leitura`**: memória **3008 MB** (ver §5), timeout **600 s**, `/tmp` 2048 MB, `MEDICAO_ONNX_THREADS` = vCPUs da memória, logs com retenção de 7 dias. Role `hookmill-leitura-role` só com `AWSLambdaBasicExecutionRole` (a função não fala com S3: só URLs assinadas).
- **Quem invoca:** a API, com a mesma chave do render (`REMOTION_AWS_*`, usuário `hookmill-remotion-deploy`). A permissão está **na função** (política de recurso `api-hookmill-invoca`), sem mexer na política do usuário. O freio de orçamento (Deny * no usuário) continua cortando a leitura também.
- **Quem faz deploy:** `node scripts/leitura-lambda.mjs deploy [--mem N]` com o perfil admin (`gusta-cli`). O script recusa rodar com a chave do render. Outros comandos: `status`, `memoria <MB>`, `apagar`.
- ffmpeg diferente por ambiente (Mac 6.0, VPS Debian 5.1 amd64, Lambda 7.0.2 arm64): o decodificador H.264 é exato bit a bit, então as medidas batem (provado em §6.2). O JPEG dos frames pode diferir em bytes, não em conteúdo.

## 5. Memória, timeout, concorrência e custo
| item | valor | por quê |
|---|---|---|
| memória | **3008 MB** (≈ 1,7 vCPU, 2 núcleos visíveis) | é o **teto desta conta**: `MemorySize` 10240 foi recusado (`Member must have value less than or equal to 3008`, conta nova). Com 10240 MB a função teria 6 vCPU e o ffmpeg decodifica em paralelo: pedir o aumento à AWS (L-D7) é o maior ganho de velocidade disponível. Memória usada hoje: 470-640 MB |
| timeout da função | 600 s (máx. 900) | `medir` de um campeão de 180 s (`CHAMPION_MAX_SEC`) leva bem menos; folga pra cold start |
| timeout do cliente | 620 s (`ANALYZE_LAMBDA_TIMEOUT_SEC`) | > timeout da função; SDK com `maxAttempts: 1` (retentativa = fallback local, não outra Lambda) |
| concorrência | sem reserva | a conta tem cota de **10** execuções simultâneas (pedido de 1000 PENDING desde 25/10), dividida com o Remotion. Cada análise usa 1 por vez. Estourou → throttling → fallback local. Reservar concorrência só depois da cota de 1000. |
| custo Lambda | ver §6.2 | arm64 US$ 0,0000133334/GB-s + US$ 0,20/1M invocações; ECR US$ 0,10/GB-mês (~US$ 0,05/mês com 5 imagens) |

## 6. Testes

### 6.1 Automatizados (recorte)
- `api/src/medicao/leitura/lambda.spec.ts` (unitário, 10 casos): evento e PUTs (1 de áudio, 16 de frame, 6 de recorte), slots → chaves, `MediaInvalidError` sem fallback, throttling/erro/resposta errada → fallback e o resto da sessão no local, `ANALYZE_LAMBDA_FALLBACK=off`, config e falha de boot sem credencial.
- `api/src/campeoes/leitura-lambda.int.spec.ts` (integração, banco `maquina_test` + MinIO local): `ANALYZE_IMPL=lambda` com a **Lambda mockada** (o invocador chama o `handler` no processo, com GET/PUT pré-assinados de verdade). Mesmo vídeo analisado pela "Lambda" e pelo local (throttling → fallback): **medições e editMap iguais**; áudio e frames que a função subiu viraram `files` e baixam.
- `campeoes.int.spec.ts` + `maquinas-f2.spec.ts` (caminho local sem regressão): 128/128. `tsc` limpo.

### 6.2 Real (31/10, 1 anúncio, ambiente local do Gusta, bucket `hookmill-dev`)
Função `hookmill-leitura` arm64 3008 MB. Script de comparação: mesma sessão no local (Mac) e na Lambda (`fallback` off), mesmo vídeo do `hookmill-dev`, refino com as camadas que a visão já tinha devolvido (sem gastar Claude), editMap montado com `buildEditMap` dos dois lados.

| anúncio | probe, frames-chave, trilha, recortes, camadas, **editMap** | medidas | áudio |
|---|---|---|---|
| `cmvnqu40e…` 42 s, 3 camadas | **iguais** (deep equal, 2 rodadas) | **iguais** | duração 41,682 × 41,681 s |
| `cmvt99btv…` 124 s, 18 segmentos | **iguais** | 3 silêncios com borda 1 ms diferente | 123,579 × 123,578 s |
A diferença de 1 ms vem do encoder AAC (ffmpeg 6.0 no Mac × 7.0.2 na Lambda), não da medição. Na **x86_64** (testada e descartada como padrão) aparecem diferenças de subpixel: borda de faixa 1 px, paleta ±1 nível, caixa do rosto ±0,1 % (o `swscale` arredonda diferente em x86); é o mesmo tipo de diferença que a VPS (amd64) já tem contra o Mac.

**Tempo da função** (contêiner quente; a 1ª chamada fria custa +0,3-0,6 s de init e o download do vídeo):
| anúncio | `ler` | `medir` | `refinar` | total Lambda | mesmo código no Mac M5 |
|---|---|---|---|---|---|
| 42 s (arm64) | 3,1-4,2 s | 24-35 s | 3,6-4,8 s | 31-46 s | 12 s |
| 42 s (x86_64) | 3,4 s | 28 s | 4,2 s | 37 s | 12 s |
| 124 s (arm64) | 10,8-11,9 s | 97-99 s | 5,8-5,9 s | 117-120 s | 39 s (com 12,5 s de download pra Bali) |
Memória usada: 470-640 MB. O `medir` do vídeo de 2 min passa ~50 s na trilha (YuNet 16 s + 2ª passada 34 s, quase tudo decodificação do ffmpeg). Por segundo de CPU, a Lambda de 3008 MB é ~4x mais lenta que o M5; contra a VPS (2 vCPU dividida com o Lab e o render) não dá pra medir daqui sem tocar em produção.

**Ponta a ponta real** (2ª API local na porta 3101, banco `maquina_test`, IA live, storage `hookmill-dev`, `ANALYZE_IMPL=lambda`, campeão de 42 s): `READY` em **116 s** com editMap e `keepEdit` liberado; `ler` 3,1 s, `medir` 24,3 s (terminou dentro da espera da transcrição: a etapa `measuring` nem apareceu), `refinar` 3,6 s. O mesmo anúncio levou 197 s em 24/10 (Mac, código antigo), mas parte dessa diferença é variação do Claude (o `describeEdit` levou ~16 s hoje e ~50 s em 24/10); o que é da mídia é a sobreposição com a transcrição (~10-25 s por análise). Custo dessa análise: IA US$ 0,38 + Lambda ~US$ 0,0012. Dados de teste apagados (banco e storage).

**Custo por análise (Lambda arm64, US$ 0,0000133334/GB-s × 2,94 GB):** 42 s ≈ 31-46 s de função = **US$ 0,0012-0,0018**; 124 s ≈ 120 s = **US$ 0,0047**; + 3 invocações (US$ 0,0000006) + saída da AWS pro Supabase (1-3 MB, ~US$ 0,0003). Menos de 1 % do custo de IA da análise. ECR: ~0,5 GB = ~US$ 0,05/mês. Gasto total dos testes de 31/10: ~US$ 0,03 de AWS + US$ 0,38 de IA.

## 7. Retomada, dev e operação
- **Boot:** nada novo. A invocação é síncrona dentro do `runAnalyze`; se a API reinicia no meio, a recuperação de hoje marca o campeão `FAILED INTERRUPTED` (ação `analyze_again`) e a nova tentativa reaproveita transcrição e medições gravadas. A invocação órfã termina sozinha (≤ 600 s) e o que ela subiu fica sem linha em `files`.
- **Dev:** `ANALYZE_IMPL=local` (padrão). Jest força `local` (`jest.setup-env.ts`); o int spec da Lambda injeta o invocador falso. Pra testar a função real do Mac: `ANALYZE_IMPL=lambda` no `api/.env` (storage tem de ser o Supabase: a Lambda não alcança o MinIO local).
- **Logs:** a API loga cada invocação (`leitura lambda medir: 41234 ms (download …, etapa …, upload …, fria)`) e o fallback (`leitura lambda (medir) falhou, segue no local: …`). CloudWatch `/aws/lambda/hookmill-leitura` (7 dias).
- **Deploy de código novo da medição:** mudou `api/src/medicao/**` → `node scripts/leitura-lambda.mjs deploy` **antes** de subir a API (senão a Lambda roda a versão velha das etapas). Fica no checklist de release (`docs/deploy.md`).

### 7.1 Envs pro EasyPanel (API de produção)
```
ANALYZE_IMPL=lambda
ANALYZE_LAMBDA_FUNCTION=hookmill-leitura
ANALYZE_LAMBDA_FALLBACK=on
# já existem lá (render-lambda): REMOTION_AWS_REGION, REMOTION_AWS_ACCESS_KEY_ID, REMOTION_AWS_SECRET_ACCESS_KEY
```
Rollback: `ANALYZE_IMPL=local` e redeploy.

## 8. Decisões
| id | decisão | status |
|---|---|---|
| L-D1 | só a mídia na Lambda, 3 invocações (`ler`, `medir`, `refinar`); API orquestra | **feito** |
| L-D2 | contêiner arm64 no ECR, montado sem Docker, mesmo código das etapas | **feito** |
| L-D3 | medição em paralelo com a transcrição + trilha reaproveita o layout (vale pro local) | **feito** |
| L-D4 | rodar `describeEdit` e `analyzeChampion` em paralelo (independentes): ~40-60 s a menos por análise, sem custo extra | **proposta** (backend, `analise.service`) |
| L-D5 | captura da página, versão sem legenda e prévia na mesma função (novas ops) | **proposta**, só se a VPS ainda apertar |
| L-D6 | concorrência reservada na função quando a cota de 1000 sair | pendente (cota) |
| L-D7 | pedir à AWS memória de função até 10240 MB (6 vCPU) e reavaliar 3008 × 6144 × 10240 | **recomendado** (Gusta, Support/Service Quotas; US$ 0) |
| L-D8 | arm64 × x86_64: hoje arm64 (igual ao Mac, mais barato); x86_64 se a velocidade pesar mais que a igualdade bit a bit | decidido arm64, reversível |
