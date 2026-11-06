import {browserPage,shot,save,pool} from './harness.mjs';import {readFileSync} from 'node:fs';
const {browser,context,page,errors}=await browserPage(390,'EN','OWNER',false);try{
 await context.addCookies(JSON.parse(readFileSync('testes/.cache/hunt/new-account-state.json')).cookies);await page.goto('/onboarding');await page.getByRole('button',{name:'Continue with Facebook'}).click();await page.waitForTimeout(3500);await shot(page,'r1-onboard-meta-choose');console.log('URL',page.url(),'PAGES',context.pages().map(p=>p.url()));console.log(await page.locator('body').innerText());
}finally{await context.storageState({path:'testes/.cache/hunt/new-account-state.json'});save('onboard-connect-errors',errors);await browser.close();await pool.end()}
