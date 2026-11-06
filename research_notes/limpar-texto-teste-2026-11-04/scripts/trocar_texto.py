#!/usr/bin/env python3
"""
trocar_texto.py — teste 04/11: trocar texto FIXO queimado (dentro de caixa) por texto novo no mesmo lugar e estilo.
Adaptado de scripts/limpar-texto-video.py (cópia, o original não é tocado):
  - resolução nativa (o original escala pra 1080x1920 e distorce vídeos 3:4)
  - só no trecho em que a caixa está parada (0..N quadros); depois disso o vídeo segue intacto
  - duas remoções: A = máscara claro+parado + cv2.inpaint TELEA (método do script)
                   B = caixa lisa: preenche a caixa toda com a cor amostrada dela (convolução normalizada,
                       sem os pixels de letra), por quadro — mantém gradiente e a leve transparência
  - texto novo: fonte/tamanho/entrelinha/posição ajustados contra o texto ORIGINAL (busca em grade)
Uso: python3 trocar_texto.py <config.json>
"""
import json, sys, time, subprocess, numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

C = json.load(open(sys.argv[1]))
OUT = C["saida"]; W, H, N = C["w"], C["h"], C["quadros"]
y0, y1, x0, x1 = C["caixa"]
T = {}

def frames(path, n=None):
    cmd = ["ffmpeg", "-v", "error", "-i", path]
    if n: cmd += ["-frames:v", str(n)]
    p = subprocess.Popen(cmd + ["-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    while True:
        b = p.stdout.read(W * H * 3)
        if len(b) < W * H * 3: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)

def writer(path):
    return subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                             "-r", "30", "-i", "-", "-c:v", "libx264", "-crf", "14", "-preset", "medium",
                             "-pix_fmt", "yuv420p", path], stdin=subprocess.PIPE)

t0 = time.time()
# 1. carrega o trecho (caixa parada) — só a faixa da caixa fica em memória
fr = [f.copy() for f in frames(C["video"], N)]
crop = np.array([f[y0:y1, x0:x1] for f in fr]).astype(np.int16)
mn, mx = crop.min(0), crop.max(0); med = np.median(crop, 0).astype(np.uint8)
T["leitura"] = time.time() - t0

# 2a. máscara do script: claro E parado, dentro da caixa, dilatada
parado = (mx - mn).max(2) < C.get("var", 70)
claro = mn.mean(2) > C.get("limiar", 150)
mbox = cv2.dilate((parado & claro).astype(np.uint8) * 255, np.ones((C.get("dilata", 5),) * 2, np.uint8))
mask = np.zeros((H, W), np.uint8); mask[y0:y1, x0:x1] = mbox
cv2.imwrite(f"{OUT}/mascara.png", mask)

# 2b. pesos pra caixa lisa: pixels da caixa que NÃO são letra (máscara bem dilatada)
fundo = (cv2.dilate(mbox, np.ones((9, 9), np.uint8)) == 0).astype(np.float32)
sig = C.get("sigma", 18)
den = cv2.GaussianBlur(fundo, (0, 0), sig, borderType=cv2.BORDER_REFLECT)

def lisa(f):
    b = f[y0:y1, x0:x1].astype(np.float32)
    num = cv2.GaussianBlur(b * fundo[..., None], (0, 0), sig, borderType=cv2.BORDER_REFLECT)
    g = f.copy(); g[y0:y1, x0:x1] = np.clip(num / np.maximum(den, 1e-4)[..., None], 0, 255).astype(np.uint8)
    return g

# 3. layout do texto: ajusta tamanho/entrelinha/base/centro contra o texto original
fnt = C["fonte"]
def font(sz): return ImageFont.truetype(fnt["arquivo"], sz, index=fnt.get("index", 0))

def render(linhas, sz, pitch, base0, cx, subl=None, ul=None):
    """RGBA do tamanho da tela; linhas centradas em cx; subl = lista de (linha, i0, i1) trechos sublinhados"""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im); f = font(sz)
    for i, ln in enumerate(linhas):
        d.text((cx, base0 + i * pitch), ln, font=f, fill=tuple(C["cor"]) + (255,), anchor="ms")
    for it in (subl or []):
        li, a, b = it[:3]; ex = it[3] if len(it) > 3 else 0
        ln = linhas[li]; wl = d.textlength(ln, font=f); xs = cx - wl / 2
        xa = xs + d.textlength(ln[:a], font=f); xb = xs + d.textlength(ln[:b], font=f)
        yb = base0 + li * pitch + ul["dy"]
        d.rectangle([xa + ul.get("pad0", 0), yb, xb + ex, yb + ul["esp"] - 1], fill=tuple(C["cor"]) + (255,))
    if C.get("blur", 0): im = im.filter(ImageFilter.GaussianBlur(C["blur"]))
    return im

alvo = (cv2.cvtColor(med, cv2.COLOR_BGR2GRAY).astype(np.float32) > 150).astype(np.float32)
def score(p):
    a = np.array(render(C["orig"], *p, C.get("orig_sub"), C.get("sub")))[y0:y1, x0:x1, 3].astype(np.float32) / 255
    return float((a * alvo).sum() / (np.sqrt((a * a).sum() * (alvo * alvo).sum()) + 1e-6))
p = list(C["layout"])  # [tamanho, entrelinha, base_linha1, centro_x]
best = score(p)
for _ in range(3):
    for k, rng in enumerate([range(-3, 4), range(-3, 4), range(-4, 5), range(-6, 7)]):
        for dv in rng:
            q = p.copy(); q[k] = p[k] + dv; s = score(q)
            if s > best: best, p = s, q
T["ajuste_layout"] = time.time() - t0 - T["leitura"]
print("layout ajustado", p, "similaridade com o texto original", round(best, 3))
json.dump({"layout": p, "sim": best}, open(f"{OUT}/layout.json", "w"))
txt_orig = render(C["orig"], *p, C.get("orig_sub"), C.get("sub"))
txt_novo = render(C["novo"], *p, C.get("novo_sub"), C.get("sub"))
txt_orig.save(f"{OUT}/texto-original-recriado.png"); txt_novo.save(f"{OUT}/texto-novo.png")
a_novo = np.array(txt_novo).astype(np.float32); al = a_novo[..., 3:4] / 255; rgb = a_novo[..., 2::-1]

def compor(g):
    return np.clip(g * (1 - al) + rgb * al, 0, 255).astype(np.uint8)

# 4. processa o trecho: limpo A/B e final A/B
ws = {k: writer(f"{OUT}/trecho-{k}.mp4") for k in ("limpoA", "limpoB", "finalA", "finalB")}
tA = tB = 0
for f in fr:
    s = time.time(); a = cv2.inpaint(np.ascontiguousarray(f), mask, C.get("raio", 6), cv2.INPAINT_TELEA); tA += time.time() - s
    s = time.time(); b = lisa(f); tB += time.time() - s
    ws["limpoA"].stdin.write(a.tobytes()); ws["limpoB"].stdin.write(b.tobytes())
    ws["finalA"].stdin.write(compor(a).tobytes()); ws["finalB"].stdin.write(compor(b).tobytes())
for w in ws.values(): w.stdin.close(); w.wait()
T["remocao_A_inpaint"] = tA; T["remocao_B_lisa"] = tB
T["trecho_total"] = time.time() - t0
print("quadros", len(fr), "pixels na máscara", int((mask > 0).sum()), "tempos", {k: round(v, 1) for k, v in T.items()})
json.dump(T, open(f"{OUT}/tempos.json", "w"), indent=1)
