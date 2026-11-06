import sys; sys.argv=['x','medir']
exec(open('scripts/montar.py').read().replace('if __name__ == "__main__": main()',''))
n,ini,fim,m=medir(); h,w=next(frames()).shape[:2]; inp=mascara(m,(h,w))
fs={i:f for i,f in enumerate(frames()) if i in (10,90,158)}
print(emoji_rgba(20).size)
lin=[]
for i,f in fs.items():
    pl=limpo(f,inp)
    a,sh,e,g=camadas(w,h,L_ANTIGAS,{"h":20,"w":emoji_rgba(20).width,"gap":9,"y":571},(1.3,0,1,.4))
    print('geo',[round(v,1) for v in g])
    r=compor(pl,a,sh,e,245)
    k=(inp>0); print('erro',np.abs(r[k].astype(float)-f[k]).mean())
    lin.append(np.vstack([f[525:607,40:430],pl[525:607,40:430],r[525:607,40:430]]))
cv2.imwrite('quadros/recria.png',cv2.resize(np.hstack(lin[:2]),None,fx=1.5,fy=1.5,interpolation=cv2.INTER_CUBIC))
