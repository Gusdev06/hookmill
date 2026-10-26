// Trilha de b-roll (25/10): 1 chamada de buscas pra todos os trechos, Pexels dedup + teto por lote, folhas por vídeo
// reaproveitadas, escolha em lotes, sem repetir clipe em seguida, cada vídeo baixado 1 vez. Nada de rede.
import { writeFileSync } from 'node:fs';
import type { BrollSegment } from '../contrato';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from '../claude/transporte';
import { schemaStats } from '../claude/schema-stats';
import { MemoryCostStore } from '../store/memoria.store';
import { PexelsBrollService, type BrollSink } from './broll.service';
import { FakeBrollService } from './fake-broll.service';
import type { Ffmpeg } from './folha';
import { PexelsClient, type PexelsVideo } from './pexels';
import { TRACK_LIMITS, TRACK_PICK_SCHEMA, TRACK_QUERY_SCHEMA, isNone, noConsecutiveRepeats, parseTrackQueries, trackClips, variantPicks, type BrollPickAlt } from './trilha';

const vid = (id: number, duration = 12): PexelsVideo => ({
  id, width: 1080, height: 1920, duration, url: `https://www.pexels.com/video/v-${id}/`, image: `https://img/${id}.jpg`,
  user: { id: 1, name: `Creator ${id}`, url: '' },
  video_files: [
    { id: id * 10, quality: 'sd', file_type: 'video/mp4', width: 360, height: 640, link: `https://videos.pexels.com/${id}/sd.mp4` },
    { id: id * 10 + 1, quality: 'hd', file_type: 'video/mp4', width: 1080, height: 1920, link: `https://videos.pexels.com/${id}/hd.mp4` },
  ],
});
/** cada busca devolve 3 vídeos derivados do texto (mesma busca = mesmos vídeos) */
const idsOf = (q: string) => { const h = [...q].reduce((a, c) => a + c.charCodeAt(0), 0); return [h % 50 + 1, (h + 7) % 50 + 1, (h + 13) % 50 + 1]; };
function pexelsFetch() {
  const calls: string[] = [];
  const f = (async (url: string) => {
    const u = String(url);
    calls.push(u);
    const headers = { 'content-type': 'application/json', 'x-ratelimit-remaining': '150' };
    if (u.includes('/videos/search')) return new Response(JSON.stringify({ videos: idsOf(new URL(u).searchParams.get('query')!).map((x) => vid(x)) }), { status: 200, headers });
    const m = u.match(/\/videos\/videos\/(\d+)/);
    if (m) return new Response(JSON.stringify(vid(Number(m[1]))), { status: 200, headers });
    return new Response(Buffer.from('mp4'), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const SEGS: BrollSegment[] = [
  { startSec: 0, endSec: 3, text: 'Você já respondeu um e-mail do chefe em inglês?' },
  { startSec: 3, endSec: 6.5, text: 'Um aluno escreveu I am not convenient no grupo da empresa.' },
  { startSec: 6.5, endSec: 9, text: 'O chefe americano leu e ficou confuso.' },
  { startSec: 9, endSec: 12, text: 'Comece hoje a aula grátis.' },
];

/** Escolhe sempre o candidato 1 (força repetição pra provar a regra) com alternativa 2. */
class T implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly none: number[] = []) {}
  async run(c: ClaudeCall): Promise<ClaudeResult> {
    this.calls.push(c);
    let body: unknown;
    if (c.schema === TRACK_QUERY_SCHEMA) {
      body = { segments: SEGS.map((_, k) => ({ segment: k + 1, queries: k === 2 ? ['man reading email confused', 'man reading email confused'] : [`query ${k} a`, `query ${k} b`, 'man reading email confused'], fallbackSubject: `subject ${k}` })) };
    } else {
      const segs = [...c.user.matchAll(/Stretch (\d+) /g)].map((m) => Number(m[1]));
      body = { picks: segs.map((n) => (this.none.includes(n) ? { segment: n, candidate: 0, alternate: 0, firstCell: 0, lastCell: 0, reason: 'all have watermarks' } : { segment: n, candidate: 1, alternate: 2, alternate2: 3, firstCell: 2, lastCell: 5, reason: `cells 2-5 fit stretch ${n}` })) };
    }
    return { text: JSON.stringify(body), stopReason: 'end_turn', usage: [{ model: 'claude-haiku-4-5', inputTokens: 4000, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0 }] };
  }
}
function setup(t = new T()) {
  const p = pexelsFetch();
  const sheets: string[] = [];
  const cuts: [string, number, number][] = [];
  const ff: Ffmpeg = {
    contactSheet: async (src) => { sheets.push(src); return Buffer.from([0xff, 0xd8]); },
    validate: async () => undefined,
    cut: async (src, s, e, out) => { cuts.push([src, s, e]); writeFileSync(out, 'cut'); },
  };
  const puts: unknown[] = [];
  const sink: BrollSink = { put: async (i) => { puts.push(i); return { fileUrl: `https://storage.test/${puts.length}.mp4` }; } };
  const pexels = new PexelsClient({ apiKey: 'k', fetchImpl: p.f });
  const costs = new MemoryCostStore();
  return { svc: new PexelsBrollService({ pexels, transport: t, costs, ffmpeg: ff, sink, fetchImpl: p.f }), p, t, sheets, cuts, puts, costs, pexels };
}
const INPUT = { workspaceId: 'w1', batchId: 'b1', segments: SEGS, language: 'pt-BR', offer: { kind: 'Curso', what: 'Inglês para o trabalho' } };

describe('searchTrack (live com fakes)', () => {
  it('1 chamada de buscas; Pexels dedup; folha 1x por vídeo; escolha em lotes; sem repetir clipe em seguida; baixa cada vídeo 1x', async () => {
    const { svc, t, p, sheets, cuts, puts, costs } = setup();
    const out = await svc.searchTrack(INPUT);
    expect(t.calls.filter((c) => c.schema === TRACK_QUERY_SCHEMA)).toHaveLength(1);
    expect(t.calls[0].user).toContain('1. [0.0-3.0 s] "Você já respondeu');
    // buscas únicas: 3 trechos × 2 próprias + 1 compartilhada por todos = 7, 1 pedido cada (3 vídeos: não pede sem orientação)
    const searches = p.calls.filter((u) => u.includes('/videos/search'));
    expect(new Set(searches).size).toBe(searches.length);
    expect(searches.length).toBe(7);
    expect(new Set(sheets).size).toBe(sheets.length); // folha 1x por vídeo
    const picks = t.calls.filter((c) => c.schema === TRACK_PICK_SCHEMA);
    expect(picks).toHaveLength(Math.ceil(SEGS.length / TRACK_LIMITS.segmentsPerPick));
    // picks alinhados aos trechos; nunca o mesmo vídeo em seguida (o modelo sempre pede o 1: troca pela alternativa)
    expect(out.picks).toHaveLength(SEGS.length);
    const vids = out.picks.map((x) => (isNone(x) ? null : x.provenance.sourceUrl));
    for (let k = 1; k < vids.length; k++) if (vids[k] && vids[k - 1]) expect(vids[k]).not.toBe(vids[k - 1]);
    const first = out.picks[0];
    if (isNone(first)) throw new Error('none');
    expect(first).toMatchObject({ fileUrl: 'https://storage.test/1.mp4', provenance: { provider: 'pexels', license: 'Pexels License', licenseCommercialOk: true }, reason: 'cells 2-5 fit stretch 1' });
    expect(first.srcEndSec - first.srcStartSec).toBeGreaterThanOrEqual(3);
    // src* é relativo ao arquivo entregue (o corte): começa em 0 e dura o mesmo que o intervalo da provenance
    for (const x of out.picks) {
      if (isNone(x)) continue;
      for (const c of [x, ...((x as BrollPickAlt).alternatives ?? [])]) {
        expect(c.srcStartSec).toBe(0);
        expect(c.srcEndSec).toBeCloseTo(c.provenance.endSec - c.provenance.startSec, 2);
      }
    }
    expect(cuts.some(([, s]) => s > 0)).toBe(true); // o corte em si usa o intervalo do vídeo original
    // cada vídeo escolhido baixado 1x; 1 corte por trecho
    const hd = p.calls.filter((u) => u.endsWith('/hd.mp4'));
    expect(new Set(hd).size).toBe(hd.length);
    // 1 corte por clipe (principal + alternativas), cada vídeo baixado 1x mesmo usado em vários trechos/variantes
    const altCount = out.picks.reduce((a, x) => a + (isNone(x) ? 0 : 1 + ((x as BrollPickAlt).alternatives?.length ?? 0)), 0);
    expect(cuts).toHaveLength(altCount);
    expect(puts).toHaveLength(cuts.length);
    for (const x of out.picks) {
      if (isNone(x)) continue;
      const alts = (x as BrollPickAlt).alternatives ?? [];
      expect(alts.length).toBeGreaterThan(0);
      expect(alts.length).toBeLessThanOrEqual(2);
      expect(alts.every((a) => a.provenance.sourceUrl !== x.provenance.sourceUrl)).toBe(true);
    }
    // variantes 0, 1 e 2: cada uma sem repetir vídeo em seguida
    for (const v of [0, 1, 2]) {
      const seq = variantPicks(out.picks, v).map((x) => x?.provenance.sourceUrl ?? null);
      for (let k = 1; k < seq.length; k++) if (seq[k] && seq[k - 1]) expect(seq[k]).not.toBe(seq[k - 1]);
    }
    expect(variantPicks(out.picks, 1).map((x) => x?.fileUrl)).not.toEqual(variantPicks(out.picks, 0).map((x) => x?.fileUrl));
    expect(out.costUsd).toBeCloseTo((1 + picks.length) * (4000 + 300 * 5) / 1e6, 6);
    expect(costs.entries.every((e) => e.variationBatchId === 'b1')).toBe(true);
    // clipes da trilha na linha do tempo da peça
    const clips = trackClips(SEGS, out.picks);
    expect(clips[0]).toMatchObject({ fromSec: 0, toSec: 3, segmentText: SEGS[0].text, fileUrl: 'https://storage.test/1.mp4' });
  });

  it('trecho sem candidato bom = { none, fallbackSubject } (não baixa nada pra ele)', async () => {
    const { svc } = setup(new T([2]));
    const out = await svc.searchTrack(INPUT);
    expect(out.picks[1]).toMatchObject({ none: true, fallbackSubject: 'subject 1' });
    expect(isNone(out.picks[0])).toBe(false);
  });

  it('teto de pedidos à Pexels por lote; trecho sem busca própria pega dos vizinhos', async () => {
    const many: BrollSegment[] = Array.from({ length: 20 }, (_, k) => ({ startSec: k * 3, endSec: k * 3 + 3, text: `trecho ${k}` }));
    class Many extends T {
      async run(c: ClaudeCall): Promise<ClaudeResult> {
        if (c.schema !== TRACK_QUERY_SCHEMA) return super.run(c);
        this.calls.push(c);
        return { text: JSON.stringify({ segments: many.map((_, k) => ({ segment: k + 1, queries: [`q${k}a`, `q${k}b`, `q${k}c`], fallbackSubject: 's' })) }), stopReason: 'end_turn', usage: [] };
      }
    }
    const { svc, pexels } = setup(new Many());
    const out = await svc.searchTrack({ ...INPUT, segments: many });
    expect(out.pexelsRequests).toBeLessThanOrEqual(TRACK_LIMITS.maxPexelsRequests);
    expect(pexels.requests - (out.picks.filter((x) => !isNone(x)).length ? 0 : 0)).toBeGreaterThan(0);
    expect(out.picks.filter((x) => !isNone(x)).length).toBeGreaterThan(15); // os 20 trechos acharam clipe com 25 buscas
  });

  it('variantPicks: usa a alternativa N; sem ela, outra opção; nunca repete em seguida (sem opção = trecho vazio)', () => {
    const pk = (url: string, alts: string[] = []): BrollPickAlt => ({
      candidateId: url, fileUrl: `f-${url}`, srcStartSec: 0, srcEndSec: 3, reason: '', provenance: { provider: 'pexels', sourceUrl: url, creator: null, license: 'Pexels License', licenseCommercialOk: true, startSec: 0, endSec: 3 },
      alternatives: alts.map((a) => pk(a)),
    });
    const picks = [pk('A', ['B', 'C']), pk('B', ['A']), { none: true as const, fallbackSubject: 's' }, pk('C', ['C2']), pk('C2')];
    expect(variantPicks(picks, 0).map((x) => x?.provenance.sourceUrl ?? null)).toEqual(['A', 'B', null, 'C', 'C2']);
    expect(variantPicks(picks, 1).map((x) => x?.provenance.sourceUrl ?? null)).toEqual(['B', 'A', null, 'C2', null]); // C2 repetiria: vazio
    expect(variantPicks(picks, 2).map((x) => x?.provenance.sourceUrl ?? null)).toEqual(['C', 'B', null, 'C', 'C2']); // sem a 2ª alternativa, volta ao principal
    expect(trackClips(SEGS.concat(SEGS[3]), picks, 1)).toHaveLength(3);
  });

  it('peças puras: parse das buscas, regra de repetição, esquemas pequenos', () => {
    expect(parseTrackQueries('{"segments":[{"segment":2,"queries":["A b","a b","x"],"fallbackSubject":"s"}]}', 2)).toEqual([{ queries: [], fallbackSubject: '' }, { queries: ['a b'], fallbackSubject: 's' }]);
    expect(noConsecutiveRepeats([{ video: 1, alt: 2 }, { video: 1, alt: 2 }, { video: 2, alt: null }, null, { video: 3, alt: null }, { video: 3, alt: null }])).toEqual([1, 2, null, null, 3, null]);
    for (const s of [TRACK_QUERY_SCHEMA, TRACK_PICK_SCHEMA]) expect(schemaStats(s)).toMatchObject({ unions: 0, optional: 0 });
  });
});

describe('searchTrack fake', () => {
  const fake = () => new FakeBrollService(new MemoryCostStore(), { publicApiUrl: 'http://api.test' });
  it('determinístico, rodízio sem repetir em seguida, duração do trecho; gatilhos none/gap', async () => {
    const a = await fake().searchTrack(INPUT);
    expect(a).toEqual(await fake().searchTrack(INPUT));
    const urls = a.picks.map((x) => (isNone(x) ? null : x.provenance.sourceUrl));
    for (let k = 1; k < urls.length; k++) expect(urls[k]).not.toBe(urls[k - 1]);
    expect(a.picks[1]).toMatchObject({ srcStartSec: 0, srcEndSec: 3.5 });
    expect((await fake().searchTrack({ ...INPUT, notes: '[mock:broll-none]' })).picks.every(isNone)).toBe(true);
    const gap = await fake().searchTrack({ ...INPUT, notes: '[mock:broll-gap]' });
    expect(gap.picks.map(isNone)).toEqual([false, false, true, false]);
    // alternativas: 2 por trecho; as 3 variantes sem repetir em seguida e diferentes entre si
    const seqs = [0, 1, 2].map((v) => variantPicks(a.picks, v).map((x) => x?.provenance.sourceUrl));
    for (const seq of seqs) for (let k = 1; k < seq.length; k++) expect(seq[k]).not.toBe(seq[k - 1]);
    expect(new Set(seqs.map((x) => x.join('|'))).size).toBe(3);
  });
});
