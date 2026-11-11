"""Ops da legenda (troca-texto-queimado-v1 §15.6, F2): `detectar`, `placa_legenda`, `conferir_legenda`. Dono: video.

- `detectar`: faixa + trechos + estilo (fonte, corpo, tracking, traço, sombra, cores) + alinhamento das palavras + medidas dos portões da
  1ª tabela da §15.6.1. Devolve JSON (sem pixel) e grava `d.npz` (trechos estáveis, tomadas, estilo) para a placa. Quando a legenda tem caixa
  de destaque, detecta uma 2ª vez COM caixa (faixa já conhecida) só para a placa, como a S1 exigiu.
- `placa_legenda`: E2 (temporal, DIS + TELEA) de 1 pedaço [ini, fim) com contexto de `ctx` quadros sem atravessar corte, GOP fechado.
- `conferir_legenda`: portões depois da placa em janelas de 0,5 s (lisura, trem, degrau), letra detectável, fora do buraco, salto na emenda.
Cor pela §15.6.6 (comum.py): nunca cv2.VideoCapture.
"""
import json, re, time
import numpy as np
import cv2

from comum import sonda, quadros
import leg_det
from leg_fontes import encaixa, id_fonte, limpa
import leg_estilo
import leg_portoes as P

CAIXA_COR = lambda b, g, r: ((b > 140) & (b - r > 50)) | ((g > 140) & (b > 120) & (r < 120)) | ((r > 110) & (r - g > 70) & (r - b > 50) & (g < 90))   # = candidato(caixa=True)
CJK_RTL = re.compile(r"[֐-ࣿ　-ヿ㐀-鿿가-힯יִ-﷿ﹰ-﻿]")
FOLGA = 1.0


def _tem_caixa(video, D, amostras=24):
    """Caixa de destaque colorida (azul → verde-água, S2; vinho/vermelha e roxa entram pelo candidato) atrás da palavra: ≥ 1,5 % da faixa em ≥ 30 % das amostras
    no meio dos trechos. Devolve (tem, cor `#rrggbb` = MEDIANA dos pixels de caixa, medida: a 1ª versão gravava #2563eb fixo e a peça saía sem o roxo do 26)."""
    segs = [s for s in D["segs"] if not s["vazio"] and s["est"].sum() > 300 and s["fim"] - s["ini"] >= 8]
    if not segs:
        return False, None
    alvo = sorted({int((s["ini"] + s["fim"]) // 2) for s in segs[:: max(1, len(segs) // amostras)]})[:amostras]
    y0, y1 = int(D["y0"]), int(D["y1"]); ok = n = 0; i0 = alvo[0]; px = []
    for i, f in enumerate(leg_det.frames(video, ini=i0, qtd=alvo[-1] - i0 + 1, roi=(y0, y1)), start=i0):
        if i not in alvo:
            continue
        c = f; b, g, r = (c[..., k].astype(np.int16) for k in range(3))
        m = CAIXA_COR(b, g, r)
        ok += int(m.mean() > 0.015); n += 1
        if m.sum() > 200:
            px.append(c[m][:: max(1, int(m.sum() // 4000))])
    tem = n > 0 and ok / n >= 0.3
    cor = None
    if tem and px:
        mb, mg, mr = np.median(np.concatenate(px), axis=0)
        cor = "#%02x%02x%02x" % (int(mr), int(mg), int(mb))
    return tem, cor


def _box_de(seg, y0):
    ys, xs = np.where(seg["est"])
    if not len(ys):
        return None
    return [int(xs.min()), int(ys.min()) + y0, int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]


def detectar(ev, video="video.mp4"):
    t0 = time.time(); T = {}
    info = leg_det.info_de(video); fps = info["fps"]
    words = ev.get("words", [])
    leg_estilo.FPS = fps
    faixa = ev.get("captionBox")
    faixa = [int(faixa["y"]), int(faixa["y"] + faixa["h"])] if faixa else None
    gates = {"duracao_s": round(info["n"] / fps, 2), "alfabeto_fora": float(any(CJK_RTL.search(w.get("word", "")) for w in words)), "emoji_legenda": 0.0}
    ws = leg_estilo.palavras_de(words)
    try:
        D, dinfo = leg_det.detectar(video, caixa=False, faixa=faixa, words=ws)
    except (ValueError, IndexError):   # sem nenhum candidato (max() de lista vazia): legenda sem contorno ou sem legenda
        D, dinfo = None, {"erro": "sem_candidato"}
    T["detectar_s"] = round(time.time() - t0, 2)
    if D is None or not any((not s["vazio"]) and s["est"].sum() > 300 for s in D["segs"]):
        g = {**gates, "cobertura": 0.0, "contorno": 1.0}
        cb = ev.get("captionBox")
        if cb and ws:
            fala = np.zeros(info["n"], bool)
            for w in ws:
                fala[int(w["ini"] * fps):int(w["fim"] * fps)] = True
            g["contorno"] = P.contorno_sem(video, [cb["x"], cb["y"], cb["w"], cb["h"]], np.where(fala)[0])
        return {"detectou": False, "gates": g, "tempos": {**T, "total_s": round(time.time() - t0, 2)}, "quadros": info["n"], "fps": fps}
    st = time.time()
    try:
        est, TT = leg_estilo.ajustar(video, D, words, ev.get("fontIdVisao"))
    except Exception as e:   # noqa: BLE001 — qualquer falha de medida do estilo vira veredito, nunca queda da op
        # estilo não medível (contorno sem borda, trechos curtos demais...): não é falha da função, é legenda que não dá para copiar (font_mismatch)
        return {"detectou": True, "estilo_erro": f"{type(e).__name__}: {e}", "gates": {**gates, "iou_mediana": 0.0}, "trechos": [], "pegada": [], "cortes": [],
                "quadros": info["n"], "fps": fps, "tempos": {**T, "total_s": round(time.time() - t0, 2)}}
    T["estilo_s"] = round(time.time() - st, 2); T.update({"estilo_" + k: v for k, v in TT.items()})
    spec = est["fonte"]; tr, esp = est["tr"], est["esp"]; W = int(D["W"]); y0 = int(D["y0"])
    # trechos, palavras e IoU por trecho
    segs_texto = [s for s in D["segs"] if not s["vazio"] and s["est"].sum() > 300 and s["fim"] - s["ini"] >= 8]
    al = est["alinhamento"]; ids_texto = {id(s) for s in segs_texto}
    trechos, pares, ious = [], [], []
    st = time.time()
    for s in D["segs"]:
        if s["vazio"]:
            continue
        idx = al.get(str(int(s["ini"])), [])
        box = _box_de(s, y0)
        if box is None:
            continue
        pal = [ws[i]["w"] for i in idx]
        texto = " ".join(pal)
        herdado = id(s) not in ids_texto or not pal
        iou = 0.0
        if not herdado:
            iou = float(encaixa(s["est"], pal, spec, tr, esp, W)[0]); ious.append(iou); pares.append((s, pal))
        trechos.append({"iniFrame": int(s["ini"]), "fimFrame": int(s["fim"]), "box": box, "iou": round(iou, 4), "texto": texto, "herdado": bool(herdado)})
    T["iou_s"] = round(time.time() - st, 2)
    n_total = len(trechos)
    atrasos = [s["ini"] / fps - ws[al[str(int(s["ini"]))][0]]["ini"] for s in segs_texto if al.get(str(int(s["ini"])))]
    atraso = float(np.median(atrasos)) if atrasos else 0.0
    cob, fala = P.cobertura_fala(D, ws, fps, atraso)
    h_letra = float(TT.get("altura_letra_px", 0.0))
    lap_med, lap_max = P.fundo_lap(D)
    gates.update({
        "cobertura": round(cob, 4), "contorno": 1.0, "linhas": float(P.linhas_legenda(D, h_letra)), "animacao": round(P.animacao(D), 4),
        "iou_mediana": round(float(np.median(ious)), 4) if ious else 0.0,
        "herdados": round(sum(t["herdado"] for t in trechos) / max(1, n_total), 4),
        "estilo_var": round(P.estilo_estavel(D, pares, spec, tr, esp, W, encaixa), 4),
        "fundo_lap": round(lap_med, 2),
    })
    n_fora = P.marcar_fora(D, ws, fps, atraso)
    caixa, caixa_cor = _tem_caixa(video, D)
    Dp = D
    if caixa:   # a placa exige a detecção com caixa (S1); faixa já conhecida, sem o 1º passo
        st = time.time()
        Dp, _ = leg_det.detectar(video, caixa=True, faixa=[int(D["y0"]), int(D["y1"])])
        P.marcar_fora(Dp, ws, fps, atraso)
        T["detectar_caixa_s"] = round(time.time() - st, 2)
    # pegada de custo por trecho (área do buraco) e o arquivo da placa
    pegada = [{"iniFrame": t["iniFrame"], "fimFrame": t["fimFrame"], "areaPx": int(next((s["est"].sum() for s in D["segs"] if (not s["vazio"]) and s["ini"] == t["iniFrame"]), 0))} for t in trechos]
    est_ts = {
        "fontId": est["fonte_id"], "tamPx": est["tam"], "tracking": est["tr"], "espaco": est["esp"], "strokePx": est["stroke"], "sombra": est["sombra"],
        "corTexto": "#%02x%02x%02x" % tuple(est["branco"]), "corDestaque": ("#%02x%02x%02x" % tuple(est["amarelo"])) if est.get("amarelo") else None,
        "corTraco": "#000000", "caixaDestaque": {"cor": caixa_cor or "#2563eb", "raioPx": max(4, int(round(0.2 * est["tam"])))} if caixa else None,
        "palavrasPorPagina": int(round(float(np.median([len(t["texto"].split()) for t in trechos if not t["herdado"]] or [3])))), "linhas": max(1, int(gates["linhas"])),
        "baseY": est["base"] + y0, "centroX": est["cx"],
    }
    est_arq = {k: est[k] for k in ("fonte", "tam", "tr", "esp", "stroke", "sombra", "cor_traco", "branco", "amarelo", "base", "cx")}
    np.savez_compressed("d.npz", **{k: Dp[k] for k in Dp}, estilo_json=np.array(json.dumps(est_arq)), caixa=np.array(bool(caixa)))
    T["total_s"] = round(time.time() - t0, 2)
    return {"detectou": True, "gates": gates, "estilo": est_ts, "atrasoSec": round(atraso, 3), "trechos": trechos, "pegada": pegada,
            "cortes": [int(x) for x in D["tomadas"][1:-1]], "caixa": bool(caixa), "faixa": [int(D["y0"]), int(D["y1"])], "quadros": int(D["N"]), "fps": fps,
            "fundo_lap_max": round(lap_max, 2), "trechos_fora": n_fora, "faixa_blocos": dinfo.get("faixa_blocos"), "tempos": T, "ranking": est.get("iou_finalistas", [])[:4], "contorno_medido": est.get("contorno_medido")}


def _legenda(npz="d.npz"):
    from leg_pegada import Legenda
    z = np.load(npz, allow_pickle=True)
    return Legenda(npz, json.loads(str(z["estilo_json"])), bool(z["caixa"]))


def placa(ev, video="video.mp4", saida="placa.mp4"):
    from leg_placa import gerar
    L = _legenda()
    return gerar(video, L, saida, int(ev.get("ini", 0)), ev.get("fim"), int(ev.get("ctx", 60)), bool(ev.get("roi", False)))


def conferir(ev, video="video.mp4", pl="placa.mp4"):
    """Portões pós-placa em [ini, fim) (ini múltiplo de 15 quadros, janelas de 0,5 s alinhadas ao vídeo inteiro)."""
    iv, ip = sonda(video), sonda(pl)
    L = _legenda(); y0, y1 = L.y0, L.y1; W = iv["w"]; fps = iv["fps"]
    ini = int(ev.get("ini", 0)); fim = int(ev.get("fim") or iv["n"]); n = fim - ini
    cortes = set(int(x) for x in L.tomadas)
    bordas = {int(s[k]) + d for s in L.segs for k in ('ini', 'fim') for d in range(-3, 4)}   # quadros de troca de página: a letra nova entra antes do trecho
    K5, K15, K7 = np.ones((5, 5), np.uint8), np.ones((15, 15), np.uint8), np.ones((7, 7), np.uint8)
    rows, fora, letras = [], [], []
    po = pp = None; t0 = time.time()
    for k, (a_bgr, b_bgr) in enumerate(zip(quadros(video, iv, ini=ini, n=n, roi=(0, y0, W, y1 - y0)), quadros(pl, ip, ini=ini, n=n, roi=(0, y0, W, y1 - y0)))):
        t = ini + k
        a, b = cv2.cvtColor(a_bgr, cv2.COLOR_BGR2GRAY), cv2.cvtColor(b_bgr, cv2.COLOR_BGR2GRAY)
        hole = cv2.morphologyEx((cv2.absdiff(a, b) > 25).astype(np.uint8), cv2.MORPH_CLOSE, K5)
        H = hole > 0; ring = (cv2.dilate(hole, K15) > 0) & ~H; r = {"t": t}
        outside = ~(cv2.dilate(hole, K15) > 0)
        fora.append(float(np.abs(a_bgr.astype(np.int16) - b_bgr.astype(np.int16)).mean(2)[outside].mean()) if outside.any() else 0.0)
        if H.sum() > 200 and ring.sum() > 200:
            bb = cv2.GaussianBlur(b, (0, 0), 2).astype(np.float32)
            inner = H & (cv2.erode(hole, K7) == 0); outer = (cv2.dilate(hole, K7) > 0) & ~H
            r["degrau"] = float(abs(bb[inner].mean() - bb[outer].mean()))
            lb = np.abs(cv2.Laplacian(b, cv2.CV_32F, ksize=3)); lo = np.abs(cv2.Laplacian(a, cv2.CV_32F, ksize=3))
            er = cv2.erode(hole, np.ones((3, 3), np.uint8)) > 0
            r["detalhe"] = float(lo[ring].mean())
            # fundo liso (anel da PLACA quase sem detalhe, ex. preto da tela de 26/05): a razão preenchido ÷ anel é 0 ÷ 0 e reprovava toda janela; sem detalhe a lisura não se mede
            r["lisura"] = float(lb[er].mean() / max(lb[ring].mean(), .1)) if er.sum() > 50 and float(lb[ring].mean()) >= 3.0 else None
            if pp is not None:
                r["trem"] = float(cv2.absdiff(b, pp)[H].mean()); r["mov"] = float(cv2.absdiff(a, po)[ring].mean())
        rows.append(r); po, pp = a.copy(), b.copy()
        if t % 5 == 0 and t < len(L.seg_de) and t not in bordas:
            _, Tl = L.pegada(a_bgr, t)
            if Tl.any():
                from leg_det import candidato
                near = cv2.dilate(Tl.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
                letras.append(float((candidato(b_bgr, L.caixa) & near).sum() / max(1, Tl.sum()) * 100))
    jan = []; JAN = max(8, int(round(fps / 2)))   # janela de 0,5 s em QUADROS (a 1ª versão fixava 15: a 60 fps virava 0,25 s e o gancho contava o dobro)
    for i in range(0, len(rows), JAN):
        sub = rows[i:i + JAN]; ts = [x["t"] for x in sub]
        com_corte = any(c in cortes for c in range(ts[0], ts[-1] + 2) if c)
        v = [x for x in sub if x.get("mov") is not None]
        m = lambda key: float(np.mean([x[key] for x in v if x.get(key) is not None])) if any(x.get(key) is not None for x in v) else None
        ruim = None
        if len(v) >= int(0.55 * JAN) and not com_corte:
            lis, tre, deg = m("lisura"), m("trem"), m("degrau")
            ruim = bool((lis is not None and lis < 0.5) or (tre is not None and tre > 3.5) or (deg is not None and deg > 3))
        jan.append({"iniFrame": ts[0], "ruim": ruim, "corte": bool(com_corte), "lisura": m("lisura"), "trem": m("trem"), "degrau": m("degrau"), "detalhe": m("detalhe")})
    salto = []
    for e in ev.get("emendas", []):
        if ini < e <= fim:
            qa = list(quadros(pl, ip, ini=e - 1, n=2, cinza=True))
            if len(qa) == 2:
                mse = float(((qa[0].astype(np.float32) - qa[1].astype(np.float32)) ** 2).mean())
                salto.append(float(10 * np.log10(255 ** 2 / max(mse, 1e-3))))
    return {"ini": ini, "fim": fim, "janelas": jan, "fora_buraco_media": float(np.mean(fora)) if fora else 0.0, "fora_buraco_pior": float(np.max(fora)) if fora else 0.0,
            "letra_p95_pct": float(np.percentile(letras, 95)) if letras else 0.0, "letra_amostras": len(letras), "letra_valores": [round(x, 3) for x in letras], "fora_valor_soma": float(np.sum(fora)), "fora_valor_n": len(fora), "janela_quadros": JAN, "salto_emenda_db": salto,
            "matriz_desconhecida": iv["matriz"] is None, "quadros_video": iv["n"], "quadros_placa": ip["n"], "conferir_s": round(time.time() - t0, 2)}
