"""Start the three isolated Council demo services without changing .env files."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import queue
import shutil
import socket
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
VITE = FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"


def check_ports_available(ports: list[int]) -> None:
    if len(set(ports)) != len(ports):
        raise ValueError("Mock, bridge and UI ports must be different.")
    sockets = []
    try:
        for port in ports:
            if not 1 <= port <= 65535:
                raise ValueError("Ports must be between 1 and 65535.")
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sockets.append(sock)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError as exc:
                raise ValueError(f"Port {port} is unavailable; no demo services were started.") from exc
    finally:
        for sock in sockets:
            sock.close()


def _ready_process(command: list[str], cwd: Path, env: dict[str, str], marker: str) -> subprocess.Popen:
    process = subprocess.Popen(
        command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    lines: queue.Queue[str | None] = queue.Queue()
    ready = threading.Event()

    def read_output() -> None:
        assert process.stdout is not None
        for line in process.stdout:
            if not ready.is_set():
                lines.put(line)
        if not ready.is_set():
            lines.put(None)

    threading.Thread(target=read_output, daemon=True).start()
    deadline = time.monotonic() + 30
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("A demo service stopped before it became ready.")
            try:
                line = lines.get(timeout=0.1)
            except queue.Empty:
                continue
            if line is None:
                raise RuntimeError("A demo service stopped before it became ready.")
            if marker in line:
                ready.set()
                return process
        raise RuntimeError("A demo service did not start within 30 seconds.")
    except BaseException:
        stop_services([process])
        raise


def stop_services(processes: list[subprocess.Popen]) -> None:
    for process in reversed(processes):
        if process.poll() is not None:
            continue
        if os.name == "nt":
            # Vite may launch esbuild. Limit the termination to the specific
            # child tree created by this launcher, never by port or name.
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        else:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def start_services(mock_port: int, bridge_port: int, ui_port: int) -> list[subprocess.Popen]:
    python = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    node = shutil.which("node")
    if not python.is_file() or not VITE.is_file() or not node:
        raise RuntimeError("Project .venv, Node, or the installed Vite package is missing.")
    check_ports_available([mock_port, bridge_port, ui_port])
    # Caller-supplied VITE_ variables cannot redirect or alter this demo.
    env = {key: value for key, value in os.environ.items() if not key.upper().startswith("VITE_")}
    env["PYTHONIOENCODING"] = "utf-8"
    env["NO_COLOR"] = "1"
    processes: list[subprocess.Popen] = []
    try:
        processes.append(_ready_process([str(python), "-u", str(ROOT / "scripts/local_openai_mock.py"),
                                         "--port", str(mock_port)], ROOT, env, "SIMULATED local API:"))
        processes.append(_ready_process([str(python), "-u", str(ROOT / "scripts/local_council_demo.py"),
                                         "--port", str(bridge_port), "--openai-port", str(mock_port)],
                                        ROOT, env, "Council demo on"))
        vite_env = dict(env, VITE_COUNCIL_DEMO="true", VITE_API_PROXY_TARGET=f"http://127.0.0.1:{bridge_port}")
        processes.append(_ready_process([node, str(VITE), "--host", "127.0.0.1", "--port", str(ui_port), "--strictPort"],
                                        FRONTEND, vite_env, "ready in"))
        return processes
    except BaseException:
        stop_services(processes)
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description="Start the isolated, fixed-response Council demonstration.")
    parser.add_argument("--mock-port", type=int, default=8766)
    parser.add_argument("--bridge-port", type=int, default=8767)
    parser.add_argument("--ui-port", type=int, default=5188)
    args = parser.parse_args()
    try:
        services = start_services(args.mock_port, args.bridge_port, args.ui_port)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Demo did not start: {exc}", file=sys.stderr)
        return 1
    print(f"SIMULATED DEMO: http://127.0.0.1:{args.ui_port}/llm-council", flush=True)
    print("Fixed sample data only. Press Ctrl+C to stop all demo services.", flush=True)
    try:
        while True:
            if any(service.poll() is not None for service in services):
                print("A demo service stopped; shutting down the rest.", file=sys.stderr)
                return 1
            time.sleep(0.25)
    except KeyboardInterrupt:
        return 0
    finally:
        stop_services(services)


if __name__ == "__main__":
    raise SystemExit(main())
