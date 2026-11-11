"""leg_fontes.py — fontes e desenho da legenda (S1/S2, troca-texto §15.6). Dono: video. Cópia do leg.py da S1; muda só o caminho das
fontes (LEGENDA_FONTES_DIR ou ./fontes_legenda: TTFs OFL empacotados, nada de fonte do sistema, §15.7.3) e o catálogo sem as do Mac."""
import json, re, subprocess, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

import os
FONTES = (os.environ.get("LEGENDA_FONTES_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "fontes_legenda")).rstrip("/") + "/"
CATALOGO = [
    {"arq": "Poppins-Bold.ttf"}, {"arq": "Poppins-ExtraBold.ttf"}, {"arq": "Poppins-Black.ttf"},
    {"arq": "Montserrat-ExtraBold.ttf"}, {"arq": "Montserrat-Variable.ttf", "var": "Black"},
    {"arq": "Montserrat-Variable.ttf", "var": "Bold"}, {"arq": "Inter-Bold.ttf"}, {"arq": "TikTokSans-Bold.ttf"},
    {"arq": "Gabarito-Variable.ttf", "var": "Black"}, {"arq": "Gabarito-Variable.ttf", "var": "Bold"},
    {"arq": "Manrope-Variable.ttf", "var": "ExtraBold"},
    {"arq": "Archivo-w1000-900.ttf"}, {"arq": "Archivo-w1125-900.ttf"}, {"arq": "Archivo-w1125-700.ttf"},
    {"arq": "Archivo-w1250-700.ttf"}, {"arq": "Archivo-w1250-900.ttf"},
]
_cache = {}

def fonte(spec, sz):
    k = (json.dumps(spec, sort_keys=True), sz)
    if k not in _cache:
        arq = spec["arq"] if spec["arq"].startswith("/") else FONTES + spec["arq"]
        f = ImageFont.truetype(arq, sz, index=spec.get("index", 0))
        if spec.get("var"): f.set_variation_by_name(spec["var"])
        _cache[k] = f
    return _cache[k]

def limpa(w):
    return re.sub(r"[^\wÁÉÍÓÚÜÑáéíóúüñ$%]", "", w).upper()

def layout(palavras, spec, sz, tr, esp):
    """posição x (relativa ao início) de cada caractere; tr = tracking em fração do tamanho; esp = fator do espaço"""
    f = fonte(spec, sz); pos = []; x = 0.0; sp = f.getlength(" ") * esp
    for wi, w in enumerate(palavras):
        ini = x
        for ch in w:
            pos.append((wi, ch, x)); x += f.getlength(ch) + tr * sz
        pos.append(("fim", wi, ini, x - tr * sz))
        x += sp
    return pos, x - sp

def render(W, Hb, palavras, est, cx, base, cores=None, caixa=None, so_miolo=False, extra_stroke=0, centros=None, caixa_cor=None):
    """RGBA (Hb x W) com a linha. est = dict(fonte, tam, tr, esp, stroke, sombra[dx,dy], cor_traco, blur, caixa_*).
    cores = lista de cor RGB por palavra. caixa = índice da palavra com caixa de destaque (ou None)."""
    spec, sz = est["fonte"], est["tam"]; f = fonte(spec, sz)
    pos, larg = layout(palavras, spec, sz, est["tr"], est["esp"])
    x0 = cx - larg / 2
    if centros is not None and len(centros) == len(palavras):
        # cada palavra centrada no lugar da palavra original
        fins = {p[1]: (p[2], p[3]) for p in pos if p[0] == "fim"}; x0 = 0; novo = []
        for p in pos:
            wi = p[1] if p[0] == "fim" else p[0]; a, b = fins[wi]; off = centros[wi] - (a + b) / 2
            novo.append(("fim", wi, a + off, b + off) if p[0] == "fim" else (wi, p[1], p[2] + off))
        pos = novo
    im = Image.new("RGBA", (W, Hb), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    sw = est.get("stroke", 3) + extra_stroke; tc = tuple(est.get("cor_traco", (0, 0, 0)))
    dx, dy = est.get("sombra", (0, 0))
    cores = cores or [(255, 255, 255)] * len(palavras)
    if so_miolo:
        for p in pos:
            if p[0] != "fim": d.text((x0 + p[2], base), p[1], font=f, fill=(255, 255, 255, 255), anchor="ls")
        return im
    # caixa de destaque atrás da palavra
    cc = caixa_cor or est.get("caixa_cor")
    if caixa is not None and cc:
        for p in pos:
            if p[0] == "fim" and p[1] == caixa:
                a, b = x0 + p[2], x0 + p[3]
                top = base - est["caixa_alt"][0]; bot = base + est["caixa_alt"][1]; pad = est.get("caixa_pad", 6)
                bx0, bx1 = int(a - pad), int(b + pad)
                # sombra da caixa
                if est.get("caixa_sombra"):
                    sd = est["caixa_sombra"]; d.rounded_rectangle([bx0 + sd, top + sd, bx1 + sd, bot + sd], radius=est.get("caixa_raio", 4), fill=tc + (255,))
                grad = np.zeros((bot - top + 1, bx1 - bx0 + 1, 4), np.uint8)
                c0, c1 = np.array(cc[0]), np.array(cc[1])
                t = np.linspace(0, 1, grad.shape[1])[None, :, None]
                grad[..., :3] = (c0 * (1 - t) + c1 * t).astype(np.uint8); grad[..., 3] = 255
                m = Image.new("L", (grad.shape[1], grad.shape[0]), 0)
                ImageDraw.Draw(m).rounded_rectangle([0, 0, grad.shape[1] - 1, grad.shape[0] - 1], radius=est.get("caixa_raio", 4), fill=255)
                g = Image.fromarray(grad, "RGBA"); g.putalpha(m); im.alpha_composite(g, (bx0, top))
    # sombra (texto + traço deslocados)
    if dx or dy:
        sh = Image.new("RGBA", (W, Hb), (0, 0, 0, 0)); ds = ImageDraw.Draw(sh)
        for p in pos:
            if p[0] != "fim":
                ds.text((x0 + p[2] + dx, base + dy), p[1], font=f, fill=tc + (255,), anchor="ls", stroke_width=sw, stroke_fill=tc + (255,))
        im.alpha_composite(sh)
    # traço + preenchimento
    for p in pos:
        if p[0] != "fim":
            d.text((x0 + p[2], base), p[1], font=f, fill=tuple(cores[p[0]]) + (255,), anchor="ls", stroke_width=sw, stroke_fill=tc + (255,))
    if est.get("blur"): im = im.filter(ImageFilter.GaussianBlur(est["blur"]))
    return im

def palavras_whisper(path):
    d = json.load(open(path))
    return [{"w": limpa(w["word"]), "ini": w["start"], "fim": w["end"]} for s in d["segments"] for w in s["words"] if limpa(w["word"])]

def palavras_do_trecho(ws, t0, t1, delta=None):
    """palavras do trecho: com delta, as que começam (ini+delta) dentro do trecho; sem delta, pelo meio da palavra"""
    if delta is None: return [w for w in ws if t0 <= (w["ini"] + w["fim"]) / 2 < t1]
    return [w for w in ws if t0 <= w["ini"] + delta < t1]

def _desloc(a, b, maxd):
    """deslocamento d (|d|<=maxd) que maximiza a correlação do perfil b deslocado contra a"""
    best, bd = -1, 0
    for d in range(-maxd, maxd + 1):
        v = float((a * np.roll(b, d)).sum())
        if v > best: best, bd = v, d
    return bd

def encaixa(alvo, pal, spec, tr, esp, W, tam_ref=None):
    """melhor IoU do texto 'pal' contra a máscara 'alvo'. Tamanhos testados: o que bate a largura (±1) e, se houver,
    o tamanho de referência (±2). Posição por correlação dos perfis de linha e coluna. Devolve (iou, (tam, cx, base))."""
    ys, xs = np.where(alvo)
    if len(xs) == 0 or not pal: return 0.0, None
    Hb = alvo.shape[0]; larg_alvo = xs.max() - xs.min() + 1
    _, l = layout(pal, spec, 100, tr, esp)
    sz = max(8, int(round(100 * larg_alvo / max(l, 1))))
    tams = {sz - 1, sz, sz + 1}
    if tam_ref: tams = {t for t in tams if 0.8 * tam_ref <= t <= 1.25 * tam_ref} | set(range(tam_ref - 2, tam_ref + 3))
    pr, pc = alvo.sum(1).astype(np.float32), alvo.sum(0).astype(np.float32)
    cx0, b0 = W / 2, Hb // 2 + 10; best = (0.0, None)
    for t in sorted(tams):
        im = np.array(render(W, Hb, pal, {"fonte": spec, "tam": t, "tr": tr, "esp": esp}, cx0, b0, so_miolo=True))[..., 3] > 127
        if not im.any(): continue
        dy = _desloc(pr, im.sum(1).astype(np.float32), Hb // 2)
        dx = _desloc(pc, im.sum(0).astype(np.float32), W // 3)
        im2 = np.roll(np.roll(im, dy, 0), dx, 1)
        iou = (im2 & alvo).sum() / max((im2 | alvo).sum(), 1)
        if iou > best[0]: best = (float(iou), (t, cx0 + dx, b0 + dy))
    return best

def alinha(segs, ws, spec, tr, esp, W, tam_ref, fps=30, folga=1.0, maxp=5):
    """atribuição monotônica palavra->trecho por programação dinâmica, maximizando o IoU do texto re-renderizado
    com a máscara de cada trecho. Palavra pode ficar sem trecho (pausa, trecho não detectado)."""
    n, m = len(ws), len(segs); NEG = -1e9
    best = np.full((m + 1, n + 1), NEG); best[0, :] = 0; arg = {}
    memo = {}
    def sc(j, i, k):
        if (j, i, k) not in memo:
            s = segs[j]; t0, t1 = s["ini"] / fps - folga, s["fim"] / fps + folga
            if any(not (t0 <= w["ini"] <= t1) for w in ws[i:k]): memo[(j, i, k)] = NEG
            else: memo[(j, i, k)] = encaixa(s["est"], [w["w"] for w in ws[i:k]], spec, tr, esp, W, tam_ref)[0] if k > i else 0.0
        return memo[(j, i, k)]
    for j in range(m):
        for i in range(n + 1):
            if best[j, i] <= NEG / 2: continue
            for k in range(i, min(n, i + maxp) + 1):
                v = sc(j, i, k)
                if v <= NEG / 2: continue
                if best[j, i] + v > best[j + 1, k]: best[j + 1, k] = best[j, i] + v; arg[(j + 1, k)] = i
        # palavra pulada (sem trecho): propaga best[j+1, i] -> best[j+1, i+1]
        for i in range(n):
            if best[j + 1, i] > best[j + 1, i + 1]: best[j + 1, i + 1] = best[j + 1, i]; arg[(j + 1, i + 1)] = ("pula", i)
    k = int(np.argmax(best[m])); res = [None] * m; j = m
    while j > 0:
        a = arg.get((j, k))
        if isinstance(a, tuple): k = a[1]; continue
        if a is None: res[j - 1] = []; j -= 1; continue
        res[j - 1] = list(range(a, k)); k = a; j -= 1
    return res


_IDS = {("Poppins-Bold.ttf", None): "poppins-700", ("Poppins-ExtraBold.ttf", None): "poppins-800", ("Poppins-Black.ttf", None): "poppins-900",
        ("Montserrat-ExtraBold.ttf", None): "montserrat-800", ("Montserrat-Variable.ttf", "Black"): "montserrat-900",
        ("Montserrat-Variable.ttf", "Bold"): "montserrat-700", ("Inter-Bold.ttf", None): "inter-700", ("TikTokSans-Bold.ttf", None): "tiktok-sans-700",
        ("Gabarito-Variable.ttf", "Black"): "gabarito-900", ("Gabarito-Variable.ttf", "Bold"): "gabarito-700",
        ("Manrope-Variable.ttf", "ExtraBold"): "manrope-800", ("Archivo-w1000-900.ttf", None): "archivo-w100-900",
        ("Archivo-w1125-900.ttf", None): "archivo-w112-900", ("Archivo-w1125-700.ttf", None): "archivo-w112-700",
        ("Archivo-w1250-700.ttf", None): "archivo-w125-700", ("Archivo-w1250-900.ttf", None): "archivo-w125-900"}


def id_fonte(spec):
    """Id de texto estável da fonte da legenda (o `fontId` do captionTrack; o catálogo da legenda é maior que o FontId da headline)."""
    return _IDS[(spec["arq"], spec.get("var"))]
