# Editor das molduras e da HEADLINE — fase E1
Data: 2026-10-26 · Dono: maquina-arquiteto · Status: **APROVADO pelo Gusta em 26/10 ("ok"), decisões abertas com a recomendação do arquiteto** (nada de código até o ok do Gusta nas decisões da §8)
Origem: decisão do Gusta de 26/10: estender o editor (`editor-v1.md`: Player = render, `EditDoc`, exportar = `POST /render`) às molduras e à HEADLINE, tirando o `editorAvailable: false` / `frame_editor_not_enabled` da D8 (`estatico-montado-e-molduras-v1.md`).
**Depende de** `legenda-protegida-v1.md` (ordem do Gusta: A antes de B). O editor usa a mesma `checarLegendaProtegida` pro aviso e pro contorno vermelho.
Fases: **E1** (este arquivo) = textos e mover/redimensionar caixas de moldura e HEADLINE · **E2** = vídeo (reenquadrar/aparar), legenda (palavras e estilo) e troca de clipe de b-roll na timeline · **E3** = estático (STATIC). E2 e E3 ganham contrato próprio depois do E1 provado.

---

## 0. Resumo em 5 linhas
1. **Mesmo editor, mais 2 composições:** o Player toca `Moldura` e `RemixKeep` (HEADLINE) com as props de `resolverPropsMoldura(input, doc)` / `resolverPropsHeadline(input, doc)`, funções puras de `@maquina/video/lib` usadas **pelo web e pela API** (WYSIWYG, ajuste 1 do editor-v1). Com `doc` nulo, o render sai idêntico ao de hoje.
2. **Camadas editáveis no E1:** cada texto da moldura (o mesmo id do slot: `headline`, `dek`, `cta`, `question`…), as **caixas** da moldura (slots, cartão, faixas) e a headline/faixa/placa da HEADLINE: texto, estilo (catálogo), posição e escala **por cima do layout calculado**. Vídeo, rosto redondo, 2ª fonte e legenda ficam pro E2.
3. **Proxies 540p** do campeão e da trilha de b-roll são gerados no lote (ffmpeg na API, ~0 custo). O Player usa os proxies; o export usa os originais em 1080 no Lambda.
4. **As regras valem no editor:** arrastar sobre a legenda queimada (faixa protegida) ou sobre o rosto = contorno vermelho + aviso, e o export bloqueia (`EDIT_NOT_SUPPORTED`). Texto editado passa pelo "nada inventado" e, depois do render, pela checagem de texto e de legenda por visão.
5. **Custo:** proxies ~US$ 0; export = 1 render no Lambda (~US$ 0,01-0,02) + checagem por visão (~US$ 0,008 se a legenda for protegida, ~US$ 0,008 de texto). Sem geração paga.

## 1. O que entra no E1
| item | moldura (`FRAME`) | `HEADLINE` |
|---|---|---|
| editar texto de cada slot | sim (limites do template; `fitText` com mínimo de 36 px) | sim (a headline; limite do §1.2 do headline-e-legenda) |
| estilo do texto (fonte do catálogo, cor, destaque, contorno, caixa alta, alinhamento) | sim | sim |
| mover e redimensionar a **caixa** (slot, cartão, faixa, placa) | sim, dentro do canvas; a `videoBox` fica fixa no E1 | sim: faixa repintada/placa/faixa adicionada |
| cor de fundo da caixa | sim (hex, e a cor da marca como atalho) | sim (a placa mantém o contraste ≥ 3, H1) |
| esconder um slot opcional | sim (os que o template marca `optional`, ex.: `dek`) | não |
| vídeo (reenquadrar, aparar), rosto redondo, 2ª fonte, legenda | **E2** | **E2** |
| trocar de template | não (é outra peça do lote) | — |

## 2. `EditDoc` (extensão do editor-v1, só campos opcionais)
```ts
// contratos/src/editor.ts
export type LayerId = 'hook' | 'caption' | 'cta' | string;
//   moldura: `slot:<nome>` (texto do slot, ex. 'slot:headline') e `box:<nome>` (caixa/cartão/faixa, ex. 'box:card');
//   HEADLINE: 'headline' (texto) e 'headline:box' (faixa/placa).
export interface EditDocLayer {
  // … campos de hoje (visible, transform, timing, text, style) …
  /** E1: caixa da moldura/HEADLINE em fração do canvas (sobrescreve o retângulo do layout calculado). */
  rect?: { x: number; y: number; w: number; h: number } | null;
  /** E1: fundo da caixa (hex). null = o do template/medido. */
  fill?: string | null;
}
export interface EditDoc {
  version: 1 | 2;               // 2 = tem camadas de moldura/HEADLINE (o resolver aceita os dois)
  // … clips, trim, layers, captionWords (moldura/HEADLINE: clips = [], trim = null, captionWords = [] no E1) …
}
```
- **Ordem de aplicação:** layout calculado (`frameLayout`, `buildHeadlineInput`) → `rect`/`fill` da caixa → texto e estilo do slot → `fitText` na caixa final. O `transform` (x, y, escala) do editor-v1 vale pras camadas de texto. Nas caixas vale o `rect`, que é mais simples de arrastar e não gira no E1.
- **Validação** (`validarDocMoldura(doc, input)`, função pura, a mesma no web e no `PUT`): ids existentes no template; texto dentro do limite do slot e cabendo no mínimo de 36 px (`FRAME_TEXT_OVERFLOW` vira `text_overflow` no doc); caixa dentro do canvas; **nenhuma caixa ou texto sobre a faixa protegida** (`caption_covered`, `checarLegendaProtegida`); **nenhuma caixa ou texto sobre o rosto principal** em > 10 % dos frames (`face_covered`); contraste mínimo 3 entre texto e fundo (`low_contrast`, só aviso).
- **"Nada inventado"**: o texto editado passa pelo `validatePlan` de texto da peça (`invented_number`/`invented_claim` contra Brain e transcrição) no `PUT`. Violou = 400 `VALIDATION_ERROR` com `rule: 'invented_number'`, e o web mostra o trecho. O usuário pode **confirmar** que é verdade (D-E1-3).

## 3. API (sem rota nova)
- `GET /creatives/:id/editor` passa a responder pra **peça AUTO** (`variation_items` → criativo da peça) dos tipos `FRAME` e `HEADLINE`. `capabilities` ganha `frame: { slots: SlotInfo[]; boxes: BoxInfo[]; protectedBands: ProtectedBand[]; faceTrack: … }` (o que o painel precisa pra desenhar guias e avisos), e `proxyUrls: { champion: string; broll: string[] }`.
- `PUT /creatives/:id/editor`: mesmo corpo. Valida com `validarDocMoldura`. Salvar marca a peça como `edited` e muda o código no zip pro sufixo `-ED` (D-E1-4).
- **Exportar** = `POST /creatives/:id/render` (Lambda), que gera o 9:16 e invalida 4:5/1:1 (ficam `none`, a pedir de novo). Depois do render rodam a checagem de legenda (`legenda-protegida-v1` §4.2) e a de texto (D-E1-5), com o mesmo `failed`/Retry/zip.
- Peças dos outros tipos AUTO continuam `editorAvailable: false` (`reason: 'auto_type_not_editable'`).
- `estatico-montado-e-molduras-v1.md` D8 e o `frame_editor_not_enabled` são revogados para `FRAME`/`HEADLINE` quando o E1 for pro ar.

## 4. Proxies 540p
- **Quando:** no fim da análise do lote (campeão) e quando a trilha de b-roll é montada, só se o lote tem `FRAME` ou `HEADLINE`. São jobs `PROXY` na fila da API (ffmpeg, CPU).
- **Como:** H.264 baseline, 540 de largura (altura proporcional), mesmo fps do original, GOP de 1 s (seek rápido no Player), crf 28, AAC 96k no campeão (o b-roll é mudo). Por volta de 3-5 MB por 30 s.
- **Onde:** `files` com `FileKind` novo `PROXY` (migração aditiva), ligados ao original (`files.proxy_of_file_id`). Apagados junto com o lote.
- **Uso:** o `resolverProps*` recebe `{ mediaMode: 'proxy' | 'original' }`. O web usa `proxy`; a API sempre `original`. As coordenadas são **normalizadas**, então o proxy não muda layout nem `fitText`. O `crop`/`contentBox` em px do arquivo é escalado pelo resolver.
- **Custo:** CPU da VPS (~2-4 s por 30 s de vídeo) + storage desprezível. US$ 0 de provedor.

## 5. Player e avisos no web
- Mesma tela do editor (`/creatives/:id/editor`), com o painel da moldura: lista de slots (texto + estilo), caixas com alças (mover/redimensionar), guias da `videoBox`, **faixa protegida desenhada em cinza tracejado** e caixa do rosto (só ao arrastar).
- **Contorno vermelho + aviso** no ato de arrastar ou digitar, pela mesma função do `PUT`: "Isto tampa a legenda do vídeo", "Isto cobre o rosto", "O texto não cabe nesta caixa". Com aviso vermelho, o Exportar fica desligado.
- O Player do Remotion já carrega as fontes do catálogo e as CJK (`public/fonts`), então a prévia fica igual ao render.

## 6. Divisão do trabalho (E1)
| agente | entrega | depende de |
|---|---|---|
| **arquiteto** | tipos (`EditDocLayer.rect/fill`, `version 2`, `capabilities.frame`, `proxyUrls`), migração (`FileKind PROXY`, `files.proxy_of_file_id`), `api.md`, revogar D8 | `legenda-protegida-v1` aprovado |
| **video** | `resolverPropsMoldura` e `resolverPropsHeadline` (doc nulo = idêntico, aceite frame a frame), `validarDocMoldura`, ids de slot/caixa estáveis por template (`data-layer` nos elementos), escala de coordenadas proxy × original | tipos; `checarLegendaProtegida` (legenda-protegida) |
| **backend** | `GET/PUT /editor` pra peça FRAME/HEADLINE (capabilities, validação, "nada inventado" no texto editado, sufixo `-ED`), jobs `PROXY`, export → render → checagens → formatos invalidados | tipos; video |
| **frontend** | painel da moldura/HEADLINE (slots, caixas com alças, faixa protegida, contorno vermelho), Player com proxies, Exportar | tipos; video (resolver); MSW antes |
| **ia** | sem trabalho novo no E1 (reaproveita `validatePlan` de texto e as checagens por visão) | — |
| **qa** | aceite doc nulo = render de hoje (PSNR infinito, como o F1 do editor-v1); Player × render com `doc` (stills, ≤ 2 níveis); arrastar sobre legenda/rosto bloqueia; "nada inventado" no texto editado; proxy × original no mesmo layout | tudo |
Ordem: arquiteto → video (resolver + aceite doc nulo, **portão**) → backend + frontend em paralelo → qa.

## 7. Custo
| item | custo |
|---|---|
| proxies (por lote com FRAME/HEADLINE) | US$ 0 de provedor; ~2-4 s de CPU por vídeo de 30 s |
| exportar 1 peça editada | render no Lambda ~US$ 0,01-0,02 + checagem de legenda ~US$ 0,008 (se protegida) + checagem de texto ~US$ 0,008 (D-E1-5) ≈ **US$ 0,02-0,04** |
| salvar o doc / Player | US$ 0 |
Sem teto novo: o export passa pelo `assertWithinCap` com essa estimativa.

## 8. Decisões abertas (com recomendação)
| # | decisão | recomendação |
|---|---|---|
| **D-E1-1** | Mover a `videoBox` no E1 | **Não**: ela define o reenquadramento e a proteção da legenda. Fica pro E2, junto com o vídeo. |
| **D-E1-2** | Girar caixas de moldura | Não no E1 (só os textos giram, como no editor-v1). |
| **D-E1-3** | "Nada inventado" no texto que o usuário digita | Bloqueia com o trecho marcado **e** oferece "Confirmo que é verdade" (grava `textConfirmedBy` no doc). O usuário é dono da oferta; a IA não. |
| **D-E1-4** | Peça editada no zip | Sufixo `-ED` no código (`FRAME-NEWS-ED`) e a original some do zip (a editada substitui). |
| **D-E1-5** | `textCheck` por visão em moldura/HEADLINE editada | Sim, só nos textos editados (o render é texto de verdade, não imagem gerada, então o risco é baixo; serve pra pegar fonte de reserva e corte). ~US$ 0,008. Pode ficar desligado no E1 se o Gusta preferir economizar. |
| **D-E1-6** | Proxies sempre ou só quando abrir o editor | Sempre no lote com FRAME/HEADLINE: custa ~0, e abrir o editor fica instantâneo. |
| **D-E1-7** | Editar várias peças de uma vez (ex.: a mesma headline em 3 molduras) | Fora do E1. |
