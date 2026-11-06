#!/usr/bin/env python3
"""05: Montserrat 500 dá linhas ±5 %. Busca aberta em fontes OFL do scratchpad + @fontsource do repo, só por largura de linha e traço, depois cos."""
import cv2, glob, json, numpy as np, os, sys
from PIL import Image, ImageDraw, ImageFont
from comum import *
S=sys.argv[1]
fp=sorted(glob.glob(S+"/f1b/gf/*.woff2"))+sorted(glob.glob(S+"/fontes/*.woff"))
med=cv2.imread(P("quadros/caixa-05-med.png")); BH,BW=med.shape[:2]
bg=cv2.medianBlur(med,101).astype(np.float32); core=np.abs(med.astype(np.float32)-bg).mean(2)>40
tx=np.median(med[cv2.erode(core.astype(np.uint8),np.ones((3,3),np.uint8))>0],0).astype(np.float32); v=tx-bg
al=np.clip(((med.astype(np.float32)-bg)*v).sum(2)/np.maximum((v*v).sum(2),1),0,1)
L=["If he doesn't call you","within two minutes,","I’ll pay you $50"]; W0=[580,548,431]; Y=[25+45,85+45,143+45]
def stem(a):
    m=(a>.5).astype(np.uint8); dt=cv2.distanceTransform(m,cv2.DIST_L2,3); return 2*float(np.percentile(dt[dt>0],90))
res=[]
for p in fp:
    try: f=ImageFont.truetype(p,100)
    except Exception: continue
    wr=[f.getlength(l)/100 for l in L]
    sz=float(np.median([w/r for w,r in zip(W0,wr)])); err=max(abs(sz*r/w-1) for r,w in zip(wr,W0))
    if err>.035: continue
    F=ImageFont.truetype(p,sz*2); best=-1;be=None
    for by in np.arange(64,74,1):
      for dl in (58,58.5,59,59.5,60):
        im=Image.new('L',(BW*2,BH*2),0); d=ImageDraw.Draw(im)
        for i,(l,cx) in enumerate(zip(L,(314,313,314.5))): d.text((cx*2,(by+i*dl)*2),l,font=F,fill=255,anchor='ms')
        a=cv2.GaussianBlur(cv2.resize(np.array(im,np.float32)/255,(BW,BH),interpolation=cv2.INTER_AREA),(0,0),.6)
        c=float(np.corrcoef(a.ravel(),al.ravel())[0,1])
        if c>best: best=c;be=(float(by),dl,a)
    res.append(dict(f=os.path.basename(p),sz=round(sz,1),err=round(err,3),cos=round(best,3),traco=round(stem(be[2]),2),by=be[0],dl=be[1]))
res.sort(key=lambda r:-r["cos"])
for r in res[:14]: print(r)
print("traço alvo",round(stem(al),2),"testadas",len(fp),"passaram largura",len(res))
