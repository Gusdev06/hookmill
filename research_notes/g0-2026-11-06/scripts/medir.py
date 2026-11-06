"""G0: régua da S4 (regua_caixa.py e regua_chrome.py) no original, na prova do Mac (dos PNG da S4) e na prova Linux.
Uso: medir.py <rótulo>   (lê saida/<rótulo>/, grava saida/<rótulo>/medidas.json)
Mac e Linux passam pela mesma medida, num quadro (caixa: mediana original de caixa_medir.py; solto: mínimo de 2 quadros).
O Linux passa por 1 geração x264 crf 10 bt709 (o Mac passou por 2: render e composição)."""
import cv2, numpy as np, json, os, sys, subprocess, tempfile
G0=os.path.dirname(os.path.dirname(os.path.abspath(__file__))); REF=os.path.join(G0,'ref'); S4=os.path.join(G0,'..','s4-demo-2026-11-06')
rot=sys.argv[1]; D=os.path.join(G0,'saida',rot)
rd=lambda f: cv2.imread(os.path.join(REF,f))
def x264(bgr):
    h,w=bgr.shape[:2]; pw,ph=w+(w&1),h+(h&1); img=cv2.copyMakeBorder(bgr,0,ph-h,0,pw-w,cv2.BORDER_REPLICATE)
    with tempfile.TemporaryDirectory() as t:
        f=os.path.join(t,'a.mp4')
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','bgr24','-s',f'{pw}x{ph}','-r','30','-i','-','-vf','scale=out_color_matrix=bt709:out_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p','-c:v','libx264','-crf','10','-pix_fmt','yuv420p',f],input=img.tobytes(),check=True)
        b=subprocess.run(['ffmpeg','-v','error','-i',f,'-vf','scale=in_color_matrix=bt709:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=bgr24','-f','rawvideo','-'],capture_output=True,check=True).stdout
    return np.frombuffer(b,np.uint8)[:pw*ph*3].reshape(ph,pw,3)[:h,:w].copy()
# ---- régua da caixa (regua_caixa.py, num quadro)
def mask(med,sub):
    BH=med.shape[0]; bgl=cv2.medianBlur(med,min(BH|1,101)); le=np.abs(med.astype(np.int16)-bgl.astype(np.int16)).mean(2)>40
    core=cv2.erode(le.astype(np.uint8),np.ones((3,3),np.uint8))>0; tx=np.median(med[core],0).astype(np.float32); bg=bgl.astype(np.float32); v=tx-bg
    al=np.clip(((med.astype(np.float32)-bg)*v).sum(2)/np.maximum((v*v).sum(2),1),0,1)
    for a,b in sub: al[a-1:b+1]=0
    return al
def stem(al):
    m=(al>.5).astype(np.uint8); dt=cv2.distanceTransform(m,cv2.DIST_L2,3); return 2*float(np.percentile(dt[dt>0],90))
def larg(al,lim=.5,minp=3,minh=8):
    prj=(al>lim).sum(1); out=[]; y=0
    while y<len(prj):
        if prj[y]>minp:
            a=y
            while y<len(prj) and prj[y]>minp:y+=1
            if y-a>minh:
                c=np.where((al[a:y]>lim).any(0))[0]; out.append([int(a),int(y),int(c.min()),int(c.max()),int(c.max()-c.min()+1)])
        y+=1
    return out
RJ=json.load(open(os.path.join(S4,'medidas/regua-caixa.json')))
R={}
def comparar(nome, A_o, A_m, A_l, mac_json=None, extra=None):
    lm,ll=larg(A_m),larg(A_l)
    r=dict(corr_mac=round(float(np.corrcoef(A_o.ravel(),A_m.ravel())[0,1]),4), corr_linux=round(float(np.corrcoef(A_o.ravel(),A_l.ravel())[0,1]),4),
           corr_mac_x_linux=round(float(np.corrcoef(A_m.ravel(),A_l.ravel())[0,1]),4),
           traco_orig=round(stem(A_o),2), traco_mac=round(stem(A_m),2), traco_linux=round(stem(A_l),2),
           linhas_mac=lm, linhas_linux=ll)
    r['larg_dif_pct']=[round(100*(b[4]-a[4])/a[4],2) for a,b in zip(lm,ll)] if len(lm)==len(ll) else 'linhas diferentes'
    r['traco_dif_pct']=round(100*(r['traco_linux']-r['traco_mac'])/r['traco_mac'],2)
    r['passa']=dict(largura=isinstance(r['larg_dif_pct'],list) and max(abs(x) for x in r['larg_dif_pct'])<=1.0,
                    traco=abs(r['traco_dif_pct'])<=5.0, corr=r['corr_linux']>=r['corr_mac']-0.03)
    if mac_json: r['mac_s4_json']=mac_json
    if extra: r.update(extra)
    R[nome]=r
SUB={'02':[(153,159),(220,226)],'05':[],'06':[]}
REC=json.load(open(os.path.join(REF,'recortes.json')))
for v in ('02','05','06'):
    X,Y,BW,BH=REC[v]['box']; med=rd(f'caixa-{v}-med.png'); A_o=mask(med,SUB[v])
    st=cv2.imread(os.path.join(D,f'still-{v}.png'))[Y:Y+BH,X:X+BW]; st=x264(st); A_l=mask(st,SUB[v])
    # coluna do Mac com as palavras e a fonte escolhida: a mais parecida com a medida da S4 (largura das linhas)
    alvo=[l[4] for l in RJ[v][f'{v}-mesmas']['linhas']]; cols=[]
    for ci in range(1,REC[v]['colunas']):
        A=mask(rd(f'caixa-{v}-col{ci}.png'),SUB[v]); w=[l[4] for l in larg(A)]
        cols.append((sum(abs(a-b) for a,b in zip(w,alvo)) if len(w)==len(alvo) else 1e9, ci, A))
    cols.sort(key=lambda t:t[0]); _,ci,A_m=cols[0]
    mj=RJ[v][f'{v}-mesmas']; comparar(v,A_o,A_m,A_l,dict(cos=mj['cos'],traco=mj['traco'],larguras=[l[4] for l in mj['linhas']]),dict(coluna_mac=ci))
    cv2.imwrite(os.path.join(D,f'cmp-{v}.png'),np.vstack([med,rd(f'caixa-{v}-col{ci}.png'),st]))
# ---- solto (regua_chrome.py): limiar 110..235 no mínimo dos quadros, emoji fora
x0,y0,x1,y1=REC['solto']['roi']; EM=356-x0
alf=lambda g: np.clip((g.astype(np.float32)-110)/125,0,1)
def A_de(imgs):
    m=np.min(np.stack([cv2.cvtColor(i,cv2.COLOR_BGR2GRAY) for i in imgs]),0); A=alf(m); A[:,EM:]=0; return A
O=[rd(f'solto-original-q{i}.png') for i in (0,1)]; M=[rd(f'solto-mac-q{i}.png') for i in (0,1)]
rgba=cv2.imread(os.path.join(D,'still-solto.png'),cv2.IMREAD_UNCHANGED)[y0:y1,x0:x1].astype(np.float32)
a=rgba[...,3:4]/255.0
L=[]
for m in M:   # fundo = a prova do Mac sem a tinta (inpaint), que é a placa
    # tinta = alfa da prova Linux (mesmo lugar) ∪ contraste local da prova do Mac; sem limiar de brilho (a pele é clara)
    g=cv2.cvtColor(m,cv2.COLOR_BGR2GRAY); loc=np.abs(g.astype(int)-cv2.medianBlur(g,21).astype(int))>25
    tinta=cv2.dilate(((a[...,0]>0.03)|loc).astype(np.uint8),np.ones((7,7),np.uint8))
    tinta[:,EM-4:]=0
    bg=cv2.inpaint(m,tinta,5,cv2.INPAINT_TELEA).astype(np.float32)
    comp=np.clip(rgba[...,:3]*a+bg*(1-a),0,255).astype(np.uint8); L.append(x264(comp))
A_o,A_m,A_l=A_de(O),A_de(M),A_de(L)
# corr e tinta: régua da S4 (limiar). Traço e largura: régua robusta da caixa (mask, fundo pela mediana local), por faixa de
# linha fixa (corte em y=565, entre as linhas de base 557 e 590), emoji fora; coluna conta com >= 2 px de tinta.
def rob(imgs):
    A=mask(np.min(np.stack(imgs),0),[]); A[:,EM:]=0; return A
def letras(A):   # só componentes do tamanho de letra/palavra: a mão e a pele clara do fundo saem
    n,lab,st,_=cv2.connectedComponentsWithStats((A>.5).astype(np.uint8),8); k=np.zeros(n,bool)
    for i in range(1,n): k[i]=st[i,3]<=30 and st[i,2]<=130 and st[i,4]>=6
    return np.where(k[lab],A,0)
# janela da linha: alfa verdadeiro do PNG Linux (transparente) ± 10 px; a mão do fundo (x 4-9) fica de fora
JAN=[]
for a_,b_ in ((0,565-y0),(565-y0,y1-y0)):
    c=np.where((a[a_:b_,:EM,0]>.5).sum(0)>=2)[0]; JAN.append((int(c.min())-10,int(c.max())+10))
def faixas(A,corte=565-y0):
    A=letras(A); out=[]
    for (a,b),(j0,j1) in zip(((0,corte),(corte,A.shape[0])),JAN):
        B=np.zeros_like(A); B[:,max(0,j0):j1+1]=A[:,max(0,j0):j1+1]
        c=np.where(((B[a:b]>.5).sum(0))>=2)[0]; out.append([a,b,int(c.min()),int(c.max()),int(c.max()-c.min()+1)])
    return out
R_o,R_m,R_l=rob(O),rob(M),rob(L)
comparar('solto',A_o,A_m,A_l,dict(cos=0.876,tinta=1.069,largura_pct=1.3),
         dict(tinta_mac=round(float(A_m.sum()/A_o.sum()),3),tinta_linux=round(float(A_l.sum()/A_o.sum()),3)))
r=R['solto']; lm,ll=faixas(R_m),faixas(R_l)
r.update(janela=JAN,alfa_linux_png=[[j0+10,j1-10,j1-j0-19] for j0,j1 in JAN],linhas_mac=lm,linhas_linux=ll,larg_dif_pct=[round(100*(b[4]-a[4])/a[4],2) for a,b in zip(lm,ll)],
         larg_orig=[x[4] for x in faixas(R_o)],traco_orig=round(stem(R_o),2),traco_mac=round(stem(R_m),2),traco_linux=round(stem(R_l),2))
r['traco_dif_pct']=round(100*(r['traco_linux']-r['traco_mac'])/r['traco_mac'],2)
r['passa']=dict(largura=max(abs(x) for x in r['larg_dif_pct'])<=1.0, traco=abs(r['traco_dif_pct'])<=5.0, corr=r['corr_linux']>=r['corr_mac']-0.03)
cv2.imwrite(os.path.join(D,'cmp-solto.png'),cv2.resize(np.vstack([O[0],M[0],L[0]]),None,fx=3,fy=3,interpolation=cv2.INTER_NEAREST))
# ---- +Y no clipe de 10 quadros com base em placa (A8): mediana de render − base fora da tinta, 3 quadros
clip=os.path.join(D,'clipe-placa-10q.mp4'); base='/tmp/g0-public/midia/g0-base.mp4'
def Yq(f):
    b=subprocess.run(['ffmpeg','-v','error','-i',f,'-vf','format=gray','-f','rawvideo','-'],capture_output=True,check=True).stdout
    return np.frombuffer(b,np.uint8).reshape(-1,832,464)
yc,yb=Yq(clip),Yq(base); dif=[]
for q in (2,5,8):
    d=yc[q].astype(np.float32)-yb[q].astype(np.float32)
    tinta=cv2.dilate((np.abs(d)>6).astype(np.uint8),np.ones((9,9),np.uint8)).astype(bool); tinta[515:610,50:420]=True
    dif.append(float(np.median(d[~tinta])))
med_=float(np.median(dif)); y=-round(med_)
R['maisY']=dict(quadros=int(len(yc)), mediana_render_menos_base=round(med_,3), por_quadro=[round(x,3) for x in dif], y=y, mac=dict(mediana=-1.65,y=2),
                 passa=dict(y_entre_menos4_e_4=-4<=y<=4, quadros_10=len(yc)==10))
json.dump(R,open(os.path.join(D,'medidas.json'),'w'),indent=1)
for k,r in R.items(): print(k, {q:r[q] for q in r if q not in ('linhas_mac','linhas_linux')})
