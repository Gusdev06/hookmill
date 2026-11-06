---
tipo: pesquisa
data: 2026-11-04
tags: [hookmill, variacao, creative-strategy, ia, pesquisa]
status: pesquisa-concluida-planejador-v1-implementado-localmente
---

# Variações de anúncios com IA: pesquisa e base para o HookMill

**Conclusão:** o motor precisa transformar uma ideia de venda em diferentes combinações de público, situação, motivação, argumento, prova e encenação. Trocar headline, rosto ou layout é só uma parte desse espaço. O caminho recomendado é gerar **famílias de hipóteses rastreáveis**, aprender com resultados e preservar os fatos da oferta.

Pesquisa em 04/11/2026. Mercado: referências internacionais, sobretudo Meta/DTC, com pesquisa brasileira complementar; aplicação proposta a e-commerce, infoprodutos, apps/SaaS e serviços. **2027 é previsão.** Nenhum formato foi validado em campanhas do HookMill nesta pesquisa. A etapa de pesquisa não incluiu geração paga, publicação, migração ou alteração do código do produto.

**Atualização de implementação — 04/11:** após o pedido do Gusta para iniciar o desenvolvimento, a primeira versão do planejador foi construída e testada localmente. [Entrega, verificações e limites](../../variacao-semantica-v1-2026-11-04.md). Geração de mídia e validação com modelo real seguem como próximas etapas; as evidências da pesquisa abaixo não mudam com a implementação.

## Entregáveis e como usar

1. Este relatório: evidências, conceitos, limites e prioridades.
2. [Catálogo de 28 formatos e execuções](catalogo-formatos.md): quando usar, como transformar e o que testar.
3. [Proposta do motor de variação](motor-proposto.md): entidades, fluxo, exemplos e critérios de aceitação.
4. [Fontes e cobertura](fontes.md): links, datas, nível de acesso e limitações.
5. [Base estruturada](base-conhecimento.json): eixos, formatos, evidências e regras para ingestão futura; ainda não conectada ao app.
6. [Memória curta](MEMORIA.md): ponto de entrada para retomar sem reler tudo.

## 1. O que a pesquisa permite afirmar

### Não existe um campeão universal de formato

O benchmark da Motion reúne **578.750 criativos, 6.015 contas e US$ 1,29 bi**, mas a janela é **01/09/2025–01/01/2026**, apesar do título “2026”. Seu vencedor é um anúncio com gasto ≥10× a mediana da conta e ≥US$ 500. O estudo explicitamente não mede ROAS, receita ou conversão. Portanto, usamos seus resultados como sinal de distribuição e capacidade de absorver verba, não como ranking de lucratividade. [S01 — metodologia e visão geral](https://runneth.com/library/research/creative-benchmarks-2026/).

| Recorte da Motion | Sinal publicado | Leitura correta |
|---|---:|---|
| Unboxing | 9,8% de hit rate | Frequência de outliers de gasto nesse formato |
| Banner centrado na oferta | 8,6% | Sinal sujeito ao peso da Black Friday na amostra |
| Demonstração | 8,1% | Boa candidata para mostrar o produto funcionando |
| Testemunhal | 6,5% | Não equivale a taxa de conversão do anúncio |

Os percentuais são de categorias do estudo, não probabilidades previstas para uma peça nossa. A página apresenta inconsistência entre sua ordenação textual e os valores da tabela; preservamos os valores publicados, sem copiar a ordenação como um ranking universal. [S02 — formatos visuais](https://runneth.com/library/research/creative-benchmarks-2026/top-visual-formats).

Em outra classificação, texto e imagem do produto com texto aparecem à frente de produções elaboradas. Isso justifica manter estáticos e peças simples no catálogo, mesmo com IA de vídeo disponível. Não se deve misturar “tipo de asset” com “formato narrativo” na mesma tabela de ranking. [S03 — tipos de asset](https://runneth.com/library/research/creative-benchmarks-2026/top-asset-types).

A própria Motion mostra diferenças entre verticais: saúde/bem-estar e moda têm combinações muito distintas. Nossa inferência: a recomendação deve ser condicionada a **oferta × público × objetivo × placement × evidência disponível**. [S04 — formatos por vertical](https://runneth.com/library/research/creative-benchmarks-2026/visual-formats-by-vertical).

### Podcast é uma opção real; “podcast de IA converte mais” segue não demonstrado

O estudo da She Converts, snapshot de 20/10/2026, reúne 8.107 anúncios de 120 anunciantes e 365 vídeos codificados. No recorte de sobrevivência, podcast chegou a 90 dias em 72% dos casos (n=18), selfie em 71% (n=69) e demo/B-roll em 71% (n=72). **Não há base para declarar podcast superior:** diferença pequena, amostra reduzida, anunciantes selecionados e duração no ar usada como proxy. A presença de avatares sintéticos duradouros também foi escassa nessa amostra, o que não prova que nunca funcionam. [S05 — estudo e limitações](https://sheconverts.com/best-ugc-ads).

Um caso brasileiro mostra produção de podcast com avatares e discute voz, sotaque e consistência de cenário. É evidência de viabilidade e problemas de execução, sem comparação de CPA/ROAS. [S20 — Maurício Leite, 22/10/2026](https://mauricioleite.com.br/blog/como-fazer-anuncio-formato-podcast-ia/).

**Decisão proposta:** incluir podcast no piloto, com controle de comparação, sem vendê-lo como formato comprovadamente mais lucrativo.

### Existe evidência favorável a IA, mas com contexto

A TikTok publica o caso Keyzar: +88% de CTR, +21% de ROAS e −40% no custo por adição ao carrinho, usando um conjunto de Product-to-Video, avatares, remix e TTS. A página consultada não explicita o ano do Q4 nem um experimento isolando cada componente. É um case selecionado pela plataforma, não prova de superioridade geral de avatar ou podcast. [S08 — Keyzar](https://ads.tiktok.com/business/en-US/inspiration/keyzar-symphony-ai-creatives-q4-performance).

O caso MySmile usa demonstrações de afiliados, Shop Ads, orgânico e lives, reportando ROAS de 3×. A mudança também envolve checkout e distribuição; não podemos atribuir o resultado exclusivamente ao criativo. A data do caso não está explícita. [S09 — MySmile](https://ads.tiktok.com/business/en-US/inspiration/mysmile-scales-distribution-with-tiktok-shop/).

**Inferência para o HookMill:** começar com produção híbrida — argumento reescrito por IA, prova real do produto e cenas geradas onde ajudam — permite testar sem substituir evidência por simulação.

### Gasto alto e atenção alta não bastam

O estudo brasileiro da Unite declara mais de 640 mil anúncios e R$ 1,2 bi analisados. Entre anúncios que receberam 10× mais verba que o típico da conta, **54% tinham custo por conversão maior**. A análise de criativos cobre set/2025–set/2026; é observacional e “conversão” depende do objetivo configurado, podendo incluir cadastro, conversa, instalação ou clique. Não é CPA de compra homogêneo. [S21 — estudo, gráficos e metodologia](https://research.unitebr.com/benchmark-criativo-black-friday-brasil-2026).

Em apps, a AppsFlyer já separava gasto, instalações por mil impressões e retenção no D7 em seu estudo **de 2025**, com dados de Q1/2024 a Q1/2025. Serve como base metodológica histórica: aquisição e qualidade do usuário são coisas distintas. Não é um resultado de 2026. [S22 — AppsFlyer](https://www.appsflyer.com/resources/reports/creative-optimization-report-2025/).

## 2. A taxonomia que o motor precisa conhecer

Taxonomia operacional proposta nesta pesquisa; não é uma classificação oficial de nenhuma plataforma.

| Eixo | Pergunta que responde | Exemplo de mudança |
|---|---|---|
| Público / persona | Para quem esse problema é relevante? | Quem trabalha em turnos → quem viaja a trabalho |
| Situação / ocasião | Quando a necessidade aparece? | Rotina normal → mudança de emprego |
| Dor | O que está difícil hoje? | Falta de tempo → dificuldade de manter consistência |
| Desejo | Qual progresso a pessoa procura? | Praticidade → autonomia |
| Objeção | Por que ela ainda não comprou? | “É caro” → “não vou conseguir usar” |
| Consciência | O que já sabe do problema e das soluções? | Descoberta → comparação → decisão |
| Ângulo | Qual razão central para escolher esta oferta? | Economizar tempo → reduzir desperdício |
| Mecanismo | Como a oferta entrega o benefício? | Lista organizada + planejamento; só o mecanismo verdadeiro |
| Prova | Por que acreditar? | Demo real → caso autorizado → dados documentados |
| Narrativa | Em que ordem o argumento se desenvolve? | Problema-solução → descoberta → comparação |
| Formato de apresentação | Que tipo de conteúdo a pessoa está vendo? | Talking head → conversa de podcast → tutorial |
| Mensageiro / ponto de vista | Quem explica e de qual posição? | Fundador → apresentador → cliente real |
| Hook | Qual entrada desperta atenção relevante? | Pergunta → cena → demonstração imediata |
| Execução audiovisual | Como a peça é materializada? | Ambiente, planos, ritmo, voz, B-roll, tipografia |
| Oferta e CTA | O que é proposto e qual o próximo passo? | Conhecer demo → comprar; preço só muda se autorizado |
| Idioma e contexto cultural | Como expressar o mesmo sentido localmente? | Exemplos, moeda, sotaque e referências de cada mercado |
| Placement / embalagem | Onde e em qual mídia será exibido? | Feed 4:5 → Reels 9:16; vídeo → estático |

**Distinções essenciais:**

- Público é o comprador pretendido; avatar pode significar personagem visual. Guardar em campos diferentes.
- Dor é a dificuldade; ângulo é o argumento escolhido a partir dela. “Falta de tempo” pode gerar praticidade, custo de oportunidade ou facilidade de começar.
- Hook é a abertura. Uma mesma tese admite muitos hooks; uma headline também pode mudar toda a tese, dependendo de seu conteúdo.
- “Podcast” é formato; “comparação” pode ser estrutura de argumento dentro de um podcast, imagem ou tutorial.
- “UGC” mistura origem e estética no uso cotidiano. Separar cliente real, creator contratado, funcionário, apresentador sintético e aparência caseira.
- “IA” é método de produção. Não é, por si, formato nem ângulo.
- Spark Ads e Partnership Ads são modalidades de distribuição/identidade, não uma linguagem visual exclusiva.
- Não há garantia de que um criativo destinado a uma persona será entregue apenas a ela.

Meta Blueprint descreve formato, mensagem, persona e hook como sinais de diversidade. O artigo técnico de Andromeda de 28/10/2026 descreve matching contextual, sinais de usuários e regras de elegibilidade; não fornece uma regra pública de “mude X% do vídeo” ou “mude o primeiro frame para ganhar novo público”. [S11 — Blueprint](https://certifications.facebookblueprint.com/student/activity/708857-ask-the-experts-session), [S10 — Meta Engineering](https://engineering.fb.com/2026/10/28/ml-applications/meta-andromeda-next-gen-ads-retrieval-gpu-co-design/).

## 3. As operações de variação

1. **Iteração de execução:** preserva persona e tese; altera hook, ritmo, duração ou montagem. Boa para aperfeiçoar uma peça.
2. **Transposição de formato:** preserva os fatos e a hipótese de venda; reestrutura o conteúdo para outra linguagem. Talking head → podcast precisa de perguntas, objeções e respostas, não apenas microfone no cenário.
3. **Expansão de mensagem:** muda dor, desejo, objeção, consciência ou ângulo. Pode exigir uma nova prova e outra página de destino.
4. **Expansão de público:** muda o contexto do comprador e verifica se a oferta realmente o atende. Não é find/replace de “mulher” por “gestante”.
5. **Conceito novo:** combina uma nova tese com nova encenação. Serve para exploração; o resultado não identifica sozinho qual componente causou a diferença.
6. **Localização:** adapta língua, contexto e exemplos mantendo a veracidade.

Essas operações podem se combinar. Um comando pode pedir “recontar para mães com pouco tempo, em podcast, explorando praticidade”. O sistema deve registrar **todos os eixos alterados** e o que ficou constante, mesmo quando a pessoa só faz um pedido em linguagem natural.

O painel da Motion de junho/2026 descreve famílias de anúncios, desconstrução de vencedores e expansão para outras personas e dores. É repertório de profissionais, não experimento causal. [S23 — painel, especialmente 03:27, 09:37 e 29:44](https://runneth.com/library/talk/scaling-ugc-ads-post-andromeda-one-winner-many-formats/).

## 4. Aplicando ao exemplo do usuário

“Mulheres que querem perder peso” ainda é amplo. Precisamos descobrir **por que**, **em qual situação**, **o que já tentaram** e **o que a oferta consegue entregar**.

| Possível recorte | O que realmente muda | Implicação para a peça |
|---|---|---|
| Rotina com pouco tempo | Situação + dor de execução | Mostrar como o processo cabe no dia |
| Já tentou e abandonou antes | Objeção + crença sobre consistência | Explicar como usar e quais limites existem |
| Busca recuperar confiança após uma separação | Contexto emocional + desejo | Falar em cuidado e autonomia, sem prometer que aparência recupera relacionamento |
| Gestação | Adequação clínica e elegibilidade da oferta | Não herdar automaticamente promessa de emagrecimento; validar produto e mensagem com orientação qualificada |
| Uma mesma pessoa reúne vários desses contextos | Interseção de necessidades | Uma história coerente pode carregar mais de uma identidade |

Gestação muda a avaliação da oferta: recomendações de peso e alimentação são específicas dessa fase. O exemplo entra na taxonomia como **adaptação que exige verificar adequação**, não como segmento aprovado para qualquer produto de perda de peso. [S24 — ACOG](https://www.acog.org/womens-health/faqs/obesity-and-pregnancy).

**“Um criativo para vários públicos” tem dois sentidos:** (a) um asset de origem gera uma família de peças específicas; (b) uma única peça conecta necessidades de mais de um grupo. O motor deve suportar ambos, sem transformar o segundo numa lista desconexa de públicos.

### Demonstração conceitual neutra

Oferta fictícia, usada só para explicar o modelo: app de planejamento de refeições, com cardápio semanal e lista de compras. Não contém promessa de emagrecimento.

| Variante | Público/contexto | Ângulo | Formato | Hipótese |
|---|---|---|---|---|
| Controle | Pessoas que planejam refeições | Reduzir decisões repetitivas | Talking head + tela do app | Explicação direta comunica o valor |
| V1 | Mesmo público | Mesmo ângulo | Podcast com apresentadores sintéticos identificados | A pergunta do host esclarece a objeção antes da demo |
| V2 | Quem trabalha em turnos | Adaptar o planejamento à rotina | Tutorial de tela | Ver a configuração torna a oferta mais concreta |
| V3 | Quem cozinha para a família | Organizar as compras | Cena de diálogo | A situação reconhecível aumenta relevância |
| V4 | Quem desperdiça ingredientes | Comprar de acordo com o plano | Comparação visual | A diferença de processo fica evidente |
| V5 | Quem abandonou outros apps | Facilidade de começar | FAQ com demonstração | Resolver uma objeção reduz incerteza |
| V6 | Mais de um desses grupos | Simplificar o planejamento | Montagem de três situações + mesma demo | Um benefício comum sustenta contextos diferentes |

São hipóteses ilustrativas. Nenhum resultado ou depoimento foi inventado para justificá-las.

## 5. Tendências relevantes para testar agora

Prioridade qualitativa, pela combinação de sinal, utilidade e viabilidade — não previsão numérica de ROAS.

1. **Demo/prova integrada ao argumento:** produto real aparece resolvendo a tarefa. Referências S02, S07 e S09.
2. **História pessoal e explicação com creator:** dar contexto ao problema e comprovar a relação com o produto. No vídeo de setembro/2026, Dara Denney enfatiza diagnóstico de personas, storytelling e educação; a transcrição foi lida por espelho, sem assistir ao vídeo. Relato de agência, com patrocínio. [S13 — transcrição](https://viewrankai.com/tools/youtube-transcript/4wM-i1cxtAM).
3. **Objeções explícitas e comparação:** explicar preço, esforço ou diferença frente à alternativa. A lista de abril/2026 de Dara inclui esse tipo de argumento junto de Reels nativos, listicles e animação assumidamente artificial. São relatos qualitativos. [S12 — transcrição](https://prepublish.ai/youtube-transcript/ePcEcT2PH8E).
4. **Texto sobre B-roll e estáticos de mensagem:** laboratório barato de comunicação, ainda exigindo confirmação no formato final. Referências S03 e S12.
5. **Podcast/entrevista com função clara:** usar perguntas para revelar mecanismo e responder objeções. Referências S05 e S20.
6. **Animação que se assume como ilustração:** personificação, metáforas e visualização de mecanismo como experimentos. Não apresentar uma animação como prova de resultado biológico. Referências S12 e S15.
7. **Criadores e comentários como pesquisa:** transformar perguntas reais em conteúdo; separar experiência autêntica de roteiro encenado. Referências S06, S13 e S14.
8. **Variação de contexto e momento de uso:** encontrar uma nova necessidade atendida pela mesma oferta, além de trocar idade ou rosto. Referências S13 e S23.

O relatório TikTok Next 2026 aponta busca de experiências reais, curiosidade e justificativas de valor. É previsão cultural e pesquisa da plataforma, não teste comparativo de CPA. Nossa aplicação: episódios concretos, explicação e produto contextualizado. [S06 — TikTok Next](https://ads.tiktok.com/business/library/TikTok_Next_2026_Trend_Report_NA.pdf).

## 6. O que Reddit e outras redes acrescentam

Reddit mostrou uma dor de operação particularmente relevante: como ligar hipótese, produção, resultado e próxima decisão sem manter dezenas de planilhas. Também trouxe contraexemplos à tese “só vídeo funciona” e listas de formatos de IA sem métricas. Usamos isso como descoberta de problemas e repertório, não como validação de performance. Há respostas de fornecedores promovendo seus produtos. [S14 — frameworks](https://www.reddit.com/r/FacebookAds/comments/1ukpo98/creative_frameworks_please_send_help/), [S16 — resultados relatados](https://www.reddit.com/r/FacebookAds/comments/1r9al50/what_creatives_are_actually_scaling_for_you_in/), [S15 — formatos de IA](https://www.reddit.com/r/FacebookAds/comments/1twjimp/what_are_the_top_ai_format_ads_you_have_tested_out/).

Perguntas de pesquisa para orientar o produto, adaptadas desses relatos e da nossa síntese — não citações literais:

- Mudou o ângulo ou só a primeira frase?
- Qual parte da peça foi observada e qual parte é interpretação da IA?
- O público aparece nos clientes reais ou só no briefing?
- A oferta é adequada ao novo contexto?
- Qual prova sustenta essa promessa?
- O argumento continua verdadeiro no novo formato?
- Essa peça recebeu verba suficiente para ser avaliada?
- O CTR aumentou junto com vendas ou só com curiosidade?
- O novo anúncio atrai clientes que permanecem ou pedem reembolso?
- Qual aprendizado merece entrar no próximo lote?

**Cobertura:** X tentou-se por busca e URL direta (403); Instagram por busca e perfil (429); posts TikTok bloqueados por robots. O navegador conectado também falhou ao criar abas. Não houve leitura direta de feeds dessas três redes. TikTok foi coberto por documentos/cases oficiais; Instagram por estudos de Meta/Reels e referências de profissionais. Detalhes e lacunas em [fontes.md](fontes.md).

## 7. Como decidir se uma variação funcionou

Protocolo proposto, a calibrar com os dados e orçamento da oferta:

1. Definir a pergunta antes de produzir: melhorar CPA? alcançar compradores adicionais? reduzir custo de produção? manter resultado com outro formato?
2. Separar **exploração de conceitos** de **experimento controlado**. Exploração pode mudar vários eixos; teste causal exige comparação apropriada, alocação e controle dos demais fatores.
3. Manter controle contemporâneo e registrar objetivo, placement, público, período, oferta e janela de atribuição.
4. Pré-definir verba máxima, tempo necessário ao ciclo de compra e diferença relevante. Evitar regras universais de “1.000 impressões”, “48 horas” ou “3 CPAs” como prova estatística.
5. Tratar baixo gasto como **inconclusivo**, não como anúncio ruim. Distribuição automática desigual confunde a comparação.
6. Olhar CPA/CAC e qualidade/receita; CTR e retenção ajudam a diagnosticar. Em lead gen: custo por lead qualificado e venda. Em apps: aquisição, ativação e retenção. Em e-commerce: margem, devoluções e recompra.
7. Registrar resultado com escopo: “funcionou nessa oferta, nesse mercado, nesse período”. Não promover para “formato campeão mundial”.

Para produtividade, medir também: tempo até peça utilizável, custo com tentativas, taxa de correção, custo por hipótese testada e custo total de encontrar vencedores. Render barato não garante experimento barato.

**Piloto recomendado:** escolher um anúncio próprio com resultado conhecido; extrair três teses apoiadas na oferta; criar seis conceitos distintos em dois públicos válidos e três formatos; escolher apenas os que o orçamento consegue avaliar. Não é obrigatório publicar toda a combinação cartesiana. Depois, iterar nos conceitos com sinal suficiente.

## 8. Como isso muda a implementação planejada

O contrato antigo de variação tem dois rótulos, ITERATION e DIVERSITY, fixados por tipo; a promessa de “público novo” é associada ao primeiro frame. Isso é insuficiente para o pedido atual. Proposta: manter compatibilidade, mas acrescentar descrição explícita dos eixos e da hipótese; não usar a aparência como prova de alcance incremental.

O inventário Fábrica de Anúncios de 04/11 avalia principalmente edição do material existente. As classificações “precisa gravar” ou “IA futura” pertencem àquele escopo. Aqui consideramos também gerar novas falas, cenas e personagens. Curtidas orgânicas do inventário continuam sem equivalência com conversão.

Não alteramos contratos nem código que o Claude está trabalhando. A especificação para a próxima implementação está em [motor-proposto.md](motor-proposto.md).

## 9. O que podemos projetar para 2027

Em 30/10/2026, a Forrester publicou uma previsão de renovada valorização de autoria humana, expertise verificável e conteúdo com proveniência. Trata-se de cenário futuro, não observação de 2027. [S18 — previsão](https://www.forrester.com/blogs/predictions-2027-humans-reclaim-content-creation-machines-dominate-content-consumption/).

A CreatorIQ pesquisou 2.000 respondentes de marcas e agências em nove países em jul–ago/2026; seu relatório 2026–2027 evidencia a importância de integrar conteúdo de creators aos processos e dados. É survey declarado por respondentes, não ensaio de formatos nem desempenho futuro medido. [S19 — relatório e metodologia](https://www.creatoriq.com/white-papers/state-of-creator-marketing-trends-2027).

**Nossas hipóteses para observar:** mais peças híbridas; mais reaproveitamento de prova e conteúdo autorizado; maior valor do diagnóstico de público e da memória de resultados; formatos de entretenimento sintético úteis em contextos específicos; saturação rápida de moldes genéricos. Nenhuma dessas hipóteses recebe selo de vencedor.

## 10. Limites e próximos dados necessários

- Não encontramos teste público controlado que eleja podcast de IA, entrevista de rua de IA ou drama de IA como melhor formato geral de 2026.
- Benchmarks misturam países, verticais, objetivos, janelas e critérios. Não agregamos seus percentuais como se fossem comparáveis.
- Uma transcrição ou artigo de criador não equivale a auditoria das contas citadas.
- Biblioteca pública prova existência e datas informadas; sozinha não confirma gasto contínuo, conversão ou lucro.
- Para sair de recomendação de mercado para recomendação própria, precisamos vincular cada peça a uma oferta, aos fatos verificáveis e aos seus resultados de campanha.
- Revalidar benchmarks e regras das plataformas antes de lançar a feature; atualizar a memória quando os testes reais contradisserem esta pesquisa.
