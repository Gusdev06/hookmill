import {browserPage,shot,save,pool,expect,api,q} from './harness.mjs';import {readFileSync} from 'node:fs';
const {template}=JSON.parse(readFileSync('testes/caca-bugs-2026-11-04/meta-seed.json'));const out=[];
const {browser,page,errors}=await browserPage(390,'PT_BR');try{
 // Reteste observável do primeiro envio, conferindo publicação e template no banco.
 await page.goto('/creatives/huntcreat1/send',{waitUntil:'domcontentloaded'});await page.getByText(/Pausad|pausad/).first().waitFor();await shot(page,'r1-meta-published-pt-mobile');const rows=await q("select status,settings,template_snapshot from meta_publications where creative_id='huntcreat1'");expect(rows[0].status).toBe('PAUSED');expect(rows[0].settings.dailyBudgetMinor).toBe(3500);expect((await api('GET','/meta/templates')).data.find(t=>t.id===template.id).campaign.dailyBudgetMinor).toBe(2000);out.push({override:rows});
 // Lote: revisar o mesmo template com override e salvamento opt-in.
 await page.goto(`/publish/template/${template.id}?review=1&creatives=huntcreat2,huntcreat3&return=%2Flibrary`,{waitUntil:'domcontentloaded'});await shot(page,'r1-meta-batch-review-pt-mobile');console.log(await page.locator('body').innerText());
}catch(e){await shot(page,'r1-meta-more-failure');console.log('FAIL',e.message)}finally{save('meta-more-evidence',out);save('meta-more-errors',errors);await browser.close();await pool.end()}
