// Implementação da porta sobre um executor de ops Python (local ou lambda) e a prova no Chrome. Dono: video.
// medirHeadline: medida → prova das candidatas no Chrome → régua → HeadlineLook (§16.2 A3).
// placaHeadline: pedaços em paralelo (1 nova tentativa cada) → A2 → juntar → conferência de quadros (§15.6.4, §16.2 A2).
import type { HeadlineLook } from '@maquina/contratos';
import { TROCA_EVENTO_VERSAO, type ExecutorTroca, type MedidaHeadline, type RespostaConferirLegenda, type RespostaDetectarLegenda, type RespostaTroca, type ResultadoRegua, type SaidaTroca } from './evento';
import { escolherAlvo, montarLook, parametrosDaPlaca, planejarPedacos } from './look';
import type { DetectarLegendaInput, DetectarLegendaResult, MedirHeadlineInput, MedirHeadlineResult, PlacaHeadlineInput, PlacaHeadlineResult, PlacaLegendaInput, PlacaLegendaResult, TrocaPorta } from './porta';
import { SUAVIZA_PX, type ProvaChrome, type StillProva } from './prova';
import {
  CAPTION_PLATE_VERSION, ESTILO_VAZIO, LEGENDA_MAX_SEC_PADRAO, agregarConferencias, avaliarPlacaLegenda, avaliarPortoesLegenda, pioresQuadros, planejarPedacosLegenda, portoesPessoa,
  type CaptionTrack,
} from './legenda';

/** §16.2 A2: no pior quadro, |média| do alto-passa nas letras antigas ≤ 3 e correlação com o molde ≤ 0,10. */
export const FANTASMA_MAX = { media: 3, corr: 0.1 } as const;

/** Falha de infraestrutura ou da op (não do vídeo): o chamador decide repetir depois. */
export class ErroTroca extends Error {
  constructor(readonly op: string, message: string, readonly detalhe?: string) {
    super(message);
    this.name = 'ErroTroca';
  }
}

export interface OrquestraConfig {
  maxPedacos?: number;
  /** CALIBRAÇÃO (S3), nunca em produção: guarda o artefato e gera a placa mesmo com o veredito sem swap (desde que o estilo tenha sido medido) e a
   *  publica mesmo reprovada pelos portões, para o Gusta ver o vídeo e marcar sim/não contra o que os números dizem */
  manterPlacaReprovada?: boolean;
  measuredIn?: 'chrome-linux' | 'chrome-mac';
  log?: { warn(m: string): void; log?(m: string): void };
  /** diagnóstico (scripts e testes): a medida e a régua inteiras, antes de virarem look */
  aoMedir?: (md: MedidaHeadline, regua: ResultadoRegua | null, stills: StillProva[]) => void;
}

export class TrocaTextoOrquestrada implements TrocaPorta {
  private readonly maxPedacos: number;
  /** `d.npz` guardado por chave (mesmo processo: o local precisa do caminho; o lambda reconstrói a URL pela chave) */
  private readonly artefatos = new Map<string, SaidaTroca>();
  private readonly measuredIn: 'chrome-linux' | 'chrome-mac';
  constructor(private readonly exec: ExecutorTroca, private readonly prova: ProvaChrome, private readonly cfg: OrquestraConfig = {}) {
    this.maxPedacos = cfg.maxPedacos ?? 4;
    this.measuredIn = cfg.measuredIn ?? (process.platform === 'darwin' ? 'chrome-mac' : 'chrome-linux');
  }

  private async op(ev: Record<string, unknown> & { op: string }): Promise<{ r: RespostaTroca; costUsd: number; ms: number }> {
    const out = await this.exec.executar({ v: TROCA_EVENTO_VERSAO, ...ev } as never);
    if (out.r.proc_ok === false || out.r.ok_op === false) {
      throw new ErroTroca(ev.op, out.r.erro ?? `op ${ev.op} falhou`, out.r.trace);
    }
    return out;
  }

  async medirHeadline(i: MedirHeadlineInput): Promise<MedirHeadlineResult> {
    const t0 = Date.now();
    const layer = escolherAlvo(i.editMap);
    if (!layer) return { look: null, costUsd: 0, ms: Date.now() - t0 };
    let custo = 0;
    const m1 = await this.op({
      op: 'medir_headline', fase: 'medida', get: { 'video.mp4': i.videoUrl },
      alvo: { layerId: layer.id, startFrame: layer.startFrame, endFrame: layer.endFrame, box: layer.box, text: layer.text ?? '' },
      bandas: (i.editMap.protectedBands ?? []).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, startSec: b.startSec, endSec: b.endSec })),
      fontIdVisao: layer.style.fontId,
    });
    custo += m1.costUsd;
    const md = m1.r as unknown as MedidaHeadline;
    let regua: ResultadoRegua | null = null;
    let provas: StillProva[] = [];
    if (md.ok && md.candidatas?.length && md.ref) {
      const stills = await this.prova.renderizar(md.candidatas.map((c) => ({
        fontId: c.fontId, lines: md.lines ?? [], layout: c.layout, color: md.color ?? '#ffffff', shadow: md.sombra ?? null,
        suavizaPx: SUAVIZA_PX[md.kind ?? 'loose'], canvas: md.canvas,
      })));
      provas = stills;
      const m2 = await this.op({ op: 'medir_headline', fase: 'regua', ref: md.ref, stills, largura: md.canvas.width });
      custo += m2.costUsd;
      regua = m2.r as unknown as ResultadoRegua;
    }
    this.cfg.aoMedir?.(md, regua, provas);
    const look = montarLook({ layer, m: i.editMap, md, regua, measuredIn: this.measuredIn });
    if (regua) look.verdict.gates.font_candidatas = regua.medidas.length;
    return { look, costUsd: custo, ms: Date.now() - t0 };
  }

  /** Detectar (§15.6): faixa, trechos, estilo e portões pela op Python; `pessoa_*` pelo faceTrack (TS). Acima do teto de duração não chama a função. */
  async detectarLegenda(i: DetectarLegendaInput): Promise<DetectarLegendaResult> {
    const t0 = Date.now();
    const layer = i.editMap.layers.find((l) => l.kind === 'caption');
    if (!layer) return { captionTrack: null, costUsd: 0, ms: Date.now() - t0 };
    const max = i.legendaMaxSec ?? LEGENDA_MAX_SEC_PADRAO;
    const base = { version: 1 as const, trechos: [], estilo: ESTILO_VAZIO, atrasoSec: 0, pegada: [], cortes: [], artefato: null, caixa: false, faixa: null, quadros: i.editMap.frameCount, fps: i.editMap.fps };
    if (i.durationSec > max) {
      const gates = { duracao_s: i.durationSec };
      return { captionTrack: { ...base, veredito: { ...avaliarPortoesLegenda(gates, { legendaMaxSec: max }), gates } }, costUsd: 0, ms: Date.now() - t0 };
    }
    if (!i.artefatoKey) throw new ErroTroca('detectar', 'detectarLegenda sem artefatoKey (chave do storage para os trechos da placa)');
    const dst = await this.exec.destino('d.npz', 'application/octet-stream', i.artefatoKey);
    this.artefatos.set(i.artefatoKey, dst);
    let custo = 0, limpar = true;
    try {
      const o = await this.op({
        op: 'detectar', get: { 'video.mp4': i.videoUrl }, put: { d: dst.destino },
        words: i.words, fontIdVisao: i.fontIdVisao === undefined ? layer.style.fontId : i.fontIdVisao, captionBox: i.captionBox ?? null,
      });
      custo += o.costUsd;
      const r = o.r as unknown as RespostaDetectarLegenda;
      const trechos = (r.trechos ?? []).map((t) => ({ iniFrame: t.iniFrame, fimFrame: t.fimFrame, box: { x: t.box[0], y: t.box[1], w: t.box[2], h: t.box[3] }, iou: t.iou, texto: t.texto, herdado: t.herdado }));
      const atrasoSec = r.atrasoSec ?? 0;
      const gates: Record<string, number> = { ...r.gates, ...(r.detectou ? portoesPessoa(i.editMap, trechos, i.words, atrasoSec) : {}) };
      gates.duracao_s = i.durationSec;
      const veredito = { ...avaliarPortoesLegenda(gates, { legendaMaxSec: max }), gates };
      const e = r.estilo;
      const track: CaptionTrack = {
        ...base, trechos, atrasoSec, quadros: r.quadros, fps: r.fps, veredito,
        estilo: e ? { fontId: e.fontId, tamPx: e.tamPx, tracking: e.tracking, espaco: e.espaco, strokePx: e.strokePx, sombra: e.sombra, corTexto: e.corTexto, corDestaque: e.corDestaque,
          corTraco: e.corTraco, caixaDestaque: e.caixaDestaque, palavrasPorPagina: e.palavrasPorPagina, linhas: e.linhas, baseY: e.baseY, centroX: e.centroX } : ESTILO_VAZIO,
        pegada: r.pegada ?? [], cortes: r.cortes ?? [], caixa: r.caixa ?? false, faixa: r.faixa ?? null,
        artefato: r.detectou && r.estilo && (veredito.swap || this.cfg.manterPlacaReprovada) ? i.artefatoKey : null,
      };
      limpar = !track.artefato;
      return { captionTrack: track, costUsd: custo, ms: Date.now() - t0 };
    } finally {
      if (limpar) { this.artefatos.delete(i.artefatoKey); await this.exec.apagar(dst).catch(() => undefined); }
      else await this.exec.publicar(dst, i.artefatoKey, 'application/octet-stream');
    }
  }

  /** Placa (§15.6.4): pedaços pela pegada → `juntar` → conferência em paralelo → portões pós-placa (§15.6.1 tabela 2). */
  async placaLegenda(i: PlacaLegendaInput): Promise<PlacaLegendaResult> {
    const t0 = Date.now();
    const tr = i.captionTrack;
    if ((!tr.veredito.swap && !this.cfg.manterPlacaReprovada) || !tr.artefato) throw new ErroTroca('placa_legenda', `placa só com swap aprovado e artefato (reason ${tr.veredito.reason})`);
    let custo = 0;
    const temporarios: SaidaTroca[] = [];
    const falha = (metrics: Record<string, number>): PlacaLegendaResult => ({ status: 'FAILED', reason: 'plate_failed', metrics, sizeBytes: null, costUsd: custo, ms: Date.now() - t0 });
    try {
      const art = this.artefatos.get(tr.artefato) ?? { destino: '', ref: tr.artefato };
      const dUrl = await this.exec.origem(art);
      const n = tr.quadros;
      const pedacos = planejarPedacosLegenda(n, tr.pegada, tr.cortes, this.maxPedacos);
      const rodar = async (k: number, [ini, fim]: [number, number]) => {
        const dst = await this.exec.destino(`p${String(k).padStart(2, '0')}.mp4`, 'video/mp4');
        temporarios.push(dst);
        const ev = { op: 'placa_legenda', get: { 'video.mp4': i.videoUrl, 'd.npz': dUrl }, put: { placa: dst.destino }, ini, fim, ctx: 60 };
        for (let tent = 0; ; tent++) {
          try { const r = await this.op(ev); custo += r.costUsd; return { dst, r: r.r, ms: r.ms }; } catch (e) {
            if (tent >= 1) throw e;
            this.cfg.log?.warn(`placa_legenda pedaço ${k} [${ini}, ${fim}): ${(e as Error).message}; nova tentativa`);
          }
        }
      };
      let res;
      try { res = await Promise.all(pedacos.map((pd, k) => rodar(k, pd))); } catch (e) {
        this.cfg.log?.warn(`placa_legenda: ${(e as Error).message}`);
        return falha({ pedacos: pedacos.length });
      }
      const metrics: Record<string, number> = {
        pedacos: pedacos.length, quadros: n, pedaco_max_s: Math.max(...res.map((x) => x.ms)) / 1000,
        pico_MB: Math.max(0, ...res.map((x) => Number(x.r.pico_arvore_MB ?? x.r.rss_python_MB ?? 0))),
      };
      const final = await this.exec.destino('placa.mp4', 'video/mp4', i.outputKey);
      const get: Record<string, string> = {};
      for (const [k, x] of res.entries()) get[`p${String(k).padStart(2, '0')}.mp4`] = await this.exec.origem(x.dst);
      let j;
      try { j = await this.op({ op: 'juntar', get: { ...get, 'audio.mp4': i.videoUrl }, put: { placa: final.destino } }); } catch (e) {
        this.cfg.log?.warn(`juntar: ${(e as Error).message}`);
        return falha(metrics);
      }
      custo += j.costUsd;
      if (final.ref !== i.outputKey) temporarios.push(final);
      metrics.quadros_placa = Number(j.r.quadros ?? 0);
      if (metrics.quadros_placa !== n) return falha(metrics);
      const emendas = pedacos.slice(1).map(([a]) => a);
      const pUrl = await this.exec.origem(final);
      const t1 = Date.now();
      let conf: RespostaConferirLegenda[];
      try {
        const cs = await Promise.all(pedacos.map(([ini, fim]) => this.op({ op: 'conferir_legenda', get: { 'video.mp4': i.videoUrl, 'placa.mp4': pUrl, 'd.npz': dUrl }, ini, fim, emendas })));
        for (const c of cs) custo += c.costUsd;
        conf = cs.map((c) => c.r as unknown as RespostaConferirLegenda);
      } catch (e) {
        this.cfg.log?.warn(`conferir_legenda: ${(e as Error).message}`);
        return falha(metrics);
      }
      metrics.conferir_s = (Date.now() - t1) / 1000;
      Object.assign(metrics, agregarConferencias(conf, tr.fps));
      const reason = avaliarPlacaLegenda(metrics);
      if (reason) {
        if (this.cfg.manterPlacaReprovada && reason !== 'plate_failed') {
          await this.exec.publicar(final, i.outputKey, 'video/mp4');
          if (final.ref !== i.outputKey) temporarios.splice(temporarios.indexOf(final), 1);
        } else await this.exec.apagar(final).catch(() => undefined);
        return { status: reason === 'plate_failed' ? 'FAILED' : 'REJECTED', reason, metrics, sizeBytes: null, costUsd: custo, ms: Date.now() - t0, pioresQuadros: pioresQuadros(conf) };
      }
      await this.exec.publicar(final, i.outputKey, 'video/mp4');
      const tam = (j.r.tam_saida as Record<string, number> | undefined)?.placa ?? null;
      return { status: 'READY', reason: null, metrics, sizeBytes: tam, costUsd: custo, ms: Date.now() - t0, pioresQuadros: pioresQuadros(conf) };
    } finally {
      await Promise.all(temporarios.map((s) => this.exec.apagar(s).catch(() => undefined)));
    }
  }

  async placaHeadline(i: PlacaHeadlineInput): Promise<PlacaHeadlineResult> {
    const t0 = Date.now();
    const look: HeadlineLook = i.look;
    if (look.kind !== 'loose') throw new ErroTroca('placa_headline', `placa só no solto (kind ${look.kind})`);
    const W = look.fit.canvas.width, H = look.fit.canvas.height;
    const p = parametrosDaPlaca(look, W, H);
    let custo = 0;
    const temporarios: SaidaTroca[] = [];
    const falha = (reason: string, metrics: Record<string, number>): PlacaHeadlineResult =>
      ({ status: 'FAILED', reason, metrics, sizeBytes: null, costUsd: custo, ms: Date.now() - t0 });
    try {
      const total = await this.contarQuadros(i.videoUrl);
      custo += total.costUsd;
      const pedacos = planejarPedacos(total.n, look.startFrame, look.endFrame, this.maxPedacos);
      const rodar = async (k: number, [ini, fim]: [number, number]) => {
        const dst = await this.exec.destino(`p${String(k).padStart(2, '0')}.mp4`, 'video/mp4');
        temporarios.push(dst);
        const ev = { op: 'placa_headline', get: { 'video.mp4': i.videoUrl }, put: { placa: dst.destino }, ...p, ini, fim };
        for (let tent = 0; ; tent++) {
          try {
            const r = await this.op(ev);
            custo += r.costUsd;
            return { dst, r: r.r, ms: r.ms };
          } catch (e) {
            if (tent >= 1) throw e;
            this.cfg.log?.warn(`placa_headline pedaço ${k} [${ini}, ${fim}): ${(e as Error).message}; nova tentativa`);
          }
        }
      };
      let res;
      try {
        res = await Promise.all(pedacos.map((pd, k) => rodar(k, pd)));
      } catch (e) {
        this.cfg.log?.warn(`placa_headline: ${(e as Error).message}`);
        return falha('plate_failed', { pedacos: pedacos.length });
      }
      const media = Math.max(0, ...res.map((x) => Number(x.r.fantasma_pior_media ?? 0)));
      const corr = Math.max(-1, ...res.map((x) => Number(x.r.fantasma_pior_corr ?? 0)));
      const metrics: Record<string, number> = {
        pedacos: pedacos.length, quadros: total.n, fantasma_pior_media: media, fantasma_pior_corr: corr,
        pedaco_max_s: Math.max(...res.map((x) => x.ms)) / 1000, mascara_px: Number(res[0].r.mascara_px ?? 0),
        pico_MB: Math.max(0, ...res.map((x) => Number(x.r.pico_arvore_MB ?? x.r.rss_python_MB ?? 0))),
      };
      if (media > FANTASMA_MAX.media || corr > FANTASMA_MAX.corr) {
        return { status: 'REJECTED', reason: 'plate_rejected', metrics, sizeBytes: null, costUsd: custo, ms: Date.now() - t0 };
      }
      const final = await this.exec.destino('placa.mp4', 'video/mp4', i.outputKey);
      const get: Record<string, string> = {};
      for (const [k, x] of res.entries()) get[`p${String(k).padStart(2, '0')}.mp4`] = await this.exec.origem(x.dst);
      let j;
      try {
        j = await this.op({ op: 'juntar', get, put: { placa: final.destino } });
      } catch (e) {
        this.cfg.log?.warn(`juntar: ${(e as Error).message}`);
        return falha('plate_failed', metrics);
      }
      custo += j.costUsd;
      metrics.quadros_placa = Number(j.r.quadros ?? 0);
      if (metrics.quadros_placa !== total.n) return falha('plate_failed', metrics);
      await this.exec.publicar(final, i.outputKey, 'video/mp4');
      if (final.ref !== i.outputKey) temporarios.push(final);
      const tam = (j.r.tam_saida as Record<string, number> | undefined)?.placa ?? null;
      return { status: 'READY', reason: null, metrics, sizeBytes: tam, costUsd: custo, ms: Date.now() - t0 };
    } finally {
      await Promise.all(temporarios.map((s) => this.exec.apagar(s).catch(() => undefined)));
    }
  }

  /** Nº de quadros do campeão: planeja os pedaços. Baixa pelo `get` como as outras ops: o ffprobe estático da função não
   *  abre a URL assinada do S3 (G1, 06/11: `sondar` com `url` falhou na Lambda; local passava porque a URL é caminho). */
  private async contarQuadros(videoUrl: string): Promise<{ n: number; costUsd: number }> {
    const r = await this.op({ op: 'sondar', get: { 'video.mp4': videoUrl } });
    return { n: Number(r.r.n ?? 0), costUsd: r.costUsd };
  }
}
