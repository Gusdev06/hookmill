"""Op `placa_headline` (troca-texto-queimado-v1 §15.5.3, §16.2 A2). Dono: video.

Headline solta: apaga o texto antigo com TELEA r5 só nos quadros do intervalo; fora dele, só recodifica. Roda por
pedaço [ini, fim) com GOP fechado, para o `juntar` emendar com -c copy. A2: fantasma medido na própria placa.
"""
import numpy as np
import cv2

from comum import sonda, quadros, codificador, matriz_de, r2
from texto import fantasma
import fontes


def mascara(video, info, p):
    """Letras (mínimo do intervalo > brilho) + letras antigas redesenhadas na fonte medida + retângulo do emoji,
    dilatada em `dil` (ímpar, round(17 × W / 1080)). Devolve (máscara do quadro, molde sem emoji para o A2)."""
    W, H = info["w"], info["h"]
    rx, ry, rw, rh = p["roi"]
    mn = None
    for g in quadros(video, info, ini=p["startFrame"], n=p["endFrame"] - p["startFrame"], roi=(rx, ry, rw, rh), cinza=True):
        mn = g if mn is None else np.minimum(mn, g)
    letra = np.zeros((H, W), np.uint8)
    letra[ry:ry + rh, rx:rx + rw] = (mn > p["brilho"]).astype(np.uint8) * 255
    lay = p.get("redesenho")
    if lay:
        a = fontes.desenhar(lay["fontId"], lay["lines"], W, H, lay["sz"], lay["pitch"], lay["base"], lay["cxs"], lay.get("tr", 0))
        letra[a > .08] = 255
    molde = letra.copy()
    e = p.get("emoji")
    if e:
        x0, y0, x1, y1 = e
        molde[max(0, y0 - 2):y1 + 3, max(0, x0 - 2):x1 + 3] = 0
        letra[max(0, y0 - 2):y1 + 3, max(0, x0 - 2):x1 + 3] = 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (p["dil"], p["dil"]))
    return cv2.dilate(letra, k), molde


def gerar(ev, video="video.mp4", saida="placa.mp4"):
    info = sonda(video)
    W, H, fps = info["w"], info["h"], info["fps"]
    mat = matriz_de(info)
    ini, fim = int(ev.get("ini", 0)), int(ev.get("fim") or info["n"])
    a, b = int(ev["startFrame"]), int(ev["endFrame"])
    m, molde = mascara(video, info, ev)
    ys, xs = np.where(m > 0)
    if len(ys) == 0:
        raise ValueError("máscara vazia")
    marg = 12   # TELEA r5 só olha a vizinhança: basta o recorte em volta do buraco
    cx0, cy0 = max(0, xs.min() - marg), max(0, ys.min() - marg)
    cx1, cy1 = min(W, xs.max() + 1 + marg), min(H, ys.max() + 1 + marg)
    mc = m[cy0:cy1, cx0:cx1]
    enc = codificador(saida, W, H, fps, mat=mat, faixa=info["faixa"], crf=str(ev.get("crf", 16)))
    fant = []
    n = 0
    for k, f in enumerate(quadros(video, info, ini=ini, n=fim - ini, mat=mat)):
        i = ini + k
        if a <= i < b:
            f[cy0:cy1, cx0:cx1] = cv2.inpaint(f[cy0:cy1, cx0:cx1], mc, 5, cv2.INPAINT_TELEA)
            if (i - a) % 10 == 0:
                rx, ry, rw, rh = ev["roi"]
                g = cv2.cvtColor(f[ry:ry + rh, rx:rx + rw], cv2.COLOR_BGR2GRAY)
                mm, cc = fantasma(g, molde[ry:ry + rh, rx:rx + rw])
                fant.append(dict(quadro=i, media=r2(mm, 2), corr=r2(cc, 4)))
        enc.stdin.write(f.tobytes())
        n += 1
    enc.stdin.close()
    if enc.wait() != 0:
        raise RuntimeError("x264 falhou")
    return dict(quadros=n, ini=ini, fim=fim, mascara_px=int((m > 0).sum()), fantasma=fant,
                fantasma_pior_media=max((abs(x["media"]) for x in fant), default=0.0),
                fantasma_pior_corr=max((x["corr"] for x in fant), default=0.0))


def fantasma_original(video, info, ev):
    """Mesma medida no original (referência: a S4 mediu 125,7 e corr 0,784 nas letras antigas)."""
    m, molde = mascara(video, info, ev)
    rx, ry, rw, rh = ev["roi"]
    g = next(quadros(video, info, ini=ev["startFrame"], n=1, roi=(rx, ry, rw, rh), cinza=True))
    mm, cc = fantasma(g, molde[ry:ry + rh, rx:rx + rw])
    return dict(media=r2(mm, 2), corr=r2(cc, 4))
