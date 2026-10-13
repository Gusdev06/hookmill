import { CTA_SEC, END_CARD_SEC, FPS, GANCHO_SEC } from './formatos';
import type { CriativoProps, Palavra } from './schema';

export interface CenaNaLinha {
  index: number;
  clipUrl: string;
  fromFrame: number;
  durationInFrames: number;
}

/** Posiciona as cenas em frames, arredondando o acumulado (sem deriva entre cenas). */
export const linhaDoTempo = (scenes: CriativoProps['scenes'], fps: number = FPS): CenaNaLinha[] => {
  let acumulado = 0;
  return scenes.map((s, index) => {
    const from = Math.round(acumulado * fps);
    acumulado += s.durationSec;
    const to = Math.round(acumulado * fps);
    return { index, clipUrl: s.clipUrl, fromFrame: from, durationInFrames: Math.max(1, to - from) };
  });
};

export const framesDasCenas = (scenes: CriativoProps['scenes'], fps: number = FPS): number =>
  Math.max(1, Math.round(scenes.reduce((t, s) => t + s.durationSec, 0) * fps));

export const framesEndCard = (endCard: boolean, fps: number = FPS): number => (endCard ? Math.round(END_CARD_SEC * fps) : 0);

/** Duração total da composição (cenas + end card). O RenderService usa pra totalFrames. */
export const duracaoEmFrames = (p: Pick<CriativoProps, 'scenes' | 'endCard'>, fps: number = FPS): number =>
  framesDasCenas(p.scenes, fps) + framesEndCard(p.endCard, fps);

export const framesGancho = (fps: number = FPS) => Math.round(GANCHO_SEC * fps);
export const framesCta = (fps: number = FPS) => Math.round(CTA_SEC * fps);

/** Palavras de todas as cenas num tempo só (segundos desde o início do vídeo), cortadas no fim da cena. */
export const palavrasGlobais = (scenes: CriativoProps['scenes']): Palavra[] => {
  const out: Palavra[] = [];
  let offset = 0;
  for (const s of scenes) {
    for (const w of s.words) {
      const word = w.word.trim();
      if (!word || w.startSec >= s.durationSec) continue;
      const start = offset + Math.max(0, w.startSec);
      const end = offset + Math.min(s.durationSec, Math.max(w.endSec, w.startSec + 0.05));
      out.push({ word, startSec: start, endSec: end });
    }
    offset += s.durationSec;
  }
  return out.sort((a, b) => a.startSec - b.startSec);
};
