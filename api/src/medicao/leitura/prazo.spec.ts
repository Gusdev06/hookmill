// F3 do QA 01/11 (a leitura prendia a API por 9-15 min numa máquina carregada): prazo por etapa, teto de processos
// ffmpeg da leitura e presença de todas as camadas numa decodificação só.
import type { EditLayer } from '@maquina/contratos';
import { comPrazo, PrazoEsgotado, run } from '../ffmpeg';
import type { MediaAnalysisService } from '../contrato';
import { refinar } from './etapas';

const FF = process.env.FFMPEG_PATH || 'ffmpeg';
/** ffmpeg que dura `sec` de verdade (-re: lê a fonte em tempo real). */
const lento = (sec: number) => run(FF, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `color=c=black:s=32x32:r=10:d=${sec}`, '-f', 'null', '-']);

describe('comPrazo (ffmpeg.ts)', () => {
  it('prazo estourado mata o ffmpeg da etapa, rejeita com PrazoEsgotado e não deixa subir outro', async () => {
    const t0 = Date.now();
    let depois: Promise<unknown> | null = null;
    await expect(comPrazo('teste', 400, async () => {
      await lento(30).catch(() => undefined); // morto no estouro: não espera os 30 s
      depois = lento(1);                       // já estourado: nem sobe
      return depois;
    })).rejects.toBeInstanceOf(PrazoEsgotado);
    expect(Date.now() - t0).toBeLessThan(5_000);
    await expect(depois).rejects.toBeInstanceOf(PrazoEsgotado);
  });

  it('no máximo LEITURA_FFMPEG_MAX processos ao mesmo tempo, somando etapas paralelas', async () => {
    const antes = process.env.LEITURA_FFMPEG_MAX;
    process.env.LEITURA_FFMPEG_MAX = '2';
    try {
      const t0 = Date.now();
      // 4 processos de ~0,6 s em 2 etapas paralelas: com teto 2 levam 2 rodadas (≥ 1,2 s); sem teto, 1 (~0,6 s)
      await Promise.all([
        comPrazo('a', 30_000, () => Promise.all([lento(0.6), lento(0.6)])),
        comPrazo('b', 30_000, () => Promise.all([lento(0.6), lento(0.6)])),
      ]);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(1_150);
    } finally {
      if (antes === undefined) delete process.env.LEITURA_FFMPEG_MAX; else process.env.LEITURA_FFMPEG_MAX = antes;
    }
  });

  it('fora de uma etapa não há fila nem prazo (render, prévia)', async () => {
    const t0 = Date.now();
    await Promise.all([lento(0.6), lento(0.6), lento(0.6), lento(0.6)]);
    expect(Date.now() - t0).toBeLessThan(1_150);
  });
});

describe('refinar (etapas.ts)', () => {
  const box = { x: 0, y: 0, w: 720, h: 120 };
  const camada = (id: string, extra: Partial<EditLayer> = {}): EditLayer => ({
    id, kind: 'text', startFrame: 0, endFrame: 300, box,
    background: { kind: 'solid', color: '#D40F0F', box: { ...box } },
    style: { fontId: 'inter-800', uppercase: true, fontSizePx: 40, lineHeight: 1.15, color: '#FFFFFF', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
    text: 'X', wordsPerPage: null, source: 'vision', ...extra,
  } as EditLayer);
  const entrada = (layers: EditLayer[]) => ({ layers, fps: 30, frameCount: 300, words: [] });

  it('presença de todas as camadas numa chamada só (layersPresence), erro de uma não leva as outras', async () => {
    const layersPresence = jest.fn(async (_v: string, items: unknown[]) => items.map((_, i) => (i === 1 ? new Error('ref além do fim') : { startFrame: 30, endFrame: 90 })));
    const layerPresence = jest.fn();
    const media = { solidBackground: async () => null, layersPresence, layerPresence } as unknown as MediaAnalysisService;
    const avisos: string[] = [];
    const out = await refinar(media, 'v.mp4', entrada([camada('a'), camada('b'), camada('c', { background: { kind: 'none', color: null, box: null } })]), (m) => avisos.push(m));
    expect(layersPresence).toHaveBeenCalledTimes(1);
    expect(layersPresence.mock.calls[0][1]).toHaveLength(2);
    expect(layerPresence).not.toHaveBeenCalled();
    expect(out.map((l) => [l.id, l.startFrame, l.endFrame, l.source])).toEqual([['a', 30, 90, 'vision+pixel'], ['b', 0, 300, 'vision'], ['c', 0, 300, 'vision']]);
    expect(avisos).toEqual(['refino da camada b falhou: ref além do fim']);
  });

  it('sem layersPresence: caixa a caixa (adaptadores antigos)', async () => {
    const layerPresence = jest.fn(async () => ({ startFrame: 10, endFrame: 20 }));
    const media = { solidBackground: async () => null, layerPresence } as unknown as MediaAnalysisService;
    const out = await refinar(media, 'v.mp4', entrada([camada('a'), camada('b')]));
    expect(layerPresence).toHaveBeenCalledTimes(2);
    expect(out.map((l) => [l.startFrame, l.endFrame])).toEqual([[10, 20], [10, 20]]);
  });

  it('prazo estourado: devolve as camadas da visão com aviso (não trava a análise)', async () => {
    const antes = process.env.LEITURA_PRAZO_FATOR;
    process.env.LEITURA_PRAZO_FATOR = '0.01'; // refinar de 10 s = 0,35 s
    try {
      const media = {
        solidBackground: async () => { await lento(30); return null; },
        layerPresence: async () => ({ startFrame: 1, endFrame: 2 }),
      } as unknown as MediaAnalysisService;
      const avisos: string[] = [];
      const ls = [camada('a'), camada('b')];
      const t0 = Date.now();
      const out = await refinar(media, 'v.mp4', entrada(ls), (m) => avisos.push(m));
      expect(Date.now() - t0).toBeLessThan(8_000);
      expect(out).toEqual(ls);
      expect(avisos.some((m) => m.includes('prazo') && m.includes('visão'))).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.LEITURA_PRAZO_FATOR; else process.env.LEITURA_PRAZO_FATOR = antes;
    }
  });
});
