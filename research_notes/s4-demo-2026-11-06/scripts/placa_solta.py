#!/usr/bin/env python3
"""S4 headline solta, versão de servidor: máscara SEM Helvetica (letras antigas redesenhadas em Arimo 600) + TELEA r5 só no intervalo. Emoji recortado do próprio quadro (§15.7.2)."""
import cv2, numpy as np, json, base64, sys, time
from PIL import Image, ImageDraw, ImageFont
from comum import *
ORIG=P("origem/original.mp4"); W,H=464,832
ROI=(30,525,450,607); BRILHO=205; SEM=60; EMOJI_RET=(354,568,392,597); DIL=7; SS=4
ARIMO=P("remotion/public/fonts/arimo-600.woff")
CORPO,BY,DL,CX1,CX2=26.75,557.25,33.25,233.5,216.75   # fontes.json, arimo-600
L1,L2="How to view your man’s","recent following on IG"
t0=time.time(); x0,y0,x1,y1=ROI
fs=list(frames(ORIG,W,H,mat="bt709")); n=len(fs)
rois=[cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY) for f in fs]
molde=np.min(np.stack(rois[30:120]),0)>BRILHO
cob=lambda i:(rois[i][molde]>BRILHO).mean()
ini=SEM
while ini>0 and cob(ini-1)>.8: ini-=1
fim=SEM
while fim<n-1 and cob(fim+1)>.8: fim+=1
m=np.min(np.stack(rois[ini:fim+1]),0)>BRILHO
full=np.zeros((H,W),np.uint8); full[y0:y1,x0:x1]=m.astype(np.uint8)*255
a,b,c,d=EMOJI_RET; full[b:d,a:c]=255
F=ImageFont.truetype(ARIMO,CORPO*SS); im=Image.new("L",(W*SS,H*SS),0); dr=ImageDraw.Draw(im)
dr.text(((CX1-F.getlength(L1)/SS/2)*SS,BY*SS),L1,font=F,fill=255,anchor="ls"); dr.text(((CX2-F.getlength(L2)/SS/2)*SS,(BY+DL)*SS),L2,font=F,fill=255,anchor="ls")
velho=cv2.GaussianBlur(cv2.resize(np.array(im,np.float32)/255,(W,H),interpolation=cv2.INTER_AREA),(0,0),.6)
full[velho>.08]=255
inp=cv2.dilate(full,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(DIL,DIL)))
cv2.imwrite(P("medidas/mascara-solta.png"),inp)
apr=cv2.imread(P("../headline-refeita-2026-11-05/quadros/mascara.png"),0)
iou=float(((apr>0)&(inp>0)).sum()/((apr>0)|(inp>0)).sum()); so_apr=int(((apr>0)&~(inp>0)).sum()); so_ser=int(((inp>0)&~(apr>0)).sum())
# emoji
ex0,ey0,ex1,ey1=352,566,392,597
st=np.stack([f[ey0:ey1,ex0:ex1] for f in fs[ini:fim+1]]).astype(np.float32); med=np.median(st,0)
anel=np.ones(med.shape[:2],bool); anel[3:-3,3:-3]=False; bg=np.median(med[anel],0)
MODO=sys.argv[1] if len(sys.argv)>1 else "casco"
if MODO=="contrato":   # §15.7.2 ao pé da letra: come a pupila encostada na borda
    mk=(np.abs(med-bg).mean(2)>45).astype(np.uint8)
    mk=cv2.morphologyEx(mk,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
    fl=cv2.copyMakeBorder(mk,1,1,1,1,cv2.BORDER_CONSTANT,value=0); mm=np.zeros((fl.shape[0]+2,fl.shape[1]+2),np.uint8); cv2.floodFill(fl,mm,(0,0),2); mk=(fl[1:-1,1:-1]!=2).astype(np.uint8)
else:                  # casco convexo por lóbulo: a pupila escura na borda deixa de virar fundo
    base=(np.abs(med-bg).mean(2)>32).astype(np.uint8)
    nucleo=cv2.erode(base,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(3,3)))
    nl,lab=cv2.connectedComponents(nucleo,connectivity=8)
    if nl<=1: nl,lab=cv2.connectedComponents(base,connectivity=8)
    d0=[cv2.distanceTransform((lab!=k).astype(np.uint8),cv2.DIST_L2,3) for k in range(1,nl)]
    dono=np.argmin(np.stack(d0),0) if d0 else np.zeros_like(base)
    mk=np.zeros_like(base)
    for k in range(nl-1):
        pts=np.column_stack(np.where((base>0)&(dono==k)))[:,::-1]
        if len(pts)>=12: cv2.fillConvexPoly(mk,cv2.convexHull(pts.astype(np.int32)),1)
ys,xs=np.where(mk); pad=2
bx0,by0,bx1,by1=max(0,xs.min()-pad),max(0,ys.min()-pad),min(mk.shape[1],xs.max()+1+pad),min(mk.shape[0],ys.max()+1+pad)
alfa=cv2.GaussianBlur(mk.astype(np.float32),(0,0),.7 if MODO=="contrato" else .5)
rgba=np.dstack([med,alfa*255]).clip(0,255).astype(np.uint8)[by0:by1,bx0:bx1]
cv2.imwrite(P("remotion/public/midia/emoji.png"),rgba)
cortes=dict(x=int(ex0+bx0),y=int(ey0+by0),w=int(bx1-bx0),h=int(by1-by0),bbox_x0=int(ex0+xs.min()),bbox_x1=int(ex0+xs.max()),bbox_y0=int(ey0+ys.min()),bbox_y1=int(ey0+ys.max()),px=int(mk.sum()),ocupa=round(float(mk.sum()/((xs.max()-xs.min()+1)*(ys.max()-ys.min()+1))),3))
fimL2=CX2+F.getlength(L2)/SS/2
cortes["gap_arimo"]=round(float(cortes["bbox_x0"]-fimL2),2); cortes["recorte_margem_esq"]=int(cortes["bbox_x0"]-cortes["x"])
# placa
enc=encoder(P("remotion/public/midia/placa-solta.mp4"),W,H)
t1=time.time()
for i,f in enumerate(fs): enc.stdin.write((cv2.inpaint(f,inp,5,cv2.INPAINT_TELEA) if ini<=i<=fim else f).tobytes())
enc.stdin.close(); assert enc.wait()==0
json.dump(dict(quadros=n,ini=ini,fim=fim,endFrame=fim+1,px_letra=int(m.sum()),mascara_px=int((inp>0).sum()),iou_mascara_aprovada=round(iou,3),so_na_aprovada=so_apr,so_na_servidor=so_ser,emoji=cortes,seg_placa=round(time.time()-t1,1),seg_total=round(time.time()-t0,1)),open(P("medidas/placa-solta.json"),"w"),indent=1)
print(open(P("medidas/placa-solta.json")).read())
vis=cv2.resize(rgba[...,:3],None,fx=8,fy=8,interpolation=cv2.INTER_NEAREST); cv2.imwrite(P("quadros/emoji-recorte-x8.png"),vis)
