#!/usr/bin/env python3
"""Gera a folha de marcação da S3 (index.html, estática, sem servidor). Uso: python3 gerar-folha.py <pasta-da-s3>
A pasta tem manifesto.json = [{id, rotulo, idioma, original: "videos/NN-original.mp4", troca: "videos/NN-troca.mp4" | null, veredito, motivo, placa, metricas, gates}].
O Gusta abre index.html, assiste cada vídeo INTEIRO e marca Sim / Não / Dúvida (+ comentário). Marcações no localStorage; "Baixar marcações" gera marcacoes.json."""
import html, json, os, sys
d = sys.argv[1]
M = json.load(open(os.path.join(d, "manifesto.json")))
def card(m):
    i = m["id"]
    v = (f'<div class="col"><div class="t">Original</div><video src="{html.escape(m["original"])}" controls preload="none" playsinline></video></div>'
         f'<div class="col"><div class="t">Com a legenda trocada (mesmas palavras)</div>' +
         (f'<video src="{html.escape(m["troca"])}" controls preload="none" playsinline></video>' if m.get("troca") else
          f'<div class="semvideo">Não gerado: {html.escape(str(m.get("motivo")))}</div>') + '</div>')
    g = m.get("gates") or {}
    gs = " · ".join(f"{k} {round(x, 3) if isinstance(x, (int, float)) else x}" for k, x in g.items() if k not in ("alfabeto_fora", "emoji_legenda"))
    pl = m.get("metricas") or {}
    ps = " · ".join(f"{k} {round(pl[k], 3)}" for k in ("janelas_ruins_pct", "ruim_gancho_s", "lisura_min", "trem_max", "degrau_max", "letra_p95_pct", "fora_buraco_media") if k in pl)
    marcavel = bool(m.get("troca"))
    radios = "".join(f'<label><input type="radio" name="r{i}" value="{v}" data-id="{i}"> {t}</label>' for v, t in (("sim", "Sim, ficou bom"), ("nao", "Não"), ("duvida", "Dúvida"))) if marcavel else '<em>sem vídeo para marcar</em>'
    return (f'<section id="c{i}"><h2>{html.escape(str(m["rotulo"]))} <small>{html.escape(str(m.get("idioma","")))} · veredito dos portões: <b>{html.escape(str(m["veredito"]))}</b></small></h2>'
            f'<div class="row">{v}</div><p class="num">{html.escape(gs)}</p><p class="num">{html.escape(ps)}</p>'
            f'<div class="marca">{radios}<input type="text" placeholder="o que viu (mão, borrão, texto torto, pulo...)" data-nota="{i}"></div></section>')
page = f"""<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>S3 legenda: marcar sim ou não</title>
<style>body{{font:15px system-ui;background:#111;color:#eee;margin:0;padding:16px 20px 80px;max-width:1100px;margin:auto}}
h1{{font-size:20px}}h2{{font-size:16px;margin:0 0 8px}}small{{color:#9aa;font-weight:400}}section{{background:#1b1b1b;border-radius:10px;padding:14px;margin:14px 0}}
.row{{display:flex;gap:12px}}.col{{flex:1;min-width:0}}.t{{color:#9aa;font-size:12px;margin-bottom:4px}}video{{width:100%;max-height:560px;background:#000;border-radius:6px}}
.semvideo{{padding:40px 10px;background:#262626;border-radius:6px;color:#bbb;text-align:center}}.num{{font:12px ui-monospace,monospace;color:#8aa;margin:6px 0}}
.marca{{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:8px}}.marca input[type=text]{{flex:1;min-width:220px;background:#111;color:#eee;border:1px solid #333;border-radius:6px;padding:6px}}
#barra{{position:fixed;left:0;right:0;bottom:0;background:#000;border-top:1px solid #333;padding:10px 20px;display:flex;gap:16px;align-items:center}}button{{background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}}</style>
<h1>S3 da legenda: {len(M)} vídeos reais. Assista cada um INTEIRO (original à esquerda, troca à direita) e marque.</h1>
<p>Sim = você postaria assim. Não = tem defeito que a pessoa notaria (mancha, borrão, mão/rastro, texto torto, pulo). Os números embaixo são dos portões automáticos, só para registrar.</p>
{''.join(card(m) for m in M)}
<div id="barra"><span id="prog"></span><button onclick="baixar()">Baixar marcações (marcacoes.json)</button></div>
<script>
const K='s3-legenda-2026-11-11';let S=JSON.parse(localStorage.getItem(K)||'{{}}');
const ids={json.dumps([m["id"] for m in M if m.get("troca")])};
function salvar(){{localStorage.setItem(K,JSON.stringify(S));const n=ids.filter(i=>S[i]&&S[i].v).length;document.getElementById('prog').textContent=n+' de '+ids.length+' marcados'}}
document.querySelectorAll('input[type=radio]').forEach(r=>{{const i=r.dataset.id;if(S[i]&&S[i].v===r.value)r.checked=true;r.onchange=()=>{{S[i]=Object.assign(S[i]||{{}},{{v:r.value}});salvar()}}}});
document.querySelectorAll('input[data-nota]').forEach(t=>{{const i=t.dataset.nota;t.value=(S[i]&&S[i].nota)||'';t.oninput=()=>{{S[i]=Object.assign(S[i]||{{}},{{nota:t.value}});salvar()}}}});
function baixar(){{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,1)],{{type:'application/json'}}));a.download='marcacoes.json';a.click()}}
salvar();
</script></html>"""
open(os.path.join(d, "index.html"), "w").write(page)
print("ok", len(M))
