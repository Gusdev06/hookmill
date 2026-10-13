// Legenda = texto do roteiro (a fala que a cena devia dizer) com os tempos da transcrição.
// A transcrição erra nome de marca e número ("Geraew" vira "Guerra", "doze" vira "doce"); o roteiro não erra.
// Alinhamento por programação dinâmica (edit distance entre palavras normalizadas): palavra casada ou trocada herda
// o tempo da transcrita; palavra do roteiro que a transcrição pulou ganha tempo interpolado entre as vizinhas;
// palavra transcrita a mais (que o roteiro não tem) só estende o tempo da vizinha.

export type Word = { word: string; startSec: number; endSec: number };

const norm = (w: string) =>
  w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

export function alignCaptionToScript(speech: string, words: Word[]): Word[] {
  const script = speech.split(/\s+/).filter((w) => norm(w));
  const heard = words.filter((w) => norm(w.word));
  if (!script.length) return words;
  if (!heard.length) return [];

  const n = script.length, m = heard.length;
  const a = script.map(norm), b = heard.map((w) => norm(w.word));
  // custo de troca 0 se igual, 1 se diferente; inserção/remoção 1
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);

  // caminho de volta: pra cada palavra do roteiro, o índice transcrito casado (ou null) e as transcritas a mais
  const match: (number | null)[] = Array(n).fill(null);
  const extraAfter: number[][] = Array.from({ length: n + 1 }, () => []);
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { match[i - 1] = j - 1; i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) i--;
    else { extraAfter[i].push(j - 1); j--; }
  }

  const out: Word[] = script.map((word, k) => {
    const h = match[k];
    return h === null ? { word, startSec: NaN, endSec: NaN } : { word, startSec: heard[h].startSec, endSec: heard[h].endSec };
  });
  // transcritas a mais: estendem a vizinha que não casou exato ("Cansá"+"la" = "Cancela"); na dúvida, a anterior
  const exact = match.map((h, k) => h !== null && a[k] === b[h]);
  extraAfter.forEach((xs, k) => {
    for (const x of xs) {
      const next = k < n && (k === 0 || exact[k - 1]) && !exact[k];
      const t = next || k === 0 ? out[k] : out[k - 1];
      if (Number.isNaN(t.startSec)) continue;
      t.startSec = Math.min(t.startSec, heard[x].startSec);
      t.endSec = Math.max(t.endSec, heard[x].endSec);
    }
  });
  // sem par: interpola entre a vizinha anterior e a próxima com tempo
  const first = heard[0].startSec, last = heard[m - 1].endSec;
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(out[k].startSec)) continue;
    let e = k;
    while (e < n && Number.isNaN(out[e].startSec)) e++;
    const from = k > 0 ? out[k - 1].endSec : first;
    const to = e < n ? out[e].startSec : last;
    const step = Math.max(0, to - from) / (e - k);
    for (let q = k; q < e; q++) { out[q].startSec = from + step * (q - k); out[q].endSec = from + step * (q - k + 1); }
  }
  // monotônico e sem sobreposição
  for (let k = 1; k < n; k++) {
    if (out[k].startSec < out[k - 1].endSec) out[k].startSec = out[k - 1].endSec;
    if (out[k].endSec < out[k].startSec) out[k].endSec = out[k].startSec;
  }
  return out.map((w) => ({ word: w.word, startSec: +w.startSec.toFixed(3), endSec: +w.endSec.toFixed(3) }));
}
