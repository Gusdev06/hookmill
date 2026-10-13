/**
 * Aceite local do V5 (§13.15, Trocar avatar com Kling/Seedance mantendo a edição) com clipes MOCK (nada pago):
 * o "motor" é imitado com os frames do próprio campeão (região do rosto, espelhada e com outra cor, 24 fps, genSec de
 * duração), e a cadeia de verdade roda em cima: janelas cortadas no meio de um silêncio → trimToFrames de cada janela →
 * lastFrame da janela vira o 1º frame da seguinte → concatClips → trimToFrames no nº exato de frames do trecho →
 * (A) "lipsync" mock (remux) | (B) voz do motor mock (a fala do campeão com outro tom e ±5-7 % de ritmo) → reencaixe
 * (corte + timeStretch) → áudio montado (audioSplice) + karaokê redesenhado com as palavras mescladas →
 * RenderService de verdade (arquivos por HTTP local, como as URLs assinadas).
 *
 * Uso (de api/): npx ts-node --transpile-only src/render/troca-motor-real.ts <campeao.mp4> <saida-dir> A|B [palavras.json] [legenda.json]
 *   palavras.json = [{word,startSec,endSec}] do teardown (B)   legenda.json = camada caption medida (B)
 * Requer: npm run build -w video (dist/lib + dist/bundle).
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Rect } from '@maquina/contratos';
import { FfmpegMediaAnalysisService } from '../medicao/media-analysis.service';
import { closeFaceDetector } from '../medicao/rostos';
import type { RemixKeepRenderInput } from './contrato';
import { RemotionRenderService } from './remotion-render.service';
import { renderConfig } from './render.module';
import { mesclarPalavras, type PalavraSeg } from './troca-motor';

const med = (v: number[]) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);
const seg = (t0: number) => ((Date.now() - t0) / 1000).toFixed(1);

/** Imitação do CatalogService.planSwapWindows (ia, §13.15.2): corta no meio do maior silêncio em [0,5 L, L]. */
function planejar(lenSec: number, silencios: { startSec: number; endSec: number }[], limite: number, genMin: number, folga: (l: number) => number) {
  const out: { startSec: number; endSec: number; genSec: number }[] = [];
  let a = 0;
  while (lenSec - a > limite) {
    const cands = silencios.filter((s) => s.endSec - s.startSec >= 0.15).map((s) => ({ ...s, meio: (s.startSec + s.endSec) / 2 }))
      .filter((s) => s.meio >= a + 0.5 * limite && s.meio <= a + limite).sort((x, y) => (y.endSec - y.startSec) - (x.endSec - x.startSec));
    const corte = cands[0]?.meio ?? a + limite;
    out.push({ startSec: a, endSec: corte, genSec: 0 });
    a = corte;
  }
  out.push({ startSec: a, endSec: lenSec, genSec: 0 });
  return out.map((w) => ({ ...w, genSec: Math.min(15, Math.max(genMin, Math.ceil(folga(w.endSec - w.startSec)))) }));
}

/** Imitação do CatalogService.fitEngineVoice (ia, §13.15.3). */
function reencaixar(src: PalavraSeg[], srcSec: number, clip: PalavraSeg[], clipSec: number) {
  const sourceSec = src[src.length - 1].endSec - src[0].startSec;
  const voiceSec = clip[clip.length - 1].endSec - clip[0].startSec;
  const ratio = voiceSec / sourceSec;
  const padL = src[0].startSec, padR = srcSec - src[src.length - 1].endSec;
  const cutStartSec = Math.max(0, clip[0].startSec - padL * ratio);
  const cutEndSec = Math.min(clipSec, clip[clip.length - 1].endSec + padR * ratio);
  const f = (cutEndSec - cutStartSec) / srcSec;
  if (Math.abs(f - 1) > 0.08) return { error: 'VOICE_FIT_OUT_OF_RANGE' as const, ratio, sourceSec, voiceSec };
  return { mode: Math.abs(f - 1) <= 0.02 ? 'EXACT' as const : 'STRETCH' as const, ratio, sourceSec, voiceSec, cutStartSec, cutEndSec, f };
}

async function main() {
  const [campeao, saidaDir, modo = 'A', palavrasJson, legendaJson] = process.argv.slice(2);
  const voz = modo === 'B';
  const tmp = path.resolve(saidaDir, `trabalho-${modo}`);
  mkdirSync(tmp, { recursive: true });
  const arquivos: Record<string, string> = { 'campeao.mp4': path.resolve(campeao) };
  const servir = (f: string) => { const n = path.basename(f); arquivos[n] = f; return `${base}/${n}`; };
  const servidor = http.createServer((req, res) => {
    const f = arquivos[path.basename(req.url ?? '')];
    if (!f) return void res.writeHead(404).end();
    const { size } = statSync(f);
    const tipo = f.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4';
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const a = Number(range[1]), b = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': tipo, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
      return void createReadStream(f, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' });
    createReadStream(f).pipe(res);
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const m = new FfmpegMediaAnalysisService();
  const t0 = Date.now();
  const track = await m.faceTrack(campeao);
  const fps = track.fps;
  const trechos = track.timeline.filter((s) => s.kind === 'main');
  console.log(`trilha ${seg(t0)} s: ${track.frameCount} frames, trechos main ${JSON.stringify(trechos.map((t) => [t.startFrame, t.endFrame]))}`);
  const audioCamp = path.join(tmp, 'campeao.m4a');
  await m.extractAudio(campeao, audioCamp);
  const silencios = await m.silences(audioCamp, 0.15);
  const palavras: PalavraSeg[] = palavrasJson ? JSON.parse(readFileSync(palavrasJson, 'utf8')) : [];

  const t1 = Date.now();
  const cenas: { trecho: (typeof trechos)[number]; clip: string; face: string; palavras: PalavraSeg[]; fit?: unknown; janelas: number }[] = [];
  const ratios = [1.05, 0.95, 1.0, 1.07];
  for (const [ti, tr] of trechos.entries()) {
    const sg = track.segments.find((s) => s.startFrame < tr.endFrame && s.endFrame > tr.startFrame)!;
    const reg = { x: Math.round(sg.region.x), y: Math.round(sg.region.y), w: Math.round(sg.region.w) & ~1, h: Math.round(sg.region.h) & ~1 };
    const t0s = tr.startFrame / fps, lenSec = (tr.endFrame - tr.startFrame) / fps;
    const sil = silencios.map((s) => ({ startSec: s.startSec - t0s, endSec: s.endSec - t0s })).filter((s) => s.endSec > 0 && s.startSec < lenSec);
    const janelas = voz ? planejar(lenSec, sil, 12.5, 3, (l) => l * 1.15 + 0.3) : planejar(lenSec, sil, 14.5, 3, (l) => l + 0.2);
    const outH = 1080, outW = Math.round((outH * reg.w) / reg.h / 2) * 2;
    const r = voz ? ratios[ti % ratios.length] : 1;
    // (B) a imagem acompanha a voz mock: começa 0,3 s depois (1º frame parado) e no mesmo ritmo ×r
    const sincroniaVoz = voz ? `,tpad=start_mode=clone:start_duration=0.3,setpts=${r}*(PTS-STARTPTS)` : '';
    const visualDe = (w: { startSec: number }) => `crop=${reg.w}:${reg.h}:${reg.x}:${reg.y},hflip,hue=h=35:s=1.15,trim=duration=${(lenSec - w.startSec - 0.5 / fps).toFixed(4)},tpad=stop_mode=clone:stop_duration=16${sincroniaVoz},scale=${outW}:${outH}:flags=lanczos,fps=24,format=yuv420p`;
    const cortadas: string[] = [];
    let face = '';
    let anterior: string | null = null;
    for (const [k, w] of janelas.entries()) {
      // "motor": frames do campeão a partir do início da janela, genSec de duração; janela k>0 começa no último frame da k-1
      const bruta = path.join(tmp, `t${ti}-j${k}-motor.mp4`);
      const ini = t0s + w.startSec;
      const vozArgs = voz ? ['-ss', ini.toFixed(3), '-t', ((w.endSec - w.startSec) * 1.0).toFixed(3), '-i', campeao] : [];
      // voz mock: a fala do campeão com outro tom (asetrate) e ritmo ×r, começando em 0,3 s
      const vozF = voz ? `;[${anterior ? 2 : 1}:a]asetrate=44100*1.18,aresample=44100,atempo=${(1 / 1.18 / r).toFixed(5)},adelay=300:all=1,apad[a]` : '';
      if (anterior) {
        ff(['-loop', '1', '-t', (1 / 24).toFixed(4), '-i', anterior, '-ss', (ini + 1 / fps).toFixed(3), '-t', w.genSec.toFixed(3), '-i', campeao, ...vozArgs,
          '-filter_complex', `[0:v]scale=${outW}:${outH},fps=24,format=yuv420p,setsar=1[p];[1:v]${visualDe(w)},setsar=1[c];[p][c]concat=n=2:v=1:a=0,trim=duration=${w.genSec}[v]${vozF}`,
          '-map', '[v]', ...(voz ? ['-map', '[a]', '-t', String(w.genSec), '-c:a', 'aac', '-b:a', '256k'] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', bruta]);
      } else {
        ff(['-ss', ini.toFixed(3), '-t', w.genSec.toFixed(3), '-i', campeao, ...vozArgs, '-filter_complex', `[0:v]${visualDe(w)}[v]${vozF}`,
          '-map', '[v]', ...(voz ? ['-map', '[a]', '-t', String(w.genSec), '-c:a', 'aac', '-b:a', '256k'] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', bruta]);
        face = path.join(tmp, `t${ti}-rosto.png`);   // "rosto escolhido" do mock = meio da janela 0 (o 1º pode ser o preto do corte)
        ff(['-ss', (w.genSec / 2).toFixed(3), '-i', bruta, '-frames:v', '1', face]);
      }
      // (A) usa só o pedaço da janela; (B) a janela inteira (o corte vem do reencaixe)
      const usada = path.join(tmp, `t${ti}-j${k}-usada.mp4`);
      const n = voz ? Math.round(w.genSec * fps) : Math.round((w.endSec - w.startSec) * fps);
      await m.trimToFrames(bruta, n, fps, usada);
      anterior = await m.lastFrame(usada, path.join(tmp, `t${ti}-j${k}-ultimo.png`));
      cortadas.push(usada);
    }
    const emendada = path.join(tmp, `t${ti}-emendada.mp4`);
    await m.concatClips(cortadas, emendada);
    const nTrecho = tr.endFrame - tr.startFrame;
    const clip = path.join(tmp, `t${ti}-clip.mp4`);
    let palavrasCena: PalavraSeg[] = [];
    let fit: unknown;
    if (!voz) {
      const cru = path.join(tmp, `t${ti}-cru.mp4`);
      await m.trimToFrames(emendada, nTrecho, fps, cru);
      // "lipsync v2v" mock: o mesmo vídeo com a fatia do áudio do campeão, devolvendo 1 frame A MENOS (o sync/lipsync-2
      // faz isso: 123 → 122, achado da ia 08/10). O trimToFrames repõe o último frame até o nº exato do trecho.
      const lip = path.join(tmp, `t${ti}-lipsync.mp4`);
      ff(['-i', cru, '-ss', t0s.toFixed(4), '-t', lenSec.toFixed(4), '-i', campeao, '-map', '0:v', '-map', '1:a', '-frames:v', String(nTrecho - 1),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-c:a', 'aac', lip]);
      console.log(`trecho ${ti}: lipsync mock ${await m.frameCount(lip)} frames → trimToFrames ${nTrecho}`);
      await m.trimToFrames(lip, nTrecho, fps, clip);
    } else {
      // "TRANSCRIBE" mock: as palavras do teardown no trecho, como o motor falou (×r, começando em 0,3 s)
      const src = palavras.filter((p) => (p.startSec + p.endSec) / 2 >= t0s && (p.startSec + p.endSec) / 2 < t0s + lenSec)
        .map((p) => ({ word: p.word, startSec: p.startSec - t0s, endSec: p.endSec - t0s }));
      const dur = (await m.probe(emendada)).durationSec;
      const doClip = src.map((p) => ({ word: p.word, startSec: 0.3 + p.startSec * r, endSec: 0.3 + p.endSec * r }));
      const ajuste = reencaixar(src, lenSec, doClip, dur);
      fit = ajuste;
      if ('error' in ajuste) throw new Error(`trecho ${ti}: ${JSON.stringify(ajuste)}`);
      const [cortado] = await m.cutVideo(emendada, [{ startSec: ajuste.cutStartSec, endSec: ajuste.cutEndSec }], path.join(tmp, `t${ti}-corte`));
      const fator = lenSec / (ajuste.cutEndSec - ajuste.cutStartSec);
      const esticado = path.join(tmp, `t${ti}-esticado.mp4`);
      if (ajuste.mode === 'STRETCH') await m.timeStretch(cortado, fator, esticado);
      await m.trimToFrames(ajuste.mode === 'STRETCH' ? esticado : cortado, nTrecho, fps, clip);
      palavrasCena = doClip.map((p) => ({ word: p.word, startSec: (p.startSec - ajuste.cutStartSec) * fator, endSec: (p.endSec - ajuste.cutStartSec) * fator }));
      console.log(`trecho ${ti}: ratio ${ajuste.ratio.toFixed(3)} ${ajuste.mode} fator ${fator.toFixed(4)}`);
    }
    const nClip = await m.frameCount(clip);
    if (nClip !== nTrecho) throw new Error(`trecho ${ti}: clipe ${nClip} frames, trecho ${nTrecho}`);
    const id = await m.identityScore(clip, face);
    console.log(`trecho ${ti} [${tr.startFrame},${tr.endFrame}) ${janelas.length} janela(s) ${JSON.stringify(janelas)} → ${nClip} frames, identidade ${JSON.stringify(id)}`);
    cenas.push({ trecho: tr, clip, face, palavras: palavrasCena, fit, janelas: janelas.length });
  }
  console.log(`cadeia das cenas ${seg(t1)} s`);

  const input: RemixKeepRenderInput = {
    renderId: `troca-${modo}-${Date.now()}`, templateId: 'remix-keep', kind: 'remix-keep',
    canvas: { width: track.width, height: track.height, fps, frameCount: track.frameCount },
    baseVideoUrl: `${base}/campeao.mp4`, audioPassthroughUrl: `${base}/campeao.mp4`, overlays: [], textLayers: [],
  };
  const trilha: { startFrame: number; endFrame: number; region: Rect }[] = [];
  for (const c of cenas) {
    const pc = await m.probe(c.clip);
    const am = (await m.detectFaces(c.clip, 2)).map((s) => s.faces[0]).filter(Boolean);
    const clipFace = { x: med(am.map((f) => f.box.x)), y: med(am.map((f) => f.box.y)), w: med(am.map((f) => f.box.w)), h: med(am.map((f) => f.box.h)) };
    const url = servir(c.clip);
    for (const s of track.segments.filter((s) => s.startFrame >= c.trecho.startFrame && s.endFrame <= c.trecho.endFrame)) {
      input.overlays.push({ startFrame: s.startFrame, endFrame: s.endFrame, region: s.region, clipUrl: url,
        clipOffsetSec: (s.startFrame - c.trecho.startFrame) / fps,
        crop: m.fitCrop({ w: pc.width, h: pc.height }, clipFace, s.region, s.faceInRegion[0].box) });
      trilha.push({ startFrame: s.startFrame, endFrame: s.endFrame, region: s.region });
    }
  }
  const excluir: { startFrame: number; endFrame: number; box: Rect }[] = [];
  if (voz) {
    input.audioSplice = { fadeMs: 10, spans: cenas.map((c) => ({ startFrame: c.trecho.startFrame, endFrame: c.trecho.endFrame, url: servir(c.clip) })) };
    const leg = JSON.parse(readFileSync(legendaJson!, 'utf8'));
    // a legenda do campeão não tem pontuação (o whisper tem): tira das pontas, como o estilo medido
    const limpa = (x: string) => x.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '') || x;
    const words = mesclarPalavras(palavras.map((p) => ({ ...p, word: limpa(p.word) })), cenas.map((c) => ({ startFrame: c.trecho.startFrame, endFrame: c.trecho.endFrame, words: c.palavras })), fps)
      .map((w) => ({ ...w, word: limpa(w.word) })).filter((w) => w.startFrame >= leg.startFrame && w.startFrame < leg.endFrame).map((w) => ({ ...w, endFrame: Math.min(w.endFrame, leg.endFrame) }));
    input.textLayers.push({ ...leg, content: { kind: 'karaoke', words, wordsPerPage: leg.wordsPerPage } });
    excluir.push({ startFrame: leg.startFrame, endFrame: leg.endFrame, box: leg.background.box ?? leg.box });
  }
  writeFileSync(path.join(saidaDir, `entrada-${modo}.json`), JSON.stringify({ ...input, cenas: cenas.map((c) => ({ trecho: c.trecho, janelas: c.janelas, fit: c.fit })) }, null, 1));
  writeFileSync(path.join(saidaDir, `trilha-${modo}.json`), JSON.stringify(trilha));
  writeFileSync(path.join(saidaDir, `excluir-${modo}.json`), JSON.stringify(excluir));

  const svc = new RemotionRenderService(renderConfig((k) => process.env[k] ?? ({ REMOTION_BUNDLE_DIR: '../video/dist/bundle', RENDER_TMP_DIR: tmp } as Record<string, string>)[k]));
  const t2 = Date.now();
  let avisos = 0;
  const r = await svc.render(input, (p) => { avisos++; if (avisos % 60 === 0) console.log(`${p.stage} ${p.progress}% frame ${p.frame}/${p.totalFrames}`); });
  console.log(`render ${seg(t2)} s, ${avisos} avisos`, JSON.stringify({ ...r, outputPath: undefined }));
  ff(['-i', r.outputPath, '-c', 'copy', path.join(saidaDir, `peca-${modo}.mp4`)]);
  servidor.close();
  await closeFaceDetector();
  console.log(`total ${seg(t0)} s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
