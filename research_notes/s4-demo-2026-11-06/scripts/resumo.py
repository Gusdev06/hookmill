#!/usr/bin/env python3
"""s4-resumo.mp4: capítulos com cartão, lado a lado, rótulos fora da imagem. O áudio é o do original no mesmo instante."""
import cv2, numpy as np, subprocess, os, json
from PIL import Image, ImageDraw, ImageFont
from comum import *
CW,CH=1600,900; FPS=30; LAB=66; ARIMO=P("remotion/public/fonts/arimo-600.woff")
T=P("saida/resumo"); os.makedirs(T,exist_ok=True)
def F(s): return ImageFont.truetype(ARIMO,s)
def txt(img,s,xy,size=26,cor=(255,255,255),anchor="mm"):
    im=Image.fromarray(img[...,::-1]); d=ImageDraw.Draw(im); d.text(xy,s,font=F(size),fill=cor,anchor=anchor); return np.array(im)[...,::-1].copy()
def card(n,tit,sub,seg=1.8):
    c=np.full((CH,CW,3),14,np.uint8); c=txt(c,tit,(CW//2,CH//2-40),54)
    for i,s in enumerate(sub): c=txt(c,s,(CW//2,CH//2+30+i*42),30,(190,190,190))
    p=f"{T}/{n:02d}.mp4"; e=encoder(p,CW,CH,crf="18",preset="fast")
    for _ in range(int(seg*FPS)): e.stdin.write(c.tobytes())
    e.stdin.close(); e.wait()
    r=subprocess.run(["ffmpeg","-v","error","-y","-i",p,"-f","lavfi","-i","anullsrc=r=44100:cl=stereo","-t",str(seg),"-c:v","copy","-c:a","aac","-b:a","128k",p+".mp4"]); os.replace(p+".mp4",p); return p
def painel(fs,cols):
    """cols: (W,H,roi,label); escala pra caber em altura útil, todas com a mesma altura"""
    H_=CH-LAB; imgs=[]
    for f,(roi,label) in zip(fs,cols):
        if roi: x0,y0,x1,y1=roi; f=f[y0:y1,x0:x1]
        imgs.append((f,label))
    gap=10; somaAR=sum(a.shape[1]/a.shape[0] for a,_ in imgs); h=min(H_,int((CW-gap*(len(imgs)-1))/somaAR)); c=np.full((CH,CW,3),14,np.uint8)
    w_tot=sum(int(a.shape[1]*h/a.shape[0]) for a,_ in imgs)+gap*(len(imgs)-1); x=(CW-w_tot)//2; y=(H_-h)//2
    pos=[]
    for a,l in imgs:
        w=int(a.shape[1]*h/a.shape[0]); r=cv2.resize(a,(w,h),interpolation=cv2.INTER_AREA if w<a.shape[1] else cv2.INTER_LANCZOS4); c[y:y+h,x:x+w]=r; pos.append((x+w//2,l)); x+=w+gap
    return c,pos
def rot(c,pos):
    for x,l in pos: c=txt(c,l,(x,CH-LAB//2),24)
    return c
def seg(n,arqs,ini,fim,audio,tema=None,zoom=None):
    """arqs: [(path,W,H,roi,label)]; zoom: [(path,W,H,roi,label)] empilhados à direita"""
    gs=[frames(a[0],a[1],a[2],ini=ini,n=fim-ini) for a in arqs]; gz=[frames(a[0],a[1],a[2],ini=ini,n=fim-ini) for a in (zoom or [])]
    p=f"{T}/{n:02d}.mp4"; e=encoder(p,CW,CH,crf="16",preset="medium")
    for fr in zip(*(gs+gz)):
        fs=list(fr[:len(arqs)]); fz=list(fr[len(arqs):])
        if zoom:
            L=CW-660; H_=CH-LAB; c=np.full((CH,CW,3),14,np.uint8); gap=10; w=(L-gap*len(arqs))//len(arqs)
            x=0; pos=[]
            for f,a in zip(fs,arqs):
                h=int(a[2]*w/a[1]); c[(H_-h)//2:(H_-h)//2+h,x:x+w]=cv2.resize(f,(w,h),interpolation=cv2.INTER_AREA); pos.append((x+w//2,a[4])); x+=w+gap
            hz=(H_-gap*(len(zoom)-1))//len(zoom); yz=0
            for f,a in zip(fz,zoom):
                x0,y0,x1,y1=a[3]; cr=f[y0:y1,x0:x1]; s=min(650/(x1-x0),(hz-34)/(y1-y0)); r=cv2.resize(cr,None,fx=s,fy=s,interpolation=cv2.INTER_LANCZOS4)
                c[yz+30:yz+30+r.shape[0],L+5:L+5+r.shape[1]]=r; c=txt(c,a[4],(L+5,yz+15),22,(255,255,255),"lm"); yz+=hz+gap
            c=rot(c,pos)
        else:
            c,pos=painel(fs,[(a[3],a[4]) for a in arqs]); c=rot(c,pos)
        e.stdin.write(c.tobytes())
    e.stdin.close(); e.wait()
    r=subprocess.run(["ffmpeg","-v","error","-y","-i",p,"-ss",str(ini/30),"-t",str((fim-ini)/30),"-i",audio,"-map","0:v","-map","1:a?","-af","apad","-t",str((fim-ini)/30),"-c:v","copy","-c:a","aac","-b:a","128k",p+".mp4"],capture_output=True); os.replace(p+".mp4",p); return p
A=P("origem/aprovada.mp4"); O=P("origem/original.mp4"); so=lambda k:P(f"saida/solto/{k}.mp4"); ca=lambda k:P(f"saida/caixa/{k}.mp4"); le=lambda k:P(f"saida/legenda/{k}.mp4")
S2=P("../limpar-legenda-teste-2026-11-05-s2/inteiros")
Z=(40,525,430,615); o=[]; n=0
def add(p): o.append(p)
add(card(1,"1. A pergunta: a versão de servidor continua aprovada?",["Mesma peça: Helvetica + emoji da Apple × Arimo 600 + emoji recortado, em Remotion"]))
add(seg(2,[(A,464,832,None,"APROVADA (Pillow)"),(so("aprovada"),464,832,None,"SERVIDOR (Remotion)")],0,174,O,zoom=[(A,464,832,Z,"aprovada"),(so("aprovada"),464,832,Z,"servidor"),(O,464,832,Z,"original")]))
add(card(3,"2. Emoji: recortado × original (ampliado 6×)",["Ele fica. Sai do próprio quadro, sem fonte da Apple"]))
E_=(340,560,400,600); add(seg(4,[(O,464,832,E_,"ORIGINAL"),(A,464,832,E_,"APROVADA (Apple)"),(so("aprovada"),464,832,E_,"RECORTADO, frase nova"),(so("prova-originais"),464,832,E_,"RECORTADO, mesmas palavras")],40,100,O))
add(card(5,"3. Solta: texto mais longo e mais curto",["Longo: 3 linhas, sobe, encosta no queixo. Curto: o apagado fica à vista"]))
add(seg(6,[(so("longa"),464,832,None,"MAIS LONGA"),(so("curta"),464,832,None,"MAIS CURTA"),(so("minima"),464,832,None,"1 LINHA")],0,165,O))
add(card(7,"4. Caixa: 05, 06 e 02",["Original | mesmas palavras | novas | mais longa ou mais curta"]))
add(seg(8,[(P("origem/c05.mp4"),720,1280,None,"05 ORIGINAL"),(ca("05-mesmas"),720,1280,None,"MESMAS"),(ca("05-novo"),720,1280,None,"NOVAS"),(ca("05-longa"),720,1280,None,"MAIS LONGA")],30,210,P("origem/c05.mp4")))
add(seg(9,[(P("origem/c06.mp4"),720,960,None,"06 ORIGINAL"),(ca("06-mesmas"),720,960,None,"MESMAS"),(ca("06-novo"),720,960,None,"NOVAS"),(ca("06-curta"),720,960,None,"MAIS CURTA")],200,355,P("origem/c06.mp4")))
add(seg(10,[(P("origem/c02.mp4"),716,1278,None,"02 ORIGINAL"),(ca("02-mesmas"),716,1278,None,"MESMAS"),(ca("02-novo"),716,1278,None,"NOVAS"),(ca("02-longa"),716,1278,None,"MAIS LONGA")],40,215,P("origem/c02.mp4")))
add(card(11,"5. Faixa translúcida do 02: parada × por quadro",["Parada é 1 imagem pequena. Por quadro pede placa em vídeo. Olhe o vulto da cabeça atrás do texto"]))
B=(0,0,716,250); add(seg(12,[(P("origem/c02.mp4"),716,1278,B,"ORIGINAL"),(ca("02-novo"),716,1278,B,"PARADA"),(ca("02-novo-porquadro"),716,1278,B,"POR QUADRO")],0,205,P("origem/c02.mp4")))
add(card(13,"6. Legenda W1: Pillow × Remotion (13)",["Sombra dura e karaokê. Mesmas páginas e mesmos tempos"]))
Lr=(0,300,720,700); add(seg(14,[(P("work-leg/v13.mp4"),720,960,None,"ORIGINAL"),(f"{S2}/13-E2-W1-tr-inteiro.mp4",720,960,None,"PILLOW (a que vc viu)"),(le("13-W1-webkit"),720,960,None,"REMOTION")],210,450,P("work-leg/v13.mp4")))
add(card(15,"7. Pausa de fala no 02",["Hoje a página some e o apagado aparece. Teste: a página fica até a próxima frase"]))
add(seg(16,[(P("work-leg/v02.mp4"),716,1278,None,"ORIGINAL"),(le("02-W1-sombras"),716,1278,None,"PÁGINA SOME"),(le("02-W1-sombras-pausa"),716,1278,None,"PÁGINA FICA")],480,600,P("work-leg/v02.mp4")))
for p in o:
    print(os.path.basename(p),[subprocess.run(["ffprobe","-v","error","-select_streams",t,"-show_entries","stream=duration","-of","csv=p=0",p],capture_output=True,text=True).stdout.strip() for t in "va"])
ent=sum((["-i",p] for p in o),[]); fc="".join(f"[{i}:v][{i}:a]" for i in range(len(o)))+f"concat=n={len(o)}:v=1:a=1[v][a]"
r=subprocess.run(["ffmpeg","-v","error","-y",*ent,"-filter_complex",fc,"-map","[v]","-map","[a]","-c:v","libx264","-crf","17","-preset","medium","-pix_fmt","yuv420p","-colorspace","bt709","-color_primaries","bt709","-color_trc","bt709","-color_range","tv","-c:a","aac","-b:a","128k","-movflags","+faststart",P("s4-resumo.mp4")],capture_output=True,text=True); print(r.stderr[-300:])
