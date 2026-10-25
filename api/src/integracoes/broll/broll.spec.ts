// §B3.1 b-roll (Pexels): buscas pela fala, Pexels com cache/cota, folhas, escolha por visão, corte, proveniência,
// reserva de imagem, social desligado e o fake. Nenhuma rede: fetch, transporte e ffmpeg falsos.
import type { BrollSearchInput } from '../contrato';
import { isIntegracaoError } from '../erros';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from '../claude/transporte';
import { schemaStats } from '../claude/schema-stats';
import { MemoryCostStore } from '../store/memoria.store';
import { PexelsBrollService, candidateIdOf, parseCandidateId, type BrollSink } from './broll.service';
import { FakeBrollService } from './fake-broll.service';
import { cellTimes, intervalFromCells, type Ffmpeg } from './folha';
import { PexelsClient, finalFile, previewFile, rankVideos, type PexelsVideo } from './pexels';
import { PICK_SCHEMA, QUERY_SCHEMA, fallbackImagePrompt, parsePick, parseQueries } from './prompts';
import { socialSourceFor } from './social';

const vid = (id: number, w: number, h: number, duration: number, extra: Partial<PexelsVideo> = {}): PexelsVideo => ({
  id, width: w, height: h, duration, url: `https://www.pexels.com/video/v-${id}/`, image: `https://images.pexels.com/${id}.jpg`,
  user: { id: 9, name: `Creator ${id}`, url: 'https://www.pexels.com/@c' },
  video_files: [
    { id: id * 10 + 1, quality: 'sd', file_type: 'video/mp4', width: Math.round(w / 3), height: Math.round(h / 3), link: `https://videos.pexels.com/${id}/sd.mp4` },
    { id: id * 10 + 2, quality: 'hd', file_type: 'video/mp4', width: w > h ? 1920 : 1080, height: w > h ? 1080 : 1920, link: `https://videos.pexels.com/${id}/hd.mp4` },
    { id: id * 10 + 3, quality: 'uhd', file_type: 'video/mp4', width: w > h ? 3840 : 2160, height: w > h ? 2160 : 3840, link: `https://videos.pexels.com/${id}/uhd.mp4` },
  ],
  ...extra,
});
const VIDEOS = [vid(1, 1920, 1080, 20), vid(2, 1080, 1920, 15), vid(3, 1080, 1920, 4)];

function pexelsFetch(opts: { remaining?: number; status?: number } = {}) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    if (String(url).startsWith('https://api.pexels.com')) {
      const headers = { 'content-type': 'application/json', 'x-ratelimit-remaining': String(opts.remaining ?? 150), 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) };
      if (opts.status) return new Response('{}', { status: opts.status, headers });
      const m = String(url).match(/\/videos\/videos\/(\d+)/);
      const body = m ? VIDEOS.find((v) => v.id === Number(m[1])) : { videos: VIDEOS };
      return new Response(JSON.stringify(body), { status: 200, headers });
    }
    return new Response(Buffer.from('video-bytes'), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

class T implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly pick: Record<string, unknown> = { choice: 2, firstCell: 3, lastCell: 6, reason: 'cells 3-6 show a woman sitting up in bed holding her lower back', rejected: [{ candidate: 1, reason: 'watermark in the corner' }] }) {}
  async run(c: ClaudeCall): Promise<ClaudeResult> {
    this.calls.push(c);
    const body = c.schema === QUERY_SCHEMA ? { queries: ['woman holding lower back in bed', 'stretching in bedroom', 'woman holding lower back in bed'], fallbackSubject: 'a woman sitting on the edge of her bed' } : this.pick;
    return { text: JSON.stringify(body), stopReason: 'end_turn', usage: [{ model: 'claude-haiku-4-5', inputTokens: 5000, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0 }] };
  }
}
const ffmpeg = (): Ffmpeg & { sheets: string[]; cuts: [string, number, number][] } => {
  const sheets: string[] = [];
  const cuts: [string, number, number][] = [];
  return {
    sheets, cuts,
    contactSheet: async (src) => { sheets.push(src); return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); },
    validate: async () => undefined,
    cut: async (src, s, e, out) => { cuts.push([src, s, e]); require('node:fs').writeFileSync(out, 'cut'); },
  };
};
const sink = (): BrollSink & { puts: unknown[] } => {
  const puts: unknown[] = [];
  return { puts, put: async (i) => { puts.push(i); return { fileUrl: `https://storage.test/${puts.length}.mp4` }; } };
};
const INPUT: BrollSearchInput = { workspaceId: 'w1', variationBatchId: 'b1', jobId: 'j1', speech: 'Toda manhã eu acordava travada, com dor nas costas.', language: 'pt-BR', minSec: 4, providers: ['pexels'], limit: 6 };

function service(over: { t?: T; f?: ReturnType<typeof pexelsFetch>; ff?: ReturnType<typeof ffmpeg>; s?: ReturnType<typeof sink>; costs?: MemoryCostStore } = {}) {
  const f = over.f ?? pexelsFetch();
  const t = over.t ?? new T();
  const ff = over.ff ?? ffmpeg();
  const s = over.s ?? sink();
  const costs = over.costs ?? new MemoryCostStore();
  const pexels = new PexelsClient({ apiKey: 'k', fetchImpl: f.f });
  return { svc: new PexelsBrollService({ pexels, transport: t, costs, ffmpeg: ff, sink: s, fetchImpl: f.f }), f, t, ff, s, costs, pexels };
}

describe('b-roll Pexels (live com fakes)', () => {
  it('buscas pela fala (Haiku, strict) → Pexels vertical → folhas → escolha por visão; o escolhido vem 1º com o intervalo das células', async () => {
    const { svc, t, f, ff, costs } = service();
    const out = await svc.search({ ...INPUT, offer: { kind: 'App', what: 'Rotina noturna de 10 min' } } as never);
    expect(t.calls[0]).toMatchObject({ schema: QUERY_SCHEMA, model: 'claude-haiku-4-5', effort: null });
    expect(t.calls[0].user).toContain('Toda manhã eu acordava travada');
    expect(t.calls[0].user).toContain('What it is: Rotina noturna de 10 min');
    expect(out.queries).toEqual(['woman holding lower back in bed', 'stretching in bedroom']); // repetida sai
    const searches = f.calls.filter((u) => u.includes('/videos/search'));
    expect(searches[0]).toContain('orientation=portrait');
    expect(searches[0]).toContain('query=woman+holding+lower+back+in+bed');
    // folhas do arquivo de PRÉVIA (o menor), vertical/HD primeiro
    expect(ff.sheets).toEqual(['https://videos.pexels.com/2/sd.mp4', 'https://videos.pexels.com/3/sd.mp4', 'https://videos.pexels.com/1/sd.mp4']);
    expect(t.calls[1]).toMatchObject({ schema: PICK_SCHEMA, model: 'claude-haiku-4-5' });
    expect(t.calls[1].images!.map((i) => i.caption)).toEqual(['Candidate 1:', 'Candidate 2:', 'Candidate 3:']);
    expect(t.calls[1].user).toContain('Candidate 1: 15 s long; cells at 1=0.63s');
    // escolha 2 = vídeo 3 (4 s): intervalo das células 3-6 alongado até o mínimo que o clipe deixa; o 1 recusado sai
    const [chosen, ...rest] = out.candidates;
    expect(chosen.pick).toEqual({ chosen: true, reason: 'cells 3-6 show a woman sitting up in bed holding her lower back', cells: [3, 6] });
    expect(chosen.provenance).toEqual({ provider: 'pexels', sourceUrl: 'https://www.pexels.com/video/v-3/', creator: 'Creator 3', license: 'Pexels License', licenseCommercialOk: true, startSec: 0, endSec: 4 });
    expect(chosen.candidateId).toBe('pexels:3:0.00-4.00');
    expect(rest.map((c) => c.provenance.sourceUrl)).toEqual(['https://www.pexels.com/video/v-1/']);
    expect(out.costUsd).toBeCloseTo(2 * (5000 * 1 + 300 * 5) / 1e6, 6);
    expect(costs.entries.every((e) => e.variationBatchId === 'b1' && e.kind === 'LLM' && e.model === 'claude-haiku-4-5')).toBe(true);
  });

  it('cache: a mesma busca não gasta cota de novo; cota no fim (reserva) ou 429 = BROLL_UNAVAILABLE', async () => {
    const a = service();
    await a.svc.search(INPUT);
    const n = a.pexels.requests;
    await a.svc.search(INPUT);
    expect(a.pexels.requests).toBe(n);
    const low = service({ f: pexelsFetch({ remaining: 5 }) });
    await low.pexels.search('x');
    await expect(low.pexels.search('y')).rejects.toMatchObject({ code: 'BROLL_UNAVAILABLE', details: { reason: 'rate_limited' } });
    await expect(service({ f: pexelsFetch({ status: 429 }) }).svc.search(INPUT)).rejects.toMatchObject({ code: 'BROLL_UNAVAILABLE' });
    await expect(service({ f: pexelsFetch({ status: 401 }) }).svc.search(INPUT)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('ninguém serve = BROLL_NO_MATCH com as recusas e o assunto da imagem de reserva', async () => {
    const t = new T({ choice: 0, firstCell: 0, lastCell: 0, reason: 'all clips have watermarks or text', rejected: [{ candidate: 1, reason: 'watermark' }] });
    const e = await service({ t }).svc.search(INPUT).catch((x) => x);
    expect(isIntegracaoError(e) && e.code).toBe('BROLL_NO_MATCH');
    expect(e.details).toMatchObject({ fallbackSubject: 'a woman sitting on the edge of her bed', rejected: [{ candidate: 1, reason: 'watermark' }] });
  });

  it('fetch: baixa só o arquivo HD (≤ 1080, nunca 4K), valida, corta o intervalo mudo e sobe pelo sink', async () => {
    const { svc, f, ff, s } = service();
    const r = await svc.fetch({ workspaceId: 'w1', variationBatchId: 'b1', candidateId: candidateIdOf(2, 1.5, 6) });
    expect(f.calls.filter((u) => u.includes('videos.pexels.com'))).toEqual(['https://videos.pexels.com/2/hd.mp4']);
    expect(ff.cuts[0].slice(1)).toEqual([1.5, 6]);
    expect(s.puts[0]).toMatchObject({ workspaceId: 'w1', variationBatchId: 'b1', mimeType: 'video/mp4', sourceUrl: 'https://www.pexels.com/video/v-2/' });
    expect(r).toEqual({ fileUrl: 'https://storage.test/1.mp4', provenance: { provider: 'pexels', sourceUrl: 'https://www.pexels.com/video/v-2/', creator: 'Creator 2', license: 'Pexels License', licenseCommercialOk: true, startSec: 1.5, endSec: 6 } });
    await expect(svc.fetch({ workspaceId: 'w1', variationBatchId: 'b1', candidateId: 'youtube:abc' })).rejects.toMatchObject({ code: 'BROLL_SOURCE_NOT_SUPPORTED' });
  });

  it('redes sociais: interface da CLI gb.py desligada (D15)', async () => {
    const yt = socialSourceFor('youtube');
    expect(yt.enabled).toBe(false);
    expect(yt.command('search', { query: 'woman stretching', project: '/data/p' })).toEqual(['scripts/gb.py', 'search', '--provider', 'youtube', '--query', 'woman stretching', '--limit', '5', '--project', '/data/p']);
    await expect(service().svc.search({ ...INPUT, providers: ['youtube'] })).rejects.toMatchObject({ code: 'BROLL_SOURCE_NOT_SUPPORTED', details: { reason: 'disabled_d15' } });
    await expect(service().svc.search({ ...INPUT, providers: ['pixabay'] })).rejects.toMatchObject({ code: 'BROLL_SOURCE_NOT_SUPPORTED' });
  });

  it('reserva: sem WaveSpeed = NOT_CONFIGURED; prompt de foto do dia a dia sem texto, 9:16', async () => {
    await expect(service().svc.fallbackImage({ workspaceId: 'w', variationBatchId: 'b', subject: 'x' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    const p = fallbackImagePrompt('a woman sitting on the edge of her "bed".');
    expect(p).toContain('object: a woman sitting on the edge of her bed');
    expect(p).toContain('no text, no letters, no watermarks');
  });
});

describe('b-roll: peças puras', () => {
  it('células e intervalo', () => {
    expect(cellTimes(12)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]);
    expect(cellTimes(120)[11]).toBe(34.5); // janela de 36 s
    expect(intervalFromCells(12, 3, 6, 2)).toEqual({ startSec: 2, endSec: 6 });
    expect(intervalFromCells(12, 11, 12, 5)).toEqual({ startSec: 7, endSec: 12 }); // alonga pra trás no fim do clipe
    expect(intervalFromCells(3, 1, 1, 5)).toEqual({ startSec: 0, endSec: 3 }); // clipe curto = inteiro (o render faz loop)
  });
  it('arquivos, ranking, ids e parse', () => {
    const v = vid(7, 1080, 1920, 10);
    expect(previewFile(v)!.link).toContain('sd.mp4');
    expect(finalFile(v)!.link).toContain('hd.mp4');
    expect(rankVideos(VIDEOS, 5).map((x) => x.id)).toEqual([2, 3, 1]);
    expect(parseCandidateId('pexels:42:1.50-6.00')).toEqual({ videoId: 42, startSec: 1.5, endSec: 6 });
    expect(parseQueries('{"queries":["a b","a b","  \\"x y z\\" "],"fallbackSubject":"s"}').queries).toEqual(['a b', 'x y z']);
    expect(parsePick('{"choice":9,"firstCell":2,"lastCell":1,"reason":"r","rejected":[]}', 3)).toMatchObject({ choice: 0, firstCell: 0 });
    expect(parsePick('{"choice":1,"firstCell":5,"lastCell":2,"reason":"r","rejected":[{"candidate":1,"reason":"x"},{"candidate":2,"reason":"y"}]}', 3)).toMatchObject({ choice: 1, firstCell: 5, lastCell: 5, rejected: [{ candidate: 2, reason: 'y' }] });
    for (const s of [QUERY_SCHEMA, PICK_SCHEMA]) expect(schemaStats(s)).toMatchObject({ unions: 0, optional: 0 });
  });
});

describe('b-roll fake', () => {
  const fake = () => new FakeBrollService(new MemoryCostStore(), { publicApiUrl: 'http://api.test' });
  it('determinístico, escolhido 1º com proveniência Pexels; fetch devolve vídeo mock do intervalo', async () => {
    const a = await fake().search(INPUT);
    expect(a).toEqual(await fake().search(INPUT));
    expect(a.candidates[0].pick.chosen).toBe(true);
    expect(a.candidates[0].provenance).toMatchObject({ provider: 'pexels', license: 'Pexels License', licenseCommercialOk: true, startSec: 1, endSec: 5 });
    const got = await fake().fetch({ workspaceId: 'w', variationBatchId: 'b', candidateId: a.candidates[0].candidateId });
    expect(got.fileUrl).toMatch(/^http:\/\/api\.test\/api\/v1\/mock-media\/video\/[0-9a-f]{16}\.mp4\?format=VERTICAL_9_16&sec=4$/);
  });
  it('[mock:broll-none] = BROLL_NO_MATCH; [mock:broll-fail] = 1º fetch falha, o retry passa; social desligado', async () => {
    await expect(fake().search({ ...INPUT, notes: '[mock:broll-none]' } as never)).rejects.toMatchObject({ code: 'BROLL_NO_MATCH', details: { fallbackSubject: expect.any(String) } });
    const f = fake();
    const id = candidateIdOf(5, 0, 4);
    await expect(f.fetch({ workspaceId: 'w', variationBatchId: 'b', candidateId: id, notes: '[mock:broll-fail]' })).rejects.toMatchObject({ code: 'BROLL_UNAVAILABLE' });
    await expect(f.fetch({ workspaceId: 'w', variationBatchId: 'b', candidateId: id, notes: '[mock:broll-fail]' })).resolves.toMatchObject({ provenance: { startSec: 0, endSec: 4 } });
    await expect(fake().search({ ...INPUT, providers: ['tiktok'] })).rejects.toMatchObject({ code: 'BROLL_SOURCE_NOT_SUPPORTED' });
    expect((await fake().fallbackImage({ workspaceId: 'w', variationBatchId: 'b', subject: 's' })).costUsd).toBe(0);
  });
});
