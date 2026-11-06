"""Op `medir_headline` (troca-texto-queimado-v1 §15.5, §16.2). Dono: video.

Fase `medida`: lê o vídeo e devolve a geometria, a pré-seleção de fontes com posição e a referência para a régua.
Fase `regua`: recebe os stills do Chrome (palavras originais em cada candidata) e escolhe a fonte (A3).
A montagem do HeadlineLook é do TS (orquestra.ts): aqui só números e imagens pequenas.
"""
import re
import numpy as np
import cv2

from comum import sonda, quadros, matriz_de, png_uri, de_uri, hexa, impar, r2
from texto import (BRILHO, alfa_caixa, alfa_solto, limpar_blobs, traco, linhas, sublinhados, achar_caixa, fundo_liso, dilatacao_a5,
                   placa_2d, medir_sombra, temporal_p99, achar_emoji, emoji_a1, emoji_veredito)
import fontes

EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]+")
COBERTURA = .8          # §15.5.2 passo 3
MAX_TRANSICAO = 3       # §15.5.2 passo 5
MAX_PILHA = 60          # quadros para a mediana do intervalo


def _clamp_rect(x, y, w, h, W, H):
    x0, y0 = max(0, int(np.floor(x))), max(0, int(np.floor(y)))
    x1, y1 = min(W, int(np.ceil(x + w))), min(H, int(np.ceil(y + h)))
    return x0, y0, max(0, x1 - x0), max(0, y1 - y0)


def _roi(alvo, bandas, W, H, fps):
    """Caixa da visão + 12 % em volta, sem entrar na faixa da legenda (§15.5.2 passo 2)."""
    b = alvo["box"]
    mx, my = .12 * b["w"], .12 * b["h"]
    x, y, w, h = _clamp_rect(b["x"] - mx, b["y"] - my, b["w"] + 2 * mx, b["h"] + 2 * my, W, H)
    y1 = y + h
    for bd in bandas:
        if bd["y"] >= b["y"] + b["h"] * .5:          # legenda abaixo do texto: corta o fundo da ROI
            y1 = min(y1, int(bd["y"]))
        elif bd["y"] + bd["h"] <= b["y"] + b["h"] * .5:  # acima: corta o topo
            y = max(y, int(bd["y"] + bd["h"]))
    return x, y, w, max(1, y1 - y)


def _cobertura(f, medc, M):
    """Fração do molde em que o quadro está a < 40 níveis da mediana da semente (média dos 3 canais: em cinza, a cena
    que se mexe imita a cor da caixa)."""
    return float((np.abs(f.astype(np.int16) - medc.astype(np.int16)).mean(2)[M] < 40).mean())


def intervalo(video, info, roi, ini_visao, fim_visao):
    """§15.5.2: semente [início + 0,5 s, + 2 s], molde estável, anda para os dois lados com cobertura > 80 %.
    Só decodifica a caixa do molde, numa janela que começa 2 s antes da visão e para quando o texto sai."""
    fps, N = info["fps"], info["n"]
    s0 = min(max(0, ini_visao + int(round(.5 * fps))), max(0, N - 2))
    s1 = min(N, max(s0 + 2, min(s0 + int(round(1.5 * fps)), fim_visao if fim_visao > s0 + 2 else N)))
    seed = np.stack(list(quadros(video, info, ini=s0, n=s1 - s0, roi=roi)))
    med = np.median(seed, 0).astype(np.uint8)
    bgl = cv2.medianBlur(med, min(med.shape[0] | 1, 101))
    letra = np.abs(med.astype(np.int16) - bgl.astype(np.int16)).mean(2) > 40
    estavel = np.abs(seed.astype(np.int16) - med[None].astype(np.int16)).mean(3).max(0) < 40
    M = letra & estavel
    if M.sum() < 20:
        return None, dict(motivo="molde_fraco", molde_px=int(M.sum()), semente=[s0, s1])
    ys, xs = np.where(M)
    bx, by, bw, bh = int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
    Mc = M[by:by + bh, bx:bx + bw]
    medg = med[by:by + bh, bx:bx + bw]
    sub = (roi[0] + bx, roi[1] + by, bw, bh)
    j0 = max(0, min(ini_visao, s0) - int(round(2 * fps)))
    cob = {}
    for k, g in enumerate(quadros(video, info, ini=j0, roi=sub)):
        i = j0 + k
        cob[i] = _cobertura(g, medg, Mc)
        if i > s1 and cob[i] <= .2 and all(cob.get(i - d, 1) <= .2 for d in range(1, 6)):
            break                                     # texto saiu há 6 quadros: não precisa ler o resto
    ult = max(cob)
    if s0 not in cob or cob[s0] <= COBERTURA:
        return None, dict(motivo="semente_sem_texto", semente=[s0, s1])
    a = s0
    while a - 1 in cob and cob[a - 1] > COBERTURA:
        a -= 1
    b = s0
    while b + 1 in cob and cob[b + 1] > COBERTURA:
        b += 1
    if a == j0 and j0 > 0:                            # texto já estava antes da janela: lê o começo inteiro
        for k, g in enumerate(quadros(video, info, ini=0, n=j0, roi=sub)):
            cob[k] = _cobertura(g, medg, Mc)
        while a - 1 in cob and cob[a - 1] > COBERTURA:
            a -= 1

    def trans(i, passo):
        # transição = cobertura intermediária que AINDA muda (fade). Patamar parado não conta: no solto real da S4 o texto
        # sai seco (0,99 → 0,28 no quadro 161) e fica em 0,28 pelas bordas estáveis da cena dentro do molde.
        n = 0
        while i in cob and .2 < cob[i] <= COBERTURA and abs(cob[i] - cob.get(i + passo, cob[i])) > .03:
            n += 1
            i += passo
        return n
    t_ini, t_fim = trans(a - 1, -1), trans(b + 1, 1)
    return (a, b + 1), dict(semente=[s0, s1], molde_px=int(M.sum()), transicao=[t_ini, t_fim],
                           lidos=len(cob), ultimo_lido=int(ult))


def _pilha_e_minimo(video, info, roi, a, b):
    """Mínimo cinza de todo o intervalo (letra solta) e até 60 quadros BGR para a mediana."""
    passo = max(1, (b - a) // MAX_PILHA)
    pilha, mn = [], None
    for i, f in enumerate(quadros(video, info, ini=a, n=b - a, roi=roi)):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        mn = g if mn is None else np.minimum(mn, g)
        if i % passo == 0:
            pilha.append(f)
    return np.stack(pilha), mn


def _alinhamento(meds):
    if len(meds) < 2:
        return "center"
    e = np.std([m[2] for m in meds]); c = np.std([(m[2] + m[3]) / 2 for m in meds]); d = np.std([m[3] for m in meds])
    return ["left", "center", "right"][int(np.argmin([e, c, d]))]


def _com_emoji(meds, emoji, rx):
    """A4: o emoji entra na linha dele para o centro e o alinhamento."""
    if not emoji:
        return meds
    out = [list(q) for q in meds]
    q = out[emoji["lineIndex"]]
    e0, e1 = emoji["bbox"][0] - rx, emoji["bbox"][2] - rx
    q[2], q[3] = min(q[2], e0), max(q[3], e1)
    q[4] = q[3] - q[2] + 1
    return out


def _caixa_alta(t):
    letras = [c for c in t if c.isalpha()]
    if letras and all(c.isupper() for c in letras):
        return "upper"
    pal = [p for p in re.findall(r"[^\W\d_]+", t)]
    if pal and all(p[0].isupper() for p in pal):
        return "title"
    return "sentence"


def medida(ev, video="video.mp4"):
    info = sonda(video)
    W, H, fps = info["w"], info["h"], info["fps"]
    alvo = ev["alvo"]
    bandas = ev.get("bandas", [])
    gates, r = {}, dict(canvas=dict(width=W, height=H), fps=r2(fps, 4), quadros=info["n"], matriz=matriz_de(info))
    texto_visao = alvo.get("text") or ""
    emojis = EMOJI_RE.findall(texto_visao)
    texto_limpo = EMOJI_RE.sub("", texto_visao).strip()
    roi = _roi(alvo, bandas, W, H, fps)
    r["roi"] = list(roi)
    iv, dbg = intervalo(video, info, roi, int(alvo["startFrame"]), int(alvo["endFrame"]))
    r["intervalo_dbg"] = dbg
    if iv is None:
        return dict(r, ok=False, reason="not_measured", gates=gates)
    a, b = iv
    r.update(startFrame=int(a), endFrame=int(b))
    gates["transicao_max"] = max(dbg["transicao"])
    if max(dbg["transicao"]) > MAX_TRANSICAO:
        return dict(r, ok=False, reason="fades", gates=gates)
    pilha, mn = _pilha_e_minimo(video, info, roi, a, b)
    med = np.median(pilha, 0).astype(np.uint8)
    rx, ry, rw, rh = roi
    # ── caixa × solto, pelo pixel (§15.5.2, §16.4)
    al0, letra0, tx0, _ = alfa_caixa(med)
    if al0 is None:
        return dict(r, ok=False, reason="not_measured", gates=gates)
    # caixa primeiro: letra, bloco e anel medidos DENTRO dela (fora, a borda da caixa contra a cena que se mexe
    # parece letra e o anel pega o movimento da cena)
    caixa, cor_caixa = achar_caixa(med)
    eh_caixa = False
    if caixa is not None:
        cx0, cy0, cw, ch = caixa
        dentro = med[cy0:cy0 + ch, cx0:cx0 + cw]
        al_b, letra_b, _, _ = alfa_caixa(dentro)
        if al_b is not None and letra_b.any():
            ty, tx_ = np.where(letra_b)
            area_bloco = (tx_.max() - tx_.min() + 1) * (ty.max() - ty.min() + 1)
            livre = ~cv2.dilate(letra_b.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
            chapada = float(np.percentile(np.abs(dentro.astype(np.float32) - cor_caixa).mean(2)[livre], 90)) if livre.any() else 999
            p99c = temporal_p99(pilha[:, cy0:cy0 + ch, cx0:cx0 + cw], letra_b)
            gates.update(caixa_area_rel=r2(cw * ch / max(1, area_bloco), 2), caixa_quadro_rel=r2(cw * ch / (W * H), 3),
                         caixa_chapada_p90=r2(chapada, 1), temporal_p99=r2(p99c, 1))
            eh_caixa = cw * ch <= 2.5 * area_bloco and cw * ch <= .4 * W * H and chapada <= 30 and p99c <= 40
            p99 = p99c
    if not eh_caixa:
        p99 = temporal_p99(pilha, letra0)
        gates["temporal_p99"] = r2(p99, 1)
    if eh_caixa and p99 > 25:
        return dict(r, kind="box", ok=False, reason="text_changes", gates=gates)   # §16.4: 25-40 não oferece
    if eh_caixa:
        return dict(r, **_medir_caixa(ev, r, med, caixa, roi, p99, gates, texto_limpo, emojis, W, H))
    return dict(r, **_medir_solto(ev, r, med, mn, pilha, roi, gates, texto_limpo, emojis, W, H))


def _candidatas(alvo_al, peso, ls, meds, ev, k=5, transf=None):
    extra = [ev["fontIdVisao"]] if ev.get("fontIdVisao") in fontes.disponiveis() else []
    pre = fontes.preselecionar(alvo_al * peso, ls, meds, k=k, extra=extra, transf=transf)
    out = []
    for p in pre:
        cs, lay = fontes.ajustar(alvo_al, peso, ls, p["fontId"], meds, sz0=p["sz"], transf=transf)
        out.append(dict(fontId=p["fontId"], cosPillow=r2(cs, 4), preStemErr=p["stemErr"], layout=lay))
    out.sort(key=lambda c: -c["cosPillow"])
    return out


def _desloca(c, dx, dy):
    lay = dict(c["layout"])
    lay["base"] = lay["base"] + dy
    lay["cxs"] = [x + dx for x in lay["cxs"]]
    return dict(c, layout=lay)


def _medir_caixa(ev, r, med, caixa, roi, p99, gates, texto, emojis, W, H):
    rx, ry, _, _ = roi
    cx0, cy0, cw, ch = caixa
    m = med[cy0:cy0 + ch, cx0:cx0 + cw]
    al0, _, _, _ = alfa_caixa(m)
    subs = sublinhados(al0)
    al, letra, tx, _ = alfa_caixa(m, [(s[0], s[1]) for s in subs])
    meds = linhas(al)
    if not meds or not texto:
        return dict(kind="box", ok=False, reason="not_measured", gates=gates)
    peso = np.ones_like(al)
    for s in subs:
        peso[max(0, s[0] - 1):s[1] + 1] = 0
    ls = fontes.quebrar(texto, [q[4] for q in meds])
    if len(ls) != len(meds):
        return dict(kind="box", ok=False, reason="not_measured", gates=dict(gates, linhas_medidas=len(meds), linhas_texto=len(ls)))
    cands = _candidatas(al, peso, ls, meds, ev)
    best = cands[0]
    lay = best["layout"]
    desenho = fontes.desenhar(best["fontId"], ls, cw, ch, lay["sz"], lay["pitch"], lay["base"], lay["cxs"], lay["tr"])
    lisa9, _ = fundo_liso(m, letra, 9)
    sombra, err_sem, err_com = medir_sombra(m, lisa9, desenho, al)
    gates.update(sombra_err_sem=r2(err_sem, 2), sombra_err_com=r2(err_com, 2))
    dil, halo, lisa = dilatacao_a5(m, letra, sombra is not None)
    gates.update(dilatacao=dil or -1, halo_p99=r2(halo, 1))
    if dil is None:
        return dict(kind="box", ok=False, reason="not_measured", gates=gates)
    uri, px = placa_2d(lisa)
    gates["placa_bytes"] = len(uri)
    stem = traco(al)
    X, Y = rx + cx0, ry + cy0
    enfase = None
    if subs:
        s = subs[0]
        base_linha = next((lay["base"] + i * lay["pitch"] for i, q in enumerate(meds) if q[0] <= s[0] <= q[1] + 20), lay["base"])
        enfase = dict(kind="underline", thicknessPx=int(s[1] - s[0] + 1), offsetPx=r2(s[0] - base_linha, 1), color=hexa(tx))
    margem = min(min(q[2] for q in meds), min(cw - 1 - q[3] for q in meds))
    alfa_png = png_uri((al * 255).astype(np.uint8))
    return dict(
        kind="box", ok=True, reason=None, gates=gates,
        box=dict(x=int(X), y=int(Y), w=int(cw), h=int(ch)), radiusPx=0,
        plate=dict(color=hexa(np.median(lisa.reshape(-1, 3), 0)), image=uri, temporalP99=r2(p99, 1), translucent=bool(p99 > 11)),
        dilatacao=int(dil),
        sombra=_sombra_css(sombra), stemPx=r2(stem, 2), color=hexa(tx),
        lines=ls, linhasMedidas=[[q[0] + Y, q[1] + Y, q[2] + X, q[3] + X, q[4]] for q in meds],
        align=_alinhamento(meds), caseStyle=_caixa_alta(texto), emphasis=enfase, emoji=None,
        sublinhados=[[s[0] + Y, s[1] + Y, s[2] + X, s[3] + X] for s in subs],
        sideMarginPx=int(max(0, margem)),
        candidatas=[_desloca(c, X, Y) for c in cands],
        ref=dict(modo="box", rect=[int(X), int(Y), int(cw), int(ch)], alvo=alfa_png, fundo=png_uri(lisa.clip(0, 255).astype(np.uint8)),
                 zerar_linhas=[[s[0], s[1]] for s in subs], zerar_colunas=None, stem=r2(stem, 3),
                 linhas=[q for q in meds], cor=hexa(tx)),
        emojis=len(emojis),
    )


def _sombra_css(s):
    if not s:
        return None
    return dict(dx=s["dx"], dy=s["dy"], blurPx=r2(2 * s["sigma"], 2), color=f"rgba(0,0,0,{s['op']})")


def _medir_solto(ev, r, med, mn, pilha, roi, gates, texto, emojis, W, H):
    rx, ry, rw, rh = roi
    m_letra = mn > BRILHO
    gates["px_letra"] = int(m_letra.sum())
    if m_letra.sum() < 20:
        return dict(kind="loose", ok=False, reason="not_measured", gates=gates)
    luz = float(np.median(cv2.cvtColor(med, cv2.COLOR_BGR2GRAY)[m_letra]))
    gates["luz_letra"] = r2(luz, 1)
    if luz < 200:
        return dict(kind="loose", ok=False, reason="text_not_light", gates=gates)
    al = alfa_solto(mn)
    stem_bruto = traco(al)
    meds0 = linhas(al)
    if not meds0 or not texto:
        return dict(kind="loose", ok=False, reason="not_measured", gates=gates)
    # emoji (§15.7.2, §16.2 A1): só no fim ou no começo de linha
    emoji, zerar, r_zerar = None, None, None
    if emojis:
        vis = ev["alvo"].get("text") or ""
        partes = [l.strip() for l in vis.split("\n")] if "\n" in vis else [vis.strip()]
        fim_re, ini_re = re.compile("(?:" + EMOJI_RE.pattern + r")\s*$"), re.compile(r"^\s*(?:" + EMOJI_RE.pattern + ")")
        lado = "end" if any(fim_re.search(p) for p in partes) else ("start" if any(ini_re.search(p) for p in partes) else None)
        if lado is None or len(emojis) > 1:
            return dict(kind="loose", ok=False, reason="emoji_unsupported", gates=dict(gates, emoji_posicao="meio"))
        cand = []
        for li, q in enumerate(meds0):
            g = achar_emoji(m_letra, (q[0], q[1]), stem_bruto, lado)
            if g:
                cand.append((li, g))
        if not cand:
            return dict(kind="loose", ok=False, reason="emoji_unsupported", gates=dict(gates, emoji="nao_achado"))
        li, (ex0, ey0, ex1, ey1) = cand[-1] if lado == "end" else cand[0]
        x0, y0 = max(0, ex0 - 5), max(0, ey0 - 5)
        x1, y1 = min(rw, ex1 + 5), min(rh, ey1 + 5)
        medE = np.median(pilha[:, y0:y1, x0:x1], 0)
        e = emoji_a1(medE)
        motivo = emoji_veredito(e)
        gates.update(emoji_ocupa=e["ocupa"] if e else 0, emoji_solidez=e["solidez"] if e else 0, emoji_lobulos=e["lobulos"] if e else 0)
        if motivo:
            return dict(kind="loose", ok=False, reason="emoji_unsupported", gates=dict(gates, emoji_motivo=motivo))
        bx0, by0, bx1, by1 = e["bbox"]
        rcx, rcy, rcw, rch = e["recorte"]
        ebox = (x0 + bx0, y0 + by0, x0 + bx1, y0 + by1)
        # some só a faixa da linha do emoji (a S4 zerava a coluna inteira e cortava o fim da linha de cima)
        q0 = meds0[li]
        zy0, zy1 = max(0, min(q0[0], ebox[1]) - 2), min(rh, max(q0[1], ebox[3]) + 2)
        zerar = [ebox[0] - 2, rw, zy0, zy1] if lado == "end" else [0, ebox[2] + 3, zy0, zy1]
        r_zerar = zerar
        al_sem = al.copy()
        al_sem[zy0:zy1, max(0, zerar[0]):zerar[1]] = 0
        meds_txt = linhas(al_sem)
        q = meds_txt[li] if li < len(meds_txt) else meds_txt[-1]
        gap = (ebox[0] - q[3] - 1) if lado == "end" else (q[2] - ebox[2] - 1)
        emoji = dict(char=emojis[0], image=png_uri(e["rgba"]), x=int(rx + x0 + rcx), y=int(ry + y0 + rcy), w=int(rcw), h=int(rch),
                     lineIndex=int(li), side=lado, gapPx=r2(gap, 2), marginLeftPx=int(bx0 - rcx), solidity=e["solidez"],
                     bbox=[int(rx + ebox[0]), int(ry + ebox[1]), int(rx + ebox[2]), int(ry + ebox[3])], ocupa=e["ocupa"])
        al = al_sem
    al = limpar_blobs(al)
    meds = linhas(al)
    ls = fontes.quebrar(texto, [q[4] for q in meds])
    if len(ls) != len(meds):
        return dict(kind="loose", ok=False, reason="not_measured", gates=dict(gates, linhas_medidas=len(meds), linhas_texto=len(ls)))
    peso = np.ones_like(al)
    # fundo para a régua e para a transferência: a letra apagada (TELEA) na mediana e no mínimo; não é a placa
    mk = cv2.dilate(((mn > BRILHO - 40) | (alfa_solto(mn) > .05)).astype(np.uint8) * 255, np.ones((5, 5), np.uint8))
    if emoji:
        ex = emoji["bbox"]
        mk[max(0, ex[1] - ry - 3):ex[3] - ry + 4, max(0, ex[0] - rx - 3):ex[2] - rx + 4] = 255
    fundo = cv2.inpaint(med, mk, 5, cv2.INPAINT_TELEA)
    fundo_min = cv2.inpaint(mn, mk, 5, cv2.INPAINT_TELEA).astype(np.float32)
    cor_txt = float(np.median(mn[mn > BRILHO + 10])) if (mn > BRILHO + 10).any() else 255.0
    zr = emoji and r_zerar
    def transf(a):
        b = alfa_solto(a * cor_txt + fundo_min * (1 - a))
        if zr:
            b[zr[2]:zr[3], max(0, zr[0]):zr[1]] = 0
        return limpar_blobs(b)
    cands = _candidatas(al, peso, ls, meds, ev, transf=transf)
    stem = traco(al)
    best = cands[0]
    lay = best["layout"]
    desenho = fontes.desenhar(best["fontId"], ls, rw, rh, lay["sz"], lay["pitch"], lay["base"], lay["cxs"], lay["tr"])
    sombra, err_sem, err_com = medir_sombra(med, fundo.astype(np.float32), desenho, al)
    gates.update(sombra_err_sem=r2(err_sem, 2), sombra_err_com=r2(err_com, 2))
    texto_cor = np.median(med[mn > BRILHO + 10], 0) if (mn > BRILHO + 10).any() else np.array([255, 255, 255])
    erased = [dict(x=int(rx + q[2]), y=int(ry + q[0]), w=int(q[4]), h=int(q[1] - q[0])) for q in meds]
    return dict(
        kind="loose", ok=True, reason=None, gates=gates, box=None, radiusPx=0, plate=None,
        dilatacao=impar(17 * W / 1080), sombra=_sombra_css(sombra), stemPx=r2(stem, 2), color=hexa(texto_cor),
        lines=ls, linhasMedidas=[[q[0] + ry, q[1] + ry, q[2] + rx, q[3] + rx, q[4]] for q in meds],
        align=_alinhamento(_com_emoji(meds, emoji, rx)), caseStyle=_caixa_alta(texto), emphasis=None, emoji=emoji, sublinhados=[],
        sideMarginPx=int(round(.05 * W)), erasedRects=erased,
        candidatas=[_desloca(c, rx, ry) for c in cands],
        molde=dict(roi=list(roi), brilho=BRILHO),
        # fundo da régua = o do MÍNIMO (mesmo modelo do alvo, que vem do mínimo dos quadros); o da mediana é mais claro e
        # engrossava a tinta da prova (vídeo real da S4: Arimo 600 com traço +15,7 %)
        ref=dict(modo="loose", rect=[int(rx), int(ry), int(rw), int(rh)], alvo=png_uri((al * 255).astype(np.uint8)),
                 fundo=png_uri(cv2.cvtColor(fundo_min.clip(0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)), zerar_linhas=[], zerar_colunas=zerar, stem=r2(stem, 3), linhas=meds, cor=hexa(texto_cor)),
        emojis=len(emojis),
    )


# ───────── fase régua (§16.2 A3) ─────────

LIMITES = {
    "box": dict(stem=.15, corr_same=.64, corr_close=.55, larg_same=.035, larg_close=.06, base_same=3, base_close=5),
    "loose": dict(stem=.15, corr_same=.85, corr_close=.75, larg_same=.035, larg_close=.06, base_same=3, base_close=5),
}


def regua(ev):
    """Stills RGBA do Chrome (quadro inteiro, fundo transparente) → composição sobre o fundo de referência → mesma
    extração de alfa do original → traço primeiro (± 15 %), depois a maior corr. Devolve a escolha e todas as medidas."""
    ref = ev["ref"]
    modo = ref["modo"]
    X, Y, w, h = ref["rect"]
    alvo = de_uri(ref["alvo"], cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    fundo = de_uri(ref["fundo"], cv2.IMREAD_COLOR).astype(np.float32)
    lim = LIMITES[modo]
    esc = 720 / float(ev.get("largura") or 720)
    meds_o = ref["linhas"]
    out = []
    for s in ev["stills"]:
        img = de_uri(s["png"], cv2.IMREAD_UNCHANGED)
        if img.ndim == 2 or img.shape[2] == 3:
            raise ValueError("still sem alfa")
        c = img[Y:Y + h, X:X + w].astype(np.float32)
        a = c[..., 3:4] / 255
        comp = (c[..., :3] * a + fundo * (1 - a)).clip(0, 255).astype(np.uint8)
        if modo == "box":
            al, _, _, _ = alfa_caixa(comp, [tuple(z) for z in ref["zerar_linhas"]])
            if al is None:
                out.append(dict(fontId=s["fontId"], ok=False, motivo="sem_tinta"))
                continue
        else:
            al = alfa_solto(cv2.cvtColor(comp, cv2.COLOR_BGR2GRAY))
        if ref.get("zerar_colunas"):
            z0, z1, zy0, zy1 = ref["zerar_colunas"]
            al[zy0:zy1, max(0, z0):z1] = 0
        if modo == "loose":
            al = limpar_blobs(al)
        st = traco(al)
        corr = float(np.corrcoef(alvo.ravel(), al.ravel())[0, 1])
        meds = linhas(al)
        m = dict(fontId=s["fontId"], corr=r2(corr, 4), stem=r2(st, 3), stemErr=r2((st - ref["stem"]) / ref["stem"], 4))
        if len(meds) == len(meds_o):
            m["widthErr"] = r2(max(abs(q[4] - o[4]) / o[4] for q, o in zip(meds, meds_o)), 4)
            m["baseErr720"] = r2(abs(meds[0][1] - meds_o[0][1]) * esc, 2)
            if len(meds) > 1:
                po = (meds_o[-1][1] - meds_o[0][1]) / (len(meds) - 1)
                pq = (meds[-1][1] - meds[0][1]) / (len(meds) - 1)
                m["pitchErr720"] = r2(abs(pq - po) * esc, 2)
        else:
            m["widthErr"] = 1.0
            m["baseErr720"] = 99.0
        out.append(m)
    validas = [m for m in out if "corr" in m and abs(m["stemErr"]) <= lim["stem"]]
    if not validas:
        return dict(escolhida=None, tier="far", medidas=out, motivo="traco")
    best = max(validas, key=lambda m: m["corr"])

    def tier(m):
        base = max(m.get("baseErr720", 0), m.get("pitchErr720", 0))
        if m["corr"] >= lim["corr_same"] and m["widthErr"] <= lim["larg_same"] and base <= lim["base_same"]:
            return "same"
        if m["corr"] >= lim["corr_close"] and m["widthErr"] <= lim["larg_close"] and base <= lim["base_close"]:
            return "close"
        return "far"
    return dict(escolhida=best["fontId"], tier=tier(best), medidas=out)
