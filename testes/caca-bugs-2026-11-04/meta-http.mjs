import {api,q,save,pool,expect,connect} from './harness.mjs';import {readFileSync} from 'node:fs';
const {template}=JSON.parse(readFileSync('testes/caca-bugs-2026-11-04/meta-seed.json'));const out=[];
try{
 for(const id of ['huntcreat11','huntcreat12','huntcreat13','huntcreat14','huntcreat15']){
  await q(`insert into creatives (id,workspace_id,offer_id,name,language,state,approved_at,approved_by_id,ad_name,variation_code,created_by_id,updated_at) select $1,workspace_id,offer_id,$1,language,state,approved_at,approved_by_id,$1,$1,created_by_id,now() from creatives where id='huntcreat6' on conflict do nothing`,[id]);
  await q(`insert into files (id,workspace_id,kind,storage_key,mime_type,size_bytes,duration_sec,width,height) select $1,workspace_id,kind,storage_key || $1,mime_type,size_bytes,duration_sec,width,height from files where id='huntcreat6f' on conflict do nothing`,[id+'f']);
  await q(`insert into renders (id,workspace_id,creative_id,status,settings,input,file_id,duration_sec) values ($1,'qa_ws_alfa',$2,'READY','{}','{}',$3,20) on conflict do nothing`,[id+'r',id,id+'f']);await q('update creatives set final_render_id=$2 where id=$1',[id,id+'r']);
 }
 for(const [id,trigger,code] of [['huntcreat11','policy','META_POLICY'],['huntcreat12','payment','META_PAYMENT_REQUIRED'],['huntcreat13','rate','META_RATE_LIMITED'],['huntcreat14','error','META_ERROR'],['huntcreat15','token','META_TOKEN_INVALID']]){
  const body={templateId:template.id,override:{campaign:{...template.campaign,destination:'NEW_CAMPAIGN'},ad:{...template.ad,primaryText:`[mock:meta-${trigger}]`}}};const r=await api('POST',`/creatives/${id}/meta/publish`,body);out.push({id,trigger,status:r.status,error:r.body?.error});expect(r.status,JSON.stringify(r)).toBe(202);
  await expect.poll(async()=> (await q('select status from meta_publications where creative_id=$1',[id]))[0]?.status,{timeout:90000,intervals:[500,1000,2000]}).toBe('FAILED');expect((await q('select error_code from meta_publications where creative_id=$1',[id]))[0].error_code).toBe(code);out.push({trigger,publication:await q('select status,error_code,settings,template_snapshot from meta_publications where creative_id=$1',[id])});save('meta-http',out);
 }
 // Token inválido continua permitindo leitura dos templates, como contrato v2.
 const expired=await api('GET','/meta/templates');expect(expired.status).toBe(200);out.push({expiredReadStatus:expired.status});await connect();
 for(const campaignId of ['mock_cmp_life','mock_cmp_awareness','mock_cmp_cbo']){const r=await api('POST','/meta/templates/import',{campaignId});out.push({import:campaignId,...r});}
 const [a,b]=await Promise.all([api('POST','/meta/sync',{}),api('POST','/meta/sync',{})]);expect(a.data.job.id).toBe(b.data.job.id);out.push({concurrentSync:[a.status,b.status],sameJob:true});
 // Retry precisa usar snapshot mesmo depois de editar o template original.
 const previous=(await api('GET','/meta/templates')).data.find(t=>t.id===template.id);
 await api('PATCH','/meta/templates/'+template.id,{ad:{...previous.ad,primaryText:'Changed after failed publication'}});
 const retry=await api('POST','/creatives/huntcreat11/meta/retry',{});expect(retry.status).toBe(202);await expect.poll(async()=> (await q("select status from meta_publications where creative_id='huntcreat11'"))[0]?.status,{timeout:90000}).toBe('FAILED');const retried=(await q("select error_code,template_snapshot from meta_publications where creative_id='huntcreat11'"))[0];expect(retried.error_code).toBe('META_POLICY');expect(retried.template_snapshot.ad.primaryText).toBe('[mock:meta-policy]');out.push({retrySnapshot:retried});console.log('PASS Meta triggers, retry snapshot, concurrent sync, expired read');
}finally{save('meta-http',out);await pool.end()}
