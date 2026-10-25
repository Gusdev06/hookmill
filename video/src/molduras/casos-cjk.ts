// Casos CJK (bug de 25/10: oferta em zh-TW, read_caption com FRAME_TEXT_OVERFLOW). Os 18 templates em chinês tradicional,
// com todos os textos no limite CJK (metade do limite latino do contrato, ver LIMITE_CJK), nos 3 formatos. Mídia local; nada pago.
import type { VideoFormat } from '../lib/formatos';
import { TEXT_LIMITS as T, type FrameTemplateId, type FrameTextsMap, type MolduraProps } from '../lib/molduras';
import { demoProps } from './demo';

/** Repete a frase (sem espaço, como se escreve em chinês) até `n` caracteres visíveis; fecha o *destaque* se cortar no meio. */
export const limiteCJK = (frase: string, n: number) => {
  let s = '';
  let vis = 0;
  while (vis < n) {
    for (const c of frase) {
      if (vis >= n) break;
      s += c;
      if (c !== '*') vis++;
    }
  }
  return (s.match(/\*/g)?.length ?? 0) % 2 ? `${s}*` : s;
};
/** Limite em CJK: os limites do contrato são em caracteres calibrados no latino; o ideograma ocupa ~2 letras, então o
 *  limite que cabe nas mesmas caixas é a METADE (recomendação pra IA/backend: contar largura cheia como 2). Com o limite
 *  latino cheio, os textos longos de story/post_card/question_box etc. dão FRAME_TEXT_OVERFLOW (Leave out). */
export const LIMITE_CJK = (n: number) => Math.ceil(n / 2);
const L = (frase: string, n: number) => limiteCJK(frase, LIMITE_CJK(n));

export const TEXTOS_ZH_TW: FrameTextsMap = {
  question_box: { question: L('為什麼我早上起床時，*腰痛*比睡前還要嚴重？', T.question_box.question) },
  meme: { pov: L('你早上一睜開眼，第一個感覺就是下背在抗議。', T.meme.pov), cta: L('點擊下方按鈕立即開始使用', T.meme.cta) },
  cinema: { question: L('如果這種疼痛*不是因為年紀*呢？', T.cinema.question), subtitle: L('睡前十分鐘，改變你每天醒來的方式。', T.cinema.subtitle) },
  news: {
    topic: L('健康生活', T.news.topic), headline: { lead: L('十分鐘睡前伸展研究顯示：', T.news.lead), highlight: L('早晨的疼痛其實始於前一晚', T.news.highlight) },
    dek: L('睡前輕柔的動作能放鬆下背，讓你醒來不再僵硬。', T.news.dek), cta: L('點擊下方按鈕立即查看', T.news.cta),
  },
  read_caption: { headline: L('你夜晚的這個小細節，*決定了你醒來的感覺*。', T.read_caption.headline), primaryText: L('早晨的疼痛很少來自早晨。', 600) },
  pov_testimonial: { pov: L('你連續一週做了十分鐘的睡前伸展，醒來終於不再僵硬。', T.pov_testimonial.pov), cta: L('點擊按鈕立即免費試用', T.pov_testimonial.cta) },
  direct_offer: { promise: L('讓你的脊椎*重新輕盈*', T.direct_offer.promise), price: { from: 'NT$ 990', to: 'NT$ 490' }, cta: L('點擊下方按鈕立即搶購', T.direct_offer.cta) },
  live: {},
  ranking: { title: L('讓你脊椎卡住的習慣', T.ranking.title), items: ['趴著睡覺', '在床上滑手機', '睡前不伸展', '枕頭太高', '跳過晚上的放鬆時間'].map((x) => L(x + '，', T.ranking.item)) },
  post_card: { copy: L('沒有人告訴過你，早上的疼痛*其實從前一晚就開始了*。', T.post_card.copy) },
  split_stack: { headline: L('你不是天生*就該痛著醒來*', T.split_stack.headline) },
  split_torn: { headline: L('你的脊椎需要的是*十分鐘*，不是奇蹟', T.split_torn.headline) },
  gossip_page: { headline: L('他每天早上醒來都僵硬不堪。*直到他改變了睡前十分鐘。*', T.gossip_page.headline), pageName: L('健康快報', T.gossip_page.pageName) },
  gossip_white: { headline: L('看這個男人如何用每晚十分鐘*不再僵硬醒來*', T.gossip_white.headline) },
  gossip_pink: { headline: L('他一直以為是年紀。*其實是睡前的習慣。*', T.gossip_pink.headline) },
  call: { title: L('夜間放鬆課程・輕盈脊椎', T.call.title), slideTitle: L('第一晚：*放鬆下背*', T.call.slideTitle), slideSteps: ['深呼吸並放鬆髖部', '慢慢做貓牛式伸展', '雙膝抱胸一分鐘'].map((x) => L(x + '，', T.call.step)) },
  call_dialog: { title: L('關於背痛的對話', T.call_dialog.title), names: ['你', '物理治療師'] },
  story: {
    question: L('為什麼我的背在早上特別痛？', T.story.question), headline: L('這有名字，也有解方。', T.story.headline),
    support: L('睡前十分鐘。*不用健身房，不用器材。*', T.story.support), copy: L('你整天背著重物，坐姿不正，筋疲力盡地躺下。脊椎沒有休息，它*卡住了*。', T.story.copy),
  },
};

export const casosZhTw = (id: FrameTemplateId, format: VideoFormat): MolduraProps => demoProps(id, format, { texts: TEXTOS_ZH_TW[id] as never, language: 'zh-TW' });
