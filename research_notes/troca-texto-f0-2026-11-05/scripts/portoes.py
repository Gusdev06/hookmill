#!/usr/bin/env python3
"""F0 troca-texto §15.4: candidatos a portão medidos em janelas de 0,5 s, com original × placa E2 da S1. US$ 0, local.
Buraco = onde a placa difere do original (aproximação, sem o .npz). Rodar da raiz do produto."""
import cv2,numpy as np,subprocess,json,sys
R='research_notes/'; S1=R+'legenda-s1-aws-2026-11-05/'; S2=R+'limpar-legenda-teste-2026-11-05-s2/work/'
V={'13':(S2+'v13.mp4',S1+'saida/placa-13-E2.mp4',248,687),'02':(S2+'v02.mp4',S1+'saida/placa-02-E2.mp4',910,1027),'05':(S2+'v05.mp4',S1+'saida/placa-05-E2.mp4',695,915),'120':(S1+'entrada/v120.mp4',S1+'saida/placa-120-E2-4pedacos.mp4',900,1040)}
def probe(p):
    o=subprocess.check_output(['ffprobe','-v','error','-select_streams','v','-show_entries','stream=width','-of','csv=p=0',p]).decode().strip(); return int(o.split(',')[0])
def ler(p,y0,y1,w):
    h=y1-y0; d=subprocess.Popen(['ffmpeg','-v','error','-i',p,'-vf',f'crop={w}:{h}:0:{y0},format=gray','-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
    while True:
        b=d.stdout.read(w*h)
        if len(b)<w*h:break
        yield np.frombuffer(b,np.uint8).reshape(h,w)
out={}
K=np.ones((5,5),np.uint8)
for v,(o,pl,y0,y1) in V.items():
    w=probe(o); rows=[]; po=pp=None; ac=[]
    for t,(a,b) in enumerate(zip(ler(o,y0,y1,w),ler(pl,y0,y1,w))):
        hole=(cv2.absdiff(a,b)>25).astype(np.uint8); hole=cv2.morphologyEx(hole,cv2.MORPH_CLOSE,K)
        ring=(cv2.dilate(hole,np.ones((15,15),np.uint8))>0)&(hole==0)
        H=hole>0; r={}
        if H.sum()>200 and ring.sum()>200:
            lap=np.abs(cv2.Laplacian(a,cv2.CV_32F,ksize=3))
            bb=cv2.GaussianBlur(b,(0,0),2).astype(np.float32)
            inner=H&(cv2.erode(hole,np.ones((7,7),np.uint8))==0); outer=(cv2.dilate(hole,np.ones((7,7),np.uint8))>0)&~H
            r=dict(detalhe=float(lap[ring].mean()),degrau=float(abs(bb[inner].mean()-bb[outer].mean())),furo=float(H.mean()))
            if po is not None:
                r['mov']=float(cv2.absdiff(a,po)[ring].mean()); r['trem']=float(cv2.absdiff(b,pp)[H].mean()); r['trem_ring']=float(cv2.absdiff(b,pp)[ring].mean())
            # textura do preenchido × em volta (borrão: preenchido liso sobre fundo com detalhe)
            lb=np.abs(cv2.Laplacian(b,cv2.CV_32F,ksize=3)); r['lisura']=float(lb[cv2.erode(hole,np.ones((3,3),np.uint8))>0].mean()/max(lb[ring].mean(),.1)) if (cv2.erode(hole,np.ones((3,3),np.uint8))>0).sum()>50 else None
        rows.append(r); po=a.copy(); pp=b.copy()
    jan=[]
    for i in range(0,len(rows),15):
        sub=[x for x in rows[i:i+15] if x]
        m={k:(round(float(np.mean([x[k] for x in sub if x.get(k) is not None])),2) if any(x.get(k) is not None for x in sub) else None) for k in ('detalhe','degrau','mov','trem','trem_ring','lisura','furo')} if sub else {}
        jan.append(dict(t=round(i/30,1),n=len(sub),**m))
    out[v]=jan
    A=[j for j in jan if j['n']>=8 and j.get('mov') is not None]
    print(v,'janelas',len(A),{k:[round(float(np.percentile([j[k] for j in A if j[k] is not None],p)),2) for p in (50,90,99)] for k in ('detalhe','degrau','mov','trem','lisura')})
json.dump(out,open(sys.argv[1],'w'))
def janela(v,a,b):
    A=[j for j in out[v] if a<=j['t']<b and j['n']>=8 and j.get('mov') is not None]
    return {k:round(float(np.mean([j[k] for j in A if j[k] is not None])),2) for k in ('detalhe','degrau','mov','trem','lisura')} if A else None
for lbl,v,a,b in [('13 bom 7-21','13',7,21),('13 igreja 0-6 ruim','13',0,6),('05 suéter bom 13-17','05',13,17),('05 partículas 25-30 ruim','05',25,30),('02 mão 0-2 ruim','02',0,2),('02 corpo 8-16 ok','02',8,16),('02 pele 19-20 ruim','02',19,20),('02 26.5-27.5 ruim','02',26.5,27.5),('120 mão 58-60 ruim','120',58,60),('120 mão 67-68 ruim','120',67,68.5),('120 10-14 ok','120',10,14)]:
    print(lbl,janela(v,a,b))
