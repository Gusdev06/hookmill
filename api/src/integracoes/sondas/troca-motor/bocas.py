import sys, numpy as np, cv2
M='/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/api/src/medicao/modelos/'
out=sys.argv[1]; vids=sys.argv[2:]
rows=[]
for v in vids:
    cap=cv2.VideoCapture(v); fps=cap.get(cv2.CAP_PROP_FPS); fs=[]
    while True:
        ok,f=cap.read()
        if not ok: break
        fs.append(f)
    h,w=fs[0].shape[:2]; det=cv2.FaceDetectorYN.create(M+'face_detection_yunet_2023mar.onnx','',(w,h),0.6)
    cells=[]
    for k in range(32):
        t=k*0.125; i=min(len(fs)-1,int(round(t*fps))); f=fs[i]
        _,faces=det.detect(f); fc=max(faces,key=lambda x:x[-1])
        cx=(fc[10]+fc[12])/2; cy=(fc[11]+fc[13])/2; s=abs(fc[12]-fc[10])*1.3
        c=f[int(cy-s*0.6):int(cy+s*0.6), int(cx-s):int(cx+s)]
        c=cv2.resize(c,(120,72))
        cv2.putText(c,f'{t:.2f}',(2,12),cv2.FONT_HERSHEY_SIMPLEX,0.35,(0,255,255),1)
        cells.append(c)
    rows.append(np.vstack([np.hstack(cells[:16]),np.hstack(cells[16:])]))
cv2.imwrite(out,np.vstack(rows))
