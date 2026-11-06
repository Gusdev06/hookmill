# Plano de deploy até o F1b (produção 19cdef8 → F1b fechado)
Data: 2026-11-06 · Dono: maquina-arquiteto · Status: **plano, nada executado em produção.** Executa na fase D1 de [`troca-texto-queimado-v1.md` §16.6](troca-texto-queimado-v1.md), depois do Q1, com o Gusta.
Runbook de base: [`docs/deploy.md`](../deploy.md). Este arquivo só diz o que muda desde o que está no ar.

## 0. Ponto de partida (conferido 06/11)
- **No ar: `19cdef8` (31/10 19:13 +08).** `meta/templates` responde; `brand-kit` e `credits` dão 404. A branch `deploy-2026-11-06` (`f7de60c`) **nunca subiu**.
- O salto é grande: 14 migrações, `video/src` com 39 arquivos mudados, leitura na Lambda virando padrão, modo teste, Ad Radar, editor universal, F1a e F1b. **Vai tudo junto**; não há deploy parcial que faça sentido, porque o código de 06/11 lê tabelas de 31/10 em diante.
- **Banco de produção: Supabase Pro, schema `hookmill`** (projeto compartilhado com o Social Hub), conforme `docs/deploy.md`. O pedido falava em Neon; o runbook vigente diz Supabase. **Gusta confirma qual é antes do D1.**
- **Migração automática no boot:** `scripts/api-start.sh` roda `prisma migrate deploy` ao subir a imagem. Ou seja, **subir a API = migrar o banco**. O backup tem que vir antes do clique em Deploy, não depois (§16.9 item 2).

## 1. Migrações que vão entrar (ordem do Prisma)
| migração | tipo | atenção |
|---|---|---|
| `20261031000100_kit_marca` | tabela + dados | aditiva |
| `20261031000200_templates_creditos` | tabelas + dados (catálogo) | aditiva |
| `20261031000300_onboarding_confirmed` | coluna com default | aditiva |
| `20261101000100_templates_cold_open_endcard` | `UPDATE templates` | muda linhas do catálogo |
| `20261104000100_templates_selection` | `INSERT` linha de sistema `selection` (HIDDEN) | aditiva |
| `20261104000200_meta_publication_template_snapshot` | coluna | aditiva |
| `20261104180000_templates_ai_background` | `ADD VALUE AI_VIDEO` + `INSERT` | aditiva |
| `20261105000100_meta_offer_match` | tabela | aditiva |
| `20261105000200_tour_v2` | tabela/colunas | aditiva |
| `20261106000100_list_overlay_enum` | `ADD VALUE LIST_OVERLAY` | aditiva |
| `20261106000200_templates_lista` | `INSERT` templates | aditiva |
| `20261107000100_ads_research` | tabelas do Ad Radar | aditiva |
| `20261110000100_editor_universal` | `FileKind PROXY`, colunas, FKs | aditiva |
| `20261110000200_champion_plates` | tabela + enums do F1b | aditiva; nada lê até `PLATE_IMPL` ligar |
Nenhum `DROP`. Código antigo (19cdef8) roda no schema novo, então o rollback da API não exige rollback do banco.

## 2. Ordem (D1), com quem faz
1. **Antes de tudo, local:** `npm run typecheck && npm test` na raiz; `npm run db:diff` vazio; suíte da QA do F1b verde (Q1).
2. **Leitura `_prisma_migrations` de produção, só leitura** (eu, com a `DIRECT_URL` que o Gusta passar): confirmar que a última aplicada é `20261029000200_amostra_e_meta_templates` e que nada de 31/10 em diante entrou por fora. Se divergir, para e reporta.
3. **Backup do banco de produção** (eu, do Mac/VPS): `pg_dump "<DIRECT_URL>" -n hookmill -Fc -f hookmill-$(date +%F-%H%M).dump` com pg_dump 17, e conferir o tamanho e `pg_restore -l`. Sem dump conferido, não há passo 7.
4. **Função `hookmill-leitura`** (eu, perfil admin, AWS): `api/src/medicao/leitura/` mudou desde 19cdef8 (+1102 linhas). `node scripts/leitura-lambda.mjs deploy` **antes** da API. Conferir a permissão de invocação para o usuário do render (`REMOTION_AWS_*`).
5. **Função `hookmill-legenda`** (G1 já deixa no ar): conferir a versão publicada = a do commit do F1b.
6. **Bundle Remotion + site novo na Lambda** (eu): `npm run build:bundle -w video` e `deploySiteFromBundle` (hoje só em `scripts/sonda-lambda-l1.mjs`; `npm run lambda:deploy` **não existe**, §15.10). Site novo `hookmill-<sha>`; anotar a URL. A imagem da API também empacota o bundle no build, então o render `local` sai certo sozinho.
7. **Envs da API no EasyPanel** (Gusta cola, eu passo a lista, seção 3). **Antes** do Deploy.
8. **Deploy da API** (Gusta clica). O boot aplica as 14 migrações. Acompanhar o log: lista das migrações aplicadas e `API em …`. `GET /health` → `ok`.
9. **Catálogo:** pack `let-hookmill-pick` → **HIDDEN** pelo admin (`PATCH /admin/templates/let-hookmill-pick` `{ "status": "HIDDEN" }`), com conta de equipe. Decisão de 04/11; **nenhuma migração faz isso** (no banco local o pack está LIVE de novo depois do seed). Conferir `GET /ad-templates` sem o pack.
10. **Deploy do web** (Vercel). `prebuild` copia as fontes novas (§15.10). `web/.env.example` só ganhou 2 comentários desde 19cdef8 (`NEXT_PUBLIC_ONBOARDING_EDDY`, `NEXT_PUBLIC_TEMPLATES`): os padrões valem.
11. **Smoke** (`docs/deploy.md` §9) + o que mudou: `brand-kit` e `credits` 200; conta comum **não** vê "Admin · Templates"; 1 leitura de anúncio curto pela Lambda (centavos, com ok); 1 publicação na Meta em ABO **só com ok do Gusta** para provar o `is_adset_budget_sharing_enabled`.
12. **`PLATE_IMPL` ligado só no workspace interno** (`PLATE_WORKSPACE_IDS=<id>`), lote real do Q1 repetido em produção só se o Gusta pedir.

## 3. Envs da API que mudam
| env | produção | por quê |
|---|---|---|
| `TEST_MODE` | **`off` ou ausente** | Ligado, toda conta vira INTERNAL e o admin libera para qualquer OWNER: qualquer cliente se daria crédito (`docs/backlog.md`, checklist do lançamento) |
| `ANALYZE_IMPL` | `lambda` | **Padrão do código desde 02/11.** Sem as envs abaixo, a leitura de anúncio quebra. Rollback rápido: `local` |
| `ANALYZE_LAMBDA_FUNCTION` / `ANALYZE_LAMBDA_REGION` / `ANALYZE_LAMBDA_TIMEOUT_SEC` / `ANALYZE_LAMBDA_FALLBACK` | `hookmill-leitura` / vazio / `620` / **`off`** | **Decidido pelo Gusta (06/11): a leitura é sempre na Lambda, nunca refeita na VPS.** Corrigir `docs/deploy.md`, que dizia `on`. Rollback de emergência para `ANALYZE_IMPL=local` só com novo ok dele |
| `REMOTION_AWS_*` | já existem se o render Lambda estiver ligado; senão, criar | a leitura usa a mesma chave |
| `REMOTION_SERVE_URL` | URL do site do passo 6 | só vale com `RENDER_IMPL=lambda`; o site antigo não tem o código novo |
| `PLATE_IMPL` / `PLATE_LAMBDA_FUNCTION` / `PLATE_LAMBDA_REGION` / `PLATE_MAX_CHUNKS` / `LEGENDA_MAX_SEC` | `lambda` / `hookmill-legenda` / vazio / `40` / `60` | §15.8 |
| `PLATE_WORKSPACE_IDS` | id do workspace interno | §16.5; **vazio = todos**, então nunca deixar vazio com `PLATE_IMPL` ligado no 1º deploy |
| `ANTHROPIC_HEADLINE_FIT_MODEL` | `claude-haiku-4-5` | §16.3 |
| `TEMPLATES` | **`on`** (confirmado pelo Gusta, 06/11) | o web novo abre em Templates por padrão (`web/.env.example`: `NEXT_PUBLIC_TEMPLATES`); a API sem `TEMPLATES=on` quebra a porta de entrada |
| `SAMPLE_TEMPLATE_USES`, `CREDITS_CONTACT_EMAIL`, `AI_TEMPLATES_ENABLED`, `EDITOR_EXPORTS_PER_DAY`, `META_CALLBACK_BASE_URL` | conferir um a um | entraram depois de 19cdef8 (`git diff 19cdef8 -- api/.env.example`) |
| `AD_LIBRARY_MODE`, `ADS_RESEARCH_*` | `ADS_RESEARCH_MODE=off` até o Gusta ligar o Ad Radar | vazio segue `INTEGRACOES_MODE`, que em produção é `live`: ligaria Apify sem decisão |

## 4. Correção que vai junto e precisa de prova
- **`is_adset_budget_sharing_enabled: false`** na campanha ABO (`api/src/integracoes/meta/publicacao.ts:100`, erro real da Graph em 04/11). Em 19cdef8, publicar sem orçamento na campanha falha na Meta. Coberto por `live.spec.ts` e `templates-v2.spec.ts`; **sem prova contra a Graph de produção**. Prova = 1 publicação PAUSED com ok do Gusta (passo 11).
- **B0** (`lut=c0=0` em `comporSobreOCampeao`, §16.7) vai neste deploy, provado na ffmpeg 5.1 da imagem.

## 5. Riscos
1. **Subir a API migra o banco sozinho.** Sem o dump do passo 3, um problema nas 14 migrações não tem volta (Prisma não tem `down`). É o §16.9 item 2 no tamanho real: não é só `champion_plates`, são todas desde 31/10, inclusive `UPDATE` no catálogo.
2. **Leitura vira Lambda por padrão.** A API nova sem `ANALYZE_*` e sem a função atualizada quebra a análise de todo campeão novo, que é a porta de entrada do produto. Mitigação: passo 4 antes do 8; rollback por env (`ANALYZE_IMPL=local`) sem redeploy.
3. **`TEST_MODE` ou `PLATE_WORKSPACE_IDS` errados abrem coisa para cliente:** créditos de graça e admin para qualquer dono, ou a headline do F1b para todos. Conferência no smoke com conta comum.
4. Pack não fica HIDDEN sozinho; publicar sem o passo 9 mostra o pack com teto de 10 que o Gusta escondeu.
5. Meta ABO sem prova contra a Graph real.
6. Banco Neon × Supabase: o pedido e o runbook divergem. Confirmar antes do passo 2.

## 6. Rollback
API: redeploy de `19cdef8` (o schema novo é aditivo, ele roda). Web: Instant Rollback. Banco: só o dump. Leitura: `ANALYZE_IMPL=local`. F1b: `PLATE_IMPL=off` volta ao comportamento do F1a sem redeploy.
