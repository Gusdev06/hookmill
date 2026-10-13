#!/usr/bin/env node
// Gera os vídeos-campeão de teste da feature 2 (Q5-prep). Dono: maquina-qa.
// Tudo local e grátis: ffmpeg + `say` do macOS (fala sintética). A mídia NÃO vai pro git (testes/.gitignore);
// o que vai é este script. Rodar de qualquer lugar:  node testes/fixtures/campeoes/gerar.mjs  [--force]
// Saída: os arquivos + manifest.json (probe real de cada um + o que o contrato manda acontecer), que os specs leem.
// Contrato: docs/contratos/feature-2-variar-campeao.md §2 (limites) e §4.6 (fixtures que o QA usa).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, copyFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const TMP = join(DIR, '.tmp');
const FORCE = process.argv.includes('--force');

function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr?.slice(-2000)}`);
  return r;
}
const ff = (...a) => run('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', ...a]);

function probe(path) {
  const r = run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { allowFail: true });
  if (r.status !== 0) return { ok: false, error: r.stderr.trim().slice(0, 300) };
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    ok: true,
    durationSec: Number(Number(j.format.duration).toFixed(3)),
    width: v?.width ?? null,
    height: v?.height ?? null,
    videoCodec: v?.codec_name ?? null,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
  };
}
/** Decodifica o arquivo inteiro (a regra do download truncado): true se decodificou sem erro. */
function decodificaInteiro(path) {
  const r = run('ffmpeg', ['-hide_banner', '-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { allowFail: true });
  return r.status === 0 && !r.stderr.trim();
}
const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

// ───────────── fala sintética (say) ─────────────
// Gancho ~3 s, corpo, CTA: o mock de transcrição ignora, mas a medição (silêncios) e o F2-G4 local usam o áudio de verdade.
const ROTEIRO = [
  'Stop scrolling. You are paying for apps you forgot about.',
  'Last month I found three subscriptions I never used. Forty dollars, every single month, gone.',
  'This app reads your bank statements and lists every recurring charge in one screen.',
  'Tap the link and find your forgotten money today.',
].join(' [[slnc 500]] ');

function falar(texto, out, voz = 'Samantha') {
  const aiff = out.replace(/\.\w+$/, '.aiff');
  const r = run('say', ['-v', voz, '-o', aiff, texto], { allowFail: true });
  if (r.status !== 0) run('say', ['-o', aiff, texto]); // voz padrão do sistema se a Samantha não existir
  ff('-i', aiff, '-ac', '1', '-ar', '44100', out);
  return probe(out).durationSec;
}

// ───────────── vídeo "talking head + painel" ─────────────
// 0-8 s: rosto em tela cheia (gradiente animado = área com movimento) + barra de legenda.
// 8 s: corte de LAYOUT → split (rosto em cima 55%, painel embaixo 45%).
// 14 s: troca de CONTEÚDO no painel (testsrc2 → mandelbrot), sem mudar o layout. É o que o measureLayout tem que separar.
function splitScreen({ out, w, h, sec, audio, codec = 'libx264', mov = false }) {
  const faceH = Math.round((h * 0.55) / 2) * 2;
  const panelH = h - faceH;
  const capH = Math.round(h * 0.08 / 2) * 2;
  const fc = [
    `gradients=s=${w}x${h}:r=30:d=${sec}:speed=0.03:c0=0xc8906a:c1=0x3a2a20:c2=0xe0b090:x0=0:y0=0:x1=${w}:y1=${h},format=yuv420p[full]`,
    `gradients=s=${w}x${faceH}:r=30:d=${sec}:speed=0.03:c0=0xc8906a:c1=0x3a2a20:c2=0xe0b090,format=yuv420p[face]`,
    `testsrc2=s=${w}x${panelH}:r=30:d=${sec},format=yuv420p[p1]`,
    `mandelbrot=s=${w}x${panelH}:r=30,trim=duration=${sec},format=yuv420p[p2]`,
    `[p1][p2]overlay=enable='gte(t,14)'[panel]`,
    `[face][panel]vstack[split]`,
    `[full][split]overlay=enable='gte(t,8)',drawbox=x=0:y=${Math.round(h * 0.72)}:w=${w}:h=${capH}:color=black@0.85:t=fill[v]`,
  ].join(';');
  const args = ['-filter_complex', fc];
  if (audio) args.push('-i', audio);
  args.push('-map', '[v]');
  if (audio) args.push('-map', '0:a', '-c:a', 'aac', '-b:a', '96k', '-af', `apad=whole_dur=${sec}`);
  args.push('-t', String(sec), '-c:v', codec, '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p');
  if (codec === 'libx265') args.push('-tag:v', 'hvc1', '-x265-params', 'log-level=error');
  args.push('-movflags', '+faststart');
  if (mov) args.push('-f', 'mov');
  args.push(out);
  ff(...args);
}
function simples({ out, w, h, sec, audio, fps = 30, crf = 32 }) {
  const args = ['-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=${fps}:d=${sec}`];
  if (audio === 'tom') args.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=44100:duration=${sec}`);
  else if (audio) args.push('-i', audio);
  args.push('-map', '0:v');
  if (audio) args.push('-map', '1:a', '-c:a', 'aac', '-b:a', '64k', '-af', `apad=whole_dur=${sec}`);
  args.push('-t', String(sec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  ff(...args);
}

// ───────────── catálogo (o que cada um prova) ─────────────
// esperado: o que o contrato manda acontecer em POST /uploads/:id/complete (sync) e no job de análise (async).
const MAX_BYTES = 209_715_200;
const FIXTURES = [
  { file: 'fala-split-20s.mp4', mimeType: 'video/mp4', prova: 'caminho feliz: fala + split screen, corte de layout em 8 s e troca de conteúdo em 14 s',
    esperado: { complete: 'READY', warnings: [], analise: 'READY', hasSpeech: true } },
  { file: 'fala-split-20s.mov', mimeType: 'video/quicktime', prova: 'MOV aceito (mesmo conteúdo do mp4, contêiner QuickTime)',
    esperado: { complete: 'READY', warnings: [], analise: 'READY', hasSpeech: true } },
  { file: 'hevc-10s.mp4', mimeType: 'video/mp4', prova: 'H.265 aceito (contrato: H.264/H.265)',
    esperado: { complete: 'READY', warnings: [], analise: 'READY' } },
  { file: 'sem-audio-10s.mp4', mimeType: 'video/mp4', prova: 'sem trilha de áudio: aviso no_audio; sem fala → SWAP/NEW_HOOKS indisponíveis (NO_SPEECH)',
    esperado: { complete: 'READY', warnings: ['no_audio'], analise: 'READY', hasSpeech: false } },
  { file: 'sem-fala-tom-10s.mp4', mimeType: 'video/mp4', prova: 'áudio sem fala (tom 440 Hz): live = hasSpeech false; no mock depende do fake da transcrição',
    esperado: { complete: 'READY', warnings: [], analise: 'READY' } },
  { file: '400px-12s.mp4', mimeType: 'video/mp4', prova: 'lado menor 400 px (< 720): aviso low_resolution, não bloqueia',
    esperado: { complete: 'READY', warnings: ['low_resolution'], analise: 'READY', hasSpeech: true } },
  { file: 'pequeno-200px-8s.mp4', mimeType: 'video/mp4', prova: 'lado menor 200 px (< 240): MEDIA_INVALID too_small',
    esperado: { complete: { status: 422, code: 'MEDIA_INVALID', details: { reason: 'too_small' } } } },
  { file: 'truncado-20s.mp4', mimeType: 'video/mp4', prova: 'cortado no meio (moov no início): ffprobe lê, decodificação inteira falha → campeão FAILED MEDIA_INVALID no job',
    esperado: { complete: 'READY', analise: { status: 'FAILED', errorCode: 'MEDIA_INVALID' } } },
  { file: 'curto-3s.mp4', mimeType: 'video/mp4', prova: '3 s < 5 s: MEDIA_TOO_SHORT',
    esperado: { complete: { status: 422, code: 'MEDIA_TOO_SHORT', details: { minSec: 5 } } } },
  { file: 'longo-125s.mp4', mimeType: 'video/mp4', prova: '125 s > 120 s: MEDIA_TOO_LONG',
    esperado: { complete: { status: 422, code: 'MEDIA_TOO_LONG', details: { maxSec: 120 } } } },
  { file: 'so-audio.mp4', mimeType: 'video/mp4', prova: 'mp4 só com áudio: MEDIA_INVALID no_video',
    esperado: { complete: { status: 422, code: 'MEDIA_INVALID', details: { reason: 'no_video' } } } },
];

function gerar() {
  mkdirSync(TMP, { recursive: true });
  const p = (f) => join(DIR, f);
  const need = (f) => FORCE || !existsSync(p(f));

  const fala20 = join(TMP, 'fala-20.m4a');
  if (!existsSync(fala20) || FORCE) {
    const d = falar(ROTEIRO, fala20);
    if (d > 19.5) console.warn(`[fixtures] aviso: fala com ${d}s, cortada em 20 s`);
  }
  const fala12 = join(TMP, 'fala-12.m4a');
  if (!existsSync(fala12) || FORCE) falar('Stop scrolling. You are paying for apps you forgot about. This app finds them in one minute.', fala12);
  const fala3 = join(TMP, 'fala-3.m4a');
  if (!existsSync(fala3) || FORCE) falar('Stop scrolling right now.', fala3);

  if (need('fala-split-20s.mp4')) splitScreen({ out: p('fala-split-20s.mp4'), w: 720, h: 1280, sec: 20, audio: fala20 });
  if (need('fala-split-20s.mov')) ff('-i', p('fala-split-20s.mp4'), '-c', 'copy', '-f', 'mov', p('fala-split-20s.mov'));
  if (need('hevc-10s.mp4')) splitScreen({ out: p('hevc-10s.mp4'), w: 720, h: 1280, sec: 10, audio: fala12, codec: 'libx265' });
  if (need('sem-audio-10s.mp4')) simples({ out: p('sem-audio-10s.mp4'), w: 720, h: 1280, sec: 10, audio: null });
  if (need('sem-fala-tom-10s.mp4')) simples({ out: p('sem-fala-tom-10s.mp4'), w: 720, h: 1280, sec: 10, audio: 'tom' });
  if (need('400px-12s.mp4')) splitScreen({ out: p('400px-12s.mp4'), w: 400, h: 712, sec: 12, audio: fala12 });
  if (need('pequeno-200px-8s.mp4')) simples({ out: p('pequeno-200px-8s.mp4'), w: 200, h: 356, sec: 8, audio: fala12 });
  if (need('curto-3s.mp4')) simples({ out: p('curto-3s.mp4'), w: 720, h: 1280, sec: 3, audio: fala3 });
  if (need('longo-125s.mp4')) simples({ out: p('longo-125s.mp4'), w: 240, h: 426, sec: 125, audio: 'tom', fps: 10, crf: 40 });
  if (need('so-audio.mp4')) ff('-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100:duration=8', '-c:a', 'aac', '-b:a', '64k', '-f', 'mp4', p('so-audio.mp4'));
  if (need('truncado-20s.mp4')) {
    // mesmo vídeo do caminho feliz, moov no início (faststart) e só os primeiros 55% dos bytes:
    // o ffprobe ainda lê a duração (passa no complete), mas o arquivo não decodifica inteiro (regra do download truncado).
    copyFileSync(p('fala-split-20s.mp4'), p('truncado-20s.mp4'));
    truncateSync(p('truncado-20s.mp4'), Math.floor(statSync(p('truncado-20s.mp4')).size * 0.55));
  }
}

function manifesto() {
  const itens = FIXTURES.map((f) => {
    const path = join(DIR, f.file);
    const pr = probe(path);
    return { ...f, sizeBytes: statSync(path).size, md5: md5(path), probe: pr, decodificaInteiro: decodificaInteiro(path) };
  });
  // sanidade: cada fixture tem que ser o que diz ser, senão o teste mente
  const erros = [];
  const by = Object.fromEntries(itens.map((i) => [i.file, i]));
  const chk = (cond, msg) => cond || erros.push(msg);
  chk(by['fala-split-20s.mp4'].probe.hasAudio && Math.abs(by['fala-split-20s.mp4'].probe.durationSec - 20) < 0.2 && by['fala-split-20s.mp4'].decodificaInteiro, 'fala-split-20s.mp4 não é 20 s com áudio decodificável');
  chk(by['fala-split-20s.mov'].probe.ok && by['fala-split-20s.mov'].decodificaInteiro, 'mov inválido');
  chk(by['hevc-10s.mp4'].probe.videoCodec === 'hevc', 'hevc-10s.mp4 não é hevc');
  chk(!by['sem-audio-10s.mp4'].probe.hasAudio, 'sem-audio tem áudio');
  chk(by['400px-12s.mp4'].probe.width === 400, '400px não tem 400 de largura');
  chk(Math.min(by['pequeno-200px-8s.mp4'].probe.width, by['pequeno-200px-8s.mp4'].probe.height) < 240, 'pequeno não é < 240');
  chk(by['truncado-20s.mp4'].probe.ok && !by['truncado-20s.mp4'].decodificaInteiro, 'truncado: ffprobe tem que ler E a decodificação inteira tem que falhar');
  chk(by['curto-3s.mp4'].probe.durationSec < 5, 'curto não é < 5 s');
  chk(by['longo-125s.mp4'].probe.durationSec > 120, 'longo não é > 120 s');
  chk(!by['so-audio.mp4'].probe.hasVideo, 'so-audio tem vídeo');
  const out = {
    geradoEm: new Date().toISOString(),
    gerador: 'testes/fixtures/campeoes/gerar.mjs',
    // sem arquivo: o > 200 MB é simulado só pelo sizeBytes declarado no POST /uploads
    simulados: [{ nome: 'grande-demais', sizeBytes: MAX_BYTES + 1, mimeType: 'video/mp4', esperado: { status: 422, code: 'MEDIA_TOO_LARGE', details: { maxBytes: MAX_BYTES } } },
                { nome: 'mime-webm', sizeBytes: 1_000_000, mimeType: 'video/webm', esperado: { status: 422, code: 'MEDIA_INVALID', details: { reason: 'mime' } } }],
    fixtures: itens,
  };
  writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
  return { itens, erros };
}

gerar();
const { itens, erros } = manifesto();
rmSync(TMP, { recursive: true, force: true });
console.log('arquivo                    bytes      dur    w x h      vcodec audio decodifica');
for (const i of itens) {
  const pr = i.probe;
  console.log(
    `${i.file.padEnd(26)} ${String(i.sizeBytes).padStart(9)}  ${String(pr.durationSec ?? '-').padStart(6)}  ${`${pr.width ?? '-'}x${pr.height ?? '-'}`.padEnd(9)}  ${String(pr.videoCodec ?? '-').padEnd(6)} ${pr.hasAudio ? 'sim  ' : 'não  '} ${i.decodificaInteiro ? 'sim' : 'NÃO'}`,
  );
}
if (erros.length) {
  console.error(`[fixtures] FALHOU a sanidade:\n- ${erros.join('\n- ')}`);
  process.exit(1);
}
console.log(`[fixtures] ok: ${itens.length} arquivos + manifest.json em ${DIR}`);
