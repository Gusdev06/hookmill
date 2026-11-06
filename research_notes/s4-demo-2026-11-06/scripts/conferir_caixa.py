#!/usr/bin/env python3
"""Conferência da caixa (§15.5.7): resto ≤ 1 nível, áudio igual, quadros iguais, corte exato; parada × por quadro no 02."""
import cv2, json, numpy as np, subprocess
from comum import *
meta=json.load(open(P("medidas/meta-caixa.json")))
def md5a(p): return subprocess.run(['ffmpeg','-v','error','-i',p,'-map','0:a','-c','copy','-f','md5','-'],capture_output=True,text=True).stdout.strip()
R={}
for k,m in meta.items():
    v=m["video"]; W,H,N=m["W"],m["H"],m["N"]; o=np.stack(list(frames(P(f"origem/c{v}.mp4"),W,H,mat="bt709"))); b=np.stack(list(frames(P(f"saida/caixa/{k}.mp4"),W,H,mat="bt709")))
    q=min(len(o),len(b)); dq=len(o)-len(b); o,b=o[:q],b[:q]
    x,y,w,h=m["area"]; f=np.ones((H,W),bool); f[max(0,y-2):y+h+2,max(0,x-2):x+w+2]=False
    d=np.abs(o.astype(np.int16)-b.astype(np.int16)).mean(3)
    R[k]=dict(dif_quadros=dq,audio_igual=md5a(P(f"origem/c{v}.mp4"))==md5a(P(f"saida/caixa/{k}.mp4")),fora_caixa_no_trecho_media=round(float(np.mean([d[i][f].mean() for i in range(0,N,3)])),2),fora_caixa_no_trecho_pior=round(float(max(d[i][f].mean() for i in range(0,N,3))),2),fora_do_trecho_media=round(float(d[N:].mean()),2),fora_do_trecho_pior=round(float(d[N:].mean((1,2)).max()),2))
    print(k,R[k],flush=True)
# 02: parada × por quadro
a=np.stack(list(frames(P("saida/caixa/02-novo.mp4"),716,1278,n=198,mat="bt709")))[:,0:246]; c=np.stack(list(frames(P("saida/caixa/02-novo-porquadro.mp4"),716,1278,n=198,mat="bt709")))[:,0:246]; o=np.stack(list(frames(P("origem/c02.mp4"),716,1278,n=198,mat="bt709")))[:,0:246]
le=cv2.dilate((np.abs(np.median(a[::10],0).astype(np.float32)-cv2.medianBlur(np.median(a[::10],0).astype(np.uint8),101).astype(np.float32)).mean(2)>25).astype(np.uint8),np.ones((15,15),np.uint8))>0
le2=cv2.dilate((np.abs(np.median(o[::10],0).astype(np.float32)-cv2.medianBlur(np.median(o[::10],0).astype(np.uint8),101).astype(np.float32)).mean(2)>25).astype(np.uint8),np.ones((15,15),np.uint8))>0
z=~(le|le2)
d=np.abs(a.astype(np.float32)-c.astype(np.float32)).mean(3)[:,z]
t=lambda x:float(np.abs(x[1:].astype(np.float32)-x[:-1].astype(np.float32)).mean(3)[:,z].mean())
R["02_parada_x_porquadro"]=dict(media=round(float(d.mean()),2),pior_quadro=round(float(d.mean(1).max()),2),p99=round(float(np.percentile(d,99)),1),movimento_entre_quadros=dict(original=round(t(o),2),porquadro=round(t(c),2),parada=round(t(a),2)))
print(R["02_parada_x_porquadro"]); json.dump(R,open(P("medidas/conferir-caixa.json"),"w"),indent=1)
