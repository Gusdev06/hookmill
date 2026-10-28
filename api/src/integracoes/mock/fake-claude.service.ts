// ClaudeService do modo mock: respostas determinísticas montadas a partir da entrada, com as
// mesmas etapas, streaming e falha parcial do real. Custo zero (grava cost_entry LLM com 0).
//
// Gatilhos (pra QA testar erros):
//   extractOffer: url contendo "mock-403" → PAGE_FORBIDDEN; "mock-unreadable" (ou sem url e sem texto) → PAGE_UNREADABLE;
//                 "mock-429" → RATE_LIMITED; "mock-login" → PAGE_UNREADABLE { reason: 'login_wall' } (leitura v2 §7);
//                 "mock-vision" → readMode 'vision' com principal + checkout, 2 imagens lidas (imageNotes) e
//                 offerAndPrice vindo da imagem 1 (fieldOrigins com imageIndex). Os 6 stages do §4.3 são emitidos.
//   generateScripts: offer.notes contendo "[mock:fail-slot:N]" (N = 0-based) → slot N falha com PROVIDER_ERROR;
//                    "[mock:fail-all]" → todos falham.
//   analyzeChampion (feature 2): offer.notes contendo "[mock:analysis-fail]" → PROVIDER_ERROR. (O gatilho do contrato
//                    mora nas notes do CAMPEÃO, que não entram no analyzeChampion: o backend repassa via offer.notes
//                    ou checa ele mesmo.)
//   planVariations: notes do lote "[mock:fail-item:<KIND>:<N>]" → item falha (PROVIDER_ERROR); "[mock:fail-all]" → todos;
//                   COPY_NEW / REMIX_EDIT → KIND_NOT_ENABLED (até a vez deles).
//                   §13: hookMode TEXT → só onScreenText (speech = fala original); editMap.profile → elenco do perfil.
//   analyzeChampion (variação automática §10): offer.notes com "[mock:auto-fail:reading]" → PROVIDER_ERROR (leitura falha).
//   planAutoBatch (variação automática §7.1/§10): determinístico a partir do teardown (mock/fake-auto-plan.ts); gatilhos
//                   [mock:auto-fail:planning], [mock:auto-plan-invalid], [mock:page-403] nas notes da oferta.
//   describeEdit (§13.2): determinístico, 1 headline com fundo chapado (topo, do 0 ao fim do gancho) + 1 legenda karaokê
//                   (embaixo, da 1ª à última palavra); sem fala = só a headline. Perfil genérico com gênero null.
//                   Gatilhos nas notes do campeão (mesmos nomes do mock do web): [mock:keep-straddle] → legenda metade
//                   dentro, metade fora da região do rosto; [mock:keep-overlay] → painel sobre o rosto no terço do meio;
//                   [mock:hook-over-video] → headline sem fundo (texto direto sobre o vídeo).
//                   headline-e-legenda-v1: [mock:headline-over-video] → idem, o vídeo todo; [mock:headline-none] → sem headline.
//                   legenda-protegida-v1: [mock:burned-captions] → legenda queimada (karaokê) na fala; sem ele, nenhuma.
import type {
  AdLibraryMeta,
  AutoPlanDraft,
  AutoPlanInput,
  CastingStyle,
  ClaudeService,
  DescribeEditInput,
  EditLayer,
  ExtractSources,
  ExtractStage,
  EditMap,
  EditMapDraft,
  HookMode,
  PersonProfile,
  Measurements,
  OfferBriefDraft,
  ScriptBlockDraft,
  ScriptDraft,
  TeardownDraft,
  TeardownSections,
  TranscriptWord,
  Usage,
  VariationItemDraft,
  VariationKind,
  WinnerExample,
} from '../contrato';
import { genderOf } from '../catalogo/genero';
import { castingGenderOf, describeCasting, diverseCasting } from '../claude/elenco';
import { planParams } from '../claude/claude.service';
import { normalizeLanguage } from '../claude/validacao';
import { snapToSilence } from '../claude/validacao-campeao';
import { IntegracaoError } from '../erros';
import type { CostStore } from '../portas';
import { hookTextSlot, spokenHookOf } from '../claude/edicao';
import { seedOf, unit } from './midia';
import { mockAutoPlan } from './fake-auto-plan';
import type { CheckStaticTextInput, CheckStaticTextResult, StaticTextCheckPort } from '../contrato';
import type { CaptionCheckPort, CheckCaptionInput } from '../contrato';
import type { CheckCaptionInputAny, CheckCaptionVerdict } from '../claude/checagem-legenda';

/** Erro de grafia determinístico do mock (o defeito real visto no 1k: "volta" → "vólta"). Tira o 1º acento, se houver;
 *  senão põe um agudo na 1ª vogal sem acento. */
export function misspell(text: string): string {
  const strip: Record<string, string> = { á: 'a', à: 'a', â: 'a', ã: 'a', é: 'e', ê: 'e', í: 'i', ó: 'o', ô: 'o', õ: 'o', ú: 'u', ç: 'c' };
  const acc = text.search(/[áàâãéêíóôõúç]/i);
  if (acc >= 0) return text.slice(0, acc) + (strip[text[acc].toLowerCase()] ?? text[acc]) + text.slice(acc + 1);
  const add: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };
  const v = text.search(/[aeiou]/);
  return v >= 0 ? text.slice(0, v) + add[text[v]] + text.slice(v + 1) : `${text}x`;
}

export interface FakeClaudeOptions {
  model: string;
  /** Pausa entre etapas/pedaços do streaming. Padrão 150 ms; testes usam 0. */
  stepMs?: number;
}

type Lang = 'en' | 'pt' | 'es';

const ANGLES: Record<Lang, string[]> = {
  en: ['Hidden cost', 'Before and after', 'Myth vs truth', 'Fast win', 'Social proof', 'Us vs them', 'Mistake to avoid'],
  pt: ['Custo escondido', 'Antes e depois', 'Mito ou verdade', 'Vitória rápida', 'Prova social', 'Nós contra eles', 'Erro que todo mundo comete'],
  es: ['Costo oculto', 'Antes y después', 'Mito o verdad', 'Victoria rápida', 'Prueba social', 'Nosotros contra ellos', 'Error a evitar'],
};

const T: Record<Lang, Record<string, string>> = {
  en: {
    hook: 'Stop scrolling: {angle} is why {audience} still struggle with this.',
    problem: '{pains} And nobody tells you the real reason.',
    product: '{what} {promise}',
    proof: '{proof}',
    cta: '{cta}',
    rationale: 'Opens with "{angle}" to stop {audience} in the first 3 seconds, then names the pain before the product.',
    winners: ' Follows the hook → problem → product → proof → CTA rhythm of {n} past winner(s), structure only.',
    defAudience: 'people like you',
    defPains: 'You tried everything and it still does not work.',
    defWhat: 'This changes that.',
    defPromise: '',
    defProof: 'Thousands already use it every day.',
    defCta: 'Tap the link and try it today.',
  },
  pt: {
    hook: 'Para tudo: {angle} é o motivo de {audience} ainda sofrer com isso.',
    problem: '{pains} E ninguém te conta o motivo real.',
    product: '{what} {promise}',
    proof: '{proof}',
    cta: '{cta}',
    rationale: 'Abre com "{angle}" pra parar {audience} nos 3 primeiros segundos e nomeia a dor antes do produto.',
    winners: ' Segue o ritmo gancho → problema → produto → prova → CTA de {n} vencedor(es), só a estrutura.',
    defAudience: 'gente como você',
    defPains: 'Você já tentou de tudo e nada funciona.',
    defWhat: 'Isso aqui muda o jogo.',
    defPromise: '',
    defProof: 'Milhares de pessoas já usam todo dia.',
    defCta: 'Toca no link e testa hoje.',
  },
  es: {
    hook: 'Para de deslizar: {angle} es la razón por la que {audience} sigue sufriendo con esto.',
    problem: '{pains} Y nadie te dice la razón real.',
    product: '{what} {promise}',
    proof: '{proof}',
    cta: '{cta}',
    rationale: 'Abre con "{angle}" para detener a {audience} en los primeros 3 segundos y nombra el dolor antes del producto.',
    winners: ' Sigue el ritmo gancho → problema → producto → prueba → CTA de {n} ganador(es), solo la estructura.',
    defAudience: 'gente como tú',
    defPains: 'Ya probaste de todo y nada funciona.',
    defWhat: 'Esto lo cambia todo.',
    defPromise: '',
    defProof: 'Miles de personas ya lo usan cada día.',
    defCta: 'Toca el enlace y pruébalo hoy.',
  },
};

const VISUAL: Record<string, string> = {
  hook: 'SOLO SHOT, one person centered, looks straight into the camera, eyebrows raised, natural window light',
  problem: 'SOLO SHOT, same person, slight head tilt, honest expression, hands resting at chest height',
  product: 'SOLO SHOT, same person, leans a little toward the camera, confident smile',
  proof: 'SOLO SHOT, same person, nods while speaking, relaxed posture',
  cta: 'SOLO SHOT, same person, warm smile, points down toward the caption area',
};

const DURATIONS: [string, number][] = [
  ['hook', 3],
  ['problem', 8],
  ['product', 9],
  ['proof', 5],
  ['cta', 4],
];

export function langOf(language: string): Lang {
  const l = language.toLowerCase();
  return l.startsWith('pt') ? 'pt' : l.startsWith('es') ? 'es' : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '').replace(/\s+/g, ' ').trim();
}

export class FakeClaudeService implements ClaudeService, StaticTextCheckPort, CaptionCheckPort {
  constructor(
    private readonly costs: CostStore,
    private readonly opts: FakeClaudeOptions,
  ) {}

  async extractOffer(
    input: { url?: string; pageText?: string; workspaceId: string; jobId: string },
    onStage: (stage: ExtractStage) => void,
  ): Promise<OfferBriefDraft & Usage & ExtractSources> {
    const vision = !!input.url?.includes('mock-vision');
    if (input.url) {
      onStage('fetching_page');
      await this.pause();
      if (input.url.includes('mock-403')) throw new IntegracaoError('PAGE_FORBIDDEN', 'page returned 403');
      if (input.url.includes('mock-429')) throw new IntegracaoError('RATE_LIMITED', 'rate limited');
      if (input.url.includes('mock-unreadable')) throw new IntegracaoError('PAGE_UNREADABLE', 'no readable text');
      if (input.url.includes('mock-login')) throw new IntegracaoError('PAGE_UNREADABLE', 'login wall', { reason: 'login_wall' });
      // leitura v2 §4.3: etapas de leitura sempre emitidas (o backend marca feita a que não precisou rodar)
      onStage('rendering_page');
      // A1 (28/10): `mock-quiz` na URL simula o caminhante de funil (etapa só aparece quando ele roda)
      if (input.url.includes('mock-quiz')) { onStage('walking_quiz'); await this.pause(); }
      onStage('reading_subpages');
      onStage('reading_images');
      if (vision) await this.pause();
    } else if (!input.pageText?.trim()) {
      throw new IntegracaoError('PAGE_UNREADABLE', 'no url and no page text');
    }
    onStage('extracting');
    await this.pause();
    const text = input.pageText ?? '';
    onStage('detecting_language');
    await this.pause();
    const language = detectLanguage(text, input.url);

    let name = 'Sample Offer';
    if (input.url) {
      try {
        const host = new URL(input.url).hostname.replace(/^www\./, '').split('.')[0];
        name = host.charAt(0).toUpperCase() + host.slice(1);
      } catch {
        /* url inválida: fica o nome padrão */
      }
    } else {
      name = text.trim().split('\n')[0].slice(0, 60) || name;
    }
    const lg = langOf(language);
    const brief: OfferBriefDraft = {
      name,
      language,
      kind: lg === 'pt' ? 'Produto digital' : lg === 'es' ? 'Producto digital' : 'Digital product',
      what: lg === 'pt' ? `${name} resolve o problema principal do cliente em poucos minutos.` : lg === 'es' ? `${name} resuelve el problema principal del cliente en minutos.` : `${name} solves the customer's main problem in minutes.`,
      audience: T[lg].defAudience,
      promise: lg === 'pt' ? 'Resultado visível na primeira semana.' : lg === 'es' ? 'Resultado visible en la primera semana.' : 'Visible results in the first week.',
      pains: T[lg].defPains,
      proof: T[lg].defProof,
      offerAndPrice: vision ? (lg === 'pt' ? '12x de R$ 49,70 (lido do banner)' : lg === 'es' ? '12 cuotas de US$ 9,90 (leído del banner)' : '12 payments of $9.90 (read from the banner)') : null,
      cta: T[lg].defCta,
      notes: null,
    };
    await this.recordCost(input.workspaceId, input.jobId, null);
    // resultado-v1 (A2/A3): sugestões determinísticas; `mock-lead`/`mock-app` na url trocam o resultado, texto colado = sem cor
    const resultType = input.url?.includes('mock-lead') ? 'LEAD' : input.url?.includes('mock-app') ? 'APP_INSTALL' : 'PURCHASE';
    const business = {
      industry: lg === 'pt' ? 'Produto digital' : lg === 'es' ? 'Producto digital' : 'Digital product',
      market: lg === 'pt' ? 'Brasil' : lg === 'es' ? null : 'United States',
      resultType,
    } as const;
    const brandColor = input.url && !input.url.includes('mock-nocolor') ? { hex: '#E4572E', source: 'cta' as const } : null;
    return { ...brief, costUsd: 0, ...this.readSources(input, brief, vision), business, brandColor };
  }

  /** ExtractSources do mock (§4.1): texto colado = pasted; url = http; mock-vision = principal + checkout + 2 imagens. */
  private readSources(input: { url?: string; pageText?: string }, brief: OfferBriefDraft, vision: boolean): ExtractSources {
    const url = input.url ?? '';
    if (!input.url || input.pageText?.trim()) {
      const origins = this.originsOf(brief, [{ role: 'main', url }]);
      return { readMode: 'pasted', pages: [{ url, role: 'main', via: 'http', chars: (input.pageText ?? '').trim().length }], imagesRead: [], fieldOrigins: origins, relatedUrls: [] };
    }
    if (!vision) {
      return { readMode: 'http', pages: [{ url, role: 'main', via: 'http', chars: 4200 }], imagesRead: [], fieldOrigins: this.originsOf(brief, [{ role: 'main', url }]), relatedUrls: [] };
    }
    let checkout = `${url.replace(/\/$/, '')}/checkout`;
    try { checkout = new URL('/checkout', url).toString(); } catch { /* url inválida: fica a concatenação */ }
    const pages: ExtractSources['pages'] = [{ url, role: 'main', via: 'rendered', chars: 423 }, { url: checkout, role: 'checkout', via: 'http', chars: 1800 }];
    const imagesRead: ExtractSources['imagesRead'] = [
      { index: 1, src: `${url}#screen-1`, alt: null, kind: 'screenshot', widthPx: 724, heightPx: 1568, read: 'Hero banner with the offer promise, a price of 12 x 49.70 and a "Buy now" button.' },
      { index: 2, src: `${checkout}#screen-1`, alt: null, kind: 'screenshot', widthPx: 724, heightPx: 1568, read: 'Checkout form with order summary and 7-day guarantee seal.' },
    ];
    const fieldOrigins = this.originsOf(brief, [{ role: 'main', url }]);
    fieldOrigins.offerAndPrice = [{ role: 'main', url, imageIndex: 1 }, { role: 'checkout', url: checkout }];
    fieldOrigins.proof = [{ role: 'main', url }, { role: 'checkout', url: checkout, imageIndex: 2 }];
    return { readMode: 'vision', pages, imagesRead, fieldOrigins, relatedUrls: [checkout] };
  }

  private originsOf(brief: OfferBriefDraft, from: { role: 'main'; url: string }[]): ExtractSources['fieldOrigins'] {
    const out: ExtractSources['fieldOrigins'] = {};
    for (const k of ['name', 'kind', 'what', 'audience', 'promise', 'pains', 'proof', 'offerAndPrice', 'cta', 'notes'] as const) {
      if (brief[k] != null && brief[k] !== '') out[k] = from.map((f) => ({ ...f }));
    }
    return out;
  }

  async generateScripts(
    input: { workspaceId: string; creativeId: string; jobId: string; offer: OfferBriefDraft; count: number; avoidAngles: string[]; winners: WinnerExample[] },
    cb: {
      onStage(stage: 'reading_brief' | 'studying_winners' | 'writing'): void;
      onDelta(slot: number, blockIndex: number, field: 'speech' | 'angle' | 'rationale', text: string): void;
      onScriptDone(slot: number, draft: ScriptDraft): void;
      onScriptFailed(slot: number, errorCode: string): void;
    },
  ): Promise<Usage> {
    cb.onStage('reading_brief');
    await this.pause();
    if (input.winners.length) {
      cb.onStage('studying_winners');
      await this.pause();
    }
    cb.onStage('writing');

    const lg = langOf(input.offer.language);
    const avoid = new Set(input.avoidAngles.map((a) => a.toLowerCase()));
    const pool = ANGLES[lg].filter((a) => !avoid.has(a.toLowerCase()));
    const start = Math.floor(unit(seedOf(input.offer.name, input.offer.promise ?? ''), 'angle') * ANGLES[lg].length);
    const notes = input.offer.notes ?? '';
    const failAll = notes.includes('[mock:fail-all]');
    const failSlots = new Set([...notes.matchAll(/\[mock:fail-slot:(\d+)\]/g)].map((m) => Number(m[1])));

    await Promise.all(
      Array.from({ length: input.count }, async (_, slot) => {
        const angle = pool.length ? pool[(start + slot) % pool.length] : `${ANGLES[lg][slot % ANGLES[lg].length]} ${slot + 1}`;
        const draft = buildScript(lg, input.offer, angle, input.winners);
        cb.onDelta(slot, 0, 'angle', draft.angle);
        await this.pause();
        if (failAll || failSlots.has(slot)) {
          cb.onScriptFailed(slot, 'PROVIDER_ERROR');
          return;
        }
        cb.onDelta(slot, 0, 'rationale', draft.rationale);
        for (let b = 0; b < draft.blocks.length; b++) {
          for (const chunk of chunks(draft.blocks[b].speech)) {
            cb.onDelta(slot, b, 'speech', chunk);
            await this.pause(4);
          }
        }
        cb.onScriptDone(slot, draft);
      }),
    );
    await this.recordCost(input.workspaceId, input.jobId, input.creativeId);
    return { costUsd: 0 };
  }

  async suggestFaceDescription(input: { offer: OfferBriefDraft; script: ScriptDraft; workspaceId: string; creativeId: string }): Promise<string> {
    const lg = langOf(input.offer.language);
    const audience = input.offer.audience ?? T[lg].defAudience;
    const age = 25 + Math.floor(unit(seedOf(input.creativeId), 'age') * 20);
    if (lg === 'pt') return `Uma pessoa de ${age} anos que parece fazer parte de "${audience}", roupa casual, em casa com luz natural, olhando pra câmera.`;
    if (lg === 'es') return `Una persona de ${age} años que parece parte de "${audience}", ropa casual, en casa con luz natural, mirando a la cámara.`;
    return `A ${age}-year-old person who looks like part of "${audience}", casual clothes, at home in natural light, looking at the camera.`;
  }

  // ---------------------------------------------------------------------------- feature 2

  async analyzeChampion(
    i: {
      workspaceId: string; championId: string; jobId: string; uiLocale: 'EN' | 'PT_BR';
      offer: OfferBriefDraft | null; transcript: { language: string; words: TranscriptWord[] };
      measurements: Omit<Measurements, 'keyframes'>; keyframes: { atSec: number; reason: string; url: string }[];
      adMeta: AdLibraryMeta | null;
    },
    onStage: (s: 'diagnosing') => void,
  ): Promise<TeardownDraft & Usage> {
    onStage('diagnosing');
    await this.pause();
    if ((i.offer?.notes ?? '').includes('[mock:auto-fail:reading]')) throw new IntegracaoError('PROVIDER_ERROR', 'mock auto reading failure');
    if ((i.offer?.notes ?? '').includes('[mock:analysis-fail]')) throw new IntegracaoError('PROVIDER_ERROR', 'mock analysis failure');
    const sections = mockTeardown(i.uiLocale, i.transcript.words, i.measurements, i.adMeta, i.keyframes.length);
    await this.costs.record({ workspaceId: i.workspaceId, championId: i.championId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0, jobId: i.jobId });
    return { language: normalizeLanguage(i.transcript.language), sections, costUsd: 0 };
  }

  async planVariations(
    i: {
      workspaceId: string; batchId: string; jobId: string; language: string;
      offer: OfferBriefDraft; teardown: TeardownSections; transcript: TranscriptWord[];
      slots: { kind: VariationKind; index: number }[]; avoidLevers: string[]; notes: string | null;
      editMap?: EditMap | null; hookMode?: HookMode; castingStyle?: CastingStyle; castingGender?: 'female' | 'male' | null;
    },
    cb: {
      onSharedCasting(description: string): void;
      onItemDone(kind: VariationKind, index: number, draft: VariationItemDraft): void;
      onItemFailed(kind: VariationKind, index: number, errorCode: string): void;
    },
  ): Promise<Usage> {
    const textHooks = i.hookMode === 'TEXT';
    const baseProfile = i.editMap?.profile ?? null;
    const profile = baseProfile && i.castingGender ? { ...baseProfile, gender: i.castingGender } : baseProfile;
    const diverse = (i.castingStyle ?? 'DIVERSE') === 'DIVERSE';
    const notes = i.notes ?? '';
    const failAll = notes.includes('[mock:fail-all]');
    const failItems = new Set([...notes.matchAll(/\[mock:fail-item:([A-Z_]+):(\d+)\]/g)].map((m) => `${m[1]}:${m[2]}`));
    const lg = langOf(i.language);
    const gender = castingGenderOf(i.castingGender, genderOf(i.teardown.audio.data?.voice ?? ''), baseProfile?.gender, genderOf(i.teardown.visual.data?.person ?? ''));
    // §13.13: mesmos eixos sorteados do serviço real (posição 0 = compartilhado, SWAP k = k + 1)
    const diverseAt = (position: number) =>
      describeCasting(diverseCasting({ batchId: i.batchId, position, gender, originalEthnicity: baseProfile?.ethnicity ?? '', usedCastings: i.avoidLevers }), lg, profile);
    const p = planParams(i.teardown, i.transcript);

    if (i.slots.some((s) => (s.kind === 'NEW_HOOKS' && !textHooks) || s.kind === 'COPY_NEW')) {
      await this.pause();
      cb.onSharedCasting(diverse ? diverseAt(0) : CASTINGS[lg][gender][0]);
    }
    const avoid = new Set(i.avoidLevers.map((a) => a.toLowerCase()));
    await Promise.all(
      i.slots.map(async ({ kind, index }) => {
        await this.pause();
        if (kind === 'COPY_NEW' || kind === 'REMIX_EDIT') return cb.onItemFailed(kind, index, 'KIND_NOT_ENABLED');
        if (failAll || failItems.has(`${kind}:${index}`)) return cb.onItemFailed(kind, index, 'PROVIDER_ERROR');
        if (kind === 'NEW_HOOKS' && textHooks) {
          const slot = hookTextSlot(i.editMap, p.hookEndSec);
          const pool = HOOKS[lg].filter((h) => !avoid.has(h.lever.toLowerCase()));
          const h = (pool.length ? pool : HOOKS[lg])[index % (pool.length || HOOKS[lg].length)];
          const text = (slot.uppercase ? h.onScreen.toUpperCase() : h.onScreen).slice(0, slot.maxChars);
          return cb.onItemDone(kind, index, { lever: h.lever, rationale: h.rationale, hook: { speech: spokenHookOf(i.transcript, p.hookEndSec, i.teardown.hook.data?.spoken ?? ''), onScreenText: text, durationSec: p.targetSec } });
        }
        if (kind === 'NEW_HOOKS') {
          const pool = HOOKS[lg].filter((h) => !avoid.has(h.lever.toLowerCase()));
          const h = (pool.length ? pool : HOOKS[lg])[index % (pool.length || HOOKS[lg].length)];
          const words = h.speech.split(' ').length;
          return cb.onItemDone(kind, index, {
            lever: h.lever, rationale: h.rationale,
            hook: { speech: h.speech, onScreenText: h.onScreen, durationSec: Math.max(1, Math.round((words / p.wordsPerSec) * 10) / 10) },
          });
        }
        const list = CASTINGS[lg][gender];
        const desc = diverse ? diverseAt(index + 1) : profile ? profileCasting(lg, profile, gender, index + i.avoidLevers.length) : list[(index + 1 + i.avoidLevers.length) % list.length];
        return cb.onItemDone(kind, index, { lever: `avatar: ${desc.split(',')[0]}`, rationale: lg === 'pt' ? 'Outro rosto, mesma fala: testa se a pessoa muda a confiança do público.' : lg === 'es' ? 'Otra cara, mismo guion: prueba si la persona cambia la confianza del público.' : 'Same words, a different face: tests whether the person changes how much the audience trusts the message.', castingDescription: desc });
      }),
    );
    await this.costs.record({ workspaceId: i.workspaceId, variationBatchId: i.batchId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0, jobId: i.jobId });
    return { costUsd: 0 };
  }

  async describeEdit(i: DescribeEditInput): Promise<EditMapDraft & Usage> {
    await this.pause();
    const draft = mockEditMap(i);
    await this.costs.record({ workspaceId: i.workspaceId, championId: i.championId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0, jobId: i.jobId });
    return { ...draft, costUsd: 0 };
  }

  // ---------------------------------------------------------------------------

  async planAutoBatch(i: AutoPlanInput, onStage: (s: 'planning') => void): Promise<AutoPlanDraft & Usage> {
    onStage('planning');
    await this.pause();
    // TRANSIÇÃO (§C.0): com FRAME em `allowed` o mock devolve peças FRAME; o cast sai na fusão do B1
    const draft = mockAutoPlan(i) as AutoPlanDraft;
    await this.costs.record({ workspaceId: i.workspaceId, variationBatchId: i.batchId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0, jobId: i.jobId });
    return { ...draft, costUsd: 0 };
  }

  /** renders cuja 1ª checagem já saiu errada no [mock:static-text-mismatch] (memória do processo; a 2ª passa) */
  private readonly textMismatched = new Set<string>();

  /**
   * §A6 mock: "vê" exatamente o texto esperado. Gatilhos nas notas da OFERTA (CheckStaticTextInput.notes):
   *   [mock:static-text-mismatch]     1ª checagem do render vê o 1º texto crítico com acento errado ("volta" → "vólta");
   *                                   a 2ª (depois da refação) vê tudo certo.
   *   [mock:static-text-mismatch-all] toda checagem vê o erro (as duas imagens erradas → `mismatch`).
   *   [mock:static-text-fail]         a checagem falha (PROVIDER_UNAVAILABLE → o backend marca `skipped`).
   * Custo 0 (cost_entry LLM no lote).
   */
  async checkStaticText(i: CheckStaticTextInput): Promise<CheckStaticTextResult & Usage> {
    await this.pause();
    const notes = i.notes ?? '';
    if (notes.includes('[mock:static-text-fail]')) throw new IntegracaoError('PROVIDER_UNAVAILABLE', 'mock text check failure');
    let wrong = false;
    if (notes.includes('[mock:static-text-mismatch-all]')) wrong = true;
    else if (notes.includes('[mock:static-text-mismatch]') && !this.textMismatched.has(i.renderId)) {
      this.textMismatched.add(i.renderId);
      wrong = true;
    }
    const target = wrong ? (i.expected.find((e) => e.critical) ?? i.expected[0])?.key : undefined;
    await this.costs.record({ workspaceId: i.workspaceId, creativeId: i.creativeId, variationBatchId: i.variationBatchId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0 });
    return {
      items: i.expected.map((e) => ({ key: e.key, found: true, seen: e.key === target ? misspell(e.text) : e.text })),
      extraText: [],
      costUsd: 0,
    };
  }

  /**
   * legenda-protegida-v1 §4.2 mock: lê a legenda esperada em todo quadro (ok). `[mock:caption-covered]` nas notas = os
   * quadros do meio com a legenda tampada (`covered`); `[mock:caption-fail]` = a checagem falha (o backend marca `skipped`).
   */
  async checkCaption(i: CheckCaptionInputAny): Promise<CheckCaptionVerdict & Usage> {
    await this.pause();
    const notes = i.notes ?? '';
    if (notes.includes('[mock:caption-fail]')) throw new IntegracaoError('PROVIDER_UNAVAILABLE', 'mock caption check failure');
    await this.costs.record({ workspaceId: i.workspaceId, creativeId: i.creativeId, variationBatchId: i.variationBatchId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0 });
    const covered = notes.includes('[mock:caption-covered]');
    const n = i.frames.length;
    const frames = i.frames.map((f, k) => {
      const hit = covered && k >= Math.floor(n / 3) && k < Math.max(Math.floor(n / 3) + 1, Math.ceil((2 * n) / 3));
      return { atSec: f.atSec, ok: !hit, covered: hit, duplicated: false, seen: hit ? null : f.expectedWords?.join(' ') ?? 'mock caption', problem: hit ? ('covered' as const) : null };
    });
    return { status: covered ? 'covered' : 'ok', frames, costUsd: 0 };
  }

  private async recordCost(workspaceId: string, jobId: string, creativeId: string | null) {
    await this.costs.record({ workspaceId, creativeId, provider: 'ANTHROPIC', kind: 'LLM', model: this.opts.model, units: 0, unit: 'ktoken_out', amountUsd: 0, jobId });
  }

  private pause(divisor = 1): Promise<void> {
    const ms = Math.round((this.opts.stepMs ?? 150) / divisor);
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }
}

function buildScript(lg: Lang, offer: OfferBriefDraft, angle: string, winners: WinnerExample[]): ScriptDraft {
  const t = T[lg];
  const vars: Record<string, string> = {
    angle,
    audience: offer.audience || t.defAudience,
    pains: offer.pains || t.defPains,
    what: offer.what || t.defWhat,
    promise: offer.promise || t.defPromise,
    proof: offer.proof || t.defProof,
    cta: offer.cta || t.defCta,
  };
  let at = 0;
  const blocks: ScriptBlockDraft[] = DURATIONS.map(([label, sec]) => {
    const b = { label, startSec: at, endSec: at + sec, speech: fill(t[label], vars), visualPrompt: VISUAL[label] };
    at += sec;
    return b;
  });
  const rationale = fill(t.rationale, vars) + (winners.length ? fill(t.winners, { n: String(winners.length) }) : '');
  return { angle, rationale, durationSec: at, blocks };
}

function chunks(text: string): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 3) out.push((i ? ' ' : '') + words.slice(i, i + 3).join(' '));
  return out;
}

function detectLanguage(text: string, url?: string): string {
  const s = ` ${text.toLowerCase()} `;
  const pt = (s.match(/ (você|não|para|com|uma|seu|sua|isso) /g) ?? []).length;
  const es = (s.match(/ (usted|para|con|una|tu|esto|el|los) /g) ?? []).length;
  if (pt > 0 && pt >= es) return 'pt-BR';
  if (es > 0) return 'es';
  if (url && /\.br(\/|$)/.test(url)) return 'pt-BR';
  return 'en';
}

// ---------------------------------------------------------------------------- feature 2 (mock)

const HOOKS: Record<Lang, { lever: string; rationale: string; speech: string; onScreen: string }[]> = {
  en: [
    { lever: 'curiosity: an open question', rationale: 'Opens a loop the body closes; attacks the retention cause of the verdict.', speech: 'Nobody explains why this keeps happening to you.', onScreen: 'Why does this keep happening?' },
    { lever: 'pain: the everyday frustration', rationale: 'Names the pain in the first second; attacks the pain/desire cause.', speech: 'If you are tired of trying and getting nothing, listen.', onScreen: 'Tired of getting nothing?' },
    { lever: 'contrarian: break a belief', rationale: 'Challenges what the audience believes; attacks the belief cause.', speech: 'Everything you were told about this is wrong.', onScreen: 'You were told wrong' },
    { lever: 'story: mid-action', rationale: 'Drops the viewer into a moment; attacks the retention cause.', speech: 'Last week I almost gave up on this, then this happened.', onScreen: 'Then this happened' },
    { lever: 'objection: say the doubt', rationale: 'Turns the main doubt first; attacks the objection cause.', speech: 'I know, you think this will not work for you.', onScreen: 'Think it will not work?' },
  ],
  pt: [
    { lever: 'curiosidade: pergunta aberta', rationale: 'Abre um loop que o corpo fecha; ataca a causa de retenção do veredito.', speech: 'Ninguém te explica por que isso continua acontecendo com você.', onScreen: 'Por que isso continua acontecendo?' },
    { lever: 'dor: a frustração do dia a dia', rationale: 'Nomeia a dor no primeiro segundo; ataca a causa de dor e desejo.', speech: 'Se você cansou de tentar e não ver resultado, escuta isso.', onScreen: 'Cansou de tentar?' },
    { lever: 'contrário: quebra uma crença', rationale: 'Desafia o que o público acredita; ataca a causa de crença.', speech: 'Tudo que te falaram sobre isso está errado.', onScreen: 'Te falaram errado' },
    { lever: 'história: no meio da ação', rationale: 'Joga a pessoa num momento; ataca a causa de retenção.', speech: 'Semana passada eu quase desisti disso, até que aconteceu isso.', onScreen: 'Até que aconteceu isso' },
    { lever: 'objeção: fala a dúvida', rationale: 'Vira a principal dúvida primeiro; ataca a causa de objeção.', speech: 'Eu sei, você acha que isso não funciona pra você.', onScreen: 'Acha que não funciona?' },
  ],
  es: [
    { lever: 'curiosidad: pregunta abierta', rationale: 'Abre un loop que el cuerpo cierra; ataca la causa de retención.', speech: 'Nadie te explica por qué esto te sigue pasando.', onScreen: '¿Por qué te sigue pasando?' },
    { lever: 'dolor: la frustración diaria', rationale: 'Nombra el dolor en el primer segundo; ataca la causa de dolor.', speech: 'Si te cansaste de intentar sin resultado, escucha esto.', onScreen: '¿Cansado de intentar?' },
    { lever: 'contrario: rompe una creencia', rationale: 'Desafía lo que el público cree; ataca la causa de creencia.', speech: 'Todo lo que te dijeron sobre esto está mal.', onScreen: 'Te dijeron mal' },
    { lever: 'historia: en plena acción', rationale: 'Mete a la persona en un momento; ataca la causa de retención.', speech: 'La semana pasada casi me rindo, hasta que pasó esto.', onScreen: 'Hasta que pasó esto' },
    { lever: 'objeción: di la duda', rationale: 'Gira la duda principal primero; ataca la causa de objeción.', speech: 'Ya sé, crees que esto no funciona para ti.', onScreen: '¿Crees que no funciona?' },
  ],
};

const CASTINGS: Record<Lang, Record<'female' | 'male', string[]>> = {
  en: {
    female: ['A woman in her early 30s, plain t-shirt, bright living room in window light, looking straight into the camera, framed from the chest up.', 'A woman in her late 40s, soft cardigan, tidy kitchen, looking straight into the camera, framed from the chest up.', 'A woman in her mid 20s with curly hair, denim shirt, bedroom with warm lamp light, looking straight into the camera, chest up.', 'A woman around 35, crisp blouse, home office, looking straight into the camera, framed from the chest up.', 'A woman in her early 50s, simple sweater, cozy sofa, looking straight into the camera, framed from the chest up.'],
    male: ['A man in his early 30s, plain t-shirt, bright living room in window light, looking straight into the camera, framed from the chest up.', 'A man in his late 40s, polo shirt, tidy kitchen, looking straight into the camera, framed from the chest up.', 'A man in his mid 20s with short curly hair, hoodie, bedroom with warm lamp light, looking straight into the camera, chest up.', 'A man around 35, button-down shirt, home office, looking straight into the camera, framed from the chest up.', 'A man in his early 50s, simple sweater, cozy sofa, looking straight into the camera, framed from the chest up.'],
  },
  pt: {
    female: ['Uma mulher de uns 30 anos, camiseta lisa, sala clara com luz de janela, olhando direto pra câmera, do peito pra cima.', 'Uma mulher de uns 48 anos, cardigã, cozinha arrumada, olhando direto pra câmera, do peito pra cima.', 'Uma mulher de uns 25 anos de cabelo cacheado, camisa jeans, quarto com luz quente, olhando direto pra câmera, do peito pra cima.', 'Uma mulher de uns 35 anos, blusa social, escritório em casa, olhando direto pra câmera, do peito pra cima.', 'Uma mulher de uns 52 anos, suéter simples, sofá aconchegante, olhando direto pra câmera, do peito pra cima.'],
    male: ['Um homem de uns 30 anos, camiseta lisa, sala clara com luz de janela, olhando direto pra câmera, do peito pra cima.', 'Um homem de uns 48 anos, camisa polo, cozinha arrumada, olhando direto pra câmera, do peito pra cima.', 'Um homem de uns 25 anos de cabelo cacheado curto, moletom, quarto com luz quente, olhando direto pra câmera, do peito pra cima.', 'Um homem de uns 35 anos, camisa de botão, escritório em casa, olhando direto pra câmera, do peito pra cima.', 'Um homem de uns 52 anos, suéter simples, sofá aconchegante, olhando direto pra câmera, do peito pra cima.'],
  },
  es: {
    female: ['Una mujer de unos 30 años, camiseta lisa, sala luminosa con luz de ventana, mirando directo a la cámara, de pecho para arriba.', 'Una mujer de unos 48 años, cárdigan, cocina ordenada, mirando directo a la cámara, de pecho para arriba.', 'Una mujer de unos 25 años de pelo rizado, camisa de jean, cuarto con luz cálida, mirando directo a la cámara, de pecho para arriba.', 'Una mujer de unos 35 años, blusa formal, oficina en casa, mirando directo a la cámara, de pecho para arriba.', 'Una mujer de unos 52 años, suéter simple, sofá acogedor, mirando directo a la cámara, de pecho para arriba.'],
    male: ['Un hombre de unos 30 años, camiseta lisa, sala luminosa con luz de ventana, mirando directo a la cámara, de pecho para arriba.', 'Un hombre de unos 48 años, polo, cocina ordenada, mirando directo a la cámara, de pecho para arriba.', 'Un hombre de unos 25 años de pelo rizado corto, sudadera, cuarto con luz cálida, mirando directo a la cámara, de pecho para arriba.', 'Un hombre de unos 35 años, camisa de botones, oficina en casa, mirando directo a la cámara, de pecho para arriba.', 'Un hombre de unos 52 años, suéter simple, sofá acogedor, mirando directo a la cámara, de pecho para arriba.'],
  },
};

const TD = {
  EN: { hook: 'Hook', body: 'Body', proof: 'Proof', cta: 'CTA', noSpeech: 'No speech detected in the video.', noAd: 'No Ad Library data: the video was uploaded without a resolved link.', proxy: 'days running (Ad Library proxy, not performance)', full: 'Full-frame talking head.', split: 'Split screen: face on top, panel below.', person: 'One person talking to the camera, chest up (mock).', voice: 'Spoken voice, natural pace (mock).', noVoice: 'No voice.', verdict: ['The hook opens a loop in the first seconds.', 'One person talking straight to the camera builds trust.', 'The CTA repeats the promise.'] },
  PT_BR: { hook: 'Gancho', body: 'Corpo', proof: 'Prova', cta: 'CTA', noSpeech: 'Nenhuma fala detectada no vídeo.', noAd: 'Sem dados da Ad Library: o vídeo foi enviado sem link resolvido.', proxy: 'dias no ar (proxy da Ad Library, não é performance)', full: 'Talking head em tela cheia.', split: 'Tela dividida: rosto em cima, painel embaixo.', person: 'Uma pessoa falando pra câmera, do peito pra cima (mock).', voice: 'Voz falada, ritmo natural (mock).', noVoice: 'Sem voz.', verdict: ['O gancho abre um loop nos primeiros segundos.', 'Uma pessoa falando direto pra câmera gera confiança.', 'O CTA repete a promessa.'] },
} as const;

/** Teardown determinístico a partir das medições e da transcrição (sem modelo). */
export function mockTeardown(uiLocale: 'EN' | 'PT_BR', words: TranscriptWord[], m: Omit<Measurements, 'keyframes'>, adMeta: AdLibraryMeta | null, frames: number): TeardownSections {
  const t = TD[uiLocale];
  const ok = <T>(data: T) => ({ status: 'ok' as const, naReason: null, data });
  const na = (r: string) => ({ status: 'na' as const, naReason: r, data: null });
  const dur = m.durationSec;
  const speech = words.length > 0;
  const lit = (a: number, b: number, last = false) => words.filter((w) => { const c = (w.startSec + w.endSec) / 2; return c >= a && (last ? c <= b : c < b); }).map((w) => w.word).join(' ');
  const hookEnd = speech ? snapToSilence(Math.min(3, dur * 0.3), words, 0.5, dur) : Math.min(3, dur);
  const third = (k: number) => (speech ? snapToSilence(hookEnd + ((dur - hookEnd) * k) / 3, words, hookEnd, dur) : hookEnd + ((dur - hookEnd) * k) / 3);
  const cuts = [0, hookEnd, third(1), third(2), dur];
  const labels = [t.hook, t.body, t.proof, t.cta];
  const fns = ['hook', 'mechanism', 'proof', 'cta'];
  const blocks = labels
    .map((label, k) => ({ label, function: fns[k], startSec: cuts[k], endSec: cuts[k + 1], onScreen: t.person, speech: lit(cuts[k], cuts[k + 1], k === 3) }))
    .filter((b) => b.endSec > b.startSec);
  const split = m.segments.some((s) => s.bands.some((b) => b.role === 'panel'));
  const sentences = speech ? words.map((w) => w.word).join(' ').split(/(?<=[.!?])\s+/).filter(Boolean) : [];
  return {
    identification: ok({ summary: `${Math.round(dur)} s, ${m.width}x${m.height}, ${frames} key frames (mock).`, signals: adMeta?.daysRunning != null ? [`${adMeta.daysRunning} ${t.proxy}`] : [] }),
    metaCopy: adMeta && adMeta.status === 'resolved' ? ok({ primaryText: adMeta.primaryText, headline: adMeta.headline, description: null, button: adMeta.ctaText, link: adMeta.linkUrl }) : na(t.noAd),
    transcript: speech ? ok({ keywords: sentences.map((s) => ({ sentence: s, keyword: s.split(' ').reduce((a, b) => (b.length > a.length ? b : a), '').replace(/[.,!?]/g, '') })) }) : na(t.noSpeech),
    hook: speech ? ok({ endSec: hookEnd, visual: t.person, onScreenText: null, spoken: lit(0, hookEnd) }) : na(t.noSpeech),
    structure: ok({ blocks }),
    layout: ok({ summary: split ? t.split : t.full, segments: m.segments.map((s) => ({ startSec: s.startSec, endSec: s.endSec, description: split ? t.split : t.full })) }),
    visual: ok({ palette: m.palette.slice(0, 5).map((hex) => ({ hex: hex.toUpperCase(), role: 'dominant' })), typography: 'n/a (mock)', captions: 'n/a (mock)', uiElements: 'n/a (mock)', person: t.person, broll: 'n/a (mock)', motion: `${m.cuts.length} cut(s)` }),
    audio: ok({ voice: speech ? t.voice : t.noVoice, music: 'n/a (mock)', sfx: 'n/a (mock)' }),
    offerProofCta: speech ? ok({ promise: lit(hookEnd, cuts[2]), mechanism: lit(hookEnd, cuts[2]), proof: lit(cuts[2], cuts[3]), ctaSpoken: lit(cuts[3], dur, true), ctaOnScreen: '' }) : na(t.noSpeech),
    whySells: ok({ avatar: 'mock', awarenessLevel: 'problem aware (mock)', painDesire: 'mock', bigIdea: 'mock', beliefObjection: 'mock', retentionEngine: 'mock', verdict: [...t.verdict] }),
    stealVsVary: ok({ steal: [t.verdict[1]], vary: [{ lever: 'hook', idea: t.verdict[0] }, { lever: 'avatar', idea: t.verdict[1] }] }),
    replicationPlan: ok({ suggestions: speech ? [{ kind: 'SWAP_AVATAR' as const, lever: 'avatar', idea: t.verdict[1] }, { kind: 'NEW_HOOKS' as const, lever: 'hook', idea: t.verdict[0] }] : [] }),
  };
}

// ---------------------------------------------------------------------------- §13 (mock)

// Alinhado às camadas REAIS da fixture de painéis do QA (testes/fixtures/campeoes/gerar-paineis.mjs, grade 720×960):
// headline na faixa vermelha do topo (y 0-119), rodapé vermelho (y 840-960), karaokê sobre câmera/app (y ~780), fora do rosto.
const HEADLINE: Record<Lang, string> = { en: 'I FOUND OUT WHY MY BILLS KEPT GOING UP EVERY MONTH.', pt: 'DESCOBRI POR QUE MINHAS CONTAS SUBIAM TODO MÊS.', es: 'DESCUBRÍ POR QUÉ MIS CUENTAS SUBÍAN CADA MES.' };
const FOOTER: Record<Lang, string> = { en: 'SEE EVERY CHARGE, EVERY APP, IN ONE SCREEN', pt: 'VEJA CADA COBRANÇA, CADA APP, NUMA TELA', es: 'MIRA CADA COBRO, CADA APP, EN UNA PANTALLA' };
/** caixas da fixture em fração da grade 720×960 */
const FX = { top: { x: 0, y: 0, w: 1, h: 119 / 960 }, bottom: { x: 0, y: 840 / 960, w: 1, h: 120 / 960 }, caption: { x: 160 / 720, y: 775 / 960, w: 400 / 720, h: 50 / 960 }, face: { x: 0, y: 119 / 960, w: 336 / 720, h: 324 / 960 } };
const TRAITS: Record<Lang, string[]> = {
  en: ['oval face and soft features', 'square jaw and strong brows', 'round face and a wide smile', 'narrow face and deep-set eyes', 'heart-shaped face and full cheeks'],
  pt: ['rosto oval e traços suaves', 'mandíbula quadrada e sobrancelhas marcadas', 'rosto redondo e sorriso largo', 'rosto fino e olhos fundos', 'rosto em formato de coração e bochechas cheias'],
  es: ['rostro ovalado y rasgos suaves', 'mandíbula cuadrada y cejas marcadas', 'rostro redondo y sonrisa amplia', 'rostro delgado y ojos hundidos', 'rostro en forma de corazón y mejillas llenas'],
};

/** Elenco do mock a partir do perfil: mesmo perfil, traço individual diferente por item. */
function profileCasting(lg: Lang, p: PersonProfile, voiceGender: 'female' | 'male', k: number): string {
  const g = p.gender ?? voiceGender;
  const who = lg === 'pt' ? (g === 'male' ? 'Um homem' : 'Uma mulher') : lg === 'es' ? (g === 'male' ? 'Un hombre' : 'Una mujer') : g === 'male' ? 'A man' : 'A woman';
  const trait = TRAITS[lg][k % TRAITS[lg].length];
  return [`${who}, ${p.ageBand || '30'}, ${p.ethnicity || ''}`.replace(/,\s*$/, ''), trait, p.hair, p.clothing, p.setting, p.lighting, p.framing, p.pose].filter(Boolean).join(', ') + '.';
}

/** describeEdit do mock: 1 headline com fundo chapado + 1 legenda karaokê (com fala). Na grade do campeão. */
export function mockEditMap(i: DescribeEditInput): EditMapDraft {
  const v = i.video;
  const lg = langOf(i.transcript.language);
  const words = i.transcript.words;
  const f = (sec: number) => Math.max(0, Math.min(v.frameCount, Math.round(sec * v.fps)));
  const px = (x: number, y: number, w: number, h: number) => ({ x: Math.round(x * v.width), y: Math.round(y * v.height), w: Math.round(w * v.width), h: Math.round(h * v.height) });
  const notes = i.notes ?? '';
  // headline-e-legenda-v1 (25/10): [mock:headline-over-video] = alias do [mock:hook-over-video] mas com a headline o vídeo
  // todo (placa no render); [mock:headline-none] = campeão sem camada de headline (modo `add`)
  const overVideo = notes.includes('[mock:hook-over-video]') || notes.includes('[mock:headline-over-video]');
  const fullOver = notes.includes('[mock:headline-over-video]');
  const noHeadline = notes.includes('[mock:headline-none]');
  const red = '#D40F0F';
  const full = f(v.durationSec);
  const pxr = (r: { x: number; y: number; w: number; h: number }) => px(r.x, r.y, r.w, r.h);
  const headBox = pxr(FX.top);
  const footBox = pxr(FX.bottom);
  const white = { highlightColor: null, strokeColor: null, strokeWidthPx: 0, lineHeight: 1.15, align: 'center' as const };
  const layers: EditLayer[] = [
    {
      // hook-over-video: sem faixa, texto direto sobre o vídeo só nos 3 s do gancho (variante gancho-sem-fundo da fixture)
      id: 'headline-1', kind: 'headline', startFrame: 0, endFrame: overVideo && !fullOver ? Math.max(1, f(Math.min(3, v.durationSec))) : Math.max(1, full), box: headBox,
      background: overVideo ? { kind: 'none', color: null, box: null } : { kind: 'solid', color: red, box: { ...headBox } },
      style: { ...white, fontId: 'archivo-black-400', uppercase: true, fontSizePx: Math.round((40 / 960) * v.height), color: '#FFFFFF', highlightColor: '#FFD400', shadow: false, ...(overVideo ? { strokeColor: '#000000', strokeWidthPx: 3 } : {}) },
      text: HEADLINE[lg], wordsPerPage: null, source: 'vision',
    },
    {
      id: 'text-1', kind: 'text', startFrame: 0, endFrame: Math.max(1, full), box: footBox,
      background: { kind: 'solid', color: red, box: { ...footBox } },
      style: { ...white, fontId: 'inter-800', uppercase: true, fontSizePx: Math.round((38 / 960) * v.height), color: '#FFFFFF', shadow: false },
      text: FOOTER[lg], wordsPerPage: null, source: 'vision',
    },
  ];
  if (noHeadline) layers.shift();
  const face = i.faceTrack[0]?.region ?? pxr(FX.face);
  // legenda-protegida-v1 (26/10): legenda queimada só com [mock:burned-captions] nas notas (opt-in); sem o gatilho o
  // campeão mock não tem legenda queimada (senão quase toda peça sairia bloqueada por `burned_captions`)
  if (words.length && (notes.includes('[mock:burned-captions]') || notes.includes('[mock:keep-straddle]'))) { // keep-straddle é sobre a legenda: implica ela
    const capH = Math.round((50 / 960) * v.height);
    // keep-straddle: como a variante legenda-cruza da fixture (centrada na borda direita da caixa do rosto, cruzando a de baixo)
    const capBox = notes.includes('[mock:keep-straddle]')
      ? { x: Math.max(0, face.x + face.w - Math.round(0.28 * v.width)), y: Math.max(0, face.y + face.h - Math.round(capH / 2)), w: Math.round(0.56 * v.width), h: capH }
      : pxr(FX.caption);
    layers.push({
      id: 'caption-1', kind: 'caption', startFrame: f(words[0].startSec), endFrame: Math.max(f(words[0].startSec) + 1, f(words[words.length - 1].endSec)), box: capBox,
      background: { kind: 'none', color: null, box: null },
      style: { fontId: 'archivo-black-400', uppercase: true, fontSizePx: Math.round((34 / 960) * v.height), lineHeight: 1.15, color: '#FFFFFF', highlightColor: '#FFFF00', strokeColor: '#000000', strokeWidthPx: 4, shadow: false, align: 'center' },
      text: null, wordsPerPage: 3, source: 'vision',
    });
  }
  const profile: PersonProfile = { gender: null, ageBand: '25-35', ethnicity: 'Latino', hair: 'short dark hair', clothing: 'plain t-shirt', setting: 'home, living room', lighting: 'soft window light from the left', framing: 'chest up, face centered', pose: 'seated, looking into the lens' };
  const overlaysOverFace = notes.includes('[mock:keep-overlay]')
    ? [{ startFrame: f(v.durationSec / 3), endFrame: Math.max(f(v.durationSec / 3) + 1, f((2 * v.durationSec) / 3)), description: 'Rating card slides over the lower half of the face' }]
    : [];
  // informativo: quem fala pra câmera (a região do rosto) e os 2 rostos da câmera de segurança da fixture de painéis
  const mainSpeaker = { box: { ...face }, description: 'top-left box of a split screen' };
  const camBox = px(0, 443 / 960, 336 / 720, 397 / 960);
  const otherFaces = [{ startFrame: 0, endFrame: Math.max(1, full), box: camBox, where: 'security camera footage below the avatar' }];
  return { layers, overlaysOverFace, profile, mainSpeaker, otherFaces };
}
