#!/usr/bin/env python3
"""§15.5.7 na peça de servidor. As letras novas/velhas usam Arimo (Pillow só p/ máscara da prova)."""
import cv2, numpy as np, json, subprocess
from PIL import Image, ImageDraw, ImageFont
from comum import *
W,H=464,832; OR=P("origem/original.mp4"); M=json.load(open(P("medidas/placa-solta.json"))); FIM=M["fim"]
def rd(p): return np.stack(list(frames(p,W,H,mat="bt709")))
def md5a(p): return subprocess.run(['ffmpeg','-v','error','-i',p,'-map','0:a','-c','copy','-f','md5','-'],capture_output=True,text=True).stdout.strip()
a=rd(OR); inp=cv2.imread(P("medidas/mascara-solta.png"),0)>0
ARI=P("remotion/public/fonts/arimo-600.woff"); SS=4
def alfa(linhas,cx,base,dl,extra=0):
    F=ImageFont.truetype(ARI,26.75*SS); im=Image.new("L",(W*SS,H*SS),0); d=ImageDraw.Draw(im)
    for i,t in enumerate(linhas):
        e=extra if i==len(linhas)-1 else 0; w=F.getlength(t)/SS
        d.text(((cx[i]-(w+e)/2)*SS,(base+i*dl)*SS),t,font=F,fill=255,anchor="ls")
    return cv2.resize(np.array(im,np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
velho=alfa(["How to view your man’s","recent following on IG"],[233.5,216.75],557.25,33.25)>.5
g=lambda x:cv2.cvtColor(x,cv2.COLOR_BGR2GRAY).astype(np.float32)
V={"aprovada":["Tired of scrolling his","endless following list?"],"longa":["Tired of scrolling his endless","following list just to find out","who he added last night?"],"longa2":["Tired of scrolling his endless list","just to see who he followed?"],"curta":["Who is he","following now?"],"minima":["Who is he following?"]}
res={}
areas=json.load(open(P("medidas/areas-solto.json")))
for k,lin in V.items():
    p=P(f"saida/solto/{k}.mp4"); b=rd(p); ar=areas[k]["area"]
    novo=np.zeros((H,W),bool); x,y,w,h=ar; novo[y:y+h,x:x+w]=True
    fora=~cv2.dilate((inp|novo).astype(np.uint8),np.ones((9,9),np.uint8)).astype(bool)
    d=np.abs(a[:FIM+1].astype(np.int16)-b[:FIM+1].astype(np.int16)).mean(3)
    d2=np.abs(a[FIM+1:].astype(np.int16)-b[FIM+1:].astype(np.int16)).mean((1,2,3))
    leg=d[:,612:,:].mean((1,2))
    pos=[]; 
    prim=next((i for i in range(FIM-5,FIM+10) if np.abs(a[i].astype(np.int16)-b[i].astype(np.int16)).mean(2)[inp].mean()<3),None)
    # fantasma: letras antigas fora do texto novo
    A=alfa(lin,[233]*len(lin),{2:557.0,3:523.75,1:573.6}[len(lin)],33.25,33)
    livre=velho&(cv2.dilate((A>.1).astype(np.uint8),np.ones((5,5),np.uint8))==0)
    x1=[(g(a[i])-cv2.GaussianBlur(g(a[i]),(0,0),5))[livre].mean() for i in range(0,161,10)]
    x2=[(g(b[i])-cv2.GaussianBlur(g(b[i]),(0,0),5))[livre].mean() for i in range(0,161,10)]
    res[k]=dict(quadros=len(b),audio_igual=md5a(OR)==md5a(p),fora_mascara_media=round(float(np.mean([d[i][fora].mean() for i in range(FIM+1)])),2),fora_mascara_pior=round(float(max(d[i][fora].mean() for i in range(FIM+1))),2),
      fora_trecho_media=round(float(d2.mean()),2),fora_trecho_pior=round(float(d2.max()),2),banda_legenda_media=round(float(leg.mean()),2),banda_legenda_pior=round(float(leg.max()),2),primeiro_sem_mudanca=prim,
      fantasma_px_livre=int(livre.sum()),fantasma_original=round(float(np.mean(x1)),1),fantasma_peca=round(float(np.mean(x2)),1))
    print(k,res[k])
# controle: a aprovada com a mesma conta
b=rd(P("origem/aprovada.mp4")); dd=np.abs(a[FIM+1:].astype(np.int16)-b[FIM+1:].astype(np.int16)).mean((1,2,3)); print("aprovada fora trecho",round(float(dd.mean()),2),round(float(dd.max()),2))
# Remotion × placa em volta do texto (o retângulo do compositor)
pl=rd(P("remotion/public/midia/placa-solta.mp4")); mu=rd(P("saida/solto/aprovada-mudo.mp4"))
x,y,w,h=areas["aprovada"]["area"]; r=np.zeros((H,W),bool); r[y:y+h,x:x+w]=True
A=alfa(V["aprovada"],[233,233],557.0,33.25,33)
fora2=r&(cv2.dilate((A>.05).astype(np.uint8),np.ones((11,11),np.uint8))==0); fora2[566:597,352:392]=False
dm=np.abs(mu[:161].astype(np.int16)-pl[:161].astype(np.int16)).mean(3)
sg=(mu[:161].astype(np.int16)-pl[:161].astype(np.int16))[:,fora2].mean((0,1))
res["remotion_x_placa"]=dict(area=areas["aprovada"]["area"],media=round(float(dm[:,fora2].mean()),2),pior_quadro=round(float(dm[:,fora2].mean(1).max()),2),desvio_bgr=[round(float(v),2) for v in sg])
print(res["remotion_x_placa"])
json.dump(res,open(P("medidas/conferir-solto.json"),"w"),indent=1)
