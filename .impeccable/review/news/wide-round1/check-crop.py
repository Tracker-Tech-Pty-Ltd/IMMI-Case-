from PIL import Image
im=Image.open('.impeccable/review/news/wide-round1/desktop.png')
im=im.resize((1127,round(im.height*1127/im.width)),Image.Resampling.LANCZOS)
im.crop((216,76,371,116)).resize((620,160)).save('.impeccable/review/news/wide-round1/expected-page-title.png')
print(im.size)
