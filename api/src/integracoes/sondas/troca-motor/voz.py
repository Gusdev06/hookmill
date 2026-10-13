# Voz consistente entre janelas? Embedding de locutor (Resemblyzer, cosseno) par a par + F0 mediana (Praat) +
# transcrição local (Whisper small). Referência de escala: o mesmo cálculo entre as 2 falantes do campeão.
import sys, json, subprocess, tempfile, os, numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav
import parselmouth, whisper
enc=VoiceEncoder(verbose=False); wm=whisper.load_model('small')
def wav(path, ss=None, t=None):
    f=tempfile.mktemp(suffix='.wav')
    a=['ffmpeg','-v','error','-y']+(['-ss',str(ss)] if ss is not None else [])+(['-t',str(t)] if t else [])+['-i',path,'-ac','1','-ar','16000',f]
    subprocess.run(a,check=True); return f
def feat(f):
    e=enc.embed_utterance(preprocess_wav(f))
    p=parselmouth.Sound(f).to_pitch(); f0=p.selected_array['frequency']; f0=f0[f0>0]
    return e, float(np.median(f0)) if len(f0) else None
items=[]
for arg in sys.argv[1:]:
    label,path,*rng=arg.split('|')
    f=wav(path,*(map(float,rng) if rng else []))
    e,f0=feat(f)
    txt=wm.transcribe(f,language='en',fp16=False)['text'].strip()
    items.append((label,e,f0,txt)); os.remove(f)
for l,e,f0,t in items: print(json.dumps({'clip':l,'f0_median_hz':round(f0,1) if f0 else None,'whisper':t}))
print('cosseno (embedding de locutor):')
labels=[i[0] for i in items]
print('            '+' '.join(f'{l[:10]:>10}' for l in labels))
for a in items: print(f'{a[0][:11]:<11} '+' '.join(f'{float(np.dot(a[1],b[1])):10.3f}' for b in items))
