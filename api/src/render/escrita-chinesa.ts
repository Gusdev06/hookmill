// Escrita chinesa da legenda (pedido do Gusta 28/10, F1): o Whisper devolve zh quase sempre em SIMPLIFICADO; numa oferta
// zh-TW/zh-HK/zh-MO/zh-Hant a legenda palavra a palavra tem que sair em TRADICIONAL (e o inverso numa zh-CN/zh-SG/zh-Hans).
// OpenCC (opencc-js, MIT/Apache-2.0, offline, sem custo) com a variante regional (tw/hk). A conversão roda no TEXTO TODO
// (frases: 头发 → 頭髮, não 頭發) e volta pras palavras pelo número de caracteres (a conversão s↔t preserva o tamanho);
// se algum dia não preservar, converte palavra por palavra. Idioma que não é chinês: nada muda.
import * as OpenCC from 'opencc-js';

type Alvo = 'tw' | 'hk' | 'cn' | null;
/** Escrita-alvo pelo idioma da tela (BCP 47). null = não é chinês ou não dá pra saber (zh puro: fica como veio). */
export function escritaAlvo(language: string | null | undefined): Alvo {
  const l = (language ?? '').toLowerCase();
  if (!l.startsWith('zh')) return null;
  if (/(-hk|-mo)/.test(l)) return 'hk';
  if (/(-tw|hant)/.test(l)) return 'tw';
  if (/(-cn|-sg|hans)/.test(l)) return 'cn';
  return null;
}

const conversores = new Map<string, (s: string) => string>();
function conversor(alvo: Exclude<Alvo, null>): (s: string) => string {
  let c = conversores.get(alvo);
  if (!c) {
    c = alvo === 'cn' ? OpenCC.Converter({ from: 'tw', to: 'cn' }) : OpenCC.Converter({ from: 'cn', to: alvo });
    conversores.set(alvo, c);
  }
  return c;
}

/** Converte um texto pra escrita do idioma (sem chinês = igual). */
export function paraEscritaDoIdioma(texto: string, language: string | null | undefined): string {
  const alvo = escritaAlvo(language);
  return alvo ? conversor(alvo)(texto) : texto;
}

/** Palavras da transcrição na escrita do idioma da tela (mesmos tempos, mesma quantidade). */
export function palavrasNaEscrita<T extends { word: string }>(words: T[], language: string | null | undefined): T[] {
  const alvo = escritaAlvo(language);
  if (!alvo || !words.length) return words;
  const conv = conversor(alvo);
  // o Whisper parte zh em 1-2 caracteres: converte o texto corrido (frases inteiras) e reparte pelo nº de caracteres
  const tamanhos = words.map((w) => [...w.word].length);
  const convertido = [...conv(words.map((w) => w.word).join(''))];
  if (convertido.length !== tamanhos.reduce((a, b) => a + b, 0)) return words.map((w) => ({ ...w, word: conv(w.word) }));
  let k = 0;
  return words.map((w, i) => {
    const word = convertido.slice(k, k + tamanhos[i]).join('');
    k += tamanhos[i];
    return { ...w, word };
  });
}
