import {prepare,connect,browserPage,shot,save,q,pool} from './harness.mjs';
await prepare();await connect();const results=[];
for(const [width,locale] of [[1440,'EN'],[390,'PT_BR'],[390,'EN'],[1440,'PT_BR']]){
 const {browser,page,errors}=await browserPage(width,locale);
 for(const path of ['/','/brain','/templates','/templates/selection?t=bad,missing','/library','/creatives','/campaigns','/settings','/settings/connections','/settings/connections/templates','/templates/admin','/credits','/iterate/new','/offers','/clients','/eddy']){
  const name=`r1-${width}-${locale}-${path.replaceAll('/','_').replaceAll('?','_')}`;
  try{await page.goto(path);await page.waitForTimeout(1000);await shot(page,name);const dims=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,ch:document.documentElement.clientHeight}));results.push({path,width,locale,url:page.url(),dims,errors:[...errors]});console.log(JSON.stringify(results.at(-1)))}catch(e){results.push({path,width,locale,error:e.message});console.log('FAIL',path,e.message)}
 }
 await browser.close();save('survey',results);
}
await pool.end();
