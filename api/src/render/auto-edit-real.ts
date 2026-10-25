/**
 * Render real do template auto-edit com mídia local (nada pago): os 8 tipos de vídeo × 3 formatos (o STATIC saiu do Remotion na rev. 23/10), na ordem aprovada (D5: o 9:16
 * de todas as peças, depois 4:5, depois 1:1), pelo RemotionRenderService de verdade e com os arquivos servidos por HTTP
 * local (como as URLs assinadas). Monta o AutoEditContext como o backend vai montar (B2) e chama buildAutoEditInput.
 * Mede o rosto (YuNet), as pausas (silencedetect) e a paleta de verdade; captura a página de fixture com o Chromium do
 * Remotion (PageCapture). Confere nb_frames, áudio e se cada emenda caiu em silêncio no campeão.
 *
 * Uso (de api/): npx ts-node --transpile-only src/render/auto-edit-real.ts <saida-dir> [tipo,tipo...] [formato,formato...]
 * Requer: npm run build:lib -w video. Bundle compilado na hora (REMOTION_BUNDLE_DIR vazio): não mexe no dist/bundle.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { AutoVariationType, EditMap, TranscriptWord } from '@maquina/contratos';
import { capturarPagina } from '../medicao/captura-pagina';
import { FfmpegMediaAnalysisService } from '../medicao/media-analysis.service';
import { buildAutoEditInput, type AutoEditContext, type AutoEditFormat, type AutoItemParams } from './auto-edit';
import type { RenderResult } from './contrato';
import { RemotionRenderService } from './remotion-render.service';
import { renderConfig } from './render.module';

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const TAKE = path.join(RAIZ, 'video/public/fixtures/real-take.mp4');
const PAINEIS = path.join(RAIZ, 'testes/fixtures/campeoes/paineis-caixa-15s.mp4');
const LP = path.join(RAIZ, 'api/src/medicao/__fixtures__/pagina-lp.html');

const ffprobeJson = (f: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,nb_frames,duration,width,height', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'json', f]).toString());
/** RMS (dBFS) do áudio do arquivo na janela [a, b] s (silencedetect usa -35 dB). */
function rmsJanela(f: string, a: number, b: number): number {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-ss', String(Math.max(0, a)), '-t', String(Math.max(0.02, b - a)), '-i', f, '-vn', '-af', 'astats=measure_overall=RMS_level:measure_perchannel=none', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /RMS level dB:\s*(-?[\d.]+|-inf)/.exec(r.stderr);
  return m ? (m[1] === '-inf' ? -120 : Number(m[1])) : NaN;
}

async function main() {
  const [saidaDir, tiposArg, formatosArg] = process.argv.slice(2);
  if (!saidaDir) throw new Error('uso: auto-edit-real.ts <saida-dir> [tipos] [formatos]');
  mkdirSync(saidaDir, { recursive: true });
  const m = new FfmpegMediaAnalysisService();

  // ── servidor local (Range) pros arquivos, como o storage ──
  const arquivos: Record<string, string> = { 'take.mp4': TAKE, 'paineis.mp4': PAINEIS, 'lp.html': LP };
  const servidor = http.createServer((req, res) => {
    const f = arquivos[path.basename((req.url ?? '').split('?')[0])];
    if (!f) return void res.writeHead(404).end();
    const { size } = statSync(f);
    const tipo = f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'video/mp4';
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
      return void createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
    createReadStream(f).pipe(res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  // ── captura da página (fixture) ──
  const t0 = Date.now();
  const pngLp = path.join(saidaDir, 'pagina-lp.png');
  const cap = await capturarPagina(`${base}/lp.html`, pngLp, { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE ?? null, allowPrivateHosts: true });
  console.log(`captura ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify('error' in cap ? cap : { ...cap, text: cap.text.slice(0, 80) + '…' }));
  if ('error' in cap) throw new Error('captura falhou');
  arquivos['pagina.png'] = pngLp;
  // SSRF: sem allowPrivateHosts, localhost é recusado
  const negado = await capturarPagina(`${base}/lp.html`, path.join(saidaDir, 'x.png'), { browserExecutable: null });
  console.log('captura sem allowPrivateHosts:', JSON.stringify(negado));

  // ── campeão 1: take de lipsync (31 s, 960x960, 24 fps), fala real ──
  const pr = await m.probe(TAKE);
  const reais = JSON.parse(readFileSync(path.join(RAIZ, 'video/public/fixtures/reais.json'), 'utf8'));
  const words: TranscriptWord[] = reais.take.flatMap((s: { clipStartSec: number; words: TranscriptWord[] }) =>
    s.words.map((w) => ({ word: w.word, startSec: +(w.startSec + s.clipStartSec).toFixed(3), endSec: +(w.endSec + s.clipStartSec).toFixed(3) })));
  const audio = path.join(saidaDir, 'take.m4a');
  await m.extractAudio(TAKE, audio);
  const silences = await m.silences(audio, 0.08);
  const kfs = await m.keyframes(TAKE, [1, 8, 16, 24], path.join(saidaDir, 'kf'), 256);
  const palette = await m.palette(kfs.map((k) => k.path), 5);
  const track = await m.faceTrack(TAKE);
  const editMap: EditMap = {
    version: 1, width: track.width, height: track.height, fps: track.fps, frameCount: track.frameCount,
    cells: track.cells, faceTrack: track.segments, layers: [], overlaysOverFace: [], profile: null, timeline: track.timeline,
    keepEdit: { SWAP_AVATAR: { available: true, blockers: [] }, NEW_HOOKS: { available: true, blockers: [] } },
  };
  console.log(`take ${pr.width}x${pr.height} ${pr.fps} fps ${pr.durationSec} s · ${words.length} palavras · ${silences.length} pausas · paleta ${palette.join(' ')} · rosto ${JSON.stringify(track.segments.map((s) => ({ f: [s.startFrame, s.endFrame], r: s.region, face: s.faceInRegion[0]?.box })))}`);
  // blocos do teardown (como a análise devolve; bordas soltas de propósito, o snap encaixa)
  const blocks = [
    { index: 0, startSec: 0, endSec: 6.7 },      // hook: "Hey man ... cheating on me."
    { index: 1, startSec: 6.7, endSec: 12.4 },   // problem
    { index: 2, startSec: 12.4, endSec: 20.7 },  // mechanism / proof
    { index: 3, startSec: 20.7, endSec: 26.3 },  // cta: "I'll leave a link below ..."
    { index: 4, startSec: 26.3, endSec: pr.durationSec },
  ];
  const ctxBase: Omit<AutoEditContext, 'renderId' | 'type' | 'params'> = {
    language: 'en',
    source: { videoUrl: `${base}/take.mp4`, width: pr.width, height: pr.height, fps: pr.fps, durationSec: pr.durationSec, hasAudio: pr.hasAudio },
    editMap, words, silences, blocks, hookEndSec: 6.58, palette, brandName: 'Northwind Planner',
    page: { imageUrl: `${base}/pagina.png`, kind: 'page' },
  };
  const PECAS: { code: string; params: AutoItemParams }[] = [
    { code: 'CUT-15S', params: { type: 'CUT', targetSec: 15, blockIndexes: [0, 3] } },
    { code: 'COLD-OPEN', params: { type: 'COLD_OPEN', teaserStartSec: 15.5, teaserEndSec: 17.8 } },
    { code: 'HOOK-TEXT-2', params: { type: 'HOOK_TEXT', text: 'She never knew I could see everything' } },
    { code: 'ENDCARD-CTA', params: { type: 'ENDCARD', variant: 'cta', headline: 'See how it works', subline: 'The link is below this video', ctaText: 'Learn more' } },
    { code: 'LAYOUT-SPLIT-LP', params: { type: 'SPLIT_LP' } },
    { code: 'LAYOUT-STORY', params: { type: 'STORY' } },
    { code: 'LAYOUT-REVIEW', params: { type: 'REVIEW', quote: 'I stopped dreading Mondays. The plan is just there.', author: 'Dana, product manager', stars: 5 } },
    { code: 'NATIVE-SEARCH', params: { type: 'NATIVE_SEARCH', query: 'how to know if my wife is cheating' } },
  ];
  const tipos = tiposArg ? tiposArg.split(',') : null;
  const formatos = (formatosArg ? formatosArg.split(',') : ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1']) as AutoEditFormat[];

  // ── campeão 2: painéis com headline em faixa chapada (HOOK-TEXT tapa o gancho escrito original) ──
  const painel = JSON.parse(readFileSync(path.join(RAIZ, 'testes/fixtures/campeoes/paineis.json'), 'utf8'));
  const pp = await m.probe(PAINEIS);
  const fx = painel.fixtures.find((f: { file: string }) => f.file === 'paineis-caixa-15s.mp4');
  const rosto = painel.caixas.rosto;
  const editMapPaineis: EditMap = {
    version: 1, width: pp.width, height: pp.height, fps: pp.fps, frameCount: painel.grade.frames, cells: [],
    faceTrack: [{ startFrame: 0, endFrame: painel.grade.frames, region: rosto, fullFrame: false, faceInRegion: [{ atFrame: 0, box: { x: 0.25, y: 0.15, w: 0.5, h: 0.6 } }], facesMax: 1, minScore: 0.9 }],
    layers: [{
      id: 'headline', kind: 'headline', startFrame: 0, endFrame: painel.grade.frames, box: painel.caixas.topo,
      background: { kind: 'solid', color: fx.esperado.headline.color, box: painel.caixas.topo },
      style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 34, lineHeight: 1.1, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
      text: fx.esperado.headline.text, wordsPerPage: null, source: 'vision+pixel',
    }],
    overlaysOverFace: [], profile: null,
    keepEdit: { SWAP_AVATAR: { available: true, blockers: [] }, NEW_HOOKS: { available: true, blockers: [] } },
  };

  const svc = new RemotionRenderService(renderConfig((k) => ({ REMOTION_BUNDLE_DIR: process.env.AUTO_BUNDLE ?? '', RENDER_TMP_DIR: path.join(saidaDir, 'tmp') } as Record<string, string>)[k] ?? process.env[k]));
  const linhas: string[] = [];
  const medidas: Record<string, unknown>[] = [];
  const renderizar = async (rotulo: string, ctx: AutoEditContext, formato: AutoEditFormat) => {
    const input = buildAutoEditInput(ctx, formato);
    writeFileSync(path.join(saidaDir, `${rotulo}.input.json`), JSON.stringify(input, null, 1));
    const t = Date.now();
    let r: RenderResult;
    svc.ultimasEmendas = [];
    try {
      r = await svc.render(input, () => undefined);
    } catch (e) {
      console.error(`FALHOU ${rotulo}`, e);
      linhas.push(`${rotulo}\tFALHOU\t${e instanceof Error ? e.message : e}`);
      return;
    }
    const seg = (Date.now() - t) / 1000;
    const ext = r.mimeType === 'image/png' ? 'png' : 'mp4';
    const final = path.join(saidaDir, `${rotulo}.${ext}`);
    copyFileSync(r.outputPath, final);
    const info: Record<string, unknown> = { rotulo, seg: +seg.toFixed(1), w: r.width, h: r.height, durationSec: r.durationSec, mb: +(r.sizeBytes / 1e6).toFixed(2), reframe: input.reframe.mode };
    if (ext === 'mp4') {
      const pj = ffprobeJson(final);
      const v = pj.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
      const a = pj.streams.find((s: { codec_type: string }) => s.codec_type === 'audio');
      info.frames = Number(v.nb_read_packets);
      info.framesEsperados = Math.round(r.durationSec * 30);
      info.audioSec = a ? +Number(a.duration).toFixed(3) : null;
      // emendas: cada borda interna do timeline tem que cair em silêncio no campeão (±40 ms)
      info.movidas = svc.ultimasEmendas;
      const refinado = input.timeline.map((s) => ({
        startSec: svc.ultimasEmendas.find((m) => m.de === s.startSec)?.para ?? s.startSec,
        endSec: svc.ultimasEmendas.find((m) => m.de === s.endSec)?.para ?? s.endSec,
      }));
      const bordas = refinado.flatMap((s) => [s.startSec > 0 ? s.startSec : null, s.endSec < ctx.source.durationSec - 0.05 ? s.endSec : null]).filter((x): x is number => x !== null);
      info.emendas = bordas.map((b) => ({ t: b, rmsDb: +rmsJanela(TAKE, b - 0.02, b + 0.02).toFixed(1), dentroDePalavra: words.find((w) => b > w.startSec + 0.001 && b < w.endSec - 0.001)?.word ?? null }));
    }
    medidas.push(info);
    console.log(JSON.stringify(info));
    linhas.push(`${rotulo}\t${seg.toFixed(1)} s`);
  };

  for (const formato of formatos) {
    for (const [i, p] of PECAS.entries()) {
      if (tipos && !tipos.includes(p.params.type)) continue;
      await renderizar(`${String(i + 1).padStart(2, '0')}-${p.code}-${formato}`, { ...ctxBase, renderId: `auto-${p.code}-${formato}`, type: p.params.type as AutoVariationType, params: p.params }, formato);
    }
  }
  if (!tipos || tipos.includes('HOOK_TEXT_COVER')) {
    await renderizar('10-HOOK-TEXT-capa-VERTICAL_9_16', {
      ...ctxBase, renderId: 'auto-hook-capa', type: 'HOOK_TEXT', params: { type: 'HOOK_TEXT', text: 'My bill dropped 40% after one change' },
      language: 'en', source: { videoUrl: `${base}/paineis.mp4`, width: pp.width, height: pp.height, fps: pp.fps, durationSec: pp.durationSec, hasAudio: pp.hasAudio },
      editMap: editMapPaineis, words: [], silences: [], blocks: [], hookEndSec: 3, palette: ['#d40f0f', '#101010', '#f0f0f0'],
    }, 'VERTICAL_9_16');
  }
  writeFileSync(path.join(saidaDir, 'medidas.json'), JSON.stringify(medidas, null, 1));
  console.log(linhas.join('\n'));
  servidor.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
