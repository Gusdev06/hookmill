// Fake determinístico do planejador semantic-v2 (templates-ia-previas §13 I1). Mesma entrada = mesma saída; sem nicho:
// as falas saem dos fatos da oferta. Fixture de desenvolvimento, identificada como tal (generationMode 'mock', custo 0).
//
// planPreviews devolve 5 candidatas: 4 produzíveis e distintas + 1 inválida na posição 2 (pede prova não fornecida:
// requirements ≠ []), para o filtro do backend ter o que recusar. planOne devolve 1 candidata fora das `exclude`.
//
// Gatilhos (texto em qualquer fato da oferta ou na fala do campeão):
//   [mock:plan-fail]     planPreviews/planOne lançam PROVIDER_ERROR (planejador falhou)
//   [mock:plan-refusal]  lançam SAFETY_BLOCK
//   [mock:plan-few]      planPreviews: só 1 produzível (+ inválidas) → backend: PLAN_FAILED (< 2)
//   [mock:plan-three]    planPreviews: 3 produzíveis (+ inválidas) → lote "3 of 4"
//   [mock:plan-one-fail] só planOne lança PROVIDER_ERROR (novo ângulo/retry falha; o lote segue)
import type { AiFormat, AiGender, AiSpeaker, PlanOneRequest, PlanPreviewsRequest, SemanticPlanV2 } from '@maquina/contratos';
import { IntegracaoError } from '../erros';
import { normV2, speakersOf, validateSemanticPlanV2, type SemanticContextV2 } from '../claude/semantic-v2';

export type MockTrigger = 'plan-fail' | 'plan-refusal' | 'plan-few' | 'plan-three' | 'plan-one-fail';
export const mockTrigger = (ctx: SemanticContextV2, t: MockTrigger) => [...ctx.facts.map((f) => f.text), ctx.transcript].some((s) => s.includes(`[mock:${t}]`));

type Txt = { pt: string; en: string };
interface Concept { title: Txt; angle: Txt; hookQ: Txt; hookS: Txt; axis2: 'hook' | 'narrative' | 'pain' | 'desire' | 'objection' | 'awareness' }
/** Ângulos genéricos (servem a qualquer oferta); a ordem é fixa para o fake ser determinístico. */
const CONCEPTS: Concept[] = [
  { title: { pt: 'A dúvida que trava a decisão', en: 'The doubt that stalls the decision' }, angle: { pt: 'Responde de frente a objeção que faz a pessoa adiar.', en: 'Answers head-on the objection that makes people put it off.' }, hookQ: { pt: 'Você já desistiu de algo só por não saber por onde começar?', en: 'Have you ever given up on something just because you did not know where to start?' }, hookS: { pt: 'Tem uma pergunta que quase todo mundo faz antes de decidir.', en: 'There is one question almost everyone asks before deciding.' }, axis2: 'objection' },
  { title: { pt: 'Como funciona, passo a passo', en: 'How it works, step by step' }, angle: { pt: 'Mostra o mecanismo em etapas simples em vez de prometer resultado.', en: 'Shows the mechanism in simple steps instead of promising results.' }, hookQ: { pt: 'Quer entender como isso funciona de verdade, sem enrolação?', en: 'Want to understand how this really works, without the fluff?' }, hookS: { pt: 'Vou explicar como isso funciona em poucas etapas simples.', en: 'Let me explain how this works in a few simple steps.' }, axis2: 'narrative' },
  { title: { pt: 'O custo de deixar como está', en: 'The cost of leaving it as is' }, angle: { pt: 'Foca no que a pessoa perde ao continuar sem resolver o problema.', en: 'Focuses on what people lose by leaving the problem unsolved.' }, hookQ: { pt: 'Quanto tempo você ainda vai deixar isso para depois?', en: 'How much longer are you going to leave this for later?' }, hookS: { pt: 'Deixar para depois também tem um preço que ninguém conta.', en: 'Putting it off also has a price nobody talks about.' }, axis2: 'pain' },
  { title: { pt: 'Para quem é, e para quem não é', en: 'Who it is for, and who it is not' }, angle: { pt: 'Qualifica o público com honestidade para quem se reconhece agir.', en: 'Qualifies the audience honestly so the right people act.' }, hookQ: { pt: 'Será que isso é mesmo para você? Vamos descobrir agora.', en: 'Is this really for you? Let us find out right now.' }, hookS: { pt: 'Isso não é para todo mundo, e tudo bem com isso.', en: 'This is not for everyone, and that is perfectly fine.' }, axis2: 'awareness' },
  { title: { pt: 'O primeiro passo mais simples', en: 'The simplest first step' }, angle: { pt: 'Reduz o esforço percebido mostrando um começo pequeno e concreto.', en: 'Lowers perceived effort by showing a small, concrete start.' }, hookQ: { pt: 'E se começar fosse bem mais simples do que você imagina?', en: 'What if getting started were much simpler than you think?' }, hookS: { pt: 'Começar costuma ser bem mais simples do que parece.', en: 'Getting started is usually much simpler than it looks.' }, axis2: 'desire' },
  { title: { pt: 'O erro mais comum de quem tenta', en: 'The most common mistake people make' }, angle: { pt: 'Parte do erro que todo mundo comete e mostra o caminho certo.', en: 'Starts from the mistake everyone makes and shows the right path.' }, hookQ: { pt: 'Sabe qual é o erro que quase todo mundo comete aqui?', en: 'Do you know the mistake almost everyone makes here?' }, hookS: { pt: 'Quase todo mundo comete o mesmo erro logo no começo.', en: 'Almost everyone makes the same mistake right at the start.' }, axis2: 'hook' },
  { title: { pt: 'O que muda no dia a dia', en: 'What changes day to day' }, angle: { pt: 'Traduz a oferta em uma rotina concreta, sem prometer milagre.', en: 'Turns the offer into a concrete routine, without promising miracles.' }, hookQ: { pt: 'Como ficaria o seu dia a dia com isso resolvido?', en: 'What would your day look like with this sorted out?' }, hookS: { pt: 'Imagine o seu dia a dia com isso finalmente resolvido.', en: 'Picture your day with this finally sorted out.' }, axis2: 'desire' },
  { title: { pt: 'A pergunta que ninguém faz', en: 'The question nobody asks' }, angle: { pt: 'Levanta a pergunta certa que muda a forma de avaliar a oferta.', en: 'Raises the right question that changes how the offer is judged.' }, hookQ: { pt: 'Por que ninguém faz essa pergunta antes de escolher?', en: 'Why does nobody ask this question before choosing?' }, hookS: { pt: 'Existe uma pergunta que quase ninguém faz antes de escolher.', en: 'There is a question almost nobody asks before choosing.' }, axis2: 'narrative' },
];
/** Elenco: nome, gênero e pessoa + cenário (inglês, para o facePromptV2). Pares para F10 = [i, i+1]. */
const PEOPLE: { name: string; gender: AiGender; person: string; set: string }[] = [
  { name: 'Marina', gender: 'female', person: 'A woman in her early thirties, shoulder-length dark wavy hair, plain olive linen shirt', set: 'a bright home office with a wooden desk and green plants' },
  { name: 'Rafael', gender: 'male', person: 'A man in his late thirties, short black hair and a trimmed beard, plain navy crew-neck sweater', set: 'a calm living room with a grey sofa and warm lamps' },
  { name: 'Júlia', gender: 'female', person: 'A woman in her mid twenties, long straight auburn hair, plain cream knit top', set: 'a cozy kitchen with white tiles and morning light' },
  { name: 'Thiago', gender: 'male', person: 'A man in his early forties, short greying hair, plain charcoal button-up shirt', set: 'a small study with bookshelves softly lit' },
  { name: 'Carla', gender: 'female', person: 'A woman in her mid forties, short curly black hair, plain mustard blouse', set: 'a modern studio with acoustic panels and a warm backlight' },
  { name: 'Bruno', gender: 'male', person: 'A man in his late twenties, curly brown hair, plain white t-shirt under an open grey overshirt', set: 'a quiet balcony with city rooftops far behind' },
  { name: 'Lúcia', gender: 'female', person: 'A woman in her late fifties, silver bob haircut, plain teal cardigan', set: 'a sunny reading corner with an armchair and a window' },
  { name: 'Diego', gender: 'male', person: 'A man in his mid thirties, shaved head and a short beard, plain black polo shirt', set: 'a minimalist room with a concrete wall and a single plant' },
  { name: 'Paula', gender: 'female', person: 'A woman in her late thirties, long braided dark hair, plain burgundy sweater', set: 'a cafe-style corner with a brick wall behind' },
  { name: 'André', gender: 'male', person: 'A man in his early fifties, short white hair and glasses, plain light blue shirt', set: 'a tidy workshop with wooden shelves' },
  { name: 'Beatriz', gender: 'female', person: 'A woman in her early twenties, high ponytail of black hair, plain lilac hoodie', set: 'a dorm-style room with fairy lights and a pinboard' },
  { name: 'Gustavo', gender: 'male', person: 'A man in his early thirties, wavy light brown hair, plain sage green henley', set: 'a sunlit loft with tall windows and a rug' },
  { name: 'Renata', gender: 'female', person: 'A woman in her early forties, straight blonde hair to the chin, plain white button-up shirt', set: 'a clean office meeting room with glass walls' },
  { name: 'Marcelo', gender: 'male', person: 'A man in his mid forties, receding dark hair and stubble, plain brown corduroy jacket over a grey tee', set: 'a garage studio with pegboard tools on the wall' },
  { name: 'Fernanda', gender: 'female', person: 'A woman in her early thirties, short pixie-cut brown hair, plain coral t-shirt', set: 'a small garden patio with potted herbs' },
  { name: 'Lucas', gender: 'male', person: 'A man in his early twenties, short twisted black hair, plain yellow sweatshirt', set: 'a colorful bedroom with posters and a desk lamp' },
  { name: 'Sônia', gender: 'female', person: 'A woman in her mid sixties, short white curly hair, plain navy knit vest over a white blouse', set: 'a classic dining room with a wooden cabinet' },
  { name: 'Eduardo', gender: 'male', person: 'A man in his late fifties, neat grey beard, plain dark green quarter-zip sweater', set: 'a home library with leather chairs' },
  { name: 'Camila', gender: 'female', person: 'A woman in her late twenties, long curly dark hair, plain rust-colored dress', set: 'a plant shop corner with hanging pots' },
  { name: 'Felipe', gender: 'male', person: 'A man in his mid thirties, short blond hair, plain light grey hoodie', set: 'a coworking space with long wooden tables' },
  { name: 'Patrícia', gender: 'female', person: 'A woman in her early fifties, shoulder-length grey-streaked hair, plain denim shirt', set: 'a craft room with shelves of fabric' },
  { name: 'Rodrigo', gender: 'male', person: 'A man in his early forties, tied-back long dark hair, plain black t-shirt', set: 'a music room with acoustic foam and a guitar on the wall' },
  { name: 'Aline', gender: 'female', person: 'A woman in her mid thirties, sleek black bob, plain emerald blouse', set: 'a calm spa-like room with soft beige walls' },
  { name: 'Vinícius', gender: 'male', person: 'A man in his late twenties, short dreadlocks, plain orange crew-neck sweater', set: 'a rooftop terrace with string lights' },
];

const words = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ').replace(/[,;:]$/, '');

function draft(ctx: SemanticContextV2, format: AiFormat, uiLocale: string, conceptIdx: number, peopleIdx: number, invalid = false) {
  const ui = (t: Txt) => (uiLocale.startsWith('pt') ? t.pt : t.en);
  const ct = (t: Txt) => (ctx.language.startsWith('pt') ? t.pt : t.en);
  const c = CONCEPTS[conceptIdx % CONCEPTS.length];
  const what = ctx.facts.find((f) => f.id === 'offer.what') ?? ctx.facts[0];
  const cta = ctx.facts.find((f) => f.id === 'offer.cta') ?? what;
  const promise = ctx.facts.find((f) => f.id === 'offer.promise') ?? what;
  const source = sourceOf(ctx);
  const speakers = speakersOf(format);
  const cast = speakers.map((speaker, k) => {
    const p = PEOPLE[(peopleIdx + k) % PEOPLE.length];
    const scene = format === 'F10' ? 'seated at a podcast table in a warm studio set with wood panels, a broadcast microphone on a short stand below the chin, in conversation' : `sitting in ${p.set}`;
    return { speaker, name: p.name, gender: p.gender, description: `${p.person}, ${scene}. One person only, hands resting out of view, no text or logos anywhere.` };
  });
  const line = (s: string) => (countOk(s) ? s : `${s} ${ct({ pt: 'É simples assim.', en: 'It is that simple.' })}`);
  type B = { role: 'hook' | 'objection' | 'mechanism' | 'proof' | 'cta'; speaker: AiSpeaker; text: string; visual: string; factRefs: string[] };
  const visual = ct({ pt: 'Fala com calma no mesmo cenário, gestos contidos.', en: 'Speaks calmly in the same set, restrained gestures.' });
  const b = (role: B['role'], speaker: AiSpeaker, text: string, refs: string[]): B => ({ role, speaker, text: line(text), visual, factRefs: refs });
  const beats: B[] = format === 'F10' ? [
    b('hook', 'host', ct(c.hookQ), []),
    b('mechanism', 'presenter', `${ct({ pt: 'Resumindo:', en: 'In short:' })} ${words(what.text, 22)}`, [what.id]),
    b('objection', 'host', ct({ pt: 'E o que a pessoa ganha com isso na prática?', en: 'And what does someone actually get out of it?' }), []),
    b('cta', 'presenter', `${words(promise.text === what.text ? cta.text : promise.text, 14)}. ${words(cta.text, 14)}`, [...new Set([promise.id, cta.id])]),
  ] : [
    b('hook', 'presenter', format === 'F04' ? ct(c.hookQ) : ct(c.hookS), []),
    b('mechanism', 'presenter', `${ct({ pt: 'Funciona assim:', en: 'Here is how it works:' })} ${words(what.text, 22)}`, [what.id]),
    b('cta', 'presenter', words(cta.text, 22), [cta.id]),
  ];
  const factRefs = [...new Set(beats.flatMap((x) => x.factRefs))];
  return {
    title: ui(c.title), angle: ui(c.angle),
    summary: `${ui(c.angle)} ${ui({ pt: 'Simulação de desenvolvimento, não escrita pelo modelo.', en: 'Development simulation, not model-written.' })}`,
    audience: ctx.facts.find((f) => f.id === 'offer.audience')?.text.slice(0, 300) ?? ui({ pt: 'Público declarado da oferta', en: 'Declared offer audience' }),
    hypothesis: ui({ pt: 'Hipótese ilustrativa: um ângulo novo pode atrair atenção diferente; precisa de teste.', en: 'Illustrative hypothesis: a new angle may draw different attention; it needs testing.' }),
    changes: [
      { axis: 'angle', before: ui({ pt: `Promete direto: ${source.promise}`, en: `Pitches the promise head-on: ${source.promise}` }), after: ui(c.angle) },
      { axis: c.axis2, before: ui({ pt: `Abre com a frase “${source.hook}”`, en: `Opens with the line “${source.hook}”` }), after: ui(c.title) },
      { axis: 'messenger', before: ui({ pt: `Talking head falando de ${source.topic}`, en: `Talking head speaking about ${source.topic}` }), after: cast.map((x) => x.name).join(' + ') },
    ],
    preserved: [ui({ pt: 'Produto, condições e CTA declarados', en: 'Declared product, terms and CTA' })],
    factRefs,
    requirements: invalid ? [{ kind: 'proof', description: ui({ pt: 'Depoimento real de cliente (não fornecido).', en: 'Real customer testimonial (not supplied).' }) }] : [],
    beats, cast,
  };
}
/** O que o anúncio original faz de fato (fala do campeão + oferta), para o `before` das mudanças nunca ser rótulo genérico. */
function sourceOf(ctx: SemanticContextV2) {
  const what = ctx.facts.find((f) => f.id === 'offer.what') ?? ctx.facts[0];
  const promise = ctx.facts.find((f) => f.id === 'offer.promise') ?? what;
  const spoken = ctx.transcript.trim();
  return { hook: words(spoken || what.text, 10), topic: words(what.text, 8), promise: words(spoken || promise.text, 14) };
}
const countOk = (s: string) => s.trim().split(/\s+/).length >= 5;

export function mockPreviewsDraft(ctx: SemanticContextV2, req: PlanPreviewsRequest) {
  const valid = mockTrigger(ctx, 'plan-few') ? 1 : mockTrigger(ctx, 'plan-three') ? 3 : 4;
  const total = Math.max(req.count, valid + 1);
  const people = speakersOf(req.format).length;
  const out: ReturnType<typeof draft>[] = [];
  let concept = 0, accepted = 0;
  for (let i = 0; i < total; i++) {
    // posição 2 é sempre a inválida; com menos produzíveis, as sobras também são inválidas
    const invalid: boolean = i === 2 || accepted >= valid;
    out.push(draft(ctx, req.format, req.uiLocale, concept, (invalid ? PEOPLE.length - people : accepted * people), invalid));
    if (!invalid) { concept++; accepted++; }
  }
  return { variations: out };
}

export function mockOneDraft(ctx: SemanticContextV2, req: PlanOneRequest) {
  const titles = new Set(req.exclude.map((x) => normV2(x.title)));
  const names = new Set(req.exclude.flatMap((x) => x.cast.map((c) => c.name)));
  const ui = (t: Txt) => (req.uiLocale.startsWith('pt') ? t.pt : t.en);
  const concept = CONCEPTS.findIndex((c) => !titles.has(normV2(ui(c.title))));
  const per = speakersOf(req.format).length;
  // 1º elenco sem nenhum nome excluído; se o pool esgotar, o de menor sobreposição (nunca devolve o elenco de antes)
  const overlap = (st: number) => Array.from({ length: per }, (_, k) => PEOPLE[(st + k) % PEOPLE.length].name).filter((n) => names.has(n)).length;
  const starts = Array.from({ length: PEOPLE.length }, (_, i) => (i * per) % PEOPLE.length);
  const start = starts.reduce((best, st) => (overlap(st) < overlap(best) ? st : best), starts[0]);
  // catálogo do fake esgotado: ainda devolve 1 candidata (o backend recusa por conceito repetido)
  return { variations: [draft(ctx, req.format, req.uiLocale, concept < 0 ? req.exclude.length : concept, start)] };
}

export function mockPlanPreviews(ctx: SemanticContextV2, req: PlanPreviewsRequest): SemanticPlanV2 {
  guard(ctx, false);
  const { rejected, ...plan } = validateSemanticPlanV2(mockPreviewsDraft(ctx, req), ctx, req, 'mock', 0);
  void rejected;
  return plan;
}
export function mockPlanOne(ctx: SemanticContextV2, req: PlanOneRequest): SemanticPlanV2 {
  guard(ctx, true);
  const { rejected, ...plan } = validateSemanticPlanV2(mockOneDraft(ctx, req), ctx, req, 'mock', 0);
  void rejected;
  return plan;
}
function guard(ctx: SemanticContextV2, one: boolean) {
  if (mockTrigger(ctx, 'plan-refusal')) throw new IntegracaoError('SAFETY_BLOCK');
  if (mockTrigger(ctx, 'plan-fail') || (one && mockTrigger(ctx, 'plan-one-fail'))) throw new IntegracaoError('PROVIDER_ERROR', 'mock semantic-v2 planner failed');
}
