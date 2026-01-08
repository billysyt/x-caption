#!/usr/bin/env python3
"""
Native Web Server - X-Caption backend
Serves the React UI and uses lightweight polling to emulate WebSocket behavior
without socket.io dependencies.
"""
import os
import sys
import logging
import json
import uuid
import tempfile
import time
import shutil
import mimetypes
import contextlib
import subprocess
import ssl
from urllib.parse import urlparse, quote
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Any, Optional, Callable, Tuple
from collections import defaultdict
import threading

try:
    import certifi
except ImportError:
    certifi = None

try:
    from opencc import OpenCC
except ImportError:
    OpenCC = None

from flask import Flask, request, jsonify, send_file, render_template, send_from_directory
from werkzeug.utils import secure_filename

# Set up environment first
from native_config import (
    setup_environment,
    get_templates_dir,
    get_static_dir,
    get_transcriptions_dir,
    get_uploads_dir,
    get_data_dir,
    get_models_dir,
    VERSION
)
setup_environment()

# Import native modules
from native_job_queue import get_queue, start_worker
import native_history
from native_job_handlers import (
    process_full_pipeline_job,
    _prepare_audio_for_processing,
    _normalized_audio_filename,
)
from model_manager import get_whisper_model_info, whisper_model_status, download_whisper_model
from whisper_cpp_runtime import resolve_whisper_model

from native_ffmpeg import setup_ffmpeg_environment, test_ffmpeg, get_ffmpeg_path
from download_media import download_url_media

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    'wav',
    'mp3',
    'mp4',
    'avi',
    'mov',
    'mkv',
    'webm',
    'flv',
    'mpg',
    'mpeg',
    'flac',
    'm4a',
    'ogg',
    'jpg',
    'jpeg'
}

_THUMBNAIL_MAX_BYTES = 50 * 1024
_THUMBNAIL_SCALES = [480, 360, 320, 240, 200, 160, 120, 96]
_THUMBNAIL_QUALITIES = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]

# WebSocket emulation - store pending updates for each job
job_update_queues = defaultdict(list)
job_update_lock = threading.Lock()

QUEUE_NAMES = ("high", "default", "low")
USER_AGENT = f"X-Caption/{VERSION}"

# Chinese conversion cache
opencc_converters: Dict[str, "OpenCC"] = {}
opencc_lock = threading.Lock()

# Whisper model download tracking
model_downloads: Dict[str, Dict[str, Any]] = {}
model_download_lock = threading.Lock()
active_model_download_id: Optional[str] = None

# YouTube import download tracking
youtube_downloads: Dict[str, Dict[str, Any]] = {}
youtube_download_lock = threading.Lock()

# URL import download tracking
url_downloads: Dict[str, Dict[str, Any]] = {}
url_download_lock = threading.Lock()
url_download_cancel_events: Dict[str, threading.Event] = {}

LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}

update_cache_lock = threading.Lock()
UPDATE_CACHE_FILENAME = "update_cache.json"


def _build_ssl_context() -> ssl.SSLContext:
    if certifi:
        return ssl.create_default_context(cafile=certifi.where())
    return ssl.create_default_context()


def _find_job(job_id: str) -> Tuple[Optional[Any], Optional[Any]]:
    for queue_name in QUEUE_NAMES:
        try:
            queue = get_queue(queue_name)
        except Exception:
            continue
        try:
            job = queue.fetch_job(job_id)
        except Exception:
            continue
        if job:
            return job, queue
    return None, None


def _get_update_cache_path() -> Path:
    return get_data_dir() / UPDATE_CACHE_FILENAME


def _read_update_cache() -> Dict[str, Any]:
    path = _get_update_cache_path()
    if not path.exists():
        return {"projects": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            if "projects" not in data or not isinstance(data.get("projects"), dict):
                data["projects"] = {}
            return data
    except Exception as exc:
        logger.warning("Failed to read update cache: %s", exc)
    return {"projects": {}}


def _write_update_cache(data: Dict[str, Any]) -> None:
    path = _get_update_cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    payload = json.dumps(data, ensure_ascii=True, separators=(",", ":"))
    tmp_path.write_text(payload, encoding="utf-8")
    tmp_path.replace(path)


def is_youtube_url(raw_url: str) -> bool:
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    return host.endswith("youtube.com") or host.endswith("youtu.be") or host.endswith("music.youtube.com")


def is_http_url(raw_url: str) -> bool:
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return False
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _resolve_youtube_download(downloads_dir: Path, download_id: str) -> Path:
    candidates = [path for path in downloads_dir.glob(f"{download_id}.*") if path.is_file()]
    if not candidates:
        raise RuntimeError("Download completed but no audio file was created.")
    allowed = [path for path in candidates if path.suffix.lstrip(".").lower() in ALLOWED_EXTENSIONS]
    if allowed:
        candidates = allowed
    return max(candidates, key=lambda path: path.stat().st_mtime)


def _local_media_url(path: Path) -> str:
    return f"/media?path={quote(str(path))}"


def _guess_thumbnail_extension(url: str, content_type: Optional[str]) -> str:
    content_type = (content_type or "").lower()
    if "jpeg" in content_type or "jpg" in content_type:
        return ".jpg"
    if "png" in content_type:
        return ".png"
    if "webp" in content_type:
        return ".webp"
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp"}:
        return suffix
    return ".jpg"


def _download_youtube_thumbnail(
    thumbnail_url: Optional[str],
    *,
    downloads_dir: Path,
    base_name: str,
) -> Optional[Path]:
    if not thumbnail_url:
        return None
    downloads_dir.mkdir(parents=True, exist_ok=True)
    dest_path = downloads_dir / f"{base_name}_thumb.jpg"
    if dest_path.exists():
        return dest_path

    temp_dir = Path(tempfile.mkdtemp(prefix="xcaption_thumb_"))
    best_path = None
    best_size = None
    try:
        req = urllib.request.Request(
            thumbnail_url,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=10, context=_build_ssl_context()) as response:
            content_type = response.headers.get("Content-Type")
            data = response.read()

        ext = _guess_thumbnail_extension(thumbnail_url, content_type)
        raw_path = temp_dir / f"thumbnail{ext}"
        raw_path.write_bytes(data)

        ffmpeg_path = get_ffmpeg_path()
        attempt_path = temp_dir / "thumb_out.jpg"
        best_path = temp_dir / "thumb_best.jpg"

        for size in _THUMBNAIL_SCALES:
            for quality in _THUMBNAIL_QUALITIES:
                cmd = [
                    ffmpeg_path,
                    "-y",
                    "-i",
                    str(raw_path),
                    "-frames:v",
                    "1",
                    "-vf",
                    f"scale='min({size},iw)':-2",
                    "-q:v",
                    str(quality),
                    str(attempt_path),
                ]
                process = subprocess.run(cmd, capture_output=True, text=True)
                if process.returncode != 0 or not attempt_path.exists():
                    continue
                size_bytes = attempt_path.stat().st_size
                if best_size is None or size_bytes < best_size:
                    best_size = size_bytes
                    shutil.copy2(attempt_path, best_path)
                if size_bytes <= _THUMBNAIL_MAX_BYTES:
                    shutil.copy2(attempt_path, dest_path)
                    return dest_path

        if best_path.exists():
            shutil.copy2(best_path, dest_path)
            return dest_path
    except Exception as exc:
        logger.warning("Failed to download YouTube thumbnail: %s", exc)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    return None


def _download_youtube_audio(
    url: str,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    download_id: Optional[str] = None
) -> Dict[str, Any]:
    try:
        from yt_dlp import YoutubeDL  # type: ignore
    except Exception as exc:
        raise RuntimeError("YouTube import requires yt-dlp. Please install the dependency.") from exc

    downloads_dir = get_uploads_dir() / "youtube"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    download_id = download_id or uuid.uuid4().hex
    outtmpl = str(downloads_dir / f"{download_id}.%(ext)s")

    def progress_hook(update: Dict[str, Any]) -> None:
        if progress_callback:
            progress_callback(update)

    ydl_opts = {
        "format": "worstaudio",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 2,
        "ffmpeg_location": get_ffmpeg_path(),
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
        "progress_hooks": [progress_hook],
    }

    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    if not info:
        raise RuntimeError("Failed to fetch YouTube metadata.")
    if "entries" in info:
        info = next((entry for entry in info.get("entries") or [] if entry), None)
        if not info:
            raise RuntimeError("No playable YouTube entries found.")

    title = (info.get("title") or "youtube_audio").strip()
    video_id = info.get("id")
    duration = info.get("duration")
    thumbnail_url = _pick_youtube_thumbnail(info)
    safe_title = secure_filename(title) or "youtube_audio"
    safe_title = safe_title[:80].strip("-_") or "youtube_audio"
    base_name = f"{safe_title}-{download_id[:8]}"
    downloaded_path = _resolve_youtube_download(downloads_dir, download_id)

    stream_url = None
    try:
        stream_opts = {
            "format": (
                "best[ext=mp4][acodec!=none][vcodec^=avc1][protocol!=m3u8][protocol!=m3u8_native]/"
                "best[ext=mp4][acodec!=none][protocol!=m3u8][protocol!=m3u8_native]/"
                "best[acodec!=none][vcodec!=none][protocol!=m3u8][protocol!=m3u8_native]"
            ),
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
        }
        with YoutubeDL(stream_opts) as stream_ydl:
            stream_info = stream_ydl.extract_info(url, download=False)
        if stream_info and "entries" in stream_info:
            stream_info = next((entry for entry in stream_info.get("entries") or [] if entry), None)
        if stream_info:
            stream_url = stream_info.get("url")
            if not duration:
                duration = stream_info.get("duration")
    except Exception as exc:
        logger.warning("Failed to resolve YouTube stream URL: %s", exc)

    final_name = f"{base_name}{downloaded_path.suffix}"
    final_path = downloads_dir / final_name
    try:
        if downloaded_path.resolve() != final_path.resolve():
            downloaded_path.replace(final_path)
    except Exception:
        final_path = downloaded_path

    mime_type, _ = mimetypes.guess_type(str(final_path))
    size = None
    with contextlib.suppress(OSError):
        size = final_path.stat().st_size

    thumbnail_path = _download_youtube_thumbnail(
        thumbnail_url,
        downloads_dir=downloads_dir,
        base_name=base_name,
    )
    local_thumbnail_url = _local_media_url(thumbnail_path) if thumbnail_path else None

    return {
        "file": {
            "path": str(final_path),
            "name": final_path.name,
            "size": size,
            "mime": mime_type or "application/octet-stream",
        },
        "thumbnail_url": local_thumbnail_url,
        "source": {
            "url": url,
            "title": title,
            "id": video_id,
        },
        "stream_url": stream_url,
        "duration_sec": duration if isinstance(duration, (int, float)) else None,
    }


def _pick_youtube_thumbnail(info: Any) -> Optional[str]:
    if not isinstance(info, dict):
        return None
    thumbnail = info.get("thumbnail")
    if isinstance(thumbnail, str) and thumbnail.strip():
        return thumbnail.strip()
    thumbnails = info.get("thumbnails")
    if isinstance(thumbnails, list) and thumbnails:
        candidates = []
        for item in thumbnails:
            if not isinstance(item, dict):
                continue
            url = item.get("url")
            if isinstance(url, str) and url:
                candidates.append(item)
        if candidates:
            def score(entry: Dict[str, Any]) -> float:
                width = entry.get("width") or 0
                height = entry.get("height") or 0
                try:
                    return float(width) * float(height)
                except Exception:
                    return 0.0
            best = max(candidates, key=score)
            url = best.get("url")
            if isinstance(url, str) and url:
                return url
    return None


def _resolve_youtube_stream(url: str) -> Dict[str, Any]:
    try:
        from yt_dlp import YoutubeDL  # type: ignore
    except Exception as exc:
        raise RuntimeError("YouTube import requires yt-dlp. Please install the dependency.") from exc

    stream_opts = {
        "format": (
            "best[ext=mp4][acodec!=none][vcodec^=avc1][protocol!=m3u8][protocol!=m3u8_native]/"
            "best[ext=mp4][acodec!=none][protocol!=m3u8][protocol!=m3u8_native]/"
            "best[acodec!=none][vcodec!=none][protocol!=m3u8][protocol!=m3u8_native]/"
            "best[protocol!=m3u8][protocol!=m3u8_native]"
        ),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    with YoutubeDL(stream_opts) as stream_ydl:
        stream_info = stream_ydl.extract_info(url, download=False)

    if not stream_info:
        raise RuntimeError("Failed to fetch YouTube metadata.")
    if "entries" in stream_info:
        stream_info = next((entry for entry in stream_info.get("entries") or [] if entry), None)
        if not stream_info:
            raise RuntimeError("No playable YouTube entries found.")

    stream_url = stream_info.get("url")
    if not stream_url:
        raise RuntimeError("Failed to resolve YouTube stream URL.")

    title = (stream_info.get("title") or "youtube_stream").strip()
    safe_title = secure_filename(title) or "youtube_stream"
    safe_title = safe_title[:80].strip("-_") or "youtube_stream"
    video_id = stream_info.get("id") or uuid.uuid4().hex[:8]
    base_name = f"{safe_title}-{video_id}"
    downloads_dir = get_uploads_dir() / "youtube"
    thumbnail_url = _pick_youtube_thumbnail(stream_info)
    thumbnail_path = _download_youtube_thumbnail(
        thumbnail_url,
        downloads_dir=downloads_dir,
        base_name=base_name,
    )
    local_thumbnail_url = _local_media_url(thumbnail_path) if thumbnail_path else None

    return {
        "stream_url": stream_url,
        "thumbnail_url": local_thumbnail_url,
        "source": {
            "url": url,
            "title": stream_info.get("title"),
            "id": stream_info.get("id"),
        },
        "duration_sec": stream_info.get("duration") if isinstance(stream_info.get("duration"), (int, float)) else None,
    }


def _serialize_youtube_download(state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "download_id": state.get("id"),
        "status": state.get("status"),
        "progress": state.get("progress"),
        "message": state.get("message"),
        "error": state.get("error"),
        "file": state.get("file"),
        "thumbnail_url": state.get("thumbnail_url"),
        "source": state.get("source"),
        "stream_url": state.get("stream_url"),
        "duration_sec": state.get("duration_sec"),
        "started_at": state.get("started_at"),
        "updated_at": state.get("updated_at"),
    }


def _get_youtube_download_state(download_id: str) -> Optional[Dict[str, Any]]:
    with youtube_download_lock:
        return youtube_downloads.get(download_id)


def _start_youtube_download(url: str) -> Dict[str, Any]:
    download_id = uuid.uuid4().hex
    state = {
        "id": download_id,
        "status": "queued",
        "progress": 0,
        "message": "Starting YouTube download...",
        "error": None,
        "file": None,
        "thumbnail_url": None,
        "source": {"url": url},
        "stream_url": None,
        "duration_sec": None,
        "started_at": time.time(),
        "updated_at": time.time(),
    }
    with youtube_download_lock:
        youtube_downloads[download_id] = state

    def progress_hook(update: Dict[str, Any]) -> None:
        status = update.get("status")
        info = update.get("info_dict") or {}
        title = info.get("title") if isinstance(info, dict) else None
        with youtube_download_lock:
            if title:
                source = state.get("source") or {}
                source["title"] = title
                state["source"] = source
            if status == "downloading":
                total = update.get("total_bytes")
                if not total:
                    info_total = info.get("filesize") if isinstance(info, dict) else None
                    if isinstance(info_total, int) and info_total > 0:
                        total = info_total
                downloaded = update.get("downloaded_bytes") or 0
                if total and total > 0:
                    state["progress"] = int(min(100, (downloaded / total) * 100))
                state["status"] = "downloading"
                state["message"] = "Downloading YouTube media..."
            elif status in {"postprocessing", "finished"}:
                state["status"] = "processing"
                state["message"] = "Processing audio..."
            state["updated_at"] = time.time()

    def _run_download() -> None:
        nonlocal state
        try:
            result = _download_youtube_audio(url, progress_callback=progress_hook, download_id=download_id)
            with youtube_download_lock:
                state["status"] = "completed"
                state["progress"] = 100
                state["message"] = "YouTube media ready."
                state["file"] = result.get("file")
                state["source"] = result.get("source")
                state["stream_url"] = result.get("stream_url")
                state["thumbnail_url"] = result.get("thumbnail_url")
                state["duration_sec"] = result.get("duration_sec")
                state["updated_at"] = time.time()
        except Exception as exc:
            with youtube_download_lock:
                state["status"] = "failed"
                state["error"] = str(exc)
                state["updated_at"] = time.time()

    thread = threading.Thread(target=_run_download, name=f"YouTubeDownload-{download_id}", daemon=True)
    thread.start()
    return state


def _get_default_download_dir() -> Path:
    """Return the user's default Downloads directory (create if missing)."""
    home = Path.home()
    candidates = []
    if sys.platform == "win32":
        userprofile = os.environ.get("USERPROFILE")
        if userprofile:
            candidates.append(Path(userprofile) / "Downloads")
    candidates.append(home / "Downloads")
    candidates.append(home / "Download")

    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            if candidate.exists() and candidate.is_dir():
                return candidate
        except Exception:
            continue
    # Fallback: use app uploads directory
    fallback = get_uploads_dir()
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _parse_download_path(raw_path: Optional[str]) -> Tuple[Path, Optional[str]]:
    """Return (download_dir, preferred_stem) from a user-supplied path."""
    default_dir = _get_default_download_dir()
    if not raw_path:
        return default_dir, None
    try:
        candidate = Path(raw_path).expanduser()
    except Exception:
        return default_dir, None
    if not candidate.is_absolute():
        candidate = default_dir / candidate
    if candidate.suffix:
        stem = secure_filename(candidate.stem) or None
        return candidate.parent, stem
    return candidate, None


def _serialize_url_download(state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "download_id": state.get("id"),
        "status": state.get("status"),
        "progress": state.get("progress"),
        "message": state.get("message"),
        "error": state.get("error"),
        "downloaded_bytes": state.get("downloaded_bytes"),
        "total_bytes": state.get("total_bytes"),
        "total_bytes_estimate": state.get("total_bytes_estimate"),
        "fragment_index": state.get("fragment_index"),
        "fragment_count": state.get("fragment_count"),
        "file": state.get("file"),
        "source": state.get("source"),
        "duration_sec": state.get("duration_sec"),
        "download_dir": state.get("download_dir"),
        "started_at": state.get("started_at"),
        "updated_at": state.get("updated_at"),
    }


def _get_url_download_state(download_id: str) -> Optional[Dict[str, Any]]:
    with url_download_lock:
        return url_downloads.get(download_id)


def _cancel_url_download(download_id: str) -> Optional[Dict[str, Any]]:
    with url_download_lock:
        state = url_downloads.get(download_id)
        cancel_event = url_download_cancel_events.get(download_id)
        if not state or not cancel_event:
            return None
        if state.get("status") in {"completed", "failed", "cancelled"}:
            return state
        cancel_event.set()
        state["status"] = "cancelling"
        state["message"] = "Cancelling download..."
        state["updated_at"] = time.time()
        return state


def _start_url_download(url: str, download_path: Optional[str]) -> Dict[str, Any]:
    download_id = uuid.uuid4().hex
    downloads_dir, preferred_stem = _parse_download_path(download_path)

    downloads_dir.mkdir(parents=True, exist_ok=True)
    if downloads_dir.exists() and not downloads_dir.is_dir():
        raise RuntimeError("Download path is not a directory.")

    cancel_event = threading.Event()
    state = {
        "id": download_id,
        "status": "queued",
        "progress": 0,
        "message": "Starting download...",
        "error": None,
        "downloaded_bytes": 0,
        "total_bytes": None,
        "total_bytes_estimate": None,
        "fragment_index": None,
        "fragment_count": None,
        "file": None,
        "source": {"url": url},
        "duration_sec": None,
        "download_dir": str(downloads_dir),
        "started_at": time.time(),
        "updated_at": time.time(),
    }
    with url_download_lock:
        url_downloads[download_id] = state
        url_download_cancel_events[download_id] = cancel_event

    def progress_hook(update: Dict[str, Any]) -> None:
        status = update.get("status")
        info = update.get("info_dict") or {}
        title = info.get("title") if isinstance(info, dict) else None
        with url_download_lock:
            if title:
                source = state.get("source") or {}
                source["title"] = title
                state["source"] = source
            if status == "downloading":
                total = update.get("total_bytes")
                total_estimate = update.get("total_bytes_estimate")
                if not total and not total_estimate:
                    info_total = info.get("filesize") if isinstance(info, dict) else None
                    info_estimate = info.get("filesize_approx") if isinstance(info, dict) else None
                    if isinstance(info_total, int) and info_total > 0:
                        total = info_total
                    elif isinstance(info_estimate, int) and info_estimate > 0:
                        total_estimate = info_estimate
                downloaded = update.get("downloaded_bytes") or 0
                fragment_index = update.get("fragment_index")
                fragment_count = update.get("fragment_count")
                state["downloaded_bytes"] = downloaded
                state["total_bytes"] = total
                state["total_bytes_estimate"] = total_estimate
                state["fragment_index"] = fragment_index
                state["fragment_count"] = fragment_count
                if total and total > 0:
                    state["progress"] = int(min(100, (downloaded / total) * 100))
                elif total_estimate and total_estimate > 0:
                    state["progress"] = int(min(100, (downloaded / total_estimate) * 100))
                elif fragment_count:
                    current_fragment = (fragment_index + 1) if isinstance(fragment_index, int) else 0
                    state["progress"] = int(min(100, (current_fragment / fragment_count) * 100))
                else:
                    state["progress"] = None
                state["status"] = "downloading"
                state["message"] = "Downloading media..."
            elif status in {"postprocessing", "finished"}:
                state["status"] = "processing"
                state["message"] = "Processing media..."
            state["updated_at"] = time.time()

    def _run_download() -> None:
        nonlocal state
        try:
            result = download_url_media(
                url,
                downloads_dir,
                allowed_extensions=ALLOWED_EXTENSIONS,
                preferred_stem=preferred_stem,
                progress_callback=progress_hook,
                download_id=download_id,
                cancel_event=cancel_event,
            )
            with url_download_lock:
                state["status"] = "completed"
                state["progress"] = 100
                state["message"] = "Media ready."
                state["file"] = result.get("file")
                state["source"] = result.get("source")
                state["duration_sec"] = result.get("duration_sec")
                state["updated_at"] = time.time()
        except Exception as exc:
            try:
                from yt_dlp.utils import DownloadCancelled  # type: ignore
            except Exception:
                DownloadCancelled = None
            if DownloadCancelled and isinstance(exc, DownloadCancelled):
                with url_download_lock:
                    state["status"] = "cancelled"
                    state["message"] = "Download cancelled."
                    state["error"] = None
                    state["updated_at"] = time.time()
            else:
                with url_download_lock:
                    state["status"] = "failed"
                    state["error"] = str(exc)
                    state["updated_at"] = time.time()
        finally:
            with url_download_lock:
                url_download_cancel_events.pop(download_id, None)

    thread = threading.Thread(target=_run_download, name=f"UrlDownload-{download_id}", daemon=True)
    thread.start()
    return state


def is_loopback_origin(origin: Optional[str]) -> bool:
    """Return True if the supplied Origin header represents a loopback host."""
    if not origin:
        return False
    try:
        parsed = urlparse(origin)
    except ValueError:
        return False

    hostname = parsed.hostname
    if hostname is None:
        return False

    return hostname in LOOPBACK_HOSTS


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def emit_update(room: str, event: str, data: Dict[str, Any]):
    """
    Emulate socket.emit() by storing updates for polling
    room format: "job:job_id"
    """
    with job_update_lock:
        job_update_queues[room].append({
            'event': event,
            'data': data,
            'timestamp': time.time()
        })
        # Keep only last 100 updates per job
        if len(job_update_queues[room]) > 100:
            job_update_queues[room] = job_update_queues[room][-100:]


def publish_job_update(job_id: str, status: str, data: Dict[str, Any]):
    """Publish job update (compatible with WebSocket emit)"""
    try:
        room = f"job:{job_id}"
        message = {
            'job_id': job_id,
            'status': status,
            'timestamp': time.time(),
            'data': data
        }
        emit_update(room, 'job_update', message)
        logger.info(f"Published update for job {job_id}: {status}")
    except Exception as e:
        logger.error(f"Failed to publish job update: {e}")


def _serialize_model_download(state: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "download_id": state.get("id"),
        "status": state.get("status"),
        "progress": state.get("progress"),
        "downloaded_bytes": state.get("downloaded_bytes"),
        "total_bytes": state.get("total_bytes"),
        "message": state.get("message"),
        "error": state.get("error"),
        "error_type": state.get("error_type"),
        "expected_path": state.get("expected_path"),
        "download_url": state.get("download_url"),
        "started_at": state.get("started_at"),
        "updated_at": state.get("updated_at"),
    }


def _get_download_state(download_id: str) -> Optional[Dict[str, Any]]:
    with model_download_lock:
        return model_downloads.get(download_id)


def _start_whisper_model_download() -> Dict[str, Any]:
    global active_model_download_id
    with model_download_lock:
        if active_model_download_id:
            existing = model_downloads.get(active_model_download_id)
            if existing and existing.get("status") in {"queued", "downloading"}:
                return existing

        info = get_whisper_model_info(get_models_dir())
        download_id = uuid.uuid4().hex
        state = {
            "id": download_id,
            "status": "queued",
            "progress": None,
            "downloaded_bytes": 0,
            "total_bytes": None,
            "message": "Starting Whisper model download...",
            "error": None,
            "error_type": None,
            "expected_path": str(info.path),
            "download_url": info.url,
            "started_at": time.time(),
            "updated_at": time.time(),
        }
        model_downloads[download_id] = state
        active_model_download_id = download_id

    def _run_download() -> None:
        nonlocal state

        def progress_cb(downloaded: int, total: Optional[int], message: str) -> None:
            with model_download_lock:
                state["downloaded_bytes"] = downloaded
                state["total_bytes"] = total
                state["message"] = message
                if total and total > 0:
                    state["progress"] = int(min(100, (downloaded / total) * 100))
                else:
                    state["progress"] = None
                state["status"] = "downloading"
                state["updated_at"] = time.time()

        try:
            download_whisper_model(get_models_dir(), progress_callback=progress_cb)
            with model_download_lock:
                state["status"] = "completed"
                state["progress"] = 100
                state["message"] = "Whisper model downloaded."
                state["updated_at"] = time.time()
        except urllib.error.URLError as exc:
            with model_download_lock:
                state["status"] = "failed"
                state["error"] = f"Unable to reach the download server: {exc}"
                state["error_type"] = "network"
                state["updated_at"] = time.time()
        except Exception as exc:  # pragma: no cover - unexpected failure
            with model_download_lock:
                state["status"] = "failed"
                state["error"] = str(exc)
                state["error_type"] = "unknown"
                state["updated_at"] = time.time()
        finally:
            global active_model_download_id
            with model_download_lock:
                if active_model_download_id == state.get("id"):
                    active_model_download_id = None

    thread = threading.Thread(target=_run_download, name=f"WhisperModelDownload-{download_id}", daemon=True)
    thread.start()
    return state


def convert_chinese_text(text: str, target: str) -> str:
    """Convert Chinese text between simplified and traditional variants"""
    if OpenCC is None:
        raise RuntimeError("Chinese conversion library (opencc) is not available")

    mode_map = {
        'traditional': 's2t',
        'simplified': 't2s'
    }

    config = mode_map.get(target)
    if not config:
        raise ValueError(f"Unsupported conversion target: {target}")

    with opencc_lock:
        converter = opencc_converters.get(config)
        if converter is None:
            converter = OpenCC(config)
            opencc_converters[config] = converter

    # Ensure we always convert a string
    return converter.convert(str(text))


def _format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(round(float(seconds) * 1000)))
    hours = total_ms // 3600000
    minutes = (total_ms % 3600000) // 60000
    secs = (total_ms % 60000) // 1000
    ms = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _normalize_export_segments(payload: dict) -> list[dict]:
    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list):
        return []
    cleaned = []
    for segment in raw_segments:
        if not isinstance(segment, dict):
            continue
        raw_text = segment.get("originalText")
        if not isinstance(raw_text, str) or not raw_text.strip():
            raw_text = segment.get("text")
        if not isinstance(raw_text, str):
            continue
        text = raw_text.strip()
        if not text:
            continue
        try:
            start = float(segment.get("start") or 0)
        except Exception:
            start = 0.0
        try:
            end = float(segment.get("end") or 0)
        except Exception:
            end = 0.0
        cleaned.append({
            "text": text,
            "start": start,
            "end": end,
        })
    return cleaned


def _convert_export_segments(segments: list[dict], target: str | None) -> tuple[list[dict], str]:
    if target not in {"simplified", "traditional"}:
        return segments, "_original"
    suffix = "_繁體中文" if target == "traditional" else "_简体中文"
    try:
        converted = []
        for segment in segments:
            text = segment.get("text", "")
            converted_text = convert_chinese_text(text, target)
            converted.append({**segment, "text": converted_text})
        return converted, suffix
    except Exception:
        return segments, "_original"


def _build_transcript_text(segments: list[dict]) -> str:
    return "\n".join(str(segment.get("text", "")).strip() for segment in segments if str(segment.get("text", "")).strip())


def _build_srt_text(segments: list[dict]) -> str:
    blocks = []
    index = 1
    for segment in segments:
        start = _format_srt_timestamp(segment.get("start", 0))
        end = _format_srt_timestamp(segment.get("end", 0))
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        blocks.append(f"{index}\n{start} --> {end}\n{text}\n")
        index += 1
    return "\n".join(blocks).strip()


def create_app():
    """Create and configure Flask application"""

    # Create Flask app with custom template and static folders
    app = Flask(
        __name__,
        template_folder=str(get_templates_dir()),
        static_folder=str(get_static_dir())
    )

    # CORS support
    @app.after_request
    def after_request(response):
        origin = request.headers.get('Origin')
        if origin == "null":
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
            response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
            response.headers['Vary'] = 'Origin'
        elif is_loopback_origin(origin):
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
            response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
            response.headers['Vary'] = 'Origin'
        return response

    # Health check endpoints
    @app.route('/health', methods=['GET'])
    def health_check():
        """Health check endpoint - returns service and model status."""
        try:
            high_queue = get_queue('high')
            default_queue = get_queue('default')
            low_queue = get_queue('low')

            queue_lengths = {
                "high": len(high_queue),
                "default": len(default_queue),
                "low": len(low_queue)
            }

            whisper_status = whisper_model_status(get_models_dir())
            models_ready = bool(whisper_status.get("ready"))
            print(f"[HEALTH] Returning response: models_ready={models_ready}")

            return jsonify({
                "status": "healthy",
                "service": "x-caption-transcription-native",
                "redis_connected": True,  # Fake for compatibility
                "queues": queue_lengths,
                "ffmpeg_available": test_ffmpeg(),
                "models_ready": models_ready,
                "whisper_model": whisper_status
            }), 200

        except Exception as e:
            logger.error(f"Health check error: {e}")
            print(f"[HEALTH] ERROR: {e}")
            return jsonify({
                "status": "unhealthy",
                "error": str(e)
            }), 500

    @app.route('/ready', methods=['GET'])
    def readiness_check():
        """Readiness check endpoint - reports model readiness."""
        try:
            whisper_status = whisper_model_status(get_models_dir())
            return jsonify({
                "status": "ready",
                "available_models": ["whisper"],
                "redis_connected": True,  # Fake for compatibility
                "models_ready": bool(whisper_status.get("ready")),
                "whisper_model": whisper_status,
            }), 200

        except Exception as e:
            return jsonify({"status": "not ready", "error": str(e)}), 503

    @app.route('/models/whisper/status', methods=['GET'])
    def whisper_model_status_endpoint():
        """Return current Whisper model availability."""
        try:
            return jsonify(whisper_model_status(get_models_dir())), 200
        except Exception as exc:
            logger.error("Failed to read Whisper model status: %s", exc)
            return jsonify({"error": str(exc)}), 500

    @app.route('/models/whisper/download', methods=['POST'])
    def whisper_model_download():
        """Kick off Whisper model download (runs in background)."""
        try:
            status_payload = whisper_model_status(get_models_dir())
            if status_payload.get("ready"):
                return jsonify({
                    **status_payload,
                    "status": "ready",
                }), 200
            state = _start_whisper_model_download()
            response = _serialize_model_download(state)
            response["status"] = state.get("status")
            return jsonify(response), 202
        except Exception as exc:
            logger.error("Failed to start Whisper model download: %s", exc, exc_info=True)
            return jsonify({"error": str(exc)}), 500

    @app.route('/models/whisper/download/<download_id>', methods=['GET'])
    def whisper_model_download_status(download_id: str):
        """Check Whisper model download progress."""
        state = _get_download_state(download_id)
        if not state:
            return jsonify({"error": "Download not found"}), 404
        return jsonify(_serialize_model_download(state)), 200

    @app.route('/history', methods=['GET'])
    def history():
        """Return persisted transcription history."""
        try:
            return jsonify({"jobs": native_history.load_history()}), 200
        except Exception as exc:
            logger.error("Failed to load job history: %s", exc)
            return jsonify({"error": "Failed to load history"}), 500

    @app.route('/api/update/fetch', methods=['GET'])
    def fetch_update():
        """Proxy update check API to avoid CORS issues."""
        try:
            update_url = request.args.get("url")
            if not update_url:
                return jsonify({"error": "URL parameter is required"}), 400

            # Validate URL
            try:
                parsed = urlparse(update_url)
                if not parsed.scheme or not parsed.netloc:
                    return jsonify({"error": "Invalid URL"}), 400
            except Exception:
                return jsonify({"error": "Invalid URL"}), 400

            # Fetch from external API
            headers = {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json',
            }

            req = urllib.request.Request(update_url, headers=headers)
            with urllib.request.urlopen(req, context=_build_ssl_context(), timeout=10) as response:
                content_type = response.headers.get('Content-Type', '')
                if 'application/json' not in content_type:
                    return jsonify({"error": "Response is not JSON"}), 400

                data = response.read()
                payload = json.loads(data.decode('utf-8'))
                return jsonify(payload), 200

        except urllib.error.HTTPError as e:
            logger.error("Update fetch HTTP error: %s", e)
            return jsonify({"error": f"HTTP error: {e.code}"}), 502
        except urllib.error.URLError as e:
            logger.error("Update fetch URL error: %s", e)
            return jsonify({"error": f"Network error: {e.reason}"}), 502
        except Exception as exc:
            logger.error("Update fetch failed: %s", exc, exc_info=True)
            return jsonify({"error": "Failed to fetch update"}), 500

    @app.route('/api/update/cache', methods=['GET'])
    def get_update_cache():
        project = (request.args.get("project") or "").strip()
        with update_cache_lock:
            data = _read_update_cache()
        if project:
            entry = data.get("projects", {}).get(project)
            if not entry:
                return jsonify({"project": project, "cached": False, "payload": None}), 200
            return jsonify({
                "project": project,
                "cached": True,
                "payload": entry.get("payload"),
                "fetched_at": entry.get("fetched_at")
            }), 200
        return jsonify(data), 200

    @app.route('/api/debug/paths', methods=['GET'])
    def debug_paths():
        """Debug endpoint to verify path detection in bundled app."""
        import native_config
        from pathlib import Path

        data_dir = native_config.get_data_dir()
        bundle_dir = native_config.get_bundle_dir()

        return jsonify({
            "frozen_detection": {
                "is_frozen": native_config.is_frozen(),
                "sys_frozen": getattr(sys, 'frozen', False),
                "sys_meipass_exists": hasattr(sys, '_MEIPASS'),
                "sys_meipass_value": getattr(sys, '_MEIPASS', None),
                "sys_executable": sys.executable,
                "in_app_bundle": '.app/Contents/MacOS' in str(sys.executable),
            },
            "paths": {
                "bundle_dir": str(bundle_dir),
                "data_dir": str(data_dir),
                "models_dir": str(native_config.get_models_dir()),
                "transcriptions_dir": str(native_config.get_transcriptions_dir()),
                "uploads_dir": str(native_config.get_uploads_dir()),
            },
            "expected_production_path": str(Path.home() / "Library" / "Application Support" / "X-Caption"),
            "data_dir_matches_expected": str(data_dir) == str(Path.home() / "Library" / "Application Support" / "X-Caption"),
            "data_dir_contents": {
                "exists": data_dir.exists(),
                "files": [f.name for f in data_dir.iterdir()] if data_dir.exists() else [],
            }
        }), 200

    @app.route('/api/update/cache', methods=['POST'])
    def set_update_cache():
        payload = request.get_json(force=True, silent=True) or {}
        payload_data = payload.get("payload") if isinstance(payload, dict) else None
        project = payload.get("project") if isinstance(payload, dict) else None
        if not project and isinstance(payload_data, dict):
            project = payload_data.get("project")
        if not project or not isinstance(project, str):
            return jsonify({"error": "Missing project"}), 400
        if payload_data is None:
            return jsonify({"error": "Missing payload"}), 400

        fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with update_cache_lock:
            data = _read_update_cache()
            projects = data.get("projects")
            if not isinstance(projects, dict):
                projects = {}
                data["projects"] = projects
            projects[project] = {
                "payload": payload_data,
                "fetched_at": fetched_at
            }
            data["updated_at"] = fetched_at
            _write_update_cache(data)
        return jsonify({"success": True, "project": project, "fetched_at": fetched_at}), 200

    @app.route('/convert_chinese', methods=['POST'])
    def convert_chinese():
        """Convert Chinese text between simplified and traditional variants"""
        if OpenCC is None:
            return jsonify({
                "success": False,
                "error": "Chinese conversion library not available"
            }), 503

        try:
            payload = request.get_json(force=True, silent=True) or {}
            text = payload.get('text', '')
            target = payload.get('target', 'traditional')

            if not isinstance(text, str):
                raise ValueError("text must be a string")

            converted = convert_chinese_text(text, target)

            return jsonify({
                "success": True,
                "converted_text": converted
            }), 200

        except ValueError as ve:
            return jsonify({
                "success": False,
                "error": str(ve)
            }), 400
        except Exception as e:
            logger.error(f"Failed to convert Chinese text: {e}")
            return jsonify({
                "success": False,
                "error": "Failed to convert text"
            }), 500

    @app.route('/export/transcript', methods=['POST'])
    def export_transcript():
        """Export transcript text."""
        try:
            payload = request.get_json(force=True, silent=True) or {}
            segments = _normalize_export_segments(payload)
            if not segments:
                return jsonify({"success": False, "error": "No segments to export."}), 400

            export_language = payload.get("export_language")
            segments, suffix = _convert_export_segments(segments, export_language)

            content = _build_transcript_text(segments)
            return jsonify({
                "success": True,
                "content": content,
                "suffix": suffix,
            }), 200
        except Exception as exc:
            logger.error("Export transcript failed: %s", exc, exc_info=True)
            return jsonify({"success": False, "error": "Export failed."}), 500

    @app.route('/export/srt', methods=['POST'])
    def export_srt():
        """Export SRT captions."""
        try:
            payload = request.get_json(force=True, silent=True) or {}
            segments = _normalize_export_segments(payload)
            if not segments:
                return jsonify({"success": False, "error": "No segments to export."}), 400

            export_language = payload.get("export_language")
            segments, suffix = _convert_export_segments(segments, export_language)

            content = _build_srt_text(segments)
            return jsonify({
                "success": True,
                "content": content,
                "suffix": suffix,
            }), 200
        except Exception as exc:
            logger.error("Export SRT failed: %s", exc, exc_info=True)
            return jsonify({"success": False, "error": "Export failed."}), 500

    @app.route('/api/segment/edit', methods=['POST'])
    def edit_segment():
        """Edit a specific segment in a transcription"""
        try:
            data = request.get_json()
            job_id = data.get('job_id')
            segment_id = data.get('segment_id')
            new_text = data.get('new_text')

            if not job_id or segment_id is None or not new_text:
                return jsonify({
                    "success": False,
                    "error": "job_id, segment_id, and new_text are required"
                }), 400
            record = native_history.get_job_record(job_id)
            transcription = record.get("transcript") if record else None

            if not transcription:
                return jsonify({
                    "success": False,
                    "error": "Transcription not found"
                }), 404

            segment_found = False
            segments = transcription.get("segments") or []
            for segment in segments:
                if segment.get('id') == segment_id:
                    segment['text'] = new_text
                    segment['originalText'] = new_text
                    segment_found = True
                    break

            if not segment_found:
                return jsonify({
                    "success": False,
                    "error": f"Segment {segment_id} not found"
                }), 404

            full_text = " ".join([seg.get('text', '') for seg in segments if seg.get('text')])
            transcription['text'] = full_text

            native_history.update_job_transcript(job_id, transcription)

            logger.info("Updated segment %s in job %s", segment_id, job_id)

            return jsonify({
                "success": True,
                "message": "Segment updated successfully"
            }), 200

        except Exception as e:
            logger.error(f"Error editing segment: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return jsonify({
                "success": False,
                "error": "Failed to edit segment"
            }), 500

    @app.route('/api/segment/timing', methods=['POST'])
    def update_segment_timing():
        """Update start/end timing for a segment."""
        try:
            data = request.get_json()
            job_id = data.get('job_id')
            segment_id = data.get('segment_id')
            start = data.get('start')
            end = data.get('end')

            if not job_id or segment_id is None or start is None or end is None:
                return jsonify({
                    "success": False,
                    "error": "job_id, segment_id, start, and end are required"
                }), 400

            try:
                start_val = float(start)
                end_val = float(end)
            except Exception:
                return jsonify({
                    "success": False,
                    "error": "start and end must be numbers"
                }), 400

            if end_val <= start_val:
                return jsonify({
                    "success": False,
                    "error": "end must be greater than start"
                }), 400

            record = native_history.get_job_record(job_id)
            transcription = record.get("transcript") if record else None
            if not transcription:
                return jsonify({
                    "success": False,
                    "error": "Transcription not found"
                }), 404

            segment_found = False
            segments = transcription.get("segments") or []
            for segment in segments:
                if segment.get('id') == segment_id:
                    segment['start'] = start_val
                    segment['end'] = end_val
                    segment_found = True
                    break

            if not segment_found:
                return jsonify({
                    "success": False,
                    "error": f"Segment {segment_id} not found"
                }), 404

            native_history.update_job_transcript(job_id, transcription)

            return jsonify({
                "success": True,
                "message": "Segment timing updated"
            }), 200

        except Exception as e:
            logger.error(f"Error updating segment timing: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return jsonify({
                "success": False,
                "error": "Failed to update segment timing"
            }), 500

    @app.route('/api/segment/add', methods=['POST'])
    def add_segment():
        """Add a new segment to the transcript."""
        try:
            data = request.get_json()
            job_id = data.get('job_id')
            start = data.get('start')
            end = data.get('end')
            text = data.get('text') or "New Caption"
            segment_id = data.get('segment_id')

            if not job_id or start is None or end is None:
                return jsonify({
                    "success": False,
                    "error": "job_id, start, and end are required"
                }), 400

            try:
                start_val = float(start)
                end_val = float(end)
            except Exception:
                return jsonify({
                    "success": False,
                    "error": "start and end must be numbers"
                }), 400

            if end_val <= start_val:
                return jsonify({
                    "success": False,
                    "error": "end must be greater than start"
                }), 400

            record = native_history.get_job_record(job_id)
            transcription = record.get("transcript") if record else None
            if not transcription:
                return jsonify({
                    "success": False,
                    "error": "Transcription not found"
                }), 404

            segments = transcription.get("segments") or []
            if segment_id is None:
                max_id = 0
                for seg in segments:
                    try:
                        max_id = max(max_id, int(seg.get("id", 0)))
                    except Exception:
                        continue
                segment_id = max_id + 1

            new_segment = {
                "id": int(segment_id),
                "start": start_val,
                "end": end_val,
                "text": text,
                "originalText": text,
            }
            segments.append(new_segment)
            segments.sort(key=lambda s: float(s.get("start", 0)))
            transcription["segments"] = segments
            transcription["text"] = " ".join([seg.get("text", "") for seg in segments if seg.get("text")]).strip()

            native_history.update_job_transcript(job_id, transcription)

            return jsonify({
                "success": True,
                "message": "Segment added",
                "segment": new_segment
            }), 200

        except Exception as e:
            logger.error(f"Error adding segment: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return jsonify({
                "success": False,
                "error": "Failed to add segment"
            }), 500

    @app.route('/api/segment/delete', methods=['POST'])
    def delete_segment():
        """Delete a segment from the transcript."""
        try:
            data = request.get_json()
            job_id = data.get('job_id')
            segment_id = data.get('segment_id')

            if not job_id or segment_id is None:
                return jsonify({
                    "success": False,
                    "error": "job_id and segment_id are required"
                }), 400

            try:
                segment_id_val = int(segment_id)
            except Exception:
                return jsonify({
                    "success": False,
                    "error": "segment_id must be a number"
                }), 400

            record = native_history.get_job_record(job_id)
            transcription = record.get("transcript") if record else None
            if not transcription:
                return jsonify({
                    "success": False,
                    "error": "Transcription not found"
                }), 404

            segments = transcription.get("segments") or []
            next_segments = [seg for seg in segments if int(seg.get("id", -1)) != segment_id_val]

            if len(next_segments) == len(segments):
                return jsonify({
                    "success": False,
                    "error": f"Segment {segment_id_val} not found"
                }), 404

            transcription["segments"] = next_segments
            transcription["text"] = " ".join([seg.get("text", "") for seg in next_segments if seg.get("text")]).strip()
            native_history.update_job_transcript(job_id, transcription)

            return jsonify({
                "success": True,
                "message": "Segment deleted"
            }), 200

        except Exception as e:
            logger.error(f"Error deleting segment: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return jsonify({
                "success": False,
                "error": "Failed to delete segment"
            }), 500

    @app.route('/api/job/record', methods=['POST'])
    def upsert_job_record():
        """Create or update a job record in the app database."""
        try:
            payload = request.get_json(force=True, silent=True) or {}
            job_id = payload.get('job_id')
            if not job_id:
                return jsonify({"success": False, "error": "job_id is required"}), 400

            record = {"job_id": job_id}
            for key in [
                "filename",
                "display_name",
                "media_path",
                "media_kind",
                "media_hash",
                "media_size",
                "media_mtime",
                "status",
                "language",
                "device",
                "summary",
                "transcript_json",
                "transcript_text",
                "segment_count",
                "duration",
                "ui_state",
            ]:
                if key in payload and payload.get(key) is not None:
                    record[key] = payload.get(key)

            native_history.upsert_job_record(record)
            return jsonify({"success": True}), 200
        except Exception as exc:
            logger.error("Failed to upsert job record: %s", exc, exc_info=True)
            return jsonify({"success": False, "error": "Failed to save job record"}), 500

    @app.route('/api/job/record/<job_id>', methods=['GET'])
    def get_job_record(job_id: str):
        """Fetch a job record."""
        try:
            record = native_history.get_job_record(job_id)
            if not record:
                return jsonify({"success": False, "error": "Record not found"}), 404
            return jsonify({"success": True, "record": record}), 200
        except Exception as exc:
            logger.error("Failed to load job record %s: %s", job_id, exc, exc_info=True)
            return jsonify({"success": False, "error": "Failed to load job record"}), 500

    # Web UI - React
    @app.route('/', methods=['GET'])
    def index():
        """Web UI for transcription."""
        templates_dir = get_templates_dir()
        static_dir = get_static_dir()

        react_template = templates_dir / 'index.html'
        react_entry = static_dir / 'ui' / 'app.js'

        if not react_template.exists():
            return "Error: React template missing (templates/index.html).", 500

        if not react_entry.exists():
            return (
                "<!doctype html><html><head><meta charset='utf-8'><title>X-Caption UI Missing</title>"
                "<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:40px;max-width:720px;line-height:1.5}</style>"
                "</head><body>"
                "<h2>X-Caption UI bundle not found</h2>"
                "<p>The React UI build output is missing (<code>static/ui/app.js</code>).</p>"
                "<p>Fix:</p>"
                "<ul>"
                "<li>Dev (HMR): <code>python scripts/dev.py</code></li>"
                "<li>Build UI: <code>python scripts/build_ui.py</code></li>"
                "</ul>"
                "</body></html>",
                503,
                {"Content-Type": "text/html; charset=utf-8"},
            )

        return render_template('index.html', VERSION=VERSION)

    @app.route('/test', methods=['GET'])
    def test_ui():
        """Test UI (alias to the main UI)."""
        return index()

    # Static files fallback
    @app.route('/static/<path:filename>')
    def serve_static(filename):
        """Serve static files"""
        static_dir = get_static_dir()
        return send_from_directory(static_dir, filename)

    # WebSocket emulation endpoints
    @app.route('/socket.io/', methods=['GET', 'POST', 'OPTIONS'])
    def socket_io_endpoint():
        """
        Emulate socket.io endpoint for compatibility
        Returns updates for subscribed jobs
        """
        if request.method == 'OPTIONS':
            return '', 200

        # Get job_id from query or body
        job_id = request.args.get('job_id') or request.json.get('job_id') if request.json else None

        if job_id:
            room = f"job:{job_id}"

            # Get pending updates
            with job_update_lock:
                updates = job_update_queues.get(room, [])
                # Clear old updates (older than 30 seconds)
                current_time = time.time()
                updates = [u for u in updates if current_time - u['timestamp'] < 30]
                job_update_queues[room] = []

            return jsonify({
                'connected': True,
                'updates': updates
            })

        return jsonify({'connected': True, 'updates': []})

    # Job polling endpoint (for WebSocket emulation)
    @app.route('/job/<job_id>/poll', methods=['GET'])
    def poll_job_updates(job_id):
        """
        Poll for job updates (WebSocket emulation)
        Compatible with original UI's socket.on('job_update')
        """
        try:
            room = f"job:{job_id}"

            # Get pending updates
            with job_update_lock:
                updates = job_update_queues.get(room, [])
                # Return and clear updates
                result = list(updates)
                job_update_queues[room] = []

            # Also get current job status from database
            job, job_queue = _find_job(job_id)

            # Always include current job status in response
            if job:
                # Use the queue the job belongs to for meta updates
                if job_queue is None:
                    job_queue = get_queue('default')

                meta_updates = job_queue.get_job_updates(job_id)
                job_meta = getattr(job, 'meta', {}) or {}

                def _meta_value(key, default=None):
                    if isinstance(meta_updates, dict) and key in meta_updates:
                        return meta_updates[key]
                    if key in job_meta:
                        return job_meta[key]
                    return default

                # Always append current status (even if there are pending updates)
                # This ensures UI always gets the latest state, including stage info
                current_status_data = {
                    'job_id': job_id,
                    'status': job.get_status(),
                    'progress': _meta_value('progress', 0),
                    'message': _meta_value('message', ''),
                    'timestamp': time.time()
                }

                # Merge other metadata (stage, partial_result, etc.) so the UI can reflect state transitions
                if isinstance(meta_updates, dict):
                    for key, value in meta_updates.items():
                        if key not in current_status_data:
                            current_status_data[key] = value
                for key, value in job_meta.items():
                    if key not in current_status_data:
                        current_status_data[key] = value

                current_status = {
                    'event': 'job_update',
                    'data': current_status_data,
                    'timestamp': time.time()
                }

                # If there are pending updates, append status at the end
                # If no pending updates, status is the only update
                if result:
                    result.append(current_status)
                else:
                    result = [current_status]

            return jsonify({
                'success': True,
                'updates': result
            })

        except Exception as e:
            logger.error(f"Error polling job updates: {e}")
            return jsonify({'success': False, 'error': str(e)}), 500

    # Job status endpoint
    @app.route('/job/<job_id>', methods=['GET'])
    def get_job_status(job_id):
        """Get job status and results"""
        try:
            # Try to find job in all queues
            job, job_queue = _find_job(job_id)

            if not job:
                record = native_history.get_job_record(job_id)
                if record:
                    status = record.get("status") or "completed"
                    normalized_status = status.lower()
                    progress = 100 if normalized_status == "completed" else -1
                    response = {
                        "job_id": job_id,
                        "status": status,
                        "created_at": native_history._ts_to_iso(record.get("created_at")),
                        "ended_at": native_history._ts_to_iso(record.get("updated_at")),
                        "meta": {
                            "progress": progress,
                            "message": "",
                            "stage": "pipeline",
                        },
                    }
                    if record.get("transcript"):
                        response["result"] = record.get("transcript")
                    elif record.get("transcript_text"):
                        response["result"] = {
                            "job_id": job_id,
                            "text": record.get("transcript_text"),
                            "language": record.get("language"),
                        }
                    return jsonify(response)

                history_entry = native_history.get_entry(job_id)
                if history_entry:
                    status = history_entry.get("status", "completed")
                    normalized_status = status.lower()
                    progress = 100 if normalized_status == "completed" else history_entry.get("progress", -1)
                    message = history_entry.get("message", "")

                    response = {
                        "job_id": job_id,
                        "status": status,
                        "created_at": history_entry.get("created_at"),
                        "ended_at": history_entry.get("completed_at"),
                        "meta": {
                            "progress": progress,
                            "message": message,
                            "stage": "pipeline",
                        },
                    }

                    if history_entry.get("summary"):
                        response["result"] = {
                            "job_id": job_id,
                            "text": history_entry.get("summary"),
                            "language": history_entry.get("language"),
                        }

                    return jsonify(response)

                return jsonify({"error": "Job not found"}), 404

            # Get latest updates
            if job_queue is None:
                job_queue = get_queue('default')

            updates = job_queue.get_job_updates(job_id)

            # Build response (compatible with original UI)
            response = {
                "job_id": job_id,
                "status": job.get_status(),
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "started_at": job.started_at.isoformat() if job.started_at else None,
                "ended_at": job.ended_at.isoformat() if job.ended_at else None,
                "meta": {
                    'progress': updates.get('progress', 0),
                    'message': updates.get('message', ''),
                    'stage': updates.get('stage', 'transcription'),  # Include stage field
                    **updates
                }
            }

            # Add result if completed
            if job.is_finished():
                record = native_history.get_job_record(job_id)
                result = record.get("transcript") if record else None
                if not result:
                    result = updates.get('result') or job.result
                response["result"] = result
            elif job.is_failed():
                response["error"] = str(job.exc_info)

            return jsonify(response)

        except Exception as e:
            logger.error(f"Error getting job status: {e}")
            return jsonify({"error": f"Failed to get job status: {str(e)}"}), 500

    @app.route('/job/<job_id>/terminate', methods=['POST'])
    def terminate_job(job_id):
        """Terminate a specific job"""
        try:
            # Try to find and cancel job in all queues
            job, queue = _find_job(job_id)
            if job and queue:
                job.cancel()
                queue.update_job_status(job_id, 'canceled')

                # Emit termination event
                emit_update(f"job:{job_id}", 'job_terminated', {
                    'job_id': job_id,
                    'message': 'Job was manually terminated',
                    'timestamp': time.time()
                })

                logger.info(f"Terminated job {job_id}")

                return jsonify({
                    "success": True,
                    "message": f"Job {job_id} terminated successfully"
                })

            return jsonify({"error": "Job not found"}), 404

        except Exception as e:
            logger.error(f"Error terminating job {job_id}: {e}")
            return jsonify({"error": f"Failed to terminate job: {str(e)}"}), 500

    @app.route('/job/<job_id>', methods=['DELETE'])
    def remove_job(job_id):
        """Remove a job and all associated artifacts"""
        try:
            uploads_dir = get_uploads_dir()
            transcriptions_dir = get_transcriptions_dir()
            removed_files = []
            removed_dirs = []
            cleanup_errors = []
            candidate_paths = set()
            job_found = False

            for queue_name in QUEUE_NAMES:
                try:
                    queue = get_queue(queue_name)
                except Exception as queue_error:
                    logger.warning(f"Unable to access queue '{queue_name}' while removing job {job_id}: {queue_error}")
                    continue

                meta_sources = []

                try:
                    job = queue.fetch_job(job_id)
                except Exception:
                    job = None

                if job:
                    job_found = True
                    if getattr(job, 'kwargs', None):
                        file_path = job.kwargs.get('file_path')
                        if file_path:
                            candidate_paths.add(file_path)
                    if isinstance(getattr(job, 'meta', None), dict):
                        meta_sources.append(job.meta)
                    if isinstance(getattr(job, 'result', None), dict):
                        meta_sources.append(job.result)

                    try:
                        if job.get_status() not in ('finished', 'failed', 'canceled', 'cancelled', 'deleted'):
                            job.cancel()
                    except Exception as cancel_error:
                        logger.warning(f"Failed to cancel job {job_id}: {cancel_error}")

                meta_updates = queue.get_job_updates(job_id)
                if isinstance(meta_updates, dict):
                    meta_sources.append(meta_updates)

                for meta in meta_sources:
                    if not isinstance(meta, dict):
                        continue
                    file_path = meta.get('file_path')
                    if file_path:
                        candidate_paths.add(file_path)
                    for key in ('result', 'partial_result'):
                        nested = meta.get(key)
                        if isinstance(nested, dict):
                            nested_path = nested.get('file_path')
                            if nested_path:
                                candidate_paths.add(nested_path)

                try:
                    queue.remove_job(job_id)
                except Exception as remove_error:
                    logger.debug(f"No queue record to remove for job {job_id} in queue '{queue_name}': {remove_error}")

            # Inspect persisted transcription output before deletion
            job_output_dir = transcriptions_dir / job_id
            job_json = job_output_dir / f"{job_id}.json"
            if job_json.exists():
                try:
                    with open(job_json, 'r', encoding='utf-8') as f:
                        stored_result = json.load(f)
                        if isinstance(stored_result, dict):
                            stored_path = stored_result.get('file_path')
                            if stored_path:
                                candidate_paths.add(stored_path)
                except Exception as inspect_error:
                    cleanup_errors.append(f"Failed to inspect stored result for {job_id}: {inspect_error}")

            # Remove uploaded audio copies
            for upload_file in uploads_dir.glob(f"{job_id}*"):
                try:
                    if upload_file.is_file():
                        upload_file.unlink()
                        removed_files.append(str(upload_file))
                    elif upload_file.is_dir():
                        shutil.rmtree(upload_file, ignore_errors=True)
                        removed_dirs.append(str(upload_file))
                except Exception as upload_error:
                    cleanup_errors.append(f"Failed to remove upload artifact {upload_file}: {upload_error}")

            # Remove transcription artifacts
            if job_output_dir.exists():
                try:
                    shutil.rmtree(job_output_dir, ignore_errors=True)
                    removed_dirs.append(str(job_output_dir))
                except Exception as dir_error:
                    cleanup_errors.append(f"Failed to remove transcription directory {job_output_dir}: {dir_error}")
            else:
                for artifact in transcriptions_dir.glob(f"{job_id}*"):
                    if artifact.is_file():
                        try:
                            artifact.unlink()
                            removed_files.append(str(artifact))
                        except Exception as artifact_error:
                            cleanup_errors.append(f"Failed to remove transcription artifact {artifact}: {artifact_error}")

            # Remove temporary processing files
            temp_root = Path(tempfile.gettempdir()).resolve()
            temp_dirs_to_remove = set()

            for path_str in candidate_paths:
                try:
                    candidate_path = Path(path_str)
                    resolved = candidate_path.resolve()
                    allowed_roots = [uploads_dir.resolve(), transcriptions_dir.resolve(), temp_root]
                    if not any(root == resolved or root in resolved.parents for root in allowed_roots):
                        continue
                    if candidate_path.exists():
                        if candidate_path.is_file():
                            try:
                                candidate_path.unlink()
                                removed_files.append(str(candidate_path))
                            except Exception as file_error:
                                cleanup_errors.append(f"Failed to remove file {candidate_path}: {file_error}")
                        elif candidate_path.is_dir():
                            try:
                                shutil.rmtree(candidate_path, ignore_errors=True)
                                removed_dirs.append(str(candidate_path))
                            except Exception as dir_error:
                                cleanup_errors.append(f"Failed to remove directory {candidate_path}: {dir_error}")

                    parent = candidate_path.parent
                    try:
                        parent_resolved = parent.resolve()
                        if (
                            parent_resolved != temp_root
                            and temp_root in parent_resolved.parents
                            and parent.name.startswith("tmp")
                        ):
                            temp_dirs_to_remove.add(parent)
                    except Exception:
                        continue
                except Exception as path_error:
                    cleanup_errors.append(f"Failed to process candidate path {path_str}: {path_error}")

            for temp_dir in temp_dirs_to_remove:
                try:
                    if temp_dir.exists():
                        shutil.rmtree(temp_dir, ignore_errors=True)
                        removed_dirs.append(str(temp_dir))
                except Exception as temp_error:
                    cleanup_errors.append(f"Failed to remove temp directory {temp_dir}: {temp_error}")

            # Clear any pending updates for this job
            room_name = f"job:{job_id}"
            with job_update_lock:
                job_update_queues.pop(room_name, None)

            with contextlib.suppress(Exception):
                native_history.remove_entry(job_id)

            message = f"Job {job_id} removed"
            if not job_found:
                message = f"Job {job_id} removed (no active queue entry found)"

            response = {
                "success": True,
                "job_found": job_found,
                "removed_files": sorted(set(removed_files)),
                "removed_directories": sorted(set(removed_dirs)),
                "message": message
            }

            if cleanup_errors:
                response["warnings"] = cleanup_errors

            logger.info(f"Removed job {job_id}: files={len(removed_files)}, dirs={len(removed_dirs)}")

            return jsonify(response), 200

        except Exception as e:
            logger.error(f"Error removing job {job_id}: {e}")
            return jsonify({"success": False, "error": f"Failed to remove job: {str(e)}"}), 500

    @app.route('/audio/<job_id>')
    def serve_audio_file(job_id):
        """Serve the uploaded audio file for a specific job"""
        try:
            uploads_dir = get_uploads_dir()

            audio_file = None

            normalized_file = uploads_dir / _normalized_audio_filename(job_id)
            if normalized_file.exists():
                audio_file = normalized_file
            else:
                audio_extensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.wma', '.webm']
                for ext in audio_extensions:
                    potential_file = uploads_dir / f"{job_id}{ext}"
                    if potential_file.exists():
                        audio_file = potential_file
                        break

            if not audio_file:
                return jsonify({"error": "Audio file not found"}), 404

            mime_type, _ = mimetypes.guess_type(str(audio_file))
            if mime_type is None and audio_file.suffix:
                if audio_file.suffix.lower() in {'.m4a', '.mp4', '.m4v'}:
                    mime_type = 'audio/mp4'
                elif audio_file.suffix.lower() in {'.ogg'}:
                    mime_type = 'audio/ogg'
                elif audio_file.suffix.lower() in {'.webm'}:
                    mime_type = 'audio/webm'
                else:
                    mime_type = 'audio/wav'

            return send_file(
                audio_file,
                as_attachment=False,
                download_name=f"{job_id}{audio_file.suffix or ''}",
                mimetype=mime_type
            )

        except Exception as e:
            logger.error(f"Error serving audio file for job {job_id}: {e}")
            return jsonify({"error": "Failed to serve audio file"}), 500

    @app.route('/media')
    def serve_media_file():
        """Serve a local media file by absolute path (audio/video)."""
        try:
            raw_path = request.args.get("path")
            if not raw_path:
                return jsonify({"error": "path is required"}), 400
            try:
                target_path = Path(raw_path).expanduser()
            except Exception:
                return jsonify({"error": "invalid path"}), 400

            if not target_path.exists() or not target_path.is_file():
                return jsonify({"error": "file not found"}), 404

            if not allowed_file(target_path.name):
                return jsonify({"error": "unsupported file type"}), 400

            mime_type, _ = mimetypes.guess_type(str(target_path))
            return send_file(
                target_path,
                as_attachment=False,
                mimetype=mime_type or "application/octet-stream",
                conditional=True
            )
        except Exception as e:
            logger.error(f"Error serving media file: {e}")
            return jsonify({"error": "Failed to serve media file"}), 500

    @app.route('/import/youtube', methods=['POST'])
    def import_youtube():
        try:
            payload = request.get_json(silent=True) or {}
            url = str(payload.get("url") or "").strip()
            if not url:
                return jsonify({"error": "YouTube URL is required."}), 400
            if not is_youtube_url(url):
                return jsonify({"error": "Only YouTube links are supported."}), 400

            result = _download_youtube_audio(url)
            return jsonify(result), 200

        except Exception as exc:
            logger.error("YouTube import failed: %s", exc, exc_info=True)
            return jsonify({"error": f"Failed to import YouTube audio: {exc}"}), 500

    @app.route('/import/youtube/resolve', methods=['POST'])
    def resolve_youtube_stream():
        try:
            payload = request.get_json(silent=True) or {}
            url = str(payload.get("url") or "").strip()
            if not url:
                return jsonify({"error": "YouTube URL is required."}), 400
            if not is_youtube_url(url):
                return jsonify({"error": "Only YouTube links are supported."}), 400

            result = _resolve_youtube_stream(url)
            return jsonify(result), 200

        except Exception as exc:
            logger.error("YouTube stream resolve failed: %s", exc, exc_info=True)
            return jsonify({"error": f"Failed to resolve YouTube stream: {exc}"}), 500

    @app.route('/import/youtube/start', methods=['POST'])
    def import_youtube_start():
        try:
            payload = request.get_json(silent=True) or {}
            url = str(payload.get("url") or "").strip()
            if not url:
                return jsonify({"error": "YouTube URL is required."}), 400
            if not is_youtube_url(url):
                return jsonify({"error": "Only YouTube links are supported."}), 400

            state = _start_youtube_download(url)
            return jsonify(_serialize_youtube_download(state)), 200
        except Exception as exc:
            logger.error("YouTube import start failed: %s", exc, exc_info=True)
            return jsonify({"error": f"Failed to start YouTube import: {exc}"}), 500

    @app.route('/import/youtube/<download_id>', methods=['GET'])
    def import_youtube_status(download_id: str):
        state = _get_youtube_download_state(download_id)
        if not state:
            return jsonify({"error": "YouTube import not found."}), 404
        return jsonify(_serialize_youtube_download(state)), 200

    @app.route('/import/url/defaults', methods=['GET'])
    def import_url_defaults():
        download_dir = _get_default_download_dir()
        return jsonify({"download_dir": str(download_dir)}), 200

    @app.route('/import/url/start', methods=['POST'])
    def import_url_start():
        try:
            payload = request.get_json(silent=True) or {}
            url = str(payload.get("url") or "").strip()
            download_path = str(payload.get("download_dir") or payload.get("save_path") or "").strip() or None
            if not url:
                return jsonify({"error": "URL is required."}), 400
            if not is_http_url(url):
                return jsonify({"error": "Only http(s) URLs are supported."}), 400

            state = _start_url_download(url, download_path)
            return jsonify(_serialize_url_download(state)), 200
        except Exception as exc:
            logger.error("URL import start failed: %s", exc, exc_info=True)
            return jsonify({"error": f"Failed to start URL download: {exc}"}), 500

    @app.route('/import/url/<download_id>', methods=['GET'])
    def import_url_status(download_id: str):
        state = _get_url_download_state(download_id)
        if not state:
            return jsonify({"error": "URL download not found."}), 404
        return jsonify(_serialize_url_download(state)), 200

    @app.route('/import/url/<download_id>/cancel', methods=['POST'])
    def import_url_cancel(download_id: str):
        state = _cancel_url_download(download_id)
        if not state:
            return jsonify({"error": "URL download not found."}), 404
        return jsonify(_serialize_url_download(state)), 200

    @app.route('/preprocess_audio', methods=['POST'])
    def preprocess_audio():
        try:
            if 'file' not in request.files:
                return jsonify({"error": "No file provided"}), 400

            file = request.files['file']
            if not file or file.filename == '':
                return jsonify({"error": "No file selected"}), 400

            if not allowed_file(file.filename):
                return jsonify({"error": "File type not allowed"}), 400

            preprocess_id = str(uuid.uuid4())
            uploads_dir = get_uploads_dir()
            uploads_dir.mkdir(parents=True, exist_ok=True)

            filename = secure_filename(file.filename)
            suffix = Path(filename).suffix or '.wav'
            original_path = uploads_dir / f"{preprocess_id}{suffix}"
            file.save(str(original_path))

            prepared_path, was_transcoded = _prepare_audio_for_processing(
                preprocess_id,
                str(original_path),
            )

            metadata = {
                "preprocess_id": preprocess_id,
                "original_path": str(original_path),
                "prepared_path": str(prepared_path),
                "was_transcoded": was_transcoded,
                "filename": filename,
                "created_at": time.time(),
            }

            with contextlib.suppress(OSError):
                metadata["original_size"] = Path(original_path).stat().st_size
            with contextlib.suppress(OSError):
                metadata["prepared_size"] = Path(prepared_path).stat().st_size

            metadata_path = uploads_dir / f"{preprocess_id}.json"
            with contextlib.suppress(Exception):
                with open(metadata_path, 'w', encoding='utf-8') as meta_file:
                    json.dump(metadata, meta_file)

            return jsonify({
                "preprocess_id": preprocess_id,
                "playback_url": f"/audio/{preprocess_id}",
                "audio_file": {
                    "name": filename,
                    "path": str(prepared_path),
                    "size": metadata.get("prepared_size"),
                    "was_transcoded": was_transcoded,
                },
                "original_file": {
                    "path": str(original_path),
                    "size": metadata.get("original_size"),
                },
            })

        except Exception as exc:
            logger.error("Audio preprocessing failed: %s", exc, exc_info=True)
            return jsonify({"error": f"Failed to preprocess audio: {exc}"}), 500

    @app.route('/transcribe', methods=['POST'])
    def transcribe_audio():
        """Submit audio file for async transcription"""
        try:
            file_path = request.form.get('file_path') or request.form.get('path')
            filename = request.form.get('filename')
            media_kind = request.form.get('media_kind')
            file = request.files.get('file')

            if not file_path and (not file or file.filename == ''):
                return jsonify({"error": "No file provided"}), 400

            if file_path:
                source_path = Path(file_path)
                if not source_path.exists():
                    return jsonify({"error": "File not found"}), 400
                filename = filename or source_path.name
                if not allowed_file(filename):
                    return jsonify({"error": "File type not allowed"}), 400
            elif file and file.filename == '':
                return jsonify({"error": "No file selected"}), 400
            elif file and not allowed_file(file.filename):
                return jsonify({"error": "File type not allowed"}), 400

            # Get parameters
            model = request.form.get('model', 'whisper')
            language = request.form.get('language', 'auto')
            chinese_style = request.form.get('chinese_style')
            display_name = request.form.get('display_name')
            device = request.form.get('device', 'auto') or 'auto'
            compute_type = request.form.get('compute_type', None)
            vad_filter = request.form.get('vad_filter', 'True').lower() == 'true'

            if not resolve_whisper_model(model):
                return jsonify({
                    "error": (
                        "Model assets not found. "
                        "Use the in-app downloader."
                    )
                }), 400

            # Create or reuse job ID
            requested_job_id = request.form.get('job_id')
            job_id = requested_job_id or str(uuid.uuid4())
            if requested_job_id:
                room_name = f"job:{job_id}"
                with job_update_lock:
                    job_update_queues.pop(room_name, None)
                # Clear any stale job cache/meta across queues for reused job ids.
                for queue_name in QUEUE_NAMES:
                    try:
                        queue = get_queue(queue_name)
                        queue.remove_job(job_id)
                    except Exception:
                        continue

            if not filename:
                filename = secure_filename(file.filename) if file else None
            if not filename:
                filename = f"audio_{job_id}.wav"

            cleanup_paths = []
            if file_path:
                input_path = str(Path(file_path).resolve())
            else:
                temp_dir = Path(tempfile.mkdtemp())
                temp_file = temp_dir / f"{job_id}_{filename}"
                if not file or file.filename == '':
                    return jsonify({"error": "No file provided"}), 400
                file.save(str(temp_file))
                input_path = str(temp_file)
                cleanup_paths.append(str(temp_file))
                cleanup_paths.append(str(temp_dir))

            if not media_kind:
                ext = Path(filename).suffix.lower().lstrip(".")
                media_kind = "video" if ext in _VIDEO_EXTENSIONS else "audio"

            media_size = None
            media_mtime = None
            media_hash = None
            if input_path:
                media_size, media_mtime = native_history.get_file_meta(input_path)
                media_hash = native_history.compute_file_hash(input_path)

            try:
                native_history.upsert_job_record({
                    "job_id": job_id,
                    "filename": filename,
                    "display_name": display_name,
                    "media_path": input_path,
                    "media_kind": media_kind,
                    "media_hash": media_hash,
                    "media_size": media_size,
                    "media_mtime": media_mtime,
                    "status": "processing",
                    "language": language,
                    "device": device,
                })
            except Exception as record_error:
                logger.debug("Failed to create job record %s: %s", job_id, record_error)

            # Prepare job arguments
            job_args = {
                'job_id': job_id,
                'file_path': input_path,
                'model_path': model,
                'language': language,
                'chinese_style': chinese_style,
                'device': device,
                'compute_type': compute_type,
                'vad_filter': vad_filter,
                'original_filename': filename,
                'cleanup_paths': cleanup_paths,
                'media_path': input_path,
                'media_kind': media_kind,
            }

            # Submit job to queue
            queue = get_queue('default')

            job = queue.enqueue(
                process_full_pipeline_job,
                kwargs=job_args,
                job_id=job_id,
            )

            logger.info(f"Submitted job {job_id} to queue: {queue.name}")

            try:
                playback_stat_size = None
                with contextlib.suppress(OSError):
                    playback_stat_size = Path(input_path).stat().st_size
                queue.update_job_meta(job_id, {
                    "original_filename": filename,
                    "audio_file": {
                        "name": filename,
                        "path": input_path,
                        "size": playback_stat_size,
                        "was_transcoded": False,
                    },
                    "language": language,
                    "device": device,
                    "model": model,
                    "message": "Job submitted successfully",
                    "progress": 0,
                })
            except Exception as meta_error:
                logger.warning("Failed to persist initial job metadata for %s: %s", job_id, meta_error)

            # Emit initial status
            emit_update(f"job:{job_id}", 'job_update', {
                'job_id': job_id,
                'status': 'queued',
                'message': 'Job submitted successfully',
                'progress': 0,
                'timestamp': time.time()
            })

            return jsonify({
                "job_id": job_id,
                "status": "queued",
                "message": "Job submitted successfully",
                "filename": filename,
                "websocket_channel": f"job:{job_id}",
                "media_hash": media_hash,
                "media_size": media_size,
                "media_mtime": media_mtime,
                "audio_file": {
                    "name": filename,
                    "path": input_path,
                    "size": playback_stat_size if 'playback_stat_size' in locals() else None,
                    "was_transcoded": False,
                }
            })

        except Exception as e:
            logger.error(f"Error submitting job: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return jsonify({"error": "Internal server error", "details": str(e)}), 500

    @app.route('/transcribe_only', methods=['POST'])
    def transcribe_only():
        """Alias for /transcribe (kept for compatibility)."""
        return transcribe_audio()

    @app.route('/download/<job_id>')
    def download_transcription(job_id):
        """Download transcription result"""
        try:
            transcriptions_dir = get_transcriptions_dir()
            job_dir = transcriptions_dir / job_id

            # Check for formatted text file first (timestamps per segment)
            formatted_file = job_dir / f"{job_id}_formatted.txt"
            if formatted_file.exists():
                return send_file(
                    formatted_file,
                    as_attachment=True,
                    download_name=f"transcription_{job_id}.txt",
                    mimetype='text/plain'
                )

            # Fallback to regular text file
            text_file = job_dir / f"{job_id}.txt"
            if text_file.exists():
                return send_file(
                    text_file,
                    as_attachment=True,
                    download_name=f"transcription_{job_id}.txt",
                    mimetype='text/plain'
                )

            # Fallback to JSON file
            json_file = job_dir / f"{job_id}.json"
            if json_file.exists():
                return send_file(
                    json_file,
                    as_attachment=True,
                    download_name=f"transcription_{job_id}.json",
                    mimetype='application/json'
                )

            return jsonify({"error": "Transcription file not found"}), 404

        except Exception as e:
            logger.error(f"Error downloading transcription {job_id}: {e}")
            return jsonify({"error": "Failed to download transcription"}), 500

    return app


# Override update_job_progress in native_job_handlers to emit updates
def patch_job_handlers():
    """Patch job handlers to emit WebSocket-style updates"""
    import native_job_handlers

    original_update = native_job_handlers.update_job_progress

    def new_update_job_progress(job_id: str, progress: int, message: str, extra_data: Dict[str, Any] = None):
        # Call original update
        original_update(job_id, progress, message, extra_data)

        # Also emit WebSocket-style update
        publish_job_update(job_id, 'progress', {
            'job_id': job_id,
            'progress': progress,
            'message': message,
            'timestamp': time.time(),
            **(extra_data or {})
        })

    native_job_handlers.update_job_progress = new_update_job_progress


def start_server(app, port=11440, host='127.0.0.1'):
    """Start the Flask server"""
    try:
        logger.info(f"Starting web server on {host}:{port}")
        logger.info("WebSocket emulation enabled (using HTTP polling)")
        app.run(host=host, port=port, debug=False, threaded=True)
    except Exception as e:
        logger.error(f"Failed to start server: {e}")
        raise


if __name__ == '__main__':
    # Set up environment
    setup_environment()
    setup_ffmpeg_environment()

    # Patch job handlers to emit updates
    patch_job_handlers()

    # Start worker threads
    start_worker(num_threads=2)

    # Create and start Flask app
    app = create_app()
    port = int(os.environ.get('PORT', 11440))

    logger.info(f"Starting native web server on port {port}...")
    logger.info("Serving React UI and WebSocket emulation")
    start_server(app, port=port)
