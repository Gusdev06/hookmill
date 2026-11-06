"""ajustar_rapido.py — contrato §3.2. Acha fonte, tamanho, tracking, espaço, traço, sombra e alinhamento sem a grade cega.
1. Tabela de avanços (getlength por caractere, uma vez por fonte, sem desenhar): para cada fonte × tracking × espaço, o tamanho que
   cada trecho pediria é largura_medida / largura_por_unidade. Na fonte certa esse tamanho é quase constante. Erro = mediana do resíduo.
2. IoU (com desenho, encaixa do S2) só nas K melhores fontes, em 3 trechos, e só nos tr/esp vizinhos.
3. Alinhamento: mesma programação dinâmica do S2, com pontuação por largura calculada em vez de IoU desenhado.
4. Traço, sombra e cores: mesmo código do ajustar.py.
Não usa o fontId da visão (a sonda é sem chamada paga): é o pior caso, todas as fontes empacotadas competem."""
import time, json, numpy as np, cv2
from detectar import frames
from leg import CATALOGO, fonte, limpa, encaixa, palavras_do_trecho, palavras_whisper

CAT = [c for c in CATALOGO if not c["arq"].startswith("/")]  # fontes do sistema do Mac não vão para a Lambda (licença); ver README
TRS = (-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.05, 0.08, 0.12); ESPS = (0.2, 0.5, 1.0, 1.6)
FPS = 30

class Tabela:
    def __init__(self, spec):
        self.f = fonte(spec, 100); self.adv = {}; self.sp = self.f.getlength(" ") / 100
        b = self.f.getbbox("H", anchor="ls"); self.cap = (b[3] - b[1]) / 100
    def soma(self, pal):
        """(soma dos avanços, caracteres, espaços) por unidade de tamanho, igual ao layout() do leg.py"""
        t = 0.0; n = 0
        for w in pal:
            for ch in w:
                if ch not in self.adv: self.adv[ch] = self.f.getlength(ch) / 100
                t += self.adv[ch]; n += 1
        return t, n, max(0, len(pal) - 1)

def altura_letra(est):
    """linhas com 60 % ou mais do máximo: miolo das maiúsculas. A caixa do karaokê pega só uma palavra e fica abaixo disso."""
    rc = est.sum(1)
    if rc.max() == 0: return 0.0
    r = np.where(rc >= 0.6 * rc.max())[0]; return float(r.max() - r.min() + 1)

def largura_alvo(est):
    xs = np.where(est.any(0))[0]; return float(xs.max() - xs.min() + 1) if len(xs) else 0.0

def ajustar(video, npz, whisper, K=4, n_iou=3, VARS=1, ITER=2, n_ref=4):
    T = {}; t0 = time.time()
    D = np.load(npz, allow_pickle=True); W = int(D["W"]); y0 = int(D["y0"]); H_V = int(D["H"])
    ws = palavras_whisper(whisper)
    TODOS = [s for s in D["segs"] if not s["vazio"] and s["est"].sum() > 300 and s["fim"] - s["ini"] >= 8]
    for s in TODOS:
        s["pal"] = [w["w"] for w in palavras_do_trecho(ws, s["ini"] / FPS, s["fim"] / FPS)]; s["wm"] = largura_alvo(s["est"])
    H_LETRA = float(np.median([altura_letra(s["est"]) for s in TODOS if s["est"].sum() > 600]))
    T["altura_letra_px"] = H_LETRA
    usados = [s for s in TODOS if s["pal"] and s["wm"] > 0]
    tabs = {i: Tabela(c) for i, c in enumerate(CAT)}
    def rankear(segs):
        """todas as fontes × tr × esp pela tabela, nas palavras atribuídas aos trechos: tamanho quase constante = fonte certa"""
        wm = np.array([s["wm"] for s in segs], np.float64); out = []
        for i in range(len(CAT)):
            A = np.array([tabs[i].soma(s["pal"]) for s in segs], np.float64)
            for tr_ in TRS:
                for esp_ in ESPS:
                    L = A[:, 0] + tr_ * A[:, 1] + esp_ * tabs[i].sp * A[:, 2]
                    # tamanho: o da altura da letra da fonte, que não depende da palavra certa; a largura confere a fonte, tr e esp
                    m = H_LETRA / tabs[i].cap; e = np.sort(np.abs(wm - m * L) / wm)
                    out.append((float(e[:max(3, int(0.7 * len(e)))].mean()), i, tr_, esp_, float(m)))
        out.sort(key=lambda r: r[0]); return out
    # palavra -> trecho e fonte se corrigem em turnos: a atribuição inicial pelo tempo da fala erra por causa do atraso da legenda.
    # Roda um turno global, e depois um por família finalista, cada uma com o seu alinhamento (legenda de karaokê em caixa engana a largura).
    def turnos(ranking_, filtro=None, n=ITER):
        pal = None
        for _ in range(n):
            _, i_, tr_, esp_, m_ = ranking_[0]
            al_ = alinha_largura(TODOS, ws, tabs[i_], tr_, esp_, m_)
            for s, idx in zip(TODOS, al_): s["pal"] = [ws[i]["w"] for i in idx]
            us = [s for s in TODOS if s["pal"] and s["wm"] > 0]
            r2 = rankear(us)
            ranking_ = [r for r in r2 if filtro is None or r[1] == filtro]
            pal = [list(s["pal"]) for s in TODOS]
        return ranking_, pal
    ranking, _ = turnos(rankear(usados))
    T["tabela_s"] = round(time.time() - t0, 3); t1 = time.time()
    por_fonte = {}
    for r in ranking: por_fonte.setdefault(r[1], []).append(r)
    top = sorted(por_fonte.items(), key=lambda kv: kv[1][0][0])[:K]
    res = []; pals = {}; rks = {}
    for i, rs in top:
        rks[i], pals[i] = turnos(rs, filtro=i, n=2)
    # mesma amostra para todas as finalistas: trechos em que elas concordam nas palavras (2+), os maiores
    idx = [j for j, s in enumerate(TODOS) if len(pals[top[0][0]][j]) >= 2 and all(pals[i][j] == pals[top[0][0]][j] for i, _ in top) and s["wm"] > 0]
    if len(idx) < n_iou: idx = [j for j, s in enumerate(TODOS) if len(pals[top[0][0]][j]) >= 2 and s["wm"] > 0]
    idx0 = idx; idx = sorted(idx, key=lambda j: -TODOS[j]["est"].sum())[:n_iou]
    amostra = [(TODOS[j], pals[top[0][0]][j]) for j in idx]
    def nota(i, tr_, esp_, am, m_):
        return float(np.median([encaixa(s["est"], p, CAT[i], tr_, esp_, W)[0] for s, p in am]))
    for i, _ in top:
        for _, _, tr_, esp_, m_ in rks[i][:VARS]:
            res.append((nota(i, tr_, esp_, amostra, m_), i, tr_, esp_, m_))
    res.sort(key=lambda r: -r[0]); _, ib, tr, esp, m = res[0]
    # refino: vizinhos de tr e esp na fonte vencedora; depois os outros pesos da mesma família (a tabela quase não separa Poppins Black de ExtraBold)
    fam = lambda c: c["arq"].split("-")[0]; maior = sorted(idx0, key=lambda j: -TODOS[j]["est"].sum())[:n_ref]
    am2 = [(TODOS[j], pals[top[0][0]][j]) for j in maior]
    it, ie = TRS.index(tr), ESPS.index(esp); mi = H_LETRA / tabs[ib].cap
    cand = [(nota(ib, t_, e_, am2, mi), ib, t_, e_, mi) for t_, e_ in [(t_, esp) for t_ in TRS[max(0, it - 1):it + 2]] + [(tr, e_) for e_ in ESPS[max(0, ie - 1):ie + 2] if e_ != esp]]
    cand.sort(key=lambda r: -r[0]); _, ib, tr, esp, m = cand[0]
    for i, c in enumerate(CAT):
        if i != ib and fam(c) == fam(CAT[ib]):
            mi = H_LETRA / tabs[i].cap
            for t_ in TRS[max(0, TRS.index(tr) - 1):TRS.index(tr) + 2]: cand.append((nota(i, t_, esp, am2, mi), i, t_, esp, mi))
    cand.sort(key=lambda r: -r[0]); res = cand + res; _, ib, tr, esp, m = cand[0]; spec = CAT[ib]; amostra = am2
    T["iou_s"] = round(time.time() - t1, 3); t1 = time.time()
    t_ind = sorted(idx0, key=lambda j: -TODOS[j]["est"].sum())[:8]
    fits = [encaixa(TODOS[j]["est"], pals[top[0][0]][j], spec, tr, esp, W) for j in t_ind]
    tam = int(np.median([f[1][0] for f in fits if f[1]])); base = int(np.median([f[1][2] for f in fits if f[1]])); cxm = float(np.median([f[1][1] for f in fits if f[1]]))
    # alinhamento: mesma PD, com largura calculada
    al = alinha_largura(TODOS, ws, tabs[ib], tr, esp, H_LETRA / tabs[ib].cap)
    for s, idx in zip(TODOS, al): s["pal"] = [ws[i]["w"] for i in idx]
    T["alinha_s"] = round(time.time() - t1, 3); t1 = time.time()
    cap = cv2.VideoCapture(video); runs = {"esq": [], "dir": [], "cima": [], "baixo": []}; y1 = int(D["y1"])
    for s in TODOS[::2]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, (s["ini"] + s["fim"]) // 2); ok, fr = cap.read()
        c = fr[y0:y1]; yy = np.where(s["est"].any(1))[0]; xx = np.where(s["est"].any(0))[0]
        if not len(yy): continue
        a_, b_ = max(0, yy.min() - 2), yy.max() + 3; e_, d_ = max(0, xx.min() - 30), xx.max() + 31   # varre só a caixa do texto: as linhas e colunas fora dela não têm borda de letra
        a2 = max(0, a_ - 30); b2 = b_ + 30
        lum = c[a2:b2, e_:d_].max(2).astype(int); est = s["est"][a2:b2, e_:d_]
        for nome, arr, msk in (("esq", lum[:, ::-1], est[:, ::-1]), ("dir", lum, est), ("baixo", lum.T, est.T), ("cima", lum.T[:, ::-1], est.T[:, ::-1])):
            for r in range(arr.shape[0]):
                row, mr = arr[r], msk[r]
                ed = np.where(mr[:-1] & ~mr[1:])[0]
                for e in ed:
                    k = e + 1; n = 0
                    while k < len(row) and row[k] < 90 and not mr[k]: k += 1; n += 1
                    if 0 < n < 25 and k < len(row) and row[k] > 120 and not mr[k]: runs[nome].append(n)
    med = {k: (float(np.median(v)) if v else None) for k, v in runs.items()}
    sw = int(round(min(x for x in med.values() if x))) - 1
    dx = max(0, int(round(med["dir"] - med["esq"]))); dy = max(0, int(round(med["baixo"] - med["cima"])))
    T["contorno_s"] = round(time.time() - t1, 3); t1 = time.time()
    # cor: pelo ffmpeg, não pelo VideoCapture. O VideoCapture da Lambda dá outra cor em fonte BT.709 (amarelo 252,239,1 contra 249,253,10 no Mac).
    pix = []
    for s in TODOS[::max(1, len(TODOS) // 5)][:6]:
        fr = next(iter(frames(video, W, H_V, ini=(s["ini"] + s["fim"]) // 2, qtd=1)))
        pix.append(fr[y0:y1][cv2.erode(s["est"].astype(np.uint8), np.ones((3, 3))) > 0])
    pix = np.concatenate(pix).astype(int)
    bri = pix[(pix.min(1) > 170) & (np.ptp(pix, 1) < 60)]; yel = pix[(pix[:, 2] > 160) & (pix[:, 1] > 160) & (pix[:, 0] < 120)]
    branco = np.median(bri, 0)[::-1].astype(int).tolist() if len(bri) else [255, 255, 255]
    amarelo = np.median(yel, 0)[::-1].astype(int).tolist() if len(yel) > 200 else None
    T["cores_s"] = round(time.time() - t1, 3); T["total_s"] = round(time.time() - t0, 3)
    est = {"fonte": spec, "tam": tam, "tr": tr, "esp": esp, "stroke": sw, "sombra": [dx, dy], "cor_traco": [0, 0, 0], "branco": branco, "amarelo": amarelo,
           "base": base, "cx": cxm, "contorno_medido": med, "alinhamento": {str(int(s["ini"])): idx for s, idx in zip(TODOS, al)},
           "ranking_tabela": [[r[0], CAT[r[1]]["arq"] + (":" + CAT[r[1]]["var"] if CAT[r[1]].get("var") else ""), r[2], r[3], r[4]] for _, rs in top for r in rs[:1]],
           "iou_finalistas": [[r[0], CAT[r[1]]["arq"] + (":" + CAT[r[1]]["var"] if CAT[r[1]].get("var") else ""), r[2], r[3]] for r in res[:6]]}
    return est, T

def alinha_largura(segs, ws, tab, tr, esp, tam, folga=1.0, maxp=5):
    """Copia de leg.alinha: muda só a pontuação (largura calculada contra a medida, em vez do IoU desenhado)."""
    n, m = len(ws), len(segs); NEG = -1e9
    best = np.full((m + 1, n + 1), NEG); best[0, :] = 0; arg = {}
    memo = {}
    def sc(j, i, k):
        if (j, i, k) not in memo:
            s = segs[j]; t0, t1 = s["ini"] / FPS - folga, s["fim"] / FPS + folga
            if any(not (t0 <= w["ini"] <= t1) for w in ws[i:k]): memo[(j, i, k)] = NEG
            elif k == i: memo[(j, i, k)] = 0.0
            else:
                a, c, e = tab.soma([w["w"] for w in ws[i:k]]); L = (a + tr * c + esp * tab.sp * e) * tam; wm = s["wm"]
                memo[(j, i, k)] = max(0.0, 1.0 - abs(wm - L) / max(wm, 1.0))
        return memo[(j, i, k)]
    for j in range(m):
        for i in range(n + 1):
            if best[j, i] <= NEG / 2: continue
            for k in range(i, min(n, i + maxp) + 1):
                v = sc(j, i, k)
                if v <= NEG / 2: continue
                if best[j, i] + v > best[j + 1, k]: best[j + 1, k] = best[j, i] + v; arg[(j + 1, k)] = i
        for i in range(n):
            if best[j + 1, i] > best[j + 1, i + 1]: best[j + 1, i + 1] = best[j + 1, i]; arg[(j + 1, i + 1)] = ("pula", i)
    k = int(np.argmax(best[m])); res = [None] * m; j = m
    while j > 0:
        a = arg.get((j, k))
        if isinstance(a, tuple): k = a[1]; continue
        if a is None: res[j - 1] = []; j -= 1; continue
        res[j - 1] = list(range(a, k)); k = a; j -= 1
    return res

def iou_medio(npz, whisper, estilo):
    """IoU médio de um estilo em todos os trechos, com o alinhamento dele: mesma conta para grade e rápido."""
    D = np.load(npz, allow_pickle=True); W = int(D["W"]); ws = palavras_whisper(whisper); segs = {str(int(s["ini"])): s for s in D["segs"] if not s["vazio"]}; v = []
    for k, idx in estilo["alinhamento"].items():
        if k in segs and idx: v.append(encaixa(segs[k]["est"], [ws[i]["w"] for i in idx], estilo["fonte"], estilo["tr"], estilo["esp"], W)[0])
    return round(float(np.mean(v)), 4), len(v)
