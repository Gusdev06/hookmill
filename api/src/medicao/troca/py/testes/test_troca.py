"""Testes da medida por imagem (V2, troca-texto §16.2) nas imagens da S4 que estão no repo (US$ 0, sem vídeo).
Uso (de api/src/medicao/troca/py): FONTES_DIR=../../../../../video/public/fonts python -m unittest testes/test_troca.py
Python fixado: numpy 2.0.2, opencv-python-headless 5.0.0.93, pillow 11.3.0.
"""
import os, sys, unittest
import numpy as np
import cv2

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
RAIZ = os.path.abspath(os.path.join(AQUI, *[".."] * 6))
S4 = os.path.join(RAIZ, "research_notes", "s4-demo-2026-11-06", "quadros")
G0 = os.path.join(RAIZ, "research_notes", "g0-2026-11-06", "ref")
os.environ.setdefault("FONTES_DIR", os.path.join(RAIZ, "video", "public", "fonts"))

from texto import (alfa_caixa, alfa_solto, traco, linhas, sublinhados, dilatacao_a5, emoji_a1, emoji_veredito, achar_emoji,
                   limpar_blobs, BRILHO, fantasma)
import fontes

TXT = {"02": ["Si en 2 minutos no te", "busca, es porque", "nunca fue para ti.."],
       "05": ["If he doesn't call you", "within two minutes,", "I’ll pay you $50"],
       "06": ["Él ya está con otra? Te", "propongo algo. Si en 7 días", "no te busca, dime mentirosa"]}


def caixa(v):
    med = cv2.imread(os.path.join(S4, f"caixa-{v}-med.png"))
    al0, _, _, _ = alfa_caixa(med)
    subs = sublinhados(al0)
    al, letra, tx, _ = alfa_caixa(med, [(s[0], s[1]) for s in subs])
    return med, al, letra, subs


@unittest.skipUnless(os.path.isdir(S4), "imagens da S4 ausentes")
class Caixa(unittest.TestCase):
    def test_linhas_e_sublinhado(self):
        # S4 (regua-caixa.json, original): 02 665/541/564; 05 580/548/431; 06 364/436/452 (±2 px)
        esperado = {"02": [665, 541, 564], "05": [580, 548, 431], "06": [364, 436, 452]}
        for v, e in esperado.items():
            _, al, _, subs = caixa(v)
            w = [q[4] for q in linhas(al)]
            self.assertEqual(len(w), 3, v)
            for a, b in zip(w, e):
                self.assertLessEqual(abs(a - b), 2, (v, w))
        # §14.1.1 item 5: no 02, y 153-158 (x 303-641) e y 220-225 (x 76-604)
        _, _, _, subs = caixa("02")
        self.assertEqual(len(subs), 2)
        self.assertLessEqual(abs(subs[0][0] - 153), 1)
        self.assertLessEqual(abs(subs[1][0] - 220), 1)
        self.assertLessEqual(abs(subs[0][2] - 303), 3)

    def test_a5_dilatacao_05(self):
        # aceite da V2: 21 ± 4 no 05 (com sombra); 06 e 02 sem sombra ficam em 9
        med, _, letra, _ = caixa("05")
        d, p99, _ = dilatacao_a5(med, letra, True)
        self.assertIsNotNone(d)
        self.assertLessEqual(abs(d - 21), 4, d)
        self.assertLessEqual(p99, 12)
        med6, _, letra6, _ = caixa("06")
        self.assertEqual(dilatacao_a5(med6, letra6, False)[0], 9)

    def test_traco_separa_pesos(self):
        # §16.2 A3: Montserrat 500 no 02 erra o traço em mais de 15 % (S4: −25 %); a 600 aprovada fica dentro
        _, al, _, _ = caixa("02")
        m = linhas(al)
        st0 = traco(al)
        err = {}
        for f in ("montserrat-500", "montserrat-600"):
            _, lay = fontes.ajustar(al, np.ones_like(al), TXT["02"], f, m)
            a = fontes.desenhar(f, TXT["02"], al.shape[1], al.shape[0], lay["sz"], lay["pitch"], lay["base"], lay["cxs"], lay["tr"])
            err[f] = (traco(a) - st0) / st0
        self.assertLess(err["montserrat-500"], -.15)
        self.assertLess(abs(err["montserrat-600"]), .15)

    def test_preselecao_tem_as_aprovadas(self):
        # §16.11: aprovadas 02 Montserrat 600, 05 Albert Sans 500, 06 Montserrat 500. Com o catálogo inteiro da V1 (TikTok
        # Sans, Albert, Arimo, Inter), a 06 cai para 7ª: entra pela fonte da visão (`extra`), como no troca-real.ts.
        # Achado V2 (06/11): a régua no Chrome prefere TikTok Sans nas 3 caixas; decisão do Gusta pendente.
        aprovada = {"02": ("montserrat-600", 5), "05": ("albert-sans-500", 5), "06": ("montserrat-500", 7)}
        for v, (f, k) in aprovada.items():
            _, al, _, _ = caixa(v)
            m = linhas(al)
            ls = fontes.quebrar(" ".join(TXT[v]), [q[4] for q in m])
            self.assertEqual(ls, TXT[v])
            ids = [p["fontId"] for p in fontes.preselecionar(al, ls, m, k=k)]
            self.assertIn(f, ids, (v, ids))
            com_visao = [p["fontId"] for p in fontes.preselecionar(al, ls, m, extra=[f])]
            self.assertIn(f, com_visao)


@unittest.skipUnless(os.path.isdir(G0), "recortes do G0 ausentes")
class Solto(unittest.TestCase):
    def test_emoji_a1_no_quadro_original(self):
        # 1 quadro (a S4 usou a mediana de 161): a regra acha o emoji e ele passa nos cortes de ocupa e solidez
        f = cv2.imread(os.path.join(G0, "solto-original-quadro.png"))
        roi = f[527:608, 30:440]
        g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        al = alfa_solto(g)
        meds = linhas(al)
        self.assertEqual(len(meds), 2)
        q = meds[1]
        e = achar_emoji(g > BRILHO, (q[0], q[1]), traco(al), "end")
        self.assertIsNotNone(e)
        x0, y0, x1, y1 = e
        self.assertTrue(355 - 30 <= x0 <= 362 - 30, e)       # S4: bbox_x0 = 359
        crop = roi[max(0, y0 - 5):y1 + 5, x0 - 5:x1 + 5]
        r = emoji_a1(crop)
        self.assertIsNone(emoji_veredito(r), r and {k: r[k] for k in ("ocupa", "solidez", "lobulos")})
        self.assertGreaterEqual(r["lobulos"], 2)

    def test_limpar_blobs_tira_pele(self):
        f = cv2.imread(os.path.join(G0, "solto-original-quadro.png"))
        al = alfa_solto(cv2.cvtColor(f[527:608, 30:440], cv2.COLOR_BGR2GRAY))
        al[37:72, 327:] = 0
        self.assertLess(traco(limpar_blobs(al)), traco(al))

    def test_fantasma_separa(self):
        # A2: o original tem letra (média alta, corr alta); a mesma cena sem letra não
        f = cv2.imread(os.path.join(G0, "solto-original-quadro.png"))
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)[527:608, 30:440]
        molde = (g > BRILHO).astype(np.uint8)
        m0, c0 = fantasma(g, molde)
        limpo = cv2.inpaint(f[527:608, 30:440], cv2.dilate(molde * 255, np.ones((7, 7), np.uint8)), 5, cv2.INPAINT_TELEA)
        m1, c1 = fantasma(cv2.cvtColor(limpo, cv2.COLOR_BGR2GRAY), molde)
        self.assertGreater(m0, 10)
        self.assertLessEqual(abs(m1), 3)
        self.assertLessEqual(c1, .10)


if __name__ == "__main__":
    unittest.main()
