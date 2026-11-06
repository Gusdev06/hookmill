#!/usr/bin/env python3
"""placa.py <id> [--shift dy] — gera as duas placas (o vídeo sem a legenda antiga):
  E1: TELEA raio 5 em cada quadro, por trecho, como o trocar.py.
  E2: temporal guiado por fluxo óptico (sem IA, sem GPU). Por tomada: fluxo DIS em meia resolução sobre quadros pré-preenchidos;
      passada para frente e para trás carregando o pixel real de onde ele estava à vista; onde as duas passadas têm pixel,
      faz fusão pela idade (distância em quadros até o pixel real); correção de exposição pela borda do buraco; TELEA só no que
      sobra, estabilizado pelo quadro anterior.
Com --shift dy: não grava vídeo. Desloca a máscara para uma área SEM legenda e mede PSNR contra o pixel verdadeiro."""
import sys, os, json, time, resource, subprocess, numpy as np, cv2
from pegada import *
v = sys.argv[1]; SHIFT = int(sys.argv[sys.argv.index("--shift") + 1]) if "--shift" in sys.argv else None
MAXIDADE = int(sys.argv[sys.argv.index("--idade") + 1]) if "--idade" in sys.argv else 120
L = Legenda(v); W, H, y0, y1, N = L.W, L.H, L.y0, L.y1, L.N; path = f"v{v}.mp4"
SEM_EST = "--com-estatica" not in sys.argv; MEMB = "--membrana" in sys.argv; SIG = 6.0; TAG = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else ""
ERRO = 14.0; MARGEM = 3; FPS = 30; DIS = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)

def rss(): return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9

# --- 1. cortes de tomada + máscara
t0 = time.time(); th = []; masks = []; letras = []
for t, f in enumerate(frames(path, W, H)):
    th.append(cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (64, 114), interpolation=cv2.INTER_AREA).astype(np.int16))
    Fp, T = L.pegada(f[y0:y1], t)
    if SHIFT:  Fp = np.roll(Fp, SHIFT, 0); T = np.roll(T, SHIFT, 0)
    masks.append(np.packbits(Fp.astype(bool))); letras.append(np.packbits(T))
Nf = len(th); dif = np.array([0] + [np.abs(th[i] - th[i - 1]).mean() for i in range(1, Nf)])
med = np.median(dif) + 1
lum = np.array([x.mean() for x in th]); escuro = lum < 22  # fade/quadro preto: não existe pixel útil para carregar através dele
cortes = [0] + [i for i in range(1, Nf) if (dif[i] > 14 and dif[i] > 5 * med) or escuro[i] != escuro[i - 1]] + [Nf]
tom = list(zip(cortes[:-1], cortes[1:])); T_MASK = time.time() - t0
un = lambda m, t: np.unpackbits(m[t])[:L.Hb * W].reshape(L.Hb, W).astype(bool)
print("tomadas:", tom, "mascara_s", round(T_MASK, 1), flush=True)

def wr(p):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                             *cor_args(path), "-c:v", "libx264", "-crf", "14", "-preset", "veryfast", "-pix_fmt", "yuv420p", p], stdin=subprocess.PIPE)

def completar_fluxo(fl, m):
    """dentro do buraco o fluxo não vale nada: difunde o de fora (convolução normalizada)"""
    k = (cv2.dilate(m.astype(np.uint8), elipse(2)) == 0).astype(np.float32)
    n = cv2.GaussianBlur(k, (0, 0), 12) + 1e-3
    out = fl.copy()
    for c in (0, 1): out[..., c] = np.where(k > 0, fl[..., c], cv2.GaussianBlur(fl[..., c] * k, (0, 0), 12) / n)
    return out

def correcao(I, Wp, val, hole, lim=45):
    """campo suave (I - warped) medido no anel em volta do buraco: tira costura e acompanha mudança de exposição"""
    ring = (cv2.dilate(hole.astype(np.uint8), elipse(9)) > 0) & (cv2.dilate(hole.astype(np.uint8), elipse(3)) == 0) & val
    if ring.sum() < 20: return None
    k = ring.astype(np.float32); d = (I.astype(np.float32) - Wp.astype(np.float32)) * k[..., None]
    h, w = hole.shape; sz = (w // 4, max(1, h // 4))
    dd = cv2.resize(d, sz, interpolation=cv2.INTER_AREA); kk = cv2.resize(k, sz, interpolation=cv2.INTER_AREA)
    dd = cv2.GaussianBlur(dd, (0, 0), 6); kk = cv2.GaussianBlur(kk, (0, 0), 6) + 1e-3
    return np.clip(cv2.resize(dd / kk[..., None], (w, h), interpolation=cv2.INTER_LINEAR), -lim, lim)

class Warp:
    def __init__(self, h, w):
        self.gx, self.gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32)); self.w, self.h = w, h
    def mapa(self, fl):
        f = cv2.resize(fl.astype(np.float32), (self.w, self.h), interpolation=cv2.INTER_LINEAR) * 2
        return self.gx + f[..., 0], self.gy + f[..., 1]

stats = dict(buraco=0, real=0, resto=0); T_FLOW = T_PROP = T_TEL = 0.0

def temporal(B, M):
    """B: n,h,w,3 uint8; M: n,h,w bool. Devolve resultado n,h,w,3 uint8."""
    global T_FLOW, T_PROP, T_TEL
    n, h, w = B.shape[:3]; WP = Warp(h, w); st = time.time()
    # buraco estendido no espaço (halo de compressão/croma) e no tempo (±2 quadros: fantasma de P-frame e letra entrando animada)
    # para letra antiga nunca virar "pixel real" de origem. Cobre também a saída.
    M0 = M; M = np.stack([cv2.dilate(m.astype(np.uint8), elipse(MARGEM)) > 0 for m in M]); Mt = M.copy()
    for k in (1, 2): Mt[k:] |= M[:-k]; Mt[:-k] |= M[k:]
    M = Mt
    # pré-preenche em meia resolução para o texto não enganar o fluxo
    sz = (w // 2, h // 2); G = []; Mh = []
    for t in range(n):
        g = cv2.resize(cv2.cvtColor(B[t], cv2.COLOR_BGR2GRAY), sz, interpolation=cv2.INTER_AREA)
        m = cv2.resize(M[t].astype(np.uint8), sz, interpolation=cv2.INTER_NEAREST); m = cv2.dilate(m, elipse(1))
        G.append(cv2.inpaint(g, m, 3, cv2.INPAINT_TELEA) if m.any() else g); Mh.append(m > 0)
    fw = [None] * n; bw = [None] * n
    for t in range(n):
        if t > 0: fw[t] = completar_fluxo(DIS.calc(G[t], G[t - 1], None), Mh[t]).astype(np.float16)
        if t < n - 1: bw[t] = completar_fluxo(DIS.calc(G[t], G[t + 1], None), Mh[t]).astype(np.float16)
    T_FLOW += time.time() - st; st = time.time()
    del G, Mh
    # passada para frente (F guarda cor; idade 0 = pixel real)
    F = np.empty_like(B); IF = np.zeros((n, h, w), np.uint8); VF = np.zeros((n, h, w), bool)
    def passo(prevc, previ, prevv, I, hole, fl):
        mx, my = WP.mapa(fl)
        cw = cv2.remap(prevc, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        vw = cv2.remap(prevv.astype(np.uint8) * 255, mx, my, cv2.INTER_LINEAR, borderValue=0) > 250
        iw = cv2.remap(previ, mx, my, cv2.INTER_NEAREST, borderValue=255)
        vis = ~hole
        c = I.copy(); ida = np.zeros(hole.shape, np.uint8); val = vis.copy()
        ok = hole & vw & (iw < MAXIDADE)
        if ok.any():
            # só ganho global por passo (acompanha fade). Correção local por passo acumula e escurece o fill: não usar.
            q = vis[::3, ::3] & vw[::3, ::3]; g = 1.0
            if q.sum() > 50:
                g = float(np.clip(np.median(I[::3, ::3][q].astype(np.float32).mean(1)) / max(np.median(cw[::3, ::3][q].astype(np.float32).mean(1)), 1.0), 0.6, 1.6))
            cc = cw.astype(np.float32) * g
            # erro local do fluxo: no anel em volta do buraco o pixel carregado tem de bater com o real. Onde não bate, não carrega.
            ring = ((cv2.dilate(hole.astype(np.uint8), elipse(8)) > 0) & (cv2.dilate(hole.astype(np.uint8), elipse(2)) == 0) & vw).astype(np.float32)
            dif_ = np.abs(I.astype(np.float32) - cc).mean(2) * ring
            sz4 = (hole.shape[1] // 4, max(1, hole.shape[0] // 4))
            e4 = cv2.GaussianBlur(cv2.resize(dif_, sz4, interpolation=cv2.INTER_AREA), (0, 0), 3); k4 = cv2.GaussianBlur(cv2.resize(ring, sz4, interpolation=cv2.INTER_AREA), (0, 0), 3) + 1e-3
            err = cv2.resize(e4 / k4, (hole.shape[1], hole.shape[0]), interpolation=cv2.INTER_LINEAR)
            ok &= err < ERRO
            c[ok] = np.clip(cc[ok], 0, 255).astype(np.uint8); ida[ok] = iw[ok] + 1; val |= ok
        return c, ida, val
    F[0] = B[0]; VF[0] = ~M[0]
    for t in range(1, n):
        F[t], IF[t], VF[t] = passo(F[t - 1], IF[t - 1], VF[t - 1], B[t], M[t], fw[t])
    # passada para trás, com fusão pela idade
    Rs = np.empty_like(B); prevc = B[n - 1]; previ = np.zeros((h, w), np.uint8); prevv = ~M[n - 1]
    for t in range(n - 1, -1, -1):
        if t < n - 1: prevc, previ, prevv = passo(prevc, previ, prevv, B[t], M[t], bw[t])
        hole = M[t]; r = B[t].copy()
        if hole.any():
            a, b = VF[t] & hole, prevv & hole; ambos = a & b
            r[a & ~b] = F[t][a & ~b]; r[b & ~a] = prevc[b & ~a]
            if ambos.any():
                ia = IF[t][ambos].astype(np.float32)[:, None] + 1; ib = previ[ambos].astype(np.float32)[:, None] + 1
                r[ambos] = ((F[t][ambos] * ib + prevc[ambos] * ia) / (ia + ib)).astype(np.uint8)
        Rs[t] = r
        VF[t] = (VF[t] | prevv) & hole  # agora: buraco com pixel real
    T_PROP += time.time() - st; st = time.time()
    del F, IF
    # o que o fluxo não alcançou mas esteve à vista em ALGUM quadro da tomada: mediana das observações reais naquele ponto
    # (ganho por quadro compensado, para fade não contaminar). Fixo no tempo: não treme.
    falta = cv2.dilate(np.any(M & ~VF, axis=0).astype(np.uint8), elipse(14)) > 0; ysx = np.where(falta)
    if len(ysx[0]) and not SEM_EST:
        passo_s = max(1, n // 150); idx = list(range(0, n, passo_s))
        cinza = np.array([np.median(B[t][::4, ::4][~M[t][::4, ::4]]) if (~M[t][::4, ::4]).any() else np.nan for t in range(n)], np.float32)
        ref = np.nanmedian(cinza); g = np.where(np.isfinite(cinza), cinza / max(ref, 1), 1.0)
        obs = np.stack([B[t][ysx] / max(g[t], .05) for t in idx]).astype(np.float32); vis = np.stack([~M[t][ysx] for t in idx])
        obs[~vis] = np.nan
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore"); med = np.nanmedian(obs, axis=0)
        tem = np.isfinite(med[:, 0]); PL = np.zeros((h, w, 3), np.float32); PV = np.zeros((h, w), bool)
        PL[ysx[0][tem], ysx[1][tem]] = med[tem]; PV[ysx[0][tem], ysx[1][tem]] = True
        del obs, vis
        for t in range(n):
            q = M[t] & ~VF[t] & PV
            if q.any():
                cand = np.clip(PL * g[t], 0, 255)
                d = correcao(Rs[t], cand, PV, q)
                cc = cand + (d if d is not None else 0); Rs[t][q] = np.clip(cc[q], 0, 255).astype(np.uint8)
                stats["estatica"] = stats.get("estatica", 0) + int(q.sum()); VF[t] |= q
    # sanidade: pixel carregado não pode ser muito mais claro ou escuro que tudo o que está à vista em volta do buraco
    # (mancha de pele sobre cabelo escuro, preto sobre suéter). Fora da faixa = volta pro TELEA.
    for t in range(n):
        if not M[t].any(): continue
        lumi = cv2.cvtColor(B[t], cv2.COLOR_BGR2GRAY); fill = cv2.cvtColor(Rs[t], cv2.COLOR_BGR2GRAY); sz4 = (w // 4, max(1, h // 4))
        vh = cv2.resize((~M[t]).astype(np.uint8), sz4, interpolation=cv2.INTER_NEAREST) > 0; lh = cv2.resize(lumi, sz4, interpolation=cv2.INTER_AREA)
        K = np.ones((15, 25), np.uint8)
        hi = cv2.dilate(np.where(vh, lh, 0).astype(np.uint8), K); lo = cv2.erode(np.where(vh, lh, 255).astype(np.uint8), K)
        hi = cv2.resize(hi, (w, h), interpolation=cv2.INTER_NEAREST).astype(np.int16); lo = cv2.resize(lo, (w, h), interpolation=cv2.INTER_NEAREST).astype(np.int16)
        ruim = M[t] & VF[t] & ((fill > hi + 25) | (fill < lo - 25))
        if ruim.any():
            ruim = cv2.dilate(ruim.astype(np.uint8), elipse(2)).astype(bool) & M[t]; VF[t] &= ~ruim
    # o que nenhuma passada alcançou: TELEA, estabilizado pelo quadro anterior para não tremer
    for t in range(n):
        hole = M[t]; rem = hole & ~VF[t]; stats["buraco"] += int(hole.sum()); stats["real"] += int(VF[t].sum()); stats["resto"] += int(rem.sum())
        if rem.any():
            ys = np.where(rem.any(1))[0]; a, b = max(0, ys.min() - 12), min(h, ys.max() + 13)
            tel = Rs[t].copy(); tel[a:b] = cv2.inpaint(np.ascontiguousarray(Rs[t][a:b]), rem[a:b].astype(np.uint8), 5, cv2.INPAINT_TELEA)
            if t > 0:
                mx, my = WP.mapa(fw[t]); prev = cv2.remap(Rs[t - 1], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                mix = (0.7 * prev.astype(np.float32) + 0.3 * tel.astype(np.float32)).astype(np.uint8); tel[rem] = mix[rem]
            Rs[t][rem] = tel[rem]
    for t in range(n):
        if M[t].any(): Rs[t] = costura(B[t], Rs[t], M[t])
    T_TEL += time.time() - st
    return Rs

def membrana(I, hole):
    """preenchimento suave do buraco a partir da borda (push-pull em pirâmide): só a baixa frequência, sem facetas"""
    h, w = hole.shape; c = I.astype(np.float32) * (~hole)[..., None]; k = (~hole).astype(np.float32); pil = []
    while min(c.shape[:2]) > 8:
        pil.append((c, k)); c = cv2.pyrDown(c); k = cv2.pyrDown(k)
    f = c / np.maximum(k, 1e-3)[..., None]
    for c_, k_ in reversed(pil):
        f = cv2.pyrUp(f, dstsize=(c_.shape[1], c_.shape[0])); a = np.minimum(k_ * 2.0, 1)[..., None]
        f = np.where(k_[..., None] > 1e-3, c_ / np.maximum(k_, 1e-3)[..., None], f) * a + f * (1 - a)
    return f

def soldar(I, r, hole):
    """cor de baixa frequência vem da borda do buraco; textura (alta frequência) vem do pixel real carregado. Dissolve as manchas."""
    ys = np.where(hole.any(1))[0]
    if not len(ys): return r
    a, b = max(0, ys.min() - 30), min(hole.shape[0], ys.max() + 31)
    h_, I_, r_ = hole[a:b], I[a:b], r[a:b].astype(np.float32)
    mem = membrana(I_, h_); alta = r_ - cv2.GaussianBlur(r_, (0, 0), SIG)
    # nas bordas do buraco a blur de r inclui fora; aceitável, r == I fora
    o = np.clip(mem + alta, 0, 255).astype(np.uint8); saida = r.copy(); saida[a:b][h_] = o[h_]; return saida

def costura(I, r, hole):
    """tira a costura na beirada do buraco: diferença entre o de fora e o de dentro, medida na beirada e difundida para dentro"""
    ys = np.where(hole.any(1))[0]
    if not len(ys): return r
    a, b = max(0, ys.min() - 12), min(hole.shape[0], ys.max() + 13); h_ = hole[a:b].astype(np.uint8)
    fora = ((cv2.dilate(h_, elipse(3)) > 0) & (h_ == 0)).astype(np.float32); den = ((h_ > 0) & (cv2.erode(h_, elipse(3)) == 0)).astype(np.float32)
    I_, r_ = I[a:b].astype(np.float32), r[a:b].astype(np.float32)
    nc = lambda x, k, s: cv2.GaussianBlur(x * k[..., None], (0, 0), s) / (cv2.GaussianBlur(k, (0, 0), s)[..., None] + 1e-3)
    dif = nc(I_, fora, 4) - nc(r_, den, 4); w = cv2.GaussianBlur(den, (0, 0), 6)
    d = cv2.GaussianBlur(dif * den[..., None], (0, 0), 6) / (w[..., None] + 1e-3)
    amort = np.minimum(w * 6, 1)[..., None]   # some ao entrar no buraco
    o = r.copy(); saida = np.clip(r_ + np.clip(d, -30, 30) * amort, 0, 255).astype(np.uint8); o[a:b][h_ > 0] = saida[h_ > 0]; return o

def ssim_buraco(a, b, m):
    a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32); b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32)
    G = lambda x: cv2.GaussianBlur(x, (0, 0), 1.5); ma, mb = G(a), G(b); va, vb, c = G(a * a) - ma * ma, G(b * b) - mb * mb, G(a * b) - ma * mb
    s = ((2 * ma * mb + 6.5) * (2 * c + 58.5)) / ((ma * ma + mb * mb + 6.5) * (va + vb + 58.5)); return float(s[m].mean())

def telea(band, m):
    ys = np.where(m.any(1))[0]
    if not len(ys): return band
    r0, r1 = max(0, ys.min() - 12), min(band.shape[0], ys.max() + 13); o = band.copy()
    o[r0:r1] = cv2.inpaint(np.ascontiguousarray(band[r0:r1]), m[r0:r1].astype(np.uint8), 5, cv2.INPAINT_TELEA); return o

# --- 2. render
res = {}; t1 = time.time(); tinp = 0
gen = frames(path, W, H)
we1 = we2 = None
if not SHIFT: we1, we2 = wr(f"placa-{v}-E1.mp4"), wr(f"placa-{v}-E2{TAG}.mp4")
psnr = {"E1": [], "E2": []}; lap = {"E1": [], "E2": []}; T_E1 = 0; T_E2 = 0
for a, b in tom:
    fs = [next(gen).copy() for _ in range(a, b)]
    ms = [un(masks, t) for t in range(a, b)]
    # recorte: só as linhas que têm máscara nesta tomada, com folga pro fluxo
    uni = np.any(ms, axis=0); ys = np.where(uni.any(1))[0]
    if not len(ys):
        for f in fs:
            if not SHIFT: we1.stdin.write(f.tobytes()); we2.stdin.write(f.tobytes())
        continue
    ra, rb = max(0, ys.min() - 40), min(L.Hb, ys.max() + 41)
    BB = np.stack([f[y0 + ra:y0 + rb] for f in fs]); MM = np.stack([m[ra:rb] for m in ms])
    st = time.time(); E1 = np.stack([telea(BB[i], MM[i]) for i in range(len(fs))]); T_E1 += time.time() - st
    st = time.time(); E2 = temporal(BB, MM) if len(fs) >= 3 else E1.copy(); T_E2 += time.time() - st
    for i, f in enumerate(fs):
        for nome, Ex, w_ in (("E1", E1, we1), ("E2", E2, we2)):
            if SHIFT:
                if MM[i].sum() > 200:
                    e = BB[i][MM[i]].astype(np.float32) - Ex[i][MM[i]].astype(np.float32); psnr[nome].append(float((e * e).mean())); lap[nome].append(ssim_buraco(BB[i], Ex[i], MM[i]))
                continue
            g = f.copy(); g[y0 + ra:y0 + rb] = Ex[i]; w_.stdin.write(g.tobytes())
    del BB, MM, E1, E2, fs, ms
if not SHIFT:
    for w_ in (we1, we2): w_.stdin.close(); w_.wait()
    np.savez_compressed(f"m{v}.npz", masks=np.array(masks, dtype=object), letras=np.array(letras, dtype=object))
out = dict(id=v, shift=SHIFT, quadros=Nf, tomadas=len(tom), mascara_s=round(T_MASK, 1), E1_inpaint_s=round(T_E1, 1), E2_s=round(T_E2, 1),
           E2_fluxo_s=round(T_FLOW, 1), E2_prop_s=round(T_PROP, 1), E2_resto_s=round(T_TEL, 1), total_s=round(time.time() - t0, 1), rss_gb=round(rss(), 2), cpu_python_s=round(time.process_time(), 1),
           buraco_estatica_pct=round(100 * stats.get("estatica", 0) / max(stats["buraco"], 1), 1), buraco_real_pct=round(100 * stats["real"] / max(stats["buraco"], 1), 1), buraco_telea_pct=round(100 * stats["resto"] / max(stats["buraco"], 1), 1))
if SHIFT:
    for k, x in psnr.items():
        x = np.array(x); p = 10 * np.log10(255 ** 2 / np.maximum(x, 1e-3)); out[f"psnr_{k}_med"] = round(float(np.median(p)), 2); out[f"psnr_{k}_p5"] = round(float(np.percentile(p, 5)), 2); out[f"ssim_{k}_med"] = round(float(np.median(lap[k])), 3)
print(json.dumps(out)); json.dump(out, open(f"placa-{v}{TAG}{'-shift' + str(SHIFT) if SHIFT else ''}.json", "w"))
