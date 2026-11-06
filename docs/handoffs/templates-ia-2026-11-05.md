# Handoff para Claude — Templates com IA

Registrado em 05/11/2026 a pedido do Gusta: “salva tudo isso para o claude saber de onde continuar”. Codex encerra a participação; este registro não inicia nova geração, deploy ou desenvolvimento. Implementação e evidências abaixo são da sessão de 04/11, sem reexecutar testes neste encerramento.

## Decisão de produto que prevalece

O Gusta rejeitou a tela que entregava apenas um plano. O fluxo aprovado e implementado é **Templates → Com IA / With AI → escolher formato → selecionar campeão → Gerar vídeo**. Planejamento semântico, roteiro, elenco, vozes, lipsync, legendas e montagem acontecem em background. O usuário recebe vídeo reproduzível, download MP4 e acesso à biblioteca. Não reintroduzir confirmação de plano ou uma jornada separada de planejamento.

O objetivo mais amplo continua sendo variar criativos por formato, público, ângulo, dores, hook etc., inclusive transformar talking head em podcast. Esta entrega conecta a **troca de formato**, preservando público, argumento, oferta e condições do campeão; não representa implementação de todas as combinações pesquisadas.

## O que foi conectado

- FAQ apresentado (`ai-faq`, F04), podcast solo (`podcast-solo`, F09) e conversa de podcast (`podcast-conversation`, F10). Um MP4 9:16 por pedido; F10 usa duas identidades e vozes persistentes, alternando os turnos.
- `/ai-variations` redireciona para `/templates?tab=ai`; link separado removido do menu. Planejador/API antigos permanecem para reutilização interna, sem a tela no caminho do usuário.
- Planejador interno gera propostas do formato solicitado e seleciona uma sem exigências pendentes de prova, assets ou elegibilidade. Produção usa os adaptadores existentes de Higgsfield e WaveSpeed, transcrição e Remotion.
- Reserva de créditos junto da criação do lote em transação, chave idempotente e conflito de payload. Falha estorna; retry explícito reserva novamente. Controle de concorrência evita duplicar chamadas; resultado de chamada paga desconhecido não é repetido automaticamente.
- Progresso persistido e retomado após reload; resultado próprio com player, “Baixar MP4”, “Abrir biblioteca” e “Gerar outro vídeo”.
- Novos formatos em **DRAFT, sem preço presumido**, disponíveis para equipe/INTERNAL. Clientes pagantes dependem de preço definido e publicação no admin; cards sem motor continuam indisponíveis.

## Onde mexer

| Responsabilidade | Entrada |
|---|---|
| Contrato vigente | `docs/contratos/templates-ia-background-v1.md` |
| Motor e etapas persistidas | `api/src/templates-ai/templates-ai.service.ts`, `contract.ts`, `templates-ai.module.ts` |
| Testes novos | `api/src/templates-ai/contract.spec.ts`, `templates-ai.int.spec.ts` |
| Catálogo e autorização | `api/src/templates/`, `api/src/iteracao/iteracao.service.ts`, DTOs e views de Iteração |
| Contratos compartilhados | `contratos/src/templates.ts`, `iteracao.ts`, `variacao-ia.ts` |
| Galeria, campeão e entrega | `web/src/components/templates/{gallery,ad-step,parts,run-screen}.tsx` |
| Produção de vozes/rostos/cenas | `api/src/geracao/{geracao,orquestrador}.service.ts` |
| Render, entrega, falhas e retry | `api/src/edicao/{edicao,pecas}.service.ts`, `api/src/criativos/state-machine.ts` |
| Banco | `api/prisma/migrations/20261104180000_templates_ai_background/migration.sql`, `api/prisma/schema.prisma` |

`AutoVariationType.AI_VIDEO` e `Scene.faceId`/`voiceId` sustentam a produção. Transições principais: SCRIPTS_WRITING → AI_PLAN_DONE → FACES_GENERATING → AI_FACES_DONE → SCENES_GENERATING → render → aprovação técnica/entrega. Isso não publica anúncio automaticamente; a revisão do conteúdo antes de publicar permanece.

Detalhe importante corrigido: no serviço de edição, conclusão/falha do render considera `creative.variationKind === 'AUTO_EDIT'`, mesmo quando AI_VIDEO usa composição nativa por cenas. Sem isso, o arquivo renderizava mas a entrega do lote/biblioteca/créditos não concluía corretamente.

## Pesquisa já feita — não recomeçar do zero

Entrada: `reports/research/variacoes-ia-2026-11-04/README.md`. Fontes e catálogo em `fontes.md`, `catalogo-formatos.md`, `base-conhecimento.json`, `motor-proposto.md` e `MEMORIA.md`. Foram registrados 24 fontes, 28 formatos, 17 eixos e 6 operações. Evidências de 2026 foram separadas de previsões para 2027; não apresentar previsões como resultados medidos ou ranking universal de conversão.

Histórico intermediário: `reports/variacao-semantica-v1-2026-11-04.md` e `reports/variacao-semantica-fix-runtime-2026-11-04.md`. A decisão de UX deste handoff substitui a jornada de planejamento desses documentos.

## Validação concluída e limites

Fonte consolidada: `reports/templates-ia-background-2026-11-04/README.md`.

- 22 testes semânticos/produção; 432 regressões de estados, catálogo e peças; 7 casos distintos de integração HTTP/PostgreSQL passaram. Incluem permissões, cobrança, duplo clique, dois participantes, estorno/retry, recuperação de interrupção e os formatos solo/FAQ.
- Execução extra com **Remotion local real + provedores de mídia simulados** gerou `pipeline-mock.mp4`: 1080×1920, 14,144 s, vídeo e áudio. `montagem-real-frame.jpg` registra a legenda. Esses arquivos estão na pasta do relatório.
- Navegador confirmou redirecionamento, três cards, campeão, geração, progresso, reload, player carregando e reproduzindo, link de download e mobile sem overflow. `browser-checks.json`: nenhum erro JavaScript. Screenshots na mesma pasta.
- Typecheck API/web, build API, lint dos arquivos web alterados e `git diff --check` passaram no encerramento da implementação.
- **Nenhuma geração paga de imagem/voz/vídeo foi executada.** Qualidade visual, naturalidade das vozes, sincronização e custo dos provedores reais ainda não estão comprovados por esses testes.
- Arquivos antigos de falha de QA foram preservados como histórico; o recibo final `browser-checks.json` é o resultado da última execução aprovada.

Comandos de referência (integração usa banco de teste e provedores simulados conforme harness):

```sh
npm test -w api -- --runInBand templates-ai/contract.spec.ts variacao-ia/plano.spec.ts
npm test -w api -- --runInBand templates-ai.int.spec.ts
env AI_TEMPLATE_TEST_RENDER=local npm test -w api -- --runInBand templates-ai.int.spec.ts -t 'duplo clique'
```

QA de navegador: `testes/variacao-ia-2026-11-04/production-server.cjs` e `production-browser.mjs`. Leia os scripts para preparar os servidores isolados; não aponte o teste para provedores live inadvertidamente.

## Estado do ambiente na última validação

- Web local 3000; API 3001. Novo build completo substituiu o snapshot provisório que só tinha o planejador. Registro em `reports/templates-ia-background-2026-11-04/runtime.json` (PID 41641 observado em 04/11; é histórico, conferir o processo vivo antes de agir).
- Migração aditiva aplicada ao banco local `maquina` e ao `maquina_test`. Backup local anterior: `.infra/backups/maquina-2026-11-04-2235.sql.gz`. `.env` preservado.
- Reinício foi feito com zero jobs, chamadas de provedor e renders ativos. Script: `testes/variacao-ia-2026-11-04/restart-ai-runtime.cjs`; log: `testes/.cache/semantic-runtime/api-ai-production.log`. Não reiniciar às cegas se houver produção em curso.
- QA isolado nas portas 3242/3342 encerrado, fixtures removidas e entradas temporárias do Next retiradas. Serviços locais principais preservados.
- **Sem commit, push, deploy remoto ou publicação de anúncio por esta frente.** Há muitas alterações simultâneas de outras frentes (Ad Radar/editor etc.). Revisar por arquivo/hunk; não restaurar a árvore nem agrupar todo o diff num commit desta entrega.

## De onde continuar

1. Ler este handoff e o contrato; conferir branch/diff e saúde local sem desfazer trabalho concorrente.
2. Na retomada da implementação, validar uma geração real com um campeão pela aba Com IA, respeitando a autorização e o orçamento vigentes. Avaliar roteiro, identidades, alternância do podcast, vozes, lipsync, legendas, duração, download e recuperação de falhas; registrar custo real e evidências.
3. Ajustar qualidade com base no resultado; definir preço comercial e publicar os templates no catálogo quando apropriado. A disponibilidade atual para equipe não significa liberação comercial.
4. Expandir formatos/eixos a partir da pesquisa e de contratos de produção específicos, preservando a entrada simples via Templates.

Memória compartilhada anterior já registrada em `../../STATUS.md` (a partir da raiz do projeto), `../../decisions/log.md` e `../../archives/marketing-workspace/brain/daily/2026-11-04.md`, marcador `hookmill-ai-templates-background-2026-11-04`.
