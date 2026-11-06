import {browserPage,shot,save,pool,expect} from './harness.mjs';import {readFileSync} from 'node:fs';
const {browser,context,page,errors}=await browserPage(390,'EN','OWNER',false);try{
 await context.addCookies(JSON.parse(readFileSync('testes/.cache/hunt/new-account-state.json')).cookies);await page.goto('/onboarding');await page.waitForTimeout(1500);await shot(page,'r1-onboard-goals');console.log('GOALS',await page.locator('body').innerText());
 const min=page.getByLabel('Minimum');if(await min.count()){await min.fill('20');await page.getByLabel('Maximum').fill('10');await shot(page,'r1-onboard-invalid-cpa');await page.getByLabel('Maximum').fill('30');}
 await page.getByRole('button',{name:'Save the goal',exact:true}).click();await page.waitForTimeout(500);await shot(page,'r1-onboard-kit');console.log('KIT',await page.locator('body').innerText());
}catch(e){await shot(page,'r1-onboard-kit-failure');console.log('FAIL',e.message)}finally{await context.storageState({path:'testes/.cache/hunt/new-account-state.json'});save('onboard-kit-errors',errors);await browser.close();await pool.end()}
