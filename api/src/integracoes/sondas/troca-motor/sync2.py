# Sincronia por movimento: energia de movimento no ROI da boca (diferença entre frames, ROI estabilizado pelos cantos
# da boca do YuNet) x |variação| do envelope de áudio. Correlação com defasagem; baseline = clipe sem lipsync.
import sys, json, subprocess, numpy as np, cv2
M='/Users/gustagoat/Documents/AIS-OS/projects/maquina-anuncios/api/src/medicao/modelos/'
v,aud=sys.argv[1],sys.argv[2]
cap=cv2.VideoCapture(v); fps=cap.get(cv2.CAP_PROP_FPS); fs=[]
while True:
    ok,f=cap.read()
    if not ok: break
    fs.append(f)
h,w=fs[0].shape[:2]; det=cv2.FaceDetectorYN.create(M+'face_detection_yunet_2023mar.onnx','',(w,h),0.6)
crops=[]; open_=[]
for f in fs:
    _,faces=det.detect(f); fc=max(faces,key=lambda x:x[-1])
    cx=(fc[10]+fc[12])/2; cy=(fc[11]+fc[13])/2; s=abs(fc[12]-fc[10])
    c=cv2.cvtColor(f[int(cy-s*0.45):int(cy+s*0.45), int(cx-s*0.6):int(cx+s*0.6)],cv2.COLOR_BGR2GRAY)
    c=cv2.resize(c,(96,72)).astype(np.float32); crops.append(c)
    mid=c[:,30:66]; col=mid.mean(axis=1)            # perfil vertical no centro da boca
    open_.append(float((mid<np.median(c)-35).mean()+(mid>np.median(c)+45).mean()))  # escuro (boca aberta) + dentes
mot=np.array([0]+[float(np.abs(crops[i]-crops[i-1]).mean()) for i in range(1,len(crops))])
raw=subprocess.run(['ffmpeg','-v','error','-i',aud,'-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
a=np.frombuffer(raw,dtype=np.int16).astype(np.float32)/32768; hop=16000/fps
env=np.array([np.sqrt(np.mean(a[int(i*hop):int((i+1)*hop)]**2)) if int((i+1)*hop)<=len(a) else 0 for i in range(len(fs))])
denv=np.abs(np.diff(env,prepend=env[0]))
def best(x,y):
    r=[]
    for lag in range(-4,5):
        xa=x[max(0,lag):len(x)+min(0,lag)]; ya=y[max(0,-lag):len(y)-max(0,lag)]
        r.append((round(float(np.corrcoef(xa,ya)[0,1]),3),lag))
    return max(r), dict((l,c) for c,l in r)[0]
o=np.array(open_)
print(json.dumps({'v':v.split('/')[-1],'open_vs_env(best,lag0)':best(o,env),'motion_vs_denv':best(mot,denv)}))
