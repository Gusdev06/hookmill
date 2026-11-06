# QA 31/10 e 01/11: templates com créditos, Home v2, shell, Brand, Eddy e landing · 2026-11-01 · maquina-qa
Escopo: working tree do `main` (nada commitado). Gasto zero: web em MSW na 3081 (API apontada pra uma porta morta, 3999), API do QA na 3151 (mock, `maquina_test`, `META_CRON=off`, render fake), jest em `maquina_test`. Nada na 3000/3001, nada no `maquina`, nenhum `migrate dev/reset/db push`. A 3081 e a 3151 foram derrubadas no fim; `web/tsconfig.json` e `web/next-env.d.ts` foram restaurados.

## Resumo (5 linhas)
1. Créditos funcionam na API: quem paga é o OWNER mais antigo, um Gerar duplo em paralelo reserva só 1 vez, os 400/402/403/404/409/422 seguem o contrato, B não vê o lote de A e o admin é idempotente (spec novo, 1/1 em 22 s). Reserva, cobrança e estorno, amostra de 4 usos, pack com teto, INTERNAL e A6 passam no `templates-creditos.int` (8/8).
2. No navegador (1440 e 390): galeria, plano, Gerar (saldo 42 → 41), 409 com custo novo, saldo baixo, pack, amostra (4 → 3), tour (4 paradas), menu e seletor do shell, Brand e Eddy passam. O Gerar no 390 fica fixo embaixo e inteiro na tela.
3. Shell: no 1440 a página não rola e o conteúdo rola em `#app-scroll`; no 390 a página rola. Não há barra de rolagem visível em nenhuma das 11 rotas, nos dois tamanhos.
4. Bugs: o chip de status fica ilegível no grid de /creatives; o MSW não tem `GET /iterate` (Recentes sem lote, 2 `ERR_FAILED`); a leitura local trava a API quando a máquina está carregada (intermitente).
5. Suíte: tsc dos 5 workspaces ok, lint com 0 erros, `next build` ok. Unit 1556/1556. Das 10 suítes de integração que falharam, todas passam depois da correção dos specs desatualizados ou rodando isoladas.

## Veredito por item
| # | item | veredito | prova |
|---|---|---|---|
| 1 | Landing v2 `/welcome` (GSAP) | **passa** (render, rolagem até o fim, sem estouro lateral e sem erro de console nos dois tamanhos). O motion não foi julgado quadro a quadro | `landing-topo/fim/inteira.png`, `landing.json` |
| 2 | Shell de painéis | **passa**: 1440 com `docRola=false` e `#app-scroll` `overflow-y:auto` + `scrollbar-width:none`; 390 com topbar e documento rolando; 0 barras visíveis em 11 rotas × 2 tamanhos. Menu (sheet) no 390, seletor de cliente e menu da conta inteiros na tela; navegar fecha o sheet | `varredura.json`, `c-menu-aberto.png`, `c-switcher.png`, `c-menu-conta.png` |
| 2b | Tour no shell novo | **passa** nos dois tamanhos: 4 de 4 paradas, nenhuma pulada (sem `[tour] target … not found`) e balão inteiro na tela | `c-tour-1..4.png` |
| 3 | Home v2 | **parcial**. O Cérebro 3D, as chamadas, a coluna direita e os Recentes de criativos passam. A Home chama `GET /iterate?limit=5`, mas o MSW não responde, então **o lote nos Recentes não pôde ser visto** (F2). Pela API, `GET /iterate` passa no `lacunas-home-eddy.int` | `v-home.png`, `c-home-recentes.png` |
| 3b | `/creatives` em grid 9:16 | **passa com bug visual**: o grid é 9:16 (2 colunas no 390), mas o chip de status fica ilegível sobre o pôster (F1) | `v-creatives.png` |
| 4 | Brand (aba padrão; `?view=map`) | **passa**: Brand vem selecionada; editar Name salva no lugar ("Saved just now", nome novo na topbar); `?view=map` mostra canvas no 1440 e, no 390, lista + "Open the 3D view" (de propósito) | `c-brand-editando/salvo.png`, `c-brain-mapa.png` |
| 5 | Onboarding com o Eddy (flag on) | **passa no que o mock deixa testar**: cliente novo → /start → conversa (não o wizard); preencher nome + Purchase + "Looks right" manda `PATCH /workspace` `{name}`, `{resultType}`, `{onboardingStep:3}`, `{confirm:"business"}`, sem erro de console nos dois tamanhos. A API do `confirm` (idempotente, 400, 403, `/auth/me`) passa no `lacunas-home-eddy.int` | `d-eddy-oi/negocio/depois-confirmar.png` |
| 6 | Templates com créditos (API) | **passa**. Veja abaixo | `specs/qa-0111-api/creditos-isolamento.spec.ts`, `templates-creditos.int` 8/8 |
| 6b | Templates (web) | **passa**: galeria, passo Ad (pede a oferta com o 422 `OFFER_REQUIRED` do contrato), plano com texto editável, "Generate · 1 credit", saldo 42 → 41 com "Breaking news · reserved" no /credits, 409 → "The cost changed: now…", saldo 0 → Generate desabilitado + "You need 1 more credit", pack ordenado com custo = soma (7) e o total atualiza ao desmarcar, amostra "4 of 4" → "3 of 4" com Estático em "Paid plan", sidebar "Templates" + medidor ("Credits 42", "Team · unlimited", "Free uses left 4") | `t1-*.png`, `t2-*.png`, `t3-pack*.png`, `t4-*.png` |
| 6c | Admin `/templates/admin` | **passa** no 1440 e no 390. No 390 o `scrollWidth` mede 736, mas a página não arrasta (`scrollX` continua 0 depois de `scrollTo(400)`); a tabela rola dentro do card | `v-templates_admin*.png` |
| 7 | Lacunas da API (needsYou/statusLabel, nó `batch`, `lastIteratedAt`, `GET /iterate`) | **passa** (`lacunas-home-eddy.int`, `brain.lotes.spec`) | jest |
| 8 | Kit da marca, "gerar mesmo assim", teto mensal, onboarding sem Metas, leitura Lambda (só o caminho local/mock) | **passa** na API: `brand-kit.int`, `legenda-forcar.int` 6/6, `onboarding-v2.int` 8/8 (corrigido), `leitura-lambda.int`, `render/logo.spec`. Não passei por esses itens no navegador | jest |

**Regras de crédito provadas pela API do QA** (spec novo, 1/1):
- `GET /ad-templates` com 2 fontes, ou `use` com 2 fontes, dá 400. CLIENT dá 403, slug inexistente dá 404 e upload de outro workspace dá 404.
- B recebe 404 no GET, no start e no PATCH de texto do lote de A. A lista de B (`GET /iterate`) não tem o lote, e `ad-templates/runs` e `credits/ledger` de B voltam vazios.
- Texto acima de `maxChars` dá 422 `TEXT_INVALID` com `violations[].path`. Texto válido dá 200. Texto depois do Gerar dá 409.
- Gerar sem `expectedCredits` dá 400. Com quote errado dá 409 `CREDITS_CHANGED {credits:1}`. CLIENT dá 403.
- Gerar duplo em paralelo: um 202 e um 409, 1 `RESERVE` só, saldo do OWNER mais antigo 1 → 0. O OWNER mais novo (100 créditos) não é tocado e fica sem lançamento.
- 2º uso com saldo 0: o `use` passa (leitura e plano não cobram), e o Gerar dá 402 `INSUFFICIENT_CREDITS {need:1, balance:0, pool:'CREDITS'}`.
- Admin: conta não-INTERNAL dá 403. A mesma chave 2× credita 1 vez (saldo 5). A mesma chave em outra conta dá 400. Débito maior que o saldo dá 409.

## Bugs (prioridade)
**F1 [média · maquina-frontend] Chip de status ilegível no grid de /creatives.** `web/src/app/(app)/creatives/page.tsx:177-179` põe o `StatusChip` (`web/src/components/status-chip.tsx:7`, `text-fg` escuro e sem fundo) direto sobre o pôster escuro.
- Repro: abrir `/creatives` (1440 ou 390, MSW). "Generating 2 of 4 scenes", "Rendering 65%" e "Ready for review" aparecem cinza-escuro sobre o vídeo escuro.
- Esperado: chip com fundo (pílula clara ou escura) ou texto claro sobre o pôster.
- Print: `/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/testes/.cache/telas-qa-0111/qa0111-390/v-creatives.png`

**F2 [média · maquina-frontend, mock] O MSW não tem `GET /iterate` (lista de lotes).** `web/src/lib/api/client.ts:330` chama, mas `web/src/mocks/handlers-iterate.ts` só tem `/iterate/config`, `POST /iterate` e `/iterate/:id…`.
- Efeito: na Home em mock, 2 `net::ERR_FAILED http://localhost:3999/api/v1/iterate?limit=5`, e os Recentes não mostram lote. É só no mock: a API real responde (`lacunas-home-eddy.int`). Mas com isso o caminho "lote nos Recentes → /iterate/:id" nunca foi visto no navegador.
- Repro: web com `NEXT_PUBLIC_API_MOCKING=enabled` → `/` → console.

**F3 [média · maquina-video, intermitente] A leitura local do anúncio prende o event loop da API.** Em 3 execuções com a máquina carregada (next dev + Playwright ao lado), o passo `upload → ANALYZING → PLAN_READY` ficou mais de 9-15 min sem resposta. O processo ficava a ~100% de CPU disparando `ffmpeg -hide_banner -nostdin -loglevel error -i …/video.mp4 -an -vf select=…` em série, o banco ficava ocioso (sem lock) e a API não respondia.
- Efeito: o token de 15 min expirava e tudo depois caía em 401 (assim falharam `pecas`, `editor`, `legenda-forcar`, `iteracao-templates`, `iteracao` e `amostra` na 1ª rodada).
- Com a máquina livre o mesmo spec passa em 70 s (18/18). Não achei a causa raiz. Suspeita: a etapa de refino da leitura refatorada em 31/10 (`api/src/medicao/leitura/etapas.ts`).
- Risco em produção: uma leitura lenta trava as outras requisições da mesma API.
- Repro: `cd api && ITERATE_TEMPLATES=off npx jest --runInBand src/iteracao/iteracao.int.spec.ts` com um `next dev` + Playwright rodando ao lado. Pra ver a pilha: `kill -USR1 <pid do jest>` e `Debugger.pause` (o `pausa.mjs` que usei está no scratchpad).

**F4 [baixa · maquina-backend, 1 vez] `META_SYNC` FAILED: `Unique constraint failed on (connection_id, campaign_id)`** em `api/src/meta/sync.service.ts:139` (`metaCampaignSnapshot.createMany`). Aconteceu na suíte completa e fez falhar 2 casos do `meta.int` (selection/summary). Isolado, `meta.int` passou 17/17. Vale olhar a deduplicação da paginação sob concorrência.

**F5 [baixa · maquina-frontend, texto] Pack:** a barra do plano sempre diz "pack price, capped at 10", mesmo com 7 créditos, abaixo do teto (`web/src/components/templates/run-screen.tsx:648`). Na amostra, a galeria mostra "1 CREDIT EACH" no cabeçalho da seção Edit, embora o uso seja grátis.

**Observação (sem bug):** no mock o Eddy de cliente novo abre direto no card do negócio, porque `siteDone` = `offers.length > 0` (`eddy-onboarding.tsx:189`) e o MSW devolve as 3 ofertas do fixture pra todo workspace. Por isso o passo "qual o site?" não aparece no mock.

## Falhas conhecidas: classificação
| falha | classe | o que fiz | agora |
|---|---|---|---|
| `iteracao.int` ×3 (tipos + 0,408 contra 0,4) | spec desatualizado: o `.env` local tem `ITERATE_TEMPLATES=on` | fixei `ITERATE_TEMPLATES=off` no topo do spec (os templates têm spec próprio) | 18/18 |
| `frame.spec:85` | já corrigida por alguém | nada | passa |
| `b2-fluxo.int` / `app.int` (`walking_quiz`) | spec desatualizado | acrescentei `walking_quiz` no checklist (7 etapas) | 4/4 e 7/7 |
| `onboarding-v2.int` e `meta.int` META_MODE=off (passo goals) | spec desatualizado: goals oculto desde 31/10 | goals `enabled:false`, % recalculada (17 → 20, 67 → 60), 4 passos com Meta off, `confirmed: []` | 8/8 e 17/17 |
| **nova** `auth.service.spec:66` | spec desatualizado: `onboarding.confirmed: []` (lacunas §1) | acrescentei `confirmed: []` | passa |
| **nova** `campeoes/legenda-caixa.spec` | spec desatualizado: `AnaliseService.refineCaptionBox` saiu pra `medicao/leitura/etapas.ts › refinar` | o spec chama `refinar` | 2/2 |
| **nova** `amostra.int` ×6 | spec desatualizado: `TEMPLATES=on` dá 402 `sample_templates` no quiz (contrato §5) | fixei `TEMPLATES=off` (a amostra nova está no `templates-creditos.int`) | 7/7 |
| `pecas`, `editor`, `legenda-forcar`, `iteracao-templates` | ambiente (F3, timeout em cascata) | nada | isoladas: 10/10, 4/4, 6/6, 4/4 |

## Não testado
- O caminho "Iterar meu vencedor" do Eddy: o mock da Meta não tem WINNER. O passo do site no Eddy em mock (veja a observação acima).
- Confirmar no Eddy num aparelho e abrir no outro, no navegador: o MSW não guarda `confirmed`. Na API, passa.
- Teto de 10 do pack no navegador: o mock só tem 7 linhas. Na API, passa (`templates-creditos.int`).
- Cobrança, estorno e Retry no navegador depois do LAUNCHED (só na API).
- Cold open / Offer end card no navegador e com plano real (pago).
- Kit da marca, "gerar mesmo assim" e teto mensal pela tela.
- Upload do vídeo de exemplo pelo Admin.
- Leitura na Lambda (só o caminho local, como pedido).

## Mudanças minhas
- `testes/`:
  - `harness/db.ts`: o reset repõe o catálogo `templates`, que o TRUNCATE apagaria;
  - `harness/env.ts`: a API do QA força `ANALYZE_IMPL=local`, zera as credenciais AWS e fixa `TEMPLATES`/`ITERATE_TEMPLATES`;
  - `playwright.config.ts`: projeto `qa0111-api`;
  - `playwright.qa0111.config.ts` (novo);
  - `specs/qa-0111/` (novo: a-varredura, b-templates, c-shell-home, d-eddy, ajuda.ts);
  - `specs/qa-0111-api/creditos-isolamento.spec.ts` (novo).
- `api/` (só specs desatualizados): `auth/auth.service.spec.ts`, `campeoes/legenda-caixa.spec.ts`, `b2-fluxo.int.spec.ts`, `app.int.spec.ts`, `iteracao/iteracao.int.spec.ts`, `amostra/amostra.int.spec.ts`, `onboarding-v2.int.spec.ts`, `meta.int.spec.ts`.
- Nenhum código de produto foi alterado. Sem commit.

## Rodar de novo
- Web (MSW):
  1. `cd web && NEXT_DIST_DIR=.next-qa-3081 NEXT_PUBLIC_API_MOCKING=enabled NEXT_PUBLIC_API_URL=http://localhost:3999/api/v1 NEXT_PUBLIC_ONBOARDING_EDDY=on npx next dev --port 3081`
  2. `cd testes && npx playwright test -c playwright.qa0111.config.ts`
  3. Depois, restaurar `web/tsconfig.json` e `web/next-env.d.ts`.
- API: `cd testes && E2E_API_PORT=3151 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261101000100_templates_cold_open_endcard E2E_LIMITES_V2=1 npx playwright test --project=qa0111-api`
- Prints: `/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/testes/.cache/telas-qa-0111/qa0111-1440/` e `/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/testes/.cache/telas-qa-0111/qa0111-390/`.
