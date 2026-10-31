# Review de UX/UI do HookMill · 2026-10-29

Pedido do Gusta (29/10): "review de ux/ui… dar uma melhorada no layout". Método `improve-ui` (só leitura, achado com contrato + caminho de execução + correção única), mais `frontend-design` e a identidade aprovada. **Refina, não redesenha.**
Base: commit `1a4edff` do monorepo, com alterações não commitadas na árvore (lido do disco em 29/10).
Mockup curto das duas melhorias grandes (L1, L2), **não publicado**: `design/mockup-review-ux-2026-10-29.html` (barra de protótipo troca tela, Desktop/Phone 390 e Meta on/off).

> **Limite desta rodada:** esta sessão não tinha shell, então **não subi o web com MSW nem tirei print**. Tudo aqui foi verificado no código (arquivo:linha) e nos textos `messages/*.json`. Os itens que dependem de medida em pixel (F4, F5) estão calculados pela largura dos componentes e marcados "confirmar no render". O QA ou o frontend confirmam em 390 px antes de fechar.

## Linguagem de design (o que governa estas telas)
- **Superfície auditada:** `web/src/app` inteiro, com foco no fluxo do usuário novo (signup → `/start` → onboarding → Iterate → amostra travada → unlock), Download do Iterate e as telas de 29/10 (amostra, templates do Meta, "Gerar mesmo assim", "Still working", faixa de CPA).
- **Fontes de design:** `design/fase2-telas-novas-2026-10-12.md` §2–§6 (aprovada 12/10; substitui os tokens da v1: tema **claro**, lima único acento), `onboarding-v2-2026-10-21.md` + `mockup-onboarding-v2.html`, `variacao-auto-v1-2026-10-12.md` §4, `mockup-amostra-gratis.html` (ok 29/10), `mockup-meta-templates.html` (ok 29/10), tokens em `web/src/app/globals.css`.
- **Decisões que valem aqui:** uma ação lima por tela, que é o avanço da etapa (fase2 §2.5). Barra de ação fixa com Back + primário e dica à esquerda (§2.6). Painel escuro = instrumento (§2.4). Status por cor: azul em andamento, âmbar espera humana, vermelho falhou, verde pronto; lima não é status (§3). Raio: chip 8 · controle 10 · botão 12 · **cartão 16 · painel 18** (§3). Alvo de toque mínimo de 44 px (§3). Foco = `--ring` (`--info`) (globals.css:352). FlowBar é um componente só pros dois fluxos (§2.1). Seleção em cartão = contorno tinta (fase2 §4 "Rostos"; ModeCard do onboarding-v2 §4). Onboarding: "um foco por tela" (onboarding-v2 §2.2).
- **Donos e consumidores:** `components/ui/button.tsx` (variantes), `components/iterate/parts.tsx` (`IterWrap`, `Cols`, `Card`, `IterActionBar`, `IterFlow`), `components/onboarding/action-bar.tsx` e `shared.tsx` (`OnboardingFrame`, `Card`), `components/flow-bar.tsx`.
- **Exceções explícitas:** botão `meta` azul só no "Continue with Facebook" (button.tsx:19). Pílula "Imported" azul nos templates está no mockup aprovado de 29/10 (por isso **não** entrou como achado).

## Os 10 de maior impacto (ordem impacto ÷ esforço)
| # | Item | Tipo | Esforço |
|---|---|---|---|
| 1 | F1 · "Unlock — see plans" abre "Plans aren't on sale yet" | corrigir já | XS |
| 2 | F4 · Botões das peças da amostra estouram o cartão em 390 px | corrigir já | XS |
| 3 | F6 · Amostra com dois limas e dois botões mortos na barra | corrigir já | S |
| 4 | L1 · `/iterate/new` tem um lima "Generate" que nunca liga, sozinho na zona do polegar | melhoria (mockup) | S |
| 5 | F2 · Signup diz "20 minutos", `/start` diz "10 minutos" | corrigir já | XS |
| 6 | F8 · Goals/Plan trocam a FlowBar de 3 passos por uma trilha de texto de 5 | corrigir já | S |
| 7 | F3 · Faixa de CPA tem moeda e, logo abaixo, "moeda chega com a Meta" | corrigir já | XS |
| 8 | L2 · Passo 1 do setup cresceu de 6 pra ~15 controles + time | melhoria (mockup) | M |
| 9 | F9 · Três estilos de "cartão selecionado" no primeiro uso; foco fora do token | corrigir já | M |
| 10 | F5 · Barra do Download estoura em 390 px com Meta conectada | corrigir já | XS |

**Corrigir já: 10 itens (F1–F10). Melhoria de layout: 6 itens (L1–L6), dependem do ok do Gusta.**

---

## Corrigir já

### F1 · CTA do unlock promete planos que não existem
- **Tela:** Download da amostra travada e `/iterate/new` com amostra usada (painel escuro), e o bloqueio do "Gerar mesmo assim".
- **Evidência:** o botão diz `sample.panel.cta` = "Unlock — see plans" (en.json:4030; pt "Liberar — ver planos", pt-BR.json:4030), usado em `components/iterate/sample.tsx:110` e `:205`. Ele abre `TalkToUs`, cujo corpo diz "Plans aren't on sale in the app yet" (en.json:4038). O próprio arquivo registra que o P2 "abre Talk to us" (sample.tsx:23).
- **Impacto:** a pessoa clica pra ver preço e recebe um "ainda não vendemos". É o momento de maior intenção do funil, e a promessa quebra.
- **Plano (maquina-frontend):**
  1. Em `messages/en.json`, `sample.panel.cta` → `"Unlock: talk to us"`. Em `messages/pt-BR.json` → `"Liberar: fale com a gente"`.
  2. Nada muda no código. Quando o gateway (P2) existir, o texto volta a ser "see plans".
  - **Aceite:** nenhum texto do fluxo de unlock menciona "plans/planos" enquanto o clique abrir "Talk to us". Confira EN e PT nas 3 telas.

### F2 · Tempo do setup se contradiz
- **Tela:** `/signup` → `/start`.
- **Evidência:** `signup.subtitle` = "Your first client is set up next. It takes about 20 minutes…" (en.json:1987, pt:1987). O `/start` diz "about 10 minutes" (`welcome.hintAgency/hintOwn`, en.json:2817–2818). O mockup aprovado do onboarding-v2 diz 10 (mockup-onboarding-v2.html:527). O subtítulo ainda supõe agência ("first client") antes de a pessoa escolher "Just me".
- **Plano:** `signup.subtitle` (EN) → `"Next you set up your business or your first client. About 10 minutes, and you can stop and come back."`. PT → `"Em seguida você configura o seu negócio ou o primeiro cliente. Uns 10 minutos, e dá pra parar e voltar depois."`
  - **Aceite:** "20" não aparece mais em nenhum texto do fluxo. Signup e `/start` dizem o mesmo tempo.

### F3 · Moeda do CPA contra o aviso "moeda chega com a Meta"
- **Tela:** onboarding passo 1 (Business), cartão "The business".
- **Evidência:** a faixa de CPA tem `Select` de moeda (USD/BRL/EUR/GBP/MXN) em `components/onboarding/business-step.tsx:358-369`. No mesmo cartão, o `SoonBlock` diz "**Currency and time zone** per client arrive with the Meta connection." (`business-step.tsx:402`, en.json:1818, pt:1818).
- **Plano:** reescrever `onboarding.business.soonCurrency`:
  - EN: `"<b>Time zone</b> and the ad account currency come from the Meta connection."`
  - PT: `"<b>Fuso</b> e a moeda da conta de anúncios vêm da conexão com a Meta."`
  - **Aceite:** o cartão não afirma ao mesmo tempo que dá pra escolher moeda e que a moeda ainda não existe.

### F4 · Botões das peças da amostra estouram o cartão no celular (confirmar no render)
- **Tela:** Download da amostra, 390 px.
- **Evidência:** a grade é `grid-cols-2 gap-2.5` (sample.tsx:91). Isso dá cartões de ~174 px, ~152 px úteis depois do `p-2.5`. Dentro ficam dois `Button size="sm"` lado a lado, com `flex-1 px-2 text-xs` (sample.tsx:159-166). O `Button` tem `whitespace-nowrap` e `min-w-0` (button.tsx:9). Sobram ~73 px por botão, e "Send to Meta" em 12 px bold mede ~96 px: o texto vaza por cima do vizinho. Em PT ("Enviar pra Meta") é pior. O mockup aprovado não trava a quebra (mockup-amostra-gratis.html:61).
- **Plano:** em `sample.tsx:159`, trocar `className="mt-auto flex gap-1.5"` por `className="mt-auto flex flex-col gap-1.5 tablet:flex-row"`. Os dois botões mantêm `flex-1`.
  - **Aceite:** em 390 px (EN e PT) nenhum texto de botão passa da borda do botão. Em ≥761 px continua lado a lado.

### F5 · Barra do Download estoura em 390 px com Meta conectada (confirmar no render)
- **Tela:** Download do Iterate (lote pago).
- **Evidência:** a barra tem 3 filhos: Home (outline), `BatchSendButton` e "Download zip" lima (download-screen.tsx:186-194). No celular, o grid de `IterActionBar` é `grid-cols-[auto_1fr] grid-flow-col auto-cols-auto` (parts.tsx:128). A soma estimada é Home ~66 + "Send to Meta (11)" ~149 + "Download zip" com ícone ~147 + gaps 16, ~378 px numa barra de 358. O botão do meio encolhe abaixo do texto (nowrap). A amostra já resolve isso escondendo um botão no celular (sample.tsx:104, `max-tablet:hidden`).
- **Plano:** em `download-screen.tsx:186`, adicionar `className={buttonVariants({ variant: "outline", className: "max-tablet:hidden" })}` no link Home. O topo escuro do celular já leva pra Home.
  - **Aceite:** em 390 px com Meta conectada, os 2 botões cabem sem texto cortado ou sobreposto. O lima "Download zip" continua visível.

### F6 · Amostra travada: dois limas e dois botões mortos na barra
- **Telas:** Download da amostra (`SampleDownloadScreen`) e `/iterate/new` com amostra usada (`SampleUsedScreen`).
- **Evidência:**
  - No Download: lima "Unlock" na barra (sample.tsx:108) **e** lima "Unlock" no painel (sample.tsx:204). A barra ainda leva "Send to Meta (n)" e "Download zip" desabilitados (sample.tsx:100-107), que repetem os botões desabilitados de cada peça.
  - No SampleUsed: "Generate" lima desabilitado na barra (sample.tsx:290) + lima no painel (:204).
  - Regra: uma ação lima por tela (fase2 §2.5). O mockup aprovado da amostra não tem barra; o lima está só no painel (mockup-amostra-gratis.html:167).
- **Plano:**
  1. `SampleDownloadScreen`: a barra fica só com o lima de unlock (`openContact`). Remover os dois `Button disabled` (sample.tsx:100-107). A dica `sample.lockedActions` continua dizendo o que abre.
  2. `UnlockPanel`: o botão do painel (sample.tsx:204) passa a `variant="default"`. Dentro de `.on-ink`, `--primary` = `--ink-fg`, então ele vira um botão claro sobre o escuro, forte mas não lima.
  3. `SampleUsedScreen`: trocar o `Button variant="brand" disabled` da barra (sample.tsx:289-293) por um lima ativo `{t("panel.cta")}` que abre o contato (mesmo `setContact(true)` + scroll do Download).
  - **Aceite:** em todas as telas da amostra existe exatamente 1 botão lima visível e ele faz algo. Nenhum botão desabilitado na barra fixa.

### F7 · PT-BR chama a mesma coisa por dois nomes
- **Telas:** todas em PT.
- **Evidência:** "Cérebro" aparece 18 vezes (nav `brain.title`, pt-BR.json:154 e :3195) e "Brain" 28 vezes (ex.: passo "Montar o Brain", :1738; "Montando o Brain de {name}", :1913). A Meta aparece no feminino 64 vezes ("Conectar a Meta", :2852) e no masculino 31 vezes ("conexão do Meta", :1818; "Enviar … pro Meta", :3941).
- **Plano:**
  1. **"Cérebro"** em todo texto PT, porque é o rótulo da navegação que a pessoa vê sempre. Troque "Brain" por "Cérebro" nos valores (nunca nas chaves) de pt-BR.json. Exceção: nome próprio dentro de frase em EN.
  2. **"a Meta"** em todo texto PT: do→da, pro→pra, no→na, o→a, ao→à antes de "Meta".
  - **Aceite:** em pt-BR.json, `grep -c "\bBrain\b"` = 0 e `grep -cE "\b(do|pro|no|o|ao) Meta\b"` = 0.

### F8 · A etapa do lote muda de modelo no meio do caminho
- **Telas:** Goals (quiz) e Plan do Iterate quando `quizEnabled`.
- **Evidência:**
  - Upload, Generate e Download usam a `FlowBar` de 3 passos (Analyze → Generate → Download), via `IterFlow` (new-screen.tsx:192, generate-screen.tsx:54, download-screen.tsx:105).
  - Goals e Plan trocam por `GoalsFlow`, uma trilha de texto de **5** passos (Winner › Your goals › Plan › Generate › Pieces), em goals.tsx:20-27 e :63 e analyze-screen.tsx:448 e :518.
  - Contrato: a FlowBar é um componente só pros dois fluxos (fase2 §2.1).
- **Plano:**
  1. Em `goals.tsx:63` e `analyze-screen.tsx:448/518`, trocar `<GoalsFlow …/>` por `<IterFlow current="analyze" running={batch.status !== "PLAN_READY"} batchId={batch.id} />`.
  2. Apagar `GoalsFlow` e as chaves `iterate.goals.flow.*` e `flowLabel`.
  3. O cartão já mostra "Question N of 2" (goals.tsx:74), que é o subpasso.
  - **Aceite:** do upload ao download o topo mostra sempre a mesma FlowBar de 3 passos. No celular, a régua de segmentos aparece igual nas 5 telas.

### F9 · Três jeitos de mostrar "escolhido" no primeiro uso; foco fora do token
- **Telas:** `/start`, onboarding Business, Goals.
- **Evidência:**
  - `/start`: cartão escolhido = contorno tinta 1,5 px + anel de 1 px (start/page.tsx:90). Bate com o ModeCard e com os rostos da fase2 §4.
  - Business, "What counts as a result?": cartão escolhido = **preenchido de tinta** com texto branco (business-step.tsx:307).
  - Goals: escolhido = **fundo lima-claro** (`border-brand-edge bg-brand-soft`), com `<input type=radio/checkbox>` nativos `accent-black` e foco `focus-within:ring-fg` (goals.tsx:77-85, :97). O resto do app usa o foco `--ring` = `--info` (globals.css:352-355) e tem `RadioGroup`/`Checkbox` do shadcn em `components/ui/`.
  - Lima-claro é reservado pra "esperando você"/Edit in video (fase2 §3).
- **Plano:**
  1. Extrair as classes do item de `/start` pra um helper `choiceCardClass(on)` em `components/ui/choice-card.ts`, sem criar componente novo: `"rounded-lg border-[1.5px] bg-card p-4 text-left outline-none hover:border-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"` + `on ? "border-fg shadow-[0_0_0_1px_var(--fg)]" : "border-line"`.
  2. Business (business-step.tsx:305-308): usar `choiceCardClass(goal === rt)`. A dica passa a ficar sempre `text-fg-3`.
  3. Goals: trocar os inputs nativos por `RadioGroupPrimitive.Item` (Q1/Q2, como em `/start`) e `Checkbox` de `components/ui/checkbox` (Q3), com `choiceCardClass`. O campo do teto de IA (goals.tsx:81) vira `Input` de `components/ui/input`, e o erro `capRange` ganha `text-status-failed text-xs`.
  4. `/start` passa a usar o helper (o raio cai de 18 pra 16, alinhado ao F10).
  - **Aceite:** nas 3 telas, escolhido = contorno tinta. Tab mostra o contorno azul de foco. Nenhum input nativo visível no Goals.

### F10 · Raios fora da escala nos cartões
- **Telas:** todas; a prioridade é amostra, Download, templates e onboarding.
- **Evidência:** escala aprovada: cartão 16, painel 18 (fase2 §3; globals.css:291-295 `rounded-lg`=16, `rounded-xl`=18). Há **101 raios arbitrários `rounded-[Npx]` em 42 arquivos** (grep em `web/src`). Exemplos no fluxo prioritário:
  - peça da amostra `rounded-[12px]` (sample.tsx:124);
  - painel de unlock `rounded-[14px]` (sample.tsx:188);
  - cartão do Download `rounded-[14px]` (download-screen.tsx:291);
  - cartão do onboarding `rounded-xl` = 18, raio de painel (onboarding/shared.tsx:191);
  - linha de template `rounded-xl` (templates-screen.tsx:147).
  - O mesmo "cartão" aparece com 12, 14, 16 e 18 px no mesmo fluxo.
- **Plano (só os arquivos do fluxo prioritário nesta passada):**
  1. Cartão claro → `rounded-lg`: sample.tsx:124, download-screen.tsx:291, onboarding/shared.tsx:191, templates-screen.tsx:147, start/page.tsx:89 e :111.
  2. Painel escuro → `rounded-xl`: sample.tsx:188.
  3. Mídia dentro do cartão → `rounded-md` (10): sample.tsx:137 e :146, `rounded-[10px]` → `rounded-md`.
  4. Os `rounded-[4px]` dos selos (hook tag, "f") ficam como estão: são selos, não cartões, e `rounded-sm` vale 8 nesta escala.
  - **Aceite:** nas telas do fluxo prioritário, todo cartão claro mede 16 px de raio e todo painel escuro 18. Os outros 30+ arquivos ficam pra uma segunda passada.

---

## Melhoria de layout (precisa do ok do Gusta)

### L1 · `/iterate/new`: o único lima da tela nunca liga (mockup)
- **Evidência:** a barra fixa sempre tem `Button variant="brand" disabled` "Generate" (new-screen.tsx:40-44 e :269-273), mas a análise começa sozinha e a tela navega. Esse botão nunca é clicável aqui. No celular ele é o único item da barra e ocupa a largura toda na zona do polegar. A ação real é "Choose file" em tinta `sm` dentro da dropzone (new-screen.tsx:339). Com Meta, o "Iterate it" do vencedor é lima (new-screen.tsx:447), então a tela tem dois limas, um morto. Isso segue a spec antiga ("Gerar desabilitado", variacao-auto §4.1), que eu reviso aqui.
- **Decisão proposta:** a barra mostra a ação que existe.
  1. Barra = lima **"Choose a video"**, que dispara o mesmo `input.current?.click()` (levantar o `ref` do `Source` pro `Ready`). No upload, a barra mostra só a dica + "Cancel" outline.
  2. O "Iterate it" do vencedor passa a `variant="default"` (tinta). O lima fica sendo um só.
  3. O botão "Choose file" da dropzone vira `variant="outline"` (redundante no celular, útil no desktop).
  4. `SampleUsedScreen` já fica coberto pelo F6.
- **Aceite:** em `/iterate/new` existe 1 lima, sempre clicável quando não há upload rodando. Em 390 px ele abre o seletor de arquivo.

### L2 · Passo 1 do setup inchou (mockup)
- **Evidência:** o mockup aprovado (mockup-onboarding-v2.html:550-563) tinha 2 cartões: site + 5 campos com chips, "One screen. The site does most of the typing." Hoje o passo 1 (business-step.tsx:195-405) tem:
  - site;
  - nome, setor, mercado e idioma;
  - cor da marca;
  - **8 cartões** de resultado com descrição, mais o campo "Other";
  - faixa de CPA com 3 controles;
  - código;
  - bloco Em breve;
  - **e um 3º cartão de time com convite** (`TeamCard`, :405).

  São ~15 controles mais o convite, contra a regra "um foco por tela" (onboarding-v2 §2.2). No celular é um formulário de várias telas de rolagem antes do primeiro Continue.
- **Decisão proposta:**
  1. Fica: site + nome, código, setor e mercado, mais o resultado em **chips** (Purchase, Lead, Message, Appointment, Sign-up, More…). "More…" abre os outros 3 + Other. A dica de cada tipo vai pro texto de ajuda abaixo, só a do escolhido.
  2. Idioma, cor da marca e faixa de CPA vão pra um `Accordion` "More details (optional)" (`components/ui/accordion.tsx` já existe), fechado por padrão e aberto se algum já tiver valor.
  3. O `TeamCard` sai do passo 1. Convite fica em Settings › People (já existe) e entra como item do tour/Home.
  4. O `SoonBlock` vira uma linha `text-xs text-fg-3` abaixo do cartão (texto do F3).
- **API:** nada muda (`PATCH /workspace` com os mesmos campos).
- **Aceite:** em 390 px, o Continue do passo 1 fica a no máximo ~2 rolagens do topo com o site lido. Nenhum campo some do produto, só muda de lugar.

### L3 · Nome do cliente perguntado até 3 vezes
- **Evidência:** signup "Agency name (optional)" (signup-form.tsx:132-138, "Becomes the name of your first client", en.json:1995) → `/start` "First client's name" (start/page.tsx:110-118) → Business "Name" (business-step.tsx:257-260, que a leitura do site também preenche).
- **Decisão proposta:** o nome fica só no Business, pré-preenchido pelo site. Tirar o campo do signup (que passa a ter nome, e-mail e senha) e do `/start` (a mutação continua só com `accountMode`). A API já aceita a ausência dos dois (opcionais).
- **Aceite:** do signup ao fim do passo 1, o nome do cliente é pedido uma vez.

### L4 · "Gerar mesmo assim" empurra o progresso pra baixo e enfia um painel escuro dentro do aviso
- **Evidência:** no Generate, a ordem é Head → badge → New batch → `CleanVersionStatus` → **`CaptionBlocked` (caixa âmbar com upload, botões por formato e, se travado, o `UnlockPanel` escuro inteiro dentro dela)** → alerta de falha → peças (generate-screen.tsx:62-87; captions.tsx:151-178). Âmbar é "espera ação humana" (fase2 §3), mas aqui é opcional. O painel escuro é o instrumento à direita (fase2 §2.4), não um bloco no meio do aviso.
- **Decisão proposta:**
  1. Depois do launch (Generate/Download), `CaptionBlocked` vira uma linha neutra **abaixo dos grupos**: "2 formats left out: burned-in captions · Show", que expande a lista atual. No Plan (antes do launch) fica como está.
  2. Travado: o `ForceButton` abre o `TalkToUs` num `Dialog` (`components/ui/dialog`), não o `UnlockPanel` inline (captions.tsx:173).
- **Aceite:** no Generate, a primeira coisa abaixo do título é o progresso ou a falha. Nenhum painel escuro aparece dentro de caixa âmbar.

### L5 · `/start` sem saída
- **Evidência:** `MinimalShell` usa por padrão só o seletor de idioma à direita (minimal-shell.tsx:51). O `/start` não passa `right` (start/page.tsx:66), então quem entrou com a conta errada não tem como sair. O wizard já tem "Save and exit"/Log out (onboarding/shared.tsx:143).
- **Plano:** passar `right={<><LanguageToggle persist /><Button variant="ghost" size="sm" onClick={logout}>{tc("logout")}</Button></>}` no `/start`, usando o mesmo logout do `OnboardingFrame`.
- **Aceite:** `/start` tem uma saída visível no topo, em EN e PT.

### L6 · Migalha dos templates com alvo de 12 px
- **Evidência:** a trilha "Settings › Meta › Publish templates" é feita de links `font-mono text-xs` sem área de toque (templates-screen.tsx:114-117). O alvo mínimo é 44 px (fase2 §3). `components/ui/breadcrumb.tsx` existe e não é usado aqui.
- **Plano:** trocar pelo `Breadcrumb` do shadcn com `BreadcrumbLink` `inline-flex min-h-11 items-center` no celular (`min-h-0` a partir de `tablet:`). A conta (`act_••••1234`) vai pra uma linha `text-xs text-fg-3` abaixo do título.
- **Aceite:** em 390 px, cada link da trilha tem 44 px de altura tocável.

---

## Visto e sem achado (pra ninguém refazer)
- **"Still working"** (new-screen.tsx:476-493): espera honesta ok, com status real por lote, link pro lote e anel azul. Ficou só o travessão do título ("Still working — you can come back any time"); se quiser, troque por ponto ("Still working. You can come back any time.").
- **Templates do Meta** (lista, vazio, erro com retry, trava sem Meta, leitura do CLIENT): estados completos e um lima por tela. A pílula "Imported" azul vem do mockup aprovado.
- **Generate:** título com contagem real, painel com ETA, "You can close this page" e Back to Home. Cumpre a espera honesta. O painel desce pro fim no celular por regra da spec (fase2 §6); o título já carrega o "X ready".
- **Signup/login/invite:** submit em tinta nas três, consistente entre si. Erros por campo com `aria-describedby`.
- **Contraste:** `--fg-3` sobre `--bg` ~5,6:1 e selo HOOK (`--brand-ink` sobre `--brand`) ~6,8:1, os dois acima de 4,5:1.

## O que preciso de você, Gusta
1. **L1–L6:** ok pra virar plano do frontend? L1 e L2 estão no mockup local `design/mockup-review-ux-2026-10-29.html` (não publiquei; publico se quiser o link).
2. **F7:** em PT, "Cérebro" (como na navegação) em todo lugar? A alternativa é "Brain" em todo lugar, inclusive no menu.
3. **F1:** o texto "Unlock: talk to us" vale até o gateway entrar.
