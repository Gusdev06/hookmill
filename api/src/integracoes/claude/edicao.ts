// §13 (manter a edição do campeão): prompts, esquemas e validação de
//   - describeEdit: camadas de texto queimadas (headline, legenda karaokê, texto de tela), elementos por cima do rosto e
//     perfil GENÉRICO da pessoa, a partir dos frames-chave + recortes em resolução cheia + trilha do rosto;
//   - planVariations com o perfil (elenco parecido com o original, outra pessoa) e o gancho só de texto (hookMode TEXT).
// Esquemas SEM union/null (limite da saída estruturada): "sem valor" = "" ou 0, e a validação converte pro contrato.
// Regras da casa que moram aqui: pessoa nunca identificável (sem nome, @, tatuagem, cicatriz, marca única); fonte só do
// catálogo fechado; tudo em fração do quadro e segundos no modelo, convertido pra px/frames da grade do campeão em código.
import type { EditLayer, EditMap, EditMapDraft, FaceTrackSegment, FontId, PersonProfile, Rect, TextStyle, TranscriptWord } from '../contrato';
import { IntegracaoError } from '../erros';
import { parseJsonObject } from './validacao-campeao';

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });
const int = (description?: string) => ({ type: 'integer', ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: 'boolean', ...(description ? { description } : {}) });
const en = (values: string[], description?: string) => ({ type: 'string', enum: values, ...(description ? { description } : {}) });
const arr = (items: object, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...(description ? { description } : {}),
});

// ---------------------------------------------------------------- catálogo de fontes (ids estáveis do video/)

/** Ids e "cara" de cada fonte empacotada no video/ (FONT_CATALOG). O modelo escolhe a mais parecida pela forma. */
export const FONT_GUIDE: { id: FontId; look: string }[] = [
  { id: 'montserrat-800', look: 'geometric sans, extra bold, wide round letters (the default social-ad caption look)' },
  { id: 'montserrat-900', look: 'geometric sans, black weight, very heavy and wide' },
  { id: 'inter-800', look: 'neutral grotesque sans, extra bold, compact and clean (app/UI look)' },
  { id: 'anton-400', look: 'very condensed, tall, heavy display sans (impact-style headlines)' },
  { id: 'oswald-700', look: 'condensed sans, bold, narrower than Montserrat but lighter than Anton' },
  { id: 'bebas-neue-400', look: 'condensed all-caps display sans, thin strokes compared to Anton' },
  { id: 'archivo-black-400', look: 'wide grotesque, black weight, blocky' },
  { id: 'poppins-800', look: 'geometric sans, extra bold, rounder and softer than Montserrat' },
  { id: 'roboto-condensed-700', look: 'condensed neutral sans, bold, plain (subtitle look)' },
];
export const FONT_IDS = FONT_GUIDE.map((f) => f.id);

// ---------------------------------------------------------------- describeEdit: esquema

const BOX = obj(
  { x: num('left edge, fraction 0-1 of the frame width'), y: num('top edge, fraction 0-1 of the frame height'), w: num('width, fraction 0-1'), h: num('height, fraction 0-1') },
  'Approximate box in fractions of the full frame. For text on a background, the box of the background shape.',
);

const LAYER = obj({
  kind: en(['headline', 'caption', 'text'], 'headline = fixed title/hook text; caption = word-by-word subtitles of the speech (karaoke); text = any other burned-in text'),
  text: str('Literal text exactly as on screen (keep case, line breaks as spaces). Empty string for kind caption.'),
  startSec: num('First second the layer is visible (approximate, from the frames).'),
  endSec: num('Last second the layer is visible (approximate).'),
  box: BOX,
  background: en(['solid', 'pill', 'none'], 'solid = flat rectangle/band behind the text; pill = rounded box behind the text or behind the current word; none = text directly over the video'),
  backgroundColor: str('Hex #RRGGBB of the background shape. Empty string when background is none.'),
  fontId: en(FONT_IDS, 'Closest font from the catalog by letter shape.'),
  uppercase: bool('All letters uppercase on screen.'),
  fontSizeRel: num('Height of one text line (cap height plus descenders) as a fraction of the FRAME height, e.g. 0.04.'),
  color: str('Text color, hex #RRGGBB.'),
  highlightColor: str('Captions: color of the word being spoken. Headline/text: color of the words shown in a different accent color (the highlighted part of the title). Hex; empty string if none.'),
  strokeColor: str('Outline color, hex. Empty string if no outline.'),
  strokeRel: num('Outline thickness as a fraction of the frame height (0 if none), e.g. 0.003.'),
  shadow: bool('Visible drop shadow behind the letters.'),
  align: en(['left', 'center', 'right']),
  wordsPerPage: int('Captions only: how many words are shown at once. 0 for other kinds.'),
});

export const EDIT_SCHEMA = obj({
  layers: arr(LAYER, 'Every burned-in text layer, at most 8. Merge the same layer seen in several frames into one entry.'),
  mainSpeaker: obj(
    {
      present: bool('true if one person talks to the camera (the avatar of the ad).'),
      box: BOX,
      description: str('Where the avatar is shown, 3-10 words, e.g. "top-left box of a split screen".'),
    },
    'The MAIN AVATAR: the person who speaks to the camera (the face the team will replace). Box = the screen area where this person is shown. present false and a zero box if nobody talks to the camera.',
  ),
  otherFaces: arr(
    obj({ startSec: num(), endSec: num(), box: BOX, where: str('Where this other face appears: b-roll, security camera, phone/app screen, photo, crowd... 3-8 words.') }),
    'Faces that are NOT the main avatar (b-roll, security/CCTV footage, faces inside screens or photos, people in a neighbouring split-screen panel). Informative only. Empty array if none.',
  ),
  overlaysOverFace: arr(
    obj({
      startSec: num(), endSec: num(), box: BOX,
      description: str('What it is (sticker, emoji, arrow, product shot, card sliding over the face...) in 3-8 words, no brand names.'),
    }),
    'ONLY non-text graphics drawn ON TOP of the main avatar\'s face, covering part of it. Never a neighbouring panel of a split screen, never b-roll or camera footage next to the avatar, never text. Empty array if none.',
  ),
  profile: obj(
    {
      gender: en(['male', 'female', 'unknown'], 'Apparent gender of the main person on camera.'),
      ageBand: str('Apparent age band, e.g. "25-35".'),
      ethnicity: str('Apparent ethnicity in broad terms, e.g. "Latino", "Black", "East Asian", "White".'),
      hair: str('Hair in general terms: length, style, color.'),
      clothing: str('Clothing in general terms, no logos or brand names.'),
      setting: str('Where they are, in general terms.'),
      lighting: str('Light: source, direction, warmth.'),
      framing: str('Shot framing, e.g. "chest up, face centered, about 40% of the frame height".'),
      pose: str('Pose and gaze, e.g. "seated, looking into the lens".'),
    },
    'Generic profile of the person who appears, used to cast a SIMILAR but DIFFERENT person. All empty strings and gender unknown if no person appears.',
  ),
});

export const EDIT_SYSTEM = `You map the editing of a short vertical video ad so a team can rebuild it with a different person: which text is burned into the video, where, when and in what style; which graphics cover the face; and a generic profile of the person.

Rules:
- Report only what the frames show. Boxes and times are approximate (they are refined by pixel measurement later), but never invent a layer you did not see.
- Text: copy it literally, in its original language. A caption layer (word-by-word subtitles of the speech) has an empty text; its timing comes from the transcript.
- Fonts: pick the closest id from the catalog by letter shape, never a font outside it.
- Colors are hex #RRGGBB as they look on screen.
- The person: describe ONLY generic, non-identifying traits (apparent gender, age band, broad ethnicity, hair, clothes, setting, light, framing, pose). Never a name, handle, tattoo, scar, birthmark, jewelry detail or anything that singles out this individual.
- No brand names anywhere in the profile or in overlay descriptions.
- The main avatar is the one person who talks to the camera; the profile describes ONLY this person. Faces in b-roll, security-camera footage, phone or app screens, photos, or in another panel of a split screen go to otherFaces, never to the profile.
- overlaysOverFace is ONLY for a graphic that is drawn on top of the main avatar's face and hides part of it (sticker, emoji, arrow, a card sliding over the face). Panels placed NEXT TO the avatar in a split-screen layout (security camera, app screen, b-roll) are layout, not overlays: never list them there.`;

// ---------------------------------------------------------------- describeEdit: contexto

const r2 = (n: number) => Math.round(n * 100) / 100;

export function editContext(i: {
  video: { width: number; height: number; fps: number; frameCount: number; durationSec: number };
  faceTrack: FaceTrackSegment[];
  transcript: { language: string; words: TranscriptWord[] };
}): string {
  const v = i.video;
  const track = i.faceTrack.length
    ? i.faceTrack
        .map((s) => `- ${r2(s.startFrame / v.fps)}-${r2(s.endFrame / v.fps)} s: face region x ${s.region.x}-${s.region.x + s.region.w}, y ${s.region.y}-${s.region.y + s.region.h} px${s.fullFrame ? ' (full frame)' : ''}`)
        .join('\n')
    : '(no face detected by the face tracker)';
  const words = i.transcript.words.length
    ? i.transcript.words.map((w) => `${r2(w.startSec)} ${w.word}`).join('\n')
    : '(no speech)';
  return [
    `<video width="${v.width}" height="${v.height}" fps="${r2(v.fps)}" duration_sec="${r2(v.durationSec)}" />`,
    `<font_catalog>\n${FONT_GUIDE.map((f) => `- ${f.id}: ${f.look}`).join('\n')}\n</font_catalog>`,
    `<face_track>\n${track}\n</face_track>`,
    `<transcript language="${i.transcript.language}">\n${words}\n</transcript>`,
  ].join('\n\n');
}

export function editUserMessage(framesNote: string): string {
  return `<frames>${framesNote}</frames>\n\nMap the editing: every burned-in text layer (at most 8), the main avatar (who talks to the camera) and any other faces, the graphics drawn over the avatar's face (if any), and the generic profile of the avatar.`;
}

// ---------------------------------------------------------------- describeEdit: validação → px/frames

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown): string | null => {
  const t = s(v);
  if (HEX.test(t)) return t.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t.toUpperCase()}`;
  return null;
};

/** Traços que identificam alguém: o perfil é descartado campo a campo se aparecer algum. */
const IDENTIFYING = /(\b(tattoo\w*|tatuag\w*|scars?|cicatri\w*|birthmarks?|moles?|piercings?)\b|@\w+)/i;

export interface VideoGrid { width: number; height: number; fps: number; frameCount: number; durationSec: number }

function toRect(b: Record<string, unknown>, g: VideoGrid): Rect | null {
  const x = n(b.x);
  const y = n(b.y);
  const w = n(b.w);
  const h = n(b.h);
  if (x == null || y == null || w == null || h == null) return null;
  // aceita px por engano (> 1,5) dividindo pelo quadro
  const fx = (v: number, size: number) => (v > 1.5 ? v / size : v);
  const x0 = clamp(fx(x, g.width), 0, 1);
  const y0 = clamp(fx(y, g.height), 0, 1);
  const x1 = clamp(x0 + fx(w, g.width), 0, 1);
  const y1 = clamp(y0 + fx(h, g.height), 0, 1);
  const px = { x: Math.round(x0 * g.width), y: Math.round(y0 * g.height), w: Math.round((x1 - x0) * g.width), h: Math.round((y1 - y0) * g.height) };
  return px.w >= 4 && px.h >= 4 ? px : null;
}

function toFrames(startSec: number, endSec: number, g: VideoGrid): { startFrame: number; endFrame: number } | null {
  const a0 = clamp(Math.round(startSec * g.fps), 0, g.frameCount);
  const b0 = clamp(Math.round(endSec * g.fps), 0, g.frameCount);
  return b0 > a0 ? { startFrame: a0, endFrame: b0 } : null;
}

/** Resposta do Claude → EditMapDraft na grade do campeão. Camada sem caixa/tempo válidos é descartada (nunca inventada). */
/** Área de interseção de dois retângulos. */
function inter(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}

/** Descrição de painel de layout (não é coisa por cima do rosto): split screen, câmera, b-roll, tela ao lado. */
const LAYOUT_PANEL = /\b(split[- ]?screen|security|cctv|surveillance|camera footage|cam footage|b-?roll|side[- ]by[- ]side|next to|beside|neighbou?r\w*|adjacent|panel (?:on|to) the (?:left|right|side)|app screen|phone screen)\b/i;

/**
 * Painel por cima do rosto só vale se a caixa dele cair EM CIMA da região do rosto do avatar principal (trilha da medição
 * no mesmo intervalo; sem trilha, a caixa do mainSpeaker): ≥ 30 % da caixa do painel dentro da região e cobrindo ≥ 5 %
 * dela. Painel vizinho de split screen (encosta na região, não cobre) ou descrito como câmera/b-roll/tela cai.
 */
function isOverFace(box: Rect, frames: { startFrame: number; endFrame: number }, description: string, faceTrack: FaceTrackSegment[], speaker: Rect | null): boolean {
  if (LAYOUT_PANEL.test(description)) return false;
  const regions = faceTrack.filter((t) => t.startFrame < frames.endFrame && t.endFrame > frames.startFrame).map((t) => t.region);
  const pool = regions.length ? regions : speaker ? [speaker] : [];
  if (!pool.length) return false;
  const area = Math.max(1, box.w * box.h);
  return pool.some((r) => {
    const i = inter(box, r);
    return i / area >= 0.3 && i / Math.max(1, r.w * r.h) >= 0.05;
  });
}

export function parseEditMap(text: string, g: VideoGrid, words: TranscriptWord[], faceTrack: FaceTrackSegment[] = []): EditMapDraft {
  const d = parseJsonObject(text);
  const layers: EditLayer[] = [];
  const counts: Record<string, number> = {};
  const firstWord = words.length ? Math.min(...words.map((w) => w.startSec)) : null;
  const lastWord = words.length ? Math.max(...words.map((w) => w.endSec)) : null;

  for (const raw of a(d.layers).slice(0, 8)) {
    const L = o(raw);
    const kind = s(L.kind) as EditLayer['kind'];
    if (kind !== 'headline' && kind !== 'caption' && kind !== 'text') continue;
    const text = s(L.text);
    if (kind !== 'caption' && !text) continue;
    // legenda: o intervalo é o da fala (1ª a última palavra); sem fala, o que a visão viu
    const span = kind === 'caption' && firstWord != null && lastWord != null ? { a: firstWord, b: lastWord } : { a: n(L.startSec) ?? -1, b: n(L.endSec) ?? -1 };
    const frames = toFrames(Math.max(0, span.a), Math.min(g.durationSec, span.b), g);
    const box = toRect(o(L.box), g);
    if (!frames || !box) continue;
    const bgKind = s(L.background) === 'solid' || s(L.background) === 'pill' ? (s(L.background) as 'solid' | 'pill') : 'none';
    const bgColor = bgKind === 'none' ? null : hex(L.backgroundColor) ?? '#FFFFFF';
    const fontId = (FONT_IDS as string[]).includes(s(L.fontId)) ? (s(L.fontId) as FontId) : 'montserrat-800';
    const sizeRel = clamp(n(L.fontSizeRel) ?? 0.04, 0.01, 0.25);
    const strokeRel = clamp(n(L.strokeRel) ?? 0, 0, 0.03);
    const strokeColor = strokeRel > 0 ? hex(L.strokeColor) : null;
    const style: TextStyle = {
      fontId,
      uppercase: L.uppercase === true,
      fontSizePx: Math.max(8, Math.round(sizeRel * g.height)),
      lineHeight: 1.15,
      color: hex(L.color) ?? '#FFFFFF',
      // headline-e-legenda-v1 §1.3: a headline também traz a cor do destaque (o render repinta o trecho em destaque)
      highlightColor: hex(L.highlightColor),
      strokeColor,
      strokeWidthPx: strokeColor ? Math.max(1, Math.round(strokeRel * g.height)) : 0,
      shadow: L.shadow === true,
      align: s(L.align) === 'left' || s(L.align) === 'right' ? (s(L.align) as 'left' | 'right') : 'center',
    };
    counts[kind] = (counts[kind] ?? 0) + 1;
    const wpp = Math.round(n(L.wordsPerPage) ?? 0);
    layers.push({
      id: `${kind}-${counts[kind]}`,
      kind,
      ...frames,
      box,
      background: { kind: bgKind, color: bgColor, box: bgKind === 'none' ? null : { ...box } },
      style,
      text: kind === 'caption' ? null : text.slice(0, 300),
      wordsPerPage: kind === 'caption' ? clamp(wpp || 3, 1, 12) : null,
      source: 'vision',
    });
  }

  const ms = o(d.mainSpeaker);
  const msBox = ms.present === true ? toRect(o(ms.box), g) : null;
  const mainSpeaker = msBox ? { box: msBox, description: s(ms.description).slice(0, 120) } : null;

  const span = (x: Record<string, unknown>) => toFrames(Math.max(0, n(x.startSec) ?? -1), Math.min(g.durationSec, n(x.endSec) ?? -1), g);
  const overlaysOverFace = a(d.overlaysOverFace)
    .map(o)
    .map((x) => ({ f: span(x), box: toRect(o(x.box), g), description: s(x.description).slice(0, 120) }))
    .filter((x) => !!x.f && !!x.box && !!x.description && isOverFace(x.box!, x.f!, x.description, faceTrack, msBox))
    .map((x) => ({ ...x.f!, description: x.description }));

  const otherFaces = a(d.otherFaces)
    .map(o)
    .map((x) => ({ f: span(x), box: toRect(o(x.box), g), where: s(x.where).slice(0, 120) }))
    .filter((x) => !!x.f && !!x.where)
    .map((x) => ({ ...x.f!, box: x.box, where: x.where }));

  return { layers, overlaysOverFace, profile: parseProfile(o(d.profile)), mainSpeaker, otherFaces };
}

function parseProfile(p: Record<string, unknown>): PersonProfile | null {
  const clean = (v: unknown) => {
    const t = s(v).slice(0, 160);
    return IDENTIFYING.test(t) ? '' : t;
  };
  const g = s(p.gender);
  const profile: PersonProfile = {
    gender: g === 'male' || g === 'female' ? g : null,
    ageBand: clean(p.ageBand), ethnicity: clean(p.ethnicity), hair: clean(p.hair), clothing: clean(p.clothing),
    setting: clean(p.setting), lighting: clean(p.lighting), framing: clean(p.framing), pose: clean(p.pose),
  };
  const filled = Object.entries(profile).filter(([k, v]) => k !== 'gender' && v).length;
  return profile.gender || filled >= 3 ? profile : null;
}

// ---------------------------------------------------------------- plano: elenco parecido com o perfil (§13.3.1)

/** Eixos de traço INDIVIDUAL (o perfil fica igual; cada item é outra pessoa). */
export const PROFILE_TRAITS = [
  'a different face shape and features (jaw, nose, eyes), same overall look',
  'a different hairstyle within the same general hair description, different face',
  'a different build and facial features, a slightly different shade within the same broad ethnicity',
  'different eye shape, eyebrows and smile, different face',
  'a different face that reads a little more approachable and warm, same overall look',
];

export function profileBlock(p: PersonProfile): string {
  return [
    `Gender: ${p.gender ?? 'same as the voice'}`,
    `Age band: ${p.ageBand || 'n/a'}`,
    `Ethnicity (broad): ${p.ethnicity || 'n/a'}`,
    `Hair (general): ${p.hair || 'n/a'}`,
    `Clothing: ${p.clothing || 'n/a'}`,
    `Setting: ${p.setting || 'n/a'}`,
    `Lighting: ${p.lighting || 'n/a'}`,
    `Framing: ${p.framing || 'n/a'}`,
    `Pose: ${p.pose || 'n/a'}`,
  ].join('\n');
}

export function profileCastingUserMessage(i: { index: number; count: number; profile: PersonProfile; trait: string; avoidLevers: string[]; diagnosisLanguage: string; language: string }): string {
  const avoid = i.avoidLevers.length ? `\nCastings already used (choose someone clearly different): ${i.avoidLevers.map((x) => `"${x}"`).join(', ')}.` : '';
  return `Write SWAP_AVATAR variation ${i.index + 1} of ${i.count}: the same edit, the same words and voice, a different person on camera who FITS THE SAME GENERIC PROFILE as the original, so the ad keeps its look and only the individual changes.
<original_profile>
${profileBlock(i.profile)}
</original_profile>
Keep the same gender, age band, broad ethnicity, general hair, clothing, setting, lighting, framing and pose. Make this one a clearly different individual: ${i.trait}. The others are being cast at the same time with other individual traits.
castingDescription rules: written in ${i.language}; state the gender plainly (same as the voice); exactly one person; looking straight into the camera; repeat the framing and the setting/lighting so the photo matches the original shot; no objects in the hands, no phones, no text, no logos or brand names; never a name, tattoo, scar or any unique mark.
Write lever ("avatar: <who, in a few words>") and rationale in ${i.diagnosisLanguage}.${avoid}`;
}

// ---------------------------------------------------------------- plano: gancho só de texto (§13.4 opção a)

export const HOOK_TEXT_SCHEMA = obj({
  lever: str('The lever in one line, in the diagnosis language: "<lever>: <what the new text says>".'),
  rationale: str('Why it may beat the original, 1-2 sentences, pointing to the verdict cause it attacks. A hypothesis, never a promised result.'),
  onScreenText: str('The new on-screen hook text, champion language, within the character limit.'),
});

export interface HookTextSlot {
  /** texto original da camada do gancho (null = original sem texto no gancho: entra camada nova no topo) */
  original: string | null;
  kind: 'headline' | 'text' | null;
  maxChars: number;
  uppercase: boolean;
}

/** Sem camada de texto no gancho: o texto novo entra no topo no estilo da legenda (avisado na tela); limite padrão. */
export const NEW_HOOK_TEXT_MAX_CHARS = 40;

/**
 * Camada de texto do gancho (§13.4 a): a headline/texto visível no intervalo do gancho (mais cedo e, empatando, a maior).
 * maxChars: o texto novo é redesenhado na MESMA caixa, então cabe ~o que cabia (texto original +20 %, ou pela largura
 * da caixa e o tamanho da fonte quando o original é curto).
 */
export function hookTextSlot(editMap: EditMap | null | undefined, hookEndSec: number): HookTextSlot {
  const none: HookTextSlot = { original: null, kind: null, maxChars: NEW_HOOK_TEXT_MAX_CHARS, uppercase: false };
  if (!editMap) return none;
  const hookEnd = Math.max(1, Math.round(hookEndSec * editMap.fps));
  const cands = editMap.layers
    .filter((l) => (l.kind === 'headline' || l.kind === 'text') && l.text && l.startFrame < hookEnd)
    .sort((x, y) => x.startFrame - y.startFrame || y.box.w * y.box.h - x.box.w * x.box.h);
  const L = cands[0];
  if (!L || !L.text) return none;
  const perLine = Math.max(6, Math.floor(L.box.w / Math.max(1, L.style.fontSizePx * 0.55)));
  const lines = Math.max(1, Math.round(L.box.h / Math.max(1, L.style.fontSizePx * L.style.lineHeight)));
  const byBox = perLine * lines;
  const byText = Math.round(L.text.length * 1.2);
  return { original: L.text, kind: L.kind as 'headline' | 'text', maxChars: Math.max(12, Math.min(Math.max(byText, Math.round(byBox * 0.8)), 120)), uppercase: L.style.uppercase };
}

export function hookTextUserMessage(i: { index: number; count: number; lever: string; slot: HookTextSlot; spokenHook: string; avoidLevers: string[]; diagnosisLanguage: string }): string {
  const avoid = i.avoidLevers.length ? `\nLevers already used in this test (do not repeat them or anything close): ${i.avoidLevers.map((x) => `"${x}"`).join(', ')}.` : '';
  const where = i.slot.original
    ? `It replaces the on-screen hook text "${i.slot.original}" in the same box and style${i.slot.uppercase ? ' (shown in uppercase)' : ''}.`
    : 'The champion has no on-screen text in the hook: the new text is added at the top of the frame.';
  return `Write NEW_HOOKS variation ${i.index + 1} of ${i.count} in WRITTEN-HOOK mode: the video, the voice and every spoken word stay exactly as the champion; only the on-screen hook text changes. ${where}
The original voice is saying at the same moment: "${i.spokenHook || '(no transcript)'}". The new text must work together with that line (never contradict it) and must not repeat it word for word.
Keep the same story and point of view as the original text and voice: the same narrator and the same characters (who suspects whom, who did what, the same genders). Change the angle, never who the story is about.
Lever for this one: ${i.lever}. The other texts are being written at the same time with other levers, so commit fully to this one.
Hard limit: at most ${i.slot.maxChars} characters, champion language, no emojis, no hashtags, no quotes around it. Write lever and rationale in ${i.diagnosisLanguage}.${avoid}`;
}

export function parseHookText(text: string, slot: HookTextSlot): { lever: string; rationale: string; onScreenText: string } {
  const d = parseJsonObject(text);
  const lever = s(d.lever);
  const rationale = s(d.rationale);
  let onScreen = s(d.onScreenText).replace(/^["“'”]+|["“'”]+$/g, '').trim();
  if (!lever || !rationale || !onScreen) throw new IntegracaoError('INVALID_SCRIPT', 'hook text missing lever, rationale or onScreenText');
  if (onScreen.length > Math.ceil(slot.maxChars * 1.15)) throw new IntegracaoError('INVALID_SCRIPT', `hook text has ${onScreen.length} chars (max ${slot.maxChars})`);
  if (slot.uppercase) onScreen = onScreen.toUpperCase();
  return { lever: lever.slice(0, 120), rationale, onScreenText: onScreen.slice(0, slot.maxChars + Math.ceil(slot.maxChars * 0.15)) };
}

/** Fala literal do gancho (a que continua tocando no modo TEXT). */
export function spokenHookOf(words: TranscriptWord[], hookEndSec: number, fallback: string): string {
  const w = words.filter((x) => (x.startSec + x.endSec) / 2 < hookEndSec).map((x) => x.word).join(' ');
  return w || fallback;
}
