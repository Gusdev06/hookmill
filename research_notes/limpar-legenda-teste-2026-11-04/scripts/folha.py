"""folha.py <id> <dir> <saida.png> <t1> [t2 ...] — recortes da área da legenda: original | limpo | A | C | V | N, zoom 1.6x"""
import sys, json, numpy as np, cv2
v, O, out = sys.argv[1], sys.argv[2], sys.argv[3]; ts = [float(x) for x in sys.argv[4:]]
D = np.load(f"d{v}.npz", allow_pickle=True); y0, y1 = int(D["y0"]), int(D["y1"])
segs = [s for s in D["segs"] if not s["vazio"] and s["bbox"]]
def grab(p, t):
    c = cv2.VideoCapture(p); c.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * 30))); ok, f = c.read(); return f
rows = []
for t in ts:
    fi = int(round(t * 30)); s = next((s for s in segs if s["ini"] <= fi < s["fim"]), None)
    if s is not None: a, b = s["bbox"][0] - 30, s["bbox"][1] + 30
    else: a, b = y0, y1
    cols = []
    for nome, p in [("ORIGINAL", f"v{v}.mp4"), ("LIMPO (so remocao)", f"{O}/limpo.mp4"), ("A fiel", f"{O}/A.mp4"), ("C fiel traco+2", f"{O}/C.mp4"), ("V destaque novo", f"{O}/V.mp4"), ("N sem remocao", f"{O}/N.mp4")]:
        c = grab(p, t)[max(0, a):b].copy(); c = cv2.resize(c, None, fx=1.6, fy=1.6, interpolation=cv2.INTER_CUBIC)
        cv2.rectangle(c, (0, 0), (len(nome) * 13 + 10, 26), (0, 0, 0), -1); cv2.putText(c, nome, (5, 19), 0, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        cols.append(c)
    hh = max(x.shape[0] for x in cols)
    row = np.vstack(cols); lab = np.zeros((34, row.shape[1], 3), np.uint8); cv2.putText(lab, f"t={t:.2f}s", (8, 25), 0, 0.8, (0, 255, 255), 2)
    rows.append(np.vstack([lab, row]))
gap = np.full((max(r.shape[0] for r in rows), 12, 3), 255, np.uint8)
rows = [np.vstack([r, np.zeros((gap.shape[0] - r.shape[0], r.shape[1], 3), np.uint8)]) for r in rows]
out_im = rows[0]
for r in rows[1:]: out_im = np.hstack([out_im, gap, r])
cv2.imwrite(out, out_im)
