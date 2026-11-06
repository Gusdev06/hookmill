# Variações com IA — correção do ambiente local

04/11/2026, após a captura enviada pelo Gusta mostrando dois avisos “Esse item não existe mais”.

## Causa e correção

O frontend Next já servia a tela nova, mas a API na porta 3001 executava `node dist/main.js` iniciado às 14:05 locais, antes da implementação. `GET /api/v1/ai-variations/config` devolvia 404 mesmo sem autenticação: a rota não existia no processo. A listagem de planos também falhava, produzindo o segundo aviso genérico. Não houve exclusão dos criativos.

O frontend agora aguarda a configuração antes de consultar anúncios, histórico e plano. Falha nesse pré-requisito mostra um aviso específico de carregamento, com “Tentar de novo”, em vez de anunciar que um item foi excluído.

A API local foi atualizada às 16:11 com o build estável anterior acrescido somente do módulo de variação semântica. A compilação global encontrou trabalho concorrente ainda incompleto (primeiro os métodos de concorrentes; depois a tipagem de `research/sync.service.ts:352`). Não alteramos essas fontes nem promovemos esse build incompleto. Backup e build não promovido ficaram em `testes/.cache/semantic-runtime/`, ignorado pelo Git. O registro do módulo já existe em `api/src/app.module.ts` e será mantido em uma compilação normal quando a outra frente estiver pronta.

Processo anterior 5043 → novo 50251. Banco local `maquina`; zero jobs QUEUED/RUNNING antes do restart; `.env` preservado. API permanece em modo live conforme a configuração existente. Não houve chamada de geração, migração, deploy remoto ou alteração de campanha.

## Verificação

- Typecheck web e ESLint de `screen.tsx`/`copy.ts` passaram.
- Antes da atualização, a própria aba mostrou o novo aviso único de carregamento.
- Após o restart, a rota de configuração sem token respondeu **401**, confirmando rota registrada e autenticação exigida (antes era 404).
- Validação na aba real `localhost:3000/ai-variations`, autenticada no workspace do Gusta: avisos ausentes, item no menu presente, campos habilitados e dois anúncios analisados disponíveis no seletor. Dropdown fechado sem mudar a seleção; nenhuma proposta gerada.
- [Recibo do restart](../testes/variacao-ia-2026-11-04/runtime-refresh-result.json).

## Retomada operacional

API executa `api/dist/main.js`, log em `testes/.cache/semantic-runtime/api.log`. O código fonte permanece a referência; o snapshot de runtime é uma recuperação local para conviver com a construção concorrente. Quando a outra frente compilar, substituir por build normal e verificar a rota autenticada no mesmo ambiente usado pelo usuário. Os scripts `runtime-check.cjs` e `refresh-runtime.cjs` registram a recuperação pontual, não são o processo de deploy do produto.

Aprendizado: os testes isolados anteriores validaram a implementação, mas não provaram que a API já em execução na porta 3001 havia carregado as rotas novas. A checagem final precisa incluir o ambiente do usuário.
