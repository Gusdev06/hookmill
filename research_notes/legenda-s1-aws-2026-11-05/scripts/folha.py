#!/usr/bin/env python3
"""folha.py <saida.png> <y0> <y1> <t1,t2,...> <a.mp4> <b.mp4> [c.mp4...] — folha: uma linha por instante, uma coluna por vídeo, só a faixa ampliada +margem, com rótulo."""
import sys, subprocess, numpy as np, cv2
sa, y0, y1, ts = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), [int(x) for x in sys.argv[4].split(",")]; vs = sys.argv[5:]
ln = []
for t in ts:
    cols = []
    for v in vs:
        W, H = [int(x) for x in subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", v]).decode().strip().split(",")[:2]]
        b = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", "%.4f" % (t / 30), "-i", v, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"])
        f = np.frombuffer(b, np.uint8).reshape(H, W, 3)[max(0, y0 - 40):min(H, y1 + 40)].copy()
        cv2.putText(f, "%s t=%d (%.1fs)" % (v.split("/")[-1][:28], t, t / 30), (6, 18), cv2.FONT_HERSHEY_SIMPLEX, .5, (0, 255, 255), 1, cv2.LINE_AA); cols.append(f)
    ln.append(np.hstack(cols))
cv2.imwrite(sa, np.vstack(ln))
