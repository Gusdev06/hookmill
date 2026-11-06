import {chromium,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
const dir='testes/usuario-comum-2026-11-04/';
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={checks:[],http:[],errors:[]};
try {
for (const [who,batch,n,charged] of [['user','cmw1nr9ss000922hspx7jo4i4',6,4],['manual','cmw1o7oht004l22hsa5r1hqbl',2,2]]) {
 const context=await browser.newContext({baseURL:'http://localhost:3311',storageState:`testes/.cache/hunt/ux-${who}-state.json`,viewport:{width:1440,height:900}});
 await context.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)||/^(data|blob|about):/.test(r.request().url())?r.continue():r.abort());
 const auth=await context.request.get('/api/session');expect(auth.status()).toBe(200);const session=await auth.json();
 const r=await context.request.get(`http://localhost:3201/api/v1/iterate/${batch}`,{headers:{authorization:`Bearer ${session.accessToken}`}});expect(r.status()).toBe(200);const b=(await r.json()).data;
 expect(session.user.access).toBe('SAMPLE');expect(b.pieces.filter(p=>p.status==='ready')).toHaveLength(n);expect(b.template.charged).toBe(charged);expect(b.template.status).toBe('SETTLED');
 for(const p of b.pieces.filter(p=>p.status==='ready')) {expect(p.locked).toBe(true);expect(p.file).toBeFalsy();expect(p.preview?.url).toBeTruthy();}
 report.http.push({who,status:r.status(),access:session.user.access,batch,phase:b.phase,ready:n,pool:b.template.pool,charged:b.template.charged,locked:true,previews:true,originalsExposed:false});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(/MISSING_MESSAGE|INVALID_MESSAGE/.test(m.text()))report.errors.push(m.text())});
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.append(s)}));
 await page.goto(`/templates/run/${batch}?view=generate`);
 await expect(page.getByRole('radio',{name:'PT',exact:true})).toBeVisible();await page.getByRole('radio',{name:'PT',exact:true}).click();
 await expect(page.getByText(`Amostra grátis · ${n} variações, sem custo`,{exact:true})).toBeVisible();
 await page.screenshot({path:dir+`verify-${who}-generation-pt.png`,fullPage:true});report.checks.push(`${who}: real count ${n} in PT`);
 await page.getByRole('radio',{name:'EN',exact:true}).click();await expect(page.getByText(`Free sample · ${n} variations, no cost`,{exact:true})).toBeVisible();report.checks.push(`${who}: real count ${n} in EN`);
 await page.goto(`/templates/run/${batch}`);await expect(page.getByText('New variations using your credits',{exact:true})).toBeVisible();await expect(page.getByText('The sample uses 1 use per Editing template. One template can produce more than one video.',{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:dir+`verify-${who}-download-mobile-en.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);report.checks.push(`${who}: corrected unlock copy and no horizontal overflow at 390px`);
 if(who==='manual') {
  await page.setViewportSize({width:1440,height:900});await page.goto('/templates/run/cmw1ocypr006n22hshbwxd3cs');
  await expect(page.getByText('8 more free uses needed',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Generate',exact:true})).toBeDisabled();report.checks.push('shortage: free uses in EN, generation disabled');
  await page.getByRole('radio',{name:'PT',exact:true}).click();await expect(page.getByText('Faltam 8 usos grátis',{exact:true})).toBeVisible();await expect(page.getByText('Selecione menos templates para caber nos seus usos grátis. Seu plano e a leitura ficam salvos.',{exact:true})).toBeVisible();await page.screenshot({path:dir+'verify-shortage-pt.png',fullPage:true});report.checks.push('shortage: free uses and recovery instruction in PT');
 }
 await context.close();
}
expect(report.errors).toEqual([]);
writeFileSync(dir+'verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await browser.close()}
