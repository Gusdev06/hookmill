// Prompts e esquemas da feature 2 (variar campeão): teardown em 12 seções e plano de variações.
// Método: _shared/templates/teardown-criativo.md (Peneira) + esteira-spy (Isca: uma alavanca por teste).
// Regras do produto que moram aqui: agnóstico de oferta; pessoa descrita de forma genérica; nada de número de
// performance inventado (Ad Library é proxy); citação literal no idioma original; seção sem dado = 'na' + motivo.
// Esquemas SEM union (anyOf/null): o limite da saída estruturada é 16 unions por pedido. "Sem valor" = "" e a
// validação (validacao-campeao.ts) converte pro formato do contrato.
import type { AdLibraryMeta, Measurements, OfferBriefDraft, TeardownSections, TranscriptWord, VariationKind } from '../contrato';
import { briefBlock } from './prompts';

const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const num = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });
const arr = (items: object, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...(description ? { description } : {}),
});

/** Seção do teardown: status + motivo (vazio quando ok) + dados (sempre preenchidos; vazios quando na). */
const section = (data: object, description: string) =>
  obj({ status: { type: 'string', enum: ['ok', 'na'] }, naReason: str('Why there is no data. Empty string when status is ok.'), data }, description);

export const VARIATION_KINDS: VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS', 'COPY_NEW', 'REMIX_EDIT'];

// metaCopy NÃO vai pro modelo: sai dos metadados da Ad Library (literal) ou é 'na' sem eles.
// O esquema inteiro (11 seções) estoura a gramática da saída estruturada ("compiled grammar is too large", sonda
// 06/10): a análise vai em DUAS chamadas com o mesmo prefixo cacheado — fatos (com os frames) e diagnóstico (texto).
const TEARDOWN_ALL = obj({
  identification: section(obj({ summary: str('2-3 sentences: format, duration, aspect, language, who speaks to whom.'), signals: arr(str(), 'Scale signals from the Ad Library data only (days running, versions, reach). Each one says it is a proxy, not performance.') }), 'Identification and scale signals.'),
  transcript: section(obj({ keywords: arr(obj({ sentence: str('One sentence of the speech, literal, original language.'), keyword: str('The single word of that sentence that carries the meaning (the one a karaoke caption would highlight), literal.') })) }), 'Keyword of each spoken sentence.'),
  hook: section(obj({
    endSec: num('Where the hook ends, in seconds: the end of the first spoken idea, usually 2-4 s, placed in a silence between words.'),
    visual: str('What is on screen in frame 1 and its job (stop the scroll).'),
    onScreenText: str('Text burned on screen during the hook, literal, original language. Empty string if none.'),
    spoken: str('First spoken sentence(s) up to endSec, literal, original language.'),
  }), 'The three layers of the first seconds.'),
  structure: section(obj({ blocks: arr(obj({
    label: str('Short block name in the diagnosis language (Hook, Pain, Mechanism, Proof, CTA...).'),
    function: str('Job of the block: hook | pain | story | mechanism | demo | proof | objection | offer | cta.'),
    startSec: num(), endSec: num(),
    onScreen: str('What is on screen during the block (person, panel, text, b-roll).'),
  }), 'Blocks in order, covering the whole video without gaps. The first block is the hook and ends exactly at hook.endSec. Every boundary sits in a silence between two words.') }), 'Structure and cuts.'),
  layout: section(obj({ summary: str('Screen layout in one or two sentences (full-frame talking head, split screen face on top and panel below, etc.), using the measured bands.'), segments: arr(obj({ startSec: num(), endSec: num(), description: str() })) }), 'Format and layout over time.'),
  visual: section(obj({
    palette: arr(obj({ hex: str('Hex color from the measured palette, #RRGGBB.'), role: str('Where it shows up (background, caption, keyword, banner...).') })),
    typography: str(), captions: str('Caption style: words per chunk, colors, keyword color, position.'),
    uiElements: str('Apps, screens or interface shown, real or mockup.'),
    person: str('GENERIC only: gender, apparent age range, framing, setting, light, clothing style, looks at camera or not. Never a name, handle, tattoo, birthmark or any distinctive physical trait.'),
    broll: str(), motion: str('Cuts, zooms, transitions, rhythm (cuts per 10 s).'),
  }), 'Visual: colors, type, elements.'),
  audio: section(obj({ voice: str('Gender, accent, human or synthetic, energy, pace in words per minute.'), music: str(), sfx: str() }), 'Audio.'),
  offerProofCta: section(obj({ promise: str(), mechanism: str(), proof: str('Proof actually shown or said. Never invent.'), ctaSpoken: str('Literal, original language.'), ctaOnScreen: str('Literal, original language. Empty string if none.') }), 'Offer, proof and CTA.'),
  whySells: section(obj({
    avatar: str('Who is on the other side, in 3 lines.'), awarenessLevel: str('Schwartz level where the ad meets the viewer and where it takes them.'),
    painDesire: str(), bigIdea: str('The idea in one sentence and the mechanism the ad sells.'),
    beliefObjection: str('Belief installed and objection neutralized.'), retentionEngine: str('What holds attention until the CTA.'),
    verdict: arr(str(), 'Why THIS ad sells: 3 to 5 causes, most important first. Hypotheses, never results.'),
  }), 'Audience and WHY it sells (the strategist diagnosis).'),
  stealVsVary: section(obj({ steal: arr(str(), 'The fixed mold that must not change.'), vary: arr(obj({ lever: str('One lever: hook, avatar, curiosity, pain, proof, contrarian, demonstration, objection, story, layout...'), idea: str() })) }), 'What to steal and what to vary.'),
  replicationPlan: section(obj({ suggestions: arr(obj({ kind: { type: 'string', enum: VARIATION_KINDS }, lever: str(), idea: str('One test, one lever, tied to a verdict cause.') })) }), 'Variation suggestions for this product.'),
});

function pick(keys: string[]) {
  const all = TEARDOWN_ALL as { properties: Record<string, object> };
  return { type: 'object', additionalProperties: false, required: keys, properties: Object.fromEntries(keys.map((k) => [k, all.properties[k]])) };
}
/** 1ª chamada: o que se vê e se ouve (recebe os frames). */
export const FACTS_SECTIONS = ['identification', 'transcript', 'hook', 'structure', 'layout', 'visual', 'audio'] as const;
/** 2ª chamada: o diagnóstico do estrategista (recebe os fatos já escritos, sem frames). */
export const DIAGNOSIS_SECTIONS = ['offerProofCta', 'whySells', 'stealVsVary', 'replicationPlan'] as const;
export const TEARDOWN_FACTS_SCHEMA = pick([...FACTS_SECTIONS]);
export const TEARDOWN_DIAGNOSIS_SCHEMA = pick([...DIAGNOSIS_SECTIONS]);

const LOCALE_NAME = { EN: 'English', PT_BR: 'Brazilian Portuguese' } as const;

export function teardownSystem(uiLocale: 'EN' | 'PT_BR'): string {
  return `You are the strategist of a performance creative team. You dissect a short video ad that is already winning (the "champion") so the team can make variations of it. You get the measured facts (word-timed transcript, silences, cuts, screen bands, palette), key frames with their timestamps, and sometimes Ad Library metadata and the brief of the offer the team sells.

Write the diagnosis in ${LOCALE_NAME[uiLocale]}. Quotes of what is said or written in the ad (speech, on-screen text, CTA) stay literal, in the ad's original language, never translated.

Rules:
- Facts come from the inputs. Times come from the transcript and the measurements; colors come from the measured palette. Do not guess what you cannot see or hear.
- A section with no data gets status "na" and a one-line naReason (for example: no speech in the video, no Ad Library data). Fill its data with empty strings and empty arrays. Never drop a section and never fill it with invented content.
- Never invent performance numbers. Ad Library fields (days running, versions, reach) are a proxy of spend, not results: say so wherever you use them. No CTR, ROAS, sales or views unless they are in the input.
- Describe the person on screen generically: gender, apparent age range, framing, setting, light, clothing style. Never a name, @handle, tattoo, scar, birthmark or any other distinctive or identifying physical trait. The team will cast a different person.
- The offer being sold may differ from the champion's. Diagnose the champion as it is; use the team's brief only to make the steal/vary and replication ideas fit the team's product, never to rewrite what the champion says.
- Structure: blocks cover the whole video in order with no gaps, the first block is the hook and ends exactly at hook.endSec, and every boundary sits in a silence between two words (use the word times).
- Verdict, steal/vary and replication: one lever per test, each idea tied to a cause in the verdict. Replication suggestions use these kinds: SWAP_AVATAR (same words, different person), NEW_HOOKS (only the first seconds change), COPY_NEW (new script on the same structure), REMIX_EDIT (same footage, new layout).
- Be concrete and short. The team scans this in a minute.`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Transcrição compacta: uma linha por trecho de fala entre silêncios ≥ 0,3 s, cada palavra com o início: "If@0 they@0.13". */
export function wordsBlock(words: TranscriptWord[]): string {
  if (!words.length) return '(no speech)';
  const lines: string[] = [];
  let cur: TranscriptWord[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    if (!next || next.startSec - w.endSec >= 0.3) {
      lines.push(`[${r2(cur[0].startSec)}-${r2(w.endSec)}] ${cur.map((x) => `${x.word}@${r2(x.startSec)}`).join(' ')}`);
      cur = [];
    }
  });
  return lines.join('\n');
}

function measurementsBlock(m: Omit<Measurements, 'keyframes'>): string {
  const segs = m.segments.map((s) => `  ${r2(s.startSec)}-${r2(s.endSec)} s: ${s.bands.map((b) => `${b.role} y=${b.y0}-${b.y1} (${Math.round(b.pct)}%)`).join(', ') || 'single band'}`);
  return [
    `Duration ${r2(m.durationSec)} s, ${m.width}x${m.height}, ${m.fps} fps, audio: ${m.hasAudio ? 'yes' : 'no'}.`,
    `Cuts: ${m.cuts.length ? m.cuts.map((c) => `${r2(c.atSec)} s (${c.kind})`).join(', ') : 'none detected'}.`,
    `Screen bands by segment:\n${segs.join('\n') || '  none measured'}`,
    `Measured palette: ${m.palette.join(', ') || 'none'}.`,
    `Silences: ${m.silences.length ? m.silences.map((s) => `${r2(s.startSec)}-${r2(s.endSec)}`).join(', ') : 'none'}.`,
  ].join('\n');
}

function adMetaBlock(a: AdLibraryMeta | null): string {
  if (!a || a.status !== 'resolved') return 'No Ad Library data (the video was uploaded without a resolved link).';
  const f = (k: string, v: unknown) => (v == null || v === '' ? null : `${k}: ${v}`);
  return [
    f('Page', a.pageName), f('Start date', a.startDate), f('End date', a.endDate), f('Active', a.isActive),
    f('Days running (proxy, not performance)', a.daysRunning), f('Versions running (collation)', a.collationCount),
    f('EU reach (proxy of spend, not performance)', a.euReach), f('Primary text', a.primaryText), f('Headline', a.headline),
    f('Button', a.ctaText), f('Link', a.linkUrl),
  ].filter(Boolean).join('\n');
}

/** Contexto estável das duas chamadas da análise (vai cacheado: a 2ª lê do cache). */
export function teardownContext(i: {
  transcript: { language: string; words: TranscriptWord[] };
  measurements: Omit<Measurements, 'keyframes'>;
  adMeta: AdLibraryMeta | null;
  offer: OfferBriefDraft | null;
}): string {
  return [
    `<measurements>\n${measurementsBlock(i.measurements)}\n</measurements>`,
    `<transcript language="${i.transcript.language}">\nOne line per stretch of speech between silences: [start-end] then each word@start (seconds).\n${wordsBlock(i.transcript.words)}\n</transcript>`,
    `<ad_library>\n${adMetaBlock(i.adMeta)}\n</ad_library>`,
    i.offer ? `<team_offer>\n${briefBlock(i.offer)}\n</team_offer>` : '<team_offer>Not given: keep the replication ideas generic to the champion.</team_offer>',
  ].join('\n\n');
}

export function teardownFactsMessage(framesNote: string): string {
  return `<frames>${framesNote}</frames>\n\nStep 1 of 2. Write the factual sections: identification, transcript keywords, hook, structure, layout, visual and audio.`;
}

export function teardownDiagnosisMessage(factsJson: string): string {
  return `Step 2 of 2. The factual sections are already written (below, with the key frames you saw in step 1 summarized there):\n<facts>\n${factsJson}\n</facts>\n\nNow write the strategist sections: offer/proof/CTA, why it sells, steal vs vary, replication plan. Stay consistent with the facts.`;
}

// ---------------------------------------------------------------- plano de variações

export const HOOK_SCHEMA = obj({
  lever: str('The lever in one line, in the diagnosis language: "<lever>: <what changes>".'),
  rationale: str('Why it may beat the original, 1-2 sentences, pointing to the verdict cause it attacks. A hypothesis, never a promised result.'),
  speech: str('The new spoken hook, in the champion language, as people really talk.'),
  onScreenText: str('Short text burned on screen during the hook (max 8 words), champion language. Empty string if the champion has no on-screen hook text.'),
});

export const CASTING_SCHEMA = obj({
  lever: str('"avatar: <who>" in one line, diagnosis language.'),
  rationale: str('Why this person may beat the original, 1-2 sentences, tied to the avatar/verdict. A hypothesis.'),
  castingDescription: str('One or two sentences, 150-400 characters, describing the person for a photo model.'),
});

export const SHARED_CASTING_SCHEMA = obj({ description: str('One or two sentences, 150-400 characters, describing the person for a photo model.') });

export function planSystem(language: string): string {
  return `You plan variations of a winning short video ad (the "champion") for a performance team. Each variation tests exactly ONE lever; everything else stays identical, so the test reads clean.

Rules:
- Spoken lines are written in the champion's language (${language}), as people really talk: short, concrete, no emojis, no hashtags, no stage directions.
- Never invent proof, numbers, results or guarantees. Use only what the champion or the team brief already says. Respect anything the brief lists as something to avoid.
- Never name, imitate or describe the person who appears in the champion. Casting starts from the ad format and the audience, not from that person.
- "lever" and "rationale" are written in the language of the diagnosis you receive. The rationale points to the cause in the champion's verdict that the variation attacks, as a hypothesis.`;
}

function sectionText<T>(s: { status: string; data: T | null }, f: (d: T) => string): string {
  return s.status === 'ok' && s.data ? f(s.data) : 'n/a';
}

/** Contexto estável do lote (cacheado entre os slots em paralelo). Não leva `visual.person`: o elenco nunca parte da pessoa. */
export function planContext(i: { offer: OfferBriefDraft; teardown: TeardownSections; transcript: TranscriptWord[]; hookEndSec: number; notes: string | null }): string {
  const t = i.teardown;
  const body = i.transcript.filter((w) => (w.startSec + w.endSec) / 2 >= i.hookEndSec);
  const hookWords = i.transcript.filter((w) => (w.startSec + w.endSec) / 2 < i.hookEndSec);
  return [
    `<team_offer>\n${briefBlock(i.offer)}\n</team_offer>`,
    `<champion_hook seconds="${r2(i.hookEndSec)}" words="${hookWords.length}">\nSpoken: ${hookWords.map((w) => w.word).join(' ') || sectionText(t.hook, (d) => d.spoken)}\nOn screen: ${sectionText(t.hook, (d) => d.onScreenText ?? '(none)')}\nFirst frame: ${sectionText(t.hook, (d) => d.visual)}\n</champion_hook>`,
    `<champion_body_literal>\n${body.map((w) => w.word).join(' ') || '(no speech after the hook)'}\n</champion_body_literal>`,
    `<structure>\n${sectionText(t.structure, (d) => d.blocks.map((b) => `- ${b.label} (${b.function}) ${r2(b.startSec)}-${r2(b.endSec)} s: ${b.speech}`).join('\n'))}\n</structure>`,
    `<format>\nLayout: ${sectionText(t.layout, (d) => d.summary)}\nVoice: ${sectionText(t.audio, (d) => d.voice)}\n</format>`,
    `<why_it_sells>\n${sectionText(t.whySells, (d) => [`Avatar: ${d.avatar}`, `Awareness: ${d.awarenessLevel}`, `Pain/desire: ${d.painDesire}`, `Big idea: ${d.bigIdea}`, `Belief/objection: ${d.beliefObjection}`, `Retention: ${d.retentionEngine}`, `Verdict:\n${d.verdict.map((v, k) => `  ${k + 1}. ${v}`).join('\n')}`].join('\n'))}\n</why_it_sells>`,
    `<steal_vs_vary>\n${sectionText(t.stealVsVary, (d) => [`Steal: ${d.steal.join(' | ')}`, `Vary: ${d.vary.map((v) => `${v.lever}: ${v.idea}`).join(' | ')}`].join('\n'))}\n</steal_vs_vary>`,
    i.notes?.trim() ? `<team_notes>\n${i.notes.trim()}\n</team_notes>` : null,
  ].filter(Boolean).join('\n\n');
}

/** Famílias de gancho: cada slot paralelo recebe uma, pra sair diferente dos outros (mesma ideia do roteiro v1). */
export const HOOK_LEVERS = [
  'curiosity: open a loop with a specific, surprising detail and hold the answer',
  'pain: name a concrete, everyday frustration of this audience in their own words',
  'proof: open with the strongest proof the champion or the brief already has (if none, a concrete before/after situation)',
  'contrarian: challenge a common belief or habit of this audience',
  'demonstration: promise to show how it works in a few seconds',
  'objection: say out loud the main doubt and turn it',
  'story: start a first-person moment in the middle of the action',
];

export function hookLeverFor(index: number, avoidCount: number): string {
  return HOOK_LEVERS[(index + avoidCount) % HOOK_LEVERS.length];
}

export function hookUserMessage(i: { index: number; count: number; lever: string; targetSec: number; targetWords: number; avoidLevers: string[]; diagnosisLanguage: string }): string {
  const avoid = i.avoidLevers.length ? `\nLevers already used in this test (do not repeat them or anything close): ${i.avoidLevers.map((a) => `"${a}"`).join(', ')}.` : '';
  return `Write NEW_HOOKS variation ${i.index + 1} of ${i.count}. Only the hook changes: the body after it stays word for word as in <champion_body_literal>, so the new hook must flow naturally into its first sentence.
Lever for this one: ${i.lever}. The other hooks are being written at the same time with other levers, so commit fully to this one.
Length: about ${i.targetSec} seconds spoken, about ${i.targetWords} words (the champion's hook length and pace). Write lever and rationale in ${i.diagnosisLanguage}.${avoid}`;
}

/** Eixos de elenco: cada item de SWAP_AVATAR muda a pessoa por um eixo diferente. */
export const CASTING_AXES = [
  'a clearly different age range from what the format suggests, still credible for this audience',
  'a different ethnicity and hair, same credibility',
  'a different everyday setting and clothing style that this audience would recognize as their own life',
  'a more polished, expert-looking presence (still natural, not corporate)',
];

export function castingUserMessage(i: { index: number; count: number; axis: string; avoidLevers: string[]; diagnosisLanguage: string; language: string }): string {
  const avoid = i.avoidLevers.length ? `\nCastings already used (choose someone clearly different): ${i.avoidLevers.map((a) => `"${a}"`).join(', ')}.` : '';
  return `Write SWAP_AVATAR variation ${i.index + 1} of ${i.count}: the same words, a different person on camera. The others are being cast at the same time; this one changes the person by: ${i.axis}.
${CASTING_RULES(i.language)}
Write lever and rationale in ${i.diagnosisLanguage}.${avoid}`;
}

export function sharedCastingUserMessage(i: { language: string }): string {
  return `Cast ONE person who will deliver every hook variation of this test (the person stays the same so only the hook changes). Pick the most credible face for this audience and format.
${CASTING_RULES(i.language)}`;
}

/** Regras de elenco comuns (lição do Pruna: o gênero do rosto tem que bater com o da voz). */
function CASTING_RULES(language: string): string {
  return `castingDescription rules: written in ${language}; state the gender plainly and keep the SAME gender as the voice in <format> (the original voice or a same-gender voice will speak these words); approximate age; simple everyday clothing and a setting that fits the ad; looking straight into the camera, framed from the chest up; exactly one person. Do not mention objects in their hands, phones, text, logos or brand names, and do not describe the champion's person.`;
}
