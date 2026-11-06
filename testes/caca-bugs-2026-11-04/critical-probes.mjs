import {browserPage,shot,save,pool,expect,api} from './harness.mjs';
const {browser,page,errors}=await browserPage();try{
 await page.goto('/templates/selection?t=breaking-news,meme-pov');await page.getByRole('radio',{name:/Hook A — the pain/}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForURL('**/templates/run/**');save('template-run-url',page.url());await shot(page,'r1-template-reading');await page.reload();await page.getByRole('button',{name:/Generate/}).waitFor({timeout:180000});await shot(page,'r1-template-plan');console.log('PLAN',await page.locator('body').innerText());
}catch(e){await shot(page,'r1-template-run-failure');console.log('FAIL',e.message)}
try{
 await page.goto('/creatives/huntcreat1/send');await page.waitForTimeout(600);await shot(page,'r1-meta-send');console.log('SEND',await page.locator('body').innerText());
}finally{save('critical-errors',errors);await browser.close();await pool.end()}
