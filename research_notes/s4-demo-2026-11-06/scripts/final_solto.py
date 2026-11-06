#!/usr/bin/env python3
import json, cv2, numpy as np, sys
from comum import *; from compor import compor
W,H=464,832
Y=int(sys.argv[1]) if len(sys.argv)>1 else 0
jobs=json.load(open(P("medidas/jobs-solto.json"))); END=json.load(open(P("medidas/placa-solta.json")))["endFrame"]
PL=P("remotion/public/midia/placa-solta.mp4"); OR=P("origem/original.mp4")
pl80=next(frames(PL,W,H,ini=80,n=1,mat="bt709"))
out={}
for j in jobs:
    mudo=P(j["saida"]); fim=mudo.replace("-mudo","" if not Y else "-y")
    f=next(frames(mudo,W,H,ini=80,n=1,mat="bt709"))
    d=np.abs(f.astype(int)-pl80.astype(int)).max(2)>30
    ys,xs=np.where(d); ys2=ys[(ys>480)&(ys<620)]; xs2=xs[(ys>480)&(ys<620)]; xs2=xs2[(xs2>=np.percentile(xs2,.5)-3)&(xs2<=np.percentile(xs2,99.5)+3)]
    x0,y0,x1,y1=max(0,xs2.min()-6),max(0,ys2.min()-6),min(W,xs2.max()+7),min(H,ys2.max()+7)
    compor(mudo,PL,OR,W,H,564,[(x0,y0,x1-x0,y1-y0,0,END)],fim,y_mais=Y)
    out[j["nome"]]=dict(area=[int(x0),int(y0),int(x1-x0),int(y1-y0)])
    print(j["nome"],out[j["nome"]])
json.dump(out,open(P("medidas/areas-solto.json"),"w"),indent=1)
