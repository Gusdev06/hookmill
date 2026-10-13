"""Fixtures dos 2 criativos "reais" do aceite do editor F1 (docs/contratos/editor-v1.md §3.4):
- SCENES: 3 cenas Kling (real-kling-1..3.mp4, lote-5-avatares/m1-loira-29 do mentoria-spy);
- LIPSYNC take: 1 take Pruna de 31 s (real-take.mp4, zap-working-late-etnias/clipes/v3-asiatico) fatiado em 4 cenas (clipStartSec).
Transcreve com mlx-whisper local (sem custo) e grava public/fixtures/reais.json.
Uso: <python com mlx_whisper> scripts/transcrever-reais.py"""
import json, subprocess, pathlib
import mlx_whisper

DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "fixtures"
MODEL = "mlx-community/whisper-large-v3-turbo"

def dur(p):
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", str(p)], text=True)
    return min(float(l.split(",")[1]) for l in out.strip().splitlines() if l.split(",")[1] not in ("", "N/A"))

def words(p, lang):
    r = mlx_whisper.transcribe(str(p), path_or_hf_repo=MODEL, word_timestamps=True, language=lang)
    return [{"word": w["word"].strip(), "startSec": round(w["start"], 3), "endSec": round(w["end"], 3)}
            for s in r["segments"] for w in s.get("words", []) if w["word"].strip()]

scenes = []
for i in (1, 2, 3):
    p = DIR / f"real-kling-{i}.mp4"
    scenes.append({"clipUrl": f"fixtures/real-kling-{i}.mp4", "durationSec": round(dur(p), 3), "words": words(p, None)})

take = DIR / "real-take.mp4"
total = dur(take)
ws = words(take, None)
cortes = [0.0, 7.5, 15.0, 23.0, round(total, 3)]
fatias = []
for a, b in zip(cortes, cortes[1:]):
    fatias.append({"clipUrl": "fixtures/real-take.mp4", "durationSec": round(b - a, 3), "clipStartSec": a,
                   "words": [{"word": w["word"], "startSec": round(w["startSec"] - a, 3), "endSec": round(w["endSec"] - a, 3)}
                             for w in ws if a <= w["startSec"] < b]})

(DIR / "reais.json").write_text(json.dumps({"scenes": scenes, "take": fatias}, ensure_ascii=False, indent=1))
for s in scenes + fatias:
    print(s["clipUrl"], s.get("clipStartSec", 0), s["durationSec"], " ".join(w["word"] for w in s["words"]))
