"""Create a local OFL font subset from the actual bilingual UI and news copy."""
import hashlib
import json
from pathlib import Path

from fontTools import subset

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
source = HERE / "NotoSerifTC-original.ttf"
inputs = [ROOT / "frontend/src/i18n/locales/en.json", ROOT / "frontend/src/i18n/locales/zh-TW.json", ROOT / "frontend/src/data/news.json"]
text = "".join(path.read_text(encoding="utf-8") for path in inputs)
options = subset.Options()
options.flavor = "woff2"
options.name_IDs = ["*"]
options.name_legacy = True
options.name_languages = ["*"]
font = subset.load_font(str(source), options)
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
output = ROOT / "frontend/public/fonts/codex-serif-tc-ui.woff2"
subset.save_font(font, str(output), options)
report = {"source": "https://github.com/google/fonts/tree/main/ofl/notoseriftc", "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
          "output": output.relative_to(ROOT).as_posix(), "bytes": output.stat().st_size,
          "inputCharacters": len(set(text)), "license": "SIL Open Font License 1.1", "subsetInputs": [str(p.relative_to(ROOT)) for p in inputs]}
(HERE / "provenance.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report))
