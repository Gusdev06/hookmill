import numpy as np, cv2, sys, subprocess
v=sys.argv[1]; d=np.load(f"d{v}.npz",allow_pickle=True); y0,y1,W,H=int(d["y0"]),int(d["y1"]),int(d["W"]),int(d["H"])
cap=cv2.VideoCapture(f"v{v}.mp4"); rows=[]
for s in d["segs"]:
    cap.set(cv2.CAP_PROP_POS_FRAMES,(s["ini"]+s["fim"])//2); ok,f=cap.read(); c=f[y0:y1].copy()
    if not s["vazio"]: c2=c.copy(); c2[s["est"]]=(0,0,255); c=np.hstack([c,c2])
    else: c=np.hstack([c,c*0])
    cv2.putText(c,f'{s["ini"]}-{s["fim"]}',(5,15),0,0.5,(0,255,0),1); rows.append(c)
n=len(rows); half=(n+1)//2
L=np.vstack(rows[:half]); R=np.vstack(rows[half:]+[rows[0]*0]*(half-(n-half)))
cv2.imwrite(f"dbg{v}.jpg",np.hstack([L,R]))
