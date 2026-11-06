#!/usr/bin/env python3
import json, sys
from comum import *; from compor import compor
meta=json.load(open(P("medidas/meta-caixa.json"))); so=sys.argv[1:] 
for k,m in meta.items():
    if so and k not in so: continue
    v=m["video"]; src=P(f"origem/c{v}.mp4"); pq=m.get("por_quadro")
    import subprocess; n=int(subprocess.run(["ffprobe","-v","error","-select_streams","v:0","-count_frames","-show_entries","stream=nb_read_frames","-of","csv=p=0",src],capture_output=True,text=True).stdout.strip().rstrip(","))
    base=P("remotion/public/midia/placa-02-porquadro.mp4") if pq else src
    x,y,w,h=m["area"]; compor(P(f"saida/caixa/{k}-mudo.mp4"),base,src,m["W"],m["H"],n,[(x,y,w,h,0,m["N"])],P(f"saida/caixa/{k}.mp4"),cor_de=src,y_mais=2 if pq else 0); print(k,n,m["area"])
