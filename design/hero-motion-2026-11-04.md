# Hero da landing com motion: o moinho (HookMill) — 04/11/2026

Status: **proposta, aguardando o Gusta**. Não virou código. Protótipo navegável: link no fim deste arquivo.

> **04/11, aprovado e implementado (opção C, exemplo Pocketwise, trilho mobile).** Única mudança do Gusta: **sem "unlock to download"** — saiu a 4ª variação borrada, o cadeado, a marca d'água PREVIEW e o HUD "hook sharp to 0:03". Loop continua 14,0 s: 0–0,9 upload · 0,9 READ · 1,0–4,2 leitura · wipes 4,2 / 5,7 / 7,2 / 8,7 (1 de 4 → 4 de 4) · 10,0 / 10,3 conjuntos 8 e 4 enchem · 11,4 Draft → Paused on Meta · 12,6 quadro de repouso (= pôster, frame 378) · 13,4–14,0 reset (o vídeo volta ao campeão cru com o mesmo wipe lime; crossfade fazia rosto fantasma). Trilho ≤ 560: **Read · Batch · Template · Paused** ("Ad sets of 8 and 4, budget set" no lugar de "Sharp to 0:03, then locked"). Tempos do "Why it works" conferidos com faster-whisper no campeão: gancho 0:00–0:02 ("Okay, I have to show you this."), prova 0:14 ("Three weeks in, I saved 400 bucks."), CTA 0:18 ("Links right below."); a fala não cita assinaturas nem trial de 7 dias (isso era texto gerado pelo breaking-news/oferta), então whyProof/whyCta foram reescritos. O vídeo usa o trecho 3,2–17,2 s da fala (começa e termina em pausa). Arquivos: `video/src/landing/HeroMill.tsx` + `render-hero.sh`, `web/public/landing/hero/hero-mill.{webm,mp4,jpg}`.
Fonte do pedido: Gusta, 04/11 ("planejar algo com motion e Remotion pro hero ficar mais atrativo").
Mexe em: `web/src/components/landing/collage.tsx`, `landing-motion.tsx`, `landing.css`, `web/messages/{en,pt-BR}.json` (bloco `landing.collage`) e um vídeo novo renderizado no workspace `video/`.

Consultei antes de decidir: `references/video-repos/README.md` (roteador: pra promo de app/SaaS ele aponta `opus-video-prompts` 12–16, `mg-styles-15` e as `explainer-*`; todos são vídeo-arquivo de 10–20 s, não UI viva), `references/stack-animacao-video-codigo.md` (regra da casa: vídeo que sai como arquivo = Remotion; movimento dentro da página = GSAP/Motion) e o estado atual da landing (GSAP + ScrollTrigger já carregados, "mill" de headlines em loop de 6 s, parallax por profundidade, vídeos reais `public/landing/ex/` já tocando nas seções de baixo).

---

## 1. O problema

1. **A colagem conta a história certa, mas parada.** São 5 cartões que o visitante precisa ler um por um pra entender "suba o campeão → ele é lido → vira lote → amostra grátis → sobe pausado no Meta". Ninguém lê 5 cartões num hero.
2. **O celular mostra um círculo cinza.** É o único lugar do hero que deveria provar o produto (um vídeo de verdade) e é placeholder.
3. **O exemplo não bate com o resto da página.** O hero fala de colchão e sono ("Still waking up at 3am?"); as seções "Exemplos reais" e "1 → 12", logo abaixo, mostram a Pocketwise (app de finanças). Dois produtos fictícios diferentes na mesma página parecem montagem.

## 2. A decisão: C, híbrido

**Um único vídeo Remotion, sem texto de interface, dentro do celular. Tudo o que é interface continua HTML vivo, e uma timeline GSAP amarra os dois no mesmo relógio.**

O vídeo (composição `HeroMill`) mostra o que só um vídeo consegue mostrar bem: a mesma mulher falando sem parar enquanto a moldura em volta dela troca de template a cada 1,5 s (Nova headline → Split screen → Breaking news → Meme POV). Como os 18 templates de moldura saíram do mesmo avatar com o mesmo tempo, a troca acontece no mesmo frame da fala: a pessoa continua, o anúncio muda. Esse é o "moinho".

Os cartões em volta (Vencedor, Por que funciona, Plano de variações, Modelo de publicação) seguem HTML, traduzidos pelo `next-intl`, e se animam sincronizados ao tempo do vídeo: a barra do upload enche, o chip READ entra, as linhas Gancho/Prova/CTA acendem enquanto o vídeo está naquele trecho, cada variação marca no plano no instante em que aparece no celular, a última fica borrada com cadeado, os conjuntos do Meta se preenchem e o status vira "Paused on Meta".

### Por que não A nem B

| | A. Vídeo Remotion do hero inteiro | B. HTML vivo + vídeos nos cartões | **C. Híbrido (escolhido)** |
|---|---|---|---|
| Peso | A colagem tem ~620×560 px; pra texto de UI nítido em tela retina o vídeo precisa de ~1240×1120. 14 s nessa resolução com texto fino: 2,5–4 MB em H.264. Estoura 1,5 MB, ou fica borrado. | 4–5 vídeos 270×480 decodificando ao mesmo tempo (~250–400 KB cada) pra trocar a moldura. Peso ok, CPU ruim no celular. | 1 vídeo 432×768 (o celular tem 212 px de largura, 2×) ≈ 600–900 KB em MP4, ≈ 400–600 KB em WebM AV1. + pôster ~25 KB. **< 1,5 MB.** |
| LCP | O pôster de 1240 px vira o maior elemento acima da dobra e compete com o H1. | O H1 continua sendo o LCP. | O H1 continua sendo o LCP; o vídeo só carrega depois do primeiro paint (`preload="none"` + `requestIdleCallback`). |
| Acessibilidade | Texto queimado: leitor de tela não lê, tradutor do navegador não traduz, ninguém seleciona. Precisa de `aria-label` longo e transcrição. | Texto real. | Texto real em todos os cartões; o vídeo é decorativo (`aria-hidden`), a história está no HTML. |
| i18n EN/PT | 2 renders por mudança de copy, 2 arquivos em cache. | Grátis (mensagens). | Grátis. O vídeo não tem texto de interface; o texto que aparece nele é o do anúncio, em inglês, como seria na vida real (a oferta Pocketwise é EN). Um arquivo serve os dois idiomas. |
| Manutenção | Mudar uma palavra = abrir o Remotion, renderizar, comprimir, subir. | Toda a troca de moldura em JS; sincronizar 5 vídeos é frágil (Safari atrasa `play()`). | O vídeo só muda se trocar os templates do exemplo. O resto é copy e GSAP, igual hoje. |
| Mobile | Texto de UI encolhido pra 358 px fica ilegível. | 5 decodificações em celular médio = engasgo e bateria. | Um vídeo pequeno, cartões reorganizados (ver §5). |
| Fidelidade | Perfeita, e serve de anúncio da própria HookMill. | Média. | Alta no que importa (o vídeo), nativa no resto. |

O que se perde com C: o vídeo do hero não serve sozinho como anúncio da HookMill. Se o Gusta quiser essa peça pra redes, ela é outra composição (`HeroMillSocial`, 9:16 com legenda), feita depois com as mesmas cenas.

## 3. A história em uma frase por momento

1. **Seu anúncio vencedor entra.** (o upload termina, o chip READ entra)
2. **A HookMill lê por que ele funciona.** (gancho, prova e CTA acendem em sequência)
3. **Ele vira um lote.** (a mesma pessoa, 4 molduras novas, uma a cada 1,5 s; o plano marca 1 de 4 … 4 de 4)
4. **Você vê a prévia grátis antes de pagar.** (a 4ª fica nítida até 0:03 e borra; cadeado "Unlock to download")
5. **Sobe pausado no Meta.** (conjuntos de 8 e 4 se preenchem; status Draft → Paused on Meta)

## 4. Storyboard quadro a quadro (loop de 14,0 s)

Relógio único: `t` em segundos dentro do loop. Na implementação, `t = video.currentTime` do `HeroMill` (o vídeo tem exatamente 14,0 s e `loop`). A timeline GSAP é criada `paused: true` e recebe `tl.time(t)` a cada frame (`requestVideoFrameCallback`, com `requestAnimationFrame` de reserva). Assim o HTML nunca escorrega do vídeo, mesmo se o vídeo travar pra carregar.

Easing da casa: entrada `power3.out`, troca/wipe `power3.inOut`, chip que "chega" `back.out(2)`, barra de progresso `power2.inOut`, varredura de leitura `none` (linear, é um playhead).

| t (s) | Celular (vídeo `HeroMill`) | Cartões HTML (GSAP) | O que a pessoa entende |
|---|---|---|---|
| 0,0 | Campeão cru (avatar falando, sem moldura). | Estado inicial: barra do upload vazia; plano "0 of 4", caixas vazias; publicação "Draft", conjuntos vazios. Código no pé do celular: `WINNER`. | "Isso é um anúncio de alguém." |
| 0,0–0,9 | Campeão. | Barra do cartão **Vencedor** enche 0 → 100 % (`scaleX`, 0,9 s, `power2.inOut`). | "Subiram o anúncio." |
| 0,9 | Campeão. | Chip **READ** entra (`scale .6→1`, `autoAlpha`, 0,35 s, `back.out(2)`); borda do cartão pisca para `--brand` e volta (0,6 s). | "Foi lido." |
| 1,0–4,2 | Campeão. Selo `READING` no canto do celular (HTML). | Cartão **Por que funciona**: playhead percorre a mini-régua do vídeo (linear, 3,2 s). Linhas acendem uma de cada vez (fundo `--brand-soft` 0,25 s + sublinhado 0 → 100 %): Gancho 1,0–2,0 · Prova 2,0–3,1 · CTA 3,1–4,2. A linha anterior volta ao normal. | "Ela entendeu o que segura a atenção, onde está a prova e qual é a chamada." |
| 4,2 | **Wipe** (0,45 s, `power3.inOut`, da esquerda pra direita, com fio lime de 2 px na borda) para **Nova headline**, no mesmo frame da fala. | Plano: linha 1 `NEW-HEADLINE` marca (caixa enche, chip FREE entra, 0,3 s); contador "1 of 4". Código do celular rola para `NEW-HEADLINE` (máscara, `yPercent`, igual ao mill de hoje). Selo `READING` sai. | "A mesma pessoa, um anúncio novo." |
| 5,7 | Wipe para **Split screen**. | Linha 2 marca; "2 of 4"; código `SPLIT-SCREEN`. | "Outro formato, sem regravar." |
| 7,2 | Wipe para **Breaking news**. | Linha 3; "3 of 4"; código `BREAKING-NEWS`. | "Mais um." |
| 8,7 | Wipe para **Meme POV**. | Linha 4; "4 of 4"; código `MEME-POV`. | "Um lote inteiro." |
| 9,3–9,65 | Meme POV **desfoca** (baked no vídeo: `blur` 0 → 14 px em 10 frames). | Cadeado + "Unlock to download" entram (`back.out(2)`, 0,35 s). HUD: "hook sharp to 0:03". Na linha 4 do plano, o chip FREE vira `PREVIEW`. | "Vejo a prévia grátis; pra baixar, libero." |
| 9,65–10,8 | Meme POV borrado (segura). | Segura. | (tempo de leitura) |
| 10,8–11,4 | Borrado. | Cartão **Modelo de publicação**: conjunto 1 "8 ads" enche (0,3 s, `power3.out`), conjunto 2 "4 ads" enche (+0,3 s). | "Os aprovados viram conjuntos." |
| 11,6–12,0 | Borrado. | Status rola **Draft → Paused on Meta** (máscara, 0,4 s) e o chip verde entra. | "Sobe sozinho, pausado, eu ligo quando quiser." |
| 12,0–13,4 | Borrado. | Tudo segura no estado final. **Este é o quadro de repouso** (pôster e "reduzir movimento"). | Lê a história inteira parada. |
| 13,4–14,0 | Crossfade (0,6 s) de volta ao campeão cru (o último frame bate com o primeiro). | Volta suave (0,4 s, `power2.inOut`): cadeado sai, caixas do plano esvaziam, conjuntos esvaziam, status volta a Draft, barra do upload esvazia. | (loop sem corte) |

Regras do loop:
- Pausa quando o hero sai da tela (`IntersectionObserver`, já existe pros vídeos `data-lp-video`) e quando a aba fica oculta (`visibilitychange`).
- O parallax por ponteiro (desktop) continua; ele mexe no `.lp-slot`, a timeline mexe dentro do `.lp-cc`. Não brigam.
- O mill de headlines de 6 s de hoje **sai**: o novo loop o substitui (mesma ideia, agora com vídeo real).
- **Botão de pausa** visível no canto do celular (WCAG 2.2.2: movimento automático com mais de 5 s precisa de pausa). Ícone pause/play, `aria-label` "Pause animation"/"Play animation", foco visível, 32×32 px (44×44 de área de toque).

## 5. Responsivo

| Largura | Layout |
|---|---|
| ≥ 1061 px | Colagem atual (posições absolutas, 560 px de altura), com os 4 cartões + celular nas mesmas posições. Os cartões só ganham as marcações sincronizadas; o parallax continua. |
| 561–1060 px | Grade de 2 colunas que já existe: Vencedor e Por que funciona à esquerda, celular ocupando 2 linhas à direita, Plano e Publicação embaixo em largura cheia. |
| ≤ 560 px (390) | **Nova:** hoje o celular perde Por que funciona e Plano, e a história some. Passa a ser uma pilha de 3 peças: (1) faixa do Vencedor numa linha (miniatura + nome do arquivo + chip READ); (2) celular centralizado, 232 px de largura; (3) **trilho de 4 etapas** (Read · Batch · Preview · Paused) com a etapa atual acesa e uma frase curta embaixo que troca no tempo do vídeo ("Hook, proof and CTA found", "4 of 4 variations, free", "Sharp to 0:03, then locked", "Paused on Meta until you turn it on"). O cartão de publicação vira a etapa 4 do trilho. |

**Atualização 04/11 (pedido do Gusta, nenhum cartão cobre texto de outro):** a linha ≥ 1061 px mudou. ≥ 1344 px (colagem ≥ 620 px): 3 colunas, Vencedor sobre Por que funciona à esquerda, celular de 180 px no meio, Plano sobre Publicação à direita um degrau abaixo, 572 px de altura. 1061–1343 px (colagem 479–619 px): 2 colunas, Vencedor / Por que funciona / Publicação à esquerda e celular de 200 px sobre o Plano à direita, 672 px de altura (3 colunas não cabem nessa largura). Folga entre cartões ≥ 10 px, maior que o deslocamento relativo da paralaxe. A nota do hero deixou de falar em liberar: "4 free variations from your own ad. Pay when you want more." / "4 variações grátis a partir do seu anúncio. Pague quando quiser mais."

No celular o trilho substitui os cartões Por que funciona e Plano sem perder o que eles diziam. O vídeo é o mesmo arquivo (432×768 já é 2× de 232 px quase exato).

## 6. Reduzir movimento, sem JS e economia de dados

- `prefers-reduced-motion: reduce`: o vídeo não toca; mostra o **pôster do quadro de repouso** (t = 12,8 s: Meme POV borrado com o cadeado em HTML por cima). Os cartões renderizam direto no estado final (READ, 4 of 4, conjuntos cheios, Paused on Meta), sem animação. O botão do celular vira "Play preview" e, se a pessoa clicar, toca uma vez com a timeline (escolha dela).
- Sem JS: o HTML do servidor já sai no estado final (mesma regra de hoje: "tudo completo e no lugar no HTML; o GSAP só anima"). O `<video>` tem `poster`, então aparece o quadro de repouso.
- `navigator.connection.saveData` ou `effectiveType` 2g/3g: não carrega o vídeo; fica o pôster e a timeline roda nos cartões mesmo assim (o celular fica parado no quadro de repouso).

## 7. Copy (troca do exemplo pra Pocketwise)

O hero passa a usar a mesma oferta das seções de baixo. Tempos de Gancho/Prova/CTA abaixo são **a conferir** com a leitura real do campeão `cmw1lxafc000n22lndftt7ur4` (GET da leitura na conta de exemplos); a fala "Okay, I have to show you this." e o tema "assinaturas esquecidas" estão nos próprios vídeos.

| chave (`landing.collage.*`) | EN | PT-BR |
|---|---|---|
| `winnerMeta` | 0:20 · speech · burned captions | 0:20 · fala · legenda queimada |
| `whyHook` | Opens mid-thought: "Okay, I have to show you this." | Abre no meio da conversa: "Okay, I have to show you this." |
| `whyProof` | Names the trick: cancelling the subscriptions people forgot. | Mostra o truque: cancelar as assinaturas esquecidas. |
| `whyCta` | 7-day free trial, said once and shown as text. | Teste grátis de 7 dias, dito uma vez e mostrado em texto. |
| `reading` (novo) | Reading | Lendo |
| `planCount` | {n} of 4 | {n} de 4 |
| `statusDraft` (novo) | Draft | Rascunho |
| `statusV` | Paused on Meta | Pausado no Meta |
| `pause` / `play` (novos) | Pause animation / Play animation | Pausar animação / Tocar animação |
| `rail.*` (novos, só ≤ 560) | Read · Batch · Preview · Paused + as 4 frases da §5 | Lido · Lote · Prévia · Pausado + frases traduzidas |

Nome do arquivo no cartão Vencedor: `POCKETWISE_UGC_A_9x16.mp4`. Linhas do plano: `NEW-HEADLINE`, `SPLIT-SCREEN`, `BREAKING-NEWS`, `MEME-POV` (os slugs reais dos templates). O bloco `collage.hooks` sai.

## 8. Plano de implementação

### 8.1 Composição Remotion

- **Arquivo:** `video/src/landing/HeroMill.tsx`, registrada em `video/src/Root.tsx` como `<Composition id="HeroMill" … />`. Fica fora do registro de templates (`templates/registro.tsx`): é peça de marketing, não template do produto.
- **Formato:** 432×768, 30 fps, **420 frames (14,0 s)**, sem áudio.
- **Fontes:** `design/exemplos-templates/2026-11-04/` (1080×1920, 30 fps, 19,7 s, mesmo tempo de fala): `avatar-falando.mp4` (campeão cru), `new-headline.mp4`, `split-screen.mp4`, `breaking-news.mp4`, `meme-pov.mp4`. Copiar pra `video/public/landing/hero/` (não versionar os 1080p no git do monorepo; o README da pasta já avisa que os MP4 de exemplo não estão no `.gitignore`).
  - Atenção: `new-headline.mp4` foi aumentado de 464×832/25 fps; conferir no Studio se a fala bate frame a frame com as outras. Se não bater, trocar por `pov-testimonial.mp4` ou `gossip-white.mp4`.
- **Estrutura** (todas as camadas com o mesmo `startFrom` pra fala ficar contínua):
  - Camada 0: `<OffthreadVideo src={avatar} startFrom={S}>` o tempo todo.
  - Camadas 1–4: `<OffthreadVideo>` de cada template com o mesmo `startFrom={S}`, revelados por `clipPath: inset(0 ${100 - p}% 0 0)` onde `p = interpolate(frame, [in, in + 13], [0, 100], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })`. Entradas: frames 126 (4,2 s), 171 (5,7 s), 216 (7,2 s), 261 (8,7 s). Fio de 2 px `#c8f03c` na borda do wipe enquanto `0 < p < 100`.
  - Blur na camada 4: `filter: blur(${interpolate(frame, [279, 289], [0, 14])}px)` + `scale(1.06)` (esconde a borda clara do blur).
  - Saída: frames 402–420, opacidade das camadas 1–4 vai a 0 (crossfade pro campeão). Escolher `S` (o segundo de início dentro do vídeo de 19,7 s) de modo que o frame 0 e o frame 419 do campeão sejam parecidos (boca fechada, mesma pose). Sugestão: começar em `S` = 1,0 s e conferir na contact sheet.
  - Sem texto, sem logo, sem cadeado (tudo isso é HTML).
- **Render** (local, não Lambda; é uma vez só):
  - `npx remotion render HeroMill out/hero-mill.mp4 --codec=h264 --crf=26 --pixel-format=yuv420p --x264-preset=slow`
  - `npx remotion render HeroMill out/hero-mill.webm --codec=vp9 --crf=36` (ou AV1 via ffmpeg a partir de um ProRes: `ffmpeg -i hero-mill.mov -c:v libsvtav1 -crf 38 -preset 6 -an hero-mill-av1.webm`)
  - Pôster: `npx remotion still HeroMill out/hero-mill.jpg --frame=384 --jpeg-quality=78` e converter pra AVIF/WebP (≈ 20–30 KB).
  - `ffmpeg … -movflags +faststart` no MP4.
- **Destino:** `web/public/landing/hero/hero-mill.webm`, `hero-mill.mp4`, `hero-mill.avif`, `hero-mill.jpg`.
- **Peso alvo:** WebM ≤ 600 KB, MP4 ≤ 900 KB, pôster ≤ 30 KB. O navegador baixa um só dos dois vídeos. Total do hero ≤ 1,0 MB (meta pedida: < 1,5 MB). Se o MP4 passar de 900 KB: subir CRF de 2 em 2 e checar o rosto; depois baixar pra 24 fps.

### 8.2 Web (agente de frontend, quando o Gusta aprovar)

- `collage.tsx`: o `.lp-video` do celular troca o placeholder `.lp-scene` por
  `<video data-hero-reel muted playsInline loop preload="none" poster="/landing/hero/hero-mill.avif" aria-hidden="true">` com `<source type="video/webm">` e `<source type="video/mp4">`. Mantém cadeado, HUD e código como HTML por cima. Novos atributos: `data-tl="winner-bar|read|why-0..2|why-head|plan-0..3|plan-count|lock|adset-0..1|status"`. Botão de pausa `data-reel-toggle`. Bloco do trilho mobile `.lp-rail` (renderizado sempre; CSS mostra só ≤ 560 px).
- `landing-motion.tsx`: substitui o bloco "2. the mill" por um `heroTimeline()` que monta a timeline da §4 `paused: true` e a dirige por `video.requestVideoFrameCallback` (`tl.time(meta.mediaTime % 14)`), com reserva em `requestAnimationFrame` lendo `video.currentTime`. Sem vídeo (economia de dados), dirige por relógio de parede. Respeita o `gsap.matchMedia` que já existe (`MOTION`), o `ScrollTrigger` de pausar fora da tela e o `useGSAP` de limpeza.
- `landing.css`: estilos do selo `READING`, sublinhado das linhas, estado do plano, trilho `.lp-rail`, botão de pausa. Remove `.lp-caps`/`.lp-cap` (o mill de texto). Só `transform`/`opacity` animados; o blur do celular é do vídeo, não de CSS.
- `messages/en.json` e `pt-BR.json`: chaves da §7.
- Carga: o `<video>` recebe `preload="auto"` e `play()` em `requestIdleCallback` depois do `load` (timeout 2 s), nunca antes do H1 pintar.

### 8.3 O que precisa da API

Nada. O hero é estático (arquivos em `public/`). A única consulta é manual e uma vez: a leitura do campeão de exemplo pra acertar os tempos de Gancho/Prova/CTA da §7.

### 8.4 Aceite

- Lighthouse mobile: LCP sem piora em relação a hoje (o LCP deve continuar sendo o H1); CLS 0 no hero (o celular tem `aspect-ratio: 9/16` reservado).
- Peso transferido do hero ≤ 1,5 MB no primeiro acesso (DevTools, desabilitar cache).
- Com "reduzir movimento" ligado no sistema: nada se mexe, estado final visível, botão "Play preview" funciona.
- EN e PT: nenhum texto de interface dentro do vídeo; trocar o idioma não recarrega o vídeo.
- Em 390 px: o trilho mostra as 4 etapas, nada corta, sem rolagem horizontal.
- Pausa funciona por teclado (Tab até o botão, Enter).

## 9. Precisa do Gusta

1. **Aprovar C** (vídeo Remotion só dentro do celular + cartões HTML sincronizados) no lugar de um vídeo do hero inteiro.
2. **Trocar o exemplo do hero de colchão pra Pocketwise**, igual às seções de baixo.
3. **Mobile com trilho de 4 etapas** no lugar dos cartões que hoje somem.

Protótipo: https://claude.ai/artifact/Q6nd5rKfiSBFXfb3QcbCP3 (fonte `design/mockup-hero-motion.html`; usa os MP4 de `web/public/landing/ex/`). No protótipo o celular toca 5 clipes reais sincronizados com wipe em CSS; em produção é o vídeo único `HeroMill`.
