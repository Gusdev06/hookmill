#!/usr/bin/env python3
"""Conferências do editor no vídeo v1 (F2d). Dono: maquina-qa. Local, grátis (ffmpeg + numpy/PIL). Saída: JSON no stdout.

  python3 qa_editor.py psnr <a.mp4> <b.mp4>
      não regressão (doc nulo): nº de frames, PSNR RGB por frame (ffmpeg, gbrp), quantos inf, md5 do áudio decodificado.
  python3 qa_editor.py frame <video.mp4> <n> <saida.png>
      extrai o frame n (select=eq(n,N)), em RGB.
  python3 qa_editor.py wysiwyg <player.png> <render.png> [--lado 540x960] [--bloco 16]
      Player × render no MESMO frame: os dois reduzidos pro mesmo tamanho (Lanczos); diferença média por bloco 16x16
      (RGB). Devolve o máximo e o p99 dos blocos. Texto fora do lugar dá bloco > 60; decodificador/encoder dá < 25
      (o <video> do Chrome converte cor diferente do OffthreadVideo: ver docs/render.md, F1).
"""
import json
import re
import subprocess
import sys

import numpy as np
from PIL import Image


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def nframes(p):
    r = run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", p])
    return int(r.stdout.strip() or 0)


def audio_md5(p):
    r = run(["ffmpeg", "-v", "error", "-i", p, "-map", "0:a", "-f", "md5", "-"])
    return r.stdout.strip()


def psnr(a, b):
    log = "/tmp/qa_editor_psnr.log"
    run(["ffmpeg", "-v", "error", "-i", a, "-i", b, "-lavfi", f"[0:v]format=gbrp[x];[1:v]format=gbrp[y];[x][y]psnr=stats_file={log}", "-f", "null", "-"])
    linhas = open(log).read().strip().splitlines()
    inf = sum(1 for l in linhas if "psnr_avg:inf" in l)
    finitos = []
    for i, l in enumerate(linhas):
        m = re.search(r"psnr_avg:([0-9.]+)", l)
        if m:
            finitos.append((i, float(m.group(1))))
    out = {
        "frames_a": nframes(a), "frames_b": nframes(b), "comparados": len(linhas), "inf": inf,
        "pior": min(finitos, key=lambda x: x[1]) if finitos else None,
        "frames_diferentes": [i for i, _ in finitos][:40],
        "audio_igual": audio_md5(a) == audio_md5(b),
    }
    print(json.dumps(out))


def frame(v, n, saida):
    r = run(["ffmpeg", "-v", "error", "-y", "-i", v, "-vf", f"select=eq(n\\,{n})", "-vsync", "0", "-frames:v", "1", "-pix_fmt", "rgb24", saida])
    print(json.dumps({"ok": r.returncode == 0, "saida": saida, "erro": r.stderr[-300:]}))


def recorte_da_composicao(img, comp=(1080, 1920)):
    """O <Player> encaixa a composição na caixa (contain): a caixa CSS é arredondada pra px inteiro, então sobra até
    ~1 px de tarja. Recorta o retângulo exato da composição antes de comparar (senão vira um desalinhamento de 1 px)."""
    W, H = img.size
    s = min(W / comp[0], H / comp[1])
    w, h = comp[0] * s, comp[1] * s
    x0, y0 = (W - w) / 2, (H - h) / 2
    return img.crop((round(x0), round(y0), round(x0 + w), round(y0 + h)))


def wysiwyg(player, render, lado="540x960", bloco=16):
    from PIL import ImageFilter
    w, h = (int(x) for x in lado.split("x"))
    pa = recorte_da_composicao(Image.open(player).convert("RGB"))
    pb = Image.open(render).convert("RGB")
    # blur de 1 px nos dois: tolera a borda de glifo/arredondamento de subpixel, não tolera camada fora do lugar (>= 8 px)
    a = np.asarray(pa.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1))).astype(np.float32)
    b = np.asarray(pb.resize((w, h), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1))).astype(np.float32)
    d = np.abs(a - b).mean(axis=2)
    hb, wb = h // bloco, w // bloco
    blocos = d[: hb * bloco, : wb * bloco].reshape(hb, bloco, wb, bloco).mean(axis=(1, 3))
    iy, ix = np.unravel_index(int(blocos.argmax()), blocos.shape)
    print(json.dumps({
        "max_bloco": round(float(blocos.max()), 2), "p99_bloco": round(float(np.percentile(blocos, 99)), 2),
        "media": round(float(d.mean()), 2), "pior_bloco_xy": [int(ix * bloco), int(iy * bloco)], "lado": [w, h],
    }))


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    if cmd == "psnr":
        psnr(*args)
    elif cmd == "frame":
        frame(args[0], int(args[1]), args[2])
    elif cmd == "wysiwyg":
        kw = {}
        rest = args[2:]
        for i in range(0, len(rest), 2):
            if rest[i] == "--lado":
                kw["lado"] = rest[i + 1]
            if rest[i] == "--bloco":
                kw["bloco"] = int(rest[i + 1])
        wysiwyg(args[0], args[1], **kw)
    else:
        raise SystemExit(__doc__)
