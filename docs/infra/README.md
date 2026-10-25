# AWS do HookMill (L0 feita em 25/10/2026)

Conta `903373620308`, região `us-east-1` (a mesma do Supabase). Nenhuma credencial neste repo.

| recurso | o que é |
|---|---|
| usuário `gusta-cli` | admin, só no `~/.aws` do Mac do Gusta (criado por ele no console). Reduzir depois. |
| política `remotion-lambda-policy` + role `remotion-lambda-role` | o que a função Lambda do Remotion pode fazer (`remotion-role-policy.json`, gerado pelo `@remotion/lambda@4.0.533`) |
| usuário `hookmill-remotion-deploy` | deploy e render, política inline `remotion-user-policy` (`remotion-user-policy.json`); chave em `projects/maquina-anuncios/.env` (`REMOTION_AWS_*`, chmod 600, fora do git). `remotion lambda policies validate`: 32/32 ok |
| orçamento `hookmill-mensal` | US$ 20/mês; e-mail pra coven688@gmail.com em 50 % e 80 % do real e 100 % da previsão |
| freio `516bd084-…` | ao bater 100 % do real, o Budgets aplica `hookmill-freio-orcamento` (Deny *) no `hookmill-remotion-deploy`, via role `hookmill-budgets-freio-role`. Destravar: `aws iam detach-user-policy --user-name hookmill-remotion-deploy --policy-arn arn:aws:iam::903373620308:policy/hookmill-freio-orcamento` (com o `gusta-cli`) |
| anomalia | assinatura `hookmill-alerta-anomalia` no `Default-Services-Monitor`, diário, impacto ≥ US$ 3, pra coven688@gmail.com (a default da AWS vai pro gustavo.gomes@weareg.com.br) |
| cota Lambda | pedido de 10 → 1000 execuções concorrentes (`L-B99A9384`), status PENDING em 25/10 |

| L1 (25/10) | função `remotion-render-4-0-533-mem3008mb-disk4096mb-300sec` (a de 2048 da comparação foi apagada em 25/10), logs com retenção de 7 dias; bucket `remotionlambda-useast1-9dano8maol` com `renders/` expirando em 7 dias (`sites/` fica); sites `hookmill-l1-f557563` (sonda) e `hookmill-dev` (o `REMOTION_SERVE_URL` do `api/.env`; republicar com o bundle atual: `set -a; source <(grep '^REMOTION_AWS_' .env); set +a; SITE=hookmill-dev node scripts/sonda-lambda-l1.mjs deploy`). Custo da sonda: US$ 0,07 |

Falta: MFA no root (Gusta, console); teto de concorrência reservada na função. O `hookmill-remotion-deploy` não lê CloudWatch Logs: a sonda contou os downloads com o `gusta-cli` (só leitura).

## Supabase Storage (25/10/2026, arquiteto)
- **`hookmill` (produção) passou de público pra privado** em 25/10, com ok do Gusta. Antes, conferido: nenhum código usa `/object/public/` (api, web, video, contratos), o web não lê storage direto (`NEXT_PUBLIC_*` só tem a API) e nenhuma das 233 colunas texto/JSON do schema `hookmill` guarda URL pública. Tudo sai por URL assinada S3 (`StorageService.signedUrl`). Prova: GET em `/storage/v1/object/public/hookmill/<obj>` = **400**; URL assinada = **206**. Resíduo: a CDN do Supabase continua servindo por até ~1 h uma URL pública que já estava em cache (só a URL exata).
  - Feito por SQL com a `DIRECT_URL` de produção: `update storage.buckets set public=false where id='hookmill';`
  - **Reverter:** `update storage.buckets set public=true where id='hookmill';` (ou Dashboard → Storage → hookmill → Edit bucket → Public).
- **`hookmill-dev`** (dev, privado, sem limite de tamanho e tipo, como o `hookmill`) criado em 25/10 pela API S3. É o `STORAGE_BUCKET` do `api/.env`, pra o Remotion Lambda alcançar a mídia. A mídia antiga do banco `maquina` (733 arquivos, 2,1 GB no versitygw local) **não foi copiada** (decisão do Gusta 25/10) e aparece quebrada.
- **CORS:** o Supabase não deixa configurar. O `PutBucketCors` do endpoint S3 é tratado como CreateBucket (409 `BucketAlreadyExists`), e não há CORS por bucket na API de Storage. A resposta é fixa: `Access-Control-Allow-Origin: *`, preflight ok, **sem `Access-Control-Expose-Headers`** (`Content-Range` não fica legível pra `fetch`). Isso não bloqueia o editor de hoje: o Player usa `<OffthreadVideo>`, que vira um `<video>` nativo, e o `<video>` faz Range sem precisar de cabeçalho exposto. Só importaria se o web passasse a ler mídia por `fetch` (ex.: `@remotion/media`/mediabunny). Aí a alternativa é um proxy de leitura com Range na API (`estrutura.md` §6, plano B), que fica sem implementar até o ok do Gusta.
