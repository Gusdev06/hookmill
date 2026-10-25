// Checagem de texto do STATIC "anúncio montado" (estatico-montado-e-molduras-v1 §A6). PURO, testado em checagem-texto.spec.ts.
// A visão (Haiku, porta `checkStaticText` da ia) diz o que LEU em cada texto esperado; aqui o backend compara, marca o que é
// crítico, decide se refaz e escolhe a melhor de 2 imagens. Acento conta ("vólta" ≠ "volta"); caixa e espaços não.
import type { StaticTextCheck } from '@maquina/contratos';
import type { CheckStaticTextResult, StaticAspect, StaticImageSpecV2 } from '../integracoes/contrato';
import { staticTextsFor } from '../integracoes/wavespeed/prompts-estatico';
import { hasClaimTerm } from '../iteracao/afirmacoes';

/** NFC, minúsculo, sem espaço/quebra de linha, aspas/apóstrofos tipográficos = retos. Acento e pontuação contam. */
export function normalizarTexto(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, '');
}

/** §A6 `compararTexto`: o visto bate com o esperado? */
export function compararTexto(expected: string, seen: string | null | undefined): boolean {
  return seen != null && normalizarTexto(expected) === normalizarTexto(seen);
}

export interface ExpectedText { key: string; text: string; critical: boolean }

/**
 * Textos que a imagem tem que ter, no aspecto: a lista sai do `staticTextsFor` da ia (o MESMO corte por aspecto do prompt,
 * com a caixa alta que o prompt pede). Críticos: os da ia (marca, headline, CTA, número) + todo texto com termo de
 * afirmação (§A6).
 */
export function expectedTexts(spec: StaticImageSpecV2, aspect: StaticAspect): ExpectedText[] {
  return staticTextsFor(spec, aspect).map((e) => ({ ...e, critical: e.critical || hasClaimTerm(e.text, spec.screenLanguage) }));
}

export interface TextVerdict { check: StaticTextCheck; criticalErrors: number; minorErrors: number }

/**
 * Resultado da visão → `StaticTextCheck` (§A10.4: TODOS os textos conferidos, cada um com `key` e `match`; erros = `!match`;
 * `extraText` = texto que a imagem inventou) + contagem de erros. G3 (Gusta 25/10): cada `extraText` é erro CRÍTICO.
 */
export function verdictOf(expected: ExpectedText[], result: CheckStaticTextResult): TextVerdict {
  const byKey = new Map(result.items.map((i) => [i.key, i]));
  const items = expected.map((e) => {
    const r = byKey.get(e.key);
    return { key: e.key, expected: e.text, seen: r?.seen ?? null, critical: e.critical, match: !!r && r.found && compararTexto(e.text, r.seen) };
  });
  const wrong = items.filter((i) => !i.match);
  const extraText = (result.extraText ?? []).map((t) => t.trim()).filter(Boolean);
  const criticalWrong = wrong.filter((i) => i.critical).length;
  return {
    check: { status: wrong.length || extraText.length ? 'mismatch' : 'ok', items, extraText },
    criticalErrors: criticalWrong + extraText.length,
    minorErrors: wrong.length - criticalWrong,
  };
}

/** §A10.4: checagem que não rodou = os esperados com `match: false` e `seen: null`. */
export function skippedCheck(expected: ExpectedText[]): StaticTextCheck {
  return { status: 'skipped', items: expected.map((e) => ({ key: e.key, expected: e.text, seen: null, critical: e.critical, match: false })), extraText: [] };
}

/** Uma imagem candidata do render (até 2: a 1ª e a refação). */
export interface StaticCandidate { providerTaskId: string; fileId: string; check: StaticTextCheck; criticalErrors: number }

/** §A6 passo 3: das imagens, a de MENOS erros críticos; empate = a mais nova. */
export function pickBest(cands: StaticCandidate[]): StaticCandidate | null {
  let best: StaticCandidate | null = null;
  for (const c of cands) if (!best || c.criticalErrors <= best.criticalErrors) best = c;
  return best;
}

/** §A6 passo 2: refaz só com erro em texto CRÍTICO e enquanto o render tiver 1 task (o limite de 2 é dividido com a recusa). */
export function shouldRedoForText(v: Pick<TextVerdict, 'criticalErrors'>, tasks: number, maxTasks: number): boolean {
  return v.criticalErrors > 0 && tasks < maxTasks;
}
