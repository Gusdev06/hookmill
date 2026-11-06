"""pegada.py — máscara por quadro da legenda antiga (letra + contorno + sombra), comum a E1 e E2.
Reaproveita candidato() e a máscara estável do detectar.py. Diferença para o trocar.py: não recorta pelo retângulo do
texto da fala (era isso que deixava palavra sobrando, ex. o "Y" no 02) e pega letra alinhada na mesma linha."""
import json, numpy as np, cv2
from detectar import candidato, frames, probe

def elipse(r): return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
K2, K15 = elipse(2), elipse(15)

class Legenda:
    def __init__(self, v, base="."):
        self.v = v; self.base = base
        D = np.load(f"{base}/d{v}.npz", allow_pickle=True); self.E = json.load(open(f"{base}/estilo{v}.json"))
        self.y0, self.y1, self.W, self.H, self.N = [int(D[k]) for k in ("y0", "y1", "W", "H", "N")]
        self.Hb = self.y1 - self.y0; self.segs = list(D["segs"]); self.caixa = v == "02"
        E = self.E; self.R = E["stroke"] + max(E["sombra"]) + 3 + (3 if self.caixa else 0); self.KR = elipse(self.R)
        self.tam = E["tam"]
        for s in self.segs:
            if s["vazio"]: continue
            est = s["est"]; rc = est.sum(1); bom = est.sum() > 300 and s["fim"] - s["ini"] >= 5
            s["bom"] = bool(bom)
            if rc.max() > 0:
                r = np.where(rc >= 0.15 * rc.max())[0]; s["r0"], s["r1"] = int(r.min()), int(r.max())
                c = np.where(est[s["r0"]:s["r1"] + 1].any(0))[0]; s["c0"], s["c1"] = int(c.min()), int(c.max())
            else: s["bom"] = False
        boas = [i for i, s in enumerate(self.segs) if not s["vazio"] and s.get("bom")]
        self.boas = boas
        self.seg_de = np.full(self.N, -1)
        for i, s in enumerate(self.segs): self.seg_de[s["ini"]:s["fim"]] = i
        # estáveis usados: trecho ruim herda os vizinhos bons (animação de entrada, 1-4 quadros)
        for i, s in enumerate(self.segs):
            viz = sorted(boas, key=lambda j: abs(j - i))[:2]
            if s["vazio"] or not s.get("bom"):
                s["usa"] = viz
            else: s["usa"] = [i]

    def pegada(self, band, t, cand=None):
        """devolve (Fp uint8 0/1, T bool: a letra em si) da legenda antiga no quadro t. band = quadro[y0:y1] BGR."""
        i = self.seg_de[t] if t < self.N else -1
        zero = np.zeros(band.shape[:2], np.uint8)
        if i < 0: return zero, zero.astype(bool)
        s = self.segs[i]; usa = s["usa"]
        if cand is None: cand = candidato(band, self.caixa)
        T = np.zeros(band.shape[:2], bool); lim = np.zeros(band.shape[:2], np.uint8)
        est = None
        for j in usa:
            sj = self.segs[j]; e = sj["est"].copy(); r0, r1 = sj["r0"], sj["r1"]
            e[:max(0, r0 - 6)] = False; e[r1 + 7:] = False
            if not s["vazio"]: T |= e   # quadro "vazio" não herda a máscara estável: só o que há no próprio quadro
            est = e if est is None else (est | e)
            m = int(1.5 * self.tam); a, b = max(0, r0 - 8), r1 + 9; lim[a:b, max(0, sj["c0"] - m):sj["c1"] + m] = 1
        if est is None: return zero, zero.astype(bool)
        perto = cv2.dilate(est.astype(np.uint8), K15) > 0
        if self.caixa: perto |= cv2.dilate(est.astype(np.uint8), np.ones((41, 121), np.uint8)) > 0
        T |= cand & perto & (cv2.dilate(lim, np.ones((25, 1), np.uint8)) > 0)
        # letra que a máscara estável perdeu (palavra pequena na mesma linha): componente com tamanho de letra
        cr = (cand & (lim > 0)).astype(np.uint8)
        if cr.any():
            n, lab, st, _ = cv2.connectedComponentsWithStats(cr, connectivity=8)
            ok = (st[:, 3] <= 1.5 * self.tam) & (st[:, 2] <= (12 if self.caixa else 3) * self.tam) & (st[:, 4] >= 6); ok[0] = False
            T |= ok[lab]
        if T.sum() < 30: return zero, zero.astype(bool)
        Tu = T.astype(np.uint8)
        Fp = (cv2.dilate(Tu, K2) > 0) | ((band.max(2) < 85) & (cv2.dilate(Tu, self.KR) > 0))
        Fp = cv2.dilate(Fp.astype(np.uint8), K2)
        return Fp, T

def cor_args(path):
    """Mantém a matriz de cor da origem. Sem isto a placa sai em BT.601 sobre fonte BT.709 e a pele muda de tom (erro presente nos testes de 04/11)."""
    import subprocess
    cs = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=color_space", "-of", "csv=p=0", path]).decode().strip().split(",")[0]
    if cs == "bt709":
        return ["-vf", "scale=out_color_matrix=bt709:out_range=tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"]
    return []
