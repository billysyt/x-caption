from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Optional, List, Dict, Any

from native_config import get_models_dir, get_bundle_dir, get_data_dir, get_bundled_models_dir
from model_manager import get_whisper_model_info

try:
    from native_gpu_detection import get_whisper_gpu_flags, is_gpu_available
except ImportError:
    def get_whisper_gpu_flags(n_gpu_layers: int = 999) -> list:
        return []
    def is_gpu_available() -> bool:
        return False

logger = logging.getLogger(__name__)

_PROGRESS_MARKER = "__XCAPTION_PROGRESS__"
_JSON_MARKER = "__XCAPTION_JSON__"
_LEGACY_JSON_MARKER = "__XSUB_JSON__"
_PROGRESS_REGEX = re.compile(r"(?i)progress[^0-9]{0,20}([0-9]{1,3}(?:\.[0-9]+)?)")
_PERCENT_REGEX = re.compile(r"([0-9]{1,3}(?:\.[0-9]+)?)%")


def _coerce_progress(value: str | float | int | None) -> Optional[int]:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not (0 <= numeric <= 100):
        return None
    return int(round(numeric))


def _extract_progress(line: str) -> Optional[int]:
    if _PROGRESS_MARKER in line:
        marker_value = line.split(_PROGRESS_MARKER, 1)[-1].strip()
        return _coerce_progress(marker_value)

    lower = line.lower()
    if "progress" in lower:
        match = _PERCENT_REGEX.search(line)
        if match:
            return _coerce_progress(match.group(1))
        match = _PROGRESS_REGEX.search(line)
        if match:
            return _coerce_progress(match.group(1))
    return None


def _stream_process_output(
    cmd: list[str],
    *,
    progress_callback=None,
    progress_message: str = "Transcribing audio...",
    json_marker: Optional[str] = None,
    env: Optional[dict[str, str]] = None,
) -> tuple[int, str, Optional[str]]:
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
        bufsize=1,
        env=env,
    )
    output_lines: list[str] = []
    json_payload: Optional[str] = None
    last_progress: Optional[int] = None

    if proc.stdout:
        for raw in iter(proc.stdout.readline, ""):
            if raw == "":
                break
            for line in raw.splitlines():
                if not line:
                    continue
                output_lines.append(line)
                if json_marker and json_marker in line:
                    json_payload = line.split(json_marker, 1)[-1].strip()
                    continue
                progress = _extract_progress(line)
                if progress_callback and progress is not None:
                    if last_progress is None or progress > last_progress:
                        last_progress = progress
                        progress_callback(progress, progress_message)
    return_code = proc.wait()
    return return_code, "\n".join(output_lines), json_payload


def _platform_exe_name(base: str) -> str:
    if os.name == "nt" and not base.endswith(".exe"):
        return f"{base}.exe"
    return base


def resolve_whisper_engine() -> Optional[Path]:
    env_path = os.environ.get("XCAPTION_WHISPER_ENGINE")
    candidates: List[Path] = []
    if env_path:
        candidates.append(Path(env_path))

    models_dir = get_models_dir()
    candidates.append(models_dir / _platform_exe_name("engine"))
    candidates.append(models_dir / _platform_exe_name("whisper"))

    legacy_models_dir = get_data_dir() / "models" / "whisper"
    candidates.append(legacy_models_dir / _platform_exe_name("engine"))
    candidates.append(legacy_models_dir / _platform_exe_name("whisper"))

    bundle_dir = get_bundle_dir()
    candidates.append(bundle_dir / "whisper" / _platform_exe_name("engine"))
    candidates.append(bundle_dir / "whisper" / _platform_exe_name("whisper"))
    candidates.append(bundle_dir / "Resources" / "whisper" / _platform_exe_name("engine"))
    candidates.append(bundle_dir / "whisper" / "video.mjs")
    candidates.append(bundle_dir / "Resources" / "whisper" / "video.mjs")

    for candidate in candidates:
        if candidate and candidate.exists() and candidate.is_file():
            return candidate
    return None


def resolve_node_binary() -> Optional[str]:
    """Return a usable Node.js binary path if available."""
    def _candidate_names() -> list[str]:
        return ["node.exe", "node"] if os.name == "nt" else ["node"]

    env_path = os.environ.get("XCAPTION_NODE")
    if env_path:
        candidate = Path(env_path).expanduser()
        if candidate.exists():
            if candidate.is_file():
                return str(candidate)
            if candidate.is_dir():
                for name in _candidate_names():
                    for subdir in ("", "bin"):
                        node_path = candidate / subdir / name if subdir else candidate / name
                        if node_path.exists() and node_path.is_file():
                            return str(node_path)

    bundle_dir = get_bundle_dir()
    candidates: list[Path] = []
    for name in _candidate_names():
        candidates.extend([
            bundle_dir / "node" / "bin" / name,
            bundle_dir / "node" / name,
            bundle_dir / "Resources" / "node" / "bin" / name,
            bundle_dir / "Resources" / "node" / name,
            bundle_dir / "whisper" / "node" / "bin" / name,
            bundle_dir / "whisper" / "node" / name,
        ])
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return str(candidate)

    return shutil.which("node")


def resolve_whisper_model(model_path: Optional[str] = None) -> Optional[Path]:
    if model_path:
        candidate = Path(model_path)
        if candidate.exists() and candidate.is_file():
            return candidate
        if not candidate.is_absolute():
            local_candidate = get_models_dir() / candidate
            if local_candidate.exists() and local_candidate.is_file():
                return local_candidate
            legacy_candidate = get_data_dir() / "models" / "whisper" / candidate
            if legacy_candidate.exists() and legacy_candidate.is_file():
                return legacy_candidate

    info = get_whisper_model_info(get_models_dir())
    default_model = info.path
    if default_model.exists() and default_model.is_file():
        return default_model

    legacy_model = get_data_dir() / "models" / "whisper" / info.filename
    if legacy_model.exists() and legacy_model.is_file():
        return legacy_model

    bundle_root = get_bundled_models_dir()
    if bundle_root:
        bundle_info = get_whisper_model_info(bundle_root)
        if bundle_info.path.exists() and bundle_info.path.is_file():
            return bundle_info.path

    bundle_candidate = get_bundle_dir() / "whisper" / info.filename
    if bundle_candidate.exists() and bundle_candidate.is_file():
        return bundle_candidate

    return None


def _parse_srt_timestamp(value: str) -> Optional[float]:
    try:
        parts = value.replace(",", ":").split(":")
        if len(parts) != 4:
            return None
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
        millis = int(parts[3])
        return hours * 3600 + minutes * 60 + seconds + (millis / 1000.0)
    except Exception:
        return None


def _parse_time_string(value: str) -> Optional[float]:
    raw = (value or "").strip()
    if not raw:
        return None
    cleaned = raw.replace(",", ".")
    if ":" in cleaned:
        parts = cleaned.split(":")
        try:
            nums = [float(part) for part in parts]
        except Exception:
            return None
        if len(nums) == 3:
            hours, minutes, seconds = nums
        elif len(nums) == 2:
            hours = 0.0
            minutes, seconds = nums
        elif len(nums) == 1:
            hours = 0.0
            minutes = 0.0
            seconds = nums[0]
        else:
            return None
        return (hours * 3600.0) + (minutes * 60.0) + seconds
    try:
        return float(cleaned)
    except Exception:
        return None


def _coerce_time(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        parsed = _parse_time_string(value)
        return float(parsed) if parsed is not None else 0.0
    return 0.0


def _parse_srt_segments(srt_text: str) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    blocks = [block.strip() for block in srt_text.strip().split("\n\n") if block.strip()]
    for block in blocks:
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        time_line = lines[1] if "-->" in lines[1] else lines[0]
        if "-->" not in time_line:
            continue
        time_parts = [part.strip() for part in time_line.split("-->")]
        if len(time_parts) != 2:
            continue
        start = _parse_srt_timestamp(time_parts[0])
        end = _parse_srt_timestamp(time_parts[1])
        if start is None or end is None:
            continue
        text_lines = lines[2:] if "-->" in lines[1] else lines[1:]
        text = " ".join(text_lines).strip()
        segments.append({"start": float(start), "end": float(end), "text": text})
    return segments


def transcribe_whisper_cpp(
    audio_path: Path | str,
    *,
    model_path: Optional[str] = None,
    language: Optional[str] = None,
    output_dir: Optional[Path] = None,
    progress_callback=None,
) -> Dict[str, Any]:
    engine = resolve_whisper_engine()
    if not engine:
        raise RuntimeError(
            "Transcription engine not found. Place the engine binary in the data directory, "
            "or add the node-based engine module, or set XCAPTION_WHISPER_ENGINE to the path."
        )

    model_file = resolve_whisper_model(model_path)
    if not model_file:
        raise RuntimeError(
            "Model assets not found. "
            "Use the in-app model downloader to fetch the required files."
        )

    audio_path = Path(audio_path)
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if output_dir is None:
        output_dir = Path.cwd()
    output_dir.mkdir(parents=True, exist_ok=True)

    output_prefix = output_dir / "whisper"
    json_path = output_prefix.with_suffix(".json")
    srt_path = output_prefix.with_suffix(".srt")
    txt_path = output_prefix.with_suffix(".txt")

    if progress_callback:
        progress_callback(10, "Starting transcription")

    if engine.suffix.lower() == ".mjs":
        node_bin = resolve_node_binary()
        if not node_bin:
            raise RuntimeError(
                "Node.js runtime not found. Install Node.js or set XCAPTION_NODE to its path."
            )
        progress_marker = _PROGRESS_MARKER
        json_marker = _JSON_MARKER
        node_script = f"""
import {{ pathToFileURL }} from 'url';
const moduleUrl = pathToFileURL({json.dumps(str(engine))}).href;
const {{ transcribeAudio }} = await import(moduleUrl);
const progressMarker = {json.dumps(progress_marker)};
const progressCallback = (progress) => {{
  if (typeof progress === 'number' && Number.isFinite(progress)) {{
    const rounded = Math.round(progress);
    console.log(`${{progressMarker}}${{rounded}}`);
  }}
}};
const result = await transcribeAudio({json.dumps(str(audio_path))}, {{
  model: {json.dumps(str(model_file))},
  language: {json.dumps(language or 'auto')},
  progress_callback: progressCallback
}});
console.log('{json_marker}' + JSON.stringify(result));
""".strip()
        cmd = [node_bin, "--input-type=module", "-e", node_script]
        logger.info("Running whisper node runner: %s", " ".join(cmd))
        env = os.environ.copy()
        if not is_gpu_available():
            env["XCAPTION_FORCE_CPU"] = "1"

        return_code, output, json_payload = _stream_process_output(
            cmd,
            progress_callback=progress_callback,
            progress_message="Transcribing audio...",
            json_marker=_JSON_MARKER,
            env=env,
        )
        if return_code != 0:
            details = output.strip() or "Unknown error"
            raise RuntimeError(f"Transcription runner failed: {details}")

        parsed = None
        if json_payload:
            try:
                parsed = json.loads(json_payload)
            except Exception:
                parsed = None
        if parsed is None:
            for line in output.splitlines()[::-1]:
                if _JSON_MARKER in line or _LEGACY_JSON_MARKER in line:
                    marker = _JSON_MARKER if _JSON_MARKER in line else _LEGACY_JSON_MARKER
                    payload = line.split(marker, 1)[-1].strip()
                    try:
                        parsed = json.loads(payload)
                        break
                    except Exception:
                        continue
        if parsed is None:
            raise RuntimeError("Transcription runner returned no JSON output")

        if isinstance(parsed, str):
            try:
                parsed = json.loads(parsed)
            except Exception:
                pass

        segments: List[Dict[str, Any]] = []
        detected_language = None
        if isinstance(parsed, dict):
            detected_language = parsed.get("language")
            raw_segments = parsed.get("segments") or parsed.get("result") or parsed.get("transcription") or []
            if isinstance(raw_segments, list):
                for seg in raw_segments:
                    if isinstance(seg, (list, tuple)) and len(seg) >= 3:
                        segments.append({
                            "start": _coerce_time(seg[0]),
                            "end": _coerce_time(seg[1]),
                            "text": str(seg[2]).strip(),
                        })
                    elif isinstance(seg, dict):
                        start = seg.get("start", seg.get("from", 0.0))
                        end = seg.get("end", seg.get("to", 0.0))
                        text = seg.get("text") or seg.get("text_segment") or seg.get("content") or ""
                        segments.append({
                            "start": _coerce_time(start),
                            "end": _coerce_time(end),
                            "text": str(text).strip(),
                        })
        elif isinstance(parsed, list):
            for seg in parsed:
                if isinstance(seg, (list, tuple)) and len(seg) >= 3:
                    segments.append({
                        "start": _coerce_time(seg[0]),
                        "end": _coerce_time(seg[1]),
                        "text": str(seg[2]).strip(),
                    })

        if not segments and srt_path.exists():
            try:
                srt_text = srt_path.read_text(encoding="utf-8", errors="ignore")
                segments = _parse_srt_segments(srt_text)
            except Exception:
                pass

        transcript_text = " ".join([seg["text"] for seg in segments]).strip()
        duration = None
        if segments:
            duration = max(seg.get("end", 0.0) for seg in segments)

        if txt_path.exists() and not transcript_text:
            try:
                transcript_text = txt_path.read_text(encoding="utf-8", errors="ignore").strip()
            except Exception:
                pass

        if progress_callback:
            progress_callback(90, "Finalizing transcript")

        return {
            "segments": segments,
            "text": transcript_text,
            "language": detected_language or language or "auto",
            "duration": duration,
        }

    cmd = [
        str(engine),
        "-m",
        str(model_file),
        "-f",
        str(audio_path),
        "-of",
        str(output_prefix),
        "-osrt",
        "-otxt",
        "-oj",
    ]
    if language and language not in {"auto", ""}:
        cmd.extend(["-l", language])

    # Add GPU acceleration flags if available
    gpu_flags = get_whisper_gpu_flags()
    if gpu_flags:
        cmd.extend(gpu_flags)
        logger.info("GPU acceleration enabled with flags: %s", " ".join(gpu_flags))

    logger.info("Running whisper.cpp: %s", " ".join(cmd))
    return_code, output, _ = _stream_process_output(
        cmd,
        progress_callback=progress_callback,
        progress_message="Transcribing audio...",
    )
    if return_code != 0 and "-oj" in cmd:
        fallback_cmd = [arg for arg in cmd if arg != "-oj"]
        return_code, output, _ = _stream_process_output(
            fallback_cmd,
            progress_callback=progress_callback,
            progress_message="Transcribing audio...",
        )

    if return_code != 0:
        details = output.strip() or "Unknown error"
        raise RuntimeError(f"Transcription engine failed: {details}")

    segments: List[Dict[str, Any]] = []
    detected_language = None

    if json_path.exists():
        try:
            with json_path.open("r", encoding="utf-8") as f:
                payload = json.load(f)
            detected_language = payload.get("language")
            raw_segments = payload.get("segments") or []
            for seg in raw_segments:
                segments.append({
                    "start": _coerce_time(seg.get("start", 0.0)),
                    "end": _coerce_time(seg.get("end", 0.0)),
                    "text": str(seg.get("text", "")).strip(),
                })
        except Exception as exc:
            logger.warning("Failed to parse whisper JSON output: %s", exc)

    if not segments and srt_path.exists():
        try:
            srt_text = srt_path.read_text(encoding="utf-8", errors="ignore")
            segments = _parse_srt_segments(srt_text)
        except Exception as exc:
            logger.warning("Failed to parse whisper SRT output: %s", exc)

    if progress_callback:
        progress_callback(90, "Finalizing transcript")

    transcript_text = " ".join([seg["text"] for seg in segments]).strip()
    duration = None
    if segments:
        duration = max(seg.get("end", 0.0) for seg in segments)

    if txt_path.exists() and not transcript_text:
        try:
            transcript_text = txt_path.read_text(encoding="utf-8", errors="ignore").strip()
        except Exception:
            pass

    return {
        "segments": segments,
        "text": transcript_text,
        "language": detected_language or language or "auto",
        "duration": duration,
    }
