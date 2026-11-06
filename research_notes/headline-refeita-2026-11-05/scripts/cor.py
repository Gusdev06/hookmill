import subprocess,numpy as np
def fr(p,pf):
    r=subprocess.run(['ffmpeg','-v','error','-ss','7','-i',p,'-frames:v','3','-f','rawvideo','-pix_fmt',pf,'-'],capture_output=True);return r.stdout
a=np.frombuffer(fr('origem/original.mp4','rgb24'),np.uint8).reshape(-1,832,464,3).astype(float);b=np.frombuffer(fr('headline-refeita.mp4','rgb24'),np.uint8).reshape(-1,832,464,3).astype(float)
print('rgb sinal',(b-a).mean((0,1,2)),'abs',np.abs(b-a).mean())
import cv2
c=cv2.VideoCapture('origem/original.mp4');_,f=c.read();print('cv2 BGR amostra',f[100,100], 'ffmpeg rgb',np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i','origem/original.mp4','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],capture_output=True).stdout,np.uint8).reshape(832,464,3)[100,100])
