// §13 (B5): regras puras do "manter a edição" e do take: bloqueios do mapa, plano por item, input do remix-keep,
// fatias do take no render e teto de 600 s.
import type { EditLayer, EditMap, TeardownSections } from '@maquina/contratos';
import { buildEditMap, clampRect, dedupeBlockers, hookBlockers, overlayCoversFace, pickMainSpeaker, swapBlockers } from './mapa-edicao';
import { remixKeepInput, wordsInFrames } from '../edicao/remix-keep';
import { renderPieces } from '../edicao/cenas-render';
import { faceWindowOf, keepEditBlockers, planItem, type TeardownSnapshot } from '../variacoes/plano';
import { assertTakeLength, joinSpeech } from '../geracao/geracao.service';
import { takeSeed } from '../geracao/take';

const style = {
  fontId: 'montserrat-800' as const, uppercase: true, fontSizePx: 40, lineHeight: 1.1, color: '#fff', highlightColor: '#ff0',
  strokeColor: '#000', strokeWidthPx: 3, shadow: false, align: 'center' as const,
};
const layer = (over: Partial<EditLayer>): EditLayer => ({
  id: 'l', kind: 'headline', startFrame: 0, endFrame: 75, box: { x: 0, y: 0, w: 720, h: 100 },
  background: { kind: 'solid', color: '#D0080C', box: { x: 0, y: 0, w: 720, h: 100 } }, style, text: 'HEADLINE', wordsPerPage: null, source: 'vision', ...over,
});
const region = { x: 0, y: 119, w: 336, h: 324 };
const seg = { startFrame: 25, endFrame: 175, region, fullFrame: false, faceInRegion: [{ atFrame: 25, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.9 };
const base = { width: 720, height: 1280, fps: 25, frameCount: 200, cells: [], overlaysOverFace: [], profile: null, trackBlockers: [], hookEndSec: 2 };

describe('mapa da edição: bloqueios', () => {
  it('sem trilha = no_face; legenda inteira dentro da região não bloqueia; metade dentro/metade fora = caption_straddles_face', () => {
    expect(swapBlockers({ ...base, faceTrack: [], layers: [] }).map((b) => b.reason)).toEqual(['no_face']);
    const insideCap = layer({ id: 'c', kind: 'caption', box: { x: 20, y: 300, w: 300, h: 60 }, startFrame: 0, endFrame: 200, text: null, wordsPerPage: 3, background: { kind: 'none', color: null, box: null } });
    expect(swapBlockers({ ...base, faceTrack: [seg], layers: [insideCap] })).toEqual([]);
    const straddle = { ...insideCap, box: { x: 200, y: 300, w: 400, h: 60 } };
    expect(swapBlockers({ ...base, faceTrack: [seg], layers: [straddle] })).toEqual([{ reason: 'caption_straddles_face', startSec: 1, endSec: 7 }]);
    // headline com caixa da visão cruzando a borda, mas fundo medido (faixa de cima) fora da região: não bloqueia
    const top = layer({ box: { x: 43, y: 48, w: 634, h: 86 }, background: { kind: 'solid', color: '#D0080C', box: { x: 0, y: 0, w: 720, h: 119 } } });
    expect(swapBlockers({ ...base, faceTrack: [seg], layers: [top] })).toEqual([]);
    expect(clampRect(top.box, top.background.box!)).toEqual({ x: 43, y: 48, w: 634, h: 71 });
  });

  it('overlay por cima do rosto e bloqueios da trilha entram; o gancho só bloqueia texto sem fundo', () => {
    // overlay sem caixa (triado pela ia) bloqueia quando cruza a trilha; fora da trilha, não
    const b = swapBlockers({ ...base, faceTrack: [seg], layers: [], trackBlockers: [{ reason: 'multiple_faces', startSec: 1, endSec: 2 }], overlaysOverFace: [{ startFrame: 151, endFrame: 303, description: 'Rating card slides over the lower half of the face' }] });
    expect(b.map((x) => x.reason)).toEqual(['multiple_faces', 'overlay_over_face']);
    expect(swapBlockers({ ...base, faceTrack: [seg], layers: [], overlaysOverFace: [{ startFrame: 180, endFrame: 200, description: 'sticker' }] })).toEqual([]);
  });

  it('overlay: split-screen/painel vizinho nunca bloqueia; com caixa só se cobre a caixa do ROSTO em ≥ 20 % dos frames; bloqueios iguais deduplicados', () => {
    const side = { startFrame: 0, endFrame: 200, description: 'split-screen panel on the right side' };
    const lost = [{ reason: 'low_confidence' as const, startSec: 0, endSec: 8 }];
    expect(swapBlockers({ ...base, faceTrack: [seg], layers: [], trackBlockers: lost, overlaysOverFace: [side, side] }).map((x) => x.reason)).toEqual(['low_confidence']);
    // rosto em x 100.8-235.2, y 183.8-345.8 (região x0 y119 336x324, caixa relativa 0.3/0.2/0.4/0.5)
    const onRegionOnly = { startFrame: 25, endFrame: 175, description: 'arrow', box: { x: 0, y: 380, w: 336, h: 50 } } as any;
    expect(overlayCoversFace(onRegionOnly, { fps: 25, faceTrack: [seg], trackBlockers: [] })).toBe(false);
    const onFace = { startFrame: 25, endFrame: 175, description: 'sticker', box: { x: 150, y: 200, w: 60, h: 60 } } as any;
    expect(overlayCoversFace(onFace, { fps: 25, faceTrack: [seg], trackBlockers: [] })).toBe(true);
    const brief = { ...onFace, startFrame: 0, endFrame: 200, box: onFace.box } as any; // 150/200 frames com rosto = 75 %
    expect(overlayCoversFace(brief, { fps: 25, faceTrack: [{ ...seg, startFrame: 170, endFrame: 175 }], trackBlockers: [] })).toBe(false);
    expect(dedupeBlockers([{ reason: 'no_face', startSec: null, endSec: null }, { reason: 'no_face', startSec: null, endSec: null }])).toHaveLength(1);
    expect(hookBlockers({ fps: 25, hookEndSec: 2, layers: [layer({})] })).toEqual([]);
    expect(hookBlockers({ fps: 25, hookEndSec: 2, layers: [layer({ background: { kind: 'none', color: null, box: null } })] })[0].reason).toBe('hook_text_over_video');
    expect(hookBlockers({ fps: 25, hookEndSec: 2, layers: [] })).toEqual([]); // sem texto no gancho: camada nova
    const m = buildEditMap({ ...base, faceTrack: [seg], layers: [layer({})] });
    expect(m.keepEdit).toEqual({ SWAP_AVATAR: { available: true, blockers: [] }, NEW_HOOKS: { available: true, blockers: [] } });
    expect(m.version).toBe(1);
  });
});

describe('trechos main / other_person / broll (podcast do Gusta)', () => {
  const main1 = { ...seg, startFrame: 0, endFrame: 300 };
  const guest = { ...seg, startFrame: 300, endFrame: 450, role: 'other_person' } as any;
  const main2 = { ...seg, startFrame: 450, endFrame: 825 };
  const broll = { ...seg, startFrame: 825, endFrame: 1225, region: { x: 0, y: 0, w: 720, h: 1280 }, fullFrame: true, role: 'broll' } as any;
  const track = [main1, guest, main2, broll];

  it('bloqueios fora dos trechos main não contam; os que cruzam são recortados ao trecho', () => {
    const cap = layer({ id: 'c', kind: 'caption', box: { x: 200, y: 300, w: 400, h: 60 }, startFrame: 825, endFrame: 1225, text: null, wordsPerPage: 3, background: { kind: 'none', color: null, box: null } });
    const b = swapBlockers({ ...base, faceTrack: track, layers: [cap], trackBlockers: [{ reason: 'low_confidence', startSec: 33, endSec: 49 }], overlaysOverFace: [{ startFrame: 900, endFrame: 1000, description: 'sticker' }] });
    expect(b).toEqual([]);
    const c = swapBlockers({ ...base, faceTrack: track, layers: [], trackBlockers: [{ reason: 'low_confidence', startSec: 30, endSec: 40 }] });
    expect(c).toEqual([{ reason: 'low_confidence', startSec: 30, endSec: 33 }]);
  });

  it('sem trecho main = no_face; take cobre do 1º ao último main (áudio contínuo); render só nos frames main', () => {
    expect(swapBlockers({ ...base, faceTrack: [guest, broll], layers: [] })).toEqual([{ reason: 'no_face', startSec: null, endSec: null }]);
    expect(faceWindowOf({ fps: 25, faceTrack: track })).toEqual({ startSec: 0, endSec: 33 });
    const m = buildEditMap({ ...base, frameCount: 1225, faceTrack: track, layers: [] });
    const r = remixKeepInput({
      renderId: 'r', editMap: m, baseVideoUrl: 'v', audioPassthroughUrl: 'v', words: [], hookEndSec: 2, fitCrop: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      swap: { clipUrl: 'c', clip: { w: 720, h: 720 }, clipFace: { x: 0, y: 0, w: 10, h: 10 }, takeSourceStartSec: 0 },
    });
    expect(r.overlays.map((o) => [o.startFrame, o.endFrame])).toEqual([[0, 300], [450, 825]]);
  });
});

describe('avatar principal', () => {
  it('trecho com rosto dentro do mainSpeaker vence; sem dica ou sem casamento = trilha intacta', () => {
    const cctv = { ...seg, startFrame: 0, endFrame: 25, region: { x: 0, y: 443, w: 336, h: 300 } };
    expect(pickMainSpeaker([cctv, seg], { box: { x: 0, y: 119, w: 336, h: 324 }, description: 'man talking' })).toEqual([seg]);
    expect(pickMainSpeaker([cctv, seg], null)).toHaveLength(2);
    expect(pickMainSpeaker([cctv, seg], { box: { x: 600, y: 0, w: 10, h: 10 }, description: 'x' })).toHaveLength(2);
    const m = buildEditMap({ ...base, faceTrack: [seg], layers: [], mainSpeaker: { box: region, description: 'd' }, otherFaces: [] });
    expect(m.mainSpeaker).toEqual({ box: region, description: 'd' });
  });
});

describe('plano por item (§13.3-13.5)', () => {
  const words = Array.from({ length: 16 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
  const sections = {
    hook: { status: 'ok', naReason: null, data: { endSec: 2, visual: '', onScreenText: 'H', spoken: '' } },
    structure: { status: 'ok', naReason: null, data: { blocks: [
      { label: 'hook', function: '', startSec: 0, endSec: 2, onScreen: '', speech: '' },
      { label: 'body', function: '', startSec: 2, endSec: 6, onScreen: '', speech: '' },
      { label: 'cta', function: '', startSec: 6, endSec: 8, onScreen: '', speech: '' },
    ] } },
  } as unknown as TeardownSections;
  const editMap = buildEditMap({ ...base, faceTrack: [seg], layers: [] });
  const snap: TeardownSnapshot = { sections, words, durationSec: 8, width: 720, height: 1280, editMap };
  const settings = { format: 'VERTICAL_9_16' as const, voiceId: null, voiceSource: 'CHAMPION_AUDIO' as const, engine: null, engineModel: null, edit: {} as any, keepEdit: true, hookMode: 'TEXT' as const, swapEngine: 'LIPSYNC' as const };
  const catalog = {} as any;

  it('janela do rosto = 1ª à última frame da trilha', () => {
    expect(faceWindowOf(editMap)).toEqual({ startSec: 1, endSec: 7 });
    expect(faceWindowOf({ ...editMap, faceTrack: [] })).toBeNull();
  });

  it('Trocar avatar mantendo a edição: take AUDIO_LIPSYNC 1-7 s, palavras relativas, fatias contíguas', () => {
    const p = planItem(catalog, 'SWAP_AVATAR', false, {}, snap, settings);
    expect(p.take).toMatchObject({ kind: 'AUDIO_LIPSYNC', sourceStartSec: 1, sourceEndSec: 7 });
    expect(p.take!.words![0]).toEqual({ word: 'w2', startSec: 0, endSec: 0.4 });
    expect(p.scenes.map((s) => [s.label, s.startSec, s.endSec, s.pipeline])).toEqual([
      ['hook', 0, 1, 'TAKE_SLICE'], ['body', 1, 5, 'TAKE_SLICE'], ['cta', 5, 6, 'TAKE_SLICE'],
    ]);
  });

  it('limpo com voz do catálogo = take TTS_LIPSYNC com a fala inteira; limpo com áudio = vídeo inteiro', () => {
    const tts = planItem(catalog, 'SWAP_AVATAR', false, {}, snap, { ...settings, keepEdit: false, voiceSource: 'CATALOG' });
    expect(tts.take).toMatchObject({ kind: 'TTS_LIPSYNC', speech: words.map((w) => w.word).join(' ') });
    const audio = planItem(catalog, 'SWAP_AVATAR', false, {}, snap, { ...settings, keepEdit: false });
    expect(audio.take).toMatchObject({ kind: 'AUDIO_LIPSYNC', sourceStartSec: 0, sourceEndSec: 8 });
  });

  it('gancho escrito = 1 SOURCE_CUT do campeão inteiro, sem take', () => {
    const p = planItem(catalog, 'NEW_HOOKS', false, {}, snap, settings);
    expect(p.take).toBeNull();
    expect(p.scenes).toHaveLength(1);
    expect(p.scenes[0]).toMatchObject({ pipeline: 'SOURCE_CUT', startSec: 0, endSec: 8, sourceStartSec: 0, sourceEndSec: 8 });
  });

  it('keepEditBlockers: primeiro tipo pedido indisponível; COPY_NEW não conta', () => {
    const ke = { SWAP_AVATAR: { available: false, blockers: [{ reason: 'no_face' as const, startSec: null, endSec: null }] }, NEW_HOOKS: { available: true, blockers: [] } };
    expect(keepEditBlockers(ke, ['NEW_HOOKS', 'COPY_NEW'])).toBeNull();
    expect(keepEditBlockers(ke, ['NEW_HOOKS', 'SWAP_AVATAR'])).toMatchObject({ kind: 'SWAP_AVATAR' });
  });
});

describe('take: teto, seed e render', () => {
  it('600 s: texto estimado ou janela do campeão acima do teto = 422 LIPSYNC_AUDIO_TOO_LONG', () => {
    expect(() => assertTakeLength({ kind: 'AUDIO_LIPSYNC', speech: null, sourceStartSec: 0, sourceEndSec: 600 })).not.toThrow();
    expect(() => assertTakeLength({ kind: 'AUDIO_LIPSYNC', speech: null, sourceStartSec: 0, sourceEndSec: 600.5 })).toThrow(
      expect.objectContaining({ code: 'LIPSYNC_AUDIO_TOO_LONG' }),
    );
    expect(() => assertTakeLength({ kind: 'TTS_LIPSYNC', speech: 'palavra '.repeat(2000), sourceStartSec: null, sourceEndSec: null })).toThrow(
      expect.objectContaining({ code: 'LIPSYNC_AUDIO_TOO_LONG' }),
    );
    expect(joinSpeech([' a ', '', 'b'])).toBe('a b');
    expect([takeSeed(1), takeSeed(2), takeSeed(3)]).toEqual([7, 8, 9]);
  });

  it('render: fatias do mesmo take viram 1 cena com palavras no tempo do take; outras cenas passam', () => {
    const sl = (i: number, a: number, b: number) => ({
      pipeline: 'TAKE_SLICE' as const, takeId: 't1', takeStartSec: a as any, takeEndSec: b as any, clipFileId: 'clip', startSec: a as any, endSec: b as any,
      words: [{ word: `x${i}`, startSec: 0.1, endSec: 0.3 }] as any,
    });
    const pieces = renderPieces([sl(0, 0, 2), sl(1, 2, 5), { ...sl(2, 0, 3), pipeline: 'SCENE_VIDEO', takeId: null, clipFileId: 'other' }]);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toMatchObject({ clipFileId: 'clip', fallbackSec: 5 });
    expect(pieces[0].words).toEqual([{ word: 'x0', startSec: 0.1, endSec: 0.3 }, { word: 'x1', startSec: 2.1, endSec: 2.3 }]);
    expect(pieces[1].clipFileId).toBe('other');
  });
});

describe('remix-keep input (§13.6)', () => {
  const words = [{ word: 'oi', startSec: 1.2, endSec: 1.5 }, { word: 'tchau', startSec: 6, endSec: 6.4 }];
  const cap = layer({ id: 'cap', kind: 'caption', box: { x: 20, y: 300, w: 300, h: 60 }, startFrame: 0, endFrame: 200, text: null, wordsPerPage: 3, background: { kind: 'none', color: null, box: null } });
  const out = layer({ id: 'top' });
  const editMap: EditMap = buildEditMap({ ...base, faceTrack: [{ ...seg, faceInRegion: [{ atFrame: 25, box: seg.faceInRegion[0].box }, { atFrame: 100, box: { x: 0.25, y: 0.1, w: 0.5, h: 0.6 } }] }], layers: [out, cap] });
  const fitCrop = jest.fn(() => ({ x: 1, y: 2, w: 3, h: 4 }));

  it('Trocar avatar: overlays por passo de escala na grade do campeão; só a camada de dentro da região é redesenhada', () => {
    const r = remixKeepInput({
      renderId: 'r', editMap, baseVideoUrl: 'v', audioPassthroughUrl: 'v', words, hookEndSec: 2, fitCrop,
      swap: { clipUrl: 'c', clip: { w: 720, h: 720 }, clipFace: { x: 200, y: 200, w: 200, h: 250 }, takeSourceStartSec: 1 },
    });
    expect(r).toMatchObject({ kind: 'remix-keep', templateId: 'remix-keep', canvas: { width: 720, height: 1280, fps: 25, frameCount: 200 } });
    expect(r.overlays.map((o) => [o.startFrame, o.endFrame, o.clipOffsetSec])).toEqual([[25, 100, 0], [100, 175, 3]]);
    expect(fitCrop).toHaveBeenCalledWith({ w: 720, h: 720 }, { x: 200, y: 200, w: 200, h: 250 }, { w: 336, h: 324 }, seg.faceInRegion[0].box);
    expect(r.textLayers).toHaveLength(1);
    expect(r.textLayers[0]).toMatchObject({ startFrame: 25, endFrame: 175, content: { kind: 'karaoke', words: [{ word: 'oi', startFrame: 30, endFrame: 38 }, { word: 'tchau', startFrame: 150, endFrame: 160 }] } });
  });

  it('gancho escrito: a camada do gancho com o texto novo no intervalo inteiro dela, sobre o fundo medido; sem overlay', () => {
    const r = remixKeepInput({ renderId: 'r', editMap, baseVideoUrl: 'v', audioPassthroughUrl: 'v', words, hookEndSec: 2, fitCrop, hookText: 'NEW HOOK' });
    expect(r.overlays).toEqual([]);
    expect(r.textLayers).toEqual([expect.objectContaining({ startFrame: 0, endFrame: 75, content: { kind: 'static', text: 'NEW HOOK' }, background: out.background })]);
    const none = remixKeepInput({ renderId: 'r', editMap: { ...editMap, layers: [] }, baseVideoUrl: 'v', audioPassthroughUrl: 'v', words, hookEndSec: 2, fitCrop, hookText: 'NEW' });
    expect(none.textLayers[0]).toMatchObject({ id: 'hook-new', startFrame: 0, endFrame: 50 });
    expect(wordsInFrames(words, 25, 0, 40)).toEqual([{ word: 'oi', startFrame: 30, endFrame: 38 }]);
  });
});
