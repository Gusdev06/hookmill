"""worker.py <evento.json> <resultado.json> — roda 1 op da troca de texto em processo próprio (troca-texto §16). Dono: video.

Mesmo formato no Lambda (handler.py) e no local (adaptador `local` da API, só desenvolvimento):
  evento = {v: 1, op, get: {nome: url|caminho}, put: {nome: url|caminho}, ...parâmetros da op}
  resultado = {op, ...medidas, tempos}
URLs entram e saem por GET/PUT pré-assinado; caminho absoluto = cópia local.
"""
import json, os, resource, shutil, subprocess, sys, time, urllib.request

os.environ.setdefault("OMP_NUM_THREADS", "2")
AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
VERSAO_EVENTO = 1


def baixar(url, dst):
    if url.startswith("/"):
        shutil.copy(url, dst)
        return
    with urllib.request.urlopen(url, timeout=120) as r, open(dst, "wb") as o:
        shutil.copyfileobj(r, o, 1 << 20)


def subir(src, url, tipo="application/octet-stream"):
    if url.startswith("/"):
        os.makedirs(os.path.dirname(url), exist_ok=True)
        shutil.copy(src, url)
        return
    n = os.path.getsize(src)
    with open(src, "rb") as f:
        q = urllib.request.Request(url, data=f, method="PUT", headers={"Content-Length": str(n), "Content-Type": tipo})
        urllib.request.urlopen(q, timeout=300).read()


SAIDAS = {"placa": ("placa.mp4", "video/mp4")}


def rodar(ev):
    if ev.get("v", 1) != VERSAO_EVENTO:
        raise ValueError(f"versão de evento {ev.get('v')} (esperada {VERSAO_EVENTO})")
    tmp = ev.get("tmp") or "/tmp/troca-job"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    cwd = os.getcwd()
    os.chdir(tmp)
    try:
        r = {"op": ev["op"]}
        t0 = st = time.time()
        for nome, url in ev.get("get", {}).items():
            baixar(url, nome)
        r["baixar_s"] = round(time.time() - st, 2)
        st = time.time()
        op = ev["op"]
        if op == "versoes":
            import numpy, cv2, PIL
            r.update(numpy=numpy.__version__, cv2=cv2.__version__, pil=PIL.__version__,
                     ffmpeg=subprocess.check_output(["ffmpeg", "-version"]).decode().split("\n")[0])
        elif op == "sondar":
            from comum import sonda
            r.update(sonda(ev.get("url") or "video.mp4"))
        elif op == "medir_headline":
            import medir_headline as mh
            r.update(mh.medida(ev) if ev.get("fase", "medida") == "medida" else mh.regua(ev))
        elif op == "placa_headline":
            import placa_headline as ph
            r.update(ph.gerar(ev))
        elif op == "juntar":
            ps = sorted(n for n in ev.get("get", {}) if n.startswith("p"))
            # `duration` exata por pedaço (quadros ÷ fps): sem ela o concat soma a duração do contêiner (com o atraso do
            # x264) e a placa saía 10/15360 s adiantada depois do 1º pedaço; o OffthreadVideo do Remotion, que busca por
            # tempo, pegava o quadro anterior (V3 real, solto: quadro 161 da peça com o quadro 160 na máscara)
            from comum import sonda
            linhas = []
            for n in ps:
                s_ = sonda(n)
                linhas.append(f"file '{n}'\nduration {s_['n'] / s_['fps']:.9f}\n")
            open("lista.txt", "w").write("".join(linhas))
            subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "lista.txt", "-c", "copy",
                                   "-movflags", "+faststart", "placa.mp4"])
            from comum import sonda
            r["quadros"] = sonda("placa.mp4")["n"]
        elif op == "conferir":
            import conferir as cf
            r.update(cf.conferir(ev))
        else:
            raise ValueError(f"op desconhecida: {op}")
        r["op_s"] = round(time.time() - st, 2)
        st = time.time()
        for nome, url in ev.get("put", {}).items():
            arq, tipo = SAIDAS[nome]
            r.setdefault("tam_saida", {})[nome] = os.path.getsize(arq)
            subir(arq, url, tipo)
        r["subir_s"] = round(time.time() - st, 2)
        r["total_s"] = round(time.time() - t0, 2)
        u, c = resource.getrusage(resource.RUSAGE_SELF), resource.getrusage(resource.RUSAGE_CHILDREN)
        r["rss_python_MB"] = round(u.ru_maxrss / (1e6 if sys.platform == "darwin" else 1e3))
        r["cpu_python_s"] = round(u.ru_utime + u.ru_stime, 1)
        r["cpu_ffmpeg_s"] = round(c.ru_utime + c.ru_stime, 1)
        return r
    finally:
        os.chdir(cwd)
        if not ev.get("manter_tmp"):
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    ev = json.load(open(sys.argv[1]))
    try:
        res = rodar(ev)
        res["ok_op"] = True
    except Exception as e:  # o erro volta como JSON: o adaptador decide repetir ou falhar
        import traceback
        res = {"op": ev.get("op"), "ok_op": False, "erro": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}
    json.dump(res, open(sys.argv[2], "w"), ensure_ascii=False)
