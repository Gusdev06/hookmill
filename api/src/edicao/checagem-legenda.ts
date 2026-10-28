// legenda-protegida-v1 §4.2: depois do render de uma peça de vídeo de campeão com legenda queimada, o backend tira 6 quadros
// (ffmpeg) em instantes com a legenda presente e pede à visão (porta `checkCaption` da ia, Haiku 4.5) o veredito. O resultado
// vai em `renders.input.captionCheck`; `covered` = o formato falha com CAPTION_COVERED (Retry) e sai do zip; Claude fora =
// `skipped` (não segura a peça). Os instantes e as palavras esperadas são funções puras (testadas sem ffmpeg nem Claude).
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CaptionCheck, ProtectedBand, TranscriptWord } from '@maquina/contratos';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editMapOf, transcriptOf } from '../campeoes/champion-views';
import { faixasDoCampeao, semLegendaQueimada } from '../campeoes/faixas-protegidas';
import { CLAUDE_SERVICE, type ClaudeService } from '../integracoes';
import { captionFramesOf } from '../integracoes/claude/checagem-legenda';
import { ffmpegRunner } from '../integracoes/claude/checagem-texto';
import type { CaptionCheckPort } from '../integracoes/contrato';
import { PrismaService } from '../prisma/prisma.service';
import type { RenderInput } from '../render/contrato';

/** D-LP3: 6 quadros (~US$ 0,008 por render). */
export const CAPTION_CHECK_FRAMES = 6;
export const CAPTION_CHECK_USD = 0.008;

type Span = { startSec: number; endSec: number };
type Rect = { x: number; y: number; w: number; h: number };

/** O que a checagem precisa saber do input do render. null = peça sem faixa protegida (não checa). */
export interface CaptionCheckTarget {
  mode: 'avoid' | 'replace';
  bands: ProtectedBand[];
  /** trechos do campeão, em ordem (a peça = a concatenação) */
  timeline: Span[];
  /** px do arquivo do campeão (pra levar a faixa pro quadro quando a saída é o próprio quadro do campeão) */
  source: { width: number; height: number };
  /** a saída é o quadro do campeão inteiro, só escalado (remix-keep): dá pra recortar a faixa */
  sameFrame: boolean;
  /** rev. 26/10: faixas em px da SAÍDA e tempo da PEÇA, gravadas pelos builders (`outputProtectedBands`) */
  output?: FaixaNaSaida[];
}

/** Faixa no espaço da saída (`outputProtectedBands` do input; `FaixaNaSaida` do @maquina/video). */
export interface FaixaNaSaida { kind: 'original' | 'replaced'; x: number; y: number; w: number; h: number; startSec: number; endSec: number }

/** Instante da peça → instante do campeão (timeline concatenada); fora = o próprio instante. */
export function pieceToSource(t: number, timeline: Span[]): number {
  let at = 0;
  for (const s of timeline) {
    const len = s.endSec - s.startSec;
    if (t <= at + len) return Math.round((s.startSec + (t - at)) * 100) / 100;
    at += len;
  }
  return t;
}

/** §4.2: recorte do quadro no instante `atSec` = envoltória das faixas na saída daquele modo (`avoid` → a original;
 *  `replace` → a nossa), com 2 % de folga, dentro do quadro. null = nenhuma faixa no instante. */
export function outputCropAt(bands: FaixaNaSaida[], mode: 'avoid' | 'replace', atSec: number, out: { width: number; height: number }): Rect | null {
  const want = mode === 'replace' ? 'replaced' : 'original';
  const bs = bands.filter((b) => b.kind === want && b.startSec <= atSec && b.endSec >= atSec && b.w > 0 && b.h > 0);
  if (!bs.length) return null;
  const pad = Math.round(0.02 * out.height);
  const x0 = Math.max(0, Math.floor(Math.min(...bs.map((b) => b.x)) - pad)), y0 = Math.max(0, Math.floor(Math.min(...bs.map((b) => b.y)) - pad));
  const x1 = Math.min(out.width, Math.ceil(Math.max(...bs.map((b) => b.x + b.w)) + pad)), y1 = Math.min(out.height, Math.ceil(Math.max(...bs.map((b) => b.y + b.h)) + pad));
  const w = x1 - x0, h = y1 - y0;
  return w > 8 && h > 8 ? { x: x0, y: y0, w: w - (w % 2), h: h - (h % 2) } : null;
}

/** Instantes da checagem a partir das faixas na saída (tempo da peça), com o instante do campeão pra palavras esperadas. */
export function outputCheckTimes(bands: FaixaNaSaida[], mode: 'avoid' | 'replace', timeline: Span[], n = CAPTION_CHECK_FRAMES): { atSec: number; srcSec: number }[] {
  const want = mode === 'replace' ? 'replaced' : 'original';
  const asBands = bands.filter((b) => b.kind === want).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, startSec: b.startSec, endSec: b.endSec }));
  const end = Math.max(0, ...asBands.map((b) => b.endSec));
  return captionCheckTimes(asBands, [{ startSec: 0, endSec: end }], n).map((t) => ({ atSec: t.atSec, srcSec: pieceToSource(t.atSec, timeline) }));
}

/** Faixas/modo/timeline do input (moldura: `video.*`; auto-edit: topo; remix-keep: as do campeão, passadas por fora). */
export function captionTargetOf(input: RenderInput, championBands: ProtectedBand[] = []): CaptionCheckTarget | null {
  const t = captionTargetBase(input, championBands);
  const out = (input as unknown as { outputProtectedBands?: FaixaNaSaida[] }).outputProtectedBands;
  return t && out?.length ? { ...t, output: out } : t;
}

function captionTargetBase(input: RenderInput, championBands: ProtectedBand[]): CaptionCheckTarget | null {
  const i = input as unknown as Record<string, unknown>;
  if (input.kind === 'frame') {
    const v = i.video as { protectedBands?: ProtectedBand[]; timeline: Span[]; source: { width: number; height: number } };
    if (!v?.protectedBands?.length) return null;
    return { mode: (i.captionMode as 'avoid' | 'replace') ?? 'avoid', bands: v.protectedBands, timeline: v.timeline, source: v.source, sameFrame: false };
  }
  if (input.kind === 'auto-edit') {
    const bands = i.protectedBands as ProtectedBand[] | undefined;
    if (!bands?.length || i.type === 'STATIC') return null;
    return { mode: (i.captionMode as 'avoid' | 'replace') ?? 'avoid', bands, timeline: i.timeline as Span[], source: i.source as { width: number; height: number }, sameFrame: false };
  }
  if (input.kind === 'remix-keep' && championBands.length) {
    // HEADLINE: o quadro do campeão inteiro (canvas = campeão, sem reescalar); a timeline é o vídeo todo
    const c = input.canvas;
    const dur = c.fps ? c.frameCount / c.fps : Math.max(...championBands.map((b) => b.endSec));
    return { mode: 'avoid', bands: championBands, timeline: [{ startSec: 0, endSec: dur }], source: { width: c.width, height: c.height }, sameFrame: true };
  }
  return null;
}

/**
 * §4.2: até `n` instantes da PEÇA com legenda presente (dentro dos intervalos medidos, levados pela timeline), espalhados.
 * `srcSec` = o instante correspondente no campeão (palavras esperadas no `replace`). Folga de 0,25 s nas bordas.
 */
export function captionCheckTimes(bands: ProtectedBand[], timeline: Span[], n = CAPTION_CHECK_FRAMES): { atSec: number; srcSec: number }[] {
  const parts: { pa: number; pz: number; offset: number }[] = [];
  let at = 0;
  for (const t of timeline) {
    for (const b of bands) {
      const a = Math.max(t.startSec, b.startSec) + 0.25, z = Math.min(t.endSec, b.endSec) - 0.25;
      if (z > a) parts.push({ pa: at + (a - t.startSec), pz: at + (z - t.startSec), offset: t.startSec - at });
    }
    at += t.endSec - t.startSec;
  }
  parts.sort((x, y) => x.pa - y.pa);
  const merged: typeof parts = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && p.pa <= last.pz && p.offset === last.offset) last.pz = Math.max(last.pz, p.pz);
    else merged.push({ ...p });
  }
  const total = merged.reduce((s, p) => s + (p.pz - p.pa), 0);
  if (total <= 0) return [];
  const out: { atSec: number; srcSec: number }[] = [];
  for (let k = 0; k < n; k++) {
    let target = ((k + 0.5) / n) * total;
    for (const p of merged) {
      const len = p.pz - p.pa;
      if (target <= len) {
        const atSec = Math.round((p.pa + target) * 100) / 100;
        out.push({ atSec, srcSec: Math.round((atSec + p.offset) * 100) / 100 });
        break;
      }
      target -= len;
    }
  }
  return out.filter((x, k) => k === 0 || x.atSec !== out[k - 1].atSec);
}

/** `replace`: palavras faladas em volta do instante (±0,8 s), na ordem. */
export function wordsAt(words: TranscriptWord[], srcSec: number, windowSec = 0.8): string[] {
  return words.filter((w) => w.endSec >= srcSec - windowSec && w.startSec <= srcSec + windowSec).map((w) => w.word.trim()).filter(Boolean);
}

/** Envoltória das faixas, escalada pro quadro de saída (só quando a saída é o próprio quadro do campeão). */
export function cropOf(t: CaptionCheckTarget, out: { width: number; height: number }): Rect | null {
  if (!t.sameFrame || !t.source.width || !t.source.height || !t.bands.length) return null;
  const sx = out.width / t.source.width, sy = out.height / t.source.height;
  const x0 = Math.min(...t.bands.map((b) => b.x)), y0 = Math.min(...t.bands.map((b) => b.y));
  const x1 = Math.max(...t.bands.map((b) => b.x + b.w)), y1 = Math.max(...t.bands.map((b) => b.y + b.h));
  const x = Math.max(0, Math.floor(x0 * sx)), y = Math.max(0, Math.floor(y0 * sy));
  const w = Math.min(out.width - x, Math.ceil((x1 - x0) * sx)), h = Math.min(out.height - y, Math.ceil((y1 - y0) * sy));
  return w > 8 && h > 8 ? { x, y, w: w - (w % 2), h: h - (h % 2) } : null;
}

/** O que a porta devolve por quadro; `problem`/`reason` só vêm do Haiku (F9, superconjunto do `CheckCaptionResult`). */
type QuadroDaPorta = { atSec: number; ok: boolean; covered: boolean; duplicated: boolean; seen: string | null; problem?: CaptionFrameProblem | null; reason?: string | null };
type CaptionFrameProblem = NonNullable<CaptionCheck['frames'][number]['problem']>;

/**
 * F10 (28/10): o veredito que vai pro `renders.input.captionCheck`, com o `problem` e o `reason` de cada quadro (antes só
 * atSec/ok/seen). Sem `status` da porta (mock antigo): `covered` se algum quadro veio tampado ou duplicado.
 */
export function captionCheckOf(res: { status?: 'ok' | 'covered'; frames: QuadroDaPorta[] }, attempt: number): CaptionCheck {
  const status = res.status ?? (res.frames.some((f) => f.covered || f.duplicated) ? 'covered' : 'ok');
  const frames = res.frames.map((f) => ({ atSec: f.atSec, ok: f.ok, seen: f.seen, problem: f.problem ?? null, reason: f.reason ?? null }));
  return { status, frames, attempt };
}

/** "21.29s missing", "40s covered: card cobre 'você'" ou "77.39s ok". */
export function quadroNoLog(f: CaptionCheck['frames'][number]): string {
  if (f.ok) return `${f.atSec}s ok`;
  return `${f.atSec}s ${f.problem ?? 'ruim'}${f.reason ? `: ${f.reason}` : ''}`;
}

export interface CaptionCheckJob {
  renderId: string; workspaceId: string; creativeId: string; variationBatchId: string;
  championId: string | null; language: string; notes: string | null;
  input: RenderInput; outputPath: string; output: { width: number; height: number };
  /** tentativa (1 = 1º render deste formato) */
  attempt: number;
}

@Injectable()
export class ChecagemLegendaService {
  private readonly log = new Logger('ChecagemLegenda');
  private readonly run = ffmpegRunner(process.env.FFMPEG_PATH || 'ffmpeg', 60_000);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
  ) {}

  /** Faixas do campeão pro remix-keep (HEADLINE), que não as leva no input. Versão sem legenda = nenhuma. */
  async championBands(championId: string | null): Promise<{ bands: ProtectedBand[]; words: TranscriptWord[] }> {
    if (!championId) return { bands: [], words: [] };
    const ch = await this.prisma.champion.findUnique({ where: { id: championId }, select: { cleanVideoFileId: true, videoFile: { select: { width: true, height: true } }, teardown: { select: { editMap: true, transcript: true } } } });
    if (!ch) return { bands: [], words: [] };
    const words = transcriptOf(ch.teardown?.transcript)?.words ?? [];
    const m = editMapOf(ch.teardown?.editMap);
    const map = ch.cleanVideoFileId ? semLegendaQueimada(m) : m;
    return { bands: faixasDoCampeao(map, { width: ch.videoFile?.width ?? m?.width ?? 0, height: ch.videoFile?.height ?? m?.height ?? 0 }), words };
  }

  /** null = a peça não tem faixa protegida (nada a checar). */
  async check(j: CaptionCheckJob): Promise<CaptionCheck | null> {
    if (j.input.kind === 'template') return this.checkTemplate(j);
    const { bands, words } = await this.championBands(j.championId);
    const target = captionTargetOf(j.input, j.input.kind === 'remix-keep' ? bands : []);
    if (!target) return null;
    const times = target.output ? outputCheckTimes(target.output, target.mode, target.timeline) : captionCheckTimes(target.bands, target.timeline);
    if (!times.length) return null;
    const port = this.claude as unknown as Partial<CaptionCheckPort>;
    const dir = await mkdtemp(join(tmpdir(), 'legenda-'));
    try {
      if (typeof port.checkCaption !== 'function') throw new Error('checkCaption ainda não existe na integração');
      // rev. 26/10: recorte da faixa em TODAS as peças, no instante de cada quadro (faixas na saída); legado = envoltória
      const fixed = cropOf(target, j.output);
      const shots: { atSec: number; image: Buffer; crop: Buffer | null }[] = [];
      for (const t of times) {
        const crop = target.output ? outputCropAt(target.output, target.mode, t.atSec, j.output) : fixed;
        shots.push(...(await captionFramesOf(this.run, null, j.outputPath, [t.atSec], crop)));
      }
      const frames = [];
      for (const [k, s] of shots.entries()) {
        const frameUrl = join(dir, `q${k}.png`);
        await writeFile(frameUrl, s.image);
        let bandUrl = '';
        if (s.crop) {
          bandUrl = join(dir, `f${k}.png`);
          await writeFile(bandUrl, s.crop);
        }
        frames.push({ atSec: s.atSec, frameUrl, bandUrl, expectedWords: target.mode === 'replace' ? wordsAt(words, times[k].srcSec) : null });
      }
      const res = await port.checkCaption.call(this.claude, {
        workspaceId: j.workspaceId, creativeId: j.creativeId, variationBatchId: j.variationBatchId, renderId: j.renderId,
        mode: target.mode, language: j.language, frames, notes: j.notes,
      });
      const check = captionCheckOf(res, j.attempt);
      this.log.log(`render ${j.renderId}: legenda ${check.status} (${check.frames.map(quadroNoLog).join('; ')})`);
      return check;
    } catch (e) {
      this.log.warn(`render ${j.renderId}: checagem da legenda pulada (${(e as Error).message})`);
      return { status: 'skipped', frames: [], attempt: j.attempt };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** F1.5: templates also get a real post-render text check, even when the source has no burned-in captions. */
  private async checkTemplate(j: CaptionCheckJob): Promise<CaptionCheck | null> {
    if (j.input.kind !== 'template') return null;
    const points = j.input.checkpoints.filter((p) => p.texts.some((t) => t.trim())).slice(0, CAPTION_CHECK_FRAMES);
    if (!points.length) return null;
    const dir = await mkdtemp(join(tmpdir(), 'template-check-'));
    try {
      const shots = await captionFramesOf(this.run, null, j.outputPath, points.map((p) => p.atSec), null);
      const frames: CaptionCheck['frames'] = [];
      for (const [i, shot] of shots.entries()) {
        const path = join(dir, `frame-${i}.png`);
        await writeFile(path, shot.image);
        const expected = points[i].texts.filter((t) => t.trim()).map((text, k) => ({ key: `text-${k}`, text, critical: true }));
        const result = await this.claude.checkStaticText({
          workspaceId: j.workspaceId, creativeId: j.creativeId, variationBatchId: j.variationBatchId,
          renderId: j.renderId, imageUrl: path, language: j.language, expected, notes: j.notes,
        });
        const missing = expected.filter((text) => !result.items.find((x) => x.key === text.key)?.found);
        frames.push({ atSec: shot.atSec, ok: !missing.length, seen: result.items.map((x) => x.seen ?? '').filter(Boolean).join(' · ') || null,
          problem: missing.length ? 'missing' : null, reason: missing.length ? 'Expected template text is missing or illegible' : null });
      }
      if (frames.length !== points.length) throw new Error('Incomplete template frame extraction');
      return { status: frames.some((f) => !f.ok) ? 'covered' : 'ok', frames, attempt: j.attempt };
    } catch (error) {
      this.log.warn(`render ${j.renderId}: template text check skipped (${(error as Error).message})`);
      return { status: 'skipped', frames: [], attempt: j.attempt };
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
  }
}
