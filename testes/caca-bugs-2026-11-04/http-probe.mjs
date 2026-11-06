import {api,save,pool} from './harness.mjs';
const out=[];
for(const role of ['OWNER','ADMIN','MEMBER','CLIENT'])for(const path of ['/auth/me','/workspace','/ad-templates','/credits','/credits/ledger?limit=9999999999999999999999','/admin/ad-templates','/brain','/brand-kit','/meta/connection','/meta/templates','/meta/campaigns','/iterate','/creatives','/offers']){const r=await api('GET',path,undefined,role);out.push({role,path,status:r.status,code:r.body?.error?.code});}
const catalog=(await api('GET','/ad-templates')).data;save('catalog',catalog);
for(const [method,path,body] of [
['POST','/auth/signup',{name:'   ',email:'probe@example.com',password:'123456'}],
['POST','/auth/signup',{name:'A'.repeat(121),email:'bad',password:'123'}],
['POST','/auth/login',{email:{x:1},password:['x']}],
['POST','/ad-templates/fits',{slug:'cold-open',sources:[null]}],
['POST','/ad-templates/fits',{slug:'cold-open',sources:[{}]}],
['POST','/ad-templates/use',{slugs:['cold-open','cold-open']}],
['POST','/ad-templates/use',{slugs:['bad','missing'],metaAdId:'mock_ad_1'}],
['POST','/meta/templates',{}],['POST','/meta/publish-batch',{creativeIds:[],templateId:'bad'}],
['POST','/brand-kit/assets',{kind:'LOGO',uploadId:null}],
['PATCH','/workspace',{name:null}],['PATCH','/auth/me',{name:null}],
]){const r=await api(method,path,body,path.startsWith('/auth/signup')||path==='/auth/login'?null:'OWNER');out.push({method,path,body,...r});}
save('http-probe',out);console.log(out.map(x=>({role:x.role,path:x.path,status:x.status,code:x.code??x.body?.error?.code})));await pool.end();
