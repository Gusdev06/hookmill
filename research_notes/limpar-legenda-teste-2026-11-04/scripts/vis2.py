import sys,json,numpy as np,cv2
from leg import *
from PIL import Image
v=sys.argv[1]; E=json.load(open(f"estilo{v}.json"))
D=np.load(f"d{v}.npz",allow_pickle=True); y0,y1,W=int(D["y0"]),int(D["y1"]),int(D["W"]); Hb=y1-y0
ws=palavras_whisper(f"w{v}.json"); cap=cv2.VideoCapture(f"v{v}.mp4"); rows=[]
segs=[s for s in D["segs"] if not s["vazio"] and s["fim"]-s["ini"]>8]
for s in segs[int(sys.argv[2]):int(sys.argv[2])+4]:
    pal=[w["w"] for w in palavras_do_trecho(ws,s["ini"]/30,s["fim"]/30,E["delta"])]
    ys,xs=np.where(s["est"]); cx=(xs.max()+xs.min())/2; base=ys.max()+1
    cap.set(cv2.CAP_PROP_POS_FRAMES,(s["ini"]+s["fim"])//2); ok,f=cap.read(); c=f[y0:y1]
    im=render(W,Hb,pal,E,cx,base,cores=[E["branco"]]*len(pal))
    g=Image.fromarray(np.full((Hb,W,3),128,np.uint8)).convert("RGBA"); g.alpha_composite(im); g=cv2.cvtColor(np.array(g.convert("RGB")),cv2.COLOR_RGB2BGR)
    r0=max(0,ys.min()-25); r1=ys.max()+25
    rows.append(np.hstack([c[r0:r1],g[r0:r1]]))
out=np.vstack(rows); cv2.imwrite(f"vis2_{v}.png",cv2.resize(out,None,fx=1.4,fy=1.4))
