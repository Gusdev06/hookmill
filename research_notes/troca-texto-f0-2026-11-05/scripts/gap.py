import cv2,numpy as np,subprocess,json
W,H=464,832
d=subprocess.Popen(['ffmpeg','-v','error','-i','origem/original.mp4','-vf','format=gray','-f','rawvideo','-pix_fmt','gray','-'],stdout=subprocess.PIPE)
fs=[]
while True:
    b=d.stdout.read(W*H)
    if len(b)<W*H:break
    fs.append(np.frombuffer(b,np.uint8).reshape(H,W))
fs=np.stack(fs); print(fs.shape)
m=cv2.imread('quadros/mascara.png',0)>0; ys=np.where(m.any(1))[0]; print('mascara y',ys.min(),ys.max(),'x',np.where(m.any(0))[0][[0,-1]])
gaps=[]
for i in range(0,161):
    c=(fs[i,ys.max()+1:ys.max()+90,40:430]>205); yy=np.where(c.sum(1)>6)[0]
    if len(yy): gaps.append(int(yy.min())+1)
print('gap máscara→1º px claro abaixo: min',min(gaps),'p50',np.median(gaps),'n',len(gaps),'de 161')
ring=(cv2.dilate(m.astype(np.uint8),np.ones((15,15),np.uint8))>0)&~m
st=fs[0:161].astype(np.float32); sd=st.std(0)
print('desvio temporal no anel: média %.2f p99 %.1f'%(sd[ring].mean(),np.percentile(sd[ring],99)))
med=np.median(st,0); print('detalhe espacial no anel (dp): %.1f'%med[ring].std())
d2=np.abs(st-med); print('|q-mediana| no anel: média %.2f p99 %.1f'%(d2[:,ring].mean(),np.percentile(d2[:,ring],99)))
