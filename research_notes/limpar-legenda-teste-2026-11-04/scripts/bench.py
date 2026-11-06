#!/usr/bin/env python3
"""bench.py <id> <modo: N|C> [--roi] — sonda de velocidade da troca: 1 variante, 1 encoder, sem nada em paralelo, tempo por etapa.
Mede parede (time.perf_counter) e CPU do processo (time.process_time). Sem --roi repete o trocar.py (compõe a faixa inteira em float).
Com --roi compõe só o retângulo da legenda, em uint8. Não grava vídeo final útil (saída em /dev/null do encoder real)."""
import sys, os, json, time, subprocess, numpy as np, cv2
sys.argv_ = sys.argv
from leg import *
from detectar import candidato, frames
v, modo = sys.argv[1], sys.argv[2]; ROI = "--roi" in sys.argv
D = np.load(f"d{v}.npz", allow_pickle=True); E = json.load(open(f"estilo{v}.json"))
y0, y1, W, H = int(D["y0"]), int(D["y1"]), int(D["W"]), int(D["H"]); Hb = y1 - y0
ws = palavras_whisper(f"w{v}.json"); FPS = 30; segs = list(D["segs"]); E["blur"] = 0.6
AM = E["amarelo"] or [255, 230, 0]; BR = E["branco"]
T = dict(resolver=0.0, leg=0.0, candidato=0.0, mascara=0.0, inpaint=0.0, compor=0.0, escrever=0.0, decode=0.0)
t00 = time.perf_counter(); c00 = time.process_time(); st = t00
alt = [s["bbox"][1]-s["bbox"][0] for s in segs if not s["vazio"] and s["bbox"]]
def bom(s): return (not s["vazio"]) and s["bbox"] and s["est"].sum() > 300 and s["fim"]-s["ini"] >= 5
for s in segs:
    idx = E["alinhamento"].get(str(int(s["ini"]))); s["idx"] = idx if idx else None
for i, s in enumerate(segs):
    if s["vazio"]: continue
    if not bom(s):
        viz = [j for j in (i+1, i-1, i+2, i-2) if 0 <= j < len(segs) and bom(segs[j])]
        if viz: s["herda"] = viz[0]
for s in segs:
    if s["vazio"] or s.get("herda") is not None or s["idx"]: continue
    s["idx"] = [k for k, w in enumerate(ws) if s["ini"]/FPS-0.15 <= (w["ini"]+w["fim"])/2 < s["fim"]/FPS+0.15] or None
for s in segs:
    if s["vazio"] or s.get("herda") is not None or not s["idx"]: continue
    pal = [ws[k]["w"] for k in s["idx"]]
    iou, fit = encaixa(s["est"], pal, E["fonte"], E["tr"], E["esp"], W, E["tam"])
    tam = fit[0] if fit and abs(fit[0]-E["tam"]) <= 0.12*E["tam"] else E["tam"]
    ys, xs = np.where(s["est"])
    if not fit or iou < 0.35: fit = (tam, (xs.min()+xs.max())/2, int(np.percentile(ys, 97))+1)
    s["pos"] = {"tam": tam, "cx": fit[1], "base": fit[2], "centros": None, "iou": iou}
for s in segs:
    if s.get("herda") is not None:
        h = segs[s["herda"]]
        for k in ("idx", "pos", "est"):
            if k in h: s[k] = h[k]
R = E["stroke"]+max(E["sombra"])+3
seg_de = np.full(int(D["N"]), -1)
for i, s in enumerate(segs):
    if not s["vazio"] and s.get("idx") and s.get("pos"): seg_de[s["ini"]:s["fim"]] = i
T["resolver"] = time.perf_counter()-st
cache = {}
def legenda(i, ativa):
    k = (i, ativa)
    if k in cache: return cache[k]
    t = time.perf_counter(); s = segs[i]; p = s["pos"]; pal = [ws[j]["w"] for j in s["idx"]]; e = dict(E, tam=p["tam"])
    cores = [BR]*len(pal); cores[min(ativa, len(pal)-1)] = AM
    im = np.array(render(W, Hb, pal, e, p["cx"], p["base"], cores=cores, extra_stroke=2))
    if ROI:
        ys, xs = np.where(im[..., 3] > 0); a, b, c, d = ys.min(), ys.max()+1, xs.min(), xs.max()+1
        rgb = im[a:b, c:d, 2::-1].astype(np.uint16); al = im[a:b, c:d, 3:4].astype(np.uint16)
        cache[k] = (a, b, c, d, rgb*al, 255-al)
    else:
        imf = im.astype(np.float32); cache[k] = (imf[..., 2::-1].copy(), imf[..., 3:4]/255.0)
    T["leg"] += time.perf_counter()-t
    return cache[k]
wr = subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","bgr24","-s",f"{W}x{H}","-r",str(FPS),"-i","-","-c:v","libx264","-crf","16","-preset","veryfast","-pix_fmt","yuv420p",os.path.join(os.path.dirname(os.path.abspath(__file__)),f"bench-{v}-{modo}.mp4")], stdin=subprocess.PIPE)
KR = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*R+1,2*R+1)); K15 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(31,31)); K2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5))
n = 0; area=[]; tl=time.perf_counter(); g=frames(f"v{v}.mp4",W,H)
while True:
    t=time.perf_counter()
    try: f=next(g)
    except StopIteration: break
    T["decode"]+=time.perf_counter()-t; n+=1
    tq=n-1; i=seg_de[tq] if tq<len(seg_de) else -1
    if i>=0:
        s=segs[i]; band=f[y0:y1]
        if modo=="C":
            t=time.perf_counter(); cand=candidato(band); T["candidato"]+=time.perf_counter()-t
            t=time.perf_counter(); perto=cv2.dilate(s["est"].astype(np.uint8),K15)>0; TT=s["est"]|(cand&perto); esc=band.max(2)<85
            Fp=(cv2.dilate(TT.astype(np.uint8),K2)>0)|(esc&(cv2.dilate(TT.astype(np.uint8),KR)>0)); Fp=cv2.dilate(Fp.astype(np.uint8),K2); ys=np.where(Fp.any(1))[0]
            T["mascara"]+=time.perf_counter()-t; area.append(int(Fp.sum()))
            if len(ys):
                r0,r1=max(0,ys.min()-12),min(Hb,ys.max()+13); t=time.perf_counter(); limpo=band.copy(); limpo[r0:r1]=cv2.inpaint(np.ascontiguousarray(band[r0:r1]),Fp[r0:r1],5,cv2.INPAINT_TELEA); T["inpaint"]+=time.perf_counter()-t
            else: limpo=band
        else: limpo=band
        tt=tq/FPS; idx=s["idx"]; ativa=max([j for j,k in enumerate(idx) if ws[k]["ini"]<=tt+0.017] or [0])
        L=legenda(i,ativa); t=time.perf_counter(); f=f.copy()
        if ROI:
            a,b,c,d,pm,ia=L; sub=limpo[a:b,c:d]; f[y0+a:y0+b,c:d]=((pm+sub.astype(np.uint16)*ia)//255).astype(np.uint8)
            if modo=="C": pass
        else:
            rgb,al=L; f[y0:y1]=np.clip(limpo.astype(np.float32)*(1-al)+rgb*al,0,255).astype(np.uint8)
        T["compor"]+=time.perf_counter()-t
    t=time.perf_counter(); wr.stdin.write(f.tobytes()); T["escrever"]+=time.perf_counter()-t
wr.stdin.close(); t=time.perf_counter(); wr.wait(); T["fim_encoder"]=time.perf_counter()-t
tot=time.perf_counter()-t00
r={"id":v,"modo":modo,"roi":ROI,"quadros":n,"banda":[y0,y1,W,H],"parede_s":round(tot,1),"cpu_python_s":round(time.process_time()-c00,1),"por_quadro_ms":round(1000*tot/n,1),"area_mascara_med":int(np.median(area)) if area else None,**{k:round(x,1) for k,x in T.items()}}
print(json.dumps(r))
