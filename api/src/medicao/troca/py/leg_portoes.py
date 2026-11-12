"""leg_portoes.py — medidas dos portões da legenda ANTES da placa (troca-texto §15.6.1, tabela 1). Dono: video.

Só mede (números em `gates`, chaves de `legenda.ts/PORTAO_CHAVES`); quem decide é `avaliarPortoesLegenda` (TS), a mesma regra no fake.
Sem pixel no resultado. `pessoa_rosto` e `pessoa_fala` vêm do `faceTrack` da leitura: calculados no TS, não aqui.
Valores iniciais dos portões; a S3 calibra. Onde a medida é uma escolha minha (agregação por vídeo) está dito.
"""
import numpy as np
import cv2

from leg_det import frames


def _bands(est, h_letra):
    """nº de linhas de texto da máscara estável: bandas de linhas (≥ 15 % do máximo) separadas por vão > 33 % da altura da letra, contando só as bandas
    com massa de tinta ≥ 40 % da maior (descendente/ascendente de caixa mista é uma faixa fina de tinta, não uma 2ª linha).
    Medido (S3, 11/11): 1 linha aprovada (30/27/54/07/09) p90 do maior vão = 0,03-0,24 da altura da letra; 2 linhas (29, 11) = 0,47 e 0,39;
    a 1ª versão pedia vão de 60 % (2 linhas coladas contavam 1) e a 2ª, 12 % (descendente contava linha: o 09 aprovado virava 2)."""
    rc = est.sum(1)
    if rc.max() <= 0:
        return 0
    rows = np.where(rc >= 0.15 * rc.max())[0]
    if not len(rows):
        return 0
    cortes = np.where(np.diff(rows) > max(3, 0.33 * h_letra))[0] + 1
    massas = [float(rc[g[0]:g[-1] + 1].sum()) for g in np.split(rows, cortes)]
    return int(sum(1 for m in massas if m >= 0.4 * max(massas)))


def cobertura_fala(D, words, fps, atraso, minimo_quadros=3):
    """Fração dos quadros com fala (palavra + atraso da legenda) que caem num trecho com texto detectado (§15.6.1 `Detectou`)."""
    N = int(D["N"]); bom = np.zeros(N, bool)
    for s in D["segs"]:
        if not s["vazio"] and s["est"].sum() > 300 and s["fim"] - s["ini"] >= minimo_quadros:
            bom[s["ini"]:s["fim"]] = True
    fala = np.zeros(N, bool)
    for w in words:
        a, b = int(round((w["ini"] + atraso) * fps)), int(round((w["fim"] + atraso) * fps))
        fala[max(0, a):max(0, min(N, b))] = True
    return float((bom & fala).sum() / max(1, fala.sum())), fala


def linhas_legenda(D, h_letra):
    """p90 do nº de linhas por trecho (karaokê em caixa não conta linha: a caixa é 1 palavra)."""
    n = [_bands(s["est"], h_letra) for s in D["segs"] if not s["vazio"] and s["est"].sum() > 300]
    return int(round(np.percentile(n, 90))) if n else 0


def animacao(D, ignorar=3):
    """Variação de largura e altura da máscara dentro do trecho (p5-p95 ÷ mediana), ignorando os primeiros quadros (entrada).
    Agregação por vídeo = p75 dos trechos; o contrato diz '> 8 % = fora' por trecho, e o vídeo-nível é escolha minha (S3 calibra)."""
    bw, bh, v = D["bw"], D["bh"], []
    for s in D["segs"]:
        if s["vazio"] or s["fim"] - s["ini"] < 8 + ignorar:
            continue
        a, b = s["ini"] + ignorar, s["fim"]
        r = []
        for x in (bw[a:b], bh[a:b]):
            x = x[x > 0]
            if len(x) >= 5:
                r.append((np.percentile(x, 95) - np.percentile(x, 5)) / max(1.0, np.median(x)))
        if r:
            v.append(max(r))
    return float(np.percentile(v, 75)) if v else 0.0


def fundo_lap(D, janela=15):
    """`detalhe` do portoes.py da F0: |Laplaciano| médio no anel das letras, janelas de 0,5 s. Vídeo = MEDIANA das janelas
    (escolha minha; a F0 mediu por janela: bom 36-49, ruim 73-82). Devolve (mediana, pior janela)."""
    lap = D["lap"]; w = []
    for i in range(0, len(lap), janela):
        x = lap[i:i + janela]; x = x[~np.isnan(x)]
        if len(x) >= 8:
            w.append(float(np.mean(x)))
    return (float(np.median(w)), float(np.max(w))) if w else (0.0, 0.0)


def estilo_estavel(D, ws_por_seg, spec, tr, esp, W, encaixa):
    """Corpo ajustado em 3 terços do vídeo, com a fonte, tracking e espaço já escolhidos: (max − min) ÷ mediana dos 3 corpos.
    Só trechos bem encaixados (IoU ≥ 0,5: um trecho com fundo claro entra com IoU 0,25 e corpo 119, e não é a legenda), até 5 por terço, a mediana."""
    N = int(D["N"]); cand = [(s, pal) for s, pal in ws_por_seg if pal and s["est"].sum() > 600]
    tams = []
    for k in range(3):
        a, b = N * k / 3, N * (k + 1) / 3
        ter = sorted([c for c in cand if a <= (c[0]["ini"] + c[0]["fim"]) / 2 < b], key=lambda c: -c[0]["est"].sum())[:8]
        fits = [encaixa(s["est"], pal, spec, tr, esp, W) for s, pal in ter]
        t = [f[1][0] for f in fits if f[1] and f[0] >= 0.5][:5]
        if t:
            tams.append(float(np.median(t)))
    if len(tams) < 2:
        return 0.0
    return float((max(tams) - min(tams)) / max(1e-6, np.median(tams)))


def contorno_sem(video, box, fala_idx, passo=5, max_amostras=40):
    """`no_outline`: há texto CLARO na faixa nos quadros de fala, mesmo sem contorno escuro? 1 = a legenda existe e o detector a perdeu por
    falta de contorno. Heurística minha: ≥ 6 componentes claros de tamanho de letra alinhados em 1 banda, em ≥ 60 % das amostras."""
    x, y, w, h = box
    alvo = set(int(i) for i in fala_idx[::passo][:max_amostras * passo])
    ok = n = 0
    for i, f in enumerate(frames(video, ini=0)):
        if i not in alvo:
            continue
        c = f[y:y + h, x:x + w]
        b, g, r = (c[..., k].astype(np.int16) for k in range(3))
        claro = ((np.minimum(np.minimum(b, g), r) > 200) & (np.maximum(np.maximum(b, g), r) - np.minimum(np.minimum(b, g), r) < 40)).astype(np.uint8)
        nn, _, st, _ = cv2.connectedComponentsWithStats(claro, connectivity=8)
        letras = [k for k in range(1, nn) if 6 <= st[k, 3] <= max(10, h * 0.7) and 2 <= st[k, 2] <= 0.5 * w and st[k, 4] >= 8]
        if len(letras) >= 6:
            cy = np.array([st[k, 1] + st[k, 3] / 2 for k in letras])
            if np.median(np.abs(cy - np.median(cy))) < 0.35 * np.median([st[k, 3] for k in letras]):
                ok += 1
        n += 1
        if n >= max_amostras:
            break
    return 1.0 if (n >= 5 and ok / n >= 0.6) else 0.0


def marcar_fora(D, words, fps, atraso, folga=0.3, minimo_quadros=20):
    """Marca (`s["fora"] = True`) os trechos que NÃO acompanham a fala: texto parado por mais de `minimo_quadros` quadros com < 40 % deles dentro
    da fala (palavra + atraso ± folga). É o CTA, a tela final, o botão, a headline que aparece e fica. Esses trechos nunca viram máscara da placa
    (a máscara fica limitada à legenda e ao tempo da fala). Trecho curto não é marcado: palavra solta de karaokê dura < 20 quadros. Devolve quantos."""
    N = int(D["N"]); fala = np.zeros(N, bool)
    for w in words:
        a, b = int(round((w["ini"] + atraso - folga) * fps)), int(round((w["fim"] + atraso + folga) * fps))
        fala[max(0, a):max(0, min(N, b))] = True
    n = 0
    for s in D["segs"]:
        if s["vazio"] or s["fim"] - s["ini"] < minimo_quadros:
            continue
        if fala[s["ini"]:s["fim"]].mean() < 0.4:
            s["fora"] = True; n += 1
    return n


def atraso_por_cobertura(D, words, fps, passo=0.05):
    """Atraso da legenda quando o alinhamento por largura não existe: o deslocamento (−1 a +1 s) que mais casa os quadros de fala com os trechos de texto."""
    N = int(D["N"]); bom = np.zeros(N, bool)
    for s in D["segs"]:
        if not s["vazio"] and s["est"].sum() > 300:
            bom[s["ini"]:s["fim"]] = True
    melhor, nm = 0.0, -1
    for k in range(-20, 21):
        d = k * passo; fala = np.zeros(N, bool)
        for w in words:
            a, b = int(round((w["ini"] + d) * fps)), int(round((w["fim"] + d) * fps))
            fala[max(0, a):max(0, min(N, b))] = True
        n = int((bom & fala).sum())
        if n > nm or (n == nm and abs(d) < abs(melhor)):
            melhor, nm = d, n
    return float(melhor)
