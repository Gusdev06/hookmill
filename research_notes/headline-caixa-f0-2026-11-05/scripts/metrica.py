# escolha de fonte SEM desenhar em producao: tabela de razoes por fonte (feita offline) x medidas da mascara
import glob,json,os,numpy as np,cv2
from PIL import Image,ImageDraw,ImageFont
exec(open('fontes.py').read().split("def casos")[0])
for p in glob.glob('gf/*.woff2'): F['G '+os.path.basename(p)[:-6]]=p
def razoes(fp):
    f=ImageFont.truetype(fp,200)
    def alt(t):
        im=Image.new('L',(800,600),0);d=ImageDraw.Draw(im);d.text((100,400),t,font=f,fill=255,anchor='ls');a=np.array(im)>128;r=np.where(a.any(1))[0];return (400-r.min())/200
    im=Image.new('L',(2600,500),0);d=ImageDraw.Draw(im);d.text((50,350),'minutos nuncabe',font=f,fill=255,anchor='ls');a=(np.array(im)>128).astype(np.uint8)
    dt=cv2.distanceTransform(a,cv2.DIST_L2,3);st=2*np.percentile(dt[dt>0],90)/200
    return dict(x=alt('x'),cap=alt('H'),stem=float(st))
T={k:razoes(v) for k,v in F.items()}
C={'v02':dict(orig=["Si en 2 minutos no te","busca, es porque","nunca fue para ti.."],ul=[(153,158),(220,225)],txt=(244,252,253),base=[72,139,206]),
   'v06':dict(orig=["Él ya está con otra? Te","propongo algo. Si en 7 días","no te busca, dime mentirosa"],ul=[],txt=(255,255,247),base=[39,73,107])}
for nome,c in C.items():
    med=cv2.imread(f"{nome}-med.png");H,W=med.shape[:2];bg=cv2.medianBlur(med,min(H|1,101)).astype(np.float32);tx=np.array(c['txt'][::-1],np.float32);v=tx-bg
    al=np.clip(((med.astype(np.float32)-bg)*v).sum(2)/np.maximum((v*v).sum(2),1),0,1)
    for a,b in c['ul']: al[a-1:b+1]=0
    m=(al>.5).astype(np.uint8)
    dt=cv2.distanceTransform(m,cv2.DIST_L2,3);stem=2*float(np.percentile(dt[dt>0],90))
    # larguras e x-height por linha (projecao)
    W_i=[];xh=[]
    pr=m.sum(1)
    for b in c['base']:
        y0=max(0,int(b-0.9*(c['base'][1]-c['base'][0])));y1=min(H,b+1)
        cols=np.where(m[y0:y1].any(0))[0];W_i.append(int(cols.max()-cols.min()))
        p=pr[y0:y1];lim=0.5*np.percentile(p,90);r=np.where(p>lim)[0];xh.append(int(y1-y0-r.min()) if len(r) else 0)
    xh_m=float(np.median(xh))
    out=[]
    for k,fp in F.items():
        f=ImageFont.truetype(fp,100)
        adv=[f.getlength(l)/100 for l in c['orig']]
        s=float(np.dot(W_i,adv)/np.dot(adv,adv));res=float(np.mean([abs(s*a-w)/w for a,w in zip(adv,W_i)]))
        t=T[k];e_x=abs(s*t['x']/xh_m-1);e_s=abs(s*t['stem']/stem-1)
        out.append((round(res*2+e_x+e_s,3),k,round(s,1),round(res,3),round(e_x,3),round(e_s,3)))
    out.sort()
    print(nome,'W',W_i,'xh',xh,'stem',round(stem,1))
    for o in out[:8]:print(' ',o)
    print('  CAT:',[o for o in out if o[1].startswith('CAT')][:3])
    r=json.load(open(f"{nome}-fontes2.json"));pos={x['f']:i for i,x in enumerate(r)}
    print('  ranking raster dos 5 primeiros da metrica:',[(o[1],pos.get(o[1])) for o in out[:5]])
    print('  hoje stem raster:',[(x['f'],x['stem']) for x in r if x['f'] in('CAT inter-800','CAT roboto-condensed-700','+ montserrat-600','+ montserrat-500')])
