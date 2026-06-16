#!/usr/bin/env python3
"""Brave Image Search → judge photo discovery pipeline.

For each judge in judge_bios.json:
  1. Run brave_image_search via docker mcp gateway
  2. Filter results: drop stock-photo/profile-farm domains, require min 200x200
  3. Score by source-domain authority (.gov.au > .edu.au > conference > news)
  4. Output top-3 candidates per judge to JSON manifest for review

After review, human marks approved=true on rows, then `--download` will fetch them.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path('/Users/d/Developer/IMMI-Case-')
BIOS = ROOT / 'downloaded_cases' / 'judge_bios.json'
PHOTOS = ROOT / 'downloaded_cases' / 'judge_photos'
MANIFEST = ROOT / 'downloaded_cases' / 'judge_photo_manifest.json'

BLOCK_DOMAINS = (
    'istockphoto', 'gettyimages', 'shutterstock', 'alamy', 'newsnow.io',
    'rocketreach', 'zoominfo', 'placeholder', 'mixrank', 'cloudfront.net/profile',
    'wp-content/uploads/.*-logo', 'static.rocketreach',
)
PREFER_DOMAINS = {  # higher = more trust
    '.gov.au': 100, '.edu.au': 90, '.org.au': 80, '.asn.au': 80,
    'coatconference': 95, 'aph.gov.au': 100, 'art.gov.au': 100,
    'fedcourt.gov.au': 100, 'sclqld.org.au': 90, 'lawyersweekly': 60,
    'theguardian': 50, 'wikipedia': 70, 'wikimedia': 75,
}

def score_url(img_url: str, src_url: str) -> int:
    s = 10
    haystack = (img_url + ' ' + src_url).lower()
    if any(b in haystack for b in BLOCK_DOMAINS):
        return -1
    for k, v in PREFER_DOMAINS.items():
        if k in haystack:
            s = max(s, v)
    return s

def search(query: str) -> list:
    try:
        out = subprocess.run(
            ['docker', 'mcp', 'tools', 'call', 'brave_image_search', f'query={query}'],
            capture_output=True, text=True, timeout=20,
        ).stdout
        # strip "Tool call took:" prefix line
        json_start = out.find('{')
        if json_start < 0:
            return []
        return json.loads(out[json_start:]).get('items', [])
    except Exception as e:
        print(f'    SEARCH ERROR: {e}', file=sys.stderr)
        return []

def candidates_for(name: str, role: str, court: str) -> list:
    # Try 2 query variants
    queries = [
        f'"{name}" {role}',
        f'"{name}" {court[:40]} Australia member',
    ]
    seen, out = set(), []
    for q in queries:
        for item in search(q):
            url = item.get('properties',{}).get('url','')
            if not url or url in seen:
                continue
            seen.add(url)
            w = item.get('properties',{}).get('width', 0) or 0
            h = item.get('properties',{}).get('height', 0) or 0
            if w < 200 or h < 200:
                continue
            score = score_url(url, item.get('url',''))
            if score < 0:
                continue
            out.append({
                'img_url': url, 'src_page': item.get('url',''),
                'title': (item.get('title','') or '')[:120],
                'w': w, 'h': h, 'conf': item.get('confidence'),
                'score': score, 'query': q,
            })
        time.sleep(0.5)
    out.sort(key=lambda x: -x['score'])
    return out[:3]

def main(limit=10):
    bios = json.loads(BIOS.read_text())
    todo = [(k,v) for k,v in bios.items() if not v.get('photo_url')][:limit]
    print(f'Pipeline: searching for {len(todo)} judges (no existing photo_url)')
    manifest = {}
    for name, b in todo:
        title = name.title()
        role = b.get('role','') or ''
        court = b.get('court','') or ''
        print(f'\n→ {title}  role="{role[:40]}"')
        cands = candidates_for(title, role, court)
        manifest[name] = cands
        for c in cands:
            print(f'  [{c["score"]:3d}|{c["w"]}x{c["h"]}] {c["img_url"][:80]}')
            print(f'    src={c["src_page"][:60]}')
    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f'\nManifest written: {MANIFEST}')
    print(f'Hit rate: {sum(1 for v in manifest.values() if v)} / {len(manifest)} judges have ≥1 candidate')

if __name__ == '__main__':
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    main(limit)
