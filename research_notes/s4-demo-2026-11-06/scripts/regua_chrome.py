#!/usr/bin/env python3
"""Régua §15.7.3 no motor do render: cos e tinta da prova com as palavras originais, Chrome × Pillow, com ajuste de corpo. Larguras reais em Chrome (por pixel)."""
import cv2, numpy as np, json
from PIL import ImageFont
from comum import *
W,H=464,832; x0,y0,x1,y1=30,525,450,607
OR=P("origem/original.mp4"); fs=list(frames(OR,W,H,n=161,mat="bt709"))
g=[cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY) for f in fs]
mn=np.min(np.stack(g),0).astype(np.float32); T=np.clip((mn-110)/(235-110),0,1); T[:,356-x0:]=0
ex=lambda p,i:cv2.cvtColor(next(frames(p,W,H,ini=i,n=1,mat="bt709")),cv2.COLOR_BGR2GRAY)[y0:y1,x0:x1].astype(np.float32)
import sys
p=P("saida/solto/prova-originais-mudo.mp4")
fsS=[cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY) for f in frames(p,W,H,mat="bt709")]
mS=np.min(np.stack(fsS),0).astype(np.float32); A=np.clip((mS-110)/(235-110),0,1); A[:,356-x0:]=0
cos=float(np.corrcoef(A.ravel(),T.ravel())[0,1])
print("cos prova Chrome Arimo600 26.75 (pela mesma medida do min dos quadros):",round(cos,4),"tinta",round(float(A.sum()/T.sum()),3))
def linhas(M,lim=.5):
    prj=(M>lim).sum(1); out=[]; y=0
    while y<len(prj):
        if prj[y]>2:
            a=y
            while y<len(prj) and prj[y]>2:y+=1
            c=np.where((M[a:y]>lim).any(0))[0]; out.append((a+y0,y+y0,int(c.min()+x0),int(c.max()+x0)))
        y+=1
    return out
print("original linhas",linhas(T)); print("chrome linhas",linhas(A))
F=ImageFont.truetype(P("remotion/public/fonts/arimo-600.woff"),26.75*4)
H_=ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc",26.75*4,index=10)
for t in ("How to view your man’s","recent following on IG","Tired of scrolling his","endless following list?"):
    print(t,"Arimo Pillow",round(F.getlength(t)/4,1),"Helvetica Pillow",round(H_.getlength(t)/4,1))
# larguras por pixel nas peças finais
for nome,p in (("aprovada",P("origem/aprovada.mp4")),("servidor",P("saida/solto/aprovada.mp4"))):
    fx=[cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY) for f in frames(p,W,H,n=161,mat="bt709")]
    M=np.clip((np.min(np.stack(fx),0).astype(np.float32)-110)/125,0,1); print(nome,linhas(M))
