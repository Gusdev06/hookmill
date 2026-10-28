# Iterate v2: templates grátis, quiz e bloco "With AI" — contrato
Data: 2026-10-28 · Dono: maquina-arquiteto · Status: **F1 no código; F2 implementada e validada localmente após “implementar tudo” do Gusta. Publicação pendente. F3 continua separado e desligado.**

### Entrega de 28/10 — escolhas e legenda preservada
- F2: candidatas até 16, seleção até 12, preferências por workspace, `answers`, Add back/Remove, edição sem outra chamada ao modelo. `quizEnabled` na vista vem de `VariationBatch.settings.quizEnabled`: lotes antigos continuam abrindo seu plano existente; novos lotes mostram o quiz.
- A Q2 e categorias de geração paga ficam ocultas enquanto F3 estiver desligada. Não há geração paga acionada pelo quiz.
- Migração aditiva `20261028000300_iterate_preferences`, aplicada nos bancos locais `maquina_test` e `maquina` (backup automático antes do segundo). Não aplicada em produção nesta entrega.
- Legenda: decisão posterior do Gusta **rejeita ambos os removedores de IA**. A remoção não é oferecida. Preservar a área completa do vídeo, legenda e rosto; procurar espaço para os elementos novos; excluir o template antes de gerar se não houver espaço. A antiga substituição automática da legenda foi superada; modo `replace` permanece somente por compatibilidade explícita com entradas antigas.
- F1 recebe checagem de texto pós-render. Templates ligados em desenvolvimento (`ITERATE_TEMPLATES=on`); antes de ligar em produção é necessário publicar o bundle Remotion atual e incluir `template` em `RENDER_LAMBDA_KINDS`.
Origem: aprovação do Gusta em 28/10 (ordem F1 → F2 → F3) depois de ver o mockup v2 (`design/mockup-remix-formato.html`, spec `design/remix-formato-2026-10-28.md` §8). Pontos já aprovados (A5b, `testes/teste-manual-gusta-2026-10-28.md`): (1) o quiz roda **durante** a análise; (2) na Q2, "Let HookMill choose" deixa a IA paga **sugerida e desmarcada**; (3) as peças grátis renderizam **antes** da aprovação da IA. As Q1–Q13 de `brainstorms/2026-10-27-hookmill-variacoes-de-formato-ia.md` seguem como plano revisável (Q12 = leva 1; Q8 ajustada: **nada de print da landing, só motion**).
Vale **por cima** de `variacao-auto-v1.md` (§3, §5, §6 e §8) **só** no que este arquivo muda. Convenções, envelope e erros: [`api.md` §1](api.md). Tempo real: **polling** de `GET /iterate/:id` a 1,5 s, como hoje (o quiz só lê a etapa da análise, e o estado mora no banco: SSE não traria nada a mais).

Evidência lida pra escrever: `contratos/src/iteracao.ts`, `contratos/src/troca-motor.ts`, `api/prisma/schema.prisma` (`VariationBatch`, `VariationItem`, `VariationCasting`, `Face`, `Workspace`, enums), `api/src/iteracao/{regras,contexto,afirmacoes,iteracao.controller}.ts`, `api/src/integracoes/contrato.ts` (`AutoPlanInput`, `AutoPlanDraft`, `AutoFrameDraft`, `CopySource`), `api/src/integracoes/catalogo/precos.ts`, `api/src/troca/*`, `api/src/render/contrato.ts`, `video/src/prototipos/formatos/{ChatDM,GreenScreenPrint,comum,roteiros}.tsx|ts`, `video/out/prototipo-formatos-2026-10-28/tempos.json`, e os contratos `variacao-auto-v1`, `estatico-montado-e-molduras-v1`, `headline-e-legenda-v1`, `legenda-protegida-v1`, `feature-2-variar-campeao` (§5, §13.3, §13.13, §13.15), `render-lambda-v1`.

---

## 0. Resumo em 5 linhas
1. **F1:** dois tipos novos no catálogo AUTO, `CHAT_DM` e `PERSON_MOTION` (DIVERSITY, grátis). O `planAutoBatch` passa a devolver **o roteiro do template**, o backend valida ("nada inventado"), o `video` transforma o protótipo numa composição de produto (`kind: 'template'`), que renderiza no Lambda, com legenda CJK e checagem por visão. Custo ≈ tokens + Lambda (~US$ 0,02-0,03 por peça).
2. **F2:** o Claude passa a planejar um **superconjunto de candidatas** (até 16). As 3 respostas do quiz (que roda durante a análise) escolhem **de forma determinística, sem nova chamada paga**, o que entra no lote: mistura por objetivo (Q1), filtro por categoria (Q3) e "Left out · Add back". As respostas ficam salvas por cliente (= workspace) e voltam no próximo lote.
3. **F3a:** o bloco "With AI · uses credits" religa a troca de avatar que já existe (`SWAP_AVATAR`, feature 2) dentro do lote AUTO: `AVATAR_FACE` (só o rosto, Lipsync com o áudio original) e `AVATAR_PERSONA` (pessoa + cenário + 1 fala de persona, talking head limpo). Tem uma etapa de aprovação de roteiro e avatar antes de gastar, o teto do lote (Q2) e o teto do workspace.
4. **F3b:** Remix de formato, começando por `REMIX_DISCOVERY` (1 pessoa, roteiro novo, 1 vídeo ~30 s + 2 ganchos sobre o mesmo corpo). `REMIX_PODCAST` fica reservado até uma sonda (1 falante por passada, plano/contraplano).
5. **Preço não decidido:** tudo é gravado em US$ (estimado e real, por peça e por item de IA), e cada item tem um campo `credits: number | null` que fica `null` até o Gusta decidir o preço. O único botão que gasta com a geração paga é "Generate AI pieces".

## 1. O que já existe e é reaproveitado
| peça | onde | uso aqui |
|---|---|---|
| Lote AUTO, peça = `VariationItem` + `Creative`, `included`, `inZip`, `leftOutAt` | `variacao-auto-v1` §2 | F1 e F2 sem tabela nova de peça; `included` passa a ser "selecionada pelo quiz" |
| `planAutoBatch` + `allowedFor` + `validatePlan` + `repairPlan` + `finalizePlan` | `api/src/iteracao/regras.ts`, `integracoes/contrato.ts` | F1 ganha 2 membros no `AutoParamsDraft`; F2 muda as regras de contagem |
| "Nada inventado": `inventedNumbers`, `inventedClaims` (`afirmacoes.ts`), `CopySource` | backend | toda fala/texto dos templates passa por eles |
| `snapSpans`, `editMap.faceTrack`, `protectedBands`, `decidirLegenda` | `medicao`, `legenda-protegida-v1` | trechos e caixa do rosto do `PERSON_MOTION` |
| Legenda palavra a palavra + CJK (`fontes-cjk.ts`, quebra sem espaço) | `headline-e-legenda-v1` §2 | `PERSON_MOTION` |
| Checagem de legenda por visão (Haiku, ~US$ 0,008/render) | `legenda-protegida-v1` §4.2 | generalizada pra texto de template (F1) |
| `RenderPorts` + `RENDER_LAMBDA_KINDS` | `render-lambda-v1` §6.1 | `kind: 'template'` entra no Lambda |
| `SWAP_AVATAR` (Lipsync take com áudio do campeão, `keepEdit`), talking head limpo (`TTS_LIPSYNC`), elenco `VariationCasting` + `Face` (Soul), `NEW_HOOKS` (corpo `REUSE`), motores Kling/Seedance | `feature-2` §5, §13.3, §13.13, §13.15; `api/src/troca`, `api/src/variacoes` | F3 inteiro; nenhuma cadeia de geração nova em F3a |
| `assertWithinCap` (teto mensal do workspace), `expectedCostUsd` + `ESTIMATE_CHANGED` | `custos`, `variacao-auto-v1` §14.4 | F3 |
| Pipeline de b-roll (Pexels primeiro, proveniência) | `estatico-montado-e-molduras-v1` §B3.1 | F3b (b-roll que não é a pessoa) |

## 2. Conceitos novos
| conceito | onde mora | o que é |
|---|---|---|
| **Tier** | derivado do tipo (`TIER_OF`) | `free` (edição, template, STATIC) ou `ai` (gasta geração de vídeo/voz). Não é coluna. |
| **Candidata** | `VariationItem` com `included = false` | peça que o Claude planejou mas o quiz deixou fora. Só vira criativo se a pessoa usar "Add back". |
| **Respostas** | `VariationBatch.answers` (JSON) | as 3 respostas do lote (`IterateAnswers`). |
| **Preferências do cliente** | `Workspace.iteratePreferences` (JSON) | as últimas respostas salvas. Cliente = workspace (fase2-agencia §1). |
| **Item de IA** | `IterateAiItem` (tabela nova, F3) | uma linha do bloco With AI = uma unidade de aprovação = 3 peças. |
| **Unidade de IA** | regra | 1 item = 3 peças. Formato: 1 vídeo ~30 s + 2 ganchos sobre o mesmo corpo. Avatar: o mesmo vídeo com 3 rostos (`AVATAR_FACE`) ou 3 personas (`AVATAR_PERSONA`). |
| **Créditos** | `credits: number \| null` em todo item/estimativa de IA | sempre `null` até haver preço. A verdade é o US$. |

---

# F1 — Templates grátis `CHAT_DM` e `PERSON_MOTION`

## F1.1 Catálogo (entra em `variacao-auto-v1` §6.1)
| tipo | código EN / PT | eixo | entra quando (`allowedFor`) | precisa | máx. |
|---|---|---|---|---|---|
| `CHAT_DM` | `CHAT-DM` / `CHAT-DM` | DIVERSITY | campeão com fala (`!no_speech`) e o teardown dá ≥ 2 de {dor ou objeção, prova ou mecanismo, oferta ou CTA} | transcrição + Brain | 1 |
| `PERSON_MOTION` | `PERSON-MOTION` / `PESSOA-MOTION` | DIVERSITY | campeão com rosto (`hasFace`: trecho `main` ≥ 40 % da duração), fala, duração ≥ 15 s e uma caixa do rosto que não cruza a legenda queimada (`decidirLegenda` ≠ `blocked`) | transcrição, `faceTrack`, Brain | 1 |
- **Igual ao protótipo aprovado de 28/10**, com as regras do Gusta: **nenhum print da landing**, **nenhuma imagem gerada**, **nunca imagem do produto**, **nunca depoimento ou número inventado**. Tudo o que não é o campeão é desenhado em código (texto cinético, cards, esquema, ícones de um catálogo fixo, contadores, botão de CTA).
- `CHAT_DM` = conversa estilo Direct, sem pessoa e sem o vídeo do campeão. A dor/objeção vira pergunta de quem quer comprar; prova, mecanismo e oferta viram resposta da marca; fecha numa cena de motion (promessa + números reais do Brain + CTA). Áudio: só SFX curtos (pop/envio/ding sintetizados por nós), sem música e sem voz.
- `PERSON_MOTION` = palco de motion em cima, sincronizado à fala; embaixo, numa caixa, o **próprio rosto e a voz do campeão** em 2-6 trechos dele (é edição, não geração: no produto é grátis). Legenda palavra a palavra sempre ligada.
- Peça nova no lote: selo "New template", preço "Free". Formatos: **só 9:16 na v1** (`supported: false` em 4:5/1:1, igual ao HEADLINE). O layout do chat e o palco não foram desenhados pros outros aspectos.
- Contagem: os dois entram na diversidade. Se faltar dado (sem fala, sem rosto), o tipo não é oferecido (`blockedReason`: `no_speech` / `no_face` / `short_video` / `burned_captions`) e nada é trocado no lugar.

## F1.2 Quem escreve o roteiro: o `planAutoBatch` (maquina-ia)
O roteiro sai **na mesma chamada do plano**. Não existe chamada nova. O Claude recebe `allowed` com os 2 tipos e devolve os params abaixo. Todo texto que aparece na tela vem no **idioma da fala** (`screenLanguage`), e todo campo de texto leva a sua `source` (`CopySource` = campo do Brain | `'transcript'` | `'generic'`). Os limites estão em caracteres visíveis; em CJK, 1 caractere = 1.
```ts
// api/src/integracoes/contrato.ts (ia escreve; arquiteto revisa)
type TemplatePreserve = 'hook' | 'pain' | 'proof' | 'mechanism' | 'objection' | 'offer' | 'cta' | 'promise';
interface TemplateText { text: string; source: CopySource; /** trecho do campeão de onde veio (rastreio; obrigatório se source = 'transcript') */ srcSpan?: { startSec: number; endSec: number } | null }

export interface AutoChatDmDraft {
  type: 'CHAT_DM';
  /** manchete fixa no topo: o gancho do campeão (texto queimado ou falado), ≤ 40; highlight = trecho do text (≤ 16) */
  hook: TemplateText & { highlight: string | null };
  /** textos da interface do chat no idioma da tela (≤ 24 cada): "digitando…", placeholder da barra, status do perfil */
  chrome: { typing: string; inputPlaceholder: string; profileStatus: string };
  /** 6-12 mensagens, na ordem */
  messages: ({
    from: 'prospect' | 'brand';
    /** 'prospect' só aceita 'question' | 'objection' (nunca relato de resultado); 'brand' aceita 'answer' | 'correction' | 'offer' */
    kind: 'question' | 'objection' | 'answer' | 'correction' | 'offer';
    text: TemplateText;                         // ≤ 90 ('correction'/'offer': título ≤ 24)
    /** 'correction': linhas riscadas (≤ 2) e certas (≤ 3), ≤ 40 cada; 'offer': benefícios (≤ 3, ≤ 40) */
    wrong?: TemplateText[]; right?: TemplateText[];
    preserves: TemplatePreserve[];
  })[];
  /** cena final de motion: até 3 linhas ≤ 32 (promessa + chamada) */
  close: { lines: TemplateText[] };
  /** botão e nota do CTA (≤ 28 / ≤ 40). source tem que ser 'cta' | 'offerAndPrice' | 'page' | 'transcript' */
  cta: { button: TemplateText; note: TemplateText | null };
}

export interface AutoPersonMotionDraft {
  type: 'PERSON_MOTION';
  /** 2-6 trechos do campeão, em ordem, sem sobrepor; soma 18-40 s; os blocos `kept` dentro. O backend encaixa no silêncio (snapSpans). */
  spans: { startSec: number; endSec: number; preserves: TemplatePreserve[] }[];
  /** cenas do palco: 1 ou mais por trecho, cada uma ancorada numa palavra da transcrição (índice global de TranscriptWord) */
  beats: ({ spanIndex: number; atWord: number; untilWord: number | null } & (
    | { kind: 'kinetic'; words: TemplateText[] }                                   // 1-4 palavras/termos ≤ 24, entram no tempo da fala
    | { kind: 'wrong_right'; wrong: TemplateText; right: TemplateText[] }           // ≤ 32; right ≤ 3
    | { kind: 'steps'; steps: TemplateText[] }                                      // 2-4 passos ≤ 16 (esquema com setas)
    | { kind: 'icon_list'; items: { icon: TemplateIconId; text: TemplateText }[] }  // 2-4, ≤ 20
    | { kind: 'badge'; text: TemplateText }                                         // selo ≤ 20
    | { kind: 'cta'; button: TemplateText; note: TemplateText | null }
  ))[];
  /** cena final depois da última fala (2-4 s): só números do Brain › proof e o CTA */
  endCard: { proof: ProofStatDraft[]; cta: { button: TemplateText; note: TemplateText | null } } | null;
}
/** número real do Brain › proof (≤ 3). value + label literais (comparação normalizada); prefix/suffix só se estão lá ("+", "%", "★") */
export interface ProofStatDraft { value: number; decimals: 0 | 1 | 2; prefix: string; suffix: string; label: string /* ≤ 24 */; source: 'proof' }
/** catálogo fixo de ícones desenhados em código (video). A IA não inventa ícone. */
export type TemplateIconId = 'check' | 'x' | 'arrow' | 'brain' | 'globe' | 'chat' | 'clock' | 'star' | 'gift' | 'lock' | 'heart' | 'bolt';
```
`CHAT_DM` também leva `proof: ProofStatDraft[]` (0-3) pra cena final. Os dois membros entram na união `AutoParamsDraft` (`AutoParamsDraftWithFrame`).

Regras do prompt (ia): agnóstico de oferta (nunca nomeia nicho); quem pergunta é "alguém que quer comprar", não um cliente que já comprou; nenhuma mensagem do `prospect` relata resultado ("perdi", "ganhei", "funcionou"); a marca só afirma o que está no Brain ou na transcrição; sem nome de pessoa, de concorrente ou de plataforma; `change` (uiLocale) diz o conceito ("A história vira uma conversa no Direct").

## F1.3 Validação (maquina-backend, `regras.ts`, puro e testado; mesma rotina de reparo do §6.3)
| regra | violação |
|---|---|
| limites de cada campo (F1.2) e quantidades (mensagens 6-12, trechos 2-6, beats ≥ 1 por trecho) | `text_too_long`, `template_shape` |
| `inventedNumbers` / `inventedClaims` em **todo** `TemplateText` (as fontes são o Brain, a transcrição e a página lida) | `invented_number`, `invented_claim` |
| `ProofStatDraft`: o número e o rótulo existem em `offer.proof` (normalizado) | `proof_not_in_brain` |
| `prospect` com `kind` fora de `question`/`objection`, ou com termo de resultado (léxico novo `RESULT_TERMS` em `afirmacoes.ts`, pt/en/es; outras línguas: só a regra do `kind`) | `prospect_testimonial` |
| `source: 'transcript'` sem `srcSpan`, ou `srcSpan` fora do vídeo | `source_span_missing` |
| `spans`: em ordem, sem sobrepor, soma 18-40 s depois do `snapSpans`, cobre os blocos `kept` com função hook e cta | `spans_invalid`, `kept_missing` |
| `atWord`/`untilWord` dentro do trecho do `spanIndex` | `beat_out_of_span` |
| duração do chat (`chatTimeline`, função pura do video, F1.4) entre 18 e 40 s | `chat_too_long` / `chat_too_short` |
| marca, logo ou URL em qualquer texto (`brandTerms` de hoje + `http`) | `template_has_brand` |
Reparo determinístico se a 2ª chamada ainda violar: a peça sai do plano (não há "trocar por outra").

`finalizePlan` (backend) completa: `code`, `axis`, spans encaixados, palavras da legenda remapeadas pro tempo de saída, `brand` (`frameBrandOf`), paleta, `safeArea`. O resultado vai em `variation_items.payload.params` (`TemplateSpec`, F1.4).

## F1.4 Render (maquina-video): `TemplateRenderInput`
Composição nova `Template` (`video/src/templates/ChatDM.tsx`, `PersonMotion.tsx`, `comum.tsx`, promovidos do protótipo), com schema zod como a `Moldura`. Builder **puro** `buildTemplateInput(spec, ctx, format, opts?)` em `api/src/render/template.ts` (como `frame.ts`). Os protótipos ficam em `video/src/prototipos/` sem mudar (o `Root.tsx` registra só a composição de produto; os ids `Formato-*` do protótipo podem continuar no Root de dev).
```ts
// api/src/render/contrato.ts (video escreve)
export type TemplateRenderInput = {
  kind: 'template'; renderId: string; templateId: 'chat-dm' | 'person-motion';
  format: 'VERTICAL_9_16'; fps: 30; language: string;          // BCP 47 da tela (zh-TW, ja… ligam as fontes CJK)
  brand: FrameBrand;                                             // nome, handle, iniciais (monograma; nunca logo), cor
  palette: string[]; safeArea: { top: number; bottom: number };
  sfx: { pop: string; send: string; ding: string } | null;       // URLs dos .wav do bundle (video/public/sfx/)
  durationInFrames: number;                                      // calculado pelo builder (chatTimeline / soma dos trechos + endCard)
  /** frases e instantes que a checagem por visão confere (F1.5) */
  checkpoints: { atSec: number; texts: string[] }[];
} & (
  | { templateId: 'chat-dm'; props: ChatDmProps }                // = AutoChatDmDraft sem source, com a agenda calculada
  | { templateId: 'person-motion'; props: PersonMotionProps }
);
export interface PersonMotionProps {
  source: { videoUrl: string; width: number; height: number; fps: number; durationSec: number };
  timeline: { startSec: number; endSec: number }[];             // trechos já encaixados; áudio = o do campeão, joinFadeMs 40
  faceBox: { focus: { x: number; y: number }; box: Rect };      // caixa do rosto na saída (fora da legenda queimada e da safeArea)
  beats: (PersonBeat & { fromSec: number; toSec: number })[];   // tempo de SAÍDA (o builder converte atWord/untilWord)
  captions: { words: { word: string; startSec: number; endSec: number }[]; style: 'auto' };  // H5 do headline-e-legenda
  endCard: { fromSec: number; proof: ProofStatDraft[]; cta: { button: string; note: string | null } } | null;
}
export type RenderInput = ScratchRenderInput | RemixKeepRenderInput | AutoEditRenderInput | FrameRenderInput | TemplateRenderInput;
```
- **Funções puras do video**, testadas: `chatTimeline(props) → { messages: { atSec, typingSec \| null, y, h }[]; endSec }` (substitui o `agenda` do protótipo; mede o texto com a fonte real, não com a largura estimada do protótipo); `fitTemplateText(...)` (mesma ideia do `fitText` das molduras: mínimo 36 px, senão `TEMPLATE_TEXT_OVERFLOW`); `personMotionLayout(source, editMap, protectedBands)` (caixa do rosto; `blocked` = `CAPTION_PROTECTED`).
- **Legenda CJK:** `PERSON_MOTION` usa a mesma legenda da `AutoEdit`/`Moldura` (headline-e-legenda §2): `carregarFontesCJK(language, textoTodo)` antes do render, página por caractere sem espaço em zh/ja, sem fonte de reserva. `CHAT_DM` usa as mesmas fontes nas bolhas.
- **Lambda:** `RENDER_LAMBDA_KINDS` ganha `template` (env, sem deploy de código). O site do Remotion precisa de redeploy (`npm run lambda:deploy`) porque o bundle ganha a composição e os `.wav`. Mídia do `PERSON_MOTION` = URL assinada do campeão (mesma regra de egress da L1). `CHAT_DM` não baixa mídia nenhuma.
- **Pôster:** por ffmpeg, como hoje (L-D5).

## F1.5 Checagem (3 camadas)
1. **Plano** (F1.3): nada inventado, limites, forma.
2. **Build** (geométrica, no `buildTemplateInput`): texto que não cabe = `TEMPLATE_TEXT_OVERFLOW` (`retryHint: 'leave_out'`); caixa do rosto sem lugar = `CAPTION_PROTECTED`; palco e caixa do rosto não se sobrepõem; nada fora da `safeArea`.
3. **Depois do render** (visão, reaproveita a checagem do `legenda-protegida` §4.2, Haiku): 4-6 quadros nos `checkpoints`; pergunta "o texto esperado está inteiro, legível, sem quadrado vazio/fonte trocada e sem nada por cima?". Veredito em `renders.input.templateCheck` (mesma forma do `CaptionCheck`, com `expected`). A regra do veredito é a mesma do F10 (≥ 2 quadros ruins, ou 1 com `reason` em `cut`/`covered`). Ruim = formato `failed` `TEMPLATE_TEXT_MISMATCH`, sai do zip, `retryHint: 'retry'` (1 retry; o 2º `failed` vira `leave_out`). `skipped` (Claude fora) não segura a peça. Custo ~US$ 0,008 por render.

## F1.6 Modelo de dados (delta descrito; **não aplicado**)
Migração aditiva `2026110x_iterate_templates` (backup antes, `npm run db:diff`):
```prisma
enum AutoVariationType { … CHAT_DM  PERSON_MOTION }   // ADD VALUE; DIVERSITY fixo (AXIS_OF)
```
Nada mais. `params` em `variation_items.payload`, o input completo em `renders.input`, o veredito em `renders.input.templateCheck`.

## F1.7 API, estados e erros
- **Sem rota nova.** `IterateConfig.types` inclui os 2 tipos quando a env `ITERATE_TEMPLATES=on` (padrão `off` até o QA passar).
- Estados: os de hoje (`variacao-auto-v1` §3). A peça segue o caminho de vídeo (`engine REMOTION`, fila, Lambda, `AUTO_APPROVE`).
- `IterateAsyncErrorCode` + `'TEMPLATE_TEXT_OVERFLOW'` (`leave_out`) + `'TEMPLATE_TEXT_MISMATCH'` (`retry`). `failReason` humano no backend.
- `IteratePiece` + `isNewTemplate?: boolean` (true nos 2 tipos; o web mostra o selo) + `template?: { id: 'chat-dm' | 'person-motion'; spans: { startSec: number; endSec: number }[] | null } | null`.
- Mock (`notes` da oferta): `[mock:template-overflow:CHAT_DM]`, `[mock:template-check-fail:PERSON_MOTION]` (1ª checagem ruim, a 2ª passa), `[mock:template-check-fail-all:CHAT_DM]`, `[mock:prospect-testimonial]` (o fake do plano manda uma mensagem de resultado do prospect → violação → reparo).

## F1.8 Nomes, pasta e custo
- `adName` `MC_1028_CHAT-DM`; arquivo `MC_1028_CHAT-DM_9x16.mp4`, `MC_1028_PERSON-MOTION_9x16.mp4` (PT `PESSOA-MOTION`). Pasta `2-new-audience/`. README: "conversa desenhada a partir do anúncio; nenhuma pessoa gerada" / "o rosto e a voz são do anúncio original".
- Custo (as `cost_entries` dão o real): plano ≈ +2-3 mil tokens de saída na chamada que já existe (a ia mede); render Lambda ≈ US$ 0,011 por 30 s (sonda L1); checagem por visão ≈ US$ 0,008. **≈ US$ 0,02-0,03 por peça.** Pro usuário: "Free" (entra no `generateEstimateUsd` só a checagem, como a da legenda).
- Tempo de render medido no protótipo (Mac, concurrency 4): chat 18,6 s pra 28,5 s de vídeo; pessoa + motion 28,5 s pra 31,1 s. No Lambda, na ordem de 1 min.

## F1.9 O que a web mostra (maquina-frontend)
Linhas `CHAT-DM` e `PERSON-MOTION` no bloco New audience com o selo "New template" e "Free"; miniatura própria (`TypeThumb` chat e motion); "a única coisa que muda" = `change`; player e Download iguais aos das outras peças; abas 4:5/1:1 escondidas (`supported: false`); erros novos com i18n EN/PT. MSW com os 2 tipos.

## F1.10 O que o QA prova (maquina-qa)
1. Plano em mock oferece os 2 tipos com campeão com fala e rosto; sem fala → nenhum; sem rosto → só `CHAT_DM`; legenda queimada sobre a caixa do rosto → `PERSON_MOTION` em `captionBlocked`.
2. Número que não está no Brain, rótulo de prova inventado ou prospect relatando resultado → violação, reparo, e a peça sai se persistir.
3. Render **real local** (grátis) dos 2 templates com os fixtures: Amnayalife (zh-TW, CJK) e 1 campeão EN. Folha de frames: nenhum quadrado vazio, nenhuma fonte de reserva, quebra CJK por caractere; `nb_frames` = `durationInFrames`; no `PERSON_MOTION`, nenhuma palavra cortada nas emendas e a legenda bate com a fala.
4. Lambda × local (critério L3): PSNR RGB ≥ 40 dB fora da borda dos glifos; 1 render de cada (~US$ 0,03, com ok).
5. `[mock:template-overflow]` → `failed` `leave_out`; `[mock:template-check-fail]` → retry passa; zip com o nome certo na pasta 2; `cost_entries` RENDER + LLM gravadas.

## F1.11 Divisão do trabalho (sem arquivo em comum)
| # | dono | entrega | arquivos | depende de |
|---|---|---|---|---|
| T0 | arquiteto | migração ADD VALUE, tipos (F1.2/F1.4/F1.7) em `contratos/src/iteracao.ts` e nos `contrato.ts` como TRANSIÇÃO, `codeFor` EN/PT, `.env.example` (`ITERATE_TEMPLATES`, `RENDER_LAMBDA_KINDS`), `api.md`, `modelo-de-dados.md` | `api/prisma/`, `contratos/src/`, `docs/` | ok do Gusta |
| T-I | ia | prompt + schema dos 2 drafts no `planAutoBatch` (com `chrome`, `proof`, `srcSpan`); fake determinístico + gatilhos; `checkTemplateText` (generaliza a checagem de legenda) | `api/src/integracoes/**` | T0 |
| T-V | video | composição `Template` (2 templates) com zod; `chatTimeline`, `fitTemplateText`, `personMotionLayout`; `buildTemplateInput`; SFX em `video/public/sfx/`; CJK; `checkpoints`; adaptador do `RenderPort` aceita `kind 'template'`; render local dos fixtures + folha de frames | `video/`, `api/src/render/` | T0 |
| T-B | backend | `allowedFor` (regras F1.1), validação F1.3 (+ `RESULT_TERMS`), `finalizePlan` (spans, palavras, brand), despacho do build, checagem pós-render e `templateCheck`, códigos novos, `isNewTemplate`/`template` na vista, flag `ITERATE_TEMPLATES` | `api/src/iteracao/`, `api/src/edicao/` | T0; T-I/T-V por fake |
| T-F | frontend | F1.9 | `web/` | T0 (MSW) |
| T-Q | qa | F1.10 | `testes/` | todos |
Paralelo: T-I ‖ T-V ‖ T-B ‖ T-F depois do T0; T-Q por último.

## F1.12 Riscos
- **Leitura do chat:** 30 s de texto sem voz pode ter retenção baixa. O protótipo é a medida; o Meta mostra depois.
- **Tradução do "jeito" de falar:** `prospect` precisa soar como alguém real sem virar depoimento. Por isso a regra do `kind` + léxico, e o QA lê 3 roteiros em línguas diferentes.
- **Medida de texto CJK:** o protótipo estimava a largura (`larguraTexto`); no produto mede com a fonte carregada, senão bolha estoura.
- **Campeão com legenda queimada no rosto:** `PERSON_MOTION` some do plano; só a versão sem legenda (legenda-protegida) devolve.

## F1.13 Decisões pro Gusta (F1)
1. **Seguir o protótipo, não o texto do mockup:** o mockup diz "Your clip plays inside the chat" e "creator cut out". O protótipo não tem clipe no chat e põe o rosto numa caixa, sem recortar o fundo. **Recomendo o protótipo na v1** (recorte de fundo é modelo novo e custo novo; clipe dentro da bolha pode ser variante depois).
2. **Só 9:16** nos 2 templates na v1. **Recomendo sim.**

---

# F2 — Quiz durante a análise + preferências do cliente

## F2.1 Como o quiz muda o lote (a ideia central)
1. O Claude passa a planejar um **superconjunto de candidatas** (8 a 16, em ordem de prioridade) com os tipos de `allowed`, como hoje, só que mais itens. Não recebe as respostas.
2. Uma função pura do backend, `selectPieces(candidates, answers, ctx)`, escolhe o lote. Ela roda quando o plano fica pronto e de novo **a cada mudança de resposta**, sem chamar o Claude. Mudar resposta é grátis e instantâneo.
3. Por quê: o quiz roda durante a análise e a pessoa pode terminar antes ou depois do plano, ou voltar e editar. Com o superconjunto, a ordem não importa e nenhuma resposta custa outra chamada.

## F2.2 Respostas e regra de seleção
```ts
// contratos/src/iteracao.ts
export type IterateGoal = 'stretch' | 'new_audience' | 'both' | 'auto';
export type IterateAiAnswer = 'free_only' | 'yes' | 'auto';
/** Q3. Vazio = "Let HookMill choose" (exclusivo). 'face' e 'format' só com F3 ligado e Q2 ≠ 'free_only'. */
export type IterateWant = 'headline' | 'frames' | 'static' | 'chat_motion' | 'face' | 'format';
export interface IterateAnswers {
  goal: IterateGoal;                    // Q1; pulada = 'auto'
  ai: IterateAiAnswer;                  // Q2; pulada = 'auto'
  /** teto do lote pra IA, só com ai = 'yes' (F2.6, decisão de unidade pendente) */
  aiCapUsd: number | null;
  /** reservado: o teto em créditos quando houver preço; sempre null hoje */
  aiCapCredits: null;
  wants: IterateWant[];                 // Q3
}
export interface IteratePreferences extends IterateAnswers { savedAt: string; savedBy: UserRef; fromBatchId: string }
```
**Categoria de cada tipo** (`WANT_OF`, backend): `HEADLINE` → `headline`; `FRAME` → `frames`; `STATIC` → `static`; `CHAT_DM`, `PERSON_MOTION` → `chat_motion`; `AVATAR_*` → `face`; `REMIX_*` → `format`. `CUT`, `NATIVE_SEARCH`, `REVIEW` não têm categoria: **entram sempre** (como no mockup).

**`selectPieces`, na ordem:**
1. `goal: 'auto'` → `both` (a linha do plano diz por quê: `goalReasonKey: 'auto_default'`; com Meta, regra própria depois).
2. Q3 com categorias: candidata cuja categoria não foi pedida → `selection: 'not_asked'` (fora). Q3 vazia → nada sai por aqui.
3. Mistura da Q1 (a ordem do Claude é a prioridade): `stretch` = até 6 ITERATION + 3 DIVERSITY · `new_audience` = até 2 ITERATION + o resto DIVERSITY · `both` = até 4 ITERATION + o resto DIVERSITY. **Teto de 12 peças grátis** (`BATCH_MAX` de hoje). O que passa do teto → `selection: 'goal_cut'` (fora, não aparece pra pessoa).
4. Piso de 4 (D2 de 13/10): se faltar, completa com `goal_cut` por prioridade (nunca com `not_asked`) e liga `flags.smallBatch`.
5. Peça marcada `user_added`/`user_removed` (Add back / tirar) vence as regras 2-3 até a próxima mudança de resposta, que **recomeça a seleção do zero**.
- A regra dos **40 % de diversidade** sai da validação do plano e passa a valer só no `both`/`auto` (que sempre fecha). No `stretch` a pessoa pediu menos diversidade, e a regra não se aplica. Hoje o máximo de ITERATION é 5 (HEADLINE 3 + CUT 2), então "6" vira "até 5".
- O plano do Claude passa a ser validado com `{ min: 8, max: 16 }` candidatas e o máximo por tipo de hoje. O reparo continua o mesmo.

## F2.3 Modelo de dados (delta descrito; **não aplicado**)
```prisma
model Workspace {
  iteratePreferences Json? @map("iterate_preferences")   // IteratePreferences; null = nunca respondeu
}
model VariationBatch {
  answers      Json?     // IterateAnswers do lote; null = quiz ainda não respondido (seleção usa o padrão 'auto')
  answersAt    DateTime? @map("answers_at")
  answersById  String?   @map("answers_by_id")             // FK users, SetNull
}
model VariationItem {
  // `included` (já existe) = selecionada pro lote. Nos AUTO antigos fica true (nada muda).
  wantKey   String? @map("want_key")    // IterateWant | null (CUT/NATIVE/REVIEW)
  selection String?                     // 'auto' | 'asked' | 'not_asked' | 'goal_cut' | 'user_added' | 'user_removed'
  priority  Int?                        // ordem do Claude no superconjunto (0 = mais forte)
}
```
JSON no workspace e não tabela: é 1 registro por cliente, sempre lido inteiro, sem histórico pedido.

## F2.4 API
| método e rota | entrada | saída | erros | quem chama / papel |
|---|---|---|---|---|
| `GET /iterate/config` | — | + `quiz: { aiEnabled: boolean; wants: IterateWant[] }` + `savedPreferences: IteratePreferences \| null` | — | Winner, Your goals · todos menos CLIENT |
| `PUT /iterate/:id/answers` | `{ answers: IterateAnswers; save?: boolean /* padrão true */ }` | `200 IterateBatch` (seleção recalculada se `PLAN_READY`) | 400 `VALIDATION_ERROR` (`rule`: `cap_needs_yes`, `cap_range` 1-1000, `wants_need_ai` — `face`/`format` com `free_only`, `ai_not_enabled` — `face`/`format` sem F3); 404; 409 `INVALID_STATE` (`reason: 'launched'`, ou `ANALYSIS_FAILED`) | Continue / See the plan / Edit answers / Use saved answers · OWNER, ADMIN, MEMBER |
| `PATCH /iterate/:id/items/:itemId` | `{ included: boolean }` | `200 IterateBatch` | 404; 409 `INVALID_STATE` (lote não `PLAN_READY`); 422 `ITEM_NOT_SELECTABLE` (`goal_cut` não aparece; peça de IA usa a rota do F3) | Add back / tirar · OWNER, ADMIN, MEMBER |
| `GET /iterate/preferences` · `DELETE /iterate/preferences` | — | `IteratePreferences \| null` · `204` | — | Brain › cliente ("Forget saved answers") · OWNER, ADMIN |
| `POST /iterate/:id/start` | sem mudança (`expectedPieces` = nº de peças **selecionadas**) | sem mudança; só as `included` viram criativo | + 409 `INVALID_STATE` `reason: 'nothing_selected'` | Generate |
- `save: true` grava `Workspace.iteratePreferences` com `fromBatchId`. O "Saved" do 2º lote vem do `savedPreferences`.
- Respostas chegando em `ANALYZING`/`PLANNING` só são gravadas; a seleção roda quando o plano fica pronto.

**Vista (`IterateBatch`, campos novos, TRANSIÇÃO opcionais):**
```ts
answers?: IterateAnswers | null;
/** o que a seleção usou: goal resolvido + a linha "por quê" do auto */
selectionInfo?: { goal: Exclude<IterateGoal, 'auto'>; goalReasonKey: 'auto_default' | null; stretchMax: number } | null;
/** `pieces` continua = só as selecionadas (o web de hoje não quebra). As fora por Q3 vêm aqui, agrupadas: */
leftOut?: { wantKey: IterateWant; count: number; pieceIds: string[] }[];
notSelected?: IteratePiece[];          // as `not_asked` e `user_removed` (status 'planned'), pra "Add back"
// IteratePiece +
wantKey?: IterateWant | null; selection?: VariationSelection | null; askedByUser?: boolean; priceUsd?: number | null; // null = Free
```
`IteratePiece.askedByUser` = categoria pedida na Q3 (o selo "YOU ASKED"). `priceUsd` = `staticImageUsd` no STATIC, `null` no resto.

## F2.5 Estados
Os do lote não mudam. O quiz é estado da web (pergunta atual); o que importa pro backend é `answers` (null ou não). O "Ad analyzed · plan ready" da pílula = `status: 'PLAN_READY'`; a etapa vem de `analysis.stage/step/checklist` (já existe). Se a pessoa termina o quiz antes do plano, o plano abre no estado "analisando" (já existe).

## F2.6 Como a Q2 entra (com F3 desligado e ligado)
- Sem F3 (`quiz.aiEnabled: false`): a web pula a Q2 e tira `face`/`format` da Q3. `answers.ai` fica `'free_only'`.
- Com F3: Q2 decide o bloco With AI (F3.3). O limite é guardado em **US$ até haver preço** (decisão pendente, F2.9).

## F2.7 O que a web mostra
Trilho Winner · Your goals · Plan · (Approve AI) · Generate · Pieces; quiz de 1 pergunta por tela com a pílula da análise (polling 1,5 s); "Let HookMill choose" marcado por padrão e exclusivo na Q3; faixa "Pre-filled from <cliente>'s last batch (<data>)" + **Use saved answers** (manda o `savedPreferences` e pula pro plano); bloco "Client preferences" com chips e "Edit answers"; "YOU ASKED" nas peças; linha "Left out because you didn't ask for them · Add back" (ou desmarcadas, F2.9); botão Generate com o nº de selecionadas.

## F2.8 O que o QA prova
1. Respostas mandadas durante `ANALYZING` são aplicadas quando o plano fica pronto; mandadas em `PLAN_READY`, recalculam sem nova `cost_entry` LLM.
2. Cada objetivo dá a mistura certa (tabela de casos com 5 ITERATION e 11 DIVERSITY candidatas); `stretch` com só 2 ITERATION dá 2 + 3.
3. Q3 = só `headline` → HEADLINE + CUT + NATIVE + REVIEW selecionadas, o resto em `leftOut` agrupado; Add back entra; Edit answers zera os Add back.
4. Piso de 4 com `smallBatch`; `nothing_selected` no start.
5. `save` grava o workspace; o 2º lote do mesmo cliente traz `savedPreferences`; outro workspace não vê.
6. Validações do DTO (cada `rule`); CLIENT 403 em answers/items.
7. Lote AUTO antigo (sem `answers`, `included` true) abre e gera igual.

## F2.9 Divisão do trabalho
| # | dono | entrega | arquivos | depende de |
|---|---|---|---|---|
| Q0 | arquiteto | migração (F2.3), tipos, `api.md`, `modelo-de-dados.md` | `api/prisma/`, `contratos/src/`, `docs/` | ok do Gusta (F2) |
| Q-I | ia | `planAutoBatch` com `rules.max = 16` e ordem = prioridade; fake com superconjunto | `api/src/integracoes/**` | Q0 |
| Q-B | backend | `selectPieces` (puro, testado), `WANT_OF`, regras de contagem novas, rotas F2.4, `save`, vista, `start` só com `included` | `api/src/iteracao/` | Q0 |
| Q-F | frontend | F2.7 (quiz, pílula, prefs, Left out, Add back) | `web/` | Q0 (MSW) |
| Q-Q | qa | F2.8 | `testes/` | todos |

## F2.10 Riscos
- **Superconjunto custa mais tokens** (até 16 itens com roteiro de template): +~30-60 % de saída no plano, centavos. A ia mede no 1º lote.
- **Planejar pra depois filtrar** pode deixar o lote filtrado com peças menos "redondas" juntas. Aceito: cada peça é uma variável só e independente.

## F2.11 Decisões pro Gusta (F2)
1. **(aberta desde o mockup)** O que não foi pedido na Q3: **fora com "Add back"** (mockup) ou **no lote desmarcado**. O contrato serve aos dois (só muda a web). **Recomendo "fora + Add back":** o lote fica do tamanho do que a pessoa pediu e o botão Generate não engana.
2. **(aberta desde o mockup)** Próximo lote **abre pré-marcado** com as respostas salvas, ou abre em "Let HookMill choose" com o atalho "Use saved answers". **Recomendo pré-marcado + atalho** (é o "aprendizado" do A5).
3. **Unidade do limite da Q2 até haver preço:** US$ (custo real) ou esconder o campo e valer só o teto do workspace. **Recomendo US$** enquanto o uso é interno (Gusta + Tordan).

---

# F3 — Bloco "With AI · uses credits" (opt-in)

## F3.1 Catálogo de IA
| tipo | código | o que é | cadeia (já existe) | peças | custo estimado do item (catálogo de hoje, a conferir) |
|---|---|---|---|---|---|
| `AVATAR_FACE` | `AVATAR-FACE` | mesmo vídeo, mesma voz, mesma edição; só o rosto muda | `SWAP_AVATAR`, `LIPSYNC` + `CHAMPION_AUDIO` + `keepEdit: true` (feature-2 §13.3, take único Pruna) | 3 (FACE 1/2/3) | 3 × (rosto US$ 0,006 + take ~30 s × 0,025) ≈ **US$ 2,3** |
| `AVATAR_PERSONA` | `AVATAR-PERSONA` | outra pessoa em outro cenário; 1 fala de abertura ajustada à persona; resto da copy literal | `SWAP_AVATAR`, `LIPSYNC` + `CATALOG` + `keepEdit: false` (talking head limpo v1, `TTS_LIPSYNC`) | 3 (PERSONA 1/2/3, personas do Brain › audience) | 3 × (rosto + TTS + lipsync ~30 s + transcrição) ≈ **US$ 2,6** |
| `REMIX_DISCOVERY` | `REMIX-DISCOVERY` | "achei isso sem querer", celular na mão; roteiro novo no formato | criativo de cenas (`SCENES`), elenco `SHARED`, ganchos com corpo `REUSE` (mecânica do `NEW_HOOKS`) | 3 (HOOK A · FULL VIDEO, HOOK B/C · SAME BODY) | motor Pruna ≈ **US$ 1,1** · motor Kling ≈ **US$ 6,8** (F3.9) |
| `REMIX_PODCAST` | `REMIX-PODCAST` | host pergunta, convidado conta; 1 falante por passada, plano/contraplano no Remotion | igual ao discovery com 2 elencos e 2 vozes | 3 | Pruna ≈ US$ 1,3 · Kling ≈ US$ 7 — **fora do build até a sonda** (`enabled: false`, selo Beta) |
Fora: Street interview (leva 2, "Wave 2"); Specialist (travado pra todos na v1, `locked: { reason: 'legal_review' }`, Q12). Regras de todos: a pessoa é **sempre** gerada (nunca a pessoa real do campeão); só o que existe no campeão e no Brain; **nenhuma imagem do produto gerada** (o que não é pessoa vem do campeão como b-roll, depois Pexels, Q8).

## F3.2 Modelo de dados (delta descrito; **não aplicado**)
```prisma
enum AutoVariationType { … AVATAR_FACE  AVATAR_PERSONA  REMIX_DISCOVERY  REMIX_PODCAST }   // tier 'ai', axis DIVERSITY
enum VariationKind     { … REMIX_FORMAT }                // peça de formato (cenas próprias; ganchos REUSE no corpo)
enum IterateAiStatus   { PLANNED  PREPARING  AWAITING_APPROVAL  UPDATING  APPROVED  GENERATING  DONE  PREP_FAILED  LEFT_OUT }

model IterateAiItem {                                    // 1 linha do bloco With AI = 1 unidade de aprovação = 3 peças
  id            String @id @default(cuid())
  workspaceId   String @map("workspace_id")
  batchId       String @map("batch_id")
  type          AutoVariationType                        // só os 4 de tier 'ai'
  code          String                                   // "AVATAR-FACE"; único no lote
  index         Int
  status        IterateAiStatus @default(PLANNED)
  checked       Boolean @default(false)                  // marcado no plano (Q2 'yes' + Q3, ou clique)
  suggested     Boolean @default(false)                  // sugestão (Q2 'auto'): selo tracejado, nunca marcado sozinho
  reason        Json                                     // { whyKey: 'hook'|'proof'|'persona'|'cta', text }
  draft         Json    @default("{}")                   // personas, ganchos, roteiro por cena (AiItemDraft, F3.5)
  freeSwapsLeft Int     @default(3) @map("free_swaps_left")
  estimateUsd   Decimal @db.Decimal(12, 4) @map("estimate_usd")   // estimativa da geração (não inclui o preparo)
  credits       Int?                                     // null até haver preço
  approvedAt    DateTime? @map("approved_at")
  approvedById  String?   @map("approved_by_id")
  launchedAt    DateTime? @map("launched_at")
  leftOutAt     DateTime? @map("left_out_at")
  errorCode     String?   @map("error_code")
  failReason    String?   @map("fail_reason")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  @@unique([batchId, code])
  @@index([batchId])
  @@map("iterate_ai_items")
}
model VariationItem { aiItemId String? @map("ai_item_id") }        // as 3 peças do item (kind SWAP_AVATAR ou REMIX_FORMAT)
model CostEntry     { iterateAiItemId String? @map("iterate_ai_item_id") }  // preparo + geração somados por item
```
- **Por que tabela nova:** a peça continua sendo `VariationItem` + `Creative` (1 pra 1, como sempre). O item de IA é outra coisa: agrupa 3 peças e tem estado de aprovação, trocas grátis e custo próprios. Botar isso numa peça duplicaria estado em 3 linhas.
- As peças-filhas nascem no **preparo** (com `included = true`, `axis DIVERSITY`, `code` `AVATAR-FACE-1`…, `castingId`). `AVATAR_FACE`/`PERSONA`: 1 `VariationCasting` `ITEM` por peça (o rosto daquela peça). `REMIX_*`: 1 `SHARED` (o mesmo rosto nas 3 peças; podcast: 2).
- O resto sai das tabelas que já existem: `Face`, `Scene`, `Take`, `ProviderTask`, `Render`.

## F3.3 O bloco no plano (vem do F2)
- O plano do Claude ganha até 3 sugestões de IA (do `allowed` com tier `ai`), cada uma ligada a uma linha do porquê. O `why` ganha a linha **`persona`** (`WhyLine.key` + `'persona'`: quem fala e pra quem).
- `allowed` de IA (backend): `AVATAR_FACE` só se `keepEdit.SWAP_AVATAR` não tem bloqueio; `AVATAR_PERSONA` com Brain › audience preenchido; `REMIX_DISCOVERY` com fala e prova/promessa; `REMIX_PODCAST` só com `ITERATE_AI_PODCAST=on`.
- **Q2 → bloco:** `free_only` = bloco "Off" (switch "Allow AI" muda a resposta pra `yes` com o limite padrão e devolve o lote); `yes` = ligado, com as sugestões cuja categoria está na Q3 já `checked` (Q3 vazia: as sugestões `checked`); `auto` = ligado, **nada checked**, todas `suggested` (aprovado A5b).
- `overCap` = Σ `estimateUsd` dos checked > `aiCapUsd` (ou > o que sobra do teto mensal). Com `overCap`, o botão principal desabilita.

## F3.4 Estados do item de IA
| de | evento | para |
|---|---|---|
| `PLANNED` | `start` com o item `checked` | `PREPARING` (job `AI_PREPARE`: roteiro/personas/ganchos + 3 rostos) |
| `PLANNED` | `start` sem `checked` | some da vista (fica `PLANNED`, não volta) |
| `PREPARING` | rostos + roteiro prontos | `AWAITING_APPROVAL` |
| `PREPARING` | rosto/roteiro falhou | `PREP_FAILED` ("Nothing was charged and this swap doesn't count"; retry grátis, não gasta troca) |
| `AWAITING_APPROVAL` / `APPROVED` | trocar rosto/roteiro, editar fala | `UPDATING` → `AWAITING_APPROVAL` (aprovação desfeita) |
| `AWAITING_APPROVAL` | Approve | `APPROVED` |
| qualquer antes de `GENERATING` | Leave out of batch | `LEFT_OUT` (peças-filhas `included = false`) |
| `APPROVED` (todos os não `LEFT_OUT`) | `POST /iterate/:id/ai/start` | `GENERATING` (peças-filhas viram criativos; cobra) |
| `GENERATING` | todas as peças assentadas | `DONE` (peça `failed` fica com Retry; o item não falha inteiro) |
Lote: `start` (as grátis) passa a `LAUNCHED` como hoje; os itens de IA andam sozinhos. Vista: `ai.stage` = `none` (sem IA) · `plan` · `preparing` · `approve` · `generating` · `done`. `phase` de hoje não muda (é das peças grátis).

## F3.5 Preparo (aprovação antes de gastar)
- **Roteiro** (ia, chamada nova `ClaudeService.planAiItem`, 1 por item, tokens reais): `AVATAR_FACE` não escreve nada (roteiro = o original, "Same hook, voice and cut as the winner"); `AVATAR_PERSONA` escreve 3 personas (do Brain › audience) e **1 fala de abertura** por persona; `REMIX_*` escreve o roteiro cena a cena no formato + **3 ganchos** com nota (0-100) e `policyRisk` (o arriscado começa desmarcado; a nota sai da mesma chamada, sem serviço externo). Cada fala com `source` + `srcSpan`; valida com as mesmas regras do F1.3 (nada inventado; nenhum resultado novo em 1ª pessoa: só pode dizer "eu…" o que o campeão já diz).
- **Rostos:** `FACE_IMAGE` (Soul, US$ 0,006) 3 por item (1 por peça nos avatares; 3 opções no remix), elenco `DIVERSE` (§13.13). Remix: rosto já no cenário do formato.
- **Custo do preparo** (rostos + roteiro, ~US$ 0,02-0,05 por item) é gravado (`cost_entries` com `iterateAiItemId`) e passa pelo teto do workspace, mas **não conta como crédito** (o "charged when you click Generate" da spec vale pros créditos).
- **Trocas:** 3 grátis por item (rosto e roteiro dividem o contador). Depois disso, a troca exige `{ confirm: true, expectedCostUsd }` e mostra o custo.

```ts
// contratos/src/iteracao.ts (F3, TRANSIÇÃO)
export type AiItemType = 'AVATAR_FACE' | 'AVATAR_PERSONA' | 'REMIX_DISCOVERY' | 'REMIX_PODCAST';
export type IterateAiStage = 'none' | 'plan' | 'preparing' | 'approve' | 'generating' | 'done';
export interface AiScene { index: number; speaker: 'host' | 'guest' | 'solo'; speech: string; source: CopySource; srcSpan: { startSec: number; endSec: number } | null; broll: { kind: 'champion_segment' | 'stock_broll'; startSec?: number; endSec?: number } | null }
export interface AiHook { id: string; text: string; score: number; policyRisk: string | null; selected: boolean }
export interface IterateAiItemView {
  id: string; type: AiItemType; code: string; status: IterateAiStatus;
  checked: boolean; suggested: boolean; beta: boolean;
  reason: { whyKey: 'hook' | 'proof' | 'persona' | 'cta'; text: string };
  people: 1 | 2; pieces: 3; outLabel: string;            // "1 video + 2 hooks · 9:16" (idioma da interface)
  costTier: 1 | 2 | 3;                                   // barrinhas relativas
  estimateUsd: number; actualUsd: number;                // actual = Σ cost_entries do item (preparo + geração)
  credits: number | null;                                // null até haver preço
  learned: null;                                         // reservado ("Sold before" com Meta, Q13; fora destas fases)
  freeSwapsLeft: number; nextSwapUsd: number | null;     // null enquanto há troca grátis
  approval: {
    faces: { slot: number; face: FileRef | null; status: 'queued' | 'generating' | 'ready' | 'failed' }[];
    personas: { slot: number; label: string; openingLine: string; brainField: 'audience' }[] | null;  // AVATAR_PERSONA
    script: { scenes: AiScene[]; editable: boolean } | null;                                         // null no AVATAR_FACE (original)
    hooks: AiHook[] | null;                                                                          // REMIX_*
  } | null;                                              // null antes de AWAITING_APPROVAL
  steps: { key: 'faces' | 'voice' | 'lipsync' | 'scenes' | 'swap' | 'render'; status: 'pending' | 'running' | 'done' | 'failed'; progress: number | null }[];
  etaSec: number | null;
  error: { code: string; reason: string; step: string; retryable: boolean } | null;
}
// IterateBatch +
ai?: { stage: IterateAiStage; enabled: boolean; capUsd: number | null; checkedEstimateUsd: number; overCap: boolean;
       items: IterateAiItemView[]; balanceCredits: null; freePiecesReady: number; freePiecesTotal: number } | null;
// IteratePiece +
group?: 'stretch' | 'new_audience' | 'ai'; aiItemId?: string | null; slotLabel?: string | null;   // "FACE 2", "HOOK B · SAME BODY"
// IteratePiece.folder + '3-ai'
```

## F3.6 API
| método e rota | entrada | saída | erros | papel |
|---|---|---|---|---|
| `PATCH /iterate/:id/ai-items/:aiItemId` | `{ checked: boolean }` | `200 IterateBatch` | 404; 409 `INVALID_STATE` (lote não `PLAN_READY`); 422 `AI_NOT_ALLOWED` (Q2 = `free_only`: a web liga o switch antes, mandando answers) | OWNER, ADMIN, MEMBER |
| `POST /iterate/:id/ai-items` | `{ type: AiItemType }` ("Add a format") | `201 IterateBatch` | 409 `INVALID_STATE`; 422 `FORMAT_LOCKED` `{ reason }`; 409 `ALREADY_IN_BATCH` | idem |
| `GET /iterate/formats` | — | `{ items: { type, code, nameKey, people, tier, beta, wave, locked: { reason } \| null }[] }` | — | Dialog "Add a format / Swap" |
| `POST /iterate/:id/start` | + `ai?: 'prepare' \| 'none'` (padrão `prepare`) | `202 IterateBatch` | os de hoje | "Generate 11 · review 2 AI" (`prepare`) · "Generate without AI" (`none`) |
| `POST /iterate/ai-items/:aiItemId/faces` | `{ slot: number; confirm?: true; expectedCostUsd?: number }` | `202 IterateAiItemView` (`UPDATING`) | 409 `SWAPS_EXHAUSTED` `{ nextSwapUsd }` sem confirm; 409 `SPEND_CAP_EXCEEDED`; 409 `INVALID_STATE` | New face |
| `POST /iterate/ai-items/:aiItemId/script` | `{ confirm?: true; expectedCostUsd?: number }` | `202` | idem | New script |
| `PATCH /iterate/ai-items/:aiItemId/script` | `{ scenes?: { index: number; speech: string }[]; openingLines?: { slot: number; text: string }[]; hooks?: { id: string; selected: boolean }[] }` | `200` (aprovação desfeita) | 422 `SCRIPT_INVALID` `{ violations }`; 422 `HOOKS_COUNT` (exatamente 3 selecionados) | editar fala / escolher ganchos |
| `POST /iterate/ai-items/:aiItemId/approve` | `{}` | `200` (`APPROVED`) | 409 `INVALID_STATE` (não `AWAITING_APPROVAL`) | Approve <code> |
| `POST /iterate/ai-items/:aiItemId/leave-out` | `{}` | `200` | 409 (já `GENERATING`) | Leave out of batch |
| `POST /iterate/ai-items/:aiItemId/retry-prep` | `{}` | `202` | 409 (não `PREP_FAILED`) | Retry (preparo) |
| `POST /iterate/:id/ai/start` | `{ expectedPieces: number; expectedCostUsd: number }` | `202 IterateBatch` (`GENERATING`) | 409 `NOT_ALL_APPROVED` `{ pending: string[] }`; 409 `ESTIMATE_CHANGED` `{ estimateUsd }` (> ×1,10); 409 `AI_CAP_EXCEEDED` `{ capUsd, estimateUsd }`; 409 `SPEND_CAP_EXCEEDED` | **Generate AI pieces (N)**: o único que dispara a geração paga |
| `POST /iterate/pieces/:pieceId/retry` (existe) | sem mudança | — | + regra: peça de IA refaz **só a etapa que falhou** (cena/take); grátis pro usuário até 2 vezes por peça (`AI_RETRY_FREE_MAX=2`), depois exige `{ confirm, expectedCostUsd }` | Retry this step |
CLIENT: 403 em tudo acima (gera ou decide gasto). Mock: `[mock:ai-face-fail]` (1º rosto falha), `[mock:ai-script-invalid]`, `[mock:ai-scene-fail:<TYPE>]`, `[mock:ai-estimate-up]` (estimativa sobe 20 % no ai/start).

## F3.7 Geração (F3a: religar; F3b: formato)
- **F3a, `AVATAR_FACE`:** no `ai/start`, cada peça-filha vira o criativo que o `launch` do lote MANUAL já cria pra `SWAP_AVATAR` (`keepEdit: true`, take Pruna com a fatia do áudio, render `remix-keep`, aceite §13.10). O código fica nos módulos de hoje (`variacoes`/`troca`), chamado pelo `iteracao`. Nada de cadeia nova. Antes do corte: a QA roda 1 troca em mock e **1 real** (~US$ 0,8, com ok), porque essa cadeia não roda desde 08/10.
- **F3a, `AVATAR_PERSONA`:** talking head limpo v1 (`LIPSYNC` + `CATALOG`): roteiro = transcrição do campeão com a fala de abertura da persona, voz do catálogo no gênero do rosto, render do template de criativo do zero (`clean`) + legenda automática.
- **F3b, `REMIX_DISCOVERY`:** criativo de cenas a partir do roteiro aprovado. Peça A = gancho A + corpo; peças B/C = gancho B/C + **corpo `REUSE`** do A (mecânica do `NEW_HOOKS`: só o gancho é gerado de novo). B-roll: trechos do campeão sem a pessoa (`editMap.timeline` ≠ `main`) e, sem eles, Pexels (pipeline das molduras); **nunca imagem gerada do produto**. O render do criativo do zero ganha `cutaways` (maquina-video).
- **F3b, `REMIX_PODCAST`** (só depois da sonda): 2 elencos, 2 vozes, 1 lipsync por falante por passada, render de plano/contraplano. Sonda proposta: 1 trecho de 10 s com 2 falantes no motor escolhido, **≤ US$ 2, com ok do Gusta**.
- **Nomes:** `MC_1028_AVATAR-FACE-1_9x16.mp4`, `MC_1028_REMIX-DISCOVERY-HA_9x16.mp4` (`-HA`/`-HB`/`-HC` = gancho), seguindo `CLIENTE_MMDD_CODIGO` (o `·` do mockup vira `_`, como no produto). Zip com 3 pastas: `1-stretch-its-life/`, `2-new-audience/`, **`3-with-ai/`** (PT `3-com-ia/`), README "pessoa gerada por IA; roteiro do anúncio original".
- **Formatos:** 9:16 no lote; 4:5/1:1 sob demanda pela rota de hoje (render de novo, sem gerar de novo).

## F3.8 Custo, teto e créditos
- `IterateConfig.ai = { enabled, podcastEnabled, defaultCapUsd: 10 }`. `estimateUsd` de cada item = `CatalogService` de hoje (`estimate`, `estimateSwap`, `takeUnits`) + Lambda (~US$ 0,011/peça).
- **3 tetos, na ordem:** (1) `expectedCostUsd` mostrado (×1,10); (2) teto do lote (`answers.aiCapUsd`); (3) teto mensal do workspace (`assertWithinCap`). O preparo só passa pelo (3).
- `cost` do lote ganha `aiPrepUsd`, `aiUsd` (geração), `aiCredits: null`; `totalUsd` soma tudo. `summary.videoCreditsUsd` passa a ser = `aiUsd` (deixa de ser `0` literal; tipo vira `number`).
- Nenhum valor de crédito é inventado: `credits` e `balanceCredits` ficam `null`, e a web mostra "X credits" como placeholder até o preço existir.

## F3.9 O que a web mostra
Bloco With AI (switch, OPT-IN, grupos New face / New format, Because ↔ linha do Why, barrinhas, "Suggested" tracejado, medidor do limite, alerta acima do limite); barra preta com os 2 botões; tela Approve AI (abas por código, rostos, personas, ganchos acima do roteiro, trocas restantes, Leave out, Approve, "Generate AI pieces (N)" só com tudo aprovado, pílula "Free pieces: 4/11 ready"); Generate com cartões de IA e etapas reais; Pieces com a seção With AI; Dialog/Drawer "Add a format / Swap". Tudo em EN/PT, desktop e 390 px.

## F3.10 O que o QA prova
1. Q2 `auto` → itens `suggested`, nenhum `checked`, e o `start` não cria peça de IA nem `cost_entry` de geração. Q2 `free_only` → `PATCH checked` = 422.
2. `start` com IA marcada: as grátis entram na fila **na hora** (render começa antes de qualquer aprovação); os itens vão pra `PREPARING`.
3. Trocas: 3 grátis, a 4ª pede confirm; editar fala desfaz a aprovação; `SCRIPT_INVALID` com número inventado.
4. `ai/start` só com tudo aprovado; `ESTIMATE_CHANGED`, `AI_CAP_EXCEEDED`, `SPEND_CAP_EXCEEDED`; é a única rota que cria `cost_entry` de VIDEO/LIPSYNC/TTS.
5. `AVATAR_FACE` em mock: 3 criativos, áudio md5 = campeão, edição igual (aceite §13.10). 1 real com ok (~US$ 0,8).
6. `REMIX_DISCOVERY` em mock: peças B/C reaproveitam o corpo do A (nenhuma cena do corpo cobrada 2 vezes); b-roll sem imagem gerada.
7. Falha de etapa → Retry refaz só a etapa; 3º retry pede confirm.
8. Zip com 3 pastas; nomes com `-HA`/`FACE`; CLIENT 403.

## F3.11 Divisão do trabalho
| # | dono | entrega | arquivos | depende de |
|---|---|---|---|---|
| X0 | arquiteto | migração F3.2, tipos F3.5, `api.md`, `eventos.md` (só polling), `.env.example` (`ITERATE_AI`, `ITERATE_AI_PODCAST`, `AI_RETRY_FREE_MAX`) | `api/prisma/`, `contratos/src/`, `docs/` | ok do Gusta (F3) |
| X-I | ia | `planAutoBatch` com sugestões de IA + linha `persona`; `planAiItem` (personas, roteiro de formato, 3 ganchos com nota/risco); estimativas por item; fakes + gatilhos; sonda do podcast só com ok | `api/src/integracoes/**` | X0 |
| X-B | backend | `IterateAiItem` (máquina F3.4), job `AI_PREPARE`, rotas F3.6, `start` com `ai`, `ai/start` (cria as peças pela cadeia de hoje), 3 tetos, `cost` novo, retry por etapa, zip pasta 3, vista | `api/src/iteracao/`, `api/src/variacoes/`, `api/src/troca/`, `api/src/edicao/` | X0 |
| X-V | video | F3a: nada novo (conferir `remix-keep` do swap no Lambda); F3b: `cutaways` no criativo do zero; depois da sonda, plano/contraplano | `video/`, `api/src/render/`, `api/src/medicao/` | X0 |
| X-F | frontend | F3.9 | `web/` | X0 (MSW) |
| X-Q | qa | F3.10 | `testes/` | todos |
Ordem dentro do F3: **F3a inteiro (avatar) → F3b discovery → podcast (sonda)**. Cada sub-fase sobe atrás de flag.

## F3.12 Riscos
- **Cadeia de troca parada desde 08/10:** pode ter quebrado com Lambda, legenda protegida e headline. Por isso a 1ª entrega do F3a é "1 troca em mock + 1 real".
- **Depoimento falso por pessoa gerada:** um avatar falando em 1ª pessoa vira depoimento. Regra: só pode dizer "eu…" o que já está no campeão (validação F3.5). Meta e TikTok pedem aviso de IA em pessoa realista; o README do zip avisa, e a publicação na Meta (meta-v1) deve marcar o rótulo de IA quando a peça for `tier ai`.
- **Retry "grátis" custa pra nós:** limite de 2 por peça.
- **Egress e tempo:** 3 peças de IA ~2-10 min cada (Pruna/Kling); o lote "termina" bem depois das grátis. A web já separa.

## F3.13 Decisões pro Gusta (F3)
1. **Motor padrão do `REMIX_DISCOVERY`:** Pruna (TTS + lipsync, ~US$ 1,1 o item, rosto mais parado) ou Kling 3.0 (~US$ 6,8, mais natural com celular na mão). **Recomendo Pruna como padrão** e Kling como opção na aprovação, até o Meta mostrar a diferença.
2. **Preparo cobra crédito?** Rostos + roteiro custam ~US$ 0,02-0,05 por item antes da aprovação. **Recomendo não contar como crédito** (só registrar e passar pelo teto do workspace), como a spec diz ("charged when you click Generate").
3. **Retry de etapa de IA:** grátis até 2 vezes por peça, depois mostra o custo. **Recomendo assim.**

---

## 4. Ordem geral e paralelismo
1. **F1** (templates): T0 → (T-I ‖ T-V ‖ T-B ‖ T-F) → T-Q → ok do Gusta no dev.
2. **F2** (quiz): pode começar o Q0 assim que o T0 entrar (sem pasta em comum com o F1 além de `regras.ts`, que é do backend nas duas fases; o backend faz F1 antes de F2).
3. **F3a → F3b**, cada um com ok do Gusta e sonda paga só com ok.
Todo gasto real (render Lambda de teste, troca real, sonda) é pedido antes, com o valor.

## 5. Conflitos encontrados (spec × código × decisões) e como ficou
1. **Rotas:** a spec usa `/iterations/...` e `/clients/:id/iterate-preferences`. O produto usa `/iterate/...`, e o workspace vem do token (regra de `api.md`). Ficou `/iterate/...` e `/iterate/preferences`.
2. **"6 de Stretch":** o catálogo de hoje tem no máximo 5 ITERATION (HEADLINE 3 + CUT 2; COLD-OPEN/HOOK-TEXT/ENDCARD saíram em 25/10). Ficou "até 6", que dá 5 na prática.
3. **40 % de diversidade × objetivo "Stretch":** 5 + 3 dá 37 %. A regra passa a valer só em `both`/`auto` (F2.2).
4. **"Sem replan, sem editar item" (13/10):** o Add back e a marcação de IA são edição do plano pela pessoa. Fica permitido só na seleção (ligar/desligar), sem editar conteúdo das peças grátis.
5. **Mockup × protótipo nos templates:** clipe no chat e "cut out" (F1.13 item 1).
6. **Nome do anúncio:** mockup `MC·REMIX-PODCAST·HA`; produto `MC_1028_REMIX-PODCAST-HA` (regra D6).
7. **`summary.videoCreditsUsd: 0`** era literal no tipo; com F3 vira `number`.
8. **"Sold before" / ranking com Meta e chat "Ask HookMill → Add to batch":** estão no mockup mas fora destas 3 fases (campos reservados `learned: null`; o chat é outro contrato).

## 6. Decisões pro Gusta (todas, curtas)
| # | decisão | recomendação |
|---|---|---|
| D1 | Templates seguem o **protótipo** (sem clipe no chat, rosto em caixa sem recorte) e não o texto do mockup | protótipo |
| D2 | Templates só em 9:16 na v1 | sim |
| D3 | **(aberta)** O que não foi pedido na Q3: fora com "Add back" ou no lote desmarcado | fora + Add back |
| D4 | **(aberta)** Próximo lote abre pré-marcado com as respostas salvas | pré-marcado + "Use saved answers" |
| D5 | Unidade do limite da Q2 até haver preço | US$ (uso interno) |
| D6 | Motor padrão do Remix Discovery | Pruna; Kling como opção |
| D7 | Preparo (rostos + roteiro) conta como crédito | não |
| D8 | Retry de etapa de IA | grátis até 2 por peça |
| D9 | **Preço / créditos** | segue aberto; o contrato guarda US$ e `credits: null` |

## Decisões do Gusta (28/10)
- D1/D2 sim (protótipo, só 9:16) · D3 fora + "Add back" · D4 respostas salvas pré-marcadas · D5 limite em US$.
- **D6 (substitui a recomendação "Pruna padrão, Kling opção"):** o motor não é escolha do usuário. A análise classifica o campeão: **talking head/podcast (pouco movimento) → Pruna (lipsync)**; qualquer outro → **Kling 3.0**. O Pruna só aparece disponível quando a classificação for talking head/podcast. Fluxo: **gera as imagens primeiro** (rosto/cena de cada take) e o usuário **aprova take a take** antes de qualquer vídeo.
- **D7/D8 (substitui "preparo não conta; retry grátis até 2"):** "o combo todo" = o crédito cobre o formato inteiro (preparo, imagens, vídeo e refações) numa cobrança só. O custo interno segue gravado por etapa em US$ pro teto e pra medir margem. Ainda é preciso definir um teto interno de refações pra não estourar a margem: propor no F3.
