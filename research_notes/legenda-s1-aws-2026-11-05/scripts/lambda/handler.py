"""handler.py — função da sonda S1. A op roda em subprocesso (worker.py); aqui só mede a árvore de processos e devolve JSON."""
import json, os, subprocess, sys, threading, time

def rss_arvore(raiz):
    """soma de VmRSS (MB) do processo e de todos os descendentes, lendo /proc"""
    pais = {}
    for d in os.listdir("/proc"):
        if d.isdigit():
            try: pais[int(d)] = int(open(f"/proc/{d}/stat").read().rsplit(")", 1)[1].split()[1])
            except Exception: pass
    vivos = {raiz}; mudou = True
    while mudou:
        mudou = False
        for p, pp in pais.items():
            if pp in vivos and p not in vivos: vivos.add(p); mudou = True
    t = 0
    for p in vivos:
        try:
            for l in open(f"/proc/{p}/status"):
                if l.startswith("VmRSS"): t += int(l.split()[1]); break
        except Exception: pass
    return t / 1024

def handler(ev, ctx):
    t0 = time.time(); os.makedirs("/tmp/ctl", exist_ok=True); ej, rj = "/tmp/ctl/ev.json", "/tmp/ctl/res.json"
    if os.path.exists(rj): os.remove(rj)
    json.dump(ev, open(ej, "w"))
    aq = "/tmp/ctl/iniciado"; frio = not os.path.exists(aq); open(aq, "w").close()
    p = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "worker.py"), ej, rj], stderr=subprocess.PIPE)
    pico = [0.0]; pare = threading.Event()
    def amostra():
        while not pare.wait(0.5):
            try: pico[0] = max(pico[0], rss_arvore(p.pid))
            except Exception: pass
    th = threading.Thread(target=amostra, daemon=True); th.start()
    err = p.stderr.read().decode(errors="replace")[-1500:]; code = p.wait(); pare.set()
    r = {"ok": code == 0, "exit": code, "frio": frio, "pico_arvore_MB": round(pico[0]), "funcao_s": round(time.time() - t0, 2)}
    if os.path.exists(rj): r.update(json.load(open(rj)))
    if code != 0: r["erro"] = err
    return r
