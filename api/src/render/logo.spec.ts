// kit-marca-v1 §5: logo do kit no render — resolução (URL assinada na hora) e o que entra nas props das composições.
import { autoEditSchema, molduraSchema, placaDoLogo, PLACA_CLARA, PLACA_ESCURA, templateSchema, logoNoFechoChat, fechoChatGeo } from '@maquina/video';
import type { FrameSpec } from '../integracoes/contrato';
import type { AutoEditContext } from './auto-edit';
import { buildFrameInput } from './frame';
import { resolverLogoDaMarca, type LogoDeps } from './logo';

const WS = 'ws1';
const arquivos: Record<string, { id: string; workspaceId: string; storageKey: string; mimeType: string }> = {
  logoPng: { id: 'logoPng', workspaceId: WS, storageKey: 'ws/ws1/BRAND_LOGO/a.png', mimeType: 'image/png' },
  logoSvg: { id: 'logoSvg', workspaceId: WS, storageKey: 'ws/ws1/BRAND_LOGO/b.svg', mimeType: 'image/svg+xml' },
  alheio: { id: 'alheio', workspaceId: 'ws2', storageKey: 'ws/ws2/BRAND_LOGO/c.png', mimeType: 'image/png' },
  pdf: { id: 'pdf', workspaceId: WS, storageKey: 'ws/ws1/BRAND_FILE/d.pdf', mimeType: 'application/pdf' },
  sumiu: { id: 'sumiu', workspaceId: WS, storageKey: 'ws/ws1/BRAND_LOGO/e.png', mimeType: 'image/png' },
};
const deps = (kit: { fileId: string; colors: string[] }[] = [{ fileId: 'logoSvg', colors: ['#5B4BF5', '#FFFFFF'] }]): LogoDeps => ({
  prisma: {
    file: { findUnique: async ({ where }) => arquivos[where.id] ?? null },
    brandAsset: { findFirst: async ({ where }) => kit.find((k) => !where.fileId || k.fileId === where.fileId) ?? null },
  },
  storage: { head: async (k) => (k.includes('e.png') ? null : { sizeBytes: 1 }), signedUrl: async (f) => `https://s3/${f.storageKey}?sig=1` },
});

describe('resolverLogoDaMarca', () => {
  it('spec com marca: usa o logoFileId gravado (URL assinada + cores do kit)', async () => {
    await expect(resolverLogoDaMarca(deps([{ fileId: 'logoPng', colors: ['#E53935'] }]), WS, { brand: { logoFileId: 'logoPng' } }))
      .resolves.toEqual({ url: 'https://s3/ws/ws1/BRAND_LOGO/a.png?sig=1', colors: ['#E53935'] });
  });
  it('spec com marca sem logo (null/ausente) = iniciais, mesmo com logo no kit agora', async () => {
    await expect(resolverLogoDaMarca(deps(), WS, { brand: { name: 'A', logoFileId: null } })).resolves.toBeNull();
    await expect(resolverLogoDaMarca(deps(), WS, { brand: { name: 'A' } })).resolves.toBeNull();
  });
  it('spec sem marca (auto-edit): o logo atual do kit', async () => {
    await expect(resolverLogoDaMarca(deps(), WS, { type: 'STORY' })).resolves.toMatchObject({ url: expect.stringContaining('b.svg'), colors: ['#5B4BF5', '#FFFFFF'] });
    await expect(resolverLogoDaMarca(deps([]), WS, { type: 'STORY' })).resolves.toBeNull();
  });
  it('arquivo de outro workspace, que não é imagem ou que sumiu do storage = sem logo; erro = sem logo', async () => {
    for (const id of ['alheio', 'pdf', 'sumiu', 'nao-existe']) await expect(resolverLogoDaMarca(deps(), WS, { brand: { logoFileId: id } })).resolves.toBeNull();
    const quebra: LogoDeps = { ...deps(), storage: { head: async () => { throw new Error('s3 fora'); }, signedUrl: async () => '' } };
    await expect(resolverLogoDaMarca(quebra, WS, { brand: { logoFileId: 'logoPng' } })).resolves.toBeNull();
  });
  it('asset apagado (o File fica): logo sem cores (placa clara)', async () => {
    const r = await resolverLogoDaMarca(deps([]), WS, { brand: { logoFileId: 'logoPng' } });
    expect(r).toEqual({ url: expect.any(String), colors: [] });
    expect(placaDoLogo(r!.colors)).toBe(PLACA_CLARA);
  });
});

describe('placa do logo (contraste de logo transparente)', () => {
  it('tinta escura/saturada = placa clara; logo branco ou claro = placa escura; PNG opaco de fundo branco = clara', () => {
    expect(placaDoLogo(['#111111'])).toBe(PLACA_CLARA);
    expect(placaDoLogo(['#5B4BF5', '#FFFFFF'])).toBe(PLACA_CLARA);
    expect(placaDoLogo(['#FFFFFF', '#E53935'])).toBe(PLACA_CLARA);
    expect(placaDoLogo(['#FFFFFF'])).toBe(PLACA_ESCURA);
    expect(placaDoLogo(['#FFE14D'])).toBe(PLACA_ESCURA);
    expect(placaDoLogo([])).toBe(PLACA_CLARA);
  });
});

const ctx = (over: Partial<AutoEditContext> = {}): AutoEditContext => ({
  renderId: 'r-logo', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: 'pt',
  source: { videoUrl: 'https://s3/take.mp4', width: 1080, height: 1920, fps: 30, durationSec: 12, hasAudio: true },
  editMap: null, words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null, ...over,
});
const brand = { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5', logoFileId: 'logoSvg' };
const spec = { template: 'post_card', texts: { copy: 'Ninguém te conta isso sobre dor nas costas.' }, screenLanguage: 'pt', brand, faceAtSec: null, second: null, suggestedPrimaryText: null } as unknown as FrameSpec;
const logo = { url: 'https://s3/logo.svg', colors: ['#5B4BF5'] };

describe('props das composições', () => {
  it('moldura: com logo no ctx vai `brand.logo`; o logoFileId (id do banco) não vai pro render; sem logo = só iniciais', () => {
    const com = buildFrameInput(spec, ctx({ brandLogo: logo }), 'VERTICAL_9_16');
    expect(com.frame.brand).toEqual({ name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5', logo });
    expect(molduraSchema.parse({ ...com, kind: undefined, renderId: undefined, templateId: undefined }).frame.brand.logo).toEqual(logo);
    const sem = buildFrameInput(spec, ctx(), 'VERTICAL_9_16');
    expect(sem.frame.brand).toEqual({ name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' });
  });
  it('schemas aceitam logo ausente, null ou {url, colors} (bundle antigo ignora o campo: compatível)', () => {
    const b = { name: 'A', handle: '@a', initials: 'A', color: '#5B4BF5' };
    const brandT = templateSchema.options[0].shape.brand;
    expect(brandT.parse({ ...b, logo }).logo).toEqual(logo);
    expect(brandT.parse({ ...b, logo: null }).logo).toBeNull();
    expect(brandT.parse(b).logo).toBeUndefined();
    expect(autoEditSchema.shape.brandLogo.parse({ url: 'x.png' })).toEqual({ url: 'x.png', colors: [] });
  });
  it('fecho do chat: logo só entra se a cena ainda couber com ele', () => {
    expect(logoNoFechoChat(true, [100, 100], 3, null)).toBe(true);
    expect(logoNoFechoChat(false, [100, 100], 3, null)).toBe(false);
    const apertado = [180, 180, 180];
    expect(fechoChatGeo(apertado, 3, 80).cabe && !fechoChatGeo(apertado, 3, 80, true).cabe).toBe(true);
    expect(logoNoFechoChat(true, apertado, 3, 80)).toBe(false);
  });
});
