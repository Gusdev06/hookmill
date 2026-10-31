# Loop 29/10 — feedback do Tordan + decisão das variações grátis

Fontes: `feedback/tordan-loom-2026-10-29.md`, `reports/superscale-reverse-engineer-2026-10-29.md`, decisão de 29/10 em `decisions/log.md` (AIS-OS).
Regras: nada de commit, push, deploy ou geração paga sem o Gusta. Testes só do recorte; a suíte completa fica com o QA.

| # | Item | Estado |
|---|---|---|
| 1 | Bug: sair da tela "cancela" o processo | **feito (local)**: a análise nunca parou no API, só faltava o caminho de volta. `GET /iterate/config` ganhou `running`, `/iterate/new` mostra "Still working" e o anúncio do Meta com lote rodando vira "Open" (não paga a análise duas vezes). tsc do api e do web ok; teste novo em `iteracao.int.spec.ts` passa. |
| 2 | Bug: 2 versões com erro na geração | **diagnóstico pelo código, sem confirmar em produção**: a fala dele ("algum elemento estava cobrindo alguma coisa") bate com `CAPTION_COVERED`, a checagem por visão depois do render que reprova a peça quando um painel ou adesivo tapa a legenda original. O commit `1a4edff` (28/10, já no ar pelo EasyPanel, segundo o STATUS) passou a buscar área livre e a tirar o template **antes** de gerar quando não há espaço seguro. Se o lote do Tordan foi antes desse deploy, já está resolvido. Se foi depois, preciso ler o `renders.error_code` desse lote em produção, e a consulta só de leitura foi bloqueada: precisa de ok do Gusta. |
| 3 | CPA alvo (faixa) no onboarding → brain | **feito (local)**: `workspaces.target_cpa_min/max/currency` (migração `20261029000100_target_cpa`, aplicada no `maquina` com backup e no `maquina_test`); `Workspace.targetCpa` no contrato; PATCH valida min ≤ max, > 0 e moeda ISO; tela do negócio ganhou "Target cost per result (optional)" (de/até + moeda); nó Goal do Brain mostra a faixa; o prompt do plano AUTO recebe "Target cost per result". Testes: fase2-agencia 12/12, brain + auto-plano 34/34; tsc api/web ok; `db:diff` vazio. |
| 4 | Variações grátis de template + prévia com blur + pagar pra liberar | **proposta pronta, esperando o ok do Gusta**: contrato `docs/contratos/amostra-gratis-v1.md` e mockup `design/mockup-amostra-gratis.html` (https://claude.ai/artifact/2y9Qoe5bdMjN44sbnV9DsY). Pendentes P1–P4: conta ou workspace, provedor/preço, 3 s nítidos ou tudo borrado, agência. Sem código até o ok. |
| 5 | Template de publicação no Meta (campanha/ad set) + importar de campanha existente | **proposta pronta, esperando o ok do Gusta**: contrato `docs/contratos/meta-templates-v1.md` (CBO 4–8 por ad set, reusar campanha de teste, importar com lista do que não foi copiado, `publish-batch`) e mockup `design/mockup-meta-templates.html` (https://claude.ai/artifact/4pxW4aqTFn74FJPyB9vuiC). Pendentes P1–P3. |
| 6 | Skill de CBO com 4–8 anúncios/ad set | aguardando o Tordan mandar |

Notas:
- **Não vi as telas no navegador**: a extensão do Chrome desconectou. Falta ver `/iterate/new` (cartão "Still working") e a tela do negócio (faixa de CPA).
- A API local (porta 3001) roda do `dist`, um build antigo. Pra testar de ponta a ponta é preciso rodar `npm run build -w api` e reiniciar. O web manda `targetCpa` só quando o valor muda, então não quebra com a API antiga.
- O upload de arquivo ainda depende da aba aberta: sair durante o upload interrompe o envio. Isso vale pro upload, não pra análise.
- 3 falhas pré-existentes em `iteracao.int.spec.ts` vêm do `ITERATE_TEMPLATES=on` no `.env` local (tipos e custo esperados sem os templates). Não foram causadas por este loop.

## Construção (Gusta: "GOSTEI… construa todas as telas novas e ajustes", 29/10)
Decisões tomadas pelas recomendações: amostra P1 = conta, P2 = sem gateway (admin libera), P3 = 0–3 s nítidos, P4 = só OWN; templates P1 = REUSE_CAMPAIGN, P2 = orçamento obrigatório, P3 = publish-batch na v1.

| recorte | quem | estado |
|---|---|---|
| R0 schema + tipos + 402 | loop | **feito**: migração `20261029000200_amostra_e_meta_templates` (maquina com backup + maquina_test), `contratos/src/amostra.ts`, `contratos/src/meta-templates.ts`, `PAYMENT_REQUIRED` 402; db:diff vazio; tsc contratos/api/web ok |
| R1 backend amostra | maquina-backend | **feito**: módulo `api/src/amostra/` (acesso efetivo puro, guard 402, admin libera); `/auth/me` com `access`/`sampleUsed`; lote `sample` só grátis ≤ 4 (com CHAT_DM/PERSON_MOTION mesmo com a flag off), lança sozinho, fora do teto (teto próprio US$ 1); 402 `sample_used`/`locked` em zip, formatos, retry, novo lote, editor, Meta, download e arquivo final; vista travada com `preview`; antiabuso por `adAccountId`. `amostra` 11/11 + tsc (conferido no loop). 18 int specs antigos ganharam `access: INTERNAL` no create do usuário, ainda **não rodados** (QA). Fora: `SAMPLE_DAILY_MAX`, URLs em SSE e `GET /creatives`. |
| R2 prévia borrada | maquina-video | **feito**: `api/src/render/previa.ts` (ffmpeg 480p, 0–3 s nítido, boxblur com corte seco, selo, AAC/H.264 faststart), chamada em `completeAuto` (`edicao.service.ts`) só pra lote `sample`; falha não derruba a peça. `previa.spec.ts` 3/3 (conferido no loop) |
| R3 backend templates Meta | maquina-backend | **feito**: CRUD + padrão, import (não salva, `unsupported`), publish com `templateId`, `publish-batch` (groupKey, 1 campanha REUSE, ad set por grupo, CBO/ABO, PAUSED, retry sem duplicar). `meta-templates.int.spec.ts` 7/7 (conferido no loop) + meta 133/133. Live Graph do import e da estrutura **nunca rodou contra a Meta de verdade**. Fora: `overrides`, template no Brain, variáveis no UTM, atualizar orçamento de campanha REUSE existente. |
| R4 web amostra (download travado + painel Unlock) + callout CPA na janela do template | maquina-frontend | **feito**: `iterate/sample.tsx` (prévia + cadeado depois de 3 s, painel Unlock → "Talk to us" com e-mail e id da conta copiáveis), análise/geração "Free sample", `/iterate/new` com amostra usada, card admin "Unlock an account" em Settings (INTERNAL OWNER), callout de CPA na janela do template; MSW `?mockaccess=`. tsc ok (conferido no loop), lint ok. ⚠️ e-mail provisório `hello@hookmill.app` em `sample.contact.email` (não existe, trocar). |
| R5 web templates (Settings › Meta + janela + Send com template/lote) | maquina-frontend | **feito**: `/settings/connections/templates` (lista, janela com trilho/abas, import com "Not copied", Archive), seletor de template na Send, "Send to Meta (N)" de lote no Download do Iterate; i18n EN/PT; MSW. tsc ok (conferido no loop), lint 0 erros, conferido pelo agente em 1440/390 com MSW. Fora: mínimo de orçamento antes do 422. |
| R6 QA (suíte api + e2e com API de teste real + 1440/390) | maquina-qa | **feito** → `testes/qa-amostra-templates-2026-10-29.md`. Funciona: amostra (blur medido no vídeo real: 6,1 → 29,8), templates (CBO/REUSE, lote 10 → 8+2), Still working, CPA; tsc/lint/db:diff ok. Regressão corrigida pelo QA: `custos.monthSpent` zerava o gasto do mês (revisada no loop: total − amostra, ok). **F1 do QA** (publish-batch publicava peças travadas) corrigido no loop em `publicacao.service.ts` + teste; amostra/templates/custos 24/24. Não testado no navegador: seletor de template na Send e "Send to Meta (N)". Falhas antigas: `frame.spec:85` (1a4edff), 3 do `iteracao.int` (`ITERATE_TEMPLATES=on`), `b2-fluxo.int`/`app.int` (`walking_quiz`, já no HEAD). |

### Antes de publicar (Gusta)
1. Trocar o e-mail provisório `hello@hookmill.app` (`sample.contact.email` nos `messages/*.json`).
2. Commit em branch + deploy: migrações `20261029000100_target_cpa` e `20261029000200_amostra_e_meta_templates` em produção com backup (a 2ª marca todo usuário existente como INTERNAL); API (EasyPanel), web (Vercel). Hoje a API local da 3001 roda um build antigo.
3. O import de campanha e a estrutura CBO/ABO/posicionamentos **nunca rodaram contra a Graph real**: primeira publicação live com o Tordan, conta de teste, tudo PAUSED.
4. Ficou de fora: teto diário de amostras, template no Brain, variáveis no UTM, atualizar orçamento de campanha REUSE existente, mínimo de orçamento antes do 422.

### Teste ao vivo do Gusta (29/10, à tarde)
- API rebuildada e reiniciada na 3001 (live). Log em `.infra/logs/api-2026-10-29.log`.
- **Achado 1:** `SPEND_CAP_EXCEEDED` (cap 1, estimativa 1,021) ao criar a amostra. O teto de US$ 1 barrava a análise. **Corrigido:** o teto vale só pra geração das peças (`iteracao.service.ts`); amostra 11/11; API reiniciada.
- **Achado 2:** borda amarela nas molduras (zoom-out da legenda protegida). Gusta: "aceito cortar um pouco" → maquina-video ajustando pra cover com foco móvel (rodando).
- **Pedido:** "gerar mesmo assim" pros formatos bloqueados por legenda → maquina-backend (rodando), tela em seguida.

### Review UX/UI + QA de layout (29/10, noite)
- Review `design/review-ux-ui-2026-10-29.md` aprovado pelo Gusta ("aprovo"): F1–F10 + L1–L6 aplicados pelo maquina-frontend.
- QA de layout `testes/qa-layout-2026-10-29.md`: 34 rotas, 566 prints, 22 bugs (3 altos). Reteste: 18/22 ok, sem regressão do `--hdr-h` = 56 px no celular.
- 3ª rodada: CLS < 0,1 na Home, Campaigns e Connections (390/768/1440); alvos de toque; Library 1440; filtros do Campaigns no celular em painel.
- Pendente: rótulos Problem/Product/Proof em inglês na UI PT (vêm da API); "Still working" e quiz sem cobertura no mock; nada commitado.
