"""Add decoder-readable prompt metadata without re-encoding image pixels."""
import hashlib
import json
import struct
import zlib
from pathlib import Path
from xml.sax.saxutils import escape
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
path = HERE / "source-map.json"
manifest = json.loads(path.read_text(encoding="utf-8-sig"))
proof = []

def pixels(file):
    with Image.open(file) as image:
        return hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest()

def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

for asset in manifest["assets"]:
    provenance = json.dumps({"tool": "built-in image_gen", "source": asset["source"],
                             "generatedFileSha256": asset["generatedFileSha256"]}, ensure_ascii=True)
    original = ROOT / asset["original"]
    web = ROOT / asset["path"]
    before = pixels(original)
    data = original.read_bytes()
    chunks = [data[:8]]
    offset = 8
    inserted = False
    while offset + 12 <= len(data):
        size = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        raw = data[offset:offset + 12 + size]
        if kind == b"IDAT" and not inserted:
            chunks += [png_chunk(b"tEXt", b"impeccable:prompt\0" + asset["prompt"].encode("latin-1")),
                       png_chunk(b"tEXt", b"codex:provenance\0" + provenance.encode("ascii"))]
            inserted = True
        if kind == b"IEND":
            chunks.append(raw)
            break
        # Retain the exact compressed image chunks; replace only our own text metadata.
        if not (kind == b"tEXt" and (b"impeccable:prompt\0" in raw or b"codex:provenance\0" in raw)):
            chunks.append(raw)
        offset += 12 + size
    original.write_bytes(b"".join(chunks))
    after = pixels(original)
    assert before == after
    with Image.open(original) as check:
        assert check.info["impeccable:prompt"] == asset["prompt"]
    proof.append({"path": asset["original"], "pixelHashBefore": before, "pixelHashAfter": after, "unchanged": True})

    before = pixels(web)
    data = web.read_bytes()
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    chunks = []
    offset = 12
    has_extended = False
    while offset + 8 <= len(data):
        kind, size = data[offset:offset + 4], struct.unpack("<I", data[offset + 4:offset + 8])[0]
        payload = data[offset + 8:offset + 8 + size]
        if kind == b"VP8X":
            payload = bytes([payload[0] | 0x04]) + payload[1:]
            has_extended = True
        if kind != b"XMP ":
            chunks.append(kind + struct.pack("<I", len(payload)) + payload + (b"\0" if len(payload) % 2 else b""))
        offset += 8 + size + size % 2
    if not has_extended:
        with Image.open(web) as image:
            payload = bytes([0x14, 0, 0, 0]) + (image.width - 1).to_bytes(3, "little") + (image.height - 1).to_bytes(3, "little")
        chunks.insert(0, b"VP8X" + struct.pack("<I", len(payload)) + payload)
    xmp = ('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
           '<rdf:Description xmlns:codex="https://openai.com/codex/asset-provenance/1.0/">'
           f'<codex:prompt>{escape(asset["prompt"])}</codex:prompt><codex:provenance>{escape(provenance)}</codex:provenance>'
           '</rdf:Description></rdf:RDF></x:xmpmeta>').encode("utf-8")
    chunks.append(b"XMP " + struct.pack("<I", len(xmp)) + xmp + (b"\0" if len(xmp) % 2 else b""))
    body = b"WEBP" + b"".join(chunks)
    web.write_bytes(b"RIFF" + struct.pack("<I", len(body)) + body)
    after = pixels(web)
    assert before == after
    with Image.open(web) as check:
        assert asset["prompt"].encode("utf-8") in check.info["xmp"]
    proof.append({"path": asset["path"], "pixelHashBefore": before, "pixelHashAfter": after, "unchanged": True})
    asset["originalFileSha256"] = hashlib.sha256(original.read_bytes()).hexdigest().upper()
    asset["webFileSha256"] = hashlib.sha256(web.read_bytes()).hexdigest().upper()

path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
revision = {"assets": [a for a in manifest["assets"] if a["id"] == "document"]}
(HERE / "document-v2-prompts.json").write_text(json.dumps(revision, indent=2) + "\n", encoding="utf-8")
(HERE / "metadata-pixel-preservation.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"metadataFiles": len(proof), "allPixelsUnchanged": True}))
