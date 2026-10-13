// Idioma da transcrição do campeão (feature 2). O Whisper da WaveSpeed roda com language=auto, mas a página do
// modelo não diz se a saída traz o idioma detectado: procura um campo de idioma na saída crua e, sem ele,
// adivinha pelo texto (palavras funcionais). Sempre devolve BCP 47 normalizado (pt → pt-BR).
import { normalizeLanguage } from '../claude/validacao';

const NAMES: Record<string, string> = {
  english: 'en', portuguese: 'pt', spanish: 'es', french: 'fr', german: 'de', italian: 'it', dutch: 'nl',
  japanese: 'ja', chinese: 'zh', korean: 'ko', russian: 'ru', arabic: 'ar', hindi: 'hi', turkish: 'tr', polish: 'pl',
};

function asLanguage(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (NAMES[s]) return NAMES[s];
  return /^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/i.test(s) ? s : null;
}

/** Campo de idioma em qualquer nível da saída (language / detected_language / lang). */
export function languageFromOutput(raw: unknown, depth = 0): string | null {
  if (typeof raw === 'string' && /^\s*[[{]/.test(raw)) raw = safeJson(raw);
  if (depth > 5 || raw == null || typeof raw !== 'object') return null;
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const l = languageFromOutput(x, depth + 1);
      if (l) return l;
    }
    return null;
  }
  const o = raw as Record<string, unknown>;
  for (const k of ['detected_language', 'language', 'lang']) {
    const l = asLanguage(o[k]);
    if (l && l !== 'auto') return l;
  }
  for (const v of Object.values(o)) {
    const l = languageFromOutput(v, depth + 1);
    if (l) return l;
  }
  return null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const STOP: Record<string, string[]> = {
  en: ['the', 'and', 'you', 'is', 'to', 'of', 'that', 'it', 'this', 'what', 'with', 'your', 'are', 'not', 'he', 'she', 'they', 'for', 'have', 'if'],
  pt: ['você', 'voce', 'não', 'nao', 'que', 'de', 'é', 'um', 'uma', 'para', 'pra', 'com', 'isso', 'seu', 'sua', 'ele', 'ela', 'mas', 'do', 'da', 'no', 'na', 'tá', 'está'],
  es: ['que', 'de', 'el', 'la', 'los', 'las', 'es', 'un', 'una', 'para', 'con', 'tu', 'esto', 'pero', 'por', 'del', 'está', 'qué', 'y', 'él'],
  fr: ['le', 'la', 'les', 'et', 'est', 'un', 'une', 'vous', 'tu', 'que', 'qui', 'pas', 'ce', 'pour', 'avec', 'des', 'du', 'je', 'il', 'elle'],
  de: ['der', 'die', 'das', 'und', 'ist', 'du', 'nicht', 'ein', 'eine', 'ich', 'sie', 'er', 'mit', 'auf', 'für', 'den', 'zu', 'es', 'wenn', 'aber'],
  it: ['il', 'la', 'che', 'di', 'e', 'non', 'un', 'una', 'per', 'con', 'sono', 'questo', 'ti', 'mi', 'lo', 'gli', 'del', 'della', 'ma', 'è'],
};

/** Palpite pelo texto. null se não der pra saber (texto curto demais ou empate sem sinal). */
export function guessLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOP)) {
    const set = new Set(list);
    const score = words.filter((w) => set.has(w)).length;
    if (score > bestScore) {
      best = lang;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}

/** Ordem: campo da saída do Whisper → idioma pedido na submissão → palpite pelo texto → 'en'. */
export function transcriptLanguage(o: { raw?: unknown; requested?: string | null; text?: string }): string {
  const found = languageFromOutput(o.raw) ?? (o.requested && o.requested !== 'auto' ? o.requested : null) ?? guessLanguage(o.text ?? '');
  return normalizeLanguage(found ?? 'en');
}
