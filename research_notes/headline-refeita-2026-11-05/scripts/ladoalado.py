from PIL import Image,ImageDraw,ImageFont
W=464;im=Image.new('RGB',(W*3+16,48),(18,18,18));d=ImageDraw.Draw(im);F=ImageFont.truetype('/System/Library/Fonts/HelveticaNeue.ttc',24,index=10)
for i,t in enumerate(('ORIGINAL','REPROVADA','REFEITA')):
    x=i*(W+8)+W/2;d.text((x,24),t,font=F,fill=(255,255,255),anchor='mm')
im.save('quadros/rotulos.png')
