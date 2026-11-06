#!/usr/bin/env python3
"""comparar.py <a.mp4> <b.mp4> <y0> <y1> [saida.json] — compara dois vídeos quadro a quadro pelo ffmpeg (mesma conversão dos dois lados):
PSNR/SSIM no quadro inteiro e na faixa da legenda. Lista os piores quadros na faixa. Sem IA, local."""
import sys, json, subprocess, numpy as np, cv2
def fr(p, W, H):
    q = subprocess.Popen(["ffmpeg", "-v", "error", "-i", p, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE, bufsize=W * H * 12); n = W * H * 3
    while True:
        b = q.stdout.read(n)
        if len(b) < n: break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
def ssim(a, b):
    a = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32); b = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32); G = lambda x: cv2.GaussianBlur(x, (0, 0), 1.5)
    ma, mb = G(a), G(b); va, vb, c = G(a * a) - ma * ma, G(b * b) - mb * mb, G(a * b) - ma * mb
    return float((((2 * ma * mb + 6.5) * (2 * c + 58.5)) / ((ma * ma + mb * mb + 6.5) * (va + vb + 58.5))).mean())
def psnr(a, b):
    e = ((a.astype(np.float32) - b.astype(np.float32)) ** 2).mean(); return 99.0 if e < 1e-6 else float(10 * np.log10(255 ** 2 / e))
def main():
    A, B, y0, y1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); W, H = [int(x) for x in subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", A]).decode().strip().split(",")[:2]]
    P = []; Pb = []; S = []; n = 0
    for t, (a, b) in enumerate(zip(fr(A, W, H), fr(B, W, H))):
        P.append(psnr(a, b)); Pb.append(psnr(a[y0:y1], b[y0:y1])); n += 1
        if t % 5 == 0: S.append(ssim(a[y0:y1], b[y0:y1]))
    Pb = np.array(Pb); P = np.array(P); pi = np.argsort(Pb)[:12].tolist()
    r = dict(quadros=n, psnr_quadro_mediana=round(float(np.median(P)), 2), psnr_faixa_mediana=round(float(np.median(Pb)), 2), psnr_faixa_p5=round(float(np.percentile(Pb, 5)), 2), psnr_faixa_min=round(float(Pb.min()), 2), ssim_faixa_media=round(float(np.mean(S)), 4), ssim_faixa_min=round(float(np.min(S)), 4), iguais_pct=round(100 * float((Pb >= 99).mean()), 1), piores=pi)
    print(json.dumps(r))
    if len(sys.argv) > 5: json.dump(r, open(sys.argv[5], "w"))
if __name__ == "__main__": main()
