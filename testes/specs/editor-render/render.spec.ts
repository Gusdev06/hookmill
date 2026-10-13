// Editor v1 (F2d) com RENDER DE VERDADE (RemotionRenderService local, CPU, US$ 0; E2E_RENDER_REAL=1): `npm run editor:render`.
// ED-R-01 não regressão (§3.4): doc nulo → input = o de antes do editor (renderPieces) e vídeo = o do bundle de antes do F1
//          (video/out/f1-bundle-antes), PSNR RGB = ∞ em todo frame, mesmos parâmetros (o mesmo RemotionRenderService).
// ED-R-02 WYSIWYG (§0.2, §8): o print do <Player> no editor = o frame do MP4 exportado, em 4 frames, com doc que mexe em
//          tudo (posição, giro, escala, estilo, corte, ordem, palavra). Controle negativo: gancho deslocado 40 px tem que reprovar.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { ENV, QA_API_DIST, ROOT_DIR, TESTES_DIR } from '../../harness/env.ts';
import { criarCriativoEditor, doc, esperarRender, getEditor, salvar, semAssinatura, videoLib } from '../../harness/editor.ts';
import { abrirEditor } from '../../harness/editor-ui.ts';

test.use({ actionTimeout: 20_000 });
const require = createRequire(import.meta.url);
const OUT = join(TESTES_DIR, 'test-results', 'editor-render');
const PY = join(TESTES_DIR, 'ferramentas', 'qa_editor.py');
const BUNDLE_ANTES = join(ROOT_DIR, 'video', 'out', 'f1-bundle-antes');
const py = (...args: string[]) => JSON.parse(execFileSync('python3', [PY, ...args], { encoding: 'utf8' }).trim().split('\n').pop()!);

test.beforeAll(() => {
  if (!ENV.renderReal) throw new Error('[qa] rode com E2E_RENDER_REAL=1 (npm run editor:render)');
  mkdirSync(OUT, { recursive: true });
});

/** Baixa o MP4 do render pela URL assinada do /files (302). */
async function baixar(fileId: string, destino: string): Promise<string> {
  const r = await as('membroA').get(`/files/${fileId}`);
  const url = r.headers.get('location');
  if (!url) throw new Error(`[qa] /files/${fileId} sem location (${r.status})`);
  writeFileSync(destino, Buffer.from(await (await fetch(url)).arrayBuffer()));
  return destino;
}

/** O RenderInput que o buildInput de ANTES do editor montava (renderPieces + duração do arquivo), com as URLs do render novo. */
async function inputDeAntes(creativeId: string, renderId: string, urlPorArquivo: Map<string, string>) {
  const { renderPieces } = require(join(QA_API_DIST, 'edicao', 'cenas-render.js'));
  const scenes = await q(`select * from scenes where creative_id = $1 and stale = false order by generation desc, index asc`, [creativeId]);
  const gen = scenes[0].generation;
  const n = (x: unknown) => (x == null ? null : Number(x)); // numeric do pg chega como texto; o renderPieces quer número
  const vigentes = scenes.filter((s: any) => s.generation === gen).map((s: any) => ({
    pipeline: s.pipeline, takeId: s.take_id, takeStartSec: n(s.take_start_sec), takeEndSec: n(s.take_end_sec), clipFileId: s.clip_file_id,
    words: s.words, startSec: n(s.start_sec), endSec: n(s.end_sec),
  }));
  const files = new Map((await q('select id, duration_sec from files where id = any($1)', [vigentes.map((s: any) => s.clipFileId)])).map((f: any) => [f.id, f]));
  const [c] = await q('select format, language, edit_settings from creatives where id = $1', [creativeId]);
  const st = c.edit_settings;
  return {
    renderId, fps: 30, templateId: st.templateId, format: c.format, language: c.language,
    scenes: renderPieces(vigentes).map((p: any) => {
      const f: any = files.get(p.clipFileId);
      const fsec = f?.duration_sec == null ? null : Number(f.duration_sec);
      return { clipUrl: urlPorArquivo.get(p.clipFileId) ?? '', durationSec: p.durationSec ?? fsec ?? p.fallbackSec, words: p.words };
    }),
    captionStyle: st.captionStyle, captionPosition: st.captionPosition, headline: st.headline, ctaText: st.ctaText, endCard: st.endCard,
  };
}

for (const v of [{ nome: 'scenes', take: false }, { nome: 'take', take: true }]) {
  test(`ED-R-01 não regressão com doc nulo (${v.nome}): input de antes e vídeo do bundle de antes do F1 = PSNR ∞ em todo frame`, async () => {
    test.skip(!existsSync(join(BUNDLE_ANTES, 'index.html')), 'sem video/out/f1-bundle-antes');
    const c = await criarCriativoEditor('A', { clipesReais: true, take: v.take });
    expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
    const r = await esperarRender(c.id, 600_000);
    expect(r.status, r.fail_reason).toBe('READY');
    expect(r.doc).toBeNull();
    expect(r.input).not.toHaveProperty('layers');
    // 1) input: o de hoje com doc nulo = o de antes do editor
    const urls = new Map<string, string>();
    const chaves = await q('select id, storage_key from files where id = any($1)', [c.cenas.map((x) => x.clipFileId)]);
    for (const s of r.input.scenes) {
      const k = chaves.find((f: any) => s.clipUrl.split('?')[0].endsWith(f.storage_key));
      if (k) urls.set(k.id, s.clipUrl);
    }
    const antes = await inputDeAntes(c.id, r.id, urls);
    expect(semAssinatura(r.input)).toEqual(semAssinatura(antes));
    // 2) vídeo: render da API (bundle de hoje) × input de antes no bundle de antes do F1, mesmo RenderService
    const dir = join(OUT, `r01-${v.nome}`);
    mkdirSync(dir, { recursive: true });
    const api = await baixar(r.file_id, join(dir, 'api-hoje.mp4'));
    writeFileSync(join(dir, 'input-antes.json'), JSON.stringify({ ...antes, renderId: `antes-${v.nome}` }));
    const saida = JSON.parse(execFileSync('node', [join(TESTES_DIR, 'ferramentas', 'render-com-bundle.cjs'), join(dir, 'input-antes.json'), BUNDLE_ANTES, dir], { encoding: 'utf8', timeout: 900_000 }).trim().split('\n').pop()!);
    const res = py('psnr', api, saida.outputPath);
    test.info().annotations.push({ type: `PSNR ${v.nome}`, description: JSON.stringify(res) });
    expect(res.frames_a).toBe(res.frames_b);
    expect(res.inf, JSON.stringify(res)).toBe(res.comparados);
    expect(res.audio_igual).toBe(true);
  });
}

test('ED-R-02 WYSIWYG: print do Player no editor = frame do MP4 exportado (doc que mexe em tudo); gancho deslocado reprova', async ({ browser }) => {
  const c = await criarCriativoEditor('A', { clipesReais: true });
  const [s0, s1, s2, s3] = c.cenas;
  const d = doc({
    clips: [
      { sceneId: s0.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3 },
      { sceneId: s2.sceneId, enabled: true, attempt: 1, inSec: 0.5, outSec: 4.5 },   // aparada e antes da 2
      { sceneId: s1.sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 4 },
      { sceneId: s3.sceneId, enabled: false, attempt: 1, inSec: 0, outSec: 3 },      // apagada
    ],
    layers: [
      { id: 'hook', transform: { x: 0.45, y: 0.3, scale: 1.25, rotationDeg: -7, boxWidth: 0.7 }, style: { background: { kind: 'pill', color: '#FFE14D' } } },
      { id: 'caption', transform: { x: 0.5, y: 0.62, scale: 1.1, rotationDeg: 0, boxWidth: 0.8 }, style: { uppercase: true, highlightColor: '#52A8FF', strokeColor: '#000000', strokeWidthPx: 6 } },
      { id: 'cta', transform: { x: 0.55, y: 0.5, scale: 1.3, rotationDeg: 4, boxWidth: 0.6 }, style: { fontId: 'anton-400', color: '#FFFFFF', background: { kind: 'box', color: '#E5484D' } }, timing: { fromSec: 5, durationSec: 4 } },
    ],
    captionWords: [{ key: `${s2.sceneId}@1:4`, text: 'subscription' }],
  });
  await salvar('membroA', c.id, d);
  expectOk(await as('membroA').post(`/creatives/${c.id}/render`, {}), 202);
  const r = await esperarRender(c.id, 600_000);
  expect(r.status, r.fail_reason).toBe('READY');
  const st = expectOk(await getEditor('membroA', c.id));
  expect(semAssinatura(r.input)).toEqual(semAssinatura({ renderId: r.id, fps: 30, ...videoLib().resolverProps(st.source, st.settings, st.doc) }));
  const dir = join(OUT, 'r02-wysiwyg');
  mkdirSync(dir, { recursive: true });
  const mp4 = await baixar(r.file_id, join(dir, 'export.mp4'));

  // Player no editor em DPR 4 (≈ 1100 px de largura de vídeo na tela); as camadas do editor ficam escondidas no print
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 4 });
  const page = await ctx.newPage();
  await abrirEditor(page, 'membroA', c.id);
  await page.addStyleTag({ content: '.ed-safe,.ed-hit,.ed-word-hit,.ed-gd,.ed-read,.ed-endsel,.ed-bn{display:none!important}' });
  const irPara = async (frame: number) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Home');
    for (let i = 0; i < frame; i += 30) await page.keyboard.press(frame - i >= 30 ? 'Shift+ArrowRight' : 'ArrowRight');
    // passos de 1 frame até chegar
    const atual = async () => Number((await page.locator('.ed-tc').textContent())!.trim().split(' ')[0].split(':').reduce((a, x, i) => (i === 0 ? Number(x) * 1800 : i === 1 ? a + Number(x) * 30 : a + Number(x)), 0));
    for (let k = 0; k < 40 && (await atual()) !== frame; k++) await page.keyboard.press((await atual()) < frame ? 'ArrowRight' : 'ArrowLeft');
    await page.waitForTimeout(300);
    await page.waitForFunction(() => [...document.querySelectorAll('.ed-player video')].every((v: any) => !v.seeking && v.readyState >= 2), null, { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    return atual();
  };
  const resultados: Record<string, any> = {};
  for (const f of [45, 120, 250, 330]) {
    const chegou = await irPara(f);
    expect(chegou).toBe(f);
    const png = join(dir, `player-${f}.png`);
    await page.locator('.ed-player').screenshot({ path: png });
    const fr = join(dir, `mp4-${f}.png`);
    expect(py('frame', mp4, String(f), fr).ok).toBe(true);
    resultados[f] = py('wysiwyg', png, fr);
  }
  test.info().annotations.push({ type: 'WYSIWYG por frame', description: JSON.stringify(resultados) });
  // controle negativo: no frame 45 o gancho vai 40 px pra direita (⌥⇧→ ×4) e tem que reprovar
  await irPara(45);
  await page.addStyleTag({ content: '.ed-hit{display:block!important;opacity:0!important}' });
  await page.locator('.ed-hit[aria-label="Hook"]').click({ force: true, timeout: 20_000 });
  for (let i = 0; i < 4; i++) await page.keyboard.press('Alt+Shift+ArrowRight');
  await page.waitForTimeout(800);
  await page.locator('.ed-player').screenshot({ path: join(dir, 'player-45-deslocado.png') });
  const neg = py('wysiwyg', join(dir, 'player-45-deslocado.png'), join(dir, 'mp4-45.png'));
  test.info().annotations.push({ type: 'controle negativo', description: JSON.stringify(neg) });
  await ctx.close();
  // limiar: o fundo (testsrc2 saturado) difere ~10 níveis em média entre o <video> do Chrome e o decodificador do render (F1);
  // camada no lugar errado dá bloco bem acima disso. O controle negativo prova que a métrica pega 40 px de deslocamento.
  for (const [f, res] of Object.entries(resultados)) expect(res.max_bloco, `frame ${f}: ${JSON.stringify(res)}`).toBeLessThan(40);
  expect(neg.max_bloco, `controle negativo: ${JSON.stringify(neg)}`).toBeGreaterThan(60);
});
