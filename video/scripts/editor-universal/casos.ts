// Casos do aceite de doc nulo do editor universal (editor-universal-v1 §5, portão do F-U1): 18 molduras × 3 formatos +
// 2 HEADLINE (RemixKeep montado como o buildHeadlineInput: faixa adicionada e placa sobre o vídeo). Mídia local; nada pago.
import type { VideoFormat } from '../../src/lib/formatos';
import type { RemixKeepProps } from '../../src/lib/remix';
import { FRAME_IDS, type MolduraProps } from '../../src/lib/molduras';
import { demoProps } from '../../src/molduras/demo';

export type CasoAceite =
  | { nome: string; composicao: 'Moldura'; formato: '9x16' | '4x5' | '1x1'; props: MolduraProps }
  | { nome: string; composicao: 'RemixKeep'; formato: '9x16'; props: RemixKeepProps };

const FMT: Record<'9x16' | '4x5' | '1x1', VideoFormat> = { '9x16': 'VERTICAL_9_16', '4x5': 'PORTRAIT_4_5', '1x1': 'SQUARE_1_1' };

/** HEADLINE `add`: faixa na cor da marca no topo da área segura + legenda automática (karaokê) embaixo. */
export const HEADLINE_ADD: RemixKeepProps = {
  canvas: { width: 1080, height: 1920, fps: 24, frameCount: 120 },
  baseVideoUrl: 'fixtures/real-kling-2.mp4',
  overlays: [],
  language: 'pt',
  textLayers: [
    {
      id: 'headline-nova', startFrame: 0, endFrame: 120, box: { x: 65, y: 197, w: 950, h: 231 },
      background: { kind: 'solid', color: '#5B4BF5', box: { x: 0, y: 176, w: 1080, h: 273 } },
      style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 70, lineHeight: 1.1, color: '#ffffff', highlightColor: '#FFE14D', strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
      content: { kind: 'static', text: 'Sua coluna *leve* de novo em 10 minutos' },
    },
    {
      id: 'legenda-auto', startFrame: 0, endFrame: 120, box: { x: 65, y: 1418, w: 950, h: 138 },
      background: { kind: 'none', color: null, box: null },
      style: { fontId: 'montserrat-800', uppercase: false, fontSizePx: 60, lineHeight: 1.15, color: '#ffffff', highlightColor: '#FFE14D', strokeColor: '#000000', strokeWidthPx: 5, shadow: true, align: 'center' },
      content: {
        kind: 'karaoke', wordsPerPage: 3,
        words: ['Eu', 'acordava', 'travado', 'todo', 'santo', 'dia', 'até', 'mudar', 'a', 'noite'].map((word, i) => ({ word, startFrame: i * 12, endFrame: i * 12 + 11 })),
      },
    },
  ],
};

/** HEADLINE `replace` com texto sobre o vídeo: placa opaca com cantos de 0,15 em sobre a headline original. */
export const HEADLINE_PLACA: RemixKeepProps = {
  canvas: { width: 960, height: 960, fps: 24, frameCount: 96 },
  baseVideoUrl: 'fixtures/real-take-legenda.mp4',
  overlays: [],
  language: 'pt',
  textLayers: [
    {
      id: 'headline-nova', startFrame: 0, endFrame: 96, box: { x: 58, y: 70, w: 844, h: 120 },
      background: { kind: 'solid', color: '#ffffff', box: { x: 39, y: 51, w: 882, h: 158 }, radius: 8 },
      style: { fontId: 'inter-800', uppercase: false, fontSizePx: 54, lineHeight: 1.1, color: '#111111', highlightColor: '#D7261E', strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
      content: { kind: 'static', text: 'A dor da manhã *começa na noite*' },
    },
  ],
};

export const casosAceite = (): CasoAceite[] => [
  ...FRAME_IDS.flatMap((id) => (['9x16', '4x5', '1x1'] as const).map((f): CasoAceite => ({ nome: `moldura-${id}-${f}`, composicao: 'Moldura', formato: f, props: demoProps(id, FMT[f]) }))),
  { nome: 'headline-add-9x16', composicao: 'RemixKeep', formato: '9x16', props: HEADLINE_ADD },
  { nome: 'headline-placa-9x16', composicao: 'RemixKeep', formato: '9x16', props: HEADLINE_PLACA },
];
