#!/usr/bin/env node
// Fixtures do §13 (manter a edição + take único): campeões com layout em PAINÉIS, no molde do campeão real
// `zap-working-late` (720x960: faixa vermelha com headline em cima, caixa do rosto x 0-336 y 119-443, câmera
// embaixo à esquerda, tela do app à direita, karaokê, faixa de baixo). Dono: maquina-qa.
// Tudo local e grátis (ffmpeg + `say`). Rostos: imagens geradas por texto pela operação (Krea 2 "uma mulher",
// 13/09; Seedance-teste 28/09), em testes/fixtures/rostos/. Nenhum frame de terceiro.
// Rodar:  node testes/fixtures/campeoes/gerar-paineis.mjs [--force]
// Saída: os .mp4 (fora do git) + paineis.json (probe + o que o contrato manda o mapa da edição achar) + sanidade
// com YuNet (testes/ferramentas/qa_video.py rostos): a fixture tem que ter o rosto que diz ter, senão o teste mente.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROSTOS = join(DIR, '..', 'rostos');
const QA_VIDEO = join(DIR, '..', '..', 'ferramentas', 'qa_video.py');
const TMP = join(DIR, '.tmp-paineis');
const FORCE = process.argv.includes('--force');
const FONT = '/System/Library/Fonts/Supplemental/Arial Black.ttf';
const FONT2 = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr?.slice(-3000)}`);
  return r;
}
const ff = (...a) => run('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', ...a]);
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');
function probe(path) {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', path]).stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = v.r_frame_rate.split('/').map(Number);
  return { durationSec: Number(Number(j.format.duration).toFixed(3)), width: v.width, height: v.height, fps: n / d,
           frames: Number(v.nb_read_frames), audioSec: a ? Number(Number(a.duration).toFixed(3)) : null, hasAudio: Boolean(a) };
}
const audioMd5 = (p) => run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', p, '-map', '0:a:0', '-f', 'md5', '-']).stdout.trim().replace('MD5=', '');
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/,/g, '\\,');

// ───────────── grade do campeão de referência ─────────────
const W = 720, H = 960, FPS = 30, SEC = 15;
const FRAMES_VIDEO = SEC * FPS;                // 450 frames de vídeo…
const AUDIO_EXTRA_SEC = 4 / FPS;               // …e o áudio passa 4 frames do vídeo, como no campeão real (909 frames x 30,42 s de áudio):
                                               // a peça tem que sair com o nº de frames do CAMPEÃO, não esticar até o áudio
const BOX = { x: 0, y: 119, w: 336, h: 324 };   // caixa do rosto (medida no zap-working-late)
const TOP = { x: 0, y: 0, w: 720, h: 119 };
const CAM = { x: 0, y: 443, w: 336, h: 397 };
const APP = { x: 336, y: 119, w: 384, h: 721 };
const BOT = { x: 0, y: 840, w: 720, h: 120 };
const VERMELHO = '0xd40f0f';
const HEADLINE = ['I FOUND OUT WHY MY BILLS', 'KEPT GOING UP EVERY MONTH.'];
const RODAPE = ['SEE EVERY CHARGE,', 'EVERY APP, IN ONE SCREEN'];
const ROTEIRO = 'Hey. I found out why my bills kept going up. Three apps were charging me every single month. '
  + 'I never used any of them. This app showed me every charge in one screen. Tap the link below and check yours today.';
// karaokê: páginas de 3 palavras, ~0,45 s por palavra, na ordem da fala (o mock da transcrição ignora; o live usa a fala real)
const PALAVRAS = ROTEIRO.replace(/[.,]/g, '').toUpperCase().split(' ');

/** Gera o retrato animado (respiração leve: zoom senoidal + deriva lateral) recortado no tamanho pedido, centrado no rosto. */
function retrato(src, w, h, { cx = 0.5, cy = 0.32, zoom = 1.0 } = {}) {
  // escala a foto pra cobrir (w x h) * 1,15 de folga e corta uma janela que se move devagar (talking head parado não é estático)
  const sw = Math.ceil(w * 1.15 * zoom / 2) * 2;
  return `movie=${src},loop=-1:1:0,setpts=N/${FPS}/TB,fps=${FPS},scale=${sw}:-2,`
    + `crop=${w}:${h}:'(iw-${w})*${cx}+6*sin(t*1.7)':'max(0\\,min(ih-${h}\\,ih*${cy}-${h}/2+4*sin(t*2.3)))',`
    + `trim=duration=${SEC},setsar=1,format=yuv420p`;
}

function texto(t, { x, y, size, color = 'white', border = 0, font = FONT, enable = null }) {
  return `drawtext=fontfile='${font}':text='${esc(t)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`
    + (border ? `:borderw=${border}:bordercolor=black` : '') + (enable ? `:enable='${enable}'` : '');
}

/** Karaokê em páginas de 3 palavras na caixa (cx, y): página branca + palavra atual amarela por cima. */
function karaoke({ cx, y, size = 34, ate = SEC, de = 0 }) {
  const out = [];
  const dur = 0.45;
  for (let p = 0; p * 3 < PALAVRAS.length; p++) {
    const pal = PALAVRAS.slice(p * 3, p * 3 + 3);
    const t0 = de + p * 3 * dur;
    const t1 = t0 + pal.length * dur;
    if (t0 >= ate) break;
    const pag = pal.join(' ');
    out.push(texto(pag, { x: `${cx}-text_w/2`, y, size, border: 4, enable: `between(t,${t0.toFixed(2)},${Math.min(t1, ate).toFixed(2)})` }));
    // palavra atual em amarelo por cima, na posição aproximada dentro da página (largura média do Arial Black)
    pal.forEach((w, k) => {
      const ini = t0 + k * dur;
      if (ini >= ate) return;
      const prefixo = pal.slice(0, k).join(' ') + (k ? ' ' : '');
      const x = `${cx}-${Math.round(measure(pag, size) / 2)}+${Math.round(measure(prefixo, size))}`;
      out.push(texto(w, { x, y, size, color: 'yellow', border: 4, enable: `between(t,${ini.toFixed(2)},${Math.min(ini + dur, ate).toFixed(2)})` }));
    });
  }
  return out;
}
// largura aproximada do Arial Black (média por caractere); só pra posicionar o destaque, não entra em nenhuma asserção
const measure = (s, size) => s.length * size * 0.72;

/** Cena "painéis": caixa do rosto + câmera + app + faixas + karaokê. `opts` mudam UMA coisa por variante. */
function paineis({ out, rosto = join(ROSTOS, 'rosto-a.jpg'), dois = false, legendaCruza = false, ganchoSemFundo = false, cheiaAte = 0, borrar = null }) {
  const L = [];
  // fundos: câmera (cinza com ruído e movimento), app (padrão "life" verde andando), faixas chapadas
  L.push(`testsrc2=s=${CAM.w}x${CAM.h}:r=${FPS}:d=${SEC},hue=s=0,format=yuv420p[cam]`);
  // tela do app: cartões verdes rolando devagar (conteúdo que muda, como o scanner do campeão real, sem ruído de alta entropia)
  L.push(`color=c=0x0b1f17:s=${APP.w}x${APP.h * 3}:r=${FPS}:d=${SEC},drawgrid=w=${APP.w * 4}:h=110:x=${APP.w * 2}:t=6:color=0x1fe39a@0.9,drawbox=x=30:y=20:w=200:h=24:color=0x1fe39a@0.6:t=fill,format=yuv420p,crop=${APP.w}:${APP.h}:0:'mod(t*40\\,${APP.h * 2})'[app]`);
  L.push(`color=c=black:s=${W}x${H}:r=${FPS}:d=${SEC},format=yuv420p[fundo]`);
  if (dois) {
    // duas pessoas lado a lado DENTRO da caixa do rosto (multiple_faces conta rostos na região)
    L.push(`${retrato(rosto, BOX.w / 2, BOX.h, { cy: 0.30 })}[ra]`);
    L.push(`${retrato(join(ROSTOS, 'rosto-b.jpg'), BOX.w / 2, BOX.h, { cy: 0.30 })}[rb]`);
    L.push('[ra][rb]hstack[rosto]');
  } else {
    L.push(`${retrato(rosto, BOX.w, BOX.h, { cy: 0.30 })}${borrar ? `,gblur=sigma=${borrar}` : ''}[rosto]`);
  }
  let v = '[fundo][cam]overlay=' + `${CAM.x}:${CAM.y}[v1];[v1][app]overlay=${APP.x}:${APP.y}[v2];[v2][rosto]overlay=${BOX.x}:${BOX.y}[v3]`;
  L.push(v);
  let cur = 'v3';
  const f = [];
  if (ganchoSemFundo) {
    // sem faixa no topo: o vídeo do app sobe até y 0 e o gancho é texto DIRETO sobre o vídeo (background none) nos 3 s
    L.push(`testsrc2=s=${W}x${TOP.h}:r=${FPS}:d=${SEC},hue=h=120:s=0.6,format=yuv420p[topo]`);
    L.push(`[${cur}][topo]overlay=0:0[v4]`);
    cur = 'v4';
    f.push(texto(HEADLINE[0], { x: '(w-text_w)/2', y: 18, size: 38, border: 3, enable: 'lt(t,3)' }));
    f.push(texto(HEADLINE[1], { x: '(w-text_w)/2', y: 62, size: 38, border: 3, enable: 'lt(t,3)' }));
  } else {
    f.push(`drawbox=x=${TOP.x}:y=${TOP.y}:w=${TOP.w}:h=${TOP.h}:color=${VERMELHO}:t=fill`);
    f.push(texto(HEADLINE[0], { x: '(w-text_w)/2', y: 16, size: 40 }));
    f.push(texto(HEADLINE[1], { x: '(w-text_w)/2', y: 62, size: 40 }));
  }
  f.push(`drawbox=x=${BOT.x}:y=${BOT.y}:w=${BOT.w}:h=${BOT.h}:color=${VERMELHO}:t=fill`);
  f.push(texto(RODAPE[0], { x: '(w-text_w)/2', y: BOT.y + 18, size: 38, font: FONT2 }));
  f.push(texto(RODAPE[1], { x: '(w-text_w)/2', y: BOT.y + 64, size: 38, font: FONT2 }));
  // karaokê: no campeão real ele fica sobre a câmera e o app (fora da caixa do rosto). Variante legendaCruza: metade dentro da caixa.
  f.push(...karaoke(legendaCruza ? { cx: 336, y: 425, de: cheiaAte } : { cx: 360, y: 780, de: cheiaAte }));
  let comp = `[${cur}]${f.join(',')}[paineis]`;
  L.push(comp);
  let saida = 'paineis';
  if (cheiaAte > 0) {
    // 0..cheiaAte s: rosto em TELA CHEIA com a legenda DENTRO da região (a célula é o quadro inteiro); depois, os painéis
    L.push(`${retrato(rosto, W, H, { cy: 0.38, zoom: 1.0 })}[cheio0]`);
    L.push(`[cheio0]${karaoke({ cx: 360, y: 760, ate: cheiaAte }).join(',')}[cheio]`);
    L.push(`[paineis][cheio]overlay=0:0:enable='lt(t,${cheiaAte})'[final]`);
    saida = 'final';
  }
  const fala = join(TMP, 'fala.m4a');
  ff('-filter_complex', L.join(';'), '-i', fala, '-map', `[${saida}]`, '-map', '0:a',
     '-t', String(SEC), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
     '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', join(TMP, 'v.mp4'));
  // remux: vídeo cortado em 450 frames, áudio inteiro (15 s + 4 frames), sem recodificar
  ff('-i', join(TMP, 'v.mp4'), '-map', '0:v', '-c:v', 'copy', '-frames:v', String(FRAMES_VIDEO), join(TMP, 'v450.mp4'));
  ff('-i', join(TMP, 'v450.mp4'), '-i', fala, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', out);
}

// ───────────── catálogo ─────────────
const SEG_CAIXA = (startFrame = 0) => ({ startFrame, endFrame: FRAMES_VIDEO, region: BOX, fullFrame: false });
const FIXTURES = [
  { file: 'paineis-caixa-15s.mp4', gerar: (o) => paineis({ out: o }),
    prova: 'caso de referência: rosto numa caixa (x 0-336 y 119-443) o vídeo todo + câmera + app + headline em faixa chapada + karaokê fora da região + rodapé; áudio 4 frames mais longo que o vídeo',
    esperado: { faceTrack: [SEG_CAIXA()], blockers: { SWAP_AVATAR: [], NEW_HOOKS: [] },
                headline: { box: TOP, background: 'solid', color: '#d40f0f', text: HEADLINE.join(' ') }, captionDentroDaRegiao: false },
    sanidade: { regiao: BOX, umRostoPct: 100 } },
  { file: 'paineis-cheia-caixa-15s.mp4', gerar: (o) => paineis({ out: o, cheiaAte: 5 }),
    prova: '0-5 s rosto em tela cheia com a legenda dentro da região (redesenhada), corte de layout no frame 150, depois a caixa',
    esperado: { faceTrack: [{ startFrame: 0, endFrame: 150, region: { x: 0, y: 0, w: W, h: H }, fullFrame: true }, SEG_CAIXA(150)],
                blockers: { SWAP_AVATAR: [], NEW_HOOKS: [] }, captionDentroDaRegiao: true },
    sanidade: { regiao: null, umRostoPct: 100 } },
  { file: 'paineis-2-rostos-15s.mp4', gerar: (o) => paineis({ out: o, dois: true }),
    prova: 'duas pessoas na caixa do rosto o vídeo todo → bloqueio multiple_faces (> 10 % das amostras com 2+ rostos >= 0,8)',
    esperado: { blockers: { SWAP_AVATAR: ['multiple_faces'] } },
    sanidade: { regiao: BOX, doisOuMaisPctMin: 90 } },
  { file: 'paineis-legenda-cruza-15s.mp4', gerar: (o) => paineis({ out: o, legendaCruza: true }),
    prova: 'karaokê metade dentro, metade fora da caixa do rosto → bloqueio caption_straddles_face (vem da visão: em mock depende de gatilho)',
    esperado: { blockers: { SWAP_AVATAR: ['caption_straddles_face'] } },
    sanidade: { regiao: BOX, umRostoPct: 90 } },
  { file: 'paineis-gancho-sem-fundo-15s.mp4', gerar: (o) => paineis({ out: o, ganchoSemFundo: true }),
    prova: 'headline do gancho escrita DIRETO sobre o vídeo (sem faixa) nos 3 s → NEW_HOOKS TEXT bloqueado com hook_text_over_video; Trocar avatar segue disponível',
    esperado: { blockers: { SWAP_AVATAR: [], NEW_HOOKS: ['hook_text_over_video'] } },
    sanidade: { regiao: BOX, umRostoPct: 100 } },
  { file: 'paineis-rosto-borrado-15s.mp4', gerar: (o) => paineis({ out: o, borrar: 16 }),
    prova: 'rosto borrado na caixa: YuNet abaixo de 0,8 em > 20 % das amostras → low_confidence (ou no_face se o borrão apagar o rosto: a sanidade mede)',
    esperado: { blockers: { SWAP_AVATAR: ['low_confidence'] } },
    sanidade: { regiao: BOX, abaixoDoLimiarPctMin: 20, melhorCruMin: 0.5 } },
];

function gerar() {
  mkdirSync(TMP, { recursive: true });
  const fala = join(TMP, 'fala.m4a');
  if (!existsSync(fala) || FORCE) {
    const aiff = join(TMP, 'fala.aiff');
    const r = run('say', ['-v', 'Samantha', '-r', '175', '-o', aiff, ROTEIRO], { allowFail: true });
    if (r.status !== 0) run('say', ['-o', aiff, ROTEIRO]);
    // fala ocupa ~13 s; o áudio sai com SEC + 4 frames exatos (apad + atrim)
    ff('-i', aiff, '-af', `apad,atrim=0:${(SEC + AUDIO_EXTRA_SEC).toFixed(4)}`, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '128k', fala);
  }
  for (const f of FIXTURES) {
    const p = join(DIR, f.file);
    if (FORCE || !existsSync(p)) {
      process.stdout.write(`[paineis] gerando ${f.file}… `);
      f.gerar(p);
      console.log('ok');
    }
  }
}

function sanidade(f, pr) {
  const erros = [];
  if (pr.width !== W || pr.height !== H || pr.fps !== FPS) erros.push(`${f.file}: grade ${pr.width}x${pr.height}@${pr.fps}`);
  if (pr.frames !== FRAMES_VIDEO) erros.push(`${f.file}: ${pr.frames} frames (esperado ${FRAMES_VIDEO})`);
  if (!(pr.audioSec > SEC)) erros.push(`${f.file}: áudio ${pr.audioSec}s não passa do vídeo`);
  const args = [QA_VIDEO, 'rostos', join(DIR, f.file), '--fps', '5'];
  if (f.sanidade.regiao) args.push('--regiao', `${f.sanidade.regiao.x},${f.sanidade.regiao.y},${f.sanidade.regiao.w},${f.sanidade.regiao.h}`);
  const r = run('python3', args);
  const y = JSON.parse(r.stdout.trim().split('\n').pop());
  const pct = (n) => (100 * n) / y.amostras;
  const s = f.sanidade;
  if (s.umRostoPct != null && pct(y.umRosto) < s.umRostoPct) erros.push(`${f.file}: 1 rosto em só ${pct(y.umRosto).toFixed(1)} % das amostras (quer ${s.umRostoPct})`);
  if (s.doisOuMaisPctMin != null && y.pctDoisOuMais < s.doisOuMaisPctMin) erros.push(`${f.file}: 2+ rostos em ${y.pctDoisOuMais} % (quer >= ${s.doisOuMaisPctMin})`);
  if (s.abaixoDoLimiarPctMin != null && y.pctAbaixoDoLimiar < s.abaixoDoLimiarPctMin) erros.push(`${f.file}: abaixo de 0,8 em ${y.pctAbaixoDoLimiar} % (quer >= ${s.abaixoDoLimiarPctMin})`);
  if (s.melhorCruMin != null && !(y.melhorCruMediana >= s.melhorCruMin)) erros.push(`${f.file}: rosto sumiu (melhor score cru ${y.melhorCruMediana}): seria no_face, não low_confidence`);
  const { centros, ...resumo } = y;
  return { erros, yunet: resumo };
}

gerar();
const erros = [];
const itens = FIXTURES.map((f) => {
  const path = join(DIR, f.file);
  const pr = probe(path);
  const s = sanidade(f, pr);
  erros.push(...s.erros);
  const { gerar: _g, ...resto } = f;
  return { ...resto, mimeType: 'video/mp4', sizeBytes: statSync(path).size, md5: md5(path), audioMd5: audioMd5(path), probe: pr, yunet: s.yunet };
});
writeFileSync(join(DIR, 'paineis.json'), JSON.stringify({
  geradoEm: new Date().toISOString(), gerador: 'testes/fixtures/campeoes/gerar-paineis.mjs',
  grade: { width: W, height: H, fps: FPS, frames: FRAMES_VIDEO, audioSec: SEC + AUDIO_EXTRA_SEC },
  caixas: { rosto: BOX, topo: TOP, camera: CAM, app: APP, rodape: BOT }, fixtures: itens,
}, null, 2) + '\n');
rmSync(TMP, { recursive: true, force: true });
console.log('arquivo                              frames  áudio   1 rosto  2+   <0,8   melhorCru');
for (const i of itens) {
  const y = i.yunet;
  console.log(`${i.file.padEnd(36)} ${String(i.probe.frames).padStart(6)}  ${String(i.probe.audioSec).padStart(6)}  ${String(y.umRosto).padStart(4)}/${y.amostras}  ${String(y.doisOuMais).padStart(3)}  ${String(y.zeroRostos).padStart(4)}   ${y.melhorCruMediana}`);
}
if (erros.length) {
  console.error(`[paineis] FALHOU a sanidade:\n- ${erros.join('\n- ')}`);
  process.exit(1);
}
console.log(`[paineis] ok: ${itens.length} fixtures + paineis.json em ${DIR}`);
