"""Op `conferir` (troca-texto-queimado-v1 §15.5.7, §16.2). Dono: video.

Peça final contra a referência (campeão ou placa): quadros, áudio, diferença fora do que mudou (no trecho e fora
dele), banda da legenda e o 1º quadro sem mudança na área do texto. Só mede; o limite é aplicado pelo chamador.
"""
import hashlib, subprocess
import numpy as np
import cv2

from comum import FFMPEG, sonda, quadros, r2


def md5_audio(caminho):
    p = subprocess.run([FFMPEG, "-v", "error", "-i", caminho, "-map", "0:a:0?", "-c", "copy", "-f", "md5", "-"],
                       capture_output=True, text=True)
    return p.stdout.strip() or None


def _mascara(H, W, regioes, i):
    m = np.zeros((H, W), bool)
    for r in regioes:
        if r["startFrame"] <= i < r["endFrame"]:
            x, y, w, h = r["rect"]
            m[max(0, y):y + h, max(0, x):x + w] = True
    return m


def conferir(ev, peca="peca.mp4", ref="ref.mp4"):
    """ev: regioes [{rect, startFrame, endFrame}] = o que pode mudar; texto = {rect, startFrame, endFrame} (área do
    texto, para o 1º quadro sem mudança); bandas [{rect, startFrame, endFrame}] da legenda; limiar_mudanca (1,5)."""
    ip, ir = sonda(peca), sonda(ref)
    W, H = ip["w"], ip["h"]
    regioes, bandas, txt = ev.get("regioes", []), ev.get("bandas", []), ev.get("texto")
    a = min((r["startFrame"] for r in regioes), default=0)
    b = max((r["endFrame"] for r in regioes), default=0)
    dentro, fora, banda = [], [], []
    primeiro_sem = None
    lim = ev.get("limiar_mudanca", 1.5)
    for i, (fp, fr) in enumerate(zip(quadros(peca, ip), quadros(ref, ir))):
        d = np.abs(fp.astype(np.int16) - fr.astype(np.int16)).mean(2)
        m = _mascara(H, W, regioes, i)
        fora_m = ~cv2.dilate(m.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) if m.any() else np.ones((H, W), bool)
        bm = _mascara(H, W, bandas, i)
        fora_m &= ~bm
        (dentro if a <= i < b else fora).append(float(d[fora_m].mean()))
        if bm.any():
            banda.append(float(d[bm & ~m].mean()) if (bm & ~m).any() else 0.0)
        if txt and primeiro_sem is None and i >= txt["startFrame"]:
            x, y, w, h = txt["rect"]
            if float(d[y:y + h, x:x + w].mean()) < lim:
                primeiro_sem = i
    est = lambda v: dict(media=r2(np.mean(v), 3), pior=r2(np.max(v), 3)) if v else None
    return dict(quadros_peca=ip["n"], quadros_ref=ir["n"], audio_md5_peca=md5_audio(peca), audio_md5_ref=md5_audio(ref),
                fora_no_trecho=est(dentro), fora_do_trecho=est(fora), banda_legenda=est(banda), primeiro_quadro_sem_mudanca=primeiro_sem)
