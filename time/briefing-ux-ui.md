# Briefing — agente de UX/UI design (HookMill)
Criado: 2026-10-05 · Status: briefing completo · agente criado em `.claude/agents/maquina-design.md` (05/10).
Fonte da estrutura: `brainstorms/2026-10-05-maquina-anuncios-estrutura.md` · decisão em `decisions/log.md` (05/10).

## Contexto já decidido (não reabrir)
- **Produto:** HookMill (nome decidido em 06/10; antes "Máquina de Anúncios"). Gera criativos de vídeo pra **qualquer oferta** a partir de um briefing e aprende com os vencedores. Uso interno (Gusta + Tordan) agora; depois agência e escola, então precisa ter cara de SaaS de verdade.
- **Time de agentes:** cada agente é especialista na sua função; este é o primeiro.
- **Stack do front:** Next 16 + Tailwind, separado da API (NestJS).
- **Fluxo v1 (wizard):** Produto (briefing) → Roteiros (3–5 opções, aprova/edita 1) → Avatar (4 rostos, escolhe) → Motor + orçamento (Kling/Seedance ou lipsync, custo na tela) → Geração (em segundo plano, regerar cena) → Edição (render, prévia) → OK final → Biblioteca (marcar vencedor).
- **O que o Gusta rejeitou no clonador:** workers e frontend "frankenstein", sem estrutura de SaaS. (Chat fica fora da v1; ver Q6.)
- **Preferência conhecida:** o Gusta quer ver mockup de tela, não diagrama técnico.

## Papel e limites
- **Só design (Q1, Gusta: "a").** Dono da experiência e do design system: decide fluxo, hierarquia, estados (vazio, carregando, erro, parcial) e tokens/componentes. Entrega **mockup navegável (HTML) + spec**.
- **Não escreve código de produção.** Quem implementa em Next 16 + Tailwind é o agente de frontend (a criar). O Gusta aprova o mockup antes de virar código.

## Direção visual
- **Ferramenta pro (Q2, Gusta: "a"):** densa, escura, rápida, no estilo Linear/Vercel/Runway. Foco no conteúdo (vídeos, roteiros), pouca decoração, cara de "estúdio de produção".
- **Tema:** escuro (veio implícito na opção "a"; tema claro não foi pedido).
- **Referência principal: Vercel** (Gusta, 05/10: "vamo usar a Vercel como referência"). Linguagem do design system **Geist** da Vercel (vercel.com/geist): fonte Geist Sans/Mono, escala de cinzas neutra quase sem cor, bordas finas de 1px, raio pequeno, densidade alta, cor só pra status (azul/verde/âmbar/vermelho), dashboard da Vercel como molde de navegação e lista de deploys (≈ lista de criativos com etapa).
- Outras referências concretas: o Gusta pode mandar mais.

## Plataforma e idioma (Q3)
- **Desktop primeiro**, mas **o mobile tem as mesmas funcionalidades** (não é versão reduzida). Todo fluxo do wizard precisa ser completável no celular.
- **Inglês desde o início** (Gusta: "inglês desde o início"). Q4: respondeu "ok" sem escolher entre só EN e EN + PT → **assumido: EN + PT-BR com seletor, EN como padrão** (suposição do assistente; o Gusta pode corrigir).
- O conteúdo gerado (roteiro, voz, legendas) segue o idioma do briefing de cada oferta, independente da interface.

## Entregáveis e formato (Q4, Gusta: "ok")
- **Mockup em HTML publicado como Artifact:** link navegável no desktop e no celular, clicando pelo wizard inteiro.
- **Spec em `.md`** pro agente de frontend: telas, estados, componentes, tokens, comportamento responsivo. Salva em `projects/maquina-anuncios/design/<assunto>-AAAA-MM-DD.md`.
- Sem Figma.

## Telas da v1 (Q5, Gusta: "ok")
1. **Login.**
2. **Home/Dashboard:** criativos em andamento (com a etapa de cada um) e o que espera aprovação.
3. **Ofertas:** lista + criar/editar briefing (cola o link e a IA preenche).
4. **Wizard do criativo:** Roteiros → Avatar → Motor + orçamento → Geração → Edição → OK final.
5. **Biblioteca:** peças aprovadas, filtro por oferta, marcação de vencedor.
6. **Configurações:** workspace, membros (Gusta + Tordan), chaves de API, custos.

## Regras duras (Q6)
- **Sem chat na v1.** O Gusta primeiro disse "podemos ter chat sim" e logo depois corrigiu: "na verdade não quero chat agora não". Ajustes acontecem por botões e campos editáveis dentro do wizard. Chat pode voltar numa versão futura.
- **Espera honesta:** geração e render levam minutos. Mostrar a etapa real e o progresso, nunca um spinner mudo; dá pra sair e voltar.
- **O vídeo é o protagonista:** player grande, sem UI competindo com ele na revisão.
- **Sem cara de IA genérica:** nada de gradiente roxo, emoji ou ✨ em todo botão.
- Rejeitadas pelo Gusta: custo obrigatório ao lado de todo botão que gasta ("não quero isso"); regra sobre dado inventado em mockup ("isso não é da sua conta").

## Skills, referências e componentes
### Componentes
- **libraries.dev** (Gusta, 05/10: "quero usar esses componentes também"). São efeitos de UI em React 18+, MIT, feitos pra agentes de código: Border Beam, Thinking Orbs, Gooey, Liquid Metal, Image Generation (loader que vira a imagem, com Three.js), Voice e Bot Avatars. Tem plano Pro (Studio/Skill).
  - Encaixe sugerido (assistente, a confirmar): **Image Generation** na espera dos rostos do avatar; **Thinking Orbs** enquanto o Claude escreve os roteiros; **Border Beam** no cartão/etapa que está gerando. Os três servem à regra de espera honesta.
  - Tensão com a regra "sem cara de IA genérica": Liquid Metal, Gooey, Voice e Bot Avatars não têm lugar óbvio na v1. Usar os efeitos só em estados de espera, nunca como decoração.
- **Base de componentes: shadcn/ui** (coerente com a referência Vercel; o shadcn é mantido por gente da Vercel e fica no código). Origin UI como catálogo de variações, se precisar.

### Referências e skills
(o Gusta envia)

## Aprovações
- **05/10 — mockup v3 (Home + wizard, PT) aprovado pelo Gusta:** "ficou legal; se eu precisar de mais ajustes eu falo". Link: https://claude.ai/artifact/N271PVVM6NiKRAdBHM17YV · spec `projects/maquina-anuncios/design/wizard-v1-2026-10-05.md`. Os 4 pontos abertos (molde Vercel, "Esperando você" junta revisão+erro, "Pedir ajustes" no lugar do chat, custo só no Motor e no OK final) ficam aceitos junto. Landing: não definida.
