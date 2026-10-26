// ClaudeService real (I2). Briefing a partir do link, N roteiros em paralelo com streaming e falha parcial,
// e sugestão de rosto. Saída sempre estruturada (JSON Schema) e validada; custo real gravado por chamada.
import { Logger } from '@nestjs/common';
import type {
  AdLibraryMeta,
  AutoPlanDraft,
  AutoPlanInput,
  CastingStyle,
  CheckStaticTextInput,
  CheckStaticTextResult,
  StaticTextCheckPort,
  ClaudeService,
  ExtractStage,
  FieldOrigin,
  DescribeEditInput,
  ExtractSources,
  EditMap,
  EditMapDraft,
  HookMode,
  Measurements,
  OfferBriefDraft,
  ScriptDraft,
  TeardownDraft,
  TeardownSections,
  TranscriptWord,
  Usage,
  VariationItemDraft,
  VariationKind,
  WinnerExample,
} from '../contrato';
import { STATIC_TEXT_CHECK_MODEL, WORDS_PER_SECOND } from '../catalogo/precos';
import { genderOf } from '../catalogo/genero';
import { guessLanguage } from '../wavespeed/idioma';
import {
  CASTING_AXES,
  CASTING_SCHEMA,
  HOOK_SCHEMA,
  SHARED_CASTING_SCHEMA,
  TEARDOWN_DIAGNOSIS_SCHEMA,
  TEARDOWN_FACTS_SCHEMA,
  castingUserMessage,
  hookLeverFor,
  hookUserMessage,
  planContext,
  planSystem,
  sharedCastingUserMessage,
  teardownContext,
  teardownDiagnosisMessage,
  teardownFactsMessage,
  teardownSystem,
} from './prompts-campeao';
import { parseCasting, parseHook, parseJsonObject, parseSharedCasting, parseTeardown } from './validacao-campeao';
import {
  EDIT_SCHEMA,
  EDIT_SYSTEM,
  HOOK_TEXT_SCHEMA,
  PROFILE_TRAITS,
  editContext,
  editUserMessage,
  hookTextSlot,
  hookTextUserMessage,
  parseEditMap,
  parseHookText,
  profileCastingUserMessage,
  spokenHookOf,
} from './edicao';
import { IntegracaoError, isIntegracaoError } from '../erros';
import { AUTO_PLAN_SCHEMA, AUTO_PLAN_SYSTEM, autoPlanContext, autoPlanUserMessage, parseAutoPlan, STATIC_REF_IMAGES, staticAllowed } from './auto-plano';
import { allowedFramesOf } from './auto-plano-moldura';
import { FRAMES_DETAIL_SCHEMA, STATIC_DETAIL_SCHEMA, detailTargets, framesByIndex, framesDetailMessage, mergeDetails, staticDetailMessage } from './auto-plano-detalhe';
import { languageName } from './auto-plano';
import { TEXT_CHECK_SCHEMA, TEXT_CHECK_SYSTEM, ffmpegRunner, parseTextCheck, prepareCheckImages, textCheckEffort, textCheckUserMessage, type RunFfmpeg } from './checagem-texto';
import type { CostStore } from '../portas';
import { recordLlmCost } from './custo';
import {
  DIVERSE_CASTING_SCHEMA,
  DIVERSE_SHARED_SCHEMA,
  LOOKALIKE,
  castingGenderOf,
  describeCasting,
  diverseCasting,
  diverseCastingUserMessage,
  diverseSharedCastingUserMessage,
  type DiverseCasting,
} from './elenco';
import { JsonStringStream } from './json-stream';
import type { PageText } from './pagina';
import { imageCaption, stripImage } from './imagens';
import { readOffer, type OfferReading, type ReadOfferOptions } from './leitura';
import {
  BRIEF_SCHEMA,
  BRIEF_SYSTEM,
  FACE_SCHEMA,
  FACE_SYSTEM,
  SCRIPT_SCHEMA,
  SCRIPTS_SYSTEM,
  briefUserMessage,
  faceUserMessage,
  familyFor,
  scriptUserMessage,
  scriptsContext,
} from './prompts';
import type { ClaudeCall, ClaudeImage, ClaudeResult, ClaudeTransport } from './transporte';
import { normalizeLanguage, parseBriefFull, parseFace, parseScript } from './validacao';

export interface ClaudeLiveOptions {
  model: string;
  /** só pros testes: troca a leitura em cascata da oferta (leitura.ts) */
  readOffer?: (url: string, onStage: (stage: ExtractStage) => void) => Promise<OfferReading>;
  /** leitura v2: fetch/render/captura/crt.sh (o módulo liga o navegador aqui) */
  pageOptions?: ReadOfferOptions;
  /** baixa os frames-chave (URL assinada do storage); testes trocam */
  fetchImpl?: typeof fetch;
  /** §A6: modelo da checagem de texto do STATIC (padrão STATIC_TEXT_CHECK_MODEL.model = claude-haiku-4-5) */
  textCheckModel?: string;
  /** §A6: recorta/reduz a imagem antes da visão (padrão: ffmpeg do PATH / FFMPEG_PATH); null = manda a original se couber */
  runFfmpeg?: RunFfmpeg | null;
}

/** Limites dos frames que vão pro Claude (§6.1: até 16, lado maior 768 px, já reduzidos pelo backend). */
export const FRAME_LIMITS = { max: 16, maxBytes: 5 * 1024 * 1024, timeoutMs: 20_000 };
/** §13.2: recortes de faixa de texto em resolução cheia (até 6, lado maior 1024 px). */
export const CROP_LIMITS = { max: 6 };
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** Códigos que o backend conhece pra falha de roteiro; o resto vira PROVIDER_ERROR. */
const MAX_TOKENS_MSG = 'claude hit max_tokens';
const SCRIPT_FAIL_CODES = new Set(['RATE_LIMITED', 'SAFETY_BLOCK', 'PROVIDER_TIMEOUT', 'PROVIDER_ERROR']);

export class ClaudeLiveService implements ClaudeService, StaticTextCheckPort {
  private readonly log = new Logger('ClaudeLive');

  constructor(
    private readonly transport: ClaudeTransport,
    private readonly costs: CostStore,
    private readonly opts: ClaudeLiveOptions,
  ) {}

  async extractOffer(
    input: { url?: string; pageText?: string; workspaceId: string; jobId: string },
    onStage: (stage: ExtractStage) => void,
  ): Promise<OfferBriefDraft & Usage & ExtractSources> {
    let reading: OfferReading;
    if (input.pageText?.trim()) {
      // texto colado (fallback do 403): não busca a página; só `extracting` e `detecting_language` (§4.3)
      const text = input.pageText.trim();
      const url = input.url ?? '';
      const page: PageText = {
        url, title: null, description: null, text: text.slice(0, 60_000), truncated: text.length > 60_000,
        pages: [{ url, role: 'main', title: null, text: text.slice(0, 60_000), truncated: text.length > 60_000, via: 'http', images: [] }],
        readMode: 'pasted',
      };
      reading = { page, images: [], imageReason: null, readMs: 0 };
    } else if (input.url) {
      // leitura em cascata (leitura.ts): HTTP → render → subpáginas → imagens; emite os 4 stages de leitura
      reading = await (this.opts.readOffer ?? ((u: string, s: (stage: ExtractStage) => void) => readOffer(u, this.opts.pageOptions ?? {}, s)))(input.url, onStage);
    } else {
      throw new IntegracaoError('PAGE_UNREADABLE', 'no url and no page text');
    }
    const { page, images } = reading;

    onStage('extracting');
    const user = briefUserMessage({
      url: page.url || undefined, title: page.title, description: page.description, text: page.text, truncated: page.truncated,
      pages: page.pages.map((p) => ({ url: p.url, role: p.role, title: p.title, text: p.text, truncated: p.truncated, via: page.readMode === 'pasted' ? 'pasted' : p.via })),
      readMode: page.readMode, imageCount: images.length,
    });
    // imagens (§3.2) vão como blocos `image` antes do texto, cada uma depois do rótulo; a visão é cobrada pelos tokens de entrada da mesma chamada
    const imageBlocks: ClaudeImage[] = images.map((i) => ({ mediaType: i.mediaType, data: i.data, caption: imageCaption(i) }));
    const res = await this.transport.run({ system: BRIEF_SYSTEM, images: imageBlocks, user, schema: BRIEF_SCHEMA, maxTokens: 16000 });
    const costUsd = await this.charge(res, { workspaceId: input.workspaceId, jobId: input.jobId });
    this.assertFinished(res);
    onStage('detecting_language'); // o idioma sai na mesma resposta; a etapa existe pro checklist do web
    const { brief, sources, imageNotes } = parseBriefFull(res.text);

    // §4.1: sources (role + imageIndex) → fieldOrigins (role + url); imagem aponta pra página de onde foi tirada
    const urlByRole = new Map<string, string>();
    for (const p of page.pages) if (!urlByRole.has(p.role)) urlByRole.set(p.role, p.url);
    const fieldOrigins: ExtractSources['fieldOrigins'] = {};
    for (const [field, list] of Object.entries(sources) as [keyof typeof sources, { role: string; imageIndex?: number }[]][]) {
      const origins: FieldOrigin[] = [];
      for (const s of list) {
        const img = s.imageIndex ? images.find((i) => i.index === s.imageIndex) : undefined;
        const url = img ? img.page.url : urlByRole.get(s.role) ?? (s.role === 'main' ? page.url : undefined);
        if (url === undefined) continue;
        origins.push(img ? { role: img.page.role, url, imageIndex: img.index } : { role: s.role as FieldOrigin['role'], url });
      }
      if (origins.length) fieldOrigins[field] = origins;
    }
    const notes = new Map(imageNotes.map((n) => [n.index, n.text]));
    const imagesRead = images.map((i) => stripImage(i, notes.get(i.index)));
    const pages = page.pages.map((p) => ({ url: p.url, role: p.role, via: p.via, chars: p.text.length }));
    return {
      ...brief, costUsd,
      readMode: page.readMode, pages, imagesRead, fieldOrigins,
      relatedUrls: pages.filter((p) => p.role !== 'main').map((p) => p.url),
    };
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
    if (input.winners.length) cb.onStage('studying_winners');
    cb.onStage('writing');

    const context = scriptsContext(input.offer, input.winners);
    let total = 0;

    const writeSlot = async (slot: number) => {
      const user = scriptUserMessage({ slot, count: input.count, family: familyFor(slot, input.avoidAngles.length), avoidAngles: input.avoidAngles });
      for (let attempt = 0; attempt < 2; attempt++) {
        const parser = new JsonStringStream((path, chunk) => {
          if (path.length === 1 && (path[0] === 'angle' || path[0] === 'rationale')) cb.onDelta(slot, 0, path[0], chunk);
          else if (path.length === 3 && path[0] === 'blocks' && typeof path[1] === 'number' && path[2] === 'speech') cb.onDelta(slot, path[1], 'speech', chunk);
        });
        let answered = false; // erro depois da resposta = defeito do texto (JSON fora da regra, corte): vale 1 nova tentativa
        try {
          const res = await this.transport.run({ system: SCRIPTS_SYSTEM, context, user, schema: SCRIPT_SCHEMA, maxTokens: 32000 }, (d) =>
            d === null ? parser.reset() : parser.push(d),
          );
          answered = true;
          // nunca `total += await …`: lê `total` antes do await e os slots paralelos se sobrescrevem
          const spent = await this.charge(res, { workspaceId: input.workspaceId, creativeId: input.creativeId, jobId: input.jobId });
          total += spent;
          if (res.stopReason === 'refusal') throw new IntegracaoError('SAFETY_BLOCK', 'claude declined (refusal)');
          this.assertFinished(res);
          cb.onScriptDone(slot, parseScript(res.text));
          return;
        } catch (e) {
          const code = isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
          if (attempt === 0 && answered && code !== 'SAFETY_BLOCK') {
            this.log.warn(`script slot ${slot}: ${(e as Error).message}; retrying once`);
            continue;
          }
          this.log.warn(`script slot ${slot} failed: ${code} ${(e as Error).message}`);
          cb.onScriptFailed(slot, SCRIPT_FAIL_CODES.has(code) ? code : 'PROVIDER_ERROR');
          return;
        }
      }
    };

    await Promise.all(Array.from({ length: input.count }, (_, slot) => writeSlot(slot)));
    return { costUsd: round6(total) };
  }

  async suggestFaceDescription(input: { offer: OfferBriefDraft; script: ScriptDraft; workspaceId: string; creativeId: string }): Promise<string> {
    const res = await this.transport.run({ system: FACE_SYSTEM, user: faceUserMessage(input.offer, input.script), schema: FACE_SCHEMA, maxTokens: 8000 });
    await this.charge(res, { workspaceId: input.workspaceId, creativeId: input.creativeId });
    this.assertFinished(res);
    return parseFace(res.text);
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
    const { images, failed } = await this.loadFrames(i.keyframes);
    const framesNote = images.length
      ? `${images.length} key frames follow, each right after its caption with the timestamp and why it was picked.${failed ? ` ${failed} other frame(s) could not be loaded.` : ''}`
      : 'No frames could be loaded: describe only what the measurements and the transcript support, and mark purely visual sections "na".';
    // Duas chamadas com o mesmo prefixo (sistema + medições/transcrição cacheados): o esquema inteiro estoura a gramática.
    const system = teardownSystem(i.uiLocale);
    const context = teardownContext({ transcript: i.transcript, measurements: i.measurements, adMeta: i.adMeta, offer: i.offer });
    const ctx = { uiLocale: i.uiLocale, durationSec: i.measurements.durationSec, words: i.transcript.words, adMeta: i.adMeta };
    let total = 0;
    const ask = (what: string, call: ClaudeCall) =>
      this.withRetry(what, async () => {
        const res = await this.transport.run(call);
        const spent = await this.charge(res, { workspaceId: i.workspaceId, championId: i.championId, jobId: i.jobId });
        total += spent;
        this.assertFinished(res);
        return parseJsonObject(res.text);
      });
    const facts = await ask('teardown facts', { system, context, images, user: teardownFactsMessage(framesNote), schema: TEARDOWN_FACTS_SCHEMA, maxTokens: 24000 });
    const diagnosis = await ask('teardown diagnosis', { system, context, user: teardownDiagnosisMessage(JSON.stringify(facts)), schema: TEARDOWN_DIAGNOSIS_SCHEMA, maxTokens: 16000 });
    const sections = parseTeardown(JSON.stringify({ ...facts, ...diagnosis }), ctx);
    return { language: normalizeLanguage(i.transcript.language), sections, costUsd: round6(total) };
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
    const p = planParams(i.teardown, i.transcript);
    const textHooks = i.hookMode === 'TEXT';
    const diverse = (i.castingStyle ?? 'DIVERSE') === 'DIVERSE';
    const baseProfile = i.editMap?.profile ?? null;
    // §13.13: o gênero do elenco é o da voz (castingGender) nos dois modos
    const profile = baseProfile && i.castingGender ? { ...baseProfile, gender: i.castingGender } : baseProfile;
    const gender = castingGenderOf(i.castingGender, genderOf(i.teardown.audio.data?.voice ?? ''), baseProfile?.gender, genderOf(i.teardown.visual.data?.person ?? ''));
    const genderNote = i.castingGender ? 'required: matches the voice that will speak' : 'same as the voice in <format>';
    const swapIdx = i.slots.filter((s) => s.kind === 'SWAP_AVATAR').map((s) => s.index);
    const castingAt = (position: number): DiverseCasting =>
      diverseCasting({ batchId: i.batchId, position, gender, originalEthnicity: baseProfile?.ethnicity ?? '', usedCastings: i.avoidLevers });
    const hookSlot = hookTextSlot(i.editMap, p.hookEndSec);
    const spokenHook = spokenHookOf(i.transcript, p.hookEndSec, i.teardown.hook.data?.spoken ?? '');
    const context = planContext({ offer: i.offer, teardown: i.teardown, transcript: i.transcript, hookEndSec: p.hookEndSec, notes: i.notes });
    const system = planSystem(i.language);
    const diagnosisLanguage = diagnosisLanguageOf(i.teardown);
    const count = (k: VariationKind) => i.slots.filter((s) => s.kind === k).length;
    const sharedNeeded = i.slots.some((s) => (s.kind === 'NEW_HOOKS' && !textHooks) || s.kind === 'COPY_NEW');
    const charge = (res: ClaudeResult) => this.charge(res, { workspaceId: i.workspaceId, variationBatchId: i.batchId, jobId: i.jobId });
    let total = 0;

    const runSlot = async (slot: { kind: VariationKind; index: number }) => {
      const { kind, index } = slot;
      if (kind !== 'NEW_HOOKS' && kind !== 'SWAP_AVATAR') {
        cb.onItemFailed(kind, index, 'KIND_NOT_ENABLED'); // COPY_NEW / REMIX_EDIT: pós-10/10
        return;
      }
      try {
        const draft = await this.withRetry(`${kind} ${index}`, async (): Promise<VariationItemDraft> => {
          if (kind === 'NEW_HOOKS' && textHooks) {
            // §13.4 (a): só o texto da tela muda; a fala do gancho é a original (não editável)
            const user = hookTextUserMessage({ index, count: count(kind), lever: hookLeverFor(index, i.avoidLevers.length), slot: hookSlot, spokenHook, avoidLevers: i.avoidLevers, diagnosisLanguage });
            const res = await this.transport.run({ system, context, user, schema: HOOK_TEXT_SCHEMA, maxTokens: 8000 });
            const spent = await charge(res);
            total += spent;
            this.assertFinished(res);
            const h = parseHookText(res.text, hookSlot);
            return { lever: h.lever, rationale: h.rationale, hook: { speech: spokenHook, onScreenText: h.onScreenText, durationSec: p.targetSec } };
          }
          if (kind === 'NEW_HOOKS') {
            const user = hookUserMessage({ index, count: count(kind), lever: hookLeverFor(index, i.avoidLevers.length), targetSec: p.targetSec, targetWords: p.targetWords, avoidLevers: i.avoidLevers, diagnosisLanguage });
            const res = await this.transport.run({ system, context, user, schema: HOOK_SCHEMA, maxTokens: 16000 });
            const spent = await charge(res); // nunca `total += await`: os slots paralelos se sobrescrevem
          total += spent;
            this.assertFinished(res);
            return parseHook(res.text, { wordsPerSec: p.wordsPerSec, targetWords: p.targetWords });
          }
          if (diverse) {
            // §13.13: posição 0 = elenco compartilhado; SWAP k = posição k + 1 (eixos sorteados pelo lote, sem repetir)
            const user = diverseCastingUserMessage({
              index, count: count(kind), casting: castingAt(index + 1), genderNote,
              others: [...(sharedNeeded ? [0] : []), ...swapIdx.filter((k) => k !== index).map((k) => k + 1)].map(castingAt),
              profile, avoidLevers: i.avoidLevers, diagnosisLanguage, language: i.language,
            });
            const res = await this.transport.run({ system, context, user, schema: DIVERSE_CASTING_SCHEMA, maxTokens: 16000 });
            const spent = await charge(res);
            total += spent;
            this.assertFinished(res);
            const c = parseCasting(res.text);
            if (LOOKALIKE.test(c.castingDescription)) throw new IntegracaoError('INVALID_SCRIPT', 'casting compares the person to someone real');
            return c;
          }
          // §13.3.1: com perfil, elenco PARECIDO com o original (outra pessoa); sem perfil, eixos do formato (v1)
          const user = profile
            ? profileCastingUserMessage({ index, count: count(kind), profile, trait: PROFILE_TRAITS[(index + i.avoidLevers.length) % PROFILE_TRAITS.length], avoidLevers: i.avoidLevers, diagnosisLanguage, language: i.language })
            : castingUserMessage({ index, count: count(kind), axis: CASTING_AXES[(index + i.avoidLevers.length) % CASTING_AXES.length], avoidLevers: i.avoidLevers, diagnosisLanguage, language: i.language });
          const res = await this.transport.run({ system, context, user, schema: CASTING_SCHEMA, maxTokens: 16000 });
          const spent = await charge(res); // nunca `total += await`: os slots paralelos se sobrescrevem
          total += spent;
          this.assertFinished(res);
          return parseCasting(res.text);
        });
        cb.onItemDone(kind, index, draft);
      } catch (e) {
        const code = isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
        this.log.warn(`plan ${kind} ${index} failed: ${code} ${(e as Error).message}`);
        cb.onItemFailed(kind, index, SCRIPT_FAIL_CODES.has(code) ? code : 'PROVIDER_ERROR');
      }
    };

    const shared = async () => {
      // gancho escrito (TEXT) não gera rosto: só pede elenco compartilhado se houver gancho falado ou COPY_NEW
      if (!sharedNeeded) return;
      try {
        const d = await this.withRetry('shared casting', async () => {
          const user = diverse
            ? diverseSharedCastingUserMessage({ casting: castingAt(0), genderNote, profile, language: i.language })
            : sharedCastingUserMessage({ language: i.language });
          const res = await this.transport.run({ system, context, user, schema: diverse ? DIVERSE_SHARED_SCHEMA : SHARED_CASTING_SCHEMA, maxTokens: 8000 });
          const spent = await charge(res); // nunca `total += await`: os slots paralelos se sobrescrevem
          total += spent;
          this.assertFinished(res);
          const desc = parseSharedCasting(res.text);
          if (diverse && LOOKALIKE.test(desc)) throw new IntegracaoError('INVALID_SCRIPT', 'casting compares the person to someone real');
          return desc;
        });
        cb.onSharedCasting(d);
      } catch (e) {
        // sem elenco o lote não lança: cai numa descrição neutra (no gênero da voz) que o usuário edita no elenco
        this.log.warn(`shared casting failed (${(e as Error).message}); using fallback description`);
        cb.onSharedCasting(diverse ? describeCasting(castingAt(0), i.language.toLowerCase().startsWith('pt') ? 'pt' : 'en', profile) : fallbackCasting(i.language, i.teardown));
      }
    };

    await Promise.all([shared(), ...i.slots.map(runSlot)]);
    return { costUsd: round6(total) };
  }

  async describeEdit(i: DescribeEditInput): Promise<EditMapDraft & Usage> {
    const frames = await this.loadFrames(i.keyframes);
    const crops = await this.loadFrames(
      i.textCrops.slice(0, CROP_LIMITS.max).map((c) => ({ atSec: c.atSec, url: c.url, reason: `full-resolution crop of x ${c.box.x}-${c.box.x + c.box.w}, y ${c.box.y}-${c.box.y + c.box.h} px` })),
    );
    const images = [...frames.images, ...crops.images];
    const failed = frames.failed + crops.failed;
    if (!images.length) throw new IntegracaoError('PROVIDER_ERROR', 'describeEdit: no frame could be loaded');
    const framesNote = `${frames.images.length} key frames of the whole video, then ${crops.images.length} full-resolution crops of bands that may hold text; each image follows its caption with the timestamp.${failed ? ` ${failed} other image(s) could not be loaded.` : ''}`;
    const context = editContext({ video: i.video, faceTrack: i.faceTrack, transcript: i.transcript });
    let total = 0;
    const draft = await this.withRetry('describe edit', async () => {
      const res = await this.transport.run({ system: EDIT_SYSTEM, context, images, user: editUserMessage(framesNote), schema: EDIT_SCHEMA, maxTokens: 16000 });
      const spent = await this.charge(res, { workspaceId: i.workspaceId, championId: i.championId, jobId: i.jobId });
      total += spent;
      this.assertFinished(res);
      return parseEditMap(res.text, i.video, i.transcript.words, i.faceTrack);
    });
    return { ...draft, costUsd: round6(total) };
  }

  // ---------------------------------------------------------------------------- variação automática v1 (§7.1)

  /** Uma chamada (sistema + contexto do lote cacheados; o reparo com `violations` reaproveita o prefixo).
   *  Resposta que não serve (JSON fora da regra, sem peça) = 1 nova tentativa; custo gravado em cada chamada. */
  async planAutoBatch(i: AutoPlanInput, onStage: (s: 'planning') => void): Promise<AutoPlanDraft & Usage> {
    onStage('planning');
    const context = autoPlanContext(i);
    const t = i.teardown;
    const ctx = {
      uiLocale: i.uiLocale, durationSec: i.media.durationSec, offer: i.offer, pageCaptured: i.page.captured,
      blockCount: t.structure.status === 'ok' && t.structure.data ? t.structure.data.blocks.length : 0,
      allowedFrames: allowedFramesOf(i),
      headline: i.headline,
    };
    // §14.3: com STATIC em `allowed`, até 4 frames-chave vão como REFERÊNCIA visual (baixados uma vez; o reparo reusa)
    const refs = staticAllowed(i) && i.keyframes.length ? await this.loadFrames(i.keyframes.slice(0, 8), STATIC_REF_IMAGES) : { images: [], failed: 0 };
    const images = refs.images.map((img) => ({ ...img, caption: `Reference for STATIC only. ${img.caption}` }));
    const user = autoPlanUserMessage(i, images.length);
    const charge = { workspaceId: i.workspaceId, variationBatchId: i.batchId, jobId: i.jobId };
    let total = 0;
    // 1ª etapa: o plano (STATIC = conceito + emoção, FRAME = template). Esquema pequeno: o único com tudo estourou a
    // gramática da saída estruturada em live (25/10, auto-plano-detalhe.ts).
    const { root, targets, whys } = await this.withRetry('auto plan', async () => {
      const res = await this.transport.run({ system: AUTO_PLAN_SYSTEM, context, ...(images.length ? { images } : {}), user, schema: AUTO_PLAN_SCHEMA, maxTokens: 32000 });
      const spent = await this.charge(res, charge);
      total += spent;
      this.assertFinished(res);
      const r = parseJsonObject(res.text);
      const tg = detailTargets(r, ctx.allowedFrames);
      let first: ReturnType<typeof parseAutoPlan> | null = null;
      try {
        first = parseAutoPlan(res.text, ctx); // forma do plano (why, itens); STATIC/FRAME ainda sem texto
      } catch (e) {
        if (!tg.length) throw e;
      }
      const w = first ? { hook: first.why.hook.text, proof: first.why.proof.text, cta: first.why.cta.text } : {};
      return { root: r, targets: tg, whys: w as Record<string, string> };
    });
    // 2ª etapa: 1 chamada por STATIC + 1 chamada com todas as molduras, em paralelo, mesmo sistema + contexto. Falhou = a peça sai.
    const screenLanguage = languageName(i.screenLanguage);
    const statics = targets.filter((x) => x.kind === 'STATIC');
    const frames = targets.filter((x) => x.kind === 'FRAME');
    const detailCall = async (what: string, call: () => Promise<Record<string, unknown>>) => {
      try {
        return await this.withRetry(what, call);
      } catch (e) {
        this.log.warn(`${what} detail failed: ${(e as Error).message}`);
        return null;
      }
    };
    const runDetail = async (user: string, schema: Record<string, unknown>, withImages: boolean, effort?: 'low') => {
      const res = await this.transport.run({ system: AUTO_PLAN_SYSTEM, context, ...(withImages && images.length ? { images } : {}), user, schema, maxTokens: 16000, ...(effort ? { effort } : {}) });
      const spent = await this.charge(res, charge);
      total += spent;
      this.assertFinished(res);
      return parseJsonObject(res.text);
    };
    const [staticDetails, framesDetail] = await Promise.all([
      Promise.all(statics.map((tg) => detailCall(`auto plan STATIC ${tg.index}`, () =>
        runDetail(staticDetailMessage(tg, { screenLanguage, whys, others: statics.filter((x) => x.index !== tg.index), violations: i.violations, refImages: images.length }), STATIC_DETAIL_SCHEMA, true)))),
      frames.length ? detailCall('auto plan FRAMES', () => runDetail(framesDetailMessage(frames, { screenLanguage, whys, violations: i.violations }), FRAMES_DETAIL_SCHEMA, false, 'low')) : Promise.resolve(null),
    ]);
    const details = framesByIndex(framesDetail, frames);
    statics.forEach((tg, k) => {
      if (staticDetails[k]) details.set(tg.index, staticDetails[k]!);
    });
    const draft = parseAutoPlan(mergeDetails(root, targets, details), ctx);
    // TRANSIÇÃO (§C.0): itens FRAME só existem quando o backend põe FRAME em `allowed` (alias WithFrame); na fusão do B1
    // o AutoPlanDraft do contrato passa a aceitá-los e o cast sai.
    return { ...(draft as AutoPlanDraft), costUsd: round6(total) };
  }

  /**
   * §A6: transcreve, por visão, o que está escrito na imagem do STATIC pra cada texto esperado (o backend compara).
   * Modelo barato (Haiku), 1 nova tentativa se a resposta não serve; custo gravado (LLM) no lote e no criativo.
   * Falha = erro do contrato (o backend marca `textCheck.status = 'skipped'` e entrega a peça).
   */
  async checkStaticText(i: CheckStaticTextInput): Promise<CheckStaticTextResult & Usage> {
    if (!i.expected.length) return { items: [], extraText: [], costUsd: 0 };
    const f = this.opts.fetchImpl ?? fetch;
    let buf: Buffer;
    try {
      const res = await f(i.imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error('empty');
    } catch (e) {
      throw new IntegracaoError('PROVIDER_ERROR', `text check: could not read the image (${(e as Error).message})`);
    }
    const run = this.opts.runFfmpeg === undefined ? ffmpegRunner(process.env.FFMPEG_PATH || 'ffmpeg') : this.opts.runFfmpeg;
    const images = await prepareCheckImages(buf, run);
    const model = this.opts.textCheckModel || STATIC_TEXT_CHECK_MODEL.model;
    let total = 0;
    const out = await this.withRetry('static text check', async () => {
      const res = await this.transport.run({
        system: TEXT_CHECK_SYSTEM, images, user: textCheckUserMessage(i, images.length), schema: TEXT_CHECK_SCHEMA,
        maxTokens: STATIC_TEXT_CHECK_MODEL.maxTokens, model, effort: textCheckEffort(model),
      });
      const spent = await recordLlmCost(this.costs, { workspaceId: i.workspaceId, creativeId: i.creativeId, variationBatchId: i.variationBatchId, model }, res.usage);
      total += spent;
      this.assertFinished(res);
      return parseTextCheck(res.text, i.expected);
    });
    return { ...out, costUsd: round6(total) };
  }

  /** 1 nova tentativa quando a resposta veio mas não serve (JSON fora da regra, corte); recusa não repete. */
  private async withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const code = isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      // recusa, provedor fora e corte por max_tokens não melhoram repetindo (o corte só dobraria o gasto)
      if (code === 'SAFETY_BLOCK' || code === 'RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_TIMEOUT' || (e as Error).message === MAX_TOKENS_MSG) throw e;
      this.log.warn(`${what}: ${(e as Error).message}; retrying once`);
      return fn();
    }
  }

  /** Baixa os frames (URL assinada) em base64. Frame que falha é pulado (o prompt avisa quantos faltaram). */
  private async loadFrames(frames: { atSec: number; reason: string; url: string }[], max: number = FRAME_LIMITS.max): Promise<{ images: ClaudeImage[]; failed: number }> {
    const pick = evenly([...frames].sort((a, b) => a.atSec - b.atSec), max);
    const f = this.opts.fetchImpl ?? fetch;
    const got = await Promise.all(
      pick.map(async (k): Promise<ClaudeImage | null> => {
        try {
          const res = await f(k.url, { signal: AbortSignal.timeout(FRAME_LIMITS.timeoutMs) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          if (!buf.length || buf.length > FRAME_LIMITS.maxBytes) throw new Error(`size ${buf.length}`);
          const mediaType = imageTypeOf(buf, res.headers.get('content-type'));
          if (!mediaType) throw new Error('not an image');
          return { mediaType, data: buf.toString('base64'), caption: `Frame at ${Math.round(k.atSec * 100) / 100} s (${k.reason}):` };
        } catch (e) {
          this.log.warn(`keyframe ${k.atSec}s: ${(e as Error).message}`);
          return null;
        }
      }),
    );
    const images = got.filter((x): x is ClaudeImage => x !== null);
    return { images, failed: pick.length - images.length };
  }

  /** Custo é gravado mesmo quando a resposta não serve (recusa, corte): a chamada foi cobrada. */
  private charge(res: ClaudeResult, ctx: { workspaceId: string; creativeId?: string; championId?: string; variationBatchId?: string; jobId?: string }): Promise<number> {
    return recordLlmCost(this.costs, { ...ctx, model: this.opts.model }, res.usage);
  }

  private assertFinished(res: ClaudeResult) {
    if (res.stopReason === 'refusal') throw new IntegracaoError('SAFETY_BLOCK', 'claude declined (refusal)');
    if (res.stopReason === 'max_tokens') throw new IntegracaoError('PROVIDER_ERROR', MAX_TOKENS_MSG);
  }
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

/** Até `max` itens espalhados por igual (sempre o 1º e o último). */
export function evenly<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  return Array.from({ length: max }, (_, k) => xs[Math.round((k * (xs.length - 1)) / (max - 1))]);
}

/** Tipo pela assinatura do arquivo (o storage pode mandar octet-stream). */
function imageTypeOf(buf: Buffer, header: string | null): ClaudeImage['mediaType'] | null {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  const h = (header ?? '').split(';')[0].trim();
  return (IMAGE_TYPES as readonly string[]).includes(h) ? (h as ClaudeImage['mediaType']) : null;
}

/** Fim do gancho, ritmo medido do campeão e o tamanho-alvo do gancho novo. */
export function planParams(t: TeardownSections, words: TranscriptWord[]): { hookEndSec: number; wordsPerSec: number; targetSec: number; targetWords: number } {
  const hookEndSec = t.hook.status === 'ok' && t.hook.data ? t.hook.data.endSec : Math.min(3, words[words.length - 1]?.endSec ?? 3);
  const spoken = words.length ? words[words.length - 1].endSec - words[0].startSec : 0;
  const wordsPerSec = spoken > 1 && words.length >= 5 ? Math.min(4.5, Math.max(1.5, words.length / spoken)) : WORDS_PER_SECOND;
  const hookWords = words.filter((w) => (w.startSec + w.endSec) / 2 < hookEndSec).length;
  return { hookEndSec, wordsPerSec, targetSec: Math.round(hookEndSec * 10) / 10, targetWords: Math.max(3, hookWords || Math.round(hookEndSec * wordsPerSec)) };
}

/** Idioma em que o teardown foi escrito (o lever/rationale do plano sai igual). */
function diagnosisLanguageOf(t: TeardownSections): string {
  const sample = [t.whySells.data?.verdict.join(' '), t.whySells.data?.bigIdea, t.identification.data?.summary].filter(Boolean).join(' ');
  return guessLanguage(sample) === 'pt' ? 'Brazilian Portuguese' : 'English';
}

/** Elenco neutro quando o Claude falhou duas vezes: mesmo gênero da voz do campeão (lição do Pruna). */
export function fallbackCasting(language: string, t: TeardownSections): string {
  const g = genderOf(t.audio.data?.voice ?? '') ?? genderOf(t.visual.data?.person ?? '');
  const l = language.toLowerCase();
  if (l.startsWith('pt')) return `${g === 'male' ? 'Um homem' : g === 'female' ? 'Uma mulher' : 'Uma pessoa'} de uns 30 anos, roupa casual do dia a dia, em casa com luz de janela, olhando direto pra câmera, enquadrado do peito pra cima.`;
  if (l.startsWith('es')) return `${g === 'male' ? 'Un hombre' : g === 'female' ? 'Una mujer' : 'Una persona'} de unos 30 años, ropa casual, en casa con luz de ventana, mirando directo a la cámara, encuadre de pecho para arriba.`;
  return `${g === 'male' ? 'A man' : g === 'female' ? 'A woman' : 'A person'} around 30, casual everyday clothes, at home in window light, looking straight into the camera, framed from the chest up.`;
}
