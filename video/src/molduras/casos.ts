// Casos de teste visual da composição Moldura: textos curto / médio / no limite do contrato, pt / en / es nos textos
// fixos, palavra longa demais (fitText quebra sem cortar) e mídia sem faceTrack. Mídia local; nada pago.
import type { VideoFormat } from '../lib/formatos';
import { frameLayout, reframeNaCaixa, type FrameTemplateId, type FrameTextsMap, type MolduraProps } from '../lib/molduras';
import { DEMO_SOURCE, DEMO_TEXTOS, demoProps } from './demo';

/** Preenche até `n` caracteres repetindo a frase (corta na palavra, completa com letras): texto exatamente no limite. */
export const noLimite = (frase: string, n: number) => {
  let s = '';
  while (s.length < n) s += (s ? ' ' : '') + frase;
  s = s.slice(0, n);
  return s.endsWith(' ') ? `${s.slice(0, -1)}a` : s;
};

type Caso = { nome: string; props: MolduraProps };
const caso = <K extends FrameTemplateId>(nome: string, id: K, texts: FrameTextsMap[K], o: { format?: VideoFormat; language?: string; semRosto?: boolean } = {}): Caso => {
  const props = demoProps(id, o.format ?? 'VERTICAL_9_16', { texts, language: o.language });
  if (o.semRosto) {
    const L = frameLayout(id, props.format, texts, props.language);
    props.video.reframe = reframeNaCaixa(L.videoBox, DEMO_SOURCE, null);
    props.face = { kind: 'face_crop', atSec: 2, box: { x: 0.3, y: 0.1, w: 0.4, h: 0.4 } };
  }
  return { nome, props };
};

export const CASOS: Caso[] = [
  caso('caixinha-curta', 'question_box', { question: 'Dói *de manhã*?' }),
  caso('caixinha-media', 'question_box', { question: 'Por que eu acordo com *mais dor* do que quando fui dormir?' }),
  caso('caixinha-limite', 'question_box', { question: noLimite('Por que minha lombar trava toda manhã quando levanto', 70) }),
  caso('caixinha-palavra-longa', 'question_box', { question: 'Pneumoultramicroscopicossilicovulcanoconiótico existe?' }),
  caso('caixinha-sem-facetrack', 'question_box', { question: 'Por que eu acordo com *mais dor*?' }, { semRosto: true }),
  caso('caixinha-en', 'question_box', { question: 'Why do I wake up *more sore* than when I went to bed?' }, { language: 'en' }),
  caso('caixinha-es', 'question_box', { question: '¿Por qué me despierto con *más dolor* que cuando me acosté?' }, { language: 'es' }),
  caso('noticia-limite', 'news', {
    topic: noLimite('Saúde', 18), headline: { lead: noLimite('Rotina de dez minutos mostra que', 40), highlight: noLimite('a dor da manhã começa', 30) },
    dek: noLimite('Movimentos leves antes de deitar soltam a lombar', 80), cta: noLimite('Toque no botão e veja', 28),
  }),
  caso('noticia-limite-4x5', 'news', {
    topic: noLimite('Saúde', 18), headline: { lead: noLimite('Rotina de dez minutos mostra que', 40), highlight: noLimite('a dor da manhã começa', 30) },
    dek: noLimite('Movimentos leves antes de deitar soltam a lombar', 80), cta: noLimite('Toque no botão e veja', 28),
  }, { format: 'PORTRAIT_4_5' }),
  caso('noticia-curta-1x1', 'news', { topic: 'Saúde', headline: { lead: 'Dor da manhã:', highlight: 'vem da noite' }, dek: 'Rotina leve.', cta: 'Veja' }, { format: 'SQUARE_1_1' }),
  caso('legenda-en', 'read_caption', { headline: 'The night habit that *decides how you wake up*', primaryText: 'x' }, { language: 'en' }),
  caso('legenda-es', 'read_caption', { headline: 'El detalle de tu noche que *decide cómo despiertas*', primaryText: 'x' }, { language: 'es' }),
  caso('legenda-limite-1x1', 'read_caption', { headline: noLimite('O detalhe da sua noite que decide como você acorda', 70), primaryText: 'x' }, { format: 'SQUARE_1_1' }),
  caso('live-en', 'live', {}, { language: 'en' }),
  caso('live-es-sem-facetrack', 'live', {}, { language: 'es', semRosto: true }),
  caso('meme-es', 'meme', { pov: 'te despiertas y lo primero que sientes es la espalda quejándose', cta: 'Toca el botón' }, { language: 'es' }),
  caso('oferta-en-sem-de', 'direct_offer', { promise: 'Your back *light* again', price: { from: null, to: '$19.99' }, cta: 'Tap the button' }, { language: 'en' }),
  caso('oferta-limite', 'direct_offer', { promise: noLimite('Sua coluna leve de novo toda manhã', 40), price: { from: 'R$ 197,90', to: 'R$ 97,90' }, cta: noLimite('Toque no botão e garanta', 28) }),
  caso('ranking-limite', 'ranking', { title: noLimite('O que trava sua coluna', 24), items: [1, 2, 3, 4, 5].map((i) => noLimite(`Item ${i} que trava a lombar`, 28)) }),
  caso('ranking-limite-1x1', 'ranking', { title: noLimite('O que trava sua coluna', 24), items: [1, 2, 3, 4, 5].map((i) => noLimite(`Item ${i} que trava a lombar`, 28)) }, { format: 'SQUARE_1_1' }),
  caso('tweet-limite', 'post_card', { copy: noLimite('Ninguém te contou, mas a dor que você sente de manhã começa na noite anterior.', 140) }),
  caso('tweet-limite-1x1', 'post_card', { copy: noLimite('Ninguém te contou, mas a dor que você sente de manhã começa na noite anterior.', 140) }, { format: 'SQUARE_1_1' }),
  caso('fofoca1-limite', 'gossip_white', { headline: noLimite('Veja como esse homem parou de acordar travado com 10 minutos', 80) }),
  caso('fofoca2-curta-4x5', 'gossip_pink', { headline: 'Era *a noite*.' }, { format: 'PORTRAIT_4_5' }),
  caso('tela-limite', 'split_stack', { headline: noLimite('Você não nasceu pra acordar com dor', 50) }),
  caso('story-limite-1x1', 'story', { question: noLimite('Por que minhas costas doem mais de manhã', 70), headline: noLimite('Isso tem nome e tem saída', 40), support: 'x', copy: noLimite('Você passa o dia carregando peso, senta torto, deita exausto.', 300) }, { format: 'SQUARE_1_1' }),
  caso('meet-es', 'call', { title: 'Rutina nocturna', slideTitle: 'Noche 1: *soltar la espalda*', slideSteps: ['Respirar y soltar la cadera', 'Gato-vaca muy despacio', 'Rodillas al pecho, 1 min'] }, { language: 'es' }),
  // Meet com a "apresentação" = 2ª fonte de imagem (bug do render real de 25/10: a foto não aparecia no slide)
  ...(['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'] as const).flatMap((format) => {
    const k = format === 'VERTICAL_9_16' ? '9x16' : format === 'PORTRAIT_4_5' ? '4x5' : '1x1';
    const t = DEMO_TEXTOS.call;
    const com = (second: MolduraProps['second'], nome: string): Caso => {
      const c = caso(nome, 'call', t, { format });
      c.props.second = second;
      return c;
    };
    return [
      caso(`meet-sem-imagem-${k}`, 'call', t, { format }),
      com({ kind: 'product_photo', fileUrl: 'fixtures/produto-qa.png' }, `meet-foto-produto-${k}`),
      com({ kind: 'page_capture', fileUrl: 'fixtures/pagina-lp.png', scroll: true }, `meet-captura-pagina-${k}`),
    ];
  }),
  caso('cinema-limite-4x5', 'cinema', { question: noLimite('E se essa dor não fosse da idade nem do colchão', 60), subtitle: noLimite('Dez minutos antes de dormir mudam o jeito que você acorda.', 80) }, { format: 'PORTRAIT_4_5' }),
];

// Trilha de b-roll (decisão 25/10): 5 clipes que trocam conforme a fala, cobrindo a peça de 10 s. O 4º é curto
// (1 s pra 2,3 s: desacelera e segura o último quadro); o 3º vai sem medidas (cover pelo CSS).
export const TRILHA_FALSA: MolduraProps['second'] = {
  kind: 'broll_track',
  clips: [
    { fromSec: 0, toSec: 2.2, fileUrl: 'fixtures/broll-pexels.mp4', srcStartSec: 0, srcEndSec: 2.2, segmentText: 'acordo travado', width: 1012, height: 1920 },
    { fromSec: 2.2, toSec: 4.1, fileUrl: 'fixtures/real-kling-1.mp4', srcStartSec: 0.5, srcEndSec: 2.4, segmentText: 'dor nas costas', width: 1080, height: 1920 },
    { fromSec: 4.1, toSec: 6, fileUrl: 'fixtures/cena-3.mp4', srcStartSec: 1, srcEndSec: 2.9, segmentText: 'antes de dormir' },
    { fromSec: 6, toSec: 8.3, fileUrl: 'fixtures/broll-pexels.mp4', srcStartSec: 8, srcEndSec: 9, segmentText: 'dez minutos', width: 1012, height: 1920 },
    { fromSec: 8.3, toSec: 10, fileUrl: 'fixtures/real-kling-3.mp4', srcStartSec: 3, srcEndSec: 5, segmentText: 'acorda leve', width: 1080, height: 1920 },
  ],
};
export const TRILHA_TEMPLATES = ['split_stack', 'split_torn', 'gossip_page', 'gossip_white', 'gossip_pink', 'call_dialog'] as const;
export const casoTrilha = (id: (typeof TRILHA_TEMPLATES)[number], format: VideoFormat): MolduraProps => ({ ...demoProps(id, format, { durSec: 10 }), second: TRILHA_FALSA });
