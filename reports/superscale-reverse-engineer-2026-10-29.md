# Superscale — reverse engineer (29/10/2026)

Fonte: navegação logada em superscale.ai (marca de teste "Amnayalife", conta do Gusta), landing e /pricing. Só observação de UI; nada foi comprado nem publicado.

## O que é

"Marketing built by AI, judged by profit". É um **chat com agentes** (Account Manager, Graphic Designer, Videographer, Meta/Google Media Buyer, Social Media Manager, Meta Ads Researcher) em cima de uma marca. O dashboard mostra os agentes como nós ("Idle" / "Waiting for you") e tem um campo de prompt com seletor de agente, canal (Meta Ads) e modo Auto.

## Módulos

| Módulo | O que faz |
|---|---|
| **Onboarding por chat** | "Help me set up my first brand": o agente lê o site, tira paleta, logo, idioma e brand guide (voz, imagética, no-gos), cria os produtos/ofertas e salva status quo e metas. Depois oferece "pesquisar concorrentes" ou "criar primeiro lote". |
| **Dashboard** | Saudação + objetivo ("Ship fresh winning creative concepts to beat Meta fatigue"), **Next steps** gerados por IA (ex.: "Report on our current Meta ads", "Find winning angles in our niche"), integrações (GA, Shopify, Meta…). |
| **Customize** | Train (chat de treino + "extended onboarding" de 3–5 min), Context files, Brand Book, Products, Video Settings, **Skills** (instruções reutilizáveis criadas pelo usuário), Integrations (inclusive MCP), Compliance (rótulo de IA). Score de contexto ("50 · Good foundation"). |
| **Research** | Biblioteca da Ad Library: seguir marcas, views salvas (Following, Recent Active Ads, **Active Winners** = ativo + performance score ≥ 70, New Launches, **Killed Fast**), Boards, Discover. |
| **Ad Trends** | Padrões que os concorrentes estão rodando, classificados (Framework / Layout / Hook) com status **Rising / Fading**, nº de anunciantes e criativos, e botão **"Recreate this trend"**. "1.479.260 ads analyzed · last 30 days". |
| **Creatives & Reports** | Fila de revisão (In Review / Approved / Rejected), filtro Static/Video, upload manual. No modal: **Approve** (depois gera placements), **AI label** (compliance), **Attach & edit**, **Reject with feedback**, Download, Save to Library, Open Source Chat, **Animate Image**. |
| **Video Templates** | Speaking Character (UGC falando pra câmera) e Talking Head (fundo transparente pra sobrepor). Character Library + Custom Character. |
| **Insights** | Creative Performance vindo do Meta: views Top Spenders, Latest Launches, Top Creatives, **Fatigued Ads**, Top Landing Pages. Ordena por Spend, ROAS, Purchase value, Impressions. |
| **Launch & Scheduling** | "Coming soon" na landing: publicar direto no Meta/Google com fluxo de aprovação. **Ainda não fazem.** |

### Regra de "Fatigued Ads" (copiável)

`CPA change ≥ 0` **E** `days active ≥ 21` **E** `impressions ≥ 1000` **E** (`CPA vs média própria ≥ 2×` **OU** `CTR de saída caiu ≥ 15%`).

## Como geram anúncios e variações

- **Estático:** prompt ("Create 7 static ad creatives… proven ad formats") → o agente escolhe o produto, puxa o brand guide e gera 7 formatos diferentes. Cada um vem com um **"Creative Rationale" que cita um anúncio real** de referência ("Why pain-point headline (Business English 40s-career ad)", "Why UGC screenshot (EWA 'From local to global')"). Formatos: testimonial card, checklist, before/after split, pain-point headline, stat callout, depoimento de executivo.
- **Recriar vídeo:** upload do vídeo do concorrente + "Recreate this video ad for my brand" → analisa o vídeo, carrega brand guide e produto → monta um **storyboard (cenas · duração, tabela TIME / VISUAL / VOICEOVER)** e explica o que adaptou ("o original falava com estudantes, reposicionei pra profissionais") → o usuário aprova a ideia → só aí gera.
- O agente pede o que falta (ex.: logo) e segue sem ele se o usuário pular.

## Monetização / paywall

- /pricing: Starter US$ 49 (4.000 créditos, até 100 gerações de IA), Advanced US$ 99 (8.000, 250, 1 marca), Pro US$ 199 (16.000, 500, 5 marcas), Scale US$ 399 (32.000). Todos com "Get started free".
- No trial, estático e pesquisa funcionaram. **A geração de vídeo foi barrada mesmo com créditos sobrando**: "1 video could not be started — 983 credits left, activate subscription to continue". Ou seja, o trial dá créditos e o vídeo exige assinatura.
- **Não vi prévia com blur nesta conta:** os 6 estáticos aparecem abertos, e o storyboard do vídeo aparece inteiro antes do bloqueio. O blur pode existir em outra etapa ou plano. A trava que vi foi na **ação** (gerar vídeo), não na visualização.

## O que vale pegar pro HookMill

Em ordem de retorno pro esforço:

1. **Variação grátis + blur (decisão de 29/10).** Mostrar o storyboard ou o roteiro antes de gerar, como eles fazem, também reduz geração desperdiçada no plano pago.
2. **"Creative Rationale" por variação.** Cada variação explica por que foi feita e de qual referência veio. Nosso brain já tem os dados; isso dá confiança e vende a parte "IA".
3. **Regra de fatiga + views prontas** (Top Spenders, Fatigued, Killed Fast) em cima do meta sync que já temos. A Fatigued alimenta direto o "Iterate a winner". Combina com o CPA alvo que o Tordan pediu.
4. **Fila de revisão com "reject with feedback"** alimentando o brain (vencedores e perdedores).
5. **Next steps gerados por IA no dashboard.** Resolve a tela vazia do onboarding (feedback de 20/10).
6. **Skills do usuário** (instruções reutilizáveis). É o mesmo formato da skill de CBO 4–8 anúncios/ad set que o Tordan vai mandar.
7. **Ad Trends com "Recreate this trend"**: maior esforço, depende de ingestão da Ad Library em escala.

**Onde a gente já está na frente:** a publicação no Meta. Pra eles ainda é "coming soon". O template de campanha e ad set que o Tordan pediu (ponto 2 do Loom de 29/10) é um diferencial real.
