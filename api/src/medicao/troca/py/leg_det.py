#!/usr/bin/env python3
"""
leg_det.py (troca-texto §15.6, dono: video; cópia do detectar.py da S1 com a cor pelo ffmpeg e as medidas dos portões) — acha sozinho a faixa da legenda queimada e os trechos (troca de frase).
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

from comum import sonda, matriz_de, FFMPEG, quadros as _quadros

_INFO = {}


def info_de(path):
    if path not in _INFO:
        _INFO[path] = sonda(path)
    return _INFO[path]


def probe(path):
    i = info_de(path)
    return i["w"], i["h"]


def frames(path, W=None, H=None, ini=0, qtd=None, roi=None, passo=1):
    """Quadros BGR de [ini, ini+qtd) pelo ffmpeg com a matriz de cor da origem (§15.6.6: nunca cv2.VideoCapture), passthrough.
    ini: busca por tempo ANTES da entrada (exata em CFR; a versão com `trim` decodificava tudo desde o início a cada chamada e custou 8 s só
    no contorno do 02). roi=(y0, y1): só as linhas [y0, y1) saem (o recorte vai no YUV, antes da conversão, em linhas pares: bem mais barato que
    converter o quadro inteiro). passo=k: 1 quadro a cada k (o `select` fica antes da conversão)."""
    import subprocess
    info = info_de(path); mat = matriz_de(info); w, h = info["w"], info["h"]
    vf = []
    if passo > 1:
        vf.append(f"select='not(mod(n\\,{passo}))'")
    sl = slice(None)
    if roi:
        y0, y1 = max(0, int(roi[0])), min(h, int(roi[1]))
        a = y0 - (y0 % 2); b = min(h, y1 + (y1 % 2)); vf.append(f"crop={w}:{b - a}:0:{a}")
        sl = slice(y0 - a, y0 - a + (y1 - y0)); h = b - a
    vf.append(f"scale=in_color_matrix={mat}:in_range={info['faixa']}:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24")
    cmd = [FFMPEG, "-v", "error", "-nostdin"]
    if ini:
        cmd += ["-ss", "%.6f" % ((ini - 0.5) / info["fps"])]
    cmd += ["-i", path, "-vf", ",".join(vf)]
    if qtd is not None:
        cmd += ["-frames:v", str(qtd)]
    cmd += ["-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=w * h * 3 * 2)
    tam = w * h * 3
    try:
        while True:
            b_ = p.stdout.read(tam)
            if len(b_) < tam:
                break
            f = np.frombuffer(b_, np.uint8).reshape(h, w, 3)
            yield np.ascontiguousarray(f[sl]) if roi else f.copy()
    finally:
        p.stdout.close(); p.kill(); p.wait()


def miniaturas(path, tw=64, th=114):
    """Miniaturas cinza (th × tw, int16) de todos os quadros, para os cortes de tomada: o ffmpeg já entrega pequeno e em cinza (faixa cheia),
    sem converter nem redimensionar o quadro inteiro em Python."""
    import subprocess
    info = info_de(path)
    cmd = [FFMPEG, "-v", "error", "-nostdin", "-i", path, "-vf", f"scale={tw}:{th}:flags=area:in_range={info['faixa']}:out_range=pc,format=gray",
           "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out = []
    try:
        while True:
            b = p.stdout.read(tw * th)
            if len(b) < tw * th:
                break
            out.append(np.frombuffer(b, np.uint8).reshape(th, tw).astype(np.int16))
    finally:
        p.stdout.close(); p.kill(); p.wait()
    return out


K6 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))

def candidato(f, caixa=False):
    b, g, r = f[..., 0].astype(np.int16), f[..., 1].astype(np.int16), f[..., 2].astype(np.int16)
    mx = np.maximum(np.maximum(b, g), r); mn = np.minimum(np.minimum(b, g), r)
    claro = ((mn > 185) & (mx - mn < 60)) | ((r > 170) & (g > 170) & (b < 120))
    if caixa:
        claro |= ((b > 140) & (b - r > 50)) | ((g > 140) & (b > 120) & (r < 120))  # caixa azul -> verde-água
        claro |= (r > 110) & (r - g > 70) & (r - b > 50) & (g < 90)   # caixa vermelha/vinho (F2: 37); a roxa já entra pelo azul
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

def escolher_faixa(path, caixa, words, fps, H):
    """Acha a faixa da LEGENDA, não de qualquer texto fixo (headline, caixa do topo, CTA): a legenda muda junto com a fala, então entre os blocos
    de linhas com texto (candidato claro com contorno escuro) vale o que MAIS troca de conteúdo perto do início de uma palavra da transcrição.
    Texto parado por muitos segundos (headline) quase não troca e perde. Bloco com mais de 30 % da altura (quadro inteiro) nunca é legenda.
    Sem palavras, só a regra do bloco mais frequente (comportamento antigo, mas com o teto de altura). Devolve (y0, y1, info) ou (None, None, info)."""
    hist = np.zeros(H); amostras = []; n = 0
    for f in frames(path, passo=5):
        c = candidato(f, caixa); hist += (c.sum(1) > 6); n += 1
        amostras.append(cv2.resize(c.astype(np.uint8), (max(1, c.shape[1] // 4), max(1, c.shape[0] // 4)), interpolation=cv2.INTER_AREA) > 0)
    info = {"blocos": []}
    if n == 0 or hist.max() <= 0:
        return None, None, info
    ini = np.array([w["ini"] for w in words], float) if words else np.zeros(0)
    if len(ini) and len(amostras) > 3:
        # linhas da legenda = onde o conteúdo MUDA perto do início das palavras (e não muda no resto do tempo): mudança líquida por linha
        perto = np.array([bool(np.min(np.abs(ini + 0.15 - k * 5 / fps)) <= 0.4) for k in range(len(amostras))])
        liq = np.zeros(amostras[0].shape[0]); np_, nf_ = 0, 0; ac_p = np.zeros_like(liq); ac_f = np.zeros_like(liq)
        for k in range(1, len(amostras)):
            d = (amostras[k] ^ amostras[k - 1]).sum(1).astype(float)
            if perto[k]: ac_p += d; np_ += 1
            else: ac_f += d; nf_ += 1
        liq = ac_p / max(1, np_) - ac_f / max(1, nf_)
        liq = np.convolve(liq, np.ones(3) / 3, mode="same")
        if liq.max() <= 0:
            return None, None, info
        rows = np.where(liq > 0.4 * liq.max())[0] * 4
    else:
        rows = np.where(hist > 0.08 * hist.max())[0]
    if len(rows) == 0:
        return None, None, info
    blocos = [(int(g[0]), int(g[-1]) + (3 if len(ini) else 0)) for g in np.split(rows, np.where(np.diff(rows) > max(10, int(0.04 * H)))[0] + 1) if len(g)]
    blocos = [bl for bl in blocos if bl[1] - bl[0] + 1 <= 0.30 * H]
    if not blocos:
        return None, None, info
    # velocidade de troca de cada bloco e quantas trocas caem perto do início de uma palavra
    pontuados = []
    for a, b in blocos:
        a4, b4 = a // 4, max(a // 4 + 1, b // 4 + 1)
        sig = [m[a4:b4] for m in amostras]; trocas = []
        for k in range(1, len(sig)):
            u = int((sig[k] ^ sig[k - 1]).sum()); d = max(int(sig[k].sum()), int(sig[k - 1].sum()), 1)
            if u / d > 0.35: trocas.append(k * 5 / fps)
        casadas = sum(1 for t in trocas if len(ini) and np.min(np.abs(ini + 0.15 - t)) <= 0.4)
        pontuados.append({"y": [a, b], "trocas": len(trocas), "casadas": casadas, "peso": float(hist[a:b + 1].sum())})
    info["blocos"] = pontuados
    if len(ini):
        best = max(pontuados, key=lambda p: (p["casadas"], p["peso"]))
        if best["casadas"] < max(3, 0.15 * len(ini)):
            return None, None, info   # nada troca junto com a fala: não é legenda (ou não dá para saber qual é)
    else:
        best = max(pontuados, key=lambda p: p["peso"])
    a, b = best["y"]
    return max(0, a - 30), min(H, b + 30), info


def detectar(path, caixa=False, faixa=None, words=None):
    """Mesmo método do S2. Diferenças de execução: o passo 1 pede só 1 de cada 5 quadros ao ffmpeg; o passo 2 calcula também
    as miniaturas que o placa.py usava para achar os cortes de tomada (mesma fórmula), e por isso a placa não decodifica de novo.
    faixa=[y0, y1]: pula o passo 1, como o produto faria com o captionBox da leitura (§3.2). words = [{ini, fim}] em s (para escolher a faixa
    da legenda pela fala; ver escolher_faixa). Sem faixa achada: ValueError('sem_faixa')."""
    W, H = probe(path); t0 = time.time(); info_faixa = {}
    if faixa: y0, y1 = int(faixa[0]), int(faixa[1]); t_faixa = 0.0
    else:
        y0, y1, info_faixa = escolher_faixa(path, caixa, words, info_de(path)["fps"], H)
        t_faixa = time.time() - t0
        if y0 is None:
            raise ValueError("sem_faixa")
    t1 = time.time(); masks = []; th = []; lap = []
    KA, KB = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    for f in frames(path, W, H, roi=(y0, y1)):
        cm = candidato(f, caixa)
        masks.append(np.packbits(cm))
        # §15.6.1 `fundo`: |Laplaciano| médio no anel em volta das letras (a medida `detalhe` do portoes.py da F0), só com letra no quadro
        if cm.sum() >= 80 and len(lap) % 1 == 0:
            g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY); mu = cm.astype(np.uint8)
            ring = (cv2.dilate(mu, KA) > 0) & (cv2.dilate(mu, KB) == 0)
            lap.append(float(np.abs(cv2.Laplacian(g, cv2.CV_32F, ksize=3))[ring].mean()) if ring.sum() > 200 else np.nan)
        else:
            lap.append(np.nan)
    th = miniaturas(path); th = (th[:len(masks)] + [th[-1]] * (len(masks) - len(th))) if th else [np.zeros((114, 64), np.int16)] * len(masks)
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
            # 2ª linha da legenda (F2, 11/11): bloco acima ou abaixo da linha principal, de altura parecida e com cobertura horizontal em comum
            bx0, bx1 = st[big, 0], st[big, 0] + st[big, 2]
            for k in range(1, n_):
                if k in keep or st[k, 4] < 0.1 * st[big, 4] or st[k, 3] > 1.6 * bh: continue
                cy = st[k, 1] + st[k, 3] / 2
                if abs(cy - (by + bh / 2)) > 2.4 * bh: continue
                ov = min(bx1, st[k, 0] + st[k, 2]) - max(bx0, st[k, 0])
                if ov >= 0.3 * min(st[big, 2], st[k, 2]): keep.append(k)
            est &= np.isin(lab, keep)
        ys, xs = np.where(est)
        segs.append({"ini": a, "fim": b, "vazio": False, "est": est,
                     "bbox": [int(ys.min()) + y0, int(ys.max()) + y0, int(xs.min()), int(xs.max())] if len(ys) else None})
    # §15.6.1 `animated`: largura e altura da máscara dentro do trecho, SÓ junto da máscara estável (o resto da faixa tem fundo claro com
    # contorno escuro que não é letra e varia por quadro: a 1ª versão media 0,96 no 13, aprovado)
    qw = np.zeros(N, np.int32); qh = np.zeros(N, np.int32); KP = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    for s_ in segs:
        if s_["vazio"]:
            continue
        near = cv2.dilate(s_["est"].astype(np.uint8), KP) > 0
        for i in range(s_["ini"], s_["fim"]):
            mm = un(i) & near
            ys_, xs_ = np.where(mm.any(1))[0], np.where(mm.any(0))[0]
            if len(ys_):
                qh[i] = ys_.max() - ys_.min() + 1; qw[i] = xs_.max() - xs_.min() + 1
    # cortes de tomada: mesma fórmula do placa.py
    dth = np.array([0] + [np.abs(th[i] - th[i - 1]).mean() for i in range(1, N)]); med = np.median(dth) + 1
    lum = np.array([x.mean() for x in th]); escuro = lum < 22
    tom = [0] + [i for i in range(1, N) if (dth[i] > 14 and dth[i] > 5 * med) or escuro[i] != escuro[i - 1]] + [N]
    t_seg = time.time() - t1
    d = dict(y0=int(y0), y1=int(y1), W=W, H=H, N=N, segs=np.array(segs, dtype=object), tomadas=np.array(tom), bw=qw, bh=qh, lap=np.array(lap, np.float32), area=area)
    info = {"faixa_blocos": info_faixa.get("blocos"), "faixa": [int(y0), int(y1)], "quadros": N, "trechos": len(segs), "trechos_com_texto": sum(not s["vazio"] for s in segs),
            "tomadas": [int(x) for x in tom], "t_faixa_s": round(t_faixa, 2), "t_mascaras_s": round(t_masc, 2), "t_trechos_s": round(t_seg, 2)}
    return d, info
