"""Retain all imagegen originals and make small alpha-preserving web copies."""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PUBLIC = ROOT / "frontend/public/assets/legal-codex-stickers"
ORIGINALS = HERE / "originals"
ORIGINALS.mkdir(exist_ok=True)
manifest_path = HERE / "source-map.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
checks = []
for asset in manifest["assets"]:
    name = f'{asset["id"]}-{asset["mode"]}'
    original = ROOT / asset.get("original", f"docs/news-updates-design-20261016/sticker-assets/originals/{name}.png")
    copied = PUBLIC / f"{name}.png"
    if not original.exists():
        copied.rename(original)
    with Image.open(original) as image:
        image.load()
        if image.mode != "RGBA":
            raise ValueError(f"Missing alpha: {name}")
        histogram = image.getchannel("A").histogram()
        if histogram[0] == 0 or histogram[255] == 0:
            raise ValueError(f"Blank or opaque output: {name}")
        size = image.size
        web = image.copy()
        web.thumbnail((256, 256), Image.Resampling.LANCZOS)
        output = ROOT / asset.get("path", f"frontend/public/assets/legal-codex-stickers/{name}.webp")
        web.save(output, "WEBP", quality=90, method=6, exact=True)
    with Image.open(output) as web_check:
        if web_check.mode != "RGBA" or web_check.getextrema()[3][0] != 0:
            raise ValueError(f"Lost alpha: {name}")
    asset["original"] = original.relative_to(ROOT).as_posix()
    asset["path"] = output.relative_to(ROOT).as_posix()
    asset["originalFileSha256"] = hashlib.sha256(original.read_bytes()).hexdigest().upper()
    asset["webFileSha256"] = hashlib.sha256(output.read_bytes()).hexdigest().upper()
    checks.append({"id": asset["id"], "mode": asset["mode"], "originalSize": size,
                   "transparentPixelRatio": histogram[0] / (size[0] * size[1]),
                   "webSize": list(web.size), "webBytes": output.stat().st_size,
                   "original": asset["original"], "web": asset["path"]})
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(HERE / "alpha-and-size-checks.json").write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"generated": len(checks), "uniqueSubjects": len({x["id"] for x in checks}),
                  "webBytes": sum(x["webBytes"] for x in checks), "allTransparent": True}))
