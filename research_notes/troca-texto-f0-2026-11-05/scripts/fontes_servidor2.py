#!/usr/bin/env python3
"""F0 troca-texto, §15.5: fontes abertas × Helvetica Neue Medium e emoji recortado do quadro, na peça aprovada. US$ 0, local.
Rodar de research_notes/headline-refeita-2026-11-05/: python3 fontes_servidor2.py <dir_woff> <saida_dir>"""
import cv2, numpy as np, glob, json, os, sys, subprocess
from PIL import Image, ImageDraw, ImageFont
ORIG='origem/original.mp4'; ROI=(30,525,450,607); x0,y0,x1,y1=ROI; W=464;H=832
def frames(n):
    d=subprocess.Popen(['ffmpeg','-v','error','-i',ORIG,'-frames:v',str(n),'-vf','scale=in_color_matrix=bt709:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24','-f','rawvideo','-pix_fmt','bgr24','-'],stdout=subprocess.PIPE)
    out=[]
    while True:
        b=d.stdout.read(W*H*3)
        if len(b)<W*H*3: break
        out.append(np.frombuffer(b,np.uint8).reshape(H,W,3))
    return out
fs=frames(161); g=[cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY) for f in fs]
mn=np.min(np.stack(g),0).astype(np.float32); T=np.clip((mn-110)/(235-110),0,1); T[:, 356-x0:]=0  # sem o emoji
L1='How to view your man’s'; L2='recent following on IG'; SS=4
def rend(p,idx,c,by,dl,cx1,cx2):
    F=ImageFont.truetype(p,c*SS,index=idx); h,w=T.shape; im=Image.new('L',(w*SS,h*SS),0); d=ImageDraw.Draw(im)
    d.text(((cx1-x0)*SS-F.getlength(L1)/2,(by-y0)*SS),L1,font=F,fill=255,anchor='ls'); d.text(((cx2-x0)*SS-F.getlength(L2)/2,(by+dl-y0)*SS),L2,font=F,fill=255,anchor='ls')
    return cv2.GaussianBlur(cv2.resize(np.array(im,np.float32)/255,(w,h),interpolation=cv2.INTER_AREA),(0,0),.5)
def score(A): return float(np.corrcoef(A.ravel(),T.ravel())[0,1])
CAND=[('Helvetica Neue Medium (macOS)','/System/Library/Fonts/HelveticaNeue.ttc',10)]+[(os.path.basename(p)[:-5],p,0) for p in sorted(glob.glob(sys.argv[1]+'/*.woff'))]
res=[]
for nome,p,idx in CAND:
    v=dict(c=26.5,by=557.0,dl=33.25,cx1=233.0,cx2=212.0)
    passos=dict(c=np.arange(-2,2.01,.25),by=np.arange(-2,2.01,.25),dl=np.arange(-1.5,1.51,.25),cx1=np.arange(-3,3.01,.25),cx2=np.arange(-3,3.01,.25))
    best=score(rend(p,idx,**v))
    for it in range(3):
        for k,ds in passos.items():
            base=v[k]; 
            for d in ds:
                u=dict(v); u[k]=base+d; s=score(rend(p,idx,**u))
                if s>best: best=s; v=u
    A=rend(p,idx,**v); F=ImageFont.truetype(p,v['c']*SS,index=idx)
    res.append(dict(fonte=nome,cos=round(best,4),tinta_rel=round(float(A.sum()/T.sum()),3),corpo=v['c'],larg_l1=round(F.getlength(L1)/SS,1),larg_l2=round(F.getlength(L2)/SS,1),**{k:v[k] for k in ('by','dl','cx1','cx2')}))
res.sort(key=lambda x:-x['cos'])
out=sys.argv[2]; json.dump(res,open(out+'/fontes.json','w'),ensure_ascii=False,indent=0)
[print(r['fonte'],r['cos'],r['tinta_rel'],r['corpo'],r['larg_l1'],r['larg_l2']) for r in res]
# folha: original e melhores
rows=[cv2.resize(fs[80][525:607,30:450],None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC)]
hel=[r for r in res if 'Helvetica' in r['fonte']]; abertas=[r for r in res if 'Helvetica' not in r['fonte']][:5]
tel=cv2.inpaint(fs[80],cv2.dilate((cv2.resize(((np.min(np.stack(g),0)>205).astype(np.uint8)),(420,82))),np.ones((7,7),np.uint8))*0+0,1,cv2.INPAINT_TELEA) if False else None
for r in hel+abertas:
    p=[c for c in CAND if c[0]==r['fonte']][0]; A=rend(p[1],p[2],r['corpo'],r['by'],r['dl'],r['cx1'],r['cx2'])
    o=np.zeros((82,420,3),np.uint8)+30; o=(o*(1-A[...,None])+255*A[...,None]).astype(np.uint8); o=cv2.resize(o,None,fx=2,fy=2,interpolation=cv2.INTER_CUBIC)
    cv2.putText(o,f"{r['fonte'][:26]} cos {r['cos']:.3f}",(6,14),cv2.FONT_HERSHEY_SIMPLEX,.42,(0,255,255),1,cv2.LINE_AA); rows.append(o)
cv2.imwrite(out+'/fontes-folha.png',np.vstack(rows))
# emoji recortado do próprio quadro
ex0,ey0,ex1,ey1=352,566,392,597
st=np.stack([f[ey0:ey1,ex0:ex1] for f in fs]).astype(np.float32); med=np.median(st,0); sd=st.std(0).mean(2)
alfa=np.clip((14-sd)/8,0,1); alfa=cv2.GaussianBlur(alfa,(0,0),.5)
ml=(sd<14).astype(np.uint8); n,lab,stats,_=cv2.connectedComponentsWithStats(ml,8)
erros=[]
for i in range(0,161,8):
    fr=fs[i][ey0:ey1,ex0:ex1].astype(np.float32); bg=fr  # reconstrução no mesmo lugar: mediana sobre o próprio quadro limpo por TELEA
    m=(alfa>.05).astype(np.uint8)*255; pl=cv2.inpaint(fs[i][ey0:ey1,ex0:ex1],m,3,cv2.INPAINT_TELEA).astype(np.float32)
    rec=pl*(1-alfa[...,None])+med*alfa[...,None]; e=((rec-fr)**2).mean(); erros.append(10*np.log10(255**2/max(e,1e-3)))
print('emoji recorte: PSNR na caixa, mediana %.1f min %.1f; px alfa>.5 %d; sd fundo p50 %.1f'%(np.median(erros),min(erros),int((alfa>.5).sum()),np.median(sd)))
json.dump(dict(psnr_mediana=float(np.median(erros)),psnr_min=float(min(erros)),px=int((alfa>.5).sum())),open(out+'/emoji.json','w'))
vis=[]
for i in (0,40,80,120,160):
    fr=fs[i][ey0:ey1,ex0:ex1].astype(np.float32); m=(alfa>.05).astype(np.uint8)*255; pl=cv2.inpaint(fs[i][ey0:ey1,ex0:ex1],m,3,cv2.INPAINT_TELEA).astype(np.float32)
    rec=pl*(1-alfa[...,None])+med*alfa[...,None]; vis.append(np.hstack([fr,rec,alfa[...,None].repeat(3,2)*255]))
cv2.imwrite(out+'/emoji-recorte.png',cv2.resize(np.vstack(vis).clip(0,255).astype(np.uint8),None,fx=4,fy=4,interpolation=cv2.INTER_NEAREST))
