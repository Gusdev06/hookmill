import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
HN="/System/Library/Fonts/HelveticaNeue.ttc";SS=4
ROI=(30,525,450,607);x0,y0,x1,y1=ROI
cap=cv2.VideoCapture('origem/original.mp4');g=[]
for i in range(161):
    ok,f=cap.read();g.append(cv2.cvtColor(f[y0:y1,x0:x1],cv2.COLOR_BGR2GRAY))
mn=np.min(np.stack(g),0).astype(np.float32)
print('pico cinza letras',mn.max(), 'p99',np.percentile(mn[mn>205],99),'mediana letras',np.median(mn[mn>205]))
T=np.clip((mn-90)/(245-90),0,1)
H,W=T.shape
def lin(F,t,cx,by,st,sig):
    im=Image.new('L',(W*SS,H*SS),0);d=ImageDraw.Draw(im);l=F.getlength(t)
    d.text(((cx-x0-l/SS/2)*SS,(by-y0)*SS),t,font=F,fill=255,anchor='ls',stroke_width=st,stroke_fill=255)
    a=cv2.resize(np.array(im,np.float32)/255,(W,H),interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(a,(0,0),sig)
for nome,t,zona,cx0,by0 in (('L1','How to view your man’s',(0,36),233,557),('L2','recent following on IG',(38,80),216,590)):
    best=[]
    a_,b_=zona
    for sz in (26,26.25,26.5,26.75,27):
        F=ImageFont.truetype(HN,sz*SS,index=10)
        for st in (0,1,2):
            for sig in (.4,.55):
                for by in np.arange(by0-2.5,by0+2.5,.25):
                    for cx in np.arange(cx0-1.5,cx0+1.6,.25):
                        A=lin(F,t,cx,by,st,sig)
                        r=np.corrcoef(A[a_:b_].ravel(),T[a_:b_].ravel())[0,1]
                        best.append((round(float(r),4),sz,st,sig,float(by),float(cx)))
    best.sort(reverse=True);print(nome,best[:5])
