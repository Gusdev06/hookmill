import sys, subprocess
from PIL import Image, ImageDraw, ImageFont
S, id, ori, out, *ts = sys.argv[1:]
f = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 34, index=1)
for i, t in enumerate(ts, 1):
    ims = []
    for lab, p in [("ANTES", ori), ("A: inpaint TELEA", f"{out}/{id}-depois-A.mp4"), ("B: caixa lisa", f"{out}/{id}-depois-B.mp4")]:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", t, "-i", p, "-frames:v", "1", f"{S}/q.png"], check=True)
        im = Image.open(f"{S}/q.png").convert("RGB"); d = ImageDraw.Draw(im)
        bb = d.textbbox((16, im.height - 60), lab, font=f); d.rectangle([bb[0]-8, bb[1]-8, bb[2]+8, bb[3]+8], fill=(0, 0, 0))
        d.text((16, im.height - 60), lab, font=f, fill=(255, 255, 255)); ims.append(im)
    w, h = ims[0].size; s = Image.new("RGB", (w * 3 + 20, h), (255, 255, 255))
    for k, im in enumerate(ims): s.paste(im, (k * (w + 10), 0))
    s.save(f"{out}/{id}-quadro-{i}-t{t}s.jpg", quality=90)
