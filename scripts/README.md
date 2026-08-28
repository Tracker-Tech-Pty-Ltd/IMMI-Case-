# scripts/

Operational scripts. None of these run in CI or in production; they are
operator-invoked, and most of them read or write `downloaded_cases/`, which is
gitignored and not reproducible from this repository. Read the script's module
docstring before running it.

## Judge data

Run in this order when rebuilding judge data from scratch. Each step consumes the
previous step's output.

| Order | Script | Consumes | Produces |
|---|---|---|---|
| 1 | `fetch_judge_bios.py` | judge names from the case catalog | `downloaded_cases/judge_bios.json` (Gemini deep-research or grounding mode) |
| 2 | `fetch_judge_profile_images.py` | `downloaded_cases/judge_bios.json` | `downloaded_cases/judge_photos/<key>.jpg` + `photo_*` fields written back into `judge_bios.json` |
| 3 | `build_judge_name_overrides.py` | bios + official public listings | `immi_case_downloader/data/judge_name_overrides.json` |
| 4 | `backfill_judge_overrides_from_pdf.py` | an operator-supplied PDF (`--pdf`) | additional entries in `immi_case_downloader/data/judge_name_overrides.json` |

`fetch_judge_profile_images.py` is the **only** supported judge-photo pipeline.
A second, Brave-Image-Search-via-docker-mcp-gateway implementation
(`fetch_judge_photos.py`) was deleted: it hardcoded an absolute path that does
not exist and it depended on an MCP gateway that this repository does not
declare.

`reextract_judges.py` is a separate repair tool, not part of the pipeline above.
Do not pass it `--apply` without first reading the post-mortem in
`docs/JUDGE_DATA_QUALITY.md`.

## Deployment gates

`check_cloudflare_native_target.py` and `check_immi_activation_evidence.py` are
the authoritative, fail-closed specification of what a deployable Cloudflare
configuration looks like. When prose docs and these scripts disagree, the
scripts win.
