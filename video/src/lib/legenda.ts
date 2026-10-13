import type { Palavra } from './schema';

export interface PaginaLegenda {
  startSec: number;
  /** Até quando a página fica na tela (início da próxima, ou fim da última palavra + folga). */
  endSec: number;
  palavras: Palavra[];
}

const FIM_DE_FRASE = /[.!?…]$/;
const PAUSA = /[,;:]$/;

/**
 * Agrupa palavras em páginas de legenda.
 * - maxPalavras/maxChars limitam o tamanho da página;
 * - fim de frase e silêncio > pausaSec quebram a página;
 * - vírgula quebra se a página já tem 2+ palavras.
 */
export const paginar = (
  palavras: Palavra[],
  opts: { maxPalavras: number; maxChars: number; pausaSec?: number; folgaSec?: number; ateSec: number },
): PaginaLegenda[] => {
  const pausa = opts.pausaSec ?? 0.45;
  const folga = opts.folgaSec ?? 0.5;
  const paginas: PaginaLegenda[] = [];
  let atual: Palavra[] = [];
  const fechar = () => {
    if (!atual.length) return;
    paginas.push({ startSec: atual[0].startSec, endSec: atual[atual.length - 1].endSec, palavras: atual });
    atual = [];
  };
  palavras.forEach((w, i) => {
    const anterior = atual[atual.length - 1];
    const chars = atual.reduce((n, p) => n + p.word.length + 1, 0) + w.word.length;
    if (anterior && (atual.length >= opts.maxPalavras || chars > opts.maxChars || w.startSec - anterior.endSec > pausa)) fechar();
    atual.push(w);
    const proxima = palavras[i + 1];
    if (FIM_DE_FRASE.test(w.word) || (PAUSA.test(w.word) && atual.length >= 2) || !proxima) fechar();
  });
  // Estende cada página até a próxima (sem buraco curto) ou até folga depois da última palavra.
  return paginas.map((p, i) => {
    const prox = paginas[i + 1];
    const limite = prox ? prox.startSec : opts.ateSec;
    const fim = Math.min(limite, p.endSec + folga);
    return { ...p, endSec: prox && prox.startSec - p.endSec < folga ? prox.startSec : Math.max(fim, p.endSec) };
  });
};
