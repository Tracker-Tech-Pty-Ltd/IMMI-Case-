from pathlib import Path
from PIL import Image
p=Path('.impeccable/review/news/wide-round3')
for name,width in [('desktop',1440),('proportional-1440',1440),('hero',1127),('width-1280',1280),('width-1600',1600),('english-dark',1440),('english-dark-expanded',1440),('mobile',390),('mobile-full',390)]:
 im=Image.open(p/f'{name}-raw.png')
 size=(width,round(im.height*width/im.width))
 im.resize(size,Image.Resampling.LANCZOS).save(p/f'{name}.png')
 print(name,im.size,size)
