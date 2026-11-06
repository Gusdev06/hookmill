#!/usr/bin/env python3
"""ajustar.py <id> [--caixa] — descobre fonte, tamanho, tracking, espaço, traço e sombra da legenda ORIGINAL
casando o texto da fala (whisper) re-renderizado com a máscara estável de cada trecho (IoU)."""
import sys, json, time, numpy as np, cv2
from leg import *

v = sys.argv[1]; caixa = "--caixa" in sys.argv
D = np.load(f"d{v}.npz", allow_pickle=True); y0, y1, W = int(D["y0"]), int(D["y1"]), int(D["W"]); Hb = y1 - y0
ws = palavras_whisper(f"w{v}.json"); FPS = 30
TODOS = [s for s in D["segs"] if not s["vazio"] and s["est"].sum() > 300 and s["fim"] - s["ini"] >= 8]
def atribui(delta):
    for s in TODOS: s["pal"] = [w["w"] for w in palavras_do_trecho(ws, s["ini"] / FPS, s["fim"] / FPS, delta)]
    return [s for s in TODOS if s["pal"]]
segs = sorted(atribui(None), key=lambda s: -s["est"].sum())[:10]
t0 = time.time()

def encaixa_s(s, spec, tr, esp): return encaixa(s["est"], s["pal"], spec, tr, esp, W)
res = []
for spec in CATALOGO:
    for tr in (-0.06, -0.03, 0, 0.03, 0.06, 0.1):
        for esp in (0.4, 1.0, 1.6):
            sc = [encaixa_s(s, spec, tr, esp)[0] for s in segs]
            res.append((float(np.median(sc)), spec, tr, esp))
res.sort(key=lambda r: -r[0])
_, spec, tr, esp = res[0]
# atribuição palavra->trecho por programação dinâmica (casando texto re-renderizado x máscara)
tam0 = int(np.median([encaixa_s(s, spec, tr, esp)[1][0] for s in segs if encaixa_s(s, spec, tr, esp)[1]]))
al = alinha(TODOS, ws, spec, tr, esp, W, tam0)
for s, idx in zip(TODOS, al): s["pal"] = [ws[i]["w"] for i in idx]
segs = sorted([s for s in TODOS if s["pal"]], key=lambda s: -s["est"].sum())[:10]
res = []
for spec in CATALOGO:
    for tr in (-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.05, 0.08, 0.12):
        for esp in (0.2, 0.5, 1.0, 1.6):
            sc = [encaixa_s(s, spec, tr, esp)[0] for s in segs]
            res.append((float(np.median(sc)), spec, tr, esp))
res.sort(key=lambda r: -r[0])
print("top fontes:"); [print(f"  {r[0]:.3f} {r[1]} tr={r[2]} esp={r[3]}") for r in res[:6]]
_, spec, tr, esp = res[0]
fits = [encaixa_s(s, spec, tr, esp) for s in segs]
tam = int(np.median([f[1][0] for f in fits if f[1]])); base = int(np.median([f[1][2] for f in fits if f[1]]))
cxm = float(np.median([f[1][1] for f in fits if f[1]]))
# segunda passada do alinhamento com a fonte final
al = alinha(TODOS, ws, spec, tr, esp, W, tam)
for s, idx in zip(TODOS, al): s["pal"] = [ws[i]["w"] for i in idx]
ious = [encaixa_s(s, spec, tr, esp)[0] for s in TODOS if s["pal"]]

# traço e sombra MEDIDOS: a partir da borda da letra, conta quantos px escuros seguidos há para cada lado
# (só vale quando, depois do escuro, o fundo é claro o bastante pra distinguir o fim do contorno)
cap = cv2.VideoCapture(f"v{v}.mp4"); runs = {"esq": [], "dir": [], "cima": [], "baixo": []}
for s in TODOS[::2]:
    cap.set(cv2.CAP_PROP_POS_FRAMES, (s["ini"] + s["fim"]) // 2); ok, fr = cap.read()
    c = fr[y0:y1]; lum = c.max(2).astype(int); est = s["est"]
    for nome, arr, msk in (("esq", lum[:, ::-1], est[:, ::-1]), ("dir", lum, est), ("baixo", lum.T, est.T), ("cima", lum.T[:, ::-1], est.T[:, ::-1])):
        for r in range(arr.shape[0]):
            row, mr = arr[r], msk[r]
            ed = np.where(mr[:-1] & ~mr[1:])[0]  # saída da letra
            for e in ed:
                k = e + 1; n = 0
                while k < len(row) and row[k] < 90 and not mr[k]: k += 1; n += 1
                if 0 < n < 25 and k < len(row) and row[k] > 120 and not mr[k]: runs[nome].append(n)
med = {k: (float(np.median(v)) if v else None) for k, v in runs.items()}
sw = int(round(min(x for x in med.values() if x))) - 1
dx = max(0, int(round(med["dir"] - med["esq"]))); dy = max(0, int(round(med["baixo"] - med["cima"])))
print("contorno medido (px escuros a partir da letra):", med, "-> traço", sw, "sombra", (dx, dy))
pix = []
for s in TODOS[::3]:
    cap.set(cv2.CAP_PROP_POS_FRAMES, (s["ini"] + s["fim"]) // 2); ok, fr = cap.read(); pix.append(fr[y0:y1][cv2.erode(s["est"].astype(np.uint8), np.ones((3, 3))) > 0])
pix = np.concatenate(pix).astype(int)
bri = pix[(pix.min(1) > 170) & (np.ptp(pix, 1) < 60)]; yel = pix[(pix[:, 2] > 160) & (pix[:, 1] > 160) & (pix[:, 0] < 120)]
branco = np.median(bri, 0)[::-1].astype(int).tolist() if len(bri) else [255, 255, 255]
amarelo = np.median(yel, 0)[::-1].astype(int).tolist() if len(yel) > 200 else None
est = {"fonte": spec, "tam": tam, "tr": tr, "esp": esp, "stroke": sw, "sombra": [dx, dy], "cor_traco": [0, 0, 0],
       "branco": branco, "amarelo": amarelo, "base": base, "cx": cxm, "iou_fonte_top10": res[0][0],
       "iou_medio_todos": float(np.mean(ious)), "contorno_medido": med,
       "alinhamento": {str(int(s["ini"])): idx for s, idx in zip(TODOS, al)}, "seg_ajuste": round(time.time() - t0, 1)}
json.dump(est, open(f"estilo{v}.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: est[k] for k in est if k != "alinhamento"}, ensure_ascii=False))
for s in TODOS: print(f'  {s["ini"]:4d}-{s["fim"]:4d}  {" ".join(s["pal"])}')
