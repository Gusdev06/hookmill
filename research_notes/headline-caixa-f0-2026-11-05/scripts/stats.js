const fs=require('fs');
const env=fs.readFileSync('.env','utf8');const u=/^DATABASE_URL=["']?([^"'\n]+)/m.exec(env)[1];
if(!/localhost|127\.0\.0\.1/.test(u)) throw new Error('nao local');
process.env.DATABASE_URL=u;
const {PrismaClient}=require(process.cwd()+'/../node_modules/@prisma/client');
(async()=>{const p=new PrismaClient();
const rows=await p.$queryRawUnsafe(`select a.champion_id, c.name, a.edit_map as m, c.status from teardowns a join champions c on c.id=a.champion_id where a.edit_map is not null`).catch(async e=>{console.log(e.message.slice(0,300));return []});
console.log('analises com mapa',rows.length);
const out=[];const seen=new Set();
for(const r of rows){const m=r.m; if(!m||!m.layers) continue; if(seen.has(r.champion_id))continue; seen.add(r.champion_id);
 const c=m.layers.filter(l=>l.kind==='headline'||(l.kind==='text'&&l.endFrame-l.startFrame>=.5*m.frameCount&&l.box.y+l.box.h/2<.7*m.height)).sort((a,b)=>b.box.w*b.box.h-a.box.w*a.box.h)[0];
 const caps=m.layers.some(l=>l.kind==='caption');
 const allhead=m.layers.filter(l=>l.kind==='headline'||l.kind==='text');
 out.push({id:r.champion_id.slice(0,12),name:(r.name||'').slice(0,28),w:m.width,h:m.height,dur:+(m.frameCount/m.fps).toFixed(1),nH:allhead.length,caps,head:c?{k:c.kind,bg:c.background.kind,col:c.background.color&&c.background.color.slice(0,24),src:c.source,font:c.style.fontId,sz:c.style.fontSizePx,hl:c.style.highlightColor,st:c.startFrame,en:c.endFrame,frac:+((c.endFrame-c.startFrame)/m.frameCount).toFixed(2),box:c.box,text:(c.text||'').slice(0,46)}:null});}
for(const o of out)console.log(JSON.stringify(o));
const t={total:out.length,sem:0,solid:0,pill:0,none:0,grad:0};for(const o of out){if(!o.head)t.sem++;else{t[o.head.bg]++;if((o.head.col||'').startsWith('linear'))t.grad++;}}
console.log(JSON.stringify(t));
const f={};for(const o of out)if(o.head)f[o.head.font]=(f[o.head.font]||0)+1;console.log(JSON.stringify(f));
await p.$disconnect();})();
