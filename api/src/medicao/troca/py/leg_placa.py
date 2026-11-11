"""leg_placa.py (troca-texto §15.6, dono: video; cópia do placa_s1.py da S1, cor pela §15.6.6) — E2 (e E1) do S2 sem mudar o método, em forma de função, com três mudanças de execução:
- Só a faixa fica em memória: os quadros inteiros são relidos por um 2º decodificador na hora de gravar (duas passadas por stream, §3.2 RAM).
- ini/fim/ctx: gera o pedaço [ini, fim) usando contexto até ctx quadros de cada lado, sem atravessar corte de tomada.
- roi=True: TELEA por grupo de letras em vez da imagem inteira.
temporal(), correcao, Warp, costura e demais são cópia do placa.py do S2."""
import time, subprocess, numpy as np, cv2
from leg_pegada import elipse
from leg_det import frames, info_de
from comum import codificador, matriz_de

ERRO = 14.0; MARGEM = 3; FPS = 30; MAXIDADE = 120

def inp(img, m, r, roi):
    """cv2.inpaint TELEA; com roi, por componente (letras próximas juntas), recorte com folga de raio + 2"""
    if not roi: return cv2.inpaint(img, m, r, cv2.INPAINT_TELEA)
    f = r + 2; n, _, st, _ = cv2.connectedComponentsWithStats(cv2.dilate(m, np.ones((2 * f + 1, 2 * f + 1), np.uint8)), connectivity=8)
    o = img.copy(); h, w = m.shape[:2]
    for k in range(1, n):
        x, y, bw, bh = st[k, :4]; a, b, c, d = max(0, y - 1), min(h, y + bh + 1), max(0, x - 1), min(w, x + bw + 1)
        if m[a:b, c:d].any(): o[a:b, c:d] = cv2.inpaint(np.ascontiguousarray(img[a:b, c:d]), m[a:b, c:d], r, cv2.INPAINT_TELEA)
    return o

def wr(p, path, W, H, crf="14"):
    """x264 com a cor da origem gravada (matriz, faixa e tags), GOP fechado: o `juntar` emenda com -c copy."""
    i = info_de(path)
    return codificador(p, W, H, i["fps"], mat=matriz_de(i), faixa=i["faixa"], crf=crf, preset="veryfast")

def completar_fluxo(fl, m):
    k = (cv2.dilate(m.astype(np.uint8), elipse(2)) == 0).astype(np.float32)
    n = cv2.GaussianBlur(k, (0, 0), 12) + 1e-3
    out = fl.copy()
    for c in (0, 1): out[..., c] = np.where(k > 0, fl[..., c], cv2.GaussianBlur(fl[..., c] * k, (0, 0), 12) / n)
    return out

class Warp:
    def __init__(self, h, w):
        self.gx, self.gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32)); self.w, self.h = w, h
    def mapa(self, fl):
        f = cv2.resize(fl.astype(np.float32), (self.w, self.h), interpolation=cv2.INTER_LINEAR) * 2
        return self.gx + f[..., 0], self.gy + f[..., 1]

def costura(I, r, hole):
    ys = np.where(hole.any(1))[0]
    if not len(ys): return r
    a, b = max(0, ys.min() - 12), min(hole.shape[0], ys.max() + 13); h_ = hole[a:b].astype(np.uint8)
    fora = ((cv2.dilate(h_, elipse(3)) > 0) & (h_ == 0)).astype(np.float32); den = ((h_ > 0) & (cv2.erode(h_, elipse(3)) == 0)).astype(np.float32)
    I_, r_ = I[a:b].astype(np.float32), r[a:b].astype(np.float32)
    nc = lambda x, k, s: cv2.GaussianBlur(x * k[..., None], (0, 0), s) / (cv2.GaussianBlur(k, (0, 0), s)[..., None] + 1e-3)
    dif = nc(I_, fora, 4) - nc(r_, den, 4); w = cv2.GaussianBlur(den, (0, 0), 6)
    d = cv2.GaussianBlur(dif * den[..., None], (0, 0), 6) / (w[..., None] + 1e-3)
    amort = np.minimum(w * 6, 1)[..., None]
    o = r.copy(); saida = np.clip(r_ + np.clip(d, -30, 30) * amort, 0, 255).astype(np.uint8); o[a:b][h_ > 0] = saida[h_ > 0]; return o

class Temporal:
    def __init__(self, roi=False):
        self.roi = roi; self.DIS = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.stats = dict(buraco=0, real=0, resto=0); self.T = dict(fluxo=0.0, prop=0.0, tel=0.0, prefill=0.0)

    def __call__(self, B, M):
        DIS, stats, roi = self.DIS, self.stats, self.roi
        n, h, w = B.shape[:3]; WP = Warp(h, w); st = time.time()
        M = np.stack([cv2.dilate(m.astype(np.uint8), elipse(MARGEM)) > 0 for m in M]); Mt = M.copy()
        for k in (1, 2): Mt[k:] |= M[:-k]; Mt[:-k] |= M[k:]
        M = Mt
        sz = (w // 2, h // 2); G = []; Mh = []
        for t in range(n):
            g = cv2.resize(cv2.cvtColor(B[t], cv2.COLOR_BGR2GRAY), sz, interpolation=cv2.INTER_AREA)
            m = cv2.resize(M[t].astype(np.uint8), sz, interpolation=cv2.INTER_NEAREST); m = cv2.dilate(m, elipse(1))
            G.append(inp(g, m, 3, roi) if m.any() else g); Mh.append(m > 0)
        self.T["prefill"] += time.time() - st; st = time.time()
        fw = [None] * n; bw = [None] * n
        for t in range(n):
            if t > 0: fw[t] = completar_fluxo(DIS.calc(G[t], G[t - 1], None), Mh[t]).astype(np.float16)
            if t < n - 1: bw[t] = completar_fluxo(DIS.calc(G[t], G[t + 1], None), Mh[t]).astype(np.float16)
        self.T["fluxo"] += time.time() - st; st = time.time()
        del G, Mh
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
                q = vis[::3, ::3] & vw[::3, ::3]; g = 1.0
                if q.sum() > 50:
                    g = float(np.clip(np.median(I[::3, ::3][q].astype(np.float32).mean(1)) / max(np.median(cw[::3, ::3][q].astype(np.float32).mean(1)), 1.0), 0.6, 1.6))
                cc = cw.astype(np.float32) * g
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
            VF[t] = (VF[t] | prevv) & hole
        self.T["prop"] += time.time() - st; st = time.time()
        del F, IF
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
        for t in range(n):
            hole = M[t]; rem = hole & ~VF[t]; stats["buraco"] += int(hole.sum()); stats["real"] += int(VF[t].sum()); stats["resto"] += int(rem.sum())
            if rem.any():
                ys = np.where(rem.any(1))[0]; a, b = max(0, ys.min() - 12), min(h, ys.max() + 13)
                tel = Rs[t].copy(); tel[a:b] = inp(np.ascontiguousarray(Rs[t][a:b]), rem[a:b].astype(np.uint8), 5, roi)
                if t > 0:
                    mx, my = WP.mapa(fw[t]); prev = cv2.remap(Rs[t - 1], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
                    mix = (0.7 * prev.astype(np.float32) + 0.3 * tel.astype(np.float32)).astype(np.uint8); tel[rem] = mix[rem]
                Rs[t][rem] = tel[rem]
        for t in range(n):
            if M[t].any(): Rs[t] = costura(B[t], Rs[t], M[t])
        self.T["tel"] += time.time() - st
        return Rs

def janelas(tomadas, ini, fim, ctx):
    """por tomada que toca [ini, fim): (a_lida, b_lida, a_grava, b_grava), com contexto sem atravessar corte"""
    out = []
    for a, b in zip(tomadas[:-1], tomadas[1:]):
        if b <= ini or a >= fim: continue
        out.append((max(a, ini - ctx), min(b, fim + ctx), max(a, ini), min(b, fim)))
    return out

def gerar(path, L, saida, ini=0, fim=None, ctx=0, roi=False, m_saida=None, encoder=True):
    """Gera a placa E2 do pedaço. Devolve tempos. Lê a faixa em memória, processa por tomada, regrava quadros inteiros por um 2º decodificador."""
    W, H, y0, y1, N = L.W, L.H, L.y0, L.y1, L.N; fim = N if fim is None else fim; Hb = L.Hb
    T = dict(ler_mascara=0.0, temporal=0.0, gravar=0.0); TP = Temporal(roi); masks = {}; letras = {}
    we = wr(saida, path, W, H) if encoder else None; maxpx = 0; quadros = 0
    for a, b, ga, gb in janelas(L.tomadas, ini, fim, ctx):
        st = time.time(); band = []; ms = []
        for t, f in zip(range(a, b), frames(path, W, H, ini=a, qtd=b - a)):
            bd = f[y0:y1].copy(); band.append(bd); Fp, Tl = L.pegada(bd, t); ms.append(Fp.astype(bool))
            if m_saida: masks[t] = np.packbits(Fp.astype(bool)); letras[t] = np.packbits(Tl)
        if len(band) != b - a: raise RuntimeError(f"tomada {a}-{b}: leu {len(band)} quadros")
        T["ler_mascara"] += time.time() - st; st = time.time()
        uni = np.any(ms, axis=0); ys = np.where(uni.any(1))[0]; Ex = None; ra = rb = 0
        if len(ys):
            ra, rb = max(0, ys.min() - 40), min(Hb, ys.max() + 41)
            BB = np.stack([f[ra:rb] for f in band]); MM = np.stack([m[ra:rb] for m in ms]); del band, ms
            maxpx = max(maxpx, BB.shape[0] * BB.shape[1] * BB.shape[2])
            if BB.shape[0] >= 3: Ex = TP(BB, MM)
            else: Ex = np.stack([cv2.inpaint(np.ascontiguousarray(BB[i]), MM[i].astype(np.uint8), 5, cv2.INPAINT_TELEA) for i in range(len(BB))])
            del BB, MM
        else: del band, ms
        T["temporal"] += time.time() - st; st = time.time()
        if we:
            for t, f in zip(range(ga, gb), frames(path, W, H, ini=ga, qtd=gb - ga)):
                if Ex is not None:
                    g = f.copy(); g[y0 + ra:y0 + rb] = Ex[t - a]; we.stdin.write(g.tobytes())
                else: we.stdin.write(f.tobytes())
                quadros += 1
        del Ex
        T["gravar"] += time.time() - st
    if we: we.stdin.close(); we.wait()
    if m_saida:
        ord_ = sorted(masks); np.savez_compressed(m_saida, masks=np.array([masks[t] for t in ord_], dtype=object), letras=np.array([letras[t] for t in ord_], dtype=object))
    s = TP.stats
    return dict(quadros=quadros, ini=ini, fim=fim, ctx=ctx, roi=roi, maior_tomada_MB=round(maxpx / 1e6, 1),
                **{k + "_s": round(v, 2) for k, v in T.items()}, **{"t_" + k + "_s": round(v, 2) for k, v in TP.T.items()},
                buraco_real_pct=round(100 * s["real"] / max(s["buraco"], 1), 1), buraco_telea_pct=round(100 * s["resto"] / max(s["buraco"], 1), 1))

def bench_telea(path, L, roi_tb=True):
    """E1 só o TELEA por quadro, sem encoder: r5, r3, r5+ROI, r3+ROI, no mesmo processo. PSNR contra r5 dentro do buraco."""
    W, H, y0, y1 = L.W, L.H, L.y0, L.y1; T = dict(r5=0.0, r3=0.0, r5_roi=0.0, r3_roi=0.0, mascara=0.0); ms = []; ne = {"r3": [], "r5_roi": [], "r3_roi": []}; n = 0
    for t, f in enumerate(frames(path, W, H)):
        st = time.time(); bd = f[y0:y1]; Fp, _ = L.pegada(bd, t); T["mascara"] += time.time() - st
        if not Fp.any(): continue
        ys = np.where(Fp.any(1))[0]; r0, r1 = max(0, ys.min() - 12), min(L.Hb, ys.max() + 13)   # recorte por linhas igual ao telea() do S2
        im = np.ascontiguousarray(bd[r0:r1]); m = Fp[r0:r1].astype(np.uint8); n += 1
        st = time.time(); a = cv2.inpaint(im, m, 5, cv2.INPAINT_TELEA); T["r5"] += time.time() - st
        st = time.time(); b = cv2.inpaint(im, m, 3, cv2.INPAINT_TELEA); T["r3"] += time.time() - st
        st = time.time(); c = inp(im, m, 5, True); T["r5_roi"] += time.time() - st
        st = time.time(); d = inp(im, m, 3, True); T["r3_roi"] += time.time() - st
        if t % 15 == 0:
            q = m > 0
            for k, x in (("r3", b), ("r5_roi", c), ("r3_roi", d)):
                e = (a[q].astype(np.float32) - x[q].astype(np.float32)); ne[k].append(float((e * e).mean()))
    return dict(quadros_com_mascara=n, **{k + "_s": round(v, 2) for k, v in T.items()}, **{"psnr_vs_r5_" + k: round(float(10 * np.log10(255 ** 2 / max(np.mean(v), 1e-3))), 2) for k, v in ne.items() if v})
