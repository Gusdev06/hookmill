// troca-texto-queimado-v1 §16.3 (F1b, I1): `rewriteHeadlineFit` do modo mock. Determinístico e grátis: monta um texto no
// meio do alvo por linha só com palavras do texto atual e da original (nunca número novo, nunca emoji), diferente da
// original e das outras do lote. `mode` força os caminhos de falha pras specs do backend (laço de 4 medidas, peça sai).
import type { RewriteHeadlineFitInput } from '../contrato';
import { IntegracaoError } from '../erros';
import { stripEmoji } from '../claude/headline-fit';

/** `fit` = mira o alvo; `same` = devolve o texto atual (o laço esgota); `error` = PROVIDER_ERROR (conta como tentativa). */
export type FakeHeadlineFitMode = 'fit' | 'same' | 'error';

const norm = (t: string) => t.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (t: string) => stripEmoji(t).replace(/\n/g, ' ').split(/\s+/).filter((w) => w && !/\d/.test(w));

export function fakeRewriteHeadlineFit(i: RewriteHeadlineFitInput, mode: FakeHeadlineFitMode = 'fit'): { text: string; highlight: string | null } {
  if (mode === 'error') throw new IntegracaoError('PROVIDER_ERROR', 'mock headline rewrite failure');
  const current = stripEmoji(i.current).replace(/\n/g, ' ');
  if (mode === 'same') return { text: current, highlight: null };
  const t = i.targetCharsPerLine.length ? i.targetCharsPerLine : [{ min: current.length, max: current.length }];
  const goal = Math.round(t.reduce((a, x) => a + (x.min + x.max) / 2, 0));
  const max = t.reduce((a, x) => a + x.max, 0);
  const cur = words(current);
  const pool = [...cur, ...words(i.original).filter((w) => !cur.includes(w)), ...cur];
  const out: string[] = [];
  const len = () => out.join(' ').length;
  // encurta: tira do fim; alonga: completa com palavras do atual e da original (repete o atual se faltar)
  for (let k = 0; len() < goal && k < pool.length * 3; k++) {
    const w = pool[k % pool.length];
    if (out.join(' ').length + 1 + w.length > max) break;
    out.push(w);
  }
  if (!out.length) out.push(...cur.slice(0, 1));
  const banned = new Set([norm(i.original), ...(i.others ?? []).map(norm)]);
  let text = out.join(' ');
  for (let k = 0; banned.has(norm(text)) && out.length > 1 && k < 4; k++) {
    out.pop();
    text = out.join(' ');
  }
  const highlight = i.hasHighlight && out.length > 2 ? out.slice(-2).join(' ') : null;
  return { text, highlight };
}
