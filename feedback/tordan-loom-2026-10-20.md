# Feedback do Tordan — 2 Looms de 20/10/2026

Fonte: dois vídeos no Loom gravados pelo Tordan em cima do app em produção (`hookmill-app.vercel.app`, cliente "New client", login como Agency admin). Transcritos com `/watch` (Whisper Groq) em 21/10/2026.

- Vídeo 1 (2:46): https://www.loom.com/share/f04e1d74f7c24286a51b16620acac0d8 — cópia local em `~/Downloads/loom-hookmill/HookMill - 20 October 2026.mp4`
- Vídeo 2 (4:53): https://www.loom.com/share/96abd346337a4c4fb26ea278ff1a39ca

Status: **proposta** do Tordan. Nada aqui foi aprovado nem implementado ainda; o Gusta decide o que entra.

## Resumo em uma linha

Design aprovado ("tá interessante"). O problema é a **entrada**: hoje a pessoa cai direto no sistema cheio e fica overwhelmed. Ele quer registro → pergunta agência/próprio → wizard guiado → tour obrigatório que já mostra valor com dados do Meta. E, acima de tudo, **quer testar criar e lançar um anúncio de verdade** o quanto antes.

## Vídeo 1 — Onboarding (fluxo de entrada)

1. **[0:24] Bug/UX:** tentou voltar na tela de onboarding e não conseguiu. Hoje não há caminho de volta pro wizard de setup.
2. **[0:36–1:15] Fluxo proposto:** registra a conta → abre **só o wizard** (não o sistema inteiro). Um passo por tela: site → próximo → conexão (Meta) → próximo. Com **barra de progresso em %** até finalizar. Só depois entra no app.
3. **[1:17–2:05] Passo novo antes do wizard:** logo após o cadastro, perguntar **"vai rodar como agência ou pra você mesmo?"**
   - Próprio: esconde o seletor de cliente / "All clients" na sidebar (ele apontou o seletor "New client · Client workspace").
   - Agência: mostra a área de clientes, onde cadastra os clientes dele depois.
4. **[2:07–2:15] Pagamento:** a conexão de pagamento fica pra depois, mas a **arquitetura** (plano agência × próprio) já deve nascer pronta.
5. **[2:24] Ordem final:** Registro → Agência ou anúncios próprios → Wizard de integração.

## Vídeo 2 — Tour pós-integração e prioridade

1. **[0:39–0:54] Tour guiado obrigatório** na primeira entrada (estilo product tour, passo a passo). **Sem skip** no primeiro tour.
2. **[1:00–1:34] Parada 1 do tour = Brain.** Como o wizard já coletou dados do negócio, mostrar o Brain sendo montado ("já estamos criando o seu cérebro"), com o "62% complete" subindo. Ele sugeriu o Brain em **3D**.
3. **[1:42–2:50] Parada 2 = Iterate a winner.** Com a integração Meta feita, puxar os anúncios da conta e **mostrar de cara um vencedor real** ("esse anúncio aqui tá com boas métricas, vamos iterar"). Entregar valor antes de qualquer tela vazia. Se não houver anúncio, pula.
4. **[2:52–3:05] Parada 3 = New concepts** (criar conceito do zero).
5. **[3:13–3:29] Parada 4 = Eddy** ("converse com o Eddy pra puxar qualquer informação da campanha").
6. **[3:29–4:02] Parada 5 = Home.** Pediu pra **repensar a Home**: hoje mostra "Waiting on you" vazio e skeletons; ele quer uma visão de performance dos anúncios, mais genérica, e pediu pra pensarmos o que adicionar.
7. **[4:15–4:49] PRIORIDADE REAL (acima de tudo):** "ao invés de complicar, eu quero testar a criação do anúncio". Quer **subir o anúncio dele, fazer a integração toda e lançar a primeira campanha** pelo HookMill. Pediu pra adiantar isso; o feedback fino vem depois desse teste.

## Lista de ação (ordem sugerida)

| # | Item | Dono provável | Tipo |
|---|------|---------------|------|
| 1 | Fluxo ponta a ponta: subir anúncio → wizard 7 etapas → render → **publicar campanha no Meta** da conta do Tordan | maquina-backend + maquina-ia + maquina-video | prioridade dele |
| 2 | Pergunta agência × próprio após cadastro; esconder seletor de cliente no modo próprio | maquina-design → maquina-frontend + backend | onboarding |
| 3 | Pós-registro abre só o wizard de setup, com barra de progresso, sem cair no app | maquina-design → maquina-frontend | onboarding |
| 4 | Botão/rota pra voltar ao wizard de setup (bug relatado) | maquina-frontend | correção |
| 5 | Tour obrigatório na 1ª entrada: Brain → Iterate a winner (com vencedor real do Meta) → New concepts → Eddy → Home | maquina-design → maquina-frontend | onboarding |
| 6 | Redesenhar Home como painel de performance | maquina-design | design |
| 7 | Brain em 3D (nice to have; já existe `/3d-brain` local como referência) | maquina-design | depois |
| 8 | Arquitetura de plano agência × próprio pronta pra plugar pagamento | maquina-arquiteto | contrato |

Observação: item 5 depende de a integração Meta (Campaigns hoje é "preview of what comes… needs the Meta connection, which isn't built yet") estar real. Item 1 também. A integração Meta é o gargalo dos dois pedidos.
