#!/usr/bin/env python3
"""Emoji recortado do quadro: máscara = diferente do fundo em volta, preenchida. Rodar de research_notes/headline-refeita-2026-11-05/."""
import cv2,numpy as np,subprocess,json,sys
W,H=464,832
d=subprocess.Popen(['ffmpeg','-v','error','-i','origem/original.mp4','-frames:v','161','-vf','scale=in_color_matrix=bt709:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24','-f','rawvideo','-pix_fmt','bgr24','-'],stdout=subprocess.PIPE)
fs=[]
while True:
    b=d.stdout.read(W*H*3)
    if len(b)<W*H*3:break
    fs.append(np.frombuffer(b,np.uint8).reshape(H,W,3))
ex0,ey0,ex1,ey1=352,566,392,597
st=np.stack([f[ey0:ey1,ex0:ex1] for f in fs]).astype(np.float32); med=np.median(st,0)
anel=np.ones(med.shape[:2],bool); anel[3:-3,3:-3]=False; bg=np.median(med[anel],0)
dif=np.abs(med-bg).mean(2); m=(dif>45).astype(np.uint8)
m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
# preenche buracos
fl=m.copy(); fl=cv2.copyMakeBorder(fl,1,1,1,1,cv2.BORDER_CONSTANT,value=0); mm=np.zeros((fl.shape[0]+2,fl.shape[1]+2),np.uint8); cv2.floodFill(fl,mm,(0,0),2); m=(fl[1:-1,1:-1]!=2).astype(np.uint8)
alfa=cv2.GaussianBlur(m.astype(np.float32),(0,0),.7)
er=[];vis=[]
ma=(cv2.dilate(m,np.ones((3,3),np.uint8))*255)
for i in range(0,161,4):
    fr=fs[i][ey0:ey1,ex0:ex1]; pl=cv2.inpaint(fr,ma,3,cv2.INPAINT_TELEA).astype(np.float32)
    rec=pl*(1-alfa[...,None])+med*alfa[...,None]; e=((rec-fr)**2).mean(); er.append(10*np.log10(255**2/max(e,1e-3)))
    if i in (0,40,80,120,160): vis.append(np.hstack([fr,rec,alfa[...,None].repeat(3,2)*255]))
print('PSNR caixa do emoji: mediana %.1f min %.1f; px %d'%(np.median(er),min(er),int(m.sum())))
json.dump(dict(psnr_mediana=round(float(np.median(er)),1),psnr_min=round(float(min(er)),1),px=int(m.sum())),open(sys.argv[1]+'/emoji.json','w'))
cv2.imwrite(sys.argv[1]+'/emoji-recorte.png',cv2.resize(np.vstack(vis).clip(0,255).astype(np.uint8),None,fx=4,fy=4,interpolation=cv2.INTER_NEAREST))
