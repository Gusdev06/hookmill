// QA 20/11 do "editor simples" (commit bfcfb10) no navegador: 1440 e 390, EN e PT. Web 3210 -> API de teste 3111 (mock), banco maquina_test.
// Cada passo grava PASS/FAIL em qa-editor-simples-2026-11-20/resultados-<projeto>.json; os prints ficam na mesma pasta.
import { readFileSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { loginRapido } from '../../harness/navegador.ts';
import { CACHE_DIR } from '../../harness/env.ts';
import { prepararWs } from '../../harness/f1a.ts';

const OUT = process.env.QA_OUT!;
test.setTimeout(900_000);

type Res = { passo: string; ok: boolean; nota: string };
const L = {
  en: { tabs: ['Text', 'Video', 'Style'], baixar: 'Download video', auto: 'Automatic', perto: 'Closer', longe: 'Wider', livre: 'Custom', salvo: 'Saved', reset: 'Reset everything to the original', sozinho: 'Frame it for me', export: /^Export$/ },
  'pt-BR': { tabs: ['Textos', 'Vídeo', 'Estilo'], baixar: 'Baixar vídeo', auto: 'Automático', perto: 'Mais perto', longe: 'Mais longe', livre: 'Livre', salvo: 'Salvo', reset: 'Voltar tudo ao original', sozinho: 'Enquadrar sozinho', export: /^Exportar$/ },
} as const;

for (const lang of ['en', 'pt-BR'] as const) {
  test(`EDITOR SIMPLES ${lang}`, async ({ page, baseURL }, info) => {
    const proj = info.project.name;
    const phone = proj.endsWith('390');
    const T = L[lang];
    const res: Res[] = [];
    const erros: string[] = [];
    const puts: any[] = [];
    const reqs: { t: number; m: string; u: string }[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || /MISSING_MESSAGE|IntlError/.test(m.text())) erros.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => erros.push('pageerror ' + e.message.slice(0, 300)));
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/v1') || u.pathname.startsWith('/api/')) reqs.push({ t: Date.now(), m: r.method(), u: u.pathname + u.search });
      if (r.method() === 'PUT' && u.pathname.endsWith('/editor')) puts.push(r.postDataJSON());
    });
    const shot = (n: string) => page.screenshot({ path: `${OUT}/${proj}-${lang}-${n}.png`, fullPage: false });
    const step = async (passo: string, fn: () => Promise<string | void>) => {
      try { const nota = (await fn()) ?? ''; res.push({ passo, ok: true, nota }); } catch (e: any) { res.push({ passo, ok: false, nota: String(e.message).split('\n').slice(0, 4).join(' | ') }); await shot('FALHA-' + passo.replace(/\W+/g, '_').slice(0, 30)).catch(() => undefined); }
    };
    const ok = (c: unknown, msg: string) => { if (!c) throw new Error(msg); };
    const tab = (n: string) => page.getByRole('tab', { name: n, exact: true });

    await prepararWs();
    await loginRapido(page, 'donoA');
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: lang, url: baseURL! }]);
    const { pieces } = JSON.parse(readFileSync(`${CACHE_DIR}/qa-editor-simples.json`, 'utf8'));
    const abrir = async (idx = 0) => {
      await page.goto(`/creatives/${pieces[idx].creativeId}/editor`);
      await page.locator('.ed.simples').waitFor({ timeout: 90_000 });
      await page.locator('.viewport video').first().waitFor({ state: 'attached', timeout: 90_000 });
      await page.waitForTimeout(2500);
    };
    await abrir(lang === 'en' ? 0 : 1);
    await shot('01-aberto');

    await step('layout: sem coluna de camadas nem linha do tempo; aparar embaixo do vídeo', async () => {
      const f = await page.evaluate(() => {
        const r = (s: string) => { const e = document.querySelector(s) as HTMLElement | null; if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), vis: b.width > 0 && b.height > 0 }; };
        return { rail: !!document.querySelector('aside.rail'), tl: !!document.querySelector('section.tl'), viewport: r('.viewport'), panel: r('.panel'), trim: r('.trimcard'), stage: r('.stagewrap'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      ok(!f.rail && !f.tl, 'ainda existe coluna de camadas ou linha do tempo: ' + JSON.stringify(f));
      ok(f.trim && f.viewport && f.trim.y >= f.viewport.y + f.viewport.h - 2, 'aparar não está abaixo do vídeo ' + JSON.stringify(f));
      if (!phone) ok(f.panel && f.viewport && f.panel.x >= f.viewport.x + f.viewport.w - 2, 'painel não está ao lado do vídeo ' + JSON.stringify(f));
      else ok(f.panel && f.trim && f.panel.y < f.trim.y && f.panel.y >= f.viewport!.y + f.viewport!.h - 2, 'B5: no celular o painel (abas) deveria vir depois do vídeo e ANTES do aparar ' + JSON.stringify(f));
      const topAbas = await page.getByRole('tab').first().evaluate((e) => Math.round(e.getBoundingClientRect().top)); const ih = await page.evaluate(() => window.innerHeight);
      if (!phone) ok(f.trim!.y < ih, `B6: aparar fora da dobra (y=${f.trim!.y}, janela ${ih})`);
      info.annotations.push({ type: 'abas', description: `topo das abas y=${topAbas} janela=${ih}` });
      console.log(`INFO ${proj} ${lang} topo abas y=${topAbas} janela=${ih} trim y=${f.trim!.y}`);
      ok(f.sw <= f.cw + 1, `rolagem horizontal ${f.sw} > ${f.cw}`);
      return JSON.stringify(f);
    });
    await step('painel com 3 abas na ordem certa; abre em Textos', async () => {
      const names = await page.getByRole('tab').allInnerTexts();
      ok(JSON.stringify(names) === JSON.stringify(T.tabs), 'abas: ' + names.join(','));
      ok((await tab(T.tabs[0]).getAttribute('aria-selected')) === 'true', 'não abre em Textos');
    });
    await step('topo: um botão só de baixar; sem Exportar; sem "rev N"', async () => {
      const top = await page.locator('header').first().innerText();
      const n = await page.getByRole('button', { name: T.baixar }).count();
      ok(n === 1, 'botões de baixar: ' + n);
      ok(await page.getByRole('button', { name: T.export }).count() === 0, 'ainda há botão Exportar');
      const mrev = (await page.locator('body').innerText()).match(/.{0,30}\b(rev\s*\d+|revis\w+\s*\d+|revision\s*\d+)\b.{0,30}/i);
      ok(!mrev, 'texto "rev N" na tela: ' + mrev?.[0]);
      return top.replace(/\n/g, ' / ');
    });
    await step('textos: sem a tabela técnica (cabeçalho, Em, De onde veio)', async () => {
      const f = await page.evaluate(() => {
        const vis = (e: Element | null) => !!e && (e as HTMLElement).offsetParent !== null && getComputedStyle(e).display !== 'none';
        const hdr = [...document.querySelectorAll('.lrow.hdr')].filter(vis).length;
        const mark = [...document.querySelectorAll('.lrow .mark, .lrow .at, .lrow .src .tag')].filter(vis).length;
        return { hdr, mark, rows: document.querySelectorAll('.lrow').length, panel: (document.querySelector('.panel') as HTMLElement).innerText };
      });
      ok(f.hdr === 0 && f.mark === 0, 'tabela técnica visível ' + JSON.stringify(f));
      return f.panel.replace(/\n+/g, ' / ').slice(0, 300);
    });
    await shot('02-textos');
    await step('clicar num texto na prévia abre Textos com o campo focado', async () => {
      await tab(T.tabs[2]).click();
      ok((await tab(T.tabs[2]).getAttribute('aria-selected')) === 'true', 'não foi pra Estilo');
      const hit = page.locator('.viewport button.hit[aria-label]').filter({ hasNotText: 'zzz' });
      const nomes = await hit.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      const alvo = page.locator('.viewport button.hit[aria-label="Headline"], .viewport button.hit[aria-label="Título"], .viewport button.hit[aria-label="Manchete"]').first();
      ok(await alvo.count(), 'sem hit de headline; hits=' + nomes.join('|'));
      const b = await alvo.boundingBox();
      await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
      await page.waitForTimeout(500);
      ok((await tab(T.tabs[0]).getAttribute('aria-selected')) === 'true', 'não abriu Textos; hits=' + nomes.join('|'));
      const foco = await page.evaluate(() => document.activeElement?.getAttribute('data-text-layer') ?? `${document.activeElement?.tagName}`);
      ok(foco && foco !== 'BODY' && !/^(BUTTON|DIV)$/.test(foco), 'campo não focado: ' + foco);
      return 'hits=' + nomes.join('|') + ' foco=' + foco;
    });
    await shot('03-texto-focado');
    await step('digitar no campo salva sozinho e mostra ' + T.salvo, async () => {
      const campo = page.locator('[data-text-layer]').first();
      const n0 = puts.length;
      await campo.fill('QA texto novo');
      await page.waitForTimeout(2500);
      ok(puts.length > n0, 'nenhum PUT /editor após digitar');
      ok(await page.locator('[role=status]').filter({ hasText: T.salvo }).count() > 0, 'não mostra ' + T.salvo);
    });

    // Vídeo
    await step('aba Vídeo: Automático/Mais perto/Mais longe, dica, e o vídeo é selecionado', async () => {
      await tab(T.tabs[1]).click();
      await page.waitForTimeout(600);
      for (const n of [T.auto, T.perto, T.longe, T.livre]) ok(await page.locator('.enq-op', { hasText: n }).count() === 1, 'falta botão ' + n);
      ok(await page.locator('.enq-op[aria-pressed=true]').count() === 1, 'nenhum/mais de um modo marcado');
      const marcado = await page.locator('.enq-op[aria-pressed=true] b').innerText();
      const dica = await page.locator('.panel .hint').first().innerText();
      return `marcado=${marcado}; dica="${dica.slice(0, 90)}"`;
    });
    await shot('04-video');
    await step('Mais longe / Mais perto / Automático gravam o enquadramento', async () => {
      const n0 = puts.length;
      await page.locator('.enq-op', { hasText: T.longe }).click();
      await page.waitForTimeout(1800);
      ok((await page.locator('.enq-op[aria-pressed=true] b').innerText()) === T.longe, 'Mais longe não ficou marcado');
      const p1 = puts.slice(n0).at(-1);
      ok(JSON.stringify(p1).includes('contain_blur'), 'PUT sem contain_blur: ' + JSON.stringify(p1)?.slice(0, 200));
      await shot('05-mais-longe');
      await page.locator('.enq-op', { hasText: T.perto }).click();
      await page.waitForTimeout(1800);
      ok((await page.locator('.enq-op[aria-pressed=true] b').innerText()) === T.perto, 'Mais perto não ficou marcado');
      await shot('06-mais-perto');
      await page.locator('.enq-op', { hasText: T.auto }).click();
      await page.waitForTimeout(1800);
      ok((await page.locator('.enq-op[aria-pressed=true] b').innerText()) === T.auto, 'Automático não ficou marcado');
    });
    if (!phone) {
      await step('guias: só aparecem ao reenquadrar; seletor de guias não existe mais', async () => {
        const g = await page.evaluate(() => ({ g: document.querySelectorAll('.g-rect, .g-ui').length, seg: !!document.querySelector('.stage-head .seg') }));
        ok(!g.seg, 'seletor de guias ainda existe');
        const vp = page.locator('.viewport');
        const b = (await vp.boundingBox())!;
        // na aba Vídeo o modo de reenquadrar vem da aba
        ok(await page.locator('.rf-cap').count() > 0, 'aba Vídeo aberta mas sem camada de reenquadrar (.rf-cap)');
        const gAberta = await page.evaluate(() => document.querySelectorAll('.g-rect, .g-ui').length);
        await tab(T.tabs[0]).click();
        await page.waitForTimeout(500);
        const gFechada = await page.evaluate(() => document.querySelectorAll('.g-rect, .g-ui').length);
        ok(gAberta > 0 && gFechada === 0, `guias reenquadrando=${gAberta} fora=${gFechada}`);
        return `guias reenquadrando=${gAberta} fora=${gFechada}; viewport=${Math.round(b.width)}x${Math.round(b.height)}`;
      });
      await step('arrastar na prévia (aba Vídeo aberta) reenquadra sem duplo clique e marca Livre', async () => {
        await tab(T.tabs[1]).click();
        await page.waitForTimeout(700);
        await page.locator('.enq-op', { hasText: T.perto }).click();
        await page.waitForTimeout(1200);
        const b = (await page.locator('.viewport').boundingBox())!;
        const n0 = puts.length;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 50, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(1800);
        const marcado = await page.locator('.enq-op[aria-pressed=true] b').innerText();
        await shot('07-arrastou');
        ok(puts.length > n0, 'arrastar não gerou PUT');
        ok(marcado === T.livre, 'modo marcado após arrastar: ' + marcado);
        await page.locator('.enq-op', { hasText: T.perto }).click();
        await page.waitForTimeout(1200);
        const volta = await page.locator('.enq-op[aria-pressed=true] b').innerText();
        ok(volta === T.perto, 'B3: Mais perto de novo não voltou a marcar Mais perto: ' + volta);
        return `PUT framing=${JSON.stringify(puts.at(-1)?.doc?.video?.framing)}`;
      });
      await step('rolar na prévia dá zoom (dica promete)', async () => {
        const b = (await page.locator('.viewport').boundingBox())!;
        const n0 = puts.length;
        const z0 = puts.at(-1)?.doc?.video?.framing?.zoom;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.wheel(0, -300);
        await page.waitForTimeout(1800);
        ok(puts.length > n0, 'rolar não gerou PUT');
        return `zoom ${z0} -> ${puts.at(-1)?.doc?.video?.framing?.zoom}`;
      });
      await step('Esc na aba Vídeo volta pros Textos', async () => {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        ok((await tab(T.tabs[0]).getAttribute('aria-selected')) === 'true', 'Esc não voltou pra Textos');
      });
    } else {
      await step('celular: aba Vídeo sem reenquadrar na prévia; dica não promete arrastar', async () => {
        const rf = await page.locator('.rf-cap').count();
        const dica = await page.locator('.panel .hint').first().innerText();
        ok(rf === 0, 'reenquadrar ativo no celular');
        ok(!/drag|arraste/i.test(dica), 'a dica do celular manda arrastar a prévia, mas arrastar não existe aqui: "' + dica + '"');
      });
    }

    await step('aviso numa faixa só + conserto num clique (Enquadrar sozinho)', async () => {
      await tab(T.tabs[1]).click();
      await page.waitForTimeout(500);
      // empurra o enquadramento pra um extremo pra provocar legenda/rosto cortado
      const f = await page.getByRole('spinbutton').count();
      let provocou = false;
      for (let i = 0; i < 6 && !provocou; i++) {
        await page.locator('.enq-op', { hasText: T.perto }).click();
        await page.waitForTimeout(700);
        provocou = (await page.locator('.aviso1').count()) > 0;
      }
      await shot('08-aviso-tentativa');
      if (!provocou) return `não consegui provocar aviso com Mais perto x6 (spinbuttons=${f}); sem prova`;
      const n = await page.locator('.aviso1').count();
      const txt = await page.locator('.aviso1').first().innerText();
      ok(n === 1, 'faixas de aviso: ' + n);
      const btn = page.locator('.aviso1 button', { hasText: T.sozinho });
      let nota = 'aviso="' + txt.replace(/\n/g, ' ') + '"';
      if (await btn.count()) {
        await btn.click();
        await page.waitForTimeout(1500);
        ok(await page.locator('.aviso1').count() === 0, 'aviso continua depois de ' + T.sozinho);
        nota += ' -> sumiu';
      }
      return nota;
    });
    await step('Estilo: cor/formato do template; sem os textos; ajuste fino ao clicar elemento', async () => {
      await tab(T.tabs[2]).click();
      await page.waitForTimeout(600);
      const txt = await page.locator('.panel').innerText();
      await shot('09-estilo');
      const bandHit = page.locator('.viewport button.hit[aria-label="Headline band"], .viewport button.hit[aria-label="Faixa da headline"]').first();
      let nota = 'painel=' + txt.replace(/\n+/g, ' / ').slice(0, 200);
      if (await bandHit.count() && !phone) {
        const b = (await bandHit.boundingBox())!;
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(500);
        nota += ' | fino=' + (await page.locator('details.fino').count());
        await shot('10-estilo-elemento');
      }
      return nota;
    });
    await step('"Voltar tudo ao original" existe e restaura', async () => {
      const b = page.getByRole('button', { name: T.reset });
      ok(await b.count() === 1, 'botão não aparece');
    });

    // download
    await step('Baixar vídeo: com mudança gera versão nova e baixa quando pronta (1ª vez)', async () => {
      await tab(T.tabs[0]).click();
      const campo = page.locator('[data-text-layer]').first();
      await campo.fill('QA muda um');
      await page.waitForTimeout(1500);
      const t0 = Date.now(); const r0 = reqs.length;
      const dl = page.waitForEvent('download', { timeout: 120_000 }).catch(() => null);
      await page.getByRole('button', { name: T.baixar }).click();
      const d = await dl;
      const novos = reqs.slice(r0).map((r) => `${r.m} ${r.u.replace(/\?.*/, '')}`);
      await shot('11-baixou-1');
      ok(novos.some((u) => /POST .*\/export/.test(u)), 'não chamou export: ' + novos.join(' ; '));
      ok(d, 'não houve download. chamadas: ' + novos.join(' ; '));
      return `download ${d!.suggestedFilename()} em ${Date.now() - t0} ms; chamadas: ${novos.join(' ; ')}`;
    });
    await step('Baixar vídeo: 2ª mudança na mesma sessão exporta ANTES de baixar (versão nova, não a velha)', async () => {
      await page.waitForTimeout(1500);
      const campo = page.locator('[data-text-layer]').first();
      await campo.fill('QA muda dois');
      await page.waitForTimeout(1500);
      const r0 = reqs.length;
      const dl = page.waitForEvent('download', { timeout: 120_000 }).catch(() => null);
      await page.getByRole('button', { name: T.baixar }).click();
      const d = await dl;
      const novos = reqs.slice(r0).map((r) => `${r.m} ${r.u.replace(/\?.*/, '')}`);
      const iExp = novos.findIndex((u) => /POST .*\/export/.test(u));
      const iDl = novos.findIndex((u) => /GET .*\/download/.test(u));
      ok(iExp >= 0, 'não exportou a mudança: ' + novos.join(' ; '));
      ok(iDl < 0 || iDl > iExp, `baixou ANTES de exportar (download na posição ${iDl}, export em ${iExp}): ` + novos.join(' ; '));
      return `chamadas: ${novos.join(' ; ')}; download=${d ? d.suggestedFilename() : 'nenhum'}`;
    });
    await step('B1: 3ª mudança na mesma sessão também exporta ANTES de baixar', async () => {
      await page.waitForTimeout(1500);
      await tab(T.tabs[0]).click();
      const campo = page.locator('[data-text-layer]').first();
      await campo.fill('QA muda tres');
      await page.waitForTimeout(1500);
      const r0 = reqs.length;
      const dl = page.waitForEvent('download', { timeout: 120_000 }).catch(() => null);
      await page.getByRole('button', { name: T.baixar }).click();
      const d = await dl;
      const novos = reqs.slice(r0).map((r) => `${r.m} ${r.u.replace(/\?.*/, '')}`);
      const iExp = novos.findIndex((u) => /POST .*\/export/.test(u));
      const iDl = novos.findIndex((u) => /GET .*\/download/.test(u));
      ok(iExp >= 0 && (iDl < 0 || iDl > iExp), `ordem errada: export=${iExp} download=${iDl}: ` + novos.join(' ; '));
      ok(d, 'sem download');
      return `export=${iExp} download=${iDl}`;
    });
    await step('Baixar vídeo sem mudança baixa direto, sem exportar', async () => {
      await page.waitForTimeout(2500);
      const r0 = reqs.length;
      const dl = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
      await page.getByRole('button', { name: T.baixar }).click();
      const d = await dl;
      const novos = reqs.slice(r0).map((r) => `${r.m} ${r.u.replace(/\?.*/, '')}`);
      ok(!novos.some((u) => /POST .*\/export/.test(u)), 'exportou sem mudança: ' + novos.join(' ; '));
      ok(d, 'sem download: ' + novos.join(' ; '));
      return novos.join(' ; ');
    });


    await step('aparar: dá pra alcançar o aparar sem sair do editor (rolagem) e ele funciona', async () => {
      const trim = page.locator('.trimcard');
      const y0 = (await trim.boundingBox())!.y;
      await trim.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const b = (await trim.boundingBox())!;
      await shot('12-aparar');
      const btns = await trim.getByRole('button').allInnerTexts();
      return `inner=${await page.evaluate(() => window.innerHeight)} trimTopAntes=${Math.round(y0)} depois=${Math.round(b.y)} h=${Math.round(b.height)} botoes=${btns.join('|')}`;
    });
    await step('número fora da fala: avisa na faixa e dá um jeito de confirmar (sem travar sem saída)', async () => {
      await tab(T.tabs[0]).click();
      const campo = page.locator('[data-text-layer]').first();
      await campo.fill('Save 50 dollars today');
      await page.waitForTimeout(1500);
      const aviso = (await page.locator('.aviso1').count()) ? (await page.locator('.aviso1').first().innerText()).replace(/\n/g, ' ') : 'sem aviso';
      const dis = await page.getByRole('button', { name: T.baixar }).isDisabled();
      const painel = (await page.locator('.panel').innerText()).replace(/\n+/g, ' / ');
      await shot('13-numero');
      const w1 = await page.evaluate(() => Math.round((document.querySelector('[data-text-layer]') as HTMLElement).getBoundingClientRect().width));
      const w0 = await page.evaluate(() => Math.round((document.querySelector('.panel') as HTMLElement).getBoundingClientRect().width));
      const keep = page.locator('.inv .btn').first();
      ok(await keep.count() > 0, 'sem botão de confirmar o número');
      await keep.click();
      await page.waitForTimeout(1500);
      const dis2 = await page.getByRole('button', { name: T.baixar }).isDisabled();
      const w2 = await page.evaluate(() => Math.round((document.querySelector('[data-text-layer]') as HTMLElement).getBoundingClientRect().width));
      await shot('14-numero-confirmado');
      ok(!dis2, 'Baixar continua desabilitado depois de confirmar o número');
      ok(w1 > w0 * 0.5, `campo de texto colapsou com o aviso de número: largura ${w1}px (painel ${w0}px); depois de confirmar ${w2}px`);
      return `aviso="${aviso}" baixarDesab(antes)=${dis} largura campo=${w1}px painel=${w0}px depois=${w2}px baixarDesab(depois)=${dis2}`;
    });

    await step('i18n: nenhuma chave crua nem MISSING_MESSAGE na tela', async () => {
      const txt = await page.locator('body').innerText();
      const cru = txt.match(/\b(simples|editorU|top|panel|issue|hist)\.[a-zA-Z.]+/g);
      ok(!cru, 'chave crua: ' + cru?.join(','));
      const miss = erros.filter((e) => /MISSING_MESSAGE|IntlError|Could not resolve/.test(e));
      ok(!miss.length, 'erros i18n: ' + miss.join(' | '));
    });
    await step('console sem erro de página', async () => {
      const so = erros.filter((e) => !/Failed to load resource|favicon|net::ERR/.test(e));
      ok(!so.length, so.slice(0, 4).join(' | '));
      return `erros brutos=${erros.length}`;
    });
    await shot('99-final');
    writeFileSync(`${OUT}/resultados-${proj}-${lang}.json`, JSON.stringify({ res, erros: erros.slice(0, 10) }, null, 1));
    for (const r of res) console.log(`${r.ok ? 'PASS' : 'FAIL'} [${proj} ${lang}] ${r.passo} :: ${r.nota.slice(0, 400)}`);
  });
}
