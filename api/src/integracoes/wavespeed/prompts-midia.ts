// Prompts e parâmetros dos modelos de mídia. Aqui moram as armadilhas que a operação já pagou pra aprender:
// - Pruna inventa 2ª pessoa, mão na lente, celular, moldura de "foto no papel", e troca de pessoa depois do
//   frame 0 → "SOLO SHOT", tudo em POSITIVO, sem citar o objeto proibido, identidade travada, seed 7 (19/19 limpos).
// - Não pedir ao Pruna pose diferente da imagem (ele reimagina a cena).
// - Rosto centrado e enquadrado do peito pra cima, porque o recorte de 4:5 / 1:1 é centrado no rosto.
import type { HeadlinePlacement, StaticAspect, StaticImageSpec, StaticStyle, VideoFormat } from '../contrato';

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai' };

export function languageName(bcp47: string): string {
  const base = bcp47.toLowerCase().split('-')[0];
  if (bcp47.toLowerCase() === 'pt-br') return 'Brazilian Portuguese';
  return LANGUAGE_NAMES[base] ?? bcp47;
}

/** language_boost da MiniMax (lista fechada do schema). */
export function minimaxLanguage(bcp47: string): string {
  const base = bcp47.toLowerCase().split('-')[0];
  const map: Record<string, string> = { en: 'English', pt: 'Portuguese', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', nl: 'Dutch', pl: 'Polish', tr: 'Turkish', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', uk: 'Ukrainian', ro: 'Romanian', el: 'Greek', cs: 'Czech', fi: 'Finnish', bg: 'Bulgarian', da: 'Danish', he: 'Hebrew', ms: 'Malay', fa: 'Persian', sk: 'Slovak', sv: 'Swedish', hr: 'Croatian', fil: 'Filipino', hu: 'Hungarian', no: 'Norwegian', sl: 'Slovenian', ca: 'Catalan', ta: 'Tamil', af: 'Afrikaans' };
  return map[base] ?? 'auto';
}

/** Código ISO 639-1 do Whisper (o schema aceita "pt", não "pt-BR"). */
export function whisperLanguage(bcp47: string): string {
  const base = bcp47.toLowerCase().split('-')[0];
  return /^[a-z]{2,3}$/.test(base) ? base : 'auto';
}

export function aspectOf(format: VideoFormat): '9:16' | '4:5' | '1:1' {
  return format === 'PORTRAIT_4_5' ? '4:5' : format === 'SQUARE_1_1' ? '1:1' : '9:16';
}

/** Seedance aceita 9:16, 3:4, 1:1 (sem 4:5): 4:5 sai em 3:4 e o render corta. */
export function seedanceAspect(format: VideoFormat): '9:16' | '3:4' | '1:1' {
  return format === 'PORTRAIT_4_5' ? '3:4' : format === 'SQUARE_1_1' ? '1:1' : '9:16';
}

// ---------------------------------------------------------------- rosto (Higgsfield Soul V2; antes gpt-image-2)

/**
 * O rosto nasce sempre 9:16: é a imagem inicial de todas as cenas (Kling segue a proporção da imagem) e os
 * formatos 4:5 e 1:1 saem por recorte centrado no rosto.
 */
/** Abertura do prompt do rosto pelo aspecto (§13.3: rosto no aspecto da região do campeão). */
export function photoKind(aspect?: string): string {
  if (!aspect || aspect === '9:16' || aspect === '2:3' || aspect === '3:4') return 'Vertical smartphone photo.';
  if (aspect === '1:1') return 'Square smartphone photo.';
  return 'Horizontal smartphone photo.';
}

export function facePrompt(description: string, aspect?: string): string {
  return [
    `${photoKind(aspect)} SOLO SHOT of exactly one person: ${description.trim().replace(/\s+/g, ' ')}`,
    'Framed from the chest up, the face centered in the frame and looking straight into the camera lens, both arms relaxed at the sides and out of frame.',
    'Realistic, natural light, real skin texture, sharp focus on the face, a believable everyday setting softly out of focus behind them.',
    'No text, no watermark, no logos, no borders.',
  ].join(' ');
}

// ---------------------------------------------------------------- cena com áudio nativo (Kling 3.0 / Seedance)

/**
 * Fala no formato de diálogo do Kling 3.0 (skill kling-3-prompt, references/dialogo.md): ação âncora ANTES da fala,
 * rótulo estruturado com tom e idioma, fala entre aspas no idioma da oferta, resto do prompt em inglês.
 * O áudio nativo só sai com `sound: true` (Kling, padrão desligado) / `generate_audio: true` (Seedance).
 */
export function scenePrompt(i: { visualPrompt: string; speech: string; language: string }): string {
  const visual = i.visualPrompt.trim().replace(/\.$/, '');
  const speech = i.speech.trim().replace(/"/g, '”');
  const lock = 'The person in the image stays exactly the same person from the first frame to the last: same face, same hair, same clothes. They are the only person in the shot.';
  if (!speech) return `${visual}. ${lock} They look at the camera with a natural expression and do not speak. Quiet room tone, no music.`;
  const lang = languageName(i.language);
  return [
    `${visual}. ${lock}`,
    'The person looks straight into the lens and starts talking, lips moving in sync with every word.',
    `[Speaker, warm natural voice, speaking ${lang}]: "${speech}"`,
    'Only this one voice is heard, clear and close to the microphone, quiet room tone, no music.',
  ].join('\n');
}

export const SCENE_NEGATIVE = 'second person, extra people, crowd, subtitles, captions, text, watermark, logo, distorted face, extra fingers, morphing face';

// ---------------------------------------------------------------- lipsync (Pruna p-video/avatar)

/** Cláusulas do prompt visual que só falam de expressão/ritmo (o resto pode fazer o Pruna reimaginar a cena). */
const EXPRESSION = /\b(smil\w*|grin\w*|laugh\w*|serious\w*|calm\w*|confident\w*|excited\w*|energetic|warm\w*|friendly|honest|concerned|surprised|curious|knowing|eyebrow\w*|nod\w*|tilt\w*|lean\w*|expression\w*|enthusias\w*|relaxed|sincere|playful)\b/i;
const OFF_LIMITS = /\b(hand\w*|arm\w*|finger\w*|hold\w*|phone\w*|screen\w*|product\w*|camera|lens|push|zoom|pan|walk\w*|person|people|man|woman|anyone|someone|another|second|frame|text|caption\w*|logo\w*|background|room|kitchen|office|outside|outdoor\w*)\b/i;

export function lipsyncExpression(visualPrompt: string): string | null {
  const clauses = visualPrompt
    .replace(/^solo shot,?\s*/i, '')
    .split(/[,.;]/)
    .map((c) => c.trim())
    .filter((c) => c && EXPRESSION.test(c) && !OFF_LIMITS.test(c));
  return clauses.length ? clauses.slice(0, 3).join(', ') : null;
}

export function lipsyncPrompt(visualPrompt: string): string {
  const mood = lipsyncExpression(visualPrompt);
  return [
    'SOLO SHOT: one continuous full-frame shot of the person in the image, who stays exactly the same person from the first frame to the last: same face, same hairstyle, same clothes, same framing.',
    `The person talks to the camera${mood ? ` (${mood})` : ''}, with natural head movement.`,
    'Both arms hang relaxed at the sides, completely out of frame, for the whole clip, and nothing is held in front of the person or shown to the camera.',
    'The image fills the whole frame edge to edge and the background stays still.',
  ].join(' ');
}

/** Seed que deu 19/19 clipes limpos no podcast Gram (24/09). */
export const LIPSYNC_SEED = 7;

// ================================================================ V2 (06/10, regras da skill OSideMedia/higgsfield-ai-prompt-skill, MIT)
// Lado a lado com a V1. Desde 06/10 a V2 é o PADRÃO (aprovada pelo Gusta); MEDIA_PROMPTS=v1 volta pra V1.
// a. realismo lisonjeiro: pele fina, uniforme e fosca, rosto descansado (tudo em positivo);
// b. o rosto-base leva a descrição longa; cena/lipsync são enxutos e NÃO re-descrevem rosto/cabelo/roupa
//    (a imagem carrega a identidade), só enquadramento, pose, expressão e ação + 1 frase curta de trava;
// c. lipsync: câmera estática ou dolly in lento, sem tokens de movimento de cabeça; clipes de fala de 3-8 s rendem
//    melhor (só registrado: a divisão de cenas não muda aqui);
// d. anti-slop: sem beautiful/stunning/cinematic/high quality/4K; luz nomeada; expressão como comportamento físico;
// e. sem nome de marca (garantido no prompt do Claude que escreve o visualPrompt, claude/prompts.ts);
// f. braços fora do quadro em positivo (pose descrita), sem citar o objeto proibido.

export type MediaPromptVersion = 'v1' | 'v2';
/** Padrão desde 06/10 (Gusta aprovou a V2): V2. */
export const MEDIA_PROMPT_VERSION_DEFAULT: MediaPromptVersion = 'v2';

/** Sem env (ou valor desconhecido) = V2; só "v1" explícito volta pra V1. */
export function mediaPromptVersion(v: string | undefined | null): MediaPromptVersion {
  return (v ?? '').trim().toLowerCase() === 'v1' ? 'v1' : MEDIA_PROMPT_VERSION_DEFAULT;
}

/** Palavras de "slop" que o modelo de imagem/vídeo trata como ruído (regra d). */
export const SLOP_WORDS = ['beautiful', 'stunning', 'gorgeous', 'cinematic', 'high quality', 'high-quality', 'best quality', 'masterpiece', 'ultra realistic', 'hyperrealistic', 'photorealistic', '4k', '8k', 'hdr', 'natural light', 'natural lighting'];
const SLOP_RE = new RegExp(`\\b(${SLOP_WORDS.map((w) => w.replace(/[-\s]/g, '[-\\s]')).join('|')})\\b`, 'gi');

/** Tira slop da entrada (descrição/visualPrompt vindos do Claude ou do usuário) e arruma a pontuação que sobra. */
export function scrubSlop(text: string): string {
  return text
    .replace(SLOP_RE, '')
    .replace(/\s+([,.;])/g, '$1')
    .replace(/([,;])\s*(?=[,.;])/g, '')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Luz nomeada padrão (regra d: nunca "natural light"). */
const DEFAULT_LIGHT = 'soft window light from the left, late afternoon, gentle fill on the shadow side';
/** Trava de identidade curta (regra b). */
export const IDENTITY_LOCK_V2 = 'The same person from the image, the only person in the shot.';
/** Braços em positivo (regra f): pose descrita, sem citar o que não pode aparecer. */
const ARMS_V2 = 'Both arms rest down along the body, below the bottom edge of the frame.';

export function facePromptV2(description: string, aspect?: string): string {
  const desc = scrubSlop(description.replace(/\s+/g, ' ')).replace(/\.$/, '');
  return [
    `${photoKind(aspect)} SOLO SHOT of exactly one person: ${desc}.`,
    'Framed from the chest up, the face centered in the frame, shoulders square to the camera, looking straight into the lens with relaxed eyebrows and a slight closed-mouth smile.',
    ARMS_V2,
    'Flattering realism: fine, even, matte skin texture with a healthy, rested complexion, clear bright eyes, neatly groomed hair; the person looks their best on an ordinary good day.',
    `Lit by ${DEFAULT_LIGHT}. Sharp focus on the face; a believable everyday setting softly out of focus behind them.`,
    ...bodyMarksV2(desc),
    'Clean photo: clothing without letters or logos, nothing written anywhere in the image, no borders.',
  ].join(' ');
}

const TATTOO = /\b(tattoo\w*|tatua\w*|tatuaje\w*|ink)\b/i;
const PIERCING = /\b(piercing\w*|septum|septo|nose stud|nostril|narina|hoops?|argola\w*|helix|h[ée]lix|ear studs?|brinco\w*|arete\w*)\b/i;

/** §13.13: tatuagem/piercing da descrição renderizados como de verdade (o Soul tende a adesivo/pintura e a sumir com eles). */
export function bodyMarksV2(description: string): string[] {
  // tira as negações ("no visible tattoos", "sem piercing") antes de procurar
  const d = description.replace(/\b(no|without|sem|sin)\s+(\w+\s+)?(tattoos?|tatuage\w*|tatuaje\w*|piercings?)(\s+vis[íi]ve\w*)?/gi, ' ');
  const out: string[] = [];
  if (TATTOO.test(d))
    out.push('Keep every tattoo exactly where the description puts it and clearly visible in the frame: real healed ink settled into the skin, slightly soft line edges, following the curve and texture of the skin, matte, never glossy or sticker-like, drawings only with no letters or numbers.');
  if (PIERCING.test(d))
    out.push('Every piercing is small real metal jewelry sitting in the skin at the described spot, with a tiny natural specular highlight.');
  return out;
}

/** Cláusulas que descrevem aparência (a imagem já carrega; re-descrever faz o modelo trocar a pessoa). */
const APPEARANCE = /\b(hair\w*|blond\w*|brunette|redhead|beard\w*|mustache|wear\w*|dress\w*|shirt\w*|t-shirt|blouse|jacket|hoodie|sweater|top|jeans|outfit|cloth\w*|makeup|lipstick|earring\w*|necklace|glasses|eyes? colou?r|skin|freckle\w*|tattoo\w*|\d{2}s|years? old|aged)\b/i;

/** Emoção abstrata → comportamento físico (regra d). A ordem importa: a 1ª que casar vence por cláusula. */
const PHYSICAL: [RegExp, string][] = [
  [/\b(surpris\w*|shock\w*|amaz\w*)\b/i, 'eyebrows shoot up, eyes widen'],
  [/\b(excit\w*|enthusias\w*|energetic|thrill\w*)\b/i, 'eyebrows lift, open smile'],
  [/\b(laugh\w*)\b/i, 'a short laugh, eyes crinkling'],
  [/\b(knowing|smirk\w*|playful|cheeky)\b/i, 'a one-sided half smile'],
  [/\b(smil\w*|grin\w*|warm\w*|friendly|happy|joy\w*)\b/i, 'eyebrows lift, half smile'],
  [/\b(curious|intrigu\w*|wonder\w*)\b/i, 'one eyebrow raised, lips slightly parted'],
  [/\b(serious\w*|concern\w*|worr\w*|frustrat\w*|annoy\w*|sad\w*)\b/i, 'brows drawn slightly together, lips pressed'],
  [/\b(confiden\w*|sincere|honest|direct|determin\w*)\b/i, 'steady eye contact, chin level'],
  [/\b(calm\w*|relax\w*|easy|gentle)\b/i, 'relaxed face, slow blinks'],
];

/** Comportamentos físicos tirados do visualPrompt (máx. 2, sem repetir). */
export function physicalExpressions(visualPrompt: string): string[] {
  const out: string[] = [];
  for (const clause of visualPrompt.split(/[,.;]/)) {
    const hit = PHYSICAL.find(([re]) => re.test(clause));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
    if (out.length === 2) break;
  }
  return out;
}

/** Cláusulas úteis do visualPrompt pra cena: sem aparência, sem "SOLO SHOT" (a trava já diz), sem slop. */
function sceneClauses(visualPrompt: string): string[] {
  return scrubSlop(visualPrompt.replace(/^\s*solo shot\s*[,:.]?\s*/i, ''))
    .split(/[,.;]/)
    .map((c) => c.trim())
    .filter((c) => c && !APPEARANCE.test(c));
}

/** Cena com áudio nativo, enxuta (regra b): enquadramento, pose, expressão, ação + trava curta. */
export function scenePromptV2(i: { visualPrompt: string; speech: string; language: string }): string {
  const clauses = sceneClauses(i.visualPrompt);
  const visual = `SOLO SHOT${clauses.length ? `, ${clauses.join(', ')}` : ', medium close-up'}`;
  const speech = i.speech.trim().replace(/"/g, '”');
  if (!speech) return `${visual}. ${IDENTITY_LOCK_V2} They look into the lens, relaxed face, lips closed. Quiet room tone, no music.`;
  return [
    `${visual}. ${IDENTITY_LOCK_V2}`,
    'They look straight into the lens and talk, lips moving in sync with every word.',
    `[Speaker, warm natural voice, speaking ${languageName(i.language)}]: "${speech}"`,
    'Only this one voice is heard, clear and close to the microphone, quiet room tone, no music.',
  ].join('\n');
}

/** Lipsync (Pruna) V2: câmera estática (ou dolly in lento se o roteiro pediu aproximação), sem movimento de cabeça. */
export function lipsyncPromptV2(visualPrompt: string): string {
  const dolly = /\b(push[-\s]?in|dolly[-\s]?in|zoom[-\s]?in|moves? closer|slow push)\b/i.test(visualPrompt);
  // só sai o comportamento físico mapeado, nunca o texto da cláusula: "nods", "tilts", "leans" não chegam ao Pruna
  const expressions = physicalExpressions(visualPrompt);
  const face = expressions.length ? expressions.join(', ') : 'steady eye contact, a slight easy smile';
  return [
    `SOLO SHOT, ${dolly ? 'slow dolly in' : 'static camera'}, one continuous full-frame shot. ${IDENTITY_LOCK_V2}`,
    `They talk straight to the lens: ${face}.`,
    ARMS_V2,
    'The image fills the whole frame edge to edge and the background stays still.',
  ].join(' ');
}

export interface MediaPrompts {
  version: MediaPromptVersion;
  face: (description: string, aspect?: string) => string;
  scene: (i: { visualPrompt: string; speech: string; language: string }) => string;
  lipsync: (visualPrompt: string) => string;
}

/** O que vai pro provedor. Chave: MEDIA_PROMPTS (v1 | v2) no api/.env; padrão v2 (06/10). */
export function mediaPrompts(version: MediaPromptVersion = MEDIA_PROMPT_VERSION_DEFAULT): MediaPrompts {
  return version === 'v2'
    ? { version, face: facePromptV2, scene: scenePromptV2, lipsync: lipsyncPromptV2 }
    : { version, face: facePrompt, scene: scenePrompt, lipsync: lipsyncPrompt };
}

// ================================================================ §13.15: janela do Trocar avatar (Kling/Seedance)
// Método da skill kling-3-prompt: ação âncora antes da fala, diálogo estruturado, câmera de tripé. A janela recria o
// avatar DENTRO da edição do campeão, então o enquadramento não pode mexer (o fitCrop recorta pela região medida).
// (A) CHAMPION_AUDIO: mudo, "fala naturalmente" SEM diálogo no prompt (o lipsync v2v põe a boca na fala do campeão).
// (B) ENGINE_VOICE: diálogo da janela com o descritor de voz FIXO do item, repetido igual em todas as janelas/trechos
// (nenhum dos dois modelos aceita voz de referência na WaveSpeed: aviso voice_may_vary).

export const SWAP_NEGATIVE = 'second person, extra people, crowd, hands near the face, subtitles, captions, text, watermark, logo, zoom, camera movement, cut, music, distorted face, morphing face';

/** §13.15: aspecto do Seedance (16:9, 9:16, 4:3, 3:4, 1:1, 21:9) mais perto do aspecto do rosto (2:3 → 3:4, 3:2 → 4:3). */
export function seedanceSwapAspect(aspect: string): '16:9' | '9:16' | '4:3' | '3:4' | '1:1' {
  const [a, b] = aspect.split(':').map(Number);
  const r = a > 0 && b > 0 ? a / b : 9 / 16;
  const opts: ['16:9' | '9:16' | '4:3' | '3:4' | '1:1', number][] = [['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4], ['1:1', 1]];
  return opts.reduce((best, o) => (Math.abs(Math.log(o[1] / r)) < Math.abs(Math.log(best[1] / r)) ? o : best))[0];
}

/** Descritor de voz padrão quando o plano não trouxe um (gênero vem do elenco). */
export function defaultVoiceDescriptor(gender: 'female' | 'male' | null, language: string): string {
  const who = gender === 'male' ? 'man in his early thirties' : gender === 'female' ? 'woman in her early thirties' : 'adult';
  return `${who}, warm medium-low voice, calm confident pace, speaking ${languageName(language)}`;
}

export function swapScenePrompt(i: { visualPrompt: string; speech: string; language: string; sound: boolean; voiceDescriptor?: string }): string {
  const clauses = sceneClauses(i.visualPrompt);
  const camera = 'Locked-off static camera on a tripod: no zoom, no pan, no cut, the framing, light and background stay exactly as in the image for the whole shot.';
  const who = `SOLO SHOT${clauses.length ? `, ${clauses.join(', ')}` : ''}. ${IDENTITY_LOCK_V2} Same face, same hair, same clothes from the first frame to the last.`;
  const body = 'Relaxed shoulders, small natural head motion. ' + ARMS_V2;
  const speech = i.speech.trim().replace(/"/g, '”');
  if (!i.sound || !speech) {
    return [camera, who, `They talk naturally to the camera, looking into the lens, lips moving with clear continuous speech. ${body}`].join('\n');
  }
  const voice = (i.voiceDescriptor?.trim() || defaultVoiceDescriptor(null, i.language)).replace(/[[\]"]/g, '');
  return [
    camera,
    who,
    `They look straight into the lens and talk, lips moving in sync with every word. ${body}`,
    `[Speaker, ${voice}]: "${speech}"`,
    'Only this one voice is heard, clear and close to the microphone, quiet room tone, no music.',
  ].join('\n');
}

// ---------------------------------------------------------------- STATIC (GPT Image 2, variacao-auto-v1 rev. 23/10 §14.3)
// Estrutura da skill gpt-image-2-prompt (.claude/skills/gpt-image-2-prompt): campos object / scene / vibe /
// photo quality and vibe (recomendação pelo tipo: everyday, cinematic, ads) / aspect ratio + "Avoid".
// Sem a frase de abertura da skill ("Generate an image ... dont change it"): ela existe pra travar o reescritor do
// ChatGPT; na API não há reescritor e a frase só viraria ruído (ou texto na imagem).
// A headline é o ÚNICO texto da imagem e vai entre aspas, no idioma da tela, dentro da safe area (topo/base ~12 % livres).

/** Recomendações de "photo quality and vibe" da skill, por estilo (texto da skill; só a parte de nitidez da headline é nossa). */
export const STATIC_STYLE_QUALITY: Record<StaticStyle, string> = {
  everyday_photo:
    'non-studio lighting, no oversharpening, real light from the location, iphone photo vibe, imperfect photo quality/raw quality (for realism), random realistic photo taken during a random moment of the day, make sure the lighting is natural and matches the background, 2k, the photo slightly soft like a phone photo while the headline text stays crisp',
  cinematic:
    'focused cinematic shot, natural light, highly aesthetic scene, movie-still composition, raw quality, warm rim light, subtle film grain, clean composition, cool ambient shadows, colors with a slight gray tone, make sure the lighting is natural and matches the background, no oversaturation, no oversharpening, a lively vibe, as if the frame was taken while the characters were doing something, raw quality',
  ad_graphic:
    'social media ad creative, clean composition, strong color direction, one clear focal point, generous empty space around the headline, print-quality sharp edges',
};

const PLACEMENT: Record<HeadlinePlacement, string> = {
  top: 'in the upper third of the frame, just below the top safe margin',
  center: 'across the middle of the frame',
  bottom: 'in the lower third of the frame, just above the bottom safe margin',
};

/** Palavras de pessoa/corpo: o modo `safe` tira os trechos da cena que as citam (o reenvio depois de SAFETY_BLOCK). */
const PERSON_RE = /\b(person|people|persons|man|men|woman|women|girl|girls|boy|boys|guy|lady|kid|kids|child|children|teen|teenager|adult|mother|father|mom|dad|baby|couple|someone|somebody|customer|user|he|she|him|her|his|hers|they|their|them|body|bodies|skin|face|faces|hand|hands|arm|arms|leg|legs|belly|waist|chest|hair|lips|eyes|shoulders?|figure|model|wearing|dressed|shirtless|naked|nude|swimsuit|bikini|underwear|lingerie)\b/i;

/** Tira os trechos (entre vírgula/ponto; dentro deles, entre and/while/with) que descrevem pessoa ou corpo. Trecho sem
 *  pessoa fica intacto. */
export function withoutPeople(text: string): string {
  const parts: string[] = [];
  for (const raw of text.split(/(?<=[.;,])\s+/)) {
    const chunk = raw.trim().replace(/[.;,]+$/, '');
    if (!chunk) continue;
    if (!PERSON_RE.test(chunk)) parts.push(chunk);
    else parts.push(...chunk.split(/\s+(?:and|while|with)\s+/i).map((x) => x.trim()).filter((x) => x && !PERSON_RE.test(x)));
  }
  return parts.join(', ');
}

const quoteSafe = (t: string) => t.replace(/\s+/g, ' ').trim().replace(/"/g, '”');
const field = (t: string) => scrubSlop(t.replace(/\s+/g, ' ').replace(/["“”]/g, '').trim()).replace(/\.$/, '');

/**
 * Prompt da imagem do STATIC (função pura). `safe` = reenvio depois de recusa: sem pessoa/corpo, mesma cena, clima e headline.
 * `visual` vazio (plano antigo, sem conceito) = pôster tipográfico só com a headline e uma cor forte.
 */
export function buildStaticImagePrompt(spec: StaticImageSpec, aspect: StaticAspect, opts: { safe: boolean }): string {
  const v = spec.visual;
  const headline = quoteSafe(spec.headline);
  const legacy = !v.object.trim() && !v.scene.trim() && !v.vibe.trim();
  const style: StaticStyle = legacy ? 'ad_graphic' : v.style;
  const placement: HeadlinePlacement = legacy ? 'center' : v.headlinePlacement;

  let object: string;
  let scene: string;
  let vibe: string;
  if (legacy) {
    object = 'the headline set as large bold typography, the main and only element of the image';
    scene = 'a clean flat background in one strong color with a subtle paper texture';
    vibe = 'confident, simple, direct';
  } else if (opts.safe) {
    const place = withoutPeople(field(v.scene));
    object = 'an everyday setting with a few ordinary objects that fit it, empty of people';
    scene = place ? `${place}, nobody in the frame` : 'an ordinary everyday setting that fits the headline, nobody in the frame';
    vibe = withoutPeople(field(v.vibe)) || 'calm and honest';
  } else {
    object = field(v.object);
    scene = field(v.scene);
    vibe = field(v.vibe);
  }

  return [
    `object: ${object}`,
    `scene: ${scene}`,
    `vibe: ${vibe}`,
    `photo quality and vibe: ${STATIC_STYLE_QUALITY[style]}`,
    `text on the image, exactly as written, in ${languageName(spec.screenLanguage)}: "${headline}"`,
    `text placement: ${PLACEMENT[placement]}, inside the safe area (the top 12% and the bottom 12% of the frame stay free of text), large bold legible sans-serif letters with strong contrast against the background, written once, every letter and accent spelled exactly as given`,
    'no other text, no watermarks, no logos, no borders, no frames.',
    `aspect ratio: ${aspect}`,
    'Avoid: excessive yellow in the photo, too sharp or overly sharpened image, too many highlights or glare on faces, misspelled or extra words, studio lighting, overpolished look.',
  ].join('\n');
}
