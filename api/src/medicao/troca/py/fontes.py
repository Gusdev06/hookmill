"""Fontes da cópia de headline (troca-texto-queimado-v1 §14.1.2, §16.2 A3). Dono: video.

Pillow só POSICIONA (corpo, linha de base, entrelinha, centro, tracking) e faz a pré-seleção. Quem decide a fonte é
a prova no Chrome (regua.py): "Pillow nunca decide". Arquivos = video/public/fonts (OFL), nunca fonte do sistema.
"""
import os, re
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

from texto import linhas as linhas_de, traco

PASTA = os.environ.get("FONTES_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "fontes")
# CopyFontId (contratos/src/troca-texto.ts) que valem para texto corrido; as de título (anton, bebas, oswald...) ficam fora
CATALOGO = ["montserrat-500", "montserrat-600", "montserrat-700", "inter-400", "inter-500", "inter-600", "inter-700",
            "poppins-500", "poppins-600", "arimo-400", "arimo-500", "arimo-600", "arimo-700",
            "tiktok-sans-400", "tiktok-sans-500", "tiktok-sans-600", "tiktok-sans-700", "albert-sans-500"]


def arquivo(font_id):
    m = re.match(r"^(.*)-(\d{3})$", font_id)
    f = os.path.join(PASTA, f"{m.group(1)}-latin-{m.group(2)}-normal.woff2")
    if "/System/Library" in f:   # §15.7.3: proibido
        raise ValueError(f)
    return f


def disponiveis():
    return [f for f in CATALOGO if os.path.exists(arquivo(f))]


_cache = {}


def fonte(font_id, px):
    k = (font_id, round(px * 8) / 8)
    if k not in _cache:
        _cache[k] = ImageFont.truetype(arquivo(font_id), k[1])
    return _cache[k]


def desenhar(font_id, lines, W, H, sz, pitch, base, cxs, tr=0.0, ss=2, blur=.6):
    """Alfa 0-1 do texto em (W, H): linha i com base em base + i·pitch, centro cxs[i]. Tracking em em."""
    f = fonte(font_id, sz * ss)
    im = Image.new("L", (W * ss, H * ss), 0)
    d = ImageDraw.Draw(im)
    for i, ln in enumerate(lines):
        w = f.getlength(ln) + tr * sz * ss * max(0, len(ln) - 1)
        x = cxs[i] * ss - w / 2
        y = (base + i * pitch) * ss
        if not tr:
            d.text((x, y), ln, font=f, fill=255, anchor="ls")
        else:
            for k, ch in enumerate(ln):
                d.text((x + f.getlength(ln[:k]) + tr * sz * ss * k, y), ch, font=f, fill=255, anchor="ls")
    a = cv2.resize(np.asarray(im, np.float32) / 255, (W, H), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(a, (0, 0), blur) if blur else a


def largura(font_id, txt, sz, tr=0.0):
    f = fonte(font_id, 100)
    return (f.getlength(txt) + tr * 100 * max(0, len(txt) - 1)) * sz / 100


# ───────── quebra das palavras originais ─────────

def quebrar(texto, larguras_medidas, font_id="arimo-600"):
    """Texto da visão em N linhas. Com '\\n' usa a quebra dela; senão, escolhe as quebras que deixam a razão
    largura medida / largura desenhada mais parecida entre as linhas (o corpo é um só)."""
    if "\n" in texto:
        ls = [l.strip() for l in texto.split("\n") if l.strip()]
        if len(ls) == len(larguras_medidas):
            return ls
    pal = texto.split()
    n = len(larguras_medidas)
    if n <= 1 or len(pal) < n:
        return [" ".join(pal)]
    import itertools
    melhor = None
    for cortes in itertools.combinations(range(1, len(pal)), n - 1):
        b = [0, *cortes, len(pal)]
        ls = [" ".join(pal[b[i]:b[i + 1]]) for i in range(n)]
        r = [larguras_medidas[i] / max(1e-3, largura(font_id, ls[i], 100)) for i in range(n)]
        s = float(np.std(r) / np.mean(r))
        if melhor is None or s < melhor[0]:
            melhor = (s, ls)
    return melhor[1]


# ───────── pré-seleção sem prova (§14.1.2 passo 1) ─────────

def preselecionar(alvo, lines, medidas, candidatas=None, k=5, extra=(), transf=None):
    """Corpo pela mediana de (largura medida / largura a 100 px); nota = espalhamento entre linhas + erro de traço
    redesenhado no corpo estimado. `transf` leva o alfa desenhado ao mesmo modelo do alfa medido (no solto: compõe
    sobre o fundo e extrai pelo mesmo limiar). Devolve até k ids (+ os de `extra`), com o corpo estimado."""
    stem0 = traco(alvo)
    notas = []
    for fid in candidatas or disponiveis():
        r = [m[4] / max(1e-3, largura(fid, t, 100)) for m, t in zip(medidas, lines)]
        sz = float(np.median(r)) * 100
        esp = float(np.std(r) / np.mean(r)) if len(r) > 1 else 0.0
        H, W = alvo.shape
        cxs = [(m[2] + m[3]) / 2 for m in medidas]
        bases = [linha_de_base(alvo, m) for m in medidas]
        pitch = (bases[-1] - bases[0]) / max(1, len(bases) - 1) if len(bases) > 1 else 0
        a = desenhar(fid, lines, W, H, sz, pitch, bases[0], cxs)
        if transf:
            a = transf(a)
        st = traco(a)
        e_st = abs(st - stem0) / max(stem0, 1e-3)
        notas.append((e_st + 2 * esp, fid, sz, round(e_st, 3), round(esp, 4)))
    notas.sort()
    esc = [n for n in notas[:k]]
    for fid in extra:
        if fid not in [n[1] for n in esc]:
            esc += [n for n in notas if n[1] == fid]
    return [dict(fontId=n[1], sz=n[2], stemErr=n[3], spread=n[4]) for n in esc]


def linha_de_base(al, m):
    """Linha de base de uma linha medida [y0, y1, x0, x1, w]: mediana do pé de cada coluna com tinta (a maioria dos
    glifos assenta na base; descendente e vírgula são minoria). +0,5: a base fica embaixo do último pixel."""
    y0, y1, x0, x1 = m[0], m[1], m[2], m[3]
    b = al[y0:y1, x0:x1 + 1] > .5
    tem = b.any(0)
    if not tem.any():
        return float(y1)
    pe = (b.shape[0] - 1 - np.argmax(b[::-1], 0))[tem]
    return float(y0 + np.median(pe) + .5)


# ───────── posição (§15.5.3, molde `calibrar`; só posiciona) ─────────

def ajustar(alvo, peso, lines, fid, medidas, sz0=None, iteracoes=1, tracking=True, transf=None):
    """Melhor corpo, entrelinha, linha de base, centro por linha e tracking por cos com o alvo (Pillow).
    Devolve (cos, layout)."""
    H, W = alvo.shape
    alvo_p = alvo * peso
    if sz0 is None:
        sz0 = float(np.median([m[4] / max(1e-3, largura(fid, t, 100)) for m, t in zip(medidas, lines)])) * 100
    bases = [linha_de_base(alvo, m) for m in medidas]
    pitch0 = (bases[-1] - bases[0]) / max(1, len(bases) - 1) if len(bases) > 1 else sz0 * 1.2
    p = dict(sz=sz0, pitch=pitch0, base=bases[0], cxs=[(m[2] + m[3]) / 2 for m in medidas], tr=0.0)
    nrm = np.sqrt((alvo_p * alvo_p).sum()) + 1e-6

    def cos(q):
        a = desenhar(fid, lines, W, H, q["sz"], q["pitch"], q["base"], q["cxs"], q["tr"])
        a = (transf(a) if transf else a) * peso
        return float((a * alvo_p).sum() / (np.sqrt((a * a).sum()) * nrm + 1e-6))

    best = cos(p)
    passos = [("sz", np.arange(-2, 2.01, .5)), ("base", np.arange(-3, 3.01, .5))]
    if len(lines) > 1:
        passos.append(("pitch", np.arange(-1.5, 1.51, .5)))
    if tracking:
        passos.append(("tr", np.arange(-.02, .0301, .01)))
    for _ in range(iteracoes):
        for k, ds in passos:
            b0 = p[k]
            for dv in ds:
                if dv == 0:
                    continue
                q = dict(p, **{k: round(float(b0 + dv), 3)})
                s = cos(q)
                if s > best:
                    best, p = s, q
        for i in range(len(lines)):
            b0 = p["cxs"][i]
            for dv in np.arange(-2, 2.01, .5):
                if dv == 0:
                    continue
                q = dict(p)
                q["cxs"] = list(p["cxs"])
                q["cxs"][i] = float(b0 + dv)
                s = cos(q)
                if s > best:
                    best, p = s, q
    return best, p
