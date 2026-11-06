#!/usr/bin/env python3
"""
trocar.py <id> <saida_dir> [--caixa] — remove a legenda queimada trecho a trecho e escreve a nova por cima.
Variantes gravadas (todas com o mesmo inpaint, menos N):
  limpo : só a remoção (TELEA na pegada da legenda antiga: letra + contorno + sombra, dilatada) — mostra o borrão cru
  A     : limpo + legenda nova FIEL (mesmo texto da fala, mesma fonte/traço/sombra/cor/karaokê medidos)
  C     : limpo + legenda nova fiel com traço +2 px  (cobre mais; o borrão só fica visível onde a nova não cobre)
  V     : limpo + legenda nova com destaque DIFERENTE (caixa magenta na palavra ativa; no vídeo com caixa: palavra amarela sem caixa)
  N     : SEM remoção, só a legenda fiel com traço +2 por cima do original (o que vaza da antiga)
Saída: vídeos sem áudio + metricas.json (área de borrão visível por variante).
"""
import sys, os, json, time, subprocess, numpy as np, cv2
from PIL import Image
from leg import *
from detectar import candidato, probe, frames

v, OUT = sys.argv[1], sys.argv[2]; CAIXA = "--caixa" in sys.argv; os.makedirs(OUT, exist_ok=True)
D = np.load(f"d{v}.npz", allow_pickle=True); E = json.load(open(f"estilo{v}.json"))
y0, y1, W, H = int(D["y0"]), int(D["y1"]), int(D["W"]), int(D["H"]); Hb = y1 - y0
ws = palavras_whisper(f"w{v}.json"); FPS = 30; segs = list(D["segs"])
E["blur"] = 1.0 if CAIXA else 0.6
if CAIXA:
    E.update({"caixa_cor": [[27, 115, 231], [95, 218, 175]], "caixa_alt": [43, 12], "caixa_pad": 8, "caixa_raio": 5, "caixa_sombra": 3})
AMARELO = E["amarelo"] or [255, 230, 0]; BRANCO = E["branco"]; MAGENTA = [[255, 45, 122], [255, 45, 122]]
t0 = time.time()

# 1. resolve cada trecho: palavras + posição + máscara (trecho curto/estranho herda do vizinho)
alt = [s["bbox"][1] - s["bbox"][0] for s in segs if not s["vazio"] and s["bbox"]]
hmed = float(np.median(alt))
def bom(s): return (not s["vazio"]) and s["bbox"] and s["est"].sum() > 300 and s["fim"] - s["ini"] >= 5
usadas = set()
for s in segs:
    idx = E["alinhamento"].get(str(int(s["ini"])))
    s["idx"] = idx if idx else None
    if idx: usadas |= set(idx)
for i, s in enumerate(segs):
    if s["vazio"]: continue
    if not bom(s):
        viz = [j for j in (i + 1, i - 1, i + 2, i - 2) if 0 <= j < len(segs) and bom(segs[j])]
        if viz: s["herda"] = viz[0]
for s in segs:
    if s["vazio"] or s.get("herda") is not None or s["idx"]: continue
    # trecho com legenda mas sem palavra (ex.: número escrito diferente): pega as palavras pelo tempo
    s["idx"] = [k for k, w in enumerate(ws) if s["ini"] / FPS - 0.15 <= (w["ini"] + w["fim"]) / 2 < s["fim"] / FPS + 0.15] or None

def blocos_palavra(est, n):
    """divide a máscara em n palavras pelas colunas vazias (o espaço entre palavras); devolve centros ou None"""
    col = est.any(0); xs = np.where(col)[0]
    if len(xs) == 0: return None
    gaps = []; k = xs[0]
    for a, b in zip(xs[:-1], xs[1:]):
        if b - a > 1: gaps.append((b - a, a, b))
    if len(gaps) < n - 1: return None
    gaps = sorted(sorted(gaps, reverse=True)[: n - 1], key=lambda g: g[1])
    if n > 1 and gaps[-1][0] < 0.08 * E["tam"]: return None  # o menor "espaço" escolhido é pequeno demais: é vão de letra
    lim = [xs[0]] + [x for g in gaps for x in (g[1], g[2])] + [xs[-1]]
    return [(lim[2 * i] + lim[2 * i + 1]) / 2 for i in range(n)]

for s in segs:
    if s["vazio"] or s.get("herda") is not None or not s["idx"]: continue
    pal = [ws[k]["w"] for k in s["idx"]]
    iou, fit = encaixa(s["est"], pal, E["fonte"], E["tr"], E["esp"], W, E["tam"])
    tam = fit[0] if fit and abs(fit[0] - E["tam"]) <= 0.12 * E["tam"] else E["tam"]
    ys, xs = np.where(s["est"])
    if not fit or iou < 0.35:  # texto não bate (fala != legenda): posição pela própria máscara
        fit = (tam, (xs.min() + xs.max()) / 2, int(np.percentile(ys, 97)) + 1)
    cen = blocos_palavra(s["est"], len(pal))
    if cen is not None:  # só usa a posição palavra a palavra se ela casar melhor com a original do que a linha inteira
        e = {"fonte": E["fonte"], "tam": tam, "tr": E["tr"], "esp": E["esp"]}
        def iou_de(c):
            m = np.array(render(W, Hb, pal, e, fit[1], fit[2], so_miolo=True, centros=c))[..., 3] > 127
            return (m & s["est"]).sum() / max((m | s["est"]).sum(), 1)
        if iou_de(cen) <= iou_de(None) + 0.02: cen = None
    s["pos"] = {"tam": tam, "cx": fit[1], "base": fit[2], "centros": cen, "iou": iou}
for s in segs:
    if s.get("herda") is not None:
        h = segs[s["herda"]]
        for k in ("idx", "pos", "est"):
            if k in h: s[k] = h[k] if k != "est" else h["est"]
        s["est_proprio"] = False

# atraso legenda x fala: mediana de (início do trecho - início da 1a palavra dele). O karaokê usa o mesmo atraso.
atrasos = [s["ini"] / FPS - ws[s["idx"][0]]["ini"] for s in segs if not s["vazio"] and s.get("herda") is None and s.get("idx") and s.get("pos") and s["pos"]["iou"] > 0.6]
ATRASO = float(np.median(atrasos)) if atrasos else 0.0
print("atraso medido legenda-fala", round(ATRASO, 3), "s")
def retangulo(s):
    """linhas onde a máscara estável é densa (a linha de texto) + bbox da legenda nova, com folga do contorno"""
    est = s["est"]; rc = est.sum(1); rows = np.where(rc >= 0.15 * rc.max())[0]
    r0, r1 = rows.min(), rows.max(); cols = np.where(est[r0:r1 + 1].any(0))[0]
    a = np.array(render(W, Hb, [ws[j]["w"] for j in s["idx"]], dict(E, tam=s["pos"]["tam"]), s["pos"]["cx"], s["pos"]["base"], centros=s["pos"]["centros"]))[..., 3] > 0
    ya, xa = np.where(a); m = R + 6
    y_0, y_1 = min(r0, ya.min()) - m, max(r1, ya.max()) + m; x_0, x_1 = min(cols.min(), xa.min()) - m, max(cols.max(), xa.max()) + m
    if CAIXA: y_0 -= 10; y_1 += 10; x_0 -= 14; x_1 += 14
    ret = np.zeros((Hb, W), np.uint8); ret[max(0, y_0):y_1 + 1, max(0, x_0):x_1 + 1] = 1
    return ret
R = E["stroke"] + max(E["sombra"]) + 3 + (3 if CAIXA else 0)
for s in segs:
    if not s["vazio"] and s.get("idx") and s.get("pos"): s["ret"] = retangulo(s)
seg_de = np.full(int(D["N"]), -1)
for i, s in enumerate(segs):
    if not s["vazio"] and s.get("idx") and s.get("pos"): seg_de[s["ini"]:s["fim"]] = i
T_RES = time.time() - t0

# 2. cache das legendas novas por (trecho, palavra ativa, variante)
cache = {}
def legenda(i, ativa, var):
    k = (i, ativa, var)
    if k in cache: return cache[k]
    s = segs[i]; p = s["pos"]; pal = [ws[j]["w"] for j in s["idx"]]; e = dict(E, tam=p["tam"])
    cores = [BRANCO] * len(pal); caixa = None; extra = 0; cc = None
    if var in ("A", "C", "N"):
        if CAIXA: caixa = ativa
        else: cores[ativa] = AMARELO
        if var in ("C", "N"): extra = 2
    elif var == "V":
        if CAIXA: cores[ativa] = [255, 229, 0]
        else: caixa = ativa; cc = MAGENTA; e = dict(e, caixa_alt=[int(p["tam"] * 0.78), int(p["tam"] * 0.16)], caixa_pad=10, caixa_raio=10, caixa_sombra=0)
    im = np.array(render(W, Hb, pal, e, p["cx"], p["base"], cores=cores, caixa=caixa, extra_stroke=extra, centros=p["centros"], caixa_cor=cc)).astype(np.float32)
    cache[k] = (im[..., 2::-1].copy(), im[..., 3:4] / 255.0)
    return cache[k]

def compor(band, var, i, ativa):
    rgb, a = legenda(i, ativa, var)
    return np.clip(band * (1 - a) + rgb * a, 0, 255).astype(np.uint8), a[..., 0]

def writer(path):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS),
                             "-i", "-", "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", path], stdin=subprocess.PIPE)
VARS = ["limpo", "A", "C", "V", "N"]
wr = {k: writer(f"{OUT}/{k}.mp4") for k in VARS}
R = E["stroke"] + max(E["sombra"]) + 3 + (3 if CAIXA else 0)
KR = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * R + 1, 2 * R + 1))
K15 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)); K2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
met = {k: [] for k in ("A", "C", "V", "N")}; t_inp = 0; t_comp = 0; mask_dbg = None

for t, f in enumerate(frames(f"v{v}.mp4", W, H)):
    i = seg_de[t] if t < len(seg_de) else -1
    if i < 0:
        for k in VARS: wr[k].stdin.write(f.tobytes())
        continue
    s = segs[i]; band = f[y0:y1]
    # pegada da legenda antiga neste quadro: máscara estável do trecho + candidato do próprio quadro perto dela
    cand = candidato(band, CAIXA)
    perto = cv2.dilate(s["est"].astype(np.uint8), K15) > 0
    if CAIXA:  # a caixa de destaque anda de palavra em palavra: pega a do quadro, na linha do texto
        linha = cv2.dilate(s["est"].astype(np.uint8), np.ones((41, 121), np.uint8)) > 0
        perto |= linha
    T = s["est"] | (cand & perto)
    escuro = band.max(2) < 85
    Fp = (cv2.dilate(T.astype(np.uint8), K2) > 0) | (escuro & (cv2.dilate(T.astype(np.uint8), KR) > 0))
    Fp = cv2.dilate(Fp.astype(np.uint8), K2)
    Fp &= s["ret"]
    ys = np.where(Fp.any(1))[0]; r0, r1 = max(0, ys.min() - 12), min(Hb, ys.max() + 13)
    st = time.time()
    limpo = band.copy(); limpo[r0:r1] = cv2.inpaint(np.ascontiguousarray(band[r0:r1]), Fp[r0:r1], 5, cv2.INPAINT_TELEA)
    t_inp += time.time() - st; st = time.time()
    tt = t / FPS; idx = s["idx"]
    ativa = max([j for j, k in enumerate(idx) if ws[k]["ini"] + ATRASO <= tt + 0.017] or [0])
    outs = {"limpo": limpo}
    fl = limpo.astype(np.float32); fo = band.astype(np.float32); Fb = Fp > 0; Tb = cv2.dilate(T.astype(np.uint8), K2) > 0
    for k in ("A", "C", "V"):
        outs[k], a = compor(fl, k, i, ativa)
        met[k].append(float((Fb & (a < 0.5)).sum() / max(Fb.sum(), 1)))
    outs["N"], a = compor(fo, "N", i, ativa)
    met["N"].append(float((Tb & (a < 0.5)).sum() / max(Tb.sum(), 1)))
    t_comp += time.time() - st
    if t == (s["ini"] + s["fim"]) // 2 and mask_dbg is None and s["fim"] - s["ini"] > 15:
        mask_dbg = (Fp * 255).astype(np.uint8)
    for k in VARS:
        g = f.copy(); g[y0:y1] = outs[k]; wr[k].stdin.write(g.tobytes())
for w in wr.values(): w.stdin.close(); w.wait()
if mask_dbg is not None: cv2.imwrite(f"{OUT}/mascara-exemplo.png", mask_dbg)
res = {"quadros": int(t + 1), "quadros_com_legenda": int((seg_de >= 0).sum()), "t_resolver": round(T_RES, 1),
       "t_inpaint": round(t_inp, 1), "t_compor": round(t_comp, 1), "t_total": round(time.time() - t0, 1),
       "borrao_visivel_medio_%": {k: round(100 * float(np.mean(x)), 1) for k, x in met.items()},
       "borrao_visivel_p95_%": {k: round(100 * float(np.percentile(x, 95)), 1) for k, x in met.items()},
       "trechos": [{"ini": int(s["ini"]), "fim": int(s["fim"]), "texto": " ".join(ws[j]["w"] for j in s["idx"]) if s.get("idx") else None,
                    "herda": s.get("herda"), "iou": round(s["pos"]["iou"], 2) if s.get("pos") else None,
                    "pos_por_palavra": bool(s.get("pos") and s["pos"]["centros"])} for s in segs if not s["vazio"]]}
json.dump(res, open(f"{OUT}/metricas.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: res[k] for k in res if k != "trechos"}, ensure_ascii=False))
