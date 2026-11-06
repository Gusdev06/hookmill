"""Medidas por imagem da headline (troca-texto-queimado-v1 §14.1.1, §15.5, §16.2). Dono: video.

Tudo aqui recebe arrays já decodificados (mediana ou mínimo do intervalo) e devolve números: testável nos PNG da S4,
sem vídeo. A leitura do vídeo e a ordem das etapas ficam em medir_headline.py.
"""
import numpy as np
import cv2

BRILHO = 205          # letra clara do solto (molde followcatch; S4 placa_solta.py)
LIM_LETRA = 40        # contraste local da letra na caixa (§14.1.1 item 3)


# ───────── alfa da letra ─────────

def alfa_caixa(med, sub=()):
    """Caixa: contraste contra a mediana grande e projeção no eixo fundo → texto (regua_caixa.py da S4).
    `sub` = faixas de linha (y0, y1) do sublinhado, zeradas no alfa. Devolve (alfa, letra, cor_texto_bgr, fundo_liso)."""
    BH = med.shape[0]
    bgl = cv2.medianBlur(med, min(BH | 1, 101))
    letra = np.abs(med.astype(np.int16) - bgl.astype(np.int16)).mean(2) > LIM_LETRA
    nucleo = cv2.erode(letra.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    if nucleo.sum() < 10:
        return None, letra, None, bgl
    tx = np.median(med[nucleo], 0).astype(np.float32)
    bg = bgl.astype(np.float32)
    v = tx - bg
    al = np.clip(((med.astype(np.float32) - bg) * v).sum(2) / np.maximum((v * v).sum(2), 1), 0, 1)
    for a, b in sub:
        al[max(0, a - 1):b + 1] = 0
    return al, letra, tx, bgl


def alfa_solto(minimo_cinza):
    """Solto: limiar 110..235 sobre o mínimo dos quadros do intervalo (regua_chrome.py da S4)."""
    return np.clip((minimo_cinza.astype(np.float32) - 110) / 125, 0, 1)


def limpar_blobs(al, lim=.5):
    """Solto: tira do alfa o que não é letra (pele ou fundo claro que passou do limiar no mínimo dos quadros, comum em
    cena parada): componente com raio inscrito > 1,6× o típico (e +1,5 px) ou área > 25× a típica, com a borda."""
    m = (al > lim).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 2:
        return al
    dt = cv2.distanceTransform(m, cv2.DIST_L2, 5)
    rmax = np.zeros(n)
    np.maximum.at(rmax, lab.ravel(), dt.ravel())
    ids = [i for i in range(1, n) if st[i, 4] >= 6]
    if not ids:
        return al
    rt = float(np.median(rmax[ids])); at = float(np.median(st[ids, 4]))
    fora = [i for i in ids if rmax[i] > max(1.6 * rt, rt + 1.5) or st[i, 4] > 25 * at]
    if not fora:
        return al
    z = cv2.dilate(np.isin(lab, fora).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    out = al.copy()
    out[z] = 0
    return out


def traco(al, ss=4):
    """stemPx = largura média do traço = 2 × área ÷ perímetro da máscara (> 0,5), no alfa ampliado `ss`×.
    Contínua: o 2 × p90 da distância à borda (§14.1.1 item 6) anda em degraus de ~0,4 px no traço fino do solto (2,5 px),
    e ±15 % vira 1 degrau. Nas caixas da S4 as duas medidas dão o mesmo erro relativo (Montserrat 500 no 02: −20 %)."""
    if (al > .5).sum() < 5:
        return 0.0
    g = cv2.resize(al.astype(np.float32), None, fx=ss, fy=ss, interpolation=cv2.INTER_LINEAR)
    m = (g > .5).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    per = sum(cv2.arcLength(c, True) for c in cs)
    return 2 * float(m.sum()) / max(per, 1.0) / ss


def linhas(al, lim=.5, minp=3, minh=8):
    """Linhas: [y0, y1, x0, x1, largura] (x1 inclusivo). Separa pelo núcleo (projeção > 30 % do pico, sem núcleo
    com menos de 40 % da altura do maior) e corta no meio entre núcleos vizinhos: descendente de uma linha e ascendente da
    seguinte podem se tocar e somar um falso núcleo de 2-3 linhas de pixel."""
    prj = (al > lim).sum(1)
    if prj.max() <= minp:
        return []
    nuc = prj > .3 * prj.max()
    runs, y = [], 0
    while y < len(nuc):
        if nuc[y]:
            a = y
            while y < len(nuc) and nuc[y]:
                y += 1
            if runs and a - runs[-1][1] < 3:
                runs[-1][1] = y
            else:
                runs.append([a, y])
        y += 1
    alt = max((r[1] - r[0] for r in runs), default=0)
    runs = [r for r in runs if r[1] - r[0] >= max(3, .4 * alt)]
    out = []
    for k, (a, b) in enumerate(runs):
        lo = 0 if k == 0 else (runs[k - 1][1] + a) // 2
        hi = len(prj) if k == len(runs) - 1 else (b + runs[k + 1][0]) // 2
        tinta = np.where(prj[lo:hi] > minp)[0]
        if len(tinta) == 0:
            continue
        y0, y1 = lo + int(tinta.min()), lo + int(tinta.max()) + 1
        if y1 - y0 <= minh:
            continue
        c = np.where((al[y0:y1] > lim).sum(0) >= 1)[0]
        out.append([int(y0), int(y1), int(c.min()), int(c.max()), int(c.max() - c.min() + 1)])
    return out


def sublinhados(al, frac=.2, max_alt=10):
    """§14.1.1 item 5: linha de pixels com corrida contínua > 20 % da largura, em faixa fina. [(y0, y1, x0, x1)]."""
    m = al > .5
    W = m.shape[1]
    linha_ok = []
    for y in range(m.shape[0]):
        row = m[y].astype(np.int8)
        if row.sum() < frac * W:
            linha_ok.append(None)
            continue
        d = np.diff(np.concatenate([[0], row, [0]]))
        ini, fim = np.where(d == 1)[0], np.where(d == -1)[0]
        k = int(np.argmax(fim - ini))
        linha_ok.append((int(ini[k]), int(fim[k] - 1)) if fim[k] - ini[k] > frac * W else None)
    out = []
    y = 0
    while y < len(linha_ok):
        if linha_ok[y]:
            a = y
            xs = []
            while y < len(linha_ok) and linha_ok[y]:
                xs.append(linha_ok[y])
                y += 1
            if y - a <= max_alt:
                out.append((a, y - 1, int(np.median([x[0] for x in xs])), int(np.median([x[1] for x in xs]))))
        y += 1
    return out


# ───────── caixa ─────────

def achar_caixa(med):
    """Caixa chapada em volta do texto (S4 caixa_medir.py, sem constante por vídeo): cor dominante no miolo,
    maior corrida de linhas e colunas próximas dela. Devolve (x, y, w, h) relativo a `med`, ou None."""
    H, W = med.shape[:2]
    miolo = med[H // 4:3 * H // 4, W // 8:7 * W // 8].reshape(-1, 3).astype(np.float32)
    # cor dominante: moda grosseira por quantização (o texto é minoria no miolo)
    q = (miolo // 16).astype(np.int32)
    chave = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
    moda = np.bincount(chave).argmax()
    cor = np.median(miolo[chave == moda], 0)
    perto = np.abs(med.astype(np.float32) - cor).mean(2) < 30
    lin = np.where(perto.mean(1) > .25)[0]
    if len(lin) < 4:
        return None, cor
    runs = np.split(lin, np.where(np.diff(lin) > 1)[0] + 1)
    yr = max(runs, key=len)
    y0, y1 = int(yr[0]), int(yr[-1]) + 1
    col = np.where(perto[y0:y1].mean(0) > .35)[0]
    if len(col) < 4:
        return None, cor
    runs = np.split(col, np.where(np.diff(col) > 1)[0] + 1)
    xr = max(runs, key=len)
    x0, x1 = int(xr[0]), int(xr[-1]) + 1
    return (x0, y0, x1 - x0, y1 - y0), cor


def fundo_liso(med, letra, dil, sigma=18):
    """Convolução normalizada fora da letra dilatada (método B, §14.1.1 item 7)."""
    fundo = (cv2.dilate(letra.astype(np.uint8), np.ones((dil, dil), np.uint8)) == 0).astype(np.float32)
    den = cv2.GaussianBlur(fundo, (0, 0), sigma, borderType=cv2.BORDER_REFLECT)
    lisa = cv2.GaussianBlur(med.astype(np.float32) * fundo[..., None], (0, 0), sigma, borderType=cv2.BORDER_REFLECT) / np.maximum(den, 1e-4)[..., None]
    return lisa, fundo > 0


def halo_p99(med, letra, dil, anel=3):
    """p99 da diferença entre a mediana e o fundo suavizado no anel externo à dilatação (A5)."""
    lisa, _ = fundo_liso(med, letra, dil)
    d0 = cv2.dilate(letra.astype(np.uint8), np.ones((dil, dil), np.uint8)) > 0
    d1 = cv2.dilate(letra.astype(np.uint8), np.ones((dil + 2 * anel, dil + 2 * anel), np.uint8)) > 0
    r = d1 & ~d0
    if r.sum() < 10:
        return 0.0, lisa
    return float(np.percentile(np.abs(med.astype(np.float32) - lisa)[r].max(1), 99)), lisa


DILATACOES = (9, 13, 17, 21, 25)


def dilatacao_a5(med, letra, tem_sombra, teto=12.0):
    """§16.2 A5: 9 px sem sombra; com sombra, sobe até o p99 do anel externo ficar ≤ 12. Não convergiu = None."""
    if not tem_sombra:
        p, lisa = halo_p99(med, letra, 9)
        return 9, p, lisa
    ult = None
    for d in DILATACOES:
        p, lisa = halo_p99(med, letra, d)
        ult = (d, p, lisa)
        if p <= teto:
            return d, p, lisa
    return None, ult[1], ult[2]


def placa_2d(lisa, max_bytes=4096):
    """§14.2: imagem 2D pequena (1/8 da caixa), PNG em data URI ≤ 4 KB."""
    from comum import png_uri
    BH, BW = lisa.shape[:2]
    sw, sh = max(8, BW // 8), max(4, BH // 8)
    peq = cv2.resize(lisa, (sw, sh), interpolation=cv2.INTER_AREA).clip(0, 255).astype(np.uint8)
    return png_uri(peq, max_bytes), [sw, sh]


def medir_sombra(med, lisa, alfa_desenho, al_original):
    """§14.1.1 item 8: {dx, dy, sigma, opacidade} pelo menor erro no halo escuro em volta das letras.
    `alfa_desenho` = letra redesenhada (sem sombra) na posição medida. Devolve (sombra|None, erro_sem, erro_com)."""
    BH, BW = alfa_desenho.shape
    anel = (cv2.dilate((alfa_desenho > .05).astype(np.uint8), np.ones((17, 17), np.uint8)) > 0) & (alfa_desenho < .02) & ~(al_original > .2)
    if anel.sum() < 50:
        return None, 0.0, 0.0
    alvo = med.astype(np.float32)[anel]
    sem = float(np.abs(lisa[anel] - alvo).mean())
    best = (sem, None)
    for sg in (1, 1.5, 2, 2.5, 3, 4):
        for dx in range(0, 5):
            for dy in range(0, 5):
                M = np.float32([[1, 0, dx], [0, 1, dy]])
                s0 = cv2.GaussianBlur(cv2.warpAffine(alfa_desenho, M, (BW, BH)), (0, 0), sg)[anel]
                for op in (.4, .55, .7, .85, 1):
                    err = float(np.abs(lisa[anel] * (1 - s0 * op)[:, None] - alvo).mean())
                    if err < best[0]:
                        best = (err, dict(dx=dx, dy=dy, sigma=sg, op=op))
    # sombra só conta se tirar ≥ 25 % do erro do anel: abaixo disso é ruído de fundo
    if best[1] is None or best[0] > .75 * sem:
        return None, sem, best[0]
    return best[1], sem, best[0]


def temporal_p99(pilha, letra, anel=7):
    """§15.5.2: desvio temporal p99 no anel de 7 px em volta das letras (pilha N×H×W×3 contra a mediana)."""
    med = np.median(pilha, 0)
    d1 = cv2.dilate(letra.astype(np.uint8), np.ones((2 * anel + 1, 2 * anel + 1), np.uint8)) > 0
    r = d1 & ~letra
    if r.sum() < 10:
        return 0.0
    dev = np.abs(pilha.astype(np.float32) - med[None].astype(np.float32)).mean(3)[:, r]
    return float(np.percentile(dev, 99))


# ───────── emoji (§16.2 A1) ─────────

def achar_emoji(m_letra, banda, traco_px, lado="end"):
    """Na faixa da linha (y0, y1), o emoji é o grupo de componentes com raio inscrito muito maior que meio traço
    (a esclera é um blob largo; a letra, traço fino). Devolve (x0, y0, x1, y1) do grupo ou None."""
    y0, y1 = banda
    sub = m_letra[y0:y1].astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(sub, 8)
    dt = cv2.distanceTransform(sub, cv2.DIST_L2, 5)
    mx = {i: float(dt[lab == i].max()) for i in range(1, n) if st[i, 4] >= 6}
    if not mx:
        return None
    tipico = float(np.median(list(mx.values())))
    grossos = [i for i, v in mx.items() if v > max(1.5 * tipico, tipico + 1.2)]
    if not grossos:
        return None
    xs = [(st[i, 0], st[i, 0] + st[i, 2]) for i in grossos]
    # o grupo do lado pedido (fim ou começo da linha), unindo vizinhos a ≤ 1 traço × 3
    xs.sort(key=lambda t: t[0], reverse=(lado == "end"))
    g0, g1 = xs[0]
    for a, b in xs[1:]:
        if (lado == "end" and b >= g0 - 3 * traco_px) or (lado == "start" and a <= g1 + 3 * traco_px):
            g0, g1 = min(g0, a), max(g1, b)
    ys = np.where(np.isin(lab, grossos).any(1))[0]
    return int(g0), int(y0 + ys.min()), int(g1), int(y0 + ys.max() + 1)


def emoji_a1(med, pad=2, limiar=32, min_pts=12):
    """§16.2 A1: casco convexo por lóbulo sobre a mediana do trecho do emoji (com folga de 3 px em volta).
    Devolve dict com a máscara, alfa, bbox, ocupa, solidez e o RGBA recortado; ou None sem lóbulo."""
    med = med.astype(np.float32)
    anel = np.ones(med.shape[:2], bool)
    anel[3:-3, 3:-3] = False
    bg = np.median(med[anel], 0)
    base = (np.abs(med - bg).mean(2) > limiar).astype(np.uint8)
    nucleo = cv2.erode(base, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    nl, lab = cv2.connectedComponents(nucleo, connectivity=8)
    if nl <= 1:
        return None
    dists = np.stack([cv2.distanceTransform((lab != k).astype(np.uint8), cv2.DIST_L2, 3) for k in range(1, nl)])
    dono = np.argmin(dists, 0)
    mk = np.zeros_like(base)
    lobulos = 0
    for k in range(nl - 1):
        pts = np.column_stack(np.where((base > 0) & (dono == k)))[:, ::-1]
        if len(pts) >= min_pts:
            cv2.fillConvexPoly(mk, cv2.convexHull(pts.astype(np.int32)), 1)
            lobulos += 1
    if not mk.any():
        return None
    ys, xs = np.where(mk)
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    ocupa = float(mk.sum() / (bw * bh))
    solidez = float(base.sum() / max(1, mk.sum()))
    x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
    x1, y1 = min(mk.shape[1], xs.max() + 1 + pad), min(mk.shape[0], ys.max() + 1 + pad)
    alfa = cv2.GaussianBlur(mk.astype(np.float32), (0, 0), .5)
    rgba = np.dstack([med, alfa * 255]).clip(0, 255).astype(np.uint8)[y0:y1, x0:x1]
    return dict(mascara=mk, rgba=rgba, recorte=(int(x0), int(y0), int(x1 - x0), int(y1 - y0)),
                bbox=(int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())), px=int(mk.sum()),
                ocupa=round(ocupa, 3), solidez=round(solidez, 3), lobulos=lobulos)


def emoji_veredito(e, ocupa_min=.40, ocupa_max=.95, solidez_min=.70):
    """§16.2 A1: None = serve; senão o motivo (sempre `emoji_unsupported` para fora)."""
    if e is None:
        return "sem_lobulo"
    if not (ocupa_min <= e["ocupa"] <= ocupa_max):
        return "ocupa"
    if e["solidez"] < solidez_min:
        return "solidez"
    return None


# ───────── conferência (A2) ─────────

def fantasma(placa_cinza, molde, sigma=5):
    """§16.2 A2: alto-passa (σ 5) nas letras antigas (sem emoji): média e correlação com o molde."""
    g = placa_cinza.astype(np.float32)
    hp = g - cv2.GaussianBlur(g, (0, 0), sigma)
    m = molde > 0
    if m.sum() < 10:
        return 0.0, 0.0
    media = float(hp[m].mean())
    a, b = hp.ravel(), m.astype(np.float32).ravel()
    corr = float(np.corrcoef(a, b)[0, 1]) if a.std() > 0 else 0.0
    return media, corr
