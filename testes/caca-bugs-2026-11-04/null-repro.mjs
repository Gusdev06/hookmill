import {api,q,save,pool,browserPage,shot,API,token} from './harness.mjs';
const out=[];
for(const path of ['/workspace','/auth/me'])for(const body of [{name:null},{uiLocale:null},{name:'   '}]){const r=await api('PATCH',path,body);out.push({path,input:body,status:r.status,error:r.body?.error});}
await q("update workspaces set name='QA Alfa' where id='qa_ws_alfa'");await q("update users set name='QA Dono Alfa' where id='qa_user_dono_a'");
const {browser,page}=await browserPage();await page.goto('/settings');const auth=await token();const r=await page.evaluate(async({API,auth})=>{const r=await fetch(API+'/workspace',{method:'PATCH',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:'{"name":null}'});return {status:r.status,body:await r.json()}},{API,auth});out.push({browser:r});await shot(page,'r1-invalid-name-settings');save('null-before',out);console.log(out);await browser.close();await pool.end();
