from pathlib import Path
from PIL import Image
p=Path('.impeccable/review/news/21st-motion-20261017')
im=Image.open(p/'wide-raw.png')
size=(1440,round(im.height*1440/im.width))
im.resize(size,Image.Resampling.LANCZOS).save(p/'wide.png')
print(im.size,size)
