"""Testes das medidas dos portões da legenda (leg_portoes.py), sintéticos, US$ 0, sem vídeo.
Uso (de api/src/medicao/troca/py): python3 -m unittest testes/test_legenda.py"""
import os, sys, unittest
import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
import leg_portoes as P


def seg(ini, fim, est=None, vazio=False):
    return {"ini": ini, "fim": fim, "vazio": vazio, **({} if vazio else {"est": est})}


def est_texto(linhas=1, h=20, vao=40, w=200):
    e = np.zeros((40 + (linhas - 1) * (h + vao), 300), bool)
    for k in range(linhas):
        y = 10 + k * (h + vao)
        e[y:y + h, 20:20 + w] = True
    return e


class TestPortoes(unittest.TestCase):
    def test_duas_linhas_coladas_contam_2(self):
        e = np.zeros((90, 300), bool)
        e[10:40, 20:220] = True; e[52:82, 20:220] = True    # vão de 12 px (0,4 da altura) entre linhas de 30 px (2 linhas apertadas)
        D = {"segs": [seg(0, 30, e), seg(30, 60, e), seg(60, 90, e)]}
        self.assertEqual(P.linhas_legenda(D, 30), 2)

    def test_descendente_de_caixa_mista_nao_e_segunda_linha(self):
        e = np.zeros((90, 300), bool)
        e[10:40, 20:220] = True; e[52:58, 60:70] = True; e[52:58, 120:130] = True   # 1 linha + 2 caudas de 'g' / 'y' (pouca tinta)
        D = {"segs": [seg(0, 30, e), seg(30, 60, e), seg(60, 90, e)]}
        self.assertEqual(P.linhas_legenda(D, 30), 1)

    def test_linhas(self):
        D = {"segs": [seg(0, 30, est_texto(1)), seg(30, 60, est_texto(1))]}
        self.assertEqual(P.linhas_legenda(D, 20), 1)
        D2 = {"segs": [seg(0, 30, est_texto(2)), seg(30, 60, est_texto(2)), seg(60, 90, est_texto(2))]}
        self.assertEqual(P.linhas_legenda(D2, 20), 2)

    def test_cobertura_com_atraso(self):
        D = {"N": 100, "segs": [seg(10, 60, est_texto(1)), seg(60, 100, vazio=True)]}
        ws = [{"w": "A", "ini": 0.3, "fim": 1.5}, {"w": "B", "ini": 2.5, "fim": 3.3}]
        c, fala = P.cobertura_fala(D, ws, 30, 0.1)
        self.assertAlmostEqual(c, 36 / 58, places=3)  # A (quadros 12-48) coberta; B (78-100) cai no trecho vazio
        self.assertTrue(fala.any())
        c2, _ = P.cobertura_fala({"N": 100, "segs": [seg(0, 100, est_texto(1))]}, ws, 30, 0.1)
        self.assertEqual(c2, 1.0)

    def test_animacao_ignora_entrada_e_mede_p75(self):
        bw = np.full(100, 200); bh = np.full(100, 40); bw[10:13] = 80  # entrada com escala: ignorada
        D = {"bw": bw, "bh": bh, "segs": [seg(10, 60, est_texto(1))]}
        self.assertLess(P.animacao(D), 0.02)
        bw2 = np.concatenate([np.linspace(100, 200, 50), np.full(50, 200)]).astype(int)
        self.assertGreater(P.animacao({"bw": bw2, "bh": bh, "segs": [seg(0, 50, est_texto(1))]}), 0.08)

    def test_fundo_mediana_das_janelas(self):
        lap = np.concatenate([np.full(15, 40.0), np.full(15, 42.0), np.full(15, 90.0)]).astype(np.float32)
        med, pior = P.fundo_lap({"lap": lap})
        self.assertEqual(med, 42.0); self.assertEqual(pior, 90.0)
        self.assertEqual(P.fundo_lap({"lap": np.full(10, np.nan, np.float32)}), (0.0, 0.0))

    def test_estilo_estavel_ignora_encaixe_ruim(self):
        N = 300; segs = [(seg(i * 30, i * 30 + 30, est_texto(1)), ["A"]) for i in range(10)]
        def enc(est, pal, spec, tr, esp, W):  # tamanho 55 em todos, menos o 1º (IoU 0,25 e corpo 119: não é legenda)
            return (0.25, (119,)) if est is segs[0][0]["est"] else (0.8, (55,))
        self.assertLess(P.estilo_estavel({"N": N}, segs, None, 0, 1, 300, enc), 0.05)

        def enc2(est, pal, spec, tr, esp, W):
            return (0.8, (40,)) if est.sum() and (est is segs[9][0]["est"] or est is segs[8][0]["est"] or est is segs[7][0]["est"]) else (0.8, (55,))
        self.assertGreater(P.estilo_estavel({"N": N}, segs, None, 0, 1, 300, enc2), 0.05)


def video_sintetico(caminho, legenda_muda=True, w=320, h=568, fps=30, seg=4):
    """Fundo cinza, headline FIXA no topo e legenda embaixo que troca a cada 0,5 s (ou parada, se legenda_muda=False). Texto branco com contorno preto."""
    import subprocess, cv2
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", caminho], stdin=subprocess.PIPE)
    pal = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT"]
    for k in range(seg * fps):
        f = np.full((h, w, 3), 90, np.uint8)
        for txt, y in (("HEADLINE HERE", 70), (pal[(k // 15) % 8] if legenda_muda else "STATIC", 470)):
            for dx in (-4, 0, 4):
                for dy in (-4, 0, 4):
                    cv2.putText(f, txt, (20 + dx, y + dy), cv2.FONT_HERSHEY_DUPLEX, 1.0, (0, 0, 0), 3, cv2.LINE_AA)   # contorno preto
            cv2.putText(f, txt, (20, y), cv2.FONT_HERSHEY_DUPLEX, 1.0, (255, 255, 255), 3, cv2.LINE_AA)
        p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()


class TestFaixa(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.d = tempfile.mkdtemp()

    def test_legenda_pela_fala_e_nao_headline_parada(self):
        import leg_det
        v = os.path.join(self.d, "a.mp4"); video_sintetico(v)
        words = [{"ini": 0.5 * k, "fim": 0.5 * k + 0.4} for k in range(8)]
        y0, y1, info = leg_det.escolher_faixa(v, False, words, 30, 568)
        self.assertIsNotNone(y0)
        self.assertGreater(y0, 300)          # embaixo, onde a legenda troca; a headline (y~70) é parada e perde
        self.assertLess(y1 - y0, 0.3 * 568)

    def test_nada_troca_com_a_fala_nao_e_legenda(self):
        import leg_det
        v = os.path.join(self.d, "b.mp4"); video_sintetico(v, legenda_muda=False)
        words = [{"ini": 0.5 * k, "fim": 0.5 * k + 0.4} for k in range(8)]
        y0, _, _ = leg_det.escolher_faixa(v, False, words, 30, 568)
        self.assertIsNone(y0)                # só texto parado: não há alvo (nunca vira a headline)

    def test_trechos_fora_da_fala_nao_viram_mascara(self):
        D = {"N": 300, "segs": [seg(0, 60, est_texto(1)), seg(60, 120, vazio=True), seg(120, 300, est_texto(1))]}
        ws = [{"ini": 0.0, "fim": 2.0}]      # fala só nos 2 primeiros segundos; o CTA parado (120-300) fica fora
        n = P.marcar_fora(D, ws, 30, 0.0)
        self.assertEqual(n, 1)
        self.assertTrue(D["segs"][2].get("fora")); self.assertFalse(D["segs"][0].get("fora"))

    def test_caixa_vermelha_e_candidata(self):
        import leg_det
        f = np.full((60, 200, 3), 40, np.uint8); f[10:50, 10:190] = (60, 20, 150)     # BGR: vinho
        import cv2
        cv2.putText(f, "AB", (30, 42), cv2.FONT_HERSHEY_DUPLEX, 1.4, (255, 255, 255), 2)
        self.assertTrue(leg_det.candidato(f, True)[12:48, 12:188].mean() > 0.5)   # a caixa entra com caixa=True
        self.assertLess(leg_det.candidato(f, False)[12:20, 12:40].mean(), 0.2)    # sem caixa não


if __name__ == "__main__":
    unittest.main()
