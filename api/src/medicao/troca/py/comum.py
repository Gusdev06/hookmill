"""Utilitários da troca de texto (troca-texto-queimado-v1 §15.6.6 e §16). Dono: video.

Decodifica e codifica pelo ffmpeg com a matriz de cor da origem, nunca por cv2.VideoCapture (desloca 1-3 níveis).
Sem estado global: cada op recebe caminhos e devolve dicionários serializáveis em JSON.
"""
import base64, io, json, os, subprocess
import numpy as np
import cv2

FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH", "ffprobe")
MATRIZES = ("bt709", "smpte170m", "bt470bg")


def sonda(caminho):
    """Largura, altura, fps, nº de quadros (pacotes contados) e cor do 1º fluxo de vídeo."""
    out = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries",
                          "stream=width,height,avg_frame_rate,r_frame_rate,nb_read_packets,color_space,color_range,color_primaries,color_transfer",
                          "-of", "json", caminho], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"ffprobe {out.returncode}: {out.stderr.strip()[-400:]}")
    out = out.stdout
    s = json.loads(out)["streams"][0]
    num, den = (s.get("avg_frame_rate") or s.get("r_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    return dict(w=int(s["width"]), h=int(s["height"]), fps=fps, n=int(s.get("nb_read_packets") or 0),
                matriz=s.get("color_space") if s.get("color_space") in MATRIZES else None,
                faixa="pc" if s.get("color_range") == "pc" else "tv",
                primarias=s.get("color_primaries"), transferencia=s.get("color_transfer"))


def matriz_de(info):
    """§15.6.6 item 4: origem `unknown` tenta bt709; o chamador mede e troca por smpte170m se precisar."""
    return info["matriz"] or "bt709"


def quadros(caminho, info, ini=0, n=None, roi=None, cinza=False, mat=None):
    """Gera quadros BGR (ou cinza) de [ini, ini+n). Com `roi` (x, y, w, h), só a faixa fica em memória."""
    mat = mat or matriz_de(info)
    W, H = info["w"], info["h"]
    vf = []
    if ini:
        vf.append(f"trim=start_frame={ini},setpts=PTS-STARTPTS")
    vf.append(f"scale=in_color_matrix={mat}:in_range={info['faixa']}:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24")
    if roi:
        # recorte DEPOIS do bgr24: em yuv420p o crop arredonda posição/altura ímpar e os bytes escorregam entre quadros
        x, y, w, h = roi
        vf.append(f"crop={w}:{h}:{x}:{y}")
        W, H = w, h
    cmd = [FFMPEG, "-v", "error", "-nostdin", "-i", caminho, "-vf", ",".join(vf)]
    if n:
        cmd += ["-frames:v", str(n)]
    # passthrough: 1 quadro decodificado = 1 quadro aqui. Sem ele a ffmpeg 7 da função (G1, 06/11) duplicava/descartava
    # quadros pelo tempo no solto real (trim a partir do 135: 358 quadros em vez de 429; placa com 494 de 564)
    cmd += ["-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    # stderr calado: quem lê pode parar no meio (o texto saiu), e o ffmpeg reclama do pipe fechado
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    tam = W * H * 3
    try:
        while True:
            b = p.stdout.read(tam)
            if len(b) < tam:
                break
            f = np.frombuffer(b, np.uint8).reshape(H, W, 3)
            yield cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if cinza else f.copy()
    finally:
        p.stdout.close()
        p.kill()
        p.wait()


def codificador(caminho, w, h, fps, mat="bt709", faixa="tv", crf="16", preset="medium", gop_fechado=True):
    """Recebe BGR por stdin. Grava a cor da origem (out_color_matrix e tags), como a §15.6.6 item 3 pede."""
    prim = "bt709" if mat == "bt709" else "smpte170m"
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
            "-r", f"{fps:.6f}", "-i", "-",
            "-vf", f"scale=out_color_matrix={mat}:out_range={faixa}:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p",
            "-c:v", "libx264", "-crf", crf, "-preset", preset, "-pix_fmt", "yuv420p"]
    if gop_fechado:
        args += ["-x264-params", "open-gop=0"]
    args += ["-colorspace", mat, "-color_primaries", prim, "-color_trc", prim, "-color_range", faixa,
             "-movflags", "+faststart", caminho]
    return subprocess.Popen(args, stdin=subprocess.PIPE)


def png_uri(img, max_bytes=None):
    """PNG (BGR ou BGRA) em data URI. Com `max_bytes`, reduz pela metade até caber."""
    while True:
        ok, b = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 9])
        assert ok
        uri = "data:image/png;base64," + base64.b64encode(b.tobytes()).decode()
        if max_bytes is None or len(uri) <= max_bytes or min(img.shape[:2]) <= 4:
            return uri
        img = cv2.resize(img, (max(2, img.shape[1] // 2), max(2, img.shape[0] // 2)), interpolation=cv2.INTER_AREA)


def de_uri(uri, flags=cv2.IMREAD_UNCHANGED):
    b = base64.b64decode(uri.split(",", 1)[1])
    return cv2.imdecode(np.frombuffer(b, np.uint8), flags)


def hexa(bgr):
    b, g, r = [int(round(float(x))) for x in bgr[:3]]
    return f"#{r:02x}{g:02x}{b:02x}"


def impar(x):
    x = int(round(x))
    return x if x % 2 else x + 1


def r2(x, n=2):
    return float(round(float(x), n))
