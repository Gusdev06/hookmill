"""Intenção de api/src/render/posprocesso.ts (comporSobreOCampeao): base decodificada, só as áreas que mudam vêm do Remotion, crf 12, áudio copiado.
DIFERENÇA de propósito: o filtro do produto usa color=black,format=gray como máscara, e esse preto é Y=16: alfa 16/255 (6,3 %) do render vaza no quadro inteiro.
Aqui é crop + overlay com enable, sem alfa. y_mais corrige o nível do render (OffthreadVideo sai ~1,6 Y abaixo da base)."""
import subprocess, json, sys
from comum import *
def compor(mudo, base, audio, W, H, frames, areas, saida, cor_de=None, y_mais=0):
    ajuste=f",lutyuv=y='clip(val+{y_mais}\\,0\\,255)'" if y_mais else ""
    par=lambda v:int(v)//2*2
    n=len(areas); partes=[f"[0:v]tpad=stop=-1:stop_mode=clone,format=yuv420p{ajuste},split={n}"+"".join(f"[t{i}]" for i in range(n)) if n>1 else f"[0:v]tpad=stop=-1:stop_mode=clone,format=yuv420p{ajuste}[t0]","[1:v]format=yuv420p[b0]"]
    for i,(x,y,w,h,s,e) in enumerate(areas):
        x,y=par(x),par(y); w=min(par(w+1),W-x); h=min(par(h+1),H-y)
        partes+= [f"[t{i}]crop={w}:{h}:{x}:{y}[c{i}]",f"[b{i}][c{i}]overlay={x}:{y}:enable='between(n\\,{s}\\,{e-1})':format=yuv420:eof_action=pass[b{i+1}]"]
    filtro=";".join(partes)
    i=info(cor_de or audio); cor=[]
    for k,o in (("color_space","-colorspace"),("color_primaries","-color_primaries"),("color_transfer","-color_trc"),("color_range","-color_range")):
        v=i.get(k)
        if v and v!="unknown": cor+= [o,v]
    r=subprocess.run(["ffmpeg","-hide_banner","-nostdin","-loglevel","error","-y","-i",mudo,"-i",base,"-i",audio,"-filter_complex",filtro,"-map",f"[b{n}]","-map","2:a:0?","-frames:v",str(frames),"-c:v","libx264","-preset","medium","-crf","12","-pix_fmt","yuv420p",*cor,"-c:a","copy","-movflags","+faststart",saida],capture_output=True,text=True)
    assert r.returncode==0, r.stderr[-800:]
