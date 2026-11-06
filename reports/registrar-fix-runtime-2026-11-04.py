from pathlib import Path
import os

root = Path('/Users/gustagoat/Documents/AIS-OS')
marker = '<!-- variacao-ia-runtime-fix-2026-11-04 -->'
note = '''
## 04/11/2026 — HookMill: erro de carregamento da Variação IA corrigido
- A captura do Gusta mostrou dois “Esse item não existe mais”. Causa: frontend atualizado, API 3001 ainda no build de 14:05, sem as rotas novas (404). Não houve exclusão de anúncios.
- Atualizado o runtime local às 16:11 com build estável anterior + módulo semântico. PID 50251, `api/dist/main.js`; log `projects/maquina-anuncios/testes/.cache/semantic-runtime/api.log`. Zero jobs ativos antes do restart; `.env` preservado; sem geração paga, migração ou deploy remoto.
- Build global estava incompleto por mudanças concorrentes do Ad Radar; fontes preservadas. Snapshot anterior e compilação não promovida em `testes/.cache/semantic-runtime/`. Quando a outra frente compilar, retomar o build normal; o import do módulo já está no código fonte.
- Frontend aguarda configuração e mostra um aviso único com retry se ela falhar. Typecheck web e lint passaram. Na própria aba/conta do Gusta: erros sumiram, menu apareceu, formulário habilitado e dois anúncios analisados no seletor. Nenhuma proposta gerada.
- Relatório: `projects/maquina-anuncios/reports/variacao-semantica-fix-runtime-2026-11-04.md`. Aprendizado: QA isolado não prova que a API em execução do usuário foi atualizada; validar também esse runtime.
'''
for path in [root / 'STATUS.md', root / 'archives/marketing-workspace/brain/daily/2026-11-04.md']:
    if marker in path.read_text(encoding='utf-8'):
        print(f'Já registrado: {path.name}')
        continue
    content = ('\n\n' + marker + '\n' + note).encode('utf-8')
    fd = os.open(path, os.O_WRONLY | os.O_APPEND)
    try:
        if os.write(fd, content) != len(content):
            raise RuntimeError('Gravação parcial')
    finally:
        os.close(fd)
    print(f'Registrado: {path.name}')
