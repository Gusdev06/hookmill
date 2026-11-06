import sys,json,numpy as np,cv2
from leg import *
v=sys.argv[1]; E=json.load(open(f"estilo{v}.json"))
D=np.load(f"d{v}.npz",allow_pickle=True); y0,y1,W=int(D["y0"]),int(D["y1"]),int(D["W"]); Hb=y1-y0
ws=palavras_whisper(f"w{v}.json"); rows=[]
for s in [s for s in D["segs"] if not s["vazio"]][:12]:
    pal=[w["w"] for w in palavras_do_trecho(ws,s["ini"]/30,s["fim"]/30,E["delta"])]
    if not pal or s["bbox"] is None: continue
    ys,xs=np.where(s["est"]); cx=(xs.max()+xs.min())/2; base=ys.max()+1
    m=np.array(render(W,Hb,pal,E,cx,base,so_miolo=True))[...,3]>127
    vis=np.zeros((Hb,W,3),np.uint8); vis[s["est"]]=(0,0,255); vis[m]=vis[m]+np.array([255,0,0],np.uint8)
    r0=max(0,ys.min()-10); rows.append(vis[r0:ys.max()+10])
cv2.imwrite(f"vis{v}.png",np.vstack(rows))
