#!/usr/bin/env python3
"""Mede o intervalo e a máscara da headline no original (molde tiktok-followcatch/montar.py medir())."""
import cv2, numpy as np, sys, json
ORIG=sys.argv[1]; OUT=sys.argv[2]
ROI=(30,525,450,607); BR=205
cap=cv2.VideoCapture(ORIG); fr=[]
while True:
    ok,f=cap.read()
    if not ok: break
    fr.append(f)
n=len(fr); x0,y0,x1,y1=ROI
g=[cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY) for f in fr]
semente=np.min(np.stack(g[30:120]),0)>BR
print('n',n,'semente',semente.sum())
cob=[(g[i][semente]>BR).mean() for i in range(n)]
print('cob', ' '.join(f'{i}:{cob[i]:.2f}' for i in list(range(0,6))+list(range(150,172))))
sem=60; ini=sem
while ini>0 and cob[ini-1]>0.8: ini-=1
fim=sem
while fim<n-1 and cob[fim+1]>0.8: fim+=1
print('ini',ini,'fim',fim,ini/30,(fim+1)/30)
mask=np.min(np.stack(g[ini:fim+1]),0)>BR
ys,xs=np.where(mask); print('px',mask.sum(),'bbox',x0+xs.min(),y0+ys.min(),x0+xs.max(),y0+ys.max())
print('densidade linha',[(y0+i,int(v)) for i,v in enumerate(mask.sum(1))])
c=np.zeros_like(mask,dtype=np.uint8)
# colunas
col=mask.sum(0); print('colunas ocupadas', x0+np.where(col>0)[0].min(), x0+np.where(col>0)[0].max())
# diferença entre quadros (cortes)
th=[cv2.resize(cv2.cvtColor(f,cv2.COLOR_BGR2GRAY),(58,104)).astype(np.int16) for f in fr]
d=[np.abs(th[i]-th[i-1]).mean() for i in range(1,n)]
print('cortes',[ (i+1,round(v,1)) for i,v in enumerate(d) if v>12])
med=np.median(np.stack([f[y0:y1,x0:x1] for f in fr[ini:fim+1:3]]),0).astype(np.uint8)
cv2.imwrite(OUT+'/mediana-headline.png',cv2.resize(med,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST))
cv2.imwrite(OUT+'/mascara-claro.png',cv2.resize(mask.astype(np.uint8)*255,None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST))
for i in (0,1,2,ini,fim-1,fim,fim+1,fim+2,163):
    cv2.imwrite(f'{OUT}/z-{i}.png',cv2.resize(fr[i][500:700],None,fx=2,fy=2,interpolation=cv2.INTER_NEAREST))
