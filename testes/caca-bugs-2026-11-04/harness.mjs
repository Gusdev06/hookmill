import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const DIR = fileURLToPath(new URL('.', import.meta.url));
export const API = 'http://localhost:3201/api/v1', WEB = 'http://localhost:3311';
export const pool = new pg.Pool({connectionString:'postgresql://maquina:maquina@localhost:5433/maquina_e2e_test',max:3});
export const q = async(sql,params=[]) => (await pool.query(sql,params)).rows;
const emails={OWNER:'qa@teste.local',ADMIN:'qa-admin-a@teste.local',MEMBER:'qa-membro-a@teste.local',CLIENT:'qa-cliente-a@teste.local'};
const tokens=new Map();
export async function token(role='OWNER') {
 if(!tokens.has(role)){
  let cached={};try{cached=JSON.parse(readFileSync('testes/.cache/hunt/http-tokens.json','utf8'))}catch{}
  if(cached[role]?.at>Date.now()-600000) tokens.set(role,cached[role].token);
  else{let r;for(let i=0;i<5;i++){r=await api('POST','/auth/login',{email:emails[role],password:'teste12345'},null);if(r.status!==429)break;await new Promise(r=>setTimeout(r,20000))}if(r.status!==200)throw Error(JSON.stringify(r));tokens.set(role,r.data.accessToken);cached[role]={at:Date.now(),token:r.data.accessToken};writeFileSync('testes/.cache/hunt/http-tokens.json',JSON.stringify(cached),{mode:0o600})}
 }return tokens.get(role);
}
export async function api(method,path,body,auth='OWNER') {
 const t=auth===null?null:auth.length>30?auth:await token(auth);
 const r=await fetch(API+path,{method,headers:{'content-type':'application/json',...(t?{authorization:'Bearer '+t}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const b=await r.json().catch(()=>null);return {status:r.status,data:b?.data,body:b};
}
export async function prepare(){const [d]=await q('select current_database()');if(d.current_database!=='maquina_e2e_test')throw Error('Wrong database');await q("update users set account_mode='OWN' where id like 'qa_user_%'");await q("update workspaces set onboarding_completed_at=now(), market='US',website_url='https://example.com/' where id in ('qa_ws_alfa','qa_ws_beta')");await q("update memberships set tour_completed_at=now() where id like 'qa_mb_%'");}
export async function connect(){const c=await api('GET','/meta/connection');if(c.data?.status==='CONNECTED'&&c.data?.adAccount?.id==='act_mock_1')return;const r=await api('POST','/meta/connect',{returnTo:'/settings'});if(!r.data?.url?.startsWith(API))throw Error(JSON.stringify(r));await fetch(r.data.url,{redirect:'manual'});const sel=await api('PUT','/meta/selection',{adAccountId:'act_mock_1',pageId:'page_mock',pixelId:'pix_mock'});expect(sel.status).toBe(200);await expect.poll(async()=> (await api('GET','/meta/summary')).data?.sync?.state,{timeout:90000}).toBe('ok');}
export async function browserPage(width=1440,locale='EN',role='OWNER',login=true) {
 const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({baseURL:WEB,viewport:{width,height:width===390?844:900}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:','about:'].includes(u.protocol))return route.continue();return route.abort('blockedbyclient')});
 if(login){await q('update users set ui_locale=$1 where email=$2',[locale,emails[role]]);let r; for(let i=0;i<4;i++){r=await context.request.post('/api/session',{data:{email:emails[role],password:'teste12345'}});if(r.status()!==429)break;await new Promise(r=>setTimeout(r,21000))}expect(r.status(),await r.text()).toBe(200)}
 const page=await context.newPage();page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/MISSING_MESSAGE|INVALID_MESSAGE/.test(m.text()))errors.push(m.text())});
 await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.append(s)}));
 return {browser,context,page,errors};
}
export async function shot(page,name){await page.screenshot({path:DIR+name+'.png',fullPage:true});writeFileSync(DIR+name+'.txt',(await page.locator('body').innerText()));}
export function save(name,value){writeFileSync(DIR+name+'.json',JSON.stringify(value,null,2));}
export {expect};
