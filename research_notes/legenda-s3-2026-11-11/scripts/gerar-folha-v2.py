#!/usr/bin/env python3
"""Folha v2 da S3 (index-v2.html): por vídeo, original + 3 versões (sem legenda, outro idioma, cores trocadas), Sim/Não/Dúvida + comentário POR versão.
Uso: python3 gerar-folha-v2.py <pasta-s3>"""
import html, json, os, sys
d = os.path.abspath(sys.argv[1])
M = json.load(open(os.path.join(d, "manifesto.json"))); R = json.load(open(os.path.join(d, "v2-resultado.json")))
IDI = {"en": ("inglês", "português"), "it": ("italiano", "inglês")}
VERS = [("sem", "1. Sem legenda (placa pura)"), ("idioma", "2. Outro idioma"), ("cores", "3. Cores trocadas")]
REP = json.load(open(os.path.join(d, "reprovados", "reprovados.json")))   # os 7 que a versão 1 da folha errou: sem vídeo, com o motivo
ok = [m for m in M if m["troca"] and R.get(m["id"], {}).get("ok") and m["id"] not in REP]; fora = [m for m in M if m not in ok and m["id"] not in REP]
def card(m):
    i = m["id"]; a, b = IDI.get(m["idioma"], (m["idioma"], "inglês"))
    cols = f'<div class="col"><div class="t">Original ({a})</div><video src="videos/{i}-original.mp4" controls preload="none" playsinline></video></div>'
    for k, t in VERS:
        extra = f" ({a} → {b})" if k == "idioma" else (" (texto #FFE600, traço preto, destaque #00E5FF)" if k == "cores" else "")
        cols += (f'<div class="col"><div class="t">{t}{extra}</div><video src="videos/{i}-{k}.mp4" controls preload="none" playsinline></video>'
                 f'<div class="marca">' + "".join(f'<label><input type="radio" name="r{i}{k}" value="{v}" data-id="{i}-{k}"> {x}</label>' for v, x in (("sim", "Sim"), ("nao", "Não"), ("duvida", "Dúvida"))) +
                 f'<input type="text" placeholder="comentário" data-nota="{i}-{k}"></div></div>')
    return f'<section><h2>vídeo {i} <small>{html.escape(m["veredito"])}</small></h2><div class="row">{cols}</div></section>'
ids = [f"{m['id']}-{k}" for m in ok for k, _ in VERS]
rep = "".join(f'<section><h2>vídeo {i} <small>reprovado: {html.escape(v["razao"])} · cobertura {v["gates"].get("cobertura")}, IoU {v["gates"].get("iou_mediana")}, trechos herdados {v["gates"].get("herdados")}</small></h2><img src="reprovados/{i}-quadro.png" style="max-height:420px"> <img src="reprovados/{i}-par.png" style="max-width:100%"><div class="t">Esquerda: o quadro e a faixa que o detector novo escolheu. Direita: 4 momentos (15/40/65/90 %), original e o que ele apagaria (só referência, não é oferecido).</div></section>' for i, v in sorted(REP.items()))
rod = "".join(f'<li>vídeo {m["id"]}: {html.escape(str(m.get("motivo") or m["veredito"]))}</li>' for m in fora)
page = f"""<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>S3 v2 legenda</title>
<style>body{{font:14px system-ui;background:#111;color:#eee;margin:0;padding:14px;max-width:1700px;margin:auto}}h2{{font-size:15px;margin:0 0 6px}}small{{color:#9aa;font-weight:400}}
section{{background:#1b1b1b;border-radius:10px;padding:12px;margin:12px 0}}.row{{display:flex;gap:10px}}.col{{flex:1;min-width:0}}.t{{color:#9aa;font-size:11px;margin-bottom:3px;min-height:28px}}
video{{width:100%;max-height:520px;background:#000;border-radius:6px}}.marca{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;font-size:13px}}
.marca input[type=text]{{flex:1;min-width:90px;background:#111;color:#eee;border:1px solid #333;border-radius:6px;padding:4px}}
#barra{{position:fixed;left:0;right:0;bottom:0;background:#000;border-top:1px solid #333;padding:10px 20px;display:flex;gap:16px;align-items:center}}button{{background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer}}</style>
<h1 style="font-size:19px">S3 v2: {len(ok)} vídeos. Original + 3 versões lado a lado; marque cada versão separadamente.</h1>
<p>As versões 2 e 3 refazem a legenda em cima da placa. A 1 é a placa sem nada por cima: serve para ver se sobrou mancha, borrão ou rastro. A tradução (2) foi feita à mão, trecho a trecho, mantendo o tempo de cada página.</p>
{''.join(card(m) for m in ok)}
<h3>Reprovados pelos portões (nenhuma troca gerada)</h3>{rep}<h3>Sem versões (sem placa)</h3><ul>{rod}</ul>
<div id="barra"><span id="prog"></span><button onclick="baixar()">Baixar marcações (marcacoes-v2.json)</button></div>
<script>
const K='s3-legenda-v2-2026-11-11';let S=JSON.parse(localStorage.getItem(K)||'{{}}');const ids={json.dumps(ids)};
function salvar(){{localStorage.setItem(K,JSON.stringify(S));document.getElementById('prog').textContent=ids.filter(i=>S[i]&&S[i].v).length+' de '+ids.length+' marcados'}}
document.querySelectorAll('input[type=radio]').forEach(r=>{{const i=r.dataset.id;if(S[i]&&S[i].v===r.value)r.checked=true;r.onchange=()=>{{S[i]=Object.assign(S[i]||{{}},{{v:r.value}});salvar()}}}});
document.querySelectorAll('input[data-nota]').forEach(t=>{{const i=t.dataset.nota;t.value=(S[i]&&S[i].nota)||'';t.oninput=()=>{{S[i]=Object.assign(S[i]||{{}},{{nota:t.value}});salvar()}}}});
function baixar(){{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(S,null,1)],{{type:'application/json'}}));a.download='marcacoes-v2.json';a.click()}}
salvar();</script></html>"""
open(os.path.join(d, "index-v2.html"), "w").write(page); print("ok", len(ok), "vídeos;", len(REP), "reprovados;", len(fora), "no rodapé")
