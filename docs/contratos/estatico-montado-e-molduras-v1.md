# Estático "anúncio montado" + molduras de vídeo — contrato v1
Data: 2026-10-25 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 25/10 ("APROVO TUDO")**.
**Fechamento 25/10:** D1–D14 fechadas com as recomendações do arquiteto (D1 = 2k, sonda S1 feita), **exceto D11, revertida**: o Gusta quer **as 18 molduras iguais ao protótipo**, incluindo o Meet diálogo (`call_dialog`) com as 2 fontes do campeão, sem rosto gerado. O protótipo aprovado ("ficou mt incrível": `video/src/prototipos/molduras/`, vídeos e contact sheet em `video/out/prototipo-molduras-2026-10-25/`) **cumpre o B1-D e o B2-D**: o visual das molduras está aprovado e é a referência do render; onde este texto e o protótipo divergirem no visual ou nos campos de texto, vale o protótipo. Adendo do Gusta 25/10: a 2ª fonte do B2 pode ser b-roll buscado pelo pipeline do get-brolls (§B3.1). Tipos de transição escritos (§C.0) e migração `20261025000100_molduras_brand_color` aplicada.
Origem: decisões do Gusta de 25/10 (`decisions/log.md`, "HookMill: estático vira anúncio montado + molduras de vídeo do pack DVN").
Vale **por cima** do `variacao-auto-v1.md` §14.3 só no que este arquivo muda; o resto do §14 (render `IMAGE_GEN`, fila, formatos sob demanda, teto, reenvio) continua valendo.
Ordem do Gusta: **A** (estático) → **B1** (10 molduras de 1 vídeo) → **B2** (molduras de 2 fontes).

Evidência lida pra escrever este contrato:
- Sonda reprovada (foto + headline, rev. 23/10): `api/src/integracoes/sondas/out/estatico-2026-10-25T04-53-54-757Z/static-9x16.png` (768×1360).
- Referência de layout do Gusta: `~/Downloads/WhatsApp Image 2026-10-15 at 23.10.24 (2).jpeg` (só estrutura; tema e oferta dela não entram).
- Experimento aprovado: `api/src/integracoes/sondas/out/estatico-layout-2026-10-25/layout-1792904521654.png` (864×1536, GPT Image 2 high 1k, 82 s) e o prompt em `gerar.ts` da mesma pasta.
- Catálogo do pack: `design/formatos-pack-dvn-2026-10-25.md`. Templates atuais: `video/src/{Criativo,AutoEdit,RemixKeep}.tsx`, `video/src/lib/{formatos,autoEdit,schema,templates}.ts`.
- Preço (página da WaveSpeed, lida 25/10; "o valor final da task prevalece"): `openai/gpt-image-2/text-to-image` high = **US$ 0,22 (1k) · 0,40 (2k) · 0,72 (4k)**; `openai/gpt-image-2/edit` high = **0,23 · 0,41 · 0,73** com 1 imagem de entrada, **+0,012 por imagem extra**. Schema (`wavespeed schema`, 25/10): os dois aceitam `aspect_ratio` 9:16, 4:5, 1:1 e `resolution` 1k/2k/4k.

## 0. Resumo em 5 linhas
1. **A:** o STATIC passa a ser um anúncio montado em blocos (marca, tagline, headline com destaque, sub, faixa manuscrita, foto-herói com emoção, tela do produto, 3-5 cards, faixa de confiança, CTA, frase de fechamento). O `planAutoBatch` devolve **cada texto separado** e com a **fonte no briefing**; o backend valida e o prompt builder monta os blocos.
2. **"Nada inventado" vira regra por bloco:** número, preço, prazo, "grátis", garantia, plataforma e autoridade só entram se estiverem no Brain ou na fala; faltou dado = **o bloco some** (o layout tem variante sem ele), nunca texto genérico com promessa.
3. **Acento errado ("vólta"):** checagem de texto por visão do Claude depois da imagem (~US$ 0,005); erro em texto crítico = 1 refação automática dentro do teto; erro em texto menor = entrega com aviso na peça.
4. **B:** uma composição Remotion nova `Moldura` com os **18 templates do protótipo** (B1 = 12 de 1 fonte, B2 = 6 de 2 fontes), usada pela variação AUTO como tipo novo `FRAME` (vídeo do campeão dentro da moldura, custo de geração zero; b-roll do get-brolls opcional no B2); o criativo do zero ganha as mesmas molduras como opção de template logo depois.
5. **Custo por estático:** US$ 0,22 (1k) ou 0,40 (2k) + ~0,005 de checagem; pior caso com refação 0,45 / 0,81. Moldura: US$ 0 de geração.

---

# PARTE A — STATIC "anúncio montado"

## A1. O que muda e o que não muda
| | rev. 23/10 (hoje) | esta proposta |
|---|---|---|
| saída do plano | `headline` ≤ 50 + `visual {object, scene, vibe, style, headlinePlacement}` | `layout: 'assembled'` + `copy` (textos de tela por bloco, cada um com fonte) + `visual` v2 (herói com emoção, tela do produto, clima) |
| texto na imagem | só a headline; prompt proíbe o resto | todos os blocos do `copy`, escritos exatamente como vieram; o prompt proíbe **qualquer outro** texto |
| cor | a imagem decide | paleta escura derivada da cor da marca (backend escolhe, §A3.3) |
| render | `Render` `IMAGE_GEN`, 1 task, reenvio 1× | igual; a 2ª task também pode vir da checagem de texto (§A6) |
| modelo | `gpt-image-2/text-to-image` high 1k | igual, ou `gpt-image-2/edit` quando há imagem de referência da tela (D4); resolução em D1 |

Não muda: fila, `engine IMAGE_GEN`, `provider_tasks.render_id`, formatos sob demanda, zip, Library, teto, estados da peça, mock existente.

## A2. Saída do `planAutoBatch` pro STATIC (maquina-ia)
Tipo novo em `api/src/integracoes/contrato.ts` (substitui o `AutoStaticDraft` de 23/10 **para planos novos**; o antigo fica como `AutoStaticDraftV1` pra leitura de plano legado, §A5):
```ts
export type StaticLayout = 'assembled';                  // único valor gerado a partir daqui
export type StaticIcon =                                 // conjunto fechado e neutro; o prompt descreve o desenho, nunca um logo
  | 'moon' | 'sun' | 'clock' | 'calendar' | 'check' | 'shield' | 'lock' | 'heart' | 'star' | 'lightning'
  | 'home' | 'phone' | 'chat' | 'chart' | 'money' | 'gift' | 'person' | 'people' | 'play' | 'leaf'
  | 'target' | 'book' | 'spark' | 'route';
export type StaticEmotion = 'pain' | 'relief' | 'desire' | 'curiosity' | 'pride';
/** De onde saiu o texto. 'generic' só onde a tabela §A3.1 deixa (frases sem afirmação nenhuma). */
export type CopySource = BriefField | 'transcript' | 'generic';

export interface StaticCopy {                            // TUDO no idioma da tela (screenLanguage = fala do campeão)
  brandLine: string | null;                              // ≤ 32 · sob o nome da marca: o que é ("rotina noturna de 10 min")
  brandLineSource: CopySource | null;
  tagline: string | null;                                // ≤ 32 · canto superior direito, ≤ 2 frases curtas ("Menos dor. Mais vida.")
  headline: { lead: string; highlight: string };         // lead ≤ 45 + highlight ≤ 22 (soma ≤ 60) · fala com a pessoa; highlight = trecho final na cor de acento
  headlineSource: CopySource;                            // promise | pains | transcript (nunca 'generic')
  subheadline: string | null;                            // ≤ 90 · 2-3 frases curtas; a última pode vir em destaque
  subheadlineSource: CopySource | null;
  handwritten: string | null;                            // ≤ 28 e ≤ 5 palavras · faixa manuscrita emocional ("Sua manhã de volta.")
  benefits: { icon: StaticIcon; title: string; line: string; source: CopySource }[];   // 0 ou 3-5 · title ≤ 24, line ≤ 40
  trust: { icon: StaticIcon; text: string; source: CopySource }[];                     // 0 ou 3 · text ≤ 24 (vira caixa alta)
  cta: { main: string; sub: string | null; subSource: CopySource | null };             // main ≤ 18 · sub ≤ 22
  closing: string | null;                                // ≤ 50 e ≤ 9 palavras · frase manuscrita de fechamento (2 linhas)
}
export interface StaticVisualV2 {                        // em INGLÊS (vai pro prompt); nada de texto, aspas, marca ou nicho nomeado
  hero: { person: string; setting: string; emotion: StaticEmotion; light: string } | null;  // person ≤ 200, setting ≤ 160, light ≤ 80; null = sem pessoa
  product: {
    kind: 'phone_screen' | 'laptop_screen' | 'physical_product' | 'none';
    look: string | null;                                 // ≤ 200 · como a tela/produto se parece, sem texto legível
    screenTitle: string | null;                          // ≤ 24, idioma da tela · único texto permitido dentro da tela
    screenTitleSource: CopySource | null;
  };
  mood: string;                                          // ≤ 100 · clima geral ("intimate, hopeful, late evening")
}
export interface AutoStaticDraftV2 {
  type: 'STATIC'; layout: StaticLayout;
  refAtSec: number | null;                               // frame-chave usado como referência (rastreio), como em 23/10
  copy: StaticCopy;
  visual: StaticVisualV2;
}
```
Regras do prompt do plano (maquina-ia, `auto-plano.ts`):
- A headline **fala com a pessoa** (2ª pessoa no idioma da tela: "Você…", "You…", "Tú…") e nomeia a dor ou o desejo do Brain; o `highlight` é o fim da frase, o pedaço mais forte.
- Emoção: `hero.emotion` ataca a linha do porquê (`whyKey`): `hook` → `pain` ou `curiosity`; `proof` → `relief` ou `pride`; `cta` → `desire`. Dois STATIC no mesmo lote (D2 do variacao-auto) = emoções diferentes.
- Pessoa só genérica (idade aproximada, jeito, roupa simples); nada de celebridade, marca, logo, uniforme com nome.
- Cards e faixa de confiança **resumem o Brain**, não descrevem o produto inventado. Sem dado pra 3 cards = `benefits: []`. Sem dado pra 3 itens de confiança = `trust: []`.
- `cta.main` vem de `offer.cta` quando existe; senão verbo de ação genérico sem promessa ("Comece hoje", "Saiba mais").
- Tamanho: soma de todos os textos de `copy` ≤ 420 caracteres (legibilidade na resolução escolhida).

## A3. "Nada inventado" (§6.2.5) aplicado a cada bloco
### A3.1 Tabela por campo
| campo | fonte aceita | 'generic' pode? | se faltar dado |
|---|---|---|---|
| nome da marca | `offer.name` (backend injeta; a IA não escreve) | — | sempre existe |
| `brandLine` | `what`, `kind`, `promise` | não | `null` → só o nome |
| `tagline` | `promise`, `pains`, `transcript` | sim, se não tiver número nem termo de afirmação (§A3.2) | `null` → canto vazio |
| `headline` | `promise`, `pains`, `transcript` | **não** | plano inválido (`static_headline_unsupported`) |
| `subheadline` | `what`, `promise`, `proof`, `offerAndPrice`, `transcript` | não | `null` → bloco some |
| `handwritten` | qualquer | sim (frase emocional sem afirmação) | `null` → faixa some |
| `benefits[]` | `what`, `promise`, `pains`, `proof`, `offerAndPrice` | **não** | `[]` → coluna de cards some, herói e tela crescem |
| `trust[]` | `proof`, `offerAndPrice`, `what`, `notes` | **não** | `[]` → faixa some |
| `cta.main` | `cta`, `transcript` | sim (verbo sem promessa) | sempre existe |
| `cta.sub` ("7 dias grátis") | `offerAndPrice`, `cta` | **não** | `null` → botão de 1 linha |
| `closing` | qualquer | sim (sem afirmação) | `null` → canto vazio |
| `product.screenTitle` | `what`, `name`, `kind` | não | `null` → tela sem texto |
| conteúdo da tela | imagem de referência (D4) ou nada legível | — | tela abstrata (linhas, ícones, anel) **sem texto**, nunca lista inventada |

**Fonte em todo texto de tela (decisão do arquiteto 25/10, pedido da ia):** `tagline`, `handwritten`, `closing` e `cta.main` também levam fonte (`taglineSource`, `handwrittenSource`, `closingSource`, `cta.mainSource`; opcionais até a fusão, depois obrigatórias quando o texto existe). Motivo: a validação `unsupported_source` e o rastreio ficam uniformes (todo texto da imagem diz de onde veio) e o "nada inventado" pega uma tagline com promessa marcada `generic`. Esses 4 são os únicos que aceitam `'generic'` (frase sem número nem termo de afirmação, §A3.2).

O experimento aprovado inventou o conteúdo da tela ("Gato e vaca 2 min", "3 de 5") e afirmações ("7 DIAS GRÁTIS", "iOS E ANDROID", "Plano de 21 dias") porque o prompt foi escrito à mão. **Pela regra acima, essas peças só saem se o briefing tiver esses dados.**

### A3.2 Validação (maquina-backend, `api/src/iteracao/regras.ts`, puro e testado; mesma rotina de reparo do §6.3)
1. `invented_number` (já existe): roda em **todo** texto do `copy` + `screenTitle`.
2. `invented_claim` (novo, `inventedClaims(text, ctx, lang)`): léxico por idioma (pt, en, es; outros idiomas = só a regra de número) de afirmações que exigem dado: grátis/free/gratis/trial/teste · garantia/guarantee/reembolso/refund · desconto/off/promoção/sale/% · iOS/Android/App Store/Google Play · especialista/médico/doctor/clinically/aprovado/certificado/estudo · "nº 1"/"#1"/melhor/best · "sem risco"/"risk-free". Se o texto tem o termo e nenhuma fonte do Brain/transcrição tem um termo da mesma família = violação. Léxico em `api/src/iteracao/afirmacoes.ts` (tabela, não regex solta).
3. `unsupported_source` (novo): `source` aponta pra campo do Brain que é `null`, ou `'generic'` num campo que não aceita (tabela §A3.1).
4. Contagens e tamanhos: `benefits` 0 ou 3-5; `trust` 0 ou 3; limites de caracteres e palavras do §A2; soma ≤ 420 (`static_copy_too_long`); `headline.lead`/`highlight` não vazios.
5. Já existentes, agora sobre o `visual` v2: `static_visual_has_text` (aspas em `person`/`setting`/`light`/`look`/`mood`), `static_visual_has_brand` (`brandTerms`). O nome da marca **pode** aparecer no `copy` só no bloco da marca (backend injeta), não em `benefits`/`trust`.
6. `duplicateKey` = `STATIC:<headline.lead + highlight normalizada>`.
Violou = a peça volta pra IA na 2ª chamada com a violação; ainda inválida, o reparo determinístico **apaga o bloco** que violou quando ele é opcional (vira `null`/`[]`) em vez de tirar a peça; só tira a peça se a violação for na headline.

### A3.3 Cor da marca (backend)
`palette = { background, accent }` calculada pelo backend (a IA não escolhe hex): `accent` = `Workspace.brandColor` (D3) › cor saturada dominante da captura da página (`pageCaptureFileId`) › cor mais saturada do `measurements.palette` do campeão › `#FF8A3D`. `background` = o `accent` escurecido (L ≈ 8-12 %, mesmo matiz). Função pura `paletaDoEstatico(...)` no `iteracao` (contraste do texto branco ≥ 7:1 no fundo, testado).

## A4. Novo `buildStaticImagePrompt` (maquina-ia, alto nível)
Assinatura: `buildStaticImagePrompt(spec: StaticImageSpecV2, aspect: StaticAspect, opts: { safe: boolean; hasScreenRef: boolean }): string`, onde
```ts
export interface StaticImageSpecV2 {
  layout: 'assembled'; screenLanguage: string; brandName: string;
  palette: { background: string; accent: string };
  copy: StaticCopy; visual: StaticVisualV2;
}
```
Blocos, na ordem do experimento aprovado (`gerar.ts`), cada um **só se o dado existir**:
1. Abertura: "polished, high-converting vertical direct-response ad poster…, dense but organized layout, strong visual hierarchy, every text element crisp, legible and spelled exactly as written below in <idioma> with correct accents. Nothing else written anywhere."
2. `PALETTE AND MOOD`: fundo `background`, acento `accent`, `visual.mood`, film grain sutil.
3. `TOP LEFT`: **wordmark** com `brandName` + `brandLine` em versalete (ícone: D2).
4. `TOP RIGHT`: `tagline` em 2 linhas + sublinhado no acento.
5. `HEADLINE`: `lead` em branco, `highlight` na cor de acento, sans geométrica grande, à esquerda.
6. `SUBHEADLINE`.
7. `HANDWRITTEN ACCENT`: pincelada no acento, levemente inclinada, script **de letras separadas e legíveis** (mitigação do §A6).
8. `HERO EMOTION`: `person` + `setting` + `light`, emoção descrita pelo enum (tabela fixa de expressões por emoção, inglês), "realistic photo, natural skin texture, not stock-looking".
9. `CENTER` device: `product.kind` + `look`; com referência (D4) = "the phone shows exactly the screen from the reference image"; sem referência = "abstract interface with shapes, rings and icons, no readable words" + `screenTitle` se houver.
10. `RIGHT COLUMN`: cards (ícone do enum descrito em palavras, título branco, linha cinza). Sem cards = herói e device ocupam a largura.
11. `TRUST STRIP`: 3 itens com ícone e versalete.
12. `BOTTOM LEFT CTA`: pílula no acento, seta, `main` grande + `sub` menor.
13. `BOTTOM RIGHT`: `closing` manuscrito com sublinhado.
14. Fechamento: margens (D6), "no element cut off except the person on the edge", "no watermarks, no logos other than the wordmark, no extra words, no lorem ipsum, no misspellings", `TEXT CHECKLIST` com **cada texto exato numa linha** (repetição deliberada: reduz erro de grafia), `aspect ratio`.
**`safe: true`** (recusa de conteúdo): tira o bloco 8 inteiro (sem pessoa); entra uma natureza-morta do `setting` sem gente, com a mesma luz; device e cards crescem. Tudo o mais igual.
**Por aspecto** (função pura `blocosPorAspecto(aspect, spec)`, testada):
| bloco | 9:16 | 4:5 | 1:1 |
|---|---|---|---|
| marca + tagline | sim | sim | marca sim, tagline não |
| headline + sub | sim | sim | headline sim, sub só se ≤ 45 |
| faixa manuscrita | sim | sim | não |
| herói + device | sim | sim | sim (lado a lado) |
| cards | até 5 | até 3 | até 3, compactos (só título) |
| faixa de confiança | sim | sim | não |
| CTA | 2 linhas | 2 linhas | 2 linhas |
| fechamento | sim | não | não |
O corte é do builder (o `copy` salvo é o mesmo); o texto que não entra num aspecto também sai da checagem do §A6.
Passa pelo `scrubSlop` existente. Snapshot do prompt em teste (3 aspectos × safe/não × com/sem cards/trust/sub/referência).

## A5. Compatibilidade com planos antigos
`StaticImageSpec` vira união discriminada por `layout`:
- `layout: 'assembled'` → V2 (planos novos).
- **Item com `visual` v1 preenchido** (plano de 23-25/10 ainda `PLAN_READY`, ou retry/formato sob demanda de peça já gerada) → `layout: 'photo_headline'`, builder de 23/10 sem mudança. Não replaneja: a peça reproduz o que o Gusta viu no plano.
- **Item com `visual` vazio** (plano anterior a 23/10) → `layout: 'poster'` (pôster tipográfico, como hoje).
O backend decide o `layout` pela forma do `payload.params` (presença de `copy` / de `visual.object`); o `Render.input.spec` guarda o spec completo, então todo render continua reproduzível. Nenhuma migração: tudo mora em `variation_items.payload` e `renders.input` (JSON).

## A6. Defeito de grafia ("vólta") — checagem e mitigação
Mitigação no prompt (custo zero): `TEXT CHECKLIST` no fim; script manuscrito "with clearly separated letters, same letters and accents as written, no extra accent marks"; manuscrito ≤ 5 palavras (`handwritten`) e ≤ 9 (`closing`).
**Checagem (novo, maquina-ia):** `ClaudeService.checkStaticText({ imageUrl, expected: { key: string; text: string; critical: boolean }[], language }) → { items: { key; found: boolean; seen: string|null }[], extraText: string[] } & Usage` — visão, modelo barato (`claude-haiku-4-5`; estimativa original ~US$ 0,004; **custo real medido pela ia 25/10: ~US$ 0,0075**, porque a imagem 2k de 1440×2560 vai em 2 metades pra caber no limite de resolução da visão), `cost_entry` `LLM` no lote. Comparação no backend (pura, `compararTexto`): NFC, caixa e espaços/quebras ignorados, **acentos contam**. Críticos: marca, headline, CTA, todo texto com número ou termo de afirmação.
Fluxo (backend, `ImagemEstaticaService`, depois do `ingestFromUrl`):
1. Tudo bate → `READY`, `textCheck: { status: 'ok' }`.
2. Erro em texto **crítico** e o render ainda tem só 1 task → `assertWithinCap(staticImageUsd)` e **reenvia o mesmo prompt** (é a 2ª e última task do render; regra "≤ 2 tasks" do §14.3 é compartilhada com o reenvio por recusa). Teto estourado = segue pro passo 3.
3. Erro só em texto menor, ou 2ª imagem também errada → `READY` com `textCheck: { status: 'mismatch', items: [{ expected, seen }] }`. Das 2 imagens, fica a de **menos** erros críticos (empate: a 2ª).
4. Checagem falhou (Claude fora) → `READY` com `textCheck: { status: 'skipped' }`; não segura a peça.
Na vista (`contratos/src/iteracao.ts`): `IteratePiece.textCheck?: StaticTextCheck | null` = `{ status: 'ok'|'mismatch'|'skipped'; items: { expected: string; seen: string|null; critical: boolean }[] }` (null = vídeo ou legado). O web mostra "Texto com erro: 'vólta' (esperado 'volta')" com Retry e Leave out.
Diferente da recusa: imagem com texto errado **é cobrada** (US$ 0,22). Por isso o reenvio por texto passa pelo teto e só acontece em texto crítico (D5).

## A7. Resolução (D1) e sonda proposta (não rodada)
Medido: 1k 9:16 saiu **768×1360** na sonda reprovada e **864×1536** no experimento (o tamanho do 1k varia). No 864 de largura a linha dos cards fica no limite de leitura depois do upscale pra 1080 do Meta.
| sonda | o quê | custo |
|---|---|---|
| S1 (agora, só com ok) | prompt do `gerar.ts` igual, 9:16 **2k** high | **US$ 0,40** |
| S2 (depois da R-IA, §C) | builder novo, 3 briefings reais diferentes (agnóstico + "nada inventado" + omissão de bloco), 9:16 na resolução escolhida, com checagem de texto | 3 × 0,22 = **0,66** (1k) ou 3 × 0,40 = **1,20** (2k) + ~0,01 |
| S3 | 1 briefing × 4:5 e 1:1 | 0,44 (1k) ou 0,80 (2k) |
| S4 (só se D4 = sim) | `gpt-image-2/edit` com a captura da página como referência da tela | 0,23 (1k) ou 0,41 (2k) |
Total no pior caso (2k, S1-S4): **~US$ 2,81**. Mede: tamanho real em px, tempo (82 s no 1k), grafia, legibilidade do card na tela do celular. O `STATIC_IMAGE_MODEL.etaSec` passa de 60 pra **90** (1k medido 82 s); 2k a sonda mede.

## A8. Custos
| | 1k | 2k |
|---|---|---|
| imagem (text-to-image high) | 0,22 | 0,40 |
| com referência de tela (edit high, 1 imagem) | 0,23 | 0,41 |
| checagem de texto (Haiku, visão) | ~0,004 | **~0,0075** (real 25/10: 2k vai em 2 metades) |
| **por estático, caso normal** | **~0,23** | **~0,41** |
| pior caso (refação por texto crítico, 2 imagens + 2 checagens) | ~0,45 | ~0,82 |
| plano (`planAutoBatch`) | +~600 tokens de saída por STATIC (~US$ 0,01 com Opus 5.5) | idem |
`IterateConfig.staticImageUsd` = preço da imagem (+ edit quando há referência); a estimativa do botão Generate continua por imagem (a refação é exceção e passa pelo teto). `cost.imagesUsd` soma as duas imagens quando houver refação. Formato sob demanda 4:5/1:1 = 1 imagem nova cada, mesmo preço.

## A9. Testes que mudam (A)
- `api/src/integracoes/auto-plano.spec.ts`, `fake-auto-plan.ts`, `mock/fake-claude.*`: STATIC V2 com `copy`/`visual` v2; fake determinístico **omite** blocos quando o Brain do fixture não tem o dado.
- `prompts-midia` (snapshot): matriz do §A4 + legado `photo_headline` e `poster` intactos.
- `regras.spec.ts`: `invented_claim` (pt/en/es; "7 dias grátis" sem trial no Brain = violação; com "teste grátis de 7 dias" = ok), `unsupported_source`, contagens, soma ≤ 420, reparo que apaga bloco opcional, headline sem fonte tira a peça.
- `paletaDoEstatico` (cadeia de fallback e contraste), `blocosPorAspecto`, `compararTexto` ("vólta" ≠ "volta"; quebra de linha e caixa ignoradas).
- `ImagemEstaticaService`: text-check ok / mismatch crítico → 2ª task → escolhe a melhor / mismatch menor → entrega com aviso / teto estourado → não refaz / Claude fora → `skipped`; recusa + texto dividem o limite de 2 tasks.
- Mock: gatilhos `[mock:static-text-mismatch]` (1ª imagem com erro crítico, 2ª ok) e `[mock:static-text-mismatch-all]` (as duas erradas → `mismatch`).
- Web (MSW): `textCheck` na peça; QA: casos do §14.8 continuam + os acima.

---

# PARTE B — Molduras de vídeo (pack DVN)

## B1. Onde entra no produto
| lugar | como | quando |
|---|---|---|
| **Variação AUTO** | tipo novo `FRAME` (eixo `DIVERSITY`): o vídeo do campeão (inteiro, com o áudio dele) dentro de uma moldura escolhida pelo Claude entre as permitidas; uma variável por peça = a moldura | **B1 (primeiro)** |
| Criativo do zero (Edição) | as mesmas molduras aparecem como templates (`kind: 'frame'`) ao lado de Clean/Bold/Headline; textos sugeridos a partir do roteiro e do briefing, editáveis num formulário | logo depois do AUTO (D8) |
| Editor (`editor-v1`) | fora da v1: criativo com moldura responde `editorAvailable: false`, reason novo `frame_editor_not_enabled`; os textos da moldura se editam no formulário da Edição e re-renderizam (grátis) | D8 |
Por que o AUTO primeiro: já existe vídeo bom (o campeão), o texto sai do mesmo plano que já roda, custo de geração zero e cada moldura vira um teste de "público novo" no lote.

## B2. Modelo e tipos
**Banco (aplicado 25/10, migração `20261025000100_molduras_brand_color`):** `enum AutoVariationType { … FRAME }` + `workspaces.brand_color` (D3). Mais nada: os textos moram em `variation_items.payload` e `renders.input`.
**Catálogo (§6.1 do variacao-auto):** `FRAME` · código EN `FRAME-<ID>` / PT `MOLDURA-<ID-PT>` (ex.: `FRAME-NEWS` / `MOLDURA-NOTICIA`) · DIVERSITY · entra quando há ao menos 1 moldura permitida pelo contexto · máx. **2 por lote, de templates diferentes** (D10) · conta nos 40 % de diversidade. **Revisão 25/10 (Gusta):** máx. **8 por lote, de templates diferentes** (D10 revista), e as 6 de 2 fontes entram no AUTO (B2 liberado, fora só no caso 3 `no_face`). O catálogo novo do AUTO está em `variacao-auto-v1.md` §6.1 (revisão 25/10).
**Templates** = os 18 do protótipo, ids **iguais** ao `MOLDURA_IDS` de `video/src/prototipos/molduras/tipos.ts`. Fonte da verdade do tipo: `FrameTemplateId` e `FrameTexts` em `contratos/src/iteracao.ts` (o `video/` não importa `@maquina/contratos`; o `api/src/render/frame.ts` tem um teste de tipo que prova `MolduraId` do video ≡ `FrameTemplateId`). Nomes da interface por i18n.
- **B1, 1 fonte (12):** `question_box` (Caixinha), `meme`, `cinema`, `news` (Notícia), `ranking`, `post_card` (Tweet), `direct_offer` (Oferta direta), `story`, `read_caption` (Leia a legenda), `pov_testimonial` (POV + depoimento), `live`, `call` (Google Meet: a "apresentação" é um slide desenhado com os textos, sem 2ª mídia, igual ao protótipo). `question_box` e `live` usam o rosto recortado do campeão (`faceAtSec`, custo zero).
- **B2, 2 fontes (6, `FrameTwoSourceId`):** `split_stack` (Tela dividida), `split_torn` (Tela dividida 2), `call_dialog` (Meet diálogo), `gossip_page` (Choquei), `gossip_white` (Fofoca 1), `gossip_pink` (Fofoca 2). §B3.
- Destaque nos textos: trecho entre `*asteriscos*` sai na cor/peso de destaque do template (como no protótipo); no máx. 1 por texto; os asteriscos não contam no limite. `news.headline` usa `{ lead, highlight }`.

**Saída do plano (ia):** `{ type: 'FRAME'; template: FrameTemplateId; texts: FrameTexts }`, união por template:
| template | campos (idioma da tela) e limites | de onde vem | permitido quando (backend, `allowedFrames`) |
|---|---|---|---|
| `question_box` | `question` ≤ 70 | gancho falado (transcrição) ou `pains` | sempre |
| `meme` | `pov` ≤ 70 (o prefixo "POV:" é do template, por idioma); `cta` ≤ 28 | `pains`/transcrição; `cta` = `offer.cta` ou genérico sem promessa | sempre |
| `cinema` | `question` ≤ 60; `subtitle` ≤ 80 | gancho / `promise` | sempre |
| `news` | `topic` ≤ 18; `headline: { lead ≤ 40; highlight ≤ 30 }`; `dek` ≤ 80; `cta` ≤ 28 | `topic` de `offer.kind`/`workspace.industry` (dado, não nicho embutido); manchete de `promise`/`proof` | sempre; "especialista/estudo/médico" na manchete só com `proof` que diga isso (`invented_claim`) |
| `read_caption` | `headline` ≤ 70; `primaryText` ≤ 600 (sugestão do texto do anúncio que paga a curiosidade) | `promise`/`proof`/transcrição | sempre; o `primaryText` vira o padrão do `MetaPublishDefaults.primaryText` dessa peça (D14) |
| `pov_testimonial` | `pov` ≤ 80; `cta` ≤ 28 | `proof`/transcrição | teardown com bloco de prova **ou** `offer.proof` não nulo |
| `direct_offer` | `promise` ≤ 40; `price: { from: string\|null; to: string }`; `cta` ≤ 28 | `promise`; **preço literal do `offerAndPrice`** | `offerAndPrice` tem número com moeda (§B5) |
| `live` | — (o `@` é do backend: `workspace.name` normalizado, como o `handle` do STORY) | — | sempre |
| `ranking` | `title` ≤ 24; `items` 3-5 × ≤ 28 (o "TOP N" é do template, N = nº de itens) | cada item com `source: BriefField` (`pains`/`what`/`promise`/`proof`) | Brain com ≥ 3 itens possíveis (a IA decide; validação cobra a fonte) |
| `post_card` | `copy` ≤ 140 | gancho/`promise` | sempre; nome = `offer.name` (backend), avatar = iniciais (sem foto), **sem selo de verificado**, tempo = "2h" fixo do template |
| `story` | `question` ≤ 70; `headline` ≤ 40; `support` ≤ 80; `copy` ≤ 320 | `question` = gancho/`pains`; `headline`/`support` = `promise`; `copy` = `what`/`promise`/`proof` | sempre ("Faça uma pergunta" é texto do template) |
| `call` | `title` ≤ 40; `slideTitle` ≤ 50; `slideSteps` 3 × ≤ 32 | `title` = `offer.name`/`what`; cada step com fonte (`what`/`promise`) | Brain com ≥ 3 partes/passos do produto (a IA decide; validação cobra a fonte de cada step); rótulo da pessoa = "Convidado" do template (D9) |
| B2 | ver §B3 | | |
Regras gerais (validação no `regras.ts`, como o STATIC): `invented_number` + `invented_claim` em todo texto; `unsupported_source` no ranking; limites; `duplicateKey` = `FRAME:<template>`. Textos fixos de interface ("Faça uma pergunta", "Leia a legenda", "Toque no botão", "AO VIVO", "comentários limitados") são **constantes do template por idioma** (pt, en, es; outro idioma = en), não saem da IA.

**Revisão do render (decisões do Gusta no teste ao vivo, 25/10; implementadas em `video/src/lib/molduras.ts`), vale por cima do que está abaixo:**
- **`contentBox`:** só a área do vídeo real do campeão entra na caixa: sem as faixas pretas de letterbox nem a headline queimada nelas (`contentBoxDe(source, editMap)`; prop opcional `video.contentBox`, px do arquivo).
- **Zoom em vez de `contain_blur`:** nada de borda borrada. O vídeo **preenche** a caixa (cover da `contentBox`) com o rosto a 40 % da altura, com o maior zoom que não corta o rosto. Se nem assim o rosto cabe, `scale` < 1 e sobra **fundo sólido na cor da marca**. Sem faceTrack: cover com foco (0,5; 0,4). O `contain_blur` sai das molduras (fica no `AutoEdit`).
- **`burnedTextBands`:** faixas de texto queimado do campeão dentro da `contentBox` (das camadas do `editMap`). O `frameLayout` não põe texto da moldura em cima delas.
- **Textos fixos de interface** ("Faça uma pergunta", "AO VIVO", "Toque no botão"…) em pt, en, es, **zh (simplificado e tradicional por região: -TW/-HK/-MO/Hant), ja e ko**; qualquer outro idioma = en. Continuam constantes do template, nunca da IA.

**Render (maquina-video):** composição nova `Moldura` (não mexe no `AutoEdit`) e membro novo de `RenderInput`:
```ts
interface FrameRenderInput {
  kind: 'frame'; renderId: string; templateId: 'frame';
  format: VideoFormat; language: string;
  frame: { id: FrameTemplateId; texts: FrameTexts[FrameTemplateId]; brand: FrameBrand };   // FrameBrand = { name, handle, initials, color } (= MarcaMoldura do protótipo)
  face: { atSec: number } | null;                                                       // foto redonda (frame do campeão)
  video: { source: AutoEditRenderInput['source']; timeline: { startSec: number; endSec: number }[]; joinFadeMs: 40;
           reframe: { mode: 'cover'; focus: { x: number; y: number } } | { mode: 'contain_blur' } };
  second?: FrameSecondSource;     // só B2 (§B3); stock_broll já vem como fileUrl do nosso storage
  safeArea: { top: number; bottom: number };
}
```
- O backend entrega um `FrameSpec` (`api/src/integracoes/contrato.ts`) no `payload.params`; o `buildFrameInput(spec, champion, format)` (`api/src/render/frame.ts`) o converte no `FrameRenderInput`.
- `frameLayout(id, format) → { videoBox: Rect; slots: Record<string, Rect>; bg: … }` é **função pura** do video (`video/src/lib/molduras.ts`), usada pela composição e pelo `buildFrameInput` (`api/src/render/frame.ts`, como o `auto-edit.ts`). O `reframeFor` existente passa a aceitar a caixa do vídeo como alvo (o aspecto da caixa, não do canvas).
- Duração = soma do `timeline` (padrão: campeão inteiro); áudio = o do campeão; moldura presente o vídeo todo, entrada de 0,4 s.
- Interfaces de terceiros genéricas: sem logo, sem nome de app, sem cor-marca de Instagram/Meet/X; **ícones em SVG próprios** em vez de emoji (render determinístico, sem depender de fonte de emoji) (D12).
- Texto queimado do campeão: a caixa do vídeo usa `cover` no rosto quando as camadas do `editMap` ficam fora da janela; senão `contain_blur` (mesma regra do §7.2).
- Ajuste de texto: `fitText` com tamanho mínimo de **36 px** na saída de 1080; não coube = falha de validação no `buildFrameInput` (erro `FRAME_TEXT_OVERFLOW`, peça `failed` com `retryHint: 'leave_out'`) — a IA já recebe os limites, então é exceção.

### B2.1 Rev. 25/10 (teste live do Gusta, lote `cmvnlm4yd000l22emdoob1j5a`): recorte, enquadramento e texto queimado
Decisões do Gusta: (1) a moldura usa SÓ a área do vídeo real do campeão (sem letterbox nem a headline queimada nas faixas pretas); (2) nada de borda borrada; (3) o texto da moldura não fica em cima da legenda queimada do campeão; (4) textos fixos também em zh/ja/ko; (5) b-roll (`stock_broll`) com o mesmo cover e zoom.
```ts
// FrameRenderInput.video (= MolduraProps.video do @maquina/video), campos novos, opcionais (ausentes = como antes):
video: {
  …;
  reframe: { mode: 'cover'; focus: { x; y }; scale?: number }   // focus = 0-1 da contentBox; scale ≤ 1 só no caso extremo
         | { mode: 'contain_blur'; focus? };                     // LEGADO: desenhado como o vídeo inteiro sobre a cor da marca (sem blur)
  contentBox?: { x; y; w; h } | null;                            // px do arquivo do campeão: área do vídeo real
  burnedTextBands?: { y; h; startSec; endSec }[];                // px do arquivo: texto queimado DENTRO da contentBox
}
second: … | { kind: 'stock_broll'; fileUrl; durationSec?; width?; height? }   // com medidas: cover + push-in iguais ao campeão
```
- **De onde vêm:** `buildFrameInput` (`api/src/render/frame.ts`) calcula a partir do `editMap`: `contentBoxDe` = `mainSpeaker.box` (ou a maior célula de `cells`); quadro inteiro = ausente. `faixasQueimadasDe` = `layers` que caem dentro da contentBox (a headline nas faixas pretas sai com o recorte). Funções puras do `@maquina/video`; o backend pode chamá-las se montar o input por fora.
- **Enquadramento (`reframeNaCaixa`):** sempre cover da contentBox, rosto do `faceTrack` a 40 % da altura. Zoom máximo = o rosto (aparando no máx. 4 % em cima/embaixo) cabe na caixa; só abaixo de 85 % do cover (caso extremo) o vídeo fica menor que a caixa e o resto é **fundo sólido `brand.color`**. Nunca borrado.
- **Texto × legenda queimada (`layoutDaPeca` = `frameLayout` + `faixasNaSaida`):** nas molduras de vídeo cheio, Caixinha desce o cartão pra baixo da faixa ou, sem espaço, o cartão (opaco) passa a cobri-la; Leia a legenda leva a manchete pra baixo da faixa (reajustando o tamanho) ou pra cima; Story reordena verde → texto (opacos, cobrindo a faixa) → apoio. O `FRAME_TEXT_OVERFLOW` é medido nesse layout final.
- **Idioma da tela:** `screenLanguage` sem região (`zh`) herda a do lote (`zh-TW`): tradicional × simplificado na fonte e nos rótulos. Textos fixos: pt, en, es, zh-Hant, zh-Hans, ja, ko; outro = en.
- **CJK:** limites do §B2 são em caracteres calibrados no latino; o ideograma ocupa ~2 letras. Recomendação (pendente do arquiteto): a IA conta largura cheia como 2 em zh/ja/ko; com o limite latino cheio, os textos longos dão `FRAME_TEXT_OVERFLOW`.

## B3. Fase 2 (2 fontes): de onde vem a 2ª mídia
```ts
type FrameSecondSource =                                              // escrito em api/src/integracoes/contrato.ts
  | { kind: 'champion_segment'; startSec: number; endSec: number }  // outro trecho do próprio campeão (b-roll/prova), em loop se curto
  | { kind: 'page_capture'; fileUrl: string; scroll: boolean }       // captura da página (já existe, SPLIT_LP)
  | { kind: 'product_photo'; fileUrl: string }                        // Offer.productImageFileId
  | { kind: 'stock_broll'; fileUrl: string; provenance: BrollProvenance } // §B3.1 (adendo 25/10)
  | { kind: 'generated_image'; fileUrl: string; prompt: string; model: string; subject: string }; // §B3.1 item 8 (25/10): reserva
// o rosto redondo (Choquei/Fofoca/Caixinha/Live) não é 2ª fonte: é `FrameSpec.faceAtSec` (frame do campeão no faceTrack)
```
Quem vai em cada painel depende do caso do campeão (§B3.2); a tabela abaixo é o caso 2 (o mais comum) e a coluna "casos" diz onde o template é oferecido.
| template | 1ª | 2ª | observação |
|---|---|---|---|
| `split_stack`, `split_torn` (casos 1, 2, 3) | campeão (gancho→fim) | `champion_segment` de prova, `page_capture` **ou** `stock_broll` | faixa com `headline` ≤ 50 na emenda |
| `gossip_page`, `gossip_white`, `gossip_pink` (casos 1 e 2; **nunca no 3**, dependem de rosto) | campeão (lado esquerdo) | `champion_segment` **ou** `stock_broll` (lado direito) + rosto (`faceAtSec`) | `headline` ≤ 80 (`gossip_page` + `pageName` ≤ 24, nome genérico de página, nunca veículo real); sem selo de verificado real |
| `call_dialog` (casos 1 e 2; no 3 não, os 2 quadros são pessoas) | campeão (quadro de cima, com o áudio) | **outro trecho do mesmo campeão** (`champion_segment`, quadro de baixo, mudo) **ou** `stock_broll` (§B3.1, D16) | **D11 revertida 25/10:** entra no AUTO igual ao protótipo, sem rosto gerado, custo zero. `title` ≤ 40; `names` = 2 rótulos de papel ≤ 14 ("Você", e o 2º só com dado do Brain, ex. "Fisio" se `proof`/`what` falar disso; senão "Convidado"), nunca nome de pessoa. O backend escolhe um trecho com rosto no `faceTrack`, ≥ 3 s, fora da janela que está tocando em cima |
Tudo do B2 custa zero de geração (o b-roll custa só a seleção, §B3.1). O backend escolhe o `champion_segment` pelo teardown (bloco de prova, ≥ 3 s, fora do gancho) e manda pro Claude como opção em `allowedFrames`. (`call` saiu desta tabela: no protótipo ele é 1 fonte, B1.)

### B3.1 2ª fonte por b-roll do get-brolls (adendo do Gusta, 25/10)
**Decisão explícita do Gusta, depois do aviso do coordenador sobre o risco de licença em anúncio pago de cliente:** a 2ª fonte das molduras de 2 fontes (`split_stack`, `split_torn`, `gossip_page`, `gossip_white`, `gossip_pink` e o Meet, aqui lido como `call_dialog`, D16) pode ser um **b-roll buscado pelo pipeline da skill get-brolls** (`.claude/skills/get-brolls/`, CLI `gb.py`, v2.3.7), com **todas** as fontes da skill: YouTube, Instagram, TikTok e stock (Pexels, Pixabay, Wikimedia Commons, NASA). `stock_broll` é mais uma opção de `FrameSecondSource`; `champion_segment` continua sendo o padrão quando não há b-roll bom (risco zero).
1. **Busca a partir da fala.** A 2ª fonte toca o vídeo todo. O backend quebra a fala do campeão pelos blocos do teardown (até 3: gancho, prova, CTA) e, pra cada bloco, a ia gera 1-2 queries (`BrollPort.search`, idioma da fala + entidades do Brain; nada de nicho embutido). Regra da skill mantida: **literal primeiro** (a fala cita pessoa/produto/fato → YouTube/TikTok); beat genérico → stock. 1 clipe por bloco, cortado no tempo do bloco; faltou clipe num bloco = repete o anterior; nenhum clipe = `champion_segment`.
2. **Seleção sem storyboard humano.** O `review.html`/`import-review` da skill **não** entra no produto. No lugar: `gb.py preview` gera o contact sheet de cada candidato; a ia escolhe com visão (Haiku, contact sheet + fala do bloco) e grava o motivo; o **usuário troca o clipe na peça** (`GET /iterate/pieces/:pieceId/broll/candidates`, `POST /iterate/pieces/:pieceId/broll { candidateId? | url? }`, re-render grátis). Essa troca é a revisão humana.
3. **Proveniência por peça:** `BrollProvenance { provider, sourceUrl, creator, license, licenseCommercialOk, startSec, endSec }` em `variation_items.payload` e `renders.input`, mostrada na peça (`IteratePiece.frame.second.provenance`) e no README do zip (1 linha por arquivo: fonte, autor, licença, link, intervalo). `license` = o que a fonte declara (Pexels License, Pixabay Content License, CC do Commons por arquivo, NASA "geralmente sem copyright, verificar"); YouTube/Instagram/TikTok = "licença da plataforma, sem permissão comercial" e `licenseCommercialOk: false`. **Nunca inventar licença**; desconhecida = `null` e nunca vira domínio público (regra da skill). O `permit` da skill é gravado com a licença lida da fonte (stock) ou com o aceite do workspace (redes, D15).
4. **Onde roda (servidor, imagem Docker da API no EasyPanel):** Python 3.12 + venv da skill + yt-dlp (+ runtime EJS) + ffmpeg/ffprobe (já existe pelo Remotion), chamados por `child_process` a partir de `api/src/integracoes/broll/` (porta `BrollPort`), com pasta de projeto temporária por lote no `/data`.
   | fonte | v1 headless | depois |
   |---|---|---|
   | Pexels, Pixabay | busca + baixa por API | — |
   | Wikimedia Commons, NASA | busca + baixa por API pública | — |
   | YouTube | `ytsearch` + intervalo via yt-dlp, sem chave. **Risco:** IP de datacenter costuma tomar "confirme que não é um robô"; precisa de sonda na VPS (S-BR1) e, se bloquear, cookies de uma conta própria ou proxy (decisão do Gusta, custo a medir) | — |
   | TikTok | só **URL colada** pelo usuário na troca (`resolve --url`, yt-dlp); a skill não tem busca por palavra | busca pelo navegador headless |
   | Instagram | **fora da v1**: a rota da skill depende de navegador logado (Playwright + sessão do usuário) e captura de streams; não roda headless no servidor sem sessão | Playwright com conta de serviço própria, contrato próprio |
5. **Custos e chaves.** Pexels e Pixabay: chave gratuita (`PEXELS_API_KEY`, `PIXABAY_API_KEY` no `.env` da API; limites de requisição da conta gratuita, conferir na página de cada API antes do uso real). Commons, NASA, YouTube, TikTok: sem chave. Seleção por visão: ~US$ 0,004 por contact sheet × até ~6 candidatos por peça ≈ **US$ 0,01-0,03 por peça** (`cost_entry` `LLM` no lote; entra no `generateEstimateUsd`). Banda e storage: desprezíveis. Proxy/cookies do YouTube: só se a S-BR1 mostrar bloqueio (custo não medido, suposição).
6. **Erros:** clipe sumiu/baixa falhou no render = peça `failed` `BROLL_UNAVAILABLE`, Retry troca pelo próximo candidato; URL colada de fonte fora da v1 = 422 `BROLL_SOURCE_NOT_SUPPORTED`. Mock: `[mock:broll-none]` (sem candidato → `champion_segment`), `[mock:broll-fail]` (1º render falha `BROLL_UNAVAILABLE`, retry passa); o fake devolve fixtures locais com proveniência de exemplo.
7. **Fase:** B2. Nada disso bloqueia o B1. Tipos já escritos (`BrollPort`, `BrollProvenance`, `PieceFrame`, `SwapBrollBody`, `BrollCandidatesResponse`).
8. **Revisão 25/10 (decisão do Gusta, implementada pela ia em `api/src/integracoes/broll/`), vale por cima dos itens 1, 4 e 5:**
   - **Ordem da 2ª fonte:** **Pexels** (`stock_broll`, padrão) → **imagem gerada** (`generated_image`, reserva: GPT Image 2 high 1k, ~US$ 0,22, do `subject` que a ia devolve quando nenhum candidato serve) → **trecho do campeão** (`champion_segment`, por último). YouTube, TikTok e Instagram ficam **desligados por workspace** (D15): a busca só usa o que o workspace liga, e URL colada de fonte desligada = 422 `BROLL_SOURCE_NOT_SUPPORTED`.
   - **Tipos (`api/src/integracoes/contrato.ts`):** `BrollSearchInput` + `offer?` (nome, tipo, o quê, público: tom e entidades das queries) e `notes?` (gatilhos do mock); `BrollCandidateDraft` + `chosen?`/`reason?` (escolha da visão; TRANSIÇÃO opcional até a ia trocar o `pick` local `BrollCandidatePick`); `BrollPort.fallbackImage?` (a reserva; grava `cost_entry` `IMAGE` no lote; sem WaveSpeed = `NOT_CONFIGURED` e o backend cai pro `champion_segment`); `FrameSecondKind`/`FrameSecondSource` + `generated_image` (`PieceFrame.second.provenance = null`; o README do zip escreve "imagem gerada", com o modelo).
   - **Erros:** `BROLL_NO_MATCH` (nenhum candidato serve) e `BROLL_UNAVAILABLE` da porta são **internos** (`IntegracaoErrorCode`; o backend troca de fonte e o usuário não vê). O usuário vê dois: `BROLL_UNAVAILABLE` como erro da peça (`IterateAsyncErrorCode`, já existia: clipe sumiu no render, Retry pega o próximo) e `BROLL_SOURCE_NOT_SUPPORTED` como 422 síncrono (`ApiErrorCode` + `ERROR_HTTP_STATUS` + `DEFAULT_ERROR_MESSAGE`, 25/10). O web precisa do texto i18n desse 422.
   - **Custo:** seleção ~US$ 0,016 por peça (Haiku 4.5, buscas + escolha); com a reserva de imagem, + US$ 0,22.
9. **Trilha de b-roll por fala (decisão do Gusta 25/10, vale por cima do item 1 e do "1 clipe pro vídeo todo"):** a 2ª fonte vira `{ kind: 'broll_track'; clips: BrollTrackClip[] }`, com vários clipes que trocam conforme a fala. O `stock_broll` fica **só pra compatibilidade** (peças antigas).
   - **Trechos:** a fala do campeão é cortada em trechos de **2-5 s**, sempre nas pausas e no fim das frases (`silences` + palavras da transcrição). Cada trecho vira um `BrollSegment { startSec, endSec, text }`.
   - **1 busca por lote:** `BrollPort.searchTrack({ workspaceId, batchId, segments, offer?, language, notes? })` roda **uma vez por lote**, e o resultado serve pra todas as molduras de 2 fontes do lote. `picks[i]` responde `segments[i]`: `BrollPick { candidateId, fileUrl, srcStartSec, srcEndSec, provenance, reason }` ou `{ none: true, fallbackSubject }`.
   - **Montagem (backend):** `clips` cobre a duração toda da peça, em ordem, sem buraco nem sobreposição (`fromSec`/`toSec` na linha do tempo da peça), e **nunca o mesmo clipe duas vezes seguidas**. Trecho `none` = imagem gerada (`fallbackImage(fallbackSubject)`, `provenance: GeneratedProvenance { provider: 'generated', model, prompt, subject }`). Se o teto barrar a imagem, o clipe vizinho é estendido sobre o trecho.
   - **Render (video):** cada clipe toca mudo `srcStartSec`→`srcEndSec` dentro do `fromSec`→`toSec`, no painel da 2ª fonte. Imagem gerada = still com o mesmo enquadramento.
   - **Proveniência:** **1 linha por clipe** no README do zip (fonte, autor, licença, link, intervalo de origem e de onde entra na peça; imagem gerada = "imagem gerada", com o modelo). Na vista: `PieceFrame.second.track` (`BrollTrackClipView[]`, TRANSIÇÃO opcional).
   - **Custo:** a busca e a seleção por lote (não por peça) entram uma vez no `generateEstimateUsd`. Cada imagem de reserva custa ~US$ 0,22 e passa pelo teto na hora.
   - **Troca de clipe pelo usuário** (`/broll/candidates`, `/broll`): continua valendo pro `stock_broll`. Pra `broll_track`, fica em aberto se troca por trecho ou a trilha inteira; o coordenador decide com o Gusta. Tipos: `api/src/integracoes/contrato.ts` (`BrollTrackClip`, `BrollSegment`, `BrollPick`, `BrollTrackSearchInput`, `BrollPort.searchTrack?`) e `contratos/src/iteracao.ts` (`GeneratedProvenance`, `BrollTrackClipView`, `FrameSecondKind` + `broll_track`).

### B3.2 O que vai em cada painel (adendo do Gusta, aprovado 25/10)
**25/10:** onde a tabela abaixo diz `stock_broll`, os lotes novos usam `broll_track` (§B3.1 item 9): a mesma trilha do lote em todas as molduras de 2 fontes.
**Regra geral das molduras de 2 fontes:**
- **Painel principal:** quem fala, o tempo todo (o áudio é sempre o do campeão).
- **Painel secundário:** o que a fala descreve, **trocando junto com a fala** pelos tempos da transcrição (`TranscriptWord`): cada troca acontece no limite de palavra/frase do trecho que o clipe ilustra, nunca no meio de uma palavra.
- **O mesmo clipe nunca aparece nos dois painéis no mesmo instante, nem o mesmo trecho de origem em painéis diferentes** (validação no backend: intervalos de origem do painel 2 não se sobrepõem aos do painel 1; falhou = troca pelo próximo candidato ou por `page_capture`/`product_photo`).

O backend decide o caso pelo teardown/EditMap (`timeline` com `main`/`other_person`/`broll`, `faceTrack`, `mainSpeaker`) e pela origem do criativo, e grava `panelCase: 1|2|3` no `FrameSpec` (o tipo entra na fusão do B1; até lá fica no `payload.params`). Função pura `casoDosPaineis(...)` no `iteracao`, testada.

| caso | como detecta | painel principal (grande) | painel secundário | templates |
|---|---|---|---|---|
| **1. Criativo feito no HookMill** (camadas separadas: take do avatar + cenas no Remotion) | o campeão é um `Creative` do próprio workspace com `Take` contínuo e cenas | o **take inteiro do avatar**, contínuo, com lipsync | as **cenas e b-rolls dele**, nos mesmos tempos do original; o `get-brolls` (§B3.1) só preenche os trechos **sem** cena | os 6 |
| **2. Campeão enviado (MP4 achatado) com b-roll** | upload/Library/Meta; `timeline` tem `main` e `broll` | o **vídeo original inteiro**, alternando como escalou | algo que **complementa sem repetir**: `page_capture`, `product_photo` ou b-roll novo pela fala (§B3.1); nunca um trecho do próprio campeão que já está tocando em cima | os 6 |
| **2b. Variante: pessoa em ≥ 60 % do vídeo** | soma dos spans `main` ≥ 60 % de `frameCount` e ≥ 1 span `broll` ≥ 1 s | só os **trechos com a pessoa**; nos buracos (onde o original tinha b-roll), um trecho `main` vizinho **mudo** com o áudio contínuo (o rosto aparece, mas sem lipsync naquele instante: ponto a conferir no contact sheet do B2; se ficar ruim, a variante cai pro caso 2) | os **trechos de b-roll do original descem** pra cá, nos tempos deles; no resto, o complemento do caso 2 | os 6 |
| **3. Campeão sem rosto** (b-roll com narração) | spans `main` < 15 % de `frameCount` ou `faceTrack` vazio | **inverte**: o b-roll do campeão (o vídeo original) vai no painel grande | o menor recebe `page_capture` ou `product_photo`; sem nenhum dos dois = b-roll novo pela fala | só `split_stack`, `split_torn`; `gossip_*` e `call_dialog` **não são oferecidos** (`allowedFrames` com `blockedReason: 'no_face'`) |
Entre 15 % e 60 % de pessoa = caso 2 sem a variante. **Por que 60 %:** abaixo disso, tirar o b-roll de cima deixa o painel principal com cortes demais cobrindo buracos; acima, a pessoa já carrega o vídeo e o b-roll embaixo vira o "o que ela descreve". O limiar fica numa constante (`PAINEL_PESSOA_MIN = 0.6`) pra ajustar depois do contact sheet do B2.
Nas molduras de 1 fonte (B1) nada muda: o campeão inteiro vai na caixa do vídeo. `question_box`/`live` no caso 3 não têm rosto: ficam sem a foto redonda (o template já aceita `faceAtSec: null`).

**IDEIA PARA DISCUTIR DEPOIS (não decidida, não implementar):** no caso 2, quando o roteiro é de fofoca (templates `gossip_*`), a 2ª fonte poderia ser uma **imagem gerada**, por exemplo uma pessoa com expressão de surpresa (GPT Image 2, "reação").
- **Custo estimado por peça:** 1 imagem por bloco da fala (1 a 3) × GPT Image 2 high = **US$ 0,22-0,66 em 1k** ou **0,40-1,20 em 2k** (preço da WaveSpeed lido em 25/10); mais o teto e a estimativa no Generate, como o STATIC. Animar a imagem (Kling etc.) seria outra conta, bem maior, e fica fora.
- **A discutir:** (a) consistência com o tom da oferta (reação exagerada pode destoar de oferta séria; ia decidiria pelo Brain?); (b) "nada inventado": é **ilustração, não prova**: não pode parecer depoimento nem "cliente real", sem texto na imagem, pessoa genérica; (c) se vira `FrameSecondSource kind 'generated_reaction'` (render `IMAGE_GEN` antes do Remotion, peça deixa de ter custo zero) ou se reaproveita o fluxo do STATIC; (d) quantas reações por peça e como o usuário troca.

## B4. 4:5 e 1:1
Cada template declara layout próprio nos 3 formatos em `frameLayout` (não é o 9:16 encolhido). Regras: 4:5 reduz as faixas de texto de cima/baixo e a caixa do vídeo fica ≥ 55 % da altura; 1:1 corta texto secundário (`dek`, `subtitle`, `cta` do meme) e o `ranking` mostra no máximo 3 itens (o texto salvo é o mesmo; o corte é do layout). Template que não fica bom num formato é marcado `formats` sem ele **depois** da revisão visual do Gusta; aí o `POST /iterate/pieces/:pieceId/formats` responde `409 INVALID_STATE` com `reason: 'format_not_supported'` (novo) e o web esconde o botão. Meta: os 12 do B1 (e depois os 6 do B2) nos 3 formatos (D13).

## B5. Preço da Oferta direta
- `price.to` e `price.from` têm que aparecer **literalmente** (dígitos e moeda, comparação por `numbersIn` + símbolo/código da moeda) em `offer.offerAndPrice`. `from` (preço riscado) só se o `offerAndPrice` tiver os **dois** valores; senão `from: null` e o template mostra só "Por apenas <to>".
- Sem número com moeda no `offerAndPrice` = `direct_offer` fora de `allowedFrames` (`blockedReason: 'no_price'`). Nunca vem da transcrição (fala pode citar preço antigo) nem da página capturada.
- Formatação: o template não reformata; mostra a string como está no Brain (ex.: "R$ 97,90", "$19.99").

## B6. Testes, QA e critério de pronto
- **video:** `frameLayout` puro (B1: 12 × 3 formatos; B2: 6 × 3; caixas dentro do canvas, vídeo ≥ mínimo, slots fora da `safeArea` no 9:16); schema zod; `fitText` com textos no limite em pt/en/es (acentos, palavras longas); `renderStill` de cada template × formato no fixture (contact sheet `testes/molduras/contact-sheet.png`: **36 quadros no B1**, 18 no B2, 54 no total).
- **backend:** `allowedFrames` (preço, prova, ≥ 3 itens), validação (`invented_claim` na manchete "Especialista revela" sem prova; preço que não está no Brain; `from` sem 2 valores), códigos `FRAME-*`/`MOLDURA-*`, máx. 2 e templates distintos, migração do enum.
- **ia:** schema/prompt do `FRAME` no `planAutoBatch`, fake determinístico (escolhe 2 templates pelo fixture), constantes de interface fora da IA.
- **qa (mock):** lote com `FRAME` → 2 peças renderizadas no 9:16, zip `…_FRAME-NEWS_9x16.mp4`; 4:5 e 1:1 sob demanda; oferta sem preço nunca gera `direct_offer`; `[mock:frame-fail:<id>]` → peça `failed`, retry passa.
- **Pronto (B1) =** as **12 molduras de 1 fonte** (lista do §B2): (1) contact sheet 12 × 3 aprovado pelo Gusta; (2) 1 lote real (mock de IA desligado, Remotion real) com 2 molduras renderizadas e assistidas; (3) `tsc` + testes verdes; (4) o QA declara. Mesmo critério pro B2 com os 6 templates dele (6 × 3). As 18 do Gusta = B1 + B2.

## B7. Códigos das peças FRAME (§6.1 do variacao-auto)
Regra EN: `FRAME-` + id em maiúsculas com `_` → `-`. PT: tabela fixa. Até 8 por lote, sempre de templates diferentes (D10 revista 25/10), então **sem sufixo de repetição**. Zip: `…_<código>_<formato>.mp4`.
| id | EN | PT |
|---|---|---|
| `question_box` | FRAME-QUESTION-BOX | MOLDURA-CAIXINHA |
| `gossip_page` | FRAME-GOSSIP-PAGE | MOLDURA-CHOQUEI |
| `meme` | FRAME-MEME | MOLDURA-MEME |
| `cinema` | FRAME-CINEMA | MOLDURA-CINEMA |
| `news` | FRAME-NEWS | MOLDURA-NOTICIA |
| `split_stack` | FRAME-SPLIT-STACK | MOLDURA-TELA-DIVIDIDA |
| `split_torn` | FRAME-SPLIT-TORN | MOLDURA-TELA-DIVIDIDA-2 |
| `call` | FRAME-CALL | MOLDURA-MEET |
| `call_dialog` | FRAME-CALL-DIALOG | MOLDURA-MEET-DIALOGO |
| `ranking` | FRAME-RANKING | MOLDURA-RANKING |
| `post_card` | FRAME-POST-CARD | MOLDURA-TWEET |
| `direct_offer` | FRAME-DIRECT-OFFER | MOLDURA-OFERTA-DIRETA |
| `story` | FRAME-STORY | MOLDURA-STORY |
| `read_caption` | FRAME-READ-CAPTION | MOLDURA-LEIA-A-LEGENDA |
| `pov_testimonial` | FRAME-POV-TESTIMONIAL | MOLDURA-POV-DEPOIMENTO |
| `live` | FRAME-LIVE | MOLDURA-LIVE |
| `gossip_white` | FRAME-GOSSIP-WHITE | MOLDURA-FOFOCA-1 |
| `gossip_pink` | FRAME-GOSSIP-PINK | MOLDURA-FOFOCA-2 |
(Não colide com o tipo `STORY`, cujo código é outro.)

## A10. Fechamento das lacunas do QA e do design (25/10, arquiteto)
1. **Retry numa peça `ready` com `textCheck.status = 'mismatch'`** (STATIC `assembled`): mesma rota `POST /iterate/pieces/:pieceId/retry` (corpo `{}`), que passa a aceitar também esse caso: nova imagem 9:16 (nova task no mesmo fluxo do §A6, com checagem), cobra `staticImageUsd` e passa pelo teto (409 `SPEND_CAP_EXCEEDED` com os `details` que já existem, `{ spentUsd, capUsd, estimateUsd }` (`api.md` §1, `contratos/src/index.ts`); **não** existe `usedUsd` nem `cap_reached`. O teto é o **mensal do workspace**, não do lote). Resposta `202 IteratePiece` com `status: 'rendering'`; a imagem anterior continua em `files`/`poster` até a nova ficar pronta e é trocada só se a nova tiver **menos ou igual** erros críticos (mesma regra de escolha do §A6). `ready` sem mismatch continua 409 `INVALID_STATE`. Formatos 4:5/1:1 já prontos não mudam (cada um teve a própria checagem, `PieceFormat.textCheck`).
1b. **Retry de peça a partir da tela de Download (fechado 25/10):** o lote **não volta** pra `phase: 'generate'`. Regra: todo Retry de peça (`ready` com mismatch ou `failed`) e todo formato sob demanda geram render com `priority: 10`, e o `phase` é derivado **só dos renders 9:16 de prioridade 0** (os do Gerar). Na prática: a tela de Download continua, a peça mostra o próprio estado (`status: 'rendering'`, `render.stage`/`attempt`) e o web segue fazendo polling enquanto houver qualquer peça ou formato em `queued`/`rendering`. O zip só leva peças `ready` com `inZip`; uma peça refazendo fica fora até terminar, e o `POST /iterate/:id/zip` monta com o que está pronto. Isso vale pro backend (`pecas`/`iteracao`) e pro MSW do web.
2. **Leave out / Put back numa peça `ready`:** é o "Leave out of zip" que já existe: `PATCH /iterate/pieces/:pieceId { inZip: false }` e, pra devolver, `{ inZip: true }`. Não há rota `put-back`. `POST /iterate/pieces/:pieceId/leave-out` continua só pra peça `failed` (estado `left_out`), e o "put back" dela é o Retry (que já limpa `leftOutAt`).
3. **Onde o render guarda o spec V2:** `renders.input.spec` = o spec completo como união por `layout` (`StaticImageSpecAny`): `{ layout: 'assembled', … }` nos novos; legado sem `layout` (`photo_headline`/`poster`, §A5). `specV2` existe **só** no `SubmitStaticImageInput` (porta da ia, transição) e nunca vai pro banco. O resultado da checagem fica em **`renders.input.textCheck`** (`StaticTextCheck` + `attempt`; decisão do arquiteto 25/10: não existe coluna `output`, ver `modelo-de-dados.md`, Mudanças 25/10 tarde).
4. **Vista (tipos escritos 25/10, opcionais/TRANSIÇÃO):** `StaticTextCheck.items` traz **todos os textos conferidos** daquele aspecto (não só os errados), cada um com `match: boolean`; os erros são `items.filter(i => !i.match)`, e o web pode mostrar "Todos os N textos batem" com `status: 'ok'` e `items.length = N`. `skipped` = `items` com os esperados e `match: false`, `seen: null`. `StaticTextCheck.items[].key` (bloco: `headline`, `cta.main`, `handwritten`, `benefits.1.title`…) e `StaticTextCheck.extraText` (texto que a imagem escreveu e não estava no `copy`; sempre vem na vista, o G3 decide se conta como crítico); `IteratePiece.render.stage` (`'image' | 'text_check' | 'retake'`) e `render.attempt` (1 ou 2); `PieceFormat.textCheck`.
5. **G1–G4 fechadas pelo Gusta em 25/10 ("ok pra tudo"), todas com a recomendação do design** (registro no fim da seção D):
   - **G1:** texto crítico ainda errado depois das 2 tentativas → a peça fica `ready` mas **sai do zip por padrão** (`inZip: false`); o usuário devolve com `PATCH { inZip: true }`. Erro só em texto menor fica no zip, com aviso.
   - **G2:** preço no próprio botão ("Retry · US$ 0.40", de `retryUsd`), **sem diálogo** de confirmação; o teto continua valendo no servidor.
   - **G3:** `extraText` (texto que a imagem escreveu e não estava no `copy`) **conta como erro crítico**: dispara a refação (dentro do teto) e entra no G1.
   - **G4:** CTA do 9:16 em **84–90 %** da altura (D6); a S2 confirma.

---

# C. Divisão do trabalho (ok do Gusta dado em 25/10)
Sem arquivo em comum. Tipos de transição e migração: feitos pelo arquiteto em 25/10 (§C.0).

### C.0 Feito pelo arquiteto (25/10)
- **`contratos/src/iteracao.ts`:** `FrameTemplateId` (18, = protótipo), `FrameTwoSourceId`, `FrameTexts` (= `TextosMoldura`), `FrameSecondKind`, `BrollProvider`, `BrollProvenance`, `PieceFrame`, `StaticTextCheck`, `SwapBrollBody`, `BrollCandidate(s)Response`; `AutoVariationTypeWithFrame` (alias de transição); `IteratePiece.frame?`/`textCheck?`/`suggestedPrimaryText?`; `PieceFormat.supported?`; `retryHint` + `'leave_out'`; reason `format_not_supported`; erros `FRAME_TEXT_OVERFLOW`, `BROLL_UNAVAILABLE`. **`contratos/src/index.ts`:** `Workspace.brandColor?`, `UpdateWorkspaceBody.brandColor`.
- **`api/src/integracoes/contrato.ts`:** STATIC V2 (`StaticLayout`/`StaticLayoutAny`, `StaticIcon`, `StaticEmotion`, `CopySource`, `StaticCopy`, `StaticVisualV2`, `AutoStaticDraftV2`, `StaticImageSpecV2` com `screenRefUrl`, `StaticImageSpecLegacy`/`Any`, `CheckStaticTextInput`/`Result`, `StaticTextCheckPort`); membro STATIC do `AutoParamsDraft` + `layout?`/`copy?`/`visualV2?`; `SubmitStaticImageInput.specV2?`; FRAME (`AutoFrameDraft` com `sources` por caminho de texto, `AutoParamsDraftWithFrame`, `FrameBrand`, `FrameSecondSource`, `FrameSpec`, `BrollSearchInput`, `BrollCandidateDraft`, `BrollPort`).
- **Banco:** `20261025000100_molduras_brand_color` (enum `FRAME`, `workspaces.brand_color`) em `maquina` e `maquina_test`, backup antes, `db:diff` vazio. `modelo-de-dados.md` e `api.md` atualizados.
- **Transição (por que alias e não `'FRAME'` direto no `AutoVariationType`):** pôr `FRAME` na união hoje quebra 10 pontos em pastas de 3 donos (`Record<AutoVariationType,…>` no `regras.ts` e no MSW, `switch` exaustivo no `auto-plano.ts`/`fake-auto-plan.ts`, chave i18n no `parts.tsx`). Então: cada dono escreve o código de moldura contra `AutoVariationTypeWithFrame` / `AutoParamsDraftWithFrame` (superconjunto, não quebra nada) e, **no dia da entrega B1** (ia + backend + frontend), o arquiteto funde: `'FRAME'` entra no `AutoVariationType`, `AutoFrameDraft` entra no `AutoParamsDraft`, os aliases somem, o STATIC vira `AutoStaticDraftV2` e sai o placeholder `api/src/edicao/pecas.service.ts:143` (`as AutoVariationType`, único ponto onde o enum do banco já com FRAME encontra o tipo do contrato; nenhum item FRAME existe antes do B1).

### C.1 Ordem de execução 25/10 (disparar em paralelo; cada linha só mexe nos arquivos dela)
| agente | começa agora | arquivos (só estes) | depende de | pronto quando |
|---|---|---|---|---|
| **maquina-video** (já rodando) | promover o protótipo pra produção: `video/src/lib/molduras.ts` (ids = `FrameTemplateId`, schema zod, `frameLayout` 18 × 3 formatos, `fitText` mín. 36 px), composição `Moldura`, ícones SVG, `reframeFor` com caixa, contact sheet 18 × 3. Depois (ainda dele): `api/src/render/frame.ts` (`buildFrameInput(FrameSpec, …)` + teste de tipo `MolduraId ≡ FrameTemplateId`) e o membro `kind 'frame'` do `RenderInput` | `video/**`; depois `api/src/render/frame.ts`, `api/src/render/contrato.ts`, `api/src/render/index.ts` | nada (tipos já escritos) | `tsc`, stills 18 × 3, render real de 1 template × 3 formatos; contact sheet pro Gusta |
| **maquina-ia** | **A-I** inteiro (§A2/§A4/§A6, `STATIC_IMAGE_MODEL` 2k = US$ 0,40, edit 0,41, `etaSec` 90; `checkStaticText`; fakes e gatilhos) e em seguida **B1-I** (FRAME no schema/prompt do `planAutoBatch` pros 18 templates, `sources` por texto, constantes de interface fora da IA, fake que escolhe 2 templates). B3.1 (`api/src/integracoes/broll/`) só depois do B1 | `api/src/integracoes/**` (no `contrato.ts` só liga `extends`; tipo novo = pedir ao arquiteto) | nada | spec + snapshot; **nenhuma chamada paga** (sondas S2-S4 só com ok do Gusta) |
| **maquina-backend** | **A-B** inteiro (§A3 validação V2 + `afirmacoes.ts`, `paletaDoEstatico`, spec por `layout`, `ImagemEstaticaService` com checagem/refação/teto, `textCheck` na vista, `brandColor` no DTO e na vista do `/workspace`) e em seguida **B1-B** (`allowedFrames`, validação §B2/§B5, códigos `FRAME-*`/`MOLDURA-*`, máx. 2 de templates distintos, `Record<AutoVariationTypeWithFrame,…>` no `regras.ts`, fila `kind 'frame'`, `supported`/`format_not_supported`, `suggestedPrimaryText` no Meta publish e README do zip, `[mock:frame-fail:<id>]`) | `api/src/iteracao/`, `api/src/edicao/`, `api/src/workspaces/`, `api/src/meta/` (só o padrão do primaryText) | A-I fake (ou stub local no spec); B1-B usa o `buildFrameInput` do video (stub até chegar) | unit + int em mock (§A9, §B6); unit sem regressão (hoje 1150/1150) |
| **maquina-frontend** | **A-F** (aviso `textCheck` com Retry/Leave out; campo "Cor da marca" no onboarding e em Settings; MSW) e **B1-F** (rótulo/ícone das 18 molduras EN/PT, chave i18n `FRAME`, `frame` na peça, botão de formato some com `supported: false`, `retryHint 'leave_out'`, MSW com peças FRAME usando os stills do protótipo) | `web/**` | nada (tipos e MSW) | `tsc`, desktop e 390 px, EN/PT |
| **maquina-qa** | preparar os casos §A9 e §B6 em mock (escrever agora, rodar quando as entregas chegarem) | `testes/**` | ia, backend, frontend, video | só o qa declara "funciona" |
| **maquina-design** | **A-D** só (spec visual do estático montado nos 3 aspectos, emoção → expressão, 24 ícones em palavras, estados do `textCheck`). B1-D e B2-D: **cumpridos pelo protótipo**, nada a fazer | `design/**` | nada | Gusta aprova |
| **arquiteto** | revisão de cada entrega contra este contrato; fusão do B1 (§C.0); imagem Docker com Python/yt-dlp pro B3.1 e sonda S-BR1 (YouTube na VPS) **só com ok** | `docs/`, `contratos/`, `api/prisma/`, Dockerfile da api | entregas B1 | typecheck da raiz verde depois da fusão |
Colisões evitadas: `api/src/render/**` é só do video; `regras.ts` só do backend; `contrato.ts` da integracoes só a ia liga `extends` (tipo novo passa pelo arquiteto); `web/` só do frontend. B2 (6 templates + B3.1) entra depois do B1 no ar, mesma divisão.

### Fase A
| # | dono | tarefa | pastas | depende de | verificação |
|---|---|---|---|---|---|
| A-D | maquina-design | spec visual do anúncio montado nos 3 aspectos (grade, hierarquia, o que some quando falta bloco, variante sem cards/sem trust/sem pessoa), tabela emoção → expressão, desenho dos 24 ícones em palavras; estados `textCheck` na peça | `design/` | — | Gusta aprova |
| A-I | maquina-ia | schema/prompt V2 no `planAutoBatch`; `buildStaticImagePrompt` V2 + `blocosPorAspecto` + `safe` + legado intacto; `submitStaticImage` com `edit` quando há referência (D4); `checkStaticText` (Haiku visão) + custo; fakes (V2, omissão de bloco, gatilhos de texto); `STATIC_IMAGE_MODEL` (resolução D1, `etaSec` 90, preço edit); sondas S1-S4 **só com ok** | `api/src/integracoes/` | contrato | spec + snapshot; nenhuma chamada paga sem ok |
| A-B | maquina-backend | validação V2 (`invented_claim` + `afirmacoes.ts`, `unsupported_source`, contagens, reparo que apaga bloco); `paletaDoEstatico`; `StaticImageSpec` por `layout` (assembled/photo_headline/poster); referência de tela (captura/foto) no spec; `ImagemEstaticaService` com checagem de texto, escolha da melhor imagem, teto na refação; `textCheck` na vista; `Workspace.brandColor` no PATCH (se D3) | `api/src/iteracao/`, `api/src/edicao/`, `api/src/workspace*` | A-I (fake) ou stub local | unit + int em mock (§A9) |
| A-F | maquina-frontend | aviso `textCheck` na peça (texto esperado × visto, Retry/Leave out); preview do STATIC sem mudança; campo "Cor da marca" no onboarding/config (se D3); MSW; EN/PT | `web/` | A-D, contrato | `tsc`, desktop e 390 px |
| A-Q | maquina-qa | §A9 em mock + revisão visual das sondas S2/S3 contra a tabela "nada inventado" | `testes/` | A-I, A-B, A-F | só o qa declara |
| arq. | maquina-arquiteto | ✅ 25/10: migração `Workspace.brandColor` + enum `FRAME` (`20261025000100_molduras_brand_color`), tipos de transição (§C.0); falta: revisão das entregas e fusão do B1 | `api/prisma/`, `docs/`, `contratos/` | ok | `db:backup` antes (feito) |

### Fase B1 (depois do A no ar)
| # | dono | tarefa | pastas | depende de | verificação |
|---|---|---|---|---|---|
| B1-D | maquina-design | ~~layout dos templates~~ **cumprido pelo protótipo aprovado 25/10** (`video/src/prototipos/molduras/`); textos fixos por idioma e 4:5/1:1 ficam com o B1-V | — | — | feito |
| B1-V | maquina-video | `molduras.ts` (`frameLayout`, schema, `fitText`), composição `Moldura`, ícones SVG, `reframeFor` com caixa, `buildFrameInput` (`api/src/render/frame.ts`), `RenderInput` `kind 'frame'`, contact sheet | `video/`, `api/src/render/` | B1-D | `tsc`, stills, render real de 1 template × 3 formatos |
| B1-I | maquina-ia | `FRAME` no schema/prompt do plano (template + textos + fontes), fake | `api/src/integracoes/` | contrato | spec |
| B1-B | maquina-backend | `allowedFrames`, validação (§B2/§B5), códigos, máx. 2, fila (`kind 'frame'`), `format_not_supported`, `primaryText` da `read_caption` no padrão do Meta publish e no README do zip, mock `[mock:frame-fail:<id>]` | `api/src/iteracao/`, `api/src/edicao/`, `api/src/meta/` (só o padrão) | B1-I fake, B1-V tipos | unit + int |
| B1-F | maquina-frontend | rótulo/ícone da peça `FRAME` (nome do template), botão de formato escondido em `format_not_supported`, MSW | `web/` | B1-D | `tsc`, EN/PT |
| B1-Q | maquina-qa | §B6 | `testes/` | todos | só o qa declara |
| B1.2 | video + backend + frontend + ia | molduras no criativo do zero (Edição, `kind 'frame'`, formulário de textos, `frameTexts` sugeridos pelo Claude, `editorAvailable: false`) — contrato curto próprio depois do B1 | idem | B1 pronto, D8 | idem |

### Fase B2
Mesma divisão do B1 para os 6 templates de 2 fontes (`FrameSecondSource`, escolha do `champion_segment` pelo backend, rosto pelo `faceTrack`, b-roll do §B3.1). **B2-D cumprido pelo protótipo.** `call_dialog` entra (D11 revertida). B3.1: ia (`api/src/integracoes/broll/`), backend (escolha por bloco, rotas de troca, proveniência no zip), frontend (proveniência e troca de clipe na peça, selo de licença), arquiteto (Docker + sonda S-BR1).
Paralelo: em cada fase, design primeiro; depois ia ‖ backend ‖ video ‖ frontend; qa por último.

---

# D. Decisões (D1–D16 fechadas em 25/10)
- **D1 — Resolução do estático.** ✅ **Fechada 25/10: 2k.** S1 rodada (prediction `36caeeb5…`, 85 s, 1440×2560, `sondas/out/estatico-layout-2026-10-25/layout-1792905520012.png`): texto dos cards nítido e o "vólta" do 1k saiu certo. Proposta original: 1k (US$ 0,22, 768-864 px de largura, texto pequeno no limite) ou 2k (US$ 0,40). **Recomendo rodar a S1 (US$ 0,40) e adotar 2k se o texto dos cards ficar visivelmente mais limpo**: +US$ 0,18 por peça é pouco perto do gasto de mídia que ela vai testar.
- **D2 — Logo.** Não existe logo no cadastro. ✅ Fechada 25/10. **Recomendo só wordmark (nome da oferta em tipografia), sem ícone**: desenhar um ícone seria inventar a marca do cliente. Upload de logo (`Workspace.logoFileId`, entra como 2ª referência no `edit`, +US$ 0,012) fica pra depois.
- **D3 — Cor da marca.** ✅ Fechada 25/10 (recomendação). **Recomendo campo novo opcional `Workspace.brandColor` (hex)**, migração aditiva, editável no onboarding/config, com a cadeia de fallback do §A3.3. Sem ele a paleta sai da página ou do campeão, que nem sempre é a marca.
- **D4 — Tela do produto.** ✅ Fechada 25/10 (recomendação). **Recomendo usar a captura da página (ou a foto do produto) como referência no `gpt-image-2/edit` quando existir (+US$ 0,01)** e, sem referência, tela abstrata sem texto. Nunca lista de conteúdo inventada como a do experimento.
- **D5 — Grafia errada.** ✅ Fechada 25/10 (recomendação). **Recomendo checagem sempre (~US$ 0,004) + 1 refação automática só para texto crítico, dentro do teto**; texto menor errado = entrega com aviso e o usuário decide (Retry/Leave out).
- **D6 — Margens no 9:16.** ✅ Fechada 25/10 (recomendação). O aprovado usa 4 % e põe o CTA nos 10 % de baixo, onde a interface do Stories cobre. **Recomendo 5 % em cima e 10 % embaixo livres** (o CTA sobe um pouco); a S2 confirma que o layout aguenta.
- **D7 — Escopo do layout.** ✅ Fechada 25/10 (recomendação). **Recomendo `assembled` como único layout de plano novo** (2 STATIC no lote = emoções/ângulos diferentes); `photo_headline` e `poster` só pra plano antigo.
- **D8 — Onde as molduras entram.** ✅ Fechada 25/10 (recomendação). **Recomendo AUTO primeiro (B1), criativo do zero logo em seguida (B1.2) e editor fora da v1** (textos editáveis por formulário, re-render grátis).
- **D9 — Prova social falsa nas interfaces.** ✅ Fechada 25/10 (recomendação). **Recomendo: Live sem número de espectadores, post_card sem selo de verificado e com avatar de iniciais, call com rótulo genérico** (número ou selo seria afirmação inventada).
- **D10 — Molduras por lote.** 🔁 **Revista 25/10 (Gusta, depois do teste live): até 8 `FRAME` por lote, todas de templates diferentes, contando na diversidade.** COLD_OPEN, HOOK_TEXT, ENDCARD, STORY e SPLIT_LP saíram dos lotes novos (`variacao-auto-v1.md` §6.1). O código continua sem sufixo de repetição. Texto original: ✅ Fechada 25/10 (recomendação). **Recomendo máx. 2 `FRAME` por lote, de templates diferentes**, contando na diversidade (com 9 tipos já no catálogo, mais que isso empurra layouts que provaram).
- **D11 — Meet diálogo.** ❌ **Revertida 25/10:** o Gusta quer as 18 molduras iguais ao protótipo; `call_dialog` fica no B2 com as 2 fontes do campeão (ou b-roll, D16), sem rosto gerado. (Recomendação original, recusada: tirar da fase 2 e tratar como criativo do zero com 2 rostos.)
- **D12 — Emojis do pack (🏆🥇👇).** ✅ Fechada 25/10 (recomendação). **Recomendo ícones SVG próprios** (render determinístico, sem fonte de emoji no servidor).
- **D13 — 4:5 e 1:1 das molduras.** ✅ Fechada 25/10 (recomendação). **Recomendo layout próprio por formato nos 10 da fase 1**, com `format_not_supported` só para o que o Gusta reprovar no contact sheet.
- **D14 — "Leia a legenda".** ✅ Fechada 25/10 (recomendação). Só funciona se o texto do anúncio pagar a curiosidade. **Recomendo a peça carregar um `primaryText` sugerido que vira o padrão na publicação Meta**; sem publicar pelo HookMill, o texto vai no README do zip.
- **D15 — Aviso de licença do b-roll pro usuário final.** ✅ **Fechada 25/10 (Gusta: "ok"), com a recomendação abaixo.** Vídeo de YouTube/Instagram/TikTok num anúncio pago de cliente não tem permissão comercial; o risco (derrubada do anúncio, strike, reclamação do autor) é de quem publica. **Recomendo:** (1) stock (Pexels/Pixabay/Commons-livre/NASA) ligado por padrão; (2) redes sociais **desligadas por padrão por workspace**, ligadas só por OWNER/ADMIN com aceite único de um termo curto ("os direitos de uso deste material são responsabilidade sua"), gravado com usuário e data; (3) peça com `licenseCommercialOk: false` mostra o selo "Licença não verificada" na peça e no README do zip; (4) publicar pelo HookMill uma peça dessas pede uma confirmação a mais. Custo: 1 campo no workspace + 1 checkbox; não trava o fluxo de quem aceitou.
- ✅ **(fechada 25/10, Gusta: "ok", com a recomendação)** **D16 — Qual "Meet" aceita b-roll (aberta).** O adendo diz "Meet". No protótipo o `call` (Google Meet) é 1 fonte com slide, e o `call_dialog` (Meet diálogo) tem o 2º quadro de vídeo. **Recomendo b-roll só no 2º quadro do `call_dialog`** (troca o "convidado" por um clipe mudo) e manter o `call` igual ao protótipo; se o Gusta quiser b-roll no lugar do slide do `call`, vira variante nova com revisão visual.
- ✅ **G1–G4 (spec do design, §A10.5) — fechadas 25/10 (Gusta: "ok pra tudo"), todas com a recomendação do design:** G1 peça com texto crítico errado depois das 2 tentativas sai do zip por padrão (`inZip: false`, o usuário devolve); G2 preço no próprio botão Retry, sem diálogo; G3 `extraText` (texto que a imagem inventou) conta como erro crítico; G4 CTA no 9:16 em 84–90 %. **Sondas pagas da rodada final aprovadas no mesmo "ok":** S2/S3 em 2k (~US$ 2,00) + 1 lote real de molduras com o Claude ligado (centavos), quando o código estiver pronto.
