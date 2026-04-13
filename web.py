#!/usr/bin/env python3
"""Start the IMMI-Case web interface.

Usage:
    python web.py                    # Start (BACKEND_PORT env or 8080)
    python web.py --port 8080        # Custom port (overrides env)
    python web.py --output mydata    # Custom data directory
"""

import argparse
import os
import warnings

# Cloudflare Containers block DNS at the network level (UDP port 53 is filtered).
# resolv.conf changes have no effect. Patch socket.getaddrinfo to return hardcoded
# IPs for known hostnames so httpx / supabase-py can connect without DNS.
if os.environ.get("APP_ENV") == "production":
    import re
    import socket as _socket

    _supabase_url = os.environ.get("SUPABASE_URL", "")
    _supabase_host_match = re.match(r"https?://([^/]+)", _supabase_url)
    _supabase_host = _supabase_host_match.group(1) if _supabase_host_match else ""

    # Supabase REST API is served via Cloudflare CDN (anycast).
    # IPs resolved on 2026-04-13 from outside the container.
    _STATIC_DNS: dict[str, list[str]] = {}
    if _supabase_host:
        _STATIC_DNS[_supabase_host] = ["104.18.38.10", "172.64.149.246"]

    _orig_getaddrinfo = _socket.getaddrinfo

    def _cf_dns_patch(host, port, *args, **kwargs):
        if host in _STATIC_DNS:
            results = []
            for ip in _STATIC_DNS[host]:
                try:
                    results.extend(_orig_getaddrinfo(ip, port, *args, **kwargs))
                except OSError:
                    pass
            if results:
                return results
        return _orig_getaddrinfo(host, port, *args, **kwargs)

    _socket.getaddrinfo = _cf_dns_patch

from immi_case_downloader.webapp import create_app


def _get_env_default_port() -> int:
    """Read backend port from environment with safe fallback."""
    raw = os.environ.get("BACKEND_PORT")
    if not raw:
        return 8080

    try:
        port = int(raw)
    except ValueError:
        warnings.warn(
            f"Invalid BACKEND_PORT={raw!r}; falling back to 8080.",
            RuntimeWarning,
            stacklevel=2,
        )
        return 8080

    if not 1 <= port <= 65535:
        warnings.warn(
            f"BACKEND_PORT out of range ({port}); falling back to 8080.",
            RuntimeWarning,
            stacklevel=2,
        )
        return 8080

    return port


def main():
    default_port = _get_env_default_port()

    parser = argparse.ArgumentParser(description="IMMI-Case Web Interface")
    parser.add_argument(
        "--port",
        type=int,
        default=default_port,
        help=f"Port (default: {default_port}; env: BACKEND_PORT)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to listen on (default: 127.0.0.1; use --host 0.0.0.0 to expose externally)",
    )
    parser.add_argument("--output", default="downloaded_cases", help="Data directory")
    parser.add_argument(
        "--backend", default="auto",
        choices=["auto", "sqlite", "csv", "supabase"],
        help="Storage backend (default: auto)",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    args = parser.parse_args()

    if args.debug and args.host == "0.0.0.0":
        warnings.warn(
            "Running in debug mode with public host 0.0.0.0 — "
            "this exposes the debugger to the network. "
            "Use --host 127.0.0.1 for safety.",
            RuntimeWarning,
            stacklevel=1,
        )

    app = create_app(output_dir=args.output, backend=args.backend)
    print(f"Starting IMMI-Case web interface at http://{args.host}:{args.port}")
    print(f"Data directory: {args.output}")
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
