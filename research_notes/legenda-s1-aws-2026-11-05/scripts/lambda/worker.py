"""worker.py <evento.json> <resultado.json> — roda uma op em processo próprio, para o pico de memória não herdar invocação anterior."""
import json, os, resource, shutil, subprocess, sys, time, urllib.request
os.environ.setdefault("OMP_NUM_THREADS", "2")
def baixar(url, dst):
    if url.startswith("/"): shutil.copy(url, dst); return
    with urllib.request.urlopen(url, timeout=120) as r, open(dst, "wb") as o: shutil.copyfileobj(r, o, 1 << 20)
def subir(src, url, tipo="application/octet-stream"):
    if url.startswith("/"): shutil.copy(src, url); return
    n = os.path.getsize(src)
    with open(src, "rb") as f:
        q = urllib.request.Request(url, data=f, method="PUT", headers={"Content-Length": str(n), "Content-Type": tipo})
        urllib.request.urlopen(q, timeout=300).read()

def main(ev, res_path):
    tmp = ev.get("tmp", "/tmp/job"); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp); os.chdir(tmp)
    r = {"op": ev["op"]}; t0 = time.time(); ge = ev.get("get", {}); pu = ev.get("put", {})
    st = time.time()
    for nome, url in ge.items(): baixar(url, nome)
    r["baixar_s"] = round(time.time() - st, 2); st = time.time()
    import numpy as np, cv2
    r["import_s"] = round(time.time() - st, 2); r["cv2"] = cv2.__version__; r["cv_threads"] = cv2.getNumThreads(); r["ncpu"] = os.cpu_count()
    st = time.time(); op = ev["op"]
    if op == "versoes":
        import PIL; r["pil"] = PIL.__version__; r["numpy"] = np.__version__; r["ffmpeg"] = subprocess.check_output(["ffmpeg", "-version"]).decode().split("\n")[0]
    elif op == "hash":
        # diagnóstico: os quadros que o ffmpeg entrega aqui são iguais aos do Mac? E o fluxo DIS?
        import hashlib; from detectar import frames, probe
        W, H = probe("video.mp4"); hs = []; prev = None; fl = []
        DIS = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        for t, f in enumerate(frames("video.mp4", W, H, qtd=120)):
            if t % 10 == 0: hs.append(hashlib.md5(f.tobytes()).hexdigest()[:10])
            g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
            if t in (10, 11):
                if prev is not None: fl.append(hashlib.md5(DIS.calc(g, prev, None).tobytes()).hexdigest()[:10])
                prev = g
        r["hash"] = hs; r["fluxo"] = fl
    elif op == "detectar":
        from detectar import detectar
        d, info = detectar("video.mp4", ev.get("caixa", False), ev.get("faixa")); np.savez_compressed("d.npz", **d); r.update(info)
    elif op == "ajustar":
        from ajustar_rapido import ajustar, iou_medio
        e, T = ajustar("video.mp4", "d.npz", "w.json"); json.dump(e, open("estilo.json", "w"), ensure_ascii=False); r["T"] = T; r["estilo"] = {k: e[k] for k in ("fonte", "tam", "tr", "esp", "stroke", "sombra", "base", "cx", "branco", "amarelo")}
    elif op == "bench_telea":
        from pegada import Legenda; from placa_s1 import bench_telea
        L = Legenda("d.npz", json.load(open("estilo.json")), ev["caixa"]); r.update(bench_telea("video.mp4", L))
    elif op == "placa":
        from pegada import Legenda; from placa_s1 import gerar
        L = Legenda("d.npz", json.load(open("estilo.json")), ev["caixa"])
        r.update(gerar("video.mp4", L, "placa.mp4", ev.get("ini", 0), ev.get("fim"), ev.get("ctx", 0), ev.get("roi", False), "m.npz" if "m" in pu else None))
    elif op == "escrever":
        from pegada import Legenda; from escrever_s1 import escrever, frases_auto
        L = Legenda("d.npz", json.load(open("estilo.json")), ev["caixa"])
        if ev.get("v") in ("02", "05", "13"):
            from textos import FRASES, T as TEX; fr, txt = FRASES[ev["v"]], TEX[ev["v"]]["tr"]
        else: fr, txt = frases_auto("w.json")
        r.update(escrever("placa.mp4", "video.mp4", L, "w.json", fr, txt, "inteiro.mp4", "m.npz" if "m.npz" in ge else None))
    elif op == "juntar":
        ps = sorted(n for n in ge if n.startswith("p"))
        open("lista.txt", "w").write("".join(f"file '{n}'\n" for n in ps))
        subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "lista.txt", "-c", "copy", "placa.mp4"])
        r["quadros"] = int(subprocess.check_output(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", "placa.mp4"]).decode().strip().split(",")[0])
    else: raise ValueError(op)
    r["op_s"] = round(time.time() - st, 2); st = time.time()
    for nome, url in pu.items():
        arq = {"d": "d.npz", "estilo": "estilo.json", "placa": "placa.mp4", "m": "m.npz", "inteiro": "inteiro.mp4"}[nome]
        r.setdefault("tam_saida", {})[nome] = os.path.getsize(arq); subir(arq, url)
    r["subir_s"] = round(time.time() - st, 2); r["total_s"] = round(time.time() - t0, 2)
    u = resource.getrusage(resource.RUSAGE_SELF); c = resource.getrusage(resource.RUSAGE_CHILDREN)
    r["rss_python_MB"] = round(u.ru_maxrss / (1e6 if sys.platform == "darwin" else 1e3)); r["cpu_python_s"] = round(u.ru_utime + u.ru_stime, 1); r["cpu_ffmpeg_s"] = round(c.ru_utime + c.ru_stime, 1)
    json.dump(r, open(res_path, "w"))

if __name__ == "__main__":
    main(json.load(open(sys.argv[1])), sys.argv[2])
