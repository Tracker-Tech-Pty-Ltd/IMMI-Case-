from pathlib import Path
from PIL import Image
import json
p=Path('.impeccable/review/core-21st-20261017')
records=json.loads((p/'frames.json').read_text())
frames=[]
for r in records:
 im=Image.open(p/'frames'/r['file']).convert('RGB')
 frames.append(im.resize((800,round(im.height*800/im.width)),Image.Resampling.LANCZOS))
palette=frames[0].quantize(colors=128)
frames=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
durations=[max(10,round((b['timestamp']-a['timestamp'])*100)*10) for a,b in zip(records,records[1:])]+[700]
frames[0].save(p/'motion-demo.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=True)
print(json.dumps({'capturedFrames':len(records),'displayWidth':800,'gifBytes':(p/'motion-demo.gif').stat().st_size}))

