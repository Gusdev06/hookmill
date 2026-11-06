#!/usr/bin/env python3
"""olhar.py <saida.png> <ini_clipe_s> <y0> <y1> <zoom> <t1,t2,...(tempo do vídeo)> <arq.mp4> ... — lado direito dos antes-depois (o resultado), linhas = tempos, colunas = combinações"""
import sys, os, numpy as np, cv2
o, ini, a, b, z = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), float(sys.argv[5]); ts = [float(x) for x in sys.argv[6].split(",")]; arqs = sys.argv[7:]
caps = [cv2.VideoCapture(p) for p in arqs]; L = []
for t in ts:
    C = []
    for p, c in zip(arqs, caps):
        c.set(cv2.CAP_PROP_POS_FRAMES, int(round((t - ini) * 30))); ok, f = c.read(); w = (f.shape[1] - 8) // 2
        q = cv2.resize(f[a:b, w + 8:], None, fx=z, fy=z, interpolation=cv2.INTER_AREA); r = os.path.basename(p)[:-4] + f" t={t}"
        cv2.rectangle(q, (0, 0), (len(r) * 8 + 8, 18), (0, 0, 0), -1); cv2.putText(q, r, (3, 13), 0, 0.42, (255, 255, 255), 1, cv2.LINE_AA); C += [q, np.full((q.shape[0], 5, 3), 255, np.uint8)]
    L += [np.hstack(C[:-1]), np.full((5, sum(x.shape[1] for x in C[:-1]), 3), 255, np.uint8)]
cv2.imwrite(o, np.vstack(L[:-1]))
