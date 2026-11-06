#!/usr/bin/env python3
"""escrever.py <id> <E0|E1|E2> <W1|W2|W3> <tr|cu|lo> <saida.mp4> <ini_s> <fim_s> [--inteiro saida2.mp4]
Escreve o texto novo sobre a placa, mede a letra antiga à vista no vídeo INTEIRO e grava um antes-depois curto com rótulo e áudio original.
W1 = mesmo tamanho e estilo. W2 = 75 %. W3 = caixa preta opaca atrás do texto, cobrindo a pegada antiga. E0 = não apaga nada (só faz sentido com W3)."""
import sys, json, time, subprocess, numpy as np, cv2
from PIL import Image, ImageDraw
from leg import *
from pegada import Legenda, cor_args
from detectar import candidato, frames
from textos import FRASES, T as TEX
v, EE, WW, TT, OUT, A, B = sys.argv[1:8]; A, B = float(A), float(B)
INT = sys.argv[sys.argv.index("--inteiro") + 1] if "--inteiro" in sys.argv else None
t0 = time.time(); FPS = 30; L = Legenda(v); E = dict(L.E); W, H, y0, y1, Hb = L.W, L.H, L.y0, L.y1, L.Hb; ws = palavras_whisper(f"w{v}.json")
Mz = np.load(f"m{v}.npz", allow_pickle=True); un = lambda a, t: np.unpackbits(np.asarray(a[t], np.uint8))[:Hb * W].reshape(Hb, W).astype(bool)
masks, letras = Mz["masks"], Mz["letras"]; N = len(masks); CAIXA = L.caixa
E["blur"] = 1.0 if CAIXA else 0.6
ESC = {"W1": 1.0, "W2": 0.75, "W3": 0.85}[WW]; tam = int(round(E["tam"] * ESC))
est = dict(E, tam=tam, stroke=max(2, int(round(E["stroke"] * ESC))), sombra=[int(round(x * ESC)) for x in E["sombra"]])
BR, AM = E["branco"], E["amarelo"] or [255, 230, 0]
if CAIXA: est.update(caixa_cor=[[27, 115, 231], [95, 218, 175]], caixa_alt=[int(43 * ESC), int(12 * ESC)], caixa_pad=8, caixa_raio=5, caixa_sombra=3)
if WW == "W3": est.update(stroke=0, sombra=[0, 0], blur=0)
# atraso legenda x fala medido nos trechos
atr = [int(k) / FPS - ws[idx[0]]["ini"] for k, idx in E["alinhamento"].items() if idx]; ATR = float(np.median(atr)); ATR = float(np.clip(ATR, 0, 0.4))
# paginação: frase -> páginas, cada uma cabe na largura; tempo proporcional a caracteres dentro do tempo da frase
LMAX = 0.90 * W; MAXL = 2 if TT == "lo" else 1
def largura(pal): return layout(pal, est["fonte"], tam, est["tr"], est["esp"])[1] + 2 * (est["stroke"] + 2)
paginas = []
fr = FRASES[v]; txt = TEX[v][TT]; assert len(fr) == len(txt)
for k, ((i, j), s) in enumerate(zip(fr, txt)):
    ini = ws[i]["ini"] + ATR; fim = ws[j]["fim"] + ATR
    if k + 1 < len(fr):
        px = ws[fr[k + 1][0]]["ini"] + ATR
        if px - fim < 0.35: fim = px
    pal = s.split(); pg = []; lin = []; pag = []
    for w in pal:
        if lin and (largura(lin + [w]) > LMAX or len(lin) >= 5):
            pag.append(lin); lin = []
            if len(pag) == MAXL: pg.append(pag); pag = []
        lin.append(w)
    if lin: pag.append(lin)
    if pag: pg.append(pag)
    total = sum(len(w) + 1 for p in pg for l in p for w in l); tc = ini
    for p in pg:
        pw = [w for l in p for w in l]; d = (fim - ini) * sum(len(w) + 1 for w in pw) / total
        tempos = []; x = tc
        for w in pw: tempos.append(x); x += d * (len(w) + 1) / sum(len(q) + 1 for q in pw)
        paginas.append({"lin": p, "pw": pw, "ini": tc, "fim": tc + d, "tempos": tempos}); tc += d
    assert abs(tc - fim) < 1e-6
pag_de = np.full(N, -1)
for i, p in enumerate(paginas):
    a, b = int(round(p["ini"] * FPS)), int(round(p["fim"] * FPS)); pag_de[a:min(b, N)] = i
if EE == "E0":  # sem apagar: página nunca sai de cena enquanto houver legenda antiga
    ult = -1
    for t in range(N):
        if pag_de[t] >= 0: ult = pag_de[t]
        elif ult >= 0: pag_de[t] = ult
    pri = pag_de[pag_de >= 0][0]; pag_de[pag_de < 0] = pri
# posição: centro vertical da linha antiga do trecho no meio da página
def centro_antigo(t):
    i = L.seg_de[min(t, N - 1)]
    if i < 0 or not L.segs[i]["usa"]:
        i = min(L.boas, key=lambda j: abs(L.segs[j]["ini"] - t))
    else: i = L.segs[i]["usa"][0]
    s = L.segs[i]; return (s["r0"] + s["r1"]) / 2
BOX = {}
def caixa_pagina(i):
    if i in BOX: return BOX[i]
    idx = np.where(pag_de == i)[0]; xs0, xs1, ys0, ys1 = [], [], [], []
    for t in idx[::2]:
        m = un(masks, t)
        if m.any():
            yy = np.where(m.any(1))[0]; xx = np.where(m.any(0))[0]; xs0.append(xx.min()); xs1.append(xx.max()); ys0.append(yy.min()); ys1.append(yy.max())
    BOX[i] = (np.percentile(xs0, 3), np.percentile(xs1, 97), np.percentile(ys0, 3), np.percentile(ys1, 97)) if xs0 else None
    return BOX[i]
cache = {}
def legenda(i, ativa):
    k = (i, ativa)
    if k in cache: return cache[k]
    p = paginas[i]; mid = int((p["ini"] + p["fim"]) / 2 * FPS); c = centro_antigo(mid); nl = len(p["lin"]); ent = int(tam * 1.12)
    cap = 0.36 * tam; bases = [int(c + cap - (nl - 1) * ent / 2 + q * ent) for q in range(nl)]
    im = Image.new("RGBA", (W, Hb), (0, 0, 0, 0)); o = 0; cx = W / 2
    if WW == "W3":
        bb = []
        for lin, b in zip(p["lin"], bases): l = largura(lin); bb.append((cx - l / 2, b - tam * 0.8, cx + l / 2, b + tam * 0.22))
        x0, y0_, x1, y1_ = min(q[0] for q in bb), min(q[1] for q in bb), max(q[2] for q in bb), max(q[3] for q in bb)
        f = caixa_pagina(i); pad = 14
        if f: x0, x1, y0_, y1_ = min(x0, f[0]), max(x1, f[1]), min(y0_, f[2]), max(y1_, f[3])
        d = ImageDraw.Draw(im); d.rounded_rectangle([int(x0 - pad), int(y0_ - pad * .6), int(x1 + pad), int(y1_ + pad * .6)], radius=14, fill=(12, 12, 12, 255))
    for lin, b in zip(p["lin"], bases):
        idx = list(range(o, o + len(lin))); ai = ativa - o if o <= ativa < o + len(lin) else None
        cores = [BR] * len(lin); cx_ = None
        if CAIXA and WW != "W3":
            cam = render(W, Hb, lin, est, cx, b, cores=cores, caixa=ai)
        else:
            if ai is not None: cores[ai] = AM
            cam = render(W, Hb, lin, est, cx, b, cores=cores)
        im.alpha_composite(cam); o += len(lin)
    a = np.array(im).astype(np.float32); cache[k] = (a[..., 2::-1].copy(), a[..., 3:4] / 255.0)
    return cache[k]
placa = {"E0": f"v{v}.mp4", "E1": f"placa-{v}-E1.mp4", "E2": f"placa-{v}-E2.mp4"}[EE]
NOMES = {"E0": "E0 nao apaga", "E1": "E1 TELEA", "E2": "E2 temporal"}; NW = {"W1": "W1 mesmo tamanho", "W2": "W2 75%", "W3": "W3 caixa"}; NT = {"tr": "traducao EN", "cu": "mais curta", "lo": "mais longa"}
rot = f"{v}  {NOMES[EE]} + {NW[WW]}  |  {NT[TT]}"
def enc(path, w, ini, dur):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{H}", "-r", str(FPS), "-i", "-", "-ss", str(ini), "-t", str(dur), "-i", f"v{v}.mp4",
        "-map", "0:v", "-map", "1:a", *cor_args(f"v{v}.mp4"), "-c:v", "libx264", "-crf", "19" if w > W else "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", path], stdin=subprocess.PIPE)
wsbs = enc(OUT, 2 * W + 8, A, B - A); wint = enc(INT, W, 0, 1e4) if INT else None
m1 = []; m2 = []; gorig = frames(f"v{v}.mp4", W, H); fa = int(A * FPS); fb = int(B * FPS); piores = []
for t, (fo, fp) in enumerate(zip(gorig, frames(placa, W, H))):
    f = fp.copy(); ba = fp[y0:y1]; i = pag_de[t] if t < N else -1; alpha = None
    if i >= 0:
        p = paginas[i]; tt = t / FPS; at = max([k for k, x in enumerate(p["tempos"]) if x <= tt + 0.017] or [0])
        rgb, alpha = legenda(i, at); f[y0:y1] = np.clip(ba * (1 - alpha) + rgb * alpha, 0, 255).astype(np.uint8)
    if t < N:
        Fp = un(masks, t); Tm = un(letras, t)
        if Fp.sum() > 30:
            cob = (alpha[..., 0] >= 0.5) if alpha is not None else np.zeros_like(Fp)
            vis = float((Fp & ~cob).sum() / Fp.sum()); m1.append(vis)
            # letra antiga ainda detectável na placa: o mesmo detector de letra (claro + contorno escuro) rodado no que sobrou
            res = candidato(ba, CAIXA) & cv2.dilate(Tm.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~cob
            m2.append(float(res.sum() / max(Tm.sum(), 1))); piores.append((vis, t))
    if wint: wint.stdin.write(f.tobytes())
    if fa <= t < fb:
        a, b = fo.copy(), f.copy()
        for q, txt_ in ((a, "ORIGINAL"), (b, rot)):
            cv2.rectangle(q, (0, H - 44), (W, H), (0, 0, 0), -1); cv2.putText(q, txt_, (10, H - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.62 if len(txt_) > 30 else 0.8, (255, 255, 255), 2, cv2.LINE_AA)
        wsbs.stdin.write(np.hstack([a, np.full((H, 8, 3), 255, np.uint8), b]).tobytes())
for w_ in (wsbs, wint):
    if w_: w_.stdin.close(); w_.wait()
pal_ = sum(len(p["pw"]) for p in paginas)
r = dict(id=v, E=EE, W=WW, T=TT, area_a_vista_media=round(100 * float(np.mean(m1)), 1), area_a_vista_p95=round(100 * float(np.percentile(m1, 95)), 1),
         letra_detectavel_media=round(100 * float(np.mean(m2)), 1), letra_detectavel_p95=round(100 * float(np.percentile(m2, 95)), 1),
         piores=[int(t) for _, t in sorted(piores, reverse=True)[::max(1, len(piores) // 40)][:8]], paginas=len(paginas), duas_linhas=sum(len(p["lin"]) > 1 for p in paginas), s=round(time.time() - t0, 1), arq=OUT)
print(json.dumps(r)); open("resultados.jsonl", "a").write(json.dumps(r) + "\n")
