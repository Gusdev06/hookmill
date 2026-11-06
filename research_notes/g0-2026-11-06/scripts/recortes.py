"""Recupera, dos PNG da S4, os recortes nativos: original e prova do Mac (Chrome headless shell mac-arm64, depois do x264 e da
composição). Zoom por vizinho mais próximo é reversível. Acha a origem de cada recorte por casamento de modelo."""
import cv2, numpy as np, json, os
from separar import paineis
Q=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../s4-demo-2026-11-06/quadros/'); OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../ref/')
R={}
# solto: 2 linhas (quadros) x 2 colunas (original | prova mesmas palavras, Mac), zoom 3
im=cv2.imread(Q+'solto-prova-originais.png'); cs,rs=paineis(im)
real=cv2.imread(Q+'solto-real.png'); orig_full=real[:, 0:464]
cv2.imwrite(OUT+'solto-original-quadro.png', orig_full)
z=3
for ri,(r0,r1) in enumerate(rs):
    for ci,(c0,c1) in enumerate(cs):
        p=im[r0:r1,c0:c1]; n=p[1::z,1::z]
        assert n.shape[0]*z==p.shape[0] and n.shape[1]*z==p.shape[1], n.shape
        nome=['original','mac'][ci]; cv2.imwrite(OUT+f'solto-{nome}-q{ri}.png', n)
n0=cv2.imread(OUT+'solto-original-q0.png')
# origem do recorte: casa o texto (topo/esq) no quadro inteiro do original
res=cv2.matchTemplate(orig_full, n0, cv2.TM_SQDIFF_NORMED); mn,_,loc,_=cv2.minMaxLoc(res)
R['solto']=dict(roi=[int(loc[0]),int(loc[1]),int(loc[0]+n0.shape[1]),int(loc[1]+n0.shape[0])], match=round(float(mn),4), zoom=z)
for v,box in (('02',[0,0,716,246]),('05',[0,586,628,220]),('06',[0,529,481,130])):
    im=cv2.imread(Q+f'caixa-{v}-prova.png'); cs,rs=paineis(im); med=cv2.imread(Q+f'caixa-{v}-med.png')
    r0,r1=rs[0]; p0=im[r0:r1,cs[0][0]:cs[0][1]]
    res=cv2.matchTemplate(p0, med, cv2.TM_SQDIFF_NORMED); mn,_,loc,_=cv2.minMaxLoc(res)
    dx,dy=loc; R[v]=dict(box=box, painel_off=[int(dx),int(dy)], match=round(float(mn),4), colunas=len(cs))
    for ci,(c0,c1) in enumerate(cs):
        cv2.imwrite(OUT+f'caixa-{v}-col{ci}.png', im[r0:r1,c0:c1][dy:dy+box[3], dx:dx+box[2]])
    cv2.imwrite(OUT+f'caixa-{v}-med.png', med)
json.dump(R, open(OUT+'recortes.json','w'), indent=1); print(json.dumps(R))
