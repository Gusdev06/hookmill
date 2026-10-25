// Props de exemplo da composição Moldura com a mídia de teste local (public/fixtures). Nada gerado, nada pago.
// Textos = os do protótipo aprovado (oferta fictícia "Coluna Leve"; preço de EXEMPLO).
// modo 'prova': mesmo enquadramento do protótipo (foco por caixa, foto do rosto) -> stills comparáveis pixel a pixel.
// modo 'auto' : enquadramento do produto (reframeNaCaixa com o faceTrack do take; rosto = face_crop do campeão).
import type { EditMapLike } from '../lib/autoEdit';
import type { VideoFormat } from '../lib/formatos';
import { frameLayout, reframeNaCaixa, type FrameReframe, type FrameTemplateId, type FrameTextsMap, type MolduraProps, type Rect } from '../lib/molduras';

export const DEMO_SOURCE = { videoUrl: 'fixtures/real-take.mp4', width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true };
/** faceTrack do take (o mesmo do auto-edit.spec da API). */
export const DEMO_EDIT_MAP: EditMapLike = {
  width: 960, height: 960, frameCount: 745, layers: [],
  faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }] }],
};
const KLING = { videoUrl: 'fixtures/real-kling-2.mp4', width: 1080, height: 1920, durationSec: 11.04 };
const PODCAST = { videoUrl: 'fixtures/cena-2.mp4', width: 704, height: 1280, durationSec: 8.04 };

export const DEMO_TEXTOS: FrameTextsMap = {
  question_box: { question: 'Por que eu acordo com *mais dor* do que quando fui dormir?' },
  gossip_page: { pageName: 'Plantão Bem-Estar', headline: 'Ele acordava travado todo santo dia. *Até mudar os 10 minutos antes de dormir.* Veja o que ele faz agora:' },
  meme: { pov: 'você acorda e a primeira coisa que sente é a lombar reclamando', cta: 'Toque no botão e use' },
  cinema: { question: 'E se essa dor não fosse *da idade*?', subtitle: 'Dez minutos antes de dormir mudam o jeito que você acorda.' },
  news: { topic: 'Saúde', headline: { lead: 'Rotina de 10 minutos mostra:', highlight: 'a dor da manhã começa na noite' }, dek: 'Movimentos leves antes de deitar soltam a lombar pra você acordar sem aquela rigidez.', cta: 'Toque no botão e veja' },
  split_stack: { headline: 'Você não nasceu pra *acordar com dor*' },
  split_torn: { headline: 'Sua coluna pede *10 minutos*, não um milagre' },
  call: { title: 'Rotina noturna · Coluna Leve', slideTitle: 'Noite 1: *soltar a lombar*', slideSteps: ['Respirar e soltar o quadril', 'Gato-vaca bem devagar', 'Joelhos ao peito, 1 min'] },
  call_dialog: { title: 'Conversa sobre dor nas costas', names: ['Você', 'Fisio'] },
  ranking: { title: 'O que trava sua coluna', items: ['Dormir de bruços', 'Celular na cama', 'Deitar sem alongar', 'Travesseiro alto demais', 'Pular a rotina da noite'] },
  post_card: { copy: 'Ninguém te contou, mas a dor que você sente de manhã *começa na noite anterior.*' },
  direct_offer: { promise: 'Sua coluna *leve* de novo', price: { from: 'R$ 97', to: 'R$ 47' }, cta: 'Toque no botão e garanta' },
  story: {
    question: 'Por que minhas costas doem mais de manhã?', headline: 'Isso tem nome. E tem saída.', support: '10 minutos antes de dormir. *Sem academia, sem aparelho.*',
    copy: 'Você passa o dia carregando peso, senta torto, deita exausto. A coluna não descansa: ela *trava*. O Coluna Leve te guia numa rotina de 10 minutos na cama, toda noite, pra você *acordar inteiro* de novo.',
  },
  read_caption: { headline: 'O detalhe da sua noite que *decide como você acorda*', primaryText: 'A dor da manhã quase nunca é da manhã. Ela vem do jeito que a coluna passa a noite: travada, sem ter soltado o dia. O Coluna Leve é uma rotina de 10 minutos na cama, antes de dormir, que solta lombar e quadril. Toque em Saiba mais e faça a primeira noite hoje.' },
  pov_testimonial: { pov: 'você fez a rotina de 10 minutos por uma semana e acordou sem travar', cta: 'Clique no botão para testar' },
  live: {},
  gossip_white: { headline: 'Veja como esse homem *parou de acordar travado* com 10 minutos por noite' },
  gossip_pink: { headline: 'Ele jurava que era a idade. *Era o que fazia antes de dormir.*' },
};

/** Ordem e nomes do protótipo (01-caixinha … 18-fofoca-2). */
export const DEMO_ORDEM: { slug: string; nome: string; id: FrameTemplateId }[] = [
  { slug: '01-caixinha', nome: 'Caixinha', id: 'question_box' }, { slug: '02-choquei', nome: 'Choquei', id: 'gossip_page' },
  { slug: '03-meme', nome: 'Meme', id: 'meme' }, { slug: '04-cinema', nome: 'Cinema', id: 'cinema' }, { slug: '05-noticia', nome: 'Notícia', id: 'news' },
  { slug: '06-tela-dividida', nome: 'Tela dividida', id: 'split_stack' }, { slug: '07-tela-dividida-2', nome: 'Tela dividida 2', id: 'split_torn' },
  { slug: '08-google-meet', nome: 'Google Meet', id: 'call' }, { slug: '09-meet-dialogo', nome: 'Meet diálogo', id: 'call_dialog' },
  { slug: '10-ranking', nome: 'Ranking', id: 'ranking' }, { slug: '11-tweet', nome: 'Tweet', id: 'post_card' }, { slug: '12-oferta-direta', nome: 'Oferta direta', id: 'direct_offer' },
  { slug: '13-story', nome: 'Story', id: 'story' }, { slug: '14-leia-a-legenda', nome: 'Leia a legenda', id: 'read_caption' },
  { slug: '15-pov-depoimento', nome: 'POV + depoimento', id: 'pov_testimonial' }, { slug: '16-live', nome: 'Live', id: 'live' },
  { slug: '17-fofoca-1', nome: 'Fofoca 1', id: 'gossip_white' }, { slug: '18-fofoca-2', nome: 'Fofoca 2', id: 'gossip_pink' },
];

// foco (object-position) que o protótipo usava em cada template, pro campeão e pra 2ª fonte
const FOCO_PROTO: Partial<Record<FrameTemplateId, { a: { x: number; y: number }; b?: { x: number; y: number } }>> = {
  cinema: { a: { x: 0.5, y: 0.3 } }, ranking: { a: { x: 0.5, y: 0.2 } }, direct_offer: { a: { x: 0.5, y: 0.25 } }, read_caption: { a: { x: 0.5, y: 0.2 } },
  pov_testimonial: { a: { x: 0.5, y: 0.3 } }, split_stack: { a: { x: 0.5, y: 0.25 }, b: { x: 0.5, y: 0.3 } }, split_torn: { a: { x: 0.5, y: 0.25 }, b: { x: 0.5, y: 0.3 } },
  call: { a: { x: 0.5, y: 0.3 } }, call_dialog: { a: { x: 0.5, y: 0.28 }, b: { x: 0.5, y: 0.28 } },
  gossip_page: { a: { x: 0.5, y: 0.3 }, b: { x: 0.5, y: 0.3 } }, gossip_white: { a: { x: 0.5, y: 0.3 }, b: { x: 0.5, y: 0.3 } }, gossip_pink: { a: { x: 0.5, y: 0.3 }, b: { x: 0.5, y: 0.3 } },
};

/** object-position do CSS (o do protótipo) -> foco do janelaCover que dá a MESMA janela. No eixo sem folga o foco não
 *  muda a janela; fica o valor do protótipo (é a origem do push-in, igual ao protótipo). */
export const focoDeObjectPosition = (box: Rect, src: { width: number; height: number }, p: { x: number; y: number }): FrameReframe => {
  const s = Math.max(box.w / src.width, box.h / src.height);
  const ww = box.w / s, wh = box.h / s;
  const fx = src.width - ww > 0.5 ? (p.x * (src.width - ww) + ww / 2) / src.width : p.x;
  const fy = src.height - wh > 0.5 ? (p.y * (src.height - wh) + wh / 2) / src.height : p.y;
  return { mode: 'cover', focus: { x: fx, y: fy } };
};

export type DemoModo = 'prova' | 'auto';
export const demoProps = <K extends FrameTemplateId>(id: K, format: VideoFormat = 'VERTICAL_9_16', o: { modo?: DemoModo; language?: string; texts?: FrameTextsMap[K]; durSec?: number } = {}): MolduraProps => {
  const modo = o.modo ?? 'auto';
  const language = o.language ?? 'pt';
  const texts = o.texts ?? DEMO_TEXTOS[id];
  const L = frameLayout(id, format, texts, language);
  const podcast = id === 'split_torn' || id === 'gossip_pink';
  const clip = podcast ? PODCAST : KLING;
  const fp = FOCO_PROTO[id];
  const reframeA: FrameReframe = modo === 'prova'
    ? focoDeObjectPosition(L.videoBox, DEMO_SOURCE, fp?.a ?? { x: 0.5, y: 0.3 })
    : reframeNaCaixa(L.videoBox, DEMO_SOURCE, DEMO_EDIT_MAP);
  const box2 = L.secondBox ?? L.videoBox;
  const reframeB: FrameReframe = modo === 'prova'
    ? focoDeObjectPosition(box2, clip, fp?.b ?? (podcast ? { x: 0.55, y: 0.35 } : { x: 0.5, y: 0.32 }))
    : reframeNaCaixa(box2, clip, null);
  return {
    format, language,
    frame: { id, texts, brand: { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' } } as MolduraProps['frame'],
    video: { source: DEMO_SOURCE, timeline: [{ startSec: 0, endSec: o.durSec ?? 8 }], joinFadeMs: 40, reframe: reframeA },
    second: { kind: 'clip', videoUrl: clip.videoUrl, width: clip.width, height: clip.height, durationSec: clip.durationSec, startSec: 0, reframe: reframeB },
    face: modo === 'prova' ? { kind: 'image', url: 'fixtures/rosto-take.jpg' } : { kind: 'face_crop', atSec: 2, box: DEMO_EDIT_MAP.faceTrack[0].faceInRegion[0].box },
    safeArea: { top: L.safe.top, bottom: L.safe.bottom },
  };
};
