import subprocess,time,numpy as np,cv2,io
from PIL import Image
M="/Users/gustagoat/Documents/AIS-OS/projects/reino-del-amor-swipe/criativos-concorrente/midia/"
def dec(path,box,n):
    x,y,w,h=box
    p=subprocess.Popen(["ffmpeg","-v","error","-i",path,"-frames:v",str(n),"-vf",f"crop={w}:{h}:{x}:{y}","-f","rawvideo","-pix_fmt","bgr24","-"],stdout=subprocess.PIPE)
    out=[]
    while True:
        b=p.stdout.read(w*h*3)
        if len(b)<w*h*3:break
        out.append(np.frombuffer(b,np.uint8).reshape(h,w,3))
    return out
for nome,path,box,n in (("v02",M+"02-1985335258774350-0.mp4",(0,0,716,244),198),("v06",M+"06-1801003027708969-0.mp4",(0,530,480,128),335)):
    t=time.time();A=dec(path,box,n);H,W=A[0].shape[:2]
    let=cv2.imread(f"{nome}-letra.png",0)>0
    med=np.median(np.array(A[::max(1,n//60)]),0).astype(np.uint8)
    fundo=(cv2.dilate(let.astype(np.uint8),np.ones((9,9),np.uint8))==0).astype(np.float32)
    # placa estatica = conv normalizada, reduzida a 1/8, PNG
    den=cv2.GaussianBlur(fundo,(0,0),18);lisa=cv2.GaussianBlur(med.astype(np.float32)*fundo[...,None],(0,0),18)/np.maximum(den,1e-4)[...,None]
    sw,sh=max(8,W//8),max(4,H//8);peq=cv2.resize(lisa,(sw,sh),interpolation=cv2.INTER_AREA).clip(0,255).astype(np.uint8)
    b=io.BytesIO();Image.fromarray(peq[...,::-1]).save(b,'PNG',optimize=True);png=len(b.getvalue())
    volta=cv2.resize(peq,(W,H),interpolation=cv2.INTER_CUBIC)
    t1=time.time()-t
    # por quadro (metodo B) x estatica, fora da letra
    dif=[];fr={}
    for i,f in enumerate(A):
        if i%10:continue
        pq=cv2.GaussianBlur(f.astype(np.float32)*fundo[...,None],(0,0),18)/np.maximum(den,1e-4)[...,None]
        d=np.abs(pq-volta.astype(np.float32)).mean(2);dif.append((float(d.mean()),float(np.percentile(d,99))))
    d=np.array(dif)
    print(nome,'placa',sw,'x',sh,'png bytes',png,'base64',int(png*4/3),'t',round(t1,1),'dif_estatica_vs_por_quadro media',round(d[:,0].mean(),2),'max media',round(d[:,0].max(),2),'p99 max',round(d[:,1].max(),1))
    ids=[int(n*.1),int(n*.5),int(n*.95)]
    painel=[]
    for i in ids:
        pq=np.clip(cv2.GaussianBlur(A[i].astype(np.float32)*fundo[...,None],(0,0),18)/np.maximum(den,1e-4)[...,None],0,255).astype(np.uint8)
        painel.append(np.vstack([A[i],pq,volta]))
    cv2.imwrite(f"{nome}-placa-painel.png",cv2.resize(np.hstack(painel),None,fx=0.6,fy=0.6))
    # removelogo no trecho (ffmpeg puro)
    cv2.imwrite(f"{nome}-mask.png",(fundo==0).astype(np.uint8)*255)
    t=time.time()
    r=subprocess.run(["ffmpeg","-v","error","-y","-i",path,"-i",f"{nome}-mask.png","-frames:v",str(n),"-filter_complex",f"[0:v]crop={W}:{H}:{box[0]}:{box[1]},format=yuv420p[c];[c]removelogo={nome}-mask.png,gblur=sigma=6[o]","-map","[o]","-c:v","libx264","-preset","veryfast","-crf","16",f"{nome}-rl.mp4"],capture_output=True,text=True)
    print(' removelogo',round(time.time()-t,1),'s',r.stderr[:200])
