import { IntegracaoError } from '../erros';
import type { ScriptBlockDraft } from '../contrato';
import { CatalogServiceImpl } from './catalog.service';

const catalog = new CatalogServiceImpl({ voiceSampleUrl: (id, lang) => `http://x/${id}?l=${lang}` });

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const blocks: ScriptBlockDraft[] = [
  { label: 'hook', startSec: 0, endSec: 3, speech: words(8), visualPrompt: 'SOLO SHOT a' },
  { label: 'problem', startSec: 3, endSec: 11, speech: words(20), visualPrompt: 'SOLO SHOT b' },
  { label: 'product', startSec: 11, endSec: 29, speech: words(46), visualPrompt: 'SOLO SHOT c' }, // 18 s > 15
];

describe('CatalogService.engines/voices', () => {
  it('lista os dois motores com ids opacos e limite por cena', () => {
    const e = catalog.engines();
    expect(e.map((x) => x.id)).toEqual(['SCENES', 'LIPSYNC']);
    expect(e[0].models.map((m) => m.id)).toEqual(['kling-3.0', 'seedance-2.0']);
    expect(e[0].models.every((m) => m.maxSceneSec === 15)).toBe(true);
    expect(e[1].models).toEqual([{ id: 'pruna-lipsync', label: 'Lipsync', maxSceneSec: 30 }]);
  });

  it('vozes filtradas por idioma, com gênero e amostra', () => {
    const v = catalog.voices('pt-BR');
    expect(v.length).toBe(17);
    expect(v.every((x) => x.language === 'pt-BR' && x.sampleUrl.includes('l=pt-BR'))).toBe(true);
    expect(v.find((x) => x.id === 'Deep_Voice_Man')?.gender).toBe('male');
    expect(v.filter((x) => x.gender === 'female').length).toBeGreaterThan(5);
    expect(catalog.voices().length).toBe(17 * 3);
  });
});

describe('CatalogService.splitScenes', () => {
  it('bloco acima do limite do modelo vira 2 cenas, sem perder palavra', () => {
    const s = catalog.splitScenes(blocks, 'SCENES', 'kling-3.0');
    expect(s.map((x) => [x.index, x.label, x.startSec, x.endSec])).toEqual([
      [0, 'hook', 0, 3],
      [1, 'problem', 3, 11],
      [2, 'product', 11, 20],
      [3, 'product', 20, 29],
    ]);
    expect(`${s[2].speech} ${s[3].speech}`).toBe(blocks[2].speech);
    expect(s[3].visualPrompt).toBe('SOLO SHOT c');
  });

  it('LIPSYNC: 1 clipe por bloco até 30 s; só divide bloco acima de 30 s (decisão F3)', () => {
    const s = catalog.splitScenes(blocks, 'LIPSYNC', 'pruna-lipsync');
    expect(s.map((x) => [x.index, x.label, x.startSec, x.endSec])).toEqual([[0, 'hook', 0, 3], [1, 'problem', 3, 11], [2, 'product', 11, 29]]);
    expect(s[2].speech).toBe(blocks[2].speech);
    const long = catalog.splitScenes([{ label: 'story', startSec: 0, endSec: 36, speech: words(90), visualPrompt: 'SOLO SHOT' }], 'LIPSYNC', 'pruna-lipsync');
    expect(long.map((x) => [x.startSec, x.endSec])).toEqual([[0, 18], [18, 36]]);
  });

  it('é determinístico', () => {
    expect(catalog.splitScenes(blocks, 'LIPSYNC', 'pruna-lipsync')).toEqual(catalog.splitScenes(blocks, 'LIPSYNC', 'pruna-lipsync'));
  });

  it('rejeita modelo do motor errado e bloco sem duração', () => {
    expect(() => catalog.splitScenes(blocks, 'LIPSYNC', 'kling-3.0')).toThrow(IntegracaoError);
    expect(() => catalog.splitScenes([{ ...blocks[0], endSec: 0 }], 'SCENES', 'kling-3.0')).toThrow(/non-positive/);
    expect(() => catalog.splitScenes([], 'SCENES', 'kling-3.0')).toThrow(IntegracaoError);
  });
});

describe('CatalogService.estimate (preço por unidade)', () => {
  it('Kling: segundos × US$ 0,168 (som ligado) + transcrição com timestamp', () => {
    const scenes = catalog.splitScenes(blocks, 'SCENES', 'kling-3.0'); // 3 + 8 + 9 + 9 = 29 s
    const r = catalog.estimate({ engine: 'SCENES', model: 'kling-3.0', scenes, format: 'VERTICAL_9_16' });
    expect(r.lines).toEqual([
      { kind: 'VIDEO', units: 29, unit: 'second', unitPriceUsd: 0.168, amountUsd: 4.872 },
      { kind: 'TRANSCRIBE', units: 29, unit: 'second', unitPriceUsd: 0.002, amountUsd: 0.058 },
    ]);
    expect(r.costUsd).toBe(4.93);
    expect(r.etaSec).toBe(90 + 12 * 9 + 20);
    expect(r.warnings).toEqual([]);
  });

  it('Seedance: mínimo de 4 s cobrado no gancho de 3 s (sem aviso: warnings só tem voice_gender_mismatch)', () => {
    const scenes = catalog.splitScenes(blocks, 'SCENES', 'seedance-2.0');
    const r = catalog.estimate({ engine: 'SCENES', model: 'seedance-2.0', scenes, format: 'SQUARE_1_1' });
    expect(r.lines[0]).toEqual({ kind: 'VIDEO', units: 30, unit: 'second', unitPriceUsd: 0.24, amountUsd: 7.2 });
    expect(r.warnings).toEqual([]);
  });

  it('Lipsync (§13.5): 1 take com o texto inteiro, um arredondamento só', () => {
    const scenes = catalog.splitScenes(blocks, 'LIPSYNC', 'pruna-lipsync');
    // take: 8 + 20 + 46 = 74 palavras / 2,6 = 28,5 s → 29 s (antes, por cena: 4 + 8 + 18 = 30 s)
    const chars = scenes.map((s) => s.speech).join(' ').length;
    const r = catalog.estimate({ engine: 'LIPSYNC', model: 'pruna-lipsync', scenes, format: 'VERTICAL_9_16', faceCount: 4 });
    expect(r.lines.map((l) => l.kind)).toEqual(['TTS', 'LIPSYNC', 'TRANSCRIBE', 'IMAGE']);
    expect(r.lines[0]).toMatchObject({ units: chars, unit: 'character', unitPriceUsd: 0.00006 });
    expect(r.lines[1]).toEqual({ kind: 'LIPSYNC', units: 29, unit: 'second', unitPriceUsd: 0.025, amountUsd: 0.725 });
    expect(r.lines[2]).toEqual({ kind: 'TRANSCRIBE', units: 29, unit: 'second', unitPriceUsd: 0.002, amountUsd: 0.058 });
    expect(r.lines[3]).toEqual({ kind: 'IMAGE', units: 4, unit: 'image', unitPriceUsd: 0.006, amountUsd: 0.024 });
    const sum = r.lines.reduce((a, l) => a + l.amountUsd, 0);
    expect(r.costUsd).toBeCloseTo(sum, 4);
  });

  it('cena curta no lipsync cobra o piso de 2 s', () => {
    const r = catalog.estimate({
      engine: 'LIPSYNC', model: 'pruna-lipsync', format: 'VERTICAL_9_16',
      scenes: [{ index: 0, label: 'hook', startSec: 0, endSec: 1, speech: 'Oi', visualPrompt: '' }],
    });
    expect(r.lines[1].units).toBe(2);
  });

  describe('voice_gender_mismatch (api.md §9)', () => {
    const scenes = [{ index: 0, label: 'hook', startSec: 0, endSec: 3, speech: words(8), visualPrompt: '' }];
    const lip = (voiceId?: string, faceDescription?: string) =>
      catalog.estimate({ engine: 'LIPSYNC', model: 'pruna-lipsync', format: 'VERTICAL_9_16', scenes, voiceId, faceDescription }).warnings;

    it('avisa quando voz e rosto têm gêneros diferentes e certos (en / pt / es)', () => {
      expect(lip('Deep_Voice_Man', 'A woman in her 30s, kitchen, natural light')).toEqual(['voice_gender_mismatch']);
      expect(lip('Calm_Woman', 'Homem de 40 anos com barba, camisa polo')).toEqual(['voice_gender_mismatch']);
      expect(lip('Casual_Guy', 'Una mujer joven sonriendo en la sala')).toEqual(['voice_gender_mismatch']);
    });

    it('não avisa quando bate, quando é ambíguo, sem descrição ou com voz neutra', () => {
      expect(lip('Calm_Woman', 'A woman in her 30s')).toEqual([]);
      expect(lip('Calm_Woman', 'A woman and her husband on the couch')).toEqual([]); // os dois gêneros: ambíguo
      expect(lip('Calm_Woman', 'A 30-year-old person, casual clothes')).toEqual([]); // sem gênero
      expect(lip('Calm_Woman', 'A human resources manager')).toEqual([]); // "human" não é "man"
      expect(lip('Calm_Woman')).toEqual([]);
      expect(lip('Friendly_Person', 'A man with a beard')).toEqual([]);
      expect(lip(undefined, 'A man with a beard')).toEqual([]);
    });

    it('só no LIPSYNC: no SCENES a voz é nativa do modelo', () => {
      const r = catalog.estimate({ engine: 'SCENES', model: 'kling-3.0', format: 'VERTICAL_9_16', scenes, voiceId: 'Deep_Voice_Man', faceDescription: 'A woman' });
      expect(r.warnings).toEqual([]);
    });
  });

  it('estimateFaces: US$ 0,006 por imagem (Higgsfield Soul V2 1080p 9:16)', () => {
    expect(catalog.estimateFaces(4)).toBe(0.024);
    expect(catalog.estimateFaces(0)).toBe(0);
  });
});
