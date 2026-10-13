// B6 (§13.15): regras puras do Trocar avatar com Kling/Seedance. Sem banco, sem provedor.
import type { EditLayer, EditMap } from '@maquina/contratos';
import { captionUnredrawable, mainSpans } from '../campeoes/mapa-edicao';
import { engineVoiceOf } from '../campeoes/champion-views';
import { mergeEngineWords, remixKeepInput, wordsInFrames } from '../edicao/remix-keep';
import { planItem, swapScenes } from '../variacoes/plano';
import { windowFrames } from './troca.service';
import { compactWindows, fittedWords, speechMatch, freshWindows, identityOk, swapProgress, swapStage, validateSwapSettings, type StoredWindow } from './regras';

const ok = { available: true, blockers: [] };
const seg = (startFrame: number, endFrame: number, role: 'main' | 'other_person' = 'main', region = { x: 0, y: 0, w: 720, h: 640 }) => ({
  startFrame, endFrame, region, fullFrame: false, faceInRegion: [{ atFrame: startFrame, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.9, role,
});
/** Podcast: main 0-100, convidada 100-150, main 150-250 (25 fps, 10 s). */
function podcast(over: Partial<EditMap> = {}): EditMap {
  return {
    version: 1, width: 720, height: 1280, fps: 25, frameCount: 250, cells: [],
    faceTrack: [seg(0, 60), seg(60, 100), seg(100, 150, 'other_person'), seg(150, 250)],
    timeline: [{ startFrame: 0, endFrame: 100, kind: 'main' }, { startFrame: 100, endFrame: 150, kind: 'other_person' }, { startFrame: 150, endFrame: 250, kind: 'main' }],
    layers: [], overlaysOverFace: [], profile: null, keepEdit: { SWAP_AVATAR: ok, NEW_HOOKS: ok }, ...over,
  };
}
const caption = (box: EditLayer['box'], startFrame = 0, endFrame = 250, kind: 'none' | 'solid' = 'none'): EditLayer => ({
  id: 'cap', kind: 'caption', startFrame, endFrame, box, background: { kind, color: kind === 'none' ? null : '#000', box: kind === 'none' ? null : box },
  style: {} as any, text: null, wordsPerPage: 3, source: 'vision',
});

describe('§13.15.1 combinações motor × voz × keepEdit', () => {
  const v = (swapEngine: any, voiceSource: any, keepEdit: boolean) => () => validateSwapSettings({ swapEngine, voiceSource, keepEdit });
  const rule = (f: () => void) => {
    try {
      f();
      return null;
    } catch (e: any) {
      return { status: e.getStatus(), ...e.details.fields[0] };
    }
  };
  it('válidas', () => {
    expect(rule(v('LIPSYNC', 'CHAMPION_AUDIO', true))).toBeNull();
    expect(rule(v('LIPSYNC', 'CATALOG', false))).toBeNull();
    expect(rule(v('KLING', 'CHAMPION_AUDIO', true))).toBeNull();
    expect(rule(v('SEEDANCE', 'ENGINE_VOICE', true))).toBeNull();
    expect(rule(v('KLING', 'ENGINE_VOICE', true))).toEqual({ status: 400, field: 'settings.voiceSource', rule: 'engine_voice_seedance_only' });
  });
  it('inválidas = 400 com campo e regra do contrato', () => {
    expect(rule(v('LIPSYNC', 'ENGINE_VOICE', true))).toEqual({ status: 400, field: 'settings.voiceSource', rule: 'engine_voice_needs_video_engine' });
    expect(rule(v('KLING', 'CHAMPION_AUDIO', false))).toEqual({ status: 400, field: 'settings.swapEngine', rule: 'video_engine_needs_keep_edit' });
    expect(rule(v('SEEDANCE', 'CATALOG', true))).toEqual({ status: 400, field: 'settings.voiceSource', rule: 'catalog_voice_not_in_keep_edit' });
  });
});

describe('§13.15.2 trechos', () => {
  it('trechos = spans main da timeline (a convidada no meio separa)', () => {
    expect(mainSpans(podcast())).toEqual([{ startFrame: 0, endFrame: 100 }, { startFrame: 150, endFrame: 250 }]);
  });
  it('mapa antigo sem timeline: trechos main da trilha unidos quando contíguos', () => {
    expect(mainSpans(podcast({ timeline: undefined }))).toEqual([{ startFrame: 0, endFrame: 100 }, { startFrame: 150, endFrame: 250 }]);
  });
  it('1 cena SWAP_VIDEO por trecho, tempos do campeão, palavras relativas ao trecho', () => {
    const words = [{ word: 'a', startSec: 1, endSec: 1.4 }, { word: 'guest', startSec: 4.5, endSec: 4.9 }, { word: 'b', startSec: 6.2, endSec: 6.6 }];
    const sc = swapScenes({ words }, podcast());
    expect(sc.map((s) => [s.label, s.startSec, s.endSec, s.pipeline, s.speech, s.frames])).toEqual([
      ['Trecho 1', 0, 4, 'SWAP_VIDEO', 'a', { startFrame: 0, endFrame: 100 }],
      ['Trecho 2', 6, 10, 'SWAP_VIDEO', 'b', { startFrame: 150, endFrame: 250 }],
    ]);
    expect(sc[1].words).toEqual([{ word: 'b', startSec: 0.2, endSec: 0.6 }]);
  });
  it('planItem: KLING + keepEdit = cenas SWAP_VIDEO sem take; LIPSYNC segue com o take', () => {
    const s = { sections: {} as any, words: [], durationSec: 10, width: 720, height: 1280, editMap: podcast() };
    const base = { format: 'VERTICAL_9_16', voiceId: null, voiceSource: 'CHAMPION_AUDIO', engine: null, engineModel: null, edit: {} as any, keepEdit: true, hookMode: 'TEXT' } as const;
    const k = planItem({} as any, 'SWAP_AVATAR', false, {}, s, { ...base, swapEngine: 'KLING' });
    expect(k.take).toBeNull();
    expect(k.scenes.every((x) => x.pipeline === 'SWAP_VIDEO')).toBe(true);
    const l = planItem({} as any, 'SWAP_AVATAR', false, {}, s, { ...base, swapEngine: 'LIPSYNC' });
    expect(l.take?.kind).toBe('AUDIO_LIPSYNC');
  });
});

describe('§13.15.1 engineVoice: caption_unredrawable', () => {
  it('legenda sem fundo fora da região num trecho main = bloqueio; dentro da região ou com fundo = ok', () => {
    expect(captionUnredrawable(podcast({ layers: [caption({ x: 0, y: 900, w: 720, h: 100 })] }))).toEqual([
      { reason: 'caption_unredrawable', startSec: 0, endSec: 4 }, { reason: 'caption_unredrawable', startSec: 6, endSec: 10 },
    ]);
    expect(captionUnredrawable(podcast({ layers: [caption({ x: 100, y: 500, w: 500, h: 80 })] }))).toEqual([]);
    expect(captionUnredrawable(podcast({ layers: [caption({ x: 0, y: 900, w: 720, h: 100 }, 0, 250, 'solid')] }))).toEqual([]);
    // só no trecho da convidada: não cruza main
    expect(captionUnredrawable(podcast({ layers: [caption({ x: 0, y: 900, w: 720, h: 100 }, 100, 150)] }))).toEqual([]);
  });
  it('engineVoice = bloqueios do SWAP_AVATAR + caption_unredrawable; campeão analisando = indisponível sem motivo', () => {
    const m = podcast({ layers: [caption({ x: 0, y: 900, w: 720, h: 100 }, 0, 50)] });
    expect(engineVoiceOf({ status: 'READY' }, m)).toEqual({ available: false, blockers: [{ reason: 'caption_unredrawable', startSec: 0, endSec: 2 }] });
    expect(engineVoiceOf({ status: 'READY' }, podcast())).toEqual({ available: true, blockers: [] });
    expect(engineVoiceOf({ status: 'ANALYZING' } as any, m)).toEqual({ available: false, blockers: [] });
    expect(engineVoiceOf({ status: 'READY' }, null).blockers[0].reason).toBe('not_mapped');
  });
});

describe('§13.15.3 etapa, progresso e identidade', () => {
  const ws = freshWindows([{ startSec: 0, endSec: 7, genSec: 8 }, { startSec: 7, endSec: 12, genSec: 6 }], '1080p', 2);
  it('janelas novas: 1ª do rosto, as seguintes do último frame; seed da tentativa', () => {
    expect(ws.map((w) => [w.startImage, w.status, w.seed, w.attempt])).toEqual([['FACE', 'QUEUED', 8, 2], ['PREVIOUS_LAST_FRAME', 'QUEUED', 8, 2]]);
  });
  it('etapa sai dos dados', () => {
    const st = (windows: StoredWindow[], raw: string | null, clip: string | null, status: any = 'GENERATING') =>
      swapStage({ status, windows, rawClipFileId: raw, clipFileId: clip, voiceSource: 'CHAMPION_AUDIO', fit: null });
    const ready = ws.map((w) => ({ ...w, status: 'READY' as const }));
    expect(st(ws, null, null)).toBe('windows');
    expect(st(ready, null, null)).toBe('joining');
    expect(st(ready, 'r', null)).toBe('lipsync');
    expect(st(ready, 'r', 'c')).toBe('checking');
    expect(st(ready, 'r', 'c', 'READY')).toBe('done');
    expect(swapStage({ status: 'GENERATING', windows: ready, rawClipFileId: 'r', clipFileId: null, voiceSource: 'ENGINE_VOICE', fit: null })).toBe('transcribing');
    expect(swapProgress({ status: 'GENERATING', windows: [ready[0], ws[1]], rawClipFileId: null, clipFileId: null, voiceSource: 'CHAMPION_AUDIO', fit: null })).toBe(33);
  });
  it('pedaço de cada janela em frames: fronteiras arredondadas, soma = trecho (a sobra da genSec fica fora)', () => {
    const w = [{ startSec: 0, endSec: 7.37 }, { startSec: 7.37, endSec: 16 }];
    expect([windowFrames(w, 0, 400, 25), windowFrames(w, 1, 400, 25)]).toEqual([184, 216]);
    expect(windowFrames([{ startSec: 0, endSec: 3 }], 0, 75, 25)).toBe(75);
  });
  it('SFace: mediana ≥ 0,363 e nenhuma amostra < 0,30', () => {
    expect(identityOk({ median: 0.5, min: 0.31 })).toBe(true);
    expect(identityOk({ median: 0.36, min: 0.35 })).toBe(false);
    expect(identityOk({ median: 0.6, min: 0.29 })).toBe(false);
  });
});

describe('legenda do remix-keep', () => {
  it('tira a pontuação do Whisper das pontas; palavra só de pontuação some', () => {
    const w = [{ word: '"Vida,', startSec: 0, endSec: 0.4 }, { word: "don't", startSec: 0.5, endSec: 0.9 }, { word: '—', startSec: 1, endSec: 1.1 }, { word: '50%.', startSec: 1.2, endSec: 1.5 }];
    expect(wordsInFrames(w, 25, 0, 100).map((x) => x.word)).toEqual(['Vida', "don't", '50%']);
  });
});

describe('§13.15.4 render: um clipe por trecho', () => {
  it('overlays apontam pro clipe da cena dona do trecho, offset relativo ao início do trecho; convidada fica como o original', () => {
    const fit = jest.fn(() => ({ x: 0, y: 0, w: 10, h: 10 }));
    const m = podcast({ faceTrack: [seg(0, 60), { ...seg(60, 100), faceInRegion: [{ atFrame: 60, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }, { atFrame: 80, box: { x: 0.2, y: 0.1, w: 0.6, h: 0.7 } }] }, seg(100, 150, 'other_person'), seg(150, 250)] });
    const part = (startFrame: number, endFrame: number, clipUrl: string) => ({ startFrame, endFrame, clipUrl, clip: { w: 1080, h: 1080 }, clipFace: { x: 1, y: 1, w: 1, h: 1 } });
    const r = remixKeepInput({
      renderId: 'r', editMap: m, baseVideoUrl: 'base', audioPassthroughUrl: 'base', words: [], hookEndSec: 2, fitCrop: fit,
      swapSpans: [part(0, 100, 'c1'), part(150, 250, 'c2')],
    });
    expect(r.overlays.map((o) => [o.startFrame, o.endFrame, o.clipUrl, o.clipOffsetSec])).toEqual([
      [0, 60, 'c1', 0], [60, 80, 'c1', 2.4], [80, 100, 'c1', 3.2], [150, 250, 'c2', 0],
    ]);
    expect(r.audioPassthroughUrl).toBe('base');
  });
});

describe('§13.15 (B) voz do motor', () => {
  it('speechMatch: maior subsequência comum, normalizada (acento, caixa, pontuação)', () => {
    expect(speechMatch(['Olá', 'você', 'aí'], ['ola,', 'VOCE', 'ai!'])).toBe(1);
    expect(speechMatch(['a', 'b', 'c', 'd'], ['a', 'banana', 'c', 'banana'])).toBe(0.5);
    expect(speechMatch([], ['x'])).toBe(1);
  });
  it('fittedWords: (t − corte) × fator, presas ao trecho', () => {
    expect(fittedWords([{ word: 'a', startSec: 0.5, endSec: 1 }, { word: 'b', startSec: 9, endSec: 9.6 }], 0.3, 1.05, 9)).toEqual([
      { word: 'a', startSec: 0.21, endSec: 0.735 }, { word: 'b', startSec: 9 * 0 + 9, endSec: 9 },
    ].filter((w) => w.startSec < 9));
  });
  it('compactWindows: tira a sobra da genSec das janelas do meio, palavras no tempo novo', () => {
    const heard = [{ word: 'a', startSec: 0.3, endSec: 0.6 }, { word: 'b', startSec: 4, endSec: 4.4 }, { word: 'c', startSec: 10.3, endSec: 10.6 }];
    const c = compactWindows(heard, [10, 5]);
    expect(c.segments).toEqual([{ startSec: 0, endSec: 4.55 }, { startSec: 10, endSec: 15 }]);
    expect(c.words.map((w) => [w.word, w.startSec])).toEqual([['a', 0.3], ['b', 4], ['c', 4.85]]);
    expect(c.durationSec).toBe(9.55);
  });
  it('legenda mesclada: teardown fora dos trechos, transcrição dentro (no tempo do campeão)', () => {
    const base = [{ word: 'x', startSec: 0.1, endSec: 0.3 }, { word: 'guest', startSec: 4.2, endSec: 4.5 }, { word: 'y', startSec: 7, endSec: 7.3 }];
    const w = mergeEngineWords(base, [{ startFrame: 0, endFrame: 100, words: [{ word: 'novo', startSec: 0.5, endSec: 0.8 }] }, { startFrame: 150, endFrame: 250, words: [] }], 25);
    expect(w.map((x) => [x.word, x.startSec])).toEqual([['novo', 0.5], ['guest', 4.2]]);
  });
  it('remix-keep (B): audioSplice no input e a legenda inteira redesenhada uma vez', () => {
    const m = podcast({ layers: [caption({ x: 0, y: 900, w: 720, h: 100 }, 0, 250, 'solid')] });
    const part = (startFrame: number, endFrame: number, clipUrl: string) => ({ startFrame, endFrame, clipUrl, clip: { w: 10, h: 10 }, clipFace: { x: 1, y: 1, w: 1, h: 1 } });
    const audioSplice = { fadeMs: 10, spans: [{ startFrame: 0, endFrame: 100, url: 'c1' }, { startFrame: 150, endFrame: 250, url: 'c2' }] };
    const r = remixKeepInput({
      renderId: 'r', editMap: m, baseVideoUrl: 'b', audioPassthroughUrl: 'b', hookEndSec: 2, fitCrop: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      words: [{ word: 'a,', startSec: 0.2, endSec: 0.5 }, { word: 'z', startSec: 9, endSec: 9.3 }], swapSpans: [part(0, 100, 'c1'), part(150, 250, 'c2')], engineVoice: { audioSplice },
    });
    expect(r.audioSplice).toEqual(audioSplice);
    expect(r.textLayers).toHaveLength(1);
    expect(r.textLayers[0]).toMatchObject({ startFrame: 0, endFrame: 250, content: { kind: 'karaoke', words: [{ word: 'a', startFrame: 5 }, { word: 'z', startFrame: 225 }] } });
  });
});
