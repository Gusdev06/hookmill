import {browserPage,shot,save,pool,expect} from './harness.mjs';import {readFileSync} from 'node:fs';
const {browser,context,page,errors}=await browserPage(390,'EN','OWNER',false);try{
 await context.addCookies(JSON.parse(readFileSync('testes/.cache/hunt/new-account-state.json')).cookies);await page.goto('/onboarding');await page.getByRole('button',{name:'Looks right',exact:true}).click();await page.waitForTimeout(500);await shot(page,'r1-onboard-offer');console.log('OFFER',await page.locator('body').innerText());

}finally{await context.storageState({path:'testes/.cache/hunt/new-account-state.json'});save('onboard-steps-errors',errors);await browser.close();await pool.end()}
