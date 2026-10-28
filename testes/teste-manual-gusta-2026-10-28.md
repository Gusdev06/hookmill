# Teste manual do Gusta — 28/10/2026 (cadastro → variações, tudo live)

Ambiente: web localhost:3000, API dev :3001 com o commit `67b8646` (restart 14:21 Bali), integrações live, teto de US$ 10 por conta nova.
Oferta usada: https://heirloom-jar.vercel.app/start (quiz).

## Achados (na ordem em que apareceram)

### A1 — Leitura do site não percorre o quiz até a oferta final
- **Gusta:** "Hoje a leitura do site ele acessa todas as telas? por exemplo o quiz ele deve navegar até a oferta final".
- **Hoje (código):** abre a página num navegador headless (celular) e lê até 6 subpáginas pelos links + até 4 rotas convencionais (/checkout, /pricing…) e o checkout de plataforma se o CTA apontar pra ele. **Nunca clica, digita nem envia formulário** (`api/src/integracoes/claude/subpaginas.ts`, `render-pagina.ts`). Quiz sem link interno não chega na oferta final.
- **Pedido:** navegar o quiz respondendo até a oferta/checkout final.
- **Sugestão:** "caminhante de funil": clica na 1ª opção ou na mais neutra, preenche campo de nome/e-mail com dado fictício só se for obrigatório pra avançar, para no checkout e nunca paga. Teto de passos e de tempo. Lê cada tela (texto + print 9:16) pro briefing. Reaproveitar a ideia do `walk.mjs` do swipe do Código da Prosperidade.
- Status: aberto.

### A2 — Tela "Tell us about the business": preencher tudo o que der automático
- **Gusta:** "nessa tela ele precisa preencher tudo o que é possível automático".
- **Hoje:** a leitura só preenche nome e idioma. Ramo (industry), mercado (país), cor da marca, tipo de negócio e prefixo ficam vazios ou no padrão (`web/src/components/onboarding/business-step.tsx`).
- **Pedido:** preencher a partir da leitura: nome do cliente, ramo, mercado/país, idioma, cor da marca (cor de destaque da página), tipo de negócio/resultado e o prefixo de 2–6 letras a partir do nome. Tudo editável.
- Status: aberto.

### A3 — "What kind of business is it?" fechado demais
- **Gusta:** "aq precisa ser mais aberto".
- **Hoje:** só 3 opções (Online store / Local business / App) → resultado PURCHASES / LEADS / INSTALLS.
- **Sugestão:** a pergunta passa a ser "o que conta como resultado", com mais opções e a IA já marcando pela leitura: compra (loja, infoproduto, low ticket), lead/formulário, mensagem no WhatsApp/Direct, agendamento, cadastro/teste grátis, assinatura, instalação de app, e "outro (descreva)". Cada opção mapeia pro evento de otimização da Meta.
- Status: aberto.

### A4 — Lote do Iterate sem variações com IA e sem os templates novos
- **Gusta:** "pq aqui ele não inclui as variações com ia? e os novos templates sem ia tbm?" (lote de 11 peças do campeão `pregadora-amostra`, oferta Heirloom Jar: 2 HEADLINE, 1 NATIVE-SEARCH, 2 STATIC, 6 FRAME).
- **Por quê (hoje):** (1) decisão de 12/10: a variação AUTO começa **sem crédito de vídeo**, então troca de avatar/lipsync/rosto não entra no Iterate; a troca de avatar existe (feature 2, 06–08/10) mas fica fora do menu e não roda desde 08/10. (2) Os templates novos (chat/DM e pessoa + motion, 28/10) são **protótipos isolados** em `video/src/prototipos/formatos/`, não estão no catálogo do produto. O Remix de formato só existe no mockup.
- **Sugestão:** o lote ganha um 3º bloco "Com IA (usa créditos)", opt-in, com custo por peça: troca de avatar (rosto/persona) e Remix de formato. Os programáticos (chat/DM, motion) entram no catálogo grátis do AUTO depois de virarem template de produto.
- Status: resolvido junto com o A5. Tudo dentro do Iterate: bloco "With AI" opt-in, liberado pela pergunta 2 do quiz. Mockup em atualização.

### A5 — Quiz antes do lote pra entender o que o usuário quer variar
- **Gusta:** "oq acha de fazermos um quiz para entender o que ele quer variar? com isso coletamos o que é mais importante para ele, caso ele não saiba sempre vai ter uma opção de deixar que a gente escolha".
- **Contexto:** revisa em parte a decisão de 12/10 ("não colocar isso na mão do usuário"), mas mantém o caminho fácil: "deixa a gente escolher" é sempre opção e é o padrão.
- **Sugestão do assistente:** 3 perguntas, uma por tela, puláveis: (1) o que você quer com esse anúncio (esticar a vida / achar público novo / os dois / escolham por mim); (2) pode usar IA que gasta crédito (só grátis / sim, até X créditos / escolham por mim); (3) o que você quer ver (múltipla: headline nova, molduras, estático, chat/motion, outro rosto, outro formato tipo podcast/descoberta / escolham por mim). As respostas montam o plano e ficam salvas como preferência do cliente (aprendizado).
- Status: **Gusta: "fechou assim"** (provisório até ver o mockup). Mockup em atualização (maquina-design).

### A5b — Pontos do mockup v2 aprovados (28/10, depois de ver o mockup)
- Gusta: "1 - ok · 2 - ok · 3 - ok". (1) O quiz roda durante a análise, não depois. (2) Com "Let HookMill choose" na pergunta 2, a IA paga aparece sugerida e desmarcada. (3) As peças grátis renderizam antes da aprovação das de IA.
- Mockup: https://claude.ai/artifact/2Y1Pc8MZrMuT4rGhURwH9h (v2) · spec `design/remix-formato-2026-10-28.md` §8.
