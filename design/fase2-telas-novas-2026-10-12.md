# Fase 2 · telas novas no visual Ads Machine (F0): spec de UX/UI
Data: 2026-10-12 · Status: **aprovado pelo Gusta em 12/10** (5 decisões no `decisions/log.md`)
Mockup navegável: https://claude.ai/artifact/LfBFMwjHNhgHeHPYoLE3NE · fonte: `projects/maquina-anuncios/design/mockup-fase2-telas-novas.html` (atualize SEMPRE este arquivo, pra o link não mudar). A barra "Prototype" no topo troca tela, estado e Desktop/Phone 390. Ela não faz parte do produto.
Base: decisão de 12/10 em `decisions/log.md`, `plano-fase2-ads-machine-2026-10-12.md` (esta é a F0), `analise-mockup-ads-machine-2026-10-12.md`. Referência visual: o artifact Ads Machine (autor de fora; usado só como referência, não foi editado).
**Esta spec substitui o §3 (tokens) de `wizard-v1-2026-10-05.md` e o §3 de `editor-v1-2026-10-09.md`.** As regras de UX de `wizard-v1`, `variar-campeao` e `editor-v1` continuam valendo; muda só a pele.

> Dados do mockup (Mooncloth, custos, tempos, rostos) são exemplo. Os rostos são arte de placeholder em CSS, não geração. Custos e `sceneCount` vêm da API.

## 1. Problema
O mockup Ads Machine pula tudo o que acontece entre "Scripts" e "Review": rosto, motor, geração, edição e editor. É justamente onde mora o código que o HookMill já tem. Sem desenhar isso no visual novo, a F5 viraria um frankenstein (telas escuras Vercel no meio de um app claro com lima). Além disso, metade do mockup depende do Meta, que não entra agora, e precisamos de um jeito único de mostrar o que vem sem fingir que funciona.

## 2. Decisões e porquê
1. **FlowBar com fases: Plan → Make → Ship.** O caminho 2 passa a ter 9 passos (What we know, Concepts, Scripts, Face, Engine, Generate, Edit, Review, Send), e isso não cabe numa barra plana. A fase atual abre os passos dela; as fases feitas viram uma pílula com check ("Plan · 2 done", clicável pra voltar); as futuras mostram o nome e os passos em texto. O caminho 1 usa o mesmo componente: Plan (Pick, Breakdown, Plan) → Make (Generate) → Ship (Review, Send). Um componente, dois fluxos.
2. **Sequência do caminho 2:** What we know → Concepts (Em breve, círculo tracejado, fora da contagem) → Scripts → **Face → Engine → Generate → Edit** → Review → Send. "Step N of 8" conta só os passos ativos. Concepts fica visível porque é o que vem, mas o fluxo segue com 1 conceito = a oferta escolhida (plano §1).
3. **Mobile da FlowBar:** uma linha "New concepts · Make / Generate / Step 5 of 8" + uma régua de segmentos (feito = tinta, atual = lima, Em breve = tracejado) + Exit. Mesmo padrão da barra "Step N of 7" da v1.
4. **Painel escuro = instrumento.** O mockup usa o cartão `--ink` pro resumo do lote ("THIS BATCH"). Generalizamos: todo resumo de etapa (THIS AD, THIS BATCH) e toda espera (GENERATING) mora no cartão escuro à direita, com o número grande em mono lima. O trabalho (rostos, cenas, campos) fica nos cartões claros. A pessoa sempre sabe onde olhar pro "quanto falta".
5. **Uma ação lima por tela.** O botão lima é o avanço da etapa (Continue / Generate / Download). Ação secundária forte = tinta (`btn-ink`); o resto é `outline` ou `ghost`. Destrutivo = contorno vermelho.
6. **Barra de ação fixa continua** (regra da v1): Back + primário, com a dica de estado à esquerda. No desktop ela é um cartão sticky no rodapé; no mobile ocupa a largura, com `safe-area`.
7. **Custo só no Engine** (v1 §2.6) e, no caminho 1, no Plan (já aprovado no variar-campeão). Na Geração aparece como fato no fim ("$4.18 spent"). O teto do mês aparece como barra no painel escuro do Engine; passou do teto = `Alert` vermelho com "Try avatar + lipsync · $2.40" e "Raise the cap", e o Generate fica desabilitado.
8. **Espera honesta no visual novo:** Image Generation (granulado + varredura lima) nos tiles de rosto e na miniatura da cena gerando; Border Beam lima→azul na linha que está gerando e no painel escuro enquanto roda; anel girando no círculo do passo Generate da FlowBar. Tudo some quando acaba e respeita `prefers-reduced-motion`. Sempre com título real ("Generating · 2 of 5 scenes ready"), ETA, etapa atual e "You can close this page" + Back to Home.
9. **Edit:** player à esquerda num palco escuro, painel à direita com, no topo, o cartão lima-claro **Edit in video** (porta pro editor, nome do contrato), depois Template, Caption style, Caption position, Hook text, CTA e End card. Mexeu = `Alert` âmbar "Changes not in the preview yet" + "Render preview" vira o primário. Renderizando = overlay no player com %, frame X de N e checklist. Voltando do editor com mudança não exportada = alerta âmbar e Continue bloqueado (editor v1 §2.1).
10. **Editor = tela cheia, sem sidebar.** A timeline precisa da largura. Palco e timeline em `--ink` (o vídeo é o protagonista e a cor é julgada no escuro); painel de propriedades claro à direita (320 px), igual aos cartões do app. **Seleção, alças e clipe selecionado = lima**; guia de alinhamento = azul claro (`--info-on-ink`); zona segura, palavra suspeita e barra vazia = âmbar; erro de export = vermelho. Todas as outras decisões do editor v1 ficam.
11. **Send = "Em breve" + saída real.** A tela Send existe nos dois caminhos: à esquerda, **Ready today**: miniatura, fatos, **nome de arquivo padronizado** (`MC_NEW_1012_A_F2_9x16.mp4` = cliente_caminho_data_roteiro_rosto_formato, roubado do mockup pra casar resultados depois), checkbox "Save to the Library" (marcado) e **Download MP4** (lima) + Copy ad text. À direita, o bloco Em breve do Send to Meta, esmaecido.
12. **Padrão "Em breve" em dois tamanhos:**
    - **Seção inteira** (Campaigns, Eddy, Connect Meta): título da página + selo SOON, um cartão claro com **uma frase do que vai fazer e do que falta** ("Needs the Meta connection") + duas saídas pro que funciona hoje, e embaixo a **prévia esmaecida** da tela do mockup com a faixa "PREVIEW OF WHAT COMES · EXAMPLE DATA · NOT MOONCLOTH'S".
    - **Bloco** dentro de tela que funciona (KPIs e Eddy's read na Home, Pick from Meta, tipos novos no Plan, New copy no lote): moldura tracejada, selo SOON + uma linha + selo EXAMPLE quando há número, conteúdo a 50% de opacidade e dessaturado, `inert` e `aria-hidden`. O bloco nunca entra em contagem, custo ou validação.
    - Na sidebar, Campaigns e Eddy levam a micro-tag SOON tracejada no lugar do badge e abrem a versão "seção inteira".
    - O selo é **neutro** (tracejado, sem cor de status): Em breve não é erro nem atenção, então não pode competir com âmbar e vermelho.
13. **Caminho 1, geração do lote:** igual à Geração, agrupado por tipo (Control · New faces · New hooks · New layout), cada grupo com uma linha do que muda. Linha: miniatura, nome, o que mudou, status e ação (Review se pronta, Retry se falhou, com o motivo em vermelho antes). Review já libera nas prontas; o painel escuro tem "Review the 7 ready". New copy aparece como bloco Em breve no fim.
14. **Nomes:** marca **HookMill** (logo "HM"), não "Ads Machine". A seção da sidebar chama **MAKE ADS** em vez de "ADSGUN". Eddy e Brain ficam como no plano. *Precisa do OK do Gusta.*

## 3. Tokens do design system (substitui o §3 da wizard-v1)
Tema **claro único** (o mockup não tem escuro). Fontes: **Archivo** (UI; títulos com `font-stretch: 125%` e peso 800) e **IBM Plex Mono** (números, custo, timecode, rótulos). No Next: `next/font/google` com `Archivo({ axes: ["wdth"] })` e `IBM_Plex_Mono({ weight: ["400","500","600"] })`; no Tailwind v4, nomes literais no `@theme inline`.

### Cor
| Token CSS | Valor | Uso |
|---|---|---|
| `--bg` | `#EEEEEA` | fundo da página |
| `--card` | `#FDFDFB` | cartões, FlowBar, barra de ação, painel do editor |
| `--card-2` | `#F3F4F0` | fundo interno (chips, segmented, bloco Em breve) |
| `--input` | `#FFFFFF` | campos |
| `--line` | `#DCDDD7` | borda de cartão |
| `--line-soft` | `#E4E5E0` | divisória interna |
| `--line-strong` | `#CFD1CB` | borda de botão outline e campo |
| `--control` | `#B9BCB5` | círculo/checkbox vazio, tracejado do Em breve |
| `--sep` | `#9A9F96` | chevron da FlowBar |
| `--fg` / `--fg-2` / `--fg-3` | `#15171A` / `#3B4047` / `#5A6068` | texto primário / corpo secundário / rótulo |
| `--fg-btn` | `#4A5058` | botão ghost, passo futuro |
| `--accent` | `#C8F03C` | o único acento: primário, passo atual, seleção no editor, número do painel escuro |
| `--accent-ink` | `#3E5200` | hover de link |
| `--accent-soft` / `--accent-edge` | `#F0F8D2` / `#A9CC2A` | linha "esperando você" em destaque, cartão Edit in video / borda do lima |
| `--ink` | `#16181B` | sidebar, painel instrumento, palco e timeline do editor |
| `--ink-2` / `--ink-3` | `#202328` / `#2A2E33` | seletor de cliente / item ativo e clipe |
| `--ink-line` | `#2E3238` | bordas no escuro |
| `--ink-fg` / `--ink-fg-2` / `--ink-fg-3` | `#F2F3EE` / `#C5CAD0` / `#9AA1A9` | texto no escuro |
| `--ok-bg` / `--ok` / `--ok-dot` | `#E2F3E8` / `#0B6B43` / `#1C9A5E` | pronto, aprovado, sincronizado |
| `--warn-bg` / `--warn` | `#FBF0D3` / `#7A5000` | espera ação, mudança não renderizada, zona segura |
| `--bad-bg` / `--bad` / `--bad-edge` | `#FBE7DD` / `#A8360C` / `#E4B9A6` | falhou, teto estourado, Reject |
| `--info-bg` / `--info` | `#E6EBFC` / `#2B4BC8` | em andamento (gerando, renderizando), foco (`--ring`) |
| `--info-on-ink` | `#8FA6FF` | guia de alinhamento no palco do editor |

Status por cor (mapa da v1, cores novas): em andamento = azul · espera humana = âmbar · falhou = vermelho · pronto = verde · Em breve = neutro tracejado. O lima **não** é status: é ação e seleção.

### Tipo, raio, tamanho
| Token | Valor |
|---|---|
| `--font-sans` / `--font-mono` | `"Archivo", "Helvetica Neue", Arial, sans-serif` / `"IBM Plex Mono", ui-monospace, Menlo, monospace` |
| h1 | 30 px (24 no mobile), 800, `font-stretch:125%`, `letter-spacing:-.015em` |
| h2 · base · secundário · rótulo | 16–17 px 700 · 14 px · 13 px · mono 11 px caixa alta `letter-spacing:.08em` |
| número grande do painel | mono 54 px (42 no mobile), lima |
| `--r-chip` / `--r-ctl` / `--r-btn` / `--r-card` / `--r-panel` / pill | 8 / 10 / 12 / 16 / 18 / 999 px |
| alvo de toque | 44 px mínimo (botão `lg` 50, `sm` 36) |

### shadcn (`components.json`: style new-york, `--radius: 0.75rem`)
`--background`→`--bg` · `--foreground`→`--fg` · `--card`/`--popover`→`--card` · `--muted`→`--card-2` · `--muted-foreground`→`--fg-3` · `--border`→`--line` · `--input`→`--line-strong` · `--primary`→`--fg` (`--primary-foreground` `#FFFFFF`) · `--accent`→`--card-2` (hover do shadcn) · **`--brand`→`--accent`** (lima, variante nova) · `--destructive`→`--bad` · `--ring`→`--info` · `--sidebar`→`--ink`, `--sidebar-foreground`→`--ink-fg-2`, `--sidebar-accent`→`--ink-3`, `--sidebar-primary`→`--accent`. Status como `--color-status-{progress,waiting,failed,approved}` + `-bg`.
O `editor.css` troca `--stage` por `--ink` e a seleção azul por `--accent`.

## 4. Componentes
| Peça | shadcn / próprio | Nota |
|---|---|---|
| Sidebar | `Sidebar` do shadcn (`collapsible="offcanvas"`) | some no ≤760 px; vira topo escuro com cliente + menu (`Sheet` de cima) |
| Seletor de cliente | `DropdownMenu` | troca de workspace; "All clients" no fim |
| FlowBar | próprio `FlowBar {flow, current, running}` | fases Plan/Make/Ship; passo `soon` tracejado; mobile = linha + segmentos |
| Botão | `Button` | variantes `brand` (lima, nova), `default` (tinta), `outline`, `ghost`, `destructive` (contorno vermelho); tamanhos `sm` 36 / `default` 44 / `lg` 50 |
| Painel instrumento | próprio `InkPanel` (`Card` com `--ink`) | rótulo mono, número grande, `ink-list` de fatos, barra lima |
| Tags | `Badge` → `StatusChip` | `progress` (ponto pulsando), `waiting`, `failed`, `ready`, `neutral` |
| Em breve | **`SoonBadge`**, **`SoonBlock`** (`{what, example?, children}`), **`SoonSection`** (`{title, promise, actions, preview}`) | conteúdo filho com `inert` + `aria-hidden`; `ExampleBadge` listrado |
| Rostos | `ToggleGroup` single em grade | tile 4:5; selecionado = contorno tinta 2,5 px + check lima |
| Motor | `RadioGroup` com itens em cartão | modelo = `ToggleGroup`; voz = `Select` + Hear |
| Linha de cena / variação | próprio `SceneRow` (já existe; troca pele) | `beam` só em `generating`; motivo antes da ação |
| Player | `VideoPlayer` da v1 num `Stage` escuro | |
| Template | `ToggleGroup` com miniatura | |
| Alertas | `Alert` | `destructive` (vermelho), `warning` (âmbar, novo), `success` (verde), `info` |
| Toast | `Sonner` | fundo `--ink` |
| Efeitos | `components/fx`: `ImageGeneration`, `BorderBeam` (cores lima→azul) | só em espera |

## 5. Telas e estados (os do mockup)
| Tela | Estados | O que muda da v1 |
|---|---|---|
| **Face** | ready · generating (4 tiles com efeito + tempo + "pode sair") · blocked (alerta com a causa, rostos antigos esmaecidos, Continue desabilitado) | painel THIS AD à direita |
| **Engine** | ready · over cap | estimativa no cartão do motor + resumo no painel escuro com barra do teto |
| **Generate** | in progress · scene failed (só a cena regera) · all ready (verde, tempo e custo) | progresso no painel escuro com beam; Continue só com tudo pronto |
| **Edit** | ready · changed · rendering · render failed · after editor | cartão Edit in video no topo do painel |
| **Send** | ready · done (verde, nome do arquivo, Open the Library) | Meta em breve; download + Library hoje |
| **Batch** (caminho 1) | in progress · one failed · all ready | grupos por tipo, Control incluído |
| **Edit in video** | hook selected · exporting | pele nova; regras do editor v1 |
| **Em breve** | seção (Campaigns) · blocos (Home, Pick a winner, Plan) | novo |
Carregando (não está no mockup): `Skeleton` com o mesmo layout, e o painel escuro com o rótulo e as linhas em esqueleto.

## 6. Responsivo
- Container queries no shell (`@container app`): **≤900 px** a grade de rostos vai pra 2 colunas e os painéis escuros descem pra baixo do conteúdo; **≤760 px** a sidebar vira topo escuro, a FlowBar vira a versão compacta, a barra de ação fica fixa na base com os botões dividindo a largura, a ação da linha de cena desce pra baixo dela.
- Gutter de 16 px no mobile, 32 px no desktop. Nada rola na horizontal, só a timeline do editor (rolagem própria).
- **Celular:** Face, Engine, Generate, Edit, Send, Batch e Em breve completam em 390 px (veja no mockup com "Phone 390"). O editor no celular segue a decisão 3 do editor v1: texto, estilo e correção de palavra pela dock; posição, tempo e cenas ficam no computador.

## 7. Idioma
EN padrão; PT-BR por chave (`next-intl`) com o seletor EN/PT no rodapé da sidebar. Termos PT novos: Planejar / Produzir / Entregar (fases), Rosto, Motor, Geração, Edição, Enviar, Em breve, Dados de exemplo, Baixar MP4, Salvar na Biblioteca. Kling 3.0, Seedance e lipsync ficam com o nome original. O conteúdo gerado segue o idioma da oferta.

## 8. O que o frontend precisa da API
Nada novo nas telas de Face, Engine, Generate, Edit, Batch e editor: são os mesmos contratos da v1, do variar-campeão e do `editor-v1.md`. Só três coisas:
| Tela | Precisa | Observação |
|---|---|---|
| Send | `GET /creatives/:id/download` → URL assinada + `fileName` padronizado | o nome segue `CLIENTE_CAMINHO_MMDD_ROTEIRO_ROSTO_FORMATO`; a regra mora na API pra ser a mesma no lote |
| Send | `POST /library` (já existe via approve) | o checkbox só evita duplicar se já está na Library |
| Em breve | nenhuma | o conteúdo de exemplo é estático no front, marcado como exemplo |
| Sidebar | contagem de Review (já existe: "waiting on you") | |

## 9. Pendências pro Gusta
1. **FlowBar em fases** (Plan → Make → Ship) nos dois caminhos, com Concepts visível como Em breve.
2. **Editor em palco escuro** com painel claro, e seleção em lima em vez de azul.
3. **Send hoje = Download + Library**, com o nome de arquivo padronizado.
4. **Nomes:** marca HookMill (não Ads Machine) e seção "MAKE ADS" (não "Adsgun").
5. Selo Em breve **neutro**, e a seção Em breve com a prévia esmaecida e dados marcados como exemplo (confirma o §3 do plano).
