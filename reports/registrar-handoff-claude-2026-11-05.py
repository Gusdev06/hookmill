from pathlib import Path

root = Path('/Users/gustagoat/Documents/AIS-OS')
marker = '<!-- hookmill-handoff-claude-2026-11-05 -->'
note = '''
## 05/11/2026 — HookMill: handoff do Codex para Claude
- Pedido explícito do Gusta: salvar tudo para o Claude continuar e encerrar a participação do Codex. Nenhuma nova implementação ou geração iniciada neste encerramento.
- Ponto de entrada: `projects/maquina-anuncios/CLAUDE.md` → `docs/handoffs/templates-ia-2026-11-05.md`. Handoff contém decisão de UX, arquitetura/arquivos, pesquisa, testes, runtime histórico, cuidados com trabalho concorrente e sequência de retomada.
- Fluxo vigente: Templates → Com IA → formato → campeão → Gerar vídeo; plano e produção em background. FAQ, podcast solo e conversa de duas pessoas conectados. Templates DRAFT disponíveis para equipe, sem preço comercial presumido.
- Evidências técnicas da sessão de 04/11 salvas; testes não foram reexecutados no handoff. Nenhuma geração paga real validada, nenhum commit/push/deploy por esta frente. Próximo passo técnico: avaliar geração real autorizada com campeão e aferir qualidade/custo; depois precificar/liberar comercialmente.
'''
for path in [root / 'STATUS.md', root / 'decisions/log.md', root / 'archives/marketing-workspace/brain/daily/2026-11-05.md']:
    existing = path.read_text(encoding='utf-8') if path.exists() else ''
    if marker not in existing:
        with path.open('a', encoding='utf-8') as output:
            output.write('\n\n' + marker + '\n' + note)
    print(f'Registrado: {path.name}')

status = root / 'STATUS.md'
text = status.read_text(encoding='utf-8')
prefix = '| HookMill (ex-Máquina de Anúncios) — **foco desde 05/10** | '
update = '**05/11 — handoff Codex → Claude:** Templates com IA implementado localmente, com produção em background; QA com mídia simulada e montagem Remotion real aprovados. Geração paga real e preço comercial pendentes. Entrada: [handoff](projects/maquina-anuncios/docs/handoffs/templates-ia-2026-11-05.md). Os registros anteriores desta célula são históricos. · '
if prefix in text and update not in text:
    status.write_text(text.replace(prefix, prefix + update, 1), encoding='utf-8')
    print('Visão vigente de HookMill atualizada; histórico preservado.')
