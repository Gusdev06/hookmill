#!/usr/bin/env python3
"""Monta a S3: lê as saídas dos lotes (saida-lote*/resumo.json), renderiza a troca de cada vídeo com placa (render-troca.py) e escreve manifesto.json + index.html.
Uso: python3 montar-s3.py <pasta-s3> <pasta-com-in-e-words>   (a pasta tem in/NN.mp4 e NN-words.json)"""
import glob, json, os, subprocess, sys
S3 = os.path.abspath(sys.argv[1]); ENT = os.path.abspath(sys.argv[2]); AQUI = os.path.dirname(os.path.abspath(__file__))
M = []
for rs in sorted(glob.glob(os.path.join(S3, "saida-lote*", "resumo.json"))):
    lote = os.path.basename(os.path.dirname(rs)); R = json.load(open(rs))
    for id_, v in sorted(R.items()):
        if "erro" in v and "veredito" not in v:
            M.append({"id": id_, "rotulo": f"vídeo {id_}", "veredito": "erro", "motivo": v["erro"], "original": f"videos/{id_}-original.mp4", "troca": None}); continue
        p = v.get("placa"); troca = None; motivo = None
        if p and os.path.exists(os.path.join(S3, lote, f"{id_}-placa.mp4")):
            if not os.path.exists(os.path.join(S3, "videos", f"{id_}-troca.mp4")):
                subprocess.check_call([sys.executable, os.path.join(AQUI, "render-troca.py"), S3, id_, os.path.join(ENT, "in", f"{id_}.mp4"), os.path.join(ENT, f"{id_}-words.json"), lote])
            troca = f"videos/{id_}-troca.mp4"
        else:
            motivo = f"não gerado ({v['veredito']['reason']}: {p['reason'] if p else 'sem placa'})" if p else f"não gerado: {v['veredito']['reason']}"
            if not os.path.exists(os.path.join(S3, "videos", f"{id_}-original.mp4")):
                os.makedirs(os.path.join(S3, "videos"), exist_ok=True)
                subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(ENT, "in", f"{id_}.mp4"), "-vf", "scale='min(720,iw)':-2", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", os.path.join(S3, "videos", f"{id_}-original.mp4")])
        idioma = json.load(open(os.path.join(ENT, f"{id_}-words.json"))).get("idioma", "")
        M.append({"id": id_, "rotulo": f"vídeo {id_}", "idioma": idioma, "original": f"videos/{id_}-original.mp4", "troca": troca, "motivo": motivo,
                  "veredito": ("swap" if v["veredito"]["swap"] else f"sem swap: {v['veredito']['reason']}") + (f" · placa {p['status']}" + (f" ({p['reason']})" if p['reason'] else "") if p else ""),
                  "metricas": (p or {}).get("metrics"), "gates": v["veredito"]["gates"]})
json.dump(M, open(os.path.join(S3, "manifesto.json"), "w"), indent=1, ensure_ascii=False)
subprocess.check_call([sys.executable, os.path.join(AQUI, "gerar-folha.py"), S3])
print(len(M), "vídeos;", sum(1 for m in M if m["troca"]), "com a troca")
