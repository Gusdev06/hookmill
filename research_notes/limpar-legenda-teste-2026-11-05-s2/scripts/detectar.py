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

def frames(path, W, H):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         stdout=subprocess.PIPE, bufsize=W * H * 3 * 4)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)

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

def main():
    path, out = sys.argv[1], sys.argv[2]; caixa = "--caixa" in sys.argv
    W, H = probe(path); t0 = time.time()
    # passo 1: faixa
    hist = np.zeros(H); n = 0
    for i, f in enumerate(frames(path, W, H)):
        if i % 5 == 0:
            c = candidato(f, caixa)
            # só componentes "de texto": altura 8..H/8 px
            hist += (c.sum(1) > 6); n += 1
    rows = np.where(hist > 0.3 * hist.max())[0]
    blocos = np.split(rows, np.where(np.diff(rows) > 8)[0] + 1)
    blk = max(blocos, key=lambda b: hist[b].sum())
    # a legenda às vezes muda de altura num trecho: estende a faixa enquanto houver linha com >=4% de presença
    fraco = hist > 0.04 * hist.max(); a, b = blk[0], blk[-1]
    while a > 0 and fraco[max(0, a - 40):a].any(): a -= 1
    while b < H - 1 and fraco[b + 1:b + 41].any(): b += 1
    y0, y1 = max(0, a - 30), min(H, b + 30)
    # passo 2: máscara por quadro dentro da faixa
    masks = []
    for f in frames(path, W, H):
        masks.append(np.packbits(candidato(f[y0:y1], caixa)))
    N = len(masks); shp = (y1 - y0, W)
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
        # filtro de linha de texto: fecha as letras em blocos e fica só com o bloco principal e os alinhados a ele
        blob = cv2.morphologyEx(est.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 31), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(blob)
        if n > 1:
            # bloco principal = maior bloco com cara de linha de texto (mais largo que alto)
            cand = [k for k in range(1, n) if st[k, 2] >= 1.5 * st[k, 3]] or list(range(1, n))
            big = max(cand, key=lambda k: st[k, 4]); by, bh = st[big, 1], st[big, 3]
            keep = [k for k in range(1, n) if st[k, 4] >= 0.1 * st[big, 4] and st[k, 3] <= 1.6 * bh
                    and by <= st[k, 1] + st[k, 3] / 2 <= by + bh
                    and min(by + bh, st[k, 1] + st[k, 3]) - max(by, st[k, 1]) >= 0.5 * min(bh, st[k, 3])]
            est &= np.isin(lab, keep)
        ys, xs = np.where(est)
        segs.append({"ini": a, "fim": b, "vazio": False, "est": est,
                     "bbox": [int(ys.min()) + y0, int(ys.max()) + y0, int(xs.min()), int(xs.max())] if len(ys) else None})
    # trechos muito curtos (<3 quadros, animação de entrada) juntam com o seguinte
    np.savez_compressed(out, y0=y0, y1=y1, W=W, H=H, N=N, area=area, dif=dif,
                        segs=np.array([{k: v for k, v in s.items()} for s in segs], dtype=object),
                        masks=np.array(masks, dtype=object))
    print(json.dumps({"faixa": [int(y0), int(y1)], "quadros": N, "trechos": len(segs),
                      "trechos_com_texto": sum(not s["vazio"] for s in segs),
                      "curtos(<4q)": sum((s["fim"] - s["ini"]) < 4 for s in segs), "seg": round(time.time() - t0, 1)}))

if __name__ == "__main__":
    main()
