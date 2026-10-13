// §13.13 (07/10): elenco DIVERSO nas variações. Os eixos de diversidade são sorteados AQUI, no código, por elenco do
// lote (semente = id do lote), e entram no prompt como restrição explícita: o Claude só redige. Antes dependia só do
// modelo e dois elencos saíram quase idênticos (dois homens brancos, 30 anos, camisa navy).
//
// Posições no lote: 0 = elenco compartilhado (NEW_HOOKS/COPY_NEW), k + 1 = SWAP_AVATAR índice k. Em cada eixo a posição
// pega um item diferente de uma permutação do eixo, então nenhum eixo se repete entre os ≤ 5 elencos de um lote
// (SWAP_AVATAR 1-4 + compartilhado). A etnia aparente do original (e as já citadas nos elencos prontos) sai do sorteio.
// Gênero nunca é sorteado: segue o castingGender (voz) — lição do Pruna.
import type { PersonProfile } from '@maquina/contratos';

export type Gender = 'female' | 'male';
interface Opt { en: string; pt: string }
interface Eth extends Opt { re: RegExp; coily: boolean; lightEyes: boolean; tone: 0 | 1 | 2 }
interface Hair extends Opt { coily?: boolean }
interface Eye extends Opt { light?: boolean }
interface Cloth extends Opt { arms: boolean }
interface Tat extends Opt { arms: boolean }

/** Etnia aparente. `re` reconhece a etnia do original/dos elencos já usados (pt/en) pra tirar do sorteio. */
export const ETHNICITIES: Eth[] = [
  { en: 'Black, of West African descent, deep brown skin', pt: 'de ascendência africana, pele negra retinta', re: /\b(black|african|afro)|negr[oa]|pret[oa]|retint/i, coily: true, lightEyes: false, tone: 2 },
  { en: 'East Asian (Korean, Japanese or Chinese descent)', pt: 'de ascendência do leste asiático (coreana, japonesa ou chinesa)', re: /east asian|korean|japanese|chinese|leste asi|corean|japon|chin[eê]s|^\s*(asian|asi[aá]tic[oa])\s*$/i, coily: false, lightEyes: false, tone: 0 },
  { en: 'South Asian (Indian or Pakistani descent), warm brown skin', pt: 'de ascendência sul-asiática (indiana ou paquistanesa), pele morena quente', re: /south asian|indian\b|pakistan|bangla|sul-?asi|indian[oa]/i, coily: false, lightEyes: false, tone: 1 },
  { en: 'Latino, of mixed Latin American descent, warm tan skin', pt: 'latino-americana de ascendência mista, pele morena', re: /latin|hispanic|mestiz|pard[oa]|moren[oa]/i, coily: true, lightEyes: true, tone: 1 },
  { en: 'White, of Northern European descent, fair skin', pt: 'de ascendência do norte europeu, pele bem clara', re: /\bwhite\b|caucasian|european|branc[oa]|europe/i, coily: false, lightEyes: true, tone: 0 },
  { en: 'Middle Eastern (Arab or Persian descent), light olive skin', pt: 'de ascendência do Oriente Médio (árabe ou persa), pele oliva', re: /middle eastern|\barab|persian|north african|[áa]rabe|persa|oriente m[ée]dio/i, coily: false, lightEyes: true, tone: 0 },
  { en: 'Indigenous Latin American (Andean descent), copper-brown skin', pt: 'indígena latino-americana (ascendência andina), pele acobreada', re: /indigen|ind[íi]gena|native american|andean|andin[oa]/i, coily: false, lightEyes: false, tone: 1 },
  { en: 'Southeast Asian (Filipino or Vietnamese descent), golden-tan skin', pt: 'do sudeste asiático (filipina ou vietnamita), pele dourada', re: /southeast asian|filipin|vietnam|indonesi|thai\b|sudeste asi/i, coily: false, lightEyes: false, tone: 1 },
  { en: 'Pacific Islander (Polynesian descent), rich brown skin', pt: 'de ascendência polinésia, pele morena escura', re: /pacific islander|polynesian|samoan|maori|polin[eé]si/i, coily: true, lightEyes: false, tone: 2 },
];

/** Idade: o prompt manda cair na faixa plausível mais próxima se a sorteada não servir pro público. */
export const AGES: Opt[] = [
  { en: 'early 20s (about 22)', pt: 'uns 22 anos' },
  { en: 'late 20s (about 28)', pt: 'uns 28 anos' },
  { en: 'mid 30s (about 35)', pt: 'uns 35 anos' },
  { en: 'early 40s (about 42)', pt: 'uns 42 anos' },
  { en: 'early 50s (about 52)', pt: 'uns 52 anos' },
  { en: 'mid 20s (about 25)', pt: 'uns 25 anos' },
  { en: 'late 30s (about 38)', pt: 'uns 38 anos' },
  { en: 'late 40s (about 47)', pt: 'uns 47 anos' },
];

export const HAIR: Record<Gender, Hair[]> = {
  female: [
    { en: 'long box braids, dark brown with honey-blonde ends', pt: 'tranças box braids longas, castanho-escuras com pontas mel', coily: true },
    { en: 'a short platinum-blonde pixie cut', pt: 'corte pixie curtinho platinado' },
    { en: 'shoulder-length copper-red curls', pt: 'cachos ruivo-acobreados na altura do ombro' },
    { en: 'a sleek jet-black bob with blunt bangs', pt: 'chanel liso preto-azulado com franja reta' },
    { en: 'a big rounded afro of dark brown coils', pt: 'black power volumoso de cachos crespos castanho-escuros', coily: true },
    { en: 'long straight chestnut hair in a high ponytail', pt: 'cabelo castanho liso e longo num rabo de cavalo alto' },
    { en: 'a wavy ash-brown lob with curtain bangs', pt: 'long bob ondulado castanho-acinzentado com franja cortina' },
    { en: 'a bleached buzz cut', pt: 'cabelo raspado bem curto e descolorido' },
    { en: 'long dark wavy hair with pastel-pink streaks', pt: 'cabelo escuro, longo e ondulado com mechas rosa-claro' },
  ],
  male: [
    { en: 'a clean shaved head', pt: 'cabeça raspada' },
    { en: 'short tight black coils with a high fade', pt: 'cabelo crespo curto preto com degradê alto', coily: true },
    { en: 'shoulder-length wavy dark hair tied in a low bun', pt: 'cabelo escuro ondulado na altura do ombro, preso num coque baixo' },
    { en: 'messy medium-length blond hair', pt: 'cabelo loiro médio e bagunçado' },
    { en: 'a short ginger crew cut', pt: 'corte militar curto ruivo' },
    { en: 'a black textured crop with a mid fade', pt: 'cabelo preto texturizado curto com degradê médio' },
    { en: 'short salt-and-pepper hair, side-parted', pt: 'cabelo grisalho curto repartido de lado' },
    { en: 'short black twists', pt: 'twists curtos pretos', coily: true },
    { en: 'long straight black hair past the shoulders', pt: 'cabelo preto liso e longo passando dos ombros' },
  ],
};

export const EYES: Eye[] = [
  { en: 'dark brown eyes', pt: 'olhos castanho-escuros' },
  { en: 'hazel eyes', pt: 'olhos cor de mel' },
  { en: 'green eyes', pt: 'olhos verdes', light: true },
  { en: 'grey-blue eyes', pt: 'olhos azul-acinzentados', light: true },
  { en: 'light amber eyes', pt: 'olhos âmbar-claros' },
  { en: 'near-black eyes', pt: 'olhos quase pretos' },
  { en: 'bright blue eyes', pt: 'olhos azuis', light: true },
  { en: 'light brown eyes', pt: 'olhos castanho-claros' },
];

/** Tatuagem visível num enquadramento do peito pra cima (os braços ficam abaixo do quadro). Nunca letra/palavra. */
export const TATTOOS: Tat[] = [
  { en: 'a fine-line botanical tattoo on the side of the neck', pt: 'tatuagem fine line de folhas na lateral do pescoço', arms: false },
  { en: 'no visible tattoos', pt: 'sem tatuagem visível', arms: false },
  { en: 'a black-ink floral tattoo covering the upper arm and shoulder', pt: 'tatuagem floral em tinta preta cobrindo o braço e o ombro', arms: true },
  { en: 'a small geometric tattoo just below the collarbone', pt: 'tatuagem geométrica pequena logo abaixo da clavícula', arms: false },
  { en: 'a tiny star tattoo behind the ear', pt: 'estrelinha tatuada atrás da orelha', arms: false },
  { en: 'a patchwork of small old-school tattoos on the upper arm', pt: 'várias tatuagens pequenas old school no braço', arms: true },
  { en: 'a thin wave line-art tattoo along the collarbone', pt: 'tatuagem de traço fino de onda ao longo da clavícula', arms: false },
  { en: 'no visible tattoos', pt: 'sem tatuagem visível', arms: false },
];

export const PIERCINGS: Opt[] = [
  { en: 'a small gold nose stud', pt: 'piercing de pedrinha dourada no nariz' },
  { en: 'a thin silver septum ring', pt: 'argola fina prateada no septo' },
  { en: 'a silver eyebrow piercing', pt: 'piercing prateado na sobrancelha' },
  { en: 'several small silver hoops along one ear', pt: 'várias argolinhas prateadas subindo por uma orelha' },
  { en: 'no piercings', pt: 'sem piercing' },
  { en: 'a small hoop in one nostril', pt: 'argolinha numa narina' },
  { en: 'a single small stud in each earlobe', pt: 'um brinco pequeno de pressão em cada orelha' },
  { en: 'a helix cuff high on one ear', pt: 'piercing de hélix no alto de uma orelha' },
];

/** Barba (homem) ou maquiagem (mulher). */
export const GROOMING: Record<Gender, Opt[]> = {
  female: [
    { en: 'no makeup, natural skin with visible freckles', pt: 'sem maquiagem, pele natural com sardas' },
    { en: 'bold red lipstick', pt: 'batom vermelho marcante' },
    { en: 'sharp black winged eyeliner', pt: 'delineado gatinho preto bem marcado' },
    { en: 'soft glowy natural makeup', pt: 'maquiagem leve e iluminada' },
    { en: 'dark berry lipstick', pt: 'batom vinho escuro' },
    { en: 'no makeup', pt: 'sem maquiagem' },
    { en: 'colored graphic eyeliner', pt: 'delineado gráfico colorido' },
  ],
  male: [
    { en: 'clean-shaven', pt: 'barba feita' },
    { en: 'a full, well-kept beard', pt: 'barba cheia e bem aparada' },
    { en: 'short stubble', pt: 'barba por fazer' },
    { en: 'a thick mustache, no beard', pt: 'bigode grosso, sem barba' },
    { en: 'a neat goatee', pt: 'cavanhaque bem feito' },
    { en: 'a short boxed beard', pt: 'barba curta desenhada' },
    { en: 'clean-shaven with long sideburns', pt: 'barba feita com costeletas longas' },
  ],
};

/** Roupa. `arms` = deixa o braço/ombro à mostra (a tatuagem de braço precisa). Sem estampa com letra ou logo. */
export const CLOTHING: Cloth[] = [
  { en: 'an oversized olive hoodie', pt: 'moletom oversized verde-oliva', arms: false },
  { en: 'a black turtleneck', pt: 'gola alta preta', arms: false },
  { en: 'a rust-orange knit sweater', pt: 'suéter de tricô laranja-ferrugem', arms: false },
  { en: 'a denim jacket over a plain white t-shirt', pt: 'jaqueta jeans sobre camiseta branca lisa', arms: false },
  { en: 'a light blue linen button-up shirt', pt: 'camisa de linho azul-clara', arms: false },
  { en: 'a cream cable-knit cardigan', pt: 'cardigã creme de tricô trançado', arms: false },
  { en: 'a forest-green bomber jacket', pt: 'jaqueta bomber verde-escura', arms: false },
  { en: 'a mustard shirt with a small floral print', pt: 'camisa mostarda com estampa floral miúda', arms: false },
  { en: 'a white ribbed tank top', pt: 'regata canelada branca', arms: true },
  { en: 'a sleeveless black top', pt: 'blusa preta sem manga', arms: true },
  { en: 'a burgundy sleeveless knit top', pt: 'blusa de tricô sem manga cor vinho', arms: true },
  { en: 'a sand-colored tank top', pt: 'regata cor de areia', arms: true },
];

export const SETTINGS: Opt[] = [
  { en: 'a small kitchen with open wooden shelves', pt: 'cozinha pequena com prateleiras de madeira abertas' },
  { en: 'a bedroom with a linen headboard and a plant', pt: 'quarto com cabeceira de linho e uma planta' },
  { en: 'a living room with a full bookshelf', pt: 'sala com uma estante cheia de livros' },
  { en: 'a compact home office with a pegboard', pt: 'home office compacto com painel perfurado' },
  { en: 'a balcony with city rooftops behind', pt: 'varanda com telhados da cidade ao fundo' },
  { en: 'a cozy café corner', pt: 'canto de um café aconchegante' },
  { en: 'a studio apartment with exposed brick', pt: 'quitinete com parede de tijolo aparente' },
  { en: 'a bright hallway with plants', pt: 'corredor claro com plantas' },
];

export interface DiverseCasting {
  position: number;
  gender: Gender;
  ethnicity: Opt; age: Opt; hair: Opt; eyes: Opt; tattoo: Opt; piercing: Opt; grooming: Opt; clothing: Opt; setting: Opt;
}

/** FNV-1a 32 bits. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193) >>> 0;
  return h;
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Permutação estável do eixo pro lote. */
export function permute<T>(xs: readonly T[], seed: string): T[] {
  const r = rng(hash(seed));
  const out = [...xs];
  for (let k = out.length - 1; k > 0; k--) {
    const j = Math.floor(r() * (k + 1));
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

/** Etnias que o sorteio pode usar: sem a do original nem as já citadas nos elencos prontos (se sobrar ≥ 3). */
export function ethnicityPool(original: string, used: string[]): Eth[] {
  const notOriginal = original.trim() ? ETHNICITIES.filter((e) => !e.re.test(original)) : ETHNICITIES;
  const fresh = notOriginal.filter((e) => !used.some((u) => e.re.test(u)));
  return fresh.length >= 3 ? fresh : notOriginal.length ? notOriginal : ETHNICITIES;
}

/**
 * Ordem das etnias no lote alternando o tom de pele (claro / médio / escuro): posições vizinhas nunca ficam no mesmo
 * grupo enquanto houver outro, então 3 elencos já cobrem os 3 tons. Sonda 07/10: andino × sul-asiático, ambos
 * morenos, saíram parecidos no Soul mesmo com etnia diferente.
 */
export function interleaveTones(pool: Eth[], batchId: string): Eth[] {
  const groups = permute([0, 1, 2] as const, `${batchId}:tones`).map((t) => permute(pool.filter((e) => e.tone === t), `${batchId}:ethnicity-${t}`));
  const out: Eth[] = [];
  for (let k = 0; out.length < pool.length; k++) for (const g of groups) if (g[k]) out.push(g[k]);
  return out;
}

/**
 * Eixos do elenco na posição `position` do lote (0 = compartilhado, k + 1 = SWAP_AVATAR k). Determinístico pelo
 * `batchId`: o mesmo lote replanejado dá a mesma pessoa na mesma posição, e posições diferentes nunca repetem eixo.
 * Cabelo crespo e olho claro só onde são plausíveis pra etnia sorteada (o lote é montado da posição 0 até a pedida,
 * cada uma pegando o próximo item plausível e ainda não usado da permutação do eixo).
 */
export function diverseCasting(i: { batchId: string; position: number; gender: Gender; originalEthnicity?: string; usedCastings?: string[] }): DiverseCasting {
  const perm = <T>(axis: string, xs: readonly T[]) => permute(xs, `${i.batchId}:${axis}`);
  const eths = interleaveTones(ethnicityPool(i.originalEthnicity ?? '', i.usedCastings ?? []), i.batchId);
  const hairs = perm(`hair-${i.gender}`, HAIR[i.gender]);
  const eyes = perm('eyes', EYES);
  const usedHair = new Set<Hair>();
  const usedEyes = new Set<Eye>();
  /** próximo item plausível e livre a partir de `q` na permutação; se não houver livre, o próximo plausível */
  const pick = <T>(xs: T[], q: number, ok: (x: T) => boolean, used: Set<T>): T => {
    const order = xs.map((_, k) => xs[(q + k) % xs.length]);
    const x = order.find((y) => ok(y) && !used.has(y)) ?? order.find(ok) ?? order[0];
    used.add(x);
    return x;
  };
  let hair = hairs[0];
  let eye = eyes[0];
  let eth = eths[0];
  for (let q = 0; q <= i.position; q++) {
    eth = eths[q % eths.length];
    const e = eth;
    hair = pick(hairs, q, (h) => !h.coily || e.coily, usedHair);
    eye = pick(eyes, q, (y) => !y.light || e.lightEyes, usedEyes);
  }
  const p = i.position;
  const at = <T>(axis: string, xs: readonly T[]): T => perm(axis, xs)[p % xs.length];
  const tattoo = at('tattoo', TATTOOS);
  // tatuagem de braço pede roupa que mostre o braço; cada grupo tem a própria permutação (sem repetir dentro dele)
  const clothing = at(tattoo.arms ? 'clothing-arms' : 'clothing', CLOTHING.filter((c) => c.arms === tattoo.arms));
  return {
    position: p,
    gender: i.gender,
    ethnicity: eth,
    age: at('age', AGES),
    hair,
    eyes: eye,
    tattoo,
    piercing: at('piercing', PIERCINGS),
    grooming: at(`grooming-${i.gender}`, GROOMING[i.gender]),
    clothing,
    setting: at('setting', SETTINGS),
  };
}

/** Bloco de restrições que vai no prompt (em inglês: é instrução, a descrição sai no idioma do lote). */
export function constraintsBlock(c: DiverseCasting, genderNote: string): string {
  return [
    `Gender: ${c.gender === 'male' ? 'man' : 'woman'} (${genderNote})`,
    `Apparent ethnicity: ${c.ethnicity.en}`,
    `Age: ${c.age.en}`,
    `Hair: ${c.hair.en}`,
    `Eyes: ${c.eyes.en}`,
    `Tattoo: ${c.tattoo.en}`,
    `Piercing: ${c.piercing.en}`,
    `${c.gender === 'male' ? 'Facial hair' : 'Makeup'}: ${c.grooming.en}`,
    `Clothing: ${c.clothing.en}`,
    `Setting: ${c.setting.en}`,
  ].join('\n');
}

/** Resumo de uma linha (pros "outros elencos deste lote"). */
export function castingSummary(c: DiverseCasting): string {
  return `${c.gender === 'male' ? 'man' : 'woman'}, ${c.ethnicity.en.split(/[,(]/)[0].trim()}, ${c.age.en.split(' (')[0]}, ${c.hair.en}`;
}

/** O que se mantém do original (a edição mantida depende de luz, enquadramento e pose iguais). */
export function keepBlock(profile: PersonProfile | null): string {
  const v = (x: string | undefined, d: string) => (x && x.trim()) || d;
  return [
    `Lighting: ${v(profile?.lighting, "same as the champion's first frame")}`,
    `Framing: ${v(profile?.framing, 'chest up, face centered')}`,
    `Pose: ${v(profile?.pose, 'facing the camera, looking straight into the lens')}`,
  ].join('\n');
}

/** Descrição pronta a partir dos eixos (usada pelo mock; en ou pt). */
export function describeCasting(c: DiverseCasting, lang: 'en' | 'pt' | 'es', profile: PersonProfile | null): string {
  if (lang === 'pt') {
    const who = c.gender === 'male' ? 'Um homem' : 'Uma mulher';
    return `${who} ${c.ethnicity.pt}, ${c.age.pt}, ${c.hair.pt}, ${c.eyes.pt}, ${c.tattoo.pt}, ${c.piercing.pt}, ${c.grooming.pt}, vestindo ${c.clothing.pt}, em ${c.setting.pt}. ${profile?.lighting ? `Luz: ${profile.lighting}. ` : ''}Enquadrado do peito pra cima, olhando direto pra câmera.`;
  }
  const who = c.gender === 'male' ? 'A man' : 'A woman';
  return `${who}, ${c.ethnicity.en}, ${c.age.en}, ${c.hair.en}, ${c.eyes.en}, ${c.tattoo.en}, ${c.piercing.en}, ${c.grooming.en}, wearing ${c.clothing.en}, in ${c.setting.en}. ${profile?.lighting ? `Lighting: ${profile.lighting}. ` : ''}Framed from the chest up, looking straight into the lens.`;
}

/** Gênero do elenco: castingGender (voz/perfil, preenchido pelo backend) > voz do teardown > perfil > mulher. */
export function castingGenderOf(castingGender: Gender | null | undefined, ...fallbacks: (Gender | null | undefined)[]): Gender {
  return castingGender ?? fallbacks.find((g): g is Gender => g === 'female' || g === 'male') ?? 'female';
}

/** Pessoa real/"parecida com X" na descrição: falha o item (1 nova tentativa) em vez de mandar pro gerador de rosto. */
export const LOOKALIKE = /\b(looks? like|resembl\w*|lookalike|look-alike|doppelg|parecid[oa] com|lembra (o|a)\b|s[óo]sia|se parece con|celebrity|famous|famos[oa])\b/i;

// ---------------------------------------------------------------- prompts do elenco diverso

const DESC = 'Two or three sentences, 200-550 characters, describing the person for a photo model.';
export const DIVERSE_CASTING_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lever', 'rationale', 'castingDescription'],
  properties: {
    lever: { type: 'string', description: '"avatar: <who, in a few words>" in one line, diagnosis language.' },
    rationale: { type: 'string', description: 'Why this person may beat the original, 1-2 sentences, tied to the avatar/verdict. A hypothesis.' },
    castingDescription: { type: 'string', description: DESC },
  },
};
export const DIVERSE_SHARED_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['description'],
  properties: { description: { type: 'string', description: DESC } },
};

function diverseRules(language: string): string {
  return `castingDescription rules: written in ${language}. Use EVERY constraint above as given, do not swap, soften or drop any (if the age is not plausible for the audience in <team_offer>, use the nearest plausible age and keep the rest; if a hair color or texture is very unlikely for that ethnicity, read it as dyed or styled that way). Mention, in this order: gender, apparent ethnicity, age, hair, eyes, tattoo and piercing with their exact placement (or that there are none), facial hair or makeup, clothing, setting; then the lighting, framing and pose kept from the original. Exactly one person, looking straight into the lens. An invented person written as a plain photo subject (do not call them fictional): never a real or famous person, never "looks like" anyone, and nothing that describes the champion's person. Tattoos are drawings or patterns, never letters, numbers or words. Do not mention hands, anything held, phones, text, logos or brand names.`;
}

export function diverseCastingUserMessage(i: {
  index: number; count: number; casting: DiverseCasting; genderNote: string; others: DiverseCasting[];
  profile: PersonProfile | null; avoidLevers: string[]; diagnosisLanguage: string; language: string;
}): string {
  const others = i.others.length ? `\n<other_people_in_this_batch>\n${i.others.map((o) => `- ${castingSummary(o)}`).join('\n')}\n</other_people_in_this_batch>` : '';
  const avoid = i.avoidLevers.length ? `\nCastings already used in this test: ${i.avoidLevers.map((x) => `"${x}"`).join(', ')}.` : '';
  return `Write SWAP_AVATAR variation ${i.index + 1} of ${i.count}: the same edit, the same words and voice, a DIFFERENT-LOOKING person on camera. This test casts a deliberately diverse lineup: each person is clearly different from the original and from every other person in the batch. The system already picked who this person is:
<casting_constraints>
${constraintsBlock(i.casting, i.genderNote)}
</casting_constraints>
<keep_from_original>
${keepBlock(i.profile)}
</keep_from_original>${others}
${diverseRules(i.language)}
Write lever ("avatar: <who, in a few words>") and rationale in ${i.diagnosisLanguage}.${avoid}`;
}

export function diverseSharedCastingUserMessage(i: { casting: DiverseCasting; genderNote: string; profile: PersonProfile | null; language: string }): string {
  return `Cast ONE person who will deliver every hook variation of this test (the person stays the same so only the hook changes). This person must look clearly different from the person in the champion. The system already picked who this person is:
<casting_constraints>
${constraintsBlock(i.casting, i.genderNote)}
</casting_constraints>
<keep_from_original>
${keepBlock(i.profile)}
</keep_from_original>
${diverseRules(i.language)}`;
}
