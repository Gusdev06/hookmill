/**
 * Prova real da cópia da headline (troca-texto §16.6 V3), US$ 0: `look` medido (pela porta local, `troca-real.ts`) →
 * `buildHeadlineInput` → `RemotionRenderService` de verdade (Chrome + ffmpeg da máquina) → peça. Sem AWS, sem banco, sem API.
 * Mede tempo e memória (soma do RSS da árvore de processos, amostrada a cada 200 ms) e grava `pecas.json` com as máscaras
 * que a conferência (research_notes/v3-2026-11-06/scripts/conferir.py) usa.
 *
 * Uso (de api/): REMOTION_BROWSER_EXECUTABLE=... npx ts-node --transpile-only src/render/copia-real.ts <casos.json> <looks-dir> <saida-dir>
 * casos.json: [{ "nome", "video", "placa"?, "variantes": [{ "nome", "text", "highlight"? }] }]; o look é `<looks-dir>/<nome>-look.json`.
 * Requer: npm run build -w video.
 */
import { copyFileSync, createReadStream, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { EditMap, HeadlineLook } from '@maquina/contratos';
import type { AutoEditContext } from './auto-edit';
import { buildHeadlineInput } from './headline';
import { sondarVideo } from './posprocesso';
import { RemotionRenderService } from './remotion-render.service';
import { renderConfig } from './render.module';

interface Caso { nome: string; video: string; placa?: string; variantes: { nome: string; text: string; highlight?: string | null }[] }

/** RSS somado (MB) do processo e de todos os descendentes (Chrome, ffmpeg). */
function rssArvore(raiz: number): number {
  const filhos = new Map<number, number[]>();
  const rss = new Map<number, number>();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = readFileSync(`/proc/${d}/stat`, 'utf8');
      const resto = st.slice(st.lastIndexOf(')') + 2).split(' ');
      const pid = Number(d), ppid = Number(resto[1]);
      rss.set(pid, Number(resto[21]) * 4096);
      filhos.set(ppid, [...(filhos.get(ppid) ?? []), pid]);
    } catch { /* processo sumiu */ }
  }
  let total = 0;
  const pilha = [raiz];
  while (pilha.length) { const p = pilha.pop()!; total += rss.get(p) ?? 0; pilha.push(...(filhos.get(p) ?? [])); }
  return total / 2 ** 20;
}

async function main() {
  const [arqCasos, looksDir, saida] = process.argv.slice(2);
  if (!arqCasos || !looksDir || !saida) throw new Error('uso: copia-real.ts <casos.json> <looks-dir> <saida-dir>');
  mkdirSync(saida, { recursive: true });
  const casos = JSON.parse(readFileSync(arqCasos, 'utf8')) as Caso[];
  const arquivos: Record<string, string> = {};
  for (const c of casos) {
    arquivos[`${c.nome}.mp4`] = path.resolve(c.video);
    if (c.placa) arquivos[`${c.nome}-placa.mp4`] = path.resolve(c.placa);
  }
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
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const svc = new RemotionRenderService(renderConfig((k) => process.env[k] ?? ({ REMOTION_BUNDLE_DIR: '../video/dist/bundle', RENDER_TMP_DIR: path.join(saida, 'tmp') } as Record<string, string>)[k]));
  const ff = { ffprobe: process.env.FFPROBE_PATH || 'ffprobe' };
  const out: Record<string, unknown>[] = [];

  for (const c of casos) {
    const look = JSON.parse(readFileSync(path.join(looksDir, `${c.nome}-look.json`), 'utf8')) as HeadlineLook;
    const v = await sondarVideo(ff, path.resolve(c.video));
    const editMap = { version: 1, width: v.width, height: v.height, fps: v.fps, frameCount: v.frames, cells: [], faceTrack: [], layers: [], overlaysOverFace: [], profile: null,
      keepEdit: { SWAP_AVATAR: { available: false, blockers: [] }, NEW_HOOKS: { available: false, blockers: [] } }, protectedBands: [] } as unknown as EditMap;
    const ctx = {
      renderId: '', type: 'HOOK_TEXT', params: {}, language: 'es', editMap, words: [], silences: [], blocks: [], hookEndSec: null, palette: [], brandName: 'v3', page: null,
      source: { videoUrl: `${url}/${c.nome}.mp4`, width: v.width, height: v.height, fps: v.fps, durationSec: v.frames / v.fps, hasAudio: true },
    } as unknown as AutoEditContext;
    for (const va of c.variantes) {
      const nome = `${c.nome}-${va.nome}`;
      const input = buildHeadlineInput({ mode: 'replace', text: va.text, highlight: va.highlight ?? null, language: 'es', brandColor: null, look },
        { ...ctx, renderId: `v3-${nome}-${Date.now()}` }, { plateUrl: c.placa ? `${url}/${c.nome}-placa.mp4` : null });
      const camada = input.textLayers[0];
      let pico = 0;
      const amostra = setInterval(() => { pico = Math.max(pico, rssArvore(process.pid)); }, 200);
      const t0 = Date.now();
      const r = await svc.render(input, () => undefined);
      const s = (Date.now() - t0) / 1000;
      clearInterval(amostra);
      const dst = path.join(saida, `${nome}.mp4`);
      copyFileSync(r.outputPath, dst);
      const linha = {
        nome, caso: c.nome, kind: look.kind, peca: dst, campeao: path.resolve(c.video), placa: c.placa ? path.resolve(c.placa) : null, quadros: input.canvas.frameCount, fps: input.canvas.fps,
        startFrame: camada.startFrame, endFrame: camada.endFrame, render_s: s, pico_rss_MB: Math.round(pico),
        // o que pode mudar na peça: a caixa (box) ou a tinta nova + a área que a placa apagou (loose; ROI da placa = texto + emoji + 12 px)
        mascara: look.kind === 'box' ? [camada.background.box] : [camada.box, roiDaPlaca(look)],
        linhas: camada.content.kind === 'static' ? camada.content.lines : null, fonte: camada.style.fontId, tamanho: camada.style.fontSizePx,
      };
      console.log(JSON.stringify(linha));
      out.push(linha);
    }
  }
  writeFileSync(path.join(saida, 'pecas.json'), JSON.stringify(out, null, 1));
  servidor.close();
}

function roiDaPlaca(look: HeadlineLook) {
  const t = look.text.textBox, e = look.emoji;
  const x0 = Math.min(t.x, e?.x ?? Infinity) - 12, y0 = Math.min(t.y, e?.y ?? Infinity) - 12;
  const x1 = Math.max(t.x + t.w, e ? e.x + e.w : -Infinity) + 12, y1 = Math.max(t.y + t.h, e ? e.y + e.h : -Infinity) + 12;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

main().catch((e) => { console.error(e); process.exit(1); });
