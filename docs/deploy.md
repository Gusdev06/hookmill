# Deploy da HookMill (runbook)
Data: 2026-10-13 · Dono: maquina-arquiteto · Desenho fechado em [`contratos/estrutura.md` §6](contratos/estrutura.md) (não reabrir).
Decisões do Gusta em 13/10: VPS = Hostinger `srv1798762.hstgr.cloud` (a MESMA da API do AI Model Lab), Supabase **Free**,
domínio provisório (web em `*.vercel.app`, API no domínio HTTPS do EasyPanel). O 1º commit e o repo GitHub são do loop principal.

| parte | onde | o que sobe |
|---|---|---|
| web | Vercel, Root Directory `web/` | Next 16 (BFF de sessão + telas) |
| api | EasyPanel na VPS, `api/Dockerfile`, contexto = raiz do repo | NestJS + Prisma + render Remotion (Chrome headless shell) + ffmpeg + onnxruntime |
| banco | Supabase (projeto novo, Free) | Postgres pelo pooler (6543 transação / 5432 sessão) |
| arquivos | Supabase Storage do mesmo projeto, API S3 | bucket privado `maquina-anuncios` |

## 0. Antes de tudo (local, sem custo)
```bash
npm run typecheck && npm test        # na raiz; tem que passar
```
- Docker não roda neste Mac: a imagem só é provada de verdade no 1º build do EasyPanel (o Dockerfile falha cedo e com mensagem se faltar lib do Chrome, onnxruntime, ffmpeg, bundle ou modelo ONNX).
- Confirme que `video/public/fixtures/amostra.json` foi pro git: o bundle do Remotion importa esse arquivo e o build quebra sem ele.

## 1. Supabase (Gusta, ~10 min, US$ 0)
1. **New project** na org do Gusta. Nome `hookmill`. Plano **Free**. Senha do banco forte (gerada pelo painel; guarde no gerenciador de senhas, ela entra nas duas URLs).
   **Região: a mais perto da VPS.** Confira o datacenter da `srv1798762` no hPanel da Hostinger (VPS → Visão geral → Localização). Brasil → `South America (São Paulo)` `sa-east-1`; EUA → `East US (N. Virginia)` `us-east-1`; Europa → `Central EU (Frankfurt)` `eu-central-1`.
2. **Desligar a Data API** (PostgREST): Project Settings → Data API → desmarcar *Enable Data API*. A API nunca usa; desligado, a chave pública não expõe tabela nenhuma.
3. **Bucket:** Storage → New bucket → nome `maquina-anuncios`, **Public OFF**, *Restrict file size* = **50 MB** (o máximo do Free), sem restrição de MIME.
   Storage → Settings: o limite global do Free é 50 MB e não sobe sem Pro (ver §8).
4. **Chave S3:** Storage → Settings → S3 Connection → habilitar → *New access key* (nome `hookmill-api`). Anote `Access key ID` e `Secret access key` (o segredo só aparece uma vez), o **Endpoint** (`https://<ref>.storage.supabase.co/storage/v1/s3`) e a **Region**.
5. **URLs do banco:** botão *Connect* → *ORMs/Prisma* (ou Connection string → Supavisor):
   - `DATABASE_URL` = **Transaction pooler**, porta **6543**, acrescentando `?pgbouncer=true&connection_limit=5`
   - `DIRECT_URL` = **Session pooler**, porta **5432** (IPv4; a conexão direta `db.<ref>.supabase.co` é só IPv6 sem add-on pago)

## 2. EasyPanel: criar o app SEM fazer deploy ainda (Gusta, ~5 min)
1. Projeto novo `hookmill` (separado do projeto do Lab), serviço **App** `api`.
2. **Source:** GitHub → repo da HookMill (criado pelo loop principal), branch `main`.
3. **Build:** tipo **Dockerfile**, arquivo `api/Dockerfile`, *Build path / context* = `/` (raiz do repo: a api depende de `contratos/` e `video/`).
4. **Domains:** usar o domínio padrão do EasyPanel (`https://api-hookmill.<id>.easypanel.host` ou parecido), **HTTPS ligado**, porta do container **3001**. Anote: é o `PUBLIC_API_URL` e a URL do webhook da WaveSpeed.
5. **Mounts:** *Volume* (não bind mount) nome `hookmill-data` → caminho **`/data`**. Ali ficam renders e downloads temporários; o arquivo final vai pro Supabase. O container roda como `node` (uid 1000); volume nomeado novo herda o dono da imagem. Se o start reclamar de permissão em `/data`, rode uma vez no console do EasyPanel como root: `chown -R 1000:1000 /data`.
6. **Resources (VPS compartilhada com a API do Lab):** *Memory limit* **4096 MB**, *Memory reservation* **2048 MB**, *CPU limit* **2**. Medido em `docs/render.md`: um render 9:16 com 1 aba chega a 1,7-2,3 GB (Chrome + compositor + node); medição soma ~0,3 GB. Antes, veja no console da VPS `nproc` e `free -h`: se a VPS tiver menos de 8 GB livres somando o Lab, **não suba o limite**; com 4 GB, `RENDER_CONCURRENCY=1` e `RENDER_FRAMES_CONCURRENCY=1` são obrigatórios.
   **Risco de disputa com o Lab:** render é CPU pura por 1-2 min e o build da imagem (Chrome, npm ci, bundle) também pesa. O limite de CPU protege o Lab no dia a dia; faça o **1º build fora do horário de pico do Lab** e acompanhe o Lab (latência/healthcheck) no 1º render. Se o Lab sofrer, baixe o CPU limit pra 1 (render fica ~2x mais lento) antes de pensar em VPS nova.
7. **Environment:** cole o bloco da §5 (api) com os valores reais. Ainda não clique em Deploy.

## 3. Teste do CORS do storage (eu, do Mac, US$ 0)
Decide `UPLOAD_MODE` e se o editor pode ser liberado. Precisa só das chaves S3 e da URL que o web vai ter (escolha o nome do projeto na Vercel antes: `https://<nome>.vercel.app`).
```bash
STORAGE_ENDPOINT=https://<ref>.storage.supabase.co/storage/v1/s3 STORAGE_REGION=<regiao> STORAGE_BUCKET=maquina-anuncios \
STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... WEB_ORIGIN=https://<nome>.vercel.app \
node scripts/storage-cors-check.mjs
```
O script sobe 1 KB em `_cors-check/`, testa com URL pré-assinada real e apaga. Ele roda os dois curls do `estrutura.md` §6 (preflight `GET`+`Range` e `GET` com `Range: bytes=0-99`, que tem que voltar **206** com `Access-Control-Allow-Origin` e `Content-Range` exposto) e mais o `PUT` direto. No fim imprime os curls pra repetir na mão e o veredito:
- **editor LIBERADO / BLOQUEADO.** Bloqueado = plano B do `estrutura.md` §6: proxy de leitura com `Range` na API. É trabalho do backend e o editor fica fora até ele existir.
- **`UPLOAD_MODE=direct`** só se o preflight do PUT e o PUT passarem; senão **`proxy`** (o arquivo passa pela API em multipart de 8 MB; com 48 MB de teto a banda da VPS aguenta).
Conferido no S3 local em 13/10: GET+Range ok, PUT bloqueado (o CORS local só libera GET/HEAD), veredito `proxy`; com origem errada, editor BLOQUEADO. **No Supabase ainda não rodou** (o projeto não existe).

## 4. Deploy da API (Gusta clica, eu acompanho os logs)
1. EasyPanel → Deploy. O build leva ~5-10 min na 1ª vez (npm ci duas vezes, bundle do Remotion, download do Chrome headless shell, SFace de 37 MB do GitHub com sha256).
   O Dockerfile prova no próprio build: bundle, `main.js`, os dois `.onnx` no `dist`, `ldd` sem lib faltando no Chrome, no compositor do Remotion e no onnxruntime, `require('onnxruntime-node')`, `ffmpeg -version`. Se cair aí, o log diz qual.
2. No start (`scripts/api-start.sh`): confere as envs obrigatórias e a escrita em `/data`, roda `prisma migrate deploy` (usa a `DIRECT_URL`) e sobe a API. No log: as migrações aplicadas e `API em http://localhost:3001/api/v1`.
3. `curl -s https://<api>/api/v1/health` → `{"ok":true,"db":true,"storage":true,...}`. O healthcheck da imagem bate nessa rota a cada 30 s (90 s de carência no boot); 503 = banco ou storage fora.

## 5. Variáveis de produção
Segredo só no painel (EasyPanel / Vercel). Nada disto vai pro git.

### api (EasyPanel → Environment)
| variável | valor / origem |
|---|---|
| `NODE_ENV` | `production` (já vem da imagem) |
| `PORT` | `3001` (imagem) |
| `PUBLIC_API_URL` | `https://<domínio do EasyPanel>` (sem `/api/v1`). Vira a URL do webhook: `<PUBLIC_API_URL>/api/v1/webhooks/wavespeed` |
| `WEB_ORIGIN` | `https://<nome>.vercel.app` (exato, sem barra no fim). Preview da Vercel tem outra URL e fica bloqueado pelo CORS: só a produção |
| `DATABASE_URL` | Supabase → Connect → Transaction pooler 6543 + `?pgbouncer=true&connection_limit=5` |
| `DIRECT_URL` | Supabase → Connect → Session pooler 5432 |
| `JWT_ACCESS_SECRET` | gerar: `openssl rand -base64 48` |
| `JWT_ACCESS_TTL` / `REFRESH_TTL_DAYS` / `INVITE_TTL_DAYS` | `15m` / `30` / `7` |
| `SIGNUP_ENABLED` | **`false`** (até ter cobrança). `true` só na janela do §7 |
| `SIGNUP_DEFAULT_SPEND_CAP_USD` | `10` (padrão; teto do 1º cliente de quem se cadastra) |
| `STORAGE_ENDPOINT` | Supabase → Storage → S3 Connection → Endpoint |
| `STORAGE_REGION` | região do projeto (a mesma da S3 Connection) |
| `STORAGE_BUCKET` | `maquina-anuncios` |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | chave S3 do §1.4 (acesso total, ignora RLS: só no servidor) |
| `STORAGE_FORCE_PATH_STYLE` | `true` |
| `SIGNED_URL_TTL_SEC` | `21600` |
| `INTEGRACOES_MODE` | **`live`** |
| `RENDER_IMPL` | `remotion` (já é o padrão no live; explícito evita surpresa) |
| `ANTHROPIC_API_KEY` | console.anthropic.com (a mesma do dev live ou uma chave nova "hookmill-prod") |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | `claude-opus-5-5` / `medium` |
| `WAVESPEED_API_KEY` | conta WaveSpeed da HookMill (chave `dsds`) |
| `WAVESPEED_WEBHOOK_SECRET` | painel da WaveSpeed → Webhooks → secret, **sem** o prefixo `whsec_` |
| `WAVESPEED_WEBHOOKS` | `on` (o reconciliador continua como rede) |
| `HF_API_KEY_ID` / `HF_API_KEY_SECRET` | Higgsfield (rosto Soul V2), as mesmas do dev live |
| `MEDIA_PROMPTS` | `v2` |
| `APIFY_TOKEN` | conta do ad-radar (teto até 19/10) |
| `APIFY_AD_LIBRARY_ACTOR` | `curious_coder~facebook-ads-library-scraper` |
| `AD_LIBRARY_MODE` | `live` (ou `off` se o Gusta não quiser link da Ad Library na estreia) |
| `UPLOAD_MODE` | `proxy`, ou `direct` só se o §3 aprovar o PUT |
| `UPLOAD_MAX_BYTES` | **`48000000`** (48 MB decimais, abaixo dos 50 MB do Free em qualquer unidade) |
| `CHAMPION_MIN_SEC` / `CHAMPION_MAX_SEC` | `5` / **`60`** (ver §8: peça longa estoura 50 MB) |
| `RENDER_CONCURRENCY` / `RENDER_FRAMES_CONCURRENCY` | **`1` / `1`** (VPS compartilhada, 4 GB) |
| `RENDER_TMP_DIR`, `TMPDIR` | `/data/render`, `/data/tmp` (imagem; ficam no volume) |
| `REMOTION_BUNDLE_DIR` | `/app/video/dist/bundle` (imagem) |
| `REMOTION_BROWSER_EXECUTABLE` | `/app/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell` (imagem; o build falha se não existir) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `/usr/bin/ffmpeg` / `/usr/bin/ffprobe` (imagem) |
| `DEFAULT_MONTHLY_SPEND_CAP_USD` | `200` |
| `THROTTLE_DEFAULT_PER_MIN` / `THROTTLE_EXPENSIVE_PER_MIN` | `600` / `20` |
| `MEDICAO_ONNX_THREADS` | `2` (opcional; com CPU limit 1, use `1`) |
| `PUBLIC_MEDIA` | não definir (`on`: a WaveSpeed baixa direto da URL assinada) |
| `SEED_*` | não usar em produção (o seed precisa de `ts-node`, que não está na imagem; o 1º dono entra pelo §7) |

As variáveis marcadas "imagem" já vêm no Dockerfile; só repita no painel se quiser mudar.

### web (Vercel → Settings → Environment Variables, ambiente Production)
| variável | valor / origem |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<domínio do EasyPanel>/api/v1`. Entra no build: trocar = redeploy |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `en` |
| `NEXT_PUBLIC_API_MOCKING` | `disabled` |
| `SESSION_COOKIE_SECRET` | gerar: `openssl rand -base64 48` (≥ 32 caracteres; em produção o web recusa menos) |

**Cookie entre domínios diferentes (`*.vercel.app` × `*.easypanel.host`): não precisa de rewrite.** O refresh token fica no cookie `maq_session` gravado pela rota `/api/session` do próprio Next (domínio da Vercel, `httpOnly`, `Secure` em produção, `SameSite=Lax`). O navegador fala com a API só com `Authorization: Bearer` (nem o SSE usa cookie: é `fetch` com Bearer). A API não lê cookie nenhum, então não há cookie de terceiro pra ser bloqueado. O que precisa estar certo é o CORS: `WEB_ORIGIN` igual à URL de produção da Vercel.

## 6. Vercel (Gusta, ~5 min)
1. Add New → Project → importar o repo da HookMill. **Root Directory `web`**, Framework Next.js, Node **22.x**. Deixe ligado *Include files outside the root directory* (o web importa `@maquina/contratos` e `@maquina/video/player` dos workspaces, e o `prebuild` copia as fontes de `../video/public/fonts`).
2. Install/Build: padrão. A Vercel detecta o `package-lock.json` com workspaces na raiz. **Não provado:** se o install não enxergar os workspaces, troque o *Install Command* por `cd .. && npm ci -w web -w video -w contratos`.
3. Envs da §5 (web), Deploy. Abra `https://<nome>.vercel.app` → tela de login.
4. `next.config.ts` não precisa de nada pra produção: não há `next/image` com host remoto (mídia é `<img>`/`<video>` com URL assinada), nem rewrite (o web chama a API pela URL pública).

## 7. Primeiro dono (com `SIGNUP_ENABLED=false`)
O seed não roda na imagem. Janela curta: EasyPanel → `SIGNUP_ENABLED=true` e `SIGNUP_DEFAULT_SPEND_CAP_USD=200` → redeploy (só restart) → o Gusta se cadastra em `/signup` → volta `SIGNUP_ENABLED=false` e `SIGNUP_DEFAULT_SPEND_CAP_USD=10` → restart. Confira: `POST /api/v1/auth/signup` responde 403.

## 8. Limite de 50 MB do Supabase Free (o que estoura)
Medido no storage local em 13/10 (688 renders, 1.458 clipes de cena, 340 campeões):
| arquivo | tamanho real | estoura 50 MB? |
|---|---|---|
| campeão enviado pelo upload | barrado em `UPLOAD_MAX_BYTES=48000000` com `422 MEDIA_TOO_LARGE` | não |
| campeão vindo do link da Ad Library (`ingestFromUrl`) | **sem teto no código**; maior campeão local: 142 MB | **sim**, se o anúncio for grande: o `put` falha 3x e a análise cai em erro |
| MP4 final (render padrão, ~5,7 Mbps) | 32 s ≈ 27 MB; 85 s ≈ 58 MB | **sim acima de ~70 s** |
| MP4 final do `remix-keep` (crf 12, ~13 Mbps) | 32 s ≈ 49 MB; 51 s ≈ 77 MB; 88 s ≈ 142 MB | **sim acima de ~30 s** |
| clipe de cena / take (lipsync) | máx 46 MB (88 s) | no limite em take longo |
| ZIP do lote (`archiver` em `store`, soma das peças) | 2 peças de 30 s já passam de 50 MB | **sim, quase sempre** |
| áudio, frames, rosto, thumbnail, captura | < 5 MB | não |

**Solução mais simples, em ordem:**
1. **Supabase Pro (US$ 25/mês)**: o limite global vai pra até 500 GB por arquivo, zero código, e o projeto para de pausar com 7 dias sem uso. É a única opção que resolve tudo hoje. Recomendo assinar antes do 1º cliente pagante.
2. Enquanto for Free, sem código: `CHAMPION_MAX_SEC=60` (render padrão fica ≤ ~43 MB) e avisar que **remix-keep acima de ~30 s e o ZIP do lote vão falhar**.
3. Se quiser ficar no Free com tudo funcionando, são 2 mudanças pequenas de código (backend + video, não implementadas aqui): (a) teto de bitrate no encode final (`-maxrate 6M -bufsize 12M` no remix-keep e `videoBitrate` no render padrão: 60 s ≈ 45 MB); (b) o ZIP sai em stream na resposta do download em vez de ser gravado no storage; e um teto de bytes no `ingestFromUrl` com erro claro (`MEDIA_TOO_LARGE`).

**Pausa do Free:** o projeto pausa depois de 7 dias sem atividade. O healthcheck faz `SELECT 1` a cada 30 s; **não confirmei** se isso conta como atividade pro Supabase. Se pausar, `/health` responde 503, o container entra em loop de restart, e o Gusta tem que dar *Restore* no painel.

## 9. Smoke test pós-deploy
Grátis primeiro, pago só com ok do Gusta e custo estimado antes:
1. `curl -s https://<api>/api/v1/health` → `ok: true`.
2. `curl -si https://<api>/api/v1/auth/signup -X POST -H 'Content-Type: application/json' -d '{"name":"Smoke","email":"smoke@exemplo.com","password":"smoke-test-123"}'` → **403** (`SIGNUP_ENABLED=false`; corpo válido de propósito, porque corpo inválido cai antes no 400 da validação).
3. Web: login do Gusta → Home carrega, sem erro de CORS no console do navegador.
4. Upload de um campeão pequeno (< 48 MB, 10-20 s): sobe (proxy ou direct) e o vídeo toca da URL assinada. *(US$ 0 até a análise; a análise chama Whisper + Claude: centavos, pedir ok)*
5. Editor: abrir uma peça e conferir que o Player toca (CORS de leitura do §3 valendo).
6. Render de 1 peça curta (CPU da VPS, US$ 0): acompanhar `docker stats`/métricas do EasyPanel (pico de RAM ≤ 4 GB) e a saúde da API do Lab durante o render.
7. 1 geração paga (lipsync curto) com webhook: confirma `PUBLIC_API_URL` + `WAVESPEED_WEBHOOK_SECRET` (o log mostra o webhook chegando, sem depender do reconciliador). *(custo pela tabela de `docs/integracoes.md`, pedir ok)*

## 10. Rollback
- **API:** EasyPanel → app `api` → Deployments → *Redeploy* do deploy anterior (ou aponte o branch/commit anterior e Deploy). O volume `/data` só tem temporário; nada se perde.
- **Web:** Vercel → Deployments → deploy anterior → *Instant Rollback*.
- **Banco:** as migrações são só pra frente (Prisma não tem "down"). Até hoje todas são aditivas, então código antigo roda em schema novo. **Antes de qualquer deploy com migração nova**, backup do Mac (o Free não tem backup baixável): `pg_dump "<DIRECT_URL>" -Fc -f hookmill-$(date +%F).dump` (pg_dump 17). Migração destrutiva só com o Gusta avisado e o dump feito.
- **Desligar rápido sem rollback:** EasyPanel → Stop no app (o web mostra "API unreachable"); WaveSpeed reenvia/reconcilia depois.

## O que depende do Gusta
- Criar o projeto Supabase (Free), desligar Data API, criar o bucket e a chave S3 (§1). Conferir a localização da VPS no hPanel.
- Criar o app no EasyPanel (§2) e o projeto na Vercel (§6), colar as envs, clicar Deploy.
- Chaves live: Anthropic, WaveSpeed (+ secret do webhook), Higgsfield, Apify.
- Decidir: ficar no Free sabendo do §8 (remix-keep > 30 s e ZIP falham) ou assinar o Pro (US$ 25/mês).
- Ok pros passos pagos do smoke test (§9.4 e §9.7).
