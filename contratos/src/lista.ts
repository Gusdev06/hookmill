// templates-lista-v1 (docs/contratos/templates-lista-v1.md, 04/11; templates aprovados pelo Gusta em 04/11, contrato aguarda ok).
// Tipo AUTO `LIST_OVERLAY` com 2 templates (`versus`, `value-stack`): lista sincronizada à fala por cima do vídeo do campeão.
// Dono: maquina-arquiteto. SÓ TIPOS. Campos novos em IteratePiece/TemplateCard ficam opcionais (TRANSIÇÃO) até as entregas.
import type { AutoVariationType, FormatCode } from './iteracao';

// T-B1 (04/11): `LIST_OVERLAY` agora é membro do `AutoVariationType` (iteracao.ts); `ListOverlayType`/`AutoVariationTypeWithList` saíram.

/** Ids dos 2 templates do motor `ListOverlay` (= slug do catálogo e `templateId` do render). */
export type ListTemplateId = 'versus' | 'value-stack';
/** Modo do painel: Versus 2 colunas · Versus 1 coluna (opção, e forçado no 1:1) · Value stack. */
export type ListMode = 'two-col' | 'one-col' | 'stack';
/** Variação de cor (§3.4 da spec). `brand` usa a cor da marca (FrameBrand.color). */
export type ListLook = 'ink' | 'paper' | 'brand';
/** Versus: `by_speech` (cada coluna enche quando a fala trata do lado) · `alternate` (par a par nos primeiros 70 %). Stack: sempre by_speech. */
export type ListOrder = 'by_speech' | 'alternate';
export type ListSide = 'bad' | 'good';
/** Versus: sempre `item`. Value stack: `item` (numerado), `proof` (✓), `price` (etiqueta), `cta` (seta). */
export type ListLineKind = 'item' | 'proof' | 'price' | 'cta';
/** De onde a linha veio. `generic` só nos rótulos (cabeçalho esquerdo / título) traduzidos do template. */
export type ListSource = 'transcript' | 'brain' | 'both' | 'generic';
/** Campo do Brain (ou `name` = offer.name, só no cabeçalho direito do Versus). */
export type ListField = 'pains' | 'promise' | 'what' | 'proof' | 'offerAndPrice' | 'cta' | 'name';

/** Onde o painel ficou (§3.1). `none` nunca chega na vista: vira `captionBlocked` (burned_captions) ou fit `no_room`. */
export type ListPlacementMode = 'body' | 'top' | 'side';
/** Por quê (o web mostra em "Placement"): zona livre entre queixo e legenda · legenda no meio (zona abaixo dela) · sem legenda ·
 *  zona pequena (foi pro topo) · formato quadrado. */
export type ListPlacementReason = 'free_below_face' | 'below_captions' | 'no_captions' | 'small_zone' | 'square';

/** Uma linha da lista na vista do Plan. `id` estável (vai no `path` do PATCH de texto: `list.lines.<id>`). */
export interface ListLineView {
  id: string;
  side: ListSide | null;            // só Versus
  kind: ListLineKind;
  text: string;
  maxChars: number;                 // §5 da spec, por peça
  /** instante de entrada na saída (s). Âncora − 0,10 s; sem âncora = maior pausa livre ≥ 0,4 s (agendaLista). */
  atSec: number;
  source: Exclude<ListSource, 'generic'>;
  field: ListField | null;          // obrigatório em brain/both
  /** frase da fala que contém a palavra-âncora (≤ 120, cortada com …); null sem âncora */
  quote: string | null;
  /** true = linha que só existe porque o Brain completou um anúncio com pouca lista (estado "Too few items") */
  fromFill: boolean;
}
export interface ListLabelView { text: string; maxChars: number; source: ListSource; field: ListField | null }

/** `IteratePiece.list` (só LIST_OVERLAY). */
export interface PieceList {
  templateId: ListTemplateId;
  mode: ListMode;
  look: ListLook;
  order: ListOrder;
  /** Versus: { bad, good } · Stack: null */
  heads: { bad: ListLabelView; good: ListLabelView } | null;
  /** Stack: título · Versus: null */
  title: ListLabelView | null;
  lines: ListLineView[];
  /** por formato com layout (9x16 sempre; 4x5/1x1 quando `supported`) */
  placement: { format: FormatCode; mode: ListPlacementMode; reason: ListPlacementReason }[];
  /** `pending` = poucos momentos de lista na fala (< 2 âncoras): a peça fica FORA do lote/quote até "Fill from Brain".
   *  `accepted` = a pessoa aceitou as linhas do Brain. null = não precisou. */
  fill: 'pending' | 'accepted' | null;
  /** Props do render 9:16 (ListOverlayProps de `@maquina/video/player`, URLs assinadas) pra prévia com @remotion/player.
   *  Opaco aqui (o contratos não depende do video): o web faz o cast. Recalculado a cada PATCH. */
  preview: { props: ListOverlayPropsJson; urlsExpireAt: string } | null;
}
export type ListOverlayPropsJson = Record<string, unknown>;

/** `PATCH /iterate/:id/items/:itemId/list` (grátis, só PLAN_READY). Pelo menos 1 campo. Resposta: `IterateBatch`. */
export interface UpdateListOptionsBody {
  look?: ListLook;
  /** só Versus no 9:16/4:5 (o 1:1 é sempre 1 coluna) */
  columns?: 1 | 2;
  /** "Fill from Brain": `fill` pending → accepted (a peça entra no lote e no quote). Sem chamada paga: as linhas já vieram no plano. */
  acceptFill?: true;
}

/** Limites da §5 (o pacote é só tipos; DTO, validação e prompt repetem os números). */
export interface ListTextLimits {
  headChars: 14; versusCellChars: 24; stackTitleChars: 18; stackItemChars: 30; stackProofChars: 30; stackPriceChars: 34; stackCtaChars: 22;
  versusPairsMin: 3; versusPairsMax: 4; stackBarsMax: 5; stackBodyMin: 3; minSpeechSec: 12; minAnchoredLines: 2;
}
