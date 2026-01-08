#!/usr/bin/env python3
"""
Developer runner:
- Starts the Python desktop app (backend + PyWebView window)
- Starts the React Vite dev server with HMR

One command for live UI development (no rebuild/restart needed for frontend changes).
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _pick_free_port(host: str, start_port: int, max_tries: int = 50) -> int:
    port = int(start_port)
    for _ in range(max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
                return port
            except OSError:
                port += 1
    raise RuntimeError(f"No free port found starting at {start_port} (tried {max_tries} ports).")


def _kill_process_tree(proc: subprocess.Popen[object]) -> None:
    if proc.poll() is not None:
        return

    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                check=False,
                capture_output=True,
            )
        except Exception:
            proc.terminate()
        return

    try:
        proc.terminate()
        proc.wait(timeout=5)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _ensure_npm(ui_dir: Path) -> None:
    npm_path = shutil.which("npm")
    if not npm_path:
        raise RuntimeError("npm not found. Install Node.js (includes npm) to use the React dev server.")

    node_modules = ui_dir / "node_modules"
    lockfile = ui_dir / "package-lock.json"
    installed_lock = node_modules / ".package-lock.json"

    if node_modules.exists() and installed_lock.exists() and lockfile.exists():
        try:
            if lockfile.stat().st_mtime <= installed_lock.stat().st_mtime:
                return
        except OSError:
            pass
    elif node_modules.exists() and not lockfile.exists():
        return

    print("[DEV] Installing/updating UI dependencies...")
    subprocess.run([npm_path, "install"], cwd=str(ui_dir), check=True)


def _npm_cmd() -> str:
    npm_path = shutil.which("npm")
    if not npm_path:
        raise RuntimeError("npm not found. Install Node.js (includes npm) to use the React dev server.")
    return npm_path


def _vite_cmd(ui_dir: Path) -> list[str]:
    """
    Return the local Vite CLI command.

    On Windows, invoking `npm run dev -- --port ...` can drop `--port/--host` flags in some environments.
    Calling the local `node_modules/.bin/vite(.cmd)` directly is the most reliable.
    """

    suffix = ".cmd" if os.name == "nt" else ""
    vite_bin = ui_dir / "node_modules" / ".bin" / f"vite{suffix}"
    if vite_bin.exists():
        return [str(vite_bin)]

    npm = _npm_cmd()
    return [npm, "run", "dev", "--"]


def _resolve_backend_python(root: Path) -> str:
    override = os.environ.get("XCAPTION_BACKEND_PYTHON")
    if override:
        return override

    if sys.platform == "darwin":
        candidate = root / ".venv" / "bin" / "python"
        if candidate.exists():
            return str(candidate)
        candidate = root / ".venv312" / "bin" / "python"
        if candidate.exists():
            return str(candidate)

    return sys.executable


def main() -> int:
    parser = argparse.ArgumentParser(description="Run X-Caption with React HMR (Vite).")
    parser.add_argument(
        "--port",
        type=int,
        default=5173,
        help="Vite dev server port (default: 5173). If unavailable, the script will auto-pick the next free port.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Vite dev server host (default: 127.0.0.1).")
    args = parser.parse_args()

    root = _repo_root()
    ui_dir = root / "ui"
    launcher = root / "xcaption_launcher.py"

    if not ui_dir.exists():
        print(f"[ERR] UI folder not found: {ui_dir}")
        return 2
    if not launcher.exists():
        print(f"[ERR] Launcher not found: {launcher}")
        return 2

    _ensure_npm(ui_dir)

    env = os.environ.copy()
    if sys.platform == "darwin":
        env["PYWEBVIEW_GUI"] = "cocoa"

    port = _pick_free_port(args.host, args.port)
    ui_url = f"http://{args.host}:{port}/static/ui/"
    env["XCAPTION_UI_DEV_URL"] = ui_url

    print(f"[DEV] Starting Vite dev server at {ui_url} ...")
    vite_cmd = _vite_cmd(ui_dir)
    vite_proc = subprocess.Popen(
        [*vite_cmd, "--host", args.host, "--port", str(port), "--strictPort"],
        cwd=str(ui_dir),
        env=env,
    )

    print("[DEV] Starting X-Caption launcher...")
    backend_python = _resolve_backend_python(root)
    print(f"[DEV] Using backend python: {backend_python}")
    launcher_proc = subprocess.Popen(
        [backend_python, str(launcher)],
        cwd=str(root),
        env=env,
    )

    try:
        while True:
            launcher_code = launcher_proc.poll()
            if launcher_code is not None:
                return int(launcher_code)

            vite_code = vite_proc.poll()
            if vite_code is not None:
                print(f"[DEV] Vite dev server exited (code {vite_code}).")
                return int(vite_code)

            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n[DEV] Shutting down...")
        return 0
    finally:
        _kill_process_tree(launcher_proc)
        _kill_process_tree(vite_proc)


if __name__ == "__main__":
    raise SystemExit(main())
