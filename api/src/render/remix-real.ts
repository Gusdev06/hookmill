/**
 * Render real do remix-keep com mídia local (nada pago): mede o campeão (trilha do rosto, fundo da headline), encaixa um
 * clipe de lipsync que já existe e renderiza pelo RemotionRenderService de verdade, com os arquivos servidos por HTTP
 * local (como as URLs assinadas do storage). Monta o RemixKeepRenderInput como o backend vai montar (B5).
 *
 * Uso (de api/): npx ts-node --transpile-only src/render/remix-real.ts <campeao.mp4> <clipe.mp4> <saida-dir> [swap|hook] ["texto do gancho"]
 *   swap = Trocar avatar mantendo a edição (clipe na região do rosto, nenhuma camada redesenhada fora dela)
 *   hook = Novo gancho escrito (D6 opção a): só a headline redesenhada sobre a própria faixa; sem clipe
 * Requer: npm run build -w video (dist/lib + dist/bundle).
 */
import { copyFileSync, createReadStream, mkdirSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { FfmpegMediaAnalysisService } from '../medicao/media-analysis.service';
import type { RemixKeepRenderInput } from './contrato';
import { RemotionRenderService } from './remotion-render.service';
import { renderConfig } from './render.module';

const med = (v: number[]) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

async function main() {
  const [campeao, clipe, saidaDir, modo = 'swap', texto = 'She said she was working late. The app showed me where she really was.'] = process.argv.slice(2);
  mkdirSync(saidaDir, { recursive: true });
  const arquivos: Record<string, string> = { 'campeao.mp4': path.resolve(campeao), 'clipe.mp4': path.resolve(clipe) };
  const servidor = http.createServer((req, res) => {
    const f = arquivos[path.basename(req.url ?? '')];
    if (!f) return void res.writeHead(404).end();
    const { size } = statSync(f);
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
      return void createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
    createReadStream(f).pipe(res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const m = new FfmpegMediaAnalysisService();
  const t0 = Date.now();
  const track = await m.faceTrack(campeao);
  console.log(`trilha (${((Date.now() - t0) / 1000).toFixed(1)} s):`, JSON.stringify(track.segments.map((s) => ({ f: [s.startFrame, s.endFrame], region: s.region, face: s.faceInRegion[0]?.box }))),
    'bloqueios', JSON.stringify(track.blockers));

  const input: RemixKeepRenderInput = {
    renderId: `remix-${modo}-${Date.now()}`, templateId: 'remix-keep', kind: 'remix-keep',
    canvas: { width: track.width, height: track.height, fps: track.fps, frameCount: track.frameCount },
    baseVideoUrl: `${base}/campeao.mp4`,
    audioPassthroughUrl: `${base}/campeao.mp4`,
    overlays: [], textLayers: [],
  };

  if (modo === 'swap') {
    const pc = await m.probe(clipe);
    const amostras = await m.detectFaces(clipe, 2);
    const melhores = amostras.map((s) => s.faces[0]).filter(Boolean);
    const duas = amostras.filter((s) => s.faces.length >= 2).length;
    console.log(`clipe ${pc.width}x${pc.height} ${pc.fps} fps: rosto em ${melhores.length}/${amostras.length} amostras, 2+ rostos em ${duas}`);
    const clipFace = { x: med(melhores.map((f) => f.box.x)), y: med(melhores.map((f) => f.box.y)), w: med(melhores.map((f) => f.box.w)), h: med(melhores.map((f) => f.box.h)) };
    // take AUDIO_LIPSYNC: da 1ª à última frame com rosto (§13.3 item 3); o clipe começa nesse instante do campeão
    const takeStartSec = (track.segments[0]?.startFrame ?? 0) / track.fps;
    input.overlays = track.segments.map((s) => ({
      startFrame: s.startFrame, endFrame: s.endFrame, region: s.region,
      clipUrl: `${base}/clipe.mp4`, clipOffsetSec: Math.max(0, s.startFrame / track.fps - takeStartSec),
      crop: m.fitCrop({ w: pc.width, h: pc.height }, clipFace, s.region, s.faceInRegion[0].box),
    }));
    console.log('overlays', JSON.stringify(input.overlays.map((o) => ({ f: [o.startFrame, o.endFrame], crop: o.crop }))));
  } else {
    // headline: caixa de texto aproximada (o que a visão devolve) → fundo medido no pixel → presença por frame
    const approx = { x: 14, y: 18, w: 692, h: 80 };
    const fundo = await m.solidBackground(campeao, 1.5, approx);
    const pres = await m.layerPresence(campeao, approx, 1.5);
    console.log('fundo', JSON.stringify(fundo?.box), 'presença', JSON.stringify(pres));
    input.textLayers = [{
      id: 'headline', startFrame: pres.startFrame, endFrame: pres.endFrame, box: approx,
      background: { kind: 'solid', color: fundo?.color ?? '#c10a09', box: fundo?.box ?? approx },
      style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 34, lineHeight: 1.08, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
      content: { kind: 'static', text: texto },
    }];
  }

  const svc = new RemotionRenderService(renderConfig((k) => process.env[k] ?? ({ REMOTION_BUNDLE_DIR: '../video/dist/bundle', RENDER_TMP_DIR: saidaDir } as Record<string, string>)[k]));
  const t1 = Date.now();
  let avisos = 0;
  const r = await svc.render(input, (p) => { avisos++; if (avisos % 40 === 0) console.log(`${p.stage} ${p.progress}% frame ${p.frame}/${p.totalFrames}`); });
  console.log(`render ${((Date.now() - t1) / 1000).toFixed(1)} s, ${avisos} avisos`, JSON.stringify(r));
  copyFileSync(r.outputPath, path.join(saidaDir, `peca-${modo}.mp4`));
  servidor.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
