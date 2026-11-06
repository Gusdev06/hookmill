import {browserPage,shot,save,pool,expect,api,API} from './harness.mjs';import {readFileSync} from 'node:fs';
const results=[];
for(const newer of [false,true]){
 const {browser,context,page,errors}=await browserPage(390,'EN','OWNER',!newer);try{
  if(newer)await context.addCookies(JSON.parse(readFileSync('testes/.cache/hunt/new-account-state.json')).cookies);
  const session=await (await context.request.get('/api/session')).json();const auth=session.accessToken;
  await api('POST','/workspace/tour/complete',{},auth);
  if(newer){await api('PATCH','/workspace',{websiteUrl:'https://example.com/'},auth);const offers=(await api('GET','/offers',undefined,auth)).data;await api('PATCH','/offers/'+offers[0].id,{pains:'Insomnia; Back pain',proof:'Customer reviews; 30-day trial'},auth)}
  const graph=(await api('GET','/brain/graph',undefined,auth)).data;save(newer?'brain-new-graph':'brain-owner-graph',graph);await page.goto('/brain?view=map',{waitUntil:'domcontentloaded'});await page.getByRole('textbox').last().waitFor();await shot(page,newer?'r1-brain-new-list':'r1-brain-owner-list');
  const nodes=graph.nodes.filter((n,i,a)=>a.findIndex(x=>x.kind===n.kind)===i&&n.kind!=='workspace');
  for(const node of nodes){try{
   const r=await api('GET','/brain/node/'+encodeURIComponent(node.id),undefined,auth);expect(r.status).toBe(200);
   const label=node.kind==='brand_asset'&&!node.meta.customLabel?(node.meta.assetKind==='LOGO'?'Logo':node.label):node.label;
   await page.getByRole('textbox').last().fill(label);const b=page.locator('#t-brain button').filter({has:page.locator('b').filter({hasText:label})}).first();await b.click();await page.getByRole('dialog').waitFor();await page.waitForTimeout(200);await shot(page,`r1-brain-${newer?'new':'owner'}-${node.kind}`);results.push({newer,kind:node.kind,http:r.status,dialog:await page.getByRole('dialog').innerText()});await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  }catch(e){results.push({newer,kind:node.kind,error:e.message});console.log('NODEFAIL',node.kind,e.message);await page.keyboard.press('Escape')}}
  await page.getByRole('textbox').last().fill('');await page.getByRole('button',{name:/Open.*3D|Explore.*3D|Open the 3D/}).first().click().catch(()=>{});await shot(page,`r1-brain-${newer?'new':'owner'}-map`);results.push({newer,errors});
 }catch(e){results.push({newer,error:e.message});console.log('FAIL',e.message)}finally{if(newer)await context.storageState({path:'testes/.cache/hunt/new-account-state.json'});await browser.close();save('brain-probe',results)}
}
await pool.end();
