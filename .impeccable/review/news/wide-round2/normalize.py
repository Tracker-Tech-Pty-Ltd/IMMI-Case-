from PIL import Image
from pathlib import Path
p=Path('.impeccable/review/news/wide-round2')
for name,width in [('english-dark',1440),('mobile',390)]:
 im=Image.open(p/f'{name}-raw.png')
 im.resize((width,round(im.height*width/im.width)),Image.Resampling.LANCZOS).save(p/f'{name}.png')
