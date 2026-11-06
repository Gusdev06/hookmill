// templates-lista-v1 (04/11): posicionarLista, needLista, agendaLista, medirLista e o painel no checarLegendaProtegida.
import {
  agendaLista, checarLegendaProtegida, checkpointsLista, faixasProtegidasNaSaidaLista, fonteNaSaida, medirLista, needLista, posicionarLista, propsDeTemplateInput, videoDaLista,
  type ListOverlayProps, type ListPlacement, type ProtectedBand, type VideoFormat,
} from '../src/lib';

const src = { width: 1080, height: 1920, durationSec: 19.7 };
const rosto = { x: 300, y: 280, w: 480, h: 730 }; // 280–1010 (o avatar Pocketwise da spec)
const faixa = (top: number, bot: number, startSec = 0, endSec = 19.7): ProtectedBand => ({ x: 60, y: top - 77, w: 960, h: bot - top + 154, startSec, endSec });
const BAIXA = faixa(1520, 1640);
const MEIO = faixa(1080, 1200);

const pos = (o: { format?: VideoFormat; face?: typeof rosto | null; bands?: ProtectedBand[]; need: number; source?: typeof src }) =>
  posicionarLista({ format: o.format ?? 'VERTICAL_9_16', source: o.source ?? src, faceSafeBand: o.face === undefined ? rosto : o.face, protectedBands: o.bands ?? [], need: o.need });

const checar = (pl: ListPlacement, face: typeof rosto | null, bands: ProtectedBand[], s = src) =>
  checarLegendaProtegida({ source: { videoUrl: 'x', fps: 30, ...s }, guard: { faceSafeBand: face, protectedBands: bands }, placement: pl, lines: [{ id: 'l1', side: 'bad', kind: 'item', text: 'a', atSec: 1, fit: null as never }] });

describe('needLista', () => {
  it('284 (2 col, 3 linhas) · 364 (1 col, 6) · 372 (stack, 5 barras)', () => {
    expect(needLista('two-col', 3)).toBe(284);
    expect(needLista('one-col', 6)).toBe(364);
    expect(needLista('stack', 5)).toBe(372);
  });
});

describe('posicionarLista', () => {
  it('legenda baixa: body entre o queixo e a legenda (zona 383 px), os três modos cabem', () => {
    for (const need of [284, 364, 372]) {
      const p = pos({ bands: [BAIXA], need });
      expect(p.mode).toBe('body');
      if (p.mode !== 'body') return;
      expect(p.reason).toBe('free_below_face');
      expect(p.panel.y).toBeGreaterThanOrEqual(1010 + 30);
      expect(p.panel.y + p.panel.h).toBeLessThanOrEqual(1520 - 77 - 20);
      expect(p.panel).toMatchObject({ x: 56, w: 968 });
      expect(p.maxPairs).toBe(3);
      expect(checar(p, rosto, [BAIXA]).ok).toBe(true);
    }
  });
  it('sem legenda: body até o limite de UI de baixo (1580), painel até need × 1,45', () => {
    const p = pos({ need: 284 });
    expect(p.mode === 'body' && p.reason).toBe('no_captions');
    if (p.mode !== 'body') return;
    expect(p.panel.h).toBe(Math.round(284 * 1.45));
    expect(p.panel.y + p.panel.h).toBeLessThanOrEqual(1920 - 340);
    expect(p.maxPairs).toBe(4); // zona 1040–1580 = 540 ≥ 480
  });
  it('legenda no meio (encosta no rosto): zona abaixo dela é pequena → top, painel em y 170 e vídeo encolhido embaixo', () => {
    const p = pos({ bands: [MEIO], need: 284 });
    expect(p.mode).toBe('top');
    if (p.mode !== 'top') return;
    expect(p.panel).toMatchObject({ x: 56, y: 170, h: Math.round(284 * 1.3) });
    expect(p.video.box.y).toBeGreaterThan(p.panel.y + p.panel.h);
    expect(p.scale).toBeGreaterThanOrEqual(0.6);
    expect(checar(p, rosto, [MEIO]).ok).toBe(true);
  });
  it('legenda no meio com zona que cabe: body abaixo da legenda (below_captions)', () => {
    const alto = { ...src, height: 1920 };
    const p = posicionarLista({ format: 'VERTICAL_9_16', source: alto, faceSafeBand: { x: 300, y: 200, w: 480, h: 500 }, protectedBands: [faixa(760, 860)], need: 284 });
    expect(p.mode === 'body' && p.reason).toBe('below_captions');
    if (p.mode === 'body') expect(p.panel.y).toBeGreaterThanOrEqual(860 + 77 + 20);
  });
  it('legenda que muda de lugar: vale a união no vídeo inteiro (o painel é estático)', () => {
    const bands = [faixa(1520, 1640, 0, 8), faixa(1080, 1200, 8, 19.7)];
    const p = pos({ bands, need: 284 });
    expect(p.mode).toBe('top');
    expect(checar(p, rosto, bands).ok).toBe(true);
    // só a baixa daria body
    expect(pos({ bands: [bands[0]], need: 284 }).mode).toBe('body');
  });
  it('sem rosto: a zona começa em 45 % da altura', () => {
    const p = pos({ face: null, bands: [BAIXA], need: 372 });
    expect(p.mode).toBe('body');
    if (p.mode !== 'body') return;
    expect(p.panel.y).toBeGreaterThanOrEqual(Math.round(0.45 * 1920) - 1);
    expect(p.maxPairs).toBe(4);
    expect(checar(p, null, [BAIXA]).ok).toBe(true);
  });
  it('4:5 com legenda baixa: Versus cabe (body), Value stack vai pro topo', () => {
    const v = pos({ format: 'PORTRAIT_4_5', bands: [BAIXA], need: 284 });
    const s = pos({ format: 'PORTRAIT_4_5', bands: [BAIXA], need: 372 });
    expect(v.mode).toBe('body');
    expect(s.mode).toBe('top');
    if (s.mode === 'top') expect(s.panel.y).toBe(50);
    for (const p of [v, s]) expect(checar(p, rosto, [BAIXA]).ok).toBe(true);
  });
  it('1:1: side (vídeo de 600 px à esquerda, painel à direita)', () => {
    const p = pos({ format: 'SQUARE_1_1', bands: [BAIXA], need: 364 });
    expect(p.mode).toBe('side');
    if (p.mode !== 'side') return;
    expect(p.video.box).toEqual({ x: 0, y: 0, w: 600, h: 1080 });
    expect(p.panel).toEqual({ x: 630, y: 70, w: 410, h: 940 });
    expect(checar(p, rosto, [BAIXA]).ok).toBe(true);
  });
  it('none: rosto ocupa o quadro → no_room sem faixa, burned_captions com faixa', () => {
    const largo = { width: 1920, height: 1080, durationSec: 19.7 };
    const face = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(pos({ source: largo, face, need: 284 })).toEqual({ mode: 'none', reason: 'no_room' });
    expect(pos({ source: largo, face, bands: [{ x: 100, y: 900, w: 1700, h: 150, startSec: 0, endSec: 19.7 }], need: 284 })).toEqual({ mode: 'none', reason: 'burned_captions' });
  });
});

describe('checarLegendaProtegida com o painel', () => {
  it('painel por cima da legenda (a partir da 1ª linha) e do rosto vira hit; faixa que some antes do painel não', () => {
    const p = pos({ need: 284 }) as Extract<ListPlacement, { mode: 'body' }>;
    const encima = { ...p, panel: { ...p.panel, y: 1450 } };
    const r = checar(encima, rosto, [BAIXA]);
    expect(r.hits.map((h) => h.element)).toContain('list_panel');
    const antes = checar(encima, rosto, [faixa(1520, 1640, 0, 0.5)]);
    expect(antes.hits.map((h) => h.element)).not.toContain('list_panel');
    const noRosto = checar({ ...p, panel: { ...p.panel, y: 900 } }, rosto, []);
    expect(noRosto.hits.map((h) => h.element)).toContain('face_covered:list_panel');
  });
  it('faixas na saída pela caixa do vídeo (top encolhe)', () => {
    const p = pos({ bands: [MEIO], need: 284 });
    const [f] = faixasProtegidasNaSaidaLista({ format: 'VERTICAL_9_16', source: { videoUrl: 'x', fps: 30, ...src }, guard: { faceSafeBand: rosto, protectedBands: [MEIO] }, placement: p, lines: [] });
    if (p.mode === 'none') throw new Error('none');
    const esperado = fonteNaSaida(MEIO, src, videoDaLista(p));
    expect(f.y).toBe(Math.round(esperado.y));
    expect(f.y).toBeGreaterThan(p.panel.y + p.panel.h);
  });
});

// tempos reais (mlx-whisper local) do avatar Pocketwise
const W = [['Okay,', 0, 0.7], ['I', 0.74, 1.0], ['have', 1.04, 1.2], ['to', 1.22, 1.32], ['show', 1.34, 1.52], ['you', 1.54, 1.66], ['this.', 1.68, 2.2], ['I', 3.14, 3.5], ['tried', 3.9, 4.2],
  ['every', 4.28, 4.7], ['budget', 4.76, 5.1], ['app', 5.14, 5.4], ['out', 5.44, 5.62], ['there', 5.66, 5.9], ['and', 5.96, 6.3], ['quit', 6.38, 6.64], ['all', 6.68, 6.94], ['of', 6.98, 7.06],
  ['them.', 7.1, 7.4], ['This', 7.76, 8.0], ['one', 8.4, 8.56], ['tells', 8.6, 8.86], ['me', 8.9, 9.02], ['exactly', 9.06, 9.6], ['where', 9.66, 10.0], ['my', 10.04, 10.24], ['money', 10.28, 10.5],
  ['goes.', 10.52, 10.9], ['Every', 11.32, 11.9], ['single', 11.98, 12.4], ['day.', 12.44, 12.9], ['Three', 13.58, 14.1], ['weeks', 14.14, 14.38], ['in,', 14.4, 14.8], ['I', 15.08, 15.6],
  ['saved', 15.7, 16.04], ['400', 16.08, 16.6], ['bucks.', 16.7, 17.1], ['Links', 18.16, 18.9], ['right', 18.92, 19.14], ['below.', 19.18, 19.6]].map(([word, startSec, endSec]) => ({ word: word as string, startSec: startSec as number, endSec: endSec as number }));

describe('agendaLista', () => {
  it('com âncora: início da palavra − 0,10 s', () => {
    expect(agendaLista([{ anchorWordIndex: 8, side: 'bad' }, { anchorWordIndex: 24, side: 'good' }], W, 19.68, 'by_speech')).toEqual([3.8, 9.56]);
  });
  it('sem âncora: na maior pausa ≥ 0,4 s entre as vizinhas (preço entre a prova e o CTA)', () => {
    const at = agendaLista([{ anchorWordIndex: 35, side: null }, { anchorWordIndex: null, side: null }, { anchorWordIndex: 38, side: null }], W, 19.68, 'by_speech');
    expect(at[1]).toBeGreaterThan(17.1); // depois de "bucks."
    expect(at[1]).toBeLessThan(18.06);   // antes do CTA
  });
  it('sem âncora e sem pausa: no meio do intervalo', () => {
    const corrida = [{ word: 'a', startSec: 0, endSec: 1 }, { word: 'b', startSec: 1.1, endSec: 2 }, { word: 'c', startSec: 2.1, endSec: 3 }];
    expect(agendaLista([{ anchorWordIndex: 0, side: null }, { anchorWordIndex: null, side: null }, { anchorWordIndex: 2, side: null }], corrida, 3, 'by_speech')[1]).toBeCloseTo(1, 1);
  });
  it('alternate: par a par nos primeiros 70 %', () => {
    const at = agendaLista([{ anchorWordIndex: null, side: 'bad' }, { anchorWordIndex: null, side: 'good' }, { anchorWordIndex: null, side: 'bad' }, { anchorWordIndex: null, side: 'good' }], W, 20, 'alternate');
    expect(at[0]).toBeLessThan(at[1]);
    expect(at[1]).toBeLessThan(at[2]);
    expect(Math.max(...at)).toBeLessThanOrEqual(0.7 * 20);
  });
});

const props = (mode: ListOverlayProps['mode'], placement: ListPlacement, lines: Omit<ListOverlayProps['lines'][number], 'fit'>[]) => ({
  mode, look: 'ink' as const, brandColor: '#3B5BFF', source: { videoUrl: 'x', fps: 30, ...src }, guard: { faceSafeBand: rosto, protectedBands: [BAIXA] }, placement,
  heads: mode === 'two-col' ? { bad: 'Other apps', good: 'Pocketwise' } : null, title: mode === 'stack' ? 'What you get' : null, lines, sfx: null, language: 'en',
});

describe('medirLista', () => {
  it('Versus 2 col no 9:16: tudo cabe no piso de 30 px; texto enorme vai pro overflow', () => {
    const pl = pos({ bands: [BAIXA], need: 284 });
    const ls = [['b1', 'bad', 'Tried every budget app'], ['b2', 'bad', 'Quit all of them'], ['b3', 'bad', 'No idea where it went'], ['g1', 'good', 'See where it all goes'], ['g2', 'good', 'A check-in every day'], ['g3', 'good', '$400 saved in 3 weeks']]
      .map(([id, side, text], k) => ({ id, side: side as 'bad' | 'good', kind: 'item' as const, text, atSec: k }));
    const m = medirLista(props('two-col', pl, ls));
    expect(m.overflow).toEqual([]);
    expect(Math.min(...m.lines.map((f) => f.size))).toBeGreaterThanOrEqual(30);
    const grande = medirLista(props('two-col', pl, ls.map((l, k) => (k === 0 ? { ...l, text: 'Supercalifragilistic expialidocious everything forever and ever' } : l))));
    expect(grande.overflow).toEqual(['b1']);
  });
  it('Value stack no 9:16 e no 1:1 (side): o preço de 34 caracteres cabe em 2 linhas no piso de 26 px; CTA em 1 linha', () => {
    const ls = [['s1', 'item', 'See where every dollar goes'], ['s2', 'item', 'A check-in every single day'], ['s3', 'proof', '$400 saved by week 3'], ['s4', 'price', '$4.99/mo after a 7-day free trial'], ['s5', 'cta', "Link's right below"]]
      .map(([id, kind, text], k) => ({ id, side: null, kind: kind as 'item', text, atSec: k }));
    for (const format of ['VERTICAL_9_16', 'SQUARE_1_1'] as const) {
      const m = medirLista(props('stack', pos({ format, bands: [BAIXA], need: 372 }), ls));
      expect(m.overflow).toEqual([]);
      expect(m.lines[4].lines).toHaveLength(1);
      expect(Math.min(...m.lines.map((f) => f.size))).toBeGreaterThanOrEqual(26);
    }
  });
});

describe('schema e checkpoints', () => {
  it('propsDeTemplateInput aceita versus em 4:5 e recusa modo trocado; checkpoints = 3 instantes, o último com a tabela inteira', () => {
    const pl = pos({ format: 'PORTRAIT_4_5', bands: [BAIXA], need: 284 });
    const ls = [['b1', 'bad', 'Tried every budget app', 3.8], ['g1', 'good', 'See where it all goes', 9.56]].map(([id, side, text, atSec]) => ({ id: id as string, side: side as 'bad', kind: 'item' as const, text: text as string, atSec: atSec as number }));
    const base = props('two-col', pl, ls);
    const m = medirLista(base);
    const { language: _l, ...p } = base;
    void _l;
    const lp: ListOverlayProps = { ...p, lines: ls.map((l, k) => ({ ...l, fit: m.lines[k] })) };
    const input = { kind: 'template', renderId: 'r', templateId: 'versus', format: 'PORTRAIT_4_5', fps: 30, language: 'en', brand: { name: 'P', handle: '@p', initials: 'P', color: '#3B5BFF' }, palette: [], safeArea: { top: 60, bottom: 90 }, sfx: null, durationInFrames: 591, checkpoints: [], props: lp };
    expect(propsDeTemplateInput(input).templateId).toBe('versus');
    expect(() => propsDeTemplateInput({ ...input, templateId: 'value-stack' })).toThrow(/stack_mode/);
    const cps = checkpointsLista(lp);
    expect(cps).toHaveLength(3);
    expect(cps[2].texts).toEqual(['Other apps', 'Pocketwise', 'Tried every budget app', 'See where it all goes']);
  });
});
