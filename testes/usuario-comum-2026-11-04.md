# HookMill — teste como usuário comum · 04/11/2026

**Consegui chegar às prévias com duas contas novas, sem acesso interno nem crédito concedido manualmente.** A seleção manual entregou **2 vídeos por 2 usos** (restaram 2). O pack disponível no banco de teste entregou **6 vídeos por 4 usos**. Cadastro, upload, geração, recarregar durante a geração e entrar novamente funcionaram. A principal dificuldade é a distância entre criar a conta e ver o primeiro resultado; receber os arquivos completos ainda depende de contato humano.

O teste é uma avaliação de usabilidade por inspeção e execução, não pesquisa com clientes nem medição de abandono. **IA, análise e render usam mocks/local**: não avaliei a qualidade criativa dos vídeos, a precisão da extração do Eddy nem velocidade de produção. Os vídeos de prévia simulados têm conteúdo ilustrativo.

## Resultado e cobertura

| Conta nova | Caminho pela interface | Resultado confirmado por UI e HTTP |
|---|---|---|
| Marina / SonoLeve | Cadastro → Só eu → Eddy sem site → pular Meta/metas/kit → tour → Home → pack → upload → desmarcar seis templates → Gerar | 6/6 prévias prontas; SAMPLE; 4 usos debitados; saldo 0; arquivos completos protegidos |
| João | Cadastro → Só eu → Eddy sem site → pular opcionais → tour → galeria → marcar Notícia urgente + Meme POV → upload → plano → Gerar | 2/2 prévias prontas; SAMPLE; 2 usos debitados; saldo 2; arquivos completos protegidos |

- Contas comuns **OWN/SAMPLE**. O papel OWNER é de dono do próprio espaço, sem acesso interno ou `TEST_MODE`.
- Toda preparação dessas contas e geração foi pela UI. Consultas SQL finais foram somente leitura para conferir o livro-razão.
- Desktop **1440×900**, resultado em mobile **390×844**; plano, contadores e retestes em **PT/EN**.
- Upload real do arquivo local `testes/fixtures/campeoes/fala-split-20s.mp4`; sem conectar Meta.
- Logout/login preservou o lote na Home; a Biblioteca guardou o anúncio original e permitiu reutilizá-lo. Prévia toca e bloqueia visualização integral após 3 s. Download completo/Meta permanecem bloqueados conforme o plano.
- Não houve pagamento, envio de e-mail, concessão administrativa de saldo ou publicação.

## Bugs corrigidos e retestados

**2 achados médios, ambos corrigidos e confirmados no navegador. Nenhum novo bug alto confirmado neste percurso.**

| ID / área | Reprodução e impacto | Correção na causa | Evidências |
|---|---|---|---|
| UC-B1 · média · plano | Selecionar Notícia urgente + Meme POV, subir vídeo e abrir o plano. Dois campos aparecem como **Headline NaN**; `topic` e `dek` aparecem como rótulos técnicos. | O web convertia qualquer sufixo de campo em número: `headline.lead` virava `NaN`. Numeração agora só para índices numéricos; nomes aninhados conhecidos e campos do telejornal têm tradução. | [Antes](usuario-comum-2026-11-04/124-manual-plano.png), [depois PT](usuario-comum-2026-11-04/131-reteste-plano-pt.png), [depois EN](usuario-comum-2026-11-04/129-reteste-plano-en.png) |
| UC-B2 · média · amostra/créditos | Gerar lote com vários templates. Cabeçalho dizia **1 uso** apesar de reservar 4; limite antigo de **até 4 variações** aparecia junto a 6 peças; desbloqueio prometia novas variações grátis; falta de usos era descrita como falta de créditos. | Contagem reservada vem do lote; quantidade de vídeos vem do resumo real; texto de desbloqueio distingue usos/templates/vídeos e novas gerações com créditos. Saldo insuficiente identifica usos grátis e orienta reduzir a seleção. Comportamento legado preservado onde ainda se aplica. | [Antes](usuario-comum-2026-11-04/63-geracao-retomada.png), [2 usos reais](usuario-comum-2026-11-04/135-manual-geracao-pt.png), [6 vídeos após correção](usuario-comum-2026-11-04/verify-user-generation-pt.png), [saldo insuficiente corrigido](usuario-comum-2026-11-04/verify-shortage-pt.png) |

## Dificuldades de experiência que permanecem

Prioridade aqui significa impacto provável na primeira geração, não severidade técnica comprovada nem taxa medida de abandono.

| Prioridade | O que vi / passos | Por que dificulta | Recomendação / situação |
|---|---|---|---|
| P1 | Cadastro avisa “uns 10 minutos”; Eddy “uns 5”. Antes do anúncio há configuração de negócio/oferta, Meta, metas, kit e tour de 4 paradas. | A pessoa ainda não viu uma variação quando precisa entender boa parte do produto. | Conduzir à primeira geração com o mínimo necessário. **Tour v2 já aprovado**, com 3 paradas e opção de pular; a versão vista nesta execução ainda era a antiga. Retestar quando integrado. |
| P1 | Resultado → “Liberar: fale com a gente” → copiar ID e abrir e-mail. | O usuário consegue avaliar uma prévia, mas não concluir a compra/liberação sozinho. | **Precisa decisão:** manter venda assistida ou priorizar checkout. Não alterei preço nem mecanismo de liberação. [Tela](usuario-comum-2026-11-04/71-liberar-amostra.png). |
| P2 | Eddy → “Sem site? Descreva o negócio”. O cartão continua perguntando pelo site; o campo que muda fica no rodapé. | Mudança de modo pouco evidente, com distância visual entre instrução e resposta. | Trocar também o título/instrução do cartão e aproximar a descrição da pergunta. [Tela](usuario-comum-2026-11-04/11-descricao-negocio.png). |
| P2 | Home → “Enviar um anúncio vencedor” abre a galeria, antes de pedir o vídeo. | O destino não corresponde à ação anunciada; exige escolher entre 27 templates antes do upload. | **Precisa decisão:** upload primeiro ou CTA que explique “Escolher templates e enviar anúncio”. [Galeria](usuario-comum-2026-11-04/44-entrada-variacoes.png). |
| P2 | Metas no Eddy: negócio no Brasil, alvo/teto em USD; ao pular permanece teto de US$ 10. | Não fica claro se é orçamento de anúncios ou limite de gasto na plataforma, nem por que esse valor já existe. | Explicitar a finalidade e origem do limite. O contrato usa `monthlySpendCapUsd` para custo interno; não converter moeda nem mudar teto sem decisão. |
| P2 · condicional | Pack do banco de teste marcou 10 templates para saldo de 4, bloqueando Gerar. Foram seis desmarcações até caber. | A promessa de escolha automática exige edição manual para uma conta nova. | O pack **já foi escondido no catálogo local usado pelo Gusta**, conforme decisão de 04/11; ficou LIVE no banco isolado. Não extrapolar este achado para o catálogo atual do usuário. Se reativado, decidir seleção inicial que respeite o saldo. A mensagem de falta de usos foi corrigida. |

O limite de 3 segundos e a necessidade de pagar para liberar **já eram informados na landing e na galeria**; não os classifiquei como cobrança surpresa.

## Baixa severidade aberta

| ID | Passos / evidência | Situação |
|---|---|---|
| UC-L1 · título desatualizado | Criar conta, renomear negócio no Eddy e concluir. Sidebar mostra SonoLeve, mas cabeçalhos do tour/fluxo exibem **NEW CLIENT** até recarregar. [Tela](usuario-comum-2026-11-04/51-plano-pronto.png). | Aberto; atualização de nome não chega imediatamente a todos os consumidores da sessão. Não bloqueou gerar. |
| UC-L2 · linguagem técnica | Abrir os textos editáveis do plano em PT. Origem aparece como `de: kind`, `de: promise`, `de: what`, `de: pains`. [Reteste](usuario-comum-2026-11-04/131-reteste-plano-pt.png). | Aberto; traduzir os nomes de origem para linguagem do usuário. Rótulos principais do telejornal corrigidos em UC-B1. |

## Validações e arquivos

- **8/8 verificações automatizadas Playwright**: contagem de 6 e 2 vídeos em PT/EN, texto de desbloqueio, ausência de overflow horizontal a 390 px e saldo insuficiente com geração bloqueada. **2/2 lotes consultados por HTTP**: SAMPLE, SETTLED, 6/2 peças prontas, 4/2 usos, prévias disponíveis e originais não expostos. [Resultado](usuario-comum-2026-11-04/verification.json), [script](usuario-comum-2026-11-04/verify.mjs).
- Rótulos conferidos em PT/EN, ausência de `NaN`, e 2 usos reservados na geração real. [Conferência](usuario-comum-2026-11-04/label-evidence-check.json).
- `npx tsc --noEmit -p api` e `npx tsc --noEmit -p web` passaram após cada grupo de correções. ESLint dos três componentes alterados passou. Logs `fix-labels-*` e `fix-sample-*` no diretório de evidências.
- `npx jest --runInBand --runTestsByPath src/meta/oferta-match.spec.ts`: **27/27**; executado ao resolver a interrupção de inicialização da API. ESLint de `api/src/meta/meta.module.ts` passou, com aviso de configuração Next usado fora da pasta web.
- Fonte alterada nesta revisão: `web/src/components/templates/run-screen.tsx`, `web/src/components/iterate/sample.tsx`, `web/src/components/iterate/generate-screen.tsx`, `web/messages/en.json`, `web/messages/pt-BR.json`. [Patch desta revisão](usuario-comum-2026-11-04/correcoes.patch).
- `api/src/meta/meta.module.ts`: acrescentei registro do provider `MetaOfferLinksService` para recuperar a API. Outra implementação simultânea também atualizou esse arquivo; as demais mudanças foram preservadas.
- Evidências e roteiros: [pasta da sessão](usuario-comum-2026-11-04/). Os scripts interativos precisam da pilha isolada e os retestes usam as contas/lotes desta execução; não são uma suíte que recria o banco. Nenhuma suíte que trunca o banco foi rodada nesta revisão.

## Isolamento e limites

Somente `maquina_e2e_test` em localhost:5433; `prisma migrate deploy` com ambas URLs explícitas, inclusive migração `20261105000100_meta_offer_match` já presente no checkout. API 3201 em mock, cron Meta desligado, render fake, análise local, chaves pagas sobrescritas como vazias, TEST_MODE off. Web 3311 com `.next-hunt`, mocking do navegador desativado. Nenhuma chamada paga nesta execução.

A API caiu durante alterações simultâneas da Meta (provider ausente e, brevemente, assinatura de método em transição). A máquina também sofreu lentidão durante trabalho paralelo. Esses incidentes foram separados dos problemas de usabilidade; tempos observados aqui não estimam produção.

**Encerrados somente os processos próprios da pilha 3201/3311 e navegadores de teste.** 3000/3001 continuam ouvindo e não foram reiniciados ou encerrados por esta sessão. O PID da 3001 mudou durante trabalho simultâneo, fora dos comandos desta auditoria. [Conferência final](usuario-comum-2026-11-04/ports-final.json).

Não editei `api/.env` nem `web/.env.local`. O hash de `web/.env.local` permaneceu igual; o de `api/.env` mudou por edição externa simultânea e foi preservado. Referências automáticas `.next-hunt` foram removidas do tsconfig; mudanças de outros processos em `next-env.d.ts` foram preservadas. Sem commit, push, deploy ou acesso a banco de produção.
