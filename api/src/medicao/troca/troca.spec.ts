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
import { PORTOES_LEGENDA, PORTOES_PLACA, agregarConferencias, avaliarPlacaLegenda, pioresQuadros, avaliarPortoesLegenda, CAPTION_PLATE_VERSION, planejarPedacosLegenda, portoesPessoa } from './legenda';
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

  it('Q1-B1: caixa sobre o rosto (02 da S4) é oferecida; o portão do rosto só vale para o solto (§15.5.5, §16.4)', () => {
    // faceTrack medido de verdade em research_notes/s4-demo-2026-11-06/origem/c02.mp4 (FfmpegMediaAnalysisService.faceTrack, 07/11)
    const faceTrack = [
      { startFrame: 0, endFrame: 198, region: { x: 0, y: 225, w: 716, h: 1053 }, fullFrame: false, facesMax: 1, minScore: 0.913,
        faceInRegion: [{ atFrame: 0, box: { x: 0.207, y: -0.0068, w: 0.5833, h: 0.5329 } }] },
      { startFrame: 198, endFrame: 290, region: { x: 0, y: 0, w: 716, h: 1278 }, fullFrame: true, facesMax: 1, minScore: 0.929,
        faceInRegion: [{ atFrame: 200, box: { x: 0.2156, y: 0.1597, w: 0.5941, h: 0.4721 } }] },
    ];
    // medida da caixa do 02 (look-s4-02.json da Q1 + linhas de medidas/caixa-02.json da S4)
    const md02: MedidaHeadline = {
      ok: true, reason: null, kind: 'box', canvas: { width: 716, height: 1278 }, fps: 30, quadros: 290, startFrame: 0, endFrame: 198,
      gates: { temporal_p99: 17, halo_p99: 8.3 }, box: { x: 0, y: 0, w: 716, h: 246 }, radiusPx: 0,
      plate: { color: '#000000', image: 'data:image/png;base64,AA', temporalP99: 17, translucent: true }, dilatacao: 9, sombra: null, stemPx: 0,
      color: '#f6fcff', lines: ['Si en 2 minutos no te', 'busca, es porque', 'nunca fue para ti..'],
      linhasMedidas: [[24, 73, 16, 680, 665], [93, 151, 78, 618, 541], [160, 218, 67, 630, 564]], align: 'center', caseStyle: 'sentence', emphasis: null,
      emoji: null, sideMarginPx: 36, erasedRects: [], candidatas: [], ref: { modo: 'box' },
    };
    const leg = { x: 60, y: 900, w: 600, h: 120, startSec: 0, endSec: 9.67 };
    const m = mapa([camada({ background: { kind: 'solid', color: '#000000', box: { x: 0, y: 0, w: 716, h: 246 } } })],
      { width: 716, height: 1278, frameCount: 290, faceTrack, protectedBands: [leg] });
    const caixa = geometria(m, md02);
    expect(caixa.gates.rosto_frac).toBe(1); // o rosto cruza a faixa o intervalo todo, como no QA
    expect(caixa.reason).toBeNull();
    expect(montarLook({ layer: m.layers[0], m, md: md02, regua: null, measuredIn: 'chrome-linux' }).verdict).toMatchObject({ ok: true, reason: null });
    // a mesma geometria apagada por inpaint (solto) continua barrada
    expect(geometria(m, { ...md02, kind: 'loose', box: null }).reason).toBe('over_face');
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

const detFalso = (o: Record<string, unknown> = {}) => ({
  detectou: true, quadros: 240, fps: 30, faixa: [560, 680], caixa: false, atrasoSec: 0.1, cortes: [120],
  gates: { cobertura: 0.97, contorno: 1, linhas: 1, animacao: 0.01, iou_mediana: 0.76, herdados: 0.03, estilo_var: 0.01, fundo_lap: 30, alfabeto_fora: 0, emoji_legenda: 0 },
  estilo: { fontId: 'gabarito-900', tamPx: 55, tracking: 0, espaco: 0.5, strokePx: 3, sombra: [0, 2], corTexto: '#ffffff', corDestaque: '#fcf000', corTraco: '#000000', caixaDestaque: null, palavrasPorPagina: 3, linhas: 1, baseY: 620, centroX: 232 },
  trechos: [{ iniFrame: 0, fimFrame: 60, box: [40, 590, 380, 40], iou: 0.78, texto: 'if he calls', herdado: false }, { iniFrame: 60, fimFrame: 150, box: [40, 590, 380, 40], iou: 0.75, texto: 'you after midnight', herdado: false }],
  pegada: [{ iniFrame: 0, fimFrame: 60, areaPx: 3000 }, { iniFrame: 60, fimFrame: 150, areaPx: 4000 }], ...o,
});
/** Conferência falsa: janelas de 15 quadros, bom ou ruim. */
const confFalsa = (ini: number, fim: number, ruim: boolean) => ({
  ini, fim, janelas: Array.from({ length: Math.ceil((fim - ini) / 15) }, (_, k) => ({ iniFrame: ini + k * 15, ruim, corte: false, lisura: ruim ? 0.3 : 0.8, trem: ruim ? 5 : 1.5, degrau: ruim ? 4 : 1.2, detalhe: 40 })),
  fora_buraco_media: 0.5, fora_buraco_pior: 1, fora_valor_soma: 0.5 * (fim - ini), fora_valor_n: fim - ini, letra_valores: [0.1, 0.2], salto_emenda_db: [42], matriz_desconhecida: false, quadros_video: 240, quadros_placa: 240,
});

/** Executor falso: responde por op; conta chamadas; falha o pedaço `falhar` N vezes. */
class ExecFalso implements ExecutorTroca {
  readonly impl = 'local' as const;
  readonly eventos: EventoTroca[] = [];
  readonly apagados: string[] = [];
  publicado: string | null = null;
  constructor(private readonly o: { md?: MedidaHeadline; fantasma?: number; falhar?: { ini: number; vezes: number }; quadrosJuntar?: number; det?: Record<string, unknown>; falharLegenda?: { ini: number; vezes: number }; ruim?: boolean } = {}) {}
  async executar(ev: EventoTroca) {
    this.eventos.push(ev);
    let r: RespostaTroca;
    if (ev.op === 'medir_headline' && ev.fase === 'medida') r = { op: 'medir_headline', ok_op: true, ...(this.o.md ?? medidaSolto()) } as RespostaTroca;
    else if (ev.op === 'medir_headline') r = { op: 'medir_headline', ok_op: true, escolhida: 'arimo-600', tier: 'close', medidas: [{ fontId: 'arimo-600', corr: 0.76, stemErr: 0.08, widthErr: 0.007 }] };
    else if (ev.op === 'sondar') r = { op: 'sondar', ok_op: true, n: 564 };
    else if (ev.op === 'detectar') r = { op: 'detectar', ok_op: true, ...(this.o.det ?? detFalso()) } as RespostaTroca;
    else if (ev.op === 'placa_legenda') {
      if (this.o.falharLegenda && this.o.falharLegenda.ini === ev.ini && this.o.falharLegenda.vezes-- > 0) r = { op: 'placa_legenda', ok_op: false, erro: 'MemoryError' };
      else r = { op: 'placa_legenda', ok_op: true, quadros: Number(ev.fim) - Number(ev.ini) };
    } else if (ev.op === 'conferir_legenda') r = { op: 'conferir_legenda', ok_op: true, ...confFalsa(Number(ev.ini), Number(ev.fim), this.o.ruim ?? false) } as RespostaTroca;
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

describe('troca de texto: legenda (F2, porta + fake)', () => {
  const leg = camada({ id: 'leg', kind: 'caption', text: null, wordsPerPage: 3, box: { x: 40, y: 600, w: 380, h: 60 } });
  const words = 'if he calls you after midnight then he is not serious about you'.split(' ').map((w, k) => ({ word: w, startSec: k * 0.4, endSec: k * 0.4 + 0.35 }));
  const pedido = (o: Record<string, unknown> = {}) => ({ workspaceId: 'w', championId: 'c', videoUrl: 'x', editMap: mapa([leg]), words, durationSec: 30, ...o });

  // RECALIBRAÇÃO S3 (12/11), APERTADA por decisão do Gusta: aprovam 30, 27, 54, 07 e 26 (=05); reprovam 09 e 37 (e os fora do escopo). Gates medidos na Lambda
  // de teste (hookmill-legenda-f2). Ver calibracao.md (inicial → folgado → final).
  const APROVADOS: Record<string, Record<string, number>> = {
    '30': { duracao_s: 46, cobertura: 0.909, contorno: 1, linhas: 1, animacao: 0, iou_mediana: 0.760, herdados: 0.439, estilo_var: 0.018, fundo_lap: 37.63, pessoa_rosto: 1, pessoa_fala: 0.828 },
    '27': { duracao_s: 34, cobertura: 0.945, contorno: 1, linhas: 1, animacao: 0, iou_mediana: 0.500, herdados: 0.062, estilo_var: 0.028, fundo_lap: 35.6, pessoa_rosto: 1, pessoa_fala: 0.817 },
    '54': { duracao_s: 34, cobertura: 0.951, contorno: 1, linhas: 1, animacao: 0, iou_mediana: 0.497, herdados: 0.125, estilo_var: 0.027, fundo_lap: 35.0, pessoa_rosto: 1, pessoa_fala: 0.744 },
    '07': { duracao_s: 17.6, cobertura: 0.982, contorno: 1, linhas: 1, animacao: 0.005, iou_mediana: 0.806, herdados: 0.404, estilo_var: 0.031, fundo_lap: 14.86, pessoa_rosto: 1, pessoa_fala: 0.84 },
    '26': { duracao_s: 49, cobertura: 0.795, contorno: 1, linhas: 1, animacao: 0, iou_mediana: 0.368, herdados: 0.489, estilo_var: 0, fundo_lap: 5.32, pessoa_rosto: 1, pessoa_fala: 0.85 },
  };
  // reprovados (valores medidos): o motivo esperado = o primeiro portão da ordem da tabela que cada um viola
  const REPROVADOS: Array<[string, Record<string, number>, string]> = [
    ['09', { duracao_s: 28, cobertura: 0.764, contorno: 1, linhas: 1, animacao: 0.014, iou_mediana: 0.291, herdados: 0.858, estilo_var: 0.018, fundo_lap: 29.5, pessoa_rosto: 1, pessoa_fala: 0.943 }, 'not_detected'],
    ['37', { duracao_s: 27, cobertura: 0.997, contorno: 1, linhas: 1, animacao: 0, iou_mediana: 0.363, herdados: 0.5, estilo_var: 0, fundo_lap: 28.9, pessoa_rosto: 1, pessoa_fala: 0.788 }, 'font_mismatch'],
    ['00', { duracao_s: 24, cobertura: 0.97, contorno: 1, linhas: 1, animacao: 0.015, iou_mediana: 0.419, herdados: 0.566, estilo_var: 0.074, fundo_lap: 14 }, 'font_mismatch'],
    ['29', { duracao_s: 39.4, pessoa_rosto: 1, pessoa_fala: 0.694, cobertura: 0.597, contorno: 1, linhas: 2, animacao: 0.472, iou_mediana: 0.374, herdados: 0.825, estilo_var: 0, fundo_lap: 47.1 }, 'not_detected'],
    ['11', { duracao_s: 33.9, cobertura: 0.638, contorno: 1, linhas: 1, animacao: 0.464, iou_mediana: 0.286, herdados: 0.906, estilo_var: 0, fundo_lap: 52.7 }, 'not_detected'],
    ['02', { duracao_s: 24.8, cobertura: 0.993, contorno: 1, linhas: 1, animacao: 0.023, iou_mediana: 0.273, herdados: 0.206, estilo_var: 0, fundo_lap: 35.1 }, 'animated'],
  ];

  it('portões pré-placa apertados: 30, 27, 54, 07 e 26 passam; cada limite fica logo acima do pior deles', () => {
    for (const [id, g] of Object.entries(APROVADOS)) expect({ id, ...avaliarPortoesLegenda(g) }).toEqual({ id, swap: true, reason: null });
    const max = (k: string) => Math.max(...Object.values(APROVADOS).map((g) => g[k]));
    const min = (k: string) => Math.min(...Object.values(APROVADOS).map((g) => g[k]));
    expect(min('cobertura') - PORTOES_LEGENDA.cobertura).toBeLessThan(0.01); expect(PORTOES_LEGENDA.cobertura).toBeLessThanOrEqual(min('cobertura'));
    expect(min('iou_mediana') - PORTOES_LEGENDA.iouMediana).toBeLessThan(0.01); expect(PORTOES_LEGENDA.iouMediana).toBeLessThanOrEqual(min('iou_mediana'));
    expect(PORTOES_LEGENDA.herdados - max('herdados')).toBeLessThan(0.01); expect(PORTOES_LEGENDA.herdados).toBeGreaterThanOrEqual(max('herdados'));
    expect(PORTOES_LEGENDA.estiloVar - max('estilo_var')).toBeLessThan(0.01);
    expect(PORTOES_LEGENDA.fundoLap - max('fundo_lap')).toBeLessThan(3);
    expect(PORTOES_LEGENDA.animacao - max('animacao')).toBeLessThan(0.02);
    expect(min('pessoa_fala') - PORTOES_LEGENDA.pessoaFala).toBeLessThan(0.01);
  });

  it('portões pré-placa: 09, 37 e os fora do escopo reprovam pelo motivo certo', () => {
    for (const [id, g, motivo] of REPROVADOS) expect({ id, ...avaliarPortoesLegenda(g) }).toEqual({ id, swap: false, reason: motivo });
  });

  it('portões pré-placa: ordem da tabela, duração e chave ausente não reprova', () => {
    const bom = APROVADOS['30'];
    expect(avaliarPortoesLegenda({})).toEqual({ swap: true, reason: null });
    expect(avaliarPortoesLegenda({ ...bom, duracao_s: 61 }).reason).toBe('too_long');
    expect(avaliarPortoesLegenda({ ...bom, duracao_s: 61 }, { legendaMaxSec: 130 }).swap).toBe(true);
    expect(avaliarPortoesLegenda({ ...bom, iou_mediana: 0.482 }).swap).toBe(true);   // 0,482 (120 s) passa o IoU novo: o 120 s só reprova pela cobertura (0,74)
    expect(avaliarPortoesLegenda({ ...bom, linhas: 2 }).reason).toBe('multi_line');   // 2 linhas continua reprovando (F2b)
    expect(avaliarPortoesLegenda({ ...bom, contorno: 0, cobertura: 0.5 }).reason).toBe('not_detected');
    expect(avaliarPortoesLegenda({ ...bom, contorno: 0 }).reason).toBe('no_outline');
    expect(avaliarPortoesLegenda({ ...bom, pessoa_fala: 0.7 }).reason).toBe('no_person');
    expect(avaliarPortoesLegenda({ ...bom, alfabeto_fora: 1, duracao_s: 10 }).reason).toBe('script_unsupported');
    expect(avaliarPortoesLegenda({ ...bom, fundo_lap: 41 }).reason).toBe('busy_background');
  });

  it('portões pós-placa apertados: o pior dos que passam passa, logo acima; 09 e 37 reprovam', () => {
    // pior por medida entre 30, 27, 54, 07 e 26 (Lambda de teste): ruim_pct 0,77 (07), gancho 1,0 (30, 07), letra 3,45 (07), fora 1,22 (54)
    const pior = { quadros: 900, quadros_placa: 900, ruim_pct: 0.77, ruim_gancho_s: 1.0, letra_p95_pct: 3.45, fora_buraco_media: 1.22, cor_deslocamento: 0 };
    expect(avaliarPlacaLegenda(pior)).toBeNull();
    expect(PORTOES_PLACA.ruimPct - pior.ruim_pct).toBeLessThan(0.05);
    expect(PORTOES_PLACA.ruimGanchoS - pior.ruim_gancho_s).toBeLessThanOrEqual(0.5);
    expect(PORTOES_PLACA.letraP95Pct - pior.letra_p95_pct).toBeLessThan(1);
    expect(PORTOES_PLACA.foraBuracoMedia - pior.fora_buraco_media).toBeLessThan(0.1);
    // 09 (Lambda): ruim 0,74, gancho 2,0, letra 8,44, fora 1,56 → reprova por gancho, letra e fora
    expect(avaliarPlacaLegenda({ ...pior, ruim_pct: 0.74, ruim_gancho_s: 2.0, letra_p95_pct: 8.44, fora_buraco_media: 1.56 })).toBe('plate_rejected');
    expect(avaliarPlacaLegenda({ ...pior, letra_p95_pct: 8.44 })).toBe('plate_rejected');      // só a letra já reprova o 09
    expect(avaliarPlacaLegenda({ ...pior, fora_buraco_media: 1.56 })).toBe('plate_rejected');
    expect(avaliarPlacaLegenda({ ...pior, ruim_pct: 0.83, ruim_gancho_s: 3, fora_buraco_media: 1.51 })).toBe('plate_rejected');   // 37
    expect(avaliarPlacaLegenda({ ...pior, quadros_placa: 899 })).toBe('plate_failed');
    expect(avaliarPlacaLegenda({ ...pior, cor_deslocamento: 1.4 })).toBe('color_shift');
    expect(CAPTION_PLATE_VERSION).toBe(1);
  });

  it('fake: detectar devolve captionTrack com as mesmas palavras, fim = início da próxima página (A7) e veredito swap', async () => {
    const f = new FakeTrocaTexto();
    const r = await f.detectarLegenda(pedido());
    const t = r.captionTrack!;
    expect(t.veredito).toMatchObject({ swap: true, reason: null });
    expect(t.trechos.map((x) => x.texto).join(' ')).toBe(words.map((w) => w.word).join(' '));
    expect(t.trechos[0].texto).toBe('if he calls');
    t.trechos.slice(0, -1).forEach((x, k) => expect(x.fimFrame).toBe(t.trechos[k + 1].iniFrame));
    expect(t.trechos.at(-1)!.fimFrame).toBe(240);
    expect(t.pegada).toHaveLength(t.trechos.length);
    expect(t.estilo.palavrasPorPagina).toBe(3);
    expect(JSON.stringify(await f.detectarLegenda(pedido()))).toBe(JSON.stringify(r)); // determinístico
  });

  it('fake: sem camada caption = captionTrack null; > 60 s = too_long; motivo forçado vira veredito e gates', async () => {
    const f = new FakeTrocaTexto();
    expect((await f.detectarLegenda(pedido({ editMap: mapa([camada({})]) }))).captionTrack).toBeNull();
    expect((await f.detectarLegenda(pedido({ durationSec: 90 }))).captionTrack!.veredito).toMatchObject({ swap: false, reason: 'too_long' });
    expect((await f.detectarLegenda(pedido({ durationSec: 90, legendaMaxSec: 130 }))).captionTrack!.veredito.swap).toBe(true);
    const r = await new FakeTrocaTexto({ motivoLegenda: 'font_mismatch' }).detectarLegenda(pedido());
    expect(r.captionTrack!.veredito).toMatchObject({ swap: false, reason: 'font_mismatch' });
    expect(r.captionTrack!.veredito.gates.iou_mediana).toBeLessThan(0.6);
  });

  it('fake: placa READY grava na chave; REJECTED e FAILED trazem motivo; veredito sem swap é erro de uso', async () => {
    const gravadas: string[] = [];
    const f = new FakeTrocaTexto({ gravar: async (k) => { gravadas.push(k); } });
    const track = (await f.detectarLegenda(pedido())).captionTrack!;
    const base = { workspaceId: 'w', championId: 'c', videoUrl: 'x', captionTrack: track, version: 1, outputKey: 'k/legenda.mp4' };
    const ok = await f.placaLegenda(base);
    expect(ok).toMatchObject({ status: 'READY', reason: null });
    expect(ok.metrics.quadros).toBe(ok.metrics.quadros_placa);
    expect(gravadas).toEqual(['k/legenda.mp4']);
    const rej = await new FakeTrocaTexto({ placaLegenda: 'REJECTED' }).placaLegenda(base);
    expect(rej).toMatchObject({ status: 'REJECTED', reason: 'plate_rejected', sizeBytes: null });
    expect(rej.metrics.ruim_gancho_s).toBeGreaterThanOrEqual(1);
    expect(await new FakeTrocaTexto({ placaLegenda: 'FAILED' }).placaLegenda(base)).toMatchObject({ status: 'FAILED', reason: 'plate_failed' });
    const ruim = (await new FakeTrocaTexto({ motivoLegenda: 'busy_background' }).detectarLegenda(pedido())).captionTrack!;
    await expect(f.placaLegenda({ ...base, captionTrack: ruim })).rejects.toBeInstanceOf(ErroTroca);
  });
});

describe('troca de texto: legenda (orquestra com executor falso)', () => {
  const leg = camada({ id: 'leg', kind: 'caption', text: null, wordsPerPage: 3, box: { x: 40, y: 600, w: 380, h: 60 } });
  const words = 'if he calls you after midnight then he is not serious'.split(' ').map((w, k) => ({ word: w, startSec: k * 0.4, endSec: k * 0.4 + 0.4 }));
  const face = { startFrame: 0, endFrame: 240, region: { x: 0, y: 0, w: 464, h: 832 }, fullFrame: true, facesMax: 1, minScore: 0.9, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.3 } }] };
  const ped = (o: Record<string, unknown> = {}) => ({ workspaceId: 'w', championId: 'c', videoUrl: 'u', editMap: mapa([leg], { faceTrack: [face] as never }), words, durationSec: 8, artefatoKey: 'champions/c/caption-data.npz', ...o });

  it('detectar: junta a op Python + pessoa_* do faceTrack, grava o artefato na chave e devolve swap', async () => {
    const ex = new ExecFalso();
    const o = new TrocaTextoOrquestrada(ex, provaFalsa);
    const r = await o.detectarLegenda(ped());
    const t = r.captionTrack!;
    expect(t.veredito).toMatchObject({ swap: true, reason: null });
    expect(t.veredito.gates.pessoa_rosto).toBe(1);
    expect(t.veredito.gates.pessoa_fala).toBeGreaterThan(0.8);
    expect(t.artefato).toBe('champions/c/caption-data.npz');
    expect(t.estilo.fontId).toBe('gabarito-900');
    expect(t.trechos[0].box).toEqual({ x: 40, y: 590, w: 380, h: 40 });
    expect(ex.eventos[0]).toMatchObject({ op: 'detectar', fontIdVisao: 'arimo-600', words });
    expect(ex.publicado).toBe('champions/c/caption-data.npz');
  });

  it('detectar: sem caption = null; > teto = too_long sem chamar a função; reprovado apaga o artefato', async () => {
    const ex = new ExecFalso();
    const o = new TrocaTextoOrquestrada(ex, provaFalsa);
    expect((await o.detectarLegenda(ped({ editMap: mapa([camada({})]) }))).captionTrack).toBeNull();
    const longo = await o.detectarLegenda(ped({ durationSec: 90 }));
    expect(longo.captionTrack!.veredito).toMatchObject({ swap: false, reason: 'too_long' });
    expect(ex.eventos).toHaveLength(0);
    const ex2 = new ExecFalso({ det: detFalso({ gates: { cobertura: 0.97, contorno: 1, iou_mediana: 0.2, herdados: 0.03 } }) });
    const rep = await new TrocaTextoOrquestrada(ex2, provaFalsa).detectarLegenda(ped());
    expect(rep.captionTrack!.veredito).toMatchObject({ swap: false, reason: 'font_mismatch' });
    expect(rep.captionTrack!.artefato).toBeNull();
    expect(ex2.apagados.length).toBe(1);
    await expect(o.detectarLegenda(ped({ artefatoKey: undefined }))).rejects.toBeInstanceOf(ErroTroca);
  });

  it('detectar: nada detectado (sem contorno) vira veredito, não exceção', async () => {
    const ex = new ExecFalso({ det: { detectou: false, quadros: 240, fps: 30, gates: { cobertura: 0, contorno: 0 } } });
    const r = await new TrocaTextoOrquestrada(ex, provaFalsa).detectarLegenda(ped());
    expect(r.captionTrack!.veredito).toMatchObject({ swap: false, reason: 'not_detected' });
    const ex2 = new ExecFalso({ det: { detectou: false, quadros: 240, fps: 30, gates: { cobertura: 0.9, contorno: 0 } } });
    expect((await new TrocaTextoOrquestrada(ex2, provaFalsa).detectarLegenda(ped())).captionTrack!.veredito.reason).toBe('no_outline');
  });

  it('placa: pedaços, juntar, conferência em paralelo, portões pós-placa = READY e publica na chave', async () => {
    const ex = new ExecFalso({ quadrosJuntar: 240 });
    const o = new TrocaTextoOrquestrada(ex, provaFalsa);
    const track = (await o.detectarLegenda(ped())).captionTrack!;
    const r = await o.placaLegenda({ workspaceId: 'w', championId: 'c', videoUrl: 'u', captionTrack: track, version: CAPTION_PLATE_VERSION, outputKey: 'k/legenda.mp4' });
    expect(r).toMatchObject({ status: 'READY', reason: null });
    expect(ex.publicado).toBe('k/legenda.mp4');
    const pl = ex.eventos.filter((e) => e.op === 'placa_legenda');
    expect(pl.length).toBeGreaterThanOrEqual(2);
    expect(pl.every((e) => e.ctx === 60)).toBe(true);
    expect(pl.map((e) => [e.ini, e.fim]).sort((a, b) => (a[0] as number) - (b[0] as number))[0][0]).toBe(0);
    expect(ex.eventos.filter((e) => e.op === 'conferir_legenda')).toHaveLength(pl.length);
    expect(r.metrics).toMatchObject({ quadros: 240, quadros_placa: 240, ruim_pct: 0 });
  });

  it('placa: janelas ruins = REJECTED sem publicar; pedaço que falha 2 vezes = FAILED; quadros errados = FAILED', async () => {
    const mk = async (o: ConstructorParameters<typeof ExecFalso>[0]) => {
      const ex = new ExecFalso({ quadrosJuntar: 240, ...o });
      const t = new TrocaTextoOrquestrada(ex, provaFalsa);
      const track = (await t.detectarLegenda(ped())).captionTrack!;
      const r = await t.placaLegenda({ workspaceId: 'w', championId: 'c', videoUrl: 'u', captionTrack: track, version: 1, outputKey: 'k/legenda.mp4' });
      return { r, ex };
    };
    const a = await mk({ ruim: true });
    expect(a.r).toMatchObject({ status: 'REJECTED', reason: 'plate_rejected' });
    expect(a.ex.publicado).toBe('champions/c/caption-data.npz'); // só o artefato; a placa reprovada não é publicada
    expect((await mk({ falharLegenda: { ini: 0, vezes: 1 } })).r.status).toBe('READY');
    expect((await mk({ falharLegenda: { ini: 0, vezes: 2 } })).r).toMatchObject({ status: 'FAILED', reason: 'plate_failed' });
    expect((await mk({ quadrosJuntar: 239 })).r).toMatchObject({ status: 'FAILED', reason: 'plate_failed' });
    const o = new TrocaTextoOrquestrada(new ExecFalso(), provaFalsa);
    const ruim = (await o.detectarLegenda(ped({ durationSec: 90 }))).captionTrack!;
    await expect(o.placaLegenda({ workspaceId: 'w', championId: 'c', videoUrl: 'u', captionTrack: ruim, version: 1, outputKey: 'k' })).rejects.toBeInstanceOf(ErroTroca);
  });

  it('calibração (S3): com manterPlacaReprovada a placa reprovada é publicada, mas o status segue REJECTED', async () => {
    const ex = new ExecFalso({ quadrosJuntar: 240, ruim: true });
    const t = new TrocaTextoOrquestrada(ex, provaFalsa, { manterPlacaReprovada: true });
    const track = (await t.detectarLegenda(ped())).captionTrack!;
    const r = await t.placaLegenda({ workspaceId: 'w', championId: 'c', videoUrl: 'u', captionTrack: track, version: 1, outputKey: 'k/legenda.mp4' });
    expect(r).toMatchObject({ status: 'REJECTED', reason: 'plate_rejected' });
    expect(ex.publicado).toBe('k/legenda.mp4');
    expect(r.pioresQuadros?.length).toBeGreaterThan(0);
  });

  it('puras: pedaços pela pegada cobrem [0, n), cortam em tomada perto do alvo; pessoa_*; agregação', () => {
    const pegada = [{ iniFrame: 0, fimFrame: 300, areaPx: 1000 }, { iniFrame: 300, fimFrame: 600, areaPx: 5000 }, { iniFrame: 600, fimFrame: 900, areaPx: 1000 }];
    const p = planejarPedacosLegenda(900, pegada, [180, 450, 700], 4);
    expect(p[0][0]).toBe(0); expect(p.at(-1)![1]).toBe(900);
    p.slice(1).forEach(([a], k) => expect(a).toBe(p[k][1]));
    // a parte cara (300-600) fica em mais pedaços que as baratas
    expect(p.filter(([a]) => a >= 300 && a < 600).length).toBeGreaterThanOrEqual(1);
    expect(planejarPedacosLegenda(50, [], [], 4)).toEqual([[0, 50]]);
    const m = mapa([leg], { faceTrack: [{ ...face, endFrame: 120 }] as never });
    const pp = portoesPessoa(m, [{ iniFrame: 0, fimFrame: 240 }], words, 0);
    expect(pp.pessoa_rosto).toBeCloseTo(0.5, 5);
    expect(portoesPessoa(mapa([leg]), [{ iniFrame: 0, fimFrame: 100 }], words, 0).pessoa_rosto).toBe(0);
    const ag = agregarConferencias([confFalsa(0, 60, false), confFalsa(60, 120, true)].map((c) => ({ ...c })), 30);
    expect(ag.janelas).toBe(8); expect(ag.ruim_pct).toBe(0.5); expect(ag.ruim_gancho_s).toBe(1);
    const pq = pioresQuadros([confFalsa(0, 60, false), confFalsa(60, 120, true)], 3);
    expect(pq).toHaveLength(3);
    expect(pq.every((f) => f >= 60)).toBe(true);   // as janelas ruins são as de 60 em diante; quadro do meio = início + 7
  });
});
