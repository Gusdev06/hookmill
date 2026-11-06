from pathlib import Path
import os

root = Path('/Users/gustagoat/Documents/AIS-OS')
marker = '<!-- hookmill-ai-templates-background-2026-11-04 -->'
note = '''
## 04/11/2026 — HookMill: Templates IA produz vídeo em background
- Decisão explícita do Gusta: a tela separada de planos era desnecessária. Fluxo vigente = Templates / Com IA → escolher formato → selecionar campeão → Gerar. Planejamento, elenco, voz, lipsync e montagem automáticos; revisão do vídeo pronto antes de publicar. `/ai-variations` agora redireciona para a aba; saiu do menu.
- Conectados FAQ (F04), podcast solo (F09) e conversa com duas pessoas (F10). Um MP4 9:16 por pedido, rostos/vozes consistentes por participante. Idempotência, reserva/estorno e recuperação sem repetir chamadas pagas incertas. Catálogo inicial DRAFT sem preço, só equipe; publicar comercialmente exige precificar no admin.
- 22 testes semânticos/produção, 432 regressões e 7 integrações passaram. Remotion real local montou MP4 1080×1920 com áudio, 14,144 s, usando mídia simulada. Navegador confirmou a jornada, reload, reprodução e mobile sem overflow. Typechecks, build API e lint passaram.
- API local 3001 atualizada com build completo (PID 41641), substituindo o snapshot provisório do planejador. Migração aditiva com backup `maquina-2026-11-04-2235.sql.gz`; zero trabalhos ativos antes do restart. QA isolado encerrado e fixtures removidas. Sem chamadas pagas reais, publicação, commit, push ou deploy remoto.
- Próximo passo: avaliar um vídeo com campeão real via UI, mediante geração real autorizada; preço comercial e qualidade real ainda não aferidos. Evidências: `projects/maquina-anuncios/reports/templates-ia-background-2026-11-04/README.md`; contrato: `projects/maquina-anuncios/docs/contratos/templates-ia-background-v1.md`.
'''
for path in [root / 'STATUS.md', root / 'archives/marketing-workspace/brain/daily/2026-11-04.md', root / 'decisions/log.md']:
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
