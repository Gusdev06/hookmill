#!/usr/bin/env python3
"""Versões da headline solta: mesma frase aprovada, mais longa (3 linhas, sobe), mais curta (2 linhas), mínima (1 linha); e a prova com as palavras originais."""
import json
from comum import *
med=json.load(open(P("medidas/placa-solta.json"))); E=med["emoji"]; END=med["endFrame"]
BY,DL,CX=557.0,33.25,233.0; SZ=26.75
SOMBRA=dict(dx=0,dy=1,blur=2.6,color="rgba(0,0,0,0.4)")
FONTES=[dict(family="Arimo",weight=600,file="fonts/arimo-600.woff")]
def bloco(linhas,base1=BY,emoji=True,sombra=SOMBRA,suaviza=.4):
    ls=[dict(text=t,cx=CX,base=base1+i*DL) for i,t in enumerate(linhas)]
    b=dict(start=0,end=END,family="Arimo",weight=600,size=SZ,color="#fff",lines=ls,sombra=sombra,suaviza=suaviza)
    if emoji:
        # y relativo à linha de base da linha do emoji: o mesmo do original (linha 2 em 590,25)
        b["emoji"]=dict(src="midia/emoji.png",linha=len(linhas)-1,gap=E["gap_arimo"],w=E["bbox_x1"]-E["bbox_x0"]+1,h=E["h"],y=E["y"]-590,margemEsq=E["recorte_margem_esq"],recorteW=E["w"],sombra="drop-shadow(0px 1px 1.3px rgba(0,0,0,0.24))")
    return b
V={
 "aprovada":["Tired of scrolling his","endless following list?"],
 "longa":["Tired of scrolling his endless","following list just to find out","who he added last night?"],
 "longa2":["Tired of scrolling his endless list","just to see who he followed?"],
 "curta":["Who is he","following now?"],
 "minima":["Who is he following?"],
}
jobs=[]
for k,lin in V.items():
    n=len(lin)
    if n==2: b1=BY
    elif n==3: b1=BY-DL     # degrau 3: a linha nova sobe; embaixo está a legenda
    else: b1=BY+DL/2        # §14.4: menos linhas, centra na altura do bloco original
    jobs.append(dict(saida=f"saida/solto/{k}-mudo.mp4",nome=k,props=dict(w=464,h=832,frames=END,base="midia/placa-solta.mp4",fontes=FONTES,blocos=[bloco(lin,b1)])))
jobs.append(dict(saida="saida/solto/prova-originais-mudo.mp4",nome="prova-originais",props=dict(w=464,h=832,frames=END,base="midia/placa-solta.mp4",fontes=FONTES,blocos=[bloco(["How to view your man’s","recent following on IG"])])))
json.dump(jobs,open(P("medidas/jobs-solto.json"),"w"),ensure_ascii=False)
