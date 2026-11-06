# Variações com IA — primeira etapa implementada

04/11/2026 · HookMill · Codex. Gusta autorizou iniciar o desenvolvimento depois da pesquisa. Entrega local: **planejador semântico com API, persistência e interface**. A geração de mídia continua sendo a próxima etapa; não houve chamada paga, publicação, commit ou deploy.

## O que funciona

Em `/ai-variations`, selecionar um anúncio já analisado, escolher exploração livre, outro formato, outro público ou outro ângulo, selecionar até três formatos e informar uma direção opcional. O resultado tem três propostas com hipótese, público, ângulo, mudanças antes/depois, roteiro por cenas/falas, fontes da oferta e requisitos para produção.

Catálogo inicial: demonstração, FAQ/objeção, estático, podcast solo, conversa de podcast e narrado com B-roll. O contrato representa os 17 eixos da pesquisa. Podcast duplo exige alternância entre dois interlocutores; expansão de público exige revisão de adequação da oferta. Nenhuma proposta recebe uma previsão inventada de conversão.

Os planos ficam salvos por workspace, podem ser reabertos após recarregar e exportados em JSON. Tela em português/inglês, desktop e celular. O roteiro segue o contexto de idioma da oferta. O modo de simulação é identificado explicitamente.

## Integração e limites desta entrega

- Contrato: [variacao-semantica-v1.md](../docs/contratos/variacao-semantica-v1.md), [tipos](../contratos/src/variacao-ia.ts).
- API isolada em [variacao-ia](../api/src/variacao-ia/), com adaptadores de [IA](../api/src/integracoes/claude/semantic-planner.ts) e [simulação](../api/src/integracoes/mock/semantic-planner.ts).
- Interface: [screen.tsx](../web/src/components/ai-variations/screen.tsx), rota e entrada na navegação. Mudanças nos arquivos compartilhados foram aditivas; alterações existentes do Claude foram preservadas.
- Reutiliza Champion, Offer, Teardown e Job. **Sem migração** e sem criar lotes de renderização.
- Geração liberada para acesso INTERNAL nesta etapa. `AI_VARIATIONS_ENABLED=on` habilita; `off` desabilita; sem env, só habilita fora de produção. Usa `INTEGRACOES_MODE` e o provedor/modelo configurados no app. Live sem chave fica indisponível, sem simulação silenciosa.
- Idempotência por pedido, trava de um planejamento ativo por workspace, isolamento entre contas, teto de gasto antes da chamada e registro de custo inclusive em resposta inválida. O teto existente não é uma reserva atômica entre features diferentes.
- Schema e validação conferem estrutura e referências; ainda é necessária revisão da fidelidade das afirmações. Os campos da oferta são fatos declarados pelo usuário, não verificação independente.
- O adaptador real está implementado, mas **a qualidade da resposta do modelo real ainda não foi validada nesta entrega**. Testes usaram simulação e transporte substituído. A base JSON da pesquisa permanece um artefato; suas regras selecionadas foram incorporadas explicitamente ao catálogo e ao prompt, sem ingestão automática de todas as fontes.

## Verificação

| Verificação | Resultado |
|---|---|
| Typecheck API, contratos e web | Passou |
| Testes unitários do plano/adaptador | 18 passaram |
| Integração HTTP + PostgreSQL `maquina_test` | 4 passaram |
| Navegador real com API mock, sem MSW | 7 verificações passaram |
| ESLint dos arquivos web envolvidos | Passou |
| `git diff --check` nos arquivos compartilhados alterados por esta entrega | Passou |

Testes cobrem três propostas, foco e formatos, referências inválidas, ausência de mudança, CTA sem fonte, podcast sem diálogo, conceitos duplicados, falta de adequação de público, campos inventados, custo em recusa/JSON inválido, ausência de chave, autenticação, isolamento, idempotência, concorrência, teto de gasto e falha persistida. Na última checagem global, uma edição concorrente em `web/src/components/campaigns/cards.tsx:218` introduziu uma linha vazia no EOF; esse arquivo não foi alterado por esta entrega.

No navegador: geração, retomada após reload, download, alternância do podcast, mudança de público, largura de 390 px sem transbordamento, idiomas EN/PT e ausência de erros JavaScript. Uma tentativa anterior encontrou o tour da fixture redirecionando a navegação; a preparação foi corrigida para concluir o tour antes de testar. A execução final passou.

Artefatos: [resultado do navegador](../testes/variacao-ia-2026-11-04/browser-result.json), [desktop PT](../testes/variacao-ia-2026-11-04/desktop-pt.png), [celular PT](../testes/variacao-ia-2026-11-04/mobile-pt.png), [desktop EN](../testes/variacao-ia-2026-11-04/desktop-en.png), [plano de teste](../testes/variacao-ia-2026-11-04/plano-exportado.json).

QA executado em portas isoladas 3241/3341 e encerrado. A fixture temporária foi removida; [recibo](../testes/variacao-ia-2026-11-04/cleanup-result.json). As portas habituais 3000/3001 não foram reiniciadas. Scripts de repetição em `testes/variacao-ia-2026-11-04/`; credenciais temporárias ficaram apenas no cache ignorado pelo Git.

## Próxima etapa

Validar o planejador com o provedor real e criativos reais; permitir escolher/editar uma proposta; converter o roteiro em plano de produção com orçamento, assets e vozes; gerar mídia por turnos; integrar montagem/QA e relacionar o resultado à hipótese original. Cobrança comercial e acesso de clientes ainda não fazem parte desta entrega.
