// briefing-leitura-v2 (22/10): saída do OFFER_EXTRACT com readMode/pages/imagesRead/fieldOrigins/costUsd/readMeta lida de forma
// tolerante da porta (antes e depois da cascata da ia), `sources` → `fieldOrigins`, frases por detalhe (login_wall /
// empty_after_render), 6 etapas com progress/etaSec, validação do `readMeta` persistido (sem base64, ≤ 60 KB).
import type { Job as JobRow } from '@prisma/client';
import { failReasonFor, pageUnreadableDetailOf } from '../common/errors/falhas';
import { EXTRACT_ESTIMATE_USD } from '../custos/custos.service';
import { IntegracaoError } from '../integracoes/erros';
import { JOB_CHECKLIST, presentJob } from '../jobs/job.presenter';
import { isReadMeta } from './ofertas.dto';
import { EXTRACT_STAGES, OfertasService, STAGE_ETA_SEC, STAGE_PROGRESS, fieldOriginsOf, readMetaOf } from './ofertas.service';

const draft = (over: Record<string, unknown> = {}) => ({
  name: 'Orbit', language: 'en', kind: 'App', what: 'Budget app', audience: null, promise: 'Find money', pains: null, proof: null,
  offerAndPrice: 'US$ 9/mo', cta: 'Start', notes: null, costUsd: 0.0234, ...over,
});

function service(stage = jest.fn(), finish = jest.fn()) {
  const prisma = { offer: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  const svc = new OfertasService(prisma as never, { stage, finish } as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  return { svc, stage, finish, prisma };
}

describe('extractOutput: sugestões do negócio (resultado-v1, A2/A3)', () => {
  it('ramo, mercado, cor, resultado e prefixo sem colidir com outro cliente', () => {
    const { svc } = service();
    const out = svc.extractOutput(
      draft({ name: 'Heirloom Jar', business: { industry: 'Faith gifts', market: 'United States', resultType: 'PURCHASE' }, brandColor: { hex: '#E4572E', source: 'cta' } }),
      { url: 'https://x.com/' }, new Set(['HJ']),
    );
    expect(out.business).toEqual({ industry: 'Faith gifts', market: 'United States', brandColor: '#E4572E', brandColorSource: 'cta', resultType: 'PURCHASE', shortCode: 'HEI' });
  });
  it('porta antiga (sem business/brandColor): tudo null menos o prefixo, que sai do nome', () => {
    const { svc } = service();
    expect(svc.extractOutput(draft(), { url: 'https://x.com/' }).business).toEqual({ industry: null, market: null, brandColor: null, brandColorSource: null, resultType: null, shortCode: 'OR' });
  });
  it('takenShortCodes: shortCodes dos outros workspaces dos membros deste', async () => {
    const prisma = {
      membership: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) },
      workspace: { findMany: jest.fn().mockResolvedValue([{ shortCode: 'HJ' }, { shortCode: 'MC' }]) },
    };
    const svc = new OfertasService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    expect([...(await svc.takenShortCodes('w1'))]).toEqual(['HJ', 'MC']);
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({ where: { id: { not: 'w1' }, memberships: { some: { userId: { in: ['u1', 'u2'] } } } }, select: { shortCode: true } });
  });
});

describe('extractOutput (§4.2)', () => {
  it('porta antiga (só briefing + costUsd): url → readMode http, 1 página main, fieldSources page, readMeta pronto', () => {
    const { svc } = service();
    const out = svc.extractOutput(draft(), { url: 'https://x.com/' });
    expect(out).toMatchObject({ name: 'Orbit', language: 'en', sourceUrl: 'https://x.com/', readMode: 'http', costUsd: 0.0234, relatedUrls: [], imagesRead: [], fieldOrigins: {} });
    expect(out.pages).toEqual([{ url: 'https://x.com/', role: 'main', via: 'http', chars: 0 }]);
    expect(out.fieldSources).toEqual({ name: 'page', language: 'page', kind: 'page', what: 'page', promise: 'page', offerAndPrice: 'page', cta: 'page' });
    expect(out.readMeta).toMatchObject({ readMode: 'http', costUsd: 0.0234, readAt: expect.any(String) });
    expect(isReadMeta(out.readMeta)).toBe(true);
  });

  it('texto colado: readMode pasted, sem páginas, sourceUrl só se veio', () => {
    const { svc } = service();
    expect(svc.extractOutput(draft(), { pageText: 'texto' })).toMatchObject({ readMode: 'pasted', pages: [], sourceUrl: null });
    expect(svc.extractOutput(draft({ readMode: 'vision' }), { pageText: 'texto', url: 'https://x.com/' })).toMatchObject({ readMode: 'pasted', sourceUrl: 'https://x.com/' });
  });

  it('cascata da ia: readMode, pages (chars do texto quando faltar), imagens sem base64, sources → fieldOrigins, relatedUrls = subpáginas', () => {
    const { svc } = service();
    const out = svc.extractOutput(
      draft({
        readMode: 'vision',
        pages: [{ url: 'https://x.com/', role: 'main', via: 'rendered', text: 'a'.repeat(300) }, { url: 'https://x.com/checkout', role: 'checkout', via: 'http', chars: 900 }],
        imagesRead: [{ index: 1, src: 'screenshot:1', alt: null, kind: 'screenshot', widthPx: 780, heightPx: 1688, read: 'US$ 9/mo, 7-day trial', base64: 'AAAA' }],
        sources: { offerAndPrice: [{ role: 'checkout' }, { role: 'main', imageIndex: 1 }], promise: [{ role: 'main' }], language: [{ role: 'main' }], bogus: [{ role: 'main' }], notes: [{ role: 'nope' as never, imageIndex: 9 }] },
      }),
      { url: 'https://x.com/' },
    );
    expect(out.readMode).toBe('vision');
    expect(out.pages).toEqual([{ url: 'https://x.com/', role: 'main', via: 'rendered', chars: 300 }, { url: 'https://x.com/checkout', role: 'checkout', via: 'http', chars: 900 }]);
    expect(out.imagesRead).toEqual([{ index: 1, src: 'screenshot:1', alt: null, kind: 'screenshot', widthPx: 780, heightPx: 1688, read: 'US$ 9/mo, 7-day trial' }]);
    expect(JSON.stringify(out)).not.toContain('AAAA');
    expect(out.fieldOrigins).toEqual({
      offerAndPrice: [{ role: 'checkout', url: 'https://x.com/checkout' }, { role: 'main', url: 'https://x.com/', imageIndex: 1 }],
      promise: [{ role: 'main', url: 'https://x.com/' }],
      notes: [{ role: 'nope', url: 'https://x.com/' }], // papel desconhecido cai na principal; imageIndex inexistente é descartado
    });
    expect(out.relatedUrls).toEqual(['https://x.com/checkout']);
    expect(out.readMeta).toMatchObject({ readMode: 'vision', pages: out.pages, imagesRead: out.imagesRead, fieldOrigins: out.fieldOrigins, costUsd: 0.0234 });
  });

  it('fieldOrigins prontos da ia têm prioridade sobre sources; readMode inferido: 2 páginas = crawled, imagem = vision', () => {
    const { svc } = service();
    const ready = { promise: [{ role: 'main' as const, url: 'https://x.com/' }] };
    expect(fieldOriginsOf({ fieldOrigins: ready, sources: { cta: [{ role: 'main' }] } }, [], [])).toBe(ready);
    expect(svc.extractOutput(draft({ pages: [{ url: 'https://x.com/', role: 'main' }, { url: 'https://x.com/about', role: 'about' }] }), { url: 'https://x.com/' }).readMode).toBe('crawled');
    expect(svc.extractOutput(draft({ imagesRead: [{ index: 1, src: 's', alt: null, kind: 'img', widthPx: 1, heightPx: 1 }] }), { url: 'https://x.com/' }).readMode).toBe('vision');
  });
});

describe('runExtraction: etapas e falhas (§4.3)', () => {
  it('6 etapas com progress e etaSec do contrato; etapa desconhecida passa sem número; estimativa 0,25', async () => {
    expect([...EXTRACT_STAGES]).toEqual(JOB_CHECKLIST.OFFER_EXTRACT);
    expect(EXTRACT_STAGES.map((s) => [STAGE_PROGRESS[s], STAGE_ETA_SEC[s]])).toEqual([[10, 5], [25, 20], [35, 30], [45, 25], [60, 10], [80, 20], [95, 1]]);
    expect(EXTRACT_ESTIMATE_USD).toBe(0.25);
    const { svc, stage, finish } = service(jest.fn().mockResolvedValue({}), jest.fn().mockResolvedValue({}));
    (svc as unknown as { claude: unknown }).claude = {
      extractOffer: async (_i: unknown, onStage: (s: string) => void) => {
        for (const s of [...EXTRACT_STAGES, 'future_stage']) onStage(s);
        return draft();
      },
    };
    await svc.runExtraction('j1', 'w1', { url: 'https://x.com/' });
    expect(stage.mock.calls.map((c) => c.slice(1))).toEqual([
      ['fetching_page', 10, 5], ['rendering_page', 25, 20], ['walking_quiz', 35, 30], ['reading_subpages', 45, 25], ['reading_images', 60, 10], ['extracting', 80, 20], ['detecting_language', 95, 1], ['future_stage', undefined, null],
    ]);
    expect(finish).toHaveBeenCalledWith('j1', { status: 'SUCCEEDED', output: expect.objectContaining({ readMode: 'http', readMeta: expect.any(Object) }) });
  });

  it('D6 (reconciliado): o job nunca grava offers.read_meta; o readMeta vai no output e quem aplica manda no POST/PATCH', async () => {
    const { svc, prisma, finish } = service(jest.fn().mockResolvedValue({}), jest.fn().mockResolvedValue({}));
    (svc as unknown as { claude: unknown }).claude = { extractOffer: async () => draft({ readMode: 'rendered' }) };
    await svc.runExtraction('j3', 'w1', { url: 'https://x.com/' });
    expect(prisma.offer.updateMany).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('j3', { status: 'SUCCEEDED', output: expect.objectContaining({ readMeta: expect.objectContaining({ readMode: 'rendered' }) }) });
  });

  it('PAGE_UNREADABLE com details.reason login_wall / empty_after_render troca só a frase; sem detalhe = frase de hoje', async () => {
    expect(failReasonFor('PAGE_UNREADABLE', 'login_wall')).toMatch(/behind a login/);
    expect(failReasonFor('PAGE_UNREADABLE', 'empty_after_render')).toMatch(/even after loading it in a browser/);
    expect(failReasonFor('PAGE_UNREADABLE', 'other')).toMatch(/could not read any text/);
    expect(failReasonFor('PAGE_FORBIDDEN', 'login_wall')).toMatch(/403/);
    expect(pageUnreadableDetailOf({ reason: 'login_wall' })).toBe('login_wall');
    expect(pageUnreadableDetailOf({ detail: 'empty_after_render' })).toBe('empty_after_render');
    expect(pageUnreadableDetailOf({ reason: 'x' })).toBeUndefined();
    expect(pageUnreadableDetailOf(undefined)).toBeUndefined();

    const { svc, finish } = service(jest.fn().mockResolvedValue({}), jest.fn().mockResolvedValue({}));
    (svc as unknown as { claude: unknown }).claude = { extractOffer: async () => { throw new IntegracaoError('PAGE_UNREADABLE', 'login', { reason: 'login_wall' }); } };
    await svc.runExtraction('j2', 'w1', { url: 'https://x.com/login' });
    expect(finish).toHaveBeenCalledWith('j2', { status: 'FAILED', errorCode: 'PAGE_UNREADABLE', failReason: expect.stringMatching(/behind a login/) });
    const row = { id: 'j2', type: 'OFFER_EXTRACT', status: 'FAILED', stage: 'rendering_page', progress: 25, etaSec: 20, errorCode: 'PAGE_UNREADABLE', failReason: 'x', output: null } as unknown as JobRow;
    const view = presentJob(row);
    expect(view.action).toBe('paste_page_text');
    expect(view.checklist).toEqual([
      { key: 'fetching_page', done: true }, { key: 'rendering_page', done: false }, { key: 'walking_quiz', done: false }, { key: 'reading_subpages', done: false },
      { key: 'reading_images', done: false }, { key: 'extracting', done: false }, { key: 'detecting_language', done: false },
    ]);
  });
});

describe('readMeta persistido (D5)', () => {
  const meta = { readMode: 'crawled', pages: [{ url: 'https://x.com/', role: 'main', via: 'http', chars: 10 }], imagesRead: [], fieldOrigins: {}, costUsd: 0.02, readAt: '2026-10-22T10:00:00.000Z' };
  it('aceita a forma do contrato; recusa readMode fora da lista, base64 em imagem, JSON > 60 KB; readMetaOf devolve null pro resto', () => {
    expect(isReadMeta(meta)).toBe(true);
    expect(readMetaOf(meta as never)).toEqual(meta);
    expect(isReadMeta({ ...meta, readMode: 'magic' })).toBe(false);
    expect(isReadMeta({ ...meta, imagesRead: [{ index: 1, src: 's', base64: 'AAA' }] })).toBe(false);
    expect(isReadMeta({ ...meta, pages: 'x' })).toBe(false);
    expect(isReadMeta({ ...meta, imagesRead: [{ index: 1, src: 's', read: 'a'.repeat(70_000) }] })).toBe(false);
    expect(readMetaOf(null)).toBeNull();
    expect(readMetaOf({ relatedUrls: [] } as never)).toBeNull();
  });
});
