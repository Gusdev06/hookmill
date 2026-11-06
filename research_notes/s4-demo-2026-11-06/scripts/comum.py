"""Utilitários da S4: decodificar/codificar com a matriz certa (§15.6.6), nunca cv2.VideoCapture."""
import subprocess, numpy as np, os, json
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def P(*a): return os.path.join(RAIZ, *a)
def info(p):
    s = json.loads(subprocess.run(["ffprobe","-v","error","-select_streams","v:0","-count_packets","-show_entries","stream=width,height,color_space,color_range,nb_read_packets","-of","json",p],capture_output=True,text=True).stdout)["streams"][0]
    return s
def matriz(p):
    c = info(p).get("color_space","unknown")
    return c if c in ("bt709","smpte170m","bt470bg") else "bt709"
def frames(p, w, h, ini=0, n=None, mat=None, roi=None):
    """BGR por quadro. ini/n em quadros; decodifica desde o início do arquivo só o necessário."""
    mat = mat or matriz(p)
    vf = f"scale=in_color_matrix={mat}:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24"
    sel = []
    if ini or n: sel = ["-vf_placeholder"]
    if ini: vf = f"trim=start_frame={ini},setpts=PTS-STARTPTS," + vf
    cmd = ["ffmpeg","-v","error","-i",p,"-vf",vf]
    if n: cmd += ["-frames:v",str(n)]
    cmd += ["-f","rawvideo","-pix_fmt","bgr24","-"]
    d = subprocess.Popen(cmd, stdout=subprocess.PIPE); sz = w*h*3
    try:
        while True:
            b = d.stdout.read(sz)
            if len(b) < sz: break
            yield np.frombuffer(b, np.uint8).reshape(h, w, 3).copy()
    finally:
        d.stdout.close(); d.kill(); d.wait()
def encoder(path, w, h, mat="bt709", crf="16", preset="slow", audio=None):
    a = ["-i",audio,"-map","0:v","-map","1:a?","-c:a","copy"] if audio else []
    return subprocess.Popen(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","rawvideo","-pix_fmt","bgr24","-s",f"{w}x{h}","-r","30","-i","-",*a,
      "-vf",f"scale=out_color_matrix={mat}:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p","-c:v","libx264","-crf",crf,"-preset",preset,"-pix_fmt","yuv420p",
      "-colorspace",mat,"-color_primaries",mat if mat=="bt709" else "smpte170m","-color_trc",mat if mat=="bt709" else "smpte170m","-color_range","tv","-movflags","+faststart",path],stdin=subprocess.PIPE)
