// Editor no vídeo v1 (docs/contratos/editor-v1.md §7.2). Funções puras, sem React: importadas pelo web (Player) e pela API.
// - layoutPadrao: padrão de cada camada (= posições, zonas, ESCALA_TIPO e estilo de hoje).
// - resolverProps(fonte, settings, doc) -> CriativoProps: template -> EditSettings -> EditDoc (cortes, ordem, cenas
//   apagadas, correção de palavra, camadas com posição/tempo/texto/estilo). Doc nulo/vazio = props de hoje, sem `layers`.
// - validarDoc(doc, fonte) -> { field, rule }[] (regras do §5.4) · normalizarDoc(doc, fonte[, settings]) -> doc | null.
// Tipos do EditDoc/ScratchSource: espelho do contrato até o @maquina/contratos exportar `editor.ts` (F0).
import { CTA_SEC, FPS, GANCHO_SEC, type VideoFormat } from './formatos';
import { FONT_CATALOG, type FontId } from './remix';
import type { CriativoProps, LayerStyle, LayerTransform, Palavra, ResolvedLayer, TemplateId } from './schema';
import { templatePorId } from './templates';
import { framesDasCenas } from './tempo';

export type { LayerStyle, LayerTransform, ResolvedLayer } from './schema';

// ---- EditDoc (espelho de editor-v1 §2) ---------------------------------------------------------------------------
export type LayerId = 'hook' | 'caption' | 'cta' | string;
export interface EditClip { sceneId: string; enabled: boolean; attempt: number; inSec: number; outSec: number }
export interface EditDocLayer {
  id: LayerId;
  visible?: boolean;
  transform?: LayerTransform | null;
  timing?: { fromSec: number; durationSec: number } | null;
  text?: string;
  style?: Partial<LayerStyle>;
}
export interface CaptionWordFix { key: string; text: string }
export interface EditDoc {
  version: 1;
  clips: EditClip[];
  trim: { inFrame: number; outFrame: number } | null;
  layers: EditDocLayer[];
  captionWords: CaptionWordFix[];
}

/** O que vem do EditSettings e muda o layout (o resto do EditSettings não mexe nas camadas). */
export type SettingsDoLayout = Pick<CriativoProps, 'captionStyle' | 'captionPosition' | 'headline' | 'ctaText' | 'endCard'>;

// ---- Layout de hoje (fonte única; estilos.ts reexporta) ------------------------------------------------------------
/** Centro vertical (fração da altura) de cada posição, por formato. Respeita a área da interface do Reels/Stories no 9:16. */
export const ZONAS: Record<VideoFormat, Record<CriativoProps['captionPosition'], number>> = {
  VERTICAL_9_16: { top: 0.2, middle: 0.5, bottom: 0.7 },
  PORTRAIT_4_5: { top: 0.15, middle: 0.5, bottom: 0.79 },
  SQUARE_1_1: { top: 0.14, middle: 0.5, bottom: 0.82 },
};

/** Escala de tipografia por formato (largura é 1080 nos três; quadros mais baixos pedem letra um pouco menor). */
export const ESCALA_TIPO: Record<VideoFormat, number> = { VERTICAL_9_16: 1, PORTRAIT_4_5: 0.92, SQUARE_1_1: 0.86 };

/** Largura da caixa de quebra de cada camada (fração da largura), = margens de hoje: gancho 7 %, legenda 6 %, CTA 86 %. */
export const LARGURA_PADRAO = { hook: 0.86, caption: 0.88, cta: 0.86 } as const;

/** Tamanho de fonte de cada camada com scale 1 (px no canvas), = cálculo de hoje dos componentes. */
const FONTE_LEGENDA: Record<TemplateId, number> = { clean: 66, bold: 96, headline: 62 };
export const fontePadraoPx = (layer: 'hook' | 'caption' | 'cta', templateId: TemplateId, format: VideoFormat, texto = ''): number => {
  const e = ESCALA_TIPO[format];
  if (layer === 'caption') return Math.round(FONTE_LEGENDA[templateId] * e);
  if (layer === 'cta') return Math.round(50 * e);
  return Math.round(64 * e * (texto.length > 60 ? 0.85 : 1));
};

/** y do CTA hoje: sobe acima da legenda quando ela está embaixo. */
export const yCtaPadrao = (format: VideoFormat, captionStyle: CriativoProps['captionStyle'], captionPosition: CriativoProps['captionPosition']) =>
  captionStyle !== 'off' && captionPosition === 'bottom' ? ZONAS[format].bottom - (format === 'VERTICAL_9_16' ? 0.13 : 0.17) : ZONAS[format].bottom;

const transformPadrao = (y: number, boxWidth: number): LayerTransform => ({ x: 0.5, y, scale: 1, rotationDeg: 0, boxWidth });

// Estilo padrão de cada camada em LayerStyle (o que o painel mostra e por baixo do `style` parcial do doc). Sem `style`
// no doc, quem desenha é estilos.ts (caminho de hoje); com `style`, os componentes desenham a partir do LayerStyle.
const FONTE_TEMPLATE: Record<TemplateId, { legenda: FontId; gancho: FontId; cta: FontId }> = {
  clean: { legenda: 'inter-800', gancho: 'inter-800', cta: 'inter-800' },
  bold: { legenda: 'montserrat-900', gancho: 'montserrat-800', cta: 'montserrat-900' },
  headline: { legenda: 'inter-800', gancho: 'inter-800', cta: 'inter-800' },
};
const COR_DESTAQUE: Record<TemplateId, string> = { clean: '#FFFFFF', bold: '#FFE14D', headline: '#7CF29A' };
export const estiloPadrao = (layer: 'hook' | 'caption' | 'cta', t: TemplateId, format: VideoFormat = 'VERTICAL_9_16'): LayerStyle => {
  const f = FONTE_TEMPLATE[t];
  if (layer === 'caption') {
    return {
      fontId: f.legenda, color: '#FFFFFF', highlightColor: COR_DESTAQUE[t],
      background: t === 'clean' ? { kind: 'word', color: '#0000008C' } : { kind: 'none', color: null },
      // = contorno de hoje: max(4, 9 % da fonte da legenda no formato)
      strokeColor: t === 'bold' ? '#000000' : null, strokeWidthPx: t === 'bold' ? Math.max(4, Math.round(fontePadraoPx('caption', t, format) * 0.09)) : 0,
      uppercase: t === 'bold', shadow: true, align: 'center',
    };
  }
  if (layer === 'cta') {
    return { fontId: f.cta, color: '#0A0A0A', highlightColor: null, background: { kind: 'pill', color: t === 'clean' ? '#FFFFFF' : COR_DESTAQUE[t] }, strokeColor: null, strokeWidthPx: 0, uppercase: t === 'bold', shadow: true, align: 'center' };
  }
  return { fontId: f.gancho, color: '#0A0A0A', highlightColor: null, background: { kind: 'box', color: '#FFFFFF' }, strokeColor: null, strokeWidthPx: 0, uppercase: false, shadow: true, align: 'center' };
};

export interface PadraoDaCamada {
  transform: LayerTransform;
  timing: { fromSec: number; durationSec: number };
  style: LayerStyle;
  text: string | null;
  /** fonte com scale 1, em px do canvas */
  fontPx: number;
}

/**
 * Padrão de cada camada (editor-v1 §5.1 `defaults`, §7.2). `cenasSec` = soma das cenas (sem o end card).
 * A legenda "top" desce pro meio enquanto o gancho aparece: isso é regra do caminho sem transform; aqui vai a posição pedida.
 */
export const layoutPadrao = (templateId: TemplateId, format: VideoFormat, settings: SettingsDoLayout, cenasSec: number): Record<'hook' | 'caption' | 'cta', PadraoDaCamada> => {
  const gancho = templatePorId(templateId)?.supportsHeadline && settings.headline?.trim() ? settings.headline.trim() : null;
  const cta = settings.ctaText.trim() || null;
  const fG = Math.min(GANCHO_SEC, cenasSec);
  const fC = Math.min(CTA_SEC, cenasSec);
  return {
    hook: { transform: transformPadrao(ZONAS[format].top, LARGURA_PADRAO.hook), timing: { fromSec: 0, durationSec: fG }, style: estiloPadrao('hook', templateId, format), text: gancho, fontPx: fontePadraoPx('hook', templateId, format, gancho ?? '') },
    caption: { transform: transformPadrao(ZONAS[format][settings.captionPosition], LARGURA_PADRAO.caption), timing: { fromSec: 0, durationSec: cenasSec }, style: estiloPadrao('caption', templateId, format), text: null, fontPx: fontePadraoPx('caption', templateId, format) },
    cta: { transform: transformPadrao(yCtaPadrao(format, settings.captionStyle, settings.captionPosition), LARGURA_PADRAO.cta), timing: { fromSec: cenasSec - fC, durationSec: fC }, style: estiloPadrao('cta', templateId, format), text: cta, fontPx: fontePadraoPx('cta', templateId, format) },
  };
};

// ---- Geometria (componentes e alças do web usam a mesma conta) -----------------------------------------------------
/** % com no máximo 6 casas: o padrão sai "7%" exato (sem ruído de ponto flutuante), igual ao CSS de antes. */
export const pct = (fracao: number) => `${Math.round(fracao * 1e8) / 1e6}%`;

/** Caixa horizontal da camada: left/right em % do canvas, centrada em x com largura boxWidth (antes do scale). */
export const caixaHorizontal = (t: LayerTransform) => ({ left: pct(t.x - t.boxWidth / 2), right: pct(1 - t.x - t.boxWidth / 2) });

// ---- Fonte do criativo do zero (espelho de editor-v1 §5.1 ScratchSource) ------------------------------------------
export interface ScratchSourceScene {
  sceneId: string;
  index: number;
  label?: string;
  attempt: number;
  durationSec: number;
  /** instante do clipe onde a cena começa (fatia de take); 0 = começo do clipe */
  clipStartSec: number;
  clip: { url: string };
  thumbnail?: { url: string } | null;
  words: Palavra[];
}
export interface ScratchSource { format: VideoFormat; fps: number; language: string; scenes: ScratchSourceScene[] }
/** = EditSettings do @maquina/contratos (templateId string: só clean/bold/headline passam no resolverProps). */
export interface EditSettingsLike {
  templateId: string;
  captionStyle: CriativoProps['captionStyle'];
  captionPosition: CriativoProps['captionPosition'];
  headline: string | null;
  ctaText: string;
  endCard: boolean;
}

export type EditDocRule =
  | 'unknown_scene' | 'clips_must_cover_scenes' | 'no_enabled_clip' | 'trim_out_of_range' | 'clip_too_short'
  | 'video_too_short' | 'unknown_layer' | 'bad_color' | 'unknown_font' | 'doc_too_large' | 'unknown_word';
export interface EditDocError { field: string; rule: EditDocRule }

/** Limites do §2. */
export const LIMITES_DOC = { layers: 50, captionWords: 2000, text: 300, bytes: 64 * 1024, clipMinSec: 0.3, videoMinSec: 1 } as const;
export const CAMADAS_DO_ZERO = ['hook', 'caption', 'cta'] as const;
type CamadaDoZero = (typeof CAMADAS_DO_ZERO)[number];
const ehCamadaDoZero = (id: string): id is CamadaDoZero => (CAMADAS_DO_ZERO as readonly string[]).includes(id);

const COR_HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const corValida = (c: unknown): c is string => typeof c === 'string' && COR_HEX.test(c);
const fonteValida = (f: unknown): f is FontId => typeof f === 'string' && Object.prototype.hasOwnProperty.call(FONT_CATALOG, f);

/** Chave da correção de palavra no criativo do zero (§2 CaptionWordFix). */
export const chavePalavra = (sceneId: string, attempt: number, wordIndex: number) => `${sceneId}@${attempt}:${wordIndex}`;
export const lerChavePalavra = (key: string): { sceneId: string; attempt: number; wordIndex: number } | null => {
  const m = /^(.+)@(\d+):(\d+)$/.exec(key);
  return m ? { sceneId: m[1], attempt: Number(m[2]), wordIndex: Number(m[3]) } : null;
};

// ---- Geometria do tempo -------------------------------------------------------------------------------------------
const limita = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const finito = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const LIMITES = { x: [-0.25, 1.25], y: [-0.25, 1.25], scale: [0.25, 4], rotationDeg: [-180, 180], boxWidth: [0.1, 1.5] } as const;
const limitaTransform = (t: LayerTransform): LayerTransform => ({
  x: limita(t.x, ...LIMITES.x), y: limita(t.y, ...LIMITES.y), scale: limita(t.scale, ...LIMITES.scale),
  rotationDeg: limita(t.rotationDeg, ...LIMITES.rotationDeg), boxWidth: limita(t.boxWidth, ...LIMITES.boxWidth),
});

/** Meio frame de tolerância: o web arredonda pra frame, a duração da cena não é múltiplo de 1/fps. */
const meioFrame = (fps: number) => 0.5 / fps;

/** Corte efetivo de uma cena: [inSec, outSec) dentro dela, alinhado a frame (o fim inteiro fica exato, sem arredondar). */
export const corteDaCena = (durationSec: number, clip: Pick<EditClip, 'inSec' | 'outSec'> | null, fps: number = FPS): { inSec: number; outSec: number; inteiro: boolean } => {
  if (!clip) return { inSec: 0, outSec: durationSec, inteiro: true };
  const inSec = limita(Math.round(limita(finito(clip.inSec) ? clip.inSec : 0, 0, durationSec) * fps) / fps, 0, durationSec);
  const out0 = finito(clip.outSec) ? clip.outSec : durationSec;
  const outSec = out0 >= durationSec - meioFrame(fps) ? durationSec : limita(Math.round(out0 * fps) / fps, 0, durationSec);
  return { inSec, outSec, inteiro: inSec === 0 && outSec === durationSec };
};

const docVazio = (doc: EditDoc | null | undefined): boolean =>
  !doc || ((doc.clips?.length ?? 0) === 0 && (doc.layers?.length ?? 0) === 0 && (doc.captionWords?.length ?? 0) === 0 && !doc.trim);

// ---- Camadas: doc -> ResolvedLayer ---------------------------------------------------------------------------------
/** `style` parcial do doc por cima do padrão; cor/fonte inválida cai no padrão (o validarDoc já recusou antes). */
const estiloResolvido = (padrao: LayerStyle, parcial: Partial<LayerStyle>): LayerStyle => {
  const s: LayerStyle = { ...padrao, background: { ...padrao.background } };
  if (fonteValida(parcial.fontId)) s.fontId = parcial.fontId;
  if (corValida(parcial.color)) s.color = parcial.color;
  if (parcial.highlightColor === null || corValida(parcial.highlightColor)) s.highlightColor = parcial.highlightColor;
  if (parcial.background) {
    const b = parcial.background;
    if (b.kind === 'none' || b.kind === 'box' || b.kind === 'pill' || b.kind === 'word') s.background.kind = b.kind;
    if (b.color === null || corValida(b.color)) s.background.color = b.color;
  }
  if (parcial.strokeColor === null || corValida(parcial.strokeColor)) s.strokeColor = parcial.strokeColor;
  if (finito(parcial.strokeWidthPx)) s.strokeWidthPx = limita(parcial.strokeWidthPx, 0, 60);
  if (typeof parcial.uppercase === 'boolean') s.uppercase = parcial.uppercase;
  if (typeof parcial.shadow === 'boolean') s.shadow = parcial.shadow;
  if (parcial.align === 'left' || parcial.align === 'center' || parcial.align === 'right') s.align = parcial.align;
  return s;
};

/** Camadas do doc resolvidas (só as que estão no doc; as outras seguem o caminho de hoje). Tempo limitado ao total. */
const resolverCamadas = (props: CriativoProps, layers: EditDocLayer[], fps: number): CriativoProps['layers'] | undefined => {
  const totalFrames = framesDasCenas(props.scenes, fps);
  const padrao = layoutPadrao(props.templateId, props.format, props, totalFrames / fps);
  const out: NonNullable<CriativoProps['layers']> = {};
  for (const l of layers) {
    if (!l || !ehCamadaDoZero(l.id)) continue;
    const p = padrao[l.id];
    const timing = l.timing && finito(l.timing.fromSec) && finito(l.timing.durationSec) ? l.timing : p.timing;
    const from = limita(Math.round(timing.fromSec * fps), 0, totalFrames - 1);
    const dur = limita(Math.round(timing.durationSec * fps), 1, totalFrames - from);
    const r: ResolvedLayer = {
      visible: l.visible ?? true,
      // sem transform no doc = posição automática (null): a legenda "top" continua descendo pro meio durante o gancho
      transform: l.transform ? limitaTransform(l.transform) : null,
      fromFrame: from,
      durationInFrames: dur,
      fontScalePx: p.fontPx,
    };
    if (typeof l.text === 'string' && l.id !== 'caption') r.text = l.text.slice(0, LIMITES_DOC.text);
    if (l.style && Object.keys(l.style).length) r.style = estiloResolvido(p.style, l.style);
    out[l.id] = r;
  }
  return Object.keys(out).length ? out : undefined;
};

/**
 * F1: aplica só as camadas do doc (visible, transform, timing, text, style) por cima de props já montadas.
 * Mantido pra página de teste do web; o caminho oficial é `resolverProps`. Cortes e correções de palavra precisam da
 * fonte (sceneId/attempt), por isso ficam só no resolverProps.
 */
export const aplicarDoc = (props: CriativoProps, doc: EditDoc | null | undefined, fps: number = FPS): CriativoProps => {
  if (docVazio(doc)) return props;
  const layers = resolverCamadas(props, doc!.layers ?? [], fps);
  return layers ? { ...props, layers } : props;
};

// ---- Cenas: ordem, corte, apagadas, correção de palavra -----------------------------------------------------------
interface CenaResolvida { cena: ScratchSourceScene; inSec: number; outSec: number; inteiro: boolean }

/** Ordem final das cenas ativas com o corte de cada uma. Tolerante: cena desconhecida/duplicada some, cena que falta
 *  entra no fim (ativa), corte de attempt antigo volta pro clipe inteiro, nenhuma ativa = todas na ordem original. */
export const cenasDoDoc = (fonte: ScratchSource, clips: EditClip[] | null | undefined): CenaResolvida[] => {
  const fps = fonte.fps || FPS;
  const ordemOriginal = [...fonte.scenes].sort((a, b) => a.index - b.index);
  const inteira = (cena: ScratchSourceScene): CenaResolvida => ({ cena, inSec: 0, outSec: cena.durationSec, inteiro: true });
  if (!clips || clips.length === 0) return ordemOriginal.map(inteira);
  const porId = new Map(fonte.scenes.map((c) => [c.sceneId, c]));
  const vistas = new Set<string>();
  const out: CenaResolvida[] = [];
  for (const c of clips) {
    const cena = porId.get(c?.sceneId);
    if (!cena || vistas.has(cena.sceneId)) continue;
    vistas.add(cena.sceneId);
    if (c.enabled === false) continue;
    if (c.attempt !== cena.attempt) { out.push(inteira(cena)); continue; }
    const k = corteDaCena(cena.durationSec, c, fps);
    // corte degenerado (< 1 frame) = clipe inteiro (o validarDoc recusa antes; aqui só não quebra o render)
    if (k.outSec - k.inSec < 1 / fps) { out.push(inteira(cena)); continue; }
    out.push({ cena, ...k });
  }
  for (const cena of ordemOriginal) if (!vistas.has(cena.sceneId)) out.push(inteira(cena));
  return out.length ? out : ordemOriginal.map(inteira);
};

/** Correções válidas pra geração/attempt vigente: Map<sceneId, Map<wordIndex, texto>>. Stale ou desconhecida = ignorada. */
const correcoesVigentes = (fonte: ScratchSource, fixes: CaptionWordFix[] | null | undefined) => {
  const out = new Map<string, Map<number, string>>();
  if (!fixes?.length) return out;
  const porId = new Map(fonte.scenes.map((c) => [c.sceneId, c]));
  for (const f of fixes) {
    const k = f && typeof f.key === 'string' ? lerChavePalavra(f.key) : null;
    const cena = k && porId.get(k.sceneId);
    if (!k || !cena || cena.attempt !== k.attempt || k.wordIndex >= cena.words.length || typeof f.text !== 'string') continue;
    if (!out.has(cena.sceneId)) out.set(cena.sceneId, new Map());
    out.get(cena.sceneId)!.set(k.wordIndex, f.text.slice(0, LIMITES_DOC.text));
  }
  return out;
};

/** Palavras da cena depois do corte (relativas ao novo começo) e da correção. Texto '' = palavra escondida (sai da lista;
 *  o destaque segura na anterior durante o tempo dela, como num silêncio). Palavra que o corte deixa com < 1 frame sai. */
const palavrasDaCena = (r: CenaResolvida, fix: Map<number, string> | undefined, fps: number): Palavra[] => {
  const out: Palavra[] = [];
  r.cena.words.forEach((w, i) => {
    const texto = fix?.has(i) ? fix.get(i)! : w.word;
    if (r.inteiro) {
      if (fix?.has(i) && !texto.trim()) return;
      out.push(fix?.has(i) ? { ...w, word: texto } : w);
      return;
    }
    if (w.endSec <= r.inSec || w.startSec >= r.outSec || !texto.trim()) return;
    const startSec = Math.max(0, w.startSec - r.inSec);
    const endSec = Math.max(startSec, Math.min(r.outSec, w.endSec) - r.inSec);
    // sobra de menos de 1 frame da palavra cortada não pisca na tela
    if (endSec - startSec < 1 / fps - 1e-9) return;
    out.push({ word: texto, startSec, endSec });
  });
  return out;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;
interface Pedaco { url: string; clipStartSec: number; durationSec: number; words: Palavra[] }

/**
 * Pedaços seguidos do MESMO clipe que continuam exatamente de onde o anterior parou (fatias de take, §13.5) viram uma
 * cena só, com as palavras deslocadas pro tempo do clipe: = `renderPieces` da API hoje (sem emenda, sem zoom alternado
 * no meio da fala). Corte no meio de uma fatia quebra a continuidade e a cena volta a ser separada.
 */
const emendarFatias = (pedacos: Pedaco[]): CriativoProps['scenes'] => {
  const grupos: Pedaco[][] = [];
  for (const p of pedacos) {
    const g = grupos[grupos.length - 1];
    const ant = g?.[g.length - 1];
    if (ant && ant.url === p.url && Math.abs(ant.clipStartSec + ant.durationSec - p.clipStartSec) < 1e-3) g.push(p);
    else grupos.push([p]);
  }
  return grupos.map((g) => {
    const [primeiro] = g;
    if (g.length === 1) {
      const { url, clipStartSec, durationSec, words } = primeiro;
      return clipStartSec > 0 ? { clipUrl: url, durationSec, clipStartSec, words } : { clipUrl: url, durationSec, words };
    }
    const words = g.flatMap((p) => {
      const off = p.clipStartSec - primeiro.clipStartSec;
      return p.words.map((w) => ({ word: w.word, startSec: r3(w.startSec + off), endSec: r3(w.endSec + off) }));
    });
    const durationSec = g.reduce((t, p) => t + p.durationSec, 0);
    return primeiro.clipStartSec > 0 ? { clipUrl: primeiro.url, durationSec, clipStartSec: primeiro.clipStartSec, words } : { clipUrl: primeiro.url, durationSec, words };
  });
};

/**
 * Props da composição `Criativo` (editor-v1 §3.1, §7.2): template -> EditSettings -> EditDoc. O web usa pro Player e a
 * API pro RenderInput (+ renderId/fps). Doc nulo ou vazio = exatamente as props de hoje (sem `layers`, cenas como vieram).
 * Tolerante: nunca lança por causa do doc (o que é inválido vira padrão); lança só com template desconhecido.
 */
export const resolverProps = (fonte: ScratchSource, settings: EditSettingsLike, doc: EditDoc | null | undefined): CriativoProps => {
  if (settings.templateId !== 'clean' && settings.templateId !== 'bold' && settings.templateId !== 'headline') {
    throw new Error(`resolverProps: template ${settings.templateId} não é do criativo do zero (remix-keep usa resolverRemix)`);
  }
  const fps = fonte.fps || FPS;
  const d = docVazio(doc) ? null : doc!;
  const correcoes = correcoesVigentes(fonte, d?.captionWords);
  const scenes = emendarFatias(cenasDoDoc(fonte, d?.clips).map((r) => ({
    url: r.cena.clip.url,
    clipStartSec: (r.cena.clipStartSec || 0) + r.inSec,
    durationSec: r.inteiro ? r.cena.durationSec : r.outSec - r.inSec,
    words: palavrasDaCena(r, correcoes.get(r.cena.sceneId), fps),
  })));
  const props: CriativoProps = {
    templateId: settings.templateId,
    format: fonte.format,
    language: fonte.language,
    scenes,
    captionStyle: settings.captionStyle,
    captionPosition: settings.captionPosition,
    headline: settings.headline,
    ctaText: settings.ctaText,
    endCard: settings.endCard,
  };
  const layers = d?.layers?.length ? resolverCamadas(props, d.layers, fps) : undefined;
  return layers ? { ...props, layers } : props;
};

// ---- Validação (§5.4) ----------------------------------------------------------------------------------------------
const tamanhoEmBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v) ?? '').length;

/** Regras semânticas do §5.4 (a forma e as faixas numéricas ficam no DTO). Lista vazia = doc aceito. */
export const validarDoc = (doc: EditDoc | null | undefined, fonte: ScratchSource): EditDocError[] => {
  if (!doc) return [];
  const erros: EditDocError[] = [];
  const err = (field: string, rule: EditDocRule) => erros.push({ field, rule });
  const fps = fonte.fps || FPS;

  // tamanho
  if (tamanhoEmBytes(doc) > LIMITES_DOC.bytes) err('doc', 'doc_too_large');
  if ((doc.layers?.length ?? 0) > LIMITES_DOC.layers) err('layers', 'doc_too_large');
  if ((doc.captionWords?.length ?? 0) > LIMITES_DOC.captionWords) err('captionWords', 'doc_too_large');

  // aparar o vídeo inteiro é só do remix (F4)
  if (doc.trim) err('trim', 'trim_out_of_range');

  // cenas
  const clips = doc.clips ?? [];
  if (clips.length) {
    const porId = new Map(fonte.scenes.map((c) => [c.sceneId, c]));
    const contagem = new Map<string, number>();
    let totalAtivo = 0;
    let algumaAtiva = false;
    clips.forEach((c, i) => {
      const cena = porId.get(c.sceneId);
      if (!cena) { err(`clips[${i}].sceneId`, 'unknown_scene'); return; }
      contagem.set(cena.sceneId, (contagem.get(cena.sceneId) ?? 0) + 1);
      // corte de attempt antigo não é erro: a normalização volta pro clipe inteiro
      const vigente = c.attempt === cena.attempt;
      if (vigente) {
        if (!finito(c.inSec) || !finito(c.outSec) || c.inSec < 0 || c.outSec > cena.durationSec + meioFrame(fps) || c.outSec <= c.inSec) {
          err(`clips[${i}]`, 'trim_out_of_range');
          if (c.enabled) algumaAtiva = true;
          return;
        }
      }
      const k = vigente ? corteDaCena(cena.durationSec, c, fps) : { inSec: 0, outSec: cena.durationSec };
      if (vigente && Math.round((k.outSec - k.inSec) * fps) < Math.round(LIMITES_DOC.clipMinSec * fps)) err(`clips[${i}]`, 'clip_too_short');
      if (c.enabled) { algumaAtiva = true; totalAtivo += k.outSec - k.inSec; }
    });
    const cobre = fonte.scenes.every((s) => contagem.get(s.sceneId) === 1) && [...contagem.values()].every((n) => n === 1);
    if (!cobre) err('clips', 'clips_must_cover_scenes');
    if (!algumaAtiva) err('clips', 'no_enabled_clip');
    else if (totalAtivo > 0 && Math.round(totalAtivo * fps) < Math.round(LIMITES_DOC.videoMinSec * fps)) err('clips', 'video_too_short');
  }

  // camadas
  (doc.layers ?? []).forEach((l, i) => {
    const f = `layers[${i}]`;
    if (!l || !ehCamadaDoZero(l.id)) { err(`${f}.id`, 'unknown_layer'); return; }
    if (typeof l.text === 'string' && l.text.length > LIMITES_DOC.text) err(`${f}.text`, 'doc_too_large');
    const s = l.style;
    if (!s) return;
    if (s.fontId !== undefined && !fonteValida(s.fontId)) err(`${f}.style.fontId`, 'unknown_font');
    if (s.color !== undefined && !corValida(s.color)) err(`${f}.style.color`, 'bad_color');
    if (s.highlightColor !== undefined && s.highlightColor !== null && !corValida(s.highlightColor)) err(`${f}.style.highlightColor`, 'bad_color');
    if (s.strokeColor !== undefined && s.strokeColor !== null && !corValida(s.strokeColor)) err(`${f}.style.strokeColor`, 'bad_color');
    if (s.background && s.background.color !== undefined && s.background.color !== null && !corValida(s.background.color)) err(`${f}.style.background.color`, 'bad_color');
  });

  // correção de palavra: chave da geração vigente; attempt antigo não é erro (cai na normalização)
  const porId = new Map(fonte.scenes.map((c) => [c.sceneId, c]));
  (doc.captionWords ?? []).forEach((w, i) => {
    const k = typeof w?.key === 'string' ? lerChavePalavra(w.key) : null;
    const cena = k && porId.get(k.sceneId);
    if (!k || !cena || (cena.attempt === k.attempt && k.wordIndex >= cena.words.length)) err(`captionWords[${i}].key`, 'unknown_word');
    else if (typeof w.text === 'string' && w.text.length > LIMITES_DOC.text) err(`captionWords[${i}].text`, 'doc_too_large');
  });
  return erros;
};

// ---- Normalização (§5.4) -------------------------------------------------------------------------------------------
const igualJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Forma canônica que o PUT devolve: corta in/out pro clipe e arredonda pra frame, descarta corte e correção de cena
 * regerada (attempt) ou desconhecida, põe no fim as cenas novas (ativas), tira campos/camadas iguais ao padrão.
 * `clips` que só repete a ordem original inteira e ativa vira []. Doc que sobra vazio = null (= render de hoje).
 * `settings` (opcional, extensão do §7.2): com ele, `style`/`transform`/`timing`/`text` iguais ao padrão do template também saem.
 */
export const normalizarDoc = (doc: EditDoc | null | undefined, fonte: ScratchSource, settings?: EditSettingsLike): EditDoc | null => {
  if (!doc) return null;
  const fps = fonte.fps || FPS;
  const ordemOriginal = [...fonte.scenes].sort((a, b) => a.index - b.index);
  const porId = new Map(fonte.scenes.map((c) => [c.sceneId, c]));

  // cenas
  let clips: EditClip[] = [];
  if (doc.clips?.length) {
    const vistas = new Set<string>();
    for (const c of doc.clips) {
      const cena = porId.get(c?.sceneId);
      if (!cena || vistas.has(cena.sceneId)) continue;
      vistas.add(cena.sceneId);
      let { inSec, outSec } = c.attempt === cena.attempt ? corteDaCena(cena.durationSec, c, fps) : { inSec: 0, outSec: cena.durationSec };
      if (outSec - inSec < LIMITES_DOC.clipMinSec - 1e-9) {
        // curto demais: estica o fim (ou recua o começo) até 0,3 s, dentro da cena
        const min = Math.ceil(LIMITES_DOC.clipMinSec * fps) / fps;
        outSec = Math.min(cena.durationSec, inSec + min);
        if (outSec - inSec < min) inSec = Math.max(0, Math.round((outSec - min) * fps) / fps);
      }
      clips.push({ sceneId: cena.sceneId, enabled: c.enabled !== false, attempt: cena.attempt, inSec, outSec });
    }
    for (const cena of ordemOriginal) if (!vistas.has(cena.sceneId)) clips.push({ sceneId: cena.sceneId, enabled: true, attempt: cena.attempt, inSec: 0, outSec: cena.durationSec });
    if (!clips.some((c) => c.enabled)) clips = clips.map((c) => ({ ...c, enabled: true }));
    const identidade = clips.length === ordemOriginal.length
      && clips.every((c, i) => c.sceneId === ordemOriginal[i].sceneId && c.enabled && c.inSec === 0 && c.outSec === ordemOriginal[i].durationSec);
    if (identidade) clips = [];
  }

  // padrão das camadas (só com settings): mesma conta do resolverProps, com as cenas já cortadas
  let padrao: ReturnType<typeof layoutPadrao> | null = null;
  if (settings && (settings.templateId === 'clean' || settings.templateId === 'bold' || settings.templateId === 'headline')) {
    const totalSec = framesDasCenas(resolverProps(fonte, settings, { version: 1, clips, trim: null, layers: [], captionWords: [] }).scenes, fps) / fps;
    padrao = layoutPadrao(settings.templateId, fonte.format, settings, totalSec);
  }

  // camadas: a última de cada id vale; campo nulo/igual ao padrão sai; camada sem nada sai
  const porCamada = new Map<CamadaDoZero, EditDocLayer>();
  for (const l of doc.layers ?? []) {
    if (!l || !ehCamadaDoZero(l.id)) continue;
    const p = padrao?.[l.id];
    const n: EditDocLayer = { id: l.id };
    if (l.visible === false) n.visible = false;
    if (l.transform) {
      const t = limitaTransform(l.transform);
      if (!p || !igualJson(t, p.transform)) n.transform = t;
    }
    if (l.timing && finito(l.timing.fromSec) && finito(l.timing.durationSec)) {
      const t = { fromSec: Math.max(0, Math.round(l.timing.fromSec * fps) / fps), durationSec: Math.max(1, Math.round(l.timing.durationSec * fps)) / fps };
      if (!p || Math.round(t.fromSec * fps) !== Math.round(p.timing.fromSec * fps) || Math.round(t.durationSec * fps) !== Math.round(p.timing.durationSec * fps)) n.timing = t;
    }
    if (typeof l.text === 'string' && l.id !== 'caption') {
      const t = l.text.slice(0, LIMITES_DOC.text);
      if (!p || t.trim() !== (p.text ?? '')) n.text = t;
    }
    if (l.style) {
      const st: Partial<LayerStyle> = {};
      const base = p?.style;
      const s = l.style;
      if (fonteValida(s.fontId) && s.fontId !== base?.fontId) st.fontId = s.fontId;
      if (corValida(s.color) && s.color !== base?.color) st.color = s.color;
      if ((s.highlightColor === null || corValida(s.highlightColor)) && s.highlightColor !== base?.highlightColor) st.highlightColor = s.highlightColor;
      if (s.background && ['none', 'box', 'pill', 'word'].includes(s.background.kind) && (s.background.color === null || corValida(s.background.color))
        && !igualJson(s.background, base?.background)) st.background = { kind: s.background.kind, color: s.background.color };
      if ((s.strokeColor === null || corValida(s.strokeColor)) && s.strokeColor !== base?.strokeColor) st.strokeColor = s.strokeColor;
      if (finito(s.strokeWidthPx) && s.strokeWidthPx !== base?.strokeWidthPx) st.strokeWidthPx = limita(s.strokeWidthPx, 0, 60);
      if (typeof s.uppercase === 'boolean' && s.uppercase !== base?.uppercase) st.uppercase = s.uppercase;
      if (typeof s.shadow === 'boolean' && s.shadow !== base?.shadow) st.shadow = s.shadow;
      if ((s.align === 'left' || s.align === 'center' || s.align === 'right') && s.align !== base?.align) st.align = s.align;
      if (Object.keys(st).length) n.style = st;
    }
    porCamada.set(l.id, n);
  }
  const layers = [...porCamada.values()].filter((l) => Object.keys(l).length > 1);

  // correções: só da geração/attempt vigente, última por chave, igual ao original sai
  const porChave = new Map<string, CaptionWordFix>();
  for (const w of doc.captionWords ?? []) {
    const k = typeof w?.key === 'string' ? lerChavePalavra(w.key) : null;
    const cena = k && porId.get(k.sceneId);
    if (!k || !cena || cena.attempt !== k.attempt || k.wordIndex >= cena.words.length || typeof w.text !== 'string') continue;
    const text = w.text.slice(0, LIMITES_DOC.text);
    const key = chavePalavra(cena.sceneId, cena.attempt, k.wordIndex);
    if (text === cena.words[k.wordIndex].word) porChave.delete(key);
    else porChave.set(key, { key, text });
  }
  const captionWords = [...porChave.values()];

  if (!clips.length && !layers.length && !captionWords.length) return null;
  return { version: 1, clips, trim: null, layers, captionWords };
};
