#!/usr/bin/env python3
"""Materialise signed operator configs beside the sources their paths describe.

The original bytes are preserved so activation config digests remain valid.
This script only writes local files and never contacts Cloudflare.
"""

from __future__ import annotations

import base64
import binascii
import os
from pathlib import Path
import sys
import tomllib


def materialize(workspace: Path) -> dict[str, Path]:
    workspace = workspace.resolve()
    plans: list[tuple[str, Path, bytes]] = []
    for role, key in (("MAIN", "MAIN_CONFIG_B64"), ("PIPELINE", "PIPELINE_CONFIG_B64")):
        try:
            raw = base64.b64decode("".join(os.environ[key].split()), validate=True)
            config = tomllib.loads(raw.decode("utf-8"))
        except (KeyError, ValueError, UnicodeError, binascii.Error, tomllib.TOMLDecodeError) as exc:
            raise ValueError(f"{role} config is missing or invalid") from exc
        entry = config.get("main")
        if role == "MAIN" and entry == "workers/cloudflare-native.js":
            directory = workspace
        elif role == "PIPELINE" and entry == "src/index.ts":
            directory = workspace / "workers/austlii-scraper"
        elif role == "PIPELINE" and entry == "workers/austlii-scraper/src/index.ts":
            directory = workspace
        else:
            raise ValueError(f"{role} config has an unsupported source entry")
        directory = directory.resolve()
        if not directory.is_relative_to(workspace) or not (directory / entry).is_file():
            raise ValueError(f"{role} config does not resolve to a source file in this checkout")
        plans.append((f"IMMI_NATIVE_{role}_CONFIG", directory / f".immi-native-{role.lower()}.toml", raw))

    created: list[Path] = []
    try:
        for _, destination, raw in plans:
            descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(destination)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(raw)
    except OSError:
        for destination in created:
            destination.unlink(missing_ok=True)
        raise
    return {key: path for key, path, _ in plans}


def main() -> int:
    try:
        paths = materialize(Path(os.environ.get("GITHUB_WORKSPACE", Path(__file__).resolve().parents[1])))
        output = "".join(f"{key}={path}\n" for key, path in paths.items())
        if os.environ.get("GITHUB_ENV"):
            with Path(os.environ["GITHUB_ENV"]).open("a", encoding="utf-8") as handle:
                handle.write(output)
        else:
            print(output, end="")
    except (OSError, ValueError) as exc:
        print(f"Native config materialisation blocked: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
