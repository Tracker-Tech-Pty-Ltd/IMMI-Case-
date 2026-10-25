from pathlib import Path
from PIL import Image
root=Path('.impeccable/review/news/assets-round2')
for name,w,h in [('desktop',1440,1400),('english-dark',1440,1400),('english-expanded',1440,1400),('mobile-viewport',390,845)]:
 im=Image.open(root/f'{name}-raw.png')
 im.resize((w,h),Image.Resampling.LANCZOS).save(root/f'{name}.png')
print('Normalized original screenshots to measured CSS viewport; raw files retained.')
