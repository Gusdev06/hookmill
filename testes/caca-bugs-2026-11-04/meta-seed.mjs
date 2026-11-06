import {api,q,expect,save,pool} from './harness.mjs';
const offers=await api('GET','/offers');const offer=offers.data[0];const ids=[];
for(let i=1;i<=6;i++){
 const id='huntcreat'+i;
 await q(`insert into creatives (id,workspace_id,offer_id,name,language,state,approved_at,approved_by_id,ad_name,variation_code,created_by_id,updated_at) values ($1,'qa_ws_alfa',$2,$3,'en','APPROVED',now(),'qa_user_dono_a',$4,$5,'qa_user_dono_a',now()) on conflict do nothing`,[id,offer.id,`Hunt ad ${i}`,`HUNT_1104_${i}`,`HEADLINE-0${i}`]);
 await q(`insert into files (id,workspace_id,kind,storage_key,mime_type,size_bytes,duration_sec,width,height) values ($1,'qa_ws_alfa','RENDER_VIDEO',$2,'video/mp4',10000,20,1080,1920) on conflict do nothing`,[id+'f',`ws/qa_ws_alfa/render_video/${id}.mp4`]);
 await q(`insert into renders (id,workspace_id,creative_id,status,settings,input,file_id,duration_sec) values ($1,'qa_ws_alfa',$2,'READY','{}','{}',$3,20) on conflict do nothing`,[id+'r',id,id+'f']);await q('update creatives set final_render_id=$2 where id=$1',[id,id+'r']);ids.push(id);
}
const body={name:'Hunt Sales',isDefault:true,campaign:{destination:'REUSE_CAMPAIGN',objective:'OUTCOME_SALES',budgetMode:'CBO',dailyBudgetMinor:2000,bidStrategy:'LOWEST_COST',bidAmountMinor:null,specialAdCategories:[],namePattern:'Hunt — {offer}'},adset:{pixelId:'pix_mock',pixelEvent:'PURCHASE',countries:['US'],ageMin:18,ageMax:65,genders:'ALL',advantageAudience:true,placements:'AUTO',adsPerAdset:{min:4,max:8},namePattern:'{offer} — {date} — {n}'},ad:{primaryText:'Hunt original',headline:'Sleep well',description:null,callToAction:'SHOP_NOW',link:'https://example.com/',urlTags:null,namePattern:'{code}'}};
const r=await api('POST','/meta/templates',body);expect(r.status,JSON.stringify(r)).toBe(201);save('meta-seed',{ids,template:r.data});console.log('Seeded 6 approved creatives, template',r.data.id);await pool.end();
