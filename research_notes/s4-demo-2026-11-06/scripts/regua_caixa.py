#!/usr/bin/env python3
"""Régua no motor do render (§14.1.2): cos, traço, largura por linha, cor, contra o original. Uma peça 'mesmas palavras' por fonte."""
import cv2, json, numpy as np
from comum import *
def mask(p,W,H,box,N,sub):
    X,Y,BW,BH=box; fs=list(frames(p,W,H,n=N,mat="bt709")); med=np.median(np.stack([f[Y:Y+BH,X:X+BW] for f in fs[::max(1,N//40)]]),0).astype(np.uint8)
    bgl=cv2.medianBlur(med,min(BH|1,101)); le=np.abs(med.astype(np.int16)-bgl.astype(np.int16)).mean(2)>40
    core=cv2.erode(le.astype(np.uint8),np.ones((3,3),np.uint8))>0; tx=np.median(med[core],0).astype(np.float32); bg=bgl.astype(np.float32); v=tx-bg
    al=np.clip(((med.astype(np.float32)-bg)*v).sum(2)/np.maximum((v*v).sum(2),1),0,1)
    fora=~cv2.dilate(le.astype(np.uint8),np.ones((21,21),np.uint8)).astype(bool)
    for a,b in sub: al[a-1:b+1]=0
    return al,med,tx,bgl,fora
def stem(al):
    m=(al>.5).astype(np.uint8); dt=cv2.distanceTransform(m,cv2.DIST_L2,3); return 2*float(np.percentile(dt[dt>0],90))
def larg(al):
    prj=(al>.5).sum(1); out=[]; y=0
    while y<len(prj):
        if prj[y]>3:
            a=y
            while y<len(prj) and prj[y]>3:y+=1
            if y-a>8:
                c=np.where((al[a:y]>.5).any(0))[0]; out.append([int(a),int(y),int(c.min()),int(c.max()),int(c.max()-c.min()+1)])
        y+=1
    return out
R={}
for v,W,H,N,sub,pcs in (("02",716,1278,198,[(153,159),(220,226)],["02-mesmas","02-mesmas-montserrat-500"]),("06",720,960,335,[],["06-mesmas"]),("05",720,1280,191,[],["05-mesmas","05-mesmas-montserrat-500","05-mesmas-dm-sans-400"])):
    m=json.load(open(P(f"medidas/caixa-{v}.json"))); box=m["box"]
    a,med,tx,bgl,fo=mask(P(f"origem/c{v}.mp4"),W,H,box,N,sub); R[v]=dict(original=dict(traco=round(stem(a),2),linhas=larg(a),cor_txt=tx[::-1].round().tolist()))
    for k in pcs:
        b,mb,tb,bb,fb=mask(P(f"saida/caixa/{k}.mp4"),W,H,box,N,sub)
        f2=fo&fb
        R[v][k]=dict(cos=round(float(np.corrcoef(a.ravel(),b.ravel())[0,1]),3),traco=round(stem(b),2),linhas=larg(b),cor_txt=tb[::-1].round().tolist(),fundo_dif_medio=round(float(np.abs(med.astype(np.float32)-mb.astype(np.float32))[f2].mean()),2),fundo_dif_p99=round(float(np.percentile(np.abs(med.astype(np.float32)-mb.astype(np.float32))[f2],99)),1))
json.dump(R,open(P("medidas/regua-caixa.json"),"w"),indent=1)
for v in R:
    for k,x in R[v].items(): print(v,k,{q:x[q] for q in x if q!='linhas'},[l[4] for l in x['linhas']],'y',[l[0] for l in x['linhas']],'x0',[l[2] for l in x['linhas']])
