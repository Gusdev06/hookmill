#!/usr/bin/env python3
"""
detectar.py — acha sozinho a faixa da legenda queimada e os trechos (troca de frase).
Uso: python3 detectar.py <video> <saida.npz> [--caixa]
Método:
  1. candidato a letra por quadro = pixel CLARO (branco: min(RGB)>185 e pouca saturação; ou amarelo: R,G>170, B<120;
     com --caixa também a caixa de destaque azul/verde-água) que fica a <=6 px de um pixel ESCURO (max(RGB)<70),
     ou seja, letra clara com contorno preto. Fundo claro sem contorno (parede, suéter, vela) não entra.
  2. faixa = linhas da tela onde esse candidato aparece com frequência (amostra 1 de cada 5 quadros).
  3. trecho = sequência de quadros cuja máscara de candidato muda pouco do quadro anterior
     (diferença simétrica / área < 0.35). Troca de cor da palavra (branco->amarelo) não muda a máscara,
     então o karaokê não quebra o trecho; troca de frase quebra.
  4. por trecho: máscara ESTÁVEL = pixel candidato em >=50% dos quadros do trecho (o princípio "claro e parado"
     do references/limpar-texto-video.md, aplicado só dentro do trecho).
"""
import sys, subprocess, json, time, numpy as np, cv2

def probe(path):
    o = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                                 "stream=width,height", "-of", "csv=p=0", path]).decode().strip().split(",")
    return int(o[0]), int(o[1])

def frames(path, W, H, ini=0, qtd=None, vf=None, fps=30):
    """S1: ini/qtd = janela em quadros (-ss antes do -i, exato em CFR). vf = filtro antes do bgr24. Fecha o ffmpeg ao terminar."""
    cmd = ["ffmpeg", "-v", "error"]
    if ini: cmd += ["-ss", "%.6f" % (ini / fps)]
    cmd += ["-i", path]
    if vf: cmd += ["-vf", vf, "-vsync", "0"]
    if qtd is not None: cmd += ["-frames:v", str(qtd)]
    cmd += ["-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
    n = W * H * 3
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n: break
            yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
    finally:
        p.stdout.close(); p.kill(); p.wait()

K6 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))

def candidato(f, caixa=False):
    b, g, r = f[..., 0].astype(np.int16), f[..., 1].astype(np.int16), f[..., 2].astype(np.int16)
    mx = np.maximum(np.maximum(b, g), r); mn = np.minimum(np.minimum(b, g), r)
    claro = ((mn > 185) & (mx - mn < 60)) | ((r > 170) & (g > 170) & (b < 120))
    if caixa:
        claro |= ((b > 140) & (b - r > 50)) | ((g > 140) & (b > 120) & (r < 120))  # caixa azul -> verde-água
    escuro = (mx < 70).astype(np.uint8)
    perto = cv2.dilate(escuro, K6) > 0
    semente = claro & perto
    # letra grossa: o miolo fica a >6 px do contorno. Reconstrói: componente claro que contém semente,
    # desde que tenha tamanho de letra/palavra (não pega parede/suéter claro inteiro)
    n, lab, st, _ = cv2.connectedComponentsWithStats(claro.astype(np.uint8), connectivity=4)
    if n <= 1: return semente
    tem = np.zeros(n, bool); tem[np.unique(lab[semente])] = True; tem[0] = False
    hmax = f.shape[0] if f.shape[0] < 400 else f.shape[0] // 6
    ok = tem & (st[:, 3] <= min(hmax, 140)) & (st[:, 4] <= 40000)
    return ok[lab] | semente

def detectar(path, caixa=False, faixa=None):
    """Mesmo método do S2. Diferenças de execução: o passo 1 pede só 1 de cada 5 quadros ao ffmpeg; o passo 2 calcula também
    as miniaturas que o placa.py usava para achar os cortes de tomada (mesma fórmula), e por isso a placa não decodifica de novo.
    faixa=[y0, y1]: pula o passo 1, como o produto faria com o captionBox da leitura (§3.2)."""
    W, H = probe(path); t0 = time.time()
    if faixa: y0, y1 = int(faixa[0]), int(faixa[1]); t_faixa = 0.0
    else:
        hist = np.zeros(H); n = 0
        for f in frames(path, W, H, vf="select='not(mod(n\\,5))'"):
            c = candidato(f, caixa); hist += (c.sum(1) > 6); n += 1
        t_faixa = time.time() - t0
        rows = np.where(hist > 0.3 * hist.max())[0]
        blocos = np.split(rows, np.where(np.diff(rows) > 8)[0] + 1)
        blk = max(blocos, key=lambda b: hist[b].sum())
        fraco = hist > 0.04 * hist.max(); a, b = blk[0], blk[-1]
        while a > 0 and fraco[max(0, a - 40):a].any(): a -= 1
        while b < H - 1 and fraco[b + 1:b + 41].any(): b += 1
        y0, y1 = max(0, a - 30), min(H, b + 30)
    t1 = time.time(); masks = []; th = []
    for f in frames(path, W, H):
        th.append(cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (64, 114), interpolation=cv2.INTER_AREA).astype(np.int16))
        masks.append(np.packbits(candidato(f[y0:y1], caixa)))
    N = len(masks); shp = (y1 - y0, W); t_masc = time.time() - t1; t1 = time.time()
    un = lambda i: np.unpackbits(masks[i])[: shp[0] * shp[1]].reshape(shp).astype(bool)
    area = np.zeros(N); dif = np.zeros(N); prev = None
    for i in range(N):
        m = un(i); area[i] = m.sum()
        if prev is not None:
            dif[i] = (m ^ prev).sum() / max(m.sum(), prev.sum(), 1)
        prev = m
    vazio = area < 80
    cortes = [0] + [i for i in range(1, N) if dif[i] > 0.35 or vazio[i] != vazio[i - 1]] + [N]
    segs = []
    for a, b in zip(cortes[:-1], cortes[1:]):
        if b <= a: continue
        if vazio[a:b].mean() > 0.5:
            segs.append({"ini": a, "fim": b, "vazio": True}); continue
        acc = np.zeros(shp, np.int32)
        for i in range(a, b): acc += un(i)
        est = acc >= max(1, 0.5 * (b - a))
        blob = cv2.morphologyEx(est.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 31), np.uint8))
        n_, lab, st, _ = cv2.connectedComponentsWithStats(blob)
        if n_ > 1:
            cand = [k for k in range(1, n_) if st[k, 2] >= 1.5 * st[k, 3]] or list(range(1, n_))
            big = max(cand, key=lambda k: st[k, 4]); by, bh = st[big, 1], st[big, 3]
            keep = [k for k in range(1, n_) if st[k, 4] >= 0.1 * st[big, 4] and st[k, 3] <= 1.6 * bh
                    and by <= st[k, 1] + st[k, 3] / 2 <= by + bh
                    and min(by + bh, st[k, 1] + st[k, 3]) - max(by, st[k, 1]) >= 0.5 * min(bh, st[k, 3])]
            est &= np.isin(lab, keep)
        ys, xs = np.where(est)
        segs.append({"ini": a, "fim": b, "vazio": False, "est": est,
                     "bbox": [int(ys.min()) + y0, int(ys.max()) + y0, int(xs.min()), int(xs.max())] if len(ys) else None})
    # cortes de tomada: mesma fórmula do placa.py
    dth = np.array([0] + [np.abs(th[i] - th[i - 1]).mean() for i in range(1, N)]); med = np.median(dth) + 1
    lum = np.array([x.mean() for x in th]); escuro = lum < 22
    tom = [0] + [i for i in range(1, N) if (dth[i] > 14 and dth[i] > 5 * med) or escuro[i] != escuro[i - 1]] + [N]
    t_seg = time.time() - t1
    d = dict(y0=int(y0), y1=int(y1), W=W, H=H, N=N, segs=np.array(segs, dtype=object), tomadas=np.array(tom))
    info = {"faixa": [int(y0), int(y1)], "quadros": N, "trechos": len(segs), "trechos_com_texto": sum(not s["vazio"] for s in segs),
            "tomadas": [int(x) for x in tom], "t_faixa_s": round(t_faixa, 2), "t_mascaras_s": round(t_masc, 2), "t_trechos_s": round(t_seg, 2)}
    return d, info
