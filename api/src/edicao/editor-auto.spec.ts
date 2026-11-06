// editor-universal-v1 F-U1 (backend): peças puras do editor da peça AUTO (editor-auto.ts), os helpers da peça servida /
// -ED (pecas.ts) e os argumentos do proxy (proxy.service.ts). Sem banco, sem ffmpeg.
import {
  editedTextsToCheck, editorPathOfSource, exportViewOf, faceTrackDoArquivo, factsNumbersOf, lastPassedExportOf, pendingExportOf, pendingFromDocs, pieceEditorViewOf,
  provenanceOf, sameDoc, templateKeyOf, utcDayStart,
} from './editor-auto';
import { adNameWithEd, codeWithEd, docV3TemConteudo, editedFromRenders, isEditorExport, servedRenders } from './pecas';
import { proxyArgs, proxyEtaSec } from './proxy.service';

const t0 = new Date('2026-11-04T10:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const EXP = { templateId: 'auto-edit', editorExport: true };
const AUTO = { templateId: 'auto-edit' };
const DOC = { version: 3, clips: [], trim: null, layers: [{ id: 'slot:headline', text: 'New' }], captionWords: [] };
type St = 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED';
const row = (o: Partial<{ id: string; status: St; settings: unknown; doc: unknown; createdAt: Date; format: 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1'; errorCode: string | null; failDetail: unknown; fileId: string | null; stage: string | null; progress: number; editRevision: number | null }>) => ({
  id: 'r', status: 'READY' as St, settings: AUTO as unknown, doc: null, createdAt: t0, format: 'VERTICAL_9_16' as const, errorCode: null, failDetail: null, fileId: 'f',
  stage: null, progress: 0, editRevision: null, startedAt: null, finishedAt: null, ...o,
});

describe('templateKeyOf (§2)', () => {
  it('FRAME com template conhecido e HEADLINE abrem; os outros tipos não', () => {
    expect(templateKeyOf('FRAME', { template: 'news' })).toBe('frame:news');
    expect(templateKeyOf('HEADLINE', {})).toBe('headline');
    expect(templateKeyOf('FRAME', { template: 'nao-existe' })).toBeNull();
    expect(templateKeyOf('LIST_OVERLAY', {})).toBeNull();
    expect(templateKeyOf('CUT', {})).toBeNull();
  });
});

describe('peça servida e -ED (pecas.ts, §9.6 / D-E1-4)', () => {
  it('export em curso ou reprovado não é servido; o que passou é', () => {
    const rs = [row({ id: 'a' }), row({ id: 'b', settings: EXP, status: 'RENDERING' }), row({ id: 'c', settings: EXP, status: 'FAILED' }), row({ id: 'd', settings: EXP, status: 'READY' })];
    expect(servedRenders(rs).map((r) => r.id)).toEqual(['a', 'd']);
    expect(isEditorExport(EXP)).toBe(true);
    expect(isEditorExport(AUTO)).toBe(false);
  });
  it('edited = o READY mais novo do principal é export com doc que muda algo', () => {
    expect(editedFromRenders([row({ id: 'a' }), row({ id: 'b', settings: EXP, doc: DOC, createdAt: at(5) })], 'VERTICAL_9_16')).toBe(true);
    expect(editedFromRenders([row({ id: 'b', settings: EXP, doc: null, createdAt: at(5) })], 'VERTICAL_9_16')).toBe(false); // "Discard edits" exportado
    expect(editedFromRenders([row({ id: 'b', settings: EXP, doc: DOC, status: 'FAILED', createdAt: at(5) }), row({ id: 'a' })], 'VERTICAL_9_16')).toBe(false);
    expect(docV3TemConteudo({ version: 3, clips: [], trim: null, layers: [], captionWords: [], templateOpts: { brand: '#FF0000' } })).toBe(true);
    expect(docV3TemConteudo({ version: 3, clips: [], trim: null, layers: [], captionWords: [], templateOpts: {} })).toBe(false);
  });
  it('código e nome do arquivo com -ED (o sufixo de colisão _2 fica no fim)', () => {
    expect(codeWithEd('FRAME-NEWS', true)).toBe('FRAME-NEWS-ED');
    expect(codeWithEd('FRAME-NEWS', false)).toBe('FRAME-NEWS');
    expect(codeWithEd('FRAME-NEWS-ED', true)).toBe('FRAME-NEWS-ED');
    expect(adNameWithEd('MC_1104_FRAME-NEWS', 'FRAME-NEWS', true)).toBe('MC_1104_FRAME-NEWS-ED');
    expect(adNameWithEd('MC_1104_FRAME-NEWS_2', 'FRAME-NEWS', true)).toBe('MC_1104_FRAME-NEWS-ED_2');
    expect(adNameWithEd('MC_1104_FRAME-NEWS', 'FRAME-NEWS', false)).toBe('MC_1104_FRAME-NEWS');
    expect(adNameWithEd('estranho', null, true)).toBe('estranho-ED');
  });
});

describe('vista do export (§7.2, SSE editor.export)', () => {
  it('etapas: QUEUED = saving, RENDERING = rendering/caption_check/text_check, READY = done, FAILED = failed com o Jump to', () => {
    expect(exportViewOf(row({ status: 'QUEUED' })).stage).toBe('saving');
    expect(exportViewOf(row({ status: 'RENDERING', progress: 40 }))).toMatchObject({ stage: 'rendering', progress: 40 });
    expect(exportViewOf(row({ status: 'RENDERING', stage: 'caption_check' })).stage).toBe('caption_check');
    expect(exportViewOf(row({ status: 'RENDERING', stage: 'text_check' })).stage).toBe('text_check');
    expect(exportViewOf(row({ status: 'READY', editRevision: 4 }))).toMatchObject({ stage: 'done', progress: 100, revision: 4, error: null });
    const f = exportViewOf(row({ status: 'FAILED', errorCode: 'CAPTION_COVERED', failDetail: { rule: 'caption_covered', atSec: 4.2, layerId: 'box:card' } }));
    expect(f).toMatchObject({ stage: 'failed', error: { code: 'CAPTION_COVERED', atSec: 4.2, layerId: 'box:card', canRecheck: true } });
    expect(exportViewOf(row({ status: 'FAILED', errorCode: 'RENDER_ERROR' })).error!.canRecheck).toBe(false);
    expect(exportViewOf(row({ status: 'FAILED', errorCode: 'TEXT_MISMATCH', fileId: null })).error!.canRecheck).toBe(false);
  });
  it('pendente = o export mais novo se não passou; último que passou = o READY mais novo do principal', () => {
    const passou = row({ id: 'p', settings: EXP, status: 'READY', createdAt: at(1), doc: DOC });
    const falhou = row({ id: 'f', settings: EXP, status: 'FAILED', createdAt: at(2) });
    expect(pendingExportOf([row({ id: 'x' }), passou, falhou])!.id).toBe('f');
    expect(pendingExportOf([falhou, row({ id: 'p2', settings: EXP, status: 'READY', createdAt: at(3) })])).toBeNull();
    expect(lastPassedExportOf([row({ id: 'x', createdAt: at(9) }), passou, falhou], 'VERTICAL_9_16')!.id).toBe('p');
  });
});

describe('dirty por doc (§7.2/§7.5)', () => {
  it('compara sem ordem de chave; vazio = null; nunca exportado + sem doc = limpo', () => {
    expect(sameDoc({ a: 1, b: { c: 2, d: 3 } , layers: [1] }, { layers: [1], b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(pendingFromDocs(null, null)).toBe(false);
    expect(pendingFromDocs({ version: 3, clips: [], trim: null, layers: [], captionWords: [] }, null)).toBe(false);
    expect(pendingFromDocs(DOC, null)).toBe(true);
    expect(pendingFromDocs(DOC, DOC)).toBe(false);
    expect(pendingFromDocs(null, DOC)).toBe(true); // "Discard edits" depois de exportar: precisa exportar de novo
  });
});

describe('fatos e proveniência', () => {
  it('números da fala, do CTA falado e do Brain, normalizados como o numbersIn', () => {
    expect(factsNumbersOf({ brain: { proof: '1.000 clientes', offerAndPrice: 'R$ 97,90', what: null }, spokenCta: 'Link na bio, 7 dias', words: [{ word: 'save' }, { word: '2' }, { word: 'hours' }] }))
      .toEqual(['1000', '2', '7', '9790']);
  });
  it('caminho do plano → caminho do editor; fonte → origem e campo do Brain', () => {
    const textos = new Map([['layer:slot:headline', 'People save time'], ['item:slot:items/i1', 'First'], ['layer:slot:price.to', '$9']]);
    expect(editorPathOfSource('items.0', textos, 'frame')).toBe('item:slot:items/i1');
    expect(editorPathOfSource('price.to', textos, 'frame')).toBe('layer:slot:price.to');
    expect(editorPathOfSource('nada', textos, 'frame')).toBeNull();
    expect(editorPathOfSource('text', new Map(), 'headline')).toBe('layer:headline');
    const p = provenanceOf(textos, { headline: 'promise', 'items.0': 'transcript', 'price.to': 'name' }, { promise: 'Save time every day' }, 'frame');
    expect(p['layer:slot:headline']).toEqual({ source: 'brain', field: 'promise', quote: 'Save time every day', anchorWordIndex: null, original: 'People save time' });
    expect(p['item:slot:items/i1']).toMatchObject({ source: 'transcript', field: null, original: 'First' });
    expect(p['layer:slot:price.to']).toMatchObject({ source: 'brain', field: 'name' });
    expect(provenanceOf(new Map([['layer:slot:cta', 'Go']]), null, {}, 'frame')['layer:slot:cta']).toMatchObject({ source: 'template', quote: null, original: 'Go' });
  });
});

describe('textos que a visão confere depois do export (D-E1-5)', () => {
  it('só os editados e visíveis, 1 s depois de aparecer (ou o meio se for curto), sem a marcação *', () => {
    const r = {
      layout: { layers: [{ id: 'a', fromSec: 0, toSec: 10, visible: true }, { id: 'b', fromSec: 2, toSec: 2.6, visible: true }, { id: 'c', fromSec: 0, toSec: 5, visible: false }] },
      textos: [
        { path: 'layer:a', layerId: 'a', text: 'Save *2 hours*', edited: true },
        { path: 'layer:b', layerId: 'b', text: 'Short', edited: true },
        { path: 'layer:c', layerId: 'c', text: 'Hidden', edited: true },
        { path: 'layer:a2', layerId: 'a', text: 'Untouched', edited: false },
      ],
    };
    expect(editedTextsToCheck(r)).toEqual([{ key: 'layer:a', text: 'Save 2 hours', layerId: 'a', atSec: 1 }, { key: 'layer:b', text: 'Short', layerId: 'b', atSec: 2.3 }]);
  });
});

describe('PieceEditorView (§7.5)', () => {
  const base = { key: 'frame:news' as const, status: 'ready', locked: false, editDoc: null, primary: 'VERTICAL_9_16' as const, renders: [row({ id: 'a' })] };
  it('disponível só pronta, de tipo ligado e destravada', () => {
    expect(pieceEditorViewOf(base)).toEqual({ available: true, reason: null, edited: false, pendingExport: false, export: null });
    expect(pieceEditorViewOf({ ...base, key: null }).reason).toBe('auto_type_not_editable');
    expect(pieceEditorViewOf({ ...base, locked: true }).reason).toBe('sample_locked');
    expect(pieceEditorViewOf({ ...base, status: 'rendering' }).reason).toBe('piece_not_ready');
  });
  it('edição salva não exportada = pendingExport; export em curso aparece; export que passou = edited', () => {
    expect(pieceEditorViewOf({ ...base, editDoc: DOC }).pendingExport).toBe(true);
    const rodando = pieceEditorViewOf({ ...base, editDoc: DOC, renders: [row({ id: 'a' }), row({ id: 'e', settings: EXP, status: 'RENDERING', createdAt: at(3) })] });
    expect(rodando.export).toMatchObject({ renderId: 'e', stage: 'rendering' });
    const pronto = pieceEditorViewOf({ ...base, editDoc: DOC, renders: [row({ id: 'a' }), row({ id: 'e', settings: EXP, status: 'READY', doc: DOC, createdAt: at(3) })] });
    expect(pronto).toMatchObject({ edited: true, pendingExport: false, export: null });
  });
});

describe('proxy 540p (§8)', () => {
  it('H.264 baseline, 540 de largura (sem aumentar), GOP 1 s, crf 28, AAC 96k opcional', () => {
    const a = proxyArgs('in.mp4', 'out.mp4');
    expect(a).toEqual(expect.arrayContaining(['-profile:v', 'baseline', '-crf', '28', '-b:a', '96k', '0:a:0?', 'expr:gte(t,n_forced*1)']));
    expect(a[a.indexOf('-vf') + 1]).toBe("scale='min(540,iw)':-2");
    expect(a[a.length - 1]).toBe('out.mp4');
    expect(proxyEtaSec(30)).toBe(3);
    expect(proxyEtaSec(120)).toBe(12);
    expect(proxyEtaSec(null)).toBe(3);
  });
  it('dia UTC do limite de exports', () => {
    expect(utcDayStart(new Date('2026-11-04T23:59:00-03:00')).toISOString()).toBe('2026-11-05T00:00:00.000Z');
  });
});

describe('faceTrackDoArquivo (F-U2)', () => {
  const seg = { startFrame: 10, endFrame: 20, role: 'main' as const, region: { x: 10, y: 20, w: 100, h: 200 }, faceInRegion: [{ atFrame: 12, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }] };
  const mapa = { width: 540, height: 960, fps: 15, faceTrack: [seg] } as never;
  it('sem mapa: vazio; mesma grade: como veio', () => {
    expect(faceTrackDoArquivo(null, { width: 1080, height: 1920, fps: 30 })).toEqual([]);
    expect(faceTrackDoArquivo(mapa, { width: 540, height: 960, fps: 15 })).toEqual([seg]);
  });
  it('outra grade: px e quadros no espaço do arquivo (a caixa do rosto é fração da região)', () => {
    const [s] = faceTrackDoArquivo(mapa, { width: 1080, height: 1920, fps: 30 });
    expect(s).toMatchObject({ startFrame: 20, endFrame: 40, region: { x: 20, y: 40, w: 200, h: 400 } });
    expect(s.faceInRegion[0]).toEqual({ atFrame: 24, box: seg.faceInRegion[0].box });
  });
});
