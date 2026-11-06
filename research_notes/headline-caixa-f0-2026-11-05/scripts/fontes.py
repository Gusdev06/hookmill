import sys,glob,json,time,numpy as np,cv2,os
from PIL import Image,ImageDraw,ImageFont,ImageFilter
NM="/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/node_modules/@fontsource/"
PUB="/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/video/public/fonts/"
CAT={'montserrat-800':'montserrat-latin-800','montserrat-900':'montserrat-latin-900','inter-800':'inter-latin-800','anton-400':'anton-latin-400','oswald-700':'oswald-latin-700','bebas-neue-400':'bebas-neue-latin-400','archivo-black-400':'archivo-black-latin-400','poppins-800':'poppins-latin-800','roboto-condensed-700':'roboto-condensed-latin-700'}
F={}
for k,v in CAT.items(): F['CAT '+k]=PUB+v+'-normal.woff2'
for fam,ws in {'inter':[400,500,600,700],'montserrat':[400,500,600,700],'poppins':[400,500,600,700],'roboto-condensed':[400,500,600]}.items():
    for w in ws:
        p=f"{NM}{fam}/files/{fam}-latin-{w}-normal.woff2"
        if os.path.exists(p): F[f'+ {fam}-{w}']=p
SISTEMA={'mac Avenir Next Medium':('/System/Library/Fonts/Avenir Next.ttc',5),'mac Avenir Next Demi':('/System/Library/Fonts/Avenir Next.ttc',2)}
def casos():
    return {
     'v02':dict(orig=["Si en 2 minutos no te","busca, es porque","nunca fue para ti.."],lay=[66,66,72,348],vis=('inter-800',58)),
     'v06':dict(orig=["Él ya está con otra? Te","propongo algo. Si en 7 días","no te busca, dime mentirosa"],lay=[35,34,39,238],vis=('roboto-condensed-700',35)),
    }
def ul_linhas(letra):
    H,W=letra.shape;out=[]
    def run(r):
        m=b=0
        for v in r:
            b=b+1 if v else 0;m=max(m,b)
        return m
    rr=[run(letra[y]) for y in range(H)]
    y=0
    while y<H:
        if rr[y]>0.2*W:
            a=y
            while y<H and rr[y]>0.2*W:y+=1
            cols=np.where(letra[a:y].mean(0)>0.8)[0]
            out.append(dict(y0=a,y1=y,x0=int(cols.min()),x1=int(cols.max())))
        y+=1
    return out
for nome,c in casos().items():
    t0=time.time()
    letra=cv2.imread(f"{nome}-letra.png",0)>0
    uls=ul_linhas(letra)
    peso=np.ones(letra.shape,np.float32)
    for u in uls: peso[u['y0']-1:u['y1']+1,:]=0
    # recorte fino da "ponta" das linhas de texto, pra medir largura por linha sem sublinhado
    alvo=letra.astype(np.float32)*peso
    Hc,Wc=letra.shape
    lines=c['orig']
    def rend(fnt,sz,pitch,base,cx,tr=0.0,idx=0):
        im=Image.new('L',(Wc,Hc),0);d=ImageDraw.Draw(im);f=ImageFont.truetype(fnt,int(round(sz)),index=idx)
        for i,ln in enumerate(lines):
            if tr==0:
                d.text((cx,base+i*pitch),ln,font=f,fill=255,anchor='ms')
            else:
                W=f.getlength(ln)+tr*sz*(len(ln)-1);x=cx-W/2
                for j,ch in enumerate(ln):
                    xx=x+f.getlength(ln[:j])+tr*sz*j
                    d.text((xx,base+i*pitch),ch,font=f,fill=255,anchor='ls')
        return np.array(im.filter(ImageFilter.GaussianBlur(0.6)),np.float32)/255*peso
    def cos(a): return float((a*alvo).sum()/(np.sqrt((a*a).sum()*(alvo*alvo).sum())+1e-6))
    def iou(a):
        x=a>0.5;y=alvo>0.5;return float((x&y).sum()/max(1,(x|y).sum()))
    res=[]
    fontes=[(k,v,0) for k,v in F.items()]+[(k,v[0],v[1]) for k,v in SISTEMA.items()]
    alturas={}
    for k,fp,idx in fontes:
        sz0=c['lay'][0]
        # chute de tamanho pela largura media das linhas
        f=ImageFont.truetype(fp,100,index=idx);adv=f.getlength(max(lines,key=len))
        cols=np.where(letra[int(c['lay'][2]-c['lay'][0]):int(c['lay'][2]+0.2*c['lay'][0])].any(0))[0]
        p=[c['lay'][0],c['lay'][1],c['lay'][2],c['lay'][3]]
        best=-1
        for _ in range(2):
            for j,rng in enumerate([range(-16,17,2),range(-4,5,2),range(-6,7,2),range(-8,9,2)]):
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
        a=rend(fp,*p,idx=idx)
        # erro de largura por linha contra a mascara
        errs=[]
        for i,ln in enumerate(lines):
            base=p[2]+i*p[1]
            y0=max(0,int(base-0.75*p[0]));y1=min(Hc,int(base+0.05*p[0]))
            colsT=np.where(alvo[y0:y1].any(0))[0];colsR=np.where((a[y0:y1]>0.5).any(0))[0]
            if len(colsT) and len(colsR): errs.append(abs((colsR.max()-colsR.min())-(colsT.max()-colsT.min()))/(colsT.max()-colsT.min()))
        res.append(dict(f=k,cos=round(best,3),iou=round(iou(a),3),larg=round(float(np.mean(errs)),3) if errs else None,sz=p[0],pitch=p[1],base=p[2],cx=p[3]))
    res.sort(key=lambda r:-r['cos'])
    print('==',nome,'sublinhados',uls,'t',round(time.time()-t0,1))
    for r in res[:8]: print(' ',json.dumps(r,ensure_ascii=False))
    print('  -- catalogo:')
    for r in [x for x in res if x['f'].startswith('CAT')]: print(' ',json.dumps(r,ensure_ascii=False))
    # tracking nas 3 primeiras
    for r in res[:3]:
        k=r['f'];fp,idx=(F[k],0) if k in F else SISTEMA[k]
        tb=max(((cos(rend(fp,r['sz'],r['pitch'],r['base'],r['cx'],tr=t/100,idx=idx)),t/100) for t in range(-3,4)))
        print('  tracking',k,round(tb[0],3),tb[1])
    json.dump(res,open(f"{nome}-fontes.json",'w'))
