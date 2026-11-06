import {chromium} from '@playwright/test';import {createInterface} from 'node:readline';import {writeFileSync,mkdirSync} from 'node:fs';
const dir='testes/usuario-comum-2026-11-04/';const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},baseURL:'http://localhost:3311',acceptDownloads:true});
await context.route('**/*',route=>{const u=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:','about:'].includes(u.protocol)?route.continue():route.abort('blockedbyclient')});await context.addCookies([{name:'NEXT_LOCALE',value:'pt-BR',url:'http://localhost:3311'}]);const page=await context.newPage();page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(45000);const events=[];let n=100;
page.on('pageerror',e=>events.push({type:'pageerror',text:e.message}));page.on('response',r=>{if(r.url().startsWith('http://localhost:3201')&&r.request().method()!=='GET')events.push({type:'mutation',url:r.url(),method:r.request().method(),status:r.status(),at:new Date().toISOString()})});page.on('download',async d=>{const path=dir+'download-'+d.suggestedFilename();await d.saveAs(path);events.push({type:'download',path})});
await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='nextjs-portal{display:none!important}';document.head.append(s)}));
const locator=a=>a.selector?page.locator(a.selector):a.role?page.getByRole(a.role,{name:a.name,exact:a.exact??true}):a.label?page.getByLabel(a.label,{exact:a.exact??true}):page.getByText(a.text,{exact:a.exact??true});
async function snapshot(name){const stem=String(++n).padStart(2,'0')+'-'+(name??'step');await page.screenshot({path:dir+stem+'.png',fullPage:true});const body=await page.locator('body').innerText();writeFileSync(dir+stem+'.txt',body);const state={step:n,url:page.url(),viewport:page.viewportSize(),body,controls:await page.locator('button,a,input,textarea,select').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height).map(e=>({tag:e.tagName,role:e.getAttribute('role'),text:e.innerText?.slice(0,90),label:e.getAttribute('aria-label'),id:e.id,type:e.getAttribute('type'),placeholder:e.getAttribute('placeholder'),disabled:e.disabled,href:e.getAttribute('href')})))};writeFileSync(dir+stem+'.json',JSON.stringify(state,null,2));writeFileSync(dir+'events-manual.json',JSON.stringify(events,null,2));console.log(JSON.stringify(state));}

try {
 await page.goto('/signup');
 await page.getByLabel('Seu nome', {exact:true}).fill('João Teste');
 await page.getByLabel('E-mail de trabalho', {exact:true}).fill('ux-joao-20261104-manual@teste.local');
 await page.getByLabel('Senha', {exact:true}).fill('UsuarioTeste123!');
 await page.getByRole('button',{name:'Criar conta',exact:true}).click();
 await page.getByRole('radio',{name:/Só eu/}).click();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByRole('button',{name:'Sem site? Descreva o negócio',exact:true}).click();
 await page.getByLabel('Sua resposta',{exact:true}).fill('Vendo colchões online no Brasil, para adultos que acordam com dor nas costas. Preço R$ 1299 e teste de 30 noites. Quero variar meu vídeo de anúncio.');
 await page.getByRole('button',{name:'Enviar',exact:true}).click();
 await page.getByRole('button',{name:'Está certo',exact:true}).click();
 await page.getByRole('heading',{name:/./}).count();
 await page.getByRole('button',{name:'Está certo',exact:true}).click();
 await page.getByRole('button',{name:'Pular por agora',exact:true}).click();
 await page.getByLabel('Teto mensal de gasto em USD',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pular por agora',exact:true}).click();
 await page.getByText('VÍDEOS DEMO DO PRODUTO',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Pular por agora',exact:true}).click();
 await page.getByRole('button',{name:'Ir pra Home',exact:true}).click();
 for(let i=0;i<3;i++) {await page.getByRole('button',{name:'Avançar',exact:true}).click();await page.waitForTimeout(900);}
 await page.getByRole('button',{name:'Concluir',exact:true}).click();
 await page.getByRole('link',{name:'Enviar um anúncio vencedor',exact:true}).click();
 await page.getByRole('checkbox',{name:'Selecionar Notícia urgente',exact:true}).click();
 await page.getByRole('checkbox',{name:'Selecionar Meme POV',exact:true}).click();
 await snapshot('manual-selecao');
} catch(e) {console.log('SETUP_ERROR',e.message);await snapshot('manual-pausa');}

console.log('READY');const rl=createInterface({input:process.stdin});for await(const line of rl){try{const a=JSON.parse(line);events.push({type:'action',at:new Date().toISOString(),action:a});if(a.op==='stop')break;if(a.op==='goto')await page.goto(a.url,{waitUntil:'domcontentloaded'});if(a.op==='click')await locator(a).click();if(a.op==='fill')await locator(a).fill(a.value);if(a.op==='upload')await locator(a).setInputFiles(a.path);if(a.op==='key')await page.keyboard.press(a.key);if(a.op==='viewport')await page.setViewportSize(a.value);if(a.op==='reload')await page.reload({waitUntil:'domcontentloaded'});if(a.op==='back')await page.goBack();if(a.op==='wait')await page.waitForTimeout(Math.min(a.ms??1000,15000));if(a.op==='inspect')console.log(await page.locator('body').ariaSnapshot());await page.waitForTimeout(250);await snapshot(a.nameTag??a.op);}catch(e){console.log('ACTION_ERROR',e.message);await snapshot('error')}}
await context.storageState({path:'testes/.cache/hunt/ux-manual-state.json'});writeFileSync(dir+'events-manual.json',JSON.stringify(events,null,2));await browser.close();
