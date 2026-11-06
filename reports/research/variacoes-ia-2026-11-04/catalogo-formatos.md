---
tipo: catalogo
data: 2026-11-04
tags: [criativos, formatos, variacao, ia]
---

# Catálogo inicial: 28 formatos e execuções

Biblioteca operacional proposta para o HookMill. Os nomes não são todos mutuamente exclusivos: um podcast pode conter demo e comparação. O motor deve poder compor **formato principal + estrutura de argumento + prova + execução**, em vez de encaixar tudo num único enum.

**P1:** primeira biblioteca, por utilidade e viabilidade. **P2:** expansão após piloto. **P3:** experimental, demanda maior ou evidência especialmente limitada. A prioridade é nossa recomendação, não um ranking de conversão. Custos relativos são estimativas de complexidade, sem cotação de APIs. Fontes abaixo remetem a [fontes.md](fontes.md); o detalhamento de produção é proposta original.

| ID / formato | Para que serve / estrutura | Transformação a partir de um talking head | Produção e prova necessárias | Prioridade / sinal externo |
|---|---|---|---|---|
| F01 · Talking head explicativo | Uma pessoa desenvolve uma ideia, mostra prova e convida à ação | Reescrever para outro contexto ou objeção; manter a oferta | Pessoa real ou apresentador sintético; não confundir apresentador com cliente | P1 · referências S05/S07 |
| F02 · Demo de produto | Tarefa → produto em uso → resultado observável | Trocar descrição abstrata pela demonstração da mesma função | Filmagem ou tela real; efeitos não podem simular eficácia | P1 · sinal de gasto S02; case S09 |
| F03 · Tutorial de tela | Ensinar um procedimento e reduzir dificuldade percebida | Transformar cada benefício em uma ação demonstrada | Captura atual da interface; cursor, zoom e narração | P1 · aplicação proposta de demo/educação; S07/S13 |
| F04 · FAQ / resposta a objeção | Pergunta concreta → resposta → prova → CTA | Converter a objeção implícita em pergunta explícita | Pergunta pode ser editorial; comentário atribuído exige fonte | P1 · sinal qualitativo S12/S13 |
| F05 · Comparação | Duas alternativas em critérios que importam | Comparar processo atual e processo com a oferta | Critérios e diferenças verificáveis; evitar rival inventado | P1 · repertório qualitativo S12 |
| F06 · Listicle | Uma tese apoiada em dois ou três pontos | Separar argumentos existentes em itens demonstráveis | Texto, VO e material do produto; não criar benefícios extras | P1 · relato S12 |
| F07 · Texto sobre B-roll | Uma mensagem legível em cenas de contexto | Condensar a tese e usar imagens que a sustentem | Footage próprio/licenciado/gerado; controlar legibilidade | P1 · relato S12 |
| F08 · Estático de mensagem/produto | Comunicar um argumento de uma vez | Destilar a promessa numa imagem, sem congelar frame aleatório | Produto fiel, texto e prova curta | P1 · sinal de gasto S03 |
| F09 · Podcast de um apresentador | Explicação com linguagem de entrevista, resposta ou reflexão | Reescrever em fala conversacional e organizar objeção/prova | Um personagem, cenário consistente e áudio; não atribuir a programa real | P1 · sinal indireto S05; produção S20 |
| F10 · Podcast de duas pessoas | Host conduz dúvida, convidado explica e demonstra | Redistribuir os beats em perguntas e respostas que avançam | Duas vozes, continuidade, turnos e reação; atores sintéticos identificados | P1 · piloto pedido pelo usuário; sem prova de vantagem da IA |
| F11 · Narrado com B-roll | Explicar enquanto se vê situação, uso e consequência | Retirar a dependência do rosto e casar cada fala com uma cena | VO e ativos por beat; prova real preservada | P1 · repertório S05/S07 |
| F12 · UGC de experiência real | História vivida → uso → observação → convite | Reaproveitar testemunho autorizado; não criar novo testemunho | Cliente/creator com experiência real e direitos de uso | P1 · repertório S07/S13 |
| F13 · História do fundador | Origem do problema e razão das escolhas de produto | Mudar o POV para quem construiu a solução | História factual; fundador real ou clone autorizado | P2 · repertório S13/S23 |
| F14 · Rotina / dia de uso | Mostrar como a oferta se encaixa na vida | Recontar o argumento como sequência de uso | Cenas de rotina; benefícios do produto continuam verificáveis | P2 · contexto de uso S06/S07 |
| F15 · Unboxing / primeiro uso | Revelar produto, componentes e experiência inicial | Converter benefícios em elementos físicos observáveis | Produto real; não inventar embalagem ou item incluído | P2 · sinal de gasto S02; menos universal para SaaS |
| F16 · Green screen / react | Explicar uma evidência visível ao fundo | Responder a tela, pergunta ou demonstração relevante | Material autorizado, contexto e rosto; não inventar publicação | P2 · diferenças por nicho em S04; sinal fraco no S05 |
| F17 · Diálogo / skit | Encenar uma tensão cotidiana e sua resolução | Uma pessoa expressa objeção, outra demonstra alternativa | Roteiro, elenco e continuidade; encenação não vira depoimento | P2 · repertório S15 |
| F18 · Entrevista de rua | Pergunta direta e reação curta | Transformar tese em pergunta seguida de demonstração | Pesquisa real ou cena identificada como encenação; não fingir amostra pública | P2 · repertório S15, sem benchmark robusto de conversão |
| F19 · Chat / conversa encenada | Revelar dúvida e descoberta por mensagens | Transformar falas em troca de mensagens com progressão | Interface ilustrativa e conversa identificada; sem conversa privada fictícia como prova | P2 · repertório interno; hipótese não validada |
| F20 · Quadro / explicação visual | Desenhar relações, etapas e mecanismo | Traduzir abstrações em objetos, setas e exemplos | Diagramas corretos, labels e sincronismo | P1 · relato de educação S13 |
| F21 · Estudo de caso | Situação → intervenção → resultado com condições | Estruturar evidência existente em narrativa | Caso real, período e permissões; resultado não generalizado | P2 · hipótese indicada para prova robusta; S04 |
| F22 · Carrossel sequencial | Desenvolver argumento em etapas navegáveis | Cada slide recebe uma função e CTA coerente | Assets estáticos, continuidade e leitura no celular | P2 · sinal de gasto agregado modesto S03; testar por contexto |
| F23 · Bastidores / processo | Demonstrar cuidado, método ou qualidade | Trocar afirmação sobre qualidade por processo visível | Filmagem real quando apresentada como bastidor real | P2 · repertório S02/S07 |
| F24 · Animação explicativa / personificação | Tornar uma ideia abstrata compreensível ou divertida | Transformar mecanismo em metáfora visual explícita | Personagens próprios; metáfora separada de evidência | P2 · relato S12 e repertório S15 |
| F25 · ASMR / sensorial | Mostrar textura, som, preparo ou uso | Converter parte do valor em experiência sensorial | Som e produto coerentes; não basta loop satisfatório desconectado | P3 · repertório S15; conversão não comprovada |
| F26 · Mini-drama / micro-história | Conflito → escolha → consequência → oferta | Expandir o problema em cena e relacionar solução | Múltiplos planos, personagens e continuidade; custo relativo alto | P3 · repertório S15; hipótese |
| F27 · Editorial / boletim explicativo | Organizar informação em linguagem de apresentação | Recontar como explicação editorial com fontes | Identidade própria; não simular cobertura ou endosso de veículo real | P3 · repertório interno; hipótese |
| F28 · Música / história cantada | Usar ritmo e repetição como estrutura | Adaptar uma tese a versos e cenas compreensíveis | Música autorizada/original, dicção, narrativa; teste separado | P3 · repertório S15; hipótese |

## Primeiro piloto sugerido

**F02 demo, F04 FAQ, F08 estático, F09 podcast solo, F10 podcast com duas pessoas e F11 narrado.** O estático é um controle barato de mensagem. O podcast de duas pessoas entra porque corresponde diretamente ao caso de uso do usuário, apesar da complexidade maior.

F01 já fornece o material de origem. F07 e F20 podem aproveitar partes do pipeline de edição existente, mas essa pesquisa não auditou a implementação de cada template.

## Três receitas de transposição

São instruções de produção propostas, sem promessa de conversão.

### Talking head → podcast

1. Identificar a tese, o mecanismo, a prova, a objeção principal e o CTA.
2. Abrir no ponto interessante da conversa, sem apresentação longa de programa.
3. Dar ao host a dúvida do público; o convidado precisa responder com conteúdo novo.
4. Introduzir a demonstração na hora em que a explicação precisa dela.
5. Fazer a transição para a oferta sem inventar experiência pessoal dos apresentadores.
6. Produzir falas por turno, com vozes e enquadramentos estáveis; montar planos individuais e reações.
7. Verificar sincronismo labial, quem fala, áudio, continuidade, legibilidade e fidelidade do argumento.

Versão ilustrativa para o app fictício do relatório:

- Host: “Como você planeja a semana quando cada dia tem um horário?”
- Apresentador: “Comece pelo que cabe na rotina. Aqui você organiza as refeições e vê a lista do que precisa comprar.”
- Mostrar as duas funções na interface real quando houver produto real.
- Host: “Então a lista acompanha o que foi planejado?”
- Apresentador: responder apenas o que o produto de fato faz e encaminhar à demonstração.

**Não fazer:** repetir o monólogo em duas vozes; adicionar elogios falsos; vestir um ator de especialista sem competência real; fabricar um podcast conhecido.

### Talking head → demonstração

1. Separar benefício alegado de comportamento observável do produto.
2. Escolher uma tarefa curta que exemplifique o benefício.
3. Mostrar estado inicial, ação e estado final sem esconder etapas necessárias.
4. Usar narração só onde acrescenta entendimento.
5. Terminar com a próxima ação compatível com o grau de interesse.

**Não fazer:** gerar uma tela fictícia e apresentá-la como recurso disponível.

### Talking head → novo público

1. Verificar se a oferta atende o novo público/contexto.
2. Recuperar linguagem e objeções de fontes reais desse grupo.
3. Trocar o argumento quando a motivação mudou, e não só o vocativo.
4. Escolher prova e exemplo relevantes ao novo uso.
5. Conferir a continuidade da promessa na landing page.
6. Marcar o recorte como hipótese até observar resultados.

**Não fazer:** inferir público alcançado pelo rosto do personagem ou por estereótipos demográficos.

## Biblioteca de ângulos independente dos formatos

Ângulos iniciais a preencher com evidência da oferta: praticidade; economia de tempo; redução de desperdício; previsibilidade; autonomia; qualidade demonstrável; facilidade de começar; compatibilidade com rotina; alternativa a um método atual; valor que justifica o preço; transparência do processo; resposta a uma objeção; identidade/comunidade; ocasião específica; descoberta de uma função subutilizada.

Cada ângulo precisa de um motivo concreto para comprar e de uma forma de comprovação. Não gerar promessas de velocidade, economia, resultados ou exclusividade sem base.

## Exemplos de combinações válidas

| Necessidade | Ângulo | Estrutura | Formato | Prova |
|---|---|---|---|---|
| “Não sei usar” | Facilidade para começar | Dúvida → demonstração | Tutorial | Tela real |
| “Parece caro” | Valor pelo que entrega | Objeção → critérios | Podcast ou comparação | Preço e componentes reais |
| “Já tentei antes” | Diferença no processo | Tentativa → diferença → uso | FAQ ou quadro | Método documentado |
| “Isso cabe na minha vida?” | Adequação à rotina | Dia real → uso | Rotina ou skit | Cena ilustrativa + função real |
| “Não acredito no resultado” | Transparência | Evidência → limites | Caso ou demo | Dados verificáveis |

Formato pode ser recomendado sem ser “validado”. A recomendação explica **por que vale o teste**, enquanto a validação exige resultado observado.
