// headline-e-legenda-v1 (backend): modo/limites/bloqueios da headline do campeão, legenda automática e aspecto.
import type { EditMap } from '@maquina/contratos';
import { captionsAutoOf, formatoDoCampeao, headlineInfoOf } from './headline-plano';

const style = { fontId: 'montserrat-800', uppercase: true, fontSizePx: 40, lineHeight: 1.1, color: '#fff', highlightColor: '#ff0', strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' };
const layer = (over: Record<string, unknown> = {}) => ({ id: 'h', kind: 'headline', startFrame: 0, endFrame: 300, box: { x: 60, y: 100, w: 600, h: 88 }, background: { kind: 'solid', color: '#000', box: null }, style, text: 'Você dorme mal toda noite?', ...over });
const em = (layers: unknown[], faceTrack: unknown[] = []) => ({ version: 1, width: 720, height: 1280, fps: 30, frameCount: 300, cells: [], faceTrack, layers, overlaysOverFace: [], profile: null }) as unknown as EditMap;
const o = { screenLanguage: 'pt-BR', offerLanguage: 'pt-BR', width: 720, height: 1280 };

describe('headlineInfoOf (§1.1, §1.4)', () => {
  it('§15.4 F1a: replace nunca é oferecido, seja qual for o fundo; limites pela original seguem pro F1b', () => {
    const h = headlineInfoOf(em([layer()]), o);
    expect(h).toMatchObject({ mode: 'replace', original: 'Você dorme mal toda noite?', maxChars: 31, lines: 2, hasHighlight: true, blockedReason: 'headline_pending', format: 'VERTICAL_9_16' });
    expect(headlineInfoOf(em([layer({ text: 'Oi' })]), o).maxChars).toBe(20);
    expect(headlineInfoOf(em([layer({ background: { kind: 'none', color: null, box: null } })]), o).blockedReason).toBe('headline_pending');
    expect(headlineInfoOf(em([layer({ style: { ...style, fontId: 'comic-sans' } })]), o).blockedReason).toBe('headline_pending');
  });
  it('add sem headline (máx. 60, idioma da oferta) segue oferecido; aspecto sem formato fica como aspecto', () => {
    expect(headlineInfoOf(em([]), { ...o, offerLanguage: 'en' })).toMatchObject({ mode: 'add', original: null, maxChars: 60, language: 'en', blockedReason: null });
    expect(headlineInfoOf(em([]), { ...o, width: 1920, height: 1080 }).blockedReason).toBe('headline_aspect');
    expect(headlineInfoOf(em([layer()]), { ...o, width: 1920, height: 1080 }).blockedReason).toBe('headline_aspect');
  });
  it('aspecto: 9:16 / 4:5 / 1:1 com 3 % de folga', () => {
    expect([formatoDoCampeao(720, 1280), formatoDoCampeao(1080, 1350), formatoDoCampeao(1000, 1010), formatoDoCampeao(1920, 1080)]).toEqual(['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1', null]);
  });
});

describe('captionsAutoOf (§2.1)', () => {
  const words = Array.from({ length: 20 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
  it('sem legenda queimada = legenda automática; com legenda em ≥ 50 % da fala = não; sem fala = não', () => {
    expect(captionsAutoOf(em([layer()]), words)).toBe(true);
    expect(captionsAutoOf(em([layer({ kind: 'caption', startFrame: 0, endFrame: 300 })]), words)).toBe(false);
    expect(captionsAutoOf(em([layer({ kind: 'caption', startFrame: 0, endFrame: 60 })]), words)).toBe(true); // 2 s de 10
    expect(captionsAutoOf(em([]), [])).toBe(false);
  });
});

// troca-texto-queimado-v1 §16.5 (F1b, B1): a ordem da decisão em `replace` com a troca ligada.
import { lookFake } from '../medicao/troca/fake';
import { semEsperarPlaca } from './headline-plano';
import { selectPieces } from './selecao';

describe('headlineInfoOf com a troca ligada (§16.5)', () => {
  const gancho = layer({ id: 'gancho', startFrame: 0, endFrame: 120, text: 'Você dorme mal\ntoda noite?', background: { kind: 'none', color: null, box: null } });
  const cta = layer({ id: 'cta', startFrame: 200, endFrame: 300, box: { x: 60, y: 100, w: 600, h: 300 }, text: 'Baixe agora o app e durma melhor hoje' });
  const base = em([cta, gancho]);
  const comLook = (o2: Parameters<typeof lookFake>[2] = {}) => ({ ...base, headlineLook: lookFake(base, 'gancho', o2) }) as EditMap;
  const ON = { ...o, plateImpl: 'local' as const };

  it('off (ou ausente) = F1a, a maior camada, sem medir nem placa', () => {
    expect(headlineInfoOf(comLook(), o)).toMatchObject({ original: 'Baixe agora o app e durma melhor hoje', blockedReason: 'headline_pending', copy: null, needsMeasure: false, needsPlate: false });
    expect(headlineInfoOf(comLook(), { ...o, plateImpl: 'off' })).toEqual(headlineInfoOf(comLook(), o));
  });
  it('alvo = a 1ª camada no tempo (o gancho, não o CTA maior); sem medida = needsMeasure com headline_pending', () => {
    expect(headlineInfoOf(base, ON)).toMatchObject({ mode: 'replace', original: 'Você dorme mal toda noite?', blockedReason: 'headline_pending', copy: null, needsMeasure: true });
  });
  it('solto: sem placa / QUEUED / RUNNING = needsPlate (blockedReason null); READY = ok; REJECTED e FAILED bloqueiam', () => {
    const m = comLook();
    const st = (status: 'QUEUED' | 'RUNNING' | 'READY' | 'REJECTED' | 'FAILED') => headlineInfoOf(m, { ...ON, plate: { status, reason: null, version: 1 } });
    expect(headlineInfoOf(m, ON)).toMatchObject({ copy: 'loose', blockedReason: null, needsPlate: true, lines: 2 });
    expect([st('QUEUED').needsPlate, st('RUNNING').needsPlate]).toEqual([true, true]);
    expect(st('READY')).toMatchObject({ blockedReason: null, needsPlate: false, copy: 'loose' });
    expect(st('REJECTED').blockedReason).toBe('headline_plate_rejected');
    expect(st('FAILED').blockedReason).toBe('headline_pending');
    expect(semEsperarPlaca(headlineInfoOf(m, ON)).blockedReason).toBe('headline_pending');
    expect(semEsperarPlaca(st('READY')).blockedReason).toBeNull();
  });
  it('caixa: pronta sem placa; veredito da medida pela tabela', () => {
    expect(headlineInfoOf(comLook({ kind: 'box' }), ON)).toMatchObject({ copy: 'box', blockedReason: null, needsPlate: false });
    const r = (motivo: import('@maquina/contratos').HeadlineLookReason) => headlineInfoOf(comLook({ motivo }), ON).blockedReason;
    expect([r('not_measured'), r('fades'), r('over_face'), r('near_caption'), r('font_far'), r('plate_rejected'), r('plate_failed')])
      .toEqual(['headline_low_confidence', 'headline_moves', 'headline_over_face', 'headline_near_caption', 'headline_font_far', 'headline_plate_rejected', 'headline_pending']);
  });
  it('medido sem headline (sem camada-alvo) = add; aspecto sem formato vence tudo', () => {
    expect(headlineInfoOf(em([]), ON)).toMatchObject({ mode: 'add', copy: 'add', blockedReason: null });
    expect(headlineInfoOf(comLook(), { ...ON, width: 1920, height: 1080 }).blockedReason).toBe('headline_aspect');
  });
});

describe('B4: `wants: [headline]` sem HEADLINE possível', () => {
  const c = (autoType: string, index: number) => ({ autoType: autoType as never, axis: (index % 2 ? 'DIVERSITY' : 'ITERATION') as never, index });
  const pool = ['CUT', 'REVIEW', 'FRAME', 'NATIVE_SEARCH', 'HOOK_TEXT', 'STATIC'].map(c);
  const answers = { goal: 'auto' as const, ai: 'free_only' as const, aiCapUsd: null, aiCapCredits: null, wants: ['headline' as const] };
  it('sem candidata HEADLINE o pedido é ignorado (antes: 1 peça só)', () => {
    const r = selectPieces(pool, answers);
    expect(r.selected.filter((x) => x.included).length).toBeGreaterThanOrEqual(4);
    expect(r.selected.some((x) => x.selection === 'not_asked')).toBe(false);
  });
  it('com HEADLINE no plano o pedido vale como antes', () => {
    const r = selectPieces([...pool, c('HEADLINE', 9)], answers);
    expect(r.selected.find((x) => x.item.autoType === 'HEADLINE')?.selection).toBe('asked');
    expect(r.selected.some((x) => x.selection === 'not_asked')).toBe(true);
  });
});
