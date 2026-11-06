// Porta da troca de texto (V2, troca-texto §16.5-16.6): partes puras, fake e orquestração com executor falso.
// Sem Python, sem Chrome, sem AWS. A prova real (Python + Chrome) é o troca-real.ts.
import type { EditLayer, EditMap } from '@maquina/contratos';
import type { EventoTroca, ExecutorTroca, MedidaHeadline, RespostaTroca, SaidaTroca } from './evento';
import { FakeTrocaTexto } from './fake';
import { centroUnico, escolherAlvo, geometria, montarLook, parametrosDaPlaca, planejarPedacos, rostosMain } from './look';
import { ErroTroca, TrocaTextoOrquestrada } from './orquestra';
import { HEADLINE_PLATE_VERSION, TROCA_TEXTO } from './porta';
import { htmlDaProva, type ProvaChrome } from './prova';
import { ExecutorLambda, lerReport, type InvocadorTroca } from './executor-lambda';
import { trocaConfig, trocaLiberada, criarTrocaTexto } from './index';

const estilo = { fontId: 'arimo-600', uppercase: false, fontSizePx: 27, lineHeight: 1.2, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: true, align: 'center' } as EditLayer['style'];
const camada = (o: Partial<EditLayer>): EditLayer => ({
  id: 'h1', kind: 'headline', startFrame: 0, endFrame: 150, box: { x: 70, y: 535, w: 330, h: 65 },
  background: { kind: 'none', color: null, box: null }, style: estilo, text: 'How to view your man’s\nrecent following on IG 👀', wordsPerPage: null, source: 'vision', ...o,
});
const mapa = (layers: EditLayer[], extra: Partial<EditMap> = {}): EditMap => ({
  version: 1, width: 464, height: 832, fps: 30, frameCount: 240, cells: [], faceTrack: [], layers, overlaysOverFace: [], profile: null,
  keepEdit: { SWAP_AVATAR: { available: false, blockers: [] }, NEW_HOOKS: { available: false, blockers: [] } }, protectedBands: [], ...extra,
}) as EditMap;

/** Medida do solto da S4 (números do troca-real.ts na fixture). */
const medidaSolto = (o: Partial<MedidaHeadline> = {}): MedidaHeadline => ({
  ok: true, reason: null, kind: 'loose', canvas: { width: 464, height: 832 }, fps: 30, quadros: 240, startFrame: 0, endFrame: 161,
  gates: { temporal_p99: 4.7 }, box: null, radiusPx: 0, plate: null, dilatacao: 7, sombra: null, stemPx: 2.5, color: '#fffcf8',
  lines: ['How to view your man’s', 'recent following on IG'], linhasMedidas: [[538, 562, 87, 379, 293], [571, 596, 82, 350, 269]],
  align: 'center', caseStyle: 'sentence', emphasis: null,
  emoji: { char: '👀', image: 'data:image/png;base64,AA', x: 357, y: 566, w: 31, h: 28, lineIndex: 1, side: 'end', gapPx: 8, marginLeftPx: 2, solidity: 0.789, bbox: [359, 566, 385, 591], ocupa: 0.677 },
  sideMarginPx: 23, erasedRects: [{ x: 87, y: 538, w: 293, h: 24 }, { x: 82, y: 571, w: 269, h: 25 }],
  candidatas: [{ fontId: 'arimo-600', cosPillow: 0.78, preStemErr: 0, layout: { sz: 26.87, pitch: 33.5, base: 556.5, cxs: [233.5, 216.5], tr: 0 } }],
  ref: { modo: 'loose' }, ...o,
});

describe('troca de texto: partes puras', () => {
  it('porta publicada: token e versão da placa', () => {
    expect(typeof TROCA_TEXTO).toBe('symbol');
    expect(HEADLINE_PLATE_VERSION).toBe(1);
  });

  it('alvo = 1ª camada no tempo (headline ou text acima de 70 %), não a maior (§15.5.2; caso 06)', () => {
    const cta = camada({ id: 'cta', kind: 'headline', startFrame: 300, endFrame: 400, box: { x: 0, y: 100, w: 700, h: 300 } });
    const gancho = camada({ id: 'gancho', kind: 'text', startFrame: 0, endFrame: 335, box: { x: 0, y: 529, w: 481, h: 130 } });
    const legenda = camada({ id: 'leg', kind: 'caption', startFrame: 0, endFrame: 400 });
    const baixo = camada({ id: 'baixo', kind: 'text', startFrame: 0, endFrame: 100, box: { x: 0, y: 700, w: 400, h: 60 } });
    expect(escolherAlvo(mapa([cta, legenda, baixo, gancho]))?.id).toBe('gancho');
    expect(escolherAlvo(mapa([legenda]))).toBeNull();
  });

  it('A4: centro único = mediana dos centros, com o emoji dentro da linha dele', () => {
    // linha 0: 87..379 → 233; linha 1 com emoji: 82..385 → 233,5
    expect(centroUnico(medidaSolto())).toBe(233.25);
    expect(centroUnico(medidaSolto({ align: 'left' }))).toBeNull();
  });

  it('legenda perto da área repintada = near_caption; longe = limite de baixo com folga', () => {
    const md = medidaSolto();
    const perto = geometria(mapa([camada({})], { protectedBands: [{ x: 90, y: 602, w: 290, h: 80, startSec: 0, endSec: 8 }] }), md);
    expect(perto.reason).toBe('near_caption');
    const longe = geometria(mapa([camada({})], { protectedBands: [{ x: 90, y: 640, w: 290, h: 80, startSec: 0, endSec: 8 }] }), md);
    expect(longe.reason).toBeNull();
    expect(longe.bottomLimitY).toBe(640 - 7);
    // banda em outro tempo não conta
    const outroTempo = geometria(mapa([camada({})], { protectedBands: [{ x: 90, y: 602, w: 290, h: 80, startSec: 10, endSec: 12 }] }), md);
    expect(outroTempo.reason).toBeNull();
  });

  it('rosto main cruzando a área em > 10 % do intervalo = over_face; queixo = p95 do fundo da caixa', () => {
    const face = { startFrame: 0, endFrame: 240, region: { x: 0, y: 0, w: 464, h: 832 }, fullFrame: true, facesMax: 1, minScore: 0.9,
      faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.38 } }] };
    const m = mapa([camada({})], { faceTrack: [face] });
    expect(rostosMain(m)[0].box.y + rostosMain(m)[0].box.h).toBeCloseTo(0.68 * 832, 3);
    const g = geometria(m, medidaSolto());
    expect(g.reason).toBe('over_face');
    expect(g.chinY).toBe(Math.round(0.68 * 832));
    const longe = geometria(mapa([camada({})], { faceTrack: [{ ...face, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.3 } }] }] }), medidaSolto());
    expect(longe.reason).toBeNull();
    expect(longe.chinY).toBe(Math.round(0.5 * 832));
    // outra pessoa nunca bloqueia
    expect(geometria(mapa([camada({})], { faceTrack: [{ ...face, role: 'other_person' }] }), medidaSolto()).reason).toBeNull();
  });

  it('montarLook: solto aprovado vira HeadlineLook v2 com fit, emoji e plateRef', () => {
    const m = mapa([camada({})]);
    const look = montarLook({ layer: m.layers[0], m, md: medidaSolto(), measuredIn: 'chrome-linux',
      regua: { escolhida: 'arimo-600', tier: 'close', medidas: [{ fontId: 'arimo-600', corr: 0.758, stemErr: 0.078, widthErr: 0.007 }] } });
    expect(look.version).toBe(2);
    expect(look.kind).toBe('loose');
    expect([look.startFrame, look.endFrame]).toEqual([0, 161]);
    expect(look.verdict).toMatchObject({ ok: true, reason: null });
    expect(look.font).toMatchObject({ fontId: 'arimo-600', tier: 'close', measuredIn: 'chrome-linux' });
    expect(look.plateRef).toEqual({ kind: 'HEADLINE', layerKey: 'h1', version: 0 });
    expect(look.box).toBeNull();
    expect(look.fit.erasedRects).toHaveLength(2);
    expect(look.fit.emoji).toEqual({ widthPx: 27, gapPx: 8, lineIndex: 1, side: 'end' });
    expect(look.fit.originalLines).toEqual([{ chars: 22, widthPx: 293 }, { chars: 22, widthPx: 269 }]);
    expect(look.text.firstBaselineY).toBe(556.5);
  });

  it('montarLook: ordem dos motivos = medida, fonte, depois legenda/rosto', () => {
    const m = mapa([camada({})], { protectedBands: [{ x: 90, y: 602, w: 290, h: 80, startSec: 0, endSec: 8 }] });
    const far = montarLook({ layer: m.layers[0], m, md: medidaSolto(), measuredIn: 'chrome-linux', regua: { escolhida: null, tier: 'far', medidas: [] } });
    expect(far.verdict.reason).toBe('font_far');
    const emoji = montarLook({ layer: m.layers[0], m, md: medidaSolto({ ok: false, reason: 'emoji_unsupported' }), measuredIn: 'chrome-linux', regua: null });
    expect(emoji.verdict).toMatchObject({ ok: false, reason: 'emoji_unsupported' });
    const legenda = montarLook({ layer: m.layers[0], m, md: medidaSolto(), measuredIn: 'chrome-linux', regua: { escolhida: 'arimo-600', tier: 'same', medidas: [{ fontId: 'arimo-600', corr: 0.9 }] } });
    expect(legenda.verdict.reason).toBe('near_caption');
  });

  it('pedaços da placa: até 4, balanceados pelo custo do intervalo, cobrindo [0, n) sem buraco', () => {
    const p = planejarPedacos(564, 0, 161, 4);
    expect(p).toHaveLength(4);
    expect(p[0][0]).toBe(0);
    expect(p[p.length - 1][1]).toBe(564);
    for (let k = 1; k < p.length; k++) expect(p[k][0]).toBe(p[k - 1][1]);
    expect(p[0][1]).toBeLessThan(80);            // o intervalo pesa: 1º pedaço curto
    expect(planejarPedacos(40, 0, 40, 4)).toEqual([[0, 40]]);
    // G1: vídeo longo com intervalo curto: nenhum pedaço fica com quase tudo o que está fora (antes: 1204 de 1800)
    const longo = planejarPedacos(1800, 0, 161, 4);
    expect(Math.max(...longo.map(([x, y]) => y - x))).toBeLessThan(700);
  });

  it('parâmetros da placa: ROI com emoji, dilatação ímpar escalada, redesenho pelo centro de cada linha', () => {
    const m = mapa([camada({})]);
    const look = montarLook({ layer: m.layers[0], m, md: medidaSolto(), measuredIn: 'chrome-linux', regua: { escolhida: 'arimo-600', tier: 'same', medidas: [{ fontId: 'arimo-600', corr: 0.9 }] } });
    const p = parametrosDaPlaca(look, 464, 832);
    expect(p.dil).toBe(7);
    expect(p.brilho).toBe(205);
    expect(p.roi[0]).toBeLessThanOrEqual(82 - 12);
    expect(p.roi[0] + p.roi[2]).toBeGreaterThanOrEqual(388);
    expect(p.redesenho?.cxs).toEqual([87 + 293 / 2, 82 + 269 / 2]);
    expect(p.emoji).toEqual([359, 566, 387, 593]);
  });

  it('HTML da prova: fonte embutida, sem fonte do sistema, dados da linha', () => {
    const h = htmlDaProva({ fontId: 'arimo-600', lines: ['a'], layout: { sz: 26, pitch: 33, base: 557, cxs: [233], tr: 0 }, color: '#fff', shadow: null, suavizaPx: 0.4, canvas: { width: 464, height: 832 } }, 'QUJD');
    expect(h).toContain('data:font/woff2;base64,QUJD');
    expect(h).not.toMatch(/System\/Library|Helvetica/);
    expect(h).toContain('"cxs":[233]');
  });

  it('REPORT da Lambda → custo', () => {
    const log = Buffer.from('REPORT RequestId: x\tDuration: 1200.5 ms\tBilled Duration: 1201 ms\tMemory Size: 3008 MB\tMax Memory Used: 600 MB').toString('base64');
    expect(lerReport(log)).toEqual({ billedMs: 1201, memMb: 3008 });
    expect(lerReport(undefined)).toEqual({ billedMs: null, memMb: null });
  });

  it('config: PLATE_IMPL padrão off; workspace liberado; lambda sem credencial falha no boot', () => {
    const off = trocaConfig(() => undefined);
    expect(off.impl).toBe('off');
    expect(trocaLiberada(off, 'w')).toBe(false);
    expect(criarTrocaTexto(off, { storage: {} as never })).toBeNull();
    const lig = trocaConfig((k) => ({ PLATE_IMPL: 'lambda', PLATE_WORKSPACE_IDS: 'w1, w2' } as Record<string, string>)[k]);
    expect(trocaLiberada(lig, 'w2')).toBe(true);
    expect(trocaLiberada(lig, 'w3')).toBe(false);
    expect(() => criarTrocaTexto(lig, { storage: {} as never, prova: { renderizar: async () => [] } })).toThrow(/sem REMOTION_AWS/);
    expect(() => trocaConfig((k) => (k === 'PLATE_IMPL' ? 'on' : undefined))).toThrow(/inválido/);
  });
});

describe('troca de texto: fake', () => {
  it('mede (box pelo fundo da camada), reprova quando pedido, e grava a placa', async () => {
    const gravadas: string[] = [];
    const caixa = camada({ background: { kind: 'solid', color: '#960101', box: { x: 0, y: 586, w: 628, h: 220 } }, text: 'If he\ncalls' });
    const f = new FakeTrocaTexto({ gravar: async (k) => { gravadas.push(k); } });
    const m = await f.medirHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'x', editMap: mapa([caixa]) });
    expect(m.look).toMatchObject({ kind: 'box', verdict: { ok: true }, font: { tier: 'same' } });
    expect(m.look!.plate?.image).toMatch(/^data:image\/png;base64,/);
    const solto = await f.medirHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'x', editMap: mapa([camada({})]) });
    const p = await f.placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'x', look: solto.look!, version: 1, outputKey: 'k/placa.mp4' });
    expect(p).toMatchObject({ status: 'READY', reason: null });
    expect(gravadas).toEqual(['k/placa.mp4']);
    const rep = new FakeTrocaTexto({ motivo: 'over_face', placa: 'REJECTED' });
    const r = await rep.medirHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'x', editMap: mapa([camada({})]) });
    expect(r.look!.verdict).toMatchObject({ ok: false, reason: 'over_face' });
    expect((await rep.placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'x', look: solto.look!, version: 1, outputKey: 'k' })).reason).toBe('plate_rejected');
    expect(await f.medirHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'x', editMap: mapa([]) })).toMatchObject({ look: null });
  });
});

/** Executor falso: responde por op; conta chamadas; falha o pedaço `falhar` N vezes. */
class ExecFalso implements ExecutorTroca {
  readonly impl = 'local' as const;
  readonly eventos: EventoTroca[] = [];
  readonly apagados: string[] = [];
  publicado: string | null = null;
  constructor(private readonly o: { md?: MedidaHeadline; fantasma?: number; falhar?: { ini: number; vezes: number }; quadrosJuntar?: number } = {}) {}
  async executar(ev: EventoTroca) {
    this.eventos.push(ev);
    let r: RespostaTroca;
    if (ev.op === 'medir_headline' && ev.fase === 'medida') r = { op: 'medir_headline', ok_op: true, ...(this.o.md ?? medidaSolto()) } as RespostaTroca;
    else if (ev.op === 'medir_headline') r = { op: 'medir_headline', ok_op: true, escolhida: 'arimo-600', tier: 'close', medidas: [{ fontId: 'arimo-600', corr: 0.76, stemErr: 0.08, widthErr: 0.007 }] };
    else if (ev.op === 'sondar') r = { op: 'sondar', ok_op: true, n: 564 };
    else if (ev.op === 'placa_headline') {
      if (this.o.falhar && ev.ini === this.o.falhar.ini && this.o.falhar.vezes-- > 0) r = { op: 'placa_headline', ok_op: false, erro: 'MemoryError' };
      else r = { op: 'placa_headline', ok_op: true, fantasma_pior_media: this.o.fantasma ?? 0.3, fantasma_pior_corr: 0.013, mascara_px: 13581 };
    } else if (ev.op === 'juntar') r = { op: 'juntar', ok_op: true, quadros: this.o.quadrosJuntar ?? 564, tam_saida: { placa: 123 } };
    else r = { op: String(ev.op), ok_op: true };
    return { r, costUsd: 0.001, ms: 5 };
  }
  async destino(nome: string): Promise<SaidaTroca> { return { destino: `/tmp/x/${nome}`, ref: `/tmp/x/${nome}` }; }
  async origem(s: SaidaTroca) { return s.ref; }
  async publicar(_s: SaidaTroca, chave: string) { this.publicado = chave; }
  async apagar(s: SaidaTroca) { this.apagados.push(s.ref); }
}
const provaFalsa: ProvaChrome = { renderizar: async (ps) => ps.map((p) => ({ fontId: p.fontId, png: 'data:image/png;base64,AA' })) };

describe('troca de texto: orquestração', () => {
  const m = mapa([camada({})]);
  const medir = async (ex: ExecFalso) => (await new TrocaTextoOrquestrada(ex, provaFalsa).medirHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', editMap: m })).look!;

  it('medir: medida → prova das candidatas → régua → look; custo somado', async () => {
    const ex = new ExecFalso();
    const r = await new TrocaTextoOrquestrada(ex, provaFalsa).medirHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', editMap: m });
    expect(ex.eventos.map((e) => `${e.op}:${e.fase ?? ''}`)).toEqual(['medir_headline:medida', 'medir_headline:regua']);
    expect(ex.eventos[0].get).toEqual({ 'video.mp4': 'u' });
    expect((ex.eventos[1] as unknown as { stills: unknown[] }).stills).toHaveLength(1);
    expect(r.look).toMatchObject({ kind: 'loose', font: { fontId: 'arimo-600', tier: 'close' }, verdict: { ok: true } });
    expect(r.costUsd).toBeCloseTo(0.002, 6);
  });

  it('medir: medida reprovada não chama a prova nem a régua', async () => {
    const ex = new ExecFalso({ md: medidaSolto({ ok: false, reason: 'fades' }) });
    const look = await medir(ex);
    expect(ex.eventos).toHaveLength(1);
    expect(look.verdict).toMatchObject({ ok: false, reason: 'fades' });
  });

  it('placa: 4 pedaços em paralelo, juntar, publica na chave e apaga os temporários', async () => {
    const ex = new ExecFalso();
    const look = await medir(ex);
    const r = await new TrocaTextoOrquestrada(ex, provaFalsa).placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', look, version: 1, outputKey: 'ws/placa.mp4' });
    expect(r).toMatchObject({ status: 'READY', reason: null, sizeBytes: 123 });
    expect(r.metrics).toMatchObject({ pedacos: 4, quadros: 564, quadros_placa: 564 });
    expect(ex.eventos.filter((e) => e.op === 'placa_headline')).toHaveLength(4);
    expect(ex.publicado).toBe('ws/placa.mp4');
    expect(ex.apagados.filter((a) => /p0\d\.mp4$/.test(a))).toHaveLength(4);
  });

  it('placa: pedaço que falha 1 vez é repetido; 2 vezes = FAILED plate_failed', async () => {
    const ex1 = new ExecFalso({ falhar: { ini: 0, vezes: 1 } });
    const look = await medir(ex1);
    expect((await new TrocaTextoOrquestrada(ex1, provaFalsa).placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', look, version: 1, outputKey: 'k' })).status).toBe('READY');
    const ex2 = new ExecFalso({ falhar: { ini: 0, vezes: 2 } });
    const r = await new TrocaTextoOrquestrada(ex2, provaFalsa).placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', look, version: 1, outputKey: 'k' });
    expect(r).toMatchObject({ status: 'FAILED', reason: 'plate_failed' });
    expect(ex2.eventos.some((e) => e.op === 'juntar')).toBe(false);
  });

  it('placa: fantasma acima do limite (A2) = REJECTED, sem juntar; quadros errados no juntar = FAILED', async () => {
    const ex = new ExecFalso({ fantasma: 6.5 });
    const look = await medir(ex);
    const r = await new TrocaTextoOrquestrada(ex, provaFalsa).placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', look, version: 1, outputKey: 'k' });
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'plate_rejected' });
    expect(ex.eventos.some((e) => e.op === 'juntar')).toBe(false);
    const ex2 = new ExecFalso({ quadrosJuntar: 560 });
    expect((await new TrocaTextoOrquestrada(ex2, provaFalsa).placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', look, version: 1, outputKey: 'k' })).reason).toBe('plate_failed');
  });

  it('placa em caixa é erro de uso', async () => {
    const ex = new ExecFalso();
    const look = { ...(await medir(ex)), kind: 'box' as const };
    await expect(new TrocaTextoOrquestrada(ex, provaFalsa).placaHeadline({ workspaceId: 'w', championId: 'c', videoUrl: 'u', look, version: 1, outputKey: 'k' })).rejects.toBeInstanceOf(ErroTroca);
  });

  it('executor lambda: URLs assinadas por pedaço, chave final direta, custo pelo REPORT', async () => {
    const chamadas: EventoTroca[] = [];
    const inv: InvocadorTroca = { invocar: async (ev) => { chamadas.push(ev); return { resposta: { op: String(ev.op), ok_op: true, n: 10 }, billedMs: 2000, memMb: 3008 }; } };
    const st = { tmpPrefix: 'troca-tmp/', presignPut: async (k: string) => `PUT:${k}`, presignGet: async (k: string) => `GET:${k}`, remove: async () => undefined };
    const ex = new ExecutorLambda(inv, st, { urlTtlSec: 60, memMb: 3008 });
    const r = await ex.executar({ v: 1, op: 'sondar' });
    expect(r.costUsd).toBeCloseTo(2 * (3008 / 1024) * 0.0000166667 + 0.0000002, 9);   // x86_64 desde o G1
    const d = await ex.destino('p00.mp4', 'video/mp4');
    expect(d.destino).toMatch(/^PUT:troca-tmp\/.+\/p00\.mp4$/);
    expect(await ex.origem(d)).toBe(`GET:${d.ref}`);
    const f = await ex.destino('placa.mp4', 'video/mp4', 'ws/final.mp4');
    expect(f).toEqual({ destino: 'PUT:ws/final.mp4', ref: 'ws/final.mp4' });
    await expect(ex.publicar(d, 'ws/final.mp4')).rejects.toThrow();
  });
});
