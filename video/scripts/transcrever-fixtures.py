"""Transcreve as cenas de teste localmente (mlx-whisper, sem custo) e grava
public/fixtures/amostra.json no formato de RenderInput.scenes (word, startSec, endSec).
Uso: <python com mlx_whisper> scripts/transcrever-fixtures.py cena-1.mp4 cena-2.mp4 ...
Em produção as palavras vêm do TRANSCRIBE da maquina-ia (parseWords); isto é só pra fixture."""
import json, subprocess, sys, pathlib
import mlx_whisper

DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "fixtures"
MODEL = "mlx-community/whisper-large-v3-turbo"
LANG = "en"  # idioma das cenas de teste

def dur(path):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration",
                                   "-of", "csv=p=0", str(path)], text=True)
    d = {}
    for line in out.strip().splitlines():
        kind, val = line.split(",")
        d[kind] = float(val)
    return min(d.values())

scenes = []
for name in sys.argv[1:]:
    p = DIR / name
    r = mlx_whisper.transcribe(str(p), path_or_hf_repo=MODEL, word_timestamps=True, language=LANG)
    words = [{"word": w["word"].strip(), "startSec": round(w["start"], 3), "endSec": round(w["end"], 3)}
             for s in r["segments"] for w in s.get("words", []) if w["word"].strip()]
    scenes.append({"clipUrl": f"fixtures/{name}", "durationSec": round(dur(p), 3), "words": words})
    print(name, scenes[-1]["durationSec"], " ".join(w["word"] for w in words))

(DIR / "amostra.json").write_text(json.dumps({"scenes": scenes}, ensure_ascii=False, indent=1))
