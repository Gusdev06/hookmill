// Validação do teardown e do plano que o Claude devolve (feature 2). A saída estruturada garante a FORMA; aqui
// ficam as regras que o esquema não expressa e as garantias que não dependem do modelo:
//  - metaCopy vem LITERAL dos metadados da Ad Library (ou 'na' sem eles), nunca do modelo;
//  - fala citada (gancho, blocos) é a transcrição literal do trecho, não paráfrase;
//  - blocos cobrem o vídeo sem buraco, começam no 0, o 1º termina no fim do gancho, fronteiras no silêncio;
//  - seção 'na' sai com data null e motivo; 'ok' sem motivo.
import type { AdLibraryMeta, TeardownSections, TranscriptWord, VariationKind } from '../contrato';
import { IntegracaoError } from '../erros';
import { VARIATION_KINDS } from './prompts-campeao';
import { gapsOf, snapCut } from '../catalogo/fatiar';

type Locale = 'EN' | 'PT_BR';
type Key = keyof TeardownSections;
const KEYS: Key[] = ['identification', 'metaCopy', 'transcript', 'hook', 'structure', 'layout', 'visual', 'audio', 'offerProofCta', 'whySells', 'stealVsVary', 'replicationPlan'];

const REASONS = {
  EN: { noSpeech: 'No speech detected in the video.', noAdMeta: 'No Ad Library data: the video was uploaded without a resolved link.', noData: 'Not enough data in the video.' },
  PT_BR: { noSpeech: 'Nenhuma fala detectada no vídeo.', noAdMeta: 'Sem dados da Ad Library: o vídeo foi enviado sem link resolvido.', noData: 'O vídeo não tem dado suficiente pra isso.' },
} as const;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const a = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown) => a(v).map(s).filter(Boolean);
const mid = (w: TranscriptWord) => (w.startSec + w.endSec) / 2;

export function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* erro abaixo */
  }
  throw new IntegracaoError('PROVIDER_ERROR', 'claude returned invalid JSON');
}

/** Corte no silêncio entre palavras perto de t (o mais longo a até 1 s; ver catalogo/fatiar.ts), dentro de (lo, hi). */
export function snapToSilence(t: number, words: TranscriptWord[], lo = 0, hi = Infinity): number {
  return r3(snapCut(t, gapsOf([...words].sort((x, y) => x.startSec - y.startSec)), lo, hi));
}

function literal(words: TranscriptWord[], from: number, to: number, inclusiveEnd = false): string {
  return words.filter((w) => mid(w) >= from && (inclusiveEnd ? mid(w) <= to : mid(w) < to)).map((w) => w.word).join(' ');
}

type Sec<T> = { status: 'ok' | 'na'; naReason: string | null; data: T | null };
const na = <T>(reason: string): Sec<T> => ({ status: 'na', naReason: reason, data: null });
const ok = <T>(data: T): Sec<T> => ({ status: 'ok', naReason: null, data });

export function parseTeardown(
  text: string,
  ctx: { uiLocale: Locale; durationSec: number; words: TranscriptWord[]; adMeta: AdLibraryMeta | null },
): TeardownSections {
  const root = parseJsonObject(text);
  const R = REASONS[ctx.uiLocale];
  const dur = ctx.durationSec > 0 ? ctx.durationSec : Math.max(1, ...ctx.words.map((w) => w.endSec));
  const words = [...ctx.words].sort((x, y) => x.startSec - y.startSec);
  const speech = words.length > 0;

  /** Seção crua do modelo: 'na' (ou sem dado) vira na com motivo; 'ok' devolve o objeto de dados. */
  const raw = (k: Key): { data: Record<string, unknown> | null; reason: string } => {
    const sec = o(root[k]);
    const reason = s(sec.naReason) || R.noData;
    if (s(sec.status) !== 'ok' || !sec.data || typeof sec.data !== 'object') return { data: null, reason };
    return { data: o(sec.data), reason };
  };
  const build = <T>(k: Key, f: (d: Record<string, unknown>) => T | null): Sec<T> => {
    const r = raw(k);
    if (!r.data) return na(r.reason);
    const v = f(r.data);
    return v == null ? na(r.reason) : ok(v);
  };

  // metaCopy: literal da Ad Library
  const am = ctx.adMeta;
  const metaCopy: TeardownSections['metaCopy'] =
    am && am.status === 'resolved' && (am.primaryText || am.headline || am.ctaText || am.linkUrl)
      ? ok({ primaryText: am.primaryText, headline: am.headline, description: null, button: am.ctaText, link: am.linkUrl })
      : na(R.noAdMeta);

  // gancho
  let hook: TeardownSections['hook'];
  if (!speech) hook = na(R.noSpeech);
  else
    hook = build('hook', (d) => {
      const raw = n(d.endSec) ?? Math.min(3, dur);
      const endSec = snapToSilence(Math.min(Math.max(raw, 0.5), dur), words, 0.3, dur);
      return { endSec, visual: s(d.visual), onScreenText: s(d.onScreenText) || null, spoken: literal(words, 0, endSec) || s(d.spoken) };
    });

  // estrutura: contínua de 0 ao fim, 1º bloco = gancho, fronteiras no silêncio, fala literal
  const structure = build('structure', (d) => {
    const blocks = a(d.blocks)
      .map((b) => o(b))
      .map((b) => ({ label: s(b.label) || 'Block', function: s(b.function) || 'other', startSec: n(b.startSec) ?? 0, endSec: n(b.endSec) ?? 0, onScreen: s(b.onScreen) }))
      .filter((b) => b.endSec > b.startSec || b.startSec > 0)
      .sort((x, y) => x.startSec - y.startSec);
    if (!blocks.length) return null;
    const bounds: number[] = [0];
    blocks.slice(1).forEach((b, i) => {
      const prev = bounds[bounds.length - 1];
      let t = i === 0 && hook.status === 'ok' && hook.data ? hook.data.endSec : snapToSilence(Math.min(Math.max(b.startSec, 0), dur), words, prev, dur);
      if (!(t > prev + 0.05)) t = Math.min(dur, Math.max(b.startSec, prev + 0.05));
      bounds.push(r3(t));
    });
    bounds.push(r3(dur));
    const out = blocks
      .map((b, i) => ({ ...b, startSec: bounds[i], endSec: bounds[i + 1] }))
      .filter((b) => b.endSec > b.startSec)
      .map((b, i, all) => ({ ...b, speech: literal(words, b.startSec, b.endSec, i === all.length - 1) }));
    return out.length ? { blocks: out } : null;
  });

  const kinds = new Set<string>(VARIATION_KINDS);
  const sections: TeardownSections = {
    identification: build('identification', (d) => ({ summary: s(d.summary), signals: strs(d.signals) })),
    metaCopy,
    transcript: speech
      ? build('transcript', (d) => ({ keywords: a(d.keywords).map(o).map((k) => ({ sentence: s(k.sentence), keyword: s(k.keyword) })).filter((k) => k.sentence && k.keyword) }))
      : na(R.noSpeech),
    hook,
    structure,
    layout: build('layout', (d) => ({
      summary: s(d.summary),
      segments: a(d.segments).map(o).map((x) => ({ startSec: r3(Math.max(0, n(x.startSec) ?? 0)), endSec: r3(Math.min(dur, n(x.endSec) ?? dur)), description: s(x.description) })).filter((x) => x.endSec > x.startSec),
    })),
    visual: build('visual', (d) => ({
      palette: a(d.palette).map(o).map((p) => ({ hex: s(p.hex).toUpperCase(), role: s(p.role) })).filter((p) => /^#[0-9A-F]{6}$/.test(p.hex)),
      typography: s(d.typography), captions: s(d.captions), uiElements: s(d.uiElements), person: s(d.person), broll: s(d.broll), motion: s(d.motion),
    })),
    audio: build('audio', (d) => ({ voice: s(d.voice), music: s(d.music), sfx: s(d.sfx) })),
    offerProofCta: build('offerProofCta', (d) => ({ promise: s(d.promise), mechanism: s(d.mechanism), proof: s(d.proof), ctaSpoken: s(d.ctaSpoken), ctaOnScreen: s(d.ctaOnScreen) })),
    whySells: build('whySells', (d) => ({
      avatar: s(d.avatar), awarenessLevel: s(d.awarenessLevel), painDesire: s(d.painDesire), bigIdea: s(d.bigIdea),
      beliefObjection: s(d.beliefObjection), retentionEngine: s(d.retentionEngine), verdict: strs(d.verdict).slice(0, 5),
    })),
    stealVsVary: build('stealVsVary', (d) => ({ steal: strs(d.steal), vary: a(d.vary).map(o).map((v) => ({ lever: s(v.lever), idea: s(v.idea) })).filter((v) => v.lever && v.idea) })),
    replicationPlan: build('replicationPlan', (d) => ({
      suggestions: a(d.suggestions).map(o).filter((x) => kinds.has(s(x.kind))).map((x) => ({ kind: s(x.kind) as VariationKind, lever: s(x.lever), idea: s(x.idea) })).filter((x) => x.lever && x.idea),
    })),
  };
  // checagem final: as 12 chaves existem (nunca some seção)
  for (const k of KEYS) if (!sections[k]) throw new IntegracaoError('PROVIDER_ERROR', `teardown missing section ${k}`);
  return sections;
}

// ---------------------------------------------------------------- plano

const count = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Gancho novo: fala não vazia, tamanho razoável; duração = palavras no ritmo medido do campeão. */
export function parseHook(text: string, ctx: { wordsPerSec: number; targetWords: number }): { lever: string; rationale: string; hook: { speech: string; onScreenText: string | null; durationSec: number } } {
  const d = parseJsonObject(text);
  const lever = s(d.lever);
  const rationale = s(d.rationale);
  const speech = s(d.speech);
  if (!lever || !rationale || !speech) throw new IntegracaoError('INVALID_SCRIPT', 'hook missing lever, rationale or speech');
  const words = count(speech);
  if (words > Math.max(8, ctx.targetWords * 2.5)) throw new IntegracaoError('INVALID_SCRIPT', `hook has ${words} words (target ${ctx.targetWords})`);
  const onScreen = s(d.onScreenText);
  return {
    lever: lever.slice(0, 120),
    rationale,
    hook: { speech, onScreenText: onScreen ? onScreen.slice(0, 80) : null, durationSec: Math.max(1, Math.round((words / ctx.wordsPerSec) * 10) / 10) },
  };
}

export function parseCasting(text: string): { lever: string; rationale: string; castingDescription: string } {
  const d = parseJsonObject(text);
  const lever = s(d.lever);
  const rationale = s(d.rationale);
  const desc = s(d.castingDescription);
  if (!lever || !rationale || desc.length < 10) throw new IntegracaoError('INVALID_SCRIPT', 'casting missing lever, rationale or description');
  return { lever: lever.slice(0, 120), rationale, castingDescription: desc.slice(0, 600) };
}

export function parseSharedCasting(text: string): string {
  const d = s(parseJsonObject(text).description);
  if (d.length < 10) throw new IntegracaoError('PROVIDER_ERROR', 'empty casting description');
  return d.slice(0, 600);
}
