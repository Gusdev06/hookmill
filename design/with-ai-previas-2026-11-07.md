# Templates › With AI: 4 prévias em imagem antes do vídeo · 2026-11-07 (rev. com as respostas do Gusta)
Dono: maquina-design · Status: **proposta, aguarda o Gusta ver o mockup** · Nada de código antes do ok dele e do contrato.
Mockup: `design/mockup-with-ai-previas.html` (autocontido; a barra amarela troca tela, estado, formato, EN/PT e Desktop / Phone 390; `#phone` no link abre no celular). Ainda **não publicado como Artifact** e **ainda não aberto num navegador** (sem screenshots: ver §9).
Fontes: decisão de 07/11 (`decisions/log.md`) e respostas do Gusta no §11 de `docs/contratos/templates-ia-previas-v1.md` (P1 4 ideias novas · P2 apresentador diferente em cada prévia · P3 prévias sem cobrança por enquanto · P4 voltar e aprovar mais prévias do mesmo lote). **Substitui** só a jornada do usuário de `templates-ia-background-v1.md` (04/11); motor em background, reserva, idempotência e estorno continuam.
Visual: a pele atual do app (`web/src/app/globals.css`): main claro, sidebar tinta, lima = a única ação da tela, Archivo + IBM Plex Mono. O tema escuro do briefing de 05/10 foi trocado em 12/10.

## 1. Problema e decisão
- **Hoje (04/11):** formato → campeão → Gerar → 1 vídeo pronto. A pessoa paga minutos de vídeo sem ver antes a ideia.
- **Decisão:** formato → campeão → **4 prévias grátis em imagem, cada uma uma ideia nova com apresentador próprio** → aprova de 1 a 4 → **só as aprovadas viram vídeo** (único passo com custo) → progresso → player e download. As não aprovadas ficam salvas no lote e podem ser aprovadas depois.
- **Por quê:** escolher no ponto barato (imagem ≈ centavos, segundos) e não no caro (vídeo ≈ US$ 1, minutos); 4 ideias realmente diferentes = 4 testes de anúncio; apresentadores diferentes deixam as 4 distinguíveis de relance.

## 2. Telas
Trilho de 4 passos depois da galeria: **Format · Winner · Previews · Videos**.

### 2.1 Galeria `/templates?tab=ai`
- Cards 9:16 iguais aos de Edição (`Card` da `gallery.tsx`). Ordem: **FAQ · Podcast solo · Podcast dupla** (ligados) · **Talking head · Cartoon · Musical · Animações** ("Soon": imagem dessaturada, pílula tracejada, botão desabilitado, sem detalhe).
- Card ligado: pílula tinta `AI · —` (preço do vídeo, sem valor ainda), rodapé "4 previews → you pick", **Use template**.
- Chips da aba: Podcast (2) · FAQ · Talking head · Cartoon · Musical · Animations.
- Cabeçalho da seção: "**With AI** · your winner, remade in another format · you approve 4 image previews first".
- Estados: pronto · carregando (skeleton do `Reveal`) · erro (`Alert` de hoje).

### 2.2 Detalhe (Dialog; sheet de baixo no celular)
`kv`: How it works · You get "1 to 4 videos · 9:16 · 25–45 s · captions" · **Cost "Previews: free · each video: — credits" + `price TBD`** · Time "Previews ≈ 1 min · videos ≈ 5–8 min, in the background" · Language "Same as your winner". Lima **Use this template**.

### 2.3 Winner
- "Which winner should we remake?" / "We keep its offer, price and promise and write 4 new ideas in the new format, each with its own presenter."
- Abas Meta winners / Upload / Library; linha com rádio, miniatura, gasto/CPA, tipo/duração e fit: `Fits` · `Needs speech` (desabilitada) · `Not read yet · ~1 min, free`.
- Coluna "What happens next": 4 free previews · approve 1 to 4, regenerate free up to a limit · only approved become videos; the rest stay saved.
- Barra: "**Podcast · duo** · 4 new ideas from **Sleep in 7 nights** · previews are free" + Back + lima **Make 4 previews**. **Nenhum custo neste passo.**
- Estados: pronto · sem campeões (Connect Meta / Upload an ad).

### 2.4 Prévias (tela nova)
**Faixa do campeão**, sticky do passo 3 ao 6: miniatura + "FROM YOUR WINNER" + nome + tipo/CPA/gancho original + "becomes → Podcast · duo". No celular, 1 linha grudada embaixo da barra do topo.

**Card (×4, A–D)**, campos do `AiPreview` (contrato §4.1/§5):
1. **Imagem-chave** 9:16 = primeiro quadro do vídeo. **F10: 2 imagens lado a lado (HOST | GUEST)**, uma por falante, sem plano a dois (contrato §6). F04/F09: 1 imagem. Selo `PREVIEW · IMAGE`, letra, botão ampliar.
2. **Angle** (`title`), idioma da interface.
3. **Gancho** (`hook`) entre aspas, régua lima, idioma do campeão.
4. **vs. your ad** (`changes[]`, máx. 3, antes → depois): "Opens on the result → **Opens on doubt**". Idioma da interface.
5. **Elenco** (`cast[]`): "Host **Maya** · Guest **Daniel**" ou "Presenter **Maya**". Muda em toda prévia.
6. **Kept** (`preserved[]`) em mono: "offer · $29 · 7-night promise · guarantee". Some no celular.
7. **Approve** (toggle grande, `role=checkbox`) + **um botão só, "New angle" / "Novo ângulo"** (ícone de refazer + texto): troca a prévia inteira por outra ideia com outro apresentador (`part: 'variation'`). Não existe "nova imagem, mesmo ângulo" (Gusta, 07/11). Embaixo, em mono: "Free · 2 of 3 left · 5 of 6 in this batch" (`regenerations`, `limits`). Refazer desmarca a aprovação daquela prévia. Sem refações sobrando, o botão desabilita e a linha diz "No free regenerations left".

**Barra:** "**2 of 4 approved** · 2 videos · — credits `price TBD`" + lima **Make 2 videos**. Com 0: "Approve at least 1 preview · previews are free; videos are charged only when you confirm" e botão desabilitado. "Approve all 4" (ghost) no cabeçalho.

| estado | o que aparece |
|---|---|
| Gerando | "Drawing 4 previews"; status "2 of 4 ready · barra · ≈ 30 s left · you can leave, they'll wait on Home"; card com Border Beam + Image Generation (imagem borrada resolvendo) + etapa real ("Writing the angle and hook 1/2" → "Drawing the key frame 2/2"). Chegam uma a uma e já podem ser aprovadas. |
| Pronto | 4 cards, nenhuma pré-aprovada |
| Uma falhou | borda vermelha, imagem hachurada, "This preview didn't come out · The image model timed out on the key frame. Nothing was charged for it." + **Try again** (não conta no limite de refações) |
| Refazendo uma | só aquele card volta pra "gerando"; os outros seguem clicáveis |
| Refações esgotadas | nota âmbar "You've used the 6 free regenerations in this batch. You can still approve any of these, or start a new batch from the gallery."; ícone de refazer desabilitado |
| Nada aprovado | botão desabilitado com o motivo |
| Voltando depois (P4) | prévias que já viraram vídeo mostram "✓ Video made · in Library" no lugar do Approve; as outras seguem aprováveis |

Sair no meio: as prévias continuam sendo feitas; o lote aparece na Home em "Waiting for you" ("4 previews to pick") com contador na sidebar.

### 2.5 Confirmar (Dialog; sheet de baixo no celular), único passo com custo
Miniaturas das aprovadas; painel tinta: "N × video · 9:16 · 25–45 s — × N" · "Previews and regenerations: free" · **Total — credits** `price TBD` · "Balance 42 → —" · "Reserved now, charged when each video is ready. If one fails, its credits come back." Ações: Back to previews · lima **Confirm · make N**.
- **Saldo insuficiente:** âmbar "Your balance (3) is lower than this batch · Your previews and approvals are saved. Get credits or approve fewer."; lima vira **Get credits**.

### 2.6 Fazendo os vídeos
- Molde da lista de deploys: 1 linha por vídeo com a imagem da prévia, "A · The skeptic gets converted", gancho, etapa atual com %, barra, chips de etapa (verde feito, azul rodando, vermelho falha) e ETA.
- Etapas: F10 = Script · Faces ×2 · Voices ×2 · Lip-sync 6 turns · Cuts + captions · Render; F09/F04 = Script · Face · Voice · Lip-sync · Captions/Question cards · Render. Como o rosto da prévia é o `Face` do lipsync (contrato §6), "Faces" já sai pronto na prática; manter o chip só se o backend expuser a etapa.
- "About 5–8 min each… You can close this page: they land in your Library and Home tells you."
- Nota: "The 2 previews you didn't pick stay saved on this batch. Come back and approve them any time."
- **Um falhou:** linha vermelha clara, "Failed at lip-sync, turn 4 of 6 · Finished steps are saved. Its credits came back." + **Try again** / Drop this video.

### 2.7 Assistir e baixar
- Abas por vídeo (miniatura + ângulo + "Ready · 0:38" / "Rendering · 82%"); palco tinta com player grande; coluna com ângulo, gancho, From, arquivo `SW·DUO·A.mp4`; lima **Download MP4** · Open in Library.
- Faixa tracejada: "2 previews you didn't pick are saved." + **Make them too** → volta pras prévias com essas marcadas (as já feitas aparecem como "Video made") → mesmo Confirmar.
- **Parcial:** o vídeo ainda renderizando mostra Beam e "Rendering · 82% · ≈ 1 min"; Download desabilitado só nele.

## 3. Regras de conteúdo
- **4 ideias novas, nenhuma fiel ao campeão** (P1). Cada uma com tese própria (`angle` distinto); sinônimo de headline não conta. Nenhuma repete o gancho do campeão.
- **Apresentador diferente em cada prévia** (P2): rosto, cenário e voz próprios; voz no gênero do rosto. No F10, as 4 duplas são diferentes entre si.
- **Mesma oferta e mesmos fatos:** preço, promessa, garantia e claims do Brain/oferta; número só se estiver na fala do campeão ou no `proof`; nada de depoimento inventado.
- **Idiomas:** gancho e legenda = idioma do campeão; título do ângulo, "vs. your ad", elenco e "Kept" = idioma da interface.
- A imagem aprovada é o frame 0 do vídeo (o mesmo arquivo vai pro lipsync). A revisão do vídeo antes de publicar continua.

## 4. Cobrança na tela
- **Prévias e refações: grátis por enquanto** (P3). Nada de custo em galeria (além da pílula de preço do vídeo), Winner ou Prévias. Refazer: **3 por prévia, 6 por lote** (contrato §5); "Try again" de prévia que falhou não conta.
- **Vídeo:** custo só no Confirmar, como "— credits" + `price TBD` até o Gusta definir (`prices.videoEach = null`).
- Regra de 05/10 mantida: sem custo ao lado de todo botão.

## 5. Tokens e componentes
- **Tokens:** os de `globals.css`, nenhum novo. Lima só em Make 4 previews / Make N videos / Confirm / Download. "Sem preço" = pílula tracejada `price TBD`. Status: azul rodando, verde pronto, vermelho falha, âmbar saldo/limite.
- **shadcn:** `Tabs` · `ToggleGroup` (chips) · `Card` · `Dialog`/`Drawer` (detalhe, confirmar, ampliar) · `RadioGroup` (campeão) · `Toggle`/`Checkbox` grande (Approve) · `Button` (New angle, sem menu) · `Progress` · `Skeleton` · `Alert` · `Badge` · `Sonner`.
- **Existentes:** trilho de passos, `IterActionBar`, `TemplateVideo`, `PricePill`, `FitPill`, palco tinta.
- **Novos:** `ChampionStrip`, `PreviewCard` (ready/wait/fail/regen/made), `PreviewImage` (1 ou 2 imagens, HOST/GUEST), `RunRow`.
- **Efeitos só na espera:** Image Generation e Border Beam.

## 6. Responsivo (390 px)
- Galeria em 2 colunas, abas largura cheia, chips rolando.
- **Prévias em lista:** imagem de 116 px à esquerda (no F10, as 2 metades), ângulo/gancho/"vs."/elenco à direita, Approve + New angle embaixo, com a linha de refações restantes; ampliar abre a imagem grande. "Kept" e o selo somem.
- Faixa do campeão em 1 linha sob a barra do topo; lista de vídeos sem ETA, chips quebram linha; barra fixa com botões em largura cheia e safe-area; dialogs viram sheet de baixo.

## 7. O que a tela consome (contrato `templates-ia-previas-v1.md` §5)
| tela | rota / campos |
|---|---|
| Galeria | `GET /ad-templates`: os 7 cards IA com `category` nova, `available`, `credits` (null = "—"), exemplo/pôster. `previewCredits` fica 0/null e **não aparece** enquanto P3 valer |
| Winner → Prévias | `POST /ad-templates/:slug/use` com `previews { requestId, expectedCredits: 0 }` → `202 IterateBatch` (`ai.phase: 'planning'`) |
| Prévias | `GET /iterate/:id` a cada 2 s: `ai.previews[]` (`status`, `title`, `hook`, `changes[]`, `preserved[]`, `cast[]` com `image.url` e `voiceName`, `regenerations`, `errorCode/failReason`, `pieceId`), `ai.limits`, `ai.prices.videoEach`. Refazer: `POST /iterate/:id/ai-previews/:previewId/regenerate { requestId, part: 'variation' }` (a tela nunca manda `image`; o arquiteto pode tirar essa opção do contrato) (`429 REGEN_LIMIT` → estado "esgotadas"). Etapa no card: `planned` = "Writing the angle and hook", `imaging` = "Drawing the key frame" |
| Confirmar | `POST /iterate/:id/ai-previews/approve { requestId, previewIds, expectedCredits }` (`402`, `409 CREDITS_CHANGED`, `409 SPEND_CAP_EXCEEDED`) |
| Vídeos / Pronto | `pieceId` de cada aprovada → o `IteratePiece` de hoje (etapas, %, MP4, retry) |
| **P4 (aprovar depois)** | o contrato hoje fecha o lote em `PLAN_READY → LAUNCHED` e não aceita aprovar de novo (`409 already_approved`), e não há regenerar depois da aprovação. **Pro arquiteto:** permitir uma 2ª aprovação com as prévias restantes `READY` (o lote volta a aceitar `approve` enquanto houver prévia não aprovada); prévias aprovadas viram `APPROVED` e exibem "Video made" |
| Home | lote em `previews_ready` sem aprovação entra em "Waiting for you" |

## 8. O que muda vs. 04/11
- Volta um ponto de aprovação, mas visual e barato (imagem), não a tela de "plano" rejeitada: sem roteiro cena a cena e sem campos de texto. O roteiro completo (`beats[]`) fica fora da v1 da tela; se o Gusta pedir, entra como disclosure "Script" no card.
- O clique que cobra sai da galeria e vai pro Confirmar.
- O planejador devolve 4 propostas com elenco próprio e desenha a imagem-chave de cada uma.

## 9. Verificação
- Não rodado num navegador nesta sessão: o ambiente do agente de design não tem shell para subir Playwright/Chromium. Pendente: abrir em 1440 e 390, conferir console sem erro e sem rolagem horizontal, salvar 2 screenshots em `design/mockup-with-ai-previas-shots/` (quem tiver shell: QA ou o coordenador).

## 10. Perguntas pro Gusta
Nenhuma em aberto. Refazer = só "New angle" (respondido em 07/11).
