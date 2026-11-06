"""escrever_s1.py — W1 do escrever.py do S2 (texto novo, mesmo tamanho e estilo, sobre a placa E2), sem o antes-depois. Cache de páginas com LRU (8).
Texto: textos.py (tr) nos 3 vídeos do S2; no vídeo de 120 s, a própria fala em maiúsculas por frase do Whisper (só para medir tempo)."""
import time, subprocess, collections, numpy as np, cv2
from PIL import Image
from leg import layout, render, palavras_whisper, limpa
from pegada import cor_args
from detectar import candidato, frames

def frases_auto(whisper):
    import json
    d = json.load(open(whisper)); out = []; txt = []; k = 0
    for s in d["segments"]:
        n = [w for w in s["words"] if limpa(w["word"])]
        if not n: continue
        out.append((k, k + len(n) - 1)); txt.append(" ".join(limpa(w["word"]) for w in n)); k += len(n)
    return out, txt

def escrever(placa, orig, L, whisper, fr, txt, saida, m_npz=None):
    t0 = time.time(); FPS = 30; E = dict(L.E); W, H, y0, y1, Hb = L.W, L.H, L.y0, L.y1, L.Hb; ws = palavras_whisper(whisper); N = L.N; CAIXA = L.caixa
    masks = letras = None
    if m_npz is not None:
        Mz = np.load(m_npz, allow_pickle=True); masks, letras = Mz["masks"], Mz["letras"]
    un = lambda a, t: np.unpackbits(np.asarray(a[t], np.uint8))[:Hb * W].reshape(Hb, W).astype(bool)
    E["blur"] = 1.0 if CAIXA else 0.6; tam = int(round(E["tam"])); est = dict(E, tam=tam, stroke=max(2, int(round(E["stroke"]))), sombra=[int(round(x)) for x in E["sombra"]])
    BR, AM = E["branco"], E["amarelo"] or [255, 230, 0]
    if CAIXA: est.update(caixa_cor=[[27, 115, 231], [95, 218, 175]], caixa_alt=[43, 12], caixa_pad=8, caixa_raio=5, caixa_sombra=3)
    atr = [int(k) / FPS - ws[idx[0]]["ini"] for k, idx in E["alinhamento"].items() if idx]; ATR = float(np.clip(float(np.median(atr)), 0, 0.4))
    LMAX = 0.90 * W; MAXL = 1
    def largura(pal): return layout(pal, est["fonte"], tam, est["tr"], est["esp"])[1] + 2 * (est["stroke"] + 2)
    paginas = []
    for k, ((i, j), s) in enumerate(zip(fr, txt)):
        ini = ws[i]["ini"] + ATR; fim = ws[j]["fim"] + ATR
        if k + 1 < len(fr):
            px = ws[fr[k + 1][0]]["ini"] + ATR
            if px - fim < 0.35: fim = px
        pal = s.split(); pg = []; lin = []; pag = []
        for w in pal:
            if lin and (largura(lin + [w]) > LMAX or len(lin) >= 5):
                pag.append(lin); lin = []
                if len(pag) == MAXL: pg.append(pag); pag = []
            lin.append(w)
        if lin: pag.append(lin)
        if pag: pg.append(pag)
        total = sum(len(w) + 1 for p in pg for l in p for w in l); tc = ini
        for p in pg:
            pw = [w for l in p for w in l]; d = (fim - ini) * sum(len(w) + 1 for w in pw) / total
            tempos = []; x = tc
            for w in pw: tempos.append(x); x += d * (len(w) + 1) / sum(len(q) + 1 for q in pw)
            paginas.append({"lin": p, "pw": pw, "ini": tc, "fim": tc + d, "tempos": tempos}); tc += d
    pag_de = np.full(N, -1)
    for i, p in enumerate(paginas):
        a, b = int(round(p["ini"] * FPS)), int(round(p["fim"] * FPS)); pag_de[a:min(b, N)] = i
    def centro_antigo(t):
        i = L.seg_de[min(t, N - 1)]
        if i < 0 or not L.segs[i]["usa"]: i = min(L.boas, key=lambda j: abs(L.segs[j]["ini"] - t))
        else: i = L.segs[i]["usa"][0]
        s = L.segs[i]; return (s["r0"] + s["r1"]) / 2
    cache = collections.OrderedDict()
    def legenda(i, ativa):
        k = (i, ativa)
        if k in cache: cache.move_to_end(k); return cache[k]
        p = paginas[i]; mid = int((p["ini"] + p["fim"]) / 2 * FPS); c = centro_antigo(mid); nl = len(p["lin"]); ent = int(tam * 1.12)
        cap = 0.36 * tam; bases = [int(c + cap - (nl - 1) * ent / 2 + q * ent) for q in range(nl)]
        im = Image.new("RGBA", (W, Hb), (0, 0, 0, 0)); o = 0; cx = W / 2
        for lin, b in zip(p["lin"], bases):
            ai = ativa - o if o <= ativa < o + len(lin) else None; cores = [BR] * len(lin)
            if CAIXA: cam = render(W, Hb, lin, est, cx, b, cores=cores, caixa=ai)
            else:
                if ai is not None: cores[ai] = AM
                cam = render(W, Hb, lin, est, cx, b, cores=cores)
            im.alpha_composite(cam); o += len(lin)
        a = np.array(im).astype(np.float32); cache[k] = (a[..., 2::-1].copy(), a[..., 3:4] / 255.0)
        while len(cache) > 8: cache.popitem(last=False)
        return cache[k]
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-ss", "0", "-t", "10000", "-i", orig,
        "-map", "0:v", "-map", "1:a", *cor_args(orig), "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", saida], stdin=subprocess.PIPE)
    m1 = []; m2 = []; n = 0
    for t, fp in enumerate(frames(placa, W, H)):
        f = fp.copy(); ba = fp[y0:y1]; i = pag_de[t] if t < N else -1; alpha = None
        if i >= 0:
            p = paginas[i]; tt = t / FPS; at = max([k for k, x in enumerate(p["tempos"]) if x <= tt + 0.017] or [0])
            rgb, alpha = legenda(i, at); f[y0:y1] = np.clip(ba * (1 - alpha) + rgb * alpha, 0, 255).astype(np.uint8)
        if masks is not None and t < len(masks):
            Fp = un(masks, t); Tm = un(letras, t)
            if Fp.sum() > 30:
                cob = (alpha[..., 0] >= 0.5) if alpha is not None else np.zeros_like(Fp)
                m1.append(float((Fp & ~cob).sum() / Fp.sum()))
                res = candidato(ba, CAIXA) & cv2.dilate(Tm.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~cob
                m2.append(float(res.sum() / max(Tm.sum(), 1)))
        enc.stdin.write(f.tobytes()); n += 1
    enc.stdin.close(); enc.wait()
    r = dict(quadros=n, paginas=len(paginas), escrever_s=round(time.time() - t0, 2))
    if m1: r.update(area_a_vista_media=round(100 * float(np.mean(m1)), 1), area_a_vista_p95=round(100 * float(np.percentile(m1, 95)), 1), letra_detectavel_media=round(100 * float(np.mean(m2)), 1), letra_detectavel_p95=round(100 * float(np.percentile(m2, 95)), 1))
    return r
