"""Prepare the reviewed document twins without replacing the previous originals."""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PUBLIC = ROOT / "frontend/public/assets/legal-codex-stickers"
revision = json.loads((HERE / "document-v2-prompts.json").read_text(encoding="utf-8"))
checks = []
for item in revision["assets"]:
    original = HERE / "originals" / f'document-v2-{item["mode"]}.png'
    if not original.exists():
        shutil.copyfile(item["source"].replace("C:\\", "/mnt/c/").replace("\\", "/"), original)
    with Image.open(original) as image:
        assert image.mode == "RGBA"
        alpha = image.getchannel("A").histogram()
        assert alpha[0] > 0 and alpha[255] > 0
        web = image.copy()
        web.thumbnail((256, 256), Image.Resampling.LANCZOS)
        output = PUBLIC / f'document-v2-{item["mode"]}.webp'
        web.save(output, "WEBP", quality=90, method=6, exact=True)
        checks.append({"mode": item["mode"], "originalSize": image.size, "webSize": web.size,
                       "transparentPixelRatio": alpha[0] / (image.width * image.height),
                       "alphaRange": image.getextrema()[3]})
    item["original"] = original.relative_to(ROOT).as_posix()
    item["path"] = output.relative_to(ROOT).as_posix()
    item["generatedFileSha256"] = hashlib.sha256(original.read_bytes()).hexdigest()
(HERE / "document-v2-prompts.json").write_text(json.dumps(revision, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "document-v2-alpha.json").write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
print(json.dumps(checks))
