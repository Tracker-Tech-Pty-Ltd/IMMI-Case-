"""Audit active shipped assets without altering their pixels or prompt metadata."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE / "source-map.json").read_text(encoding="utf-8-sig"))
checks = []
for asset in manifest["assets"]:
    original, web = ROOT / asset["original"], ROOT / asset["path"]
    assert hashlib.sha256(original.read_bytes()).hexdigest().upper() == asset["originalFileSha256"]
    assert hashlib.sha256(web.read_bytes()).hexdigest().upper() == asset["webFileSha256"]
    assert asset["prompt"]
    with Image.open(original) as image, Image.open(web) as optimized:
        assert image.mode == optimized.mode == "RGBA"
        alpha = image.getchannel("A").histogram()
        assert alpha[0] > 0 and alpha[255] > 0
        assert optimized.getextrema()[3] == (0, 255)
        checks.append({"id": asset["id"], "mode": asset["mode"], "originalSize": image.size,
                       "transparentPixelRatio": alpha[0] / (image.width * image.height),
                       "webSize": optimized.size, "webBytes": web.stat().st_size,
                       "original": asset["original"], "web": asset["path"], "hashesMatch": True})
(HERE / "alpha-and-size-checks.json").write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"activeImages": len(checks), "subjects": len({x["id"] for x in checks}),
                  "archivedVariants": len(manifest["archivedVariants"]),
                  "allTransparent": True, "webBytes": sum(x["webBytes"] for x in checks)}))
