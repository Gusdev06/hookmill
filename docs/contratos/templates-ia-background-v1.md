# Templates com IA — produção em background (04/11/2026)

Pedido do Gusta: escolher o formato em Templates / With AI, escolher o campeão e gerar. O planejamento semântico é interno; não existe aprovação intermediária de roteiro. A revisão é do vídeo pronto, antes de publicar.

- Um clique explícito em Gerar autoriza leitura, planejamento, elenco, voz, lipsync e montagem. `POST /ad-templates/:slug/use` recebe `generation: {requestId, expectedCredits}` para esses templates. Repetir a mesma chave e corpo devolve o mesmo lote; reutilizar com outro corpo é conflito. As demais modalidades mantêm seu fluxo.
- Primeiros formatos produzíveis: FAQ apresentado, podcast solo e conversa de podcast com dois participantes. Cada template entrega um MP4 vertical, com vozes/rostos consistentes por participante, cortes entre falas e legendas. Não libera cards cujo motor ainda não está conectado.
- `AI_VIDEO` identifica a peça; o plano e a seleção ficam persistidos. A oferta do workspace é a fonte dos claims. Mudança de público não é implícita ao mudar formato. Conceitos com requisitos de prova/asset/elegibilidade pendentes não seguem para produção automaticamente.
- Reserva de créditos e criação do lote são atômicas, antes do trabalho pago. Preço alterado, saldo insuficiente ou duplicata não dispara produção. Catálogo sem preço permanece restrito à equipe; publicação comercial exige preço no admin. Falhas devolvem créditos pelo ledger existente.
- Processo durável: jobs, elenco, cenas, tarefas dos provedores e renders persistidos. Fechar a página não cancela. Recuperação nunca repete chamada paga de resultado desconhecido: reconcilia tarefas conhecidas ou encerra com falha explícita. Retry é uma nova ação do usuário.
- `/ai-variations` redireciona para `/templates?tab=ai`; o item separado sai do menu. A tela do lote IA mostra progresso/resultado, sem Plan.
- Migração aditiva: enum `AI_VIDEO`, rosto/voz opcionais por cena. Não muda os fluxos de edição, fontes da Meta nem editor em desenvolvimento paralelo.
- Verificação: fontes isoladas por workspace, idempotência, reserva/estorno, ordem de participantes, recuperação e arquivo final. Testes usam provedores fake; execução paga real depende do orçamento autorizado.
