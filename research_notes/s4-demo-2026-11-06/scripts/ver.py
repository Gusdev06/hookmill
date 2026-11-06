#!/usr/bin/env python3
"""Tira quadros: python3 ver.py saida.png idx1,idx2 W H [--roi x0,y0,x1,y1] [--zoom Z] arq1 arq2 ... (linhas = quadros; colunas = arquivos)"""
import sys, cv2, numpy as np
from comum import *
a=sys.argv[1:]; out=a[0]; idx=[int(x) for x in a[1].split(",")]; W=int(a[2]); H=int(a[3]); roi=None; z=1; r=a[4:]
if r[0]=="--roi": roi=[int(x) for x in r[1].split(",")]; r=r[2:]
if r[0]=="--zoom": z=float(r[1]); r=r[2:]
rows=[]
for i in idx:
    c=[]
    for p in r:
        f=next(frames(p,W,H,ini=i,n=1))
        if roi: f=f[roi[1]:roi[3],roi[0]:roi[2]]
        if z!=1: f=cv2.resize(f,None,fx=z,fy=z,interpolation=cv2.INTER_NEAREST if z>=2 else cv2.INTER_AREA)
        c+= [f,np.full((f.shape[0],6,3),255,np.uint8)]
    rows+= [np.hstack(c[:-1]),np.full((6,sum(x.shape[1] for x in c[:-1]),3),255,np.uint8)]
cv2.imwrite(out,np.vstack(rows[:-1]))
