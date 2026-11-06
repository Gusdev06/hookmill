---
tipo: memoria
data: 2026-11-04
tags: [hookmill, variacao-ia, retomada]
status: pesquisa-concluida-planejador-v1-implementado-localmente
---

# Retomada — variações de anúncios com IA

**Direção do Gusta:** variação deve incluir público, dor, desejo, argumento e formato — inclusive transformar talking head em conversa de podcast com IA. Não restringir a headline, avatar ou template. Pesquisa primeiro, em paralelo às outras features do Claude.

**Pesquisa entregue:** [relatório](README.md), [28 formatos](catalogo-formatos.md), [proposta do motor](motor-proposto.md), [24 referências e limites de acesso](fontes.md), [base JSON](base-conhecimento.json).

**Atualização após autorização de desenvolvimento:** planejador v1 implementado localmente em `/ai-variations`: três propostas, seis formatos, focos AUTO/FORMAT/AUDIENCE/ANGLE, roteiro, fontes, histórico e exportação. Reutiliza Job sem migração, acesso INTERNAL, simulação explícita e adaptador real implementado. 22 testes de lógica/API e sete verificações de navegador passaram. Sem geração paga, mídia produzida ou deploy. [Entrega e limites](../../variacao-semantica-v1-2026-11-04.md). A base JSON continua como artefato de conhecimento; regras selecionadas foram portadas ao código, sem ingestão automática de toda a base.

**Memória compartilhada registrada:** [fonte no wiki](/Users/gustagoat/Documents/AIS-OS/wiki/trafego-criativos/wiki/fontes/fonte-pesquisa-variacoes-ia-2026-11-04.md), [conceito de variação](/Users/gustagoat/Documents/AIS-OS/wiki/trafego-criativos/wiki/conceitos/variacao-semantica-de-criativos.md), [receita de podcast](/Users/gustagoat/Documents/AIS-OS/wiki/trafego-criativos/wiki/tecnicas/transpor-talking-head-para-podcast.md), STATUS, diário, índice e decisões. Os acréscimos preservam o histórico; [registro das 14 operações](memoria-registro.json).

## O que manter na memória

1. Separar **17 eixos**: público, situação, dor, desejo, objeção, consciência, ângulo, mecanismo, prova, narrativa, formato, mensageiro, hook, execução, oferta/CTA, localização e placement.
2. **Seis operações combináveis:** iteração, transposição, expansão de mensagem, expansão de público, conceito novo e localização.
3. Ângulo é a razão central para comprar; hook é a entrada; formato é a linguagem; IA é método de produção. Rosto do ator não define público atingido.
4. Trocar público exige reavaliar contexto, objeção, prova e adequação da oferta. O exemplo de gestação não aprova uma promessa genérica de emagrecimento.
5. Talking head → podcast requer reescrever os beats como conversa útil. Preservar fatos e condições, sem criar depoimento ou autoridade fictícios.
6. Longevidade e gasto são **proxies**, não prova de lucro. Estudos de 2026 podem conter dados de 2025. **2027 é previsão** em 04/11/2026.
7. Demo, explicação de objeção, comparação, conteúdo com creator e estáticos têm utilidade consistente como candidatos. Podcast merece teste; não foi demonstrado como vencedor universal.
8. Separar exploração multieixo de teste causal controlado. Baixa entrega é inconclusiva; uma única variável alterada não corrige automaticamente viés de alocação.
9. A memória deve guardar hipótese, eixos alterados, constantes, fontes, prova, KPI e resultado por contexto. Nenhuma previsão inventada de chance de conversão.
10. Acesso direto a X/Instagram/TikTok foi limitado. YouTube via transcrições; sem inspeção visual de vídeos. Consultar [cobertura](fontes.md) antes de afirmar que uma tendência foi observada nesses feeds.

**Próxima fatia:** validar qualidade com provedor real e criativos reais; escolher/editar proposta → plano de produção orçado → geração de mídia por turnos → montagem/QA e vínculo à hipótese. O primeiro planejador já existe; não recomeçar pela pesquisa nem confundir roteiro com vídeo pronto. Preço e acesso comercial ainda não definidos.

**Correção posterior da API local:** a porta 3001 ainda executava o build anterior e retornava 404. Runtime atualizado com build estável + módulo semântico; frontend agora mostra um único aviso de carregamento recuperável. Validado na conta/aba real do Gusta: menu, formulário e dois anúncios disponíveis. Sem geração paga. [Causa, recuperação e estado do build concorrente](../../variacao-semantica-fix-runtime-2026-11-04.md).

**Piloto sugerido:** F02 demo, F04 FAQ, F08 estático, F09 podcast solo, F10 podcast duplo e F11 narrado. A seleção é de produto/viabilidade, não ranking de ROAS. Não publicar automaticamente todos: escolher desenho e quantidade pelo orçamento e pela pergunta do teste.
