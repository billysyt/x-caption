#!/usr/bin/env python3
"""Utility helpers for preparing Whisper model assets used by X-Caption."""
from __future__ import annotations

import argparse
import contextlib
import logging
import os
import sys
import time
import urllib.error
import urllib.request
import ssl
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

LOGGER = logging.getLogger(__name__)

try:
    import certifi  # type: ignore
except ImportError:
    certifi = None

ENV_MODEL_URL = "XCAPTION_WHISPER_MODEL_URL"
ENV_MODEL_FILE = "XCAPTION_WHISPER_MODEL_FILE"
ENV_WRITTEN_MODEL_URL = "XCAPTION_WHISPER_WRITTEN_MODEL_URL"
ENV_WRITTEN_MODEL_FILE = "XCAPTION_WHISPER_WRITTEN_MODEL_FILE"

DEFAULT_MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v2-q5_0.bin?download=true"
DEFAULT_MODEL_FILE = "ggml-large-v2-q5_0.bin"
DEFAULT_WRITTEN_MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
DEFAULT_WRITTEN_MODEL_FILE = "ggml-base.bin"


@dataclass(frozen=True)
class WhisperModelInfo:
    url: str
    filename: str
    directory: Path
    path: Path


def get_whisper_model_info(models_root: Path) -> WhisperModelInfo:
    """Return resolved Whisper model settings for the given *models_root*."""
    url = os.environ.get(ENV_MODEL_URL, DEFAULT_MODEL_URL).strip()
    filename = os.environ.get(ENV_MODEL_FILE, DEFAULT_MODEL_FILE).strip()
    if not filename:
        filename = DEFAULT_MODEL_FILE
    directory = Path(models_root).resolve()
    path = directory / filename
    return WhisperModelInfo(url=url, filename=filename, directory=directory, path=path)


def get_whisper_written_model_info(models_root: Path) -> WhisperModelInfo:
    """Return resolved Whisper model settings for written Chinese output."""
    url = os.environ.get(ENV_WRITTEN_MODEL_URL, DEFAULT_WRITTEN_MODEL_URL).strip()
    filename = os.environ.get(ENV_WRITTEN_MODEL_FILE, DEFAULT_WRITTEN_MODEL_FILE).strip()
    if not filename:
        filename = DEFAULT_WRITTEN_MODEL_FILE
    directory = Path(models_root).resolve()
    path = directory / filename
    return WhisperModelInfo(url=url, filename=filename, directory=directory, path=path)


def _file_ready(path: Path) -> bool:
    try:
        return path.exists() and path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def whisper_model_status(models_root: Path) -> dict[str, object]:
    """Return a status payload for the Whisper model assets."""
    info = get_whisper_model_info(models_root)
    resolved_path: Optional[Path] = info.path if _file_ready(info.path) else None
    ready = resolved_path is not None
    if not ready:
        legacy_path = Path(models_root).resolve() / "models" / "whisper" / info.filename
        if _file_ready(legacy_path):
            resolved_path = legacy_path
            ready = True
    if not ready:
        try:
            from native_config import get_bundled_models_dir
        except Exception:
            get_bundled_models_dir = None  # type: ignore
        bundle_root = get_bundled_models_dir() if get_bundled_models_dir else None
        if bundle_root:
            bundle_info = get_whisper_model_info(bundle_root)
            if _file_ready(bundle_info.path):
                resolved_path = bundle_info.path
                ready = True
    size = None
    if ready:
        try:
            if resolved_path and resolved_path.exists():
                size = resolved_path.stat().st_size
        except OSError:
            size = None
    return {
        "ready": ready,
        "model_path": str(resolved_path) if ready and resolved_path and resolved_path.exists() else None,
        "expected_path": str(info.path),
        "download_url": info.url or None,
        "filename": info.filename,
        "size_bytes": size,
    }


def whisper_written_model_status(models_root: Path) -> dict[str, object]:
    """Return a status payload for the written Chinese Whisper model assets."""
    info = get_whisper_written_model_info(models_root)
    resolved_path: Optional[Path] = info.path if _file_ready(info.path) else None
    ready = resolved_path is not None
    if not ready:
        try:
            from native_config import get_bundled_models_dir
        except Exception:
            get_bundled_models_dir = None  # type: ignore
        bundle_root = get_bundled_models_dir() if get_bundled_models_dir else None
        if bundle_root:
            bundle_info = get_whisper_written_model_info(bundle_root)
            if _file_ready(bundle_info.path):
                resolved_path = bundle_info.path
                ready = True
    size = None
    if ready:
        try:
            if resolved_path:
                size = resolved_path.stat().st_size
        except OSError:
            size = None
    return {
        "ready": ready,
        "model_path": str(resolved_path) if ready and resolved_path else None,
        "expected_path": str(info.path),
        "download_url": info.url or None,
        "filename": info.filename,
        "size_bytes": size,
    }


def _download_with_progress(
    url: str,
    target: Path,
    *,
    progress_callback: Optional[Callable[[int, Optional[int], str], None]] = None,
) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_suffix(target.suffix + ".part")
    if tmp_path.exists():
        with contextlib.suppress(OSError):
            tmp_path.unlink()

    def _build_ssl_context() -> ssl.SSLContext | None:
        if certifi is None:
            return None
        try:
            return ssl.create_default_context(cafile=certifi.where())
        except Exception:
            return None

    request = urllib.request.Request(
        url,
        headers={"User-Agent": "X-Caption/1.0"},
    )
    context = _build_ssl_context()
    with urllib.request.urlopen(request, timeout=30, context=context) as response:
        total_header = response.headers.get("Content-Length")
        total_bytes = int(total_header) if total_header and total_header.isdigit() else None
        downloaded = 0
        last_report = time.time()

        with tmp_path.open("wb") as handle:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                downloaded += len(chunk)
                if progress_callback and (time.time() - last_report) >= 0.15:
                    progress_callback(downloaded, total_bytes, "Downloading Whisper model...")
                    last_report = time.time()

        if progress_callback:
            progress_callback(downloaded, total_bytes, "Finalizing Whisper model...")

    tmp_path.replace(target)


def download_whisper_model(
    models_root: Path,
    *,
    url: Optional[str] = None,
    filename: Optional[str] = None,
    progress_callback: Optional[Callable[[int, Optional[int], str], None]] = None,
) -> Path:
    info = get_whisper_model_info(models_root)
    download_url = (url or info.url).strip()
    if not download_url:
        raise RuntimeError("Model download URL is missing.")
    target_name = (filename or info.filename).strip() or DEFAULT_MODEL_FILE
    target_path = info.directory / target_name

    if _file_ready(target_path):
        return target_path

    LOGGER.info("Downloading model from %s", download_url)
    _download_with_progress(download_url, target_path, progress_callback=progress_callback)

    if not _file_ready(target_path):
        raise RuntimeError("Downloaded model is invalid.")

    LOGGER.info("Model is ready at %s", target_path)
    return target_path


def download_whisper_written_model(
    models_root: Path,
    *,
    url: Optional[str] = None,
    filename: Optional[str] = None,
    progress_callback: Optional[Callable[[int, Optional[int], str], None]] = None,
) -> Path:
    info = get_whisper_written_model_info(models_root)
    download_url = (url or info.url).strip()
    target_name = (filename or info.filename).strip() or DEFAULT_WRITTEN_MODEL_FILE
    target_path = info.directory / target_name

    if _file_ready(target_path):
        return target_path

    LOGGER.info("Downloading written model from %s", download_url)
    _download_with_progress(download_url, target_path, progress_callback=progress_callback)

    if not _file_ready(target_path):
        raise RuntimeError("Downloaded written model is invalid.")

    LOGGER.info("Written model is ready at %s", target_path)
    return target_path


def ensure_whisper_model(
    models_root: Path,
    *,
    auto_download: Optional[bool] = None,
    interactive: Optional[bool] = None,
) -> Path:
    """Ensure the Whisper model exists under *models_root*."""
    info = get_whisper_model_info(models_root)

    if _file_ready(info.path):
        return info.path

    interactive = interactive if interactive is not None else bool(sys.stdin and sys.stdin.isatty())

    env_pref = os.environ.get("XCAPTION_AUTO_DOWNLOAD_MODELS", "").strip().lower()
    if auto_download is None and env_pref:
        if env_pref in {"1", "true", "yes", "always", "auto"}:
            auto_download = True
        elif env_pref in {"0", "false", "no", "never"}:
            auto_download = False

    if auto_download is False:
        raise RuntimeError(
            "Model assets are missing and automatic download is disabled. "
            f"Download the model from {info.url} and place it at {info.path}."
        )

    if auto_download is None and not interactive:
        raise RuntimeError(
            "Model assets are missing and interactive confirmation is not possible. "
            f"Download the model from {info.url} and place it at {info.path}, "
            "or set XCAPTION_AUTO_DOWNLOAD_MODELS=1."
        )

    if auto_download is None:
        response = input(
            f"Download model assets from {info.url} (~several hundred MB)? [Y/n]: "
        ).strip().lower()
        if response not in {"", "y", "yes"}:
            raise RuntimeError(
                "Model download cancelled by user. Re-run with `--download` when ready."
            )

    return download_whisper_model(models_root, url=info.url, filename=info.filename)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Manage Whisper model assets for X-Caption.")
    parser.add_argument(
        "--models-dir",
        default=None,
        help="Target models directory (defaults to ./data/models).",
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Download missing model assets automatically.",
    )
    parser.add_argument(
        "--url",
        default=None,
        help=f"Override download URL (defaults to {DEFAULT_MODEL_URL}).",
    )
    parser.add_argument(
        "--filename",
        default=None,
        help="Override the target filename (defaults to model.bin).",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    models_root = Path(args.models_dir) if args.models_dir else Path(__file__).parent / "data" / "models"

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        if args.download:
            download_whisper_model(
                models_root,
                url=args.url,
                filename=args.filename,
            )
        else:
            ensure_whisper_model(
                models_root,
                auto_download=False,
                interactive=None,
            )
    except urllib.error.URLError as exc:
        LOGGER.error("Network error while downloading model: %s", exc)
        return 2
    except Exception as exc:
        LOGGER.error(str(exc))
        return 2

    info = get_whisper_model_info(models_root)
    print(f"[OK] Model assets are ready at: {info.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
