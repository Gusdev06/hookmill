import sys
sys.argv=['x','medir']
src=open('scripts/montar.py').read().replace('if __name__ == "__main__": main()','')
exec(src)
n,ini,fim,m=medir(); h,w=next(frames()).shape[:2]
fs=[f for i,f in enumerate(frames()) if i in (20,100,160)]
lin=[]
for d in (5,7):
    DILATA=d; inp=mascara(m,(h,w))
    lin.append(np.hstack([limpo(f,inp)[525:607,60:400] for f in fs]))
cv2.imwrite('quadros/placas.png',cv2.resize(np.vstack(lin),None,fx=1.6,fy=1.6,interpolation=cv2.INTER_CUBIC))
