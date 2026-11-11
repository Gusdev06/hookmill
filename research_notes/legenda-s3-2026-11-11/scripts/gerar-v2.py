#!/usr/bin/env python3
"""S3 v2: para cada vídeo com placa, 3 versões SEM Lambda: -sem (placa pura + áudio), -idioma (legenda traduzida à mão), -cores (mesmo texto, cores trocadas).
Uso: python3 gerar-v2.py <pasta-s3>   (precisa de paginas.json e scripts/traducoes.txt; reaproveita saida-lote*/NN-{placa.mp4,props.json})"""
import json, os, re, shutil, subprocess, sys
S3 = os.path.abspath(sys.argv[1]); VIDEO = os.path.abspath(os.path.join(S3, "..", "..", "video"))
V = os.path.join(S3, "videos"); pub = os.path.join(VIDEO, "public", "f2-tmp"); os.makedirs(pub, exist_ok=True)
PAG = json.load(open(os.path.join(S3, "paginas.json")))
TR = {}
for l in open(os.path.join(S3, "scripts", "traducoes.txt")):
    if l.startswith("#") or not l.strip(): continue
    i, k, t = l.rstrip("\n").split("|", 2); TR.setdefault(i, {})[int(k)] = t
limpa = lambda w: re.sub(r"[^\w$%]", "", w, flags=re.U).upper()
CORES = {"texto": "#FFE600", "traco": "#000000", "destaque": "#00E5FF"}
vf = "scale='min(720,iw)':-2"
def render(props, nome, base):
    pj = os.path.join(S3, f"_{nome}-props.json"); json.dump(props, open(pj, "w"))
    mudo = os.path.join(S3, f"_{nome}-mudo.mp4")
    subprocess.check_call(["npx", "remotion", "render", "src/index.ts", "LegendaSwap", mudo, f"--props={pj}", "--codec=h264", "--crf=20", "--log=error"], cwd=VIDEO)
    return mudo
def mux(mudo, orig, out):
    subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", mudo, "-i", orig, "-map", "0:v", "-map", "1:a?", "-vf", vf, "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-shortest", out])
    if os.path.basename(mudo).startswith("_"): os.remove(mudo)   # só apaga o intermediário; NUNCA a placa (bug de 11/11: apaguei as 12 placas)
res = {}
for id_, meta in sorted(PAG.items()):
    try:
        lote = meta["lote"]; props = json.load(open(os.path.join(S3, lote, f"{id_}-props.json"))); orig = os.path.join(V, f"{id_}-original.mp4")
        placa = os.path.join(V, f"{id_}-sem.mp4")   # as placas cruas foram apagadas por engano; o -sem (placa + áudio, H.264 crf 23) é a base
        # 1) sem legenda
        out1 = os.path.join(V, f"{id_}-sem.mp4")
        if not os.path.exists(out1): raise RuntimeError('sem o -sem.mp4')
        shutil.copy(placa, os.path.join(pub, f"{id_}-placa.mp4")); props["baseVideoUrl"] = f"f2-tmp/{id_}-placa.mp4"
        # 2) outro idioma
        out2 = os.path.join(V, f"{id_}-idioma.mp4"); faltou = []
        if not os.path.exists(out2):
            fps = props["canvas"]["fps"]; idx_tx = [i for i, t in enumerate(props["trechos"]) if t["texto"].strip()]
            nt, nw = [], []
            for k, (i, pg) in enumerate(zip(idx_tx, meta["pages"])):
                t = dict(props["trechos"][i]); novo = TR.get(id_, {}).get(i)
                if novo is None: faltou.append(i); novo = t["texto"]
                toks = [limpa(w) for w in novo.split() if limpa(w)]
                t["texto"] = " ".join(toks); nt.append(t)
                t0 = pg["t0"] if pg["t0"] is not None else pg["ini"] / fps
                t1 = (pg["t1"] if pg["t1"] is not None else t0) + 0.35
                for j, w in enumerate(toks):
                    s = t0 + j * (t1 - t0) / max(1, len(toks)); nw.append({"word": w, "startSec": round(s, 3), "endSec": round(s + (t1 - t0) / max(1, len(toks)), 3)})
            p2 = json.loads(json.dumps(props)); p2["trechos"] = nt + [t for i, t in enumerate(props["trechos"]) if i not in idx_tx]; p2["words"] = nw; p2["atrasoSec"] = 0
            mux(render(p2, f"{id_}-idioma", None), orig, out2)
        # 3) cores
        out3 = os.path.join(V, f"{id_}-cores.mp4")
        if not os.path.exists(out3):
            p3 = json.loads(json.dumps(props)); e = p3["estilo"]; e["corTexto"], e["corTraco"], e["corDestaque"] = CORES["texto"], CORES["traco"], CORES["destaque"]
            mux(render(p3, f"{id_}-cores", None), orig, out3)
        os.remove(os.path.join(pub, f"{id_}-placa.mp4"))   # só a cópia temporária no public do Remotion
        res[id_] = {"ok": True, "sem_traducao_em": faltou, "estilo": {k: props["estilo"][k] for k in ("fontId", "corTexto", "corDestaque", "corTraco")}}
    except Exception as ex:
        res[id_] = {"ok": False, "erro": str(ex)[:300]}
    print(id_, res[id_], flush=True)
    json.dump(res, open(os.path.join(S3, "v2-resultado.json"), "w"), indent=1, ensure_ascii=False)
shutil.rmtree(pub, ignore_errors=True)
print("FIM")
