# Onboarding com o Eddy (conversa): nota de UX + o que muda no backend
Data: 2026-10-31 · Status: **protótipo pra testar a ideia, aguarda o Gusta** · Dono: maquina-design
Mockup: `design/mockup-onboarding-eddy.html` (não publicado). A barra "Prototype" pula entre os 9 momentos e troca Desktop / Phone 390; dá pra percorrer clicando nos botões da conversa. Dados são exemplo.
Pedido do Gusta 31/10: "testar o onboard via chat, conversacional, e quem vai fazer o onboard vai ser o Eddy".

## A ideia em 5 linhas
- Mesmo conteúdo do wizard de hoje (site → negócio → Meta → oferta → público → metas), **na ordem de uma conversa**: o Eddy pergunta, a pessoa cola o site, o Eddy mostra o que leu em **cartões editáveis na própria mensagem** e a pessoa confirma.
- **Não é chat livre.** Cada mensagem do Eddy tem um cartão com a ação daquele momento (um lima só, o da mensagem ativa). As mensagens passadas viram "Confirmed". O campo de texto embaixo responde só à pergunta atual (ex.: colar o site, digitar a faixa).
- À direita, **"Mooncloth's Brain"** (painel tinta) enche conforme cada cartão é confirmado: âmbar "read, waiting for you" enquanto o Eddy leu mas a pessoa não confirmou, lima quando confirmou. O % é o mesmo `brainCompleteness()` (13 itens); Meta e kit aparecem mas não contam.
- Ordem: Site → Leitura (espera honesta com checklist e beam) → Negócio → Oferta + público + provas → Meta (botão Facebook, escolher conta com saúde) → Vencedor encontrado + meta de CPA e teto → Kit da marca (logo e cores lidos do site, upload de arquivos e vídeo demo no chat, continua em segundo plano) → Pronto (lima "Iterate my winner", "Go to Home"; o tour segue igual).
- Celular: o painel vira uma faixa "Brain ▬▬ 23 %" sob o topo; tocar abre como folha de baixo.

## Do Superscale, o que peguei e o que não
- **Peguei:** ler o site e trazer logo/cores sem perguntar; pedir o que falta e seguir sem ele se a pessoa pular ("Proof can wait"); fechar com o próximo passo concreto (o vencedor), não com "pronto".
- **Não peguei:** vários agentes, chat aberto, "modo Auto". Aqui é um agente só, com roteiro fixo, e tudo o que ele escreve vira campo editável.

## Backend: o que o chat reaproveita
| Momento | Endpoint atual | Nota |
|---|---|---|
| Ler o site | `POST /offers/extract {url}` → job; `GET /jobs/:id` (polling 2 s) | o checklist usa as páginas do job (`readMeta`/`ExtractChecklist`) |
| Negócio | `PATCH /workspace {name, industry, market, resultType, websiteUrl, brandColor}` | a leitura já sugere `business.{industry, market, brandColor}` |
| Oferta, público, provas, notas | `POST /offers` (com `readMeta`) / `PATCH /offers/:id` | mesmo `applyMutate` do `business-step.tsx` |
| Meta | `POST /meta/connect {returnTo}` → redirect; `GET /meta/options`; `PUT /meta/selection`; `POST /meta/health` | o redirect sai da página: a conversa **precisa voltar no mesmo ponto** (ver "novo" item 1) |
| Vencedor | `GET /meta/summary`, `GET /meta/ads?verdict=WINNER&limit=1` | igual ao passo 6 de hoje |
| Meta de CPA e teto | `PATCH /workspace {targetCpa, monthlySpendCapUsd}` | existe desde 29/10 |
| Passo salvo | `PATCH /workspace {onboardingStep}` | os 9 momentos mapeiam nos 6 passos de hoje (1 site/negócio, 2 Meta, 3 oferta, 4 público, 5 metas, 6 fim) |
| Concluir | `POST /workspace/onboarding/complete` | igual; o tour não muda |

## Backend: o que é novo
1. **Transcrição derivada, não guardada (recomendado).** A conversa é remontada a partir do estado (workspace + oferta + conexão Meta + kit + `onboardingStep`): cada momento confirmado vira a mensagem "Confirmed". Assim a volta do redirect da Meta, o "Save and exit" e outro aparelho caem no ponto certo **sem tabela de mensagens**. Custo backend: zero. Precisa só de um campo pra "o que já foi confirmado" que hoje não existe: `onboarding.confirmed: ('business'|'offer'|'meta'|'goals'|'kit')[]` no `Workspace` (PATCH com `confirm: 'business'`), porque "campo preenchido pela leitura" ≠ "confirmado pela pessoa".
2. **Kit da marca:** finalidades novas de upload (`LOGO`, `BRAND_FILE`, `PRODUCT_DEMO_VIDEO`; hoje só `CHAMPION_VIDEO` e `PRODUCT_IMAGE`) + onde o kit mora (`GET/POST/DELETE /workspace/kit`). Está no `kit-marca-v1` em construção; o chat só consome.
3. **Logo e cores da leitura:** o `OFFER_EXTRACT` passa a devolver `business.logoUrl` (do `<link rel=icon>`/`og:image`/header) e uma 2ª cor, pra o Eddy oferecer "I took the logo from the site". Sem isso, o slot do logo começa vazio.
4. **Texto livre só na pergunta atual (opcional na v0).** Se a pessoa digitar em vez de clicar (ex.: "não tenho site, vendo cobertor de 7 kg nos EUA"), `POST /offers/extract {pageText}` já resolve o caso "sem site". Pra correções em texto ("o mercado é Canadá"), seria um endpoint novo `POST /onboarding/eddy/parse {question, text}` → patch sugerido (Claude, centavos). **Recomendo deixar fora da v0**: os cartões editáveis cobrem a correção.
5. **Falas do Eddy:** fixas no `messages/*.json` (EN/PT), com variáveis. Sem LLM pra "conversar". O único LLM é o que já existe (leitura do site).

Estimativa grossa pra o frontend: o chat reaproveita os mutations dos passos (`business-step`, `offer-steps`, `meta-step`, `goals-brain-steps`); o trabalho novo é a casca da conversa, os cartões editáveis e o painel. Backend: itens 1 e 3 (pequenos), item 2 já está andando.

## Decisões pro Gusta
1. **Testar como substituto do wizard ou lado a lado?** Recomendo **atrás de flag** (`ONBOARDING_EDDY`), com o wizard de hoje como padrão, pra comparar quem conclui.
2. **Texto livre na v0?** Recomendo **não** (só cartões + colar site). Entra com o Eddy de verdade.
3. **Kit da marca no onboarding ou depois?** Recomendo **no fim, pulável** como no mockup: logo e cores vêm do site sem esforço; arquivos e vídeo são opcionais.
