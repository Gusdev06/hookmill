# Variação de formato com IA, desconstrução e preços dos concorrentes (27/10/2026)

Complementa `Variações de criativos campeões.md`, que já cobre troca de gancho, avatar, primeiro frame, estático, música e Andromeda/diversidade. Aqui o foco é outro: **pegar a mensagem de um campeão e reencaixá-la em outro formato de anúncio**, quem automatiza a desconstrução e quanto cobram os concorrentes.

## Como ler

- **[OFICIAL]**: documentação da plataforma, do modelo ou de um regulador.
- **[PRATICANTE]**: Reddit ou fórum. É anedota e pode ser propaganda disfarçada.
- **[VENDEDOR]**: página ou blog de quem vende a ferramenta, ou de um concorrente dela.
- **[INFERÊNCIA]**: conclusão minha, sem fonte direta.

Limites de acesso:
- O reddit.com bloqueia, então usei o arquivo Arctic Shift. Ele deu timeout na maioria das buscas dos subs grandes, e só alguns threads de r/FacebookAds e r/VEO3 foram lidos.
- O x.com devolve 402 e não foi usado.
- Icon (AdGPT deu 404) e Poppy AI não foram verificados a fundo.
- **Não achei nenhum número de performance específico** de anúncio em podcast, entrevista de rua, skit ou reação feito com IA, nem de praticante nem de estudo.

## Antes de tudo: o Sora 2 saiu do ar

O app e o sora.com fecharam em 26/04/2026, e a Videos API e os aliases do Sora 2 foram removidos em 24/09/2026. São fontes secundárias; não abri a página oficial da OpenAI ([zilliz](https://zilliz.com/ai-faq/what-is-the-sora-shutdown-timeline), [invideo](https://invideo.io/blog/sora-ai-video-generator/)). Um praticante diz que "o pico do AI UGC veio da API do Sora 2" e que não é mais o mesmo desde então ([r/FacebookAds](https://www.reddit.com/r/FacebookAds/comments/1x1yqs0)).

Os substitutos são estes:
- **Veo 3.1** [OFICIAL]: clipes de 4, 6 ou 8 s, diálogo entre aspas, imagens de referência ("ingredients") e first/last frame ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1)).
- **Kling 3.0**: até 15 s, multi-shot e áudio nativo com voz por personagem. Essas especificações vêm de terceiros ([apiframe](https://apiframe.ai/guides/kling-3-0-guide)).
- **Seedance 2.0**: até 9 imagens de referência, com o produto como primeira referência ([Creatify](https://creatify.ai/blog/seedance-is-now-in-creatify-asset-generator), [VENDEDOR]).

## 1. Transposição de formato: o que dá para gerar e como

### Multi-pessoa é o gargalo técnico

O 2-shot nativo engana. A Google afirma que o Veo 3.1 gera "multi-person conversations", mas o exemplo oficial com dois personagens é **plano a plano, uma fala por personagem** ([Google Cloud](https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1), [OFICIAL]).

Um guia de terceiro lista as falhas típicas do diálogo no Veo ([veo3ai.io](https://www.veo3ai.io/blog/veo-3-two-character-dialogue-guide-2026)):
- as duas bocas mexem na mesma fala;
- as vozes trocam de personagem quando os timbres são parecidos;
- as falas se sobrepõem;
- o lipsync desanda quando há fala demais (o guia recomenda **2 a 4 falas curtas por clipe de 8 s**);
- o personagem muda entre os cortes.

O mesmo guia propõe corrigir com tag de figurino dentro da fala, contraste forte de timbre e plano/contraplano. Um vendedor diz que o Kling "às vezes mostra artefatos" em cenas com vários personagens ([magichour](https://magichour.ai/blog/kling-30-vs-veo-31), [VENDEDOR]).

O lipsync de pós-produção também é, na prática, um falante por vez:
- **Sync.so** [OFICIAL]: recomenda separar o áudio por falante e fazer uma passada por pessoa ([Sync](https://support.sync.so/articles/5077624656-how-do-i-lip-sync-a-video-with-multiple-speakers-or-a-two-person-dialogue)).
- **Hedra** [OFICIAL]: o "speaker selection" escolhe um único personagem que fala; os outros ficam calados ([Hedra docs](https://hedra.com/docs/pages/studio/content-creation/speaker-selection)).
- **OmniHuman 1.5**: o paper descreve máscara por falante ([arXiv](https://arxiv.org/pdf/2508.19209)). Mas a página do modelo no Hedra diz que não dá para dirigir uma conversa multi-personagem com um áudio só; a saída é gerar um clipe por falante e costurar ([Hedra](https://www.hedra.com/models/video/bytedance/omnihuman-15)).
- **MultiTalk** [OFICIAL]: abertos, com áudio por pessoa mais máscara facial, em 480p ou 720p e até 15 s ([HF](https://huggingface.co/MeiGen-AI/MeiGen-MultiTalk), [RunComfy](https://www.runcomfy.com/comfyui-workflows/comfyui-multitalk-workflow-multi-speaker-lip-synced-video-generator)).
- **InfiniteTalk** [OFICIAL]: também aberto, tem modo multi-pessoa, mas o schema não está documentado ([GitHub](https://github.com/MeiGen-AI/InfiniteTalk)).

**[INFERÊNCIA]** O caminho robusto para podcast, entrevista e skit tem cinco passos:
1. diarizar o roteiro por falante;
2. gerar um TTS por voz;
3. gerar um rosto por personagem;
4. animar um clipe por falante (close ou contraplano) com lipsync de uma pessoa;
5. montar o plano/contraplano em código.

Usar o 2-shot nativo só no plano de abertura. **Isso cabe no stack atual do HookMill sem lipsync multi-pessoa.**

### Outras quebras recorrentes

- **Mãos segurando o produto**: "ponto fraco histórico do Kling, orce re-rolls" ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/), [VENDEDOR]).
- **Texto do rótulo**: o prompt não garante a tipografia. A recomendação é compor a arte aprovada na pós ([devtoollab](https://devtoollab.com/blog/product-consistency-ai-generated-ads), [VENDEDOR]).
- **Consistência do ator e do produto entre cortes**: é a dor mais citada em r/VEO3 ([r/VEO3](https://www.reddit.com/r/VEO3/comments/1tw33az), [PRATICANTE]).
- **Áudio**: "audio always makes it obvious" ([r/VEO3](https://www.reddit.com/r/VEO3/comments/1sx1tv4), [PRATICANTE]).
- **Talking head**: drift de lipsync, "olhos mortos" na ênfase e pele lisa demais ([ugcvids](https://ugcvids.ai/blog/talking-head-ugc-ads-2026), [VENDEDOR]).

### Tabela de formatos

Encaixe no HookMill, que já tem rosto gpt-image-2, TTS, lipsync Pruna (1 pessoa), cenas Kling 3.0/Seedance, Remotion e Claude:
- **Pronto**: sai com o que existe, mudando só roteiro e template.
- **Barato**: precisa de um template Remotion novo ou de uma orquestração simples.
- **Caro**: precisa de multi-personagem, mais re-rolls ou trabalho de compliance.

| Formato | Como praticantes geram hoje | Personagens / cenas | Dificuldade técnica | Evidência | Encaixe no HookMill |
|---|---|---|---|---|---|
| Review / depoimento UGC | Arcads (atores, "Product Showcase") ([arcads.ai](https://www.arcads.ai)), Captions/Mirage Ad Studio (roteiro → ator, 4 variações) ([help](https://help.captions.ai/docs/project/ad-studio-mirage)), MakeUGC (produto na mão) ([fluxnote](https://fluxnote.io/guides/makeugc-ai-review)). Hook no Veo 3.1 e corpo no Kling 3.0 ou OmniHuman ([ugcvids](https://ugcvids.ai/blog/talking-head-ugc-ads-2026)) | 1; 2-4 cenas | Baixa a média (mãos, lipsync longo) | VENDEDOR. Legal: a FTC proíbe depoimento falso, inclusive gerado por IA ([Sidley](https://datamatters.sidley.com/2024/08/30/u-s-ftcs-new-rule-on-fake-and-ai-generated-reviews-and-social-media-bots/)) | **Pronto** (é o formato base). Rotular como porta-voz, não como "cliente real" |
| Podcast (2 hosts, estúdio, microfone) | Higgsfield AI Podcast Generator: 2 hosts, Veo 3.1, Seedance, Kling 3.0, clipes de 4-15 s; "makes short clips, not full episodes" ([higgsfield](https://higgsfield.ai/ai-podcast-generator)). Shhots (1-2 hosts, anúncio de 30 s) ([shhots](https://shhots.ai/ai-ugc-ads/)). InfiniteUGC ("cast two voices") ([infiniteugc](https://www.infiniteugc.com/)). Não achei formato podcast documentado na Arcads | 2; 4-8 planos (aberto + contraplano) | **Alta**: vozes trocadas, duas bocas, consistência. 5-10 tentativas e 1-2 h por peça; ~US$12-15 de geração por 30 s antes dos retries ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | VENDEDOR; sem dado de performance | **Barato a caro**: 2 rostos + 2 vozes TTS + 2 passadas Pruna + montagem plano/contraplano no Remotion. O plano aberto dos dois pode ser Kling sem fala |
| Entrevista de rua | Templates de Veo 3/3.1: Segmind ([segmind](https://www.segmind.com/pixelflow/ai-street-interview-video-generator)), UlazAI no estilo Recess Therapy ([ulazai](https://ulazai.com/el/street-interview-ai/)). Fluxo ChatGPT → Google Flow ([lilys](https://lilys.ai/it/notes/veo3/make-viral-ai-street-interview-videos-free)). 2-3 h por peça ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | 2-6 (entrevistador + 1-5 transeuntes) | **Alta**: figurantes, ruído, tatuagem que aparece e some entre cortes ([r/VEO3](https://www.reddit.com/r/VEO3/comments/1uk7pu4)) | VENDEDOR/PRATICANTE; sem performance | **Caro**: N rostos, N vozes. Versão barata: o entrevistador fica fora de quadro (só o microfone e a voz) e cada transeunte é um talking head de 1 pessoa |
| "Descoberta" (TikTok made me buy it, achei isso) | Templates "TikTok Made Me Buy It"/"Storytime" a partir da URL ([synthesys](https://synthesys.io/ai-tiktok-ad-generator/)). Creatify: "Chasing the Product POV", "Shopping Cart Perspective" ([Creatify](https://creatify.ai/blog/4-viral-ad-templates-you-can-clone-with-ai-right-now)) | 1; 2-3 cenas (talking head + B-roll do produto) | Baixa | VENDEDOR | **Pronto**: muda o roteiro (Claude) e entra uma cena de "achado" no Kling |
| Reação / duet / stitch | Revid ([revid](https://www.revid.ai/tools/ai-reaction-video-generator)), Creatify Reaction Maker ([Creatify](https://creatify.ai/tools/reaction-video-maker)), Atlabs ([atlabs](https://www.atlabs.ai/use-cases/reaction-video-generator-with-ai-avatars/)): tela dividida com avatar reagindo | 1 + o vídeo-fonte | Baixa | VENDEDOR | **Barato**: o rosto reage em cima do próprio campeão (split no Remotion) |
| Green screen sobre notícia, print, Reddit ou tweet | Icon: "green screen over your landing page" ([ppc.io](https://ppc.io/blog/ai-ugc)). Wavemaker Green Screen ([wavemaker](https://wavemaker.adwave.com/video-styles/green_screen_explainer)). Ator em WebM transparente ([videobgremover](https://api.videobgremover.com/ai-ugc)) | 1 | **Baixa**: o print é imagem real ou código, não sai do gerador | VENDEDOR | **Barato**: talking head com recorte + fundo em Remotion. É o melhor custo-benefício da lista [INFERÊNCIA] |
| Unboxing | Preset "Unboxing" do Higgsfield Marketing Studio (avatar + produto + embalagem) ([higgsfield blog](https://higgsfield.ai/blog/marketing-studio-video-1)). Labels na Arcads ([arcads.ai](https://www.arcads.ai)). Veo 3.1, Kling ou Seedance em 1-2 h ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | 0-1; 3-5 cenas de mão | Média a alta (mãos, rótulo) | VENDEDOR | **Caro** para produto físico. Para infoproduto/SaaS, vira "unboxing de tela" (Remotion) |
| Antes/depois | Stills em FLUX Kontext ou Nano Banana + Kling first/last frame, em 20-60 min ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)). Veo 3.1 também tem first/last frame [OFICIAL] | 0-1 | Média | VENDEDOR. Risco: um "depois" gerado vira promessa enganosa em saúde e beleza | **Barato** (gpt-image-2 + Kling), mas precisa de trava de compliance por nicho |
| POV / demo de produto | Kling i2v e Seedance 2.0 com o produto como referência ([Creatify](https://creatify.ai/blog/seedance-is-now-in-creatify-asset-generator), [nikhil.pro](https://nikhil.pro/ai-ugc-ads-seedance-veo-chatgpt/)) | 0-1 | Média a alta (mãos, produto vira "blob") | PRATICANTE: num teste de US$ 10k, o anúncio de 30 s 100% IA foi "garbage" e a demo real teve de ser filmada ([r/FacebookAds](https://www.reddit.com/r/FacebookAds/comments/1x1yqs0)) | **Parcial**: reaproveitar a demo do campeão e gerar só o hook/POV |
| Listicle "3 motivos" | LLM + voz + Arcads ou Creatify, em 1-2 h ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | 0-1 | Baixa | VENDEDOR; sem métrica | **Pronto**: Claude reescreve em 3 beats e o Remotion põe os números na tela |
| Storytime | Template na Synthesys ([synthesys](https://synthesys.io/ai-tiktok-ad-generator/)) | 1 | Baixa (roteiro mais longo puxa o drift de lipsync) | VENDEDOR | **Pronto**: roteiro novo, com o mesmo pipeline |
| Médico / especialista | Avatar de jaleco (Arcads, HeyGen). **Política:** o TikTok exige disclaimer de mídia "completely AI-generated" ([TikTok Ads](https://ads.tiktok.com/help/article/about-ad-disclaimers-in-tiktok-ads-manager?lang=en), [OFICIAL]). A AB 489 da Califórnia proíbe a IA de se apresentar como profissional de saúde ([Senado CA](https://sd33.senate.ca.gov/sites/sd33.senate.ca.gov/files/pdf/SB%201146%20(Gonzalez)%20AI%20Health%20Ads.pdf)). Nova York exige disclosure de "AI actors", com multa de até US$ 5 mil ([Bloomberg Law](https://news.bloomberglaw.com/antitrust/ny-gov-hochul-signs-law-to-make-advertisers-disclose-ai-actors)). Já há investigações sobre médicos sintéticos vendendo suplementos ([Deseret](https://deseret.com/lifestyle/2026/07/22/artificial-intelligence-social-media-health-ads-danger)) | 1 | Baixa técnica, **alta legal** | OFICIAL (regulação). Não achei regra específica de jaleco na Meta nem no TikTok | **Bloquear em saúde** ou sair como "especialista" sem credencial, com o disclaimer de IA ligado |
| Comparação lado a lado (nós vs eles) | Estático (FLUX, Nano Banana) ou Kling i2v, de 30 min a 1,5 h ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | 0 | Baixa | VENDEDOR | **Barato**: template Remotion, sem modelo de vídeo |
| Chat / DM / iMessage / Notes | Feito à mão ou programático; a IA só escala a copy, em 10-20 min ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)). Existe uma skill pública que renderiza iMessage em HTML ([skills.rest](https://skills.rest/skill/create-imessage-video-ad)) | 0 | Baixa | VENDEDOR | **Barato**: Remotion + Claude (a conversa sai do ângulo do campeão) |
| ASMR | Veo 3 (corte de fruta de vidro viral em 2025, ">10 milhões" de reproduções em contas de criador, não de marca) ([36kr](https://eu.36kr.com/en/p/3340310849533704)) | 0 | Média (precisa de SFX nativo) | Reportagem; sem dado de anúncio | **Fraco**: Kling/Seedance sem o SFX nativo do Veo; teria que adicionar SFX |
| Founder story | HeyGen ou Argil (clone do fundador) ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | 1 (pessoa real) | Média (precisa do consentimento e de uma amostra) | VENDEDOR: caso sem números em que a foto real do dono bateu o avatar | **Parcial**: só se o cliente subir o próprio rosto e voz |
| Skit de 2 personagens | Veo 3/3.1 com cena + traço por personagem + diálogo ([dgmastery](https://dgmastery.beehiiv.com/p/how-to-structure-veo-3-prompts-with-dialogue-for-viral-ai-content-b8759051fa573851)); Kling para multi-shot ([magichour](https://magichour.ai/blog/kling-30-vs-veo-31)) | 2; 4-8 planos | **Alta** (as mesmas falhas do podcast) | VENDEDOR | **Caro**: o mesmo pipeline de diarização do podcast |
| Extras: âncora de telejornal falso, try-on, "brainrot" | Arcads e Veo 3.1 (âncora); Higgsfield Try-On ([higgsfield blog](https://higgsfield.ai/blog/marketing-studio-video-1)); "absurdo puxa view, não necessariamente comprador" ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/)) | 1 | Baixa a média | VENDEDOR | Âncora: **barato** (green screen). Try-on: fora do foco |

### Relatos de performance (todos fracos)

- **Teste de US$ 10k no Meta, 3 clientes** [PRATICANTE]. Nos comentários há acusação de shill. O teste comparou 5 UGCs humanos (US$ 200-400 cada) com 35 hooks de 3 s feitos com avatar e colados em filmagem real do produto. O híbrido teve **CPA 32% menor**, com 2 vencedores em 35. O anúncio de 30 s gerado num prompt só foi "garbage". Um comentarista aponta que o teste mudou duas variáveis ao mesmo tempo ([r/FacebookAds](https://www.reddit.com/r/FacebookAds/comments/1x1yqs0)).
- "Non ai ads are a huge edge right now" ([r/FacebookAds](https://www.reddit.com/r/FacebookAds/comments/1x8mfzf), [PRATICANTE]).
- IA com bom CTR e conversão pior quando parece sintética ([r/FacebookAds](https://www.reddit.com/r/FacebookAds/comments/1x1gymp), [PRATICANTE]).
- "Criativo visivelmente IA cansa mais rápido; o CPA piora por volta da semana 3". É observação de campo, sem estudo ([Apogee](https://www.apogee.ad/en/blog/crea-publicitaire-ia-concepts-meta-ads/), [VENDEDOR]).
- Os cards "+45% views" e "+195% receita" da Arcads parecem ilustrativos ([arcads.ai](https://www.arcads.ai), [VENDEDOR]).

## 2. Desconstruir o campeão e decidir para qual formato portar

**Não achei nenhuma ferramenta que, de forma documentada, faça o fluxo inteiro**: desconstruir o campeão em hook, ângulo, prova, CTA e persona, escolher outros formatos e reescrever os beats para cada um. O mercado se divide em três grupos:

1. **Desconstroem, mas não geram roteiro** (tagging e analytics):
   - **Motion** [OFICIAL] faz AI Tagging em 8 categorias, incluindo formato visual (listicle, founder story) e tática de hook. Está em todos os planos desde 10/11/2025, mas só para anúncios Meta com gasto nos últimos 90 dias ([Motion](https://www.motionapp.com/releases/introducing-ai-tagging)).
   - **Segwise** marca hook, personagens, CTA, emoção e texto na tela, ligado a ROAS ([Segwise](https://www.segwise.ai/features/creative-tagging)).
   - **Atria** marca conceito, pilar de teste e emoção ([Atria](https://www.tryatria.com/blog/automate-creative-tagging-stop-manually-tagging-your-ads)).
   - Os dois últimos são [VENDEDOR].
2. **Desconstroem e clonam no MESMO formato:**
   - **Foreplay Briefs** [OFICIAL] transforma o vídeo de referência em roteiro com 1 clique (diálogo, cenas e texto na tela, lado a lado com o original) ([Foreplay](https://www.foreplay.co/post/foreplay-2-0)). Segmenta em hook, depoimento, produto e CTA. Não há troca de formato documentada.
   - **Creatify Ad Clone** [OFICIAL] analisa padrão de hook, ritmo e posição do CTA e reescreve para o seu produto, trocando avatar e proporção. Não fala em trocar o formato narrativo ([Creatify](https://creatify.ai/features/ad-clone)).
   - **Icon AdSpy → AdGPT → AdCut** acha vencedores por filtro (2+ semanas no ar, razão like/comentário de 10:1) e os clona ([Icon](https://icon.com/products/adspy)).
   - **ARKADS** tem "Hook Analyzer" e "Ad Clone" a partir de link ou MP4 ([diretório](https://aiagentsdirectory.com/agent/arkads)).
   - **Higgsfield Ad Multiplier** [OFICIAL] faz o inverso do que buscamos: decompõe personagem, roupa, locação e objetos e reconstrói mantendo atuação, corte e áudio ([Higgsfield](https://higgsfield.ai/ad-multiplier)).
3. **Workflows de praticante** (n8n + Gemini + LLM): o Gemini classifica e analisa o vencedor plano a plano, e um LLM "creative strategist" gera hooks, roteiro de VO e brief ([lilys](https://lilys.ai/en/notes/ai-agent-20251205/ai-automated-meta-ad-agency), [GitHub UGC-Machine](https://github.com/cth9191/UGC-Machine)). O "viral ad cloning machine" alega "92% de similaridade estrutural", ou seja, espelha o original ([growwstacks](https://growwstacks.com/blog/n8n-ai-viral-ad-cloning-machine)).

A troca de formato existe como **método manual de estrategista**:
- No Creative Strategy Bootcamp 2026 da Motion, a tarefa da semana 7 é transformar um conceito vencedor num **novo formato visual**, em 3 níveis: iteração rápida, adaptação na pós e produção nova ([Motion](https://motionapp.com/events/2026-creative-strategy-bootcamp/homebase/homework-week-7)).
- Na semana 3, a ordem de prioridade é: iterar vencedores, depois **formato novo para mensagem já provada**, depois partnership ads ([Motion](https://motionapp.com/events/2026-creative-strategy-bootcamp/homebase/homework-week-3)).
- O caso mais próximo de "outro formato" é o de uma agência que empilha um hook de depoimento UGC com um trecho em estilo podcast ([Inceptly](https://inceptly-agency.beehiiv.com/p/one-winning-ad-two-ai-formats-three-variables-to-test)).
- No Reddit, há quem pergunte se uma ferramenta que "analise um vencedor e gere estrutura similar adaptada" seria útil, o que sinaliza demanda ([r/FacebookAds](https://reddit.com/r/FacebookAds/comments/1sd181a/)).

**[INFERÊNCIA]** Desconstruir é commodity, porque o Gemini e o Claude resolvem em casa. Clonar no mesmo formato está ocupado. O passo que segue manual é **manter ângulo, persona e prova e reescrever os beats para um formato escolhido**, com uma justificativa do porquê aquele formato (ex.: "prova social forte → entrevista de rua"; "objeção técnica → podcast com cético"). Essa é a lacuna.

## 3. Preços dos concorrentes

Datas: página oficial acessada em 27/10/2026, salvo indicação. O custo efetivo é **só o piso de geração**, sem re-rolls nem descartes.

| Ferramenta | Plano | Preço | O que 1 crédito compra / inclui | Custo por vídeo de ~30 s (conta) | Limites | Fonte |
|---|---|---|---|---|---|---|
| **Creatify** | Standard / Pro / Max / Business | US$ 10 / 38 / 66 / 136 por mês (lista: 15 / 55 / 95 / 195) | 55 / 280 / 730 / 1.500 créditos. 55 créditos = 11 avatares Aurora de 15 s, logo **1 crédito ≈ 3 s de avatar** | 30 s = 10 créditos. Fica em US$ 1,82 (Standard), 1,36 (Pro) e ~0,90 (Max/Business) | 2 min por vídeo no Standard e 10 min no Pro. Créditos valem 2 meses. API: US$ 99/500 e US$ 299/2.000 créditos. Free: 10 créditos com marca d'água | [creatify.ai/pricing](https://creatify.ai/pricing), oficial, 27/10/2026 |
| **Arcads** | Lite / Starter / Creator / Pro | US$ 29 / 110 / 220 / 550 (30% off em promoção) | Ator falante = **800 créditos por minuto cheio, arredondado para cima**. Creator tem 16.000 e Pro tem 48.000 créditos. O Lite não tem ator falante | 30 s é cobrado como 1 min: 800 × (220/16.000) ≈ **US$ 11** (US$ 7,70 com a promoção) | Cobrança por minuto cheio | Sem /pricing pública (404 e login). Terceiros: [Creatify blog](https://creatify.ai/blog/arcads-pricing-(2026)-plans-credits-and-what-you-ll-actually-pay) (preços de 24/08/2026; é concorrente) e [eesel](https://www.eesel.ai/en/blog/arcads-ai-pricing) (2026; "1 crédito = 1 vídeo", também ≈US$ 11) |
| **MakeUGC** | Starter / Growth / Pro | US$ 29 / 39 / 79 por mês no plano anual | 500 / 1.000 (+200) / 2.000-5.000 créditos. **Não publica o que 1 crédito compra** ("varia por modelo, duração e resolução") | Não calculável | Starter: 480/720p, 1 geração por vez. Sem marca d'água, API e MCP. Créditos não acumulam. Teste por US$ 1 | [makeugc.ai/pricing](https://www.makeugc.ai/pricing), oficial, 27/10/2026 |
| **HeyGen** | Free / Creator / Pro / Business | US$ 0 / 29 (24 no anual) / 49 / 149 + 20 por assento | 3 vídeos no Free; 600 / 1.000 / 1.500 créditos (oficial). Avatar IV/V = **20 créditos/min** e Avatar III = 3 créditos/min (terceiros; há relato de 16, 31 e 48/min por look) | Avatar IV, 30 s = 10 créditos: 10 × (29/600) ≈ **US$ 0,48** | Creator: 30 min e 1080p. Pro: 4K. Free com marca d'água | [heygen.com/pricing](https://www.heygen.com/pricing), oficial, 27/10/2026; créditos/min: [Creatify blog](https://creatify.ai/blog/heygen-pricing-(2026)-plans-and-what-you-ll-actually-pay) (concorrente) e [Arcade](https://www.arcade.software/post/heygen-pricing) |
| **Higgsfield** | Plus / Ultra | Plus US$ 49 por mês (39 no anual). Ultra US$ 129 por mês (99 no anual). Recarga: 20 créditos por dólar, validade de 90 dias | Plus: 1.000 créditos, "~200 Kling 3.0 videos", logo **~5 créditos por clipe Kling 3.0**. A tabela também diz "100 créditos ≈ 4 vídeos Seedance 2.0", logo ~25 créditos por clipe. A duração do clipe não é informada | Por clipe, e não por 30 s: Kling 3.0 ≈ 5 × (49/1.000) ≈ **US$ 0,25**; Seedance 2.0 ≈ 25 × 0,049 ≈ **US$ 1,22**. Um anúncio de 30 s usa vários clipes | Até 6 vídeos em paralelo (Plus) ou 8 (Ultra). Promoções de "ilimitado" por 7 ou 365 dias em modelos de imagem e Kling 3.0 720p/5 s | Tabela de preço ao vivo lida pelo conector oficial da Higgsfield em 27/10/2026 (a [página /pricing](https://higgsfield.ai/pricing) é SPA e não renderizou). Os terceiros divergem entre si |
| **Captions / Mirage** | Max / Frontier / 2x / 4x | US$ 24,99 / 69,99 / 139,99 / 279,99 por mês (preços do iOS) | 500 / 1.400 / 2.800 / 5.600 créditos. Ad Studio = **10 créditos por segundo**, com 4 variações por geração | 30 s = 300 créditos: 300 × (24,99/500) ≈ **US$ 15** por geração com 4 variações (≈US$ 3,75 por variação) | Créditos acumulam até 3× a cota | [captions.ai/pricing](https://captions.ai/pricing), oficial, 27/10/2026; créditos por segundo: [help Captions](https://help.captions.ai/docs/project/ad-studio-mirage) |
| **AdCreative.ai** | Starter / Pro / Ultimate | US$ 39 / 249 / 999 por mês (20 / 125 / 500 no anual) | 20 / 300 / 300 créditos. **Não diz o que 1 crédito compra.** A própria página traz valores inconsistentes | Se 1 crédito = 1 download, ≈US$ 1,95 por peça no Starter. **É hipótese** | Por número de marcas | [adcreative.ai](https://www.adcreative.ai/), oficial, home de 27/10/2026 (/pricing dá 404) |
| **Icon** (agência humana) | The Agency | US$ 1.000 por mês, após 3 dias de teste | 6 anúncios (2 criadores × 3), diretor criativo, roteiro e edição | 1.000 ÷ 6 ≈ **US$ 167 por anúncio** | Entrega em 12-16 dias, direitos totais | [icon.com/pricing](https://icon.com/pricing), oficial, 27/10/2026 |
| **Billo** (UGC humano, referência) | Saldo pré-pago | A partir de **US$ 99 por vídeo**. Pacotes: US$ 550/60 e US$ 3.872/560 créditos | Inclui o criador, 2 revisões e direitos. Duração, formatos, hooks e variações são extras | US$ 69-99 base; ≈US$ 150 com extras (terceiros) | Produto e frete por conta do cliente. Saldo vale 12 meses | Guia de preços da Billo, outubro/2026 ([billo.app](https://billo.app/?p=54672)); terceiro: [ainfluencer](https://ainfluencer.com/billo/) |

Leitura rápida:
- O piso de IA vai de **US$ 0,25 por clipe** (Higgsfield/Kling) a cerca de **US$ 11 por vídeo** (Arcads, cobrada por minuto cheio).
- Creatify e HeyGen ficam entre US$ 0,50 e 2 por avatar de 30 s.
- O humano custa 50 a 100 vezes mais: US$ 99-167.
- A régua que importa contra o HookMill é **custo por variação aprovada**, que ninguém publica.

Não pesquisados: TopView, Poppy AI, Hedra, Insense e Trend.

## Conclusão

Trocar de formato é a próxima alavanca de diversidade e cabe quase toda no stack que o HookMill já tem. Os formatos se dividem em três classes:
- **Programáticos** (chat/DM, nós vs eles, green screen sobre print, listicle): saem com Claude + Remotion, a custo quase zero.
- **De 1 personagem** (review, descoberta, storytime, reação sobre o próprio campeão, founder): são o pipeline atual com roteiro e template novos.
- **Multi-pessoa** (podcast, entrevista de rua, skit): são os mais pedidos e os mais frágeis. Mesmo os vendedores admitem clipes curtos e 5 a 10 tentativas.

O lipsync multi-pessoa num plano só continua instável. Por isso o caminho é diarizar o roteiro e montar plano/contraplano, com um rosto, uma voz TTS e uma passada de Pruna por falante, emendados no Remotion. Isso dispensa um modelo novo. O que nenhum concorrente faz de forma documentada é o elo entre as duas pontas: desconstruir o campeão (hook, ângulo, prova, CTA, persona) e **decidir para quais formatos portar, preservando a mensagem**. Motion e Foreplay desconstroem; Creatify, Icon e Higgsfield clonam no mesmo formato; a troca de formato só aparece como lição de casa no bootcamp da Motion. No preço, um vídeo de IA custa de US$ 0,25 a 11 por geração, e o espaço para cobrar está no lote de formatos diferentes, rotulado e pronto para testar, não no segundo de avatar. Duas ressalvas: trave o formato "médico" em nichos de saúde (disclaimer de IA, sem credencial falsa), e lembre que **não existe dado público de performance de nenhum formato transposto por IA**, então o HookMill terá de medir isso nas próprias contas.
