"""mede salto temporal na faixa em volta de um corte de pedaço: PSNR entre quadro t-1 e t, antes e depois, no 4 pedaços e na referência"""
import sys,subprocess,numpy as np
sys.path.insert(0,'scripts'); from comparar import fr,psnr
A,B,y0,y1=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4]); cs=[int(x) for x in sys.argv[5].split(',')]
W,H=[int(x) for x in subprocess.check_output(["ffprobe","-v","error","-select_streams","v","-show_entries","stream=width,height","-of","csv=p=0",A]).decode().strip().split(",")[:2]]
pa=pb=None;d={}
for t,(a,b) in enumerate(zip(fr(A,W,H),fr(B,W,H))):
    if t and any(abs(t-c)<=3 for c in cs): d[t]=(round(psnr(a[y0:y1],pa),1),round(psnr(b[y0:y1],pb),1))
    pa,pb=a[y0:y1].copy(),b[y0:y1].copy()
    if t>max(cs)+4: break
for t in sorted(d): print(t,'4p',d[t][0],'ref',d[t][1])
