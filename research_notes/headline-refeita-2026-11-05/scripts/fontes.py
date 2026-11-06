#!/usr/bin/env python3
"""Casa a fonte: calibra o corpo pela largura medida da 1ª linha antiga e correlaciona com as letras originais."""
import cv2, numpy as np, json, glob, os
from PIL import Image, ImageDraw, ImageFont
ORIG='origem/original.mp4'; ROI=(30,525,450,607); x0,y0,x1,y1=ROI
cap=cv2.VideoCapture(ORIG); g=[]
for i in range(161):
    ok,f=cap.read(); g.append(cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY))
mn=np.min(np.stack(g),0).astype(np.float32)   # texto parado claro; o resto escurece no min
T=np.clip((mn-110)/(235-110),0,1)
L1='How to view your man’s'; L2='recent following on IG'
m=mn>205; 
def bbox(a,b,xmax=None):
    s=m[a-y0:b-y0]; c=np.where(s.sum(0)>0)[0]; 
    if xmax: c=c[c+x0<xmax]
    return x0+c.min(),x0+c.max()
b1=bbox(536,563); b2=bbox(569,596,356)
print('linha1 x',b1,'larg',b1[1]-b1[0]+1,'linha2 x (sem emoji)',b2,'larg',b2[1]-b2[0]+1)
SS=4
CAND=[]
def add(p,idx=0,var=None,nome=None): CAND.append((p,idx,var,nome or os.path.basename(p)+f'#{idx}'+(f'@{var}' if var else '')))
for i in range(0,14): add('/System/Library/Fonts/HelveticaNeue.ttc',i)
for i in range(0,6): add('/System/Library/Fonts/Helvetica.ttc',i)
add('/System/Library/Fonts/Supplemental/Arial.ttf'); add('/System/Library/Fonts/Supplemental/Arial Bold.ttf')
TT='/Users/gustagoat/Documents/AIS-OS/projects/mentoria-spy/criativos/tiktok-followcatch-2026-11-05/fontes/TikTokSans.ttf'
for w in (400,500,600,700): add(TT,0,w)
for w in (400,500,600,700): add('/System/Library/Fonts/SFNS.ttf',0,w)
S2='/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/research_notes/limpar-legenda-teste-2026-11-05-s2/scripts/fontes/'
for w in (400,500,600): 
    if os.path.exists(S2+'Manrope-Variable.ttf'): add(S2+'Manrope-Variable.ttf',0,w)
add(S2+'Inter-Bold.ttf')
for p in glob.glob('/Library/Fonts/*.ttf')+glob.glob(os.path.expanduser('~/Library/Fonts/*.ttf')):
    b=os.path.basename(p).lower()
    if any(k in b for k in ('inter','proxima','roboto','poppins','sf')): add(p)
def font(c,sz):
    p,idx,var,_=c; f=ImageFont.truetype(p,sz,index=idx)
    if var:
        ax=f.get_variation_axes(); vals=[]
        for a in ax:
            n=a['name'].decode() if isinstance(a['name'],bytes) else a['name']
            vals.append(var if 'eight' in n else a['default'])
        f.set_variation_by_axes(vals)
    return f
def render(F,t,base_ss,xc_ss):
    H,W=T.shape; im=Image.new('L',(W*SS,H*SS),0); d=ImageDraw.Draw(im); l=F.getlength(t)
    d.text((xc_ss-l/2,base_ss),t,font=F,fill=255,anchor='ls'); return im
res=[]
tgt=b1[1]-b1[0]+1
for c in CAND:
    try:
        lo,hi=40,160
        while hi-lo>1:
            mid=(lo+hi)//2
            if font(c,mid).getbbox(L1)[2]-font(c,mid).getbbox(L1)[0]<=tgt*SS: lo=mid
            else: hi=mid
        F=font(c,lo); nome=F.getname()
    except Exception as e:
        continue
    best=-1;arg=None
    cx1=(b1[0]+b1[1]+1)/2-x0; cx2=(b2[0]+b2[1]+1)/2-x0
    for by1 in np.arange(555,559,0.25):
      for dyl in (32,32.5,33,33.5,34):
        for dx in (-1,-.5,0,.5,1):
            a=render(F,L1,(by1-y0)*SS,(cx1+dx)*SS); ImageDraw.Draw(a).text(((cx2+dx)*SS-F.getlength(L2)/2,(by1+dyl-y0)*SS),L2,font=F,fill=255,anchor='ls')
            A=cv2.GaussianBlur(cv2.resize(np.array(a,np.float32)/255,(T.shape[1],T.shape[0]),interpolation=cv2.INTER_AREA),(0,0),0.5)
            mask=np.zeros_like(T,bool); mask[:, :b2[1]-x0+3]=True
            r=np.corrcoef(A[mask],T[mask])[0,1]
            if r>best: best=r;arg=(by1,dyl,dx)
    w2=F.getbbox(L2)[2]-F.getbbox(L2)[0]
    res.append((best,c[3],nome,lo/SS,arg,w2/SS))
res.sort(key=lambda x:-x[0])
for r in res[:14]: print(f'{r[0]:.4f}',r[1],r[2],'corpo',r[3],'base,dl,dx',r[4],'larg2',round(r[5],1))
