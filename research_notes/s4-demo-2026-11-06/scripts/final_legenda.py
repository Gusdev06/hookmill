#!/usr/bin/env python3
import json
from comum import *; from compor import compor
meta=json.load(open(P("medidas/meta-legenda.json")))
for k,m in meta.items():
    v=m["video"]; pl=P(f"remotion/public/midia/placa-{v}.mp4"); src=P(f"work-leg/v{v}.mp4")
    compor(P(f"saida/legenda/{k}-mudo.mp4"),pl,src,m["W"],m["H"],m["N"],[(0,m["y0"],m["W"],m["y1"]-m["y0"],0,m["N"])],P(f"saida/legenda/{k}.mp4"),cor_de=src,y_mais=2); print(k)
