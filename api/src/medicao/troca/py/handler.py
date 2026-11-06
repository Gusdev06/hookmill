"""handler.py — função `hookmill-legenda` (troca-texto §15.6.4, §16). Dono: video.

A op roda em subprocesso (worker.py), para o pico de memória não herdar invocação anterior; aqui só mede a árvore de
processos e devolve o JSON do worker com tempo, pico de RSS e se o ambiente era frio.
"""
import json, os, subprocess, sys, threading, time

AQUI = os.path.dirname(os.path.abspath(__file__))


def rss_arvore(raiz):
    """Soma de VmRSS (MB) do processo e de todos os descendentes, lendo /proc."""
    pais = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                pais[int(d)] = int(open(f"/proc/{d}/stat").read().rsplit(")", 1)[1].split()[1])
            except Exception:
                pass
    vivos, mudou = {raiz}, True
    while mudou:
        mudou = False
        for p, pp in pais.items():
            if pp in vivos and p not in vivos:
                vivos.add(p)
                mudou = True
    t = 0
    for p in vivos:
        try:
            for l in open(f"/proc/{p}/status"):
                if l.startswith("VmRSS"):
                    t += int(l.split()[1])
                    break
        except Exception:
            pass
    return t / 1024


def handler(ev, ctx):
    t0 = time.time()
    os.makedirs("/tmp/ctl", exist_ok=True)
    ej, rj = "/tmp/ctl/ev.json", "/tmp/ctl/res.json"
    if os.path.exists(rj):
        os.remove(rj)
    json.dump(ev, open(ej, "w"))
    marca = "/tmp/ctl/iniciado"
    frio = not os.path.exists(marca)
    open(marca, "w").close()
    p = subprocess.Popen([sys.executable, os.path.join(AQUI, "worker.py"), ej, rj], stderr=subprocess.PIPE)
    pico, pare = [0.0], threading.Event()

    def amostra():
        while not pare.wait(0.5):
            try:
                pico[0] = max(pico[0], rss_arvore(p.pid))
            except Exception:
                pass
    threading.Thread(target=amostra, daemon=True).start()
    err = p.stderr.read().decode(errors="replace")[-1500:]
    code = p.wait()
    pare.set()
    # `proc_ok`, não `ok`: a medida tem o próprio `ok` (vídeo reprovado), que não é falha da função
    r = {"proc_ok": code == 0, "exit": code, "frio": frio, "pico_arvore_MB": round(pico[0]), "funcao_s": round(time.time() - t0, 2)}
    if os.path.exists(rj):
        r.update(json.load(open(rj)))
    if code != 0:
        r["erro"] = err
    return r
