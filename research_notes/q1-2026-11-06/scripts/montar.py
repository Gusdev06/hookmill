"""Q1: monta o pecas.json do conferir.py (V3) a partir das peças do lote real: render-input-<caso>.json + look-<caso>.json.
Máscara = o que pode mudar: caixa (box) ou caixa do texto novo + área apagada da placa (texto + emoji + 12 px) no solto.
Uso: python montar.py <dir-q1> <casos...>"""
import json, os, subprocess, sys, urllib.request
ORIG = {'s4-02': 'c02.mp4', 's4-05': 'c05.mp4', 's4-06': 'c06.mp4', 's4-solto': 'original.mp4'}
d = sys.argv[1]; s4 = os.path.join(d, '..', 's4-demo-2026-11-06', 'origem')
out = []
for c in sys.argv[2:]:
    inp = json.load(open(os.path.join(d, f'render-input-{c}.json'))); look = json.load(open(os.path.join(d, f'look-{c}.json')))
    t = inp['textLayers'][0]
    if look['kind'] == 'box':
        masc = [t['background']['box'] or look['box']]
    else:
        tb, e = look['text']['textBox'], look.get('emoji')
        x0 = min(tb['x'], e['x'] if e else 1e9) - 12; y0 = min(tb['y'], e['y'] if e else 1e9) - 12
        x1 = max(tb['x'] + tb['w'], e['x'] + e['w'] if e else -1e9) + 12; y1 = max(tb['y'] + tb['h'], e['y'] + e['h'] if e else -1e9) + 12
        masc = [t['box'], {'x': x0, 'y': y0, 'w': x1 - x0, 'h': y1 - y0}]
    placa = None
    if inp.get('placaComoBase'):
        placa = os.path.join(d, 'placas', f'{c}.mp4'); os.makedirs(os.path.dirname(placa), exist_ok=True)
        if not os.path.exists(placa): urllib.request.urlretrieve(inp['baseVideoUrl'], placa)
    out.append(dict(nome=c, kind=look['kind'], campeao=os.path.abspath(os.path.join(s4, ORIG[c])), peca=os.path.join(d, 'pecas', f'{c}.mp4'), placa=placa,
                    startFrame=t['startFrame'], endFrame=t['endFrame'], mascara=masc, linhas=t['content'].get('lines'), fonte=t['style']['fontId'],
                    tamanho=t['style']['fontSizePx'], render_s=None, pico_rss_MB=None))
json.dump(out, open(os.path.join(d, 'pecas.json'), 'w'), ensure_ascii=False, indent=1)
print(len(out))
