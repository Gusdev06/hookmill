import glob,json,time,numpy as np,cv2,os,sys
from PIL import Image,ImageDraw,ImageFont,ImageFilter
exec(open('fontes.py').read().split("def casos")[0])
for p in glob.glob('gf/*.woff2'):
    F['G '+os.path.basename(p)[:-6]]=p
SISTEMA={f'mac AvenirNext#{i}':('/System/Library/Fonts/Avenir Next.ttc',i) for i in (0,2,5,7,8,10)}
F['ref Inter-Bold(teste)']='/Users/gustagoat/Documents/AIS-OS/projects/mentoria-spy/PACOTE-ESTEIRA-CRIATIVOS/fontes/Inter-Bold.ttf'
C={'v02':dict(orig=["Si en 2 minutos no te","busca, es porque","nunca fue para ti.."],lay=[66,66,72,348],today='CAT inter-800',ul=[(153,158),(220,225)],txt=(244,252,253)),
   'v06':dict(orig=["Él ya está con otra? Te","propongo algo. Si en 7 días","no te busca, dime mentirosa"],lay=[34,34,39,238],today='CAT roboto-condensed-700',ul=[],txt=(255,255,247))}
for nome,c in C.items():
    t0=time.time()
    med=cv2.imread(f"{nome}-med.png");Hc,Wc=med.shape[:2]
    k=min(Hc|1,101);bg=cv2.medianBlur(med,k).astype(np.float32);tx=np.array(c['txt'][::-1],np.float32)
    v=tx-bg;al=np.clip(((med.astype(np.float32)-bg)*v).sum(2)/np.maximum((v*v).sum(2),1),0,1)
    peso=np.ones((Hc,Wc),np.float32)
    for a,b in c['ul']: peso[a-1:b+1]=0
    alvo=al*peso;lines=c['orig']
    def rend(fnt,sz,pitch,base,cx,idx=0):
        im=Image.new('L',(Wc,Hc),0);d=ImageDraw.Draw(im);f=ImageFont.truetype(fnt,int(round(sz)),index=idx)
        for i,ln in enumerate(lines): d.text((cx,base+i*pitch),ln,font=f,fill=255,anchor='ms')
        return np.array(im.filter(ImageFilter.GaussianBlur(0.6)),np.float32)/255*peso
    cos=lambda a:float((a*alvo).sum()/(np.sqrt((a*a).sum()*(alvo*alvo).sum())+1e-6))
    def iou(a):
        x=a>0.5;y=alvo>0.5;return float((x&y).sum()/max(1,(x|y).sum()))
    # medidas sem desenhar: traco (stem) e alturas, da mascara
    m=(alvo>0.5).astype(np.uint8);dt=cv2.distanceTransform(m,cv2.DIST_L2,3)
    stem=2*float(np.percentile(dt[dt>0],90))
    res=[]
    fontes=[(k_,v_,0) for k_,v_ in F.items()]+[(k_,v_[0],v_[1]) for k_,v_ in SISTEMA.items()]
    for k_,fp,idx in fontes:
        try: ImageFont.truetype(fp,20,index=idx)
        except Exception as e: continue
        p=list(c['lay']);best=-1
        for _ in range(2):
            for j,rng in enumerate([range(-14,15,2),range(-4,5,2),range(-6,7,2),range(-8,9,2)]):
                b0=list(p)
                for dv in rng:
                    q=list(p);q[j]=b0[j]+dv
                    if j==0 and q[0]<12: continue
                    s=cos(rend(fp,*q,idx=idx))
                    if s>best:best,p=s,q
        for j,rng in enumerate([range(-1,2),range(-2,3),range(-2,3),range(-2,3)]):
            b0=list(p)
            for dv in rng:
                q=list(p);q[j]=b0[j]+dv
                s=cos(rend(fp,*q,idx=idx))
                if s>best:best,p=s,q
        a=rend(fp,*p,idx=idx);dt2=cv2.distanceTransform((a>0.5).astype(np.uint8),cv2.DIST_L2,3)
        st2=2*float(np.percentile(dt2[dt2>0],90)) if (dt2>0).any() else 0
        res.append(dict(f=k_,cos=round(best,3),iou=round(iou(a),3),sz=p[0],pitch=p[1],base=p[2],cx=p[3],stem=round(st2,1),fp=fp,idx=idx))
    res.sort(key=lambda r:-r['cos'])
    print('==',nome,'stem alvo',round(stem,1),'t',round(time.time()-t0,1))
    for r in res[:10]: print(' ',{k_:r[k_] for k_ in ('f','cos','iou','sz','pitch','stem')})
    print('  catalogo:',[(r['f'][4:],r['cos'],r['iou']) for r in res if r['f'].startswith('CAT')][:5])
    print('  hoje:',[(r['f'],r['cos'],r['iou'],r['sz']) for r in res if r['f']==c['today']],' ref:',[(r['f'],r['cos'],r['iou']) for r in res if r['f'].startswith('ref') or r['f'].startswith('mac')][:4])
    json.dump(res,open(f"{nome}-fontes2.json",'w'))
    # painel: original, hoje, melhor catalogo, melhor geral
    def panel(r):
        im=Image.new('L',(Wc,Hc),0);d=ImageDraw.Draw(im);f=ImageFont.truetype(r['fp'],int(r['sz']),index=r['idx'])
        for i,ln in enumerate(lines): d.text((r['cx'],r['base']+i*r['pitch']),ln,font=f,fill=255,anchor='ms')
        a=np.array(im.filter(ImageFilter.GaussianBlur(0.6)),np.float32)[...,None]/255
        return np.clip(bg*(1-a)+tx*a,0,255).astype(np.uint8)
    hoje=[r for r in res if r['f']==c['today']][0];cat=[r for r in res if r['f'].startswith('CAT')][0]
    linhas=[med,panel(hoje),panel(cat),panel(res[0])]
    cv2.imwrite(f"{nome}-painel.png",np.vstack(linhas))
