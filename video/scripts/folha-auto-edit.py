"""Folha de frames do auto-edit (variacao-auto-v1 V1): uma linha por peça, 5 instantes por linha, uma folha por formato.
Uso: python3 video/scripts/folha-auto-edit.py <pasta-dos-renders>  (lê NN-CODIGO-FORMATO.mp4/.png e grava folha-<FORMATO>.jpg)"""
import pathlib, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

pasta = pathlib.Path(sys.argv[1])
ALT = 300  # altura de cada miniatura
try:
    fonte = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 22)
except OSError:
    fonte = ImageFont.load_default()

def dur(f):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], text=True)
    return float(out.strip())

def frame(f, t, tmp):
    o = pathlib.Path(tmp) / f'{f.stem}-{t:.2f}.png'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', f'{t:.3f}', '-i', str(f), '-frames:v', '1', str(o)], check=True)
    return Image.open(o).convert('RGB')

for formato in ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1']:
    pecas = sorted(p for p in pasta.iterdir() if p.suffix in ('.mp4', '.png') and p.stem.endswith(formato) and p.stem[:2].isdigit())
    if not pecas:
        continue
    linhas = []
    with tempfile.TemporaryDirectory() as tmp:
        for p in pecas:
            if p.suffix == '.png':
                ims, rot = [Image.open(p).convert('RGB')], ['still']
            else:
                d = dur(p)
                ts = [0.3, 1.5, d * 0.45, d - 2.6 if 'ENDCARD' in p.stem else d * 0.75, d - 0.4]
                ims, rot = [frame(p, t, tmp) for t in ts], [f'{t:.1f}s' for t in ts]
            ims = [im.resize((round(im.width * ALT / im.height), ALT)) for im in ims]
            w = sum(im.width for im in ims) + 8 * len(ims) + 260
            lin = Image.new('RGB', (w, ALT + 8), (24, 24, 24))
            dr = ImageDraw.Draw(lin)
            dr.text((10, 10), p.stem.replace('-' + formato, ''), fill=(255, 255, 255), font=fonte)
            x = 260
            for im, r in zip(ims, rot):
                lin.paste(im, (x, 4))
                dr.text((x + 6, ALT - 26), r, fill=(255, 230, 0), font=fonte)
                x += im.width + 8
            linhas.append(lin)
    W = max(l.width for l in linhas)
    folha = Image.new('RGB', (W, sum(l.height for l in linhas)), (24, 24, 24))
    y = 0
    for l in linhas:
        folha.paste(l, (0, y)); y += l.height
    out = pasta / f'folha-{formato}.jpg'
    folha.save(out, quality=85)
    print(out, folha.size)
