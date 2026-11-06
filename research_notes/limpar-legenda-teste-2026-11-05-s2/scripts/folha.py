#!/usr/bin/env python3
"""folha.py <saida.png> <y0> <y1> <zoom> <t1,t2,...> <rotulo=video> ... — recortes do mesmo trecho em colunas, para olhar. Linhas = tempos."""
import sys, numpy as np, cv2
out, a, b, z = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]); ts = [float(x) for x in sys.argv[5].split(",")]
vs = [x.split("=", 1) for x in sys.argv[6:]]
caps = {r: cv2.VideoCapture(p) for r, p in vs}; linhas = []
for t in ts:
    cols = []
    for r, _ in vs:
        c = caps[r]; c.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * 30))); ok, f = c.read()
        q = cv2.resize(f[a:b], None, fx=z, fy=z, interpolation=cv2.INTER_LANCZOS4)
        cv2.rectangle(q, (0, 0), (9 * len(r) + 90, 20), (0, 0, 0), -1); cv2.putText(q, f"{r} t={t:.1f}", (4, 15), 0, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        cols.append(q); cols.append(np.full((q.shape[0], 6, 3), 255, np.uint8))
    linhas.append(np.hstack(cols[:-1])); linhas.append(np.full((6, linhas[-1].shape[1], 3), 255, np.uint8))
cv2.imwrite(out, np.vstack(linhas[:-1]))
