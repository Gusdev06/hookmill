#!/usr/bin/env python3
"""Mesma paginação e posição do escrever.py (W1, tr): gera os jobs Remotion da legenda. Rodar em work-leg, PYTHONPATH=scripts/s2:scripts."""
import sys, json, numpy as np
from leg import *; from pegada import Legenda; from textos import FRASES, T as TEX
FPS=30
def paginas_de(v,TT="tr"):
    L=Legenda(v); E=dict(L.E); W,H,y0,y1,Hb=L.W,L.H,L.y0,L.y1,L.Hb; ws=palavras_whisper(f"w{v}.json"); N=L.N; est=dict(E); tam=E["tam"]
    atr=[int(k)/FPS-ws[idx[0]]["ini"] for k,idx in E["alinhamento"].items() if idx]; ATR=float(np.clip(np.median(atr),0,.4))
    LMAX=.90*W
    def largura(pal): return layout(pal,est["fonte"],tam,est["tr"],est["esp"])[1]+2*(est["stroke"]+2)
    pgs=[]; fr=FRASES[v]; txt=TEX[v][TT]
    for k,((i,j),s) in enumerate(zip(fr,txt)):
        ini=ws[i]["ini"]+ATR; fim=ws[j]["fim"]+ATR
        if k+1<len(fr):
            px=ws[fr[k+1][0]]["ini"]+ATR
            if px-fim<.35: fim=px
        pal=s.split(); pg=[]; lin=[]; pag=[]
        for w in pal:
            if lin and (largura(lin+[w])>LMAX or len(lin)>=5):
                pag.append(lin); lin=[]
                pg.append(pag); pag=[]
            lin.append(w)
        if lin: pag.append(lin)
        if pag: pg.append(pag)
        total=sum(len(w)+1 for p in pg for l in p for w in l); tc=ini
        for p in pg:
            pw=[w for l in p for w in l]; d=(fim-ini)*sum(len(w)+1 for w in pw)/total; tempos=[]; x=tc
            for w in pw: tempos.append(x); x+=d*(len(w)+1)/sum(len(q)+1 for q in pw)
            pgs.append(dict(lin=p,pw=pw,ini=tc,fim=tc+d,tempos=tempos)); tc+=d
    pag_de=np.full(N,-1)
    for i,p in enumerate(pgs):
        a,b=int(round(p["ini"]*FPS)),int(round(p["fim"]*FPS)); pag_de[a:min(b,N)]=i
    def centro(t):
        i=L.seg_de[min(t,N-1)]
        if i<0 or not L.segs[i]["usa"]: i=min(L.boas,key=lambda j:abs(L.segs[j]["ini"]-t))
        else: i=L.segs[i]["usa"][0]
        s=L.segs[i]; return (s["r0"]+s["r1"])/2
    saida=[]
    for i,p in enumerate(pgs):
        idx=np.where(pag_de==i)[0]
        if len(idx)==0: continue
        mid=int((p["ini"]+p["fim"])/2*FPS); c=centro(mid); nl=len(p["lin"]); ent=int(tam*1.12); cap=.36*tam; bases=[int(c+cap-(nl-1)*ent/2+q*ent) for q in range(nl)]
        saida.append(dict(start=int(idx[0]),end=int(idx[-1])+1,linhas=[dict(pal=l,base=int(y0+b)) for l,b in zip(p["lin"],bases)],tempos=[(x-.017)*FPS for x in p["tempos"]]))
    return saida,E,L,W,H,int(y0),int(y1),N
FONTES=[dict(family="Gabarito",weight=900,file="fonts/Gabarito-Variable.ttf")]
jobs=[]; meta={}
def cor(c): return "#%02x%02x%02x"%tuple(c)
for v,base,modos in (("13","midia/placa-13.mp4",[("sombras",False,1.0)]),("02","midia/placa-02.mp4",[("sombras",False,1.0),("sombras",True,1.0)])):
    pg,E,L,W,H,y0,y1,N=paginas_de(v)
    caixa=dict(c0="rgb(27,115,231)",c1="rgb(95,218,175)",acima=43,abaixo=12,pad=8,raio=5,sombra=3) if v=="02" else None
    for modo,hold,suav in modos:
        ps=[dict(q) for q in pg]
        if hold:
            for a,b in zip(ps,ps[1:]): a["end"]=b["start"]
            ps[-1]["end"]=N
        lg=dict(family="Gabarito",weight=900,size=E["tam"],cx=W/2,espaco=E["esp"],tracking=E["tr"],traco=E["stroke"],tracoCor=cor(E["cor_traco"]),sombra=E["sombra"],cor=cor(E["branco"]),ativa=cor(E["amarelo"]) if E.get("amarelo") else None,caixa=caixa,suaviza=suav,tracoModo=modo,paginas=ps)
        k=f"{v}-W1-{modo}"+("-pausa" if hold else "")+("-s1" if v=="13" else "")
        jobs.append(dict(saida=f"saida/legenda/{k}-mudo.mp4",nome=k,props=dict(w=W,h=H,frames=N,base=base,fontes=FONTES,blocos=[],legenda=lg)))
        meta[k]=dict(video=v,W=W,H=H,N=N,y0=y0,y1=y1)
json.dump(jobs,open("../medidas/jobs-legenda.json","w"),ensure_ascii=False); json.dump(meta,open("../medidas/meta-legenda.json","w"),indent=0)
print({k:(m,len(j["props"]["legenda"]["paginas"])) for (k,m),j in zip(meta.items(),jobs)})
