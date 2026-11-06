#!/usr/bin/env python3
# Adaptado de cp108-headlines-textos-2026-10-08/conferir.py: decodifica tudo, compara por zona e confere md5 do áudio.
import subprocess, numpy as np, cv2
O='origem/original.mp4'; P='headline-refeita.mp4'; H,W=832,464
def fr(p):
    r=subprocess.run(['ffmpeg','-v','error','-i',p,'-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True)
    assert not r.stderr, r.stderr[:300]
    return np.frombuffer(r.stdout,np.uint8).reshape(-1,H,W,3)
def md5a(p): return subprocess.run(['ffmpeg','-v','error','-i',p,'-map','0:a','-c','copy','-f','md5','-'],capture_output=True,text=True).stdout.strip()
a=fr(O); b=fr(P); print('quadros',a.shape[0],b.shape[0]); print('audio igual',md5a(O)==md5a(P),md5a(P))
INI,FIM=0,160
m=cv2.imread('quadros/mascara.png',0)>0
# zona onde a nova foi escrita (sombra + letras)
fora=~cv2.dilate(m.astype(np.uint8)*255,np.ones((9,9),np.uint8)).astype(bool)
d=np.abs(a.astype(np.int16)-b.astype(np.int16)).mean(3)
print('intervalo, fora da mascara: media %.2f max-quadro %.2f'%(np.mean([d[i][fora].mean() for i in range(INI,FIM+1)]),max(d[i][fora].mean() for i in range(INI,FIM+1))))
print('intervalo, legenda y>=600: media %.2f max-quadro %.2f pico-px %.0f'%(d[INI:FIM+1,600:].mean(),d[INI:FIM+1,600:].mean((1,2)).max(),d[INI:FIM+1,600:].max()))
print('fora do intervalo 161..563: media %.2f max-quadro %.2f'%(d[FIM+1:].mean(),d[FIM+1:].mean((1,2)).max()))
print('primeiro quadro sem mudança real:', next(i for i in range(561) if d[i][m].mean()<3))
# ghost: letras antigas fora do novo texto, depois da limpeza. Correlação entre alto-passa do quadro e a letra antiga.
import importlib.util
g=lambda x:cv2.cvtColor(x,cv2.COLOR_RGB2GRAY).astype(np.float32)
fs=[]
import sys
sys.argv=['x','medir']; src=open('scripts/montar.py').read().replace('if __name__ == "__main__": main()',''); exec(src)
velho,*_=camadas(W,H,L_ANTIGAS,sig=.6); novo,sn,en,_=camadas(W,H,L_NOVAS,EMOJI)
livre=(velho>.5)&(cv2.dilate((novo>.1).astype(np.uint8),np.ones((5,5),np.uint8))==0)
print('px letra antiga fora do texto novo',int(livre.sum()))
ghost_o=[];ghost_r=[]
for i in range(0,161,10):
    for arr,lst in ((a,ghost_o),(b,ghost_r)):
        x=g(arr[i]); hp=x-cv2.GaussianBlur(x,(0,0),5); lst.append(hp[livre].mean())
print('contraste nas letras antigas livres (alto-passa, níveis): original %.1f | refeita %.1f'%(np.mean(ghost_o),np.mean(ghost_r)))
