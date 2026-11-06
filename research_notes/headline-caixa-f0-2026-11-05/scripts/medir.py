import sys,json,subprocess,time,numpy as np,cv2
def dec(path,w,h,box,ss=None,n=None,fps=None):
    x,y,bw,bh=box
    vf=f"crop={bw}:{bh}:{x}:{y}"
    if fps: vf=f"fps={fps},"+vf
    cmd=["ffmpeg","-v","error"]+(["-ss",str(ss)] if ss is not None else [])+["-i",path]+(["-frames:v",str(n)] if n else [])+["-vf",vf,"-f","rawvideo","-pix_fmt","bgr24","-"]
    p=subprocess.Popen(cmd,stdout=subprocess.PIPE);sz=bw*bh*3
    while True:
        b=p.stdout.read(sz)
        if len(b)<sz:break
        yield np.frombuffer(b,np.uint8).reshape(bh,bw,3)
def medir(nome,path,box,W,H):
    t0=time.time()
    # 1. intervalo: 2 amostras/s na caixa: cor mediana e fracao de pixels perto dela
    am=[]
    for f in dec(path,W,H,box,fps=2):
        m=np.median(f.reshape(-1,3),0);d=np.abs(f.astype(np.int16)-m).mean(2);am.append((m,float((d<24).mean())))
    # ancora: amostra mais "chapada" no inicio; corrida contigua de cor proxima
    fr=np.array([a[1] for a in am]);cor=np.array([a[0] for a in am])
    a=2
    ref=cor[a];i=a
    ok=lambda k: fr[k]>0.4 and np.abs(cor[k]-ref).mean()<20
    s=a
    while s>0 and ok(s-1):s-=1
    e=a
    while e<len(fr)-1 and ok(e+1):e+=1
    # refina fim por quadro
    ini=max(0,(e)/2-0.2)
    fim=None;k=0
    for f in dec(path,W,H,box,ss=ini,n=60):
        m=np.median(f.reshape(-1,3),0)
        if np.abs(m-ref).mean()>=20: fim=int(round(ini*30))+k;break
        k+=1
    if fim is None: fim=int(round(ini*30))+k
    t1=time.time()
    # 2. todos os quadros do trecho
    fs=[f for f in dec(path,W,H,box,n=fim)]
    A=np.array(fs,dtype=np.uint8);med=np.median(A,0).astype(np.uint8)
    mn=A.min(0);mx=A.max(0)
    # fundo por linha (mediana) e mascara de letra por distancia ao fundo
    k=min(med.shape[0]|1,101)
    bgl=cv2.medianBlur(med,k)
    dist=np.abs(med.astype(np.int16)-bgl.astype(np.int16)).mean(2)
    letra=(dist>40)
    # 3. temporal: desvio do fundo fora da letra (dilatada) vs chapado medido
    fundo=cv2.dilate(letra.astype(np.uint8),np.ones((9,9),np.uint8))==0
    flat=cv2.GaussianBlur(med.astype(np.float32)*fundo[...,None],(0,0),18)/np.maximum(cv2.GaussianBlur(fundo.astype(np.float32),(0,0),18),1e-3)[...,None]
    rm=[];p99=[]
    idx=np.linspace(0,len(fs)-1,min(40,len(fs))).astype(int)
    for i in idx:
        d=(A[i].astype(np.float32)-flat)[fundo]
        rm.append(float(np.sqrt((d**2).mean())));p99.append(float(np.percentile(np.abs(d),99)))
    tv=np.abs(A[idx].astype(np.float32)-med[None].astype(np.float32)).mean(3)
    # 4. linhas por projecao
    prj=letra.sum(1);lim=max(3,0.01*letra.shape[1])
    runs=[];y=0
    while y<len(prj):
        if prj[y]>lim:
            a0=y
            while y<len(prj) and prj[y]>lim:y+=1
            runs.append((a0,y))
        y+=1
    # sublinhado: linhas de pixel com corrida horizontal >= 8x sua espessura e altura pequena
    ul=[]
    n,lab,st,_=cv2.connectedComponentsWithStats(letra.astype(np.uint8),8)
    for i in range(1,n):
        x_,y_,w_,h_,ar=st[i]
        if w_>=40 and h_<=10 and ar>0.7*w_*h_: ul.append((int(x_),int(y_),int(w_),int(h_)))
    linhas=[]
    for a0,b0 in runs:
        cols=np.where(letra[a0:b0].any(0))[0]
        linhas.append(dict(y0=int(a0),y1=int(b0),x0=int(cols.min()),x1=int(cols.max())))
    core=cv2.erode(letra.astype(np.uint8),np.ones((3,3),np.uint8))>0
    cortexto=np.median(med[core],0)[::-1].astype(int).tolist() if core.any() else None
    corfundo=np.median(med[fundo],0)[::-1].astype(int).tolist()
    colsrow=np.median(med[fundo].reshape(-1,3),0)
    # gradiente: variacao por linha e por coluna do fundo
    g=cv2.GaussianBlur(med.astype(np.float32)*fundo[...,None],(0,0),8)/np.maximum(cv2.GaussianBlur(fundo.astype(np.float32),(0,0),8),1e-3)[...,None]
    out=dict(nome=nome,fim_quadro=fim,seg=round(fim/30,2),n=len(fs),t_intervalo=round(t1-t0,1),t_tudo=round(time.time()-t0,1),
      rms_contra_chapado_med=round(float(np.median(rm)),2),rms_max=round(max(rm),2),p99_med=round(float(np.median(p99)),1),p99_max=round(max(p99),1),
      desvio_temporal_medio=round(float(tv[:,fundo].mean()),2),desvio_temporal_p99=round(float(np.percentile(tv[:,fundo],99)),1),
      grad_v=round(float(np.abs(np.diff(g.mean(1),axis=0)).sum(0).max()),1),grad_h=round(float(np.abs(np.diff(g.mean(0),axis=0)).sum(0).max()),1),
      corfundo=corfundo,cortexto=cortexto,linhas=linhas,sublinhados=ul)
    np.save(f"{nome}.npy",dict(med=med,letra=letra,box=box),allow_pickle=True)
    cv2.imwrite(f"{nome}-med.png",med);cv2.imwrite(f"{nome}-letra.png",letra.astype(np.uint8)*255)
    print(json.dumps(out,ensure_ascii=False))
M="/Users/gustagoat/Documents/AIS-OS/projects/reino-del-amor-swipe/criativos-concorrente/midia/"
for a in sys.argv[1:]:
    n,p,x,y,w,h,W,H=a.split(',');medir(n,p,(int(x),int(y),int(w),int(h)),int(W),int(H))
