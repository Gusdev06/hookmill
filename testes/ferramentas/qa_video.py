#!/usr/bin/env python3
# Conferência de vídeo do QA (feature 2 §13: manter a edição + take único). Dono: maquina-qa.
# Local e grátis: ffmpeg + OpenCV (YuNet). Nada de provedor. Saída = JSON no stdout (os specs leem).
#
#   python3 testes/ferramentas/qa_video.py rostos <video> [--fps 5] [--score 0.8] [--regiao x,y,w,h]
#       rostos por amostra (score >= limiar, escolha por score, nunca por área) + resumo
#   python3 testes/ferramentas/qa_video.py peca --campeao <mp4> --peca <mp4> --trilha <json> [--excluir <json>] [--folha <png>]
#       a peça de "Trocar avatar mantendo a edição" contra o campeão (§13.8 Q7):
#         1. mesma largura/altura/fps/nº de frames;  2. md5 do áudio DECODIFICADO igual;
#         3. fora da região do rosto (e fora das camadas redesenhadas): PSNR >= 40 dB em todo frame;
#         4. dentro da região: DIFERENTE do campeão em todo frame da trilha (pega o original "piscando");
#         5. 1 rosto (YuNet >= 0,8) dentro da região em todo frame da trilha.
#       trilha = [{startFrame, endFrame, region:{x,y,w,h}}]  (frames [start, end) na grade do campeão)
#       excluir = [{startFrame, endFrame, box:{x,y,w,h}}]   (camadas redesenhadas: ficam fora do item 3)
#   python3 testes/ferramentas/qa_video.py gancho --campeao <mp4> --peca <mp4> --caixa x,y,w,h --ate-frame N
#       Novos ganchos (a): corpo intacto = áudio decodificado md5-igual + nº de frames igual + fora da caixa do
#       texto do gancho PSNR >= 40 dB em todo frame (critério; o md5 do vídeo fora da caixa é só informativo,
#       só bate com render sem perdas). Dentro da caixa, até N: diferente.
import argparse
import hashlib
import json
import math
import os
import subprocess
import sys

import cv2
import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
MODELO = os.path.join(AQUI, 'modelos', 'face_detection_yunet_2023mar.onnx')


def sh(args, binary=False):
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise SystemExit(f'falhou: {" ".join(args)}\n{r.stderr.decode()[-1500:]}')
    return r.stdout if binary else r.stdout.decode()


def probe(path):
    j = json.loads(sh(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
                       'stream=width,height,r_frame_rate,nb_read_frames', '-of', 'json', path]))
    s = j['streams'][0]
    num, den = s['r_frame_rate'].split('/')
    return {'width': int(s['width']), 'height': int(s['height']), 'fps': round(int(num) / int(den), 3),
            'frames': int(s['nb_read_frames'])}


def md5_audio(path):
    # áudio DECODIFICADO (regra da esteira): -c:a copy preserva; recodificar muda o md5
    out = sh(['ffmpeg', '-hide_banner', '-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'md5', '-'])
    return out.strip().replace('MD5=', '')


def frames(path, w, h):
    """Gera frames BGR (np.uint8 h×w×3), um por vez, sem reescalar."""
    p = subprocess.Popen(['ffmpeg', '-hide_banner', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'],
                         stdout=subprocess.PIPE)
    n = w * h * 3
    try:
        while True:
            buf = p.stdout.read(n)
            if len(buf) < n:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.wait()


class Detector:
    def __init__(self, score=0.8):
        self.score = score
        self.det = cv2.FaceDetectorYN.create(MODELO, '', (320, 320), 0.3, 0.3, 5000)

    def rostos(self, img):
        h, w = img.shape[:2]
        self.det.setInputSize((w, h))
        _, faces = self.det.detect(img)
        out = []
        if faces is not None:
            for f in faces:
                if float(f[14]) >= self.score:
                    out.append({'box': [int(f[0]), int(f[1]), int(f[2]), int(f[3])], 'score': round(float(f[14]), 3)})
        out.sort(key=lambda r: -r['score'])  # por score, nunca por área
        return out


def rect(s):
    x, y, w, h = [int(v) for v in s.split(',')]
    return {'x': x, 'y': y, 'w': w, 'h': h}


def crop(img, r):
    return img[r['y']:r['y'] + r['h'], r['x']:r['x'] + r['w']]


def psnr(a, b):
    mse = float(np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2))
    return 99.0 if mse == 0 else 10 * math.log10(255 * 255 / mse)


# ───────────── rostos ─────────────
def cmd_rostos(a):
    pr = probe(a.video)
    det = Detector(a.score)
    passo = max(1, round(pr['fps'] / a.fps))
    regiao = rect(a.regiao) if a.regiao else None
    amostras = []
    for i, f in enumerate(frames(a.video, pr['width'], pr['height'])):
        if i % passo:
            continue
        img = crop(f, regiao) if regiao else f
        rs = det.rostos(img)
        # baixa confiança: o melhor score cru (sem limiar) ajuda a calibrar fixture de low_confidence
        det.det.setInputSize((img.shape[1], img.shape[0]))
        _, cru = det.det.detect(img)
        melhor = round(float(max(cru[:, 14])) if cru is not None and len(cru) else 0.0, 3)
        amostras.append({'frame': i, 'rostos': rs, 'melhorCru': melhor})
    n = len(amostras)
    cont = {k: sum(1 for s in amostras if (len(s['rostos']) == k if k < 2 else len(s['rostos']) >= 2)) for k in (0, 1, 2)}
    resumo = {
        'video': os.path.basename(a.video), **pr, 'amostras': n, 'passoFrames': passo, 'limiar': a.score,
        'zeroRostos': cont[0], 'umRosto': cont[1], 'doisOuMais': cont[2],
        'pctDoisOuMais': round(100 * cont[2] / n, 1) if n else 0, 'pctAbaixoDoLimiar': round(100 * cont[0] / n, 1) if n else 0,
        'scoreMin': min((s['rostos'][0]['score'] for s in amostras if s['rostos']), default=None),
        'melhorCruMediana': float(np.median([s['melhorCru'] for s in amostras])) if n else None,
    }
    if a.detalhe:
        resumo['detalhe'] = amostras
    else:
        # centro do rosto principal por amostra, pra conferir em que célula ele está
        resumo['centros'] = [[s['frame'], s['rostos'][0]['box'][0] + s['rostos'][0]['box'][2] // 2,
                              s['rostos'][0]['box'][1] + s['rostos'][0]['box'][3] // 2] for s in amostras if s['rostos']]
    print(json.dumps(resumo))


# ───────────── peça (Trocar avatar mantendo a edição) ─────────────
def na_trilha(trilha, i):
    for t in trilha:
        if t['startFrame'] <= i < t['endFrame']:
            return t
    return None


def cmd_peca(a):
    pc, pp = probe(a.campeao), probe(a.peca)
    trilha = json.load(open(a.trilha))
    excluir = json.load(open(a.excluir)) if a.excluir else []
    w, h = pc['width'], pc['height']
    res = {'campeao': pc, 'peca': pp, 'grade': all(pc[k] == pp[k] for k in ('width', 'height', 'fps', 'frames'))}
    res['audioMd5'] = {'campeao': md5_audio(a.campeao), 'peca': md5_audio(a.peca)}
    res['audioIgual'] = res['audioMd5']['campeao'] == res['audioMd5']['peca']
    if not res['grade'] and not a.forcar:
        res['ok'] = False
        print(json.dumps(res))
        return
    det = Detector(0.8)
    psnr_fora, dif_dentro, rostos_ruins, piscando = [], [], [], []
    folha = []
    passo_folha = int(round(pc['fps'] * 2))
    for i, (fc, fp) in enumerate(zip(frames(a.campeao, w, h), frames(a.peca, w, h))):
        t = na_trilha(trilha, i)
        mask = np.ones((h, w), bool)
        if t:
            r = t['region']
            mask[r['y']:r['y'] + r['h'], r['x']:r['x'] + r['w']] = False
        for e in excluir:
            if e['startFrame'] <= i < e['endFrame']:
                b = e['box']
                mask[b['y']:b['y'] + b['h'], b['x']:b['x'] + b['w']] = False
        if mask.any():
            psnr_fora.append((psnr(fc[mask], fp[mask]), i))
        if t:
            r = t['region']
            d = float(np.mean(np.abs(crop(fc, r).astype(np.int16) - crop(fp, r).astype(np.int16))))
            dif_dentro.append((d, i))
            if d < a.limiar_diferente:
                piscando.append(i)
            n = len(det.rostos(crop(fp, r)))
            if n != 1:
                rostos_ruins.append([i, n])
        if a.folha and i % passo_folha == 0:
            folha.append(np.hstack([cv2.resize(fc, (w // 3, h // 3)), cv2.resize(fp, (w // 3, h // 3))]))
    pf = sorted(psnr_fora)
    dd = sorted(dif_dentro)
    res.update({
        'foraPsnrMin': round(pf[0][0], 2) if pf else None, 'foraPsnrMinFrame': pf[0][1] if pf else None,
        'foraPsnrP5': round(pf[len(pf) // 20][0], 2) if pf else None,
        'foraFramesAbaixoDe40': sum(1 for v, _ in pf if v < 40),
        'dentroDifMin': round(dd[0][0], 2) if dd else None, 'dentroDifMinFrame': dd[0][1] if dd else None,
        'dentroFramesIguaisAoCampeao': piscando[:50], 'dentroFramesIguaisTotal': len(piscando),
        'framesNaTrilha': len(dd), 'framesSemUmRosto': rostos_ruins[:50], 'framesSemUmRostoTotal': len(rostos_ruins),
    })
    res['ok'] = bool(res['grade'] and res['audioIgual'] and res['foraFramesAbaixoDe40'] == 0
                     and res['dentroFramesIguaisTotal'] == 0 and res['framesSemUmRostoTotal'] == 0)
    if a.folha and folha:
        linhas = [np.hstack(folha[k:k + 4] + [np.zeros_like(folha[0])] * (4 - len(folha[k:k + 4]))) for k in range(0, len(folha), 4)]
        cv2.imwrite(a.folha, np.vstack(linhas))
        res['folha'] = a.folha
    print(json.dumps(res))


# ───────────── gancho escrito (NEW_HOOKS, hookMode TEXT) ─────────────
def cmd_gancho(a):
    pc, pp = probe(a.campeao), probe(a.peca)
    caixa = rect(a.caixa)
    # margem de 2 px: em yuv420p o croma é por bloco 2x2, então pintar a caixa mexe na linha/coluna vizinha
    m = a.margem
    caixa = {'x': max(0, caixa['x'] - m), 'y': max(0, caixa['y'] - m), 'w': caixa['w'] + 2 * m, 'h': caixa['h'] + 2 * m}
    w, h = pc['width'], pc['height']
    res = {'campeao': pc, 'peca': pp, 'grade': all(pc[k] == pp[k] for k in ('width', 'height', 'fps', 'frames'))}
    res['audioMd5'] = {'campeao': md5_audio(a.campeao), 'peca': md5_audio(a.peca)}
    res['audioIgual'] = res['audioMd5']['campeao'] == res['audioMd5']['peca']
    if not res['grade']:
        res['ok'] = False
        print(json.dumps(res))
        return
    fora, md5_iguais, dentro_igual = [], 0, []
    hc, hp = hashlib.md5(), hashlib.md5()
    for i, (fc, fp) in enumerate(zip(frames(a.campeao, w, h), frames(a.peca, w, h))):
        mask = np.ones((h, w), bool)
        if i < a.ate_frame:
            mask[caixa['y']:caixa['y'] + caixa['h'], caixa['x']:caixa['x'] + caixa['w']] = False
            d = float(np.mean(np.abs(crop(fc, caixa).astype(np.int16) - crop(fp, caixa).astype(np.int16))))
            if d < a.limiar_diferente:
                dentro_igual.append(i)
        fora.append((psnr(fc[mask], fp[mask]), i))
        if hashlib.md5(fc[mask].tobytes()).digest() == hashlib.md5(fp[mask].tobytes()).digest():
            md5_iguais += 1
        # corpo = tudo fora da caixa do texto do gancho (a headline fixa troca no intervalo inteiro dela: --ate-frame)
        hc.update(fc[mask].tobytes())
        hp.update(fp[mask].tobytes())
    fs = sorted(fora)
    res.update({
        'foraPsnrMin': round(fs[0][0], 2), 'foraPsnrMinFrame': fs[0][1], 'foraFramesAbaixoDe40': sum(1 for v, _ in fs if v < 40),
        'framesForaDaCaixaMd5Iguais': md5_iguais, 'frames': len(fs),
        'corpoMd5': {'campeao': hc.hexdigest(), 'peca': hp.hexdigest()},
        'corpoMd5Igual': hc.hexdigest() == hp.hexdigest(),
        'ganchoFramesSemMudanca': dentro_igual[:50], 'ganchoFramesSemMudancaTotal': len(dentro_igual),
    })
    res['ok'] = bool(res['grade'] and res['audioIgual'] and res['foraFramesAbaixoDe40'] == 0 and not dentro_igual)
    print(json.dumps(res))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('rostos')
    r.add_argument('video')
    r.add_argument('--fps', type=float, default=5)
    r.add_argument('--score', type=float, default=0.8)
    r.add_argument('--regiao')
    r.add_argument('--detalhe', action='store_true')
    p = sub.add_parser('peca')
    p.add_argument('--campeao', required=True)
    p.add_argument('--peca', required=True)
    p.add_argument('--trilha', required=True)
    p.add_argument('--excluir')
    p.add_argument('--folha')
    p.add_argument('--limiar-diferente', type=float, default=6.0)
    p.add_argument('--forcar', action='store_true', help='compara os frames em comum mesmo com a grade diferente (ok continua false)')
    g = sub.add_parser('gancho')
    g.add_argument('--campeao', required=True)
    g.add_argument('--peca', required=True)
    g.add_argument('--caixa', required=True)
    g.add_argument('--ate-frame', type=int, required=True)
    g.add_argument('--limiar-diferente', type=float, default=3.0)
    g.add_argument('--margem', type=int, default=2)
    a = ap.parse_args()
    {'rostos': cmd_rostos, 'peca': cmd_peca, 'gancho': cmd_gancho}[a.cmd](a)


if __name__ == '__main__':
    main()
