# Plano de construção v1 (por agente)
Data: 2026-10-05 · Dono: maquina-arquiteto · Status: **G0 aprovado 05/10; A1 feito 05/10** (código liberado a partir do G1)
## Mudanças 06/10 noite (manter a edição + take contínuo; detalhe em [`feature-2-variar-campeao.md` §13](feature-2-variar-campeao.md))
- Tarefas novas A4 (feito), V4a, V4b, I5, B5, F5, Q7 (F2-G2b, 09/10), Q8 (F2-G4b, 10/10, ≈ US$ 1,40 com ok do Gusta). Tabela, paralelismo e o que corta em §13.8.
> ⚠️ API dev da porta 3001 em MODO LIVE (Gusta testando com dinheiro): nenhum agente usa a 3001. Testes = API própria em mock; web = MSW ou API própria em outra porta.

## Mudanças 05/10 (fechamento da onda 1)
- Tipos da API num pacote só tipos, `@maquina/contratos` (pasta `contratos/`, arquiteto). Sem `api:types`/OpenAPI. Pendências da onda 2: **F2/F3** trocam `web/src/lib/api/types.ts` por reexport do pacote; **B2** faz os DTOs `implements` os corpos do pacote e troca `INVALID_STATE`+`LAST_OWNER` pelo código `LAST_OWNER`; **I2/I3** acrescentam `voiceId`/`faceDescription` no `estimate`.

Meta: **um criativo do zero, de ponta a ponta, aprovado** (oferta → roteiros → rosto → motor → geração → edição → OK final → Biblioteca), primeiro com integrações mockadas, depois uma vez de verdade com o ok do Gusta pro gasto.

## Portões
| portão | o quê | quem libera |
|---|---|---|
| **G0** | contratos aprovados (`docs/contratos/*` + schema) + decisões de storage e modelo do Claude | Gusta |
| **G1** | esqueleto da raiz no ar (workspaces npm, infra local, `git init` do monorepo) | **feito 05/10** |
| **G2** | fluxo inteiro passando em mock no navegador (1440 e 390 px) | qa declara |
| **G3** | sondas pagas baratas (centavos) de cada modelo | ia faz; Gusta é avisado do valor |
| **G4** | 1 criativo real ponta a ponta (estimativa mostrada antes, ~US$ 3-8 pra 25-30 s, a confirmar na sonda) | Gusta autoriza o gasto e aprova o vídeo |

## Tarefas
Posse de pasta segue o `TIME.md`. Ninguém espera ninguém sem motivo: quem depende de outro trabalha contra a **interface do contrato** + mock até a entrega real chegar.

| id | agente | tarefa | depende de | entrega verificada por |
|---|---|---|---|---|
| A1 | arquiteto | raiz: `package.json` (workspaces), `scripts/infra.mjs` (Postgres 17 na 5433 + S3 local na 9000, sem Docker), `scripts/guard-db.mjs`, `.nvmrc`, `.gitignore` do monorepo, `git init` | G0, G1 | **feito 05/10**: `npm install` e `infra:up` rodando, schema aplicado num banco descartável (16 tabelas) |
| **B1** | backend | esqueleto Nest em `api/`: `common/` (envelope, filtro de erro com os códigos do contrato, `ValidationPipe`, guard JWT + workspace, throttle), Prisma migrate inicial do schema (script `prisma:migrate` e `seed` no `api/package.json`, chamados pela raiz), `auth` (login, refresh rotativo, me, convites), `workspaces`, seed, `saude`, `arquivos` (StorageService S3 contra o versitygw local, URL pré-assinada testada, com `ingestFromUrl` validando arquivo inteiro), `jobs`, `eventos` (SSE + heartbeat) | A1 | `tsc`, `nest build`, Jest de auth/guard |
| **I1** | ia | `api/src/integracoes/contrato.ts` (copiado de `estrutura.md` §2.1) + **modo mock** completo (fakes determinísticos, eventos `provider.task.finished` em 2-5 s, custo zero) + `CatalogService` (motores, vozes, `splitScenes`, `estimate` com preços por unidade documentados em `docs/integracoes.md`) | A1 | Jest dos fakes e do `estimate` |
| **V1** | video | pacote `video/`: 3 templates (`clean`, `bold`, `headline`), legenda palavra a palavra, gancho nos 3 s, emenda de cenas, CTA/end card, 3 formatos; mídia de teste local (nada pago) | A1 | render de amostra no Remotion Studio + folha de frames |
| **F1** | frontend | Next 16 em `web/`: tokens da spec, shadcn, shell (header, abas, breadcrumb), next-intl EN/PT, cliente HTTP tipado com `@maquina/contratos`, sessão (cookie httpOnly), Login, Home, Offers, Library, Settings com dados de mock (MSW) | A1 | `tsc`, `next build`, 1440/390 |
| Q1 | qa | `testes/`: Playwright + harness de contrato (cliente da API, banco `maquina_test`, reset por teste), casos escritos a partir de `api.md` (falham até B2) | A1 | harness rodando |
| **B2** | backend | domínio: `ofertas` (+ job de extração), `criativos` com **CreativeStateMachine** (todas as transições de `modelo-de-dados.md`, compare-and-set, teste unitário por transição), `roteiros`, `rostos`, `geracao` (orquestrador que ouve `provider.task.finished`, encadeia SCENE/TTS/LIPSYNC/TRANSCRIBE, baixa e valida pro storage), `edicao` (fila de render no banco, chama `RenderService`), revisão/aprovação/changes, `biblioteca`, `custos`/spend cap, recuperação no boot | B1, I1 (contrato + mock), V2 (contrato) | Jest + Swagger batendo com `api.md` |
| **I2** | ia | Claude real: `extractOffer` (fetch da página, 403 → `PAGE_FORBIDDEN`), `generateScripts` (saída estruturada, streaming, paralelo, parcial, vencedores), `suggestFaceDescription`; prompts agnósticos; `cost_entries` | I1 | Jest com mock do SDK + **1 sonda real de centavos** (G3) |
| **I3** | ia | WaveSpeed real: `submitFace/SceneVideo/Tts/Lipsync/Transcribe`, webhook assinado (`POST /webhooks/wavespeed`), reconciliador, erros normalizados, `cost_entries`; armadilhas do Pruna e do download truncado | I1 | Jest + **sondas de centavos** por modelo (G3), assinatura confirmada |
| **V2** | video | `api/src/render/`: `contrato.ts` (de `estrutura.md` §2.2) primeiro, depois `RenderService` com `@remotion/renderer`, fila com concorrência 1, progresso, `RenderError` com frame; mede tempo e memória do render de 30 s em `docs/render.md` | V1 (contrato sai no dia 1, sem esperar V1) | render real com fixture, memória medida |
| **F2** | frontend | wizard das 7 etapas com todos os estados da spec (escrevendo/parcial, gerando/erro de segurança, custo, cenas com falha, render com erro, Request changes), SSE + polling, mobile completo | F1 | `tsc`, `next build`, 1440/390 em mock |
| F3 | frontend | trocar MSW pela API real (B2) | F2, B2 | fluxo manual em mock da API |
| Q2 | qa | contrato endpoint a endpoint, **isolamento entre workspaces**, máquina de estados (transições inválidas = 409, falha vira "esperando você") | B2 | relatório com comando + saída |
| Q3 | qa | fluxo inteiro no navegador com `INTEGRACOES_MODE=mock`, 1440 e 390 px → **G2** | F3, B2, I1, V2 | screenshots lidos + saída do Playwright |
| A2 | arquiteto | revisão de cada entrega contra o contrato (divergência volta pro dono com o ponto exato); `api/Dockerfile` com Chrome + ffmpeg; deploy Supabase (Postgres + Storage) + EasyPanel + Vercel **quando o Gusta pedir** (criar o projeto Supabase é com ele) | cada entrega; G2 pro deploy | deploy respondendo `/health` |
| Q4 | qa + Gusta | **1 criativo real** em staging/produção: estimativa mostrada, Gusta autoriza, roda, qa confere vídeo (folha de frames, áudio, legenda), Gusta aprova → **G4 = critério de pronto** | G2, G3, A2 | vídeo aprovado na Biblioteca |

## O que roda em paralelo
```
G0 ─► A1 ─┬─► B1 ───────────────┐
          ├─► I1 ─┬─► I2        ├─► B2 ─► F3 ─► Q2, Q3 (G2) ─► A2 deploy ─► Q4 (G4)
          │       └─► I3        │
          ├─► V1 ─► V2 (contrato no dia 1) ┘
          ├─► F1 ─► F2 ────────────────► F3
          └─► Q1 ──────────────────────────► Q2
```
- **Onda 1 (logo após A1, 5 em paralelo):** B1, I1, V1 + contrato do V2, F1, Q1.
- **Onda 2:** B2, I2, I3, V2, F2 (todos em paralelo; B2 usa o mock do I1 e o contrato do V2).
- **Onda 3:** F3 → Q2/Q3 (G2) → deploy → Q4 real (G4).

## Pontos de atrito já resolvidos (pra não virar conflito)
- `api/package.json` e `app.module.ts` são do backend: ia e video pedem dependência/import ao backend (ou ao arquiteto).
- Tabelas `provider_tasks` e `cost_entries`: só a ia escreve. Todo o resto: só o backend.
- Storage: só o backend toca (ia e render recebem/devolvem URL ou caminho local).
- Texto humano de erro: backend + web (i18n por `errorCode`), nunca a mensagem crua do provedor.
- Mudança de contrato: só o arquiteto, avisando os afetados.

## Dinheiro
Testes automatizados = mock, sempre. Sondas G3 = centavos, avisadas. G4 = estimativa na tela de Engine antes, ok do Gusta.

## Feature 2: variar campeão (aprovada 06/10)
Contrato, plano, portões (F2-G0..G4), tarefas (A3, V3, I4a/b, B4a/b, F4a/b/c, Q5, Q6, D2) e paralelismo em [`feature-2-variar-campeao.md`](feature-2-variar-campeao.md) §9; briefs por agente na §12 dele. **A3 feito 06/10** (schema + migração local + `@maquina/contratos` + este conjunto de contratos). Até 10/10: upload, análise, Trocar avatar e Novos ganchos; Copy nova e Remontar depois.
