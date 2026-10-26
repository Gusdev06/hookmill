// headline-e-legenda-v1 §2: legenda automática (funções puras) e fichas CJK do remix-keep.
import {
  caixaDaLegenda, caixaLegendaAutoEdit, caixaLegendaMoldura, frameLayout, paginasLegendaAuto, palavrasNaPeca, semEspaco, textoDaPagina,
  tokensDoKaraoke, tokensDoTexto, type MolduraProps,
} from '../src/lib';

const pt = 'O detalhe da sua noite decide como você acorda amanhã de manhã'.split(' ').map((w, i) => ({ word: w, startSec: i * 0.4, endSec: i * 0.4 + 0.35 }));
const zh = [...'你夜晚的這個小細節決定了你醒來的感覺。睡前十分鐘就夠了'].map((w, i) => ({ word: w, startSec: i * 0.2, endSec: i * 0.2 + 0.18 }));

describe('palavras e páginas', () => {
  it('remapeia pelo timeline: palavra de trecho cortado sai, o resto vem pro tempo da peça', () => {
    const r = palavrasNaPeca(pt, [{ startSec: 0, endSec: 1.2 }, { startSec: 2.4, endSec: 3.6 }], 30);
    expect(r.map((w) => w.word)).toEqual(['O', 'detalhe', 'da', 'como', 'você', 'acorda']);
    expect(r[3].startSec).toBeCloseTo(1.2, 5);
  });
  it('latino: até 4 palavras por página; zh: até 8 caracteres, sem espaço, fecha no 。', () => {
    expect(paginasLegendaAuto(pt, 'pt', 10).every((p) => p.palavras.length <= 4)).toBe(true);
    const pz = paginasLegendaAuto(zh, 'zh-TW', 10);
    expect(pz.every((p) => [...textoDaPagina(p, 'zh-TW')].length <= 8)).toBe(true);
    expect(textoDaPagina(pz[0], 'zh-TW')).not.toContain(' ');
    expect(pz.some((p) => textoDaPagina(p, 'zh-TW').endsWith('。'))).toBe(true);
    expect([semEspaco('zh-TW'), semEspaco('ja'), semEspaco('ko'), semEspaco('pt')]).toEqual([true, true, false, false]);
  });
});

describe('onde a legenda entra', () => {
  it('AutoEdit: terço de baixo, acima da área segura', () => {
    const c = caixaLegendaAutoEdit('VERTICAL_9_16', { top: 220, bottom: 380 })!;
    expect(c.box.y + c.box.h).toBeLessThanOrEqual(1920 - 380);
    expect(c.box.y).toBeGreaterThanOrEqual(960);
    expect(c.maxLinhas).toBe(2);
  });
  it('desvia de obstáculo; sem espaço nem em 1 linha = null (sem legenda naquela peça)', () => {
    const area = { x: 0, y: 0, w: 1080, h: 1000 };
    const c = caixaDaLegenda(area, 1000, [{ x: 0, y: 860, w: 1080, h: 140 }], 64)!;
    expect(c.box.y + c.box.h).toBeLessThanOrEqual(852);
    expect(caixaDaLegenda(area, 1000, [{ x: 0, y: 480, w: 1080, h: 520 }], 64)).toBeNull();
  });
  it('Moldura: dentro da videoBox, fora dos slots, do rosto e da legenda queimada', () => {
    const p = {
      format: 'VERTICAL_9_16', safeArea: { top: 96, bottom: 192 },
      video: { source: { videoUrl: 'x', width: 720, height: 1280, fps: 30, durationSec: 10, hasAudio: true }, timeline: [{ startSec: 0, endSec: 10 }], joinFadeMs: 40,
        reframe: { mode: 'cover', focus: { x: 0.5, y: 0.4 } }, burnedTextBands: [{ y: 1000, h: 120, startSec: 0, endSec: 10 }] },
    } as unknown as MolduraProps;
    for (const id of ['meme', 'news', 'question_box', 'split_stack', 'gossip_white', 'call'] as const) {
      const L = frameLayout(id, 'VERTICAL_9_16', ({ meme: { pov: 'x', cta: 'y' }, news: { topic: 'a', headline: { lead: 'b', highlight: 'c' }, dek: 'd', cta: 'e' }, question_box: { question: 'q' }, split_stack: { headline: 'h' }, gossip_white: { headline: 'h' }, call: { title: 't', slideTitle: 's', slideSteps: ['a', 'b'] } } as never)[id]);
      const c = caixaLegendaMoldura(p, L);
      if (!c) continue;
      const vb = L.videoBox;
      expect(c.box.y >= vb.y && c.box.y + c.box.h <= vb.y + vb.h).toBe(true);
      for (const s of Object.values(L.slots)) expect(c.box.y >= s.y + s.h || c.box.y + c.box.h <= s.y || c.box.x >= s.x + s.w || c.box.x + c.box.w <= s.x).toBe(true);
    }
  });
});

describe('fichas CJK do remix-keep (headline e karaokê)', () => {
  it('ideograma = ficha sem espaço; latino por palavra; destaque com *; pontuação de fechamento gruda', () => {
    const t = tokensDoTexto('你跟外國同事說過 *I\'m not* 嗎？');
    expect(t.map((x) => x.t)).toEqual(['你', '跟', '外', '國', '同', '事', '說', '過', 'I\'m', 'not', '嗎？']);
    expect(t.find((x) => x.t === 'not')!.destaque).toBe(true);
    expect(t[1].espaco).toBe(false);
    expect(t.find((x) => x.t === 'I\'m')!.espaco).toBe(true);
    expect(tokensDoTexto('Sua coluna leve').map((x) => [x.t, x.espaco])).toEqual([['Sua', false], ['coluna', true], ['leve', true]]);
  });
  it('karaokê: duas palavras CJK sem espaço; latino com espaço', () => {
    expect(tokensDoKaraoke(['上次', '有個', 'student', 'said']).map((x) => x.espaco)).toEqual([false, false, true, true]);
  });
});
