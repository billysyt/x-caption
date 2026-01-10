#!/usr/bin/env python3
"""
Prepare Node.js runtime for packaging.

Copies the platform-appropriate Node binary into ./node so PyInstaller
bundles it with the app. Source can be provided via:
- --source argument
- XCAPTION_NODE_RUNTIME / XCAPTION_NODE / XCAPTION_NODE_SOURCE env vars
- `node` found on PATH
"""
from __future__ import annotations

import argparse
import os
import shutil
import stat
import sys
from pathlib import Path
from typing import Optional


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _candidate_names() -> list[str]:
    return ["node.exe", "node"] if os.name == "nt" else ["node"]


def _find_node_binary(source: Optional[Path]) -> Optional[Path]:
    if source:
        if source.exists():
            if source.is_file():
                return source
            if source.is_dir():
                for name in _candidate_names():
                    candidates = [source / name, source / "bin" / name]
                    for candidate in candidates:
                        if candidate.exists() and candidate.is_file():
                            return candidate

    env_source = (
        os.environ.get("XCAPTION_NODE_RUNTIME")
        or os.environ.get("XCAPTION_NODE")
        or os.environ.get("XCAPTION_NODE_SOURCE")
    )
    if env_source:
        return _find_node_binary(Path(env_source).expanduser())

    which = shutil.which("node")
    if which:
        return Path(which)
    return None


def _target_path(dest_root: Path) -> Path:
    if os.name == "nt":
        return dest_root / "node.exe"
    return dest_root / "bin" / "node"


def _ensure_executable(path: Path) -> None:
    if os.name == "nt":
        return
    try:
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage Node.js runtime for packaging.")
    parser.add_argument("--source", help="Path to node binary or its parent directory.")
    parser.add_argument("--dest", help="Destination directory (default: ./node)")
    args = parser.parse_args()

    root = _repo_root()
    dest_root = Path(args.dest).expanduser() if args.dest else root / "node"
    source_path = Path(args.source).expanduser() if args.source else None

    node_bin = _find_node_binary(source_path)
    if not node_bin or not node_bin.exists():
        print("[ERR] Node.js binary not found. Install Node or set XCAPTION_NODE_RUNTIME.")
        return 2

    target = _target_path(dest_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        try:
            target.chmod(target.stat().st_mode | stat.S_IWUSR)
        except OSError:
            pass
        try:
            target.unlink()
        except OSError:
            pass
    shutil.copy2(node_bin, target)
    _ensure_executable(target)

    print(f"[OK] Staged Node.js runtime: {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
