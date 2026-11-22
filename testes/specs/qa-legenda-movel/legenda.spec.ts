// QA 20/11 da "legenda movel" (commit 690b78a). 1440 e 390, EN e PT. API 3111 mock + web 3210, banco maquina_test. Dono: maquina-qa.
// Pecas (banco de teste): R = frame "news" com captionMode 'replace' + captions (preparada por SQL); B = frame com legenda queimada; H = headline remix-keep.
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
  en: { baixar: 'Download video', alto: 'Higher', baixo: 'Lower', home: 'Back in place', sm: 'Small', md: 'Medium', lg: 'Large', estilo: 'Style', textos: 'Text', video: 'Video', branco: 'White', amarelo: 'Yellow', limao: 'Lime', preto: 'Black', rosa: 'Pink', verde: 'Green', posHome: 'Original position', titulo: 'Caption', undo: 'Undo', redo: 'Redo', enq: 'Open framing', cobreT: 'covers the title', fora: 'outside the safe area', travada: "can't be moved" },
  'pt-BR': { baixar: 'Baixar vídeo', alto: 'Mais alto', baixo: 'Mais baixo', home: 'Voltar ao lugar', sm: 'Pequena', md: 'Média', lg: 'Grande', estilo: 'Estilo', textos: 'Textos', video: 'Vídeo', branco: 'Branco', amarelo: 'Amarelo', limao: 'Verde-limão', preto: 'Preto', rosa: 'Rosa', verde: 'Verde', posHome: 'Posição original', titulo: 'Legenda', undo: 'Desfazer', redo: 'Refazer', enq: 'Ver enquadramento', cobreT: 'em cima do título', fora: 'fora da área segura', travada: 'não dá pra mover' },
} as const;

for (const lang of ['en', 'pt-BR'] as const) {
  test(`LEGENDA MOVEL ${lang}`, async ({ page, baseURL }, info) => {
    const proj = info.project.name; const phone = proj.endsWith('390'); const T = L[lang];
    const res: Res[] = []; const erros: string[] = []; const puts: any[] = []; const reqs: { m: string; u: string }[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || /MISSING_MESSAGE|IntlError/.test(m.text())) erros.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => erros.push('pageerror ' + e.message.slice(0, 300)));
    const falhasHttp: string[] = [];
    page.on('response', async (r) => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/')) falhasHttp.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname} ${(await r.text().catch(() => '')).slice(0, 260)}`); });
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
    const centro = async () => { const b = await hit().boundingBox(); const v = (await page.locator('.viewport').boundingBox())!; return { y: (b!.y + b!.height / 2 - v.y) / v.height, h: b!.height / v.height, b: b!, v }; };
    const pos = async () => (await page.locator('#legenda-card .fl em').first().innerText()).trim();
    const aviso = async () => (await page.locator('.aviso1').allInnerTexts()).join(' | ');
    const homeBtn = () => page.locator('#legenda-card').getByRole('button', { name: T.home });
    const baixarBtn = () => page.getByRole('button', { name: T.baixar });
    const selecionar = async () => { await tab(T.estilo).click(); await page.waitForTimeout(300); };
    const lastCaption = () => { const d = puts[puts.length - 1]; return JSON.stringify(d?.doc ?? d).match(/\{"id":"caption"[^}]*(\{[^}]*\}[^}]*)*\}/)?.[0] ?? JSON.stringify(d?.doc?.layers?.filter?.((l: any) => l.id === 'caption') ?? null); };

    await prepararWs();
    // pecas do setup: frames "news" (2 por idioma) e 1 headline remix-keep. R vira legenda 'replace' por SQL (banco de teste); B fica queimada.
    const ids: string[] = JSON.parse(readFileSync(`${CACHE_DIR}/qa-editor-simples.json`, 'utf8')).pieces.map((x: any) => x.creativeId);
    const frames = await q(`select distinct creative_id from renders where input->>'kind'='frame' and stale=false and creative_id = any($1) order by creative_id`, [ids]);
    const heads = await q(`select distinct creative_id from renders where input->>'kind'='remix-keep' and stale=false and creative_id = any($1) order by creative_id`, [ids]);
    ok(frames.length >= 4 && heads.length >= 2, 'poucas pecas');
    const R = frames[lang === 'en' ? 0 : 2].creative_id, B = heads[lang === 'en' ? 0 : 1].creative_id, H = B;
    await loginRapido(page, 'donoA');
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: lang, url: baseURL! }]);

    // ============ PECA R (legenda nossa) ============
    await abrir(R);
    await shot('R-01-aberto');
    await step('R: manifesto tem camada caption clicavel; sem edicao nada mexido', async () => {
      ok(await hit().count() === 1, 'hit caption count=' + await hit().count());
      ok(await page.getByRole('button', { name: T.baixar }).count() === 1, 'botao baixar');
      ok(puts.length === 0, 'PUT sem edicao');
      const t = await page.evaluate(() => document.body.innerText);
      ok(!/MISSING_MESSAGE|simples\.cap/.test(t), 'chave crua');
      const c = await centro(); return `caption centro y=${c.y.toFixed(3)} h=${c.h.toFixed(3)}`;
    });
    let y0 = 0;
    await step('clicar/tocar na legenda: seleciona, abre Estilo com cartao Legenda destacado', async () => {
      y0 = (await centro()).y;
      const b = (await centro()).b; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(500);
      ok(await tab(T.estilo).getAttribute('aria-selected') === 'true', 'nao foi pra Estilo');
      ok(await page.locator('#legenda-card.hi').count() === 1, 'cartao sem destaque');
      ok(await page.locator('.viewport .sel.capsel').count() === 1, 'sem contorno de selecao');
      const zonas = await page.locator('.viewport .g-ui').count();
      if (!phone) ok(zonas === 2, 'zonas app UI=' + zonas);
      ok(await pos() === T.posHome, 'posicao: ' + await pos());
      ok(await homeBtn().isDisabled(), 'Voltar ao lugar deveria estar desligado na posicao original');
      return `zonasUI=${zonas} grip=${await page.locator('.capgrip').count()}`;
    });
    await shot('R-02-selecionada');
    await step('clicar no video fora de camadas tira a selecao', async () => {
      const v = (await page.locator('.viewport').boundingBox())!;
      await page.mouse.click(v.x + 6, v.y + v.height * 0.5); await page.waitForTimeout(400);
      const n = await page.locator('.viewport .sel').count(); ok(n === 0, 'ainda selecionada ' + n);
      await selecionar(); const b = (await centro()).b; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300);
    });

    if (!phone) {
      await step('arrasto vertical: move, grava 1 PUT por gesto, x nao muda', async () => {
        const n0 = puts.length; const c = await centro();
        await page.mouse.move(c.b.x + c.b.width / 2, c.b.y + c.b.height / 2); await page.mouse.down();
        await page.mouse.move(c.b.x + c.b.width / 2 + 60, c.b.y + c.b.height / 2 - 120, { steps: 12 });
        await page.waitForTimeout(150); await shot('R-03-arrastando');
        const dur = { orig: await page.locator('.viewport .cap-orig').count(), g: await page.locator('.viewport .g-ui').count(), aviso: await page.locator('.aviso1').count() };
        await page.mouse.up(); await page.waitForTimeout(2500);
        const c2 = await centro();
        ok(c2.y < c.y - 0.04, `nao subiu y ${c.y.toFixed(3)} -> ${c2.y.toFixed(3)}`);
        ok(Math.abs(c2.b.x + c2.b.width / 2 - (c.b.x + c.b.width / 2)) < 3, 'x mudou');
        ok(puts.length > n0, 'sem PUT');
        ok(dur.orig === 1, 'linha pontilhada da posicao original ausente durante arrasto: ' + JSON.stringify(dur));
        ok(dur.aviso === 0, 'faixa de aviso aparece durante o arrasto');
        ok(/Moved up|Subiu/.test(await pos()), 'posicao: ' + await pos());
        return `PUTs +${puts.length - n0}; ${await pos()}; durante=${JSON.stringify(dur)}; doc=${lastCaption().slice(0, 160)}`;
      });
      await shot('R-04-arrastou');
      await step('arrasto perto da posicao original encaixa (snap) e sai do doc', async () => {
        const c = await centro(); const alvoY = y0; const v = c.v;
        const dy = (alvoY + 0.008 - c.y) * v.height; // 0.8% da altura do lugar original, dentro do encaixe de 1.4%
        await page.mouse.move(c.b.x + c.b.width / 2, c.b.y + c.b.height / 2); await page.mouse.down();
        await page.mouse.move(c.b.x + c.b.width / 2, c.b.y + c.b.height / 2 + dy, { steps: 14 });
        const chip = await page.locator('.viewport .capchip').count();
        await shot('R-05-snap'); await page.mouse.up(); await page.waitForTimeout(2500);
        ok(chip === 1, 'chip "Encaixou" nao apareceu');
        ok(await pos() === T.posHome, 'nao voltou a posicao original: ' + await pos());
        return 'chip ok; ' + await pos();
      });
      await step('arrasto ate a borda de baixo: SEM limite duro, so avisa (fora da area segura), Baixar liberado', async () => {
        const c = await centro();
        await page.mouse.move(c.b.x + c.b.width / 2, c.b.y + c.b.height / 2); await page.mouse.down();
        await page.mouse.move(c.b.x + c.b.width / 2, c.v.y + c.v.height * 0.99, { steps: 14 }); await page.mouse.up(); await page.waitForTimeout(2800);
        const c2 = await centro(); const a = await aviso();
        ok(c2.y > 0.85, 'ficou preso antes da borda: y=' + c2.y.toFixed(3));
        ok(a.includes(T.fora), 'sem aviso de area segura: "' + a + '"');
        ok(await baixarBtn().isEnabled(), 'Baixar bloqueado');
        return `y=${c2.y.toFixed(3)} aviso="${a}"`;
      });
      await shot('R-06-borda-baixo');
      await step('arrasto ate a borda de cima: sem limite, aviso, Baixar liberado', async () => {
        const c = await centro();
        await page.mouse.move(c.b.x + c.b.width / 2, c.b.y + c.b.height / 2); await page.mouse.down();
        await page.mouse.move(c.b.x + c.b.width / 2, c.v.y + 2, { steps: 16 }); await page.mouse.up(); await page.waitForTimeout(2800);
        const c2 = await centro(); const a = await aviso();
        ok(c2.y < 0.12, 'ficou preso: y=' + c2.y.toFixed(3));
        ok(await baixarBtn().isEnabled(), 'Baixar bloqueado');
        return `y=${c2.y.toFixed(3)} aviso="${a}"`;
      });
      await shot('R-07-borda-cima');
      await step('teclado: seta 1%, Shift+seta 5%', async () => {
        await homeBtn().click(); await page.waitForTimeout(1500);
        const b = (await centro()).b; await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(300);
        const a0 = await centro(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300); const a1 = await centro();
        await page.keyboard.press('Shift+ArrowDown'); await page.waitForTimeout(300); const a2 = await centro();
        await page.waitForTimeout(1800);
        const d1 = (a1.y - a0.y) * 100, d2 = (a2.y - a1.y) * 100;
        ok(Math.abs(d1 - 1) < 0.35, 'seta moveu ' + d1.toFixed(2) + '%');
        ok(Math.abs(d2 - 5) < 0.6, 'shift+seta moveu ' + d2.toFixed(2) + '%');
        return `seta=${d1.toFixed(2)}% shift=${d2.toFixed(2)}%`;
      });
    } else {
      await step('celular: sem arrasto (sem alca, hit sem classe move; arrastar com toque nao move)', async () => {
        ok(await page.locator('.capgrip').count() === 0, 'alca no celular');
        const c = await centro(); const cx = c.b.x + c.b.width / 2, cy = c.b.y + c.b.height / 2;
        const cdp = await page.context().newCDPSession(page);
        const t = (type: string, y: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y }] });
        await t('touchStart', cy); for (let i = 1; i <= 8; i++) await t('touchMove', cy - i * 10); await t('touchEnd', 0);
        await page.waitForTimeout(800);
        const c2 = await centro(); ok(Math.abs(c2.y - c.y) < 0.004, `moveu com toque ${c.y} -> ${c2.y}`);
        return 'arrasto de toque nao move; sem alca';
      });
    }

    // botoes
    await step('botoes Mais alto / Mais baixo: toque = 2%', async () => {
      await selecionar();
      await homeBtn().click().catch(() => undefined); await page.waitForTimeout(1200);
      const a0 = await centro();
      await page.getByRole('button', { name: T.baixo }).click(); await page.waitForTimeout(250);
      const a1 = await centro();
      await page.getByRole('button', { name: T.alto }).click(); await page.waitForTimeout(250);
      const a2 = await centro();
      const d1 = (a1.y - a0.y) * 100;
      ok(Math.abs(d1 - 2) < 0.5, 'toque moveu ' + d1.toFixed(2) + '%');
      ok(Math.abs(a2.y - a0.y) < 0.004, 'subir depois de descer nao voltou');
      return `Mais baixo = ${d1.toFixed(2)}%; voltou`;
    });
    await step('botao segurado anda continuo e vira UM passo no desfazer', async () => {
      await page.waitForTimeout(1600);
      const a0 = await centro(); const bx = (await page.getByRole('button', { name: T.baixo }).boundingBox())!;
      await page.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await page.mouse.down(); await page.waitForTimeout(1500); await page.mouse.up(); await page.waitForTimeout(1500);
      const a1 = await centro(); const d = (a1.y - a0.y) * 100;
      ok(d > 6, 'segurar 1,5 s andou so ' + d.toFixed(2) + '%');
      // desfazer: um passo volta tudo do gesto
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await page.waitForTimeout(1500);
      const a2 = await centro();
      ok(Math.abs(a2.y - a0.y) < 0.006, `desfazer 1x nao voltou o gesto inteiro (${a0.y.toFixed(3)} -> ${a2.y.toFixed(3)} apos ${a1.y.toFixed(3)})`);
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z'); await page.waitForTimeout(1500);
      const a3 = await centro();
      ok(Math.abs(a3.y - a1.y) < 0.006, `refazer nao restaurou (${a3.y.toFixed(3)} vs ${a1.y.toFixed(3)})`);
      return `segurar=${d.toFixed(1)}%; desfazer 1x volta; refazer ok`;
    });
    await step('Voltar ao lugar volta a posicao original e desliga o botao', async () => {
      ok(await homeBtn().isEnabled(), 'Voltar ao lugar desligado apos mover');
      await homeBtn().click(); await page.waitForTimeout(1500);
      ok(await pos() === T.posHome, 'pos=' + await pos());
      ok(await homeBtn().isDisabled(), 'nao desligou');
      const c = await centro(); ok(Math.abs(c.y - y0) < 0.006, `y ${c.y.toFixed(3)} != original ${y0.toFixed(3)}`);
    });
    await step('sobrepor o titulo so AVISA (warn) e Baixar continua liberado; Voltar ao lugar na faixa', async () => {
      // levar a legenda pro topo onde esta o titulo (news: headline no alto) por botoes (vale em desktop e celular)
      for (let i = 0; i < 40; i++) { await page.getByRole('button', { name: T.alto }).click(); if (i % 8 === 7) { const a = await aviso(); if (a.includes(T.cobreT)) break; } }
      await page.waitForTimeout(2600);
      const a = await aviso(); await shot('R-12-aviso');
      ok(await baixarBtn().isEnabled(), 'Baixar bloqueado com aviso');
      ok(a.length > 0, 'nenhum aviso apos subir ate o topo');
      return `aviso="${a}" caption_over_text=${a.includes(T.cobreT)}`;
    });
    await step('Voltar ao lugar pela faixa de aviso (ou cartao) restaura e some o aviso', async () => {
      const f = page.locator('.aviso1 button').first();
      if (await f.count()) await f.click(); else await homeBtn().click();
      await page.waitForTimeout(2500);
      ok(await pos() === T.posHome, 'pos=' + await pos());
      ok((await aviso()) === '' || !(await aviso()).includes(T.cobreT), 'aviso ficou: ' + await aviso());
    });

    // exportar / baixar com legenda movida
    await step('Baixar com legenda movida+cor: exporta (POST export antes do download) e baixa', async () => {
      const bt = (n: number) => page.getByRole('button', { name: T.baixo }).click({ clickCount: 1 }).then(() => page.waitForTimeout(150));
      for (let i = 0; i < 5; i++) await bt(i); // 10% pra baixo
      await page.getByRole('button', { name: T.lg, exact: true }).first().click(); await page.waitForTimeout(600);
      await page.locator('#legenda-card .capsw').first().getByRole('radio', { name: T.amarelo, exact: true }).click(); await page.waitForTimeout(400);
      await page.locator('#legenda-card .capsw').nth(1).getByRole('radio', { name: T.rosa, exact: true }).click();
      await page.waitForTimeout(2800);
      const n0 = reqs.length; const dl = page.waitForEvent('download', { timeout: 90_000 });
      await baixarBtn().click(); const d = await dl;
      const seq = reqs.slice(n0).filter((r) => /export|download/.test(r.u)).map((r) => r.m + ' ' + r.u.split('/').slice(-2).join('/'));
      const iExp = seq.findIndex((s) => /export/.test(s)), iDl = seq.findIndex((s) => /download/.test(s));
      ok(iExp >= 0 && iDl > iExp, 'ordem das chamadas: ' + seq.join(' > '));
      const [row] = await q(`select input->'captions'->'edicao' ed, input->'captions'->>'highlightColor' hl, edit_revision from renders where creative_id=$1 and stale=false and status='READY' order by edit_revision desc nulls last, created_at desc limit 1`, [R]);
      writeFileSync(`${OUT}/${proj}-${lang}-export-input.json`, JSON.stringify(row, null, 1));
      ok(row?.ed && typeof row.ed.cy === 'number' && row.ed.cy > 0.8 && row.ed.scale > 1.2 && /^#ffe14a$/i.test(row.ed.color) && /^#ff5fa2$/i.test(row.ed.highlight), 'render exportado sem captions.edicao completo: ' + JSON.stringify(row));
      return `download=${d.suggestedFilename()} seq=${seq.join(' > ')} render.captions.edicao=${JSON.stringify(row.ed)}`;
    });
    await step('Baixar de novo sem mudar: baixa direto, sem exportar', async () => {
      const n0 = reqs.length; const dl = page.waitForEvent('download', { timeout: 60_000 });
      await baixarBtn().click(); await dl;
      const exp = reqs.slice(n0).filter((r) => r.m === 'POST' && /export/.test(r.u)).length; ok(exp === 0, 'exportou de novo: ' + exp);
    });
    await step('recarregar: posicao, tamanho e cores persistem', async () => {
      const antes = { c: (await centro()).y, p: await pos() };
      await abrir(R); await selecionar();
      const dep = { c: (await centro()).y, p: await pos() };
      ok(Math.abs(dep.c - antes.c) < 0.006, `posicao ${antes.c.toFixed(3)} -> ${dep.c.toFixed(3)}`);
      ok(dep.p === antes.p, `${antes.p} vs ${dep.p}`);
      return dep.p;
    });
    await step('voltar tudo ao original restaura posicao e cores (e o doc fica vazio)', async () => {
      const reset = page.locator('button.reset-tudo');
      ok(await reset.count(), 'botao voltar tudo nao existe');
      await reset.first().scrollIntoViewIfNeeded(); await reset.first().click(); await page.waitForTimeout(2800);
      const c = await centro(); ok(Math.abs(c.y - y0) < 0.006, `y ${c.y.toFixed(3)} != ${y0.toFixed(3)}`);
      ok(await pos() === T.posHome, 'pos=' + await pos());
      ok(await page.locator('#legenda-card .capsw').first().getByRole('radio', { name: T.branco, exact: true }).getAttribute('aria-checked') === 'true', 'texto nao voltou a branco');
      return 'ok';
    });
    await step('cores: texto e palavra falada SALVAM (sem 400); mesma cor nas duas fileiras desabilitada', async () => {
      const n400a = falhasHttp.filter((x) => x.startsWith('400 PUT')).length;
      const sw = (n: string) => page.getByRole('radio', { name: n, exact: true });
      const texto = page.locator('.capsw').first(); const pal = page.locator('.capsw').nth(1);
      const n0 = puts.length;
      await texto.getByRole('radio', { name: T.limao, exact: true }).click(); await page.waitForTimeout(500);
      await pal.getByRole('radio', { name: T.rosa, exact: true }).click(); await page.waitForTimeout(2500);
      ok(puts.length > n0, 'sem PUT de cor');
      const n400b = falhasHttp.filter((x) => x.startsWith('400 PUT')).length;
      const ult = falhasHttp.filter((x) => x.startsWith('400 PUT')).slice(-1)[0] ?? '';
      // amarelo esta em uso no texto? texto=limao agora. Coloque texto=amarelo e confira que amarelo some na palavra? palavra=rosa
      await texto.getByRole('radio', { name: T.amarelo, exact: true }).click(); await page.waitForTimeout(400);
      // palavra = rosa ; texto = amarelo. Agora tente tornar palavra=amarelo (desabilitado)
      const dis = await pal.getByRole('radio', { name: T.amarelo, exact: true }).isDisabled();
      ok(dis, 'amarelo na palavra deveria estar desabilitado quando o texto e amarelo');
      const branco = await pal.getByRole('radio', { name: T.branco, exact: true }).isDisabled(); ok(!branco, 'branco na palavra deveria estar liberado');
      await shot('R-10-cores');
      await texto.getByRole('radio', { name: T.preto, exact: true }).click(); await page.waitForTimeout(2500); await shot('R-11-texto-preto');
      const doc = JSON.stringify(puts[puts.length - 1]);
      ok(/#111111/i.test(doc) && /#ff5fa2/i.test(doc), 'doc sem as cores: ' + doc.slice(0, 300));
      ok(n400b === n400a, `BUG: mudar cor da legenda volta 400 da API (${n400b - n400a} PUTs 400): ${ult.slice(0, 330)}`);
      return 'doc cor preto+rosa; amarelo bloqueado quando igual; ' + lastCaption().slice(0, 200);
    });
    await step('tamanho P/M/G muda a caixa da legenda E SALVA (sem erro de API)', async () => {
      const seg = async (n: string) => { await page.getByRole('radio', { name: n, exact: true }).or(page.getByRole('button', { name: n, exact: true })).first().click(); await page.waitForTimeout(2600); };
      const bad = () => page.locator('.banner.bad').count();
      const n400 = () => falhasHttp.filter((x) => x.startsWith('400 PUT')).length;
      const m = (await centro()).h; const e0 = n400();
      await seg(T.lg); const g = (await centro()).h; const bg = await bad(); await shot('R-08-grande'); const e1 = n400();
      await seg(T.md); await seg(T.sm); const p = (await centro()).h; const bp = await bad(); await shot('R-09-pequena'); const e2 = n400();
      await seg(T.md); await page.waitForTimeout(1500);
      ok(g > m * 1.05 && p < m * 0.95, `alturas P=${p.toFixed(3)} M=${m.toFixed(3)} G=${g.toFixed(3)}`);
      ok(e2 === e0 && bg === 0 && bp === 0, `BUG: salvar tamanho falha. PUT 400 apos Grande: ${e1 - e0}, apos Pequena: ${e2 - e1}; banner de erro Grande=${bg} Pequena=${bp}; ultimo erro=${falhasHttp.filter((x) => x.startsWith('400 PUT')).slice(-1)[0]?.slice(0, 200)}`);
      return `P=${p.toFixed(3)} M=${m.toFixed(3)} G=${g.toFixed(3)}`;
    });
    if (phone) {
      await step('celular: video fixo no topo na aba Estilo (sticky), menor, e botoes >= 48 px', async () => {
        await selecionar(); await page.evaluate(() => { window.scrollTo(0, 400); let e: HTMLElement | null = document.querySelector('.ed.simples'); while (e) { if (e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = 400; e = e.parentElement; } }); await page.waitForTimeout(500);
        const f = await page.evaluate(() => { const s = document.querySelector('.ed.simples > .stagewrap') as HTMLElement; const b = s.getBoundingClientRect(); return { top: Math.round(b.top), h: Math.round(b.height), pos: getComputedStyle(s).position, vh: Math.round((document.querySelector('.viewport') as HTMLElement).getBoundingClientRect().height), scroll: Math.max(window.scrollY, ...[...document.querySelectorAll('*')].map((x) => (x as HTMLElement).scrollTop)) }; });
        const bt = await page.getByRole('button', { name: T.baixo }).boundingBox();
        await shot('R-13-sticky');
        ok(f.pos === 'sticky' && f.top <= 2, 'nao esta fixo: ' + JSON.stringify(f));
        ok(f.vh <= 290, 'video do sticky grande: ' + f.vh);
        ok(bt!.height >= 47.5, 'botao ' + bt!.height);
        const sw = await page.locator('.capsw .sw').first().boundingBox(); ok(sw!.width >= 37.5, 'swatch ' + sw!.width);
        return JSON.stringify(f) + ` botao h=${bt!.height} swatch=${sw!.width}`;
      });
      await step('celular: em Textos/Video o video NAO e fixo', async () => {
        await tab(T.textos).click(); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
        const pos2 = await page.evaluate(() => getComputedStyle(document.querySelector('.ed.simples > .stagewrap') as HTMLElement).position);
        ok(pos2 !== 'sticky', 'sticky em Textos: ' + pos2);
        const redo = await page.getByRole('button', { name: T.redo }).isVisible().catch(() => false);
        const code = await page.locator('.code').first().isVisible().catch(() => false);
        ok(!redo && !code, `topo no celular: Refazer visivel=${redo}, codigo visivel=${code}`);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(sw <= 1, 'rolagem horizontal ' + sw);
        return `sem sticky em Textos; Refazer/codigo escondidos; sem rolagem lateral`;
      });
    }

    // ============ PECA B (queimada) ============
    await abrir(B);
    await step('B queimada: sem camada caption, sem arrasto; clicar mostra cadeado + info + Ver enquadramento', async () => {
      ok(await hit().count() === 0, 'tem hit de caption na peca queimada');
      const burned = page.locator('.viewport button.hit').filter({ has: page.locator('xpath=self::*') });
      const nomes = await page.locator('.viewport button.hit').evaluateAll((e) => e.map((x) => x.getAttribute('aria-label')));
      const alvo = page.locator('.viewport button.hit[aria-label="Burned caption"], .viewport button.hit[aria-label="Legenda queimada"]').first();
      void burned;
      ok(await alvo.count(), 'sem hit da legenda queimada; hits=' + nomes.join('|'));
      await tab(T.estilo).click(); const b = await alvo.boundingBox(); await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2); await page.waitForTimeout(600);
      const a = await aviso(); await shot('B-01-queimada');
      ok(await page.locator('.viewport .sel.lockd').count() === 1, 'sem contorno travado');
      ok(await page.locator('.aviso1.info').count() === 1, 'sem faixa info: "' + a + '"');
      ok(await page.getByRole('button', { name: T.enq }).count() === 1, 'sem Ver enquadramento');
      ok(await page.locator('.capcard .lockcard').count() === 1, 'sem cartao de cadeado');
      ok(await page.locator('.capcard .btn, .capcard .sw, #legenda-card').count() === 0, 'tem controles no cartao travado');
      return `hits=${nomes.join('|')} aviso="${a}"`;
    });
    await step('B: tentar arrastar a queimada nao muda nada (nenhum PUT)', async () => {
      if (phone) return 'celular: sem arrasto por desenho';
      const n0 = puts.length; const alvo = page.locator('.viewport .sel.lockd'); const b = await alvo.boundingBox();
      await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2); await page.mouse.down(); await page.mouse.move(b!.x + b!.width / 2, b!.y - 150, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(2200);
      ok(puts.length === n0, 'PUT apos arrastar queimada');
    });
    await step('B: Ver enquadramento leva pra aba Video; a faixa info some ao trocar de aba', async () => {
      await page.getByRole('button', { name: T.enq }).click(); await page.waitForTimeout(500);
      ok(await tab(T.video).getAttribute('aria-selected') === 'true', 'nao foi pra Video');
      ok(await page.locator('.aviso1.info').count() === 0, 'info ficou');
    });
    await step('B: Baixar liberado e sem export (sem mudanca)', async () => { ok(await baixarBtn().isEnabled(), 'bloqueado'); });

    // ============ PECA H (headline) ============
    await abrir(H);
    await step('H headline: sem cartao Legenda, sem camada caption, sem info nova', async () => {
      await tab(T.estilo).click(); await page.waitForTimeout(300);
      ok(await page.locator('#legenda-card').count() === 0, 'cartao Legenda COM controles aparece na headline');
      const ids = await page.evaluate(() => [...document.querySelectorAll('.viewport button.hit')].map((e) => e.getAttribute('aria-label')));
      ok(await hit().count() === 0, 'hit caption');
      await shot('H-01-estilo');
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(sw <= 1, 'rolagem lateral');
      return 'sem cartao de controles; hits=' + ids.join('|');
    });

    writeFileSync(`${OUT}/resultados-${proj}-${lang}.json`, JSON.stringify({ res, erros: erros.slice(0, 12) }, null, 1));
    const falhas = res.filter((r) => !r.ok);
    console.log(`RESULTADO ${proj} ${lang}: ${res.length - falhas.length}/${res.length} ok`);
    for (const r of res) console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${r.passo} :: ${r.nota.slice(0, 260)}`);
    console.log('  http>=400:', falhasHttp.length, JSON.stringify(falhasHttp.slice(0, 6)));
    console.log('  erros console:', erros.length, erros.slice(0, 3).join(' || '));
  });
}
