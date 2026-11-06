#!/usr/bin/env python3
import json, cv2, numpy as np
from comum import *
ESC={"02":"montserrat-600","06":"montserrat-500","05":"albert-sans-500"}   # traço medido: 02 7,6 e 06 3,8 (§14.1.1); 05 por olho na prova
FONTES=[dict(family="Montserrat",weight=w,file=f"fonts/montserrat-latin-{w}-normal.woff2") for w in (500,600,700)]+[dict(family="Albert Sans",weight=500,file="fonts/albert-sans-500.woff"),dict(family="DM Sans",weight=400,file="fonts/dm-sans-400.woff2")]
FAM={"montserrat":"Montserrat","albert":"Albert Sans","dm":"DM Sans"}
def cfg(v,fonte=None):
    m=json.load(open(P(f"medidas/caixa-{v}.json"))); e=[r for r in m["fonte"] if r["fonte"]==(fonte or ESC[v])][0]; return m,e
def bloco(v,lines,sub=(),grow=0,dy=0,fonte=None,cx=None,cor=None):
    m,e=cfg(v,fonte); X,Y,BW,BH=m["box"]; w=int(e["fonte"].split("-")[-1]); fam=FAM[e["fonte"].split("-")[0]]
    cxs=e["cxs"]; cxm=float(np.mean(cxs))
    ls=[dict(text=t,cx=X+(cxs[i] if (cx is None and i<len(cxs)) else cxm),base=Y+e["base"]+dy+i*e["pitch"]) for i,t in enumerate(lines)]
    b=dict(start=0,end=m["N"],family=fam,weight=w,size=e["sz"],tracking=e["tr"] or None,color=m["cor_texto"],lines=ls,suaviza=.6,placa=dict(uri=m["placa_uri"],x=X,y=Y,w=BW,h=BH+grow),sublinhados=list(sub))
    if m["sombra"]:
        s=m["sombra"]; b["sombra"]=dict(dx=s["dx"],dy=s["dy"],blur=s["sigma"]*2,color=f"rgba(0,0,0,{s['op']})")
    return b,m
def sub(l,t,a):
    i=t.index(a); return dict(linha=l,de=i,ate=i+len(a),dy=14,esp=6)
V={}
o=["Si en 2 minutos no te","busca, es porque","nunca fue para ti.."]
V["02-mesmas"]=("02",o,[sub(1,o[1],"es porque"),sub(2,o[2],"nunca fue para ti")],0,0)
n=["Si en 7 días no","vuelve a escribirte,","nunca fue para ti.."]
V["02-novo"]=("02",n,[sub(1,n[1],"escribirte,"),sub(2,n[2],"nunca fue para ti")],0,0)
l=["Si en 7 días no vuelve","a buscarte de verdad,","es porque nunca fue","para ti.."]
V["02-longa"]=("02",l,[sub(2,l[2],"es porque nunca fue"),sub(3,l[3],"para ti")],67,0)
o=["Él ya está con otra? Te","propongo algo. Si en 7 días","no te busca, dime mentirosa"]
V["06-mesmas"]=("06",o,[],0,0)
V["06-novo"]=("06",["¿Sientes que ya no piensa","en ti? Haz esto 7 días","y mira lo que pasa"],[],0,0)
V["06-curta"]=("06",["¿Ya no piensa en ti?","Haz esto 7 días"],[],0,17)
o=["If he doesn't call you","within two minutes,","I’ll pay you $50"]
V["05-mesmas"]=("05",o,[],0,0)
V["05-novo"]=("05",["If he doesn't text you","back within 7 days,","I’ll pay you $50"],[],0,0)
V["05-longa"]=("05",["If he doesn't call you","or text back within","two minutes, I’ll pay","you $50 right now"],[],60,-30)
jobs=[]; meta={}
for k,(v,ln,sb,gr,dy) in V.items():
    b,m=bloco(v,ln,sb,gr,dy if gr==0 else 0)
    if v=="05" and gr: # cresce pros dois lados
        b["placa"]["y"]-=30; 
        for q in b["lines"]: q["base"]-=30
    if not k.endswith("mesmas"):
        reg=json.load(open(P("medidas/regua-caixa.json")))[v]["original"]["linhas"]
        c=float(np.median([(l_[2]+l_[3])/2 for l_ in reg]))+m["box"][0]
        for q in b["lines"]: q["cx"]=c
    jobs.append(dict(saida=f"saida/caixa/{k}-mudo.mp4",nome=k,video=v,props=dict(w=m["W"],h=m["H"],frames=m["N"],fontes=FONTES,blocos=[b])))
    meta[k]=dict(video=v,N=m["N"],W=m["W"],H=m["H"],area=[b["placa"]["x"],b["placa"]["y"],b["placa"]["w"],b["placa"]["h"]])
# 02 por quadro: mesma placa do teste de 04/11 (método B), base = vídeo repintado; mesmo texto
b,m=bloco("02",n,V["02-novo"][2]); bb=dict(b); del bb["placa"]
reg=json.load(open(P("medidas/regua-caixa.json")))["02"]["original"]["linhas"]; c=float(np.median([(l_[2]+l_[3])/2 for l_ in reg]))
for q in bb["lines"]: q["cx"]=c
jobs.append(dict(saida="saida/caixa/02-novo-porquadro-mudo.mp4",nome="02-novo-porquadro",video="02",props=dict(w=716,h=1278,frames=198,base="midia/placa-02-porquadro.mp4",fontes=FONTES,blocos=[bb])))
meta["02-novo-porquadro"]=dict(video="02",N=198,W=716,H=1278,area=list(m["box"]),por_quadro=True)
# 05: outro peso, para olhar
for v_,f in (("05","montserrat-500"),("05","dm-sans-400"),("02","montserrat-500")):
    o_=V[f"{v_}-mesmas"]; b,m=bloco(v_,o_[1],o_[2],fonte=f); nm=f"{v_}-mesmas-{f}"; jobs.append(dict(saida=f"saida/caixa/{nm}-mudo.mp4",nome=nm,video=v_,props=dict(w=m["W"],h=m["H"],frames=m["N"],fontes=FONTES,blocos=[b]))); meta[nm]=dict(video=v_,N=m["N"],W=m["W"],H=m["H"],area=list(m["box"]))
json.dump(jobs,open(P("medidas/jobs-caixa.json"),"w"),ensure_ascii=False); json.dump(meta,open(P("medidas/meta-caixa.json"),"w"),indent=0)
