#!/usr/bin/env python3
"""
Build the production artifacts:
- Builds the React UI into static/ui/
- Runs PyInstaller with xcaption_native.spec
"""

from __future__ import annotations

import importlib
import os
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def main() -> int:
    root = _repo_root()

    build_ui = root / "scripts" / "build_ui.py"
    spec = root / "xcaption_native.spec"

    if not build_ui.exists():
        print(f"[ERR] Missing script: {build_ui}")
        return 2
    if not spec.exists():
        print(f"[ERR] Missing PyInstaller spec: {spec}")
        return 2

    env = os.environ.copy()

    # Fail fast if yt-dlp is missing so Windows builds don't ship broken URL import.
    importlib.import_module("yt_dlp")

    if sys.platform == "win32":
        icon_builder = root / "scripts" / "build_icon_windows.py"
        if icon_builder.exists():
            subprocess.run([sys.executable, str(icon_builder)], cwd=str(root), check=True, env=env)

    subprocess.run([sys.executable, str(build_ui)], cwd=str(root), check=True, env=env)
    subprocess.run(
        [sys.executable, "-m", "PyInstaller", str(spec), "--clean", "--noconfirm"],
        cwd=str(root),
        check=True,
        env=env,
    )

    print("[OK] Release built in dist/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
