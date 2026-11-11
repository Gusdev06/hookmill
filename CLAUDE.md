# HookMill — continuidade compartilhada

Siga também o manual do AIOS em `../../CLAUDE.md` e o estado compartilhado em `../../STATUS.md`.

## Handoff de 05/11/2026: Templates com IA

A pedido do Gusta, o Codex encerrou sua participação e deixou o ponto de retomada em [docs/handoffs/templates-ia-2026-11-05.md](docs/handoffs/templates-ia-2026-11-05.md). Leia esse arquivo antes de continuar a frente de variações com IA.

Decisão vigente (07/11, substitui a de 04/11): **Templates → Com IA → formato → campeão → 4 prévias em imagem (ideias novas, apresentador diferente em cada, grátis) → usuário aprova (pode voltar e aprovar mais depois) → só as aprovadas viram vídeo.** Contrato `docs/contratos/templates-ia-previas-v1.md`, mockup `design/mockup-with-ai-previas.html`. Contrato APROVADO 07/11 e código do passo 1 liberado (local, sem deploy, sem push). **Este worktree (branch `with-ai-previas`) é onde essa frente coda**: API 3141, banco `maquina_previas`/`maquina_previas_test`, tudo em mock; nunca o banco `maquina` nem a API 3001. Ambiente, comandos e tarefas por dono no §12–§13 do contrato.

O repositório contém trabalho simultâneo de outras frentes e muitos arquivos sem commit. Não trate todo o diff como parte deste handoff; preserve as alterações existentes.
