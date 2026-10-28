# Iterate: escolhas do lote e legenda preservada

Implementado localmente em 28/10, continuando a sessão Claude `6c072d22-f508-4a1a-89e8-a1748e917b5c`. Sem commit, push ou publicação nesta entrega.

- Quiz durante a análise: escolher objetivo/categorias ou deixar o HookMill escolher; respostas salvas por cliente e pré-marcadas no próximo lote.
- Até 16 candidatas planejadas; até 12 selecionadas. Editar respostas, remover e adicionar de volta recalcula a seleção sem outra chamada ao modelo. Só itens selecionados viram criativos e entram na estimativa.
- Rotas de respostas, seleção e preferências com isolamento por workspace e restrição de papel; lote já lançado não aceita alteração. Lotes antigos mantêm o plano existente.
- Legenda original preservada. Plano e render recalculam as mesmas faixas; mantém-se a área completa do vídeo para não cortar linhas que a análise deixou de medir. Cartões usam áreas livres da legenda e do rosto; HEADLINE testa várias posições. Sem espaço seguro, o template fica fora antes de gerar.
- Reparo tenta cortes válidos para completar quatro peças; nunca duplica cortes idênticos nem inventa texto. Material insuficiente resulta em lote menor com quantidade real e aviso.
- F1 ganha checagem de texto pós-render. `ITERATE_TEMPLATES=on` no `.env` local; o roteamento atual manda `template` para render local.
- **Gusta rejeitou os dois removedores de legenda.** A sonda foi interrompida; quatro pedidos já enviados somavam estimativa de US$ 0,70, a última dupla não foi enviada. Nenhuma opção de remoção com IA foi adicionada ao produto. F3 (novos avatares e remix pago) permanece separado e desligado; Q2 e categorias pagas ficam ocultas.

Validação executada:

- Typecheck dos cinco workspaces e lint web sem erros.
- API: 185 testes no recorte afetado; vídeo: 86 testes; integração: 22 testes; navegador: dois testes reais contra a API de teste, 1440 e 390 px. Tudo passou.
- Build web com Turbopack passou em `.next-build-v2` separado. O caminho alternativo Webpack falhou na exportação `msw/browser` preexistente; não foi usado como validação final.
- Amostras Remotion locais com o campeão real, fonte conferida por dimensões/duração, no instante de 12 s: `meme`, `news`, `direct_offer` e `HEADLINE`. Galeria: `video/out/legenda-preservada-2026-10-28/index.html`. São quadros, não uma prova de render do vídeo inteiro nem de Lambda atualizado.
- Migração aditiva `20261028000300_iterate_preferences` aplicada em `maquina_test` e `maquina`. Backup do desenvolvimento: `.infra/backups/maquina-2026-10-28-1808.sql.gz` (29 tabelas, 8.243 linhas).

Antes de publicar:

1. Aplicar a migração aditiva em produção com backup.
2. Publicar o bundle Remotion novo; o bundle atual de produção é anterior às mudanças de templates/layout. Incluir `template` em `RENDER_LAMBDA_KINDS` antes de ligar `ITERATE_TEMPLATES=on` na VPS.
3. Commit/push, deploy da API e web; confirmar fluxo com conta de teste em produção. Estas ações não foram executadas nesta entrega.
