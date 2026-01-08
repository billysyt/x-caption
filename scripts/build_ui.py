#!/usr/bin/env python3
"""
Build the React UI bundle into static/ui/ (used by Flask + PyInstaller).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def main() -> int:
    root = _repo_root()
    ui_dir = root / "ui"

    if not ui_dir.exists():
        print(f"[ERR] UI folder not found: {ui_dir}")
        return 2

    npm_path = shutil.which("npm")
    if not npm_path:
        print("[ERR] npm not found. Install Node.js (includes npm) to build the UI.")
        return 2

    env = os.environ.copy()

    subprocess.run([npm_path, "install"], cwd=str(ui_dir), check=True, env=env)
    subprocess.run([npm_path, "run", "build"], cwd=str(ui_dir), check=True, env=env)

    print("[OK] UI built into static/ui/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
