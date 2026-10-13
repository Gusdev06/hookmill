// Jest da §13.1 (manter a edição): células, YuNet, trilha do rosto, presença de camada, fundo da faixa, fitCrop.
// Vídeo sintético feito por ffmpeg com um rosto NOSSO (__fixtures__/rosto.jpg, gerado por nós no lote zap-working-late)
// colado numa caixa. O caso real (campeão do Gusta) roda só se o arquivo existir na máquina (mídia fora do git).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegMediaAnalysisService } from './media-analysis.service';
import { boundaries, cellsFromFrames } from './celulas';
import { closeFaceDetector, decodeYunet } from './rostos';
import { buildFaceTrack, fitCrop, mainAvatar, mainIdentity, refineEdge, scaleSteps, timeline, trackBlockers } from './trilha';
import { presenceCut, presenceRun, solidFromFrame } from './camadas';

jest.setTimeout(400_000);   // YuNet em 2 passadas + layout; em paralelo com outras suítes passa de 3 min

const svc = new FfmpegMediaAnalysisService();
const ROSTO = join(__dirname, '__fixtures__', 'rosto.jpg');
const CAMPEAO = '/Users/gustagoat/Documents/AIS-OS/projects/mentoria-spy/criativos/zap-working-late-etnias-2026-10-06/pecas/zap-working-late-v2-latino.mp4';
// = campeão cmuwsqw79000922x2t8gz86v3 do Gusta (AdLibNote Canal7, 909 frames): caixa do rosto sem coluna visível embaixo
// podcast do Gusta (07/10): apresentadora ruiva até 0:33, cortes da convidada e inserts; b-roll de outra mulher 0:33-0:49
const PODCAST = '/Users/gustagoat/Downloads/8e982d56-fd78-4e40-8a67-5d259e7f0e4a.mp4';
const ADLIBNOTE = '/Users/gustagoat/Documents/AIS-OS/projects/mentoria-spy/criativos/zap-working-late-etnias-2026-10-06/REFERENCIA-original.mp4';
let dir: string;
let caixa: string;   // 720x960, 30 fps, 3 s: faixa vermelha 0-118, rosto na caixa x0 y118 337x325 até o frame 47, cinza depois; painel à direita
let dois: string;    // imagem com 2 rostos lado a lado

const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'manter-edicao-'));
  caixa = join(dir, 'caixa.mp4');
  ff([
    '-f', 'lavfi', '-i', 'color=c=0x101418:s=720x960:r=30:d=3',
    '-loop', '1', '-framerate', '30', '-t', '3', '-i', ROSTO,
    // painel parecido com tela de app (fundo escuro, bolinhas verdes mexendo); testsrc2 tem barras verticais de alto
    // contraste na altura toda, que nenhum criativo tem, e escondem a borda x=337 (limite conhecido, docs/render.md)
    '-f', 'lavfi', '-i', 'life=s=383x669:mold=10:r=30:ratio=0.1:death_color=#0d1a14:life_color=#20e080',
    '-filter_complex',
    // rosto ocupa a caixa (cover) e balança 2 px pra não ser imagem parada; a partir do frame 47 a caixa vira cinza
    '[1:v]scale=337:-2,crop=337:325:0:(ih-325)/2,setsar=1[r];' +
    '[0:v]drawbox=x=0:y=0:w=720:h=118:c=0xc00a08:t=fill[b];' +
    '[b][r]overlay=x=0:y=\'118+2*sin(n/3)\':enable=\'lt(n,47)\'[c];' +
    '[c]drawbox=x=0:y=118:w=337:h=325:c=0x606060:t=fill:enable=\'gte(n,47)\'[d];' +
    '[d][2:v]overlay=x=337:y=118[e];[e]drawbox=x=0:y=443:w=337:h=344:c=0x303030:t=fill,format=yuv420p[v]',
    '-map', '[v]', '-frames:v', '90', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', caixa,
  ]);
  dois = join(dir, 'dois.png');
  ff(['-i', ROSTO, '-i', ROSTO, '-filter_complex', '[0:v]scale=320:320[a];[1:v]scale=320:320,hflip[b];[a][b]hstack', '-frames:v', '1', dois]);
});
afterAll(async () => { rmSync(dir, { recursive: true, force: true }); await closeFaceDetector(); });

describe('células (guilhotina)', () => {
  it('acha a caixa do rosto como célula própria (±2 px)', async () => {
    const m = await svc.measureLayout(caixa);
    const cells = m.segments.flatMap((s) => s.cells);
    const c = cells.find((x) => x.x <= 2 && Math.abs(x.y - 118) <= 2 && Math.abs(x.w - 337) <= 2);
    expect(c).toBeDefined();
    expect(Math.abs(c!.y + c!.h - 443)).toBeLessThanOrEqual(2);
  });

  it('boundaries escolhe por força e respeita a distância mínima', () => {
    const g = new Float64Array(99);
    g[29] = 50; g[34] = 80; g[69] = 60;   // fronteiras em 30, 35, 70; 30 e 35 a menos de 10 → fica a mais forte
    for (let i = 0; i < 99; i++) g[i] += 1;
    expect(boundaries([g, g], 100, 10)).toEqual([35, 70]);
  });

  it('cellsFromFrames: quadro liso = 1 célula', () => {
    const data = new Uint8Array(40 * 30 * 3).fill(90);
    expect(cellsFromFrames([{ data, w: 40, h: 30 }])).toEqual([{ x: 0, y: 0, w: 40, h: 30 }]);
  });
});

describe('YuNet', () => {
  it('acha o rosto na imagem e 2 rostos no lado a lado (score ≥ 0,8)', async () => {
    const um = await svc.detectFaces(ROSTO);
    expect(um).toHaveLength(1);
    expect(um[0].faces.length).toBe(1);
    expect(um[0].faces[0].score).toBeGreaterThanOrEqual(0.8);
    const d = await svc.detectFaces(dois);
    expect(d[0].faces.length).toBe(2);
  });

  it('decodeYunet: score = sqrt(cls*obj), NMS fica com o de maior score', () => {
    const z = (n: number) => new Float32Array(n);
    const out: Record<string, Float32Array> = {};
    for (const s of [8, 16, 32]) { const n = (640 / s) ** 2; out[`cls_${s}`] = z(n); out[`obj_${s}`] = z(n); out[`bbox_${s}`] = z(4 * n); }
    const n32 = 20; // stride 32: célula (r=1,c=1) = índice 21; vizinha 22
    out.cls_32[21] = 0.9; out.obj_32[21] = 0.9; out.cls_32[22] = 0.81; out.obj_32[22] = 0.81;
    out.bbox_32.set([0, 0, Math.log(3), Math.log(3)], 21 * 4);
    out.bbox_32.set([-1, 0, Math.log(3), Math.log(3)], 22 * 4);  // mesma caixa → suprimida
    const f = decodeYunet(out, 0.5);
    expect(n32).toBe(20);
    expect(f).toHaveLength(1);
    expect(f[0].score).toBeCloseTo(0.9, 3);
    const b = f[0].box;
    [b.x, b.y, b.w, b.h].forEach((v, i) => expect(v).toBeCloseTo([-16, -16, 96, 96][i], 4));
  });
});

describe('trilha do rosto', () => {
  it('região = célula da caixa, trecho [0, 47) no frame exato, sem bloqueio', async () => {
    const t = await svc.faceTrack(caixa);
    expect(t.frameCount).toBe(90);
    expect(t.segments).toHaveLength(1);
    const s = t.segments[0];
    expect(Math.abs(s.region.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.region.y - 118)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.region.w - 337)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.region.y + s.region.h - 443)).toBeLessThanOrEqual(2);
    expect(s.startFrame).toBe(0);
    expect(Math.abs(s.endFrame - 47)).toBeLessThanOrEqual(1);
    expect(s.fullFrame).toBe(false);
    expect(s.facesMax).toBe(1);
    expect(t.blockers).toEqual([]);
  });

  it('buildFaceTrack: 2 rostos na região em > 10 % das amostras = multiple_faces; nenhum rosto = no_face', () => {
    const region = { x: 0, y: 0, w: 100, h: 100 };
    const face = (x: number, score = 0.9) => ({ box: { x, y: 20, w: 20, h: 30 }, score });
    const samples = Array.from({ length: 10 }, (_, i) => ({ frame: i * 6, atSec: i / 5, faces: i < 3 ? [face(10), face(60, 0.85)] : [face(10)] }));
    const d = buildFaceTrack(samples, [{ startFrame: 0, endFrame: 60, cells: [region, { x: 100, y: 0, w: 100, h: 100 }] }], { width: 200, height: 100 });
    expect(d.segments).toHaveLength(1);
    expect(d.segments[0].facesMax).toBe(2);
    expect(trackBlockers(d, 30).map((b) => b.reason)).toEqual(['multiple_faces']);
    const vazio = buildFaceTrack(samples.map((s) => ({ ...s, faces: [] })), [{ startFrame: 0, endFrame: 60, cells: [region] }], { width: 100, height: 100 });
    expect(trackBlockers(vazio, 30)).toEqual([{ reason: 'no_face', startSec: null, endSec: null }]);
  });

  it('falso rosto grande abaixo de 0,8 (planta) não vira o principal: o limiar de score vem antes do tamanho', () => {
    const cells = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 0, w: 100, h: 100 }];
    const samples = Array.from({ length: 6 }, (_, i) => ({ frame: i * 6, atSec: i / 5,
      faces: [{ box: { x: 110, y: 5, w: 80, h: 90 }, score: 0.75 }, { box: { x: 40, y: 40, w: 15, h: 20 }, score: 0.95 }] }));
    const d = buildFaceTrack(samples, [{ startFrame: 0, endFrame: 36, cells }], { width: 200, height: 100 });
    expect(d.segments[0].region).toEqual(cells[0]);
  });

  it('avatar principal = trilha mais persistente e maior; rosto pequeno de outro painel não é o principal', () => {
    const grande = (x: number) => ({ box: { x, y: 40, w: 90, h: 120 }, score: 0.9 });
    const pequeno = { box: { x: 90, y: 700, w: 40, h: 53 }, score: 0.95 };   // score maior, mas é o casal da câmera
    const S = Array.from({ length: 10 }, (_, i) => ({ frame: i * 6, atSec: i / 5, faces: [pequeno, grande(140 + (i % 3))] }));
    const m = mainAvatar(S, 0.8);
    expect(m.faces.every((f) => f && f.box.h === 120)).toBe(true);
    expect(m.others).toHaveLength(1);
  });

  it('identidade: o principal é o grupo mais persistente × maior; a convidada no mesmo lugar não é o principal', () => {
    const e = (i: number) => Array.from({ length: 4 }, (_, k) => (k === i ? 1 : 0));
    const host = (frame: number) => ({ frame, atSec: frame / 30, faces: [{ box: { x: 260, y: 470, w: 195, h: 265 }, score: 0.95, emb: e(0) }] });
    const guest = (frame: number) => ({ frame, atSec: frame / 30, faces: [{ box: { x: 260, y: 470, w: 195, h: 265 }, score: 0.95, emb: e(1) }] });
    const S = [0, 6, 12, 18, 24, 30].map(host).concat([36, 42].map(guest), [48, 54, 60].map(host));
    expect(mainIdentity(S, 0.8)).toEqual(e(0));
    const d = buildFaceTrack(S, [{ startFrame: 0, endFrame: 66, cells: [{ x: 0, y: 0, w: 720, h: 1280 }] }], { width: 720, height: 1280 });
    expect(d.segments.map((x) => [x.startFrame, x.endFrame])).toEqual([[0, 36], [48, 66]]);
    expect(timeline(d.segments, S, 66).map((x) => x.kind)).toEqual(['main', 'other_person', 'main']);
  });

  it('scaleSteps parte no salto de > 15 % e refineEdge pega o maior salto', () => {
    const pts = [0.3, 0.31, 0.3, 0.29, 0.45, 0.46, 0.45].map((h, i) => ({ frame: i * 6, rel: { x: 0.4, y: 0.1, w: h * 0.7, h } }));
    const st = scaleSteps(pts, 0.15);
    expect(st).toHaveLength(2);
    expect(st[1].atFrame).toBe(24);
    expect(refineEdge(10, [0.1, 0.2, 0.1, 9, 0.3, 0.2])).toBe(11);
  });
});

describe('fitCrop', () => {
  it('mantém a proporção rosto/região do original e o aspecto da região, dentro do clipe', () => {
    const c = fitCrop({ w: 1000, h: 1000 }, { x: 450, y: 200, w: 100, h: 120 }, { w: 300, h: 200 }, { x: 0.4, y: 0.2, w: 0.2, h: 0.4 });
    expect(c.h).toBeCloseTo(300, 1);         // 120 / 0.4
    expect(c.w / c.h).toBeCloseTo(1.5, 3);
    expect(c.x + c.w).toBeLessThanOrEqual(1000);
    expect(c.y).toBeGreaterThanOrEqual(0);
    // rosto pequeno demais pra caber: o recorte encosta no limite do clipe, sem sair dele (cover, sem barra)
    const g = fitCrop({ w: 960, h: 960 }, { x: 400, y: 200, w: 120, h: 340 }, { w: 337, h: 325 }, { x: 0.43, y: 0.11, w: 0.27, h: 0.37 });
    expect(g.w).toBeLessThanOrEqual(960);
    expect(g.h).toBeLessThanOrEqual(960);
    expect(g.w / g.h).toBeCloseTo(337 / 325, 2);
  });
});

describe('camadas', () => {
  it('presença: salto de verdade corta, recompressão (1-3 níveis) não corta', () => {
    const d = [0, 0.2, 0.3, 0.1, 30, 31, 29];
    expect(presenceRun(d, 0, 40)).toEqual({ startFrame: 0, endFrame: 4 });
    const pulsa = [0, 0.3, 0.4, 2.4, 2.5, 2.6];
    expect(presenceCut(pulsa, 40)).toBe(Infinity);
    expect(presenceRun(pulsa, 0, 40)).toEqual({ startFrame: 0, endFrame: 6 });
  });

  it('fundo em degradê com texto: caixa da faixa e cor reconstruída sem o texto', () => {
    const w = 200, h = 120;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3;
      const faixa = y < 60;
      const texto = faixa && y >= 15 && y < 45 && x >= 20 && x < 180 && (x % 10) < 6;   // ~60 % de "letra" nas linhas de texto
      const v = faixa ? [240 - 2 * y, 10, 5] : [20, 30, 25];
      rgb.set(texto ? [255, 255, 255] : v, o);
    }
    const r = solidFromFrame(rgb, w, h, { x: 20, y: 15, w: 160, h: 30 });
    expect(r).not.toBeNull();
    expect(r!.box).toEqual({ x: 0, y: 0, w: 200, h: 60 });
    expect(r!.color.startsWith('linear-gradient(180deg, #f00a05 0px')).toBe(true);
    expect(r!.color).not.toMatch(/#ffffff/);
  });
});

(existsSync(PODCAST) ? describe : describe.skip)('bug do Gusta: podcast (apresentadora × convidada × b-roll)', () => {
  it('main = só os planos da ruiva até 0:33; convidada e b-roll ficam de fora; 0 bloqueio', async () => {
    const t = await svc.faceTrack(PODCAST);
    expect(t.blockers).toEqual([]);
    const main = t.timeline.filter((x) => x.kind === 'main').map((x) => [x.startFrame / t.fps, x.endFrame / t.fps]);
    expect(main.length).toBe(4);
    // convidada em 12-13 s e 20,5-22 s, inserts em 4,5-7,5 e 22,5-28 s, b-roll depois de 33,6 s: nada disso é main
    for (const [a, b] of main) {
      expect(b).toBeLessThanOrEqual(33.7);
      for (const [x0, x1] of [[4.6, 7.4], [12.0, 13.4], [20.6, 22.2], [22.6, 28.3]]) expect(b <= x0 || a >= x1).toBe(true);
    }
    expect(t.timeline.some((x) => x.kind === 'other_person' && x.startFrame / t.fps < 13 && x.endFrame / t.fps > 12)).toBe(true);
    expect(t.timeline[t.timeline.length - 1].endFrame).toBe(t.frameCount);
  });
});

(existsSync(ADLIBNOTE) ? describe : describe.skip)('bug do Gusta: AdLibNote (campeão cmuwsqw79000922x2t8gz86v3)', () => {
  it('região = só a caixa do rapaz (não o miolo 720x726), sem multiple_faces pelo casal da câmera de segurança', async () => {
    const t = await svc.faceTrack(ADLIBNOTE);
    expect(t.frameCount).toBe(909);
    expect(t.segments).toHaveLength(1);
    const r = t.segments[0].region;
    expect(Math.abs(r.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y - 119)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.x + r.w - 336)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y + r.h - 443)).toBeLessThanOrEqual(3);
    expect(t.segments[0].facesMax).toBe(1);
    expect(t.blockers).toEqual([]);
  });
});

(existsSync(CAMPEAO) ? describe : describe.skip)('caso real: zap-working-late v2-latino (campeão do Gusta)', () => {
  it('trilha: caixa x 0-336, y 119-443 (±2 px), o vídeo inteiro, 1 rosto', async () => {
    const t = await svc.faceTrack(CAMPEAO);
    expect(t.frameCount).toBe(913);
    expect(t.segments).toHaveLength(1);
    const r = t.segments[0].region;
    expect(Math.abs(r.x - 0)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y - 119)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.x + r.w - 336)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y + r.h - 443)).toBeLessThanOrEqual(2);
    expect([t.segments[0].startFrame, t.segments[0].endFrame]).toEqual([0, 913]);
    expect(t.segments[0].facesMax).toBe(1);
    expect(t.blockers).toEqual([]);
    // a câmera de segurança tem gente (score ~0,87): fica registrada, não vira região
    expect(t.otherFaceCells.length).toBe(1);
    // headline fixa o vídeo todo; fundo = barra vermelha inteira em degradê
    expect(await svc.layerPresence(CAMPEAO, { x: 14, y: 18, w: 692, h: 80 }, 1.5)).toEqual({ startFrame: 0, endFrame: 913 });
    const bg = await svc.solidBackground(CAMPEAO, 1.5, { x: 14, y: 18, w: 692, h: 80 });
    expect(bg!.box.x).toBe(0);
    expect(bg!.box.w).toBe(720);
    expect(bg!.box.y).toBe(0);
    expect(bg!.box.y + bg!.box.h).toBeGreaterThanOrEqual(114);
    expect(bg!.box.y + bg!.box.h).toBeLessThanOrEqual(119);
    // caixa da visão que passa da faixa (mock do describeEdit: x43 y48 634x86, até y 134) não arrasta o fundo pro rosto
    const bg2 = await svc.solidBackground(CAMPEAO, 1.5, { x: 43, y: 48, w: 634, h: 86 });
    expect(bg2!.box).toEqual(bg!.box);
    expect(bg!.color.startsWith('linear-gradient')).toBe(true);
  });
});

// Fixtures do QA (testes/fixtures/campeoes, `npm run fixtures:paineis` em testes/): bloqueios do vídeo de verdade.
const FIX = join(__dirname, '..', '..', '..', 'testes', 'fixtures', 'campeoes');
const fx = (n: string) => join(FIX, `paineis-${n}-15s.mp4`);
(existsSync(fx('caixa')) ? describe : describe.skip)('fixtures do QA (painéis)', () => {
  it('2 rostos lado a lado = multiple_faces; rosto borrado (~0,5 recortado) = low_confidence', async () => {
    const dois = await svc.faceTrack(fx('2-rostos'));
    expect(dois.blockers.map((b) => b.reason)).toEqual(['multiple_faces']);
    const borrado = await svc.faceTrack(fx('rosto-borrado'));
    expect(borrado.blockers.map((b) => b.reason)).toEqual(['low_confidence']);
    expect(borrado.segments[0].region).toMatchObject({ x: 0, w: 336 });
  });

  it('tela cheia 0-5 s e caixa depois: 2 trechos, o 1º fullFrame, borda no frame 150 (±1)', async () => {
    const t = await svc.faceTrack(fx('cheia-caixa'));
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0]).toMatchObject({ startFrame: 0, fullFrame: true, region: { x: 0, y: 0, w: 720, h: 960 } });
    expect(Math.abs(t.segments[0].endFrame - 150)).toBeLessThanOrEqual(1);
    const r = t.segments[1].region;
    expect(Math.abs(r.y - 119)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.w - 336)).toBeLessThanOrEqual(2);
    expect(t.segments[1].fullFrame).toBe(false);
    expect(t.blockers).toEqual([]);
  });

  it('faixa vermelha 0-119 pelo pixel, com a caixa da visão justa ou passando da faixa; gancho sem fundo = null', async () => {
    for (const b of [{ x: 43, y: 48, w: 634, h: 86 }, { x: 14, y: 18, w: 692, h: 80 }]) {
      expect((await svc.solidBackground(fx('caixa'), 1.5, b))!.box).toEqual({ x: 0, y: 0, w: 720, h: 119 });
      expect(await svc.layerPresence(fx('caixa'), b, 1.5)).toEqual({ startFrame: 0, endFrame: 450 });
    }
    expect(await svc.solidBackground(fx('gancho-sem-fundo'), 1.5, { x: 43, y: 48, w: 634, h: 86 })).toBeNull();
  });
});
