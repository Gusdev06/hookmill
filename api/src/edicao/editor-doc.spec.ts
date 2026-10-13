import type { EditDoc, EditSettings } from '@maquina/contratos';
import { resolverProps } from '@maquina/video';
import { Prisma, type File as FileRow, type Scene as SceneRow } from '@prisma/client';
import { renderPieces } from './cenas-render';
import { plainToInstance } from 'class-transformer';
import { UpdateEditDto } from './edicao.dto';
import { aplicarMudancaDeSettings, definidos, docDeGeracaoNova, docJson, docTemConteudo, montarScratchSource } from './editor-doc';

const D = (n: number) => new Prisma.Decimal(n);
const file = (id: string, durationSec: number | null): FileRow =>
  ({ id, storageKey: `k/${id}`, mimeType: 'video/mp4', durationSec: durationSec == null ? null : D(durationSec) }) as unknown as FileRow;
const settings: EditSettings = { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: 'Hook', ctaText: 'Go', endCard: true };
const sign = async (f: FileRow) => ({ id: f.id, url: `https://s3/${f.id}?sig=1`, mimeType: f.mimeType });

type Cena = Parameters<typeof montarScratchSource>[0][number] & Pick<SceneRow, 'status'>;
const slice = (i: number, start: number, end: number, words: { word: string; startSec: number; endSec: number }[]): Cena => ({
  id: `s${i}`, index: i, label: `L${i}`, attempt: 1, pipeline: 'TAKE_SLICE', takeId: 't1', takeStartSec: D(start), takeEndSec: D(end),
  clipFileId: 'take', thumbnailFileId: null, words: words as unknown as Prisma.JsonValue, startSec: D(start), endSec: D(end), status: 'READY',
});
const scene = (i: number, fileId: string, start: number, end: number): Cena => ({
  id: `c${i}`, index: i, label: `L${i}`, attempt: 2, pipeline: 'SCENE_VIDEO', takeId: null, takeStartSec: null, takeEndSec: null,
  clipFileId: fileId, thumbnailFileId: null, words: [{ word: 'oi', startSec: 0.1, endSec: 0.4 }] as unknown as Prisma.JsonValue,
  startSec: D(start), endSec: D(end), status: 'READY',
});

/** O que o buildInput de antes do editor mandava (renderPieces). */
const antes = (scenes: Cena[], files: Map<string, FileRow>) =>
  renderPieces(scenes as unknown as SceneRow[]).map((p) => {
    const f = p.clipFileId ? files.get(p.clipFileId) : undefined;
    const fsec = f?.durationSec == null ? null : Number(f.durationSec);
    return { clipUrl: f ? `https://s3/${f.id}?sig=1` : '', durationSec: p.durationSec ?? fsec ?? p.fallbackSec, words: p.words };
  });

describe('montarScratchSource + resolverProps (doc nulo = render de hoje)', () => {
  it('take em 3 fatias: emenda no clipe inteiro, a última fatia vai até o fim do arquivo', async () => {
    const scenes = [
      slice(0, 0, 2.345, [{ word: 'a', startSec: 0.1, endSec: 0.5 }]),
      slice(1, 2.345, 5.1, [{ word: 'b', startSec: 0.2, endSec: 0.9 }]),
      slice(2, 5.1, 7.2, [{ word: 'c', startSec: 0.3, endSec: 1.2 }]),
    ];
    const files = new Map([['take', file('take', 7.433)]]);
    const fonte = await montarScratchSource(scenes, files, sign, { format: 'VERTICAL_9_16', language: 'en' });
    expect(fonte.scenes.map((s) => [s.clipStartSec, Number(s.durationSec.toFixed(3))])).toEqual([[0, 2.345], [2.345, 2.755], [5.1, 2.333]]);
    const props = resolverProps(fonte, settings, null);
    const old = antes(scenes, files);
    expect(props.scenes).toHaveLength(1);
    expect(props.scenes[0].clipUrl).toBe(old[0].clipUrl);
    expect(props.scenes[0].durationSec).toBeCloseTo(old[0].durationSec, 9);
    expect(props.scenes[0].words).toEqual(old[0].words);
    expect(props.scenes[0]).not.toHaveProperty('clipStartSec');
    expect(props.layers).toBeUndefined();
  });

  it('cenas soltas: duração do arquivo (sem ela, endSec − startSec), mesma ordem', async () => {
    const scenes = [scene(0, 'f0', 0, 3), scene(1, 'f1', 3, 6.5)];
    const files = new Map([['f0', file('f0', 3.04)], ['f1', file('f1', null)]]);
    const fonte = await montarScratchSource(scenes, files, sign, { format: 'SQUARE_1_1', language: 'pt' });
    const props = resolverProps(fonte, settings, null);
    expect(props.scenes).toEqual(antes(scenes, files));
  });

  it('assina cada arquivo uma vez (fatias do mesmo take com a mesma URL)', async () => {
    let n = 0;
    const scenes = [slice(0, 0, 1, []), slice(1, 1, 2, [])];
    await montarScratchSource(scenes, new Map([['take', file('take', 2)]]), async (f) => ({ id: f.id, url: `u${n++}`, mimeType: 'video/mp4' }), { format: 'VERTICAL_9_16', language: 'en' });
    expect(n).toBe(1);
  });
});

describe('§3.2 e Generate novo', () => {
  const doc: EditDoc = {
    version: 1, trim: null,
    clips: [{ sceneId: 'a', enabled: true, attempt: 1, inSec: 0, outSec: 1 }],
    layers: [
      { id: 'hook', transform: { x: 0.5, y: 0.3, scale: 1, rotationDeg: 0, boxWidth: 0.8 }, text: 'Oi' },
      { id: 'caption', transform: { x: 0.5, y: 0.6, scale: 1.2, rotationDeg: 5, boxWidth: 0.8 } },
    ],
    captionWords: [{ key: 'a@1:0', text: 'x' }],
  };
  it('trocar template apaga todo transform e mantém o resto', () => {
    const d = aplicarMudancaDeSettings(doc, settings, { ...settings, templateId: 'bold' })!;
    expect(d.layers).toEqual([{ id: 'hook', text: 'Oi' }]);
    expect(d.clips).toEqual(doc.clips);
    expect(d.captionWords).toEqual(doc.captionWords);
  });
  it('trocar a posição da legenda apaga só o transform dela', () => {
    const d = aplicarMudancaDeSettings(doc, settings, { ...settings, captionPosition: 'top' })!;
    expect(d.layers).toEqual([doc.layers[0]]);
  });
  it('sem mudança de template/posição = mesmo doc', () => {
    expect(aplicarMudancaDeSettings(doc, settings, { ...settings, ctaText: 'x' })).toBe(doc);
  });
  it('doc que sobra vazio vira null', () => {
    const so: EditDoc = { version: 1, trim: null, clips: [], captionWords: [], layers: [{ id: 'caption', transform: doc.layers[1].transform }] };
    expect(aplicarMudancaDeSettings(so, settings, { ...settings, captionPosition: 'middle' })).toBeNull();
  });
  it('Generate novo zera cortes e correções, mantém camadas', () => {
    const d = docDeGeracaoNova(doc as unknown as Prisma.JsonValue)!;
    expect(d).toMatchObject({ clips: [], captionWords: [], layers: doc.layers });
    expect(docDeGeracaoNova({ version: 1, trim: null, clips: doc.clips, layers: [], captionWords: [] } as unknown as Prisma.JsonValue)).toBeNull();
  });
  it('docTemConteudo', () => {
    expect(docTemConteudo(null)).toBe(false);
    expect(docTemConteudo({ version: 1, trim: null, clips: [], layers: [], captionWords: [] } as unknown as Prisma.JsonValue)).toBe(false);
    expect(docTemConteudo(doc as unknown as Prisma.JsonValue)).toBe(true);
  });
});

describe('gravação do doc', () => {
  it('doc nulo ou vazio vira NULL de SQL (Prisma.DbNull), não JSON null', () => {
    expect(docJson(null)).toBe(Prisma.DbNull);
    expect(docJson({ version: 1, trim: null, clips: [], layers: [], captionWords: [] })).toBe(Prisma.DbNull);
    const d: EditDoc = { version: 1, trim: null, clips: [], layers: [{ id: 'cta', text: 'x' }], captionWords: [] };
    expect(docJson(d)).toBe(d);
  });
  it('leitura trata JSON null e NULL iguais (linha antiga)', () => {
    expect(docTemConteudo(null as unknown as Prisma.JsonValue)).toBe(false);
    expect(docTemConteudo(undefined)).toBe(false);
  });
  it('definidos: DTO de classe não apaga os outros ajustes ao espalhar', () => {
    const dto = plainToInstance(UpdateEditDto, { captionStyle: 'line' });
    expect(Object.keys(dto)).toContain('ctaText'); // o campo existe como undefined (target ES2022+)
    expect({ ...settings, ...definidos(dto) }).toEqual({ ...settings, captionStyle: 'line' });
  });
});
