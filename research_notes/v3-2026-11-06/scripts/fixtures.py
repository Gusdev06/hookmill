"""V3 (troca-texto §16.6): campeões sintéticos com os pixels reais da S4, como na G0/V2. Os mp4 da S4 só existem no Mac.
Caixa: mediana da caixa (caixa-0X-med.png) colada sobre um fundo real que se mexe (quadro do solto, panorâmica lenta +
ruído), presente em [0, fim) e ausente depois. Solto: quadro original do solto + ruído em [0, 161); depois, o mesmo quadro
sem o texto (TELEA na máscara da S4). Áudio: seno + ruído rosa em AAC, para provar duração e conteúdo.
Uso: python fixtures.py <saida-dir>"""
import os, subprocess, sys
import cv2, numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RN = os.path.normpath(os.path.join(AQUI, '..', '..'))
S4 = os.path.join(RN, 's4-demo-2026-11-06')
G0 = os.path.join(RN, 'g0-2026-11-06')
FPS = 30
CASOS = {  # nome: (W, H, caixa x, y, fim do intervalo, total de quadros)
    'c02': (716, 1278, 0, 0, 198, 258),
    'c05': (720, 1280, 0, 586, 191, 251),
    'c06': (720, 960, 0, 529, 335, 395),
}


def escrever(nome, W, H, quadros, saida):
    dst = os.path.join(saida, f'{nome}.mp4')
    n = len(quadros)
    p = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-f', 'lavfi', '-i', f'sine=frequency=330:duration={n / FPS}', '-f', 'lavfi', '-i', f'anoisesrc=c=pink:a=0.05:d={n / FPS}:r=44100',
                          '-filter_complex', '[1:a][2:a]amix=inputs=2:duration=first[a]', '-map', '0:v', '-map', '[a]',
                          '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709',
                          '-color_trc', 'bt709', '-color_range', 'tv', '-c:a', 'aac', '-b:a', '128k', '-shortest', dst], stdin=subprocess.PIPE)
    for q in quadros:
        p.stdin.write(q.tobytes())
    p.stdin.close()
    assert p.wait() == 0, nome
    return dst


def ruido(rng, q, s=2.0):
    return np.clip(q.astype(np.float32) + rng.normal(0, s, q.shape), 0, 255).astype(np.uint8)


def main(saida, so=None):
    os.makedirs(saida, exist_ok=True)
    rng = np.random.default_rng(7)
    foto = cv2.imread(os.path.join(G0, 'ref', 'solto-original-quadro.png'))
    for nome, (W, H, bx, by, fim, n) in CASOS.items():
        if so and nome not in so:
            continue
        med = cv2.imread(os.path.join(S4, 'quadros', f'caixa-{nome[1:]}-med.png'))
        # 06: a caixa vinho é escura como a foto; com a foto crua, a borda da caixa some na cena e a medida acha a caixa
        # errada (chapada p90 31 > 30). Fundo clareado só aqui: é artefato da fixture, não do vídeo real
        fundo = cv2.convertScaleAbs(foto, alpha=0.6, beta=110) if nome == 'c06' else foto
        grande = cv2.resize(fundo, (int(W * 1.15), int(H * 1.15)), interpolation=cv2.INTER_CUBIC)
        qs = []
        for k in range(n):
            dx = int(round((grande.shape[1] - W) * k / n)); dy = int(round((grande.shape[0] - H) * 0.5 * k / n))
            q = ruido(rng, grande[dy:dy + H, dx:dx + W].copy())
            if k < fim:
                q[by:by + med.shape[0], bx:bx + med.shape[1]] = med
            qs.append(q)
        print(escrever(nome, W, H, qs, saida))
    if so and 'solto' not in so:
        return
    # solto
    masc = cv2.imread(os.path.join(S4, 'medidas', 'mascara-solta.png'), 0)
    masc = cv2.dilate((masc > 0).astype(np.uint8) * 255, np.ones((5, 5), np.uint8))
    limpo = cv2.inpaint(foto, masc, 5, cv2.INPAINT_TELEA)
    qs = [ruido(rng, foto if k < 161 else limpo) for k in range(240)]
    print(escrever('solto', 464, 832, qs, saida))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2:] or None)
