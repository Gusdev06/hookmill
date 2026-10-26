import { z } from 'zod';
import { FORMATOS, FPS, type VideoFormat } from './formatos';
import { rectSchema } from './remix';
import { captionsAutoSchema } from './captionsSchema';

// Template `auto-edit` (variacao-auto-v1 §7.2): a peça da variação automática. Uma coisa muda por tipo; o resto é o
// campeão recortado pelo `timeline`, reenquadrado pro formato. Props = AutoEditRenderInput sem renderId/kind/templateId.

export const AUTO_EDIT_COMPOSITION_ID = 'AutoEdit';
export const AUTO_EDIT_TEMPLATE_ID = 'auto-edit';

export const AUTO_TYPES = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH'] as const;
// rev. 23/10 (variacao-auto-v1 §14.3/§14.6): o STATIC saiu do Remotion; vira imagem do GPT Image 2 (engine IMAGE_GEN).
export type AutoType = (typeof AUTO_TYPES)[number];

/** Margens livres da UI do app (px da saída 1080 de largura). 9:16 = Reels/Stories; 4:5 e 1:1 = feed (quase nada). */
export const SAFE_AREA: Record<VideoFormat, { top: number; bottom: number }> = {
  VERTICAL_9_16: { top: 220, bottom: 380 },
  PORTRAIT_4_5: { top: 60, bottom: 90 },
  SQUARE_1_1: { top: 50, bottom: 70 },
};

const rgb = z.string().min(1);

const paramsSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CUT'), targetSec: z.union([z.literal(15), z.literal(20)]) }),
  z.object({ type: z.literal('COLD_OPEN'), teaserSec: z.number().positive() }),
  z.object({
    type: z.literal('HOOK_TEXT'), text: z.string().min(1), endSec: z.number().positive(), box: rectSchema,
    cover: z.object({ box: rectSchema, color: rgb }).nullable(),
  }),
  z.object({
    type: z.literal('ENDCARD'), variant: z.enum(['offer', 'guarantee', 'price', 'cta']), headline: z.string().min(1),
    subline: z.string().nullable(), ctaText: z.string().min(1), durationSec: z.literal(2), background: rgb,
  }),
  z.object({
    type: z.literal('SPLIT_LP'),
    top: z.object({ imageUrl: z.string().min(1), kind: z.enum(['page', 'product_photo']), scroll: z.boolean() }),
    ratio: z.literal(0.5),
  }),
  z.object({ type: z.literal('STORY'), handle: z.string().min(1), timeAgo: z.string(), replyLabel: z.string(), bars: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({
    type: z.literal('REVIEW'), quote: z.string().min(1), author: z.string().nullable(),
    stars: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(), ratio: z.literal(0.42),
  }),
  z.object({ type: z.literal('NATIVE_SEARCH'), query: z.string().min(1), introSec: z.number().min(1).max(4), typingCps: z.literal(14), placeholder: z.string() }),
]);

export const autoEditSchema = z.object({
  /** legado (transição do §14.5): só 'video'. 'still' (STATIC) foi aposentado e falha na validação. */
  output: z.literal('video').optional(),
  format: z.enum(['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1']),
  language: z.string(),
  source: z.object({
    /** URL http(s) assinada; em dev, caminho relativo a public/ */
    videoUrl: z.string().min(1),
    width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(),
    durationSec: z.number().positive(), hasAudio: z.boolean(),
  }),
  reframe: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('cover'), focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }) }),
    z.object({ mode: z.literal('contain_blur') }),
  ]),
  timeline: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().positive() })).min(1),
  joinFadeMs: z.number().min(0),
  safeArea: z.object({ top: z.number().min(0), bottom: z.number().min(0) }),
  palette: z.array(z.string()),
  brandName: z.string(),
  type: z.enum(AUTO_TYPES),
  params: paramsSchema,
  /** legenda automática (headline-e-legenda-v1 §2, campeão sem legenda queimada): terço de baixo, acima da UI do formato */
  captions: captionsAutoSchema.optional(),
});

export type AutoEditProps = z.infer<typeof autoEditSchema>;
export type AutoEditParamsProps = z.infer<typeof paramsSchema>;
export type AutoReframe = AutoEditProps['reframe'];

/** Trechos do timeline em frames da saída (30 fps): cada um com o 1º frame do campeão e o nº de frames. Arredonda as
 *  bordas na grade da saída (a soma é a duração exata da peça, sem buraco). */
export const trechosEmFrames = (timeline: AutoEditProps["timeline"], fps: number = FPS) => {
  let em = 0;
  return timeline.map((t) => {
    const from = Math.round(t.startSec * fps);
    const frames = Math.max(1, Math.round(t.endSec * fps) - from);
    const r = { at: em, from, frames };
    em += frames;
    return r;
  });
};

/** Frames do end card (ENDCARD). */
export const endCardFrames = (p: AutoEditProps, fps: number = FPS) => (p.params.type === 'ENDCARD' ? Math.round(p.params.durationSec * fps) : 0);

/** Duração da peça em frames: soma do timeline (+2 s no ENDCARD). */
export const duracaoAutoEdit = (p: AutoEditProps, fps: number = FPS) =>
  trechosEmFrames(p.timeline, fps).reduce((n, t) => n + t.frames, 0) + endCardFrames(p, fps);

/** Valida e confere: params do tipo certo, timeline dentro do campeão. */
export const propsDeAutoEditInput = (input: AutoEditProps & Record<string, unknown>): AutoEditProps => {
  const { renderId: _r, kind: _k, templateId: _t, ...resto } = input as AutoEditProps & { renderId?: string; kind?: string; templateId?: string };
  const p = autoEditSchema.parse(resto);
  if (p.params.type !== p.type) throw new Error(`params.type ${p.params.type} != type ${p.type}`);
  const dur = p.source.durationSec + 0.05;
  for (const [i, t] of p.timeline.entries()) {
    if (!(t.endSec > t.startSec) || t.endSec > dur) throw new Error(`timeline ${i}: ${t.startSec}-${t.endSec} fora de 0-${p.source.durationSec}`);
  }
  return p;
};

// ───────────────────────── reenquadramento (§7.2) ─────────────────────────

type Box = { x: number; y: number; w: number; h: number };
/** O que o reenquadramento precisa do EditMap (estrutural: o pacote video não depende do @maquina/contratos). */
export interface EditMapLike {
  width: number; height: number; frameCount: number;
  faceTrack: { startFrame: number; endFrame: number; region: Box; faceInRegion: { atFrame: number; box: Box }[]; role?: string }[];
  layers: { box: Box; startFrame: number; endFrame: number }[];
}

/** Centro do rosto principal (px do campeão): mediana ponderada pela duração dos trechos `main` do faceTrack. */
export const centroDoRosto = (m: EditMapLike | null): { x: number; y: number } | null => {
  const segs = (m?.faceTrack ?? []).filter((s) => (s.role ?? 'main') === 'main' && s.faceInRegion.length);
  if (!segs.length) return null;
  let sx = 0, sy = 0, n = 0;
  for (const s of segs) {
    const f = s.faceInRegion[0].box;
    const peso = Math.max(1, s.endFrame - s.startFrame);
    sx += (s.region.x + (f.x + f.w / 2) * s.region.w) * peso;
    sy += (s.region.y + (f.y + f.h / 2) * s.region.h) * peso;
    n += peso;
  }
  return { x: sx / n, y: sy / n };
};

/** Janela (px do campeão) que o `cover` mostra numa caixa de aspecto `aspecto` (w/h), centrada em `foco` (0-1) e presa
 *  ao quadro. Igual ao que o componente pinta (objectFit cover + deslocamento). */
export const janelaCover = (src: { width: number; height: number }, aspecto: number, foco: { x: number; y: number }): Box => {
  const srcAsp = src.width / src.height;
  const w = srcAsp > aspecto ? src.height * aspecto : src.width;
  const h = srcAsp > aspecto ? src.height : src.width / aspecto;
  const x = Math.min(src.width - w, Math.max(0, foco.x * src.width - w / 2));
  const y = Math.min(src.height - h, Math.max(0, foco.y * src.height - h / 2));
  return { x, y, w, h };
};

const dentro = (a: Box, b: Box, tol = 2) => a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;

/**
 * §7.2 reframeFor(format, source, editMap): `cover` centrado no rosto quando todas as camadas de texto queimadas do original
 * cabem na janela de corte; senão `contain_blur`. Mesma proporção (ex.: 9:16 → 9:16) = cover sem corte. Sem rosto medido:
 * foco no centro (um pouco acima, onde o rosto costuma estar). Determinístico.
 */
export const reframeFor = (format: VideoFormat, source: { width: number; height: number }, editMap: EditMapLike | null): AutoReframe => {
  const { width: W, height: H } = FORMATOS[format];
  const aspecto = W / H;
  const c = centroDoRosto(editMap);
  // o mapa pode estar noutra grade (análise reduzida): escala pro tamanho do arquivo
  const ex = editMap ? source.width / editMap.width : 1;
  const ey = editMap ? source.height / editMap.height : 1;
  const foco = c ? { x: (c.x * ex) / source.width, y: (c.y * ey) / source.height } : { x: 0.5, y: 0.4 };
  const focus = { x: Math.round(foco.x * 1000) / 1000, y: Math.round(foco.y * 1000) / 1000 };
  if (Math.abs(source.width / source.height - aspecto) / aspecto < 0.01) return { mode: 'cover', focus };
  const janela = janelaCover(source, aspecto, focus);
  const camadas = (editMap?.layers ?? []).map((l) => ({ x: l.box.x * ex, y: l.box.y * ey, w: l.box.w * ex, h: l.box.h * ey }));
  return camadas.every((b) => dentro(b, janela)) ? { mode: 'cover', focus } : { mode: 'contain_blur' };
};

/** Onde um retângulo do campeão (px do arquivo) cai na saída (px), dado o reenquadramento numa caixa `alvo` da saída. */
export const mapearCaixa = (r: Box, source: { width: number; height: number }, reframe: AutoReframe, alvo: Box): Box => {
  const asp = alvo.w / alvo.h;
  if (reframe.mode === 'cover') {
    const j = janelaCover(source, asp, reframe.focus);
    const s = alvo.w / j.w;
    return { x: alvo.x + (r.x - j.x) * s, y: alvo.y + (r.y - j.y) * s, w: r.w * s, h: r.h * s };
  }
  const s = Math.min(alvo.w / source.width, alvo.h / source.height);
  const ox = alvo.x + (alvo.w - source.width * s) / 2, oy = alvo.y + (alvo.h - source.height * s) / 2;
  return { x: ox + r.x * s, y: oy + r.y * s, w: r.w * s, h: r.h * s };
};
