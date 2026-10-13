"""Aceite (b) do F1 (editor-v1 §10): print do <Player> × renderStill, mesmo doc e mesmo frame.
Critério: diferença máxima <= 2 níveis RGB FORA das bordas de texto (borda = gradiente forte no still, dilatado 3 px).
Uso: python3 scripts/editor-f1/comparar.py <pasta-stills> <pasta-player>   (mesmos nomes: <doc>-<frame>.png)
Saída: uma linha por par + resumo; exit 1 se algum passar de 2."""
import sys, pathlib
import numpy as np
from PIL import Image

def borda(img):
    g = img.astype(np.int32).max(axis=2)
    gx = np.abs(np.diff(g, axis=1, prepend=g[:, :1])); gy = np.abs(np.diff(g, axis=0, prepend=g[:1, :]))
    m = (gx + gy) > 40
    for _ in range(3):  # dilata 3 px (cruz)
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    return m

a, b = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
falhou = 0
for s in sorted(a.glob("*.png")):
    p = b / s.name
    if not p.exists():
        print(f"{s.name}: FALTA o print do Player"); falhou += 1; continue
    x = np.asarray(Image.open(s).convert("RGB")); y = np.asarray(Image.open(p).convert("RGB"))
    if x.shape != y.shape:
        print(f"{s.name}: tamanho {y.shape[1]}x{y.shape[0]} != {x.shape[1]}x{x.shape[0]}"); falhou += 1; continue
    d = np.abs(x.astype(np.int16) - y.astype(np.int16)).max(axis=2)
    fora = ~(borda(x) | borda(y))
    mx = int(d[fora].max()) if fora.any() else 0
    ok = mx <= 2
    falhou += 0 if ok else 1
    print(f"{s.name}: max fora das bordas = {mx} ({'ok' if ok else 'FALHOU'}); max geral = {int(d.max())}; px > 2 fora = {int((d[fora] > 2).sum())}")
print("PASSOU" if not falhou else f"FALHOU em {falhou}")
sys.exit(1 if falhou else 0)
