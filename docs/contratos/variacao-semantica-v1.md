# Variação semântica v1 — primeira fatia (04/11/2026)

Implementação autorizada pelo Gusta após a pesquisa de 04/11. Escopo desta fatia: selecionar um criativo analisado, orientar a variação, gerar três hipóteses com roteiro e fontes, salvar e retomar o planejamento. A tela `/ai-variations` não renderiza vídeo, não debita créditos de mídia nem publica campanhas.

## Representação e persistência

Tipos em `contratos/src/variacao-ia.ts`. Os 17 eixos da pesquisa são independentes. Primeiro catálogo: demo (F02), FAQ (F04), estático (F08), podcast solo (F09), podcast duplo (F10), narrado (F11).

Reutiliza Champion + Offer + Teardown. A oferta fornece fatos **declarados**, não automaticamente verificados; transcrição/teardown são referência e interpretação, especialmente quando o original é de terceiro. Cada proposta tem alterações antes/depois, constantes, hipótese, requisitos de prova/produção, falas por turno e referências aos campos da oferta. Nenhum score de conversão.

Persistência em `Job`, tipo existente `VARIATIONS_PLAN`, discriminado por `input.purpose = semantic-variation-v1`, sem `variationBatchId`. `input` guarda pedido e snapshot; `output` guarda o plano. Não cria lotes renderizáveis nem itens com enum incompatível. Não exige migração. A retomada existente marca jobs interrompidos como FAILED/INTERRUPTED; nova tentativa requer outro requestId, sem cobrança automática repetida.

## HTTP autenticado

- `GET /ai-variations/config`: disponibilidade, modo e seis formatos.
- `POST /ai-variations` → 202 `SemanticPlanJob`: `{championId, requestId(UUID), focus: AUTO|FORMAT|AUDIENCE|ANGLE, instructions(0..1200), formatIds(1..3, únicos)}`. Sempre três hipóteses. FORMAT muda apresentação/execução; AUDIENCE exige público alterado; ANGLE exige tese alterada. Seleção de mais de um formato exige cobrir todos.
- `GET /ai-variations?championId=`: últimos 20 planejamentos do workspace, opcionalmente por original.
- `GET /ai-variations/:id`: polling a cada 2 s enquanto QUEUED/RUNNING. Erros de job usam códigos assíncronos existentes.

Workspace vem do token. CLIENT só lê. Oferta/criativo arquivados não iniciam planejamento. Não usa claims de outro workspace. Idempotência por workspace + requestId; payload diferente com a mesma chave retorna INVALID_STATE. Um planejamento ativo por workspace, serializado com lock transacional PostgreSQL. Reutilização da chave não dispara nova chamada.

## Ativação e custos

`AI_VARIATIONS_ENABLED=on` habilita; `off` desabilita. Sem env, habilitado apenas fora de production. Acesso de geração restrito a INTERNAL (inclui TEST_MODE=on) nesta fase de desenvolvimento; pricing comercial ainda não definido. Falta de chave em live = indisponível, nunca simulação silenciosa.

Usa INTEGRACOES_MODE e ANTHROPIC_MODEL existentes. Mock explicitamente identificado, sem chamada externa. Live reutiliza transporte estruturado e livro de custos existentes: uma chamada, sem fallback/retry automático, max_tokens limitado. Verifica teto mensal antes de iniciar; estimativa conservadora baseada em bytes do prompt e teto de saída. Custo registrado mesmo se a resposta for recusada/inválida. O teto mensal existente não é uma reserva global atômica entre features concorrentes.

## Validação e limites

Schema fechado e validação em runtime: exatamente três propostas distintas, enums e limites, fatos conhecidos, mudanças antes/depois diferentes, cobertura dos formatos pedidos, foco respeitado e dois falantes com alternância no podcast duplo. Mecanismo/prova/CTA exigem referência. Nova audiência implica revisão de adequação. Todos os planos são hipóteses para revisão; referências válidas não provam que uma paráfrase é semanticamente fiel.

O provedor recebe oferta, transcrição e instruções como dados não confiáveis, sem ferramentas. Preservar oferta/preço/condições; não inventar depoimento, autoridade, métrica ou eficácia. Não transferir promessa genérica de emagrecimento para gestação. 2027 é previsão. Dados próprios de conversão ainda não entram nesta fatia.

Próxima fatia: escolha/edição de proposta → plano de produção orçado → geração de mídia por turnos → QA e vínculo ao resultado. A base desta entrega é `reports/research/variacoes-ia-2026-11-04/`.
