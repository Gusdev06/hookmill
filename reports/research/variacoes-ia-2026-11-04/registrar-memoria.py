"""Registra somente a pesquisa de 04/11; --check lê, --apply acrescenta notas.

Alvos fixos, sem substituir conteúdo existente. Escrita fora do projeto exige
a permissão do sandbox. Não modifica código, contratos, campanhas ou serviços.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

ROOT = Path('/Users/gustagoat/Documents/AIS-OS')
HERE = Path(__file__).resolve().parent
BASE = 'projects/maquina-anuncios/reports/research/variacoes-ia-2026-11-04'
WIKI = 'wiki/trafego-criativos'
MARKER = '<!-- pesquisa-variacoes-ia-2026-11-04 -->'
SOURCE = 'fonte-pesquisa-variacoes-ia-2026-11-04'
REPORT = f'{ROOT}/{BASE}/README.md'
MEMORY = f'{ROOT}/{BASE}/MEMORIA.md'

def note(kind, tags, title, body):
    return f'---\ntipo: {kind}\ndata: 2026-11-04\ntags: [{tags}]\nfontes: [{SOURCE}]\n---\n\n# {title}\n\n{body.strip()}\n'

RAW = f'''---
tipo: pesquisa
data: 2026-11-04
tags: [hookmill, variacao-ia, sintese-de-pesquisa]
---

# Pesquisa de variações de anúncios com IA — síntese original da sessão

Fonte única desta ingestão: síntese produzida pelo Codex a pedido do Gusta em 04/11/2026; os estudos externos permanecem individualmente identificados no registro de fontes.

Pedido: investigar a amplitude de variação de ângulo, formato, público, dores e desejos, incluindo talking head convertido em conversa de podcast com IA, antes da próxima implementação do HookMill; alimentar a memória compartilhada enquanto Claude trabalha em outras features.

Entregáveis: [relatório]({REPORT}), [fontes e limites]({ROOT}/{BASE}/fontes.md), [catálogo]({ROOT}/{BASE}/catalogo-formatos.md), [proposta do motor]({ROOT}/{BASE}/motor-proposto.md), [base JSON]({ROOT}/{BASE}/base-conhecimento.json).

Síntese: 17 eixos independentes na representação; seis operações combináveis; 28 formatos/execuções e 24 referências selecionadas. Público, ângulo, hook, formato, mensageiro e método de produção são conceitos distintos. Transposição exige reescrita da estrutura; a oferta e suas provas não podem ser inventadas.

Qualidade de evidência: gasto e tempo no ar são proxies. Não foi estabelecido ranking universal de conversão; podcast sintético não demonstrou superioridade geral. Estudos datados de 2026 podem usar dados de 2025. Em 04/11/2026, 2027 permanece previsão. Resultado de negócio próprio é necessário para validar as hipóteses.

Cobertura: Reddit, documentos e estudos públicos; YouTube por transcrições indiretas; X/Instagram/TikTok nativos com limitações de acesso. Não foram assistidos vídeos completos nem consultadas métricas privadas. As datas, janelas e níveis de acesso estão em fontes.md.

Contradições com o histórico: hook não é sinônimo de ângulo; a ordem hook-primeiro não é universal; uma variável por vez só ajuda inferência causal com desenho e alocação adequados; explorar vários eixos é válido se a conclusão for sobre o conceito, sem isolar causalmente cada componente.

Estado: pesquisa concluída, conhecimento salvo localmente; proposta técnica ainda não implementada nem aprovada em detalhes. Sem geração paga, publicação, commit ou deploy. Próxima fatia sugerida: planejador semântico ligado à oferta/Brain; depois produção de formatos e aprendizado com resultados. As recomendações não substituem os contratos em implementação pelo Claude.
'''

NEW_FILES = [
    (f'{WIKI}/raw/2026-11-04-pesquisa-variacoes-ia.md', RAW),
    (f'{WIKI}/wiki/fontes/{SOURCE}.md', note('fonte', 'hookmill, pesquisa, variacao-ia', 'Pesquisa de variações com IA — 04/11/2026', f'''
Síntese original de pesquisa: amplia variação para mensagem, público e formato; evidencia limites de rankings de conversão.

Raw: `raw/2026-11-04-pesquisa-variacoes-ia.md`. [Relatório completo]({REPORT}) e [fontes]({ROOT}/{BASE}/fontes.md). Não é uma fonte primária de resultados de campanhas; distingue estudos, proxies, relatos e previsões.

Gerou [[variacao-semantica-de-criativos]] e [[transpor-talking-head-para-podcast]]. Complementa [[eixos-de-variacao-de-criativo]], [[variar-uma-alavanca-por-vez]] e [[gasto-do-gerenciador-como-proxy-de-performance]].

28 formatos e 17 eixos são uma proposta operacional, não categorias oficiais. Não houve teste próprio nem integração da base JSON ao produto. Cobertura direta das redes foi parcial; vídeos consultados por transcrição.
''')),
    (f'{WIKI}/wiki/conceitos/variacao-semantica-de-criativos.md', note('conceito', 'hookmill, variacao, publico, angulo', 'Variação semântica de criativos', f'''
Uma variação pode mudar a razão de compra e o contexto do comprador, além da aparência do anúncio.

Separar público, situação, dor, desejo, objeção, consciência, ângulo, mecanismo, prova, narrativa, formato, mensageiro, hook, execução, oferta/CTA, localização e placement. São 17 eixos da taxonomia proposta em [relatório]({REPORT}).

Ângulo = razão central para comprar. Hook = abertura. Formato = linguagem de apresentação. IA = método de produção. Trocar rosto não comprova novo público; trocar palavra não comprova novo ângulo.

Operações combináveis: iteração; transposição; expansão de mensagem; expansão de público; conceito novo; localização. Registrar eixos alterados e constantes. Uma peça pode reunir contextos distintos numa necessidade comum, ou originar várias peças específicas.

Nova persona exige adequação da oferta, linguagem, objeção e prova. O exemplo de gestação não autoriza herdar promessa genérica de emagrecimento; requer avaliação específica da oferta. Um apresentador sintético não cria experiência real de cliente.

Fonte: [[{SOURCE}]]. Conecta com [[eixos-de-variacao-de-criativo]], [[variar-uma-alavanca-por-vez]] e [[transpor-talking-head-para-podcast]]. Proposta para o HookMill; validação depende de testes por oferta.
''')),
    (f'{WIKI}/wiki/tecnicas/transpor-talking-head-para-podcast.md', note('tecnica', 'hookmill, podcast, roteiro, ia', 'Transpor talking head para podcast', '''
Transformar monólogo em podcast exige uma conversa que desenvolva o argumento e preserve os fatos da oferta.

1. Extrair tese, mecanismo, prova, objeção, CTA e condições do original.
2. Dar ao host uma dúvida relevante; abrir no trecho interessante da conversa.
3. Dar ao outro apresentador uma resposta que avance o entendimento, sem repetir o monólogo em duas vozes.
4. Inserir prova real quando a explicação precisar dela.
5. Planejar turnos, vozes, planos e reações com continuidade; permitir corrigir um turno isolado.
6. Conferir áudio, lipsync, personagem falando, legibilidade, produto e fidelidade factual.

Cenário de podcast não implica entrevista real, autoridade nem depoimento. Não fabricar endosso de programa ou experiência pessoal. A eficácia do formato permanece hipótese até resultado próprio; longevidade de anúncios externos não prova menor CPA.

Conecta com [[variacao-semantica-de-criativos]], [[transplantar-formato-entre-ofertas]], [[ugc-em-primeira-pessoa-sem-virar-depoimento]] e [[fonte-pesquisa-variacoes-ia-2026-11-04]].
''')),
    ('decisions/2026-11-04-variacao-ia-escopo-de-pesquisa.md', '''---
tipo: decisao
data: 2026-11-04
tags: [second-brain, hookmill, variacao-ia]
---

# Direção: ampliar o escopo da variação de anúncios com IA

## Contexto
Gusta quer iniciar a frente de variação com IA enquanto Claude trabalha nas demais features. Os exemplos incluem transformar talking head em podcast e explorar públicos, dores e motivações a partir de um criativo.

## Decisão do usuário
Pesquisar profundamente o espaço de variação e registrar o aprendizado na memória. A capacidade desejada vai além de headlines, avatares e moldes de edição. Buscar referências em redes sociais e outras fontes disponíveis.

## Por quê
A mesma oferta pode admitir argumentos, contextos de uso e apresentações diferentes. O produto precisa representar essas diferenças para produzir e aprender com intenção.

## Impacto e estado
Pesquisa concluída; proposta de 17 eixos, seis operações, 28 formatos e motor semântico documentada. Estas classificações e prioridades são recomendações do Codex, não decisões técnicas já aprovadas pelo usuário. Sem mudança no código ou contratos em andamento, sem geração paga ou publicação.

Próxima ação proposta: mapear o planejador aos objetos atuais de oferta/Brain e desenhar o primeiro fluxo de transposição. 2027 tratado como previsão; proxies não viram validação de conversão.

Relatório: `projects/maquina-anuncios/reports/research/variacoes-ia-2026-11-04/README.md`. Retomada: `MEMORIA.md` na mesma pasta. Conecta com [[STATUS]] e [[fonte-pesquisa-variacoes-ia-2026-11-04]].
'''),
]

APPENDS = [
    (f'{WIKI}/wiki/tecnicas/eixos-de-variacao-de-criativo.md', '''
## 04/11/2026 — Ampliação de escopo para o HookMill

A lista histórica acima descreve sobretudo a operação de edição spy; não esgota variação. O título menciona seis eixos, mas a tabela histórica já contém sete linhas. Preservada como registro, não como taxonomia completa.

[[variacao-semantica-de-criativos]] propõe 17 eixos, separando público, dor, ângulo, hook, formato e execução. **Hook e ângulo não são sinônimos.** Não há evidência para hook-primeiro como regra universal: a lacuna pode estar na oferta, prova, público ou argumento. Custos de edição também não são literalmente zero quando há render, infraestrutura ou trabalho.

Exploração pode mudar múltiplos eixos, com registro explícito; teste causal pede desenho apropriado. Talking head → podcast exige [[transpor-talking-head-para-podcast]]. Fonte: [[fonte-pesquisa-variacoes-ia-2026-11-04]].
'''),
    (f'{WIKI}/wiki/tecnicas/variar-uma-alavanca-por-vez.md', '''
## 04/11/2026 — Limite da inferência e espaço de exploração

A técnica histórica é útil para uma pergunta delimitada; a frase “sabe POR QUE ganhou” exige qualificação. Alterar uma variável não elimina diferenças de entrega, leilão, período ou amostra. Para inferir causa, precisamos de comparação controlada e incerteza adequada.

Exploração de conceitos pode mudar público, ângulo e formato juntos. Nesse caso, aprendemos sobre a combinação, sem atribuir isoladamente o resultado a um componente. Registrar todos os eixos alterados e manter anúncios com pouca entrega como inconclusivos. Não há um piso universal de horas, impressões ou múltiplos de CPA aplicável a todas as ofertas.

Fonte: [[fonte-pesquisa-variacoes-ia-2026-11-04]]. Conecta com [[variacao-semantica-de-criativos]] e [[gasto-do-gerenciador-como-proxy-de-performance]].
'''),
    (f'{WIKI}/wiki/conceitos/gasto-do-gerenciador-como-proxy-de-performance.md', f'''
## 04/11/2026 — Gasto continua sendo proxy, inclusive no mesmo conjunto

A afirmação histórica “quase sempre” não deve ser transferida como garantia ao HookMill: concentração de gasto não comprova menor CPA ou maior lucro. Comparar no mesmo conjunto reduz algumas diferenças, mas não torna alocação algorítmica um experimento aleatório.

Os benchmarks consultados distinguem outlier de gasto e custo por conversão. A biblioteca pública acrescenta ainda outro sinal, duração informada no ar, que não comprova gasto contínuo ou venda. Ver [metodologias S01/S05/S21]({ROOT}/{BASE}/fontes.md).

Guardar separadamente referência popular, anúncio com alta distribuição e resultado comercial comprovado. Preservar objetivo, janela, atribuição e qualidade da conversão. Baixa entrega permanece inconclusiva. Fonte: [[fonte-pesquisa-variacoes-ia-2026-11-04]]; conecta com [[variacao-semantica-de-criativos]].
'''),
    (f'{WIKI}/index.md', '''
## Pesquisa 04/11/2026 — Variação de anúncios com IA

### Conceitos
- [[variacao-semantica-de-criativos]] — público, motivação, argumento e formato representados separadamente; 17 eixos propostos.
- [[gasto-do-gerenciador-como-proxy-de-performance]] — complemento: gasto e longevidade não comprovam lucro, mesmo no mesmo conjunto.

### Técnicas
- [[transpor-talking-head-para-podcast]] — reescrever beats como conversa, preservar fatos e planejar turnos.
- [[eixos-de-variacao-de-criativo]] — histórico ampliado; hook e ângulo separados; ordem hook-primeiro não universal.
- [[variar-uma-alavanca-por-vez]] — distinção entre exploração de conceitos e inferência causal.

### Fontes
- [[fonte-pesquisa-variacoes-ia-2026-11-04]] — 24 referências com limites de acesso, 28 formatos e proposta para HookMill; 2027 é previsão.
'''),
    (f'{WIKI}/log.md', '''
## 2026-11-04 — Pesquisa de variações de anúncios com IA (HookMill)
- Fonte única de ingestão: `raw/2026-11-04-pesquisa-variacoes-ia.md`, síntese original com registro separado das referências externas.
- Criadas [[fonte-pesquisa-variacoes-ia-2026-11-04]], [[variacao-semantica-de-criativos]] e [[transpor-talking-head-para-podcast]].
- Complementadas [[eixos-de-variacao-de-criativo]], [[variar-uma-alavanca-por-vez]] e [[gasto-do-gerenciador-como-proxy-de-performance]]; histórico preservado e divergências explicitadas. Índice atualizado por acréscimo.
- Pesquisa concluída; proposta não implementada. Sem geração paga, publicação ou métricas próprias. Acesso direto a X/Instagram/TikTok limitado; YouTube via transcrição. 2027 permanece previsão.
'''),
    ('STATUS.md', f'''
## Sessão 04/11/2026 — HookMill: pesquisa de variações com IA concluída (Codex)
- **Direção do Gusta:** variação inclui ângulo, público, dores e formato, inclusive talking head → conversa de podcast com IA. Pesquisa em paralelo às outras features do Claude.
- **Entregue:** 17 eixos, seis operações combináveis, 28 formatos/execuções, 24 referências selecionadas com qualidade/limites e base JSON. [Relatório]({BASE}/README.md) · [retomada curta]({BASE}/MEMORIA.md).
- **Aprendizado:** gasto/longevidade não comprovam lucro; podcast de IA é hipótese de teste; 2027 é previsão. Memória histórica ampliada sem apagar os casos anteriores.
- **Estado:** pesquisa e memória registradas; base ainda não integrada ao app; código/contratos existentes preservados. Sem geração paga, commit ou deploy.
- **Próxima ação proposta:** mapear planejador semântico às entidades atuais e especificar o primeiro fluxo de transposição. Prioridades técnicas ainda são recomendações, não aprovação do usuário. [Direção registrada](decisions/2026-11-04-variacao-ia-escopo-de-pesquisa.md).
'''),
    ('decisions/log.md', '''
## 2026-11-04 — HookMill: escopo amplo de variação com IA e pesquisa antes da implementação
- **Direção do Gusta:** investigar ângulo, público, dor, desejo e formato; incluir talking head → podcast com IA; alimentar memória enquanto Claude trabalha nas outras features.
- Pesquisa concluída e registrada em `projects/maquina-anuncios/reports/research/variacoes-ia-2026-11-04/`. Taxonomia e prioridades são propostas do Codex, sem aprovação técnica presumida. Sem alteração de produção.
- Contexto e impacto: [[2026-11-04-variacao-ia-escopo-de-pesquisa]]. Não substitui decisões de Ad Radar, templates ou editor universal.
'''),
    ('archives/marketing-workspace/brain/daily/2026-11-04.md', f'''
## Sessão — Pesquisa de variações com IA (Codex)
- **Trabalho:** pesquisa pública de formatos, ângulos e públicos; 24 referências selecionadas, 17 eixos, seis operações, 28 formatos; distinção entre performance, proxy e previsão.
- **Direção do usuário:** ampliar variação além de headline/molde, incluindo podcast e expansão de contexto. [[2026-11-04-variacao-ia-escopo-de-pesquisa]].
- **Entregáveis:** [relatório]({REPORT}), [retomada]({MEMORY}), catálogo, proposta do motor, fontes e base JSON na mesma pasta. Wiki alimentado por [[fonte-pesquisa-variacoes-ia-2026-11-04]].
- **Pendências:** integração do planejador, escolha/teste de provedor e validação com campanhas próprias. Não foi estabelecido ranking universal; cobertura direta das redes foi parcial; 2027 é previsão.
- **Próxima ação proposta:** mapear dados da oferta/Brain e primeiro fluxo de transposição. Sem código de produção alterado, geração paga, publicação, commit ou deploy.
'''),
    ('archives/marketing-workspace/brain/MOC.md', f'''
## HookMill — pesquisa de variações com IA (04/11/2026)
- [Retomada da pesquisa]({MEMORY}) — 17 eixos, 28 formatos, 24 referências e plano de implementação proposto.
- [[fonte-pesquisa-variacoes-ia-2026-11-04]] → [[variacao-semantica-de-criativos]] e [[transpor-talking-head-para-podcast]].
- [[2026-11-04-variacao-ia-escopo-de-pesquisa]] — direção do usuário; recomendações técnicas ainda não aprovadas.
'''),
]

DAILY = 'archives/marketing-workspace/brain/daily/2026-11-04.md'
DAILY_HEADER = '---\ntipo: daily\ndata: 2026-11-04\ntags: [second-brain, daily]\n---\n\n# Registro de sessões — 04/11/2026\n'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument('--check', action='store_true')
    choice.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    operations = [('create', p, t) for p, t in NEW_FILES] + [('append', p, t) for p, t in APPENDS]
    # Verificar todos os alvos antes de escrever qualquer um.
    for mode, rel, text in operations:
        path = ROOT / rel
        if not path.resolve().is_relative_to(ROOT):
            raise RuntimeError(f'Alvo fora da raiz: {path}')
        if mode == 'create' and path.exists() and path.read_text() != text:
            raise RuntimeError(f'Nota nova já existe com outro conteúdo: {path}')
        if mode == 'append' and not path.exists() and rel != DAILY:
            raise RuntimeError(f'Alvo de acréscimo não existe: {path}')
    result = []
    for mode, rel, text in operations:
        path = ROOT / rel
        before = path.read_bytes() if path.exists() else b''
        if mode == 'create':
            exists = path.exists()
            state = 'already_present' if exists else 'create'
            if args.apply and not exists:
                path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('x') as handle:
                    handle.write(text)
        else:
            exists = path.exists()
            state = 'already_present' if MARKER.encode() in before else 'append'
            if args.apply and state == 'append':
                payload = ('' if exists else DAILY_HEADER) + '\n\n' + MARKER + '\n' + text.strip() + '\n'
                flags = os.O_WRONLY | os.O_APPEND
                if not exists:
                    flags |= os.O_CREAT | os.O_EXCL
                fd = os.open(path, flags, 0o644)
                try:
                    raw = payload.encode()
                    written = os.write(fd, raw)
                    if written != len(raw):
                        raise RuntimeError(f'Escrita parcial: {path}')
                    os.fsync(fd)
                finally:
                    os.close(fd)
        after = path.read_bytes() if args.apply else before
        result.append({'path': str(path), 'action': state, 'beforeSha256': digest(before), 'afterSha256': digest(after) if args.apply else None})
    if args.apply:
        (HERE / 'memoria-registro.json').write_text(json.dumps({'date': '2026-11-04', 'operations': result}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': 'apply' if args.apply else 'check', 'targets': len(result), 'operations': [{'path': r['path'], 'action': r['action']} for r in result]}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
