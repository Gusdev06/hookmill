import cv2,sys,numpy as np
A=cv2.VideoCapture('origem/original.mp4');B=cv2.VideoCapture('headline-refeita.mp4')
alvos=[int(x) for x in sys.argv[2:]];lin=[]
for i in range(max(alvos)+1):
    _,a=A.read();_,b=B.read()
    if i in alvos:
        c=np.vstack([a[525:607,50:420],b[525:607,50:420]])
        lin.append(cv2.resize(c,None,fx=3,fy=3,interpolation=cv2.INTER_LANCZOS4))
cv2.imwrite(sys.argv[1],np.vstack(lin))
