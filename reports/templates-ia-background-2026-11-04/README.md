# Templates com IA: produção automática conectada

Handoff para continuação no Claude, salvo em 05/11: [ponto de retomada](../../docs/handoffs/templates-ia-2026-11-05.md).

04/11/2026. Pedido do Gusta: **Templates → With AI → campeão → Gerar**, com todo planejamento em background. A página separada de planos foi substituída por redirecionamento para a aba Com IA, e removida da navegação.

## Entrega

- FAQ apresentado (F04), podcast solo (F09) e conversa de podcast (F10), um MP4 vertical por pedido.
- Planejador semântico usa oferta e campeão; seleciona internamente uma proposta do formato pedido sem requisitos de prova, assets ou elegibilidade pendentes. Mantém público, argumento e condições ao mudar formato.
- Cria elenco e vozes; dois rostos e duas vozes persistentes no F10, alternando os turnos. Usa os adaptadores existentes de Higgsfield / WaveSpeed, transcrição para legendas e montagem Remotion.
- Tela de progresso, depois player, Baixar MP4 e biblioteca. Sem Plan intermediário, sem textos do antigo lote sugerindo que toda troca de formato muda o público. Reload não cancela o trabalho.
- Crédito reservado atomicamente no Gerar, chave idempotente e controle de concorrência. Falha estorna; retry explícito reserva novamente. Recuperação não repete chamada paga com resultado desconhecido.
- Os três formatos novos ficam em DRAFT e sem preço comercial presumido: disponíveis para equipe. O admin pode definir preço e publicar para clientes. Os demais cards de IA não foram liberados sem motor.

Contrato: [templates-ia-background-v1](../../docs/contratos/templates-ia-background-v1.md). Implementação central: `api/src/templates-ai`, com integração em Templates/Iteração/Geração/Edição e contratos compartilhados.

## Evidências

- 22 testes de regras semânticas/produção passaram.
- 432 testes de regressão de máquina de estados, catálogo e peças passaram; o invariant antigo foi atualizado para reconhecer o retry explícito de IA.
- 7 casos de integração HTTP + PostgreSQL passaram: catálogo, autorização e preço, duplo clique, entrega com dois participantes, estorno/retry, interrupção e os dois formatos de uma pessoa.
- Uma execução adicional com **Remotion real local** e provedores simulados entregou MP4 **1080 × 1920, 14,144 s, com trilha de áudio**. Arquivo: `pipeline-mock.mp4`; frame de legenda: `montagem-real-frame.jpg`. É evidência técnica, não anúncio final gerado por provedores pagos.
- QA no navegador: redirecionamento, galeria, seleção de campeão, Gerar, progresso, reload, player carregando e reproduzindo, download disponível e mobile sem overflow. Sem erros JavaScript. [Recibo](browser-checks.json).
- Typecheck API/web, build API e lint dos arquivos web alterados passaram.

## Ambiente local

- Migração aditiva aplicada com `npm run db:migrate`, que gerou primeiro `.infra/backups/maquina-2026-11-04-2235.sql.gz`.
- Novo build completo da API substituiu o snapshot provisório do planejador. PID atual registrado em [runtime.json](runtime.json), porta 3001; nenhum job, task de provedor ou render ativo no restart. `.env` preservado.
- Servidores de QA 3242/3342 encerrados, fixtures removidas, entradas temporárias do Next retiradas. Produção local 3000/3001 preservada.
- Nenhuma geração paga real, publicação de anúncio, commit, push ou deploy remoto executado. A qualidade dos avatares/vozes reais e o preço comercial ainda exigem avaliação com uma geração real autorizada.

Próximo passo: experimentar um campeão real pela aba Com IA e avaliar o vídeo; a arquitetura permite acrescentar novos formatos com seu próprio contrato de produção.
