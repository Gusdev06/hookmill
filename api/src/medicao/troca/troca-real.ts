/**
 * Prova real da troca de texto (V2, troca-texto §16.6), US$ 0: executor LOCAL (Python + ffmpeg) e prova no Chrome da API,
 * pela porta de verdade (TrocaTextoOrquestrada). Mede, escolhe a fonte no Chrome e, no solto, gera a placa em pedaços.
 *
 * Uso (de api/):
 *   TROCA_PYTHON=/caminho/python3 REMOTION_BROWSER_EXECUTABLE=/caminho/chrome-headless-shell \
 *   npx ts-node --transpile-only src/medicao/troca/troca-real.ts <casos.json> <saida-dir>
 * casos.json: [{ "nome", "video", "W", "H", "fps", "frames", "layer": EditLayer parcial, "bandas"?: ProtectedBand[] }]
 * Python: numpy 2.0.2, opencv-python-headless 5.0.0.93, pillow 11.3.0 (as da função).
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EditLayer, EditMap } from '@maquina/contratos';
import { ExecutorLocal, pastaPython } from './executor-local';
import { TrocaTextoOrquestrada } from './orquestra';
import { ProvaPuppeteer, pastaDeFontes } from './prova';

interface Caso { nome: string; video: string; W: number; H: number; fps: number; frames: number; layer: Partial<EditLayer> & { box: EditLayer['box']; text: string }; bandas?: EditMap['protectedBands'] }

async function main() {
  const [arqCasos, saida] = process.argv.slice(2);
  if (!arqCasos || !saida) throw new Error('uso: troca-real.ts <casos.json> <saida-dir>');
  mkdirSync(saida, { recursive: true });
  // vídeo relativo = relativo à pasta do casos.json (o worker só copia caminho absoluto)
  const casos = (JSON.parse(readFileSync(arqCasos, 'utf8')) as Caso[]).map((c) => ({ ...c, video: /^(https?:|\/)/.test(c.video) ? c.video : path.resolve(path.dirname(arqCasos), c.video) }));
  const fontesDir = pastaDeFontes(process.env.TROCA_FONTES_DIR);
  const storage = { putFile: async (key: string, file: string) => { const d = path.join(saida, key); mkdirSync(path.dirname(d), { recursive: true }); copyFileSync(file, d); } };
  const ex = new ExecutorLocal({ python: process.env.TROCA_PYTHON || 'python3', pyDir: pastaPython(process.env.TROCA_PY_DIR), fontesDir, ffmpeg: process.env.FFMPEG_PATH, ffprobe: process.env.FFPROBE_PATH }, storage);
  const porta = new TrocaTextoOrquestrada(ex, new ProvaPuppeteer({ browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null, fontesDir }), { log: console, aoMedir: (md, rg, stills) => {
    const d = path.join(saida, 'provas', String(atual)); mkdirSync(d, { recursive: true });
    for (const st of stills) writeFileSync(path.join(d, `${st.fontId}.png`), Buffer.from(st.png.split(',')[1], 'base64'));
    writeFileSync(path.join(d, 'ref.json'), JSON.stringify(md.ref ?? null));
    const c = md.candidatas?.map((x) => ({ fontId: x.fontId, cosPillow: x.cosPillow, sz: x.layout.sz })) ?? [];
    console.log('régua', JSON.stringify({ candidatas: c, regua: rg }));
    ultima = { candidatas: c, regua: rg };
  } });
  let ultima: unknown = null;
  let atual = '';
  const resumo: Record<string, unknown> = {};
  for (const c of casos) {
    const layer: EditLayer = {
      id: c.layer.id ?? 'headline-1', kind: c.layer.kind ?? 'headline', startFrame: c.layer.startFrame ?? 0, endFrame: c.layer.endFrame ?? c.frames,
      box: c.layer.box, background: c.layer.background ?? { kind: 'none', color: null, box: null },
      style: { fontId: 'inter-800', uppercase: false, fontSizePx: 40, lineHeight: 1.15, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: true, align: 'center', ...(c.layer.style ?? {}) },
      text: c.layer.text, wordsPerPage: null, source: 'vision',
    };
    const editMap = {
      version: 1, width: c.W, height: c.H, fps: c.fps, frameCount: c.frames, cells: [], faceTrack: [], layers: [layer], overlaysOverFace: [], profile: null,
      keepEdit: { SWAP_AVATAR: { available: false, blockers: [] }, NEW_HOOKS: { available: false, blockers: [] } }, protectedBands: c.bandas ?? [],
    } as EditMap;
    atual = c.nome;
    const t0 = Date.now();
    const m = await porta.medirHeadline({ workspaceId: 'w', championId: c.nome, videoUrl: c.video, editMap });
    const look = m.look!;
    const linha: Record<string, unknown> = {
      medir_s: (Date.now() - t0) / 1000, kind: look.kind, intervalo: [look.startFrame, look.endFrame], verdict: look.verdict, font: look.font,
      box: look.box, dilatacao: look.verdict.gates.dilatacao, sombra: look.text.shadow, linhas: look.text.lines, sizePx: look.text.sizePx,
      base: look.text.firstBaselineY, pitch: look.text.linePitchPx, centerX: look.fit.centerX, align: look.text.align,
      emoji: look.emoji && { ...look.emoji, image: `${look.emoji.image.length} B` }, plate: look.plate && { ...look.plate, image: `${look.plate.image.length} B` },
      erasedRects: look.fit.erasedRects, chinY: look.fit.chinY, bottomLimitY: look.fit.bottomLimitY,
    };
    writeFileSync(path.join(saida, `${c.nome}-look.json`), JSON.stringify(look, null, 1));
    if (look.kind === 'loose' && look.verdict.ok) {
      const t1 = Date.now();
      const p = await porta.placaHeadline({ workspaceId: 'w', championId: c.nome, videoUrl: c.video, look, version: 1, outputKey: `placas/${c.nome}.mp4` });
      linha.placa = { ...p, total_s: (Date.now() - t1) / 1000 };
    }
    linha.regua = ultima;
    resumo[c.nome] = linha;
    console.log(c.nome, JSON.stringify(linha, null, 1));
  }
  writeFileSync(path.join(saida, 'resumo.json'), JSON.stringify(resumo, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
