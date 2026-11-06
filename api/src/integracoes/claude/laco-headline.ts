// troca-texto-queimado-v1 §16.3 itens 2-4 (F1b, I1): o laço de uma headline `replace`, PURO. Quem chama (B1, no
// AUTO_PLAN) injeta a medida (`ajustarHeadlineCopia` + `headlineViolations`) e a reescrita (`rewriteHeadlineFit`):
//   medida 0 = o texto do plano; reprovou → até 3 reescritas, cada uma medida (4 medidas no máximo);
//   erro da reescrita conta como tentativa e o texto atual segue; passou = fica; sem passar na 3ª = a peça sai.
import type { HeadlineFitReject } from '@maquina/contratos';
import { HEADLINE_FIT_MODEL } from '../catalogo/precos';
import { isIntegracaoError } from '../erros';

export interface HeadlineFitVerdict {
  ok: boolean;
  /** null quando ok */
  reject: HeadlineFitReject | 'rule' | null;
  /** a medida, legível, que vai pra IA ("E 0.33 > 0.15") */
  measure: string;
  /** regras violadas (detail do headlineViolations), vão pra IA */
  rules: string[];
}

export interface HeadlineFitAttempt<V extends HeadlineFitVerdict> {
  text: string; highlight: string | null;
  /** null = a reescrita falhou (erro), nada medido */
  verdict: V | null;
  error: string | null;
}

export type HeadlineFitOutcome<V extends HeadlineFitVerdict> =
  | { ok: true; text: string; highlight: string | null; verdict: V; rewrites: number; measures: number; attempts: HeadlineFitAttempt<V>[] }
  | { ok: false; reason: 'headline_no_fit'; last: V; rewrites: number; measures: number; attempts: HeadlineFitAttempt<V>[] };

export async function encaixarHeadline<V extends HeadlineFitVerdict>(o: {
  text: string; highlight: string | null;
  /** síncrona e pura (a função da V1 + as regras do backend) */
  medir: (text: string, highlight: string | null) => V;
  /** 1 chamada de `rewriteHeadlineFit` com o texto atual e o motivo; o resto (alvo, idioma, lote) quem chama fecha */
  reescrever: (a: { current: string; reject: NonNullable<V['reject']>; measure: string; rules: string[] }) => Promise<{ text: string; highlight: string | null }>;
  /** padrão 3 (§16.3 item 3) */
  maxRewrites?: number;
}): Promise<HeadlineFitOutcome<V>> {
  const max = o.maxRewrites ?? HEADLINE_FIT_MODEL.maxRewrites;
  let cur = { text: o.text, highlight: o.highlight };
  let v = o.medir(cur.text, cur.highlight);
  const attempts: HeadlineFitAttempt<V>[] = [{ ...cur, verdict: v, error: null }];
  let measures = 1;
  let rewrites = 0;
  while (!v.ok && rewrites < max) {
    rewrites++;
    try {
      const r = await o.reescrever({ current: cur.text, reject: (v.reject ?? 'rule') as NonNullable<V['reject']>, measure: v.measure, rules: v.rules });
      const nv = o.medir(r.text, r.highlight);
      measures++;
      attempts.push({ text: r.text, highlight: r.highlight, verdict: nv, error: null });
      cur = { text: r.text, highlight: r.highlight };
      v = nv;
    } catch (e) {
      // §16.3 item 3: erro da chamada conta como tentativa; o texto e a medida atuais seguem pra próxima
      attempts.push({ ...cur, verdict: null, error: isIntegracaoError(e) ? e.code : (e as Error).message });
    }
  }
  return v.ok
    ? { ok: true, text: cur.text, highlight: cur.highlight, verdict: v, rewrites, measures, attempts }
    : { ok: false, reason: 'headline_no_fit', last: v, rewrites, measures, attempts };
}
