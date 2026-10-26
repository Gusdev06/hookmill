// 2ª fonte das molduras de 2 fontes (Gusta 25/10): Pexels pela ia › imagem gerada › trecho do campeão que nunca repete o de cima.
import { IntegracaoError } from '../integracoes/erros';
import { PROVEDORES_PADRAO, SegundaFonteService, type BrollServicePort, distanciaMinima, falaDe, semRepetirDentro, trechoSemRepetir, type BlocoDaFala } from './segunda-fonte';

const BLOCKS: BlocoDaFala[] = [
  { label: 'Hook', fn: 'hook', startSec: 0, endSec: 3 },
  { label: 'Problem', fn: 'problem', startSec: 3, endSec: 12 },
  { label: 'Proof', fn: 'proof', startSec: 12, endSec: 24 },
  { label: 'CTA', fn: 'cta', startSec: 24, endSec: 30 },
];
const words = Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
const entrada = { workspaceId: 'w', variationBatchId: 'b', template: 'split_stack' as const, language: 'en', durationSec: 30, blocks: BLOCKS, words, editMap: null };

describe('trecho do campeão sem repetir o de cima', () => {
  it('distância mínima em todas as voltas do loop', () => {
    expect(distanciaMinima(0, 5, 30)).toBe(0); // começa no 0: na 1ª volta é o mesmo quadro
    expect(distanciaMinima(12, 6, 30)).toBe(0); // 12 = 2 × 6: na 3ª volta coincide
    expect(distanciaMinima(13, 8, 30)).toBe(3);
  });
  it('bloco de prova, ≥ 3 s, ≥ 2 s de distância sempre; nada serve = null', () => {
    const t = trechoSemRepetir({ durationSec: 30, blocks: BLOCKS })!;
    expect(t.bloco).toBe('Proof (proof)');
    expect(t.endSec - t.startSec).toBeGreaterThanOrEqual(3);
    expect(t.startSec).toBeGreaterThanOrEqual(12);
    expect(distanciaMinima(t.startSec, t.endSec - t.startSec, 30)).toBeGreaterThanOrEqual(2);
    expect(trechoSemRepetir({ durationSec: 30, blocks: BLOCKS.filter((b) => b.fn !== 'proof' && b.fn !== 'problem') })).toBeNull();
    expect(trechoSemRepetir({ durationSec: 30, blocks: BLOCKS, comRosto: true, rostos: [] })).toBeNull();
    expect(semRepetirDentro({ startSec: 0, endSec: 2 }, 30)).toBeNull();
    expect(falaDe(words, { startSec: 1, endSec: 2 })).toBe('w2 w3');
  });
});

describe('ordem da 2ª fonte', () => {
  const prov = { provider: 'pexels' as const, sourceUrl: 'https://pexels.com/v/1', creator: 'Ana', license: 'Pexels License', licenseCommercialOk: true, startSec: 0, endSec: 6 };
  const cand = (candidateId: string, provider: 'pexels' | 'youtube' = 'pexels') =>
    ({ candidateId, provenance: { ...prov, provider, licenseCommercialOk: provider === 'pexels' }, posterUrl: '', previewUrl: null, durationSec: 6, query: candidateId });
  const noMatch = () => Object.assign(new IntegracaoError('BROLL_NO_MATCH' as never, 'none'), { details: { fallbackSubject: 'tired parent at night', costUsd: 0.01 } });

  it('1. Pexels pela ia: o 1º que baixa; só provedor ligado; oferta e notes vão na busca', async () => {
    const calls: unknown[] = [];
    const broll: BrollServicePort = {
      search: async (i) => (calls.push(i), { costUsd: 0.013, candidates: [cand('yt', 'youtube'), cand('p1'), cand('p2')] }),
      fetch: async ({ candidateId }) => { if (candidateId === 'p1') throw new Error('404'); return { fileUrl: `https://st/${candidateId}.mp4`, provenance: prov }; },
    };
    const r = await new SegundaFonteService(broll).resolver({ ...entrada, offer: { name: 'Sleepio' }, notes: '[mock:broll-fail]' });
    expect(r).toMatchObject({ second: { kind: 'stock_broll', fileUrl: 'https://st/p2.mp4', provenance: prov }, costUsd: 0.013 });
    expect(calls[0]).toMatchObject({ providers: PROVEDORES_PADRAO, minSec: 3, language: 'en', offer: { name: 'Sleepio' }, notes: '[mock:broll-fail]' });
    expect(PROVEDORES_PADRAO).toEqual(['pexels']); // D15: redes sociais desligadas
  });
  it('2. BROLL_NO_MATCH → imagem gerada sobre o fallbackSubject; 3. trecho do campeão; sem nada = null', async () => {
    const gerou: string[] = [];
    const semClipe: BrollServicePort = {
      search: async () => { throw noMatch(); },
      fetch: async () => { throw new Error('x'); },
      fallbackImage: async ({ subject }) => (gerou.push(subject), { fileUrl: 'https://st/img.png', prompt: 'p', model: 'gpt-image-2', costUsd: 0.22 }),
    };
    const img = await new SegundaFonteService(semClipe).resolver(entrada);
    expect(img).toMatchObject({ second: { kind: 'generated_image', fileUrl: 'https://st/img.png', subject: 'tired parent at night' }, nota: 'imagem gerada: tired parent at night', costUsd: 0.23 });
    expect(gerou).toEqual(['tired parent at night']);
    const semImagem = { ...semClipe, fallbackImage: async () => { throw new Error('wavespeed down'); } };
    expect((await new SegundaFonteService(semImagem).resolver(entrada))?.second.kind).toBe('champion_segment');
    expect((await new SegundaFonteService(null).resolver(entrada))?.second.kind).toBe('champion_segment');
    expect(await new SegundaFonteService(null).resolver({ ...entrada, blocks: [BLOCKS[0], BLOCKS[3]] })).toBeNull();
  });

  it('trilha por LOTE: 1 searchTrack, gravada e reaproveitada; `none` vira imagem pelo teto (máx. 2); sem trilha = cadeia de antes', async () => {
    const gravadas: unknown[] = [];
    let salva: any = null;
    const tetos: number[] = [];
    const store = {
      carregar: async () => salva, gravar: async (_b: string, t: unknown) => { salva = t; gravadas.push(t); },
      teto: async (_w: string, usd: number) => { tetos.push(usd); },
    };
    let buscas = 0;
    const port: BrollServicePort = {
      search: async () => ({ candidates: [], costUsd: 0 }), fetch: async () => { throw new Error('x'); },
      fallbackImage: async ({ subject }) => ({ fileUrl: `https://st/${subject}.png`, prompt: 'p', model: 'gpt-image-2', costUsd: 0.22 }),
      searchTrack: async (i) => (buscas++, {
        costUsd: 0.05,
        picks: i.segments.map((_, k) => (k % 2 ? { none: true as const, fallbackSubject: `s${k}` } : { candidateId: `c${k}`, fileUrl: `https://st/c${k}.mp4`, srcStartSec: 0, srcEndSec: 4, provenance: prov, reason: 'r' })),
      }),
    };
    const svc = new SegundaFonteService(port, store);
    const [a, b] = await Promise.all([svc.resolver(entrada), svc.resolver({ ...entrada, template: 'gossip_pink' })]);
    expect(buscas).toBe(1); // as duas molduras do lote dividem a mesma busca
    expect(gravadas).toHaveLength(1);
    expect(a?.second.kind).toBe('broll_track');
    expect(b?.second).toEqual(a?.second);
    const t = a!.second as { clips: { fromSec: number; toSec: number; provenance: { provider: string } }[] };
    expect(t.clips[0].fromSec).toBe(0);
    expect(t.clips[t.clips.length - 1].toSec).toBe(30);
    expect(t.clips.filter((c) => c.provenance.provider === 'generated')).toHaveLength(2); // IMAGENS_POR_TRILHA
    expect(tetos).toEqual([0.22, 0.22]);
    expect(salva.costUsd).toBe(0.49);
    await svc.resolver(entrada); // retry: reaproveita a gravada
    expect(buscas).toBe(1);
    const falha = new SegundaFonteService({ ...port, searchTrack: async () => { throw new Error('pexels down'); } }, { ...store, carregar: async () => null });
    expect((await falha.resolver(entrada))?.second.kind).toBe('champion_segment');
  });

  it('bug 429: a trilha da variante vira 1 arquivo (store.juntar); falhou ao juntar = cadeia de antes, nunca N arquivos', async () => {
    let salva: any = null;
    const juntadas: number[] = [];
    const store = {
      carregar: async () => salva, gravar: async (_b: string, t: unknown) => { salva = t; }, teto: async () => undefined,
      variante: async () => 1,
      juntar: async ({ variante, track }: { variante: number; track: any }) => (juntadas.push(variante), { kind: 'broll_track' as const, clips: track.clips.map((c: any) => ({ ...c, fileUrl: 'https://st/trilha-v1.mp4' })) }),
    };
    const port: BrollServicePort = {
      search: async () => ({ candidates: [], costUsd: 0 }), fetch: async () => { throw new Error('x'); },
      searchTrack: async (i) => ({ costUsd: 0, picks: i.segments.map((_, k) => ({ candidateId: `c${k}`, fileUrl: `https://st/c${k}.mp4`, srcStartSec: 0, srcEndSec: 4, provenance: { ...prov, sourceUrl: `https://pexels.com/v/${k}` }, reason: 'r' })) }),
    };
    const r = await new SegundaFonteService(port, store).resolver(entrada);
    expect(juntadas).toEqual([1]);
    expect(r).toMatchObject({ variante: 1 });
    const clips = (r!.second as { clips: { fileUrl: string; provenance: { sourceUrl: string } }[] }).clips;
    expect(new Set(clips.map((c) => c.fileUrl))).toEqual(new Set(['https://st/trilha-v1.mp4']));
    expect(new Set(clips.map((c) => c.provenance.sourceUrl)).size).toBe(clips.length); // proveniência de cada clipe original
    const quebra = new SegundaFonteService(port, { ...store, juntar: async () => { throw new Error('ffmpeg'); } });
    expect((await quebra.resolver(entrada))?.second.kind).toBe('champion_segment');
  });
});
