#!/usr/bin/env python3
"""Compatibility wrapper for the Cloudflare-native IMMI deploy gate.

The old implementation required a second Supabase project and target
Hyperdrive IDs. Those are not part of the final architecture; the only deploy
target is the operator-supplied native D1/R2/Vectorize/Queue config.
"""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(scripts_dir))
    from check_cloudflare_native_target import main as native_target_main

    return native_target_main([])


if __name__ == "__main__":
    raise SystemExit(main())
