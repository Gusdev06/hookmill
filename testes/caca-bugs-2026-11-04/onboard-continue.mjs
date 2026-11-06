import {browserPage,shot,save,pool,expect,WEB} from './harness.mjs';
import {readFileSync} from 'node:fs';
const {browser,context,page,errors}=await browserPage(390,'EN','OWNER',false);
try{
 const state=JSON.parse(readFileSync('testes/.cache/hunt/new-account-state.json'));await context.addCookies(state.cookies);
 await page.goto('/onboarding');await page.getByRole('button',{name:'No site? Describe the business instead'}).click();await page.getByLabel('Your answer').fill('We sell comfortable mattresses online in the United States for $500. Buyers need better sleep. Real verified reviews and a 30-day trial. Shop now.');await page.getByRole('button',{name:'Send',exact:true}).click();await page.reload();await page.getByText(/Here.s the business as I read it/).waitFor({timeout:60000});await shot(page,'r1-onboard-business');console.log(await page.locator('body').innerText());await context.storageState({path:'testes/.cache/hunt/new-account-state.json'});
}finally{save('onboard-errors',errors);await browser.close();await pool.end()}
