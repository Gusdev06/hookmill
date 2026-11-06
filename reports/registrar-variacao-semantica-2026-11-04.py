"""Registra somente a entrega do planejador v1, acrescentando notas sem reescrever histórico."""
from pathlib import Path
import json
import os

ROOT = Path('/Users/gustagoat/Documents/AIS-OS')
PROJECT = ROOT / 'projects/maquina-anuncios'
MARKER = '<!-- variacao-semantica-v1-implementada-2026-11-04 -->'
REPORT = 'projects/maquina-anuncios/reports/variacao-semantica-v1-2026-11-04.md'
CONTRACT = 'projects/maquina-anuncios/docs/contratos/variacao-semantica-v1.md'
COMMON = f'''Gusta autorizou começar o desenvolvimento após a pesquisa. Primeira etapa implementada localmente: `/ai-variations`, API e persistência de três propostas com público, ângulo, formato, mudanças antes/depois, roteiro, fontes, requisitos, histórico e exportação. Catálogo inicial: demo, FAQ, estático, podcast solo/duplo e narrado. Reutiliza Job; sem migração.

Validação: 18 testes unitários + 4 de integração HTTP/PostgreSQL, sete verificações de navegador desktop/celular/EN/PT, typechecks API/contratos/web e lint passaram. Simulação explícita; adaptador real implementado, ainda sem chamada paga de validação. QA isolado encerrado e fixture removida. Sem mídia gerada, commit, deploy ou publicação. Mudanças simultâneas do Claude preservadas.

Acesso de geração INTERNAL nesta primeira etapa; `AI_VARIATIONS_ENABLED` controla a disponibilidade. Não representa liberação comercial. Próximo passo: qualidade com provedor/criativos reais, edição/seleção de proposta e produção de mídia orçada por turnos. Não recomeçar o planejador: ele já existe. [Entrega]({REPORT}) · [Contrato]({CONTRACT}).'''
entries = {
    ROOT / 'STATUS.md': '## Sessão 04/11/2026 — HookMill: planejador de variações com IA implementado (Codex)\n\n' + COMMON,
    ROOT / 'decisions/log.md': '## 2026-11-04 — HookMill: desenvolvimento de variações com IA iniciado\n\n**Pedido do Gusta:** “VAMOS COMECAR A DESENVOLVER?” após a pesquisa. O escopo da primeira entrega foi definido na implementação; não confundir com aprovação de preço ou geração paga.\n\n' + COMMON,
    ROOT / 'archives/marketing-workspace/brain/daily/2026-11-04.md': '## Sessão — Implementação da variação semântica v1 (Codex)\n\n' + COMMON,
    ROOT / 'decisions/2026-11-04-variacao-ia-escopo-de-pesquisa.md': '## Atualização — desenvolvimento autorizado e primeira etapa entregue\n\nO estado histórico acima descreve o término da pesquisa. Em seguida, Gusta pediu explicitamente para começar o desenvolvimento.\n\n' + COMMON,
}
receipt = []
for path, note in entries.items():
    previous = path.read_text(encoding='utf-8')
    if MARKER in previous:
        receipt.append({'path': str(path), 'action': 'already_present'})
        continue
    payload = ('\n\n' + MARKER + '\n' + note + '\n').encode('utf-8')
    fd = os.open(path, os.O_WRONLY | os.O_APPEND)
    try:
        written = os.write(fd, payload)
        if written != len(payload):
            raise RuntimeError(f'Gravação parcial: {path}')
    finally:
        os.close(fd)
    receipt.append({'path': str(path), 'action': 'appended'})
(PROJECT / 'reports/variacao-semantica-v1-memoria-registro.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt, ensure_ascii=False, indent=2))
