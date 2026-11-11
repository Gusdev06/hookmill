#!/usr/bin/env python3
"""Renderiza o vídeo 'com a legenda trocada' da S3: placa (legenda antiga apagada) + legenda nova (composição LegendaSwap do Remotion) + áudio do original.
Uso (de qualquer pasta): python3 render-troca.py <pasta-s3> <id> <video-original> <words.json> [subpasta-da-saida]
Espera em <pasta-s3>/saida/: <id>-captionTrack.json e <id>-placa.mp4 (baixados pelo s1b-lambda.ts). Escreve <pasta-s3>/videos/<id>-troca.mp4 e -original.mp4 (≤ 720 px de largura)."""
import json, os, shutil, subprocess, sys
S3, id_, orig, words_json = sys.argv[1:5]
S3 = os.path.abspath(S3); orig = os.path.abspath(orig); words_json = os.path.abspath(words_json)
SAIDA = sys.argv[5] if len(sys.argv) > 5 else "saida"
VIDEO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "video"))
saida = os.path.join(S3, SAIDA); vid = os.path.join(S3, "videos"); os.makedirs(vid, exist_ok=True)
tr = json.load(open(os.path.join(saida, f"{id_}-captionTrack.json")))
w = json.load(open(words_json)); words = w["words"] if isinstance(w, dict) and "words" in w else [{"word": x["word"], "startSec": x["start"], "endSec": x["end"]} for s in w["segments"] for x in s["words"]]
info = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", orig]))["streams"][0]
pub = os.path.join(VIDEO, "public", "f2-tmp"); os.makedirs(pub, exist_ok=True)
shutil.copy(os.path.join(saida, f"{id_}-placa.mp4"), os.path.join(pub, f"{id_}-placa.mp4"))
e = tr["estilo"]
props = {"canvas": {"width": info["width"], "height": info["height"], "fps": tr["fps"], "frameCount": tr["quadros"]}, "baseVideoUrl": f"f2-tmp/{id_}-placa.mp4",
         "trechos": [{"iniFrame": t["iniFrame"], "fimFrame": t["fimFrame"], "texto": t["texto"], "herdado": t["herdado"]} for t in tr["trechos"]], "words": words, "atrasoSec": tr["atrasoSec"],
         "estilo": {k: e[k] for k in ("fontId", "tamPx", "tracking", "espaco", "strokePx", "sombra", "corTexto", "corDestaque", "corTraco", "baseY", "centroX")}}
if e.get("caixaDestaque"): props["estilo"]["caixaDestaque"] = e["caixaDestaque"]
pj = os.path.join(saida, f"{id_}-props.json"); json.dump(props, open(pj, "w"))
mudo = os.path.join(saida, f"{id_}-mudo.mp4")
subprocess.check_call(["npx", "remotion", "render", "src/index.ts", "LegendaSwap", mudo, f"--props={pj}", "--codec=h264", "--crf=20"], cwd=VIDEO)
# áudio do original no vídeo renderizado; largura máx 720 para a folha ficar leve
vf = "scale='min(720,iw)':-2"
subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", mudo, "-i", orig, "-map", "0:v", "-map", "1:a?", "-vf", vf, "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-shortest", os.path.join(vid, f"{id_}-troca.mp4")])
subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", orig, "-vf", vf, "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", os.path.join(vid, f"{id_}-original.mp4")])
os.remove(os.path.join(pub, f"{id_}-placa.mp4"))
print("ok", id_)
