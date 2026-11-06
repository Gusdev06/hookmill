"""V3 (troca-texto §16.6): conferência das peças contra o campeão e folha de quadros. US$ 0.
- PSNR RGB fora da máscara, no trecho da headline, e no quadro inteiro fora do trecho (aceite: ≥ 40 dB).
- Pior quadro (PSNR mínimo) nas duas regiões e diferença média em níveis.
- Nº de quadros; áudio: duração do stream e md5 do PCM decodificado, campeão × peça.
- Folha: por peça, o recorte da headline no meio do trecho e no 1º quadro depois do corte, original × peça.
Uso: python conferir.py <pecas.json> <saida-dir>"""
import hashlib, json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def quadros(arq, W, H):
    p = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', arq, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    n = W * H * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(H, W, 3)
    p.wait()


def quadro(arq, n, W, H):
    b = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', arq, '-vf', f'select=eq(n\\,{n})', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    return np.frombuffer(b, np.uint8).reshape(H, W, 3)


def sonda(arq):
    o = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,width,height,nb_read_packets,duration', '-of', 'json', arq]))
    v = next(s for s in o['streams'] if s['codec_type'] == 'video')
    a = next((s for s in o['streams'] if s['codec_type'] == 'audio'), None)
    return int(v['width']), int(v['height']), int(v['nb_read_packets']), (float(a['duration']) if a else None), (int(a['nb_read_packets']) if a else None)


def md5_audio(arq):
    pcm = subprocess.check_output(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', arq, '-map', '0:a', '-f', 's16le', '-'])
    return hashlib.md5(pcm).hexdigest(), len(pcm)


def psnr(se, n):
    return float('inf') if se == 0 else 10 * np.log10(255 ** 2 / (se / n))


def main(pecas_json, saida):
    os.makedirs(saida, exist_ok=True)
    pecas = json.load(open(pecas_json))
    resultado, folhas = [], []
    for p in pecas:
        W, H, nq_c, ad_c, ap_c = sonda(p['campeao'])
        W2, H2, nq_p, ad_p, ap_p = sonda(p['peca'])
        a, b = p['startFrame'], p['endFrame']
        mask = np.zeros((H, W), bool)
        for r in p['mascara']:
            x0, y0 = max(0, int(np.floor(r['x']))), max(0, int(np.floor(r['y'])))
            x1, y1 = min(W, int(np.ceil(r['x'] + r['w']))), min(H, int(np.ceil(r['y'] + r['h'])))
            mask[y0:y1, x0:x1] = True
        fora = ~mask
        se_in = se_out = 0.0
        n_in = n_out = 0
        pior_in = pior_out = float('inf')
        dif_in = []
        meio, depois = (a + b) // 2, min(b, nq_c - 1)
        guarda = {}
        for k, (qc, qp) in enumerate(zip(quadros(p['campeao'], W, H), quadros(p['peca'], W, H))):
            d = (qc.astype(np.int32) - qp.astype(np.int32))
            d2 = (d * d).sum(2)
            if a <= k < b:
                s = float(d2[fora].sum()); m = int(fora.sum()) * 3
                se_in += s; n_in += m; pior_in = min(pior_in, psnr(s, m)); dif_in.append(float(np.abs(d)[fora].mean()))
            else:
                s = float(d2.sum()); m = W * H * 3
                se_out += s; n_out += m; pior_out = min(pior_out, psnr(s, m))
            if k in (meio, depois):
                guarda[k] = (qc.copy(), qp.copy())
        mc, mp = md5_audio(p['campeao']), md5_audio(p['peca'])
        # A8 (só com placa de base): dentro da máscara, peça − placa; a tinta é minoria, então a mediana mede o deslocamento
        a8 = None
        if p.get('placa'):
            qpl = quadro(p['placa'], meio, W, H)
            dd = guarda[meio][1].astype(np.int32).mean(2) - qpl.astype(np.int32).mean(2)
            a8 = round(float(np.median(dd[mask])), 2)
        linha = dict(nome=p['nome'], kind=p['kind'], fonte=p['fonte'], tamanho=p['tamanho'], linhas=p['linhas'],
                     quadros=[nq_c, nq_p], intervalo=[a, b],
                     psnr_fora_mascara_trecho=round(psnr(se_in, n_in), 2), pior_quadro_trecho=round(pior_in, 2), dif_media_trecho=round(float(np.mean(dif_in)), 3) if dif_in else None,
                     psnr_fora_do_trecho=round(psnr(se_out, n_out), 2) if n_out else None, pior_quadro_fora=round(pior_out, 2) if n_out else None,
                     audio_s=[ad_c, ad_p], audio_pacotes=[ap_c, ap_p], audio_md5_igual=mc == mp, audio_bytes=[mc[1], mp[1]],
                     a8_mediana_peca_menos_placa=a8, render_s=p['render_s'], pico_rss_MB=p['pico_rss_MB'])
        linha['passa'] = bool(linha['psnr_fora_mascara_trecho'] >= 40 and (linha['psnr_fora_do_trecho'] is None or linha['psnr_fora_do_trecho'] >= 40)
                              and nq_c == nq_p and linha['audio_md5_igual'] and abs(ad_c - ad_p) < 1e-3)
        print(json.dumps(linha, ensure_ascii=False))
        resultado.append(linha)
        # recorte: a máscara + 40 px (até a borda), no meio do trecho e logo depois do corte
        ys, xs = np.where(mask)
        x0, x1 = max(0, xs.min() - 40), min(W, xs.max() + 41)
        y0, y1 = max(0, ys.min() - 40), min(H, ys.max() + 41)
        folhas.append((p, [(f'original q{meio}', guarda[meio][0][y0:y1, x0:x1]), (f'peça q{meio}', guarda[meio][1][y0:y1, x0:x1]),
                           (f'original q{depois} (corte)', guarda[depois][0][y0:y1, x0:x1]), (f'peça q{depois} (corte)', guarda[depois][1][y0:y1, x0:x1])], linha))
    json.dump(resultado, open(os.path.join(saida, 'conferencia.json'), 'w'), ensure_ascii=False, indent=1)
    folha(folhas, os.path.join(saida, 'folha-v3.png'))


def folha(folhas, dst):
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
    except OSError:
        f = ImageFont.load_default()
    larg_cel = 420
    linhas = []
    for p, cels, r in folhas:
        ims = []
        for rot, a in cels:
            im = Image.fromarray(a)
            im = im.resize((larg_cel, max(1, round(im.height * larg_cel / im.width))), Image.LANCZOS)
            ims.append((rot, im))
        h = max(i.height for _, i in ims) + 30
        lin = Image.new('RGB', (larg_cel * 4 + 50, h + 30), (24, 24, 24))
        d = ImageDraw.Draw(lin)
        d.text((10, 4), f"{p['nome']} · {p['kind']} · {p['fonte']} {r['tamanho']}px · PSNR fora {r['psnr_fora_mascara_trecho']} dB (pior {r['pior_quadro_trecho']}) · fora do trecho {r['psnr_fora_do_trecho']} dB · áudio {'igual' if r['audio_md5_igual'] else 'DIFERENTE'}", fill=(240, 240, 240), font=f)
        for k, (rot, im) in enumerate(ims):
            x = 10 + k * (larg_cel + 10)
            d.text((x, 30), rot, fill=(180, 180, 180), font=f)
            lin.paste(im, (x, 56))
        linhas.append(lin)
    W = max(l.width for l in linhas)
    out = Image.new('RGB', (W, sum(l.height for l in linhas)), (24, 24, 24))
    y = 0
    for l in linhas:
        out.paste(l, (0, y)); y += l.height
    out.save(dst)
    print(dst, out.size)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
