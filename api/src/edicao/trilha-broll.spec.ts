// Trilha de b-roll (Gusta 25/10): a fala em trechos de 2-5 s, a trilha cobre a peça toda, `none` estende o vizinho.
import type { BrollProvenance } from '@maquina/contratos';
import { FakeBrollService } from '../integracoes/broll';
import type { BrollPick } from '../integracoes/contrato';
import { cortarFala, montarTrilha, proveniencias, type TrilhaDoLote } from './trilha-broll';

const w = (word: string, startSec: number, endSec: number) => ({ word, startSec, endSec });
// 2 frases com pausa; uma fala corrida longa sem pausa; silêncio no fim
const FALA = [
  w('Você', 0.1, 0.4), w('dorme', 0.45, 0.8), w('mal?', 0.85, 1.3),
  w('Eu', 1.8, 2.0), w('também', 2.05, 2.5), w('dormia.', 2.55, 3.1),
  ...Array.from({ length: 24 }, (_, k) => w(`p${k}`, 3.5 + k * 0.3, 3.5 + k * 0.3 + 0.25)), // 3,5-10,7 s corrido
];

describe('cortarFala', () => {
  it('trechos contíguos de 2-5 s cobrindo a janela, cortes nas pausas/fim de frase', () => {
    const t = cortarFala(FALA, { startSec: 0, endSec: 14 });
    expect(t[0].startSec).toBe(0);
    expect(t[t.length - 1].endSec).toBe(14);
    for (let k = 1; k < t.length; k++) expect(t[k].startSec).toBe(t[k - 1].endSec);
    for (const s of t) {
      expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(s.endSec - s.startSec).toBeLessThanOrEqual(5 + 1e-6);
    }
    expect(t[0].text).toBe('Você dorme mal? Eu também dormia.'); // 1ª pausa com < 2 s não corta; o fim de frase com ≥ 2 s sim
    expect(t[0].endSec).toBeCloseTo(3.3, 1);
    expect(t.map((s) => s.index)).toEqual(t.map((_, k) => k));
  });
  it('sem fala = blocos de 4 s; sobra curta junta no anterior; janela vazia = nada', () => {
    expect(cortarFala([], { startSec: 0, endSec: 9 }).map((s) => [s.startSec, s.endSec])).toEqual([[0, 4], [4, 9]]);
    expect(cortarFala([], { startSec: 0, endSec: 0 })).toEqual([]);
  });
});

const prov = (n: number): BrollProvenance => ({ provider: 'pexels', sourceUrl: `https://pexels.com/v/${n}`, creator: 'Ana', license: 'Pexels License', licenseCommercialOk: true, startSec: 0, endSec: 4 });
const clip = (n: number, alternatives?: BrollPick[]): BrollPick & { alternatives?: BrollPick[] } => ({ candidateId: `c${n}`, fileUrl: `https://st/${n}.mp4`, srcStartSec: 0, srcEndSec: 4, provenance: prov(n), reason: 'r', ...(alternatives && { alternatives }) });
const NONE = { none: true as const, fallbackSubject: 'x' };
const trilha = (picks: TrilhaDoLote['picks']): TrilhaDoLote => ({
  version: 1, createdAt: '', language: 'pt', durationSec: 16, costUsd: 0,
  segments: [0, 4, 8, 12].map((s, index) => ({ index, startSec: s, endSec: s + 4, text: `t${index}` })), picks,
});

describe('montarTrilha', () => {
  it('cobre 0 → duração sem buraco; `none` estende o vizinho; nunca o mesmo vídeo seguido', () => {
    const t = montarTrilha(trilha([NONE, clip(1), NONE, clip(3)]))!;
    expect(t.kind).toBe('broll_track');
    expect(t.clips.map((c) => [c.fromSec, c.toSec, c.fileUrl, c.segmentText])).toEqual([[0, 12, 'https://st/1.mp4', 't0 t1 t2'], [12, 16, 'https://st/3.mp4', 't3']]);
    const u = montarTrilha(trilha([clip(1), clip(2), NONE, clip(3)]))!;
    expect(u.clips.map((c) => [c.fromSec, c.toSec, c.fileUrl])).toEqual([[0, 4, 'https://st/1.mp4'], [4, 12, 'https://st/2.mp4'], [12, 16, 'https://st/3.mp4']]);
    expect(montarTrilha(trilha([NONE, NONE, NONE, NONE]))).toBeNull();
  });
  it('proveniência de cada clipe (sem repetir) e da imagem gerada', () => {
    const gen = { ...clip(9), provenance: { provider: 'generated', model: 'gpt-image-2', prompt: 'p', subject: 'parent at night', licenseCommercialOk: true } as unknown as BrollProvenance };
    const t = montarTrilha(trilha([clip(1), gen, clip(1), clip(2)]))!;
    expect(proveniencias(t).map((p) => p.provider === 'generated' ? `gen:${p.subject}` : p.sourceUrl)).toEqual(['https://pexels.com/v/1', 'gen:parent at night', 'https://pexels.com/v/2']);
    expect(proveniencias({ kind: 'champion_segment', startSec: 1, endSec: 4 })).toEqual([]);
  });
  it('variantes (rodízio da ia, variantPicks): 3 trilhas diferentes, mesma sincronia', () => {
    const t = trilha([clip(1, [clip(11), clip(21)]), clip(2, [clip(12), clip(22)]), clip(3, [clip(13), clip(23)]), clip(4, [clip(14), clip(24)])]);
    const v = (n: number) => montarTrilha(t, n)!.clips.map((c) => [c.fromSec, c.toSec, c.fileUrl.replace('https://st/', '')]);
    expect(v(0).map((x) => x[2])).toEqual(['1.mp4', '2.mp4', '3.mp4', '4.mp4']);
    expect(v(1).map((x) => x[2])).toEqual(['11.mp4', '12.mp4', '13.mp4', '14.mp4']);
    expect(v(2).map((x) => x[2])).toEqual(['21.mp4', '22.mp4', '23.mp4', '24.mp4']);
    expect(v(1).map((x) => [x[0], x[1]])).toEqual(v(0).map((x) => [x[0], x[1]]));
  });
});

describe('com o fake da ia (FakeBrollService.searchTrack)', () => {
  it('3 variantes diferentes da MESMA busca, sem vídeo repetido seguido em nenhuma', async () => {
    const fake = new FakeBrollService({ record: async () => undefined } as never, { publicApiUrl: 'http://x' });
    const segments = cortarFala(FALA, { startSec: 0, endSec: 14 });
    const r = await fake.searchTrack({ workspaceId: 'w', batchId: 'b', language: 'pt', segments: segments.map(({ startSec, endSec, text }) => ({ startSec, endSec, text })) });
    const t: TrilhaDoLote = { version: 1, createdAt: '', language: 'pt', durationSec: 14, segments, picks: r.picks, costUsd: 0 };
    const trilhas = [0, 1, 2].map((v) => montarTrilha(t, v)!);
    const urls = trilhas.map((x) => x.clips.map((c) => (c.provenance as BrollProvenance).sourceUrl).join('|'));
    expect(new Set(urls).size).toBe(3);
    for (const x of trilhas) {
      expect(x.clips[0].fromSec).toBe(0);
      expect(x.clips[x.clips.length - 1].toSec).toBe(14);
      for (let k = 1; k < x.clips.length; k++) expect((x.clips[k].provenance as BrollProvenance).sourceUrl).not.toBe((x.clips[k - 1].provenance as BrollProvenance).sourceUrl);
    }
  });
});
