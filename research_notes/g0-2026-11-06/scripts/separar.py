"""Acha painéis (separadores brancos de 6 px) nos PNG da S4."""
import cv2, numpy as np, sys
def paineis(img):
    g = img.min(2)
    def cortes(eixo):
        full = (g == 255).all(axis=eixo)
        seg=[];i=0;n=len(full)
        while i<n:
            if not full[i]:
                a=i
                while i<n and not full[i]: i+=1
                seg.append((a,i))
            i+=1
        return seg
    return cortes(0), cortes(1)
if __name__=='__main__':
    for f in sys.argv[1:]:
        im=cv2.imread(f); c,r=paineis(im); print(f, 'cols',c,'rows',r)
