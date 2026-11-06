#!/usr/bin/env python3
"""HEADLINE-1 refeita fora do produto, no fluxo da /esteira-spy (molde tiktok-followcatch/montar.py: texto solto sobre a cena).
Mede intervalo e máscara no vídeo; cv2.inpaint TELEA raio 5 só nos quadros do intervalo; redesenha na mesma fonte, corpo,
linha de base, sombra e emoji; fora do trecho nada muda; áudio copiado. Custo US$ 0.
Uso (de research_notes/headline-refeita-2026-11-05/): python3 scripts/montar.py medir|calibrar|previa|final [--dilata N] [--limpo]"""
import subprocess, sys, time
import cv2, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ORIG = "origem/original.mp4"; SAIDA = "headline-refeita.mp4"
ROI = (30, 525, 450, 607); BRILHO = 205; SEM = 60
EMOJI_RET = (354, 568, 392, 597)            # x0,y0,x1,y1 do 👀 antigo (medido no recorte ampliado)
HN = "/System/Library/Fonts/HelveticaNeue.ttc"; HN_MEDIUM = 10
CORPO = 26.75; BASE1 = 557.0; ENTRELINHA = 33.25; CX = 233.0     # medidos em fontes.py e ajuste_fino.py
EMOJI_FONTE = "/System/Library/Fonts/Apple Color Emoji.ttc"
L_ANTIGAS = ("How to view your man’s", "recent following on IG")
L_NOVAS = ("Tired of scrolling his", "endless following list?")
SS = 4
SOMBRA = (1.3, 0, 1, .4)
args = sys.argv[1:]; MODO = args[0] if args else "medir"
DILATA = int(args[args.index("--dilata") + 1]) if "--dilata" in args else 7  # 17 px do molde em 1080 de largura = 7 px em 464

def frames(p=ORIG, w=464, h=832):
    """decodifica com ffmpeg (matriz bt709 explícita, arredondamento exato): o cv2 desloca a cor em 1 a 3 níveis no ida e volta"""
    d = subprocess.Popen(["ffmpeg", "-v", "error", "-i", p, "-vf", "scale=in_color_matrix=bt709:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24",
                          "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    n = w * h * 3
    try:
        while True:
            b = d.stdout.read(n)
            if len(b) < n: break
            yield np.frombuffer(b, np.uint8).reshape(h, w, 3).copy()
    finally:
        d.stdout.close(); d.kill(); d.wait()

def medir():
    x0, y0, x1, y1 = ROI
    rois = [cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY) for f in frames()]
    n = len(rois)
    molde = np.min(np.stack(rois[30:120]), 0) > BRILHO
    cob = lambda i: (rois[i][molde] > BRILHO).mean()
    ini = SEM
    while ini > 0 and cob(ini - 1) > .8: ini -= 1
    fim = SEM
    while fim < n - 1 and cob(fim + 1) > .8: fim += 1
    return n, ini, fim, np.min(np.stack(rois[ini:fim + 1]), 0) > BRILHO

def mascara(mask, shape):
    x0, y0, x1, y1 = ROI
    full = np.zeros(shape[:2], np.uint8); full[y0:y1, x0:x1] = mask.astype(np.uint8) * 255
    a, b, c, d = EMOJI_RET; full[b:d, a:c] = 255        # o emoji tem pupila escura: entra inteiro
    # adaptação: em 464 px, letra fina (rabo do "y" sobre a gola) às vezes fica abaixo do limiar em algum quadro; soma as letras antigas redesenhadas
    velho, *_ = camadas(shape[1], shape[0], L_ANTIGAS, sig=.6); full[velho > .08] = 255
    return cv2.dilate(full, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DILATA, DILATA)))

def emoji_rgba(alt):
    f = ImageFont.truetype(EMOJI_FONTE, 160)
    im = Image.new("RGBA", (200, 200), (0, 0, 0, 0)); ImageDraw.Draw(im).text((10, 10), "👀", font=f, embedded_color=True)
    im = im.crop(im.getbbox()); a = np.array(im, np.float32) / 255; a[..., :3] *= a[..., 3:]
    alvo = (round(im.width * alt / im.height), alt)
    return cv2.resize(a, alvo, interpolation=cv2.INTER_AREA)  # RGBA pré-multiplicado, 0..1

def camadas(w, h, linhas, emoji=None, sombra=None, sig=.4, cx=CX, dx2=0):
    """devolve alpha do texto, alpha da sombra e camada RGBA do emoji"""
    F = ImageFont.truetype(HN, CORPO * SS, index=HN_MEDIUM)
    im = Image.new("L", (w * SS, h * SS), 0); d = ImageDraw.Draw(im)
    l1, l2 = linhas
    w1 = F.getlength(l1) / SS; w2 = F.getlength(l2) / SS
    extra = (emoji["gap"] + emoji["w"]) if emoji else 0
    x1 = cx - w1 / 2; x2 = cx - (w2 + extra) / 2 + dx2
    d.text((x1 * SS, BASE1 * SS), l1, font=F, fill=255, anchor="ls")
    d.text((x2 * SS, (BASE1 + ENTRELINHA) * SS), l2, font=F, fill=255, anchor="ls")
    a = cv2.resize(np.array(im, np.float32) / 255, (w, h), interpolation=cv2.INTER_AREA)
    sg, sx, sy, op = sombra or SOMBRA
    sh = cv2.GaussianBlur(np.roll(np.roll(a, sy, 0), sx, 1), (0, 0), sg) * op
    e = None
    if emoji:
        rgba = emoji_rgba(emoji["h"])
        ex = round(x2 + w2 + emoji["gap"]); ey = emoji["y"]
        lay = np.zeros((h, w, 4), np.float32); arr = rgba
        lay[ey:ey + arr.shape[0], ex:ex + arr.shape[1]] = arr
        lay[..., :3] = lay[..., [2, 1, 0]]; e = cv2.GaussianBlur(lay, (0, 0), .45)
        sh = np.maximum(sh, cv2.GaussianBlur(np.roll(e[..., 3], sy, 0), (0, 0), sg) * op * .6)
    return cv2.GaussianBlur(a, (0, 0), sig), sh, e, (x1, x1 + w1, x2, x2 + w2)

def limpo(f, inp): return cv2.inpaint(f, inp, 5, cv2.INPAINT_TELEA)

def compor(pl, a, sh, e, branco=255):
    o = pl.astype(np.float32) * (1 - sh)[..., None]
    o = o * (1 - a)[..., None] + branco * a[..., None]
    if e is not None:
        al = e[..., 3:]; o = o * (1 - al) + e[..., :3] * 255  # e já pré-multiplicado
    return o.clip(0, 255).astype(np.uint8)

EMOJI = {"h": 21, "w": 27, "gap": 7, "y": 570}   # medidos no 👀 antigo: x 358-387, y 570-591

def medir_emoji():
    """bbox do 👀 antigo: pixel claro parado à direita da última letra + corpo escuro"""
    n, ini, fim, m = medir(); x0, y0, *_ = ROI
    s = m[569 - y0:597 - y0, 352 - x0:]; ys, xs = np.where(s)
    return 352 + xs.min(), 569 + ys.min(), 352 + xs.max(), 569 + ys.max()

def main():
    t0 = time.time()
    n, ini, fim, m = medir()
    h, w = next(frames()).shape[:2]
    inp = mascara(m, (h, w))
    print(f"quadros={n} headline={ini}..{fim} ({ini/30:.3f}s a {(fim+1)/30:.3f}s) px={int(m.sum())} mascara_px={int((inp>0).sum())} emoji_claro={medir_emoji()}")
    cv2.imwrite("quadros/mascara.png", inp)
    if MODO == "medir": return
    if MODO == "calibrar":
        fs = [f for i, f in enumerate(frames()) if i in (10, 50, 90, 130, 158)]
        pls = [limpo(f, inp) for f in fs]
        a0, *_ = camadas(w, h, L_ANTIGAS)
        reg = inp > 0
        best = []
        for sg in (.8, 1.0, 1.3, 1.6, 2.0, 2.5):
            for sy in (0, 1, 2):
                for op in (.2, .3, .4, .5, .6, .7):
                    for br in (255,):
                        a, sh, _, _ = camadas(w, h, L_ANTIGAS, None, (sg, 0, sy, op))
                        err = 0
                        for f, pl in zip(fs, pls):
                            r = compor(pl, a, sh, None, br).astype(np.float32)
                            k = (a < .05) & (cv2.dilate((a > .3).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0); a_, b_, c_, d_ = EMOJI_RET; k[b_:d_, a_:c_] = False
                            err += (r[k].astype(np.float32) - f[k].astype(np.float32)).mean() ** 2 + 0 * np.abs(r[k] - f[k]).mean()
                        best.append((err / len(fs), sg, sy, op, br))
        best.sort(); print("melhor sombra (erro, sigma, dy, opacidade, branco):"); [print(b) for b in best[:6]]
        return
    F_em = None
    sombra = SOMBRA
    al, sh, e, geo = camadas(w, h, L_NOVAS, EMOJI, sombra)
    print("linhas novas x:", [round(v, 1) for v in geo], "dilata", DILATA)
    if MODO == "previa":
        alvos = sorted({0, 1, 40, 80, 120, 150, 159, 160})
        lin = []
        for i, f in enumerate(frames()):
            if i in alvos:
                pl = limpo(f, inp); r = compor(pl, al, sh, e)
                lin.append(np.hstack([f[505:705], pl[505:705], r[505:705]]))
        cv2.imwrite("quadros/previa.png", cv2.resize(np.vstack(lin[:4]), None, fx=1, fy=1))
        cv2.imwrite("quadros/previa2.png", np.vstack(lin[4:]))
        return
    enc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", "30", "-i", "-",
        "-i", ORIG, "-map", "0:v", "-map", "1:a", "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv", "-c:a", "copy", "-movflags", "+faststart", SAIDA], stdin=subprocess.PIPE)
    for i, f in enumerate(frames()):
        enc.stdin.write((compor(limpo(f, inp), al, sh, e) if ini <= i <= fim else f).tobytes())
    enc.stdin.close()
    if enc.wait() != 0: sys.exit("ffmpeg falhou")
    print("ok", SAIDA, f"{time.time()-t0:.1f}s")

if __name__ == "__main__": main()
