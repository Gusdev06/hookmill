// QA 22/11 do seletor de cor livre (bolinha arco-iris). 1440 e 390, EN e PT. API 3111 mock + web 3210, banco maquina_test. Dono: maquina-qa.
import { readFileSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { loginRapido } from '../../harness/navegador.ts';
import { prepararWs } from '../../harness/f1a.ts';
import { q } from '../../harness/db.ts';
import { CACHE_DIR } from '../../harness/env.ts';

const OUT = process.env.QA_OUT!;
test.setTimeout(900_000);
type Res = { passo: string; ok: boolean; nota: string };
const L = {
  en: { baixar: 'Download video', estilo: 'Style', branco: 'White', amarelo: 'Yellow', preto: 'Black', rosa: 'Pink', livre: 'Any color', undo: 'Undo', brand: 'Brand color' },
  'pt-BR': { baixar: 'Baixar vídeo', estilo: 'Estilo', branco: 'Branco', amarelo: 'Amarelo', preto: 'Preto', rosa: 'Rosa', livre: 'Qualquer cor', undo: 'Desfazer', brand: 'Cor da marca' },
} as const;

for (const lang of ['en', 'pt-BR'] as const) {
  test(`COR LIVRE ${lang}`, async ({ page, baseURL }, info) => {
    const proj = info.project.name; const phone = proj.endsWith('390'); const T = L[lang];
    const res: Res[] = []; const erros: string[] = []; const puts: any[] = []; const reqs: { m: string; u: string }[] = []; const falhasHttp: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || /MISSING_MESSAGE|IntlError/.test(m.text())) erros.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => erros.push('pageerror ' + e.message.slice(0, 300)));
    page.on('response', async (r) => { const p = new URL(r.url()).pathname; if (r.status() >= 400 && p.startsWith('/api/')) falhasHttp.push(`${r.status()} ${r.request().method()} ${p} ${(await r.text().catch(() => '')).slice(0, 260)}`); });
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) reqs.push({ m: r.method(), u: u.pathname }); if (r.method() === 'PUT' && u.pathname.endsWith('/editor')) puts.push(r.postDataJSON()); });
    const shot = (n: string) => page.screenshot({ path: `${OUT}/${proj}-${lang}-${n}.png` });
    const step = async (passo: string, fn: () => Promise<string | void>) => {
      try { const nota = (await fn()) ?? ''; res.push({ passo, ok: true, nota }); } catch (e: any) { res.push({ passo, ok: false, nota: String(e.message).split('\n').slice(0, 4).join(' | ') }); await shot('FALHA-' + passo.replace(/\W+/g, '_').slice(0, 28)).catch(() => undefined); }
    };
    const ok = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
    const tab = (n: string) => page.getByRole('tab', { name: n, exact: true });
    const abrir = async (id: string) => {
      await page.goto(`/creatives/${id}/editor`);
      await page.locator('.ed.simples').waitFor({ timeout: 90_000 });
      await page.locator('.viewport video').first().waitFor({ state: 'attached', timeout: 90_000 });
      await page.waitForTimeout(2500);
    };
    const hit = () => page.locator('.viewport button.hit.capH');
    const texto = () => page.locator('#legenda-card .capsw').first();
    const palavra = () => page.locator('#legenda-card .capsw').nth(1);
    const livre = (g: ReturnType<typeof texto>) => g.locator('label.sw.livre');
    const input = (g: ReturnType<typeof texto>) => g.locator('label.sw.livre input[type=color]');
    const pressed = async (g: ReturnType<typeof texto>) => (await livre(g).getAttribute('aria-pressed')) === 'true';
    // simula o arrasto na paleta: varios 'input' e 1 'change' no fim
    const arrastar = (loc: ReturnType<typeof texto>, vals: string[]) => loc.evaluate((el: HTMLInputElement, vs: string[]) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const v of vs) { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, vals);
    const chk400 = () => falhasHttp.filter((x) => x.startsWith('400')).length;
    // pixels proximos de um hex no recorte (tolerancia por canal)
    const pixels = async (clip: { x: number; y: number; width: number; height: number }, hex: string) => {
      const png = await page.screenshot({ clip });
      return page.evaluate(async ({ b64, hex }) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; const t = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - t[0]) < 28 && Math.abs(d[i + 1] - t[1]) < 28 && Math.abs(d[i + 2] - t[2]) < 28) n++;
        return n;
      }, { b64: png.toString('base64'), hex });
    };
    const clipCap = async () => { const b = (await hit().boundingBox())!; return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const lastDoc = () => JSON.stringify(puts[puts.length - 1]?.doc ?? null);
    const baixarBtn = () => page.getByRole('button', { name: T.baixar });

    await prepararWs();
    const ids: string[] = JSON.parse(readFileSync(`${CACHE_DIR}/qa-cor-livre.json`, 'utf8')).pieces.map((x: any) => x.creativeId);
    const frames = await q(`select distinct creative_id from renders where input->>'kind'='frame' and stale=false and creative_id = any($1) order by creative_id`, [ids]);
    ok(frames.length >= 4, 'poucas pecas: ' + frames.length);
    const idx = (phone ? 2 : 0) + (lang === 'en' ? 0 : 1);
    const R = frames[idx].creative_id;
    await loginRapido(page, 'donoA');
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: lang, url: baseURL! }]);
    await abrir(R);
    const b = (await hit().boundingBox())!; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(600);
    if (!(await tab(T.estilo).getAttribute('aria-selected') === 'true')) await tab(T.estilo).click();
    await shot('01-estilo');

    await step('A bolinha arco-iris existe no fim de texto e palavra, focavel, aria-label com "' + T.livre + '", habilitada, nao marcada', async () => {
      for (const [nome, g] of [['texto', texto()], ['palavra', palavra()]] as const) {
        ok(await livre(g).count() === 1, nome + ': sem bolinha livre');
        const last = await g.locator(':scope > *').last().evaluate((e) => e.classList.contains('livre'));
        ok(last, nome + ': bolinha nao e a ultima');
        const al = await input(g).getAttribute('aria-label'); ok(al?.includes(T.livre), nome + ' aria-label=' + al);
        ok(await input(g).isEnabled(), nome + ' desabilitada');
        ok(!(await pressed(g)), nome + ' ja marcada');
        await input(g).focus(); ok(await input(g).evaluate((e) => document.activeElement === e), nome + ' nao focavel');
        const bb = (await livre(g).boundingBox())!; if (phone) ok(bb.width >= 26 && bb.height >= 26, `alvo pequeno ${bb.width}x${bb.height}`);
      }
      const bb = (await livre(texto()).boundingBox())!;
      return `ok; bolinha ${bb.width}x${bb.height}`;
    });

    let corAntes = '';
    await step('Texto: arrastar (5 inputs + change) para cor fora da lista: previa muda, anel marcado, PUT 200', async () => {
      const n0 = puts.length, e0 = chk400(); const cl = await clipCap();
      const antes = await pixels(cl, '#2A9D8F');
      await arrastar(input(texto()), ['#102030', '#205040', '#2A8D8F', '#2A9D8E', '#2A9D8F']);
      await page.waitForTimeout(3000);
      ok(await pressed(texto()), 'anel nao marcado');
      ok(puts.length > n0, 'sem PUT');
      ok(chk400() === e0, '400: ' + falhasHttp.slice(-1)[0]);
      ok(/#2A9D8F/i.test(lastDoc()), 'doc sem a cor: ' + lastDoc().slice(0, 200));
      const depois = await pixels(await clipCap(), '#2A9D8F'); await shot('02-texto-livre');
      ok(depois > antes + 20, `previa nao mudou (pixels da cor ${antes} -> ${depois})`);
      const dentro = await livre(texto()).evaluate((e) => getComputedStyle(e).getPropertyValue('--livre') || e.getAttribute('style'));
      ok(/2a9d8f/i.test(dentro ?? ''), 'cor nao aparece dentro do anel: ' + dentro);
      corAntes = '#2A9D8F';
      return `PUTs +${puts.length - n0} (5 inputs); pixels ${antes}->${depois}; anel=${dentro}`;
    });

    await step('Desfazer: o gesto inteiro e 1 passo (um clique em Desfazer volta a cor anterior ao gesto)', async () => {
      const ub = page.getByRole('button', { name: T.undo }); const nUb = await ub.count();
      const cliques: string[] = [];
      let n = 0;
      for (; n < 9 && (await pressed(texto())); n++) { cliques.push(`antes#${n + 1}: disabled=${await ub.first().isDisabled()}`); if (await ub.first().isDisabled()) break; await ub.first().click(); await page.waitForTimeout(1500); }
      await page.waitForTimeout(1500); await shot('02b-desfeito');
      ok(!(await pressed(texto())), `anel continua marcado apos ${n} cliques (botoes Undo=${nUb}; ${cliques.join(' ; ')})`);
      ok(n === 1, `foram precisos ${n} cliques em Desfazer para voltar (esperado 1); ${cliques.join(' ; ')}`);
      ok(await texto().getByRole('radio', { name: T.branco, exact: true }).getAttribute('aria-checked') === 'true', 'texto nao voltou a branco');
      return `1 clique; botoes Undo=${nUb}`;
    });

    await step('Texto livre de novo (#2A9D8F) e Palavra livre (#E76F51): ambos salvam sem 400', async () => {
      const e0 = chk400();
      await arrastar(input(texto()), ['#2A9D8F']); await page.waitForTimeout(1200);
      await arrastar(input(palavra()), ['#e0e0e0', '#E76F51']); await page.waitForTimeout(3000);
      ok(await pressed(texto()) && await pressed(palavra()), 'aneis: texto=' + await pressed(texto()) + ' palavra=' + await pressed(palavra()));
      ok(/#E76F51/i.test(lastDoc()) && /#2A9D8F/i.test(lastDoc()), 'doc: ' + lastDoc().slice(0, 300));
      ok(chk400() === e0, '400: ' + falhasHttp.slice(-1)[0]);
      const px = await pixels(await clipCap(), '#E76F51'); await shot('03-texto-e-palavra');
      return `pixels palavra #E76F51=${px}`;
    });

    await step('Palavra = mesma cor do texto pela bolinha livre NAO e aplicada', async () => {
      const n0 = puts.length; const docAntes = lastDoc();
      await arrastar(input(palavra()), ['#2a9d8f']); await page.waitForTimeout(2500);
      ok(puts.length === n0 || lastDoc() === docAntes, 'gravou PUT novo: ' + lastDoc().slice(0, 250));
      ok(/#E76F51/i.test(lastDoc()), 'palavra mudou');
      // o input nativo fica na cor nova ate o React reaplicar value; o anel/doc e o que vale
      ok(await pressed(palavra()), 'anel da palavra deveria seguir marcado (cor antiga #E76F51)');
      const dentro = await livre(palavra()).evaluate((e) => getComputedStyle(e).getPropertyValue('--livre'));
      ok(/e76f51/i.test(dentro), 'cor dentro do anel mudou: ' + dentro);
    });

    await step('Bolinhas antigas continuam: Amarelo no texto marca o radio e desmarca o anel livre', async () => {
      await texto().getByRole('radio', { name: T.amarelo, exact: true }).click(); await page.waitForTimeout(2500);
      ok(await texto().getByRole('radio', { name: T.amarelo, exact: true }).getAttribute('aria-checked') === 'true', 'amarelo nao marcou');
      ok(!(await pressed(texto())), 'anel livre ficou marcado');
      ok(/#FFE14A/i.test(lastDoc()), 'doc: ' + lastDoc().slice(0, 200));
      await palavra().getByRole('radio', { name: T.rosa, exact: true }).click(); await page.waitForTimeout(2500);
      ok(!(await pressed(palavra())), 'anel da palavra ficou marcado');
      ok(await palavra().getByRole('radio', { name: T.amarelo, exact: true }).isDisabled(), 'amarelo deveria estar travado na palavra');
    });

    await step('Salvar + recarregar mantem as cores livres (texto #2A9D8F, palavra #E76F51)', async () => {
      const e0 = chk400();
      await arrastar(input(texto()), ['#2A9D8F']); await page.waitForTimeout(1200);
      await arrastar(input(palavra()), ['#E76F51']); await page.waitForTimeout(3000);
      await abrir(R); const b2 = (await hit().boundingBox())!; await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.waitForTimeout(500);
      if (!(await tab(T.estilo).getAttribute('aria-selected') === 'true')) await tab(T.estilo).click();
      ok(await pressed(texto()) && await pressed(palavra()), 'aneis apos recarregar: ' + await pressed(texto()) + '/' + await pressed(palavra()));
      const v = [await input(texto()).inputValue(), await input(palavra()).inputValue()];
      ok(/2a9d8f/i.test(v[0]) && /e76f51/i.test(v[1]), 'valores: ' + v.join(','));
      ok(chk400() === e0, '400: ' + falhasHttp.slice(-1)[0]);
      await shot('04-recarregado'); return v.join(' ');
    });

    await step('Cor da marca (aba Estilo): bolinha livre; cor livre muda a peca (brand) e salva; recarregar mantem', async () => {
      const g = page.locator(`.sws:has(input[aria-label^="${T.brand}"][type=color])`).first();
      ok(await g.count() === 1, 'grupo Cor da marca nao achado');
      ok(await g.locator('label.sw.livre').count() === 1, 'sem bolinha');
      const al = await g.locator('input[type=color]').getAttribute('aria-label'); ok(al?.includes(T.livre), 'aria-label=' + al);
      ok(await g.locator('input[type=color]').isEnabled(), 'desabilitada');
      await g.scrollIntoViewIfNeeded();
      const vp = (await page.locator('.viewport').boundingBox())!; const cl = { x: vp.x, y: vp.y, width: vp.width, height: vp.height };
      const antes = await pixels(cl, '#00B050'); const n0 = puts.length, e0 = chk400();
      await arrastar(g.locator('input[type=color]'), ['#112233', '#00A040', '#00B050']); await page.waitForTimeout(3500);
      ok(await g.locator('label.sw.livre').getAttribute('aria-pressed') === 'true', 'anel nao marcado');
      ok(puts.length > n0 && /00B050/i.test(lastDoc()), 'PUT/doc: ' + lastDoc().slice(0, 250));
      ok(chk400() === e0, '400: ' + falhasHttp.slice(-1)[0]);
      const vp2 = (await page.locator('.viewport').boundingBox())!;
      const depois = await pixels({ x: vp2.x, y: vp2.y, width: vp2.width, height: vp2.height }, '#00B050'); await shot('05-cor-marca');
      ok(depois > antes + 5, `peca nao mudou de destaque (pixels ${antes} -> ${depois})`);
      await abrir(R); await tab(T.estilo).click().catch(() => undefined); await page.waitForTimeout(500);
      const g2 = page.locator(`.sws:has(input[aria-label^="${T.brand}"][type=color])`).first();
      ok(await g2.locator('label.sw.livre').getAttribute('aria-pressed') === 'true', 'apos recarregar anel nao marcado');
      return `pixels marca ${antes}->${depois}; doc=${lastDoc().slice(0, 160)}`;
    });

    await step('Exportar com cor livre: POST export antes do download, render leva as cores, sem 400', async () => {
      const b3 = await hit().boundingBox(); if (b3) { await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2); await page.waitForTimeout(400); }
      if (!(await tab(T.estilo).getAttribute('aria-selected') === 'true')) await tab(T.estilo).click();
      const e0 = chk400(); const n0 = reqs.length; const dl = page.waitForEvent('download', { timeout: 120_000 });
      await baixarBtn().click(); const d = await dl;
      const seq = reqs.slice(n0).filter((r) => /export|download/.test(r.u)).map((r) => r.m + ' ' + r.u.split('/').slice(-2).join('/'));
      const iE = seq.findIndex((s) => /export/.test(s)), iD = seq.findIndex((s) => /download/.test(s));
      ok(iE >= 0 && iD > iE, 'ordem: ' + seq.join(' > '));
      const [row] = await q(`select input->'captions'->'edicao' ed, input->'frame'->'brand' brand, input->'templateOpts' opts, input->'captions'->>'highlightColor' hl, edit_revision from renders where creative_id=$1 and stale=false and status='READY' order by edit_revision desc nulls last, created_at desc limit 1`, [R]);
      writeFileSync(`${OUT}/${proj}-${lang}-export-input.json`, JSON.stringify(row, null, 1));
      ok(row?.ed && /^#2a9d8f$/i.test(row.ed.color) && /^#e76f51$/i.test(row.ed.highlight), 'render sem as cores livres: ' + JSON.stringify(row?.ed));
      ok(chk400() === e0, '400: ' + falhasHttp.slice(-1)[0]);
      return `download=${d.suggestedFilename()} seq=${seq.join(' > ')} edicao=${JSON.stringify(row.ed)} brand=${JSON.stringify(row.brand)} opts=${JSON.stringify(row.opts)}`;
    });

    await step('Legenda do tipo queimada continua travada, sem bolinha livre (peca headline)', async () => {
      const heads = await q(`select distinct creative_id from renders where input->>'kind'='remix-keep' and stale=false and creative_id = any($1) order by creative_id`, [ids]);
      if (!heads.length) return 'SEM peca headline no setup (nao testado)';
      await abrir(heads[0].creative_id); await tab(T.estilo).click(); await page.waitForTimeout(400);
      ok(await page.locator('#legenda-card .capsw').count() === 0, 'paleta da legenda em peca queimada');
      ok(await hit().count() === 0, 'camada caption em peca queimada');
      return 'ok';
    });

    // somente-leitura: peca com publicacao Meta ativa
    await step('Somente-leitura: bolinha desabilitada (peca publicada)', async () => {
      const [pub] = await q(`select id from meta_publications limit 1`);
      const [conn] = await q(`select id, workspace_id from meta_connections limit 1`);
      if (!conn) return 'SEM meta_connection no banco de teste: nao testado em navegador';
      const [cr] = await q(`select id, workspace_id from creatives where id = $1`, [R]);
      const [rf] = await q(`select id from files where workspace_id=$1 limit 1`, [cr.workspace_id]);
      await q(`insert into meta_publications (id, workspace_id, connection_id, creative_id, status, ad_account_id, page_id, settings, render_file_id, created_by_id, created_at, updated_at) values ($1,$2,$3,$4,'PAUSED','act_1','p1','{}'::jsonb,$5,'qa_user_dono_a', now(), now())`, ['qa-ro-' + proj + lang, cr.workspace_id, conn.id, R, rf?.id ?? 'x']);
      await abrir(R); const b4 = (await hit().boundingBox())!; await page.mouse.click(b4.x + b4.width / 2, b4.y + b4.height / 2); await page.waitForTimeout(500);
      if (!(await tab(T.estilo).getAttribute('aria-selected') === 'true')) await tab(T.estilo).click();
      const dis = [await input(texto()).isDisabled(), await input(palavra()).isDisabled()];
      const dm = await page.locator(`.sws:has(input[aria-label^="${T.brand}"][type=color]) input[type=color]`).first().isDisabled();
      await shot('06-somente-leitura');
      await q(`delete from meta_publications where id=$1`, ['qa-ro-' + proj + lang]);
      ok(dis[0] && dis[1] && dm, `desabilitadas: texto=${dis[0]} palavra=${dis[1]} marca=${dm}`);
      return 'ok';
    });

    writeFileSync(`${OUT}/resultados-${proj}-${lang}.json`, JSON.stringify({ res, erros: erros.slice(0, 12), falhasHttp: falhasHttp.slice(0, 10) }, null, 1));
    const falhas = res.filter((r) => !r.ok);
    console.log(`RESULTADO ${proj} ${lang}: ${res.length - falhas.length}/${res.length} ok`);
    for (const r of res) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.passo} :: ${r.nota.slice(0, 300)}`);
    console.log('  http>=400:', falhasHttp.length, JSON.stringify(falhasHttp.slice(0, 6)));
    console.log('  erros console:', erros.length, erros.slice(0, 3).join(' || '));
  });
}
