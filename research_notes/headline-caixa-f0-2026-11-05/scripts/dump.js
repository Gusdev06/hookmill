const fs=require('fs');
const env=fs.readFileSync('.env','utf8');const u=/^DATABASE_URL=["']?([^"'\n]+)/m.exec(env)[1];
if(!/localhost|127\.0\.0\.1/.test(u)) throw new Error('nao local');
process.env.DATABASE_URL=u;
const {PrismaClient}=require(process.cwd()+'/../node_modules/@prisma/client');
(async()=>{const p=new PrismaClient();
const rows=await p.$queryRawUnsafe(`select t.champion_id id, c.name, t.edit_map m, c.video_file_id vf, f.storage_key k from teardowns t join champions c on c.id=t.champion_id left join files f on f.id=c.video_file_id where t.edit_map is not null and c.name in ('02-1985335258774350-0','06-1801003027708969-0','05-1690340855780761-0','01-2235522793977796-0','v1-outra','snapinsta-1791161537282','podcast-aceite') order by c.name`);
const seen=new Set();
for(const r of rows){if(seen.has(r.name))continue;seen.add(r.name);const m=r.m;console.log('==',r.id,r.name,m.width+'x'+m.height,'fps',m.fps,'frames',m.frameCount,'key',r.k);
for(const l of m.layers){console.log(' ',l.id,l.kind,'f',l.startFrame,l.endFrame,'box',JSON.stringify(l.box),'bg',l.background.kind,(l.background.color||'').slice(0,60),JSON.stringify(l.background.box),'src',l.source);console.log('     font',l.style.fontId,'sz',l.style.fontSizePx,'lh',l.style.lineHeight,'up',l.style.uppercase,'cor',l.style.color,'hl',l.style.highlightColor,'stroke',l.style.strokeColor,l.style.strokeWidthPx,'sh',l.style.shadow,'al',l.style.align);console.log('     txt',(l.text||'').slice(0,90));}}
await p.$disconnect();})();
