import sys,subprocess,numpy as np,cv2
# Onde a diferença mora: |Lambda - local| em buracos × fora deles, na placa
sys.path.insert(0,'scripts'); from comparar import fr
A,B,mz,y0,y1=sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]),int(sys.argv[5])
W,H=[int(x) for x in subprocess.check_output(["ffprobe","-v","error","-select_streams","v","-show_entries","stream=width,height","-of","csv=p=0",A]).decode().strip().split(",")[:2]]
M=np.load(mz,allow_pickle=True)["masks"]; Hb=y1-y0; d=[];f=[]; pio=[]
for t,(a,b) in enumerate(zip(fr(A,W,H),fr(B,W,H))):
    m=np.unpackbits(np.asarray(M[t],np.uint8))[:Hb*W].reshape(Hb,W).astype(bool)
    e=((a[y0:y1].astype(np.float32)-b[y0:y1].astype(np.float32))**2).mean(2)
    if m.sum()>50: d.append(e[m].mean()); f.append(e[~m].mean()); pio.append(t)
p=lambda x:10*np.log10(255**2/np.maximum(np.array(x),1e-3)); pd=p(d); pf=p(f)
print("placa PSNR no buraco mediana %.1f p5 %.1f min %.1f | fora do buraco mediana %.1f"%(np.median(pd),np.percentile(pd,5),pd.min(),np.median(pf)),"piores no buraco",[pio[i] for i in np.argsort(pd)[:6]])
