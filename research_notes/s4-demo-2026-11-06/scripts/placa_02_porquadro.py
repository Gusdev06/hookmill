#!/usr/bin/env python3
import cv2, numpy as np, json, time
from comum import *
m=json.load(open(P("medidas/caixa-02.json"))); W,H,N=716,1278,198; X,Y,BW,BH=m["box"]; src=P("origem/c02.mp4")
fs=list(frames(src,W,H,mat="bt709")); cr=np.stack([f[Y:Y+BH,X:X+BW] for f in fs[:N]]); med=np.median(cr[::3],0).astype(np.uint8)
bgl=cv2.medianBlur(med,101); dist=np.abs(med.astype(np.int16)-bgl.astype(np.int16)).mean(2); letra=dist>40
fundo=(cv2.dilate(letra.astype(np.uint8),np.ones((9,9),np.uint8))==0).astype(np.float32); den=cv2.GaussianBlur(fundo,(0,0),18,borderType=cv2.BORDER_REFLECT)
enc=encoder(P("remotion/public/midia/placa-02-porquadro.mp4"),W,H); t=time.time()
for i,f in enumerate(fs):
    if i<N:
        b=cv2.GaussianBlur(f[Y:Y+BH,X:X+BW].astype(np.float32)*fundo[...,None],(0,0),18,borderType=cv2.BORDER_REFLECT)/np.maximum(den,1e-4)[...,None]
        f=f.copy(); f[Y:Y+BH,X:X+BW]=b.clip(0,255).astype(np.uint8)
    enc.stdin.write(f.tobytes())
enc.stdin.close(); enc.wait(); print("porquadro",len(fs),"q",round(time.time()-t,1),"s")
