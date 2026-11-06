#!/usr/bin/env python3
"""Caixa (§14.1.1, §15.5.3): só com palavras vistas no vídeo. Mede caixa exata, letra, cor, placa 2D (1/8, PNG), corpo, entrelinha, linha de base, centro por linha, tracking, sombra."""
import cv2, numpy as np, json, base64, io, sys, time, glob, os
from PIL import Image, ImageDraw, ImageFont
from comum import *
NM=P("../../node_modules/@fontsource")
def mont(w): return f"{NM}/montserrat/files/montserrat-latin-{w}-normal.woff2"
C={
"02":dict(W=716,H=1278,N=198,roi=(0,0,716,300),orig=["Si en 2 minutos no te","busca, es porque","nunca fue para ti.."],cands={"montserrat-600":mont(600),"montserrat-500":mont(500),"montserrat-700":mont(700)},sub=[(153,159),(220,226)]),
"06":dict(W=720,H=960,N=335,roi=(0,500,540,190),orig=["Él ya está con otra? Te","propongo algo. Si en 7 días","no te busca, dime mentirosa"],cands={"montserrat-500":mont(500),"montserrat-600":mont(600)},sub=[]),
"05":dict(W=720,H=1280,N=191,roi=(0,560,680,270),orig=["If he doesn't call you","within two minutes,","I’ll pay you $50"],cands={"montserrat-500":mont(500),"montserrat-600":mont(600),"montserrat-700":mont(700)},sub=[]),
}
def fit(alvo,peso,lines,fp,lay):
    Hc,Wc=alvo.shape; SS=2
    def rend(sz,pitch,base,cxs,tr):
        f=ImageFont.truetype(fp,sz*SS); im=Image.new('L',(Wc*SS,Hc*SS),0); d=ImageDraw.Draw(im)
        for i,ln in enumerate(lines):
            w=f.getlength(ln)+tr*sz*SS*(len(ln)-1); x=cxs[i]*SS-w/2
            if tr==0: d.text((x,(base+i*pitch)*SS),ln,font=f,fill=255,anchor='ls')
            else:
                for k,ch in enumerate(ln):
                    d.text((x+f.getlength(ln[:k])+tr*sz*SS*k,(base+i*pitch)*SS),ch,font=f,fill=255,anchor='ls')
        a=cv2.resize(np.array(im,np.float32)/255,(Wc,Hc),interpolation=cv2.INTER_AREA)
        return cv2.GaussianBlur(a,(0,0),.6)*peso
    cos=lambda a:float((a*alvo).sum()/(np.sqrt((a*a).sum()*(alvo*alvo).sum())+1e-6))
    p=dict(lay); best=cos(rend(**p))
    for it in range(3):
        for k,ds in (("sz",np.arange(-3,3.01,.5)),("pitch",np.arange(-2,2.01,.5)),("base",np.arange(-10,6.01,.5)),("tr",np.arange(-.02,.0401,.005))):
            b0=p[k]
            for dv in ds:
                q=dict(p); q[k]=b0+dv
                if k=="tr": q[k]=round(float(q[k]),3)
                s=cos(rend(**q))
                if s>best: best,p=s,q
        for i in range(len(lines)):
            b0=p["cxs"][i]
            for dv in np.arange(-5,5.01,.5):
                q=dict(p); q["cxs"]=list(p["cxs"]); q["cxs"][i]=b0+dv; s=cos(rend(**q))
                if s>best: best,p=s,q
    return best,p,rend(**p)
for v,c in C.items():
    t0=time.time(); W,H,N=c["W"],c["H"],c["N"]; rx,ry,rw,rh=c["roi"]; src=P(f"origem/c{v}.mp4"); mat=matriz(src)
    A=np.stack([f[ry:ry+rh,rx:rx+rw] for f in frames(src,W,H,n=N,mat=mat)]); med=np.median(A[::max(1,N//60)],0).astype(np.uint8)
    # caixa exata: cor dominante (mediana da região central) e linhas/colunas chapadas
    cor=np.median(med[med.shape[0]//4:3*med.shape[0]//4,5:rw//2].reshape(-1,3),0)
    perto=np.abs(med.astype(np.float32)-cor).mean(2)<30 if v!="02" else (med[...,0].astype(np.float32)-med[...,2].astype(np.float32))>35
    lin=np.where(perto.mean(1)>.25)[0]; 
    # maior corrida contínua
    runs=np.split(lin,np.where(np.diff(lin)>1)[0]+1); yr=max(runs,key=len); y0,y1=int(yr[0]),int(yr[-1])+1
    col=np.where(perto[y0:y1].mean(0)>.35)[0]; runs=np.split(col,np.where(np.diff(col)>1)[0]+1); xr=max(runs,key=len); x0,x1=int(xr[0]),int(xr[-1])+1
    box=(rx+x0,ry+y0,x1-x0,y1-y0); X,Y,BW,BH=box
    B=A[:,y0:y1,x0:x1]; med=np.median(B[::max(1,N//60)],0).astype(np.uint8)
    k=min(BH|1,101); bgl=cv2.medianBlur(med,k); dist=np.abs(med.astype(np.int16)-bgl.astype(np.int16)).mean(2); letra=dist>40
    core=cv2.erode(letra.astype(np.uint8),np.ones((3,3),np.uint8))>0; bgrtxt=np.median(med[core],0)
    tx=bgrtxt.astype(np.float32); bg=bgl.astype(np.float32); vv=tx-bg
    al=np.clip(((med.astype(np.float32)-bg)*vv).sum(2)/np.maximum((vv*vv).sum(2),1),0,1)
    peso=np.ones((BH,BW),np.float32)
    for a,b in c["sub"]: peso[max(0,a-y0-1):b-y0+1]=0
    alvo=al*peso
    # dilatação: 9 (§14.1.1); com sombra, sobe até o halo sair (05)
    dil=21 if v=="05" else 9
    fundo=(cv2.dilate(letra.astype(np.uint8),np.ones((dil,dil),np.uint8))==0).astype(np.float32)
    sig=18; den=cv2.GaussianBlur(fundo,(0,0),sig,borderType=cv2.BORDER_REFLECT)
    lisa=cv2.GaussianBlur(med.astype(np.float32)*fundo[...,None],(0,0),sig,borderType=cv2.BORDER_REFLECT)/np.maximum(den,1e-4)[...,None]
    sw,sh=max(8,BW//8),max(4,BH//8); peq=cv2.resize(lisa,(sw,sh),interpolation=cv2.INTER_AREA).clip(0,255).astype(np.uint8)
    b=io.BytesIO(); Image.fromarray(peq[...,::-1]).save(b,'PNG',optimize=True); uri="data:image/png;base64,"+base64.b64encode(b.getvalue()).decode()
    # fonte
    prjs=(alvo>.5).sum(1); ls=[]; y=0
    while y<BH:
        if prjs[y]>3:
            a=y
            while y<BH and prjs[y]>3: y+=1
            ls.append((a,y))
        y+=1
    ls=[q for q in ls if q[1]-q[0]>8][:len(c["orig"])]
    cxs=[]
    for a,bb in ls:
        cc=np.where((alvo[a:bb]>.5).any(0))[0]; cxs.append((cc.min()+cc.max())/2)
    hh=ls[0][1]-ls[0][0]
    res=[]
    for nome,fp in c["cands"].items():
        f100=ImageFont.truetype(fp,100); wm=[np.where((alvo[a:bb]>.5).any(0))[0] for a,bb in ls]; sz0=float(np.median([(w.max()-w.min())/f100.getlength(l)*100 for w,l in zip(wm,c["orig"])]))
        lay=dict(sz=sz0,pitch=(ls[-1][0]-ls[0][0])/max(1,len(ls)-1),base=ls[0][1]-1.0,cxs=cxs,tr=0.0)
        s,p,a=fit(alvo,peso,c["orig"],fp,lay); res.append(dict(fonte=nome,cos=round(s,3),**p)); print(v,nome,round(s,3),p,flush=True)
    res.sort(key=lambda r:-r["cos"]); e=res[0]
    # sombra: menor erro em volta das letras
    A_=None; sombra=None
    def alfa(e):
        f=ImageFont.truetype(c["cands"][e["fonte"]],e["sz"]*2); im=Image.new('L',(BW*2,BH*2),0); d=ImageDraw.Draw(im)
        for i,ln in enumerate(c["orig"]):
            w=f.getlength(ln)+e["tr"]*e["sz"]*2*(len(ln)-1); x=e["cxs"][i]*2-w/2
            for k_,ch in enumerate(ln): d.text((x+f.getlength(ln[:k_])+e["tr"]*e["sz"]*2*k_,(e["base"]+i*e["pitch"])*2),ch,font=f,fill=255,anchor='ls')
        return cv2.resize(np.array(im,np.float32)/255,(BW,BH),interpolation=cv2.INTER_AREA)
    if v=="05":
        a=alfa(e); anel=(cv2.dilate((a>.05).astype(np.uint8),np.ones((17,17),np.uint8))>0)&(a<.02)&~(al>.2)
        L=lisa; best=(1e9,None)
        for sg in (1,1.5,2,2.5,3,4):
            for dx in (0,1,2,3,4):
                for dy in (0,1,2,3,4):
                    M=np.float32([[1,0,dx],[0,1,dy]]); s0=cv2.GaussianBlur(cv2.warpAffine(a,M,(BW,BH)),(0,0),sg)
                    for op in (.4,.55,.7,.85,1):
                        r=L*(1-s0*op)[...,None]; err=np.abs(r[anel]-med[anel]).mean()
                        if err<best[0]: best=(float(err),dict(dx=dx,dy=dy,sigma=sg,op=op))
        sombra=best[1]; print("sombra",best,flush=True)
    bgr=[int(x) for x in bgrtxt]
    json.dump(dict(video=v,W=W,H=H,N=N,mat=mat,box=box,cor_texto="#%02x%02x%02x"%(bgr[2],bgr[1],bgr[0]),placa_uri=uri,placa_bytes=len(uri),placa_px=[sw,sh],linhas_medidas=[[int(a),int(b)] for a,b in ls],fonte=res,sombra=sombra,dil=dil,seg=round(time.time()-t0,1),
        desvio_p99=round(float(np.percentile(np.abs(B[np.linspace(0,N-1,40).astype(int)].astype(np.float32)-med[None].astype(np.float32)).mean(3)[:,fundo>0],99)),1)),open(P(f"medidas/caixa-{v}.json"),"w"),indent=0)
    cv2.imwrite(P(f"quadros/caixa-{v}-med.png"),med); np.save(P(f"medidas/caixa-{v}-lisa.npy"),lisa.astype(np.float32))
    print(v,"caixa",box,"cor",bgr,"placa",sw,sh,len(uri),"bytes","t",round(time.time()-t0,1),flush=True)
